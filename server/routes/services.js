// Платный каталог услуг: перегонщики, машины сопровождения негабарита, таможенные брокеры.
// Исполнитель размещает карточку компании и оплачивает показ с баланса (L.SERVICE_PLAN: сумма за 30 дней);
// заказчики находят его по виду услуги и городу и звонят напрямую. Неоплаченная карточка в каталоге не видна.
import { z } from 'zod';
import { q, q1, run, insert, tx } from '../db.js';
import { cityById } from '../geo.js';
import * as L from '../lib.js';

const { bad, parse, auth, staff } = L;

const serviceSchema = z.object({
  category: z.enum(L.SERVICE_CATEGORIES),
  title: z.string().trim().min(3, 'Название: не короче 3 символов').max(100),
  cities: z.array(z.string().refine((id) => cityById.has(id), 'Неизвестный город')).max(20).default([]),
  allCountry: z.boolean().default(false),
  description: z.string().trim().max(1500).default(''),
  phone: z.string().trim().max(20).default(''),
}).refine((b) => b.allCountry || b.cities.length > 0, 'Укажите города, где вы работаете, или отметьте «Вся страна»');

function serviceOut(r, viewer) {
  const mine = r.company_id === viewer.company_id;
  const active = !!r.paid_until && r.paid_until > L.now();
  return {
    id: r.id, category: r.category, title: r.title, cities: L.j(r.cities, []), allCountry: !!r.all_country, description: r.description,
    phone: r.phone, paidUntil: r.paid_until, active, mine, views: mine ? r.views : undefined, createdAt: r.created_at,
    company: L.companyOut(r, 'c_'),
  };
}
const SQL = `SELECT s.*, ${L.COMPANY_COLS('cs', 'c_')} FROM services s JOIN company_stats cs ON cs.id = s.company_id`;

export default function serviceRoutes(app) {
  app.get('/api/services', auth, (req, res) => {
    L.browseLimit(req);
    const cat = L.SERVICE_CATEGORIES.includes(req.query.category) ? req.query.category : null;
    const city = cityById.has(String(req.query.city || '')) ? String(req.query.city) : null;
    const blocked = new Set(q('SELECT blocked_id FROM blocks WHERE company_id = ?', req.user.company_id).map((r) => r.blocked_id));
    const rows = q(`${SQL} WHERE s.removed = 0 AND s.paid_until > ? AND cs.banned = 0 ${cat ? 'AND s.category = ?' : ''} ORDER BY s.id DESC`, L.now(), ...(cat ? [cat] : []))
      .filter((r) => !blocked.has(r.company_id))
      .filter((r) => !city || r.all_country || L.j(r.cities, []).includes(city))
      .map((r) => serviceOut(r, req.user));
    // сначала проверенные компании и с лучшей репутацией
    const rank = (s) => (s.company.indicator === 'green' ? 0 : s.company.indicator === 'gray' ? 1 : 2);
    rows.sort((a, b) => rank(a) - rank(b) || (b.company.rating ?? 0) - (a.company.rating ?? 0));
    res.json(rows);
  });

  app.get('/api/services/mine', auth, (req, res) => {
    res.json({ price: L.SERVICE_PLAN.price, days: L.SERVICE_PLAN.days,
      items: q(`${SQL} WHERE s.company_id = ? AND s.removed = 0 ORDER BY s.id DESC`, req.user.company_id).map((r) => serviceOut(r, req.user)) });
  });

  // просмотр карточки (нажатие «Позвонить» / «WhatsApp») считаем для исполнителя — видно, что реклама работает
  app.post('/api/services/:id/view', auth, (req, res) => {
    // один человек — один просмотр в сутки: повторными нажатиями счётчик не накрутить
    const sid = Number(req.params.id);
    if (L.firstTime(`sv:${req.user.id}:${sid}`)) run('UPDATE services SET views = views + 1 WHERE id = ? AND company_id != ?', sid, req.user.company_id);
    res.json({ ok: true });
  });

  app.post('/api/services', auth, staff, (req, res) => {
    L.requireActiveCompany(req.user);
    const b = parse(serviceSchema, req.body);
    if (q1('SELECT COUNT(*) AS n FROM services WHERE company_id = ? AND removed = 0', req.user.company_id).n >= 5) throw bad('limit', 'Не больше 5 карточек услуг у одной компании', 429);
    const phone = b.phone ? L.normPhone(b.phone) : q1('SELECT phone FROM users WHERE id = ?', req.user.id).phone;
    const id = insert('INSERT INTO services(company_id, user_id, category, title, cities, all_country, description, phone) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
      req.user.company_id, req.user.id, b.category, b.title, JSON.stringify([...new Set(b.cities)]), b.allCountry ? 1 : 0, b.description, phone);
    res.json({ id });
  });

  const own = (req) => {
    const s = q1('SELECT * FROM services WHERE id = ? AND removed = 0', Number(req.params.id));
    if (!s) throw bad('not_found', 'Карточка не найдена', 404);
    if (s.company_id !== req.user.company_id) throw bad('forbidden', 'Это не ваша карточка', 403);
    return s;
  };
  app.put('/api/services/:id', auth, staff, (req, res) => {
    const s = own(req);
    const b = parse(serviceSchema, req.body);
    const phone = b.phone ? L.normPhone(b.phone) : s.phone;
    run('UPDATE services SET category = ?, title = ?, cities = ?, all_country = ?, description = ?, phone = ? WHERE id = ?',
      b.category, b.title, JSON.stringify([...new Set(b.cities)]), b.allCountry ? 1 : 0, b.description, phone, s.id);
    res.json({ ok: true });
  });
  app.delete('/api/services/:id', auth, (req, res) => {
    const s = q1('SELECT * FROM services WHERE id = ? AND removed = 0', Number(req.params.id));
    if (!s) throw bad('not_found', 'Карточка не найдена', 404);
    // удалить может владелец карточки или модератор (например, по жалобе); оплаченные дни не возвращаются
    if (s.company_id !== req.user.company_id && !req.user.is_admin) throw bad('forbidden', 'Это не ваша карточка', 403);
    if (s.company_id !== req.user.company_id) L.modLog(req.user, 'service_remove', s.company_id, `Карточка услуги №${s.id}`);
    run('UPDATE services SET removed = 1 WHERE id = ?', s.id);
    res.json({ ok: true });
  });

  // Оплата показа: списывается с баланса компании, срок прибавляется к оставшемуся
  app.post('/api/services/:id/pay', auth, L.owner, (req, res) => {
    const s = own(req);
    L.requireActiveCompany(req.user);
    const { price, days } = L.SERVICE_PLAN;
    const until = tx(() => {
      // карточек у компании может быть несколько, но две оплаты за полминуты — это повторное нажатие
      L.requireNoRecentPayment(req.user.company_id, 'service');
      const c = q1('SELECT balance FROM companies WHERE id = ?', req.user.company_id);
      if (c.balance < price) {
        const e = bad('balance', 'Недостаточно средств на балансе', 402);
        e.extra = { need: price - c.balance };
        throw e;
      }
      const from = s.paid_until && s.paid_until > L.now() ? Date.parse(s.paid_until) : Date.now();
      const until = new Date(from + days * 86400_000).toISOString();
      run('UPDATE companies SET balance = balance - ? WHERE id = ?', price, req.user.company_id);
      run('UPDATE services SET paid_until = ? WHERE id = ?', until, s.id);
      run(`INSERT INTO transactions(company_id, amount, kind, note) VALUES(?, ?, 'service', ?)`, req.user.company_id, -price, `Каталог услуг до ${until.slice(0, 10)}`);
      return until;
    });
    res.json({ paidUntil: until });
  });
}
