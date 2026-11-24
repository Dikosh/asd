// Выключение демо-режима: демо-аккаунты перестают действовать, входы, открытые во время демо, закрываются,
// а на боевом сервере демо не запускается без явного подтверждения. Здесь сервер работает БЕЗ демо-режима.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jolda-test-demo-off-'));
delete process.env.DEMO_MODE;
delete process.env.SMS_WEBHOOK_URL;
delete process.env.OSRM_URL;
delete process.env.FCM_SERVICE_ACCOUNT;
process.env.SMS_DAILY_MAX = '400'; // предел кодов на всю площадку — небольшой, чтобы его можно было проверить
const { createApp, leaveDemoMode } = await import('../server/index.js');
const { syncAdmins, smsAllowed } = await import('../server/routes/auth.js');
const { seed } = await import('../server/seed.js');
const { q1, run, insert, tx } = await import('../server/db.js');

const entry = fileURLToPath(new URL('../server/index.js', import.meta.url));
let server;
let base;
let demoAdmin;
let realUser;
before(async () => {
  // база после показа: демо-данные, настоящий пользователь и входы, открытые во время демо
  seed();
  run(`INSERT INTO app_state(key, value) VALUES('demo', '1')`);
  demoAdmin = q1('SELECT * FROM users WHERE is_admin = 1 AND is_demo = 1');
  const company = insert(`INSERT INTO companies(name, form) VALUES('Настоящая компания', 'ТОО')`);
  realUser = { id: insert(`INSERT INTO users(name, phone, email, role, company_id, accepted_terms) VALUES('Настоящий Пользователь', '+77059990001', '', 'customer', ?, '2026-01-01')`, company) };
  run(`INSERT INTO sessions(token, user_id) VALUES('demo-admin-sid', ?)`, demoAdmin.id);
  run(`INSERT INTO sessions(token, user_id) VALUES('real-user-sid', ?)`, realUser.id);
  run(`INSERT INTO push_devices(user_id, token, platform) VALUES(?, 'device-token-1', 'android')`, realUser.id);
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = async (method, url, { sid, body } = {}) => {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(sid ? { Cookie: `sid=${sid}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};

test('вход демо-администратора, открытый во время демо, не действует', async () => {
  assert.equal((await call('GET', '/api/me', { sid: 'demo-admin-sid' })).data, null);
  assert.equal((await call('GET', '/api/admin/metrics', { sid: 'demo-admin-sid' })).status, 401);
});

test('быстрый вход и код на экране выключены, демо-номер недоступен', async () => {
  assert.equal((await call('POST', '/api/auth/demo', { body: { role: 'admin' } })).status, 403);
  assert.equal((await call('POST', '/api/auth/request-code', { body: { phone: demoAdmin.phone } })).status, 403);
  // без SMS-провайдера код не выдаётся и на экран не попадает
  const r = await call('POST', '/api/auth/request-code', { body: { phone: '+77059990002' } });
  assert.equal(r.status, 503);
  assert.equal(r.data.devCode, undefined);
  assert.equal((await call('GET', '/api/meta')).data.demo, false);
});

test('при первом запуске без демо закрываются все входы и отвязываются устройства', async () => {
  // под настоящим номером во время демо мог войти кто угодно — этот вход пока жив
  assert.equal((await call('GET', '/api/me', { sid: 'real-user-sid' })).data.user.id, realUser.id);
  leaveDemoMode();
  assert.equal((await call('GET', '/api/me', { sid: 'real-user-sid' })).data, null);
  assert.equal(q1('SELECT COUNT(*) AS n FROM sessions').n, 0);
  assert.equal(q1('SELECT COUNT(*) AS n FROM push_devices').n, 0);
  assert.equal(q1(`SELECT value FROM app_state WHERE key = 'demo'`).value, '0');
});

test('следующие запуски без демо входы не трогают', () => {
  run(`INSERT INTO sessions(token, user_id) VALUES('real-user-sid-2', ?)`, realUser.id);
  leaveDemoMode();
  assert.equal(q1('SELECT COUNT(*) AS n FROM sessions').n, 1);
});

test('база без отметки о режиме, но с демо-пользователями считается базой после демо', () => {
  run(`DELETE FROM app_state WHERE key = 'demo'`);
  leaveDemoMode();
  assert.equal(q1('SELECT COUNT(*) AS n FROM sessions').n, 0);
});

const env = (extra) => ({ ...process.env, DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'jolda-test-demo-prod-')), NODE_ENV: 'production', PORT: '0', ...extra });

test('модераторы — по списку ADMIN_PHONE: права выдаются и снимаются, демо-аккаунты не затрагиваются', () => {
  const admin = (id) => q1('SELECT is_admin FROM users WHERE id = ?', id).is_admin;
  assert.deepEqual(syncAdmins(new Set()), { granted: 0, revoked: 0 }, 'без списка права никто не трогает');
  assert.deepEqual(syncAdmins(new Set(['+77059990001', '+77059990002'])), { granted: 1, revoked: 0 });
  assert.equal(admin(realUser.id), 1);
  assert.deepEqual(syncAdmins(new Set(['+77059990002'])), { granted: 0, revoked: 1 }, 'номер убрали из списка — права сняты');
  assert.equal(admin(realUser.id), 0);
  assert.equal(admin(demoAdmin.id), 1, 'демо-администратор остаётся для демо-стенда');
});

test('опечатка в ADMIN_PHONE: сервер не запускается и говорит, какой номер неверный', () => {
  const r = spawnSync(process.execPath, [entry], { env: env({ ADMIN_PHONE: '+7 701 123 45 67, 12345' }), encoding: 'utf8', timeout: 20_000 });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /ADMIN_PHONE: некорректный номер «12345»/);
});

test('очистка базы (npm run seed -- --reset) проходит до конца и не оставляет старых данных', () => {
  const seedJs = fileURLToPath(new URL('../server/seed.js', import.meta.url));
  const e = env({ NODE_ENV: 'test' });
  const first = spawnSync(process.execPath, [seedJs], { env: e, encoding: 'utf8', timeout: 60_000 });
  assert.equal(first.status, 0, first.stderr);
  // следы работы площадки в таблицах, которых не было в прежнем ручном списке
  const mark = spawnSync(process.execPath, ['-e', `
    const { run, q1 } = await import(${JSON.stringify(new URL('../server/db.js', import.meta.url).href)});
    run("INSERT INTO known_devices(token, phone) VALUES('t', '+77010000000')");
    run("INSERT INTO companies(name, form) VALUES('Лишняя компания', 'ТОО')");
    console.log(q1('SELECT COUNT(*) AS n FROM users').n);
  `, '--input-type=module'], { env: e, encoding: 'utf8', timeout: 60_000 });
  assert.equal(mark.status, 0, mark.stderr);
  const users = Number(mark.stdout.trim());
  const reset = spawnSync(process.execPath, [seedJs, '--reset'], { env: e, encoding: 'utf8', timeout: 60_000 });
  assert.equal(reset.status, 0, reset.stderr);
  const check = spawnSync(process.execPath, ['-e', `
    const { q1 } = await import(${JSON.stringify(new URL('../server/db.js', import.meta.url).href)});
    console.log(JSON.stringify([q1('SELECT COUNT(*) AS n FROM users').n, q1('SELECT COUNT(*) AS n FROM known_devices').n, q1("SELECT COUNT(*) AS n FROM companies WHERE name = 'Лишняя компания'").n]));
  `, '--input-type=module'], { env: e, encoding: 'utf8', timeout: 60_000 });
  assert.deepEqual(JSON.parse(check.stdout.trim()), [users, 0, 0]);
});

test('база демо-стенда боевой не становится: без демо сервер на ней не запускается, пока её не убрали', () => {
  const e = env({});
  // база после показа: отметка «демо» стоит, демо выключено
  const mark = spawnSync(process.execPath, ['-e', `
    const { run } = await import(${JSON.stringify(new URL('../server/db.js', import.meta.url).href)});
    run("INSERT INTO app_state(key, value) VALUES('demo', '1')");
  `, '--input-type=module'], { env: e, encoding: 'utf8', timeout: 60_000 });
  assert.equal(mark.status, 0, mark.stderr);
  const r = spawnSync(process.execPath, [entry], { env: e, encoding: 'utf8', timeout: 20_000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /база создана в демо-режиме/);
  assert.match(r.stderr, /DEMO_DATA_KEEP=1/);
});

test('демо на боевом сервере без подтверждения не запускается', () => {
  const r = spawnSync(process.execPath, [entry], { env: env({ DEMO_MODE: '1' }), encoding: 'utf8', timeout: 20_000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /DEMO_CONFIRM=1/);
});

test('демо-стенд с подтверждением запускается', async () => {
  const child = spawn(process.execPath, [entry], { env: env({ DEMO_MODE: '1', DEMO_CONFIRM: '1' }) });
  try {
    const out = await new Promise((resolve, reject) => {
      let text = '';
      const timer = setTimeout(() => reject(new Error('сервер не запустился: ' + text)), 30_000);
      child.stdout.on('data', (d) => {
        text += d;
        if (text.includes('демо-режим')) { clearTimeout(timer); resolve(text); }
      });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`сервер завершился с кодом ${code}: ${text}`)); });
    });
    assert.match(out, /Ovi: http:\/\/localhost:\d+ \(демо-режим\)/);
  } finally {
    child.removeAllListeners('exit');
    child.kill();
  }
});

// ---------- пределы SMS: здесь сервер работает без демо, коды уходят «провайдеру» — маленькому серверу теста ----------
const sms = [];
let smsFails = false;
let provider;
/** Клиент со всеми cookie, как браузер или приложение. */
function device() {
  const jar = new Map();
  const c = { jar };
  c.call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const name = pair.slice(0, pair.indexOf('='));
      if (/Max-Age=0/.test(line)) jar.delete(name);
      else jar.set(name, pair.slice(name.length + 1));
    }
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return c;
}
const lastCode = (phone) => sms.findLast((m) => m.phone === phone).text.match(/\d{6}/)[0];
/** Сколько кодов уже отправлено: строки, как их оставляет запрос кода. */
const sentBefore = (n, phone, ip) => tx(() => {
  for (let i = 0; i < n; i++) run(`INSERT INTO login_codes(ticket, phone, code, expires, ip) VALUES(?, ?, '000000', 0, ?)`, `seed-${phone}-${ip}-${i}`, phone, ip);
});
const TOO_MANY = 'Слишком много запросов кода за сутки. Попробуйте завтра';

test('сутки: не больше десяти кодов на номер с чужих устройств, у «своего» устройства свой счёт', async () => {
  provider = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      if (smsFails) return res.writeHead(500).end();
      sms.push(JSON.parse(body));
      res.writeHead(200).end('{}');
    });
  }).listen(0);
  await new Promise((r) => provider.once('listening', r));
  process.env.SMS_WEBHOOK_URL = `http://127.0.0.1:${provider.address().port}`;

  // владелец номера входит со своего телефона — телефон запомнен как «свой»
  const phone = '+77059990010';
  const owner = device();
  assert.equal((await owner.call('POST', '/api/auth/request-code', { phone })).data.devCode, undefined, 'вне демо код на экран не попадает');
  const v = await owner.call('POST', '/api/auth/verify', { phone, code: lastCode(phone) });
  const reg = await owner.call('POST', '/api/auth/register', { regToken: v.data.regToken, name: 'Данияр', companyName: 'Данияр Логистик', companyForm: 'ТОО', role: 'customer', accept: true });
  assert.equal(reg.status, 200);
  assert.equal((await owner.call('POST', '/api/auth/logout', {})).status, 200);
  assert.ok(owner.jar.has('kd') && !owner.jar.has('sid'), 'после обычного выхода телефон остаётся «своим»');

  // недоброжелатель засыпал номер запросами: десять кодов за сутки с чужих устройств
  sentBefore(9, phone, '203.0.113.7'); // плюс один — сам владелец при первом входе
  const before = sms.length;
  const stranger = await device().call('POST', '/api/auth/request-code', { phone });
  assert.equal(stranger.status, 429);
  assert.equal(stranger.data.message, TOO_MANY);
  assert.equal(sms.length, before, 'одиннадцатое SMS не отправлено');

  // владелец со своего телефона входит как обычно
  assert.equal((await owner.call('POST', '/api/auth/request-code', { phone })).status, 200);
  assert.equal((await owner.call('POST', '/api/auth/verify', { phone, code: lastCode(phone) })).data.registered, true);

  // через сутки счёт обнуляется
  run(`UPDATE login_codes SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-25 hours') WHERE phone = ?`, phone);
  assert.equal((await device().call('POST', '/api/auth/request-code', { phone })).status, 200);
});

test('сутки: предел кодов с одного адреса и на всю площадку; неотправленное SMS не считается', async () => {
  const ip = q1('SELECT ip FROM login_codes WHERE ip LIKE ? LIMIT 1', '%127.0.0.1%').ip;
  const count = () => q1('SELECT COUNT(*) AS n FROM login_codes').n;

  // провайдер SMS недоступен: человек видит ошибку, а в пределы попытка не засчитана
  smsFails = true;
  const rows = count();
  assert.equal((await device().call('POST', '/api/auth/request-code', { phone: '+77059990011' })).status, 502);
  assert.equal(count(), rows);
  smsFails = false;

  // рассылка кодов по чужим номерам с одного адреса
  sentBefore(300, '+77050000000', ip);
  const flood = await device().call('POST', '/api/auth/request-code', { phone: '+77059990012' });
  assert.equal(flood.status, 429);
  assert.equal(flood.data.message, TOO_MANY);
  run(`DELETE FROM login_codes WHERE ticket LIKE 'seed-+77050000000-%'`);
  assert.equal((await device().call('POST', '/api/auth/request-code', { phone: '+77059990012' })).status, 200);

  // SMS уходят только на номера стран из списка на экране входа: рассылка кодов по всему миру не пройдёт
  const abroad = await device().call('POST', '/api/auth/request-code', { phone: '+447911123456' });
  assert.equal(abroad.status, 400);
  assert.equal(abroad.data.error, 'sms_country');
  assert.equal(count(), rows + 1, 'запрос на номер чужой страны в пределы не засчитан');
  assert.equal((await device().call('POST', '/api/auth/request-code', { phone: '+998901234567' })).status, 200);
  assert.equal(smsAllowed('+77011234567', ['7']), true);
  assert.equal(smsAllowed('+998901234567', ['7']), false);
  assert.equal(smsAllowed('+447911123456', null), true, '`*` в SMS_COUNTRIES — любые страны');

  // рассылка с тысяч адресов: общий предел площадки (в тесте — 400 кодов в сутки)
  sentBefore(400, '+77050000001', '198.51.100.1');
  const before = sms.length;
  const all = await device().call('POST', '/api/auth/request-code', { phone: '+77059990013' });
  assert.equal(all.status, 503);
  assert.equal(all.data.error, 'sms_limit');
  assert.equal(sms.length, before);
  // модераторы узнают об исчерпанном пределе — один раз, а не на каждый отказ
  const alerts = () => q1(`SELECT COUNT(*) AS n FROM notifications WHERE title = 'Суточный предел SMS исчерпан'`).n;
  const admins = q1('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').n;
  assert.ok(admins > 0);
  assert.equal(alerts(), admins);
  assert.equal((await device().call('POST', '/api/auth/request-code', { phone: '+77059990014' })).status, 503);
  assert.equal(alerts(), admins);
  provider.close();
});
