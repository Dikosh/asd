// Тексты ошибок: сообщение с числом внутри сервер отдаёт шаблоном, чтобы сайт и приложение показали его
// на языке человека; у каждого текста, который видит пользователь, есть казахский, английский и китайский перевод.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jolda-test-texts-'));
process.env.DEMO_MODE = '1';
delete process.env.OSRM_URL;
delete process.env.FCM_SERVICE_ACCOUNT;
const { createApp } = await import('../server/index.js');
const { seed } = await import('../server/seed.js');
const L = await import('../server/lib.js');

let server;
let base;
before(async () => {
  seed();
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return { call };
}
async function demo(role) {
  const c = client();
  const r = await c.call('POST', '/api/auth/demo', { role });
  assert.equal(r.status, 200);
  return c;
}
/** Словарь перевода сайта: ключ — русская строка. */
function dict(lang) {
  const text = fs.readFileSync(new URL(`../web/src/${lang}.ts`, import.meta.url), 'utf8');
  const start = text.indexOf('{', text.indexOf('Record<string, string>') + 22);
  return new Function(`return (${text.slice(start, text.lastIndexOf('}') + 1)});`)();
}
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

test('лимит тарифа: сервер отдаёт шаблон и числа, перевод подставляет те же числа', async () => {
  const carrier = await demo('carrier');
  let limited;
  for (let i = 0; i < L.PLAN.free.alerts + 1 && !limited; i++) {
    const r = await carrier.call('POST', '/api/searches', { kind: 'cargo', name: `Подписка ${i}`, params: { from: 'astana' }, notify: true });
    if (r.status !== 200) limited = r;
  }
  assert.ok(limited, 'подписок сверх тарифа быть не должно');
  assert.equal(limited.status, 402);
  assert.equal(limited.data.error, 'alert_limit');
  assert.deepEqual(limited.data.vars, { n: L.PLAN.free.alerts });
  assert.equal(limited.data.message, fill(limited.data.tpl, limited.data.vars), 'русский текст — тот же шаблон с числами');
  assert.match(limited.data.message, new RegExp(`подписок: ${L.PLAN.free.alerts}\\.`));
  for (const lang of ['kz', 'en', 'zh']) {
    const tr = dict(lang)[limited.data.tpl];
    assert.ok(tr, `${lang}: у шаблона есть перевод`);
    assert.ok(fill(tr, limited.data.vars).includes(String(L.PLAN.free.alerts)), `${lang}: число на месте`);
    if (lang !== 'kz') assert.ok(!/[А-Яа-яЁё]/.test(tr), `${lang}: перевод не остался русским`); // казахский — тоже кириллица
  }
});

test('общие ответы сервера — с текстом, для которого есть перевод', async () => {
  const c = client();
  const broken = await c.call('POST', '/api/auth/request-code', '{"phone":');
  assert.deepEqual([broken.status, broken.data.error], [400, 'bad_json']);
  const huge = await c.call('POST', '/api/auth/request-code', { phone: '7'.repeat(30 * 1024 * 1024) });
  assert.deepEqual([huge.status, huge.data.error], [413, 'too_large']);
  for (const lang of ['kz', 'en', 'zh']) for (const r of [broken, huge]) assert.ok(dict(lang)[r.data.message], `${lang}: «${r.data.message}»`);
});

test('в коде сервера нет сообщений об ошибках, собранных из кусков: их нельзя перевести', () => {
  const found = [];
  (function walk(dir) {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.js$/.test(f.name) && !/seed/.test(f.name))
        fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
          // второй аргумент bad()/tbad() — в обратных кавычках с подстановкой или склейка строк
          if (/\bt?bad\(\s*'[a-z_]+',\s*(`[^`]*\$\{|'[^']*'\s*\+)/.test(line)) found.push(`${path.relative('.', p)}:${i + 1}`);
        });
    }
  })(fileURLToDir('../server'));
  assert.deepEqual(found, [], 'используйте L.tbad(код, шаблон с {n}, { n })');
});

test('все тексты, которые видит пользователь, переведены на три языка', () => {
  const keys = createRequire(import.meta.url)('../scripts/i18n-keys.cjs');
  for (const must of ['Слишком много сообщений — подождите минуту', 'Допустимы JPG, PNG или WEBP', 'Картинка больше 1 МБ', 'Внутренняя ошибка сервера', 'Нужно принять правила платформы'])
    assert.ok(keys.includes(must), `проверка переводов видит строку «${must}»`);
  for (const lang of ['kz', 'en', 'zh']) {
    const d = dict(lang);
    assert.deepEqual(keys.filter((k) => !d[k]), [], `${lang}: без перевода`);
  }
});

function fileURLToDir(rel) {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), rel);
}
