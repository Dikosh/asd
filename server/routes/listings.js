// Объявления о грузах и транспорте: размещение, поиск, подбор «по пути», отметки, сохранённые поиски.
import { z } from 'zod';
import { q, q1, run, insert, tx } from '../db.js';
import { cityById, haversine, roadKm, routeFit } from '../geo.js';
import * as L from '../lib.js';

const { bad, parse, auth } = L;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const num = (max) => z.number().positive().max(max).nullable().optional();
const cityId = z.string().refine((id) => cityById.has(id), 'неизвестный город');

const listingSchema = z
  .object({
    kind: z.enum(['cargo', 'truck']),
    points: z.array(cityId).min(2).max(8),
    brand: z.string().trim().max(60).default(''),
    bodyType: z.enum(L.BODY).nullable().optional(),
    cargoType: z.enum(L.CARGO).nullable().optional(),
    weight: num(500),
    volume: num(1000),
    loading: z.array(z.enum(L.LOADING)).default([]),
    dateFrom: dateStr,
    dateTo: dateStr,
    payTerms: z.array(z.enum(L.PAY)).default([]),
    rate: num(1e9),
    currency: z.enum(L.CURRENCIES).default('KZT'),
    description: z.string().trim().max(2000).default(''),
  })
  .refine((b) => b.dateTo >= b.dateFrom, 'дата окончания раньше даты начала')
  .refine((b) => b.points.every((p, i) => i === 0 || p !== b.points[i - 1]), 'соседние пункты маршрута совпадают');

const pts = (l) => l.points.map((id) => cityById.get(id)).filter(Boolean);

/** Насколько транспорт подходит грузу: 0–100 либо null, если не подходит. */
export function matchScore(cargo, truck) {
  const cp = pts(cargo);
  const detour = routeFit(pts(truck), cp[0], cp[cp.length - 1], 150);
  if (detour === null) return null;
  if (cargo.dateFrom > truck.dateTo || truck.dateFrom > cargo.dateTo) return null;
  if (cargo.weight && truck.weight && cargo.weight > truck.weight) return null;
  if (cargo.volume && truck.volume && cargo.volume > truck.volume) return null;
  let score = 100 - detour / 3;
  if (cargo.bodyType && truck.bodyType && cargo.bodyType !== truck.bodyType) score -= 30;
  if (cargo.loading.length && truck.loading.length && !cargo.loading.some((x) => truck.loading.includes(x))) score -= 15;
  return score >= 40 ? { score: Math.round(score), detourKm: detour } : null;
}

const ACTIVE = `l.status = 'active' AND l.date_to >= :today
  AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.listing_id = l.id AND t.status = 'active')`;

/** Встречные объявления, подходящие к данному. */
function matchesFor(user, listing, limit = 10) {
  const otherKind = listing.kind === 'cargo' ? 'truck' : 'cargo';
  return L.listings(user, `l.kind = :kind AND ${ACTIVE} AND l.company_id != :company`, {
    kind: otherKind,
    today: L.today(),
    company: listing.company.id,
  })
    .map((o) => ({ ...o, match: listing.kind === 'cargo' ? matchScore(listing, o) : matchScore(o, listing) }))
    .filter((o) => o.match && !o.mark.hidden)
    .sort((a, b) => b.match.score - a.match.score)
    .slice(0, limit);
}

/** Рыночный ориентир: медианная ставка ₸/км по похожим объявлениям. */
function marketRate(listing) {
  const rows = q(
    `SELECT rate, distance_km FROM listings WHERE kind = ? AND currency = 'KZT' AND rate > 0 AND distance_km > 50 AND id != ?
     ORDER BY id DESC LIMIT 400`,
    listing.kind,
    listing.id,
  );
  const perKm = rows.map((r) => r.rate / r.distance_km).sort((a, b) => a - b);
  if (perKm.length < 5) return null;
  const at = (p) => Math.round(perKm[Math.floor((perKm.length - 1) * p)]);
  return { low: at(0.25), median: at(0.5), high: at(0.75), sample: perKm.length };
}

export default function listingRoutes(app) {
  // ---- поиск ----
  app.get('/api/listings', auth, (req, res) => {
    const f = req.query;
    const kind = f.kind === 'truck' ? 'truck' : 'cargo';
    const where = [`l.kind = :kind`, ACTIVE, 'COALESCE(m.hidden, 0) = 0'];
    const p = { kind, today: L.today() };
    const add = (cond, key, value) => {
      if (value === undefined || value === '' || value === null) return;
      where.push(cond);
      p[key] = value;
    };
    const n = (v) => (v === undefined || v === '' || isNaN(Number(v)) ? undefined : Number(v));
    add('l.body_type = :body', 'body', L.BODY.includes(f.body) ? f.body : undefined);
    add('l.cargo_type = :cargo', 'cargo', L.CARGO.includes(f.cargoType) ? f.cargoType : undefined);
    add('l.weight >= :wMin', 'wMin', n(f.wMin));
    add('l.weight <= :wMax', 'wMax', n(f.wMax));
    add('l.volume >= :vMin', 'vMin', n(f.vMin));
    add('l.volume <= :vMax', 'vMax', n(f.vMax));
    add('l.rate >= :rMin', 'rMin', n(f.rateMin));
    add('l.rate <= :rMax', 'rMax', n(f.rateMax));
    if (n(f.rateMin) !== undefined || n(f.rateMax) !== undefined || f.sort?.startsWith('rate')) {
      add('l.currency = :cur', 'cur', L.CURRENCIES.includes(f.currency) ? f.currency : 'KZT');
    } else add('l.currency = :cur', 'cur', L.CURRENCIES.includes(f.currency) ? f.currency : undefined);
    add('l.date_to >= :dFrom', 'dFrom', /^\d{4}-\d{2}-\d{2}$/.test(f.dateFrom || '') ? f.dateFrom : undefined);
    add('l.date_from <= :dTo', 'dTo', /^\d{4}-\d{2}-\d{2}$/.test(f.dateTo || '') ? f.dateTo : undefined);

    const from = cityById.get(f.from);
    const to = cityById.get(f.to);
    const radius = Math.min(n(f.radius) ?? 0, 500);
    const loading = String(f.loading || '').split(',').filter((x) => L.LOADING.includes(x));
    let items = L.listings(req.user, where.join(' AND '), p).filter((l) => {
      if (loading.length && !loading.some((x) => l.loading.includes(x))) return false;
      const route = pts(l);
      if (kind === 'truck') {
        // транспорт подходит, если его маршрут проходит рядом с обеими точками в нужном порядке
        const detour = routeFit(route, from, to, Math.max(radius, 25));
        if (detour === null) return false;
        l.detourKm = detour;
      } else {
        const near = (a, b) => !b || (radius ? haversine(a, b) <= radius : a.id === b.id);
        if (!near(route[0], from) || !near(route[route.length - 1], to)) return false;
      }
      return true;
    });

    const perKm = (l) => (l.rate && l.distanceKm ? l.rate / l.distanceKm : 0);
    const sorters = {
      new: (a, b) => Number(b.boosted) - Number(a.boosted) || b.id - a.id,
      rate_desc: (a, b) => (b.rate || 0) - (a.rate || 0),
      rate_asc: (a, b) => (a.rate || Infinity) - (b.rate || Infinity),
      rate_km: (a, b) => perKm(b) - perKm(a),
      weight_desc: (a, b) => (b.weight || 0) - (a.weight || 0),
      date_asc: (a, b) => a.dateFrom.localeCompare(b.dateFrom),
      distance_asc: (a, b) => a.distanceKm - b.distanceKm,
    };
    items.sort(sorters[f.sort] || sorters.new);
    res.json({ total: items.length, items: items.slice(0, 200) });
  });

  app.get('/api/listings/mine', auth, (req, res) => {
    const kind = req.query.kind === 'truck' ? 'truck' : 'cargo';
    res.json(L.listings(req.user, 'l.kind = :kind AND l.company_id = :c', { kind, c: req.user.company_id }));
  });

  // Рекомендации на главной — зависят от роли.
  app.get('/api/recommendations', auth, (req, res) => {
    const role = req.user.role;
    const wants = role === 'customer' ? ['truck'] : role === 'logist' ? ['cargo', 'truck'] : ['cargo'];
    const mine = L.listings(req.user, `l.company_id = :c AND l.status = 'active'`, { c: req.user.company_id });
    const out = [];
    for (const kind of wants) {
      const seen = new Set();
      const matched = [];
      for (const own of mine.filter((l) => l.kind !== kind)) {
        for (const m of matchesFor(req.user, own, 6)) {
          if (!seen.has(m.id)) {
            seen.add(m.id);
            matched.push({ ...m, matchFor: own.id });
          }
        }
      }
      matched.sort((a, b) => b.match.score - a.match.score);
      const fresh = L.listings(
        req.user,
        `l.kind = :kind AND ${ACTIVE} AND l.company_id != :c AND COALESCE(m.hidden, 0) = 0`,
        { kind, today: L.today(), c: req.user.company_id, now: L.now() },
        `ORDER BY COALESCE(l.boosted_until > :now, 0) DESC, l.id DESC LIMIT ${role === 'broker' ? 80 : 12}`,
      ).filter((l) => !seen.has(l.id));
      // брокеру в первую очередь интересны международные перевозки — там нужна таможня
      if (role === 'broker') fresh.sort((a, b) => Number(b.international) - Number(a.international));
      out.push({ kind, items: [...matched, ...fresh].slice(0, 8) });
    }
    res.json(out);
  });

  // ---- отметки и скрытые ----
  app.get('/api/marks', auth, (req, res) => {
    const hidden = req.query.hidden === '1';
    res.json(L.listings(req.user, hidden ? 'm.hidden = 1' : `m.hidden = 0 AND (m.marked = 1 OR m.note != '')`));
  });
  const markSchema = z.object({ marked: z.boolean().optional(), note: z.string().max(500).optional(), hidden: z.boolean().optional() });
  app.post('/api/listings/:id/mark', auth, (req, res) => {
    const b = parse(markSchema, req.body);
    const id = Number(req.params.id);
    if (!q1('SELECT 1 FROM listings WHERE id = ?', id)) throw bad('not_found', 'Объявление не найдено', 404);
    const cur = q1('SELECT * FROM marks WHERE user_id = ? AND listing_id = ?', req.user.id, id) || { marked: 0, note: '', hidden: 0 };
    const note = b.note ?? cur.note;
    // заметка работает вместе с отметкой
    const marked = b.marked ?? (b.note ? true : !!cur.marked);
    const hidden = b.hidden ?? !!cur.hidden;
    run(
      `INSERT INTO marks(user_id, listing_id, marked, note, hidden) VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(user_id, listing_id) DO UPDATE SET marked = excluded.marked, note = excluded.note, hidden = excluded.hidden`,
      req.user.id,
      id,
      marked ? 1 : 0,
      note,
      hidden ? 1 : 0,
    );
    res.json({ marked, note, hidden });
  });

  // ---- сохранённые поиски ----
  app.get('/api/searches', auth, (req, res) => {
    res.json(q('SELECT id, kind, name, params FROM searches WHERE user_id = ? ORDER BY id DESC', req.user.id).map((s) => ({ ...s, params: L.j(s.params, {}) })));
  });
  app.post('/api/searches', auth, (req, res) => {
    const b = parse(z.object({ kind: z.enum(['cargo', 'truck']), name: z.string().trim().min(1).max(80), params: z.record(z.string()) }), req.body);
    if (q1('SELECT COUNT(*) AS n FROM searches WHERE user_id = ?', req.user.id).n >= 30) throw bad('limit', 'Не более 30 сохранённых поисков');
    res.json({ id: insert('INSERT INTO searches(user_id, kind, name, params) VALUES(?, ?, ?, ?)', req.user.id, b.kind, b.name, JSON.stringify(b.params)) });
  });
  app.delete('/api/searches/:id', auth, (req, res) => {
    run('DELETE FROM searches WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
    res.json({ ok: true });
  });

  // ---- размещение и управление ----
  const save = (b) => {
    const route = b.points.map((id) => cityById.get(id));
    return [
      JSON.stringify(b.points), b.points[0], b.points[b.points.length - 1], b.brand, b.bodyType ?? null, b.cargoType ?? null,
      b.weight ?? null, b.volume ?? null, JSON.stringify(b.loading), b.dateFrom, b.dateTo, JSON.stringify(b.payTerms),
      b.rate ?? null, b.currency, b.description, roadKm(route),
    ];
  };
  app.post('/api/listings', auth, (req, res) => {
    L.requireNoPendingReviews(req.user);
    const b = parse(listingSchema, req.body);
    if (b.dateTo < L.today()) throw bad('validation', 'Период размещения уже прошёл');
    const id = insert(
      `INSERT INTO listings(kind, user_id, company_id, points, from_id, to_id, brand, body_type, cargo_type, weight, volume, loading,
         date_from, date_to, pay_terms, rate, currency, description, distance_km) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      b.kind, req.user.id, req.user.company_id, ...save(b),
    );
    res.json({ id });
  });

  const own = (req) => {
    const l = q1('SELECT * FROM listings WHERE id = ?', Number(req.params.id));
    if (!l) throw bad('not_found', 'Объявление не найдено', 404);
    if (l.company_id !== req.user.company_id) throw bad('forbidden', 'Это не ваше объявление', 403);
    return l;
  };
  app.put('/api/listings/:id', auth, (req, res) => {
    const l = own(req);
    const b = parse(listingSchema, { ...req.body, kind: l.kind });
    run(
      `UPDATE listings SET points = ?, from_id = ?, to_id = ?, brand = ?, body_type = ?, cargo_type = ?, weight = ?, volume = ?, loading = ?,
         date_from = ?, date_to = ?, pay_terms = ?, rate = ?, currency = ?, description = ?, distance_km = ? WHERE id = ?`,
      ...save(b), l.id,
    );
    res.json({ id: l.id });
  });
  app.post('/api/listings/:id/status', auth, (req, res) => {
    const l = own(req);
    const { status } = parse(z.object({ status: z.enum(['active', 'closed', 'archived']) }), req.body);
    if (q1(`SELECT 1 FROM trips WHERE listing_id = ? AND status = 'active'`, l.id)) throw bad('in_trip', 'По объявлению идёт рейс — сначала завершите его', 409);
    run('UPDATE listings SET status = ?, closed_at = ? WHERE id = ?', status, status === 'active' ? null : L.now(), l.id);
    if (status !== 'active') run(`UPDATE responses SET status = 'declined' WHERE listing_id = ? AND status = 'sent'`, l.id);
    res.json({ ok: true });
  });
  app.post('/api/listings/:id/boost', auth, (req, res) => {
    const l = own(req);
    tx(() => {
      const c = q1('SELECT balance FROM companies WHERE id = ?', req.user.company_id);
      if (c.balance < L.BOOST_PRICE) throw bad('balance', 'Недостаточно средств на балансе', 402);
      run('UPDATE companies SET balance = balance - ? WHERE id = ?', L.BOOST_PRICE, req.user.company_id);
      run(`INSERT INTO transactions(company_id, amount, kind, note) VALUES(?, ?, 'boost', ?)`, req.user.company_id, -L.BOOST_PRICE, `Объявление №${l.id}`);
      run('UPDATE listings SET boosted_until = ? WHERE id = ?', new Date(Date.now() + 24 * 3600_000).toISOString(), l.id);
    });
    res.json({ ok: true });
  });

  // ---- карточка ----
  app.get('/api/listings/:id', auth, (req, res) => {
    const [l] = L.listings(req.user, 'l.id = :id', { id: Number(req.params.id) });
    if (!l) throw bad('not_found', 'Объявление не найдено', 404);
    const out = { ...l, market: marketRate(l), matches: l.mine && l.status === 'active' ? matchesFor(req.user, l) : [] };
    if (l.mine) {
      out.responses = q(
        `SELECT r.id, r.message, r.price, r.currency, r.status, r.created_at AS createdAt, r.user_id AS userId, u.name AS userName, u.phone,
           r.company_id, ${L.COMPANY_COLS('cs', 'c_')},
           (SELECT id FROM chats c WHERE c.listing_id = r.listing_id AND c.peer_id = r.user_id) AS chatId
         FROM responses r JOIN users u ON u.id = r.user_id JOIN company_stats cs ON cs.id = r.company_id
         WHERE r.listing_id = ? AND r.status != 'withdrawn' ORDER BY r.id DESC`,
        l.id,
      ).map((r) => ({ id: r.id, message: r.message, price: r.price, currency: r.currency, status: r.status, createdAt: r.createdAt, chatId: r.chatId,
        user: { id: r.userId, name: r.userName, phone: r.phone }, company: L.companyOut(r, 'c_') }));
    } else if (l.myResponse) {
      out.chatId = q1('SELECT id FROM chats WHERE listing_id = ? AND peer_id = ?', l.id, req.user.id)?.id || null;
    }
    res.json(out);
  });
}
