// Перегон: профиль перегонщика (права, город) и каталог перегонщиков.
// Сами заявки на перегон — обычные объявления вида 'relocation' (listings.js): отклик, чат, рейс с GPS и отзыв работают как у грузов.
import { z } from 'zod';
import { q, q1, run } from '../db.js';
import { cityById, haversine } from '../geo.js';
import * as L from '../lib.js';

const { bad, parse, auth, staff } = L;

const profileSchema = z.object({
  relocator: z.boolean(),
  licenses: z.array(z.enum(L.LICENSES)).max(8).default([]),
  cityId: z.string().nullable().optional(),
  note: z.string().trim().max(300).default(''),
});

const profileOut = (u) => ({ relocator: !!u.relocator, licenses: L.j(u.licenses, []), cityId: u.relocator_city || null, note: u.relocator_note || '' });

export default function relocationRoutes(app) {
  app.get('/api/relocator', auth, (req, res) => {
    res.json(profileOut(q1('SELECT relocator, licenses, relocator_city, relocator_note FROM users WHERE id = ?', req.user.id)));
  });

  // водитель из команды работает на свою компанию — сам предлагать себя как перегонщика не может
  app.put('/api/relocator', auth, staff, (req, res) => {
    const b = parse(profileSchema, req.body);
    if (b.relocator) {
      if (!b.cityId || !cityById.has(b.cityId)) throw bad('validation', 'Укажите город, где вы находитесь', 400);
      if (!b.licenses.length) throw bad('validation', 'Отметьте категории прав', 400);
    }
    run('UPDATE users SET relocator = ?, licenses = ?, relocator_city = ?, relocator_note = ? WHERE id = ?',
      b.relocator ? 1 : 0, JSON.stringify([...new Set(b.licenses)]), b.cityId && cityById.has(b.cityId) ? b.cityId : null, b.note, req.user.id);
    res.json(profileOut(q1('SELECT relocator, licenses, relocator_city, relocator_note FROM users WHERE id = ?', req.user.id)));
  });

  // Каталог: рядом с выбранным городом (до 300 км) и с нужными правами; сначала ближние, потом с лучшей репутацией
  app.get('/api/relocators', auth, (req, res) => {
    L.browseLimit(req);
    const city = cityById.get(String(req.query.city || ''));
    const need = String(req.query.lic || '').split(',').filter((x) => L.LICENSES.includes(x));
    const companies = L.companyMap();
    const blocked = new Set(q('SELECT blocked_id FROM blocks WHERE company_id = ?', req.user.company_id).map((r) => r.blocked_id));
    const rows = q(
      `SELECT u.id, u.name, u.phone, u.settings, u.company_id, u.licenses, u.relocator_city, u.relocator_note,
         (SELECT COUNT(*) FROM trips t JOIN listings l ON l.id = t.listing_id
           WHERE l.kind = 'relocation' AND t.status = 'completed' AND (t.driver_user = u.id OR (t.driver_user IS NULL AND t.carrier_user = u.id))) AS done
       FROM users u JOIN companies c ON c.id = u.company_id
       WHERE u.relocator = 1 AND c.banned = 0 AND u.company_role != 'driver'`,
    );
    const out = [];
    for (const r of rows) {
      if (blocked.has(r.company_id)) continue;
      const lic = L.j(r.licenses, []);
      if (need.some((x) => !lic.includes(x))) continue;
      const at = cityById.get(r.relocator_city);
      const km = city && at ? Math.round(haversine(city, at)) : null;
      if (city && (km === null || km > 300)) continue;
      const company = companies.get(r.company_id);
      if (!company) continue;
      out.push({
        userId: r.id, name: r.name, cityId: r.relocator_city, km, licenses: lic, note: r.relocator_note, done: r.done,
        phone: L.phoneFor(req.user, r), company, mine: r.company_id === req.user.company_id,
      });
    }
    const rank = (x) => (x.company.indicator === 'green' ? 0 : x.company.indicator === 'gray' ? 1 : 2);
    out.sort((a, b) => (a.km ?? 0) - (b.km ?? 0) || rank(a) - rank(b) || b.done - a.done || (b.company.rating ?? 0) - (a.company.rating ?? 0));
    res.json(out.slice(0, 100));
  });
}
