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
  c.me = await c.post('/api/auth/register', { regToken: v.regToken, ...extra });
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
  assert.deepEqual(list[0].vars, { route: ['oral', 'samara'], name: 'Уральск, тент' });
  assert.equal(list[0].link, `/listing/${l.id}`);
  assert.equal((await customer.get('/api/me')).counters.notifications >= 0, true);
  await carrier.post('/api/notifications/read', { id: list[0].id });
  assert.equal((await carrier.get('/api/me')).counters.notifications, 0);

  // лимит подписок на бесплатном тарифе
  for (const name of ['b', 'c']) await carrier.post('/api/searches', { kind: 'cargo', name, params: { from: 'astana' }, notify: true });
  const extra = await carrier.post('/api/searches', { kind: 'cargo', name: 'd', params: { from: 'astana' }, notify: true });
  assert.equal(extra.notify, false, 'сверх лимита поиск сохраняется без подписки');
  assert.equal((await carrier.call('PATCH', `/api/searches/${extra.id}`, { notify: true })).status, 402);

  // отклик → уведомление владельцу; push-подписка принимается и снимается
  const resp = await carrier.post(`/api/listings/${l.id}/responses`, { message: 'Готов забрать' });
  assert.equal((await customer.get('/api/notifications'))[0].title, 'Новый отклик: {route}');
  assert.ok(resp.id);
  assert.match((await carrier.get('/api/push/key')).key, /^[\w-]{80,}$/);
  const sub = { endpoint: 'https://push.example.test/abc', keys: { p256dh: 'BKey', auth: 'auth' } };
  await carrier.post('/api/push/subscribe', sub);
  assert.equal((await carrier.call('POST', '/api/push/subscribe', { endpoint: 'not a url', keys: {} })).status, 400);
  await carrier.post('/api/push/unsubscribe', { endpoint: sub.endpoint });
});

test('команда, тариф Pro и роли в компании', async () => {
  const owner = await signIn('+77051110001', { name: 'Олжас Владелец', email: 'o@example.com', companyName: 'Команда Тест', companyForm: 'ТОО', role: 'carrier' });
  assert.equal(owner.me.user.companyRole, 'owner');
  await owner.post('/api/team/invite', { phone: '+7 705 111 00 02', name: 'Айдос', role: 'manager' });
  assert.equal((await owner.call('POST', '/api/team/invite', { phone: '+77051110003' })).status, 402, 'на бесплатном тарифе два места');
  assert.equal((await owner.call('POST', '/api/team/invite', { phone: '+77010000001' })).status, 409, 'номер уже на платформе');

  const mate = await signIn('+77051110002', { name: 'Айдос Сотрудник', email: 'a@example.com' });
  assert.equal(mate.invite.companyName, 'Команда Тест');
  assert.equal(mate.me.company.id, owner.me.company.id);
  assert.equal(mate.me.user.companyRole, 'manager');
  assert.equal(mate.me.user.role, 'carrier');
  const team = await owner.get('/api/team');
  assert.deepEqual([team.members.length, team.invites.length, team.seats], [2, 0, 2]);
  assert.equal((await mate.call('POST', '/api/team/invite', { phone: '+77051110009' })).status, 403, 'приглашает только владелец');
  assert.equal((await mate.call('POST', '/api/plan/buy')).status, 403);

  // сотрудник размещает объявление от имени компании, владелец им управляет
  const l = await mate.post('/api/listings', { kind: 'truck', points: ['astana', 'almaty'], brand: 'MAN', dateFrom: day(0), dateTo: day(3) });
  assert.equal((await owner.get('/api/listings/mine?kind=truck'))[0].id, l.id);

  // тариф
  assert.equal((await owner.call('POST', '/api/plan/buy')).status, 402);
  await owner.post('/api/balance/topup', { amount: 20000 });
  const pro = await owner.post('/api/plan/buy');
  assert.equal(pro.company.pro, true);
  assert.ok(pro.company.planUntil > new Date().toISOString());
  assert.equal(pro.company.balance, 20000 - 9900);
  await owner.post(`/api/listings/${l.id}/boost`);
  assert.equal((await owner.get('/api/balance')).balance, 20000 - 9900, 'на Pro поднятие в топ бесплатно');
  await owner.post('/api/team/invite', { phone: '+77051110003', role: 'driver' });
  assert.equal((await owner.get('/api/team')).seats, 10);

  // удаление сотрудника: он остаётся на платформе в собственной компании
  const mateId = team.members.find((m) => !m.me).id;
  await owner.del(`/api/team/members/${mateId}`);
  assert.equal(await mate.get('/api/me'), null, 'сессия удалённого сотрудника закрыта');
  const again = await signIn('+77051110002');
  assert.notEqual(again.me.company.id, owner.me.company.id);
  assert.equal((await owner.call('DELETE', `/api/team/members/${owner.me.user.id}`)).status, 400);
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
  assert.equal((await customer.get(`/api/listings/${l.id}`)).status, 'archived');
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
