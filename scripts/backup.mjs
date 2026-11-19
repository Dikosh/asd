// Резервная копия Timma. Запуск: node scripts/backup.mjs [папка для копий] [--update]
//
// Что лежит в папке копий (по умолчанию /var/backups/jolda):
//   jolda-ГГГГ-ММ-ДД-ЧЧ-ММ.tar.gz         ночная копия: снимок базы (без остановки сервиса) и ключи уведомлений сайта.
//                                         Хранятся последние KEEP_DAYS (14).
//   jolda-update-ГГГГ-ММ-ДД-ЧЧ-ММ.tar.gz  копия перед обновлением сервера (--update). Хранятся последние KEEP_UPDATES (5)
//                                         отдельно от ночных: серия обновлений ночные копии не вытесняет.
//   uploads/                              загруженные файлы (документы, фото, ТТН) — одна общая папка, в которую
//                                         докладываются только новые файлы. Раньше каждая копия содержала их все целиком.
//
// Перед работой проверяется свободное место: копия не делается, если после неё останется меньше MIN_FREE_MB (500).
// Если задан BACKUP_REMOTE (адрес для rsync, например backup@host:/backups/jolda), ночная копия уходит и туда —
// копии на том же диске, что и база, не спасут при поломке сервера.
// Итог каждого запуска записывается в <DATA_DIR>/backup-status.json: сервер читает его и предупреждает администратора,
// если копии перестали создаваться.
//
// Чего в копии нет нарочно: действующих входов пользователей, кодов входа и запомненных устройств — тот, кто прочитал
// копию, не должен входить под чужим именем; после восстановления все входят заново. Нет и ключа Firebase (fcm.json):
// он даёт рассылать уведомления от имени приложения, а скачать его заново в консоли Firebase — минута.
//
// На сервере ночной запуск делает таймер jolda-backup (ставит scripts/install-server.sh).
// Восстановление (после него все пользователи входят заново): остановить jolda; tar -xzf <копия> -C /var/lib/jolda; cp -an <папка копий>/uploads/. /var/lib/jolda/uploads/;
// chown -R jolda:jolda /var/lib/jolda; запустить jolda.
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const UPDATE = args.includes('--update');
const DATA = path.resolve(process.env.DATA_DIR || 'data');
const OUT = path.resolve(args.find((a) => !a.startsWith('--')) || process.env.BACKUP_DIR || '/var/backups/jolda');
const KEEP = Math.max(1, Number(process.env.KEEP_DAYS || 14));
const KEEP_UPDATES = Math.max(1, Number(process.env.KEEP_UPDATES || 5));
const MIN_FREE = Number(process.env.MIN_FREE_MB || 500) * 1024 * 1024;
const REMOTE = (process.env.BACKUP_REMOTE || '').trim();

const NIGHTLY = /^jolda-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.tar\.gz$/;
const BEFORE_UPDATE = /^jolda-update-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.tar\.gz$/;
const mb = (bytes) => Math.round(bytes / 1024 / 1024);
const list = (re) => fs.readdirSync(OUT).filter((f) => re.test(f)).sort();

/** Все файлы папки с размерами: относительный путь → размер. */
function walk(dir, base = dir, out = new Map()) {
  for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, out);
    else if (e.isFile()) out.set(path.relative(base, full), fs.statSync(full));
  }
  return out;
}

const status = { at: new Date().toISOString(), ok: false, kind: UPDATE ? 'update' : 'nightly', remote: REMOTE ? 'pending' : 'off' };
let tmp;
try {
  fs.mkdirSync(OUT, { recursive: true, mode: 0o700 });
  // следы прерванного запуска (сервер перезагрузили посреди копии)
  for (const f of fs.readdirSync(OUT)) if (/^\.tmp-|\.part$/.test(f)) fs.rmSync(path.join(OUT, f), { recursive: true, force: true });
  const dbFile = path.join(DATA, 'jolda.db');
  const mirror = path.join(OUT, 'uploads');
  const source = walk(path.join(DATA, 'uploads'));
  const saved = walk(mirror);
  const fresh = [...source].filter(([f, st]) => saved.get(f)?.size !== st.size);

  // место: снимок базы, архив с ним и новые загруженные файлы — и запас, чтобы копии не остановили сайт
  const need = fs.statSync(dbFile).size * 2 + fresh.reduce((n, [, st]) => n + st.size, 0);
  const disk = fs.statfsSync(OUT);
  const free = disk.bavail * disk.bsize;
  status.freeMb = mb(free);
  if (free - need < MIN_FREE) throw new Error(`недостаточно места на диске: свободно ${mb(free)} МБ, для копии нужно ${mb(need)} МБ и запас ${mb(MIN_FREE)} МБ`);

  // VACUUM INTO делает целостную копию работающей базы: запись в это время не мешает
  tmp = fs.mkdtempSync(path.join(OUT, '.tmp-'));
  const db = new DatabaseSync(dbFile, { readOnly: true });
  db.exec(`VACUUM INTO '${path.join(tmp, 'jolda.db').replace(/'/g, "''")}'`);
  db.close();
  // входы, коды и запомненные устройства в копию не идут; VACUUM стирает их следы из файла окончательно
  const snap = new DatabaseSync(path.join(tmp, 'jolda.db'));
  snap.exec('PRAGMA secure_delete = ON');
  const have = new Set(snap.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((r) => r.name));
  for (const table of ['sessions', 'login_codes', 'known_devices', 'push_subs', 'push_devices']) if (have.has(table)) snap.exec(`DELETE FROM ${table}`);
  snap.exec('VACUUM');
  snap.close();
  const check = new DatabaseSync(path.join(tmp, 'jolda.db'), { readOnly: true });
  const verdict = check.prepare('PRAGMA quick_check').get();
  check.close();
  if (Object.values(verdict)[0] !== 'ok') throw new Error(`снимок базы повреждён: ${Object.values(verdict)[0]}`);

  const stamp = status.at.slice(0, 16).replace(/[:T]/g, '-');
  const file = path.join(OUT, `jolda-${UPDATE ? 'update-' : ''}${stamp}.tar.gz`);
  const keys = ['vapid.json'].filter((f) => fs.lstatSync(path.join(DATA, f), { throwIfNoEntry: false })?.isFile());
  execFileSync('tar', ['-czf', `${file}.part`, '-C', tmp, 'jolda.db', ...keys.flatMap((f) => ['-C', DATA, f])]);
  fs.chmodSync(`${file}.part`, 0o600);
  fs.renameSync(`${file}.part`, file); // недописанный архив копией не считается

  // загруженные файлы: докладываем новые. Файл, удалённый с сайта, остаётся в копиях ещё KEEP дней
  for (const [f] of fresh) {
    const to = path.join(mirror, f);
    fs.mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 });
    fs.copyFileSync(path.join(DATA, 'uploads', f), `${to}.part`);
    fs.renameSync(`${to}.part`, to);
  }
  let pruned = 0;
  for (const [f, st] of saved) {
    if (source.has(f) || Date.now() - st.mtimeMs < KEEP * 86400_000) continue;
    fs.rmSync(path.join(mirror, f), { force: true });
    pruned++;
  }

  // старые копии удаляем: ночные и «перед обновлением» — каждые в своём запасе
  for (const [re, keep] of [[NIGHTLY, KEEP], [BEFORE_UPDATE, KEEP_UPDATES]]) {
    const all = list(re);
    for (const f of all.slice(0, Math.max(0, all.length - keep))) fs.rmSync(path.join(OUT, f));
  }
  Object.assign(status, {
    ok: true, file: path.basename(file), sizeKb: Math.round(fs.statSync(file).size / 1024),
    nightly: list(NIGHTLY).length, updates: list(BEFORE_UPDATE).length, uploads: source.size, uploadsCopied: fresh.length, uploadsPruned: pruned,
  });
  console.log(`Копия готова: ${file} (${status.sizeKb} КБ). Ночных копий: ${status.nightly}, перед обновлением: ${status.updates}; загруженных файлов: ${source.size}, новых: ${fresh.length}. Свободно ${status.freeMb} МБ`);

  // вторая площадка: без неё поломка сервера уносит и базу, и копии
  if (REMOTE && !UPDATE) {
    try {
      execFileSync('rsync', ['-a', '--timeout=120', '--exclude=.tmp-*', '--exclude=*.part', `${OUT}/`, `${REMOTE.replace(/\/+$/, '')}/`], { stdio: ['ignore', 'ignore', 'pipe'] });
      status.remote = 'ok';
      console.log(`Копия отправлена: ${REMOTE}`);
    } catch (e) {
      status.remote = 'failed';
      status.remoteError = String(e.stderr || e.message).trim().slice(0, 300);
      console.error(`Копию не удалось отправить на ${REMOTE}: ${status.remoteError}`);
    }
  } else if (!REMOTE && !UPDATE) console.log('Копии хранятся только на этом сервере. Чтобы отправлять их в другое место, задайте BACKUP_REMOTE в /etc/jolda.env');
} catch (e) {
  status.error = String(e.message || e).slice(0, 300);
  console.error(`Копия не создана: ${status.error}`);
  process.exitCode = 1;
} finally {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  // итог — для сервера. Неудачная копия перед обновлением ночную отметку не портит: её и так видно в выводе установщика
  try {
    const statusFile = path.join(DATA, 'backup-status.json');
    // копию делает администратор сервера, а папка данных принадлежит программе сайта: по ссылке, подложенной вместо
    // файла, ничего не читаем и не пишем
    const regular = fs.lstatSync(statusFile, { throwIfNoEntry: false })?.isFile();
    const prev = regular ? JSON.parse(fs.readFileSync(statusFile, 'utf8')) : {};
    const lastOk = status.ok ? status.at : prev.lastOk || null;
    // состояние отправки на вторую площадку меняет только ночная копия
    const remote = UPDATE ? { remote: prev.remote ?? status.remote, remoteError: prev.remoteError } : {};
    fs.rmSync(statusFile, { force: true });
    fs.writeFileSync(statusFile, JSON.stringify({ ...status, ...remote, lastOk }, null, 1), { flag: 'wx', mode: 0o640 }); // wx по ссылке не пишет
    const owner = fs.statSync(DATA);
    if (process.getuid?.() === 0) fs.chownSync(statusFile, owner.uid, owner.gid);
  } catch (e) {
    console.error(`Не удалось записать итог копии: ${e.message}`);
  }
}
