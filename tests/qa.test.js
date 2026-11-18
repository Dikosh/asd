// Правила, добавленные по отчёту тестировщиков (docs/qa-sweep.md): ошибки, которые легко вернуть обратно.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jolda-test-'));
process.env.DEMO_MODE = '1';
const { createApp } = await import('../server/index.js');

let server;
let base;
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  const ok = async (method, url, body) => {
    const r = await call(method, url, body);
    assert.ok(r.status < 300, `${method} ${url} → ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  };
  return { call, get: (u) => ok('GET', u), post: (u, b = {}) => ok('POST', u, b), put: (u, b) => ok('PUT', u, b) };
}
async function signIn(phone, reg) {
  const c = client();
  const { devCode } = await c.post('/api/auth/request-code', { phone });
  const v = await c.post('/api/auth/verify', { phone, code: devCode });
  const me = v.registered ? v : await c.post('/api/auth/register', { regToken: v.regToken, accept: true, ...reg });
  return Object.assign(c, { me });
}
const day = (n) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);

test('объявления: класс ADR, дубликаты, топ у закрытого, лимит откликов', async () => {
  const customer = await signIn('+77062220001', { name: 'Заказчик', companyName: 'Хим Транзит', companyForm: 'ТОО', role: 'customer' });
  const carrier = await signIn('+77062220002', { name: 'Перевозчик', companyName: 'Адр Логистик', companyForm: 'ТОО', role: 'carrier' });
  const base0 = { kind: 'cargo', points: ['almaty', 'shymkent'], bodyType: 'tank', weight: 20, dateFrom: day(0), dateTo: day(3), rate: 400000 };
  // опасный груз без класса не публикуется
  assert.equal((await customer.call('POST', '/api/listings', { ...base0, cargoType: 'adr' })).status, 400);
  const adr = await customer.post('/api/listings', { ...base0, cargoType: 'adr', adrClass: 3 });
  // тот же маршрут и даты, но груз не опасный — это другое объявление, а не дубликат
  await customer.post('/api/listings', { ...base0, cargoType: 'food' });
  assert.equal((await customer.call('POST', '/api/listings', { ...base0, cargoType: 'adr', adrClass: 3 })).status, 409, 'настоящий дубликат отклоняется');

  // после закрытия метки «в топе» нет
  await customer.post('/api/balance/topup', { amount: 1000 }).catch(() => {});
  const boosted = await customer.call('POST', `/api/listings/${adr.id}/boost`);
  assert.equal(boosted.status, 200, JSON.stringify(boosted.data));
  {
    assert.ok((await customer.get(`/api/listings/${adr.id}`)).boostedUntil);
    await customer.post(`/api/listings/${adr.id}/status`, { status: 'closed' });
    const l = await customer.get(`/api/listings/${adr.id}`);
    assert.equal(l.boosted, false);
    assert.equal(l.boostedUntil, null);
    await customer.post(`/api/listings/${adr.id}/status`, { status: 'active' });
  }

  // сколько откликов осталось — видно до отправки; отозванные тоже считаются
  assert.equal((await carrier.get(`/api/listings/${adr.id}`)).responsesLeft, 3);
  for (let i = 0; i < 3; i++) {
    const r = await carrier.post(`/api/listings/${adr.id}/responses`, { message: `Попытка ${i}` });
    const mine = (await carrier.get(`/api/listings/${adr.id}`)).myResponse;
    assert.ok(r.chatId && mine);
    await carrier.post(`/api/responses/${mine.id}/withdraw`);
  }
  assert.equal((await carrier.get(`/api/listings/${adr.id}`)).responsesLeft, 0);
});

test('рейс: ссылка получателя без заказчика, сорванный рейс, GPS по ссылке после рейса, ETA на месте', async () => {
  const customer = await signIn('+77063330001', { name: 'Заказчик', companyName: 'Получатель Тест', companyForm: 'ТОО', role: 'customer' });
  const carrier = await signIn('+77063330002', { name: 'Перевозчик', companyName: 'Возим Тест', companyForm: 'ИП', role: 'carrier' });
  const { id } = await customer.post('/api/listings', { kind: 'cargo', points: ['astana', 'karaganda'], bodyType: 'tent', cargoType: 'consumer', weight: 10, dateFrom: day(0), dateTo: day(2), rate: 150000 });
  await carrier.post(`/api/listings/${id}/responses`, { message: 'Готов' });
  const resp = (await customer.get(`/api/listings/${id}`)).responses[0];
  const { tripId } = await customer.post(`/api/responses/${resp.id}/accept`);
  const trip = await carrier.get(`/api/trips/${tripId}`);
  const pub = await client().get(`/api/track/${trip.trackToken}`);
  assert.equal(pub.customer.name, undefined, 'получатель по ссылке не видит название заказчика');
  assert.ok(pub.carrier.name);

  await carrier.post(`/api/trips/${tripId}/fail`, { reason: 'Машина сломалась в пути' });
  assert.equal((await client().call('GET', `/api/track/${trip.trackToken}`)).status, 404, 'сорванный рейс по ссылке получателя не показывается');
  assert.equal((await client().call('POST', `/api/drive/${trip.driverToken}/gps`, { share: true })).status, 409, 'на закрытом рейсе GPS не включается');
});

test('профиль и команда: понятные ошибки', async () => {
  const owner = await signIn('+77064440001', { name: 'Владелец', companyName: 'Команда Тест', companyForm: 'ТОО', role: 'carrier' });
  // короткий БИН — про длину, а не про контрольный разряд
  const bin = await owner.call('PATCH', '/api/company', { bin: '12345' });
  assert.equal(bin.status, 400);
  assert.match(bin.data.message, /12 цифр/);
  // пустой файл — понятная ошибка вместо «data: не короче 10 симв.»
  const empty = await owner.call('POST', '/api/documents', { kind: 'registration', filename: 'a.pdf', mime: 'application/pdf', data: Buffer.from('%PDF').toString('base64') });
  assert.equal(empty.status, 400);
  assert.match(empty.data.message, /пустой/);

  // водитель-одиночка — без формы ИП/ТОО
  const solo = await signIn('+77064440009', { name: 'Ерлан Водитель', role: 'driver', companyName: 'Ерлан Водитель', companyForm: '' });
  assert.equal(solo.me.company.form, '');

  // повторное приглашение — «уже приглашён», даже если места кончились; второй DELETE — 404
  const inv = await owner.post('/api/team/invite', { phone: '+77064440002', name: 'Сотрудник' });
  for (let i = 3; i < 9; i++) await owner.call('POST', '/api/team/invite', { phone: `+7706444000${i}` });
  const again = await owner.call('POST', '/api/team/invite', { phone: '+77064440002' });
  assert.equal(again.status, 409);
  await owner.call('DELETE', `/api/team/invites/${inv.id}`);
  assert.equal((await owner.call('DELETE', `/api/team/invites/${inv.id}`)).status, 404);
});

test('чат: блокировка видна в списке, ранние сообщения подгружаются', async () => {
  const customer = await signIn('+77065550001', { name: 'Заказчик', companyName: 'Чат Тест', companyForm: 'ТОО', role: 'customer' });
  const carrier = await signIn('+77065550002', { name: 'Перевозчик', companyName: 'Чат Перевоз', companyForm: 'ТОО', role: 'carrier' });
  const { id } = await customer.post('/api/listings', { kind: 'cargo', points: ['almaty', 'taraz'], bodyType: 'tent', cargoType: 'consumer', weight: 5, dateFrom: day(0), dateTo: day(2) });
  const { chatId } = await carrier.post(`/api/listings/${id}/responses`, { message: 'Первое' });
  for (let i = 0; i < 4; i++) await carrier.post(`/api/chats/${chatId}/messages`, { text: `строка ${i}\nвторая строка` });
  const all = await carrier.get(`/api/chats/${chatId}/messages`);
  assert.ok(all.some((m) => m.text.includes('\n')), 'перенос строки сохраняется');
  const older = await carrier.get(`/api/chats/${chatId}/messages?before=${all[2].id}`);
  assert.deepEqual(older.map((m) => m.id), all.slice(0, 2).map((m) => m.id));

  await customer.post(`/api/companies/${carrier.me.company.id}/block`, { on: true });
  const chat = (await carrier.get('/api/chats')).find((c) => c.id === chatId);
  assert.equal(chat.blocked, true);
  assert.equal(chat.peerPhone, null);
});
