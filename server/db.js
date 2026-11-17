// SQLite-хранилище на встроенном модуле node:sqlite (без нативных зависимостей).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'jolda.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;');

const TS = `TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

db.exec(`
CREATE TABLE IF NOT EXISTS companies(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, form TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'customer',
  bin TEXT, about TEXT NOT NULL DEFAULT '', city_id TEXT,
  verified TEXT NOT NULL DEFAULT 'none', balance INTEGER NOT NULL DEFAULT 0, created_at ${TS});
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE, email TEXT NOT NULL, role TEXT NOT NULL,
  company_id INTEGER NOT NULL REFERENCES companies(id), is_admin INTEGER NOT NULL DEFAULT 0,
  settings TEXT NOT NULL DEFAULT '{}', created_at ${TS});
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), created_at ${TS});
CREATE TABLE IF NOT EXISTS otps(phone TEXT PRIMARY KEY, code TEXT NOT NULL, expires INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, reg_token TEXT);
CREATE TABLE IF NOT EXISTS documents(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id), user_id INTEGER NOT NULL,
  kind TEXT NOT NULL, filename TEXT NOT NULL, mime TEXT NOT NULL, path TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at ${TS});
CREATE TABLE IF NOT EXISTS vehicles(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id), brand TEXT NOT NULL, plate TEXT NOT NULL DEFAULT '',
  body_type TEXT, weight REAL, volume REAL, loading TEXT NOT NULL DEFAULT '[]', created_at ${TS});
CREATE TABLE IF NOT EXISTS employees(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id), name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '',
  position TEXT NOT NULL DEFAULT '', license_cats TEXT NOT NULL DEFAULT '', experience INTEGER,
  esutd TEXT NOT NULL DEFAULT 'unknown', esutd_number TEXT NOT NULL DEFAULT '', created_at ${TS});
CREATE TABLE IF NOT EXISTS listings(
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id), company_id INTEGER NOT NULL REFERENCES companies(id),
  status TEXT NOT NULL DEFAULT 'active', points TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '', body_type TEXT, cargo_type TEXT, weight REAL, volume REAL, loading TEXT NOT NULL DEFAULT '[]',
  date_from TEXT NOT NULL, date_to TEXT NOT NULL, pay_terms TEXT NOT NULL DEFAULT '[]', rate REAL, currency TEXT NOT NULL DEFAULT 'KZT',
  description TEXT NOT NULL DEFAULT '', distance_km INTEGER NOT NULL DEFAULT 0, boosted_until TEXT, created_at ${TS}, closed_at TEXT);
CREATE INDEX IF NOT EXISTS listings_kind_status ON listings(kind, status);
CREATE TABLE IF NOT EXISTS marks(
  user_id INTEGER NOT NULL, listing_id INTEGER NOT NULL REFERENCES listings(id), marked INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '', hidden INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, listing_id));
CREATE TABLE IF NOT EXISTS searches(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, params TEXT NOT NULL, created_at ${TS});
CREATE TABLE IF NOT EXISTS responses(
  id INTEGER PRIMARY KEY, listing_id INTEGER NOT NULL REFERENCES listings(id), user_id INTEGER NOT NULL REFERENCES users(id),
  company_id INTEGER NOT NULL, message TEXT NOT NULL, price REAL, currency TEXT NOT NULL DEFAULT 'KZT',
  status TEXT NOT NULL DEFAULT 'sent', created_at ${TS});
CREATE TABLE IF NOT EXISTS chats(
  id INTEGER PRIMARY KEY, listing_id INTEGER NOT NULL REFERENCES listings(id), owner_id INTEGER NOT NULL, peer_id INTEGER NOT NULL,
  created_at ${TS}, UNIQUE(listing_id, owner_id, peer_id));
CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL REFERENCES chats(id), sender_id INTEGER NOT NULL, text TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0, created_at ${TS});
CREATE INDEX IF NOT EXISTS messages_chat ON messages(chat_id, id);
CREATE TABLE IF NOT EXISTS trips(
  id INTEGER PRIMARY KEY, listing_id INTEGER NOT NULL REFERENCES listings(id), response_id INTEGER,
  customer_user INTEGER NOT NULL, customer_company INTEGER NOT NULL, carrier_user INTEGER NOT NULL, carrier_company INTEGER NOT NULL,
  price REAL, currency TEXT NOT NULL DEFAULT 'KZT', status TEXT NOT NULL DEFAULT 'active', stage TEXT NOT NULL DEFAULT 'planned',
  share_gps INTEGER NOT NULL DEFAULT 0, track_token TEXT NOT NULL UNIQUE, created_at ${TS}, finished_at TEXT);
CREATE TABLE IF NOT EXISTS trip_events(id INTEGER PRIMARY KEY, trip_id INTEGER NOT NULL REFERENCES trips(id), stage TEXT NOT NULL, at ${TS});
CREATE TABLE IF NOT EXISTS positions(id INTEGER PRIMARY KEY, trip_id INTEGER NOT NULL REFERENCES trips(id), lat REAL NOT NULL, lon REAL NOT NULL, speed REAL, at ${TS});
CREATE INDEX IF NOT EXISTS positions_trip ON positions(trip_id, id);
CREATE TABLE IF NOT EXISTS reviews(
  id INTEGER PRIMARY KEY, trip_id INTEGER NOT NULL REFERENCES trips(id), author_user INTEGER NOT NULL, author_company INTEGER NOT NULL,
  target_company INTEGER NOT NULL, rating INTEGER NOT NULL, text TEXT NOT NULL DEFAULT '', created_at ${TS}, UNIQUE(trip_id, author_company));
CREATE TABLE IF NOT EXISTS blacklist(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id), author_user INTEGER NOT NULL, author_company INTEGER NOT NULL,
  reason TEXT NOT NULL, review TEXT NOT NULL DEFAULT '', created_at ${TS}, UNIQUE(company_id, author_company));
CREATE TABLE IF NOT EXISTS jobs(
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id), company_id INTEGER NOT NULL,
  title TEXT NOT NULL, city_id TEXT, vehicle TEXT NOT NULL DEFAULT '', license_cats TEXT NOT NULL DEFAULT '', experience INTEGER,
  salary TEXT NOT NULL DEFAULT '', date_from TEXT, description TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', created_at ${TS});
CREATE TABLE IF NOT EXISTS transactions(id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, amount INTEGER NOT NULL, kind TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at ${TS});

`);

// ---- расширения схемы: новые таблицы и столбцы добавляются без потери данных ----
db.exec(`
CREATE TABLE IF NOT EXISTS invites(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id), phone TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'manager', created_at ${TS});
CREATE TABLE IF NOT EXISTS listing_views(listing_id INTEGER NOT NULL, user_id INTEGER NOT NULL, day TEXT NOT NULL, PRIMARY KEY(listing_id, user_id, day));
CREATE TABLE IF NOT EXISTS blocks(company_id INTEGER NOT NULL, blocked_id INTEGER NOT NULL, created_at ${TS}, PRIMARY KEY(company_id, blocked_id));
CREATE TABLE IF NOT EXISTS partners(company_id INTEGER NOT NULL, partner_id INTEGER NOT NULL, created_at ${TS}, PRIMARY KEY(company_id, partner_id));
CREATE TABLE IF NOT EXISTS complaints(
  id INTEGER PRIMARY KEY, listing_id INTEGER, company_id INTEGER, author_user INTEGER NOT NULL, author_company INTEGER NOT NULL,
  reason TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open', created_at ${TS});
CREATE TABLE IF NOT EXISTS notifications(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '', is_read INTEGER NOT NULL DEFAULT 0, created_at ${TS});
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, id);
CREATE TABLE IF NOT EXISTS push_subs(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, endpoint TEXT NOT NULL UNIQUE, keys TEXT NOT NULL, created_at ${TS});
CREATE TABLE IF NOT EXISTS news(
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, title_kz TEXT NOT NULL DEFAULT '', body_kz TEXT NOT NULL DEFAULT '',
  title_en TEXT NOT NULL DEFAULT '', body_en TEXT NOT NULL DEFAULT '', created_at ${TS});
CREATE TABLE IF NOT EXISTS feedback(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at ${TS});
CREATE TABLE IF NOT EXISTS route_cache(key TEXT PRIMARY KEY, km INTEGER NOT NULL, geometry TEXT NOT NULL, created_at ${TS});
`);
function addColumn(table, column, definition) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn('notifications', 'vars', `TEXT NOT NULL DEFAULT '{}'`);
addColumn('users', 'company_role', `TEXT NOT NULL DEFAULT 'owner'`);
addColumn('listings', 'adr_class', 'INTEGER');
addColumn('listings', 'flags', `TEXT NOT NULL DEFAULT '[]'`);
addColumn('listings', 'views', 'INTEGER NOT NULL DEFAULT 0');
addColumn('searches', 'notify', 'INTEGER NOT NULL DEFAULT 0');
addColumn('companies', 'plan', `TEXT NOT NULL DEFAULT 'free'`);
addColumn('companies', 'plan_until', 'TEXT');
addColumn('companies', 'banned', 'INTEGER NOT NULL DEFAULT 0');
addColumn('companies', 'ban_reason', `TEXT NOT NULL DEFAULT ''`);
addColumn('documents', 'note', `TEXT NOT NULL DEFAULT ''`);
addColumn('feedback', 'reply', `TEXT NOT NULL DEFAULT ''`);
addColumn('feedback', 'replied_at', 'TEXT');
db.exec(`CREATE TABLE IF NOT EXISTS mod_log(id INTEGER PRIMARY KEY, admin_user INTEGER NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', created_at ${TS})`);
addColumn('companies', 'verify_note', `TEXT NOT NULL DEFAULT ''`);
addColumn('trips', 'driver_token', 'TEXT');
addColumn('trips', 'fail_reason', `TEXT NOT NULL DEFAULT ''`);
addColumn('trips', 'failed_by', 'INTEGER');
addColumn('trips', 'sim', 'INTEGER NOT NULL DEFAULT 0');
addColumn('blacklist', 'reply', `TEXT NOT NULL DEFAULT ''`);
addColumn('users', 'accepted_terms', 'TEXT');
addColumn('users', 'is_demo', 'INTEGER NOT NULL DEFAULT 0');
addColumn('otps', 'fail_hour', 'INTEGER');
addColumn('trips', 'terms', 'TEXT');
addColumn('invites', 'user_id', 'INTEGER');
// чат принадлежит двум компаниям: его видят все их сотрудники
addColumn('chats', 'owner_company', 'INTEGER');
addColumn('chats', 'peer_company', 'INTEGER');
db.exec(`
UPDATE chats SET owner_company = (SELECT company_id FROM users WHERE id = chats.owner_id) WHERE owner_company IS NULL;
UPDATE chats SET peer_company = (SELECT company_id FROM users WHERE id = chats.peer_id) WHERE peer_company IS NULL;
UPDATE trips SET driver_token = lower(hex(randomblob(14))) WHERE driver_token IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS trips_driver_token ON trips(driver_token);
CREATE INDEX IF NOT EXISTS listings_company ON listings(company_id, status);
CREATE INDEX IF NOT EXISTS responses_listing ON responses(listing_id, status);
CREATE INDEX IF NOT EXISTS trips_listing ON trips(listing_id, status);
CREATE INDEX IF NOT EXISTS reviews_target ON reviews(target_company);
`);

db.exec(`
DROP VIEW IF EXISTS company_stats;
DROP VIEW IF EXISTS rated_reviews;
DROP VIEW IF EXISTS visible_reviews;
CREATE VIEW visible_reviews AS SELECT r.* FROM reviews r
WHERE EXISTS (SELECT 1 FROM reviews o WHERE o.trip_id = r.trip_id AND o.author_company = r.target_company)
   OR r.created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days');
-- В рейтинге от каждой компании учитывается один, самый свежий отзыв: серия рейсов между двумя «своими» компаниями его не накручивает.
-- В рейтинг идут только отзывы проверенных компаний: пачка компаний-однодневок его не накрутит и не обрушит.
CREATE VIEW rated_reviews AS SELECT r.* FROM visible_reviews r JOIN companies a ON a.id = r.author_company
WHERE a.verified = 'verified' AND a.banned = 0 AND NOT EXISTS (SELECT 1 FROM visible_reviews n WHERE n.target_company = r.target_company AND n.author_company = r.author_company AND n.id > r.id);
-- Отзыв учитывается в рейтинге, когда отзывы оставили обе стороны рейса или прошло 7 дней:
-- так нельзя ответить оценкой на оценку.
CREATE VIEW company_stats AS SELECT c.id, c.name, c.form, c.kind, c.bin, c.about, c.city_id, c.verified, c.created_at, c.banned,
  CASE WHEN c.plan = 'pro' AND c.plan_until > strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 1 ELSE 0 END AS pro,
  (SELECT ROUND(AVG(rating), 1) FROM rated_reviews r WHERE r.target_company = c.id) AS rating,
  (SELECT COUNT(*) FROM visible_reviews r WHERE r.target_company = c.id) AS reviews,
  (SELECT COUNT(*) FROM rated_reviews r WHERE r.target_company = c.id) AS reviewers,
  (SELECT COUNT(*) FROM trips t WHERE t.status = 'completed' AND (t.customer_company = c.id OR t.carrier_company = c.id)) AS trips,
  (SELECT COUNT(*) FROM blacklist b JOIN companies a ON a.id = b.author_company WHERE b.company_id = c.id AND a.verified = 'verified' AND a.banned = 0) AS bl
FROM companies c;
`);

const cache = new Map();
const stmt = (sql) => {
  let s = cache.get(sql);
  if (!s) cache.set(sql, (s = db.prepare(sql)));
  return s;
};
/** Все строки. Параметры — позиционные (?) или один объект с именованными (:name). */
export const q = (sql, ...p) => stmt(sql).all(...p);
export const q1 = (sql, ...p) => stmt(sql).get(...p);
export const run = (sql, ...p) => stmt(sql).run(...p);
export const insert = (sql, ...p) => Number(stmt(sql).run(...p).lastInsertRowid);

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
