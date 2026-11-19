// Защита от сбора базы, выдачи себя за площадку и злоупотреблений (docs/security-2026-11-20.md).
// Каждая проверка — дыра, которую легко открыть обратно незаметной правкой.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jolda-test-security-'));
process.env.DEMO_MODE = '1';
delete process.env.OSRM_URL;
delete process.env.FCM_SERVICE_ACCOUNT;
const { createApp } = await import('../server/index.js');
const L = await import('../server/lib.js');
const { q1, run } = await import('../server/db.js');
const { resetContacts } = await import('../server/contacts.js');

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
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, headers: res.headers, data: await res.json().catch(() => null) };
  };
  const ok = async (method, url, body) => {
    const r = await call(method, url, body);
    assert.ok(r.status < 300, `${method} ${url} → ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  };
  return { call, get: (u) => ok('GET', u), post: (u, b = {}) => ok('POST', u, b) };
}
async function signIn(phone, reg) {
  const c = client();
  const { devCode } = await c.post('/api/auth/request-code', { phone });
  const v = await c.post('/api/auth/verify', { phone, code: devCode });
  const me = v.registered ? v : await c.post('/api/auth/register', { regToken: v.regToken, accept: true, ...reg });
  return Object.assign(c, { me });
}
const day = (n) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
const cargo = (to, extra = {}) => ({ kind: 'cargo', points: ['almaty', to], bodyType: 'tent', cargoType: 'food', weight: 10, dateFrom: day(0), dateTo: day(3), rate: 300000, ...extra });

test('телефон и точный адрес — только в открытой карточке; открытий в сутки не больше предела', async () => {
  const owner = await signIn('+77071110001', { name: 'Айдар Владелец', companyName: 'Груз Сервис', companyForm: 'ТОО', role: 'customer' });
  const reader = await signIn('+77071110002', { name: 'Сборщик Базы', companyName: 'Читатель', companyForm: 'ТОО', role: 'carrier' });
  const ids = [];
  for (const to of ['astana', 'shymkent', 'aktobe', 'karaganda'])
    ids.push((await owner.post('/api/listings', cargo(to, { loadAddress: 'ул. Складская, 5', unloadAddress: 'пр. Абая, 1' }))).id);

  // список: ни телефонов, ни адресов — сколько бы объявлений в нём ни было
  const list = (await reader.get('/api/listings?kind=cargo')).items.filter((l) => ids.includes(l.id));
  assert.equal(list.length, 4);
  for (const l of list) assert.deepEqual([l.user.phone, l.loadAddress, l.unloadAddress, l.user.hasPhone], [null, '', '', true]);
  assert.ok(!JSON.stringify(list).includes('77071110001'), 'номера нет нигде в ответе');

  // карточка: контакты есть, пока не исчерпан суточный предел
  const [before1, before2] = [L.LIMITS.contactsNew, L.LIMITS.contactsTrusted];
  L.LIMITS.contactsNew = 2;
  resetContacts();
  try {
    const first = await reader.get(`/api/listings/${ids[0]}`);
    assert.deepEqual([first.user.phone, first.loadAddress, first.contactLimit], ['+77071110001', 'ул. Складская, 5', false]);
    assert.equal((await reader.get(`/api/listings/${ids[0]}`)).user.phone, '+77071110001', 'повторное открытие той же карточки в счёт не идёт');
    assert.equal((await reader.get(`/api/listings/${ids[1]}`)).user.phone, '+77071110001');
    const over = await reader.get(`/api/listings/${ids[2]}`);
    assert.deepEqual([over.user.phone, over.loadAddress, over.contactLimit], [null, '', true], 'сверх предела карточка открывается без контактов');
    assert.equal((await reader.get(`/api/listings/${ids[0]}`)).user.phone, '+77071110001', 'уже открытые сегодня остаются открытыми');
    // страница компании считается тем же счётом
    const company = await reader.get(`/api/companies/${owner.me.company.id}`);
    assert.equal(company.contactLimit, true);
    assert.ok(!JSON.stringify(company).includes('77071110001'));
    // модераторы узнают, что компания упёрлась в предел
    assert.ok(q1(`SELECT 1 FROM notifications WHERE title = 'Компания открыла слишком много контактов'`) || !q1('SELECT 1 FROM users WHERE is_admin = 1'));
    // на объявление, по которому компания откликнулась, предел не действует: с партнёром по сделке связь нужна всегда
    await reader.post(`/api/listings/${ids[3]}/responses`, { message: 'Готов везти' });
    assert.equal((await reader.get(`/api/listings/${ids[3]}`)).user.phone, '+77071110001');
  } finally {
    [L.LIMITS.contactsNew, L.LIMITS.contactsTrusted] = [before1, before2];
    resetContacts();
  }

  // закрытое объявление контактов постороннему не отдаёт
  await owner.post(`/api/listings/${ids[1]}/status`, { status: 'closed' });
  const closed = await reader.call('GET', `/api/listings/${ids[1]}`);
  assert.ok(closed.status === 404 || closed.data.user.phone === null, 'закрытое объявление — без телефона');
  // владелец свои контакты видит всегда
  assert.equal((await owner.get(`/api/listings/${ids[1]}`)).loadAddress, 'ул. Складская, 5');
});

test('имя и название: нельзя выдать себя за площадку и передать разметку страницы', async () => {
  const c = client();
  const { devCode } = await c.post('/api/auth/request-code', { phone: '+77071110010' });
  const { regToken } = await c.post('/api/auth/verify', { phone: '+77071110010', code: devCode });
  const reg = (extra) => c.call('POST', '/api/auth/register', { regToken, accept: true, name: 'Обычное Имя', companyName: 'Обычная Компания', companyForm: 'ТОО', role: 'carrier', ...extra });
  for (const bad of [{ name: 'Поддержка Timma' }, { companyName: 'Timma Модерация' }, { name: 'Служба безопасности' }, { companyName: 'Проверено ✅ Логистик' },
    { companyName: '<img src=x onerror=alert(1)>' }, { name: 'Support Тимма' }, { companyName: 'Official Verified' }]) {
    const r = await reg(bad);
    assert.equal(r.status, 400, `${JSON.stringify(bad)} → ${r.status}`);
  }
  const fine = await reg({ name: 'Нұрлан Әбдіғали', companyName: '«Жол-Транс» & Ко №1 (Алматы)' });
  assert.equal(fine.status, 200, JSON.stringify(fine.data));
  // и сменить имя на такое после регистрации нельзя
  assert.equal((await c.call('PATCH', '/api/me', { name: 'Модератор' })).status, 400);
});

test('чат: под чужим сообщением с типовой уловкой — предупреждение; пожаловаться можно прямо из переписки', async () => {
  const owner = await signIn('+77071110021', { name: 'Заказчик Честный', companyName: 'Честный Груз', companyForm: 'ТОО', role: 'customer' });
  const scammer = await signIn('+77071110022', { name: 'Ловкий Перевозчик', companyName: 'Быстрые Колёса', companyForm: 'ТОО', role: 'carrier' });
  const l = await owner.post('/api/listings', cargo('taraz'));
  const { chatId } = await scammer.post(`/api/listings/${l.id}/responses`, { message: 'Здравствуйте' });
  for (const text of ['Переведите предоплату на карту 4400 4301 1234 5678', 'Продиктуйте код из SMS, это для проверки', 'Когда погрузка?'])
    await scammer.post(`/api/chats/${chatId}/messages`, { text });
  const seen = (await owner.get(`/api/chats/${chatId}/messages`)).filter((m) => !m.mine).slice(-3).map((m) => m.warn);
  assert.deepEqual(seen, [true, true, false]);
  assert.ok((await scammer.get(`/api/chats/${chatId}/messages`)).every((m) => !m.warn), 'автор своих предупреждений не видит');
  await owner.post('/api/complaints', { companyId: scammer.me.company.id, reason: 'fraud', text: 'Просит перевод на карту' });
});

test('предел активных объявлений возвратом из архива не обойти', async () => {
  const owner = await signIn('+77071110031', { name: 'Много Объявлений', companyName: 'Весь Поиск', companyForm: 'ТОО', role: 'customer' });
  const cap = L.LIMITS.activeFree;
  L.LIMITS.activeFree = 2;
  try {
    const a = await owner.post('/api/listings', cargo('astana'));
    await owner.post('/api/listings', cargo('shymkent'));
    await owner.post(`/api/listings/${a.id}/status`, { status: 'archived' });
    await owner.post('/api/listings', cargo('aktobe'));
    const back = await owner.call('POST', `/api/listings/${a.id}/status`, { status: 'active' });
    assert.deepEqual([back.status, back.data.error], [429, 'limit']);
  } finally {
    L.LIMITS.activeFree = cap;
  }
});

test('вход: код не из шести цифр — обычная ошибка; о входе с нового устройства человек узнаёт', async () => {
  const first = await signIn('+77071110041', { name: 'Хозяин Аккаунта', companyName: 'Свой Аккаунт', companyForm: 'ИП', role: 'carrier' });
  const c = client();
  await c.post('/api/auth/request-code', { phone: '+77071110041' });
  for (const code of ['abcdef', { $gt: '' }, '12345678901234567890', ['1']])
    assert.equal((await c.call('POST', '/api/auth/verify', { phone: '+77071110041', code })).status, 400, `код ${JSON.stringify(code)}`);
  // второй вход — с другого устройства: на первом появляется уведомление
  await signIn('+77071110041');
  const n = q1(`SELECT link FROM notifications WHERE user_id = ? AND title = 'Новый вход в аккаунт'`, first.me.user.id);
  assert.equal(n?.link, '/cabinet/settings');
});

test('команда: ответ на приглашение не раскрывает, зарегистрирован ли номер; владелец получает уведомление', async () => {
  const owner = await signIn('+77071110051', { name: 'Владелец Команды', companyName: 'Команда Плюс', companyForm: 'ТОО', role: 'carrier' });
  await signIn('+77071110052', { name: 'Уже Есть', companyName: 'Чужая Компания', companyForm: 'ТОО', role: 'carrier' });
  await owner.post('/api/balance/topup', { amount: 20000 });
  await owner.post('/api/plan/buy'); // на Pro мест в команде хватает на несколько приглашений
  const known = await owner.post('/api/team/invite', { phone: '+77071110052' });
  const unknown = await owner.post('/api/team/invite', { phone: '+77071110053' });
  assert.deepEqual([Object.keys(known), Object.keys(unknown)], [['id'], ['id']]);
  assert.equal(q1(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND title = 'В команду приглашён новый человек'`, owner.me.user.id).n, 2);
  assert.equal((await owner.call('POST', '/api/team/invite', { phone: '+77071110054', name: 'Поддержка Timma' })).status, 400);
});

test('без входа: большой запрос не разбирается, списки и карточки закрыты, поисковикам сказано не ходить в личные разделы', async () => {
  const c = client();
  const big = await c.call('POST', '/api/documents', { name: 'x'.repeat(2 * 1024 * 1024) });
  assert.equal(big.status, 401, 'тело запроса на 2 МБ без входа отклоняется до разбора');
  for (const url of ['/api/listings', '/api/listings/1', '/api/companies', '/api/companies/1', '/api/relocators', '/api/services', '/api/stats/prices', '/api/jobs'])
    assert.equal((await c.call('GET', url)).status, 401, url);
  const robots = await (await fetch(base + '/robots.txt')).text();
  for (const line of ['Disallow: /api/', 'Disallow: /cabinet', 'Disallow: /t/', 'Disallow: /d/']) assert.ok(robots.includes(line), line);
});

test('огромный список в запросе отклоняется сразу', async () => {
  const owner = await signIn('+77071110061', { name: 'Длинный Список', companyName: 'Длинный Маршрут', companyForm: 'ТОО', role: 'customer' });
  const r = await owner.call('POST', '/api/listings', cargo('astana', { points: Array.from({ length: 5000 }, () => 'almaty') }));
  assert.equal(r.status, 400);
});

test('счётчик просмотров услуги: один человек — один просмотр в сутки', async () => {
  const seller = await signIn('+77071110071', { name: 'Мастер Сервис', companyName: 'Шиномонтаж 24', companyForm: 'ИП', role: 'carrier' });
  const viewer = await signIn('+77071110072', { name: 'Зритель Услуг', companyName: 'Зритель', companyForm: 'ИП', role: 'carrier' });
  const company = seller.me.company.id;
  run(`INSERT INTO services(company_id, user_id, category, title, cities, all_country, description, phone, paid_until)
       VALUES(?, ?, ?, 'Шиномонтаж', '[]', 1, '', '+77071110071', ?)`, company, seller.me.user.id, L.SERVICE_CATEGORIES[0], new Date(Date.now() + 86400_000).toISOString());
  const id = q1('SELECT id FROM services WHERE company_id = ?', company).id;
  for (let i = 0; i < 5; i++) await viewer.post(`/api/services/${id}/view`);
  assert.equal(q1('SELECT views FROM services WHERE id = ?', id).views, 1);
});

test('связка номера с Telegram, которой полгода не пользовались, снимается', async () => {
  const { housekeeping } = await import('../server/index.js');
  const old = new Date(Date.now() - 200 * 86400_000).toISOString();
  run(`INSERT INTO tg_links(phone, chat_id, created_at) VALUES('+77071110081', 1, ?), ('+77071110082', 2, ?), ('+77071110083', 3, ?)`, old, old, L.now());
  run(`UPDATE tg_links SET used_at = ? WHERE phone = '+77071110082'`, L.now());
  housekeeping();
  assert.deepEqual(['+77071110081', '+77071110082', '+77071110083'].map((p) => !!q1('SELECT 1 FROM tg_links WHERE phone = ?', p)), [false, true, true]);
});

test('PDF из чата скачивается файлом, а не открывается как страница площадки; фото показывается на месте', async () => {
  const owner = await signIn('+77071110091', { name: 'Заказчик Файлов', companyName: 'Файл Груз', companyForm: 'ТОО', role: 'customer' });
  const carrier = await signIn('+77071110092', { name: 'Перевозчик Файлов', companyName: 'Файл Транс', companyForm: 'ТОО', role: 'carrier' });
  const l = await owner.post('/api/listings', cargo('kostanay'));
  const { chatId } = await carrier.post(`/api/listings/${l.id}/responses`, { message: 'Здравствуйте' });
  const pdf = await carrier.post(`/api/chats/${chatId}/files`, { filename: 'Счёт на предоплату.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4 invoice').toString('base64') });
  const got = await owner.call('GET', `/api/files/${pdf.fileId}`);
  assert.equal(got.status, 200);
  assert.match(got.headers.get('content-disposition'), /^attachment;/);
  assert.equal(got.headers.get('x-content-type-options'), 'nosniff');
});

test('раздел «Работа»: не больше трёх новых объявлений в сутки; заблокированная компания не размещает', async () => {
  const hr = await signIn('+77071110101', { name: 'Кадровик Компании', companyName: 'Кадры Транс', companyForm: 'ТОО', role: 'carrier' });
  const job = (n) => hr.call('POST', '/api/jobs', { kind: 'vacancy', title: `Водитель категории CE, рейс ${n}`, cityId: 'almaty', description: 'Межгород, новая машина' });
  for (let i = 0; i < 3; i++) assert.equal((await job(i)).status, 200);
  const over = await job(4);
  assert.deepEqual([over.status, over.data.error], [429, 'limit']);
  run('UPDATE companies SET banned = 1 WHERE id = ?', hr.me.company.id);
  assert.equal((await job(5)).status, 403);
});
