// Раздел «Заказчики»: крупные компании (сети, производители) со своими сайтами заявок на перевозку.
// Карточки добавляет администратор — только после договорённости с компанией: её название и логотип у нас
// выглядят как партнёрство. Перевозчик нажимает «Перейти к заявкам» и попадает на сайт компании; переходы считаем,
// чтобы показать компании, сколько перевозчиков мы ей приводим.
// Здесь же — показатели площадки для встреч с такими компаниями (только администратор).
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { UPLOAD_DIR, q, q1, run, insert } from '../db.js';
import { cityById } from '../geo.js';
import { decodeUpload } from '../files.js';
import * as L from '../lib.js';

const { bad, parse, auth, admin } = L;

const shipperSchema = z.object({
  name: z.string().trim().min(2, 'Название: не короче 2 символов').max(80),
  url: z.string().trim().max(300).url('Укажите адрес сайта, например https://example.kz')
    .refine((u) => /^https?:\/\//i.test(u), 'Адрес сайта должен начинаться с https://'),
  about: z.string().trim().max(600).default(''),
  cities: z.array(z.string().refine((id) => cityById.has(id), 'Неизвестный город')).max(30).default([]),
  cargo: z.array(z.enum(L.CARGO)).max(L.CARGO.length).default([]),
  visible: z.boolean().default(true),
  sort: z.number().int().min(0).max(999).default(0),
  // null — убрать логотип, без поля — оставить прежний
  logo: z.object({ mime: z.string(), data: z.string() }).nullable().optional(),
});

const shipperOut = (r, isAdmin) => ({
  id: r.id, name: r.name, url: r.url, about: r.about, cities: L.j(r.cities, []), cargo: L.j(r.cargo, []),
  logo: r.logo ? `/api/shippers/${r.id}/logo?v=${encodeURIComponent(r.logo)}` : null,
  ...(isAdmin ? { visible: !!r.visible, clicks: r.clicks, sort: r.sort } : {}),
});

function saveLogo(logo, old) {
  if (old) fs.rmSync(path.join(UPLOAD_DIR, path.basename(old)), { force: true });
  if (!logo) return null;
  const { buf, ext } = decodeUpload(logo, { images: true, max: 1024 * 1024 });
  const name = `shipper-${L.token(12)}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return name;
}

export default function shipperRoutes(app) {
  app.get('/api/shippers', auth, (req, res) => {
    const all = !!req.user.is_admin;
    res.json(q(`SELECT * FROM shippers ${all ? '' : 'WHERE visible = 1'} ORDER BY sort, name`).map((r) => shipperOut(r, all)));
  });
  // логотип открыт без входа: это публичная эмблема компании, а не документ
  app.get('/api/shippers/:id/logo', (req, res) => {
    const r = q1('SELECT logo FROM shippers WHERE id = ?', Number(req.params.id));
    const file = r?.logo && path.join(UPLOAD_DIR, path.basename(r.logo));
    if (!file || !fs.existsSync(file)) throw bad('not_found', 'Файл не найден', 404);
    const ext = path.extname(file).slice(1);
    res.setHeader('Content-Type', { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
  // переход на сайт компании; администратора не считаем, чтобы не портить статистику для партнёра
  app.post('/api/shippers/:id/open', auth, (req, res) => {
    const sid = Number(req.params.id);
    // один человек — один переход в сутки
    if (!req.user.is_admin && !req.user.is_demo && L.firstTime(`sh:${req.user.id}:${sid}`)) run('UPDATE shippers SET clicks = clicks + 1 WHERE id = ? AND visible = 1', sid);
    res.json({ ok: true });
  });

  app.post('/api/admin/shippers', auth, admin, (req, res) => {
    const b = parse(shipperSchema, req.body);
    const logo = b.logo ? saveLogo(b.logo, null) : null;
    const id = insert('INSERT INTO shippers(name, url, about, cities, cargo, logo, visible, sort) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
      b.name, b.url, b.about, JSON.stringify([...new Set(b.cities)]), JSON.stringify([...new Set(b.cargo)]), logo, b.visible ? 1 : 0, b.sort);
    L.modLog(req.user, 'shipper_add', b.name, b.url);
    res.json({ id });
  });
  app.put('/api/admin/shippers/:id', auth, admin, (req, res) => {
    const s = q1('SELECT * FROM shippers WHERE id = ?', Number(req.params.id));
    if (!s) throw bad('not_found', 'Компания не найдена', 404);
    const b = parse(shipperSchema, req.body);
    const logo = b.logo === undefined ? s.logo : saveLogo(b.logo, s.logo);
    run('UPDATE shippers SET name = ?, url = ?, about = ?, cities = ?, cargo = ?, logo = ?, visible = ?, sort = ? WHERE id = ?',
      b.name, b.url, b.about, JSON.stringify([...new Set(b.cities)]), JSON.stringify([...new Set(b.cargo)]), logo, b.visible ? 1 : 0, b.sort, s.id);
    res.json({ ok: true });
  });
  app.delete('/api/admin/shippers/:id', auth, admin, (req, res) => {
    const s = q1('SELECT * FROM shippers WHERE id = ?', Number(req.params.id));
    if (!s) throw bad('not_found', 'Компания не найдена', 404);
    saveLogo(null, s.logo);
    run('DELETE FROM shippers WHERE id = ?', s.id);
    L.modLog(req.user, 'shipper_remove', s.name, '');
    res.json({ ok: true });
  });

  // ---------- показатели площадки для встреч с заказчиками ----------
  // По умолчанию демо-данные не учитываются: показываем только настоящих пользователей.
  app.get('/api/admin/metrics', auth, admin, (req, res) => {
    const withDemo = req.query.demo === '1';
    const realUser = withDemo ? '1 = 1' : 'u.is_demo = 0';
    // компания настоящая, если в ней есть хотя бы один не-демо пользователь
    const realCo = withDemo ? '1 = 1' : 'EXISTS (SELECT 1 FROM users u WHERE u.company_id = c.id AND u.is_demo = 0)';
    const n = (sql, ...a) => q1(sql, ...a).n;
    const ago = (days) => new Date(Date.now() - days * 86400_000).toISOString();
    const carrierCo = `c.banned = 0 AND c.kind IN ('carrier', 'driver') AND ${realCo}`;

    const roles = Object.fromEntries(L.ROLES.map((r) => [r, 0]));
    for (const r of q(`SELECT u.role, COUNT(*) AS n FROM users u WHERE ${realUser} GROUP BY u.role`)) roles[r.role] = r.n;
    const users = Object.values(roles).reduce((a, b) => a + b, 0);
    const vehicles = n(`SELECT COUNT(*) AS n FROM vehicles v JOIN companies c ON c.id = v.company_id WHERE ${carrierCo}`);
    // водитель-одиночка без машины в «Машинах» — всё равно одна машина
    const soloNoFleet = n(`SELECT COUNT(*) AS n FROM companies c WHERE c.kind = 'driver' AND ${carrierCo} AND NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.company_id = c.id)`);
    const bodies = q(`SELECT v.body_type AS key, COUNT(*) AS n FROM vehicles v JOIN companies c ON c.id = v.company_id WHERE ${carrierCo} AND v.body_type IS NOT NULL GROUP BY v.body_type ORDER BY n DESC LIMIT 10`);
    const cities = q(`SELECT c.city_id AS key, COUNT(*) AS n FROM companies c WHERE ${carrierCo} AND c.city_id IS NOT NULL GROUP BY c.city_id ORDER BY n DESC LIMIT 10`);
    const listings = (kind, days) => n(`SELECT COUNT(*) AS n FROM listings l JOIN companies c ON c.id = l.company_id WHERE l.kind = ? AND l.created_at > ? AND ${realCo}`, kind, ago(days));
    const trips = (days) => n(`SELECT COUNT(*) AS n FROM trips t JOIN companies c ON c.id = t.carrier_company WHERE t.status = 'completed' ${days ? 'AND t.finished_at > ?' : ''} AND ${realCo}`, ...(days ? [ago(days)] : []));
    // новые пользователи по неделям за 12 недель (последняя — текущая неполная)
    const weeks = [];
    for (let i = 11; i >= 0; i--) {
      weeks.push({ from: ago((i + 1) * 7), n: n(`SELECT COUNT(*) AS n FROM users u WHERE ${realUser} AND u.created_at > ? AND u.created_at <= ?`, ago((i + 1) * 7), ago(i * 7)) });
    }
    const milestones = [1000, 2000, 3000, 5000, 10000, 20000, 50000];
    res.json({
      at: L.now(), withDemo, demoAvailable: L.DEMO,
      users, roles,
      goal: milestones.find((m) => m > users) ?? users,
      active7: n(`SELECT COUNT(*) AS n FROM users u WHERE ${realUser} AND u.last_seen > ?`, ago(7)),
      active30: n(`SELECT COUNT(*) AS n FROM users u WHERE ${realUser} AND u.last_seen > ?`, ago(30)),
      new30: n(`SELECT COUNT(*) AS n FROM users u WHERE ${realUser} AND u.created_at > ?`, ago(30)),
      carriers: n(`SELECT COUNT(*) AS n FROM companies c WHERE ${carrierCo}`),
      carriersVerified: n(`SELECT COUNT(*) AS n FROM companies c WHERE ${carrierCo} AND c.verified = 'verified'`),
      customers: n(`SELECT COUNT(*) AS n FROM companies c WHERE c.banned = 0 AND c.kind NOT IN ('carrier', 'driver') AND ${realCo}`),
      vehicles: vehicles + soloNoFleet,
      bodies, cities,
      listings30: { cargo: listings('cargo', 30), truck: listings('truck', 30), relocation: listings('relocation', 30) },
      responses30: n(`SELECT COUNT(*) AS n FROM responses r JOIN companies c ON c.id = r.company_id WHERE r.created_at > ? AND ${realCo}`, ago(30)),
      tripsDone: trips(0), tripsDone30: trips(30),
      weeks,
      shippers: q('SELECT name, clicks FROM shippers ORDER BY clicks DESC LIMIT 20'),
    });
  });
}
