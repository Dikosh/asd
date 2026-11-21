// Удаление аккаунта: человек уходит, его данные стираются, а история рейсов и переписка у партнёров остаются.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jolda-test-acc-'));
process.env.DEMO_MODE = '1';
delete process.env.OSRM_URL;
delete process.env.FCM_SERVICE_ACCOUNT;
const { createApp } = await import('../server/index.js');
const { seed } = await import('../server/seed.js');
const { q, q1 } = await import('../server/db.js');

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
  return { call, get: (u) => ok('GET', u), post: (u, b = {}) => ok('POST', u, b), del: (u) => ok('DELETE', u) };
}
async function signIn(phone, extra) {
  const c = client();
  const { devCode } = await c.post('/api/auth/request-code', { phone });
  const v = await c.post('/api/auth/verify', { phone, code: devCode });
  if (v.registered) return Object.assign(c, { me: v });
  c.me = await c.post('/api/auth/register', { regToken: v.regToken, accept: true, ...extra });
  return c;
}
const day = (n) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
const cargo = (points = ['shymkent', 'almaty']) => ({ kind: 'cargo', points, weight: 10, dateFrom: day(0), dateTo: day(3) });

test('удаление аккаунта: рейс держит, после удаления — данные стёрты, история у партнёра осталась, номер свободен', async () => {
  const customer = await signIn('+77061400001', { name: 'Асан Удаляев', email: 'asan@example.com', companyName: 'Уход Груз', companyForm: 'ТОО', role: 'customer' });
  const carrier = await signIn('+77061400002', { name: 'Перевозчик', companyName: 'Остаюсь Транс', companyForm: 'ТОО', role: 'carrier' });
  const { id: listingId } = await customer.post('/api/listings', cargo());
  const r = await carrier.post(`/api/listings/${listingId}/responses`, { message: 'Беру' });
  const { tripId } = await customer.post(`/api/responses/${r.id}/accept`);
  const { id: other } = await customer.post('/api/listings', cargo(['astana', 'karaganda']));

  const busy = await customer.call('DELETE', '/api/me');
  assert.equal(busy.status, 409, 'пока идёт рейс, аккаунт не удаляется');
  assert.match(JSON.stringify(busy.data), new RegExp(`№${tripId}`));

  await customer.post(`/api/trips/${tripId}/cancel`);
  const uid = customer.me.user.id;
  await customer.del('/api/me');
  assert.equal(await customer.get('/api/me'), null, 'вход закрыт');

  const u = q1('SELECT * FROM users WHERE id = ?', uid);
  assert.equal(u.name, 'Аккаунт удалён');
  assert.equal(u.email, '');
  assert.notEqual(u.phone, '+77061400001');
  for (const t of ['sessions', 'notifications', 'searches', 'push_devices']) assert.equal(q(`SELECT 1 FROM ${t} WHERE user_id = ?`, uid).length, 0, t);
  assert.equal(q('SELECT 1 FROM login_codes WHERE phone = ?', '+77061400001').length, 0);
  assert.equal(q1('SELECT status FROM listings WHERE id = ?', other).status, 'archived', 'объявления ушли в архив');

  // у перевозчика рейс остался, но без телефона и имени человека
  const trip = await carrier.get(`/api/trips/${tripId}`);
  assert.equal(trip.status, 'cancelled');
  assert.ok(!JSON.stringify(trip).includes('+77061400001'), 'номера удалённого человека нет');
  assert.ok(!JSON.stringify(trip).includes('Асан'), 'имени удалённого человека нет');

  // с того же номера можно зарегистрироваться заново — это новый аккаунт
  const again = await signIn('+77061400001', { name: 'Асан Новый', companyName: 'Новая Компания', companyForm: 'ТОО', role: 'customer' });
  assert.notEqual(again.me.user.id, uid);
});

test('удаление аккаунта: владелец с командой — сначала команда; сотрудник уходит, объявления остаются у компании', async () => {
  const owner = await signIn('+77061400011', { name: 'Владелец Команды', companyName: 'Команда Уход', companyForm: 'ТОО', role: 'customer' });
  await owner.post('/api/team/invite', { phone: '+77061400012', role: 'manager' });
  const mate = await signIn('+77061400012', { name: 'Сотрудник Уходящий', joinInvite: true });
  assert.equal(mate.me.company.id, owner.me.company.id);
  const { id: listingId } = await mate.post('/api/listings', cargo());

  assert.equal((await owner.call('DELETE', '/api/me')).status, 409, 'владельца с сотрудниками не удалить');
  await mate.del('/api/me');
  assert.equal(q1('SELECT user_id, status FROM listings WHERE id = ?', listingId).user_id, owner.me.user.id, 'объявление перешло владельцу');
  assert.equal(q1('SELECT status FROM listings WHERE id = ?', listingId).status, 'active');
  const team = await owner.get('/api/team');
  assert.equal(team.members.length, 1, 'в команде остался только владелец');

  // демо-аккаунты общие для всех посетителей стенда — их удалить нельзя
  const d = client();
  await d.post('/api/auth/demo', { role: 'carrier' });
  assert.equal((await d.call('DELETE', '/api/me')).status, 403);
});
