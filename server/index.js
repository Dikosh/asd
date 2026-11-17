// Точка входа: API + раздача собранного интерфейса.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { q1 } from './db.js';
import { DEMO, HttpError, loadUser } from './lib.js';
import authRoutes from './routes/auth.js';
import listingRoutes from './routes/listings.js';
import dealRoutes from './routes/deals.js';
import companyRoutes from './routes/company.js';
import extraRoutes from './routes/extras.js';
import { seed } from './seed.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '8mb' }));
  app.use('/api', loadUser);

  authRoutes(app);
  listingRoutes(app);
  dealRoutes(app);
  companyRoutes(app);
  extraRoutes(app);

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'not_found', 'Нет такого метода')));

  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web/dist');
  if (fs.existsSync(dist)) {
    // сервис-воркер должен обновляться сразу, остальное можно кэшировать
    app.get('/sw.js', (_req, res) => res.sendFile(path.join(dist, 'sw.js'), { headers: { 'Cache-Control': 'no-cache' } }));
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, message: err.message });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large', message: 'Слишком большой запрос' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json', message: 'Некорректный JSON' });
    console.error(err);
    res.status(500).json({ error: 'internal', message: 'Внутренняя ошибка сервера' });
  });
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (DEMO && !q1('SELECT 1 FROM users LIMIT 1')) seed();
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, () => console.log(`Jolda: http://localhost:${port}${DEMO ? ' (демо-режим)' : ''}`));
}
