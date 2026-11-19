// Файлы в чате и в рейсе: фото груза, ТТН, CMR, акты, счета. Хранятся рядом с документами компаний (UPLOAD_DIR)
// и попадают в ночную резервную копию. Отдаются только участникам чата или рейса.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { UPLOAD_DIR, insert, q1 } from './db.js';
import * as L from './lib.js';

export const FILE_KINDS = ['photo', 'ttn', 'cmr', 'act', 'invoice', 'waybill', 'other'];
const MIME = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const MAX_FILE = 5 * 1024 * 1024;
const DAY_QUOTA = 150 * 1024 * 1024; // сколько компания загружает за сутки: файлы не удаляются, и без предела ими можно занять весь диск

export const fileSchema = z.object({
  kind: z.enum(FILE_KINDS).default('other'),
  filename: z.string().trim().min(1).max(120),
  mime: z.string(),
  data: z.string(),
  note: z.string().trim().max(200).default(''),
});

/** Проверить и сохранить файл на диск. Возвращает id записи в таблице files. */
/** Раскодировать загруженный файл и проверить, что содержимое совпадает с заявленным типом. */
export function decodeUpload(b, { images = false, max = MAX_FILE } = {}) {
  const ext = Object.hasOwn(MIME, b.mime) && !(images && b.mime === 'application/pdf') ? MIME[b.mime] : null;
  if (!ext) throw L.bad('file_type', images ? 'Допустимы JPG, PNG или WEBP' : 'Допустимы PDF, JPG, PNG или WEBP');
  const buf = Buffer.from(b.data, 'base64');
  if (buf.length < 10) throw L.bad('file_empty', 'Файл пустой или повреждён — выберите другой');
  if (buf.length > max) throw L.bad('file_size', max === MAX_FILE ? 'Файл больше 5 МБ' : 'Картинка больше 1 МБ');
  // содержимое должно совпадать с заявленным типом: исполняемый файл под видом картинки не пройдёт
  const sig = buf.subarray(0, 12).toString('latin1');
  const okSig = { pdf: sig.startsWith('%PDF'), jpg: buf[0] === 0xff && buf[1] === 0xd8, png: sig.startsWith('\x89PNG'), webp: sig.startsWith('RIFF') && sig.slice(8, 12) === 'WEBP' }[ext];
  if (!okSig) throw L.bad('file_type', 'Файл повреждён или не совпадает с указанным типом');
  return { buf, ext };
}

export function saveFile(b, { scope, refId, userId, companyId, byDriverLink = false }) {
  const { buf, ext } = decodeUpload(b);
  if (q1('SELECT COUNT(*) AS n FROM files WHERE scope = ? AND ref_id = ?', scope, refId).n >= 100) throw L.bad('limit', 'Слишком много файлов в одном рейсе или чате');
  if (companyId && q1(`SELECT COALESCE(SUM(size), 0) AS n FROM files WHERE company_id = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')`, companyId).n + buf.length > DAY_QUOTA)
    throw L.bad('limit', 'За сутки загружено слишком много файлов — попробуйте завтра', 429);
  // имя показывается получателю и по нему телефон выбирает, чем открыть файл: расширение всегда соответствует содержимому
  b.filename = `${b.filename.replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ').replace(/\.[A-Za-z0-9]{1,6}$/, '').trim() || 'file'}.${ext}`;
  const name = `${scope}-${L.token(16)}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf, { mode: 0o600 });
  return insert(
    'INSERT INTO files(scope, ref_id, user_id, company_id, kind, filename, mime, path, size, note, by_driver_link) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    scope, refId, userId, companyId, b.kind, b.filename, b.mime, name, buf.length, b.note, byDriverLink ? 1 : 0,
  );
}

/** Отдать файл: картинки открываются в браузере, PDF скачивается, остальное не допускается при загрузке. */
export function sendFile(res, f) {
  const file = path.join(UPLOAD_DIR, path.basename(f.path));
  if (!fs.existsSync(file)) throw L.bad('not_found', 'Файл не найден', 404);
  res.setHeader('Content-Type', f.mime);
  // PDF скачивается, а не открывается на адресе площадки: «счёт на предоплату» от мошенника не должен выглядеть её страницей
  res.setHeader('Content-Disposition', `${f.mime === 'application/pdf' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

export const fileOut = (f) => ({
  id: f.id, kind: f.kind, filename: f.filename, mime: f.mime, size: f.size, note: f.note, createdAt: f.created_at,
  author: f.author || '', byDriverLink: !!f.by_driver_link, companyId: f.company_id,
});
