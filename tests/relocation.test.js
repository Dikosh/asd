// Перегон: заявка, профиль перегонщика, уведомление, отбор по правам, рейс без госномера и подписи этапов.
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

test('перегон: заявка, перегонщик, уведомление, отклик и рейс', async () => {
  const customer = await signIn('+77063330001', { name: 'Заказчик', companyName: 'Техника Хоргос', companyForm: 'ТОО', role: 'customer' });
  const driver = await signIn('+77063330002', { name: 'Ерлан Перегонщик', companyName: 'Ерлан Перегонщик', role: 'driver' });
  const other = await signIn('+77063330003', { name: 'Без допуска', companyName: 'Без допуска', role: 'driver' });

  // профиль: без города и прав включить нельзя
  assert.equal((await driver.call('PUT', '/api/relocator', { relocator: true, licenses: [], cityId: null })).status, 400);
  await driver.put('/api/relocator', { relocator: true, licenses: ['B', 'C', 'tractor'], cityId: 'almaty', note: 'Погрузчики, 10 лет' });
  await other.put('/api/relocator', { relocator: true, licenses: ['B'], cityId: 'almaty' });
  assert.deepEqual((await driver.get('/api/relocator')).licenses, ['B', 'C', 'tractor']);

  // заявка без вида техники не принимается
  const req = { kind: 'relocation', points: ['khorgos', 'almaty'], brand: 'Погрузчик Hyundai 50D', licenses: ['tractor'], dateFrom: day(0), dateTo: day(3), rate: 40000 };
  assert.equal((await customer.call('POST', '/api/listings', req)).status, 400);
  const { id } = await customer.post('/api/listings', { ...req, vehicleKind: 'special', loadAddress: 'СЭЗ Хоргос, склад 4' });

  // уведомление — только тому, у кого есть нужные права (Хоргос в ~300 км от Алматы — дальше 150 км, поэтому ставим заявку ближе)
  const near = await customer.post('/api/listings', { ...req, vehicleKind: 'special', points: ['kaskelen', 'almaty'] });
  const notes = await driver.get('/api/notifications');
  assert.ok(JSON.stringify(notes).includes('Новая заявка на перегон'), 'перегонщик с нужными правами получил уведомление');
  assert.ok(!JSON.stringify(await other.get('/api/notifications')).includes('Новая заявка на перегон'), 'без удостоверения тракториста уведомления нет');

  // поиск: фильтр «под мои права»
  const mine = await driver.get('/api/listings?kind=relocation&lic=B,C,tractor');
  assert.ok(mine.items.some((l) => l.id === id && l.vehicleKind === 'special' && l.licenses.includes('tractor')));
  assert.equal((await other.get('/api/listings?kind=relocation&lic=B')).total, 0);
  // в поиске грузов заявки на перегон не появляются
  assert.ok(!(await driver.get('/api/listings?kind=cargo')).items.some((l) => l.id === id));

  // каталог перегонщиков: рядом с Алматы и с нужной категорией
  const cat = await customer.get('/api/relocators?city=almaty&lic=tractor');
  assert.deepEqual(cat.map((r) => r.name), ['Ерлан Перегонщик']);

  // отклик и принятие: рейс сразу подтверждён, за рулём — откликнувшийся перегонщик, госномер не нужен
  await driver.post(`/api/listings/${id}/responses`, { message: 'Готов, есть удостоверение тракториста' });
  const full = await customer.get(`/api/listings/${id}`);
  const { tripId } = await customer.post(`/api/responses/${full.responses[0].id}/accept`);
  const trip = await driver.get(`/api/trips/${tripId}`);
  assert.equal(trip.kind, 'relocation');
  assert.equal(trip.myRole, 'carrier');
  assert.ok(trip.confirmed);
  assert.equal(trip.driver.name, 'Ерлан Перегонщик');
  assert.equal(trip.vehicle.brand, 'Погрузчик Hyundai 50D');
  // замену водителя можно сохранить без госномера — у новой техники его может не быть
  await driver.post(`/api/trips/${tripId}/assign`, { brand: '', plate: '', driverName: 'Ерлан Перегонщик', driverPhone: '+77063330002' });
  await driver.post(`/api/trips/${tripId}/gps`, { share: true });
  await driver.post(`/api/trips/${tripId}/stage`, { stage: 'to_loading' });
  const n = JSON.stringify(await customer.get('/api/notifications'));
  assert.ok(n.includes('Перегонщик едет к машине'), 'у перегона свои подписи этапов');
  assert.ok(near.id > id);
});

test('каталог услуг: карточка видна только после оплаты, фильтр по городу', async () => {
  const escort = await signIn('+77063330011', { name: 'Сопровождение', companyName: 'Прикрытие KZ', companyForm: 'ТОО', role: 'carrier' });
  const customer = await signIn('+77063330012', { name: 'Заказчик', companyName: 'Негабарит Строй', companyForm: 'ТОО', role: 'customer' });
  assert.equal((await escort.call('POST', '/api/services', { category: 'escort', title: 'Машина прикрытия', cities: [] })).status, 400, 'без городов нельзя');
  const { id } = await escort.post('/api/services', { category: 'escort', title: 'Машина прикрытия', cities: ['pavlodar', 'astana'], description: 'Маячки, табличка' });
  assert.equal((await customer.get('/api/services?category=escort')).length, 0, 'неоплаченная карточка не видна');
  const poor = await escort.call('POST', `/api/services/${id}/pay`);
  assert.equal(poor.status, 402);
  await escort.post('/api/balance/topup', { amount: 5000 });
  const { paidUntil } = await escort.post(`/api/services/${id}/pay`);
  assert.ok(paidUntil > new Date().toISOString());
  assert.equal((await escort.get('/api/balance')).balance, 0);
  assert.equal((await customer.get('/api/services?category=escort&city=astana')).length, 1);
  assert.equal((await customer.get('/api/services?category=escort&city=almaty')).length, 0);
  assert.equal((await customer.get('/api/services?category=broker')).length, 0);
  // чужую карточку удалить нельзя, свою — можно
  assert.equal((await customer.call('DELETE', `/api/services/${id}`)).status, 403);
  await escort.call('DELETE', `/api/services/${id}`);
  assert.equal((await customer.get('/api/services?category=escort')).length, 0);
});
