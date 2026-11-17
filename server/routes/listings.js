// Объявления о грузах и транспорте: размещение, поиск, подбор «по пути», отметки, сохранённые поиски и подписки на них.
import { z } from 'zod';
import { q, q1, run, insert, tx } from '../db.js';
import { cityById, haversine, routeFit } from '../geo.js';
import { route } from '../routing.js';
import { notify } from '../notify.js';
import { toKzt } from '../rates.js';
import * as L from '../lib.js';

const { bad, parse, auth, staff } = L;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// настоящая календарная дата, а не просто цифры по шаблону
const dateStr = z.string().regex(DATE).refine((d) => !isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d, 'Нет такой даты');
const num = (max) => z.number().positive().max(max).nullable().optional();
const cityId = z.string().refine((id) => cityById.has(id), 'Неизвестный город');

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
    adrClass: z.number().int().min(1).max(9).nullable().optional(),
    flags: z.array(z.enum(L.FLAGS)).default([]),
    dateFrom: dateStr,
    dateTo: dateStr,
    payTerms: z.array(z.enum(L.PAY)).default([]),
    rate: num(1e9),
    currency: z.enum(L.CURRENCIES).default('KZT'),
    description: z.string().trim().max(2000).default(''),
  })
  .refine((b) => b.dateTo >= b.dateFrom, 'Дата окончания раньше даты начала')
  .refine((b) => b.dateTo <= new Date(Date.now() + 180 * 86400_000).toISOString().slice(0, 10), 'Период размещения — не дальше полугода')
  .refine((b) => b.points.every((p, i) => i === 0 || p !== b.points[i - 1]), 'Соседние пункты маршрута совпадают');

const pts = (l) => l.points.map((id) => cityById.get(id)).filter(Boolean);
const n = (v) => (v === undefined || v === '' || v === null || isNaN(Number(v)) ? undefined : Number(v));

/** Насколько транспорт подходит грузу: 0–100 либо null, если не подходит. */
export function matchScore(cargo, truck) {
  const cp = pts(cargo);
  const detour = routeFit(pts(truck), cp[0], cp[cp.length - 1], 150);
  if (detour === null) return null;
  if (cargo.dateFrom > truck.dateTo || truck.dateFrom > cargo.dateTo) return null;
  if (cargo.weight && truck.weight && cargo.weight > truck.weight) return null;
  if (cargo.volume && truck.volume && cargo.volume > truck.volume) return null;
  // груз требует определённый кузов — машина с другим кузовом не подходит
  if (cargo.bodyType && truck.bodyType && cargo.bodyType !== truck.bodyType) return null;
  let score = 100 - detour / 3;
  if (cargo.loading.length && truck.loading.length && !cargo.loading.some((x) => truck.loading.includes(x))) score -= 15;
  return score >= 40 ? { score: Math.round(score), detourKm: detour } : null;
}

/**
 * Подходит ли объявление под условия фильтра. Один и тот же код работает и в поиске,
 * и в подписках: новое объявление проверяется по сохранённым поискам.
 */
export function passes(l, f) {
  const has = (v) => v !== undefined && v !== '' && v !== null;
  if (L.BODY.includes(f.body) && l.bodyType !== f.body) return false;
  if (L.CARGO.includes(f.cargoType) && l.cargoType !== f.cargoType) return false;
  if (n(f.wMin) !== undefined && !(l.weight >= n(f.wMin))) return false;
  if (n(f.wMax) !== undefined && !(l.weight <= n(f.wMax))) return false;
  if (n(f.vMin) !== undefined && !(l.volume >= n(f.vMin))) return false;
  if (n(f.vMax) !== undefined && !(l.volume <= n(f.vMax))) return false;
  if (L.CURRENCIES.includes(f.currency) && l.currency !== f.currency) return false;
  // границы ставки задаются в тенге; объявления в другой валюте пересчитываются по курсу Нацбанка
  const kzt = toKzt(l.rate, l.currency);
  if (n(f.rateMin) !== undefined && !(kzt >= n(f.rateMin))) return false;
  if (n(f.rateMax) !== undefined && !(l.rate && kzt <= n(f.rateMax))) return false;
  if (DATE.test(f.dateFrom || '') && l.dateTo < f.dateFrom) return false;
  if (DATE.test(f.dateTo || '') && l.dateFrom > f.dateTo) return false;
  const loading = String(f.loading || '').split(',').filter((x) => L.LOADING.includes(x));
  if (loading.length && !loading.some((x) => l.loading.includes(x))) return false;
  const pay = String(f.pay || '').split(',').filter((x) => L.PAY.includes(x));
  if (pay.length && !pay.some((x) => l.payTerms.includes(x))) return false;
  const flags = String(f.flags || '').split(',').filter((x) => L.FLAGS.includes(x));
  if (flags.length && !flags.every((x) => l.flags.includes(x))) return false;
  if (f.adr === '1' && !l.adrClass && l.cargoType !== 'adr') return false;
  if (f.withRate === '1' && !l.rate) return false;
  if (f.verified === '1' && l.company.verified !== 'verified') return false;
  if (f.noRed === '1' && l.company.indicator === 'red') return false;
  // «прямые» — объявления самих владельцев груза или машин, без посредников
  if (f.direct === '1' && !['customer', 'carrier', 'driver'].includes(l.company.kind)) return false;
  if (f.partners === '1' && !l.partner) return false;
  if (f.fresh === '1' && Date.now() - Date.parse(l.createdAt) > 24 * 3600_000) return false;
  if (f.intl === '1' && !l.international) return false;
  if (f.intl === '0' && l.international) return false;

  const from = cityById.get(f.from);
  const to = cityById.get(f.to);
  // по умолчанию ищем город с окрестностями: груз из Каскелена должен находиться по запросу «Алматы»
  const radius = Math.min(n(f.radius) ?? 50, 500);
  const route = pts(l);
  if (has(f.fromCountry) && route[0]?.country !== f.fromCountry) return false;
  if (has(f.toCountry) && route[route.length - 1]?.country !== f.toCountry) return false;
  if (l.kind === 'truck') {
    // транспорт подходит, если его маршрут проходит рядом с обеими точками в нужном порядке
    const detour = routeFit(route, from, to, Math.max(radius, 25));
    if (detour === null) return false;
    l.detourKm = detour;
  } else {
    const near = (a, b) => !b || (radius ? haversine(a, b) <= radius : a.id === b.id);
    if (!near(route[0], from) || !near(route[route.length - 1], to)) return false;
  }
  return true;
}

const ACTIVE = `l.status = 'active' AND l.date_to >= :today AND cs.banned = 0
  AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.listing_id = l.id AND t.status = 'active')`;
// скрытые пользователем объявления и компании из личного чёрного списка в выдачу не попадают
const VISIBLE = `COALESCE(m.hidden, 0) = 0
  AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.company_id = :viewerCompany AND b.blocked_id = l.company_id)`;

/** Встречные объявления, подходящие к данному. */
function matchesFor(user, listing, limit = 10) {
  const otherKind = listing.kind === 'cargo' ? 'truck' : 'cargo';
  return L.listings(user, `l.kind = :kind AND ${ACTIVE} AND ${VISIBLE} AND l.company_id != :company`, {
    kind: otherKind,
    today: L.today(),
    company: listing.company.id,
  }, 'ORDER BY l.id DESC LIMIT 1500')
    .map((o) => ({ ...o, match: listing.kind === 'cargo' ? matchScore(listing, o) : matchScore(o, listing) }))
    .filter((o) => o.match)
    .sort((a, b) => b.match.score - a.match.score)
    .slice(0, limit);
}

/**
 * Выборка цен для статистики и ориентира. Одна компания даёт по одному значению на направление (самое свежее) —
 * иначе рынок можно «нарисовать» пачкой одинаковых объявлений. Цены состоявшихся рейсов добавляются отдельно.
 */
export function priceSamples(kind, { bodyType = null, exceptId = 0 } = {}) {
  const since = new Date(Date.now() - 180 * 86400_000).toISOString();
  const rows = q(
    `SELECT l.id, l.company_id, l.from_id, l.to_id, l.rate, l.currency, l.distance_km AS km, l.body_type, l.weight, 0 AS deal
     FROM listings l JOIN companies c ON c.id = l.company_id
     WHERE l.kind = :kind AND l.rate > 0 AND l.distance_km > 50 AND l.status != 'removed' AND c.banned = 0 AND l.id != :id
       AND (c.verified = 'verified' OR EXISTS (SELECT 1 FROM trips t WHERE t.status = 'completed' AND (t.customer_company = c.id OR t.carrier_company = c.id)))
       AND (:body IS NULL OR l.body_type = :body) AND l.created_at > :since
     ORDER BY l.id DESC LIMIT 5000`,
    { kind, id: exceptId, body: bodyType, since },
  );
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const key = `${r.company_id}:${r.from_id}:${r.to_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...r, rate: toKzt(r.rate, r.currency) });
  }
  // цена, по которой рейс действительно состоялся, весомее объявления
  const deals = q(
    `SELECT t.carrier_company AS company_id, l.from_id, l.to_id, t.price AS rate, t.currency, l.distance_km AS km, l.body_type, l.weight, 1 AS deal
     FROM trips t JOIN listings l ON l.id = t.listing_id
     WHERE t.status = 'completed' AND t.price > 0 AND l.distance_km > 50 AND l.kind = :kind AND (:body IS NULL OR l.body_type = :body) AND t.finished_at > :since
     ORDER BY t.id DESC LIMIT 2000`,
    { kind, body: bodyType, since },
  );
  for (const r of deals) out.push({ ...r, rate: toKzt(r.rate, r.currency) });
  return out;
}

const kmBand = (km) => (km < 300 ? 0 : km < 1000 ? 1 : 2);
const weightBand = (w) => (w == null ? null : w <= 5 ? 0 : 1);
/**
 * Рыночный ориентир ₸/км (25-й, 50-й и 75-й процентили) по похожим перевозкам: тот же класс расстояния и веса,
 * по возможности тот же кузов. Нужны данные минимум от трёх компаний — иначе ориентира нет.
 */
export function marketRate(kind, { exceptId = 0, bodyType = null, km = null, weight = null } = {}) {
  const all = priceSamples(kind, { exceptId });
  const pick = (useBody, useWeight, useKm) =>
    all.filter((r) => (!useBody || !bodyType || r.body_type === bodyType) && (!useKm || km == null || kmBand(r.km) === kmBand(km))
      && (!useWeight || weight == null || weightBand(r.weight) === weightBand(weight)));
  for (const args of [[true, true, true], [false, true, true], [false, false, true], [false, false, false]]) {
    const rows = pick(...args);
    if (rows.length < 5 || new Set(rows.map((r) => r.company_id)).size < 3) continue;
    const perKm = rows.map((r) => r.rate / r.km).sort((x, y) => x - y);
    const at = (p) => Math.round(perKm[Math.floor((perKm.length - 1) * p)]);
    return { low: at(0.25), median: at(0.5), high: at(0.75), sample: perKm.length };
  }
  return null;
}

/** Сообщить подписчикам сохранённых поисков о новом объявлении. */
function alertSubscribers(listingId, author) {
  const subs = q(
    `SELECT s.id, s.name, s.params, u.id AS user_id, u.company_id, u.name AS user_name FROM searches s JOIN users u ON u.id = s.user_id
     WHERE s.notify = 1 AND s.kind = (SELECT kind FROM listings WHERE id = ?) AND u.company_id != ?`,
    listingId,
    author.company_id,
  );
  const sent = new Set();
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  for (const s of subs) {
    if (sent.has(s.user_id)) continue;
    // не больше одного уведомления в час от одной компании — пачка объявлений не превращается в спам
    if (q1(`SELECT 1 FROM notifications n WHERE n.user_id = ? AND n.kind = 'match' AND n.created_at > ? AND json_extract(n.vars, '$.by') = ?`, s.user_id, hourAgo, author.company_id)) continue;
    const viewer = { id: s.user_id, company_id: s.company_id };
    const [l] = L.listings(viewer, `l.id = :id AND ${VISIBLE}`, { id: listingId });
    if (!l || !passes(l, L.j(s.params, {}))) continue;
    sent.add(s.user_id);
    notify(s.user_id, {
      kind: 'match',
      title: l.kind === 'cargo' ? 'Новый груз: {route}' : 'Новая машина: {route}',
      body: 'По вашему поиску «{name}»',
      vars: { route: l.points, name: s.name, by: author.company_id },
      link: `/listing/${l.id}`,
    });
  }
}

const FILTER_KEYS = ['from', 'to', 'radius', 'fromCountry', 'toCountry', 'dateFrom', 'dateTo', 'body', 'cargoType', 'wMin', 'wMax', 'vMin', 'vMax', 'loading',
  'rateMin', 'rateMax', 'currency', 'pay', 'flags', 'adr', 'withRate', 'verified', 'noRed', 'direct', 'partners', 'fresh', 'intl', 'sort'];

/** Истёкшие объявления сами уходят в «Закрытые». */
export function expireListings() {
  run(`UPDATE listings SET status = 'closed', closed_at = ? WHERE status = 'active' AND date_to < ?
       AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.listing_id = listings.id AND t.status = 'active')`, L.now(), L.today());
}

export default function listingRoutes(app) {
  // ---- поиск ----
  app.get('/api/listings', auth, (req, res) => {
    const f = req.query;
    const kind = f.kind === 'truck' ? 'truck' : 'cargo';
    const items = L.listings(req.user, `l.kind = :kind AND ${ACTIVE} AND ${VISIBLE}`, { kind, today: L.today() }, 'ORDER BY l.id DESC LIMIT 5000').filter((l) => passes(l, f));
    const kzt = (l) => toKzt(l.rate, l.currency);
    const perKm = (l) => (l.rate && l.distanceKm ? kzt(l) / l.distanceKm : 0);
    const sorters = {
      new: (a, b) => Number(b.boosted) - Number(a.boosted) || b.id - a.id,
      rate_desc: (a, b) => kzt(b) - kzt(a),
      rate_asc: (a, b) => (kzt(a) || Infinity) - (kzt(b) || Infinity),
      rate_km: (a, b) => perKm(b) - perKm(a),
      weight_desc: (a, b) => (b.weight || 0) - (a.weight || 0),
      date_asc: (a, b) => a.dateFrom.localeCompare(b.dateFrom),
      distance_asc: (a, b) => a.distanceKm - b.distanceKm,
    };
    items.sort(Object.hasOwn(sorters, f.sort) ? sorters[f.sort] : sorters.new);
    res.json({ total: items.length, items: items.slice(0, 200) });
  });

  app.get('/api/listings/mine', auth, (req, res) => {
    const kind = req.query.kind === 'truck' ? 'truck' : 'cargo';
    res.json(L.listings(req.user, 'l.kind = :kind AND l.company_id = :c', { kind, c: req.user.company_id }, 'ORDER BY l.id DESC LIMIT 500'));
  });

  // Рекомендации на главной — зависят от роли.
  app.get('/api/recommendations', auth, (req, res) => {
    const role = req.user.role;
    const wants = role === 'customer' ? ['truck'] : role === 'logist' ? ['cargo', 'truck'] : ['cargo'];
    const mine = L.listings(req.user, `l.company_id = :c AND l.status = 'active'`, { c: req.user.company_id }, 'ORDER BY l.id DESC LIMIT 8');
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
        `l.kind = :kind AND ${ACTIVE} AND ${VISIBLE} AND l.company_id != :c`,
        { kind, today: L.today(), c: req.user.company_id, now: L.now() },
        `ORDER BY COALESCE(l.boosted_until > :now, 0) DESC, l.id DESC LIMIT ${role === 'broker' ? 80 : 12}`,
      ).filter((l) => !seen.has(l.id));
      // брокеру в первую очередь интересны международные перевозки — там нужна таможня
      // сначала — объявления, где заказчик прямо отметил «нужен таможенный брокер»
      const customs = (l) => (l.flags?.includes('customs') ? 2 : 0) + Number(l.international);
      if (role === 'broker') fresh.sort((a, b) => customs(b) - customs(a));
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
      req.user.id, id, marked ? 1 : 0, note, hidden ? 1 : 0,
    );
    res.json({ marked, note, hidden });
  });

  // ---- сохранённые поиски и подписки ----
  const alertLimit = (user) => (q1('SELECT pro FROM company_stats WHERE id = ?', user.company_id).pro ? L.PLAN.pro.alerts : L.PLAN.free.alerts);
  app.get('/api/searches', auth, (req, res) => {
    res.json(
      q('SELECT id, kind, name, params, notify FROM searches WHERE user_id = ? ORDER BY id DESC', req.user.id).map((s) => ({ ...s, notify: !!s.notify, params: L.j(s.params, {}) })),
    );
  });
  app.post('/api/searches', auth, (req, res) => {
    const b = parse(z.object({ kind: z.enum(['cargo', 'truck']), name: z.string().trim().min(1).max(80), params: z.record(z.enum(FILTER_KEYS), z.string().max(120)), notify: z.boolean().default(false) }), req.body);
    if (q1('SELECT COUNT(*) AS n FROM searches WHERE user_id = ?', req.user.id).n >= 30) throw bad('limit', 'Не более 30 сохранённых поисков');
    if (b.notify && q1('SELECT COUNT(*) AS n FROM searches WHERE user_id = ? AND notify = 1', req.user.id).n >= alertLimit(req.user)) b.notify = false;
    res.json({ id: insert('INSERT INTO searches(user_id, kind, name, params, notify) VALUES(?, ?, ?, ?, ?)', req.user.id, b.kind, b.name, JSON.stringify(b.params), b.notify ? 1 : 0), notify: b.notify });
  });
  app.patch('/api/searches/:id', auth, (req, res) => {
    const { notify: on } = parse(z.object({ notify: z.boolean() }), req.body);
    const limit = alertLimit(req.user);
    if (on && q1('SELECT COUNT(*) AS n FROM searches WHERE user_id = ? AND notify = 1 AND id != ?', req.user.id, Number(req.params.id)).n >= limit)
      throw bad('alert_limit', `На вашем тарифе доступно подписок: ${limit}. Тариф Pro снимает ограничение.`, 402);
    run('UPDATE searches SET notify = ? WHERE id = ? AND user_id = ?', on ? 1 : 0, Number(req.params.id), req.user.id);
    res.json({ ok: true });
  });
  app.delete('/api/searches/:id', auth, (req, res) => {
    run('DELETE FROM searches WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
    res.json({ ok: true });
  });

  // ---- размещение и управление ----
  const save = async (b) => {
    const { km } = await route(b.points.map((id) => cityById.get(id)));
    return [
      JSON.stringify(b.points), b.points[0], b.points[b.points.length - 1], b.brand, b.bodyType ?? null, b.cargoType ?? null,
      b.weight ?? null, b.volume ?? null, JSON.stringify(b.loading), b.dateFrom, b.dateTo, JSON.stringify(b.payTerms),
      b.rate ?? null, b.currency, b.description, km, b.adrClass ?? null, JSON.stringify(b.flags),
    ];
  };
  app.post('/api/listings', auth, staff, async (req, res) => {
    L.requireActiveCompany(req.user);
    L.requireNoPendingReviews(req.user);
    const b = parse(listingSchema, req.body);
    if (b.dateTo < L.today()) throw bad('validation', 'Период размещения уже прошёл');
    const c = req.user.company_id;
    const cap = q1('SELECT pro FROM company_stats WHERE id = ?', c).pro ? L.LIMITS.activePro : L.LIMITS.activeFree;
    if (q1(`SELECT COUNT(*) AS n FROM listings WHERE company_id = ? AND status = 'active'`, c).n >= cap)
      throw bad('limit', `Активных объявлений может быть не больше ${cap}. Закройте неактуальные`, 429);
    if (q1('SELECT COUNT(*) AS n FROM listings WHERE company_id = ? AND created_at > ?', c, new Date(Date.now() - 3600_000).toISOString()).n >= L.LIMITS.perHour)
      throw bad('rate_limit', 'Слишком много объявлений за час — попробуйте позже', 429);
    if (q1(`SELECT 1 FROM listings WHERE company_id = ? AND status = 'active' AND kind = ? AND points = ? AND date_from = ? AND date_to = ?
              AND COALESCE(weight, 0) = ? AND COALESCE(body_type, '') = ?`, c, b.kind, JSON.stringify(b.points), b.dateFrom, b.dateTo, b.weight ?? 0, b.bodyType ?? ''))
      throw bad('duplicate', 'Такое объявление у вас уже размещено', 409);
    // снятое модератором нельзя просто разместить заново
    if (q1(`SELECT 1 FROM listings WHERE company_id = ? AND status = 'removed' AND kind = ? AND from_id = ? AND to_id = ? AND closed_at > ?`,
      c, b.kind, b.points[0], b.points[b.points.length - 1], new Date(Date.now() - 30 * 86400_000).toISOString()))
      throw bad('removed', 'Такое объявление недавно снял модератор. Если это ошибка, напишите в поддержку', 409);
    const id = insert(
      `INSERT INTO listings(kind, user_id, company_id, points, from_id, to_id, brand, body_type, cargo_type, weight, volume, loading,
         date_from, date_to, pay_terms, rate, currency, description, distance_km, adr_class, flags)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      b.kind, req.user.id, req.user.company_id, ...(await save(b)),
    );
    res.json({ id });
    try {
      alertSubscribers(id, req.user);
    } catch (e) {
      console.error('[alerts]', e); // сбой рассылки не должен ломать размещение
    }
  });

  const own = (req) => {
    const l = q1('SELECT * FROM listings WHERE id = ?', Number(req.params.id));
    if (!l) throw bad('not_found', 'Объявление не найдено', 404);
    if (l.company_id !== req.user.company_id) throw bad('forbidden', 'Это не ваше объявление', 403);
    return l;
  };
  app.put('/api/listings/:id', auth, staff, async (req, res) => {
    const l = own(req);
    if (l.status === 'removed') throw bad('removed', 'Объявление снято модератором', 403);
    // условия, о которых уже договорились, задним числом не меняются
    if (q1(`SELECT 1 FROM trips WHERE listing_id = ? AND status = 'active'`, l.id)) throw bad('in_trip', 'По объявлению идёт рейс — изменить его нельзя', 409);
    const b = parse(listingSchema, { ...req.body, kind: l.kind });
    run(
      `UPDATE listings SET points = ?, from_id = ?, to_id = ?, brand = ?, body_type = ?, cargo_type = ?, weight = ?, volume = ?, loading = ?,
         date_from = ?, date_to = ?, pay_terms = ?, rate = ?, currency = ?, description = ?, distance_km = ?, adr_class = ?, flags = ? WHERE id = ?`,
      ...(await save(b)), l.id,
    );
    res.json({ id: l.id });
  });
  app.post('/api/listings/:id/status', auth, staff, (req, res) => {
    const l = own(req);
    if (l.status === 'removed') throw bad('removed', 'Объявление снято модератором — вернуть его нельзя', 403);
    const { status } = parse(z.object({ status: z.enum(['active', 'closed', 'archived']) }), req.body);
    if (q1(`SELECT 1 FROM trips WHERE listing_id = ? AND status = 'active'`, l.id)) throw bad('in_trip', 'По объявлению идёт рейс — сначала завершите его', 409);
    if (status === 'active') {
      L.requireActiveCompany(req.user);
      // по объявлению уже был рейс — это история сделки; для новой перевозки объявление размещают заново
      if (q1(`SELECT 1 FROM trips WHERE listing_id = ? AND status IN ('completed', 'failed')`, l.id)) throw bad('state', 'По этому объявлению уже был рейс. Нажмите «Разместить снова»', 409);
      if (l.date_to < L.today()) throw bad('state', 'Срок объявления истёк. Нажмите «Разместить снова»', 409);
    }
    run('UPDATE listings SET status = ?, closed_at = ? WHERE id = ?', status, status === 'active' ? null : L.now(), l.id);
    if (status !== 'active') run(`UPDATE responses SET status = 'declined' WHERE listing_id = ? AND status = 'sent'`, l.id);
    res.json({ ok: true });
  });
  app.post('/api/listings/:id/boost', auth, staff, (req, res) => {
    const l = own(req);
    if (l.status !== 'active') throw bad('state', 'Поднять можно только активное объявление', 409);
    tx(() => {
      const c = q1('SELECT cs.pro, c.balance FROM companies c JOIN company_stats cs ON cs.id = c.id WHERE c.id = ?', req.user.company_id);
      // на тарифе Pro поднятие в топ входит в подписку, но не безлимитно — иначе одна компания займёт всю первую страницу
      if (c.pro && q1('SELECT COUNT(*) AS n FROM listings WHERE company_id = ? AND boosted_until > ?', req.user.company_id, L.now()).n >= L.LIMITS.boostsPro)
        throw bad('limit', `Одновременно в топе может быть не больше ${L.LIMITS.boostsPro} объявлений`, 429);
      if (!c.pro) {
        if (c.balance < L.BOOST_PRICE) throw bad('balance', 'Недостаточно средств на балансе', 402);
        run('UPDATE companies SET balance = balance - ? WHERE id = ?', L.BOOST_PRICE, req.user.company_id);
        run(`INSERT INTO transactions(company_id, amount, kind, note) VALUES(?, ?, 'boost', ?)`, req.user.company_id, -L.BOOST_PRICE, `Объявление №${l.id}`);
      }
      run('UPDATE listings SET boosted_until = ? WHERE id = ?', new Date(Date.now() + 24 * 3600_000).toISOString(), l.id);
    });
    res.json({ ok: true });
  });

  // ---- карточка ----
  app.get('/api/listings/:id', auth, (req, res) => {
    const id = Number(req.params.id);
    const own0 = q1('SELECT company_id FROM listings WHERE id = ?', id);
    if (!own0) throw bad('not_found', 'Объявление не найдено', 404);
    // просмотры считаем по одному на пользователя в день, свои не считаем
    if (own0.company_id !== req.user.company_id) {
      const first = run('INSERT OR IGNORE INTO listing_views(listing_id, user_id, day) VALUES(?, ?, ?)', id, req.user.id, L.today()).changes;
      if (first) run('UPDATE listings SET views = views + 1 WHERE id = ?', id);
    }
    const [l] = L.listings(req.user, 'l.id = :id', { id });
    const out = { ...l, market: marketRate(l.kind, { exceptId: l.id, bodyType: l.bodyType, km: l.distanceKm, weight: l.weight }), matches: l.mine && l.status === 'active' ? matchesFor(req.user, l) : [] };
    if (l.mine) {
      out.responses = q(
        `SELECT r.id, r.message, r.price, r.currency, r.status, r.created_at AS createdAt, r.user_id AS userId, u.name AS userName, u.phone, u.settings, u.company_id AS u_company,
           r.company_id, ${L.COMPANY_COLS('cs', 'c_')},
           (SELECT id FROM chats c WHERE c.listing_id = r.listing_id AND c.peer_id = r.user_id) AS chatId
         FROM responses r JOIN users u ON u.id = r.user_id JOIN company_stats cs ON cs.id = r.company_id
         WHERE r.listing_id = ? AND r.status != 'withdrawn' ORDER BY r.id DESC`,
        l.id,
      ).map((r) => ({ id: r.id, message: r.message, price: r.price, currency: r.currency, status: r.status, createdAt: r.createdAt, chatId: r.chatId,
        user: { id: r.userId, name: r.userName, phone: L.phoneFor(req.user, { phone: r.phone, settings: r.settings, company_id: r.u_company }) }, company: L.companyOut(r, 'c_') }));
    } else if (l.myResponse) {
      out.chatId = q1('SELECT id FROM chats WHERE listing_id = ? AND peer_id = ?', l.id, req.user.id)?.id || null;
    }
    res.json(out);
  });
}
