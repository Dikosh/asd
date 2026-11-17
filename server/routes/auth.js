// Вход по номеру телефона с одноразовым кодом, регистрация, профиль, события.
import { z } from 'zod';
import { q1, run, insert, tx } from '../db.js';
import { CITIES, isValidBin } from '../geo.js';
import * as L from '../lib.js';
import { sendSms } from '../sms.js';
import zlib from 'node:zlib';

const PLACES_JSON = Buffer.from(JSON.stringify(CITIES.map((c) => [c.id, c.ru, c.kz, c.en, c.country, c.lat, c.lon, c.region])));
const PLACES_GZ = zlib.gzipSync(PLACES_JSON);

const { bad, parse } = L;
const attempts = new Map();
function rateLimit(key, max, windowMs) {
  const t = Date.now();
  const list = (attempts.get(key) || []).filter((x) => t - x < windowMs);
  if (list.length >= max) throw bad('rate_limit', 'Слишком много попыток, попробуйте позже', 429);
  list.push(t);
  attempts.set(key, list);
}

export default function authRoutes(app) {
  app.get('/api/meta', (_req, res) => {
    res.json({
      demo: L.DEMO,
      flags: L.FLAGS,
      plan: L.PLAN,
      places: CITIES.length,
      roles: L.ROLES,
      body: L.BODY,
      cargo: L.CARGO,
      loading: L.LOADING,
      pay: L.PAY,
      currencies: L.CURRENCIES,
      stages: L.STAGES,
      docKinds: L.DOC_KINDS,
      boostPrice: L.BOOST_PRICE,
      stats: {
        cargo: q1(`SELECT COUNT(*) AS n FROM listings WHERE kind = 'cargo' AND status = 'active'`).n,
        truck: q1(`SELECT COUNT(*) AS n FROM listings WHERE kind = 'truck' AND status = 'active'`).n,
        companies: q1('SELECT COUNT(*) AS n FROM companies').n,
        trips: q1(`SELECT COUNT(*) AS n FROM trips WHERE status = 'completed'`).n,
      },
    });
  });

  app.get('/api/places', (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      res.setHeader('Content-Encoding', 'gzip');
      return res.end(PLACES_GZ);
    }
    res.end(PLACES_JSON);
  });

  app.post('/api/auth/request-code', async (req, res) => {
    const phone = L.normPhone(req.body?.phone);
    rateLimit('code:' + phone, 5, 10 * 60_000);
    rateLimit('ip:' + req.ip, 30, 10 * 60_000);
    const code = String(Math.floor(1000 + Math.random() * 9000));
    run(
      `INSERT INTO otps(phone, code, expires, attempts, reg_token) VALUES(?, ?, ?, 0, NULL)
       ON CONFLICT(phone) DO UPDATE SET code = excluded.code, expires = excluded.expires, attempts = 0, reg_token = NULL`,
      phone,
      code,
      Date.now() + 5 * 60_000,
    );
    await sendSms(phone, `Jolda: код входа ${code}`);
    res.json({ ok: true, devCode: L.DEMO ? code : undefined });
  });

  app.post('/api/auth/verify', (req, res) => {
    const phone = L.normPhone(req.body?.phone);
    const otp = q1('SELECT * FROM otps WHERE phone = ?', phone);
    if (!otp || otp.expires < Date.now()) throw bad('code_expired', 'Код устарел, запросите новый');
    if (otp.attempts >= 5) throw bad('rate_limit', 'Слишком много попыток, запросите новый код', 429);
    if (otp.code !== String(req.body?.code || '').trim()) {
      run('UPDATE otps SET attempts = attempts + 1 WHERE phone = ?', phone);
      throw bad('code_wrong', 'Неверный код');
    }
    const user = q1('SELECT * FROM users WHERE phone = ?', phone);
    if (user) {
      run('DELETE FROM otps WHERE phone = ?', phone);
      L.startSession(req, res, user.id);
      return res.json({ ...L.meOut(user), registered: true });
    }
    const regToken = L.token();
    run('UPDATE otps SET reg_token = ?, expires = ? WHERE phone = ?', regToken, Date.now() + 30 * 60_000, phone);
    // если компания уже пригласила этот номер, достаточно имени и почты
    const invite = q1('SELECT i.name, c.name AS companyName, c.form AS companyForm FROM invites i JOIN companies c ON c.id = i.company_id WHERE i.phone = ?', phone);
    res.json({ registered: false, regToken, invite: invite || null });
  });

  const regSchema = z.object({
    regToken: z.string().min(10),
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().email().max(120),
    companyName: z.string().trim().min(2).max(120).optional(),
    companyForm: z.enum(['ИП', 'ТОО']).optional(),
    role: z.enum(L.ROLES).optional(),
  });
  app.post('/api/auth/register', (req, res) => {
    const b = parse(regSchema, req.body);
    const otp = q1('SELECT * FROM otps WHERE reg_token = ?', b.regToken);
    if (!otp || otp.expires < Date.now()) throw bad('code_expired', 'Сессия регистрации истекла, подтвердите номер заново');
    const invite = q1('SELECT i.*, c.kind FROM invites i JOIN companies c ON c.id = i.company_id WHERE i.phone = ?', otp.phone);
    if (!invite && (!b.companyName || !b.companyForm || !b.role)) throw bad('validation', 'Укажите компанию и роль');
    const userId = tx(() => {
      run('DELETE FROM otps WHERE phone = ?', otp.phone);
      if (invite) {
        // сотрудник присоединяется к компании, которая его пригласила
        run('DELETE FROM invites WHERE id = ?', invite.id);
        return insert('INSERT INTO users(name, phone, email, role, company_id, company_role) VALUES(?, ?, ?, ?, ?, ?)',
          b.name, otp.phone, b.email, invite.role === 'driver' ? 'driver' : invite.kind, invite.company_id, invite.role === 'driver' ? 'driver' : 'manager');
      }
      const companyId = insert('INSERT INTO companies(name, form, kind) VALUES(?, ?, ?)', b.companyName, b.companyForm, b.role);
      return insert('INSERT INTO users(name, phone, email, role, company_id) VALUES(?, ?, ?, ?, ?)', b.name, otp.phone, b.email, b.role, companyId);
    });
    L.startSession(req, res, userId);
    res.json(L.meOut(q1('SELECT * FROM users WHERE id = ?', userId)));
  });

  // Быстрый вход под демо-аккаунтом — только в демо-режиме.
  app.post('/api/auth/demo', (req, res) => {
    if (!L.DEMO) throw bad('forbidden', 'Демо-режим выключен', 403);
    const role = req.body?.role;
    const user =
      role === 'admin'
        ? q1('SELECT * FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1')
        : q1('SELECT * FROM users WHERE role = ? AND is_admin = 0 ORDER BY id LIMIT 1', String(role));
    if (!user) throw bad('not_found', 'Демо-аккаунт не найден', 404);
    L.startSession(req, res, user.id);
    res.json(L.meOut(user));
  });

  app.post('/api/auth/logout', (req, res) => {
    L.endSession(req, res);
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => {
    if (!req.user) return res.json(null);
    res.json(L.meOut(req.user));
  });

  const meSchema = z.object({
    name: z.string().trim().min(2).max(100).optional(),
    email: z.string().trim().email().max(120).optional(),
    settings: z.record(z.union([z.boolean(), z.string()])).optional(),
  });
  app.patch('/api/me', L.auth, (req, res) => {
    const b = parse(meSchema, req.body);
    if (b.name) run('UPDATE users SET name = ? WHERE id = ?', b.name, req.user.id);
    if (b.email) run('UPDATE users SET email = ? WHERE id = ?', b.email, req.user.id);
    if (b.settings) run('UPDATE users SET settings = ? WHERE id = ?', JSON.stringify({ ...L.j(req.user.settings, {}), ...b.settings }), req.user.id);
    res.json(L.meOut(q1('SELECT * FROM users WHERE id = ?', req.user.id)));
  });

  const companySchema = z.object({
    about: z.string().max(1000).optional(),
    cityId: z.string().nullable().optional(),
    bin: z.string().trim().optional(),
  });
  app.patch('/api/company', L.auth, (req, res) => {
    const b = parse(companySchema, req.body);
    const id = req.user.company_id;
    if (b.about !== undefined) run('UPDATE companies SET about = ? WHERE id = ?', b.about, id);
    if (b.cityId !== undefined) run('UPDATE companies SET city_id = ? WHERE id = ?', b.cityId, id);
    if (b.bin !== undefined) {
      if (b.bin && !isValidBin(b.bin)) throw bad('bin', 'БИН/ИИН не прошёл проверку контрольного разряда');
      // смена БИН сбрасывает подтверждение компании
      run(`UPDATE companies SET bin = ?, verified = CASE WHEN bin IS ? THEN verified ELSE 'none' END WHERE id = ?`, b.bin || null, b.bin || null, id);
    }
    res.json(L.meOut(req.user));
  });

  app.get('/api/events', L.auth, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': connected\n\n');
    L.subscribe(req.user.id, res);
  });
}
