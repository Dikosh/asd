// Уведомления: запись в базу, мгновенная доставка в открытое приложение (SSE), push в браузер (Web Push)
// и в мобильное приложение (Firebase Cloud Messaging, server/fcm.js).
// Сообщения чата в список уведомлений не пишутся — о них уходит только push (pushOnly).
import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import { DATA_DIR, q, q1, run, insert } from './db.js';
import { j, push, openSessions } from './lib.js';
import { render } from './i18n.js';
import { fcmAccount, fcmSend } from './fcm.js';

// Ключи для push создаются один раз и хранятся рядом с базой.
const keyFile = path.join(DATA_DIR, 'vapid.json');
let vapid;
try {
  vapid = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
} catch {
  vapid = webpush.generateVAPIDKeys();
  fs.writeFileSync(keyFile, JSON.stringify(vapid), { mode: 0o600 });
}
webpush.setVapidDetails(process.env.PUSH_CONTACT || 'mailto:support@jolda.local', vapid.publicKey, vapid.privateKey);
export const pushPublicKey = vapid.publicKey;

// Push отправляется только на серверы браузеров — иначе подпиской можно заставить сервер стучаться по произвольному адресу.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /\.push\.apple\.com$/];
export function isPushEndpoint(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && PUSH_HOSTS.some((r) => r.test(u.hostname));
  } catch {
    return false;
  }
}

/**
 * Уведомить пользователей. title и body — русские шаблоны из server/i18n.js (или текст человека), vars — подстановки;
 * kind — тип для значка, link — куда перейти по нажатию.
 */
export function notify(userIds, payload) {
  // уведомление — побочное действие: его сбой не должен ломать основную операцию
  try {
    deliver(userIds, payload);
  } catch (e) {
    console.error('[notify]', e);
  }
}
function deliver(userIds, { kind, title, body = '', link = '', vars = {} }) {
  for (const userId of new Set([userIds].flat())) {
    const id = insert('INSERT INTO notifications(user_id, kind, title, body, link, vars) VALUES(?, ?, ?, ?, ?, ?)', userId, kind, title, body, link, JSON.stringify(vars));
    push(userId, 'notify', { id, kind, title, body, link, vars });
    sendPush(userId, { kind, title, body, link, vars, id });
  }
}

/**
 * Только push, без записи в «Уведомления»: для сообщений чата — их слишком много для списка, а счётчик непрочитанного
 * у чата свой. В браузер, где сайт сейчас открыт, push не идёт: человек и так видит новое сообщение.
 * В мобильное приложение идёт всегда: открытое приложение push не показывает, а закрытое иначе о сообщении не узнает.
 */
export function pushOnly(userIds, payload) {
  try {
    for (const userId of new Set([userIds].flat())) sendPush(userId, payload, { skipOpen: true });
  } catch (e) {
    console.error('[notify]', e);
  }
}

/** Push на устройства человека: в браузер (Web Push) и в мобильное приложение (FCM). Текст — на его языке. */
function sendPush(userId, { kind, title, body = '', link = '', vars = {}, id = '' }, { skipOpen = false } = {}) {
  const lang = j(q1('SELECT settings FROM users WHERE id = ?', userId)?.settings, {}).lang;
  const text = { title: render(title, vars, lang), body: render(body, vars, lang) };
  const open = skipOpen ? openSessions(userId) : null;
  for (const sub of q('SELECT id, endpoint, keys, sid FROM push_subs WHERE user_id = ? LIMIT 5', userId)) {
    if (!isPushEndpoint(sub.endpoint) || open?.has(sub.sid)) continue;
    webpush
      .sendNotification({ endpoint: sub.endpoint, keys: JSON.parse(sub.keys) }, JSON.stringify({ ...text, link }), { TTL: 3600, timeout: 5000 })
      .catch((e) => {
        // подписка отозвана на устройстве — удаляем её
        if (e.statusCode === 404 || e.statusCode === 410) run('DELETE FROM push_subs WHERE id = ?', sub.id);
      });
  }
  // мобильное приложение: те же заголовок и текст; data — куда перейти и что за уведомление
  if (!fcmAccount()) return;
  for (const dev of q('SELECT id, token FROM push_devices WHERE user_id = ? ORDER BY updated_at DESC LIMIT 5', userId)) {
    fcmSend(dev.token, { ...text, link, kind, id })
      .then((r) => r === 'dead' && run('DELETE FROM push_devices WHERE id = ? AND token = ?', dev.id, dev.token))
      .catch((e) => console.error('[fcm]', e));
  }
}
