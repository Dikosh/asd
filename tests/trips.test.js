// Рейс глазами перевозчика: груз на несколько машин, подтверждение машины и водителя, водитель из команды, адреса.
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

test('груз на три машины: отклики, рейсы, закрытие объявления', async () => {
  const customer = await signIn('+77061110001', { name: 'Заказчик', companyName: 'Зерно Север', companyForm: 'ТОО', role: 'customer' });
  const carrierA = await signIn('+77061110002', { name: 'Перевозчик А', companyName: 'Тасымал А', companyForm: 'ТОО', role: 'carrier' });
  const carrierB = await signIn('+77061110003', { name: 'Перевозчик Б', companyName: 'Тасымал Б', companyForm: 'ИП', role: 'carrier' });

  const { id } = await customer.post('/api/listings', {
    kind: 'cargo', points: ['kostanay', 'astana'], bodyType: 'grain', cargoType: 'agro', weight: 22, dateFrom: day(0), dateTo: day(5), rate: 300000,
    trucks: 3, loadAddress: 'Элеватор, ул. Промышленная 12', unloadAddress: 'Мелькомбинат', loadTime: '7:00–15:00',
  });
  let l = await carrierA.get(`/api/listings/${id}`);
  assert.deepEqual([l.trucks, l.booked, l.full, l.loadAddress, l.loadTime], [3, 0, false, 'Элеватор, ул. Промышленная 12', '7:00–15:00']);

  // перевозчик А предлагает две машины, Б — одну; больше, чем осталось, предложить нельзя
  assert.equal((await carrierA.call('POST', `/api/listings/${id}/responses`, { message: 'Дам пять', trucks: 5 })).status, 409);
  const vA = await carrierA.post('/api/vehicles', { brand: 'Howo', plate: '111 AAA 10', bodyType: 'grain' });
  assert.equal((await carrierB.call('POST', `/api/listings/${id}/responses`, { message: 'чужая машина', vehicleId: vA.id })).status, 404, 'машину из чужого парка указать нельзя');
  const rA = await carrierA.post(`/api/listings/${id}/responses`, { message: 'Две машины', trucks: 2, price: 290000 });
  const rB = await carrierB.post(`/api/listings/${id}/responses`, { message: 'Одна', price: 310000 });
  const own = await customer.get(`/api/listings/${id}`);
  assert.equal(own.responses.find((r) => r.id === rA.id).trucks, 2);

  // принятие отклика А создаёт два рейса; объявление остаётся в поиске — нужна ещё одна машина
  await customer.post(`/api/responses/${rA.id}/accept`);
  l = await customer.get(`/api/listings/${id}`);
  assert.deepEqual([l.booked, l.full, l.trips.length], [2, false, 2]);
  assert.ok((await carrierB.get('/api/listings?kind=cargo&from=kostanay')).items.some((x) => x.id === id), 'объявление ещё ищет машину');
  assert.equal((await carrierA.get(`/api/listings/${id}`)).trips.length, 2, 'перевозчик видит свои рейсы');
  assert.equal((await carrierB.get(`/api/listings/${id}`)).trips.length, 0, 'чужие рейсы не видны');

  // принятие Б — все машины найдены, объявление скрыто из поиска, новые отклики не принимаются
  await customer.post(`/api/responses/${rB.id}/accept`);
  l = await customer.get(`/api/listings/${id}`);
  assert.deepEqual([l.booked, l.full], [3, true]);
  assert.equal((await carrierB.get('/api/listings?kind=cargo&from=kostanay')).items.some((x) => x.id === id), false);
  const late = await signIn('+77061110004', { name: 'Опоздал', companyName: 'Поздно', companyForm: 'ИП', role: 'carrier' });
  assert.equal((await late.call('POST', `/api/listings/${id}/responses`, { message: 'я тоже' })).status, 409);

  // отмена одного рейса освобождает место
  const tripB = l.trips.find((x) => x.carrierName === 'Тасымал Б');
  await carrierB.post(`/api/trips/${tripB.id}/cancel`);
  assert.equal((await customer.get(`/api/listings/${id}`)).full, false);

  // сорванный рейс не закрывает объявление, пока идут остальные
  const [t1, t2] = (await customer.get(`/api/listings/${id}`)).trips.filter((x) => x.status === 'active');
  await customer.post(`/api/trips/${t1.id}/fail`, { reason: 'Машина не приехала на погрузку' });
  assert.equal((await customer.get(`/api/listings/${id}`)).status, 'active');
  // адреса фиксируются в условиях рейса
  const trip2 = await carrierA.get(`/api/trips/${t2.id}`);
  assert.deepEqual([trip2.loadAddress, trip2.unloadAddress, trip2.loadTime], ['Элеватор, ул. Промышленная 12', 'Мелькомбинат', '7:00–15:00']);
});

test('водитель из команды видит только назначенные рейсы', async () => {
  const customer = await signIn('+77061120001', { name: 'Заказчик', companyName: 'Груз Юг', companyForm: 'ТОО', role: 'customer' });
  const owner = await signIn('+77061120002', { name: 'Владелец', companyName: 'Парк Юг', companyForm: 'ТОО', role: 'carrier' });
  await owner.post('/api/team/invite', { phone: '+77061120003', role: 'driver' });
  const driver = await signIn('+77061120003', { name: 'Водитель Асхат', joinInvite: true });

  const trips = [];
  for (const to of ['almaty', 'taraz']) {
    const { id } = await customer.post('/api/listings', { kind: 'cargo', points: ['shymkent', to], weight: 10, dateFrom: day(0), dateTo: day(3) });
    const r = await owner.post(`/api/listings/${id}/responses`, { message: 'Беру' });
    trips.push((await customer.post(`/api/responses/${r.id}/accept`)).tripId);
  }
  assert.equal((await driver.get('/api/trips')).length, 0, 'пока не назначен — рейсов не видит');
  assert.equal((await driver.call('POST', `/api/trips/${trips[0]}/assign`, { brand: 'X', plate: '1234', driverName: 'Я', driverPhone: '+77010000000' })).status, 403, 'водитель сам себя не назначает');

  await owner.post(`/api/trips/${trips[0]}/assign`, { brand: 'Scania', plate: '777 ZZZ 13', driverUserId: driver.me.user.id });
  const mine = await driver.get('/api/trips');
  assert.deepEqual(mine.map((x) => x.id), [trips[0]]);
  assert.equal(mine[0].driver.name, 'Водитель Асхат', 'имя и телефон берутся из профиля водителя');
  assert.equal(mine[0].price, null, 'водитель не видит цену');
  assert.equal((await driver.call('GET', `/api/trips/${trips[1]}`)).status, 404, 'чужой рейс компании недоступен');
  assert.equal((await driver.get('/api/me')).counters.trips, 1);
  // водитель ведёт свой рейс сам
  await driver.post(`/api/trips/${trips[0]}/gps`, { share: true });
  await driver.post(`/api/trips/${trips[0]}/stage`, { stage: 'to_loading' });
  assert.equal((await driver.call('POST', `/api/trips/${trips[1]}/gps`, { share: true })).status, 404);
  // в заявке на перевозку — назначенный водитель, а не владелец аккаунта перевозчика
  const doc = await customer.get(`/api/trips/${trips[0]}`);
  assert.equal(doc.driver.name, 'Водитель Асхат');
  assert.notEqual(doc.driver.phone, doc.carrier.phone);
});
