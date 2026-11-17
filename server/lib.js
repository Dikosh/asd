// Общие помощники: ошибки, валидация, сессии, SSE, сериализация.
import crypto from 'node:crypto';
import { q, q1, run } from './db.js';
import { cityById, isValidBin } from './geo.js';

export const DEMO = process.env.DEMO_MODE ? process.env.DEMO_MODE !== '0' : process.env.NODE_ENV !== 'production';

export const ROLES = ['customer', 'carrier', 'logist', 'broker', 'driver'];
export const BODY = ['tent', 'ref', 'isotherm', 'board', 'container', 'tank', 'tipper', 'trawl', 'carrier', 'grain', 'van'];
export const CARGO = ['food', 'building', 'equipment', 'consumer', 'agro', 'metal', 'fuel', 'groupage', 'adr', 'oversize', 'cars', 'furniture', 'other'];
export const LOADING = ['top', 'rear', 'full', 'side'];
export const PAY = ['prepay', 'cash', 'cashless_vat', 'cashless_novat'];
export const CURRENCIES = ['KZT', 'USD', 'RUB'];
export const STAGES = ['planned', 'to_loading', 'loading', 'in_transit', 'unloading', 'delivered'];
export const DOC_KINDS = ['id_card', 'registration', 'license', 'driver_license', 'other'];
export const BOOST_PRICE = 500;

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}
export const bad = (code, message, status = 400) => new HttpError(status, code, message);
export const parse = (schema, data) => {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw bad('validation', r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return r.data;
};
export const now = () => new Date().toISOString();
export const token = (n = 24) => crypto.randomBytes(n).toString('base64url');
export const j = (s, d) => {
  try {
    return JSON.parse(s);
  } catch {
    return d;
  }
};
export const today = () => new Date().toISOString().slice(0, 10);

export function normPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) throw bad('phone', 'Некорректный номер телефона');
  return '+' + digits;
}

// ---------- сессии ----------
function cookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
export function startSession(req, res, userId) {
  const sid = token(32);
  run('INSERT INTO sessions(token, user_id) VALUES(?, ?)', sid, userId);
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000${secure}`);
}
export function endSession(req, res) {
  const sid = cookie(req, 'sid');
  if (sid) run('DELETE FROM sessions WHERE token = ?', sid);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
}
export function loadUser(req, _res, next) {
  const sid = cookie(req, 'sid');
  req.user = sid ? q1('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?', sid) || null : null;
  next();
}
export function auth(req, _res, next) {
  if (!req.user) throw bad('unauthorized', 'Требуется вход', 401);
  next();
}
export function admin(req, _res, next) {
  if (!req.user?.is_admin) throw bad('forbidden', 'Только для администратора', 403);
  next();
}

// ---------- события в реальном времени (SSE) ----------
const streams = new Map();
export function subscribe(userId, res) {
  if (!streams.has(userId)) streams.set(userId, new Set());
  streams.get(userId).add(res);
  res.on('close', () => streams.get(userId)?.delete(res));
}
export function push(userIds, type, data = {}) {
  for (const id of new Set([userIds].flat())) {
    for (const res of streams.get(id) || []) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}
setInterval(() => {
  for (const set of streams.values()) for (const res of set) res.write(': ping\n\n');
}, 25000).unref();

// ---------- компании ----------
export function indicator(rating, reviews, bl) {
  if (bl >= 2 || (reviews >= 1 && rating < 3)) return 'red';
  if (reviews >= 1 && rating >= 4 && bl === 0) return 'green';
  return 'gray';
}
/** Компания из строки company_stats (prefix — если поля выбраны с префиксом, например c_). */
export function companyOut(r, prefix = '') {
  const g = (k) => r[prefix + k];
  return {
    id: prefix ? r.company_id : r.id,
    name: g('name'),
    form: g('form'),
    kind: g('kind'),
    verified: g('verified'),
    rating: g('rating'),
    reviews: g('reviews'),
    trips: g('trips'),
    blacklisted: g('bl'),
    indicator: indicator(g('rating'), g('reviews'), g('bl')),
  };
}
export const COMPANY_COLS = (a, p) =>
  ['name', 'form', 'kind', 'verified', 'rating', 'reviews', 'trips', 'bl'].map((k) => `${a}.${k} AS ${p}${k}`).join(', ');

// ---------- объявления ----------
const LISTING_SQL = `
SELECT l.*, u.name AS user_name, u.phone AS user_phone, u.settings AS user_settings, ${COMPANY_COLS('cs', 'c_')},
  m.marked AS m_marked, m.note AS m_note, m.hidden AS m_hidden,
  (SELECT COUNT(*) FROM responses r WHERE r.listing_id = l.id AND r.status IN ('sent', 'accepted')) AS responses_count,
  (SELECT r.id || ':' || r.status FROM responses r WHERE r.listing_id = l.id AND r.user_id = :viewer ORDER BY r.id DESC LIMIT 1) AS my_response,
  (SELECT t.id FROM trips t WHERE t.listing_id = l.id AND t.status = 'active' LIMIT 1) AS trip_id
FROM listings l
JOIN users u ON u.id = l.user_id
JOIN company_stats cs ON cs.id = l.company_id
LEFT JOIN marks m ON m.listing_id = l.id AND m.user_id = :viewer`;

/** Объявления по условию where (именованные параметры), уже в виде JSON для клиента. */
export function listings(viewer, where, params = {}, tail = 'ORDER BY l.id DESC') {
  return q(`${LISTING_SQL} WHERE ${where} ${tail}`, { viewer: viewer.id, ...params }).map((r) => listingOut(r, viewer));
}
export function listingOut(r, viewer) {
  const points = j(r.points, []);
  const countries = new Set(points.map((id) => cityById.get(id)?.country));
  const [respId, respStatus] = (r.my_response || '').split(':');
  const mine = r.company_id === viewer.company_id;
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    points,
    fromId: r.from_id,
    toId: r.to_id,
    brand: r.brand,
    bodyType: r.body_type,
    cargoType: r.cargo_type,
    weight: r.weight,
    volume: r.volume,
    loading: j(r.loading, []),
    dateFrom: r.date_from,
    dateTo: r.date_to,
    payTerms: j(r.pay_terms, []),
    rate: r.rate,
    currency: r.currency,
    description: r.description,
    distanceKm: r.distance_km,
    international: countries.size > 1,
    boosted: !!r.boosted_until && r.boosted_until > now(),
    createdAt: r.created_at,
    tripId: r.trip_id || null,
    company: companyOut(r, 'c_'),
    // владелец может скрыть телефон в настройках — тогда связь только через отклик и чат
    user: { id: r.user_id, name: r.user_name, phone: mine || j(r.user_settings, {}).showPhone !== false ? r.user_phone : null },
    mine,
    mark: { marked: !!r.m_marked, note: r.m_note || '', hidden: !!r.m_hidden },
    responsesCount: r.responses_count,
    myResponse: respId ? { id: Number(respId), status: respStatus } : null,
  };
}

// ---------- профиль ----------
export function pendingReviews(user) {
  return q(
    `SELECT t.id AS tripId, c.name AS companyName FROM trips t
     JOIN companies c ON c.id = CASE WHEN t.customer_company = :c THEN t.carrier_company ELSE t.customer_company END
     WHERE t.status = 'completed' AND (t.customer_company = :c OR t.carrier_company = :c)
       AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.trip_id = t.id AND r.author_company = :c)`,
    { c: user.company_id },
  );
}
export function requireNoPendingReviews(user) {
  if (pendingReviews(user).length) throw bad('review_required', 'Сначала оставьте отзыв о завершённом рейсе', 409);
}
export function meOut(user) {
  const c = q1('SELECT cs.*, c.balance FROM company_stats cs JOIN companies c ON c.id = cs.id WHERE cs.id = ?', user.company_id);
  return {
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      email: user.email,
      role: user.role,
      isAdmin: !!user.is_admin,
      settings: j(user.settings, {}),
    },
    company: { ...companyOut(c), bin: c.bin, binValid: isValidBin(c.bin), about: c.about, cityId: c.city_id, balance: c.balance },
    counters: {
      unread: q1(
        `SELECT COUNT(*) AS n FROM messages m JOIN chats c ON c.id = m.chat_id
         WHERE m.is_read = 0 AND m.sender_id != :u AND (c.owner_id = :u OR c.peer_id = :u)`,
        { u: user.id },
      ).n,
      responses: q1(
        `SELECT COUNT(*) AS n FROM responses r JOIN listings l ON l.id = r.listing_id WHERE l.company_id = ? AND r.status = 'sent'`,
        user.company_id,
      ).n,
      trips: q1(`SELECT COUNT(*) AS n FROM trips WHERE status = 'active' AND (customer_company = :c OR carrier_company = :c)`, {
        c: user.company_id,
      }).n,
    },
    pendingReviews: pendingReviews(user),
  };
}
