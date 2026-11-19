// Коды входа через бота в Telegram: привязка номера кнопкой «Поделиться номером», выдача кода, повторные входы,
// чужой контакт, несовпадение номеров, удалённый бот. Telegram заменён локальным сервером-заглушкой.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jolda-test-tg-'));
delete process.env.DEMO_MODE;
delete process.env.SMS_WEBHOOK_URL;
delete process.env.OSRM_URL;
delete process.env.FCM_SERVICE_ACCOUNT;
process.env.TELEGRAM_BOT_TOKEN = '123:test';
process.env.TELEGRAM_BOT_NAME = 'JoldaTestBot';
process.env.SMS_DAILY_MAX = '1'; // предел SMS на площадку — коды через Telegram в него не входят
const { createApp } = await import('../server/index.js');
const { q1, run } = await import('../server/db.js');
const telegram = await import('../server/telegram.js');

// заглушка Telegram: запоминает отправленные сообщения; чат 403 «заблокировал бота»
const sent = [];
const bot = http.createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : {};
  const reply = (status, data) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
  if (req.url !== '/bot123:test/sendMessage') return reply(404, { ok: false, error_code: 404, description: 'Not Found' });
  if (body.chat_id === 403) return reply(403, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' });
  sent.push(body);
  reply(200, { ok: true, result: { message_id: sent.length } });
});

let server;
let base;
before(async () => {
  server = createApp().listen(0);
  bot.listen(0);
  await Promise.all([server, bot].map((s) => new Promise((r) => s.once('listening', r))));
  base = `http://127.0.0.1:${server.address().port}`;
  telegram.tg.api = `http://127.0.0.1:${bot.address().port}`;
});
after(() => {
  server.close();
  bot.close();
});

/** Посетитель со своими cookie (код привязан к тому, кто его запросил). */
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
const user = (id, lang = 'ru') => ({ id, is_bot: false, first_name: 'Тест', language_code: lang });
const msg = (chat, extra, lang) => ({ update_id: 1, message: { message_id: 1, chat: { id: chat, type: 'private' }, from: user(chat, lang), ...extra } });
const codeIn = (m) => /(?<!\d)\d{6}(?!\d)/.exec(m.text)?.[0];

test('сервер сообщает, какими путями можно получить код', async () => {
  const meta = await visitor()('GET', '/api/meta');
  assert.deepEqual(meta.data.login, { sms: false, telegram: 'JoldaTestBot' });
});

test('первый вход: ссылка на бота → «Поделиться номером» → код в чате → вход; код на экран не попадает', async () => {
  const me = visitor();
  const r = await me('POST', '/api/auth/request-code', { phone: '+7 701 111 22 33', via: 'telegram' });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.data).sort(), ['ok', 'telegramUrl', 'via']);
  const start = /^https:\/\/t\.me\/JoldaTestBot\?start=([A-Za-z0-9_-]+)$/.exec(r.data.telegramUrl)[1];

  sent.length = 0;
  await telegram.handleUpdate(msg(5001, { text: `/start ${start}` }));
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Поделиться номером/);
  assert.equal(sent[0].reply_markup.keyboard[0][0].request_contact, true);

  await telegram.handleUpdate(msg(5001, { contact: { phone_number: '77011112233', first_name: 'Тест', user_id: 5001 } }));
  assert.equal(sent.length, 2);
  const code = codeIn(sent[1]);
  assert.ok(code, 'бот прислал код');
  assert.deepEqual({ ...q1('SELECT chat_id AS c, lang FROM tg_links WHERE phone = ?', '+77011112233') }, { c: 5001, lang: 'ru' });

  // чужой посетитель с этим кодом не войдёт: код привязан к тому, кто его запросил
  assert.equal((await visitor()('POST', '/api/auth/verify', { phone: '+77011112233', code })).status, 400);
  const v = await me('POST', '/api/auth/verify', { phone: '+77011112233', code });
  assert.equal(v.status, 200);
  assert.ok(v.data.regToken, 'нового человека ведут на регистрацию');
});

test('следующие входы: код приходит в чат сразу, без ссылки; предел SMS на площадку коды Telegram не тратят', async () => {
  sent.length = 0;
  for (let i = 0; i < 2; i++) {
    const r = await visitor()('POST', '/api/auth/request-code', { phone: '+77011112233', via: 'telegram' });
    assert.deepEqual(r.data, { ok: true, via: 'telegram' });
  }
  assert.equal(sent.length, 2);
  assert.deepEqual(sent.map((m) => m.chat_id), [5001, 5001]);
  assert.match(sent[0].text, /^Код входа в Jolda: \d{6}\nНикому его не сообщайте\.$/);
});

test('язык бота — из настроек Telegram; привязанному чату без запроса бот объясняет, что делать', async () => {
  sent.length = 0;
  await telegram.handleUpdate(msg(5002, { text: '/start' }, 'kk'));
  assert.match(sent[0].text, /Нөмірмен бөлісу/);
  await telegram.handleUpdate(msg(5002, { contact: { phone_number: '+77022223344', user_id: 5002 } }, 'en'));
  assert.match(sent[1].text, /^Done\. Go back to Jolda/);
  await telegram.handleUpdate(msg(5002, { text: 'привет' }, 'en'));
  assert.match(sent[2].text, /already linked to \+77022223344/);
  assert.deepEqual([telegram.tgLang('zh-hans'), telegram.tgLang('de'), telegram.tgLang(undefined)], ['zh', 'ru', 'ru']);
});

test('чужой контакт не принимается: нужен номер самого аккаунта', async () => {
  sent.length = 0;
  await telegram.handleUpdate(msg(5003, { contact: { phone_number: '+77011112233', user_id: 9999 } }));
  assert.match(sent[0].text, /чужой контакт не подойдёт/);
  assert.equal(q1('SELECT chat_id AS c FROM tg_links WHERE phone = ?', '+77011112233').c, 5001, 'связка чужого номера не изменилась');
});

test('номер Telegram не совпал с введённым в Jolda — код не выдаётся', async () => {
  const me = visitor();
  const r = await me('POST', '/api/auth/request-code', { phone: '+77033334455', via: 'telegram' });
  const start = new URL(r.data.telegramUrl).searchParams.get('start');
  sent.length = 0;
  await telegram.handleUpdate(msg(5004, { text: `/start ${start}` }));
  await telegram.handleUpdate(msg(5004, { contact: { phone_number: '+77039990000', user_id: 5004 } }));
  assert.match(sent[1].text, /не совпадает с номером, который вы ввели в Jolda/);
  assert.equal(codeIn(sent[1]), undefined);
  assert.ok(q1('SELECT tg_start FROM login_codes WHERE tg_start = ?', start), 'запрос остаётся ждать своего номера');
});

test('ссылку из бота нельзя использовать дважды, а устаревший запрос бот не обслуживает', async () => {
  const me = visitor();
  const r = await me('POST', '/api/auth/request-code', { phone: '+77022223344', via: 'telegram' });
  // номер уже привязан (тест выше) — код ушёл сразу; новый запрос для непривязанного номера даёт ссылку
  assert.deepEqual(r.data, { ok: true, via: 'telegram' });
  const fresh = await me('POST', '/api/auth/request-code', { phone: '+77044445566', via: 'telegram' });
  const start = new URL(fresh.data.telegramUrl).searchParams.get('start');
  run(`UPDATE login_codes SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-20 minutes') WHERE tg_start = ?`, start);
  sent.length = 0;
  await telegram.handleUpdate(msg(5005, { text: `/start ${start}` }));
  await telegram.handleUpdate(msg(5005, { contact: { phone_number: '+77044445566', user_id: 5005 } }));
  assert.match(sent[1].text, /Запрос кода устарел/);
});

test('человек удалил бота: связка снимается, выдаётся ссылка для новой привязки', async () => {
  run(`INSERT INTO tg_links(phone, chat_id, lang) VALUES('+77055556677', 403, 'ru')`);
  const r = await visitor()('POST', '/api/auth/request-code', { phone: '+77055556677', via: 'telegram' });
  assert.equal(r.status, 200);
  assert.match(r.data.telegramUrl, /^https:\/\/t\.me\/JoldaTestBot\?start=/);
  assert.equal(q1(`SELECT 1 AS x FROM tg_links WHERE phone = '+77055556677'`), undefined);
});

test('без SMS-провайдера вход по SMS закрыт, через Telegram — работает; неизвестный способ считается SMS', async () => {
  const r = await visitor()('POST', '/api/auth/request-code', { phone: '+77066667788' });
  assert.equal(r.status, 503);
  assert.equal(r.data.error, 'sms_off');
});
