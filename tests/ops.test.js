// Надёжность: скорость базы (индексы под частые запросы), отклики на закрытые объявления,
// резервные копии и присмотр сервера за копиями и местом на диске.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jolda-test-ops-'));
process.env.DEMO_MODE = '1';
delete process.env.OSRM_URL;
delete process.env.FCM_SERVICE_ACCOUNT;
const { createApp, housekeeping } = await import('../server/index.js');
const { seed } = await import('../server/seed.js');
const { db, q, q1, run } = await import('../server/db.js');
const { healthProblems, checkHealth } = await import('../server/health.js');

let server;
let base;
before(async () => {
  seed();
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function client() {
  const c = { cookie: '' };
  c.call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: c.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) c.cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  const ok = async (method, url, body) => {
    const r = await c.call(method, url, body);
    assert.ok(r.status < 300, `${method} ${url} → ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  };
  return Object.assign(c, { get: (u) => ok('GET', u), post: (u, b = {}) => ok('POST', u, b), put: (u, b) => ok('PUT', u, b) });
}
async function signIn(phone, reg) {
  const c = client();
  const { devCode } = await c.post('/api/auth/request-code', { phone });
  const v = await c.post('/api/auth/verify', { phone, code: devCode });
  const me = v.registered ? v : await c.post('/api/auth/register', { regToken: v.regToken, accept: true, ...reg });
  return Object.assign(c, { me });
}
const day = (n) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
const cargo = (extra = {}) => ({ kind: 'cargo', points: ['shymkent', 'almaty'], weight: 10, dateFrom: day(0), dateTo: day(3), ...extra });

test('частые запросы идут по индексам, а не перебором всех рейсов и отзывов', () => {
  const plan = (sql, ...p) => db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...p).map((r) => r.detail);
  const scans = (sql, ...p) => plan(sql, ...p).filter((d) => /^SCAN /.test(d));
  // репутация всех компаний: один проход по компаниям, остальное — по индексам. Иначе на 2000 компаний и 20 000 рейсов
  // это секунды, и на это время замирают все пользователи
  assert.deepEqual(scans('SELECT * FROM company_stats'), ['SCAN c']);
  const indexed = [
    [`SELECT COUNT(*) AS n FROM trips WHERE status = 'active' AND (customer_company = ? OR carrier_company = ?)`, 1, 1],
    ['SELECT id FROM users WHERE company_id = ?', 1],
    ['SELECT stage, at FROM trip_events WHERE trip_id = ? ORDER BY id', 1],
    ['SELECT id FROM chats WHERE owner_company = ? OR peer_company = ?', 1, 1],
    ['SELECT id FROM trips t WHERE t.response_id = ? ORDER BY t.id LIMIT 1', 1],
    [`SELECT COUNT(*) AS n FROM responses r JOIN listings l ON l.id = r.listing_id WHERE l.company_id = ? AND r.status = 'sent'`, 1],
    ['SELECT * FROM vehicles WHERE company_id = ? ORDER BY id DESC', 1],
    ['DELETE FROM sessions WHERE user_id = ?', 1],
  ];
  for (const [sql, ...p] of indexed) assert.deepEqual(scans(sql, ...p), [], sql);
});

test('объявление закрылось — отклики «на рассмотрении» отклоняются', async () => {
  const customer = await signIn('+77062100001', { name: 'Заказчик', companyName: 'Груз Срок', companyForm: 'ТОО', role: 'customer' });
  const carrier = await signIn('+77062100002', { name: 'Перевозчик', companyName: 'Авто Срок', companyForm: 'ТОО', role: 'carrier' });
  const admin = client();
  await admin.post('/api/auth/demo', { role: 'admin' });
  const respond = async (listingId) => (await carrier.post(`/api/listings/${listingId}/responses`, { message: 'Готов везти', price: 300000 })).id;
  const mine = async (id) => q1('SELECT status FROM responses WHERE id = ?', id).status;

  // срок объявления вышел
  const expired = (await customer.post('/api/listings', cargo())).id;
  const r1 = await respond(expired);
  assert.equal((await customer.get('/api/me')).counters.responses, 1);
  run(`UPDATE listings SET date_from = ?, date_to = ? WHERE id = ?`, day(-5), day(-1), expired);
  housekeeping();
  assert.equal(q1('SELECT status FROM listings WHERE id = ?', expired).status, 'closed');
  assert.equal(await mine(r1), 'declined', 'перевозчик не ждёт ответа по закрытому объявлению');
  assert.equal((await customer.get('/api/me')).counters.responses, 0, 'у владельца нет значка откликов на закрытое объявление');

  // объявление снял модератор по жалобе
  const removed = (await customer.post('/api/listings', cargo({ points: ['almaty', 'astana'] }))).id;
  const r2 = await respond(removed);
  await carrier.post('/api/complaints', { listingId: removed, reason: 'fraud', text: 'Просят предоплату' });
  const complaint = q1(`SELECT id FROM complaints WHERE listing_id = ? AND status = 'open'`, removed).id;
  await admin.post(`/api/admin/complaints/${complaint}`, { action: 'close_listing' });
  assert.equal(q1('SELECT status FROM listings WHERE id = ?', removed).status, 'removed');
  assert.equal(await mine(r2), 'declined');

  // отклик, оставшийся «новым» по объявлению, закрытому до этого исправления, поправляется сам
  const old = (await customer.post('/api/listings', cargo({ points: ['aktobe', 'atyrau'] }))).id;
  const r3 = await respond(old);
  run(`UPDATE listings SET status = 'archived' WHERE id = ?`, old);
  const live = (await customer.post('/api/listings', cargo({ points: ['astana', 'karaganda'] }))).id;
  const r4 = await respond(live);
  housekeeping();
  assert.equal(await mine(r3), 'declined');
  assert.equal(await mine(r4), 'sent', 'отклики на действующие объявления не трогаем');
});

// ---------- резервные копии ----------
const script = fileURLToPath(new URL('../scripts/backup.mjs', import.meta.url));
const NIGHTLY = /^jolda-\d{4}-/;
function backupSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jolda-test-backup-'));
  const [data, out] = [path.join(dir, 'data'), path.join(dir, 'out')];
  fs.mkdirSync(path.join(data, 'uploads'), { recursive: true });
  db.exec(`VACUUM INTO '${path.join(data, 'jolda.db')}'`);
  fs.writeFileSync(path.join(data, 'vapid.json'), '{}');
  fs.writeFileSync(path.join(data, 'uploads', 'ttn.pdf'), 'накладная');
  const backup = (args = [], env = {}) => spawnSync(process.execPath, [script, out, ...args], { env: { ...process.env, DATA_DIR: data, BACKUP_REMOTE: '', ...env }, encoding: 'utf8' });
  const status = () => JSON.parse(fs.readFileSync(path.join(data, 'backup-status.json'), 'utf8'));
  const copies = () => fs.readdirSync(out).filter((f) => f.endsWith('.tar.gz')).sort();
  return { dir, data, out, backup, status, copies };
}

test('копии перед обновлением хранятся отдельно и не вытесняют ночные', () => {
  const s = backupSandbox();
  assert.equal(s.backup().status, 0);
  const nightly = s.copies().filter((f) => NIGHTLY.test(f));
  assert.equal(nightly.length, 1);
  // серия из восьми обновлений подряд (минуты разные — имитируем именами файлов)
  for (let i = 1; i <= 8; i++) {
    assert.equal(s.backup(['--update']).status, 0);
    const made = s.copies().filter((f) => f.startsWith('jolda-update-')).at(-1);
    fs.renameSync(path.join(s.out, made), path.join(s.out, `jolda-update-2026-01-0${i}-10-00.tar.gz`));
  }
  assert.equal(s.backup(['--update']).status, 0);
  const all = s.copies();
  assert.equal(all.filter((f) => f.startsWith('jolda-update-')).length, 5, 'копий перед обновлением — последние пять');
  assert.deepEqual(all.filter((f) => NIGHTLY.test(f)), nightly, 'ночная копия на месте');
  assert.equal(s.status().ok, true);

  // ночных — не больше заданного числа
  for (let i = 1; i <= 4; i++) fs.copyFileSync(path.join(s.out, nightly[0]), path.join(s.out, `jolda-2026-01-0${i}-03-30.tar.gz`));
  assert.equal(s.backup([], { KEEP_DAYS: '3' }).status, 0);
  assert.equal(s.copies().filter((f) => NIGHTLY.test(f)).length, 3);
  assert.equal(s.copies().filter((f) => f.startsWith('jolda-update-')).length, 5);
});

test('копия восстанавливается; загруженные файлы хранятся один раз и докладываются', () => {
  const s = backupSandbox();
  assert.equal(s.backup().status, 0);
  assert.deepEqual(fs.readdirSync(path.join(s.out, 'uploads')), ['ttn.pdf']);
  // в архиве — база и ключи, без загруженных файлов
  const archive = path.join(s.out, s.copies()[0]);
  assert.deepEqual(spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' }).stdout.trim().split('\n').sort(), ['jolda.db', 'vapid.json']);

  // появился новый файл, старый удалили с сайта: в копиях есть оба
  fs.writeFileSync(path.join(s.data, 'uploads', 'photo.jpg'), 'фото груза');
  fs.rmSync(path.join(s.data, 'uploads', 'ttn.pdf'));
  const second = s.backup();
  assert.equal(second.status, 0);
  assert.deepEqual(fs.readdirSync(path.join(s.out, 'uploads')).sort(), ['photo.jpg', 'ttn.pdf']);
  assert.equal(s.status().uploadsCopied, 1, 'скопирован только новый файл');

  // восстановление на чистый сервер: распаковать архив и вернуть загруженные файлы
  const restored = path.join(s.dir, 'restored');
  fs.mkdirSync(restored);
  assert.equal(spawnSync('tar', ['-xzf', archive, '-C', restored]).status, 0);
  fs.cpSync(path.join(s.out, 'uploads'), path.join(restored, 'uploads'), { recursive: true });
  const check = spawnSync(process.execPath, ['-e', `
    const { DatabaseSync } = require('node:sqlite');
    const d = new DatabaseSync(process.argv[1], { readOnly: true });
    console.log(Object.values(d.prepare('PRAGMA integrity_check').get())[0], d.prepare('SELECT COUNT(*) AS n FROM users').get().n);
  `, path.join(restored, 'jolda.db')], { encoding: 'utf8' });
  assert.equal(check.stdout.trim(), `ok ${q1('SELECT COUNT(*) AS n FROM users').n}`);
  assert.equal(fs.readFileSync(path.join(restored, 'uploads', 'ttn.pdf'), 'utf8'), 'накладная');
});

test('мало места на диске — копия не делается и сайт не останавливает; сбой виден серверу', () => {
  const s = backupSandbox();
  assert.equal(s.backup().status, 0);
  const good = s.status().lastOk;
  const r = s.backup([], { MIN_FREE_MB: '999999999' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /недостаточно места на диске/);
  assert.equal(s.copies().length, 1, 'новых файлов в папке копий нет');
  assert.equal(fs.readdirSync(s.out).some((f) => f.startsWith('.tmp-') || f.endsWith('.part')), false);
  assert.equal(s.status().ok, false);
  assert.equal(s.status().lastOk, good, 'время последней удачной копии сохранено');

  // вторая площадка: копия уходит и туда; недоступная площадка — это отметка, а не потеря местной копии
  if (spawnSync('rsync', ['--version']).status === 0) {
    const remote = path.join(s.dir, 'remote');
    fs.mkdirSync(remote);
    assert.equal(s.backup([], { BACKUP_REMOTE: remote }).status, 0);
    assert.equal(s.status().remote, 'ok');
    assert.ok(fs.readdirSync(remote).some((f) => NIGHTLY.test(f)) && fs.existsSync(path.join(remote, 'uploads', 'ttn.pdf')));
    assert.equal(s.backup(['--update'], { BACKUP_REMOTE: remote }).status, 0);
    assert.equal(s.status().remote, 'ok', 'копия перед обновлением отметку отправки не меняет');
    const down = s.backup([], { BACKUP_REMOTE: path.join(s.data, 'vapid.json', 'x') }); // не папка — отправить некуда
    assert.equal(down.status, 0);
    assert.equal(s.status().ok, true);
    assert.equal(s.status().remote, 'failed');
  }
});

test('сервер предупреждает администратора о пропавших копиях и заполненном диске — не чаще раза в сутки', () => {
  const GB = 1024 ** 3;
  const now = Date.parse('2026-11-19T10:00:00Z');
  const fine = { status: { lastOk: '2026-11-19T03:30:00Z', remote: 'ok' }, free: 15 * GB, total: 24 * GB, now };
  const codes = (over) => healthProblems({ ...fine, ...over }).map((p) => p.code);
  assert.deepEqual(codes({}), []);
  assert.deepEqual(codes({ status: null }), ['backup'], 'копий не было вовсе');
  assert.deepEqual(codes({ status: { lastOk: '2026-11-17T03:30:00Z' } }), ['backup'], 'последняя копия — двое суток назад');
  assert.deepEqual(codes({ status: { lastOk: '2026-11-18T03:30:00Z' } }), [], 'вчерашняя ночная копия — норма');
  assert.deepEqual(codes({ status: { ...fine.status, remote: 'failed' } }), ['backup_remote']);
  assert.deepEqual(codes({ free: 2 * GB }), ['disk'], 'меньше десятой части диска');
  assert.deepEqual(codes({ free: 0.5 * GB, total: 4 * GB }), ['disk']);
  assert.equal(healthProblems({ ...fine, free: 2 * GB })[0].vars.n, '2.0');

  // в папке данных теста копий нет: администраторы получают уведомление один раз за сутки
  const admins = q('SELECT id FROM users WHERE is_admin = 1').length;
  const sent = () => q1(`SELECT COUNT(*) AS n FROM notifications WHERE title = 'Резервные копии не создаются'`).n;
  assert.ok(admins > 0);
  assert.ok(checkHealth(now).some((p) => p.code === 'backup'));
  assert.equal(sent(), admins);
  checkHealth(now + 3600_000);
  assert.equal(sent(), admins, 'через час — без повтора');
  checkHealth(now + 25 * 3600_000);
  assert.equal(sent(), admins * 2, 'через сутки — напоминание');
  // копия появилась — предупреждений больше нет
  fs.writeFileSync(path.join(process.env.DATA_DIR, 'backup-status.json'), JSON.stringify({ ok: true, lastOk: new Date(now + 49 * 3600_000).toISOString(), remote: 'off' }));
  assert.equal(checkHealth(now + 50 * 3600_000).some((p) => p.code === 'backup'), false);
});
