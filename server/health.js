// Здоровье сервера: резервные копии и место на диске. Сервер сам за этим следит и, если что-то не так,
// раз в сутки пишет администраторам — иначе о пропавших копиях или заполненном диске узнают, когда уже поздно.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, q, q1, run } from './db.js';
import { notify } from './notify.js';

const BACKUP_MAX_AGE = 36 * 3600_000; // ночная копия делается раз в сутки; полтора дня без неё — уже сбой
const GB = 1024 ** 3;

/** Что не так. status — содержимое backup-status.json (или null), free/total — место на диске в байтах. */
export function healthProblems({ status, free, total, now = Date.now() }) {
  const out = [];
  if (!status?.lastOk || now - Date.parse(status.lastOk) > BACKUP_MAX_AGE) {
    out.push({ code: 'backup', title: 'Резервные копии не создаются', body: 'Последняя удачная копия была больше полутора суток назад. Проверьте сервер.' });
  } else if (status.remote === 'failed') {
    out.push({ code: 'backup_remote', title: 'Копия не отправлена в запасное хранилище', body: 'Копии остаются только на самом сервере. Проверьте настройку BACKUP_REMOTE.' });
  }
  // меньше десятой части диска или меньше гигабайта
  if (free < Math.max(GB, total * 0.1)) {
    out.push({ code: 'disk', title: 'На сервере заканчивается место', body: 'Свободно {n} ГБ. Когда место закончится, сайт остановится.', vars: { n: (free / GB).toFixed(1) } });
  }
  return out;
}

const HOUR = 3600_000;
let failures = 0;
/**
 * Непредвиденная ошибка сервера: сразу сообщить администраторам, но не чаще раза в час. В сообщении — только сколько их
 * и где в коде, без текста ошибки: в нём могут оказаться данные людей. Подробности — в журнале сервера.
 */
export function reportFailure(e, now = Date.now()) {
  try {
    failures++;
    const key = 'health:error';
    const last = Number(q1('SELECT value FROM app_state WHERE key = ?', key)?.value || 0);
    if (now - last < HOUR) return false;
    run('INSERT INTO app_state(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(now));
    const where = /server\/([\w/]+\.js:\d+)/.exec(e?.stack || '')?.[1] || '?';
    for (const a of q('SELECT id FROM users WHERE is_admin = 1'))
      notify(a.id, { kind: 'system', title: 'Ошибка на сервере', body: 'Ошибок с прошлого сообщения: {n}, место в коде: {where}. Подробности — в журнале сервера.', vars: { n: failures, where }, link: '/cabinet/admin' });
    failures = 0;
    return true;
  } catch (err) {
    console.error('[health]', err); // база недоступна — об этом скажет внешнее наблюдение за сайтом
    return false;
  }
}

/** Проверка и уведомление администраторам; об одной и той же беде — не чаще раза в сутки. */
export function checkHealth(now = Date.now()) {
  let status = null;
  try {
    status = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'backup-status.json'), 'utf8'));
  } catch { /* файла нет или он недописан — копий, считаем, нет */ }
  const disk = fs.statfsSync(DATA_DIR);
  const problems = healthProblems({ status, free: disk.bavail * disk.bsize, total: disk.blocks * disk.bsize, now });
  for (const p of problems) {
    const key = `health:${p.code}`;
    const last = Number(q1('SELECT value FROM app_state WHERE key = ?', key)?.value || 0);
    if (now - last < 86400_000) continue;
    run('INSERT INTO app_state(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(now));
    console.error(`[health] ${p.title}`);
    for (const a of q('SELECT id FROM users WHERE is_admin = 1')) notify(a.id, { kind: 'system', title: p.title, body: p.body, vars: p.vars || {}, link: '/cabinet/admin' });
  }
  return problems;
}
