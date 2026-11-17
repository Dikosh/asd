// Уведомления и push, команда и тариф, партнёры и личный чёрный список, жалобы, статистика цен,
// калькуляторы, курсы валют, новости, обратная связь и сводка для модератора.
import { z } from 'zod';
import { q, q1, run, insert, tx } from '../db.js';
import { cityById } from '../geo.js';
import { route } from '../routing.js';
import { notify, pushPublicKey } from '../notify.js';
import { marketRate } from './listings.js';
import * as L from '../lib.js';

const { bad, parse, auth } = L;
const id = (req) => Number(req.params.id);

// ---------- курсы Национального банка ----------
let rates = { at: 0, data: null };
async function loadRates() {
  if (Date.now() - rates.at < 6 * 3600_000) return rates.data;
  try {
    const xml = await (await fetch('https://nationalbank.kz/rss/rates_all.xml', { signal: AbortSignal.timeout(6000) })).text();
    const out = {};
    for (const m of xml.matchAll(/<item>\s*<title>([A-Z]{3})<\/title>\s*<pubDate>([^<]*)<\/pubDate>\s*<description>([\d.]+)<\/description>\s*<quant>(\d+)<\/quant>/g)) {
      out[m[1]] = { rate: Number(m[3]) / Number(m[4]), date: m[2] };
    }
    if (out.USD) rates = { at: Date.now(), data: out };
  } catch {
    rates.at = Date.now() - 6 * 3600_000 + 10 * 60_000; // не вышло — повторим через 10 минут
  }
  return rates.data;
}

export default function extraRoutes(app) {
  // ---------- уведомления ----------
  app.get('/api/notifications', auth, (req, res) => {
    res.json(
      q('SELECT id, kind, title, body, link, vars, is_read AS isRead, created_at AS createdAt FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 60', req.user.id)
        .map((x) => ({ ...x, isRead: !!x.isRead, vars: L.j(x.vars, {}) })),
    );
  });
  app.post('/api/notifications/read', auth, (req, res) => {
    const one = Number(req.body?.id);
    if (one) run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', one, req.user.id);
    else run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', req.user.id);
    res.json({ ok: true });
  });
  app.get('/api/push/key', auth, (_req, res) => res.json({ key: pushPublicKey }));
  const subSchema = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) });
  app.post('/api/push/subscribe', auth, (req, res) => {
    const b = parse(subSchema, req.body);
    run(
      `INSERT INTO push_subs(user_id, endpoint, keys) VALUES(?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, keys = excluded.keys`,
      req.user.id, b.endpoint, JSON.stringify(b.keys),
    );
    res.json({ ok: true });
  });
  app.post('/api/push/unsubscribe', auth, (req, res) => {
    run('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?', String(req.body?.endpoint || ''), req.user.id);
    res.json({ ok: true });
  });
  app.post('/api/push/test', auth, (req, res) => {
    notify(req.user.id, { kind: 'system', title: 'Уведомления включены', body: 'Так будут приходить новые отклики и подходящие грузы.', link: '/notifications' });
    res.json({ ok: true });
  });

  // ---------- команда: несколько сотрудников в одной компании ----------
  const seats = (companyId) => (q1('SELECT pro FROM company_stats WHERE id = ?', companyId).pro ? L.PLAN.pro.seats : L.PLAN.free.seats);
  app.get('/api/team', auth, (req, res) => {
    res.json({
      seats: seats(req.user.company_id),
      members: q(`SELECT id, name, phone, email, role, company_role AS companyRole, id = :u AS me FROM users WHERE company_id = :c AND is_admin = 0 OR id = :u ORDER BY id`, {
        c: req.user.company_id, u: req.user.id,
      }).map((m) => ({ ...m, me: !!m.me })),
      invites: q('SELECT id, phone, name, role, created_at AS createdAt FROM invites WHERE company_id = ? ORDER BY id DESC', req.user.company_id),
    });
  });
  app.post('/api/team/invite', auth, L.owner, (req, res) => {
    const b = parse(z.object({ phone: z.string(), name: z.string().trim().max(100).default(''), role: z.enum(['manager', 'driver']).default('manager') }), req.body);
    const phone = L.normPhone(b.phone);
    if (q1('SELECT 1 FROM users WHERE phone = ?', phone)) throw bad('exists', 'Этот номер уже зарегистрирован на платформе', 409);
    const used = q1('SELECT (SELECT COUNT(*) FROM users WHERE company_id = :c) + (SELECT COUNT(*) FROM invites WHERE company_id = :c) AS n', { c: req.user.company_id }).n;
    const limit = seats(req.user.company_id);
    if (used >= limit) throw bad('seats', `На вашем тарифе доступно мест: ${limit}. Тариф Pro расширяет команду до ${L.PLAN.pro.seats}.`, 402);
    if (q1('SELECT 1 FROM invites WHERE phone = ?', phone)) throw bad('exists', 'Этот номер уже приглашён', 409);
    res.json({ id: insert('INSERT INTO invites(company_id, phone, name, role) VALUES(?, ?, ?, ?)', req.user.company_id, phone, b.name, b.role) });
  });
  app.delete('/api/team/invites/:id', auth, L.owner, (req, res) => {
    run('DELETE FROM invites WHERE id = ? AND company_id = ?', id(req), req.user.company_id);
    res.json({ ok: true });
  });
  // Сотрудника нельзя удалить вместе с его сделками, поэтому он «выходит» в собственную пустую компанию.
  app.delete('/api/team/members/:id', auth, L.owner, (req, res) => {
    const m = q1('SELECT * FROM users WHERE id = ? AND company_id = ?', id(req), req.user.company_id);
    if (!m) throw bad('not_found', 'Сотрудник не найден', 404);
    if (m.id === req.user.id) throw bad('self', 'Нельзя удалить самого себя');
    tx(() => {
      const companyId = insert(`INSERT INTO companies(name, form, kind) VALUES(?, 'ИП', ?)`, m.name, m.role);
      run(`UPDATE users SET company_id = ?, company_role = 'owner' WHERE id = ?`, companyId, m.id);
      run('DELETE FROM sessions WHERE user_id = ?', m.id);
    });
    res.json({ ok: true });
  });

  // ---------- тариф ----------
  app.post('/api/plan/buy', auth, L.owner, (req, res) => {
    tx(() => {
      const c = q1('SELECT balance, plan, plan_until FROM companies WHERE id = ?', req.user.company_id);
      if (c.balance < L.PLAN.price) throw bad('balance', 'Недостаточно средств на балансе', 402);
      // продление прибавляется к оставшемуся сроку
      const from = c.plan === 'pro' && c.plan_until > L.now() ? Date.parse(c.plan_until) : Date.now();
      const until = new Date(from + L.PLAN.days * 86400_000).toISOString();
      run(`UPDATE companies SET balance = balance - ?, plan = 'pro', plan_until = ? WHERE id = ?`, L.PLAN.price, until, req.user.company_id);
      run(`INSERT INTO transactions(company_id, amount, kind, note) VALUES(?, ?, 'plan', ?)`, req.user.company_id, -L.PLAN.price, `Тариф Pro до ${until.slice(0, 10)}`);
    });
    res.json(L.meOut(req.user));
  });

  // ---------- партнёры и личный чёрный список ----------
  const relation = (table, column) => (req, res) => {
    const target = id(req);
    const { on } = parse(z.object({ on: z.boolean() }), req.body);
    if (target === req.user.company_id) throw bad('own', 'Это ваша компания');
    if (!q1('SELECT 1 FROM companies WHERE id = ?', target)) throw bad('not_found', 'Компания не найдена', 404);
    if (on) run(`INSERT OR IGNORE INTO ${table}(company_id, ${column}) VALUES(?, ?)`, req.user.company_id, target);
    else run(`DELETE FROM ${table} WHERE company_id = ? AND ${column} = ?`, req.user.company_id, target);
    // партнёр и личный чёрный список исключают друг друга
    if (on) run(table === 'partners' ? 'DELETE FROM blocks WHERE company_id = ? AND blocked_id = ?' : 'DELETE FROM partners WHERE company_id = ? AND partner_id = ?', req.user.company_id, target);
    res.json({ ok: true });
  };
  app.post('/api/companies/:id/partner', auth, relation('partners', 'partner_id'));
  app.post('/api/companies/:id/block', auth, relation('blocks', 'blocked_id'));
  const listRelated = (table, column) => (req, res) =>
    res.json(q(`SELECT cs.* FROM ${table} r JOIN company_stats cs ON cs.id = r.${column} WHERE r.company_id = ? ORDER BY r.created_at DESC`, req.user.company_id)
      .map((c) => ({ ...L.companyOut(c), cityId: c.city_id, bin: c.bin })));
  app.get('/api/partners', auth, listRelated('partners', 'partner_id'));
  app.get('/api/blocks', auth, listRelated('blocks', 'blocked_id'));

  // ---------- жалобы ----------
  const complaintSchema = z.object({
    listingId: z.number().int().optional(),
    companyId: z.number().int().optional(),
    reason: z.enum(['fraud', 'outdated', 'wrong_info', 'duplicate', 'rude', 'other']),
    text: z.string().trim().max(1000).default(''),
  });
  app.post('/api/complaints', auth, (req, res) => {
    const b = parse(complaintSchema, req.body);
    const listing = b.listingId ? q1('SELECT id, company_id FROM listings WHERE id = ?', b.listingId) : null;
    const companyId = listing?.company_id ?? b.companyId;
    if (!companyId || !q1('SELECT 1 FROM companies WHERE id = ?', companyId)) throw bad('not_found', 'Не найдено, на что жаловаться', 404);
    if (companyId === req.user.company_id) throw bad('own', 'Нельзя пожаловаться на свою компанию');
    if (q1(`SELECT COUNT(*) AS n FROM complaints WHERE author_user = ? AND created_at > ?`, req.user.id, new Date(Date.now() - 86400_000).toISOString()).n >= 20)
      throw bad('rate_limit', 'Слишком много жалоб за сутки', 429);
    insert('INSERT INTO complaints(listing_id, company_id, author_user, author_company, reason, text) VALUES(?, ?, ?, ?, ?, ?)',
      listing?.id ?? null, companyId, req.user.id, req.user.company_id, b.reason, b.text);
    for (const a of q('SELECT id FROM users WHERE is_admin = 1')) notify(a.id, { kind: 'system', title: 'Новая жалоба', body: b.text.slice(0, 120), link: '/cabinet/admin' });
    res.json({ ok: true });
  });

  // ---------- статистика цен по направлениям ----------
  app.get('/api/stats/prices', auth, (req, res) => {
    const body = L.BODY.includes(req.query.body) ? req.query.body : null;
    const kind = req.query.kind === 'truck' ? 'truck' : 'cargo';
    const rows = q(
      `SELECT from_id, to_id, rate, distance_km, body_type FROM listings
       WHERE kind = :kind AND currency = 'KZT' AND rate > 0 AND distance_km > 50 AND (:body IS NULL OR body_type = :body)
         AND created_at > :since`,
      { kind, body, since: new Date(Date.now() - 180 * 86400_000).toISOString() },
    );
    const groups = new Map();
    for (const r of rows) {
      const key = `${r.from_id}>${r.to_id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    const median = (a) => a.sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)];
    const directions = [...groups.entries()]
      .map(([key, list]) => {
        const [fromId, toId] = key.split('>');
        return {
          fromId, toId, count: list.length, distanceKm: list[0].distance_km,
          rate: Math.round(median(list.map((r) => r.rate)) / 1000) * 1000,
          perKm: Math.round(median(list.map((r) => r.rate / r.distance_km))),
        };
      })
      .sort((a, b) => b.count - a.count || b.rate - a.rate)
      .slice(0, 60);
    const byBody = q(
      `SELECT body_type AS body, COUNT(*) AS count, ROUND(AVG(rate / distance_km)) AS perKm FROM listings
       WHERE kind = ? AND currency = 'KZT' AND rate > 0 AND distance_km > 50 AND body_type IS NOT NULL GROUP BY body_type HAVING COUNT(*) >= 2 ORDER BY count DESC`,
      kind,
    );
    res.json({ sample: rows.length, overall: marketRate(kind, 0, body), directions, byBody });
  });

  // ---------- калькуляторы ----------
  app.get('/api/tools/route', auth, async (req, res) => {
    const points = String(req.query.points || '').split(',').map((p) => cityById.get(p)).filter(Boolean);
    if (points.length < 2 || points.length > 8) throw bad('validation', 'Укажите от двух до восьми пунктов');
    const r = await route(points);
    const body = L.BODY.includes(req.query.body) ? req.query.body : null;
    const m = marketRate('cargo', 0, body);
    res.json({
      ...r,
      hours: Math.round(r.km / 60), // средняя скорость грузовика на трассе с учётом остановок
      cost: m ? { low: Math.round((m.low * r.km) / 1000) * 1000, median: Math.round((m.median * r.km) / 1000) * 1000, high: Math.round((m.high * r.km) / 1000) * 1000, perKm: m.median, sample: m.sample } : null,
    });
  });
  app.get('/api/tools/rates', auth, async (_req, res) => {
    const all = await loadRates();
    res.json(all ? ['USD', 'EUR', 'RUB', 'CNY', 'UZS', 'KGS', 'TRY'].filter((c) => all[c]).map((c) => ({ code: c, ...all[c] })) : null);
  });

  // ---------- новости ----------
  app.get('/api/news', (_req, res) => {
    res.json(q('SELECT id, title, body, title_kz AS titleKz, body_kz AS bodyKz, title_en AS titleEn, body_en AS bodyEn, created_at AS createdAt FROM news ORDER BY id DESC LIMIT 30'));
  });
  const newsSchema = z.object({
    title: z.string().trim().min(3).max(160), body: z.string().trim().min(3).max(4000),
    titleKz: z.string().trim().max(160).default(''), bodyKz: z.string().trim().max(4000).default(''),
    titleEn: z.string().trim().max(160).default(''), bodyEn: z.string().trim().max(4000).default(''),
  });
  app.post('/api/admin/news', auth, L.admin, (req, res) => {
    const b = parse(newsSchema, req.body);
    res.json({ id: insert('INSERT INTO news(title, body, title_kz, body_kz, title_en, body_en) VALUES(?, ?, ?, ?, ?, ?)', b.title, b.body, b.titleKz, b.bodyKz, b.titleEn, b.bodyEn) });
  });
  app.delete('/api/admin/news/:id', auth, L.admin, (req, res) => {
    run('DELETE FROM news WHERE id = ?', id(req));
    res.json({ ok: true });
  });

  // ---------- обратная связь ----------
  app.post('/api/feedback', auth, (req, res) => {
    const { text } = parse(z.object({ text: z.string().trim().min(5).max(2000) }), req.body);
    if (q1(`SELECT COUNT(*) AS n FROM feedback WHERE user_id = ? AND created_at > ?`, req.user.id, new Date(Date.now() - 86400_000).toISOString()).n >= 10)
      throw bad('rate_limit', 'Слишком много обращений за сутки', 429);
    insert('INSERT INTO feedback(user_id, text) VALUES(?, ?)', req.user.id, text);
    for (const a of q('SELECT id FROM users WHERE is_admin = 1')) notify(a.id, { kind: 'system', title: 'Новое обращение в поддержку', body: text.slice(0, 120), link: '/cabinet/admin' });
    res.json({ ok: true });
  });

  // ---------- модератор: жалобы, обращения, сводка ----------
  app.get('/api/admin/overview', auth, L.admin, (_req, res) => {
    const count = (sql) => q1(sql).n;
    res.json({
      stats: {
        users: count('SELECT COUNT(*) AS n FROM users'),
        companies: count('SELECT COUNT(*) AS n FROM companies'),
        verified: count(`SELECT COUNT(*) AS n FROM companies WHERE verified = 'verified'`),
        listings: count(`SELECT COUNT(*) AS n FROM listings WHERE status = 'active'`),
        tripsActive: count(`SELECT COUNT(*) AS n FROM trips WHERE status = 'active'`),
        tripsDone: count(`SELECT COUNT(*) AS n FROM trips WHERE status = 'completed'`),
        pro: count('SELECT COUNT(*) AS n FROM company_stats WHERE pro = 1'),
        week: count(`SELECT COUNT(*) AS n FROM users WHERE created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')`),
      },
      complaints: q(
        `SELECT c.id, c.reason, c.text, c.created_at AS createdAt, c.listing_id AS listingId, c.company_id AS companyId, t.name AS companyName, a.name AS author,
           (SELECT COUNT(*) FROM complaints x WHERE x.company_id = c.company_id) AS total
         FROM complaints c JOIN companies t ON t.id = c.company_id JOIN companies a ON a.id = c.author_company WHERE c.status = 'open' ORDER BY c.id LIMIT 200`,
      ),
      feedback: q(
        `SELECT f.id, f.text, f.created_at AS createdAt, u.name AS userName, u.phone, c.name AS companyName
         FROM feedback f JOIN users u ON u.id = f.user_id JOIN companies c ON c.id = u.company_id WHERE f.status = 'open' ORDER BY f.id LIMIT 200`,
      ),
    });
  });
  app.post('/api/admin/complaints/:id', auth, L.admin, (req, res) => {
    const { action } = parse(z.object({ action: z.enum(['dismiss', 'close_listing']) }), req.body);
    const c = q1('SELECT * FROM complaints WHERE id = ?', id(req));
    if (!c) throw bad('not_found', 'Жалоба не найдена', 404);
    if (action === 'close_listing' && c.listing_id) {
      const l = q1('SELECT user_id FROM listings WHERE id = ?', c.listing_id);
      run(`UPDATE listings SET status = 'archived', closed_at = ? WHERE id = ?`, L.now(), c.listing_id);
      if (l) notify(l.user_id, { kind: 'system', title: 'Объявление №{n} снято модератором', vars: { n: c.listing_id }, body: 'Причина: жалоба пользователей. Если это ошибка, напишите в поддержку.', link: '/help' });
    }
    run(`UPDATE complaints SET status = 'closed' WHERE id = ?`, c.id);
    res.json({ ok: true });
  });
  app.post('/api/admin/feedback/:id', auth, L.admin, (req, res) => {
    run(`UPDATE feedback SET status = 'closed' WHERE id = ?`, id(req));
    res.json({ ok: true });
  });
}
