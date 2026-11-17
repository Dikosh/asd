// Проверка возможностей второй очереди: фильтры, подписки и уведомления, команда, тариф, партнёры,
// личный чёрный список, жалобы, статистика цен, калькуляторы, новости, поддержка.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jolda-test2-'));
process.env.DEMO_MODE = '1';
delete process.env.OSRM_URL; // расстояния в тестах считаются оценкой, без обращения в сеть
const { createApp } = await import('../server/index.js');
const { seed } = await import('../server/seed.js');
const { render } = await import('../server/i18n.js');

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
  return { call, get: (u) => ok('GET', u), post: (u, b = {}) => ok('POST', u, b), patch: (u, b) => ok('PATCH', u, b), del: (u) => ok('DELETE', u) };
}
async function demo(role) {
  const c = client();
  c.me = await c.post('/api/auth/demo', { role });
  return c;
}
async function signIn(phone, extra) {
  const c = client();
  const { devCode } = await c.post('/api/auth/request-code', { phone });
  const v = await c.post('/api/auth/verify', { phone, code: devCode });
  if (v.registered) return Object.assign(c, { me: v });
  c.invite = v.invite;
  c.me = await c.post('/api/auth/register', { regToken: v.regToken, accept: true, ...extra });
  return c;
}
const day = (n) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
const cargo = (over = {}) => ({
  kind: 'cargo', points: ['aktobe', 'atyrau'], bodyType: 'tent', cargoType: 'building', weight: 10, volume: 40, loading: ['rear'],
  dateFrom: day(0), dateTo: day(5), payTerms: ['card'], rate: 300000, currency: 'KZT', ...over,
});

test('шаблоны уведомлений переводятся, маршрут собирается из городов', () => {
  assert.equal(render('Новый отклик: {route}', { route: ['astana', 'almaty'] }, 'ru'), 'Новый отклик: Астана → Алматы');
  assert.match(render('Новый отклик: {route}', { route: ['oskemen', 'almaty'] }, 'kz'), /Жаңа өтінім: Өскемен → Алматы/);
  assert.match(render('Новый груз: {route}', { route: ['astana', 'almaty'] }, 'en'), /^New load: Astana → Almaty$/);
  assert.equal(render('Привет, это текст человека', {}, 'en'), 'Привет, это текст человека');
});

test('новые поля и фильтры поиска', async () => {
  const customer = await demo('customer');
  const carrier = await demo('carrier');
  const adr = await customer.post('/api/listings', cargo({ adrClass: 3, flags: ['cmr', 'tir'], points: ['aktobe', 'orenburg'], bodyType: 'chemtank' }));
  const plain = await customer.post('/api/listings', cargo());
  // среди объявлений из Актобе смотрим только два только что созданных — в демо-данных есть и другие
  const ids = async (qs) => (await carrier.get(`/api/listings?kind=cargo&from=aktobe&${qs}`)).items.map((l) => l.id).filter((id) => id === adr.id || id === plain.id).sort((a, b) => a - b);

  const one = (await carrier.get(`/api/listings/${adr.id}`));
  assert.deepEqual([one.adrClass, one.flags, one.international, one.bodyType], [3, ['cmr', 'tir'], true, 'chemtank']);
  assert.deepEqual(await ids('adr=1'), [adr.id]);
  assert.deepEqual(await ids('flags=tir,cmr'), [adr.id]);
  assert.deepEqual(await ids('flags=ekmt'), []);
  assert.deepEqual(await ids('intl=1'), [adr.id]);
  assert.deepEqual(await ids('intl=0'), [plain.id]);
  assert.deepEqual(await ids('toCountry=RU'), [adr.id]);
  assert.ok((await ids('pay=card')).includes(plain.id));
  assert.deepEqual(await ids('pay=cash'), []);
  assert.ok((await ids('verified=1&direct=1&fresh=1&withRate=1')).includes(plain.id));
  assert.equal((await carrier.call('POST', '/api/listings', cargo({ adrClass: 12 }))).status, 400);

  // просмотры: один на пользователя в день, свои не считаются
  await carrier.get(`/api/listings/${plain.id}`);
  await carrier.get(`/api/listings/${plain.id}`);
  assert.equal((await customer.get(`/api/listings/${plain.id}`)).views, 1);

  // партнёры и личный чёрный список
  const customerCompany = customer.me.company.id;
  assert.deepEqual(await ids('partners=1'), [adr.id, plain.id], 'в демо-данных заказчик уже партнёр перевозчика');
  await carrier.post(`/api/companies/${customerCompany}/block`, { on: true });
  assert.deepEqual(await ids(''), [], 'объявления скрытой компании пропадают из поиска');
  assert.equal((await carrier.get('/api/partners')).length, 0, 'скрытие убирает компанию из партнёров');
  assert.equal((await carrier.get('/api/blocks'))[0].id, customerCompany);
  assert.equal((await carrier.get(`/api/companies/${customerCompany}`)).isBlocked, true);
  await carrier.post(`/api/companies/${customerCompany}/block`, { on: false });
  await carrier.post(`/api/companies/${customerCompany}/partner`, { on: true });
  assert.equal((await carrier.get(`/api/listings/${plain.id}`)).partner, true);
  assert.equal((await carrier.call('POST', `/api/companies/${carrier.me.company.id}/partner`, { on: true })).status, 400);
});

test('подписка на поиск присылает уведомление о новом объявлении', async () => {
  const carrier = await demo('carrier');
  const customer = await demo('customer');
  await carrier.post('/api/notifications/read', {});
  const s = await carrier.post('/api/searches', { kind: 'cargo', name: 'Уральск, тент', params: { from: 'oral', body: 'tent' }, notify: true });
  assert.equal(s.notify, true);
  await customer.post('/api/listings', cargo({ points: ['oral', 'samara'], bodyType: 'ref' }));
  assert.equal((await carrier.get('/api/me')).counters.notifications, 0, 'не тот кузов — уведомления нет');
  const l = await customer.post('/api/listings', cargo({ points: ['oral', 'samara'] }));
  const list = await carrier.get('/api/notifications');
  assert.equal(list[0].kind, 'match');
  assert.equal(list[0].title, 'Новый груз: {route}');
  assert.deepEqual(list[0].vars, { route: ['oral', 'samara'], name: 'Уральск, тент', by: customer.me.company.id });
  assert.equal(list[0].link, `/listing/${l.id}`);
  assert.equal((await customer.get('/api/me')).counters.notifications >= 0, true);
  await carrier.post('/api/notifications/read', { id: list[0].id });
  assert.equal((await carrier.get('/api/me')).counters.notifications, 0);

  // лимит подписок на бесплатном тарифе
  // добираем подписки до лимита тарифа (у демо-перевозчика часть уже есть)
  for (const name of ['b', 'c', 'e']) await carrier.call('POST', '/api/searches', { kind: 'cargo', name, params: { from: 'astana' }, notify: true });
  assert.equal((await carrier.call('POST', '/api/searches', { kind: 'cargo', name: 'd', params: { from: 'astana' }, notify: true })).data.error, 'alert_limit', 'сверх лимита — понятная ошибка, а не тихое отключение');
  const extra = await carrier.post('/api/searches', { kind: 'cargo', name: 'd', params: { from: 'astana' }, notify: false });
  assert.equal((await carrier.call('PATCH', `/api/searches/${extra.id}`, { notify: true })).status, 402);

  // отклик → уведомление владельцу; push-подписка принимается и снимается
  const resp = await carrier.post(`/api/listings/${l.id}/responses`, { message: 'Готов забрать' });
  assert.equal((await customer.get('/api/notifications'))[0].title, 'Новый отклик: {route}');
  assert.ok(resp.id);
  assert.match((await carrier.get('/api/push/key')).key, /^[\w-]{80,}$/);
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'BKey', auth: 'auth' } };
  await carrier.post('/api/push/subscribe', sub);
  for (const endpoint of ['https://127.0.0.1:9443/internal', 'http://169.254.169.254/latest/meta-data/', 'https://evil.example/push'])
    assert.equal((await carrier.call('POST', '/api/push/subscribe', { ...sub, endpoint })).status, 400, 'push уходит только на серверы браузеров');
  assert.equal((await carrier.call('POST', '/api/push/subscribe', { endpoint: 'not a url', keys: {} })).status, 400);
  await carrier.post('/api/push/unsubscribe', { endpoint: sub.endpoint });
});

test('команда, тариф Pro и роли в компании', async () => {
  const owner = await signIn('+77051110001', { name: 'Олжас Владелец', email: 'o@example.com', companyName: 'Команда Тест', companyForm: 'ТОО', role: 'carrier' });
  assert.equal(owner.me.user.companyRole, 'owner');
  await owner.post('/api/team/invite', { phone: '+7 705 111 00 02', name: 'Айдос', role: 'manager' });
  assert.equal((await owner.call('POST', '/api/team/invite', { phone: '+77051110003' })).status, 402, 'на бесплатном тарифе два места');

  // приглашённый сам решает: присоединиться или создать свою компанию
  const mate = await signIn('+77051110002', { name: 'Айдос Сотрудник', email: 'a@example.com', joinInvite: true });
  assert.equal(mate.invite.companyName, 'Команда Тест');
  assert.equal(mate.me.company.id, owner.me.company.id);
  assert.deepEqual([mate.me.user.companyRole, mate.me.user.role], ['manager', 'carrier']);
  const team = await owner.get('/api/team');
  assert.deepEqual([team.members.length, team.invites.length, team.seats], [2, 0, 2]);
  assert.equal((await mate.call('POST', '/api/team/invite', { phone: '+77051110009' })).status, 403, 'приглашает только владелец');
  assert.equal((await mate.call('POST', '/api/plan/buy')).status, 403);
  assert.equal((await mate.call('PATCH', '/api/company', { about: 'взлом' })).status, 403, 'данные компании меняет только владелец');
  assert.equal((await mate.call('GET', '/api/documents')).status, 403, 'документы компании видит только владелец');

  // сотрудник размещает объявление от имени компании, владелец им управляет
  const l = await mate.post('/api/listings', { kind: 'truck', points: ['astana', 'almaty'], brand: 'MAN', dateFrom: day(0), dateTo: day(3) });
  assert.equal((await owner.get('/api/listings/mine?kind=truck'))[0].id, l.id);
  assert.equal((await mate.call('POST', '/api/listings', { kind: 'truck', points: ['astana', 'almaty'], brand: 'MAN', dateFrom: day(0), dateTo: day(3) })).status, 409, 'повтор объявления не размещается');

  // тариф
  assert.equal((await owner.call('POST', '/api/plan/buy')).status, 402);
  await owner.post('/api/balance/topup', { amount: 20000 });
  const pro = await owner.post('/api/plan/buy');
  assert.equal(pro.company.pro, true);
  assert.ok(pro.company.planUntil > new Date().toISOString());
  assert.equal(pro.company.balance, 20000 - 9900);
  await owner.post(`/api/listings/${l.id}/boost`);
  assert.equal((await owner.get('/api/balance')).balance, 20000 - 9900, 'на Pro поднятие в топ бесплатно');
  assert.equal((await owner.get('/api/team')).seats, 10);

  // водитель из команды: ведёт рейсы, но не управляет компанией
  await owner.post('/api/team/invite', { phone: '+77051110003', role: 'driver' });
  const driver = await signIn('+77051110003', { name: 'Марат Водитель', email: 'm@example.com', joinInvite: true });
  assert.deepEqual([driver.me.user.companyRole, driver.me.company.id], ['driver', owner.me.company.id]);
  assert.equal((await driver.call('GET', '/api/trips')).status, 200);
  for (const [method, url, body] of [['POST', '/api/listings', { kind: 'truck', points: ['astana', 'oral'], brand: 'DAF', dateFrom: day(0), dateTo: day(3) }],
    ['POST', `/api/listings/${l.id}/status`, { status: 'archived' }], ['POST', `/api/listings/${l.id}/boost`], ['POST', '/api/blacklist', { companyId: 2, reason: 'обман' }],
    ['GET', '/api/balance'], ['GET', '/api/chats'], ['GET', '/api/documents'], ['POST', '/api/balance/topup', { amount: 1000 }]])
    assert.equal((await driver.call(method, url, body)).status, 403, `водителю закрыто: ${method} ${url}`);

  // приглашение человеку, у которого уже есть аккаунт: он принимает его сам
  const solo = await signIn('+77051110004', { name: 'Ержан Сам', email: 'e@example.com', companyName: 'Сам по себе', companyForm: 'ИП', role: 'driver' });
  assert.equal((await owner.post('/api/team/invite', { phone: '+77051110004', role: 'driver' })).existing, true);
  assert.equal((await solo.get('/api/me')).company.name, 'Сам по себе', 'без согласия человек остаётся в своей компании');
  assert.equal((await solo.get('/api/team')).myInvite.companyName, 'Команда Тест');
  assert.equal((await solo.get('/api/notifications'))[0].title, 'Вас пригласили в компанию «{name}»');
  await solo.post('/api/team/accept', { accept: true });
  assert.equal((await solo.get('/api/me')).company.id, owner.me.company.id);

  // приглашение можно не принимать: человек регистрирует свою компанию
  await owner.post('/api/team/invite', { phone: '+77051110005', role: 'manager' });
  const free = await signIn('+77051110005', { name: 'Данияр Свой', email: 'd@example.com', companyName: 'Своя компания', companyForm: 'ТОО', role: 'customer' });
  assert.equal(free.invite.companyName, 'Команда Тест');
  assert.notEqual(free.me.company.id, owner.me.company.id);

  // удаление сотрудника: он остаётся на платформе в собственной компании, объявления остаются у компании
  const mateId = team.members.find((m) => !m.me).id;
  await owner.del(`/api/team/members/${mateId}`);
  assert.equal(await mate.get('/api/me'), null, 'сессия удалённого сотрудника закрыта');
  const again = await signIn('+77051110002');
  assert.notEqual(again.me.company.id, owner.me.company.id);
  assert.equal((await owner.get(`/api/listings/${l.id}`)).user.id, owner.me.user.id, 'контактом по объявлению стал владелец');
  assert.equal((await owner.call('DELETE', `/api/team/members/${owner.me.user.id}`)).status, 400);
});

test('защита: настройки, чёрный список, блокировка компании, вход', async () => {
  const customer = await demo('customer');
  const admin = await demo('admin');
  // в настройки нельзя записать произвольные данные
  assert.equal((await customer.call('PATCH', '/api/me', { settings: { junk: 'x'.repeat(1000) } })).status, 400);
  assert.equal((await customer.call('PATCH', '/api/me', { settings: { showPhone: false, lang: 'kz' } })).status, 200);
  const stranger = await signIn('+77052220001', { name: 'Чужой Человек', email: 's@example.com', companyName: 'Без сделок', companyForm: 'ИП', role: 'carrier' });
  // скрытый телефон не виден ни в объявлениях, ни на странице компании
  const page = await stranger.get(`/api/companies/${customer.me.company.id}`);
  assert.equal(page.contacts[0].phone, null);
  assert.equal(page.hadDeal, false);
  await customer.patch('/api/me', { settings: { showPhone: true } });
  // чёрный список — только после сделки
  assert.equal((await stranger.call('POST', '/api/blacklist', { companyId: customer.me.company.id, reason: 'Мошенники' })).data.error, 'no_deal');
  // БИН чужой компании занять нельзя
  assert.equal((await stranger.call('PATCH', '/api/company', { bin: customer.me.company.bin })).data.error, 'bin_taken');
  // неверный код: после десяти ошибок вход по номеру закрыт, даже с новым кодом
  const c = client();
  for (let i = 0; i < 2; i++) {
    const { devCode } = await c.post('/api/auth/request-code', { phone: '+77052220009' });
    for (let k = 0; k < 5; k++) assert.equal((await c.call('POST', '/api/auth/verify', { phone: '+77052220009', code: devCode === '000000' ? '111111' : '000000' })).status, 400);
  }
  const { devCode } = await c.post('/api/auth/request-code', { phone: '+77052220009' });
  assert.equal((await c.call('POST', '/api/auth/verify', { phone: '+77052220009', code: devCode })).status, 429, 'после десяти ошибок не помогает и верный код');
  // испорченная cookie и «опасные» имена параметров не дают ошибку сервера
  assert.equal((await fetch(base + '/api/meta', { headers: { Cookie: 'sid=%' } })).status, 200);
  assert.equal((await customer.call('GET', '/api/listings?kind=cargo&sort=__proto__')).status, 200);
  assert.equal((await customer.call('POST', '/api/documents', { kind: 'other', filename: 'x', mime: 'constructor', data: 'AAAAAAAAAAAAAAAA' })).status, 400);
  // блокировка компании модератором
  const banUrl = `/api/admin/companies/${stranger.me.company.id}/ban`;
  assert.equal((await admin.call('POST', banUrl, { banned: true })).status, 400, 'без причины заблокировать нельзя');
  await admin.post(banUrl, { banned: true, reason: 'Просили предоплату и пропали' });
  const banned = await stranger.get('/api/me');
  assert.equal(banned.company.banned, true);
  assert.equal(banned.company.banReason, 'Просили предоплату и пропали', 'компания видит причину');
  assert.equal(banned.company.indicator, 'red');
  assert.equal((await stranger.call('POST', '/api/listings', cargo())).data.error, 'banned');
  assert.ok((await stranger.get('/api/notifications')).some((n) => n.title === 'Компания заблокирована модератором'));
  // обжалование: обращение в поддержку, ответ модератора, снятие блокировки
  await stranger.post('/api/feedback', { text: 'Это ошибка, прошу разобраться' });
  const o = await admin.get('/api/admin/overview');
  assert.ok(o.banned.some((x) => x.id === stranger.me.company.id));
  assert.ok(o.log.some((x) => x.action === 'ban'));
  const f = o.feedback.find((x) => x.text === 'Это ошибка, прошу разобраться');
  await admin.post(`/api/admin/feedback/${f.id}`, { reply: 'Проверили, блокировку сняли' });
  assert.equal((await stranger.get('/api/feedback/mine'))[0].reply, 'Проверили, блокировку сняли');
  await admin.post(banUrl, { banned: false });
  assert.equal((await stranger.get('/api/me')).company.banned, false);
  assert.ok((await admin.get('/api/admin/search?q=' + encodeURIComponent('2220001'))).some((x) => x.id === stranger.me.company.id), 'поиск по телефону');
});

test('жалобы, поддержка, новости и сводка модератора', async () => {
  const customer = await demo('customer');
  const carrier = await demo('carrier');
  const admin = await demo('admin');
  const l = await customer.post('/api/listings', cargo({ points: ['kostanay', 'rudny'], rate: 30000 }));
  assert.equal((await customer.call('POST', '/api/complaints', { listingId: l.id, reason: 'fraud' })).status, 400, 'на себя жаловаться нельзя');
  await carrier.post('/api/complaints', { listingId: l.id, reason: 'fraud', text: 'Просят предоплату на карту' });
  await carrier.post('/api/feedback', { text: 'Не приходит код из SMS' });
  assert.equal((await carrier.call('GET', '/api/admin/overview')).status, 403);
  const o = await admin.get('/api/admin/overview');
  assert.ok(o.stats.users > 10 && o.stats.listings > 20);
  const c = o.complaints.find((x) => x.listingId === l.id);
  assert.equal(c.reason, 'fraud');
  assert.equal(o.feedback[0].text, 'Не приходит код из SMS');
  await admin.post(`/api/admin/complaints/${c.id}`, { action: 'close_listing' });
  assert.equal((await customer.get(`/api/listings/${l.id}`)).status, 'removed');
  assert.equal((await customer.call('POST', `/api/listings/${l.id}/status`, { status: 'active' })).status, 403, 'снятое модератором объявление владелец не вернёт');
  assert.equal((await customer.get('/api/notifications'))[0].title, 'Объявление №{n} снято модератором');
  await admin.post(`/api/admin/feedback/${o.feedback[0].id}`);
  assert.equal((await admin.get('/api/admin/overview')).feedback.length, 0);

  const before = (await client().get('/api/news')).length;
  const n = await admin.post('/api/admin/news', { title: 'Тестовая новость', body: 'Текст новости' });
  assert.equal((await carrier.call('POST', '/api/admin/news', { title: 'Взлом', body: 'текст' })).status, 403);
  assert.equal((await client().get('/api/news')).length, before + 1);
  await admin.del(`/api/admin/news/${n.id}`);
});

test('статистика цен и калькулятор маршрута', async () => {
  const c = await demo('logist');
  const stats = await c.get('/api/stats/prices?kind=cargo');
  assert.ok(stats.sample >= 20 && stats.directions.length >= 10, JSON.stringify([stats.sample, stats.directions.length]));
  assert.ok(stats.overall.low <= stats.overall.median && stats.overall.median <= stats.overall.high);
  assert.ok(stats.directions.every((d) => d.perKm > 50 && d.perKm < 5000), JSON.stringify(stats.directions.filter((d) => !(d.perKm > 50 && d.perKm < 5000))));
  assert.ok(stats.byBody.length >= 3, JSON.stringify(stats.byBody));
  const r = await c.get('/api/tools/route?points=astana,karaganda,almaty&body=tent');
  assert.equal(r.source, 'estimate');
  assert.ok(r.km > 1000 && r.km < 1500, `Астана — Караганда — Алматы: ${r.km} км`);
  assert.ok(r.cost.low <= r.cost.median && r.cost.median <= r.cost.high && r.cost.median > 100000, JSON.stringify(r.cost));
  assert.equal((await c.call('GET', '/api/tools/route?points=astana')).status, 400);
});
