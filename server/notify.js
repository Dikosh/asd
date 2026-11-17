// Уведомления: запись в базу, мгновенная доставка в открытое приложение (SSE) и push на телефон (Web Push).
import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import { DATA_DIR, q, q1, run, insert } from './db.js';
import { j, push } from './lib.js';
import { render } from './i18n.js';

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

/**
 * Уведомить пользователей. title и body — русские шаблоны из server/i18n.js (или текст человека), vars — подстановки;
 * kind — тип для значка, link — куда перейти по нажатию.
 */
export function notify(userIds, { kind, title, body = '', link = '', vars = {} }) {
  for (const userId of new Set([userIds].flat())) {
    const id = insert('INSERT INTO notifications(user_id, kind, title, body, link, vars) VALUES(?, ?, ?, ?, ?, ?)', userId, kind, title, body, link, JSON.stringify(vars));
    push(userId, 'notify', { id, kind, title, body, link, vars });
    const lang = j(q1('SELECT settings FROM users WHERE id = ?', userId)?.settings, {}).lang;
    for (const sub of q('SELECT id, endpoint, keys FROM push_subs WHERE user_id = ?', userId)) {
      webpush
        .sendNotification({ endpoint: sub.endpoint, keys: JSON.parse(sub.keys) }, JSON.stringify({ title: render(title, vars, lang), body: render(body, vars, lang), link }), { TTL: 3600 })
        .catch((e) => {
          // подписка отозвана на устройстве — удаляем её
          if (e.statusCode === 404 || e.statusCode === 410) run('DELETE FROM push_subs WHERE id = ?', sub.id);
        });
    }
  }
}
