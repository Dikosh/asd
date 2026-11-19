// Демо-данные: компании, объявления, рейсы, отзывы — чтобы платформа выглядела живой сразу после запуска.
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { db, q, q1, run, insert, tx, UPLOAD_DIR } from './db.js';
import { cityById, roadKm, isValidBin } from './geo.js';
import { token } from './lib.js';

// детерминированный генератор, чтобы демо-данные были одинаковыми при каждом запуске
let s = 20261117;
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const day = (n) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
const ago = (h) => new Date(Date.now() - h * 3600_000).toISOString();

function makeBin(i) {
  for (let k = 0; k < 10; k++) {
    const base = `9${String(i).padStart(2, '0')}140${String(k)}${String(1000 + i * 37).slice(0, 4)}`;
    for (let c = 0; c < 10; c++) if (isValidBin(base + c)) return base + c;
  }
  return null;
}

const COMPANIES = [
  // name, form, kind, city, контакт, телефон, проверена
  ['Jolda Модерация', 'ТОО', 'logist', 'astana', 'Администратор', '+77000000000', 'verified'],
  ['Астана Трейд', 'ТОО', 'customer', 'astana', 'Айгерим Сапарова', '+77010000001', 'verified'],
  ['Жумабаев Транс', 'ИП', 'carrier', 'karaganda', 'Ерлан Жумабаев', '+77010000002', 'verified'],
  ['Silk Way Logistics', 'ТОО', 'logist', 'almaty', 'Данияр Ахметов', '+77010000003', 'verified'],
  ['КеденСервис', 'ТОО', 'broker', 'khorgos', 'Мадина Оспанова', '+77010000004', 'verified'],
  ['Тулегенов Б.', 'ИП', 'driver', 'shymkent', 'Бауыржан Тулегенов', '+77010000005', 'none'],
  ['Алатау Агро', 'ТОО', 'customer', 'almaty', 'Асель Нурланова', '+77015550101', 'verified'],
  ['СтройМаркет KZ', 'ТОО', 'customer', 'shymkent', 'Руслан Ибраев', '+77015550102', 'verified'],
  ['Каспий Металл', 'ТОО', 'customer', 'aktau', 'Тимур Касымов', '+77015550103', 'none'],
  ['Сарыарка Карго', 'ТОО', 'carrier', 'astana', 'Нурлан Байжанов', '+77015550104', 'verified'],
  ['Оңтүстік Транс', 'ИП', 'carrier', 'shymkent', 'Серик Абдрахманов', '+77015550105', 'verified'],
  ['Батыс Логистик', 'ТОО', 'carrier', 'aktobe', 'Азамат Утегенов', '+77015550106', 'none'],
  ['Ертіс Авто', 'ИП', 'carrier', 'pavlodar', 'Канат Смагулов', '+77015550107', 'verified'],
  ['Быстрый Груз 24', 'ТОО', 'carrier', 'almaty', 'Менеджер', '+77015550108', 'none'],
  ['Евразия Брокер', 'ТОО', 'broker', 'almaty', 'Жанна Ким', '+77015550109', 'verified'],
  ['Номад Экспедиция', 'ТОО', 'logist', 'astana', 'Арман Сейтказин', '+77015550110', 'none'],
];

const ROUTES = [
  ['astana', 'karaganda', 'almaty'], ['almaty', 'astana'], ['almaty', 'shymkent'], ['shymkent', 'almaty'], ['astana', 'kostanay'],
  ['astana', 'pavlodar'], ['karaganda', 'astana'], ['almaty', 'taraz', 'shymkent'], ['shymkent', 'kyzylorda', 'aktobe'], ['aktobe', 'atyrau'],
  ['atyrau', 'aktau'], ['almaty', 'taldykorgan', 'oskemen'], ['semey', 'pavlodar', 'astana'], ['khorgos', 'almaty'], ['almaty', 'khorgos'],
  ['astana', 'petropavl'], ['kokshetau', 'astana', 'karaganda'], ['almaty', 'bishkek'], ['shymkent', 'tashkent'], ['astana', 'omsk'],
  ['kostanay', 'chelyabinsk'], ['oral', 'samara'], ['almaty', 'balkhash', 'karaganda', 'astana'], ['karaganda', 'zhezkazgan'], ['aktobe', 'orenburg'],
  ['almaty', 'novosibirsk'], ['astana', 'ekaterinburg'], ['taraz', 'almaty'], ['turkistan', 'shymkent', 'almaty'], ['urumqi', 'khorgos', 'almaty'],
  ['astana', 'almaty'], ['pavlodar', 'ekibastuz', 'karaganda'], ['oskemen', 'semey', 'astana'], ['almaty', 'moscow'], ['shymkent', 'astana'],
];
const CARGO_DESC = {
  food: ['Продукты на паллетах, 33 места', 'Соки и вода, паллеты', 'Мука в мешках'], building: ['Гипсокартон, пачки', 'Цемент в мешках, биг-бэги', 'Кирпич на поддонах'],
  equipment: ['Станки в ящиках', 'Холодильное оборудование'], consumer: ['Бытовая техника, коробки', 'Текстиль, тюки'], agro: ['Пшеница насыпью', 'Лук в сетках'],
  metal: ['Арматура 12 м', 'Листовой прокат'], groupage: ['Сборный груз, 6 паллет', 'Коробки, догруз'], furniture: ['Офисная мебель в упаковке'], other: ['Тара, пустые паллеты'],
};
const BODY_FOR = { food: ['ref', 'isotherm', 'tent'], building: ['tent', 'board'], equipment: ['tent', 'trawl'], consumer: ['tent', 'van'], agro: ['grain', 'tent'], metal: ['board', 'tent'], groupage: ['tent', 'van'], furniture: ['tent', 'van'], other: ['tent'] };
const TRUCKS = [['DAF XF 105', 'tent', 20, 86], ['Volvo FH', 'ref', 20, 82], ['MAN TGX', 'tent', 22, 92], ['Scania R450', 'ref', 20, 86], ['КамАЗ 5490', 'tent', 20, 82],
  ['Mercedes Actros', 'isotherm', 20, 86], ['Shacman X3000', 'tipper', 25, 20], ['ГАЗель Next', 'van', 1.5, 16], ['Hyundai HD78', 'van', 5, 22], ['Howo T5G', 'board', 20, 60], ['Sitrak C7H', 'container', 26, 76]];

const DEMO_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 420 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 58>>stream
BT /F1 18 Tf 40 110 Td (Jolda demo document) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF
`;

export function seed() {
  tx(() => {
    const comp = {};
    const user = {};
    COMPANIES.forEach(([name, form, kind, city, person, phone, verified], i) => {
      const cid = insert('INSERT INTO companies(name, form, kind, bin, city_id, verified, balance, about) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
        name, form, kind, makeBin(i + 1), city, verified, i >= 1 && i <= 5 ? 5000 : 0,
        kind === 'broker' ? 'Таможенное оформление, декларирование, сертификация, СВХ.' : kind === 'carrier' ? 'Собственный парк, работаем по Казахстану и СНГ.' : '');
      comp[name] = cid;
      user[name] = insert('INSERT INTO users(name, phone, email, role, company_id, is_admin, is_demo, accepted_terms) VALUES(?, ?, ?, ?, ?, ?, 1, ?)',
        person, phone, `demo${i}@jolda.local`, kind, cid, i === 0 ? 1 : 0, ago(500));
    });
    // ---- документы проверенных компаний: отметка «Проверена» в демо подкреплена принятыми документами ----
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    COMPANIES.forEach(([name, , kind, , , , verified]) => {
      if (verified !== 'verified' || name === 'Jolda Модерация') return;
      for (const [docKind, title] of [['registration', 'Свидетельство о регистрации.pdf'], ...(kind === 'broker' ? [['customs_license', 'Свидетельство таможенного представителя.pdf']] : [])]) {
        const file = `demo-${comp[name]}-${docKind}.pdf`;
        fs.writeFileSync(path.join(UPLOAD_DIR, file), DEMO_PDF);
        insert(`INSERT INTO documents(company_id, user_id, kind, filename, mime, path, status, created_at) VALUES(?, ?, ?, ?, 'application/pdf', ?, 'approved', ?)`,
          comp[name], user[name], docKind, title, file, ago(400));
      }
    });
    const carriers = COMPANIES.filter((c) => c[2] === 'carrier').map((c) => c[0]);
    const customers = COMPANIES.filter((c) => c[2] === 'customer' || (c[2] === 'logist' && c[0] !== 'Jolda Модерация')).map((c) => c[0]);

    // ---- парк машин и сотрудники ----
    carriers.forEach((name, i) => {
      for (let k = 0; k < 2; k++) {
        const [brand, body, w, v] = TRUCKS[(i * 2 + k) % TRUCKS.length];
        run('INSERT INTO vehicles(company_id, brand, plate, body_type, weight, volume, loading) VALUES(?, ?, ?, ?, ?, ?, ?)',
          comp[name], brand, `${int(100, 999)} ${pick(['ABA', 'KZT', 'AEO', 'BNR'])} ${pick(['01', '02', '09', '13', '17'])}`, body, w, v, JSON.stringify(['rear', 'side']));
      }
    });
    run(`INSERT INTO employees(company_id, name, phone, position, license_cats, experience, esutd, esutd_number) VALUES
      (?, 'Марат Кенжебеков', '+77015550201', 'Водитель', 'C, CE', 12, 'registered', 'ТД-2024-00417'),
      (?, 'Олжас Берик', '+77015550202', 'Водитель', 'C, CE', 5, 'unknown', '')`, comp['Жумабаев Транс'], comp['Жумабаев Транс']);
    // водитель из команды перевозчика: входит в приложение и видит только свои рейсы (демо-вход «Водитель»)
    const teamDriver = insert(`INSERT INTO users(name, phone, email, role, company_id, company_role, is_demo, accepted_terms) VALUES(?, ?, '', 'driver', ?, 'driver', 1, ?)`,
      'Марат Кенжебеков', '+77015550201', comp['Жумабаев Транс'], ago(300));

    // ---- объявления ----
    const addListing = (kind, owner, points, o = {}) => {
      const km = roadKm(points.map((p) => cityById.get(p)));
      const withRate = o.rate !== undefined ? o.rate !== null : rnd() > 0.25;
      const perKm = kind === 'cargo' ? int(260, 430) : int(230, 360);
      const rate = o.rate !== undefined ? o.rate : withRate ? Math.max(20000, Math.round((km * perKm) / 5000) * 5000) : null;
      const from = o.from ?? int(0, 4);
      return insert(
        `INSERT INTO listings(kind, user_id, company_id, status, points, from_id, to_id, brand, body_type, cargo_type, weight, volume, loading,
           date_from, date_to, pay_terms, rate, currency, description, distance_km, created_at, closed_at, flags)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'KZT', ?, ?, ?, ?, ?)`,
        kind, user[owner], comp[owner], o.status || 'active', JSON.stringify(points), points[0], points[points.length - 1], o.brand || '',
        o.body ?? null, o.cargo ?? null, o.weight ?? null, o.volume ?? null, JSON.stringify(o.loading || ['rear']),
        o.dateFrom || day(from), o.dateTo || day(from + int(4, 14)),
        JSON.stringify(rate ? pick([['cashless_vat'], ['cashless_novat', 'prepay'], ['cash'], ['cashless_vat', 'prepay']]) : []),
        rate, o.description || '', km, o.createdAt || ago(int(1, 70)), o.status && o.status !== 'active' ? ago(int(80, 400)) : null,
        JSON.stringify(o.flags || []),
      );
    };
    const cargoKinds = Object.keys(CARGO_DESC);
    ROUTES.forEach((route, i) => {
      const cargo = cargoKinds[i % cargoKinds.length];
      addListing('cargo', customers[i % customers.length], route, {
        cargo, body: pick(BODY_FOR[cargo]), weight: pick([1.5, 3, 5, 10, 15, 18, 20, 20, 22]), volume: pick([12, 20, 36, 60, 82, 86]),
        loading: pick([['rear'], ['rear', 'side'], ['top', 'side'], ['full']]), description: pick(CARGO_DESC[cargo]),
      });
    });
    ROUTES.slice(0, 26).forEach((route, i) => {
      const [brand, body, w, v] = TRUCKS[i % TRUCKS.length];
      addListing('truck', carriers[i % carriers.length], i % 3 === 0 ? [...route].reverse() : route, {
        brand, body, weight: w, volume: v, loading: pick([['rear', 'side'], ['rear'], ['rear', 'side', 'top', 'full']]),
        description: pick(['Готов к загрузке, документы в порядке.', 'Возьму догруз по пути.', 'Опытный водитель, CMR.', '']),
      });
    });

    // ---- история: завершённые рейсы и отзывы ----
    const GOOD = ['Всё чётко, груз доставлен вовремя.', 'Рекомендую, водитель на связи весь рейс.', 'Оплата день в день, спасибо.', 'Работаем не первый раз, без нареканий.'];
    const FINE = ['Хорошо, но была задержка на погрузке.', 'В целом нормально, документы пришлось ждать.'];
    const BAD = ['Сорвали сроки на три дня, на звонки не отвечали.', 'Взяли предоплату и пропали на неделю.', 'Машина пришла не того типа, груз подмочен.'];
    const history = (customer, carrier, route, ratingToCarrier, ratingToCustomer, hoursAgo) => {
      const lid = addListing('cargo', customer, route, { status: 'closed', cargo: pick(cargoKinds), body: 'tent', weight: 20, volume: 82, createdAt: ago(hoursAgo + 200), dateFrom: day(-20), dateTo: day(-10) });
      const price = q1('SELECT rate FROM listings WHERE id = ?', lid).rate;
      const tid = insert(
        `INSERT INTO trips(listing_id, customer_user, customer_company, carrier_user, carrier_company, price, status, stage, track_token, driver_token, created_at, finished_at)
         VALUES(?, ?, ?, ?, ?, ?, 'completed', 'delivered', ?, ?, ?, ?)`,
        lid, user[customer], comp[customer], user[carrier], comp[carrier], price, token(12), token(18), ago(hoursAgo + 96), ago(hoursAgo),
      );
      const rev = (author, target, rating) =>
        run('INSERT INTO reviews(trip_id, author_user, author_company, target_company, rating, text, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)',
          tid, user[author], comp[author], comp[target], rating, rating === 5 ? pick(GOOD) : rating === 4 ? pick(FINE) : pick(BAD), ago(hoursAgo - 1));
      rev(customer, carrier, ratingToCarrier);
      rev(carrier, customer, ratingToCustomer);
    };
    let h = 30;
    carriers.filter((c) => c !== 'Быстрый Груз 24').forEach((carrier, ci) => {
      for (let k = 0; k < int(3, 4); k++) history(customers[(ci + k) % customers.length], carrier, pick(ROUTES), pick([5, 5, 5, 4, 4]), pick([5, 5, 4]), (h += int(20, 90)));
    });
    history('Алатау Агро', 'Быстрый Груз 24', ['almaty', 'astana'], 1, 4, 300);
    history('СтройМаркет KZ', 'Быстрый Груз 24', ['shymkent', 'almaty'], 2, 5, 520);
    history('Каспий Металл', 'Быстрый Груз 24', ['aktau', 'atyrau'], 1, 4, 760);
    run(`INSERT INTO blacklist(company_id, author_user, author_company, reason, review) VALUES
      (?, ?, ?, 'Срыв сроков и отказ от связи', 'Груз шёл на трое суток дольше, диспетчер не отвечал. Работать не советуем.'),
      (?, ?, ?, 'Невозврат предоплаты', 'Взяли предоплату 30%, машину на погрузку не подали.')`,
      comp['Быстрый Груз 24'], user['Алатау Агро'], comp['Алатау Агро'], comp['Быстрый Груз 24'], user['Каспий Металл'], comp['Каспий Металл']);

    // ---- сценарий для демо-аккаунтов: активный рейс, отклики, чат ----
    const chat = (listing, owner, peer, msgs) => {
      const cid = insert('INSERT INTO chats(listing_id, owner_id, peer_id, owner_company, peer_company) VALUES(?, ?, ?, ?, ?)', listing, user[owner], user[peer], comp[owner], comp[peer]);
      msgs.forEach(([who, text], i) => run('INSERT INTO messages(chat_id, sender_id, text, is_read, created_at) VALUES(?, ?, ?, ?, ?)',
        cid, user[who], text, i < msgs.length - 1 ? 1 : 0, ago((msgs.length - i) * 0.4)));
    };
    const A = 'Астана Трейд';
    const B = 'Жумабаев Транс';
    const live = addListing('cargo', A, ['astana', 'karaganda', 'almaty'], { cargo: 'food', body: 'ref', weight: 18, volume: 82, rate: 520000, dateFrom: day(-1), dateTo: day(3), from: 0, description: 'Молочная продукция, температурный режим +2…+6 °C. Выгрузка в Караганде 4 паллеты.', createdAt: ago(40) });
    const r1 = insert(`INSERT INTO responses(listing_id, user_id, company_id, message, price, status, created_at) VALUES(?, ?, ?, 'Реф свободен, могу встать на загрузку завтра утром.', 500000, 'accepted', ?)`, live, user[B], comp[B], ago(30));
    chat(live, A, B, [[B, 'Реф свободен, могу встать на загрузку завтра утром.\n— 500 000 ₸'], [A, 'Добрый день! Подходит. Режим +2…+6, термописец есть?'], [B, 'Да, есть, распечатку дам на выгрузке.'], [A, 'Отлично, принимаю отклик.'], [B, 'Загрузился, выехал из Астаны.']]);
    run(`UPDATE listings SET load_address = 'Астана, ул. Жетиген 37, склад №4', unload_address = 'Алматы, ул. Рыскулова 103, ворота 2', load_time = '8:00–11:00' WHERE id = ?`, live);
    const trip = insert(
      `INSERT INTO trips(listing_id, response_id, customer_user, customer_company, carrier_user, carrier_company, price, stage, share_gps, track_token, driver_token, created_at,
         vehicle_brand, plate, trailer_plate, driver_user, driver_name, driver_phone, confirmed_at)
       VALUES(?, ?, ?, ?, ?, ?, 500000, 'in_transit', 1, 'demo-track-jolda', 'demo-drive-jolda', ?, 'Volvo FH', '725 ABA 09', '31 AFB 09', ?, 'Марат Кенжебеков', '+77015550201', ?)`,
      live, r1, user[A], comp[A], user[B], comp[B], ago(28), teamDriver, ago(27),
    );
    run('UPDATE trips SET terms = ? WHERE id = ?', JSON.stringify(q1('SELECT points, cargo_type, body_type, weight, volume, distance_km, date_from, date_to, description, loading, pay_terms, brand, load_address, unload_address, load_time FROM listings WHERE id = ?', live)), trip);
    [['planned', 28], ['to_loading', 20], ['loading', 16], ['in_transit', 13]].forEach(([st, hh]) => run('INSERT INTO trip_events(trip_id, stage, at) VALUES(?, ?, ?)', trip, st, ago(hh)));
    // трек: Астана → Караганда → в сторону Балхаша
    const way = [[51.17, 71.43], [50.75, 72.0], [50.3, 72.6], [49.8, 73.1], [49.2, 73.5], [48.6, 73.9], [48.0, 74.3], [47.5, 74.7]];
    let n = 0;
    for (let i = 1; i < way.length; i++) {
      for (let k = 0; k < 6; k++) {
        const f = k / 6;
        run('INSERT INTO positions(trip_id, lat, lon, speed, at) VALUES(?, ?, ?, ?, ?)', trip,
          way[i - 1][0] + (way[i][0] - way[i - 1][0]) * f + (rnd() - 0.5) * 0.02, way[i - 1][1] + (way[i][1] - way[i - 1][1]) * f + (rnd() - 0.5) * 0.02, int(62, 88), ago((41 - n++) * 0.3 + 0.03));
      }
    }

    const open1 = addListing('cargo', A, ['astana', 'kostanay'], { cargo: 'consumer', body: 'tent', weight: 12, volume: 60, rate: 290000, from: 1, description: 'Бытовая техника в коробках, 22 паллеты. Нужны ремни.', createdAt: ago(5) });
    run(`INSERT INTO responses(listing_id, user_id, company_id, message, price, created_at) VALUES(?, ?, ?, 'Тент 20 т в Астане, готов забрать послезавтра.', 280000, ?)`, open1, user['Сарыарка Карго'], comp['Сарыарка Карго'], ago(3));
    chat(open1, A, 'Сарыарка Карго', [['Сарыарка Карго', 'Тент 20 т в Астане, готов забрать послезавтра.\n— 280 000 ₸']]);
    run(`INSERT INTO responses(listing_id, user_id, company_id, message, price, created_at) VALUES(?, ?, ?, 'Заберём сегодня, предоплата 50%.', 250000, ?)`, open1, user['Быстрый Груз 24'], comp['Быстрый Груз 24'], ago(2));
    chat(open1, A, 'Быстрый Груз 24', [['Быстрый Груз 24', 'Заберём сегодня, предоплата 50%.\n— 250 000 ₸']]);

    const truck1 = addListing('truck', B, ['almaty', 'balkhash', 'karaganda', 'astana'], { brand: 'Volvo FH', body: 'ref', weight: 20, volume: 82, rate: 480000, from: 3, loading: ['rear', 'side'], description: 'Обратный рейс после выгрузки в Алматы, возьму догруз.', createdAt: ago(8) });
    run(`INSERT INTO responses(listing_id, user_id, company_id, message, price, created_at) VALUES(?, ?, ?, 'Есть 12 т фруктов из Алматы в Караганду, реф обязателен.', 300000, ?)`, truck1, user['Алатау Агро'], comp['Алатау Агро'], ago(1));
    chat(truck1, B, 'Алатау Агро', [['Алатау Агро', 'Есть 12 т фруктов из Алматы в Караганду, реф обязателен.\n— 300 000 ₸']]);
    addListing('cargo', 'Silk Way Logistics', ['urumqi', 'khorgos', 'almaty'], { cargo: 'consumer', body: 'container', weight: 22, volume: 76, rate: 1450000, from: 2, description: 'Контейнер 40HC, электроника. Нужен брокер на Хоргосе.', createdAt: ago(4), flags: ['cmr', 'customs'] });
    addListing('truck', 'Silk Way Logistics', ['almaty', 'astana'], { brand: 'MAN TGX', body: 'tent', weight: 22, volume: 92, rate: 400000, from: 1, createdAt: ago(6) });
    // груз на несколько машин: каждая машина — отдельный рейс
    const grain = addListing('cargo', 'Алатау Агро', ['kostanay', 'astana'], { cargo: 'agro', body: 'grain', weight: 22, volume: 60, rate: 330000, from: 1, description: 'Пшеница 3 класса насыпью, 66 т — нужно три зерновоза. Погрузка с элеватора.', createdAt: ago(7) });
    run(`UPDATE listings SET trucks = 3, load_address = 'Костанай, элеватор «Береке», ул. Промышленная 12', unload_address = 'Астана, мелькомбинат, ул. Сарыарка 5', load_time = '7:00–15:00' WHERE id = ?`, grain);
    // история рейсов: машина и водитель указаны, рейсы считаются подтверждёнными
    for (const t of q('SELECT id, carrier_company FROM trips WHERE confirmed_at IS NULL')) {
      const v = q1('SELECT brand, plate FROM vehicles WHERE company_id = ? ORDER BY random() LIMIT 1', t.carrier_company) || { brand: 'DAF XF 105', plate: '512 KZT 02' };
      run(`UPDATE trips SET vehicle_brand = ?, plate = ?, driver_name = ?, driver_phone = ?, confirmed_at = created_at WHERE id = ?`,
        v.brand, v.plate, pick(['Ерболат Нуртаев', 'Алексей Ким', 'Даурен Сейткали', 'Нурсултан Жаксыбеков']), `+7701${int(1000000, 9999999)}`, t.id);
    }
    run(`INSERT INTO searches(user_id, kind, name, params, notify) VALUES(?, 'cargo', 'Алматы → Астана, реф', ?, 1)`, user[B], JSON.stringify({ from: 'almaty', to: 'astana', body: 'ref', radius: '100' }));
    run('INSERT INTO partners(company_id, partner_id) VALUES(?, ?), (?, ?)', comp[A], comp[B], comp[B], comp[A]);
    run(`INSERT INTO notifications(user_id, kind, title, body, link, vars, created_at) VALUES
      (?, 'response', 'Новый отклик: {route}', 'Есть 12 т фруктов из Алматы в Караганду, реф обязателен.', ?, ?, ?),
      (?, 'response', 'Новый отклик: {route}', 'Тент 20 т в Астане, готов забрать послезавтра.', ?, ?, ?)`,
      user[B], `/listing/${truck1}`, JSON.stringify({ route: ['almaty', 'balkhash', 'karaganda', 'astana'] }), ago(1),
      user[A], `/listing/${open1}`, JSON.stringify({ route: ['astana', 'kostanay'] }), ago(3));
    run(`INSERT INTO news(title, body, title_kz, body_kz, title_en, body_en, created_at) VALUES
      ('Подписки на грузы и push-уведомления', 'Сохраните поиск и включите колокольчик — платформа сама сообщит о новом подходящем грузе или машине, даже если она закрыта.', 'Жүктерге жазылу және push-хабарламалар', 'Іздеуді сақтап, қоңырауды қосыңыз — платформа жабық тұрса да, жаңа сәйкес жүк немесе көлік туралы өзі хабарлайды.', 'Load alerts and push notifications', 'Save a search and switch on the bell — the platform will tell you about a new matching load or truck even when it is closed.', ?),
      ('Калькуляторы: расстояние, стоимость рейса, нагрузка на оси', 'В разделе «Инструменты» появились три калькулятора и курсы Национального банка.', 'Калькуляторлар: қашықтық, рейс құны, осьтік жүктеме', '«Құралдар» бөлімінде үш калькулятор және Ұлттық банк бағамдары пайда болды.', 'Calculators: distance, trip cost, axle load', 'The Tools section now has three calculators and National Bank exchange rates.', ?),
      ('Команда: несколько сотрудников в одной компании', 'Владелец компании может пригласить логистов и водителей по номеру телефона — у каждого будет свой вход.', 'Команда: бір компанияда бірнеше қызметкер', 'Компания иесі логистер мен жүргізушілерді телефон нөмірі арқылы шақыра алады — әрқайсысының өз кіруі болады.', 'Teams: several people in one company', 'A company owner can invite dispatchers and drivers by phone number — each gets their own sign-in.', ?)`,
      ago(20), ago(140), ago(300));
    run(`INSERT INTO marks(user_id, listing_id, marked, note) VALUES(?, ?, 1, 'Уточнить про термописец и время выгрузки')`, user[B], open1);

    // ---- работа ----
    const job = (kind, owner, title, city, vehicle, cats, exp, salary, description) =>
      run('INSERT INTO jobs(kind, user_id, company_id, title, city_id, vehicle, license_cats, experience, salary, date_from, description, phone, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        kind, user[owner], comp[owner], title, city, vehicle, cats, exp, salary, day(int(1, 10)), description, COMPANIES.find((c) => c[0] === owner)[5], ago(int(2, 90)));
    job('vacancy', B, 'Водитель на рефрижератор, межгород', 'karaganda', 'Volvo FH, реф 20 т', 'C, CE', 3, 'от 600 000 ₸', 'Рейсы Караганда — Алматы — Астана. Оформление по ТК РК, договор регистрируем в ЕСУТД.');
    job('vacancy', 'Сарыарка Карго', 'Водитель категории CE на тент', 'astana', 'DAF XF 105, тент 20 т', 'CE', 5, '18% от рейса', 'Новая техника, рейсы по Казахстану и в РФ. Нужен загранпаспорт.');
    job('vacancy', 'Оңтүстік Транс', 'Водитель на самосвал', 'shymkent', 'Shacman X3000', 'C', 2, 'от 450 000 ₸', 'Работа вахтой 15/15, жильё предоставляем.');
    job('vacancy', 'Ертіс Авто', 'Водитель-экспедитор', 'pavlodar', 'Hyundai HD78, фургон 5 т', 'C', 1, 'от 350 000 ₸', 'Доставка по области, пятидневка.');
    job('resume', 'Тулегенов Б.', 'Водитель CE, стаж 14 лет, международные рейсы', 'shymkent', 'Тягач + полуприцеп (тент, реф)', 'B, C, CE', 14, 'от 700 000 ₸', 'Опыт: Китай, Узбекистан, Россия. ДОПОГ, чип-карта тахографа. Без ДТП.');
    job('resume', 'Номад Экспедиция', 'Водитель C, стаж 6 лет', 'astana', 'Среднетоннажные фургоны', 'B, C', 6, 'от 400 000 ₸', 'Ищу работу в Астане и области, готов к командировкам.');
    job('resume', 'Батыс Логистик', 'Водитель CE, вахта', 'aktobe', 'Самосвалы, тралы', 'C, CE', 9, 'договорная', 'Опыт перевозки негабарита, есть удостоверение стропальщика.');

    for (const name of [A, B, 'Silk Way Logistics', 'КеденСервис', 'Тулегенов Б.'])
      run(`INSERT INTO transactions(company_id, amount, kind, note) VALUES(?, 5000, 'topup', 'Приветственный бонус')`, comp[name]);
  });
  seedRelocation();
  seedServices();
  console.log('[seed] демо-данные загружены');
}

/**
 * Демо раздела «Перегон»: заявки на перегон техники и перегонщики в каталоге. Компании ищутся по названию,
 * поэтому это можно добавить и в уже заполненную демо-базу: node server/seed.js --relocation (повторно не дублирует).
 */
export function seedRelocation() {
  if (q1(`SELECT 1 FROM listings WHERE kind = 'relocation' LIMIT 1`)) return false;
  const who = (name) => q1('SELECT u.id AS user, c.id AS company FROM companies c JOIN users u ON u.company_id = c.id AND u.company_role = \'owner\' WHERE c.name = ? ORDER BY u.id LIMIT 1', name);
  const add = (owner, points, vehicle, brand, licenses, o = {}) => {
    const w = who(owner);
    if (!w) return;
    const km = roadKm(points.map((p) => cityById.get(p)));
    insert(
      `INSERT INTO listings(kind, user_id, company_id, status, points, from_id, to_id, brand, date_from, date_to, pay_terms, rate, currency, description,
         distance_km, trucks, load_address, unload_address, load_time, vehicle_kind, licenses, created_at)
       VALUES('relocation', ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, 'KZT', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      w.user, w.company, JSON.stringify(points), points[0], points[points.length - 1], brand, day(o.from ?? 0), day((o.from ?? 0) + 5),
      JSON.stringify(o.pay || ['cashless_vat']), o.rate ?? null, o.description || '', km, o.trucks || 1, o.load || '', o.unload || '', o.time || '',
      vehicle, JSON.stringify(licenses), ago(o.ago ?? 5),
    );
  };
  add('СтройМаркет KZ', ['khorgos', 'almaty'], 'special', 'Погрузчик Hyundai 50D', ['tractor'], {
    rate: 120000, trucks: 3, load: 'СЭЗ «Хоргос — Восточные ворота», таможенный склад', unload: 'Алматы, ул. Бокейханова 510, склад', time: '9:00–17:00',
    description: 'Три новых вилочных погрузчика после растаможки. Номера не нужны — перегон по трассе в сопровождении. Топливо за наш счёт.', ago: 2,
  });
  add('Алатау Агро', ['almaty', 'kaskelen'], 'special', 'Трактор МТЗ-82', ['tractor'], { rate: 40000, description: 'Трактор с базы на поле, около 40 км. Документы при тракторе.', ago: 6 });
  add('Астана Трейд', ['astana', 'karaganda'], 'truck', 'Тягач Volvo FH 460', ['C', 'CE'], { rate: 90000, from: 1, unload: 'Караганда, СТО на ул. Ермекова', description: 'Тягач без прицепа после ремонта, вернуть в парк.', ago: 12 });
  add('Каспий Металл', ['aktau', 'atyrau'], 'car', 'Toyota Camry 2023', ['B'], { rate: 60000, pay: ['card'], from: 2, description: 'Легковая машина из салона, пробег минимальный.', ago: 20 });
  add('Silk Way Logistics', ['urumqi', 'khorgos', 'almaty'], 'bus', 'Автобус Yutong ZK6122', ['D'], { rate: null, from: 3, description: 'Новый автобус из Урумчи, нужен водитель с категорией D и опытом международных поездок.', ago: 30 });
  // перегонщики в каталоге
  const profile = (phone, licenses, city, note) =>
    run('UPDATE users SET relocator = 1, licenses = ?, relocator_city = ?, relocator_note = ? WHERE phone = ?', JSON.stringify(licenses), city, note, phone);
  profile('+77010000005', ['B', 'C', 'CE', 'tractor'], 'shymkent', 'Стаж 14 лет: тягачи, самосвалы, погрузчики. Готов к дальним перегонам.');
  profile('+77015550105', ['B', 'C', 'CE'], 'almaty', 'Перегоняю тягачи и грузовики после ремонта и из салонов.');
  profile('+77015550107', ['B', 'C', 'tractor'], 'pavlodar', 'Тракторы и спецтехника по Павлодарской области.');
  profile('+77015550110', ['B', 'D'], 'astana', 'Автобусы и микроавтобусы, есть опыт поездок в Китай.');
  return true;
}

/** Демо каталога услуг: оплаченные карточки перегонщиков, сопровождения и брокеров. Повторно не дублирует. */
export function seedServices() {
  if (q1('SELECT 1 FROM services LIMIT 1')) return false;
  const until = new Date(Date.now() + 25 * 86400_000).toISOString();
  const add = (company, category, title, cities, description, all = false) => {
    const w = q1(`SELECT u.id AS user, c.id AS company, u.phone FROM companies c JOIN users u ON u.company_id = c.id AND u.company_role = 'owner' WHERE c.name = ? ORDER BY u.id LIMIT 1`, company);
    if (!w) return;
    insert('INSERT INTO services(company_id, user_id, category, title, cities, all_country, description, phone, paid_until, views) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      w.company, w.user, category, title, JSON.stringify(cities), all ? 1 : 0, description, w.phone, until, 0);
  };
  add('Оңтүстік Транс', 'relocation', 'Перегон тягачей и спецтехники', ['almaty', 'shymkent', 'taraz', 'khorgos'], 'Водители с категориями C, CE и удостоверением тракториста. Перегоняем из салонов, с таможни и после ремонта. Страховка на время перегона.');
  add('Тулегенов Б.', 'relocation', 'Перегонщик — легковые и грузовые', ['shymkent', 'turkistan', 'kyzylorda'], 'Стаж 14 лет. Категории B, C, CE, тракторист-машинист.');
  add('Сарыарка Карго', 'escort', 'Сопровождение негабарита 24/7', [], 'Две машины прикрытия с проблесковыми маячками и табличками «Крупногабаритный груз». Опыт с тралами и бурильным оборудованием, согласование маршрута.', true);
  add('Ертіс Авто', 'escort', 'Машина прикрытия — Павлодар и север', ['pavlodar', 'ekibastuz', 'astana', 'semey'], 'Сопровождение спецтехники и негабарита, работаем ночью.');
  add('КеденСервис', 'broker', 'Таможенное оформление на Хоргосе', ['khorgos', 'almaty'], 'Импорт и экспорт с Китаем, декларации, сертификаты, СВХ.');
  add('Евразия Брокер', 'broker', 'Брокер — декларирование и сертификация', [], 'Все таможенные режимы, электронное декларирование.', true);
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--relocation')) {
  console.log(seedRelocation() ? '[seed] демо раздела «Перегон» добавлено' : '[seed] демо раздела «Перегон» уже есть');
  console.log(seedServices() ? '[seed] демо каталога услуг добавлено' : '[seed] демо каталога услуг уже есть');
  process.exit(0);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (q1('SELECT 1 FROM users LIMIT 1')) {
    if (!process.argv.includes('--reset')) {
      console.log('База не пуста. Запустите с --reset, чтобы очистить её и загрузить демо-данные заново.');
      process.exit(1);
    }
    db.exec('PRAGMA foreign_keys=OFF;');
    for (const t of ['files', 'route_cache', 'feedback', 'news', 'push_subs', 'push_devices', 'notifications', 'complaints', 'partners', 'blocks', 'listing_views', 'invites', 'transactions', 'jobs', 'blacklist', 'reviews', 'positions', 'trip_events', 'trips', 'messages', 'chats', 'responses', 'searches', 'marks', 'listings', 'employees', 'vehicles', 'documents', 'otps', 'sessions', 'users', 'companies'])
      db.exec(`DELETE FROM ${t}`);
    db.exec('PRAGMA foreign_keys=ON;');
  }
  seed();
}
