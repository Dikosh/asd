// Справочник городов и геометрия маршрутов (расстояния, «по пути»).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const RAW = [
  // id, ru, kz, страна, широта, долгота
  ['astana', 'Астана', 'Астана', 'KZ', 51.17, 71.43],
  ['almaty', 'Алматы', 'Алматы', 'KZ', 43.24, 76.95],
  ['shymkent', 'Шымкент', 'Шымкент', 'KZ', 42.32, 69.6],
  ['karaganda', 'Караганда', 'Қарағанды', 'KZ', 49.8, 73.1],
  ['aktobe', 'Актобе', 'Ақтөбе', 'KZ', 50.28, 57.21],
  ['taraz', 'Тараз', 'Тараз', 'KZ', 42.9, 71.37],
  ['pavlodar', 'Павлодар', 'Павлодар', 'KZ', 52.29, 76.97],
  ['oskemen', 'Усть-Каменогорск', 'Өскемен', 'KZ', 49.95, 82.61],
  ['semey', 'Семей', 'Семей', 'KZ', 50.41, 80.23],
  ['atyrau', 'Атырау', 'Атырау', 'KZ', 47.11, 51.92],
  ['kostanay', 'Костанай', 'Қостанай', 'KZ', 53.21, 63.63],
  ['kyzylorda', 'Кызылорда', 'Қызылорда', 'KZ', 44.85, 65.51],
  ['oral', 'Уральск', 'Орал', 'KZ', 51.23, 51.37],
  ['petropavl', 'Петропавловск', 'Петропавл', 'KZ', 54.87, 69.14],
  ['aktau', 'Актау', 'Ақтау', 'KZ', 43.65, 51.16],
  ['temirtau', 'Темиртау', 'Теміртау', 'KZ', 50.05, 72.96],
  ['turkistan', 'Туркестан', 'Түркістан', 'KZ', 43.3, 68.25],
  ['kokshetau', 'Кокшетау', 'Көкшетау', 'KZ', 53.28, 69.39],
  ['taldykorgan', 'Талдыкорган', 'Талдықорған', 'KZ', 45.02, 78.37],
  ['ekibastuz', 'Экибастуз', 'Екібастұз', 'KZ', 51.72, 75.32],
  ['rudny', 'Рудный', 'Рудный', 'KZ', 52.96, 63.12],
  ['zhezkazgan', 'Жезказган', 'Жезқазған', 'KZ', 47.8, 67.71],
  ['balkhash', 'Балхаш', 'Балқаш', 'KZ', 46.84, 74.98],
  ['zhanaozen', 'Жанаозен', 'Жаңаөзен', 'KZ', 43.34, 52.86],
  ['kentau', 'Кентау', 'Кентау', 'KZ', 43.52, 68.51],
  ['satbayev', 'Сатпаев', 'Сәтбаев', 'KZ', 47.9, 67.54],
  ['konaev', 'Конаев', 'Қонаев', 'KZ', 43.88, 77.06],
  ['stepnogorsk', 'Степногорск', 'Степногорск', 'KZ', 52.35, 71.89],
  ['aksay', 'Аксай', 'Ақсай', 'KZ', 51.17, 53.0],
  ['kulsary', 'Кульсары', 'Құлсары', 'KZ', 46.95, 54.02],
  ['khorgos', 'Хоргос', 'Қорғас', 'KZ', 44.21, 80.41],
  ['zharkent', 'Жаркент', 'Жаркент', 'KZ', 44.17, 80.0],
  ['dostyk', 'Достык', 'Достық', 'KZ', 45.25, 82.48],
  ['saryagash', 'Сарыагаш', 'Сарыағаш', 'KZ', 41.46, 69.17],
  ['shu', 'Шу', 'Шу', 'KZ', 43.6, 73.76],
  ['ayagoz', 'Аягоз', 'Аягөз', 'KZ', 47.96, 80.43],
  ['shchuchinsk', 'Щучинск', 'Щучинск', 'KZ', 52.93, 70.2],
  ['ridder', 'Риддер', 'Риддер', 'KZ', 50.34, 83.51],
  ['arkalyk', 'Аркалык', 'Арқалық', 'KZ', 50.25, 66.91],
  ['baikonur', 'Байконур', 'Байқоңыр', 'KZ', 45.62, 63.31],
  ['aral', 'Аральск', 'Арал', 'KZ', 46.8, 61.67],
  ['shalkar', 'Шалкар', 'Шалқар', 'KZ', 47.83, 59.6],
  ['kandyagash', 'Кандыагаш', 'Қандыағаш', 'KZ', 49.47, 57.42],
  ['khromtau', 'Хромтау', 'Хромтау', 'KZ', 50.25, 58.44],
  ['lisakovsk', 'Лисаковск', 'Лисаков', 'KZ', 52.54, 62.5],
  ['kaskelen', 'Каскелен', 'Қаскелең', 'KZ', 43.2, 76.62],
  ['talgar', 'Талгар', 'Талғар', 'KZ', 43.3, 77.24],
  ['esik', 'Есик', 'Есік', 'KZ', 43.36, 77.45],
  ['saran', 'Сарань', 'Саран', 'KZ', 49.8, 72.83],
  ['shakhtinsk', 'Шахтинск', 'Шахтинск', 'KZ', 49.71, 72.59],
  ['zaysan', 'Зайсан', 'Зайсан', 'KZ', 47.47, 84.87],
  ['usharal', 'Ушарал', 'Үшарал', 'KZ', 46.17, 80.94],
  ['korday', 'Кордай', 'Қордай', 'KZ', 43.04, 74.71],
  ['merke', 'Мерке', 'Меркі', 'KZ', 42.87, 73.18],
  ['zhetisay', 'Жетысай', 'Жетісай', 'KZ', 40.78, 68.33],
  ['arys', 'Арысь', 'Арыс', 'KZ', 42.43, 68.8],
  ['beyneu', 'Бейнеу', 'Бейнеу', 'KZ', 45.32, 55.2],
  ['moscow', 'Москва', 'Мәскеу', 'RU', 55.75, 37.62],
  ['spb', 'Санкт-Петербург', 'Санкт-Петербург', 'RU', 59.94, 30.31],
  ['novosibirsk', 'Новосибирск', 'Новосібір', 'RU', 55.03, 82.92],
  ['omsk', 'Омск', 'Омбы', 'RU', 54.99, 73.37],
  ['ekaterinburg', 'Екатеринбург', 'Екатеринбург', 'RU', 56.84, 60.61],
  ['chelyabinsk', 'Челябинск', 'Челябі', 'RU', 55.16, 61.4],
  ['orenburg', 'Оренбург', 'Орынбор', 'RU', 51.77, 55.1],
  ['samara', 'Самара', 'Самара', 'RU', 53.2, 50.15],
  ['kazan', 'Казань', 'Қазан', 'RU', 55.79, 49.11],
  ['astrakhan', 'Астрахань', 'Астрахан', 'RU', 46.35, 48.04],
  ['barnaul', 'Барнаул', 'Барнаул', 'RU', 53.35, 83.78],
  ['tyumen', 'Тюмень', 'Түмен', 'RU', 57.15, 65.53],
  ['saratov', 'Саратов', 'Саратов', 'RU', 51.53, 46.03],
  ['ufa', 'Уфа', 'Уфа', 'RU', 54.74, 55.97],
  ['tashkent', 'Ташкент', 'Ташкент', 'UZ', 41.31, 69.28],
  ['samarkand', 'Самарканд', 'Самарқанд', 'UZ', 39.65, 66.96],
  ['bukhara', 'Бухара', 'Бұхара', 'UZ', 39.77, 64.42],
  ['nukus', 'Нукус', 'Нүкіс', 'UZ', 42.46, 59.6],
  ['bishkek', 'Бишкек', 'Бішкек', 'KG', 42.87, 74.59],
  ['osh', 'Ош', 'Ош', 'KG', 40.53, 72.8],
  ['urumqi', 'Урумчи', 'Үрімші', 'CN', 43.83, 87.62],
  ['kashgar', 'Кашгар', 'Қашқар', 'CN', 39.47, 75.99],
  ['dushanbe', 'Душанбе', 'Душанбе', 'TJ', 38.56, 68.79],
  ['ashgabat', 'Ашхабад', 'Ашхабад', 'TM', 37.95, 58.38],
  ['minsk', 'Минск', 'Минск', 'BY', 53.9, 27.56],
  ['baku', 'Баку', 'Баку', 'AZ', 40.41, 49.87],
  ['tbilisi', 'Тбилиси', 'Тбилиси', 'GE', 41.72, 44.79],
  ['istanbul', 'Стамбул', 'Стамбұл', 'TR', 41.01, 28.98],
];

// Полный справочник (города и посёлки Казахстана, крупные города соседних стран) собирается из GeoNames
// скриптом scripts/build-places.py в server/data/places.json. Список RAW выше — запасной вариант, если файла нет.
const placesFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data/places.json');
export const CITIES = fs.existsSync(placesFile)
  ? JSON.parse(fs.readFileSync(placesFile, 'utf8')).map(([id, ru, kz, en, country, lat, lon, region, pop]) => ({ id, ru, kz, en, country, lat, lon, region, pop }))
  : RAW.map(([id, ru, kz, country, lat, lon]) => ({ id, ru, kz, en: ru, country, lat, lon, region: '', pop: 0 }));
export const cityById = new Map(CITIES.map((c) => [c.id, c]));

const rad = (d) => (d * Math.PI) / 180;

/** Расстояние по прямой между двумя точками {lat, lon}, км. */
export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/** Оценка длины маршрута по дорогам: сумма прямых отрезков с дорожным коэффициентом. */
export const ROAD_FACTOR = 1.22;
export function roadKm(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += haversine(pts[i - 1], pts[i]);
  return Math.round(s * ROAD_FACTOR);
}

/** Ближайшая точка маршрута к p: расстояние (км) и позиция вдоль маршрута (номер отрезка + доля). */
export function nearestOnRoute(route, p) {
  let best = { d: Infinity, pos: 0 };
  if (route.length === 1) return { d: haversine(route[0], p), pos: 0 };
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const kx = 111.32 * Math.cos(rad((a.lat + b.lat) / 2));
    const ky = 110.57;
    const bx = (b.lon - a.lon) * kx;
    const by = (b.lat - a.lat) * ky;
    const px = (p.lon - a.lon) * kx;
    const py = (p.lat - a.lat) * ky;
    const len2 = bx * bx + by * by;
    const t = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
    const d = Math.hypot(px - bx * t, py - by * t);
    if (d < best.d) best = { d, pos: i - 1 + t };
  }
  return best;
}

/**
 * Лежат ли точки from → to «по пути» маршрута route (в правильном порядке, не дальше radius км).
 * Возвращает суммарный крюк в км либо null.
 */
export function routeFit(route, from, to, radius) {
  const a = from ? nearestOnRoute(route, from) : null;
  const b = to ? nearestOnRoute(route, to) : null;
  if (a && a.d > radius) return null;
  if (b && b.d > radius) return null;
  if (a && b && a.pos >= b.pos) return null;
  return Math.round((a?.d || 0) + (b?.d || 0));
}

/** Контрольный разряд ИИН/БИН Республики Казахстан. */
export function isValidBin(bin) {
  if (!/^\d{12}$/.test(bin || '')) return false;
  const d = [...bin].map(Number);
  const calc = (w) => d.slice(0, 11).reduce((s, x, i) => s + x * w[i], 0) % 11;
  let c = calc([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  if (c === 10) c = calc([3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2]);
  return c !== 10 && c === d[11];
}
