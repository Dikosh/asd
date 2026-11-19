// Выключение демо-режима: демо-аккаунты перестают действовать, входы, открытые во время демо, закрываются,
// а на боевом сервере демо не запускается без явного подтверждения. Здесь сервер работает БЕЗ демо-режима.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jolda-test-demo-off-'));
delete process.env.DEMO_MODE;
delete process.env.SMS_WEBHOOK_URL;
delete process.env.OSRM_URL;
delete process.env.FCM_SERVICE_ACCOUNT;
const { createApp, leaveDemoMode } = await import('../server/index.js');
const { seed } = await import('../server/seed.js');
const { q1, run, insert } = await import('../server/db.js');

const entry = fileURLToPath(new URL('../server/index.js', import.meta.url));
let server;
let base;
let demoAdmin;
let realUser;
before(async () => {
  // база после показа: демо-данные, настоящий пользователь и входы, открытые во время демо
  seed();
  run(`INSERT INTO app_state(key, value) VALUES('demo', '1')`);
  demoAdmin = q1('SELECT * FROM users WHERE is_admin = 1 AND is_demo = 1');
  const company = insert(`INSERT INTO companies(name, form) VALUES('Настоящая компания', 'ТОО')`);
  realUser = { id: insert(`INSERT INTO users(name, phone, email, role, company_id, accepted_terms) VALUES('Настоящий Пользователь', '+77059990001', '', 'customer', ?, '2026-01-01')`, company) };
  run(`INSERT INTO sessions(token, user_id) VALUES('demo-admin-sid', ?)`, demoAdmin.id);
  run(`INSERT INTO sessions(token, user_id) VALUES('real-user-sid', ?)`, realUser.id);
  run(`INSERT INTO push_devices(user_id, token, platform) VALUES(?, 'device-token-1', 'android')`, realUser.id);
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = async (method, url, { sid, body } = {}) => {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(sid ? { Cookie: `sid=${sid}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};

test('вход демо-администратора, открытый во время демо, не действует', async () => {
  assert.equal((await call('GET', '/api/me', { sid: 'demo-admin-sid' })).data, null);
  assert.equal((await call('GET', '/api/admin/metrics', { sid: 'demo-admin-sid' })).status, 401);
});

test('быстрый вход и код на экране выключены, демо-номер недоступен', async () => {
  assert.equal((await call('POST', '/api/auth/demo', { body: { role: 'admin' } })).status, 403);
  assert.equal((await call('POST', '/api/auth/request-code', { body: { phone: demoAdmin.phone } })).status, 403);
  // без SMS-провайдера код не выдаётся и на экран не попадает
  const r = await call('POST', '/api/auth/request-code', { body: { phone: '+77059990002' } });
  assert.equal(r.status, 503);
  assert.equal(r.data.devCode, undefined);
  assert.equal((await call('GET', '/api/meta')).data.demo, false);
});

test('при первом запуске без демо закрываются все входы и отвязываются устройства', async () => {
  // под настоящим номером во время демо мог войти кто угодно — этот вход пока жив
  assert.equal((await call('GET', '/api/me', { sid: 'real-user-sid' })).data.user.id, realUser.id);
  leaveDemoMode();
  assert.equal((await call('GET', '/api/me', { sid: 'real-user-sid' })).data, null);
  assert.equal(q1('SELECT COUNT(*) AS n FROM sessions').n, 0);
  assert.equal(q1('SELECT COUNT(*) AS n FROM push_devices').n, 0);
  assert.equal(q1(`SELECT value FROM app_state WHERE key = 'demo'`).value, '0');
});

test('следующие запуски без демо входы не трогают', () => {
  run(`INSERT INTO sessions(token, user_id) VALUES('real-user-sid-2', ?)`, realUser.id);
  leaveDemoMode();
  assert.equal(q1('SELECT COUNT(*) AS n FROM sessions').n, 1);
});

test('база без отметки о режиме, но с демо-пользователями считается базой после демо', () => {
  run(`DELETE FROM app_state WHERE key = 'demo'`);
  leaveDemoMode();
  assert.equal(q1('SELECT COUNT(*) AS n FROM sessions').n, 0);
});

const env = (extra) => ({ ...process.env, DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'jolda-test-demo-prod-')), NODE_ENV: 'production', PORT: '0', ...extra });

test('демо на боевом сервере без подтверждения не запускается', () => {
  const r = spawnSync(process.execPath, [entry], { env: env({ DEMO_MODE: '1' }), encoding: 'utf8', timeout: 20_000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /DEMO_CONFIRM=1/);
});

test('демо-стенд с подтверждением запускается', async () => {
  const child = spawn(process.execPath, [entry], { env: env({ DEMO_MODE: '1', DEMO_CONFIRM: '1' }) });
  try {
    const out = await new Promise((resolve, reject) => {
      let text = '';
      const timer = setTimeout(() => reject(new Error('сервер не запустился: ' + text)), 30_000);
      child.stdout.on('data', (d) => {
        text += d;
        if (text.includes('демо-режим')) { clearTimeout(timer); resolve(text); }
      });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`сервер завершился с кодом ${code}: ${text}`)); });
    });
    assert.match(out, /Jolda: http:\/\/localhost:\d+ \(демо-режим\)/);
  } finally {
    child.removeAllListeners('exit');
    child.kill();
  }
});
