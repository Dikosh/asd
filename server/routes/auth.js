// Вход по номеру телефона с одноразовым кодом, регистрация, профиль, события.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { z } from 'zod';
import { q, q1, run, insert, tx, UPLOAD_DIR } from '../db.js';
import { CITIES, cityById, isValidBin } from '../geo.js';
import * as L from '../lib.js';
import { notify } from '../notify.js';
import { sendSms } from '../sms.js';
import { tgBot, tgLink, tgSendCode } from '../telegram.js';

const PLACES_JSON = Buffer.from(JSON.stringify(CITIES.map((c) => [c.id, c.ru, c.kz, c.en, c.country, c.lat, c.lon, c.region, c.zh === c.en ? '' : c.zh])));
const PLACES_GZ = zlib.gzipSync(PLACES_JSON);

const { bad, parse } = L;

// Ограничение частоты запросов — общее для всех разделов, живёт в lib.js.
export const rateLimit = L.rateLimit;

const CODE_TTL = 5 * 60_000; // сколько живёт код из SMS
const TG_WAIT = 15 * 60_000; // сколько ждём, пока человек откроет бота в Telegram и поделится номером
const CODE_TRIES = 5; // неверных вводов на один код — потом нужен новый
const PHONE_DAY = 10; // кодов на номер в сутки: столько с чужих устройств и столько же со «своих»
const IP_DAY = 60; // кодов с одного адреса в сутки с устройств, с которых под этим номером ещё не входили
const SMS_STRANGERS = 0.8; // доля суточного запаса SMS для таких устройств: остаток — тем, кто уже входил
const SMS_DAY = Number(process.env.SMS_DAILY_MAX ?? 300); // SMS с кодами в сутки на всю площадку (0 — без предела): защита от рассылки за наш счёт
// На номера каких стран отправляются SMS: коды стран через запятую, `*` — на любые. По умолчанию — страны из списка
// на экране входа. SMS за границу дороже, и рассылка кодов по чужим странам — прямой способ накрутить расходы.
const SMS_COUNTRIES = (process.env.SMS_COUNTRIES || '').trim() === '*' ? null
  : (process.env.SMS_COUNTRIES || '7,998,996,992,993,86,375,994,995,90').split(/[,;\s]+/).map((c) => c.replace(/\D/g, '')).filter(Boolean);
/** Можно ли отправить SMS на этот номер (страна разрешена). */
export const smsAllowed = (phone, countries = SMS_COUNTRIES) => !countries || countries.some((c) => phone.startsWith('+' + c));
/** Модераторы узнают, что суточный предел SMS исчерпан, — не чаще раза в сутки. */
function smsLimitAlert(now = Date.now()) {
  const last = Number(q1(`SELECT value FROM app_state WHERE key = 'sms:limit'`)?.value || 0);
  if (now - last < 86400_000) return;
  run(`INSERT INTO app_state(key, value) VALUES('sms:limit', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, String(now));
  for (const a of q('SELECT id FROM users WHERE is_admin = 1')) {
    notify(a.id, { kind: 'system', title: 'Суточный предел SMS исчерпан', body: 'За сутки отправлено {n} кодов входа, новые SMS не отправляются. Если это не атака, попросите разработчика увеличить предел.', vars: { n: SMS_DAY }, link: '/cabinet/admin' });
  }
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('base64url');
/** Устройство, с которого под этим номером уже входили: cookie `kd`, в базе — только её отпечаток. */
const knownDevice = (req, phone) => {
  const kd = L.cookie(req, 'kd');
  return !!kd && !!q1('SELECT 1 FROM known_devices WHERE token = ? AND phone = ?', sha(kd), phone);
};
function rememberDevice(req, res, phone) {
  if (knownDevice(req, phone)) return;
  const kd = L.token(32);
  run('INSERT INTO known_devices(token, phone) VALUES(?, ?)', sha(kd), phone);
  run('DELETE FROM known_devices WHERE phone = ? AND token NOT IN (SELECT token FROM known_devices WHERE phone = ? ORDER BY created_at DESC, rowid DESC LIMIT 10)', phone, phone);
  L.setCookie(req, res, 'kd', kd, 31536000, '/api/auth');
}
// Модераторы — номера из ADMIN_PHONE, через запятую. Этот список — единственный источник прав: добавили номер —
// человек становится модератором (сразу, если уже зарегистрирован, иначе при регистрации), убрали — права снимаются
// при следующем запуске сервера. Без ADMIN_PHONE права никому не выдаются и ни у кого не снимаются.
const ADMIN_PHONES = new Set(
  String(process.env.ADMIN_PHONE || '').split(/[,;]+/).map((x) => x.trim()).filter(Boolean).map((x) => {
    try {
      return L.normPhone(x);
    } catch {
      throw new Error(`ADMIN_PHONE: некорректный номер «${x}». Номера указываются через запятую, например +77011234567,+77017654321`);
    }
  }),
);
/** Привести права модераторов к списку ADMIN_PHONE. Демо-аккаунты список не затрагивает. */
export function syncAdmins(phones = ADMIN_PHONES) {
  if (!phones.size) return { granted: 0, revoked: 0 };
  const list = [...phones];
  const marks = list.map(() => '?').join(', ');
  const revoked = run(`UPDATE users SET is_admin = 0 WHERE is_admin = 1 AND is_demo = 0 AND phone NOT IN (${marks})`, ...list).changes;
  const granted = run(`UPDATE users SET is_admin = 1 WHERE is_admin = 0 AND is_demo = 0 AND phone IN (${marks})`, ...list).changes;
  if (revoked || granted) console.log(`Модераторы по ADMIN_PHONE: права выданы — ${granted}, сняты — ${revoked}`);
  return { granted, revoked };
}
const INVITE_DAYS = 14;
const inviteFor = (phone) =>
  q1(
    `SELECT i.id, i.name, i.role, i.company_id, c.name AS companyName, c.form AS companyForm, c.kind FROM invites i JOIN companies c ON c.id = i.company_id
     WHERE i.phone = ? AND i.created_at > ?`,
    phone, new Date(Date.now() - INVITE_DAYS * 86400_000).toISOString(),
  );

export default function authRoutes(app) {
  app.get('/api/meta', (_req, res) => {
    const active = (kind) =>
      q1(`SELECT COUNT(*) AS n FROM listings l JOIN companies c ON c.id = l.company_id WHERE l.kind = ? AND l.status = 'active' AND l.date_to >= ? AND c.banned = 0`, kind, L.today()).n;
    res.json({
      demo: L.DEMO,
      flags: L.FLAGS,
      plan: L.PLAN,
      limits: L.LIMITS,
      places: CITIES.length,
      roles: L.ROLES,
      body: L.BODY,
      cargo: L.CARGO,
      loading: L.LOADING,
      relocVehicles: L.RELOC_VEHICLES,
      licenses: L.LICENSES,
      pay: L.PAY,
      currencies: L.CURRENCIES,
      stages: L.STAGES,
      docKinds: L.DOC_KINDS,
      boostPrice: L.BOOST_PRICE,
      // контакты поддержки задаются при установке; без них остаётся форма обращения
      tiles: L.TILES,
      // какими путями можно получить код входа: SMS (в демо код показывается на экране) и бот в Telegram (его имя)
      login: { sms: L.DEMO || !!process.env.SMS_WEBHOOK_URL, telegram: tgBot() },
      support: { phone: process.env.SUPPORT_PHONE || '', telegram: process.env.TELEGRAM_URL || '', hours: process.env.SUPPORT_HOURS || '' },
      stats: {
        cargo: active('cargo'),
        truck: active('truck'),
        relocation: active('relocation'),
        companies: q1('SELECT COUNT(*) AS n FROM companies WHERE banned = 0').n,
        trips: q1(`SELECT COUNT(*) AS n FROM trips WHERE status = 'completed'`).n,
        shippers: q1('SELECT COUNT(*) AS n FROM shippers WHERE visible = 1').n,
      },
    });
  });

  app.get('/api/places', (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      res.setHeader('Content-Encoding', 'gzip');
      return res.end(PLACES_GZ);
    }
    res.end(PLACES_JSON);
  });

  // Витрина для гостей: свежие объявления без контактов и названий компаний. Контакты — после входа.
  app.get('/api/public/listings', (req, res) => {
    rateLimit('pub:' + L.ip(req), 60, 60_000);
    const rows = q(
      `SELECT l.id, l.kind, l.points, l.body_type, l.cargo_type, l.weight, l.volume, l.date_from, l.date_to, l.rate, l.currency, l.distance_km
       FROM listings l JOIN companies c ON c.id = l.company_id
       WHERE l.status = 'active' AND l.date_to >= ? AND c.banned = 0
         AND ${L.BOOKED('l')} < l.trucks
       ORDER BY l.id DESC LIMIT 12`,
      L.today(),
    );
    res.json(rows.map((r) => ({
      id: r.id, kind: r.kind, points: L.j(r.points, []).filter((p) => cityById.has(p)), bodyType: r.body_type, cargoType: r.cargo_type, weight: r.weight, volume: r.volume,
      dateFrom: r.date_from, dateTo: r.date_to, rate: r.rate, currency: r.currency, distanceKm: r.distance_km,
    })));
  });

  app.post('/api/auth/request-code', async (req, res) => {
    const phone = L.normPhone(req.body?.phone);
    // «своё» устройство — то, с которого под этим номером уже входили. У него отдельный счёт кодов: посторонний,
    // который засыпает номер запросами, исчерпает только общий счёт и не оставит владельца без входа
    const known = knownDevice(req, phone) ? 1 : 0;
    // код можно получить в Telegram вместо SMS, если бот подключён (server/telegram.js)
    const viaTelegram = req.body?.via === 'telegram';
    if (viaTelegram && !tgBot()) throw bad('telegram_off', 'Вход через Telegram не подключён', 503);
    rateLimit(`code:${known}:${phone}`, 5, 10 * 60_000);
    rateLimit('ip:' + L.ip(req), 100, 10 * 60_000); // за одним адресом мобильного оператора — много людей
    // учётные записи из демо-данных вне демо-режима не действуют
    if (!L.DEMO && q1('SELECT 1 FROM users WHERE phone = ? AND is_demo = 1', phone)) throw bad('forbidden', 'Этот номер недоступен', 403);
    // суточные пределы — про настоящие SMS: в демо-режиме код показывается на экране и ничего не стоит
    if (!L.DEMO) {
      const sent = (where, ...args) => q1(`SELECT COUNT(*) AS n FROM login_codes WHERE ${where} AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')`, ...args).n;
      // предел на адрес — только для «чужих» устройств: за одним адресом оператора много людей, а свои уже подтверждены
      if (sent('phone = ? AND known = ?', phone, known) >= PHONE_DAY || (!known && sent('ip = ? AND known = 0', L.ip(req)) >= IP_DAY)) throw bad('rate_limit', 'Слишком много запросов кода за сутки. Попробуйте завтра', 429);
      // общий предел площадки — про деньги: коды через Telegram бесплатны и в него не входят
      // один адрес не должен израсходовать запас всей площадки: с незнакомых устройств — не больше его части
      if (!viaTelegram && SMS_DAY && sent(`channel = 'sms'`) >= (known ? SMS_DAY : Math.ceil(SMS_DAY * SMS_STRANGERS))) {
        console.error(`[sms] за сутки отправлено ${SMS_DAY} кодов входа — отправка приостановлена (предел SMS_DAILY_MAX)`);
        smsLimitAlert();
        if (tgBot()) throw bad('sms_limit', 'Отправка SMS временно приостановлена. Получите код в Telegram', 503);
        throw bad('sms_limit', 'Отправка кодов временно приостановлена. Попробуйте позже', 503);
      }
      if (!viaTelegram && !smsAllowed(phone)) {
        if (tgBot()) throw bad('sms_country', 'На номера этой страны код по SMS не отправляется. Получите код в Telegram', 400);
        throw bad('sms_country', 'На номера этой страны код по SMS не отправляется', 400);
      }
    }
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    // новый код не отменяет прежние: чужой запрос на тот же номер не обесценивает код, который человек уже получил
    const ticket = L.token(32);
    if (viaTelegram) {
      const link = tgLink(phone);
      // номер уже привязан к чату — код уходит сразу; человек удалил бота — привязываем заново по ссылке
      if (link) {
        run(`INSERT INTO login_codes(ticket, phone, code, expires, ip, known, channel) VALUES(?, ?, ?, ?, ?, ?, 'tg')`, ticket, phone, code, Date.now() + CODE_TTL, L.ip(req), known);
        const sent = await tgSendCode(link, code);
        if (sent === 'error') {
          run('DELETE FROM login_codes WHERE ticket = ?', ticket);
          throw bad('telegram_failed', 'Не удалось отправить код в Telegram, попробуйте позже', 502);
        }
        if (sent === 'ok') {
          L.setCookie(req, res, 'otp', ticket, 1800, '/api/auth');
          // sent — код уже в чате; ссылка ведёт прямо в чат с ботом, чтобы человек не искал его сам
          return res.json({ ok: true, via: 'telegram', sent: true, telegramUrl: `https://t.me/${tgBot()}` });
        }
        run('DELETE FROM login_codes WHERE ticket = ?', ticket);
      }
      // номер ещё не привязан: человек открывает бота по ссылке и делится номером — тогда бот пришлёт этот код
      const start = L.token(24);
      run(`INSERT INTO login_codes(ticket, phone, code, expires, ip, known, channel, tg_start) VALUES(?, ?, ?, ?, ?, ?, 'tg', ?)`,
        ticket, phone, code, Date.now() + TG_WAIT, L.ip(req), known, start);
      L.setCookie(req, res, 'otp', ticket, 1800, '/api/auth');
      return res.json({ ok: true, via: 'telegram', sent: false, telegramUrl: `https://t.me/${tgBot()}?start=${start}` });
    }
    run('INSERT INTO login_codes(ticket, phone, code, expires, ip, known) VALUES(?, ?, ?, ?, ?, ?)', ticket, phone, code, Date.now() + CODE_TTL, L.ip(req), known);
    try {
      await sendSms(phone, `Ovi: код ${code}. Никому его не сообщайте`);
    } catch (e) {
      run('DELETE FROM login_codes WHERE ticket = ?', ticket); // SMS не ушло — в пределы не засчитываем
      throw e;
    }
    L.setCookie(req, res, 'otp', ticket, 1800, '/api/auth');
    res.json({ ok: true, devCode: L.DEMO ? code : undefined });
  });

  app.post('/api/auth/verify', (req, res) => {
    const phone = L.normPhone(req.body?.phone);
    rateLimit('verify:' + L.ip(req), 40, 10 * 60_000);
    // код принимается только от того, кто его запросил: cookie `otp` выдана вместе с кодом
    const ticket = L.cookie(req, 'otp');
    const otp = ticket ? q1('SELECT * FROM login_codes WHERE ticket = ? AND phone = ? AND reg_token IS NULL', ticket, phone) : null;
    // код из Telegram действует только после того, как бот отправил его в чат: пока человек не поделился номером,
    // кода никто не видел, и принять его — значит дать постороннему угадывать вслепую
    if (!otp || otp.expires < Date.now() || otp.tg_start) throw bad('code_expired', 'Код устарел, запросите новый');
    // неверные вводы считаются на сам код: перебор упирается в число кодов на номер, а чужой вход не страдает
    if (otp.attempts >= CODE_TRIES) throw bad('rate_limit', 'Слишком много неверных кодов. Запросите новый код', 429);
    const given = String(req.body?.code || '').trim();
    const same = /^\d{6}$/.test(given) && given.length === otp.code.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(otp.code));
    if (!same) {
      run('UPDATE login_codes SET attempts = attempts + 1 WHERE ticket = ?', ticket);
      throw bad('code_wrong', 'Неверный код');
    }
    if (otp.channel === 'tg') run(`UPDATE tg_links SET used_at = ? WHERE phone = ?`, L.now(), phone);
    const user = q1('SELECT * FROM users WHERE phone = ?', phone);
    if (user) {
      if (user.is_demo && !L.DEMO) throw bad('forbidden', 'Этот номер недоступен', 403);
      // код использован; строка остаётся — отправленное SMS учтено в суточных пределах
      run('UPDATE login_codes SET code = ?, expires = 0 WHERE ticket = ?', L.token(8), ticket);
      if (ADMIN_PHONES.has(phone) && !user.is_admin) run('UPDATE users SET is_admin = 1 WHERE id = ?', user.id);
      // вход с устройства, с которого под этим номером ещё не входили, — владелец узнаёт об этом на остальных устройствах
      const fresh = !knownDevice(req, phone) && !!q1('SELECT 1 FROM sessions WHERE user_id = ? LIMIT 1', user.id);
      L.startSession(req, res, user.id);
      if (fresh) notify(user.id, { kind: 'system', title: 'Новый вход в аккаунт', body: 'В ваш аккаунт вошли с нового устройства. Если это были не вы, откройте настройки и нажмите «Выйти на всех устройствах».', link: '/cabinet/settings' });
      rememberDevice(req, res, phone);
      L.setCookie(req, res, 'otp', '', 0, '/api/auth');
      return res.json({ ...L.meOut(q1('SELECT * FROM users WHERE id = ?', user.id)), registered: true });
    }
    const regToken = L.token();
    run('UPDATE login_codes SET reg_token = ?, expires = ?, code = ? WHERE ticket = ?', regToken, Date.now() + 30 * 60_000, L.token(8), ticket);
    // если компания пригласила этот номер, человек сам выбирает: присоединиться или создать свою компанию
    const inv = inviteFor(phone);
    res.json({ registered: false, regToken, invite: inv ? { name: inv.name, companyName: inv.companyName, companyForm: inv.companyForm, role: inv.role } : null });
  });

  const regSchema = z.object({
    regToken: z.string().min(10),
    name: L.safeName(z.string().trim().min(2).max(100)),
    email: z.union([z.literal(''), z.string().trim().email().max(120)]).default(''),
    companyName: L.safeName(z.string().trim().min(2).max(120)).optional(),
    companyForm: z.enum(['ИП', 'ТОО', '']).optional(),
    role: z.enum(L.ROLES).optional(),
    joinInvite: z.boolean().default(false),
    accept: z.literal(true), // текст ошибки — в issueOut (lib.js)
  });
  app.post('/api/auth/register', (req, res) => {
    const b = parse(regSchema, req.body);
    const otp = q1('SELECT * FROM login_codes WHERE reg_token = ?', b.regToken);
    if (!otp || otp.expires < Date.now()) throw bad('code_expired', 'Сессия регистрации истекла, подтвердите номер заново');
    const invite = b.joinInvite ? inviteFor(otp.phone) : null;
    if (b.joinInvite && !invite) throw bad('not_found', 'Приглашение не найдено или устарело', 404);
    // водитель без компании: запись на его имя, без формы ИП/ТОО
    if (!invite && b.role === 'driver') Object.assign(b, { companyName: b.companyName || b.name, companyForm: '' });
    if (!invite && (!b.companyName || (!b.companyForm && b.role !== 'driver') || !b.role)) throw bad('validation', 'Укажите компанию и роль');
    const userId = tx(() => {
      run('UPDATE login_codes SET reg_token = NULL, expires = 0 WHERE ticket = ?', otp.ticket);
      const isAdmin = ADMIN_PHONES.has(otp.phone) ? 1 : 0;
      if (invite) {
        // сотрудник присоединяется к компании, которая его пригласила
        run('DELETE FROM invites WHERE id = ?', invite.id);
        return insert('INSERT INTO users(name, phone, email, role, company_id, company_role, accepted_terms, is_admin) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
          b.name, otp.phone, b.email, invite.role === 'driver' ? 'driver' : invite.kind, invite.company_id, invite.role === 'driver' ? 'driver' : 'manager', L.now(), isAdmin);
      }
      const companyId = insert('INSERT INTO companies(name, form, kind) VALUES(?, ?, ?)', b.companyName, b.companyForm, b.role);
      return insert('INSERT INTO users(name, phone, email, role, company_id, accepted_terms, is_admin) VALUES(?, ?, ?, ?, ?, ?, ?)', b.name, otp.phone, b.email, b.role, companyId, L.now(), isAdmin);
    });
    L.startSession(req, res, userId);
    rememberDevice(req, res, otp.phone);
    L.setCookie(req, res, 'otp', '', 0, '/api/auth');
    res.json(L.meOut(q1('SELECT * FROM users WHERE id = ?', userId)));
  });

  // Быстрый вход под демо-аккаунтом — только в демо-режиме.
  app.post('/api/auth/demo', (req, res) => {
    if (!L.DEMO) throw bad('forbidden', 'Демо-режим выключен', 403);
    const role = req.body?.role;
    const user =
      role === 'admin'
        ? q1('SELECT * FROM users WHERE is_admin = 1 AND is_demo = 1 ORDER BY id LIMIT 1')
        // «Водитель» в демо — водитель из команды перевозчика: главный сценарий для водителя
        : q1(`SELECT * FROM users WHERE role = ? AND is_admin = 0 AND is_demo = 1 ORDER BY (company_role = 'driver') DESC, id LIMIT 1`, String(role));
    if (!user) throw bad('not_found', 'Демо-аккаунт не найден', 404);
    L.startSession(req, res, user.id);
    res.json(L.meOut(user));
  });

  app.post('/api/auth/logout', (req, res) => {
    // вместе с входом уходят уведомления на это устройство и открытые потоки событий; «выйти везде» — на всех устройствах,
    // и ни одно из них больше не считается «своим» для кодов входа
    if (req.user) {
      const everywhere = !!req.body?.everywhere;
      L.dropSessions(req.user.id, everywhere ? null : req.sid);
      if (everywhere) run('DELETE FROM known_devices WHERE phone = ?', req.user.phone);
    }
    L.endSession(req, res);
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => {
    if (!req.user) return res.json(null);
    res.json(L.meOut(req.user));
  });

  // Настройки — строго известные ключи: произвольные данные в профиль записать нельзя.
  const meSchema = z.object({
    name: L.safeName(z.string().trim().min(2).max(100)).optional(),
    email: z.string().trim().email().max(120).optional(),
    settings: z.object({ showPhone: z.boolean(), news: z.boolean(), lang: z.enum(['ru', 'kz', 'en', 'zh']) }).partial().strict().optional(),
  });
  app.patch('/api/me', L.auth, (req, res) => {
    const b = parse(meSchema, req.body);
    if (b.name) run('UPDATE users SET name = ? WHERE id = ?', b.name, req.user.id);
    if (b.email) run('UPDATE users SET email = ? WHERE id = ?', b.email, req.user.id);
    if (b.settings) {
      const cur = L.j(req.user.settings, {});
      const next = { showPhone: cur.showPhone, news: cur.news, lang: cur.lang, ...b.settings };
      run('UPDATE users SET settings = ? WHERE id = ?', JSON.stringify(next), req.user.id);
    }
    res.json(L.meOut(q1('SELECT * FROM users WHERE id = ?', req.user.id)));
  });

  // Удаление аккаунта (требование App Store и Google Play). Запись о человеке не стирается, а обезличивается: на неё
  // ссылаются рейсы, отзывы и переписка партнёров, и у них эта история должна остаться. Имя, номер, почта, настройки,
  // входы, уведомления, подписки, заметки и обращения в поддержку удаляются; номер освобождается для новой регистрации.
  app.delete('/api/me', L.auth, (req, res) => {
    const u = req.user;
    if (u.is_demo) throw bad('forbidden', 'Демо-аккаунт удалить нельзя', 403);
    const mine = u.company_id;
    const others = q('SELECT id, company_role FROM users WHERE company_id = ? AND id != ? ORDER BY id', mine, u.id);
    const alone = others.length === 0;
    if (!alone && u.company_role === 'owner' && !others.some((o) => o.company_role === 'owner'))
      throw bad('state', 'Вы владелец компании с сотрудниками — сначала удалите их из команды', 409);
    // как при переходе в другую компанию: единственного человека держат рейсы компании, сотрудника — рейсы, где он водитель
    const busy = alone
      ? q(`SELECT id FROM trips WHERE status = 'active' AND (customer_company = :c OR carrier_company = :c) ORDER BY id LIMIT 5`, { c: mine })
      : q(`SELECT id FROM trips WHERE status = 'active' AND driver_user = ? ORDER BY id LIMIT 5`, u.id);
    if (busy.length) throw L.tbad('state', 'У вашей компании есть активные рейсы ({n}) — сначала завершите их в разделе «Рейсы»', { n: busy.map((x) => `№${x.id}`).join(', ') }, 409);
    const docs = alone ? q('SELECT path FROM documents WHERE company_id = ?', mine) : [];
    tx(() => {
      run(`UPDATE responses SET status = 'withdrawn' WHERE user_id = ? AND status = 'sent'`, u.id);
      if (alone) {
        // в компании никого не остаётся: объявления в архив, вакансии и карточки услуг сняты; документы для проверки,
        // сотрудники и машины — это данные людей, которых платформа больше не обслуживает. Название остаётся в истории рейсов и отзывах
        run(`UPDATE responses SET status = 'declined' WHERE status = 'sent' AND listing_id IN (SELECT id FROM listings WHERE company_id = ? AND status = 'active')`, mine);
        run(`UPDATE listings SET status = 'archived', closed_at = ? WHERE company_id = ? AND status = 'active'`, L.now(), mine);
        run(`UPDATE jobs SET status = 'closed', phone = '' WHERE company_id = ?`, mine);
        run(`UPDATE services SET removed = 1, phone = '' WHERE company_id = ?`, mine);
        run('DELETE FROM documents WHERE company_id = ?', mine);
        run('DELETE FROM employees WHERE company_id = ?', mine);
        run('DELETE FROM vehicles WHERE company_id = ?', mine);
        run('DELETE FROM invites WHERE company_id = ?', mine);
        run(`UPDATE companies SET bin = NULL, about = '' WHERE id = ?`, mine);
      } else {
        // компания работает дальше: объявления, вакансии, услуги и текущие сделки человека переходят владельцу
        const boss = (others.find((o) => o.company_role === 'owner') || others[0]).id;
        run('UPDATE listings SET user_id = ? WHERE user_id = ? AND company_id = ?', boss, u.id, mine);
        run('UPDATE jobs SET user_id = ? WHERE user_id = ? AND company_id = ?', boss, u.id, mine);
        run('UPDATE services SET user_id = ? WHERE user_id = ? AND company_id = ?', boss, u.id, mine);
        run(`UPDATE trips SET customer_user = ? WHERE customer_user = ? AND status = 'active'`, boss, u.id);
        run(`UPDATE trips SET carrier_user = ? WHERE carrier_user = ? AND status = 'active'`, boss, u.id);
        // сотрудник уходит из команды в свою пустую компанию — как при удалении из команды
        const own = insert(`INSERT INTO companies(name, form, kind) VALUES('—', 'ИП', ?)`, u.role);
        run(`UPDATE users SET company_id = ?, company_role = 'owner' WHERE id = ?`, own, u.id);
      }
      // в завершённых рейсах человек остаётся водителем, но без имени и номера
      run(`UPDATE trips SET driver_name = '', driver_phone = '' WHERE driver_user = ?`, u.id);
      for (const t of ['notifications', 'searches', 'marks', 'listing_views', 'feedback']) run(`DELETE FROM ${t} WHERE user_id = ?`, u.id);
      run('DELETE FROM invites WHERE phone = ? OR user_id = ?', u.phone, u.id);
      for (const t of ['login_codes', 'known_devices', 'tg_links']) run(`DELETE FROM ${t} WHERE phone = ?`, u.phone);
      run(`UPDATE users SET name = 'Аккаунт удалён', phone = ?, email = '', settings = '{"showPhone":false}', is_admin = 0,
        relocator = 0, licenses = '[]', relocator_city = NULL, relocator_note = '' WHERE id = ?`, `deleted-${u.id}`, u.id);
    });
    for (const d of docs) fs.rmSync(path.join(UPLOAD_DIR, path.basename(d.path)), { force: true });
    L.resetCompanyCache();
    L.dropSessions(u.id);
    L.endSession(req, res);
    res.json({ ok: true });
  });

  // Данные компании меняет только владелец.
  const companySchema = z.object({
    about: z.string().max(1000).optional(),
    cityId: z.string().refine((c) => cityById.has(c), 'Неизвестный город').nullable().optional(),
    bin: z.string().trim().max(12).optional(),
  });
  app.patch('/api/company', L.auth, L.owner, (req, res) => {
    const b = parse(companySchema, req.body);
    const id = req.user.company_id;
    if (b.about !== undefined) run('UPDATE companies SET about = ? WHERE id = ?', b.about, id);
    if (b.cityId !== undefined) run('UPDATE companies SET city_id = ? WHERE id = ?', b.cityId, id);
    if (b.bin !== undefined) {
      if (b.bin && !/^\d{12}$/.test(b.bin)) throw bad('bin', 'БИН/ИИН — это 12 цифр');
      if (b.bin && !isValidBin(b.bin)) throw bad('bin', 'БИН/ИИН не прошёл проверку контрольного разряда');
      if (b.bin && q1('SELECT 1 FROM companies WHERE bin = ? AND id != ?', b.bin, id)) throw bad('bin_taken', 'Компания с таким БИН/ИИН уже зарегистрирована. Если это ваша компания, напишите в поддержку', 409);
      // смена БИН сбрасывает подтверждение компании
      L.resetCompanyCache();
      run(`UPDATE companies SET bin = ?, verified = CASE WHEN bin IS ? THEN verified ELSE 'none' END WHERE id = ?`, b.bin || null, b.bin || null, id);
    }
    res.json(L.meOut(req.user));
  });

  app.get('/api/events', L.auth, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': connected\n\n');
    L.subscribe(req.user.id, res, req.sid);
  });
}
