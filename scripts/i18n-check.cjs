// Проверяет, что у каждой строки интерфейса есть казахский перевод: npm run i18n
const fs = require('fs');
const keys = require('./i18n-keys.cjs');
const src = fs.readFileSync('web/src/kz.ts', 'utf8').replace(/export const KZ: Record<string, string> =/, 'module.exports =');
const m = { exports: {} };
new Function('module', src)(m);
const KZ = m.exports;
const missing = keys.filter((k) => !KZ[k]);
const extra = Object.keys(KZ).filter((k) => !keys.includes(k));
const broken = keys.filter((k) => KZ[k] && (k.match(/\{\w+\}/g) || []).some((p) => !KZ[k].includes(p)));
if (missing.length) console.log(`Нет перевода (${missing.length}):\n  ` + missing.join('\n  '));
if (extra.length) console.log(`Лишние ключи (${extra.length}):\n  ` + extra.join('\n  '));
if (broken.length) console.log(`Потеряны подстановки (${broken.length}):\n  ` + broken.join('\n  '));
console.log(`Строк: ${keys.length}, переведено: ${keys.length - missing.length}`);
process.exit(missing.length || broken.length ? 1 : 0);
