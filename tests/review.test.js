// Вход проверяющего из магазина приложений: постоянный код на два номера из REVIEW_LOGIN. Сервер — БЕЗ демо-режима
// и без SMS: обычный номер войти не может, проверяющий — может.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [A, B] = ['+77079990001', '+77079990002'];
const [CODE_A, CODE_B] = ['481516', '729304'];
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jolda-test-review-'));
process.env.REVIEW_LOGIN = `${A}:${CODE_A}, 8 707 999 00 02:${CODE_B}`;
for (const k of ['DEMO_MODE', 'SMS_WEBHOOK_URL', 'TELEGRAM_BOT_TOKEN', 'ADMIN_PHONE', 'OSRM_URL', 'FCM_SERVICE_ACCOUNT']) delete process.env[k];
const { createApp } = await import('../server/index.js');
const { REVIEW, SAMPLE_NOTE, closeReview, parseReview } = await import('../server/review.js');
const { q, q1, run, insert } = await import('../server/db.js');

let server;
let base;
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { Date.now = realNow; server.close(); });

function client() {
  const jar = new Map();
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of res.headers.getSetCookie()) {
      const [k, v] = line.split(';')[0].split('=');
      if (/Max-Age=0/.test(line)) jar.delete(k);
      else jar.set(k, v);
    }
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}
async function signIn(phone, code) {
  const c = client();
  assert.deepEqual((await c('POST', '/api/auth/request-code', { phone })).data, { ok: true }, 'кода в ответе нет');
  return { c, r: await c('POST', '/api/auth/verify', { phone, code }) };
}
// предел «пять кодов за десять минут» действует и на проверяющего; между тестами часы переводятся вперёд
const realNow = Date.now;
let shift = 0;
Date.now = () => realNow() + shift;
beforeEach(() => { shift += 11 * 60_000; });
const reviewTrips = () => q(`SELECT * FROM trips WHERE status = 'active'`);

test('проверяющий входит по постоянному коду, а обычный номер без SMS — нет', async () => {
  assert.equal((await client()('POST', '/api/auth/request-code', { phone: '+77012223344' })).status, 503);
  const { c, r } = await signIn(A, CODE_A);
  assert.equal(r.status, 200);
  assert.equal(r.data.registered, true);
  assert.equal(r.data.user.role, 'carrier');
  assert.equal(r.data.user.isAdmin, false);
  const { r: r2 } = await signIn(B, CODE_B);
  assert.equal(r2.data.user.role, 'customer');

  // рейс уже ждёт: GPS включается, выезд отмечается
  const [trip] = reviewTrips();
  assert.equal(reviewTrips().length, 1, 'второй вход второго рейса не создаёт');
  assert.equal((await c('GET', `/api/trips/${trip.id}`)).status, 200);
  assert.equal((await c('POST', `/api/trips/${trip.id}/gps`, { share: true })).status, 200);
  assert.equal((await c('POST', `/api/trips/${trip.id}/position`, { lat: 37.33, lon: -122.03 })).status, 200);
  assert.equal((await c('POST', `/api/trips/${trip.id}/stage`, { stage: 'to_loading' })).status, 200);
  const chats = (await c('GET', '/api/chats')).data;
  assert.equal(chats.length, 1);
  assert.equal(chats[0].peerPhone, null, 'номер проверяющего скрыт');
});

test('код чужого номера, неверный код и код без запроса не подходят; в базе постоянного кода нет', async () => {
  assert.equal((await signIn(A, CODE_B)).r.data.error, 'code_wrong');
  assert.equal((await client()('POST', '/api/auth/verify', { phone: A, code: CODE_A })).data.error, 'code_expired');
  const c = client();
  await c('POST', '/api/auth/request-code', { phone: A });
  for (let i = 0; i < 5; i++) assert.equal((await c('POST', '/api/auth/verify', { phone: A, code: '000000' })).data.error, 'code_wrong');
  assert.equal((await c('POST', '/api/auth/verify', { phone: A, code: CODE_A })).status, 429);
  assert.equal(q1('SELECT 1 FROM login_codes WHERE code IN (?, ?)', CODE_A, CODE_B), undefined);
});

test('настоящие люди тестовых данных не видят', async () => {
  const company = insert(`INSERT INTO companies(name, form) VALUES('Настоящая', 'ТОО')`);
  const user = insert(`INSERT INTO users(name, phone, email, role, company_id, accepted_terms) VALUES('Настоящий', '+77059990001', '', 'customer', ?, '2026-01-01')`, company);
  run(`INSERT INTO sessions(token, user_id) VALUES('real-sid', ?)`, user);
  const get = async (u) => (await fetch(base + u, { headers: { Cookie: 'sid=real-sid' } })).json();
  assert.ok(!JSON.stringify(await get('/api/companies')).includes('Review'));
  assert.deepEqual(await get('/api/public/listings'), []);
});

test('примеры объявлений видят только проверяющие: ищут, открывают и откликаются', async () => {
  const { c: carrier } = await signIn(A, CODE_A);
  const { c: customer } = await signIn(B, CODE_B);
  const cargo = (await carrier('GET', '/api/listings?kind=cargo')).data;
  const truck = (await customer('GET', '/api/listings?kind=truck')).data;
  assert.equal(cargo.total, 8);
  assert.equal(truck.total, 6);
  assert.equal((await carrier('GET', '/api/listings?kind=relocation')).data.total, 1);
  for (const l of [...cargo.items, ...truck.items]) assert.ok(l.description.startsWith(SAMPLE_NOTE), 'у каждого примера пометка');
  const id = cargo.items[0].id;
  assert.equal((await carrier('GET', `/api/listings/${id}`)).status, 200);
  assert.equal((await carrier('POST', `/api/listings/${id}/responses`, { message: 'test' })).status, 200);
  assert.equal((await customer('GET', `/api/listings/${id}`)).data.responses.length, 1);

  // повторный вход не размножает примеры, а истёкшие и закрытые возвращает
  run(`UPDATE listings SET status = 'closed', date_to = '2026-01-01' WHERE id = ?`, id);
  await signIn(A, CODE_A);
  assert.equal((await carrier('GET', '/api/listings?kind=cargo')).data.total, 8);

  // настоящий человек с подпиской на все грузы и правами перегонщика
  const company = insert(`INSERT INTO companies(name, form, verified) VALUES('Живая', 'ТОО', 'verified')`);
  const user = insert(`INSERT INTO users(name, phone, email, role, company_id, accepted_terms, relocator, licenses, relocator_city) VALUES('Живой', '+77059990077', '', 'logist', ?, '2026-01-01', 1, '["B"]', 'almaty')`, company);
  run(`INSERT INTO sessions(token, user_id) VALUES('live-sid', ?)`, user);
  run(`INSERT INTO searches(user_id, kind, name, params, notify) VALUES(?, 'cargo', 'все', '{}', 1)`, user);
  const http = (method, u, body) => fetch(base + u, { method, headers: { Cookie: 'sid=live-sid', 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const get = async (u) => (await http('GET', u)).json();
  for (const kind of ['cargo', 'truck', 'relocation']) assert.equal((await get(`/api/listings?kind=${kind}`)).total, 0);
  assert.ok((await get('/api/recommendations')).every((r) => !r.items.length));
  assert.deepEqual(await get('/api/public/listings'), []);
  const { stats } = await get('/api/meta');
  assert.deepEqual([stats.cargo, stats.truck, stats.relocation], [0, 0, 0]);
  assert.equal((await http('GET', `/api/listings/${id}`)).status, 404);
  assert.equal((await http('POST', `/api/listings/${id}/responses`, { message: 'x' })).status, 404);
  assert.equal((await http('POST', `/api/listings/${id}/mark`, { marked: true })).status, 404);
  const owner = q1('SELECT company_id FROM listings WHERE id = ?', id).company_id;
  assert.deepEqual((await get(`/api/companies/${owner}`)).listings, []);
  assert.ok(!JSON.stringify(await get('/api/stats/prices?kind=cargo')).includes('almaty'));

  // объявление, которое проверяющий разместит сам, настоящим людям тоже не видно и не рассылается
  const today = new Date(Date.now()).toISOString().slice(0, 10);
  const mine = await customer('POST', '/api/listings', { kind: 'cargo', points: ['almaty', 'taraz'], bodyType: 'tent', cargoType: 'food', weight: 5, dateFrom: today, dateTo: today });
  assert.equal(mine.status, 200, JSON.stringify(mine.data));
  assert.equal((await carrier('GET', '/api/listings?kind=cargo')).data.total, 9);
  assert.equal((await get('/api/listings?kind=cargo')).total, 0);
  assert.equal(q1('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?', user).n, 0);

  // а настоящее объявление проверяющий видит вместе со всеми
  insert(`INSERT INTO listings(kind, user_id, company_id, points, from_id, to_id, date_from, date_to) VALUES('cargo', ?, ?, '["almaty","astana"]', 'almaty', 'astana', ?, ?)`, user, company, today, today);
  assert.equal((await get('/api/listings?kind=cargo')).total, 1);
  assert.equal((await carrier('GET', '/api/listings?kind=cargo')).data.total, 10);
});

test('удаление аккаунта работает несмотря на активный рейс, а следующий вход создаёт всё заново', async () => {
  const { c } = await signIn(B, CODE_B);
  const del = await c('DELETE', '/api/me', {});
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.equal(reviewTrips().length, 0);
  const { r } = await signIn(B, CODE_B);
  assert.equal(r.data.registered, true);
  assert.equal(reviewTrips().length, 1);
});

test('сорванный рейс не запирает аккаунт требованием отзыва', async () => {
  const { c } = await signIn(A, CODE_A);
  const [trip] = reviewTrips();
  run(`UPDATE trips SET status = 'failed', finished_at = '2026-01-01T00:00:00.000Z' WHERE id = ?`, trip.id);
  await signIn(A, CODE_A);
  assert.equal(reviewTrips().length, 1);
  assert.notEqual(reviewTrips()[0].id, trip.id);
  assert.deepEqual((await c('GET', '/api/me')).data.pendingReviews ?? [], []);
});

test('настоящий аккаунт постоянным кодом не открыть, приглашённый в чужую компанию его теряет', async () => {
  run('UPDATE users SET is_review = 0 WHERE phone = ?', A);
  assert.equal((await client()('POST', '/api/auth/request-code', { phone: A })).status, 503, 'обычный путь через SMS');
  run(`UPDATE users SET is_review = 1, company_role = 'manager' WHERE phone = ?`, A);
  assert.equal((await client()('POST', '/api/auth/request-code', { phone: A })).status, 503);
  run(`UPDATE users SET company_role = 'owner' WHERE phone = ?`, A);
});

test('номер убрали из настроек — вход закрыт', async () => {
  const { c } = await signIn(A, CODE_A);
  const code = REVIEW.get(A);
  REVIEW.delete(A);
  closeReview();
  assert.equal((await c('GET', '/api/me')).data, null);
  assert.equal((await client()('POST', '/api/auth/request-code', { phone: A })).status, 503);
  REVIEW.set(A, code);
});

test('ошибки в REVIEW_LOGIN видны при запуске, кода в них нет', () => {
  assert.equal(parseReview('').size, 0);
  for (const bad of [`${A}:481516`, `${A}:481516,${A}:729304`, `${A}:123456,${B}:729304`, `${A}:111111,${B}:729304`, `${A}:48151,${B}:729304`, `12:481516,${B}:729304`, A])
    assert.throws(() => parseReview(bad), (e) => /REVIEW_LOGIN/.test(e.message) && !/481516|729304|123456/.test(e.message), bad);
  const entry = fileURLToPath(new URL('../server/index.js', import.meta.url));
  const r = spawnSync(process.execPath, [entry], { env: { ...process.env, ADMIN_PHONE: A, PORT: '0', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'jolda-test-review-adm-')) }, encoding: 'utf8', timeout: 20000 });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /REVIEW_LOGIN.*ADMIN_PHONE/);
});
