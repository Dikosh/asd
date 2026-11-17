// Резервная копия Jolda: снимок базы (без остановки сервиса) и папка с документами — в один архив.
// Запуск: node scripts/backup.mjs [папка для копий]. Хранятся последние KEEP_DAYS копий (по умолчанию 14).
// На сервере запускается каждую ночь таймером jolda-backup (ставит scripts/install-server.sh).
// Восстановление: остановить jolda, распаковать архив в DATA_DIR (tar -xzf … -C /var/lib/jolda), запустить jolda.
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA = path.resolve(process.env.DATA_DIR || 'data');
const OUT = path.resolve(process.argv[2] || process.env.BACKUP_DIR || '/var/backups/jolda');
const KEEP = Number(process.env.KEEP_DAYS || 14);

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jolda-backup-'));
try {
  // VACUUM INTO делает целостную копию работающей базы: запись в это время не мешает
  const db = new DatabaseSync(path.join(DATA, 'jolda.db'), { readOnly: true });
  db.exec(`VACUUM INTO '${path.join(tmp, 'jolda.db').replace(/'/g, "''")}'`);
  db.close();
  const extra = ['uploads', 'vapid.json'].filter((f) => fs.existsSync(path.join(DATA, f)));
  fs.mkdirSync(OUT, { recursive: true, mode: 0o700 });
  const file = path.join(OUT, `jolda-${stamp}.tar.gz`);
  execFileSync('tar', ['-czf', file, '-C', tmp, 'jolda.db', ...extra.flatMap((f) => ['-C', DATA, f])]);
  fs.chmodSync(file, 0o600);
  // старые копии удаляем, свежие KEEP штук оставляем
  const all = fs.readdirSync(OUT).filter((f) => /^jolda-.*\.tar\.gz$/.test(f)).sort();
  for (const f of all.slice(0, Math.max(0, all.length - KEEP))) fs.rmSync(path.join(OUT, f));
  console.log(`Копия готова: ${file} (${Math.round(fs.statSync(file).size / 1024)} КБ), всего копий: ${Math.min(all.length, KEEP)}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
