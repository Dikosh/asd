// Кабинет компании: каталог и проверка, документы, машины, сотрудники, баланс, чёрный список, работа, модерация.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { q, q1, run, insert, tx, UPLOAD_DIR } from '../db.js';
import { cityById, isValidBin } from '../geo.js';
import * as L from '../lib.js';
import { notify } from '../notify.js';

const { bad, parse, auth, owner, staff } = L;
const MIME = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const id = (req) => Number(req.params.id);
const optNum = (max) => z.number().min(0).max(max).nullable().optional();

/** Был ли между компаниями рейс (в любом статусе) — основание для записи в чёрный список. */
// чёрный список — по итогам рейса: пока рейс идёт, вносить нельзя
const dealBetween = (a, b) =>
  q1(`SELECT id FROM trips WHERE status != 'active' AND ((customer_company = :a AND carrier_company = :b) OR (customer_company = :b AND carrier_company = :a)) LIMIT 1`, { a, b });

export default function companyRoutes(app) {
  // ---------- каталог компаний ----------
  app.get('/api/companies', auth, (req, res) => {
    const term = `%${String(req.query.q || '').trim()}%`;
    const kind = L.ROLES.includes(req.query.kind) ? req.query.kind : null;
    res.json(
      q(
        `SELECT * FROM company_stats WHERE (name LIKE :t OR bin LIKE :t) AND (:k IS NULL OR kind = :k)
           AND id NOT IN (SELECT company_id FROM users WHERE is_admin = 1)
         ORDER BY (verified = 'verified') DESC, trips DESC, reviews DESC, id DESC LIMIT 100`,
        { t: term, k: kind },
      ).map((c) => ({ ...L.companyOut(c), cityId: c.city_id, bin: c.bin })),
    );
  });
  app.get('/api/companies/:id', auth, (req, res) => {
    const c = q1('SELECT * FROM company_stats WHERE id = ?', id(req));
    if (!c) throw bad('not_found', 'Компания не найдена', 404);
    res.json({
      ...L.companyOut(c),
      bin: c.bin,
      binValid: isValidBin(c.bin),
      about: c.about,
      cityId: c.city_id,
      since: c.created_at,
      mine: c.id === req.user.company_id,
      // запись в чёрный список может оставить только тот, у кого с компанией была сделка
      hadDeal: !!dealBetween(req.user.company_id, c.id),
      isPartner: !!q1('SELECT 1 FROM partners WHERE company_id = ? AND partner_id = ?', req.user.company_id, c.id),
      isBlocked: !!q1('SELECT 1 FROM blocks WHERE company_id = ? AND blocked_id = ?', req.user.company_id, c.id),
      contacts: q(`SELECT name, phone, role, settings, company_id FROM users WHERE company_id = ? AND is_admin = 0 AND company_role != 'driver' LIMIT 5`, c.id)
        .map((u) => ({ name: u.name, role: u.role, phone: L.phoneFor(req.user, u) })),
      vehicles: q1('SELECT COUNT(*) AS n FROM vehicles WHERE company_id = ?', c.id).n,
      documents: q(`SELECT kind FROM documents WHERE company_id = ? AND status = 'approved' GROUP BY kind`, c.id).map((d) => d.kind),
      reviewList: q(
        `SELECT r.rating, r.text, r.created_at AS createdAt, a.name AS author, a.id AS authorId, a.verified = 'verified' AS counted, t.status AS tripStatus
         FROM visible_reviews r JOIN companies a ON a.id = r.author_company JOIN trips t ON t.id = r.trip_id WHERE r.target_company = ? ORDER BY r.id DESC LIMIT 50`,
        c.id,
      ),
      blacklist: q(
        `SELECT b.id, b.reason, b.review, b.reply, b.created_at AS createdAt, a.name AS author, a.id AS authorId, a.verified = 'verified' AS counted
         FROM blacklist b JOIN companies a ON a.id = b.author_company WHERE b.company_id = ? ORDER BY b.id DESC`,
        c.id,
      ),
      listings: L.listings(req.user, `l.company_id = :c AND l.status = 'active' AND l.date_to >= :today`, { c: c.id, today: L.today() }).slice(0, 10),
    });
  });

  // ---------- чёрный список ----------
  app.get('/api/blacklist', auth, (req, res) => {
    res.json(
      q(
        `SELECT b.id, b.reason, b.review, b.created_at AS createdAt, b.author_company = :c AS mine,
           :admin AS canDelete, a.verified = 'verified' AS counted, t.id AS companyId, t.name, t.form, t.bin, a.name AS author, (SELECT COUNT(*) FROM blacklist x WHERE x.company_id = t.id) AS total
         FROM blacklist b JOIN companies t ON t.id = b.company_id JOIN companies a ON a.id = b.author_company
         WHERE t.name LIKE :t OR t.bin LIKE :t ORDER BY b.id DESC LIMIT 200`,
        { c: req.user.company_id, t: `%${String(req.query.q || '').trim()}%`, admin: req.user.is_admin ? 1 : 0 },
      ).map((b) => ({ ...b, mine: !!b.mine, canDelete: !!b.canDelete, counted: !!b.counted })),
    );
  });
  app.post('/api/blacklist', auth, owner, (req, res) => {
    const b = parse(z.object({ companyId: z.number().int(), reason: z.string().trim().min(3).max(200), review: z.string().trim().max(1000).default('') }), req.body);
    if (b.companyId === req.user.company_id) throw bad('own', 'Нельзя добавить свою компанию');
    if (!q1('SELECT 1 FROM companies WHERE id = ?', b.companyId)) throw bad('not_found', 'Компания не найдена', 404);
    if (!dealBetween(req.user.company_id, b.companyId))
      throw bad('no_deal', 'В чёрный список можно внести только компанию, с которой у вас был рейс. Если это мошенники — нажмите «Пожаловаться модератору»', 403);
    run(
      `INSERT INTO blacklist(company_id, author_user, author_company, reason, review) VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(company_id, author_company) DO UPDATE SET reason = excluded.reason, review = excluded.review`,
      b.companyId, req.user.id, req.user.company_id, b.reason, b.review,
    );
    notify(q('SELECT id FROM users WHERE company_id = ?', b.companyId).map((u) => u.id), {
      kind: 'system', title: 'О вашей компании появилась запись в чёрном списке', body: 'Вы можете ответить на неё на странице своей компании', link: `/company/${b.companyId}`,
    });
    res.json({ ok: true });
  });
  // Компания вправе один раз ответить на запись о себе.
  app.post('/api/blacklist/:id/reply', auth, owner, (req, res) => {
    const { reply } = parse(z.object({ reply: z.string().trim().min(3).max(1000) }), req.body);
    const changed = run('UPDATE blacklist SET reply = ? WHERE id = ? AND company_id = ?', reply, id(req), req.user.company_id).changes;
    if (!changed) throw bad('not_found', 'Запись не найдена', 404);
    res.json({ ok: true });
  });
  app.delete('/api/blacklist/:id', auth, (req, res) => {
    // автор убирает свою запись, модератор — любую
    if (req.user.is_admin) {
      const e = q1('SELECT c.name FROM blacklist b JOIN companies c ON c.id = b.company_id WHERE b.id = ?', id(req));
      run('DELETE FROM blacklist WHERE id = ?', id(req));
      if (e) L.modLog(req.user, 'blacklist_delete', e.name);
    }
    else {
      if (req.user.company_role !== 'owner') throw bad('forbidden', 'Доступно только владельцу компании', 403);
      run('DELETE FROM blacklist WHERE id = ? AND author_company = ?', id(req), req.user.company_id);
    }
    res.json({ ok: true });
  });

  // ---------- документы и проверка ----------
  app.get('/api/documents', auth, owner, (req, res) => {
    res.json(q('SELECT id, kind, filename, status, note, created_at AS createdAt FROM documents WHERE company_id = ? ORDER BY id DESC', req.user.company_id));
  });
  const docSchema = z.object({ kind: z.enum(L.DOC_KINDS), filename: z.string().trim().min(1).max(120), mime: z.string(), data: z.string().min(10) });
  app.post('/api/documents', auth, owner, (req, res) => {
    const b = parse(docSchema, req.body);
    const ext = Object.hasOwn(MIME, b.mime) ? MIME[b.mime] : null;
    if (!ext) throw bad('file_type', 'Допустимы PDF, JPG, PNG или WEBP');
    const buf = Buffer.from(b.data, 'base64');
    if (buf.length > 5 * 1024 * 1024) throw bad('file_size', 'Файл больше 5 МБ');
    if (q1('SELECT COUNT(*) AS n FROM documents WHERE company_id = ?', req.user.company_id).n >= 20) throw bad('limit', 'Не более 20 документов');
    // новый файл того же вида заменяет прежний непринятый: в очереди нет дублей
    for (const old of q(`SELECT id, path FROM documents WHERE company_id = ? AND kind = ? AND status != 'approved'`, req.user.company_id, b.kind)) {
      fs.rmSync(path.join(UPLOAD_DIR, path.basename(old.path)), { force: true });
      run('DELETE FROM documents WHERE id = ?', old.id);
    }
    const name = `${L.token(16)}.${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
    res.json({ id: insert('INSERT INTO documents(company_id, user_id, kind, filename, mime, path) VALUES(?, ?, ?, ?, ?, ?)',
      req.user.company_id, req.user.id, b.kind, b.filename, b.mime, name) });
  });
  app.get('/api/documents/:id/file', auth, (req, res) => {
    const d = q1('SELECT * FROM documents WHERE id = ?', id(req));
    const mineAsOwner = d && d.company_id === req.user.company_id && req.user.company_role === 'owner';
    if (!d || (!mineAsOwner && !req.user.is_admin)) throw bad('not_found', 'Документ не найден', 404);
    const file = path.join(UPLOAD_DIR, path.basename(d.path));
    if (!fs.existsSync(file)) throw bad('not_found', 'Файл документа не найден', 404);
    res.setHeader('Content-Type', d.mime);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(d.filename)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // файл могут удалить, пока он читается: ошибка потока не должна ронять сервер
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
  app.delete('/api/documents/:id', auth, owner, (req, res) => {
    const d = q1('SELECT * FROM documents WHERE id = ? AND company_id = ?', id(req), req.user.company_id);
    if (d) {
      fs.rmSync(path.join(UPLOAD_DIR, path.basename(d.path)), { force: true });
      run('DELETE FROM documents WHERE id = ?', d.id);
    }
    res.json({ ok: true });
  });
  app.post('/api/company/verify-request', auth, owner, (req, res) => {
    const c = q1('SELECT * FROM companies WHERE id = ?', req.user.company_id);
    if (!isValidBin(c.bin)) throw bad('bin', 'Сначала укажите корректный БИН/ИИН');
    if (!q1(`SELECT 1 FROM documents WHERE company_id = ? AND kind IN ('registration', 'id_card')`, c.id))
      throw bad('documents', 'Загрузите свидетельство о регистрации или удостоверение личности');
    if (c.verified === 'verified') throw bad('state', 'Компания уже проверена', 409);
    run(`UPDATE companies SET verified = 'pending', verify_note = '' WHERE id = ?`, c.id);
    res.json({ ok: true });
  });

  // ---------- модерация ----------
  app.get('/api/admin/queue', auth, L.admin, (_req, res) => {
    res.json({
      // вместе с заявкой — все документы компании: модератор видит картину целиком
      companies: q(`SELECT id, name, form, bin, kind, created_at AS createdAt FROM companies WHERE verified = 'pending' ORDER BY id`)
        .map((c) => ({ ...c, binValid: isValidBin(c.bin), docs: q(`SELECT id, kind, filename, status FROM documents WHERE company_id = ? ORDER BY id DESC`, c.id) })),
      documents: q(
        `SELECT d.id, d.kind, d.filename, d.status, d.created_at AS createdAt, c.id AS companyId, c.name AS companyName
         FROM documents d JOIN companies c ON c.id = d.company_id WHERE d.status = 'pending' ORDER BY d.id LIMIT 200`,
      ),
    });
  });
  const decision = z.object({ approve: z.boolean(), note: z.string().trim().max(500).default('') });
  app.post('/api/admin/companies/:id', auth, L.admin, (req, res) => {
    const d = parse(decision, req.body);
    const ok = d.approve;
    run('UPDATE companies SET verified = ?, verify_note = ? WHERE id = ?', ok ? 'verified' : 'rejected', ok ? '' : d.note, id(req));
    // при отказе непроверенные документы компании тоже отклоняются с той же причиной — компания видит, что исправить
    if (!ok) run(`UPDATE documents SET status = 'rejected', note = ? WHERE company_id = ? AND status = 'pending'`, d.note, id(req));
    L.modLog(req.user, ok ? 'verify_approve' : 'verify_reject', q1('SELECT name FROM companies WHERE id = ?', id(req))?.name, d.note);
    notify(q('SELECT id FROM users WHERE company_id = ?', id(req)).map((u) => u.id), {
      kind: 'system', title: ok ? 'Компания проверена' : 'Проверка компании не пройдена',
      body: ok ? 'В объявлениях появилась отметка «Проверена».' : d.note || 'Проверьте БИН и документы и отправьте заявку заново.', link: '/cabinet/profile',
    });
    res.json({ ok: true });
  });
  app.post('/api/admin/documents/:id', auth, L.admin, (req, res) => {
    const d = parse(decision, req.body);
    const doc = q1('SELECT d.*, c.name FROM documents d JOIN companies c ON c.id = d.company_id WHERE d.id = ?', id(req));
    if (!doc) throw bad('not_found', 'Документ не найден', 404);
    run('UPDATE documents SET status = ?, note = ? WHERE id = ?', d.approve ? 'approved' : 'rejected', d.approve ? '' : d.note, doc.id);
    L.modLog(req.user, d.approve ? 'doc_approve' : 'doc_reject', `${doc.name}: ${doc.filename}`, d.note);
    if (!d.approve) notify(q(`SELECT id FROM users WHERE company_id = ? AND company_role = 'owner'`, doc.company_id).map((u) => u.id), {
      kind: 'system', title: 'Документ отклонён модератором', body: d.note || doc.filename, link: '/cabinet/profile',
    });
    res.json({ ok: true });
  });

  // ---------- машины ----------
  const vehicleSchema = z.object({
    brand: z.string().trim().min(1).max(60),
    plate: z.string().trim().max(20).default(''),
    bodyType: z.enum(L.BODY).nullable().optional(),
    weight: optNum(500),
    volume: optNum(1000),
    loading: z.array(z.enum(L.LOADING)).default([]),
  });
  const vehicleOut = (v) => ({ id: v.id, brand: v.brand, plate: v.plate, bodyType: v.body_type, weight: v.weight, volume: v.volume, loading: L.j(v.loading, []) });
  app.get('/api/vehicles', auth, (req, res) => res.json(q('SELECT * FROM vehicles WHERE company_id = ? ORDER BY id DESC', req.user.company_id).map(vehicleOut)));
  app.post('/api/vehicles', auth, (req, res) => {
    const b = parse(vehicleSchema, req.body);
    res.json({ id: insert('INSERT INTO vehicles(company_id, brand, plate, body_type, weight, volume, loading) VALUES(?, ?, ?, ?, ?, ?, ?)',
      req.user.company_id, b.brand, b.plate, b.bodyType ?? null, b.weight ?? null, b.volume ?? null, JSON.stringify(b.loading)) });
  });
  app.put('/api/vehicles/:id', auth, (req, res) => {
    const b = parse(vehicleSchema, req.body);
    run('UPDATE vehicles SET brand = ?, plate = ?, body_type = ?, weight = ?, volume = ?, loading = ? WHERE id = ? AND company_id = ?',
      b.brand, b.plate, b.bodyType ?? null, b.weight ?? null, b.volume ?? null, JSON.stringify(b.loading), id(req), req.user.company_id);
    res.json({ ok: true });
  });
  app.delete('/api/vehicles/:id', auth, (req, res) => {
    run('DELETE FROM vehicles WHERE id = ? AND company_id = ?', id(req), req.user.company_id);
    res.json({ ok: true });
  });

  // ---------- сотрудники ----------
  const employeeSchema = z.object({
    name: z.string().trim().min(2).max(100),
    phone: z.string().trim().max(20).default(''),
    position: z.string().trim().max(60).default(''),
    licenseCats: z.string().trim().max(30).default(''),
    experience: optNum(70),
    esutd: z.enum(['unknown', 'registered', 'missing']).default('unknown'),
    esutdNumber: z.string().trim().max(40).default(''),
  });
  app.get('/api/employees', auth, (req, res) => {
    res.json(
      q(
        `SELECT id, name, phone, position, license_cats AS licenseCats, experience, esutd, esutd_number AS esutdNumber
         FROM employees WHERE company_id = ? ORDER BY id DESC`,
        req.user.company_id,
      ),
    );
  });
  app.post('/api/employees', auth, (req, res) => {
    const b = parse(employeeSchema, req.body);
    if (b.phone && q1('SELECT 1 FROM employees WHERE company_id = ? AND phone = ?', req.user.company_id, b.phone)) throw bad('exists', 'Этот человек уже есть в «Сотрудниках»', 409);
    res.json({ id: insert('INSERT INTO employees(company_id, name, phone, position, license_cats, experience, esutd, esutd_number) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
      req.user.company_id, b.name, b.phone, b.position, b.licenseCats, b.experience ?? null, b.esutd, b.esutdNumber) });
  });
  app.put('/api/employees/:id', auth, (req, res) => {
    const b = parse(employeeSchema, req.body);
    run('UPDATE employees SET name = ?, phone = ?, position = ?, license_cats = ?, experience = ?, esutd = ?, esutd_number = ? WHERE id = ? AND company_id = ?',
      b.name, b.phone, b.position, b.licenseCats, b.experience ?? null, b.esutd, b.esutdNumber, id(req), req.user.company_id);
    res.json({ ok: true });
  });
  app.delete('/api/employees/:id', auth, (req, res) => {
    run('DELETE FROM employees WHERE id = ? AND company_id = ?', id(req), req.user.company_id);
    res.json({ ok: true });
  });

  // ---------- баланс ----------
  app.get('/api/balance', auth, owner, (req, res) => {
    res.json({
      balance: q1('SELECT balance FROM companies WHERE id = ?', req.user.company_id).balance,
      transactions: q('SELECT id, amount, kind, note, created_at AS createdAt FROM transactions WHERE company_id = ? ORDER BY id DESC LIMIT 100', req.user.company_id),
    });
  });
  // Пополнение без платёжного провайдера доступно только в демо-режиме.
  app.post('/api/balance/topup', auth, owner, (req, res) => {
    if (!L.DEMO) throw bad('payments_off', 'Онлайн-оплата ещё не подключена', 501);
    const { amount } = parse(z.object({ amount: z.number().int().min(100).max(1_000_000) }), req.body);
    tx(() => {
      run('UPDATE companies SET balance = balance + ? WHERE id = ?', amount, req.user.company_id);
      run(`INSERT INTO transactions(company_id, amount, kind, note) VALUES(?, ?, 'topup', 'Демо-пополнение')`, req.user.company_id, amount);
    });
    res.json({ ok: true });
  });

  // ---------- работа: вакансии и резюме ----------
  const jobSchema = z.object({
    kind: z.enum(['vacancy', 'resume']),
    title: z.string().trim().min(3).max(120),
    cityId: z.string().refine((c) => cityById.has(c), 'Неизвестный город').nullable().optional(),
    vehicle: z.string().trim().max(120).default(''),
    licenseCats: z.string().trim().max(30).default(''),
    experience: optNum(70),
    salary: z.string().trim().max(60).default(''),
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    description: z.string().trim().max(2000).default(''),
  });
  app.get('/api/jobs', auth, (req, res) => {
    const kind = req.query.kind === 'resume' ? 'resume' : 'vacancy';
    res.json(
      q(
        `SELECT j.id, j.kind, j.title, j.city_id AS cityId, j.vehicle, j.license_cats AS licenseCats, j.experience, j.salary, j.date_from AS dateFrom,
           j.description, CASE WHEN j.user_id = :u OR COALESCE(json_extract(u.settings, '$.showPhone'), 1) THEN j.phone END AS phone, j.created_at AS createdAt, j.user_id = :u AS mine, u.name AS userName, c.name AS companyName, c.id AS companyId
         FROM jobs j JOIN users u ON u.id = j.user_id JOIN companies c ON c.id = j.company_id
         WHERE j.kind = :k AND j.status = 'active' AND (:city IS NULL OR j.city_id = :city) ORDER BY j.id DESC LIMIT 200`,
        { u: req.user.id, k: kind, city: cityById.has(req.query.city) ? req.query.city : null },
      ).map((r) => ({ ...r, mine: !!r.mine })),
    );
  });
  app.post('/api/jobs', auth, (req, res) => {
    const b = parse(jobSchema, req.body);
    res.json({ id: insert(
      `INSERT INTO jobs(kind, user_id, company_id, title, city_id, vehicle, license_cats, experience, salary, date_from, description, phone)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      b.kind, req.user.id, req.user.company_id, b.title, b.cityId ?? null, b.vehicle, b.licenseCats, b.experience ?? null, b.salary, b.dateFrom ?? null, b.description, req.user.phone) });
  });
  app.delete('/api/jobs/:id', auth, (req, res) => {
    run(`UPDATE jobs SET status = 'closed' WHERE id = ? AND user_id = ?`, id(req), req.user.id);
    res.json({ ok: true });
  });
}
