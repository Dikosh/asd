// Точка входа: API + раздача собранного интерфейса.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { q1, run } from './db.js';
import { DEMO, HttpError, PROD, TILE_ORIGIN, loadUser } from './lib.js';
import authRoutes, { rateLimit } from './routes/auth.js';
import listingRoutes, { expireListings } from './routes/listings.js';
import dealRoutes, { autoCompleteTrips } from './routes/deals.js';
import companyRoutes from './routes/company.js';
import extraRoutes from './routes/extras.js';
import relocationRoutes from './routes/relocation.js';
import serviceRoutes from './routes/services.js';
import shipperRoutes from './routes/shippers.js';
import { loadRates } from './rates.js';
import { seed } from './seed.js';

// Что может менять водитель из команды: вести рейс и свои личные настройки. Остальное — сотрудники и владелец.
// По ссылке водителя (/drive/…) право даёт сама ссылка, поэтому вошедшему водителю она тоже доступна.
const DRIVER_WRITE = [/^\/trips\/\d+\/(stage|gps|position|files)$/, /^\/drive\/[^/]+\/(stage|gps|position|files)$/, /^\/notifications\/read$/, /^\/push\//, /^\/me$/, /^\/auth\//, /^\/feedback$/, /^\/team\/accept$/];
// Что водитель из команды видит: свои рейсы и их файлы, профиль, команду, справочные разделы. Список разрешающий:
// объявления, ставки, отклики, чаты, деньги и всё, что появится позже, для него закрыто, пока не добавлено сюда.
const DRIVER_READ = [
  /^\/(me|meta|events|notifications|news|places|team|jobs|services|shippers)$/, /^\/trips(\/\d+)?$/, /^\/files\/\d+$/, /^\/companies(\/\d+)?$/,
  /^\/shippers\/\d+\/logo$/, /^\/feedback\/mine$/, /^\/(push|tools|drive|track|public|auth)\//,
];

export function createApp() {
  const app = express();
  // Заголовкам X-Forwarded-* верим, только если сервер действительно стоит за прокси (TRUST_PROXY=1).
  app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // сервер карт должен видеть, с какого сайта идёт запрос (иначе OpenStreetMap отвечает «Access blocked»)
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org ${TILE_ORIGIN}; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
    );
    if (PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
  // большое тело запроса нужно только для загрузки документа
  app.use(/^\/api\/(documents|chats\/\d+\/files|trips\/\d+\/files|drive\/[^/]+\/files|admin\/shippers(\/\d+)?)$/, express.json({ limit: '8mb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', loadUser, (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    // общий предел частоты запросов: защищает от перебора и случайных циклов в клиенте
    rateLimit(req.user ? `u:${req.user.id}` : `a:${req.ip}`, 600, 60_000, 'Слишком много запросов, подождите минуту');
    const u = req.user;
    if (u?.company_role === 'driver') {
      const blocked = !(req.method === 'GET' ? DRIVER_READ : DRIVER_WRITE).some((r) => r.test(req.path));
      if (blocked) return next(new HttpError(403, 'forbidden', 'Водителю это действие недоступно — обратитесь к владельцу компании'));
    }
    next();
  });

  authRoutes(app);
  listingRoutes(app);
  dealRoutes(app);
  companyRoutes(app);
  extraRoutes(app);
  relocationRoutes(app);
  serviceRoutes(app);
  shipperRoutes(app);

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'not_found', 'Нет такого метода')));

  const dist = process.env.WEB_DIST || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web/dist');
  if (fs.existsSync(dist)) {
    // сервис-воркер должен обновляться сразу, остальное можно кэшировать
    app.get('/sw.js', (_req, res) => res.sendFile(path.join(dist, 'sw.js'), { headers: { 'Cache-Control': 'no-cache' } }));
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } }));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (res.headersSent) return res.destroy();
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, message: err.message, ...err.extra });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large', message: 'Слишком большой запрос' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json', message: 'Некорректный JSON' });
    console.error(err);
    res.status(500).json({ error: 'internal', message: 'Внутренняя ошибка сервера' });
  });
  return app;
}

/** Фоновые работы: истёкшие объявления, зависшие рейсы, старые сессии, курсы валют. */
export function housekeeping() {
  try {
    expireListings();
    autoCompleteTrips();
    run(`DELETE FROM sessions WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')`);
    run('DELETE FROM otps WHERE expires < ?', Date.now() - 3600_000);
    run(`DELETE FROM invites WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-14 days')`);
    run(`DELETE FROM route_cache WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 days')`);
  } catch (e) {
    console.error('[housekeeping]', e);
  }
  loadRates();
}

/**
 * Переход из демо-режима в боевой. В демо код входа виден на экране, поэтому под любым номером мог войти кто угодно.
 * При первом запуске без демо закрываем все входы, открытые за время демо, и отвязываем устройства от уведомлений:
 * каждый входит заново, уже по коду из SMS.
 */
export function leaveDemoMode() {
  const prev = q1(`SELECT value FROM app_state WHERE key = 'demo'`)?.value;
  // база старше этой отметки: если в ней есть демо-пользователи, значит демо включали
  const wasDemo = prev === undefined ? !!q1('SELECT 1 FROM users WHERE is_demo = 1 LIMIT 1') : prev === '1';
  if (!DEMO && wasDemo) {
    for (const table of ['sessions', 'otps', 'push_subs', 'push_devices']) run(`DELETE FROM ${table}`);
    console.warn('Демо-режим выключен: все входы, открытые во время демо, закрыты. Демо-аккаунты больше не действуют.');
  }
  run(`INSERT INTO app_state(key, value) VALUES('demo', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, DEMO ? '1' : '0');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // демо открывает вход под любым номером и под администратором — на сервере в интернете только с явным подтверждением
  if (DEMO && PROD && process.env.DEMO_CONFIRM !== '1') {
    console.error('Сервер не запущен: включён демо-режим (DEMO_MODE=1) на боевом сервере. В демо любой посетитель входит под любым номером и как администратор.\n'
      + 'Для настоящих пользователей уберите DEMO_MODE. Если это стенд для показа, подтвердите: DEMO_CONFIRM=1.');
    process.exit(1);
  }
  if (DEMO && PROD) console.warn('ВНИМАНИЕ: демо-режим на сервере в боевой конфигурации — вход под любой ролью открыт всем. Только для показа.');
  leaveDemoMode();
  if (DEMO && !q1('SELECT 1 FROM users LIMIT 1')) seed();
  const port = Number(process.env.PORT || 3000);
  housekeeping();
  setInterval(housekeeping, 15 * 60_000).unref();
  const server = createApp().listen(port);
  server.on('listening', () => console.log(`Jolda: http://localhost:${port}${DEMO ? ' (демо-режим)' : ''}`));
  server.on('error', (e) => {
    console.error(`Не удалось запустить сервер на порту ${port}: ${e.code === 'EADDRINUSE' ? 'порт занят' : e.message}`);
    process.exit(1);
  });
  // необработанная ошибка в одном запросе не должна останавливать сервер для всех
  process.on('uncaughtException', (e) => console.error('[uncaught]', e));
  process.on('unhandledRejection', (e) => console.error('[unhandled]', e));
}
