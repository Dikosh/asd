// Точка входа: API + раздача собранного интерфейса.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { q1, run } from './db.js';
import { DEMO, HttpError, PROD, TILE_ORIGIN, ip, loadUser } from './lib.js';
import authRoutes, { rateLimit, syncAdmins } from './routes/auth.js';
import listingRoutes, { expireListings } from './routes/listings.js';
import dealRoutes, { autoCompleteTrips } from './routes/deals.js';
import companyRoutes from './routes/company.js';
import extraRoutes from './routes/extras.js';
import relocationRoutes from './routes/relocation.js';
import serviceRoutes from './routes/services.js';
import shipperRoutes from './routes/shippers.js';
import { loadRates } from './rates.js';
import { checkHealth } from './health.js';
import { seed } from './seed.js';
import { startTelegram } from './telegram.js';
import { handleWebhook, signed, wa } from './whatsapp.js';
import { closeReview } from './review.js';

// Что может менять водитель из команды: вести рейс и свои личные настройки. Остальное — сотрудники и владелец.
// По ссылке водителя (/drive/…) право даёт сама ссылка, поэтому вошедшему водителю она тоже доступна.
const DRIVER_WRITE = [/^\/trips\/\d+\/(stage|gps|positions?|files)$/, /^\/drive\/[^/]+\/(stage|gps|positions?|files)$/, /^\/notifications\/read$/, /^\/push\//, /^\/me$/, /^\/auth\//, /^\/feedback$/, /^\/team\/accept$/];
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
  // Кто пришёл и не слишком ли часто — выясняется до разбора тела запроса: иначе большими запросами можно нагружать
  // сервер без входа и поверх предела частоты.
  app.use('/api', loadUser, (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    // общий предел частоты запросов: защищает от перебора и случайных циклов в клиенте
    rateLimit(req.user ? `u:${req.user.id}` : `a:${ip(req)}`, 600, 60_000, 'Слишком много запросов, подождите минуту');
    next();
  });
  // Сообщения WhatsApp от Meta. Подпись считается по телу запроса как есть, поэтому разбор — до общего express.json
  app.get('/api/whatsapp/webhook', (req, res) => {
    const ok = wa.verify && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === wa.verify;
    if (!ok) throw new HttpError(403, 'forbidden', 'Нет доступа');
    res.type('text/plain').send(String(req.query['hub.challenge'] || ''));
  });
  app.post('/api/whatsapp/webhook', express.raw({ type: () => true, limit: '1mb' }), (req, res) => {
    if (!signed(req.body, req.get('x-hub-signature-256'))) throw new HttpError(403, 'forbidden', 'Нет доступа');
    let data;
    try {
      data = JSON.parse(req.body.toString('utf8'));
    } catch {
      throw new HttpError(400, 'bad_json', 'Запрос повреждён — попробуйте ещё раз');
    }
    res.json({ ok: true }); // ответ сразу: иначе Meta присылает то же самое ещё раз
    handleWebhook(data).catch((e) => console.error('[whatsapp]', e));
  });
  // большое тело запроса нужно только для загрузки файла: вошедшему — до 8 МБ, по ссылке водителя — тоже (право даёт ссылка),
  // и таких загрузок с одного адреса или аккаунта — не больше 20 в минуту
  app.use(/^\/api\/(documents|chats\/\d+\/files|trips\/\d+\/files|drive\/[^/]+\/files|admin\/shippers(\/\d+)?)$/, (req, _res, next) => {
    if (!req.user && !req.originalUrl.startsWith('/api/drive/')) return next(new HttpError(401, 'unauthorized', 'Требуется вход'));
    rateLimit(req.user ? `up:${req.user.id}` : `up:${ip(req)}`, 20, 60_000, 'Слишком много запросов, подождите минуту');
    next();
  }, express.json({ limit: '8mb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', (req, res, next) => {
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
    // поисковикам: внутренние разделы и личные ссылки рейсов не индексировать
    app.get('/robots.txt', (_req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /api/\nDisallow: /cabinet\nDisallow: /t/\nDisallow: /d/\n'));
    app.get(/^\/(t|d)\//, (_req, res, next) => { res.setHeader('X-Robots-Tag', 'noindex, nofollow'); next(); });
    app.get('/sw.js', (_req, res) => res.sendFile(path.join(dist, 'sw.js'), { headers: { 'Cache-Control': 'no-cache' } }));
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } }));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (res.headersSent) return res.destroy();
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, message: err.message, ...err.extra });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large', message: 'Слишком большой запрос' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json', message: 'Запрос повреждён — попробуйте ещё раз' });
    // прочие ошибки разбора запроса (кодировка, обрыв, неверный адрес) — это ошибка клиента, а не сервера
    if (err.status >= 400 && err.status < 500 && !err.code?.startsWith?.('SQLITE')) return res.status(400).json({ error: 'bad_request', message: 'Запрос повреждён — попробуйте ещё раз' });
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
    run(`DELETE FROM sessions WHERE COALESCE(used_at, created_at) < strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')`);
    run(`DELETE FROM login_codes WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days')`);
    // вход истёк сам — уведомления на его устройство тоже прекращаются
    for (const table of ['push_subs', 'push_devices']) run(`DELETE FROM ${table} WHERE sid IS NOT NULL AND sid NOT IN (SELECT token FROM sessions)`);
    run(`DELETE FROM invites WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-14 days')`);
    // связка номера с чатом Telegram, которой полгода не входили: номер мог сменить владельца — пусть подтвердит заново
    run(`DELETE FROM tg_links WHERE COALESCE(used_at, created_at) < strftime('%Y-%m-%dT%H:%M:%fZ','now','-180 days')`);
    run(`DELETE FROM route_cache WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 days')`);
    // на боевом сервере — присмотр за резервными копиями и местом на диске
    if (PROD) checkHealth();
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
export function demoBase() {
  const prev = q1(`SELECT value FROM app_state WHERE key = 'demo'`)?.value;
  // база старше этой отметки: если в ней есть демо-пользователи, значит демо включали
  return prev === undefined ? !!q1('SELECT 1 FROM users WHERE is_demo = 1 LIMIT 1') : prev === '1';
}
export function leaveDemoMode() {
  const wasDemo = demoBase();
  if (!DEMO && wasDemo) {
    for (const table of ['sessions', 'login_codes', 'known_devices', 'push_subs', 'push_devices']) run(`DELETE FROM ${table}`);
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
  // В демо любой посетитель мог стать администратором и выдать кому угодно «проверено», баланс и тариф. Такую базу
  // боевой не делаем: настоящие пользователи начинают с чистой. Установщик при выключении демо сам убирает её в архив.
  if (!DEMO && PROD && demoBase() && process.env.DEMO_DATA_KEEP !== '1') {
    console.error('Сервер не запущен: база создана в демо-режиме, а демо выключено. В ней остались компании, проверки, балансы и объявления, '
      + 'сделанные когда угодно и кем угодно. Уберите базу демо-стенда (папка данных) и запустите с чистой. '
      + 'Оставить её осознанно: DEMO_DATA_KEEP=1.');
    process.exit(1);
  }
  leaveDemoMode();
  syncAdmins();
  closeReview();
  if (DEMO && !q1('SELECT 1 FROM users LIMIT 1')) seed();
  const port = Number(process.env.PORT || 3000);
  housekeeping();
  setInterval(housekeeping, 15 * 60_000).unref();
  // HOST=127.0.0.1 (так ставит установщик): программа принимает соединения только от веб-сервера на той же машине
  const server = createApp().listen(port, process.env.HOST || undefined);
  server.on('listening', () => console.log(`Ovi: http://localhost:${port}${DEMO ? ' (демо-режим)' : ''}`));
  startTelegram(); // бот с кодами входа; без TELEGRAM_BOT_TOKEN ничего не делает
  server.on('error', (e) => {
    console.error(`Не удалось запустить сервер на порту ${port}: ${e.code === 'EADDRINUSE' ? 'порт занят' : e.message}`);
    process.exit(1);
  });
  // необработанная ошибка в одном запросе не должна останавливать сервер для всех
  process.on('uncaughtException', (e) => console.error('[uncaught]', e));
  process.on('unhandledRejection', (e) => console.error('[unhandled]', e));
}
