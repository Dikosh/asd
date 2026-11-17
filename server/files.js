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

export const fileSchema = z.object({
  kind: z.enum(FILE_KINDS).default('other'),
  filename: z.string().trim().min(1).max(120),
  mime: z.string(),
  data: z.string().min(10),
  note: z.string().trim().max(200).default(''),
});

/** Проверить и сохранить файл на диск. Возвращает id записи в таблице files. */
export function saveFile(b, { scope, refId, userId, companyId, byDriverLink = false }) {
  const ext = Object.hasOwn(MIME, b.mime) ? MIME[b.mime] : null;
  if (!ext) throw L.bad('file_type', 'Допустимы PDF, JPG, PNG или WEBP');
  const buf = Buffer.from(b.data, 'base64');
  if (buf.length > MAX_FILE) throw L.bad('file_size', 'Файл больше 5 МБ');
  // содержимое должно совпадать с заявленным типом: исполняемый файл под видом картинки не пройдёт
  const sig = buf.subarray(0, 12).toString('latin1');
  const okSig = { pdf: sig.startsWith('%PDF'), jpg: buf[0] === 0xff && buf[1] === 0xd8, png: sig.startsWith('\x89PNG'), webp: sig.startsWith('RIFF') && sig.slice(8, 12) === 'WEBP' }[ext];
  if (!okSig) throw L.bad('file_type', 'Файл повреждён или не совпадает с указанным типом');
  if (q1('SELECT COUNT(*) AS n FROM files WHERE scope = ? AND ref_id = ?', scope, refId).n >= 100) throw L.bad('limit', 'Слишком много файлов в одном рейсе или чате');
  const name = `${scope}-${L.token(16)}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return insert(
    'INSERT INTO files(scope, ref_id, user_id, company_id, kind, filename, mime, path, size, note, by_driver_link) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    scope, refId, userId, companyId, b.kind, b.filename, b.mime, name, buf.length, b.note, byDriverLink ? 1 : 0,
  );
}

/** Отдать файл: картинки и PDF открываются в браузере, остальное не допускается при загрузке. */
export function sendFile(res, f) {
  const file = path.join(UPLOAD_DIR, path.basename(f.path));
  if (!fs.existsSync(file)) throw L.bad('not_found', 'Файл не найден', 404);
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

export const fileOut = (f) => ({
  id: f.id, kind: f.kind, filename: f.filename, mime: f.mime, size: f.size, note: f.note, createdAt: f.created_at,
  author: f.author || '', byDriverLink: !!f.by_driver_link, companyId: f.company_id,
});
