// Push в мобильное приложение через Firebase Cloud Messaging (HTTP v1), без сторонних библиотек.
// Ключ — файл сервисного аккаунта Firebase: путь в FCM_SERVICE_ACCOUNT, по умолчанию <DATA_DIR>/fcm.json.
// Нет файла — push в приложение просто выключен (пишем в журнал один раз).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './db.js';

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
// адреса Google; тесты подменяют их на локальный сервер-заглушку
export const endpoints = { token: TOKEN_URL, api: 'https://fcm.googleapis.com' };

let account; // undefined — ещё не читали, null — выключено
export function fcmAccount() {
  if (account !== undefined) return account;
  const file = process.env.FCM_SERVICE_ACCOUNT || path.join(DATA_DIR, 'fcm.json');
  account = null;
  try {
    const sa = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!sa.project_id || !sa.client_email || !sa.private_key) throw new Error('нет project_id, client_email или private_key');
    crypto.createPrivateKey(sa.private_key); // ключ читается — иначе ошибка сразу, а не при каждой отправке
    account = sa;
    console.log(`[fcm] push в приложение включён (проект ${sa.project_id})`);
  } catch (e) {
    if (e.code === 'ENOENT') console.log(`[fcm] нет файла ${file} — push в мобильное приложение выключен`);
    else console.error(`[fcm] не удалось прочитать ${file} — push в мобильное приложение выключен:`, e.message);
  }
  return account;
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** JWT сервисного аккаунта для обмена на токен доступа OAuth2 (RS256). */
export function fcmJwt(sa, nowSec = Math.floor(Date.now() / 1000)) {
  const head = b64({ alg: 'RS256', typ: 'JWT', ...(sa.private_key_id ? { kid: sa.private_key_id } : {}) });
  const claims = b64({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${claims}`), sa.private_key).toString('base64url');
  return `${head}.${claims}.${sig}`;
}

// токен доступа живёт час; берём новый за 5 минут до конца. Одновременные запросы ждут один и тот же обмен.
let access = null; // { token, until }
let pending = null;
async function accessToken(sa) {
  if (access && Date.now() < access.until) return access.token;
  pending ||= (async () => {
    try {
      const res = await fetch(endpoints.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: fcmJwt(sa) }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.access_token) throw new Error(`OAuth ${res.status}: ${data.error_description || data.error || 'нет access_token'}`);
      access = { token: data.access_token, until: Date.now() + (Number(data.expires_in) || 3600) * 1000 - 5 * 60_000 };
      return access.token;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

/** Ошибка FCM означает, что токен устройства больше не действует, — строку устройства нужно удалить. */
export function deadToken(status, error = {}) {
  if (status === 404) return true;
  const details = Array.isArray(error.details) ? error.details : [];
  if (details.some((d) => d?.errorCode === 'UNREGISTERED') || error.status === 'UNREGISTERED') return true;
  if (error.status !== 'INVALID_ARGUMENT') return false;
  // INVALID_ARGUMENT бывает и из-за содержимого сообщения — удаляем, только если речь о токене
  const fields = details.flatMap((d) => (Array.isArray(d?.fieldViolations) ? d.fieldViolations : []));
  return fields.some((f) => /token/i.test(f?.field || '')) || /registration token|message\.token|\btoken\b/i.test(error.message || '');
}

/** Сообщение FCM v1: notification — заголовок и текст, data — только строки. */
export function fcmMessage(token, { title, body, link, kind, id }) {
  return {
    token,
    notification: { title: String(title ?? ''), body: String(body ?? '') },
    data: { link: String(link ?? ''), kind: String(kind ?? ''), id: String(id ?? '') },
    android: { priority: 'high' },
    apns: { payload: { aps: { sound: 'default' } } },
  };
}

/**
 * Отправить на одно устройство. Возвращает 'ok', 'dead' (токен недействителен — удалить) или 'error'.
 * Не бросает исключений.
 */
export async function fcmSend(token, msg) {
  const sa = fcmAccount();
  if (!sa) return 'off';
  try {
    const res = await fetch(`${endpoints.api}/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await accessToken(sa)}` },
      body: JSON.stringify({ message: fcmMessage(token, msg) }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) return 'ok';
    const error = (await res.json().catch(() => ({}))).error || {};
    if (res.status === 401) access = null; // токен доступа отозван — в следующий раз возьмём новый
    if (deadToken(res.status, error)) return 'dead';
    console.error(`[fcm] ${res.status} ${error.status || ''} ${error.message || ''}`.trim());
    return 'error';
  } catch (e) {
    console.error('[fcm]', e.message);
    return 'error';
  }
}
