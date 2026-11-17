// Сквозная проверка API: регистрация → объявления → отклик → рейс с GPS → отзывы.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jolda-test-'));
process.env.DEMO_MODE = '1';
const { createApp } = await import('../server/index.js');
const { seed } = await import('../server/seed.js');
const { isValidBin, routeFit, cityById } = await import('../server/geo.js');

let server;
let base;
before(async () => {
  seed();
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

/** Клиент со своей сессией (cookie). */
function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  };
  const ok = async (method, url, body) => {
    const r = await call(method, url, body);
    assert.ok(r.status < 300, `${method} ${url} → ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  };
  return { call, get: (u) => ok('GET', u), post: (u, b = {}) => ok('POST', u, b), put: (u, b) => ok('PUT', u, b), patch: (u, b) => ok('PATCH', u, b), del: (u) => ok('DELETE', u) };
}
async function register(phone, role, companyName) {
  const c = client();
  const { devCode } = await c.post('/api/auth/request-code', { phone });
  assert.match(devCode, /^\d{6}$/);
  const wrong = await c.call('POST', '/api/auth/verify', { phone, code: '000000' === devCode ? '111111' : '000000' });
  assert.equal(wrong.status, 400);
  const v = await c.post('/api/auth/verify', { phone, code: devCode });
  assert.equal(v.registered, false);
  const noConsent = await c.call('POST', '/api/auth/register', { regToken: v.regToken, name: 'Тест Тестов', email: 't@example.com', companyName, companyForm: 'ТОО', role });
  assert.equal(noConsent.status, 400, 'без согласия с правилами регистрация невозможна');
  const me = await c.post('/api/auth/register', { regToken: v.regToken, name: 'Тест Тестов', email: 't@example.com', companyName, companyForm: 'ТОО', role, accept: true });
  assert.equal(me.user.role, role);
  return c;
}
const day = (n) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);

test('геометрия и БИН', () => {
  assert.equal(isValidBin('123456789012'), false);
  assert.equal(isValidBin('abc'), false);
  const c = (id) => cityById.get(id);
  const route = [c('astana'), c('karaganda'), c('almaty')];
  assert.notEqual(routeFit(route, c('temirtau'), c('almaty'), 150), null, 'Темиртау лежит по пути Астана → Алматы');
  assert.equal(routeFit(route, c('almaty'), c('astana'), 150), null, 'обратное направление не подходит');
  assert.equal(routeFit(route, c('aktau'), c('almaty'), 150), null, 'Актау не по пути');
});

test('защита: без входа API закрыт, демо-данные на месте', async () => {
  const anon = client();
  assert.equal((await anon.call('GET', '/api/listings?kind=cargo')).status, 401);
  assert.equal(await anon.get('/api/me'), null);
  const meta = await anon.get('/api/meta');
  assert.ok(meta.places > 70 && meta.stats.cargo > 20);
  const places = await anon.get('/api/places');
  assert.equal(places.length, meta.places);
  assert.equal(places.find((p) => p[0] === 'astana')[1], 'Астана');
  const demo = client();
  const me = await demo.post('/api/auth/demo', { role: 'carrier' });
  assert.equal(me.user.role, 'carrier');
  assert.equal(me.company.binValid, true);
  const rec = await demo.get('/api/recommendations');
  assert.equal(rec[0].kind, 'cargo');
  assert.ok(rec[0].items.length > 0);
  const trips = await demo.get('/api/trips');
  assert.equal(trips[0].stage, 'in_transit');
  const pub = await anon.get('/api/track/demo-track-jolda');
  assert.ok(pub.position && pub.track.length > 10 && pub.etaHours > 0);
  assert.equal(pub.carrier.phone, undefined, 'публичная ссылка не раскрывает телефоны');
  assert.deepEqual([pub.price, pub.listingId, pub.carrier.userName, pub.customer.companyId], [undefined, undefined, undefined, undefined], 'и не раскрывает цену, имена и ссылки на объявление');
  assert.equal((await demo.call('GET', '/api/admin/queue')).status, 403);
});

test('полный цикл сделки', async () => {
  const customer = await register('+7 (700) 111-22-33', 'customer', 'Тест Груз');
  const carrier = await register('+77001112244', 'carrier', 'Тест Перевозчик');

  // размещение
  const bad = await customer.call('POST', '/api/listings', { kind: 'cargo', points: ['astana'], dateFrom: day(0), dateTo: day(5) });
  assert.equal(bad.status, 400);
  const cargo = await customer.post('/api/listings', {
    kind: 'cargo', points: ['petropavl', 'kokshetau', 'astana'], bodyType: 'tent', cargoType: 'building', weight: 10, volume: 40,
    loading: ['rear'], dateFrom: day(0), dateTo: day(7), payTerms: ['cashless_vat'], rate: 200000, currency: 'KZT', description: 'Тестовый груз',
  });
  const truck = await carrier.post('/api/listings', {
    kind: 'truck', points: ['petropavl', 'astana', 'karaganda'], brand: 'Тест-тягач', bodyType: 'tent', weight: 20, volume: 82,
    loading: ['rear', 'side'], dateFrom: day(0), dateTo: day(10), payTerms: [], rate: null,
  });

  // поиск и фильтры
  const found = await carrier.get('/api/listings?kind=cargo&from=petropavl&to=astana');
  assert.ok(found.items.some((l) => l.id === cargo.id));
  assert.equal((await carrier.get('/api/listings?kind=cargo&from=petropavl&to=astana&wMin=15')).items.some((l) => l.id === cargo.id), false);
  const trucks = await customer.get('/api/listings?kind=truck&from=kokshetau&to=astana&radius=50');
  assert.ok(trucks.items.some((l) => l.id === truck.id), 'транспорт находится по промежуточной точке маршрута');
  assert.equal((await customer.get('/api/listings?kind=truck&from=astana&to=petropavl')).items.some((l) => l.id === truck.id), false);

  // подбор: груз видит подходящий транспорт
  const detail = await customer.get(`/api/listings/${cargo.id}`);
  assert.ok(detail.matches.some((m) => m.id === truck.id && m.match.score >= 40));
  assert.equal(detail.distanceKm > 400, true);

  // отметки, заметки, скрытие
  await carrier.post(`/api/listings/${cargo.id}/mark`, { note: 'перезвонить' });
  assert.equal((await carrier.get('/api/marks')).some((l) => l.id === cargo.id && l.mark.note === 'перезвонить' && l.mark.marked), true);
  await carrier.post(`/api/listings/${cargo.id}/mark`, { hidden: true });
  assert.equal((await carrier.get('/api/listings?kind=cargo&from=petropavl')).items.some((l) => l.id === cargo.id), false);
  assert.equal((await carrier.get('/api/marks?hidden=1')).some((l) => l.id === cargo.id), true);
  await carrier.post(`/api/listings/${cargo.id}/mark`, { hidden: false });

  // сохранённый поиск
  const s = await carrier.post('/api/searches', { kind: 'cargo', name: 'Север', params: { from: 'petropavl' } });
  assert.equal((await carrier.get('/api/searches')).length, 1);
  await carrier.del(`/api/searches/${s.id}`);

  // отклик и чат
  assert.equal((await customer.call('POST', `/api/listings/${cargo.id}/responses`, { message: 'сам себе' })).status, 400);
  const resp = await carrier.post(`/api/listings/${cargo.id}/responses`, { message: 'Заберу завтра', price: 190000 });
  assert.equal((await carrier.call('POST', `/api/listings/${cargo.id}/responses`, { message: 'ещё раз' })).status, 409);
  await customer.post(`/api/chats/${resp.chatId}/messages`, { text: 'Договорились' });
  const msgs = await carrier.get(`/api/chats/${resp.chatId}/messages`);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[1].mine, false);
  assert.equal((await customer.get('/api/me')).counters.responses, 1);
  const stranger = client();
  await stranger.post('/api/auth/demo', { role: 'logist' });
  assert.equal((await stranger.call('GET', `/api/chats/${resp.chatId}/messages`)).status, 404, 'чужой чат недоступен');

  // рейс
  assert.equal((await carrier.call('POST', `/api/responses/${resp.id}/accept`)).status, 403);
  const { tripId } = await customer.post(`/api/responses/${resp.id}/accept`);
  assert.ok(tripId);
  assert.equal((await stranger.call('GET', `/api/trips/${tripId}`)).status, 404);
  assert.equal((await carrier.call('POST', `/api/trips/${tripId}/stage`, { stage: 'to_loading' })).status, 409, 'без GPS рейс не начать');
  await carrier.post(`/api/trips/${tripId}/gps`, { share: true });
  assert.equal((await customer.call('POST', `/api/trips/${tripId}/stage`, { stage: 'to_loading' })).status, 403);
  assert.equal((await carrier.call('POST', `/api/trips/${tripId}/stage`, { stage: 'in_transit' })).status, 409, 'этапы — по порядку');
  await carrier.post(`/api/trips/${tripId}/stage`, { stage: 'to_loading' });
  await carrier.post(`/api/trips/${tripId}/stage`, { stage: 'loading' });
  assert.equal((await carrier.call('POST', `/api/trips/${tripId}/stage`, { stage: 'in_transit' })).data.error, 'gps_stale', 'в путь — только с GPS-позицией');
  assert.equal((await carrier.call('POST', `/api/trips/${tripId}/gps`, { share: false })).status, 409, 'после начала рейса GPS не отключить');
  await carrier.post(`/api/trips/${tripId}/position`, { lat: 54.0, lon: 69.3, speed: 80 });
  await carrier.post(`/api/trips/${tripId}/stage`, { stage: 'in_transit' });
  // точка, до которой машина не могла доехать за секунды, отбрасывается
  await new Promise((r) => setTimeout(r, 1600));
  assert.equal((await carrier.post(`/api/trips/${tripId}/position`, { lat: 43.2, lon: 76.9 })).reason, 'jump');
  // правка объявления после сделки не меняет условия рейса
  assert.equal((await customer.call('PUT', `/api/listings/${cargo.id}`, { points: ['astana', 'moscow'], dateFrom: day(0), dateTo: day(3) })).status, 409);
  const trip = await customer.get(`/api/trips/${tripId}`);
  assert.equal(trip.myRole, 'customer');
  assert.equal(trip.price, 190000);
  assert.ok(trip.position && trip.remainingKm > 100 && trip.etaHours >= 1);
  assert.equal((await carrier.get('/api/listings?kind=cargo&from=petropavl')).items.some((l) => l.id === cargo.id), false, 'груз в рейсе скрыт из поиска');
  assert.equal((await customer.call('POST', `/api/trips/${tripId}/complete`)).status, 409);
  assert.equal((await carrier.call('POST', `/api/trips/${tripId}/stage`, { stage: 'unloading' })).data.error, 'gps_far', 'выгрузку не отметить вдали от пункта выгрузки');
  await new Promise((r) => setTimeout(r, 1600));
  await carrier.post(`/api/trips/${tripId}/position`, { lat: 51.15, lon: 71.45, sim: true });
  await carrier.post(`/api/trips/${tripId}/stage`, { stage: 'unloading' });
  await carrier.post(`/api/trips/${tripId}/stage`, { stage: 'delivered' });
  assert.equal((await carrier.call('POST', `/api/trips/${tripId}/complete`)).status, 403, 'перевозчик сам завершить не может, пока не прошло трое суток');
  await customer.post(`/api/trips/${tripId}/complete`);
  assert.equal((await customer.call('POST', `/api/listings/${cargo.id}/status`, { status: 'active' })).status, 409, 'объявление с состоявшимся рейсом заново не открыть');
  assert.equal((await customer.get('/api/listings/mine?kind=cargo'))[0].status, 'closed');

  // отзыв обязателен
  assert.equal((await customer.get('/api/me')).pendingReviews.length, 1);
  const blocked = await customer.call('POST', '/api/listings', { kind: 'cargo', points: ['astana', 'almaty'], dateFrom: day(0), dateTo: day(3) });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.error, 'review_required');
  await customer.post(`/api/trips/${tripId}/review`, { rating: 5, text: 'Отлично' });
  assert.equal((await carrier.get('/api/me')).company.rating, null, 'отзыв не считается, пока вторая сторона не оставила свой');
  assert.equal((await carrier.get(`/api/trips/${tripId}`)).reviews.length, 0);
  await carrier.post(`/api/trips/${tripId}/review`, { rating: 4, text: '' });
  assert.equal((await carrier.get(`/api/trips/${tripId}`)).reviews.length, 2);
  assert.equal((await customer.call('POST', `/api/trips/${tripId}/review`, { rating: 1 })).status, 409);
  assert.equal((await carrier.get('/api/me')).company.rating, null, 'отзыв непроверенной компании виден, но в рейтинг не идёт');
  // модератор подтверждает заказчика — его отзыв начинает учитываться
  const mod = client();
  await mod.post('/api/auth/demo', { role: 'admin' });
  await mod.post(`/api/admin/companies/${(await customer.get('/api/me')).company.id}`, { approve: true });
  const me = await carrier.get('/api/me');
  assert.equal(me.company.rating, 5);
  assert.equal(me.company.indicator, 'gray', 'один отзыв цвет индикатора не меняет');
  assert.equal(me.pendingReviews.length, 0);

  // кабинет: БИН, машины, сотрудники, баланс, чёрный список, работа
  assert.equal((await carrier.call('PATCH', '/api/company', { bin: '111111111111' })).status, 400);
  const v = await carrier.post('/api/vehicles', { brand: 'Volvo', plate: '001 AAA 01', bodyType: 'ref', weight: 20, volume: 82, loading: ['rear'] });
  await carrier.put(`/api/vehicles/${v.id}`, { brand: 'Volvo FH16', loading: [] });
  assert.equal((await carrier.get('/api/vehicles'))[0].brand, 'Volvo FH16');
  await carrier.post('/api/employees', { name: 'Иван Водитель', esutd: 'registered', esutdNumber: 'ТД-1' });
  assert.equal((await carrier.get('/api/employees')).length, 1);
  assert.equal((await carrier.call('POST', `/api/listings/${truck.id}/boost`)).status, 402);
  await carrier.post('/api/balance/topup', { amount: 1000 });
  await carrier.post(`/api/listings/${truck.id}/boost`);
  assert.equal((await carrier.get('/api/balance')).balance, 500);
  const customerCompany = (await customer.get('/api/me')).company.id;
  await carrier.post('/api/blacklist', { companyId: customerCompany, reason: 'Тестовая причина', review: 'текст' });
  assert.equal((await carrier.get(`/api/companies/${customerCompany}`)).blacklist.length, 1);
  assert.ok((await carrier.get('/api/blacklist')).some((b) => b.companyId === customerCompany && b.mine));
  await carrier.post('/api/jobs', { kind: 'vacancy', title: 'Нужен водитель CE', cityId: 'astana', licenseCats: 'CE', experience: 3 });
  assert.ok((await customer.get('/api/jobs?kind=vacancy&city=astana')).some((j2) => j2.title === 'Нужен водитель CE'));
  assert.ok((await customer.get('/api/companies?q=Тест')).length >= 2);

  // документы и модерация
  const doc = await carrier.post('/api/documents', { kind: 'registration', filename: 'спр.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4 test').toString('base64') });
  assert.equal((await carrier.call('POST', '/api/documents', { kind: 'other', filename: 'x.exe', mime: 'application/x-msdownload', data: 'AAAAAAAAAAAAAAAA' })).status, 400);
  assert.equal((await customer.call('GET', `/api/documents/${doc.id}/file`)).status, 404, 'чужие документы недоступны');
  const adminC = client();
  await adminC.post('/api/auth/demo', { role: 'admin' });
  assert.ok((await adminC.get('/api/admin/queue')).documents.some((d) => d.id === doc.id));
  await adminC.post(`/api/admin/documents/${doc.id}`, { approve: true });
  assert.equal((await carrier.get('/api/documents'))[0].status, 'approved');

  await carrier.post('/api/auth/logout');
  assert.equal(await carrier.get('/api/me'), null);
});
