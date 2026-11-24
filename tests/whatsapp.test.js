// Вход через WhatsApp: подпись Meta, число с экрана для нового устройства, вход без вопросов со своего, чужой номер,
// неверное число, повторная доставка, скрытый номер, месячный запас ответов. Meta заменена локальной заглушкой.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jolda-test-wa-'));
for (const k of ['DEMO_MODE', 'SMS_WEBHOOK_URL', 'TELEGRAM_BOT_TOKEN', 'OSRM_URL', 'FCM_SERVICE_ACCOUNT']) delete process.env[k];
Object.assign(process.env, { WHATSAPP_NUMBER: '+7 700 000 00 01', WHATSAPP_PHONE_ID: '555', WHATSAPP_TOKEN: 'tok', WHATSAPP_APP_SECRET: 'shh', WHATSAPP_VERIFY_TOKEN: 'vt', SMS_DAILY_MAX: '1', REVIEW_LOGIN: '+77010000091:482915,+77010000092:739164' });
const { createApp } = await import('../server/index.js');
const { q1, run } = await import('../server/db.js');
const { wa } = await import('../server/whatsapp.js');

const sent = [];
let failing = false;
const meta = http.createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  const ok = !failing && req.url === '/555/messages' && req.headers.authorization === 'Bearer tok';
  if (ok) sent.push(JSON.parse(raw));
  res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' }).end(JSON.stringify(ok ? { messages: [{ id: 'x' }] } : { error: { code: 190, message: 'expired' } }));
});
let server;
let base;
before(async () => {
  server = createApp().listen(0);
  meta.listen(0);
  await Promise.all([server, meta].map((s) => new Promise((r) => s.once('listening', r))));
  base = `http://127.0.0.1:${server.address().port}`;
  wa.api = `http://127.0.0.1:${meta.address().port}`;
});
after(() => {
  server.close();
  meta.close();
});

function visitor() {
  const jar = new Map();
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      jar.set(pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1));
    }
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}
const ask = (me, phone, lang) => me('POST', '/api/auth/request-code', { phone, via: 'whatsapp', lang });
const poll = (me, phone) => me('POST', '/api/auth/whatsapp', { phone });
const hello = (r) => new URL(r.data.whatsappUrl).searchParams.get('text');
/** Сообщение от Meta с подписью; сервер отвечает сразу, поэтому даём ему мгновение на обработку. */
async function incoming(message, { secret = 'shh', phoneId = '555' } = {}) {
  const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: 'messages', value: { metadata: { phone_number_id: phoneId }, messages: [{ id: 'wamid', type: 'text', ...message }] } }] }] });
  const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const res = await fetch(base + '/api/whatsapp/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, body: raw });
  await new Promise((r) => setTimeout(r, 60));
  return res.status;
}
const say = (from, body, opt) => incoming({ from, text: { body } }, opt);

test('сервер сообщает, что вход через WhatsApp подключён; Meta подтверждает адрес по своему слову', async () => {
  assert.deepEqual((await visitor()('GET', '/api/meta')).data.login, { sms: false, telegram: '', whatsapp: true });
  const url = (t) => `${base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${t}&hub.challenge=1158201444`;
  const ok = await fetch(url('vt'));
  assert.deepEqual([ok.status, await ok.text()], [200, '1158201444']);
  assert.match(ok.headers.get('content-type'), /text\/plain/);
  assert.equal((await fetch(url('no'))).status, 403);
});

test('новое устройство: сообщение → число с экрана → вход; сервер ничего не присылает, кроме вопроса', async () => {
  const me = visitor();
  const r = await ask(me, '+7 701 111 22 33');
  assert.deepEqual(Object.keys(r.data).sort(), ['ok', 'pick', 'via', 'whatsappUrl']);
  assert.match(r.data.whatsappUrl, /^https:\/\/wa\.me\/77000000001\?text=/);
  assert.match(r.data.pick, /^\d{2}$/);
  assert.deepEqual((await poll(me, '+77011112233')).data, { wait: true, sent: false });
  sent.length = 0;
  assert.equal(await say('77011112233', hello(r)), 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, '+77011112233');
  assert.match(sent[0].text.body, /двузначное число с экрана Ovi/);
  assert.ok(!sent[0].text.body.includes(r.data.pick), 'само число в чат не уходит');
  // Meta доставила то же самое ещё раз — второго вопроса нет
  await say('77011112233', hello(r));
  assert.equal(sent.length, 1);
  assert.deepEqual((await poll(me, '+77011112233')).data, { wait: true, sent: true });
  await say('77011112233', ` ${r.data.pick} `);
  assert.equal(sent.length, 1);
  // чужой посетитель и обычная проверка кода этим входом не воспользуются
  assert.equal((await poll(visitor(), '+77011112233')).data.error, 'wa_expired');
  assert.equal((await me('POST', '/api/auth/verify', { phone: '+77011112233', code: '000000' })).data.error, 'code_expired');
  const v = await poll(me, '+77011112233');
  assert.ok(v.data.regToken);
  const reg = await me('POST', '/api/auth/register', { regToken: v.data.regToken, name: 'Иван Тестов', companyName: 'Тест', companyForm: 'ИП', role: 'customer', accept: true });
  assert.equal(reg.status, 200);
  assert.equal((await poll(me, '+77011112233')).data.error, 'wa_expired', 'подтверждение одноразовое');

  // с этого же устройства в следующий раз числа не спрашиваем и ответов не тратим
  await me('POST', '/api/auth/logout', {});
  const again = await ask(me, '+77011112233');
  assert.equal(again.data.pick, '');
  sent.length = 0;
  await say('77011112233', hello(again));
  assert.equal(sent.length, 0);
  assert.equal((await poll(me, '+77011112233')).data.registered, true);
});

test('чужая ссылка: жертва отправила готовое сообщение, но без числа мошенник не войдёт', async () => {
  const thief = visitor();
  const r = await ask(thief, '+77011112233');
  assert.match(r.data.pick, /^\d{2}$/);
  await say('77011112233', hello(r));
  assert.equal((await poll(thief, '+77011112233')).data.wait, true);
  sent.length = 0;
  const wrong = r.data.pick === '55' ? '56' : '55';
  await say('77011112233', wrong);
  assert.match(sent[0].text.body, /вход отменён/);
  assert.equal((await poll(thief, '+77011112233')).data.error, 'wa_denied');
  await say('77011112233', r.data.pick); // вторая попытка уже ничего не открывает
  assert.equal((await poll(thief, '+77011112233')).data.error, 'wa_denied');
});

test('сообщение с другого номера вход не открывает; местная запись чужой страны за наш номер не сойдёт', async () => {
  const me = visitor();
  const r = await ask(me, '+77022223344');
  sent.length = 0;
  await say('77029998877', hello(r));
  assert.match(sent[0].text.body, /другой номер/);
  await say('7022223344', hello(r)); // десять цифр — не +7 702…
  await say('87022223344', hello(r));
  assert.equal((await poll(me, '+77022223344')).data.sent, false);
});

test('без подписи Meta, с чужой подписью, для чужого номера и с выдуманной меткой сообщения не действуют', async () => {
  const me = visitor();
  const r = await ask(me, '+77033334455');
  sent.length = 0;
  assert.equal(await say('77033334455', hello(r), { secret: 'other' }), 403);
  assert.equal((await fetch(base + '/api/whatsapp/webhook', { method: 'POST', body: '{}' })).status, 403);
  assert.equal(await say('77033334455', hello(r), { phoneId: '999' }), 200);
  await say('77033334455', 'Войти в Ovi: #ABCDEFGHJK');
  await say('77033334455', 'привет');
  await say('77033334455', '42');
  assert.equal(sent.length, 0, 'на постороннее бот не отвечает');
  assert.equal((await poll(me, '+77033334455')).data.sent, false);
});

test('устаревший запрос, скрытый номер и язык', async () => {
  const me = visitor();
  const r = await ask(me, '+77044445566', 'en');
  assert.match(hello(r), /^Sign in to Ovi/);
  run(`UPDATE login_codes SET expires = ? WHERE phone = '+77044445566'`, Date.now() - 1);
  sent.length = 0;
  await say('77044445566', hello(r));
  assert.match(sent[0].text.body, /has expired/);
  assert.equal((await poll(me, '+77044445566')).data.error, 'wa_expired');
  const h = await ask(me, '+77044445567', 'kz');
  sent.length = 0;
  await incoming({ from_user_id: 'KZ.123', text: { body: hello(h) } });
  assert.equal(sent[0].recipient, 'KZ.123');
  assert.match(sent[0].text.body, /жасырылған/);
  assert.equal((await poll(me, '+77044445567')).data.error, 'wa_failed');
});

test('Meta не приняла ответ — человеку предлагают другой способ, запас не тратится', async () => {
  const me = visitor();
  const r = await ask(me, '+77055556677');
  const used = () => Number(q1(`SELECT value FROM app_state WHERE key LIKE 'wa:%'`)?.value || 0);
  const before = used();
  failing = true;
  await say('77055556677', hello(r));
  failing = false;
  assert.equal((await poll(me, '+77055556677')).data.error, 'wa_failed');
  assert.equal(used(), before);
});

test('месячный запас ответов кончился — кнопка исчезает, запросы отклоняются', async () => {
  const max = wa.monthMax;
  wa.monthMax = 1;
  assert.equal((await visitor()('GET', '/api/meta')).data.login.whatsapp, false);
  assert.equal((await ask(visitor(), '+77066667788')).data.error, 'whatsapp_off');
  wa.monthMax = max;
});

test('проверяющий из App Store входит своим постоянным кодом и через эту кнопку; предел SMS вход не тратит', async () => {
  const me = visitor();
  const r = await ask(me, '+77010000091');
  assert.deepEqual(r.data, { ok: true });
  assert.equal((await me('POST', '/api/auth/verify', { phone: '+77010000091', code: '482915' })).status, 200);
  for (const p of ['+77077770001', '+77077770002', '+77077770003']) assert.equal((await ask(visitor(), p)).status, 200);
});
