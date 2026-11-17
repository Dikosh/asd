// Проверяет, что у каждой строки интерфейса есть казахский и английский перевод: npm run i18n
const fs = require('fs');
const keys = require('./i18n-keys.cjs');

function check(file, name, title) {
  const src = fs.readFileSync(file, 'utf8').replace(new RegExp(`export const ${name}: Record<string, string> =`), 'module.exports =');
  const m = { exports: {} };
  new Function('module', src)(m);
  const dict = m.exports;
  const missing = keys.filter((k) => !dict[k]);
  const extra = Object.keys(dict).filter((k) => !keys.includes(k));
  const broken = keys.filter((k) => dict[k] && (k.match(/\{\w+\}/g) || []).some((p) => !dict[k].includes(p)));
  if (missing.length) console.log(`${title}: нет перевода (${missing.length}):\n  ` + missing.slice(0, 40).join('\n  '));
  if (extra.length) console.log(`${title}: лишние ключи (${extra.length}):\n  ` + extra.slice(0, 40).join('\n  '));
  if (broken.length) console.log(`${title}: потеряны подстановки (${broken.length}):\n  ` + broken.join('\n  '));
  console.log(`${title}: строк ${keys.length}, переведено: ${keys.length - missing.length}`);
  return missing.length || broken.length;
}

// казахский проверяется последним, чтобы итоговая строка относилась к нему
const en = check('web/src/en.ts', 'EN', 'Английский');
const kz = check('web/src/kz.ts', 'KZ', 'Казахский');
process.exit(en || kz ? 1 : 0);
