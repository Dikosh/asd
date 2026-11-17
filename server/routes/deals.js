// Отклики, чат, рейсы с GPS и отзывы.
import { z } from 'zod';
import { q, q1, run, insert, tx } from '../db.js';
import { cityById, haversine, ROAD_FACTOR } from '../geo.js';
import * as L from '../lib.js';

const { bad, parse, auth } = L;

function postMessage(chatId, senderId, text) {
  const id = insert('INSERT INTO messages(chat_id, sender_id, text) VALUES(?, ?, ?)', chatId, senderId, text);
  const chat = q1('SELECT * FROM chats WHERE id = ?', chatId);
  L.push([chat.owner_id, chat.peer_id], 'message', { chatId, id });
  return id;
}
function chatOf(req) {
  const chat = q1('SELECT * FROM chats WHERE id = ?', Number(req.params.id));
  if (!chat || (chat.owner_id !== req.user.id && chat.peer_id !== req.user.id)) throw bad('not_found', 'Чат не найден', 404);
  return chat;
}

const TRIP_SQL = `
SELECT t.*, l.kind AS l_kind, l.points AS l_points, l.cargo_type, l.body_type, l.weight, l.volume, l.distance_km,
  cu.name AS customer_user_name, cu.phone AS customer_phone, cc.name AS customer_name,
  ru.name AS carrier_user_name, ru.phone AS carrier_phone, rc.name AS carrier_name
FROM trips t JOIN listings l ON l.id = t.listing_id
JOIN users cu ON cu.id = t.customer_user JOIN companies cc ON cc.id = t.customer_company
JOIN users ru ON ru.id = t.carrier_user JOIN companies rc ON rc.id = t.carrier_company`;

function tripOut(t, viewer, full = false) {
  const points = L.j(t.l_points, []);
  const last = q1('SELECT lat, lon, speed, at FROM positions WHERE trip_id = ? ORDER BY id DESC LIMIT 1', t.id) || null;
  const dest = cityById.get(points[points.length - 1]);
  const remainingKm = last && dest ? Math.round(haversine(last, dest) * ROAD_FACTOR) : null;
  const role = viewer ? (t.carrier_company === viewer.company_id ? 'carrier' : 'customer') : null;
  const out = {
    id: t.id,
    status: t.status,
    stage: t.stage,
    shareGps: !!t.share_gps,
    points,
    listingId: t.listing_id,
    cargoType: t.cargo_type,
    bodyType: t.body_type,
    weight: t.weight,
    volume: t.volume,
    distanceKm: t.distance_km,
    price: t.price,
    currency: t.currency,
    createdAt: t.created_at,
    finishedAt: t.finished_at,
    carrier: { companyId: t.carrier_company, name: t.carrier_name, userName: t.carrier_user_name },
    customer: { companyId: t.customer_company, name: t.customer_name },
    position: last,
    remainingKm,
    etaHours: remainingKm !== null && t.stage === 'in_transit' ? Math.max(1, Math.round(remainingKm / 55)) : null,
  };
  if (viewer) {
    Object.assign(out, {
      myRole: role,
      trackToken: t.track_token,
      reviewed: !!q1('SELECT 1 FROM reviews WHERE trip_id = ? AND author_company = ?', t.id, viewer.company_id),
    });
    out.carrier.phone = t.carrier_phone;
    out.customer.phone = t.customer_phone;
    out.customer.userName = t.customer_user_name;
    out.chatId = q1(
      'SELECT id FROM chats WHERE listing_id = :l AND ((owner_id = :a AND peer_id = :b) OR (owner_id = :b AND peer_id = :a))',
      { l: t.listing_id, a: t.customer_user, b: t.carrier_user },
    )?.id || null;
  }
  if (full) {
    out.events = q('SELECT stage, at FROM trip_events WHERE trip_id = ? ORDER BY id', t.id);
    // трек прореживается до ~300 точек
    const track = q('SELECT lat, lon FROM positions WHERE trip_id = ? ORDER BY id', t.id);
    const step = Math.ceil(track.length / 300) || 1;
    out.track = track.filter((_, i) => i % step === 0 || i === track.length - 1).map((p) => [p.lat, p.lon]);
    if (viewer) out.reviews = q(
      `SELECT r.rating, r.text, r.created_at AS createdAt, c.name AS author FROM reviews r JOIN companies c ON c.id = r.author_company WHERE r.trip_id = ?`,
      t.id,
    );
  }
  return out;
}
function tripOf(req) {
  const t = q1(`${TRIP_SQL} WHERE t.id = ?`, Number(req.params.id));
  if (!t || (t.customer_company !== req.user.company_id && t.carrier_company !== req.user.company_id)) throw bad('not_found', 'Рейс не найден', 404);
  return t;
}
const tripUsers = (t) => [t.customer_user, t.carrier_user];

export default function dealRoutes(app) {
  // ---------- отклики ----------
  const respSchema = z.object({
    message: z.string().trim().min(1).max(1000),
    price: z.number().positive().max(1e9).nullable().optional(),
    currency: z.enum(L.CURRENCIES).default('KZT'),
  });
  app.post('/api/listings/:id/responses', auth, (req, res) => {
    L.requireNoPendingReviews(req.user);
    const b = parse(respSchema, req.body);
    const l = q1('SELECT * FROM listings WHERE id = ?', Number(req.params.id));
    if (!l || l.status !== 'active') throw bad('not_found', 'Объявление недоступно', 404);
    if (l.company_id === req.user.company_id) throw bad('own', 'Нельзя откликнуться на объявление своей компании');
    if (q1(`SELECT 1 FROM trips WHERE listing_id = ? AND status = 'active'`, l.id)) throw bad('in_trip', 'По объявлению уже идёт рейс', 409);
    if (q1(`SELECT 1 FROM responses WHERE listing_id = ? AND user_id = ? AND status = 'sent'`, l.id, req.user.id)) throw bad('duplicate', 'Вы уже откликнулись', 409);
    const out = tx(() => {
      const id = insert('INSERT INTO responses(listing_id, user_id, company_id, message, price, currency) VALUES(?, ?, ?, ?, ?, ?)',
        l.id, req.user.id, req.user.company_id, b.message, b.price ?? null, b.currency);
      run('INSERT OR IGNORE INTO chats(listing_id, owner_id, peer_id) VALUES(?, ?, ?)', l.id, l.user_id, req.user.id);
      const chatId = q1('SELECT id FROM chats WHERE listing_id = ? AND owner_id = ? AND peer_id = ?', l.id, l.user_id, req.user.id).id;
      return { id, chatId };
    });
    postMessage(out.chatId, req.user.id, b.price ? `${b.message}\n— ${b.price} ${b.currency}` : b.message);
    L.push(l.user_id, 'response', { listingId: l.id });
    res.json(out);
  });

  app.get('/api/responses', auth, (req, res) => {
    const rows = (where, p) =>
      q(
        `SELECT r.id, r.message, r.price, r.currency, r.status, r.created_at AS createdAt, r.listing_id AS listingId,
           l.kind, l.from_id AS fromId, l.to_id AS toId, l.status AS listingStatus, u.name AS userName, c.name AS companyName, c.id AS companyId,
           lc.name AS ownerCompany, lc.id AS ownerCompanyId,
           (SELECT id FROM chats ch WHERE ch.listing_id = r.listing_id AND ch.peer_id = r.user_id) AS chatId,
           (SELECT id FROM trips t WHERE t.response_id = r.id) AS tripId
         FROM responses r JOIN listings l ON l.id = r.listing_id JOIN users u ON u.id = r.user_id
         JOIN companies c ON c.id = r.company_id JOIN companies lc ON lc.id = l.company_id
         WHERE ${where} ORDER BY r.id DESC LIMIT 200`,
        p,
      );
    res.json({
      incoming: rows(`l.company_id = :c AND r.status != 'withdrawn'`, { c: req.user.company_id }),
      outgoing: rows('r.company_id = :c', { c: req.user.company_id }),
    });
  });

  app.post('/api/responses/:id/:action', auth, (req, res) => {
    const { action } = req.params;
    const r = q1(
      `SELECT r.*, l.company_id AS owner_company, l.user_id AS owner_user, l.kind, l.rate, l.currency AS l_currency
       FROM responses r JOIN listings l ON l.id = r.listing_id WHERE r.id = ?`,
      Number(req.params.id),
    );
    if (!r) throw bad('not_found', 'Отклик не найден', 404);
    if (r.status !== 'sent') throw bad('state', 'Отклик уже обработан', 409);
    const isOwner = r.owner_company === req.user.company_id;
    const isAuthor = r.company_id === req.user.company_id;
    let tripId = null;
    if (action === 'withdraw' && isAuthor) {
      run(`UPDATE responses SET status = 'withdrawn' WHERE id = ?`, r.id);
    } else if (action === 'decline' && isOwner) {
      run(`UPDATE responses SET status = 'declined' WHERE id = ?`, r.id);
    } else if (action === 'accept' && isOwner) {
      if (q1(`SELECT 1 FROM trips WHERE listing_id = ? AND status = 'active'`, r.listing_id)) throw bad('in_trip', 'По объявлению уже идёт рейс', 409);
      // заказчик — тот, чей груз; перевозчик — тот, чей транспорт
      const owner = { user: r.owner_user, company: r.owner_company };
      const peer = { user: r.user_id, company: r.company_id };
      const [customer, carrier] = r.kind === 'cargo' ? [owner, peer] : [peer, owner];
      tripId = tx(() => {
        run(`UPDATE responses SET status = 'accepted' WHERE id = ?`, r.id);
        const id = insert(
          `INSERT INTO trips(listing_id, response_id, customer_user, customer_company, carrier_user, carrier_company, price, currency, track_token)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          r.listing_id, r.id, customer.user, customer.company, carrier.user, carrier.company,
          r.price ?? r.rate ?? null, r.price ? r.currency : r.l_currency, L.token(12),
        );
        run(`INSERT INTO trip_events(trip_id, stage) VALUES(?, 'planned')`, id);
        return id;
      });
      L.push([r.owner_user, r.user_id], 'trip', { tripId });
    } else throw bad('forbidden', 'Действие недоступно', 403);
    L.push([r.owner_user, r.user_id], 'response', { listingId: r.listing_id });
    res.json({ ok: true, tripId });
  });

  // ---------- чат ----------
  app.get('/api/chats', auth, (req, res) => {
    res.json(
      q(
        `SELECT c.id, c.listing_id AS listingId, l.kind, l.from_id AS fromId, l.to_id AS toId,
           p.id AS peerId, p.name AS peerName, pc.name AS peerCompany, pc.id AS peerCompanyId,
           (SELECT text FROM messages m WHERE m.chat_id = c.id ORDER BY m.id DESC LIMIT 1) AS lastText,
           (SELECT created_at FROM messages m WHERE m.chat_id = c.id ORDER BY m.id DESC LIMIT 1) AS lastAt,
           (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id AND m.is_read = 0 AND m.sender_id != :u) AS unread
         FROM chats c JOIN listings l ON l.id = c.listing_id
         JOIN users p ON p.id = CASE WHEN c.owner_id = :u THEN c.peer_id ELSE c.owner_id END
         JOIN companies pc ON pc.id = p.company_id
         WHERE c.owner_id = :u OR c.peer_id = :u ORDER BY lastAt DESC`,
        { u: req.user.id },
      ),
    );
  });
  app.get('/api/chats/:id/messages', auth, (req, res) => {
    const chat = chatOf(req);
    const changed = run('UPDATE messages SET is_read = 1 WHERE chat_id = ? AND sender_id != ? AND is_read = 0', chat.id, req.user.id).changes;
    if (changed) L.push(chat.owner_id === req.user.id ? chat.peer_id : chat.owner_id, 'read', { chatId: chat.id });
    res.json(
      q('SELECT id, sender_id AS senderId, text, is_read AS isRead, created_at AS createdAt FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT 300', chat.id)
        .reverse()
        .map((m) => ({ ...m, isRead: !!m.isRead, mine: m.senderId === req.user.id })),
    );
  });
  app.post('/api/chats/:id/messages', auth, (req, res) => {
    const chat = chatOf(req);
    const { text } = parse(z.object({ text: z.string().trim().min(1).max(2000) }), req.body);
    res.json({ id: postMessage(chat.id, req.user.id, text) });
  });

  // ---------- рейсы ----------
  app.get('/api/trips', auth, (req, res) => {
    res.json(
      q(`${TRIP_SQL} WHERE t.customer_company = :c OR t.carrier_company = :c ORDER BY (t.status = 'active') DESC, t.id DESC LIMIT 200`, {
        c: req.user.company_id,
      }).map((t) => tripOut(t, req.user)),
    );
  });
  app.get('/api/trips/:id', auth, (req, res) => res.json(tripOut(tripOf(req), req.user, true)));

  // Публичная ссылка отслеживания — без входа и без контактов сторон.
  app.get('/api/track/:token', (req, res) => {
    const t = q1(`${TRIP_SQL} WHERE t.track_token = ?`, req.params.token);
    if (!t) throw bad('not_found', 'Ссылка недействительна', 404);
    const out = tripOut(t, null, true);
    if (!t.share_gps && t.status === 'active') Object.assign(out, { position: null, track: [], remainingKm: null, etaHours: null });
    res.json(out);
  });

  app.post('/api/trips/:id/stage', auth, (req, res) => {
    const t = tripOf(req);
    const { stage } = parse(z.object({ stage: z.enum(L.STAGES) }), req.body);
    if (t.carrier_company !== req.user.company_id) throw bad('forbidden', 'Этап отмечает перевозчик', 403);
    if (t.status !== 'active') throw bad('state', 'Рейс уже завершён', 409);
    if (L.STAGES.indexOf(stage) <= L.STAGES.indexOf(t.stage)) throw bad('state', 'Этап уже пройден', 409);
    // делиться GPS в пути обязательно
    if (stage !== 'planned' && !t.share_gps) throw bad('gps_required', 'Включите «Делиться GPS», чтобы начать рейс', 409);
    run('UPDATE trips SET stage = ? WHERE id = ?', stage, t.id);
    run('INSERT INTO trip_events(trip_id, stage) VALUES(?, ?)', t.id, stage);
    L.push(tripUsers(t), 'trip', { tripId: t.id });
    res.json({ ok: true });
  });

  app.post('/api/trips/:id/gps', auth, (req, res) => {
    const t = tripOf(req);
    const { share } = parse(z.object({ share: z.boolean() }), req.body);
    if (t.carrier_company !== req.user.company_id) throw bad('forbidden', 'GPS включает перевозчик', 403);
    if (!share && t.status === 'active' && t.stage !== 'planned') throw bad('gps_required', 'В пути отключить GPS нельзя', 409);
    run('UPDATE trips SET share_gps = ? WHERE id = ?', share ? 1 : 0, t.id);
    L.push(tripUsers(t), 'trip', { tripId: t.id });
    res.json({ ok: true });
  });

  const posSchema = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), speed: z.number().min(0).max(250).nullable().optional() });
  app.post('/api/trips/:id/position', auth, (req, res) => {
    const t = tripOf(req);
    const b = parse(posSchema, req.body);
    if (t.carrier_company !== req.user.company_id) throw bad('forbidden', 'Позицию передаёт перевозчик', 403);
    if (t.status !== 'active' || !t.share_gps) throw bad('state', 'Передача GPS выключена', 409);
    const last = q1('SELECT at FROM positions WHERE trip_id = ? ORDER BY id DESC LIMIT 1', t.id);
    if (last && Date.now() - Date.parse(last.at) < 1500) return res.json({ ok: true, skipped: true });
    run('INSERT INTO positions(trip_id, lat, lon, speed) VALUES(?, ?, ?, ?)', t.id, b.lat, b.lon, b.speed ?? null);
    L.push(tripUsers(t), 'position', { tripId: t.id, lat: b.lat, lon: b.lon, at: L.now() });
    res.json({ ok: true });
  });

  // Заказчик подтверждает доставку — рейс завершён, объявление уходит в «Закрытые».
  app.post('/api/trips/:id/complete', auth, (req, res) => {
    const t = tripOf(req);
    if (t.customer_company !== req.user.company_id) throw bad('forbidden', 'Завершение подтверждает заказчик', 403);
    if (t.status !== 'active') throw bad('state', 'Рейс уже завершён', 409);
    if (t.stage !== 'delivered') throw bad('state', 'Перевозчик ещё не отметил доставку', 409);
    tx(() => {
      run(`UPDATE trips SET status = 'completed', finished_at = ?, share_gps = 0 WHERE id = ?`, L.now(), t.id);
      run(`UPDATE listings SET status = 'closed', closed_at = ? WHERE id = ?`, L.now(), t.listing_id);
      run(`UPDATE responses SET status = 'declined' WHERE listing_id = ? AND status = 'sent'`, t.listing_id);
    });
    L.push(tripUsers(t), 'trip', { tripId: t.id });
    res.json({ ok: true });
  });

  app.post('/api/trips/:id/cancel', auth, (req, res) => {
    const t = tripOf(req);
    if (t.status !== 'active') throw bad('state', 'Рейс уже завершён', 409);
    if (L.STAGES.indexOf(t.stage) >= L.STAGES.indexOf('in_transit')) throw bad('state', 'Груз уже в пути — отменить нельзя', 409);
    run(`UPDATE trips SET status = 'cancelled', finished_at = ?, share_gps = 0 WHERE id = ?`, L.now(), t.id);
    L.push(tripUsers(t), 'trip', { tripId: t.id });
    res.json({ ok: true });
  });

  app.post('/api/trips/:id/review', auth, (req, res) => {
    const t = tripOf(req);
    const b = parse(z.object({ rating: z.number().int().min(1).max(5), text: z.string().trim().max(1000).default('') }), req.body);
    if (t.status !== 'completed') throw bad('state', 'Отзыв можно оставить после завершения рейса', 409);
    const target = t.customer_company === req.user.company_id ? t.carrier_company : t.customer_company;
    if (q1('SELECT 1 FROM reviews WHERE trip_id = ? AND author_company = ?', t.id, req.user.company_id)) throw bad('duplicate', 'Отзыв уже оставлен', 409);
    run('INSERT INTO reviews(trip_id, author_user, author_company, target_company, rating, text) VALUES(?, ?, ?, ?, ?, ?)',
      t.id, req.user.id, req.user.company_id, target, b.rating, b.text);
    res.json({ ok: true });
  });
}
