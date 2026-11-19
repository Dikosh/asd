// Push в мобильное приложение через Firebase (FCM HTTP v1): подпись JWT, токен доступа, содержимое сообщения,
// удаление недействительных устройств. Google заменён локальным сервером-заглушкой — в сеть тесты не ходят.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jolda-test-fcm-'));
process.env.DEMO_MODE = '1';
delete process.env.OSRM_URL;
// одноразовый ключ: такой же формат, как у файла сервисного аккаунта Firebase
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const sa = {
  type: 'service_account', project_id: 'jolda-test', private_key_id: 'kid1', client_email: 'push@jolda-test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token',
};
process.env.FCM_SERVICE_ACCOUNT = path.join(process.env.DATA_DIR, 'service-account.json');
fs.writeFileSync(process.env.FCM_SERVICE_ACCOUNT, JSON.stringify(sa));

const { createApp } = await import('../server/index.js');
const { seed } = await import('../server/seed.js');
const { q, q1, run, insert } = await import('../server/db.js');
const lib = await import('../server/lib.js');
const { notify } = await import('../server/notify.js');
const fcm = await import('../server/fcm.js');

// заглушка Google: выдаёт токен доступа и принимает сообщения; ответ зависит от токена устройства
const calls = { token: [], send: [] };
const google = http.createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  const reply = (status, body) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  if (req.url === '/token') {
    calls.token.push(Object.fromEntries(new URLSearchParams(raw)));
    return reply(200, { access_token: 'ya29.test', expires_in: 3599, token_type: 'Bearer' });
  }
  if (req.url === '/v1/projects/jolda-test/messages:send') {
    const { message } = JSON.parse(raw);
    calls.send.push({ auth: req.headers.authorization, message });
    const t = message.token;
    if (t.startsWith('dead')) return reply(404, { error: { code: 404, status: 'NOT_FOUND', message: 'Requested entity was not found.', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } });
    if (t.startsWith('badtoken'))
      return reply(400, { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'The registration token is not a valid FCM registration token', details: [{ '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field: 'message.token', description: 'Invalid registration token' }] }] } });
    if (t.startsWith('badpayload'))
      return reply(400, { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Invalid value at message.data', details: [{ '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field: 'message.data', description: 'Invalid' }] }] } });
    if (t.startsWith('down')) return reply(503, { error: { code: 503, status: 'UNAVAILABLE', message: 'try later' } });
    return reply(200, { name: `projects/jolda-test/messages/${calls.send.length}` });
  }
  reply(404, {});
});

let server;
let base;
before(async () => {
  seed();
  server = createApp().listen(0);
  google.listen(0);
  await Promise.all([server, google].map((s) => new Promise((r) => s.once('listening', r))));
  base = `http://127.0.0.1:${server.address().port}`;
  const g = `http://127.0.0.1:${google.address().port}`;
  Object.assign(fcm.endpoints, { token: `${g}/token`, api: g });
});
after(() => {
  server.close();
  google.close();
});

async function demo(role) {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = await res.json().catch(() => null);
    assert.ok(res.status < 300, `${method} ${url} → ${res.status} ${JSON.stringify(data)}`);
    return data;
  };
  const me = await call('POST', '/api/auth/demo', { role });
  return { me, post: (u, b = {}) => call('POST', u, b), get: (u) => call('GET', u) };
}
const until = async (cond, ms = 3000) => {
  for (const t0 = Date.now(); !cond(); ) {
    if (Date.now() - t0 > ms) throw new Error('не дождались');
    await new Promise((r) => setTimeout(r, 20));
  }
};

test('JWT сервисного аккаунта: RS256, нужные поля, подпись проверяется открытым ключом', () => {
  const jwt = fcm.fcmJwt(sa, 1_800_000_000);
  const [h, c, s] = jwt.split('.');
  const dec = (x) => JSON.parse(Buffer.from(x, 'base64url').toString());
  assert.deepEqual(dec(h), { alg: 'RS256', typ: 'JWT', kid: 'kid1' });
  assert.deepEqual(dec(c), {
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: 1_800_000_000, exp: 1_800_003_600,
  });
  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${c}`), publicKey, Buffer.from(s, 'base64url')));
});

test('какие ошибки FCM означают, что токен устройства умер', () => {
  assert.equal(fcm.deadToken(404, {}), true);
  assert.equal(fcm.deadToken(400, { status: 'INVALID_ARGUMENT', details: [{ errorCode: 'UNREGISTERED' }] }), true);
  assert.equal(fcm.deadToken(400, { status: 'INVALID_ARGUMENT', message: 'The registration token is not a valid FCM registration token' }), true);
  assert.equal(fcm.deadToken(400, { status: 'INVALID_ARGUMENT', message: 'Invalid value', details: [{ fieldViolations: [{ field: 'message.android.ttl' }] }] }), false);
  assert.equal(fcm.deadToken(503, { status: 'UNAVAILABLE' }), false);
  assert.equal(fcm.deadToken(401, { status: 'UNAUTHENTICATED' }), false);
});

test('уведомление уходит на устройства; токен доступа берётся один раз; умершие устройства удаляются', async () => {
  const carrier = await demo('carrier');
  const userId = carrier.me.user.id;
  for (const token of ['ok-1', 'dead-1', 'badtoken-1', 'badpayload-1', 'down-1']) await carrier.post('/api/push/device', { token, platform: token === 'ok-1' ? 'ios' : 'android' });

  notify(userId, { kind: 'system', title: 'Уведомления включены', body: 'Так будут приходить новые отклики и подходящие грузы.', link: '/notifications' });
  await until(() => calls.send.length === 5);
  const notifId = q('SELECT id FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1', userId)[0].id;

  assert.equal(calls.token.length, 1, 'одновременные отправки ждут один обмен JWT на токен');
  assert.equal(calls.token[0].grant_type, 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  assert.equal(calls.token[0].assertion.split('.').length, 3);
  const ok = calls.send.find((c) => c.message.token === 'ok-1');
  assert.equal(ok.auth, 'Bearer ya29.test');
  assert.deepEqual(ok.message, {
    token: 'ok-1',
    notification: { title: 'Уведомления включены', body: 'Так будут приходить новые отклики и подходящие грузы.' },
    data: { link: '/notifications', kind: 'system', id: String(notifId) },
    android: { priority: 'high' },
    apns: { payload: { aps: { sound: 'default' } } },
  });

  await until(() => q('SELECT COUNT(*) AS n FROM push_devices WHERE user_id = ?', userId)[0].n === 3);
  assert.deepEqual(q('SELECT token FROM push_devices WHERE user_id = ? ORDER BY token', userId).map((d) => d.token), ['badpayload-1', 'down-1', 'ok-1'], 'удаляются только UNREGISTERED и неверный токен');

  // текст — на языке пользователя, как и в Web Push; токен доступа берётся из кэша
  const kzUser = await demo('customer');
  await kzUser.post('/api/push/device', { token: 'ok-kz', platform: 'android' });
  run(`UPDATE users SET settings = json_set(settings, '$.lang', 'kz') WHERE id = ?`, kzUser.me.user.id);
  const sent = calls.send.length;
  notify(kzUser.me.user.id, { kind: 'response', title: 'Новый отклик: {route}', vars: { route: ['astana', 'almaty'] }, link: '/cabinet' });
  await until(() => calls.send.length === sent + 1);
  const kz = calls.send.at(-1).message;
  assert.deepEqual([kz.token, kz.notification.title, kz.notification.body, kz.data.kind, kz.data.link], ['ok-kz', 'Жаңа өтінім: Астана → Алматы', '', 'response', '/cabinet']);
  assert.equal(calls.token.length, 1, 'токен доступа живёт до 5 минут до истечения');

  const before = calls.send.length;
  const t = await carrier.post('/api/push/test');
  assert.deepEqual([t.devices, t.fcm], [3, true]);
  await until(() => calls.send.length === before + 3);
});

test('сообщение в чате: push собеседнику без записи в уведомления, пачка сообщений — один push, после прочтения — снова', async () => {
  const sender = await demo('logist');
  const peer = await demo('broker');
  const listing = q1('SELECT id FROM listings ORDER BY id LIMIT 1').id;
  const chatId = insert('INSERT INTO chats(listing_id, owner_id, peer_id, owner_company, peer_company) VALUES(?, ?, ?, ?, ?)',
    listing, sender.me.user.id, peer.me.user.id, sender.me.company.id, peer.me.company.id);
  await sender.post('/api/push/device', { token: 'ok-chat-sender', platform: 'android' });
  await peer.post('/api/push/device', { token: 'ok-chat-peer', platform: 'ios' });
  const toPeer = () => calls.send.filter((c) => c.message.token === 'ok-chat-peer');
  const notifs = () => q1('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?', peer.me.user.id).n;
  const before = notifs();

  await sender.post(`/api/chats/${chatId}/messages`, { text: 'Когда подадите машину?' });
  await until(() => toPeer().length === 1);
  assert.deepEqual(toPeer()[0].message.notification, { title: `Новое сообщение: ${sender.me.company.name}`, body: 'Когда подадите машину?' });
  assert.deepEqual(toPeer()[0].message.data, { link: `/cabinet/messages/${chatId}`, kind: 'message', id: '' });
  assert.equal(notifs(), before, 'в список уведомлений сообщения чата не пишутся');

  // ещё два сообщения подряд — нового push нет
  await sender.post(`/api/chats/${chatId}/messages`, { text: 'Алло?' });
  await sender.post(`/api/chats/${chatId}/messages`, { text: 'Жду ответа' });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(toPeer().length, 1);

  // собеседник открыл переписку — о следующем сообщении узнаёт сразу
  await peer.get(`/api/chats/${chatId}/messages`);
  await sender.post(`/api/chats/${chatId}/messages`, { text: 'Спасибо, договорились' });
  await until(() => toPeer().length === 2);
  assert.equal(calls.send.filter((c) => c.message.token === 'ok-chat-sender').length, 0, 'отправителю и его коллегам push о своём сообщении не идёт');

  // ответ идёт уже в обратную сторону
  await peer.post(`/api/chats/${chatId}/messages`, { text: 'Хорошо' });
  await until(() => calls.send.filter((c) => c.message.token === 'ok-chat-sender').length === 1);
});

test('в какие входы сайт открыт: по живым потокам событий', () => {
  const stream = { write() {}, end() {}, on() {} };
  lib.subscribe(987654, stream, 'sid-open');
  assert.deepEqual([...lib.openSessions(987654)], ['sid-open']);
  assert.deepEqual([...lib.openSessions(987655)], []);
});

test('заявка на проверку компании: модераторы узнают сразу, повторная отправка не шумит', async () => {
  const owner = await demo('broker');
  run(`UPDATE companies SET verified = 'none' WHERE id = ?`, owner.me.company.id);
  await owner.post('/api/documents', { kind: 'registration', filename: 'справка.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4 test').toString('base64') });
  const admins = q('SELECT id FROM users WHERE is_admin = 1').length;
  const count = () => q1(`SELECT COUNT(*) AS n FROM notifications WHERE title = 'Новая заявка на проверку компании' AND body = ?`, owner.me.company.name).n;
  assert.ok(admins > 0);
  await owner.post('/api/company/verify-request');
  assert.equal(count(), admins);
  assert.equal(q1(`SELECT link FROM notifications WHERE title = 'Новая заявка на проверку компании' LIMIT 1`).link, '/cabinet/admin');
  await owner.post('/api/company/verify-request');
  assert.equal(count(), admins, 'та же заявка второй раз модераторов не будит');
});
