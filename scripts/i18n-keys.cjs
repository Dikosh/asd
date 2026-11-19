// Собирает все русские строки интерфейса: вызовы t('…') и значения словарей-справочников.
const fs = require('fs'), path = require('path');
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) && !/(kz|zh)\.ts$/.test(f) && files.push(p); } })('web/src');
const keys = new Set();
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(m[1].replace(/\\'/g, "'"));
  // словари вида NAME: Record<string, string> = { k: 'Текст', ... } и Record<string, [string, string]>
  for (const m of s.matchAll(/:\s*Record<string, (?:string|\[string, string\])>\s*=\s*\{([\s\S]*?)\n?\};/g))
    for (const v of m[1].matchAll(/'((?:[^'\\]|\\.)*[А-Яа-яЁё](?:[^'\\]|\\.)*)'/g)) keys.add(v[1]);
  // списки пар «вопрос — ответ»: const FAQ: [string, string][] = [ ['…', '…'], … ]
  for (const m of s.matchAll(/:\s*\[string, string\]\[\]\s*=\s*\[([\s\S]*?)\n\];/g))
    for (const v of m[1].matchAll(/'((?:[^'\\]|\\.)*[А-Яа-яЁё](?:[^'\\]|\\.)*)'/g)) keys.add(v[1]);
}
// сообщения об ошибках сервера тоже показываются пользователю
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.js$/.test(f) && !/seed/.test(f)) {
  const s = fs.readFileSync(p, 'utf8');
  for (const m of s.matchAll(/(?:bad|HttpError)\(\s*(?:\d+,\s*)?'[a-z_]+',\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(m[1]);
  for (const m of s.matchAll(/\.refine\([^\n]*?,\s*'([^'\n]*[А-Яа-яЁё][^'\n]*)'\)/g)) keys.add(m[1]);
  // текст выбирается условием: bad('code', условие ? 'один' : 'другой')
  for (const m of s.matchAll(/bad\(\s*'[a-z_]+',\s*[^'\n,]+\?\s*'([^'\n]*)'\s*:\s*'([^'\n]*)'/g)) keys.add(m[1]).add(m[2]);
  // свой текст ограничения частоты и ответы общего обработчика ошибок
  for (const m of s.matchAll(/rateLimit\([^\n]*,\s*'([^'\n]*[А-Яа-яЁё][^'\n]*)'\)/g)) keys.add(m[1]);
  for (const m of s.matchAll(/\bmessage:\s*'([^'\n]*[А-Яа-яЁё][^'\n]*)'/g)) keys.add(m[1]);
} } })('server');
// шаблоны уведомлений (server/i18n.js) приложение тоже показывает на языке интерфейса
for (const m of fs.readFileSync('server/i18n.js', 'utf8').matchAll(/^  '((?:[^'\\]|\\.)*)': \[/gm)) keys.add(m[1]);
module.exports = [...keys];
if (require.main === module) console.log(module.exports.join("\n"));
