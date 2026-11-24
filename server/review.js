// Вход для проверяющего из App Store и Google Play: он не может получить SMS или код в Telegram, поэтому на два номера
// из REVIEW_LOGIN действует постоянный код. Без REVIEW_LOGIN ничего этого нет.
// REVIEW_LOGIN=+77010000001:код,+77010000002:код — первый номер перевозчик, второй заказчик; код — шесть цифр.
// Постоянный код подходит только к тестовым аккаунтам (is_review), которые создаются здесь же: настоящий аккаунт
// с таким номером им не открыть. Между двумя аккаунтами всегда есть активный рейс — на нём проверяют передачу GPS.
import { q, q1, run, insert, tx } from './db.js';
import * as L from './lib.js';

/** Разобрать REVIEW_LOGIN: номер → код. Коды в текст ошибки не попадают: он уходит в журнал сервера. */
export function parseReview(raw) {
  const parts = String(raw || '').split(/[,;]+/).map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return new Map();
  const map = new Map();
  for (const part of parts) {
    const [phone, code = ''] = part.split(':').map((x) => x.trim());
    let norm;
    try {
      norm = L.normPhone(phone);
    } catch {
      throw new Error(`REVIEW_LOGIN: некорректный номер «${phone}»`);
    }
    if (!/^\d{6}$/.test(code) || /^(\d)\1{5}$/.test(code) || '01234567890'.includes(code) || '09876543210'.includes(code))
      throw new Error(`REVIEW_LOGIN: для номера ${norm} нужен код из шести цифр, не подряд и не одинаковых`);
    map.set(norm, code);
  }
  if (parts.length !== 2 || map.size !== 2) throw new Error('REVIEW_LOGIN: укажите два разных номера — перевозчика и заказчика');
  return map;
}
export const REVIEW = parseReview(process.env.REVIEW_LOGIN);
const PHONES = [...REVIEW.keys()];

/** Постоянный код номера — или null: номер обычный либо под ним уже есть настоящий аккаунт. */
export function reviewCode(phone) {
  if (!REVIEW.has(phone)) return null;
  const u = q1('SELECT is_review, company_role FROM users WHERE phone = ?', phone);
  // перешёл по приглашению в чужую компанию — постоянный код больше не действует: там данные настоящих людей
  return !u || (u.is_review && u.company_role === 'owner') ? REVIEW.get(phone) : null;
}

const PEOPLE = [
  { name: 'Review Driver', company: 'Review Carrier', form: 'ИП', role: 'carrier' },
  { name: 'Review Manager', company: 'Review Customer', form: 'ТОО', role: 'customer' },
];
/** Номер занят настоящим аккаунтом — тестовый под ним не создаётся. */
function account(i) {
  const u = q1('SELECT * FROM users WHERE phone = ?', PHONES[i]);
  if (u) return u.is_review ? u : null;
  const p = PEOPLE[i];
  const company = insert('INSERT INTO companies(name, form, kind) VALUES(?, ?, ?)', p.company, p.form, p.role);
  const id = insert(`INSERT INTO users(name, phone, email, role, company_id, accepted_terms, settings, is_review) VALUES(?, ?, '', ?, ?, ?, '{"showPhone":false}', 1)`, p.name, PHONES[i], p.role, company, L.now());
  L.resetCompanyCache();
  return q1('SELECT * FROM users WHERE id = ?', id);
}
/** Аккаунты и активный рейс между ними: вызывается при каждом входе — проверяющий мог удалить аккаунт или закрыть рейс. */
export function ensureReview() {
  if (!REVIEW.size) return;
  tx(() => {
    const [carrier, customer] = [account(0), account(1)];
    if (!carrier || !customer) return;
    const pair = [customer.company_id, carrier.company_id];
    // закрытый тестовый рейс требует отзыва и через три дня запирает аккаунт — для проверяющего это тупик
    run(`UPDATE trips SET status = 'cancelled' WHERE status IN ('completed', 'failed') AND customer_company = ? AND carrier_company = ?`, ...pair);
    if (q1(`SELECT 1 FROM trips WHERE status = 'active' AND customer_company = ? AND carrier_company = ?`, ...pair)) return;
    const day = (n) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
    // объявление сразу закрыто и без ставки: в поиске его не видно и на статистику цен оно не влияет
    const listing = insert(
      `INSERT INTO listings(kind, user_id, company_id, status, points, from_id, to_id, body_type, cargo_type, weight, volume, date_from, date_to, description, distance_km, closed_at)
       VALUES('cargo', ?, ?, 'closed', '["astana","karaganda","almaty"]', 'astana', 'almaty', 'ref', 'food', 18, 82, ?, ?, 'Test cargo for app review', 1192, ?)`,
      customer.id, customer.company_id, day(0), day(5), L.now(),
    );
    const response = insert(`INSERT INTO responses(listing_id, user_id, company_id, message, price, status) VALUES(?, ?, ?, 'The truck is ready to load.', 500000, 'accepted')`, listing, carrier.id, carrier.company_id);
    const chat = insert('INSERT INTO chats(listing_id, owner_id, peer_id, owner_company, peer_company) VALUES(?, ?, ?, ?, ?)', listing, customer.id, carrier.id, customer.company_id, carrier.company_id);
    run('INSERT INTO messages(chat_id, sender_id, text, is_read) VALUES(?, ?, ?, 1)', chat, carrier.id, 'The truck is ready to load.');
    run('INSERT INTO messages(chat_id, sender_id, text) VALUES(?, ?, ?)', chat, customer.id, 'Great, the trip is yours. Please turn on GPS sharing.');
    const terms = JSON.stringify(q1('SELECT points, cargo_type, body_type, weight, volume, distance_km, date_from, date_to, description, loading, pay_terms, brand, load_address, unload_address, load_time FROM listings WHERE id = ?', listing));
    const trip = insert(
      `INSERT INTO trips(listing_id, response_id, customer_user, customer_company, carrier_user, carrier_company, price, track_token, driver_token, terms, vehicle_brand, plate, driver_user, driver_name, driver_phone, confirmed_at)
       VALUES(?, ?, ?, ?, ?, ?, 500000, ?, ?, ?, 'Volvo FH', '000 TST 01', ?, ?, ?, ?)`,
      listing, response, customer.id, customer.company_id, carrier.id, carrier.company_id, L.token(12), L.token(18), terms, carrier.id, carrier.name, carrier.phone, L.now(),
    );
    run(`INSERT INTO trip_events(trip_id, stage) VALUES(?, 'planned')`, trip);
  });
}
/** Тестовые рейсы не держат удаление тестового аккаунта: проверяющий обязан увидеть, что удаление работает. */
export function cancelReviewTrips(user) {
  if (!user.is_review) return;
  run(
    `UPDATE trips SET status = 'cancelled', finished_at = ?, share_gps = 0 WHERE status = 'active' AND (customer_company = ? OR carrier_company = ?)
       AND customer_company IN (SELECT company_id FROM users WHERE is_review = 1) AND carrier_company IN (SELECT company_id FROM users WHERE is_review = 1)`,
    L.now(), user.company_id, user.company_id,
  );
}
/** Номер убрали из REVIEW_LOGIN — входы в его тестовый аккаунт закрываются при следующем запуске. */
export function closeReview() {
  for (const u of q('SELECT id, phone FROM users WHERE is_review = 1')) if (!REVIEW.has(u.phone)) L.dropSessions(u.id);
}
