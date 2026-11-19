// Правила, которые защищают от злоупотреблений: блокировка компании, права водителя из команды,
// отзыв и чёрный список только после состоявшейся сделки, обязательный отзыв, уход сотрудника,
// груз на несколько машин после сорванного рейса, повторное нажатие на платные действия.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jolda-test-rules-'));
process.env.DEMO_MODE = '1';
delete process.env.OSRM_URL;
delete process.env.FCM_SERVICE_ACCOUNT;
const { createApp } = await import('../server/index.js');
const { seed } = await import('../server/seed.js');
const { q1, run } = await import('../server/db.js');

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
async function admin() {
  const c = client();
  await c.post('/api/auth/demo', { role: 'admin' });
  return c;
}
const day = (n) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
const cargo = (extra = {}) => ({ kind: 'cargo', points: ['shymkent', 'almaty'], weight: 10, dateFrom: day(0), dateTo: day(3), ...extra });
const status = async (c, method, url, body) => (await c.call(method, url, body)).status;
/** Отклик перевозчика принят заказчиком — возвращает номер рейса. */
async function deal(customer, carrier, listing = cargo()) {
  const { id } = await customer.post('/api/listings', listing);
  const r = await carrier.post(`/api/listings/${id}/responses`, { message: 'Беру' });
  const { tripId } = await customer.post(`/api/responses/${r.id}/accept`);
  return { listingId: id, responseId: r.id, tripId };
}
const confirm = (carrier, tripId) => carrier.post(`/api/trips/${tripId}/assign`, { brand: 'Volvo', plate: '001 AAA 01', driverName: 'Иван Петров', driverPhone: '+77010001122' });

test('заблокированная компания не начинает новых сделок, но договаривает по идущему рейсу', async () => {
  const customer = await signIn('+77061300001', { name: 'Заказчик', companyName: 'Груз Блок', companyForm: 'ТОО', role: 'customer' });
  const carrier = await signIn('+77061300002', { name: 'Перевозчик', companyName: 'Везу Блок', companyForm: 'ТОО', role: 'carrier' });
  const mod = await admin();
  const ban = (c, banned) => mod.post(`/api/admin/companies/${c.me.company.id}/ban`, { banned, reason: banned ? 'Проверка жалобы на мошенничество' : '' });

  const { id } = await customer.post('/api/listings', cargo());
  const r = await carrier.post(`/api/listings/${id}/responses`, { message: 'Беру' });
  const chat = (await customer.get('/api/chats')).find((c) => c.listingId === id);

  // заблокирован владелец объявления: принять отклик и писать в чат нельзя
  await ban(customer, true);
  const refused = await customer.call('POST', `/api/responses/${r.id}/accept`);
  assert.deepEqual([refused.status, refused.data.error], [403, 'banned']);
  assert.equal(await status(customer, 'POST', `/api/chats/${chat.id}/messages`, { text: 'Переведите предоплату' }), 403);
  assert.equal(await status(customer, 'POST', '/api/blacklist', { companyId: carrier.me.company.id, reason: 'Не понравились' }), 403);
  await ban(customer, false);

  // заблокирован откликнувшийся: рейс с ним не создаётся
  await ban(carrier, true);
  const other = await customer.call('POST', `/api/responses/${r.id}/accept`);
  assert.deepEqual([other.status, other.data.error], [409, 'banned']);
  await ban(carrier, false);

  // рейс уже идёт — заблокированная сторона может договорить о доставке, но не оставить отзыв
  const { tripId } = await customer.post(`/api/responses/${r.id}/accept`);
  await confirm(carrier, tripId);
  await ban(carrier, true);
  await carrier.post(`/api/chats/${chat.id}/messages`, { text: 'Машина выехала, будем к вечеру' });
  await customer.post(`/api/trips/${tripId}/fail`, { reason: 'Машина не приехала на погрузку' });
  assert.equal(await status(carrier, 'POST', `/api/chats/${chat.id}/messages`, { text: 'Давайте ещё один рейс' }), 403, 'рейс закончился — переписка закрыта');
  assert.equal(await status(carrier, 'POST', `/api/trips/${tripId}/review`, { rating: 1 }), 403);
});

test('водитель из команды: только свои рейсы, без объявлений, ставок и баланса', async () => {
  const customer = await signIn('+77061310001', { name: 'Заказчик', companyName: 'Груз Водитель', companyForm: 'ТОО', role: 'customer' });
  const owner = await signIn('+77061310002', { name: 'Владелец', companyName: 'Парк Водитель', companyForm: 'ТОО', role: 'carrier' });
  await owner.post('/api/balance/topup', { amount: 30000 });
  await owner.post('/api/plan/buy');
  await owner.post('/api/team/invite', { phone: '+77061310003', role: 'driver' });
  await owner.post('/api/team/invite', { phone: '+77061310004', role: 'driver' });
  const driver = await signIn('+77061310003', { name: 'Водитель Асхат', joinInvite: true });
  const idle = await signIn('+77061310004', { name: 'Водитель Берик', joinInvite: true });

  const mine = await owner.post('/api/listings', { kind: 'truck', points: ['shymkent', 'almaty'], bodyType: 'tent', weight: 20, dateFrom: day(0), dateTo: day(3), rate: 450000 });
  const { tripId, listingId } = await deal(customer, owner, cargo({ rate: 400000 }));
  await owner.post(`/api/trips/${tripId}/assign`, { brand: 'Scania', plate: '777 ZZZ 13', driverUserId: driver.me.user.id });

  // закрыто: объявления своей и чужой компании, подбор, цены, отмеченные, подписки, отклики, чаты, деньги
  for (const url of [`/api/listings/${mine.id}`, `/api/listings/${listingId}`, '/api/listings?kind=cargo', '/api/listings/mine', '/api/recommendations',
    '/api/stats/prices', '/api/marks', '/api/searches', '/api/responses', '/api/chats', '/api/balance', '/api/documents', '/api/vehicles', '/api/blacklist'])
    assert.equal(await status(driver, 'GET', url), 403, url);
  // открыто: рейсы, профиль, команда и справочные разделы
  for (const url of ['/api/trips', `/api/trips/${tripId}`, '/api/me', '/api/meta', '/api/notifications', '/api/team', '/api/jobs?kind=vacancy', '/api/news', '/api/companies', '/api/feedback/mine'])
    assert.equal(await status(driver, 'GET', url), 200, url);
  const me = await driver.get('/api/me');
  assert.deepEqual([me.company.balance, me.counters.responses], [0, 0], 'баланс компании водителю не отдаётся');
  assert.ok((await owner.get('/api/me')).company.balance > 0);
  assert.deepEqual((await driver.get(`/api/companies/${owner.me.company.id}`)).listings, [], 'в карточке компании объявлений для водителя нет');
  assert.ok((await customer.get(`/api/companies/${owner.me.company.id}`)).listings.length > 0);

  // по ссылке водителя вошедший водитель ведёт рейс так же, как без входа
  const { driverToken } = await owner.get(`/api/trips/${tripId}`);
  assert.equal(await status(driver, 'POST', `/api/drive/${driverToken}/gps`, { share: true }), 200);

  // события рейса с координатами получают сотрудники и назначенный водитель, но не остальные водители команды
  const listen = async (c) => {
    const ctl = new AbortController();
    const res = await fetch(base + '/api/events', { headers: { Cookie: c.cookie }, signal: ctl.signal });
    const got = { text: '', stop: () => ctl.abort() };
    (async () => { for await (const chunk of res.body) got.text += Buffer.from(chunk).toString(); })().catch(() => {});
    return got;
  };
  const [a, b, o] = [await listen(driver), await listen(idle), await listen(owner)];
  await driver.post(`/api/trips/${tripId}/position`, { lat: 42.3, lon: 69.6, speed: 40 });
  await new Promise((r) => setTimeout(r, 200));
  for (const s of [a, b, o]) s.stop();
  assert.match(o.text, /event: position/, 'владелец видит движение машины');
  assert.match(a.text, /event: position/, 'назначенный водитель получает события своего рейса');
  assert.doesNotMatch(b.text, /event: (position|trip)/, 'водитель без назначения не получает координаты чужого рейса');
});

test('отзыв и чёрный список — только после состоявшейся сделки', async () => {
  const customer = await signIn('+77061320001', { name: 'Заказчик', companyName: 'Груз Отзыв', companyForm: 'ТОО', role: 'customer' });
  const carrier = await signIn('+77061320002', { name: 'Перевозчик', companyName: 'Везу Отзыв', companyForm: 'ТОО', role: 'carrier' });
  const blacklist = () => status(customer, 'POST', '/api/blacklist', { companyId: carrier.me.company.id, reason: 'Сорвал перевозку' });

  // принять отклик и сразу отменить рейс — не основание портить репутацию
  const cancelled = await deal(customer, carrier);
  await customer.post(`/api/trips/${cancelled.tripId}/cancel`);
  assert.equal(await status(customer, 'POST', `/api/trips/${cancelled.tripId}/review`, { rating: 1, text: 'Плохо' }), 409);
  assert.equal((await customer.get(`/api/trips/${cancelled.tripId}`)).canReview, false);
  assert.equal(await blacklist(), 403);
  assert.equal((await customer.get(`/api/companies/${carrier.me.company.id}`)).hadDeal, false);

  // «сорван» до того, как перевозчик подтвердил рейс, — тоже нет
  const early = await deal(customer, carrier, cargo({ points: ['shymkent', 'taraz'] }));
  await customer.post(`/api/trips/${early.tripId}/fail`, { reason: 'Передумали сразу после принятия' });
  assert.equal(await status(customer, 'POST', `/api/trips/${early.tripId}/review`, { rating: 1 }), 409);
  assert.equal(await blacklist(), 403);

  // перевозчик подтвердил машину и водителя, рейс сорван — отзыв и чёрный список доступны обеим сторонам
  const real = await deal(customer, carrier, cargo({ points: ['shymkent', 'astana'] }));
  await confirm(carrier, real.tripId);
  await customer.post(`/api/trips/${real.tripId}/fail`, { reason: 'Машина не приехала на погрузку' });
  assert.equal((await customer.get(`/api/trips/${real.tripId}`)).canReview, true);
  await customer.post(`/api/trips/${real.tripId}/review`, { rating: 2, text: 'Не приехали' });
  await carrier.post(`/api/trips/${real.tripId}/review`, { rating: 3 });
  assert.equal(await blacklist(), 200);
});

test('без отзыва о рейсе через 72 часа нельзя вернуть или переделать старое объявление', async () => {
  const customer = await signIn('+77061330001', { name: 'Заказчик', companyName: 'Груз Срок', companyForm: 'ТОО', role: 'customer' });
  const carrier = await signIn('+77061330002', { name: 'Перевозчик', companyName: 'Везу Срок', companyForm: 'ТОО', role: 'carrier' });
  const old = await customer.post('/api/listings', cargo({ points: ['astana', 'karaganda'] }));
  await customer.post(`/api/listings/${old.id}/status`, { status: 'archived' });
  const live = await customer.post('/api/listings', cargo({ points: ['astana', 'kostanay'] }));
  await customer.post('/api/balance/topup', { amount: 5000 });

  const { tripId } = await deal(customer, carrier);
  await confirm(carrier, tripId);
  // рейс завершён четыре дня назад, отзыва от заказчика нет
  run(`UPDATE trips SET status = 'completed', stage = 'delivered', finished_at = ? WHERE id = ?`, new Date(Date.now() - 96 * 3600_000).toISOString(), tripId);

  const blocked = async (method, url, body) => {
    const r = await customer.call(method, url, body);
    assert.deepEqual([r.status, r.data.error], [409, 'review_required'], `${method} ${url}`);
  };
  await blocked('POST', '/api/listings', cargo());
  await blocked('POST', `/api/listings/${old.id}/status`, { status: 'active' });
  await blocked('PUT', `/api/listings/${old.id}`, cargo({ points: ['almaty', 'taraz'] }));
  await blocked('POST', `/api/listings/${live.id}/boost`);
  // закрыть своё объявление можно и без отзыва
  await customer.post(`/api/listings/${live.id}/status`, { status: 'closed' });

  await customer.post(`/api/trips/${tripId}/review`, { rating: 5 });
  await customer.post(`/api/listings/${old.id}/status`, { status: 'active' });
});

test('сотрудник уходит в другую компанию — объявления прежней остаются в поиске', async () => {
  const owner = await signIn('+77061340001', { name: 'Владелец', companyName: 'Груз Команда', companyForm: 'ТОО', role: 'customer' });
  await owner.post('/api/team/invite', { phone: '+77061340002', role: 'manager' });
  const manager = await signIn('+77061340002', { name: 'Менеджер Айдос', joinInvite: true });
  const other = await signIn('+77061340003', { name: 'Другой', companyName: 'Другая компания', companyForm: 'ТОО', role: 'carrier' });

  const a = await owner.post('/api/listings', cargo({ points: ['astana', 'karaganda'] }));
  const b = await manager.post('/api/listings', cargo({ points: ['astana', 'pavlodar'] }));
  const r = await other.post(`/api/listings/${a.id}/responses`, { message: 'Беру' });

  await other.post('/api/team/invite', { phone: '+77061340002', role: 'manager' });
  await manager.post('/api/team/accept', { accept: true });
  assert.equal((await manager.get('/api/me')).company.id, other.me.company.id);

  for (const id of [a.id, b.id]) assert.equal(q1('SELECT status FROM listings WHERE id = ?', id).status, 'active', `объявление ${id} осталось активным`);
  assert.equal(q1('SELECT user_id FROM listings WHERE id = ?', b.id).user_id, owner.me.user.id, 'контактом по объявлению ушедшего стал владелец');
  assert.equal(q1('SELECT status FROM responses WHERE id = ?', r.id).status, 'sent', 'отклики на объявления компании не тронуты');
});

test('сорванный рейс закрывает объявление на одну машину, но не на несколько', async () => {
  const customer = await signIn('+77061350001', { name: 'Заказчик', companyName: 'Груз Машины', companyForm: 'ТОО', role: 'customer' });
  const carrierA = await signIn('+77061350002', { name: 'Перевозчик А', companyName: 'Везу А', companyForm: 'ТОО', role: 'carrier' });
  const carrierB = await signIn('+77061350003', { name: 'Перевозчик Б', companyName: 'Везу Б', companyForm: 'ТОО', role: 'carrier' });

  const { id } = await customer.post('/api/listings', cargo({ trucks: 3 }));
  const rA = await carrierA.post(`/api/listings/${id}/responses`, { message: 'Одна машина' });
  const rB = await carrierB.post(`/api/listings/${id}/responses`, { message: 'Одна машина' });
  const { tripId } = await customer.post(`/api/responses/${rA.id}/accept`);
  await customer.post(`/api/trips/${tripId}/fail`, { reason: 'Машина не приехала на погрузку' });
  const l = await customer.get(`/api/listings/${id}`);
  assert.deepEqual([l.status, l.booked], ['active', 0], 'ещё три машины не найдены — объявление в поиске');
  assert.equal(q1('SELECT status FROM responses WHERE id = ?', rB.id).status, 'sent', 'отклик второго перевозчика ждёт ответа');
  await customer.post(`/api/responses/${rB.id}/accept`);

  const single = await deal(customer, carrierA, cargo({ points: ['almaty', 'taraz'] }));
  await customer.post(`/api/trips/${single.tripId}/fail`, { reason: 'Машина не приехала на погрузку' });
  assert.equal((await customer.get(`/api/listings/${single.listingId}`)).status, 'closed');
});

test('повторное нажатие на платное действие не списывает деньги второй раз', async () => {
  const owner = await signIn('+77061360001', { name: 'Владелец', companyName: 'Груз Оплата', companyForm: 'ТОО', role: 'customer' });
  await owner.post('/api/balance/topup', { amount: 50000 });
  const balance = async () => (await owner.get('/api/balance')).balance;
  const meta = await owner.get('/api/meta');

  const { id } = await owner.post('/api/listings', cargo());
  await owner.post(`/api/listings/${id}/boost`);
  const again = await owner.call('POST', `/api/listings/${id}/boost`);
  assert.deepEqual([again.status, again.data.message], [409, 'Объявление уже в топе']);
  assert.equal(await balance(), 50000 - meta.boostPrice, 'поднятие в топ списано один раз');

  const before = await balance();
  await owner.post('/api/plan/buy');
  const twice = await owner.call('POST', '/api/plan/buy');
  assert.deepEqual([twice.status, twice.data.error], [409, 'duplicate']);
  assert.equal(await balance(), before - 9900, 'тариф оплачен один раз');
  // через минуту продлить можно
  run(`UPDATE transactions SET created_at = ? WHERE kind = 'plan' AND company_id = ?`, new Date(Date.now() - 60_000).toISOString(), owner.me.company.id);
  await owner.post('/api/plan/buy');
  assert.equal(await balance(), before - 2 * 9900);
});

test('вход продлевается, пока им пользуются, и обрывается после месяца тишины', async () => {
  const user = await signIn('+77061370001', { name: 'Водитель', companyName: 'Долгий рейс', companyForm: 'ИП', role: 'carrier' });
  const sid = user.cookie.split('=')[1];
  const ago = (days) => new Date(Date.now() - days * 86400_000).toISOString();

  // вошёл 29 дней назад и продолжает работать: вход продлевается, cookie выдаётся на новый срок
  run('UPDATE sessions SET created_at = ? WHERE token = ?', ago(29), sid);
  const res = await fetch(base + '/api/me', { headers: { Cookie: user.cookie } });
  assert.match(res.headers.get('set-cookie') || '', new RegExp(`^sid=${sid}; .*Max-Age=2592000`));
  assert.ok(q1('SELECT used_at FROM sessions WHERE token = ?', sid).used_at > ago(1));

  // со дня входа прошло больше месяца, но приложением пользовались вчера — вход действует
  run('UPDATE sessions SET created_at = ?, used_at = ? WHERE token = ?', ago(45), ago(1.5), sid);
  assert.equal((await user.get('/api/me')).user.id, user.me.user.id);
  // в тот же день cookie заново не выдаётся и база не трогается
  const same = await fetch(base + '/api/me', { headers: { Cookie: user.cookie } });
  assert.equal(same.headers.get('set-cookie'), null);

  // месяц без единого обращения — нужно войти заново
  run('UPDATE sessions SET used_at = ? WHERE token = ?', ago(31), sid);
  assert.equal(await user.get('/api/me'), null);
});

test('точки GPS, накопленные без связи, досылаются со своим временем', async () => {
  const customer = await signIn('+77061380001', { name: 'Заказчик', companyName: 'Груз Трасса', companyForm: 'ТОО', role: 'customer' });
  const carrier = await signIn('+77061380002', { name: 'Перевозчик', companyName: 'Везу Трасса', companyForm: 'ТОО', role: 'carrier' });
  const { tripId } = await deal(customer, carrier, cargo({ points: ['almaty', 'astana'] }));
  await confirm(carrier, tripId);
  const pt = (minutesAgo, lat, lon) => ({ lat, lon, speed: 70, at: new Date(Date.now() - minutesAgo * 60_000).toISOString() });

  assert.equal(await status(carrier, 'POST', `/api/trips/${tripId}/positions`, { points: [pt(5, 43.3, 76.9)] }), 409, 'GPS ещё не включён');
  await carrier.post(`/api/trips/${tripId}/gps`, { share: true });
  assert.equal(await status(customer, 'POST', `/api/trips/${tripId}/positions`, { points: [pt(5, 43.3, 76.9)] }), 403, 'позицию передаёт только перевозчик');

  // телефон был без связи полчаса: три точки приходят одним запросом, не по порядку; точка «из будущего» отбрасывается
  const r = await carrier.post(`/api/trips/${tripId}/positions`, { points: [pt(10, 43.6, 76.95), pt(30, 43.3, 76.9), pt(20, 43.45, 76.92), pt(-30, 50, 70)] });
  assert.equal(r.saved, 3);
  const trip = await customer.get(`/api/trips/${tripId}`);
  assert.equal(trip.track.length, 3, 'маршрут на карте без разрыва');
  assert.deepEqual([trip.position.lat, trip.position.lon], [43.6, 76.95], 'последняя позиция — самая поздняя точка');
  assert.ok(Date.now() - Date.parse(trip.position.at) > 9 * 60_000, 'у точки её настоящее время, а не время отправки');
  // повторная отправка тех же точек ничего не дублирует
  assert.equal((await carrier.post(`/api/trips/${tripId}/positions`, { points: [pt(20, 43.45, 76.92)] })).saved, 0);

  // по ссылке водителя — так же; событие о позиции несёт остаток пути
  const { driverToken } = await carrier.get(`/api/trips/${tripId}`);
  const ctl = new AbortController();
  const stream = await fetch(base + '/api/events', { headers: { Cookie: customer.cookie }, signal: ctl.signal });
  let text = '';
  (async () => { for await (const chunk of stream.body) text += Buffer.from(chunk).toString(); })().catch(() => {});
  const anon = client();
  assert.equal((await anon.post(`/api/drive/${driverToken}/positions`, { points: [pt(2, 43.8, 77.0)] })).saved, 1);
  await new Promise((r) => setTimeout(r, 200));
  ctl.abort();
  const ev = JSON.parse(text.split('event: position\ndata: ')[1].split('\n')[0]);
  assert.deepEqual([ev.tripId, ev.lat, ev.lon], [tripId, 43.8, 77.0]);
  assert.ok(ev.remainingKm > 500, 'в событии есть остаток пути до Астаны');
  assert.match(text, /event: trip/, 'после досылки отрезка пути экраны перечитывают рейс');
});
