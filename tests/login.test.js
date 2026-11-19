// Вход по коду и выход: код действует только у того, кто его запросил, ошибки считаются на сам код,
// а вместе с входом закрываются уведомления и потоки событий на этом устройстве.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jolda-test-login-'));
process.env.DEMO_MODE = '1';
delete process.env.OSRM_URL;
delete process.env.FCM_SERVICE_ACCOUNT;
const { createApp, housekeeping } = await import('../server/index.js');
const { seed } = await import('../server/seed.js');
const { q, q1, run } = await import('../server/db.js');

let server;
let base;
before(async () => {
  seed();
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

/** Клиент, который хранит все cookie, как браузер или приложение. */
function client() {
  const jar = new Map();
  const c = { jar };
  c.cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  c.call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: c.cookie() }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const [name, value] = [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)];
      if (/Max-Age=0/.test(line)) jar.delete(name);
      else jar.set(name, value);
    }
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  const ok = async (method, url, body) => {
    const r = await c.call(method, url, body);
    assert.ok(r.status < 300, `${method} ${url} → ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  };
  return Object.assign(c, { get: (u) => ok('GET', u), post: (u, b = {}) => ok('POST', u, b) });
}
const wrong = (code) => (code === '000000' ? '111111' : '000000');
const REG = { name: 'Асель', companyName: 'Асель Транс', companyForm: 'ТОО', role: 'carrier', accept: true };
async function signIn(phone, c = client()) {
  const { devCode } = await c.post('/api/auth/request-code', { phone });
  const v = await c.post('/api/auth/verify', { phone, code: devCode });
  c.me = v.registered ? v : await c.post('/api/auth/register', { regToken: v.regToken, ...REG });
  return c;
}
/** Поток событий клиента: что пришло и закрыл ли его сервер. */
async function listen(c) {
  const ctl = new AbortController();
  const res = await fetch(base + '/api/events', { headers: { Cookie: c.cookie() }, signal: ctl.signal });
  const got = { text: '', ended: false, stop: () => ctl.abort() };
  (async () => {
    for await (const chunk of res.body) got.text += Buffer.from(chunk).toString();
    got.ended = true;
  })().catch(() => {});
  return got;
}
const pause = () => new Promise((r) => setTimeout(r, 150));
const devices = (userId) => q('SELECT token FROM push_devices WHERE user_id = ? ORDER BY token', userId).map((d) => d.token);

test('код действует только у того, кто его запросил, а ошибки считаются на сам код', async () => {
  const phone = '+77071110001';
  const owner = client();
  const { devCode } = await owner.post('/api/auth/request-code', { phone });

  // посторонний знает номер, но код не запрашивал: подобрать чужой код ему нечем
  const stranger = client();
  const blind = await stranger.call('POST', '/api/auth/verify', { phone, code: devCode });
  assert.equal(blind.data.error, 'code_expired', 'без своего запроса кода не принимается даже верный код');

  // посторонний запрашивает код на тот же номер и пять раз ошибается: «сгорает» только его код
  const mine = (await stranger.post('/api/auth/request-code', { phone })).devCode;
  for (let i = 0; i < 5; i++) assert.equal((await stranger.call('POST', '/api/auth/verify', { phone, code: wrong(mine) })).data.error, 'code_wrong');
  const burned = await stranger.call('POST', '/api/auth/verify', { phone, code: mine });
  assert.equal(burned.status, 429, 'после пяти ошибок этот код не принимается, даже верный');
  assert.equal(burned.data.message, 'Слишком много неверных кодов. Запросите новый код');

  // код владельца при этом жив: чужой запрос его не отменил, чужие ошибки вход не закрыли
  const v = await owner.post('/api/auth/verify', { phone, code: devCode });
  assert.equal(v.registered, false);
  const me = await owner.post('/api/auth/register', { regToken: v.regToken, ...REG });
  assert.equal(me.user.phone, phone);
  assert.equal(owner.jar.has('otp'), false, 'после входа отметка кода с устройства убрана');
  assert.ok(owner.jar.has('kd'), 'устройство запомнено как «своё»');

  // использованный код второй раз не действует
  const ticket = q1('SELECT ticket FROM login_codes WHERE phone = ? ORDER BY created_at LIMIT 1', phone).ticket;
  const replay = await fetch(base + '/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `otp=${ticket}` }, body: JSON.stringify({ phone, code: devCode }) });
  assert.equal(replay.status, 400);

  // ошибся пять раз сам — достаточно запросить новый код, ждать час не нужно
  const again = (await stranger.post('/api/auth/request-code', { phone })).devCode;
  assert.equal((await stranger.post('/api/auth/verify', { phone, code: again })).registered, true);
  // код чужого номера к своему запросу не подходит
  const other = client();
  await other.post('/api/auth/request-code', { phone: '+77071110002' });
  assert.equal((await other.call('POST', '/api/auth/verify', { phone, code: again })).data.error, 'code_expired');
});

test('выход закрывает уведомления и поток событий на этом устройстве, «выйти везде» — на всех', async () => {
  const phone = '+77071110003';
  const [a, b] = [await signIn(phone), await signIn(phone)];
  const userId = a.me.user.id;
  await a.post('/api/push/device', { token: 'phone-a', platform: 'android' });
  await b.post('/api/push/device', { token: 'phone-b', platform: 'ios' });
  await b.post('/api/push/subscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/browser-b', keys: { p256dh: 'k', auth: 'a' } });
  let [sa, sb] = [await listen(a), await listen(b)];

  // обычный выход с устройства А: его уведомления и поток закрыты, устройство Б работает как раньше
  await a.post('/api/auth/logout', {});
  await pause();
  assert.deepEqual(devices(userId), ['phone-b']);
  assert.match(sa.text, /event: logout/);
  assert.equal(sa.ended, true, 'поток событий вышедшего устройства закрыт сервером');
  assert.equal(sb.ended, false);
  assert.doesNotMatch(sb.text, /event: logout/);
  assert.equal((await b.get('/api/me')).user.id, userId);

  // телефон А потерян, но вход на нём остался; уведомления, включённые до этого обновления, к входу не привязаны
  await signIn(phone, a);
  await a.post('/api/push/device', { token: 'phone-a', platform: 'android' });
  run(`INSERT INTO push_devices(user_id, token, platform) VALUES(?, 'old-phone', 'android')`, userId);
  sa = await listen(a);
  const c = await signIn(phone);
  assert.deepEqual(devices(userId), ['old-phone', 'phone-a', 'phone-b']);

  // «выйти на всех устройствах» с третьего устройства
  await c.post('/api/auth/logout', { everywhere: true });
  await pause();
  assert.deepEqual(devices(userId), [], 'на потерянный телефон уведомления больше не уходят');
  assert.equal(q1('SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?', userId).n, 0);
  for (const s of [sa, sb]) {
    assert.match(s.text, /event: logout/);
    assert.equal(s.ended, true, 'открытые вкладки и приложения перестают получать события');
  }
  assert.equal(await a.get('/api/me'), null);
  assert.equal(await b.get('/api/me'), null);
  assert.equal((await fetch(base + '/api/events', { headers: { Cookie: a.cookie() } })).status, 401);
  assert.equal(q1('SELECT COUNT(*) AS n FROM known_devices WHERE phone = ?', phone).n, 0, 'ни одно устройство больше не считается «своим»');
});

test('вход истёк сам или сотрудника убрали из команды — уведомления на его устройство прекращаются', async () => {
  const user = await signIn('+77071110004');
  await user.post('/api/push/device', { token: 'expired-phone', platform: 'android' });
  run(`UPDATE sessions SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-31 days'), used_at = NULL WHERE user_id = ?`, user.me.user.id);
  housekeeping();
  assert.deepEqual(devices(user.me.user.id), []);

  // владелец убирает сотрудника из команды
  const owner = await signIn('+77071110005');
  const worker = await signIn('+77071110006');
  await worker.post('/api/push/device', { token: 'worker-phone', platform: 'android' });
  run(`UPDATE users SET company_id = ?, company_role = 'manager' WHERE id = ?`, owner.me.user.companyId ?? owner.me.company.id, worker.me.user.id);
  const stream = await listen(worker);
  assert.equal((await owner.call('DELETE', `/api/team/members/${worker.me.user.id}`)).status, 200);
  await pause();
  assert.deepEqual(devices(worker.me.user.id), []);
  assert.equal(stream.ended, true);
  assert.equal(await worker.get('/api/me'), null);
});
