// Отклики, чат, рейсы с GPS и отзывы.
import { z } from 'zod';
import { q, q1, run, insert, tx } from '../db.js';
import { cityById, haversine, ROAD_FACTOR } from '../geo.js';
import * as L from '../lib.js';
import { notify } from '../notify.js';
import { rateLimit } from './auth.js';
import { fileOut, fileSchema, saveFile, sendFile } from '../files.js';
import { forgetRecommendations } from './listings.js';

const { bad, parse, auth, staff } = L;

/** Маршрут объявления для подстановки {route} в уведомление. */
const routeOf = (listingId) => ({ route: L.j(q1('SELECT points FROM listings WHERE id = ?', listingId)?.points, []) });
const STAGE_TITLE = { to_loading: 'Машина едет на погрузку: {route}', loading: 'Идёт погрузка: {route}', in_transit: 'Груз в пути: {route}', unloading: 'Идёт выгрузка: {route}', delivered: 'Груз доставлен: {route}' };
// перегон: перегонщик едет к машине заказчика, принимает её и ведёт своим ходом
const RELOC_STAGE_TITLE = { to_loading: 'Перегонщик едет к машине: {route}', loading: 'Перегонщик принимает машину: {route}', in_transit: 'Машина в пути: {route}', unloading: 'Перегонщик сдаёт машину: {route}', delivered: 'Машина доставлена: {route}' };

// Сделки ведёт компания, а не один человек: чат и рейс видят все её сотрудники.
const usersOf = (companyId) => q('SELECT id FROM users WHERE company_id = ?', companyId).map((u) => u.id);
const staffOf = (companyId) => q(`SELECT id FROM users WHERE company_id = ? AND company_role != 'driver'`, companyId).map((u) => u.id);
const chatUsers = (chat) => [...staffOf(chat.owner_company), ...staffOf(chat.peer_company)];
const tripUsers = (t) => [...usersOf(t.customer_company), ...usersOf(t.carrier_company)];

function postMessage(chatId, sender, text, fileId = null) {
  const id = insert('INSERT INTO messages(chat_id, sender_id, text, file_id) VALUES(?, ?, ?, ?)', chatId, sender.id, text, fileId);
  const chat = q1('SELECT * FROM chats WHERE id = ?', chatId);
  L.push(chatUsers(chat), 'message', { chatId, id });
  return id;
}
function chatOf(req) {
  const chat = q1('SELECT * FROM chats WHERE id = ?', Number(req.params.id));
  if (!chat || (chat.owner_company !== req.user.company_id && chat.peer_company !== req.user.company_id)) throw bad('not_found', 'Чат не найден', 404);
  return chat;
}

const TRIP_SQL = `
SELECT t.*, l.kind AS l_kind, l.points AS l_points, l.cargo_type, l.body_type, l.weight, l.volume, l.distance_km,
  l.date_from AS l_date_from, l.date_to AS l_date_to, l.description AS l_description, l.loading AS l_loading, l.pay_terms AS l_pay_terms, l.brand AS l_brand,
  l.load_address AS l_load_address, l.unload_address AS l_unload_address, l.load_time AS l_load_time, l.trucks AS l_trucks,
  cu.name AS customer_user_name, cu.phone AS customer_phone, cu.settings AS customer_settings, ru.settings AS carrier_settings, cc.name AS customer_name, cc.form AS customer_form, cc.bin AS customer_bin,
  ru.name AS carrier_user_name, ru.phone AS carrier_phone, rc.name AS carrier_name, rc.form AS carrier_form, rc.bin AS carrier_bin
FROM trips t JOIN listings l ON l.id = t.listing_id
JOIN users cu ON cu.id = t.customer_user JOIN companies cc ON cc.id = t.customer_company
JOIN users ru ON ru.id = t.carrier_user JOIN companies rc ON rc.id = t.carrier_company`;

/** Условия сделки фиксируются в момент принятия отклика: правка объявления их уже не меняет. */
const TERM_COLS = { points: 'l_points', cargo_type: 'cargo_type', body_type: 'body_type', weight: 'weight', volume: 'volume', distance_km: 'distance_km',
  date_from: 'l_date_from', date_to: 'l_date_to', description: 'l_description', loading: 'l_loading', pay_terms: 'l_pay_terms', brand: 'l_brand',
  load_address: 'l_load_address', unload_address: 'l_unload_address', load_time: 'l_load_time' };
const TERMS_SQL = 'SELECT points, cargo_type, body_type, weight, volume, distance_km, date_from, date_to, description, loading, pay_terms, brand, load_address, unload_address, load_time FROM listings WHERE id = ?';
function withTerms(t) {
  const terms = t && L.j(t.terms, null);
  if (terms) for (const [k, col] of Object.entries(TERM_COLS)) if (k in terms) t[col] = terms[k];
  return t;
}
const AUTO_COMPLETE_HOURS = 72; // если заказчик молчит после доставки, рейс завершается сам
const deliveredAt = (tripId) => q1(`SELECT at FROM trip_events WHERE trip_id = ? AND stage = 'delivered' ORDER BY id DESC LIMIT 1`, tripId)?.at;

/** mode: 'party' — участник сделки, 'driver' — водитель по ссылке, 'public' — получатель по ссылке. */
function tripOut(t, viewer, full = false, mode = 'party') {
  const points = L.j(t.l_points, []);
  const last = q1('SELECT lat, lon, speed, at FROM positions WHERE trip_id = ? ORDER BY id DESC LIMIT 1', t.id) || null;
  const dest = cityById.get(points[points.length - 1]);
  const remainingKm = last && dest ? Math.round(haversine(last, dest) * ROAD_FACTOR) : null;
  const out = {
    id: t.id,
    status: t.status,
    kind: t.l_kind,
    stage: t.stage,
    shareGps: !!t.share_gps,
    points,
    listingId: t.listing_id,
    cargoType: t.cargo_type,
    bodyType: t.body_type,
    weight: t.weight,
    volume: t.volume,
    distanceKm: t.distance_km,
    createdAt: t.created_at,
    finishedAt: t.finished_at,
    failReason: t.fail_reason || '',
    carrier: { companyId: t.carrier_company, name: t.carrier_name, userName: t.carrier_user_name },
    customer: { companyId: t.customer_company, name: t.customer_name },
    position: last,
    // связь с машиной считается потерянной, если позиции нет дольше 20 минут
    signalLost: t.status === 'active' && !!t.share_gps && !!last && Date.now() - Date.parse(last.at) > 20 * 60_000,
    remainingKm,
    // на месте (меньше 5 км) время в пути не показываем: «≈ 1 ч» на финише сбивает с толку
    etaHours: remainingKm !== null && t.stage === 'in_transit' && remainingKm >= 5 ? Math.max(1, Math.round(remainingKm / 55)) : null,
    // перевозчик подтвердил рейс: назначил машину и водителя
    confirmed: !!t.confirmed_at,
    vehicle: { brand: t.vehicle_brand || '', plate: t.plate || '', trailerPlate: t.trailer_plate || '', bodyType: t.body_type },
  };
  // получателю по ссылке госномер нужен, чтобы узнать машину; имя и телефон водителя — только участникам и самому водителю
  if (mode !== 'public') {
    Object.assign(out, { loadAddress: t.l_load_address || '', unloadAddress: t.l_unload_address || '', loadTime: t.l_load_time || '' });
    out.driver = { userId: t.driver_user || null, name: t.driver_name || '', phone: t.driver_phone || '' };
  }
  if (mode === 'driver') {
    // водителю нужны контакты для погрузки и условия, но не цена сделки
    Object.assign(out.customer, { userName: t.customer_user_name, phone: t.status === 'active' ? t.customer_phone : null });
    Object.assign(out, { dateFrom: t.l_date_from, dateTo: t.l_date_to, description: t.l_description, loading: L.j(t.l_loading, []) });
  }
  if (mode === 'party') {
    const isDriver = viewer.company_role === 'driver';
    const done = deliveredAt(t.id);
    Object.assign(out, {
      myRole: t.carrier_company === viewer.company_id ? 'carrier' : 'customer',
      price: isDriver ? null : t.price,
      currency: t.currency,
      trackToken: t.track_token,
      driverToken: t.carrier_company === viewer.company_id ? t.driver_token : undefined,
      reviewed: !!q1('SELECT 1 FROM reviews WHERE trip_id = ? AND author_company = ?', t.id, viewer.company_id),
      autoCompleteAt: t.status === 'active' && t.stage === 'delivered' && done ? new Date(Date.parse(done) + AUTO_COMPLETE_HOURS * 3600_000).toISOString() : null,
      dateFrom: t.l_date_from, dateTo: t.l_date_to, description: t.l_description, loading: L.j(t.l_loading, []), payTerms: L.j(t.l_pay_terms, []), brand: t.l_brand,
    });
    // пока идёт рейс, стороны должны дозвониться друг до друга; после него действует настройка «скрыть телефон»
    const ph = (phone, settings, company) => (t.status === 'active' ? phone : L.phoneFor(viewer, { phone, settings, company_id: company }));
    Object.assign(out.carrier, { phone: ph(t.carrier_phone, t.carrier_settings, t.carrier_company), form: t.carrier_form, bin: t.carrier_bin });
    Object.assign(out.customer, { userName: t.customer_user_name, phone: ph(t.customer_phone, t.customer_settings, t.customer_company), form: t.customer_form, bin: t.customer_bin });
    out.chatId = q1('SELECT id FROM chats WHERE listing_id = :l AND ((owner_company = :a AND peer_company = :b) OR (owner_company = :b AND peer_company = :a))',
      { l: t.listing_id, a: t.customer_company, b: t.carrier_company })?.id || null;
  }
  if (full) {
    out.events = q('SELECT stage, at FROM trip_events WHERE trip_id = ? ORDER BY id', t.id);
    // документы и фото рейса видят обе стороны и водитель; получателю по ссылке — нет
    if (mode !== 'public') out.files = tripFiles(t.id);
    // трек прореживается до ~300 точек
    const track = q('SELECT lat, lon FROM positions WHERE trip_id = ? ORDER BY id', t.id);
    const step = Math.ceil(track.length / 300) || 1;
    out.track = track.filter((_, i) => i % step === 0 || i === track.length - 1).map((p) => [p.lat, p.lon]);
    if (mode === 'party') {
      // отзыв другой стороны виден только после своего — чтобы не отвечать оценкой на оценку
      out.reviews = q(
        `SELECT r.rating, r.text, r.created_at AS createdAt, c.name AS author, r.author_company = :me AS mine FROM reviews r
         JOIN companies c ON c.id = r.author_company WHERE r.trip_id = :t AND (r.author_company = :me OR ${L.REVIEW_VISIBLE})`,
        { t: t.id, me: viewer.company_id },
      ).map((r) => ({ ...r, mine: !!r.mine }));
    }
  }
  return out;
}

const tripFiles = (tripId) =>
  // загрузил водитель по ссылке — подписываем его именем из рейса, иначе — сотрудником и компанией
  q(`SELECT f.*, CASE WHEN f.by_driver_link THEN tr.driver_name ELSE COALESCE(u.name, '') || COALESCE(' · ' || c.name, '') END AS author
     FROM files f JOIN trips tr ON tr.id = f.ref_id LEFT JOIN users u ON u.id = f.user_id LEFT JOIN companies c ON c.id = f.company_id
     WHERE f.scope = 'trip' AND f.ref_id = ? ORDER BY f.id`, tripId).map(fileOut);
const FILE_KIND_RU = { photo: 'фото', ttn: 'ТТН', cmr: 'CMR', act: 'акт', invoice: 'счёт', waybill: 'путевой лист', other: 'документ' };
/** Файл в рейсе: сохранить и сообщить другой стороне. */
function addTripFile(t, b, by) {
  if (t.status !== 'active' && Date.now() - Date.parse(t.finished_at || L.now()) > 30 * 86400_000) throw bad('state', 'Рейс закрыт больше месяца назад — документы к нему уже не добавить', 409);
  const id = saveFile(b, { scope: 'trip', refId: t.id, userId: by?.id ?? null, companyId: by?.company_id ?? t.carrier_company, byDriverLink: !by });
  L.push(tripUsers(t), 'trip', { tripId: t.id });
  const to = by?.company_id === t.customer_company ? t.carrier_company : t.customer_company;
  notify(staffOf(to), { kind: 'trip', title: 'Новый документ в рейсе: {route}', vars: routeOf(t.listing_id), body: `${FILE_KIND_RU[b.kind] || 'документ'}: ${b.filename}`, link: `/trip/${t.id}` });
  return id;
}

function tripOf(req) {
  const t = withTerms(q1(`${TRIP_SQL} WHERE t.id = ?`, Number(req.params.id)));
  if (!t || (t.customer_company !== req.user.company_id && t.carrier_company !== req.user.company_id)) throw bad('not_found', 'Рейс не найден', 404);
  // водитель из команды видит только рейсы, на которые его назначили
  if (req.user.company_role === 'driver' && t.driver_user !== req.user.id) throw bad('not_found', 'Рейс не найден', 404);
  return t;
}
function tripByDriverToken(req) {
  const t = withTerms(q1(`${TRIP_SQL} WHERE t.driver_token = ?`, String(req.params.token)));
  // ссылка водителя нужна только на время рейса: через сутки после окончания она перестаёт работать
  if (!t || (t.finished_at && Date.now() - Date.parse(t.finished_at) > 86400_000)) throw bad('not_found', 'Ссылка недействительна', 404);
  return t;
}

// ---------- действия водителя: одинаковы для сотрудника перевозчика и для водителя по ссылке ----------
function setGps(t, share) {
  if (t.status !== 'active') throw bad('state', 'Рейс уже завершён', 409);
  if (!share && t.stage !== 'planned') throw bad('gps_required', 'После выезда на погрузку отключить GPS нельзя — до конца рейса заказчик должен видеть машину', 409);
  run('UPDATE trips SET share_gps = ? WHERE id = ?', share ? 1 : 0, t.id);
  L.push(tripUsers(t), 'trip', { tripId: t.id });
}
function addPosition(t, b) {
  if (t.status !== 'active' || !t.share_gps) throw bad('state', 'Передача GPS выключена', 409);
  const last = q1('SELECT lat, lon, at FROM positions WHERE trip_id = ? ORDER BY id DESC LIMIT 1', t.id);
  if (last) {
    const seconds = (Date.now() - Date.parse(last.at)) / 1000;
    if (seconds < 1.5) return { ok: true, skipped: true };
    // точка, до которой машина не могла доехать, — сбой геолокации или подмена: не записываем
    const km = haversine(last, { lat: b.lat, lon: b.lon });
    // в демо-режиме симуляция движения «едет» быстрее настоящей машины. Фильтр нужен в пути и при непрерывной передаче:
    // до выезда и после паузы точку принимаем — GPS могли включить с другого телефона
    const moving = L.STAGES.indexOf(t.stage) >= L.STAGES.indexOf('in_transit');
    if (!(L.DEMO && b.sim) && moving && seconds < 600 && km > 5 && km / (seconds / 3600) > L.MAX_SPEED) return { ok: true, skipped: true, reason: 'jump' };
  }
  if (L.DEMO && b.sim && !t.sim) run('UPDATE trips SET sim = 1 WHERE id = ?', t.id);
  run('INSERT INTO positions(trip_id, lat, lon, speed) VALUES(?, ?, ?, ?)', t.id, b.lat, b.lon, b.speed ?? null);
  L.push(tripUsers(t), 'position', { tripId: t.id, lat: b.lat, lon: b.lon, at: L.now() });
  return { ok: true };
}
function setStage(t, stage) {
  if (t.status !== 'active') throw bad('state', 'Рейс уже завершён', 409);
  if (L.STAGES.indexOf(stage) <= L.STAGES.indexOf(t.stage)) throw bad('state', 'Этап уже пройден', 409);
  if (L.STAGES.indexOf(stage) !== L.STAGES.indexOf(t.stage) + 1) throw bad('state', 'Этапы отмечаются по порядку', 409);
  if (!t.confirmed_at) throw bad('not_confirmed', 'Перевозчик ещё не подтвердил рейс: укажите машину и водителя', 409);
  // делиться GPS в пути обязательно
  if (!t.share_gps) throw bad('gps_required', 'Включите «Делиться GPS», чтобы начать рейс', 409);
  if (L.STAGES.indexOf(stage) >= L.STAGES.indexOf('in_transit')) {
    const last = q1('SELECT lat, lon, at FROM positions WHERE trip_id = ? ORDER BY id DESC LIMIT 1', t.id);
    if (!last || Date.now() - Date.parse(last.at) > 60 * 60_000)
      throw bad('gps_stale', 'Нет свежей GPS-позиции. Разрешите геолокацию на телефоне водителя и подождите несколько секунд', 409);
    // доставку можно отметить только рядом с пунктом выгрузки — так рейтинг нельзя накрутить рейсом «на бумаге»
    const points = L.j(t.l_points, []);
    const dest = cityById.get(points[points.length - 1]);
    const far = dest ? Math.round(haversine(last, dest)) : 0;
    // выгрузка может начаться в любом пункте после погрузки (частичная выгрузка по пути), доставка — только в конечном
    const nearStop = Math.round(Math.min(...points.slice(1).map((p) => cityById.get(p)).filter(Boolean).map((c) => haversine(last, c)), far || Infinity));
    if (stage === 'unloading' && nearStop > 80) throw L.tbad('gps_far', 'До ближайшего пункта выгрузки ещё {n} км. Отметить выгрузку можно, когда машина будет ближе 80 км к нему', { n: nearStop }, 409);
    if (stage === 'delivered' && far > 80) throw L.tbad('gps_far', 'До пункта выгрузки ещё {n} км. Отметить доставку можно, когда машина будет ближе 80 км к нему', { n: far }, 409);
    // рейс не может закончиться быстрее, чем машина способна проехать маршрут: так его не «нарисовать» за минуту
    if (stage === 'delivered' && !(L.DEMO && q1('SELECT sim FROM trips WHERE id = ?', t.id).sim)) {
      const started = q1(`SELECT at FROM trip_events WHERE trip_id = ? AND stage = 'in_transit'`, t.id)?.at;
      const km = q1('SELECT distance_km AS km FROM listings WHERE id = ?', t.listing_id)?.km || 0;
      const left = Math.ceil((km / L.MAX_SPEED) * 60 - (Date.now() - Date.parse(started || L.now())) / 60_000);
      if (left > 0) throw L.tbad('too_fast', 'Слишком быстро для такого расстояния — отметить доставку можно через {n} мин', { n: left }, 409);
    }
  }
  run('UPDATE trips SET stage = ? WHERE id = ?', stage, t.id);
  run('INSERT INTO trip_events(trip_id, stage) VALUES(?, ?)', t.id, stage);
  L.push(tripUsers(t), 'trip', { tripId: t.id });
  const reloc = q1('SELECT kind FROM listings WHERE id = ?', t.listing_id)?.kind === 'relocation';
  notify(staffOf(t.customer_company), {
    kind: 'trip', title: (reloc ? RELOC_STAGE_TITLE : STAGE_TITLE)[stage], vars: routeOf(t.listing_id),
    body: stage === 'delivered' ? (reloc ? 'Проверьте машину и подтвердите приёмку' : 'Проверьте груз и подтвердите доставку') : '', link: `/trip/${t.id}`,
  });
}
/** Объявление закрывается, когда по нему не осталось идущих рейсов и найдены все машины (или рейс сорван). */
function closeListingIfDone(listingId, force = false) {
  if (q1(`SELECT 1 FROM trips WHERE listing_id = ? AND status = 'active'`, listingId)) return;
  const l = q1(`SELECT trucks, ${L.BOOKED('listings')} AS booked FROM listings WHERE id = ?`, listingId);
  if (!force && l.booked < l.trucks) return;
  run(`UPDATE listings SET status = 'closed', closed_at = ? WHERE id = ? AND status = 'active'`, L.now(), listingId);
  run(`UPDATE responses SET status = 'declined' WHERE listing_id = ? AND status = 'sent'`, listingId);
}
function completeTrip(t) {
  tx(() => {
    run(`UPDATE trips SET status = 'completed', finished_at = ?, share_gps = 0 WHERE id = ?`, L.now(), t.id);
    closeListingIfDone(t.listing_id);
  });
  L.push(tripUsers(t), 'trip', { tripId: t.id });
}
/** Рейсы, где доставка отмечена, а заказчик не ответил за 72 часа, завершаются сами. */
export function autoCompleteTrips() {
  const limit = new Date(Date.now() - AUTO_COMPLETE_HOURS * 3600_000).toISOString();
  for (const t of q(`${TRIP_SQL} WHERE t.status = 'active' AND t.stage = 'delivered'`).map(withTerms)) {
    if ((deliveredAt(t.id) || L.now()) > limit) continue;
    completeTrip(t);
    notify(tripUsers(t), { kind: 'trip', title: 'Рейс завершён автоматически: {route}', vars: routeOf(t.listing_id), body: 'Оставьте отзыв о партнёре', link: `/trip/${t.id}` });
  }
}

const posSchema = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), speed: z.number().min(0).max(250).nullable().optional(), sim: z.boolean().optional() });
const stageSchema = z.object({ stage: z.enum(L.STAGES) });
const gpsSchema = z.object({ share: z.boolean() });

export default function dealRoutes(app) {
  // ---------- отклики ----------
  const respSchema = z.object({
    message: z.string().trim().min(1).max(1000),
    price: z.number().positive().max(1e9).nullable().optional(),
    currency: z.enum(L.CURRENCIES).default('KZT'),
    // сколько машин предлагает перевозчик (для груза на несколько машин) и какая машина из парка
    trucks: z.number().int().min(1).max(50).default(1),
    vehicleId: z.number().int().positive().nullable().optional(),
  });
  const freeTrucks = (listingId) => {
    const l = q1(`SELECT trucks, ${L.BOOKED('listings')} AS booked FROM listings WHERE id = ?`, listingId);
    return l.trucks - l.booked;
  };
  app.post('/api/listings/:id/responses', auth, staff, (req, res) => {
    L.requireActiveCompany(req.user);
    L.requireNoPendingReviews(req.user);
    const b = parse(respSchema, req.body);
    const l = q1('SELECT * FROM listings WHERE id = ?', Number(req.params.id));
    if (!l || l.status !== 'active') throw bad('not_found', 'Объявление недоступно', 404);
    if (l.company_id === req.user.company_id) throw bad('own', 'Нельзя откликнуться на объявление своей компании');
    // компания, которую владелец объявления скрыл, откликнуться не может (ответ тот же, что для закрытого объявления)
    if (q1('SELECT 1 FROM blocks WHERE company_id = ? AND blocked_id = ?', l.company_id, req.user.company_id)) throw bad('not_found', 'Объявление недоступно', 404);
    rateLimit('resp:' + req.user.company_id, 60, 3600_000, 'Слишком много откликов за час — попробуйте позже');
    if (q1('SELECT COUNT(*) AS n FROM responses WHERE listing_id = ? AND company_id = ?', l.id, req.user.company_id).n >= 3)
      throw bad('limit', 'На это объявление вы уже откликались несколько раз — продолжите разговор в чате', 409);
    const free = freeTrucks(l.id);
    if (free <= 0 && l.trucks > 1) throw bad('in_trip', 'Все машины по объявлению уже найдены', 409);
    if (free <= 0) throw bad('in_trip', 'По объявлению уже идёт рейс', 409);
    if (b.trucks > free) throw L.tbad('trucks', 'По объявлению осталось машин: {n}', { n: free }, 409);
    if (b.vehicleId && !q1('SELECT 1 FROM vehicles WHERE id = ? AND company_id = ?', b.vehicleId, req.user.company_id)) throw bad('vehicle', 'Машина не найдена в вашем парке', 404);
    if (q1(`SELECT 1 FROM responses WHERE listing_id = ? AND company_id = ? AND status = 'sent'`, l.id, req.user.company_id)) throw bad('duplicate', 'Вы уже откликнулись', 409);
    const out = tx(() => {
      const id = insert('INSERT INTO responses(listing_id, user_id, company_id, message, price, currency, trucks, vehicle_id) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
        l.id, req.user.id, req.user.company_id, b.message, b.price ?? null, b.currency, l.kind === 'truck' ? 1 : b.trucks, b.vehicleId ?? null);
      let chat = q1('SELECT id FROM chats WHERE listing_id = ? AND peer_company = ?', l.id, req.user.company_id);
      if (!chat) chat = { id: insert('INSERT INTO chats(listing_id, owner_id, peer_id, owner_company, peer_company) VALUES(?, ?, ?, ?, ?)', l.id, l.user_id, req.user.id, l.company_id, req.user.company_id) };
      return { id, chatId: chat.id };
    });
    const sym = { KZT: '₸', USD: '$', RUB: '₽' }[b.currency] || b.currency;
    const v = b.vehicleId ? q1('SELECT brand, plate FROM vehicles WHERE id = ?', b.vehicleId) : null;
    const extra = [
      b.price ? `— ${String(Math.round(b.price)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ${sym}${b.trucks > 1 ? ' за машину' : ''}` : '',
      l.kind !== 'truck' && b.trucks > 1 ? `— машин: ${b.trucks}` : '',
      v ? `— машина: ${v.brand}${v.plate ? `, ${v.plate}` : ''}` : '',
    ].filter(Boolean);
    postMessage(out.chatId, req.user, [b.message, ...extra].join('\n'));
    forgetRecommendations(req.user.id);
    L.push(staffOf(l.company_id), 'response', { listingId: l.id });
    notify(staffOf(l.company_id), { kind: 'response', title: 'Новый отклик: {route}', vars: routeOf(l.id), body: b.message.slice(0, 140), link: `/listing/${l.id}` });
    res.json(out);
  });

  app.get('/api/responses', auth, (req, res) => {
    const rows = (where, p) =>
      q(
        `SELECT r.id, r.message, r.price, r.currency, r.status, r.trucks, r.created_at AS createdAt, r.listing_id AS listingId,
           l.kind, l.from_id AS fromId, l.to_id AS toId, l.status AS listingStatus, u.name AS userName, c.name AS companyName, c.id AS companyId,
           lc.name AS ownerCompany, lc.id AS ownerCompanyId, c.kind AS companyKind, c.verified AS companyVerified,
           (SELECT rating FROM company_stats cs WHERE cs.id = r.company_id) AS companyRating,
           (SELECT id FROM chats ch WHERE ch.listing_id = r.listing_id AND ch.peer_company = r.company_id) AS chatId,
           (SELECT id FROM trips t WHERE t.response_id = r.id ORDER BY t.id LIMIT 1) AS tripId
         FROM responses r JOIN listings l ON l.id = r.listing_id JOIN users u ON u.id = r.user_id
         JOIN companies c ON c.id = r.company_id JOIN companies lc ON lc.id = l.company_id
         WHERE ${where} ORDER BY r.id DESC LIMIT 200`,
        p,
      );
    res.json({
      incoming: rows(`l.company_id = :c AND r.status != 'withdrawn'`, { c: req.user.company_id }),
      outgoing: rows('r.company_id = :c', { c: req.user.company_id }),
    });
  });

  app.post('/api/responses/:id/:action', auth, staff, (req, res) => {
    const { action } = req.params;
    let tripId = null;
    // проверка состояния и запись — одной транзакцией, чтобы два одновременных «принять» не создали два рейса
    const r = tx(() => {
      const row = q1(
        `SELECT r.*, l.company_id AS owner_company, l.user_id AS owner_user, l.kind, l.rate, l.currency AS l_currency, l.status AS l_status, l.trucks AS l_trucks
         FROM responses r JOIN listings l ON l.id = r.listing_id WHERE r.id = ?`,
        Number(req.params.id),
      );
      if (!row) throw bad('not_found', 'Отклик не найден', 404);
      if (row.status !== 'sent') throw bad('state', 'Отклик уже обработан', 409);
      const isOwner = row.owner_company === req.user.company_id;
      const isAuthor = row.company_id === req.user.company_id;
      if (action === 'withdraw' && isAuthor) run(`UPDATE responses SET status = 'withdrawn' WHERE id = ?`, row.id);
      else if (action === 'decline' && isOwner) run(`UPDATE responses SET status = 'declined' WHERE id = ?`, row.id);
      else if (action === 'accept' && isOwner) {
        if (row.l_status !== 'active') throw bad('state', 'Объявление уже закрыто', 409);
        const free = freeTrucks(row.listing_id);
        if (free <= 0 && row.l_trucks > 1) throw bad('in_trip', 'Все машины по объявлению уже найдены', 409);
        if (free <= 0) throw bad('in_trip', 'По объявлению уже идёт рейс', 409);
        // заказчик — тот, чей груз; перевозчик — тот, чей транспорт
        const owner = { user: row.owner_user, company: row.owner_company };
        const peer = { user: row.user_id, company: row.company_id };
        const [customer, carrier] = row.kind === 'truck' ? [peer, owner] : [owner, peer];
        // брокер оформляет документы, а не везёт груз: рейс с ним как с перевозчиком не создаётся
        if (q1('SELECT kind FROM companies WHERE id = ?', carrier.company)?.kind === 'broker')
          throw bad('broker', 'Брокер не перевозит груз — договоритесь об услугах в чате', 409);
        run(`UPDATE responses SET status = 'accepted' WHERE id = ?`, row.id);
        const terms = JSON.stringify(q1(TERMS_SQL, row.listing_id));
        // машина, предложенная в отклике, подставляется в рейс; водителя перевозчик назначает при подтверждении
        const v = row.vehicle_id ? q1('SELECT brand, plate FROM vehicles WHERE id = ? AND company_id = ?', row.vehicle_id, row.company_id) : null;
        // на груз из нескольких машин — отдельный рейс на каждую машину: у каждой свой водитель, GPS и этапы
        const n = Math.min(row.trucks || 1, free);
        // перегон: машина — заказчика (марка из заявки), за рулём сам откликнувшийся перегонщик — рейс сразу подтверждён.
        // Если перегонщиков несколько (компания взяла несколько машин), водителей она назначает сама.
        const reloc = row.kind === 'relocation' ? q1('SELECT l.brand, u.name, u.phone FROM listings l, users u WHERE l.id = ? AND u.id = ?', row.listing_id, row.user_id) : null;
        for (let i = 0; i < n; i++) {
          const id = insert(
            `INSERT INTO trips(listing_id, response_id, customer_user, customer_company, carrier_user, carrier_company, price, currency, track_token, driver_token, terms, vehicle_brand, plate)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            row.listing_id, row.id, customer.user, customer.company, carrier.user, carrier.company,
            row.price ?? row.rate ?? null, row.price ? row.currency : row.l_currency, L.token(12), L.token(18), terms,
            n === 1 && v ? v.brand : '', n === 1 && v ? v.plate : '',
          );
          run(`INSERT INTO trip_events(trip_id, stage) VALUES(?, 'planned')`, id);
          if (reloc) {
            run('UPDATE trips SET vehicle_brand = ? WHERE id = ?', reloc.brand, id);
            if (n === 1) run('UPDATE trips SET driver_user = ?, driver_name = ?, driver_phone = ?, confirmed_at = ? WHERE id = ?', row.user_id, reloc.name, reloc.phone, L.now(), id);
          }
          tripId ??= id;
        }
      } else throw bad('forbidden', 'Действие недоступно', 403);
      return row;
    });
    const both = [...staffOf(r.owner_company), ...staffOf(r.company_id)];
    if (action === 'decline') notify(staffOf(r.company_id), { kind: 'response', title: 'Отклик отклонён: {route}', vars: routeOf(r.listing_id), link: `/listing/${r.listing_id}` });
    if (tripId) {
      L.push(both, 'trip', { tripId });
      // подтвердить рейс — машину и водителя — должен перевозчик
      const carrierCompany = r.kind === 'truck' ? r.owner_company : r.company_id;
      notify(staffOf(r.company_id), { kind: 'trip', title: 'Отклик принят — рейс создан: {route}', vars: routeOf(r.listing_id), link: `/trip/${tripId}` });
      const autoConfirmed = r.kind === 'relocation' && q1('SELECT confirmed_at FROM trips WHERE id = ?', tripId)?.confirmed_at;
      if (carrierCompany === r.company_id && !autoConfirmed) notify(staffOf(carrierCompany), { kind: 'trip', title: 'Подтвердите рейс: {route}', vars: routeOf(r.listing_id), body: 'Укажите машину и водителя', link: `/trip/${tripId}` });
    }
    L.push(both, 'response', { listingId: r.listing_id });
    res.json({ ok: true, tripId });
  });

  // ---------- чат ----------
  app.get('/api/chats', auth, staff, (req, res) => {
    res.json(
      q(
        `SELECT c.id, c.listing_id AS listingId, l.kind, l.from_id AS fromId, l.to_id AS toId, pc.name AS peerCompany, pc.id AS peerCompanyId,
           (SELECT text FROM messages m WHERE m.chat_id = c.id ORDER BY m.id DESC LIMIT 1) AS lastText,
           (SELECT created_at FROM messages m WHERE m.chat_id = c.id ORDER BY m.id DESC LIMIT 1) AS lastAt,
           (SELECT u.name FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.chat_id = c.id AND u.company_id != :c ORDER BY m.id DESC LIMIT 1) AS peerName,
           (SELECT COUNT(*) FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.chat_id = c.id AND m.is_read = 0 AND u.company_id != :c) AS unread,
           pu.phone AS peerPhone, pu.settings AS peerSettings, pu.company_id AS peerUserCompany
         FROM chats c JOIN listings l ON l.id = c.listing_id
         JOIN users pu ON pu.id = CASE WHEN c.owner_company = :c THEN c.peer_id ELSE c.owner_id END
         JOIN companies pc ON pc.id = CASE WHEN c.owner_company = :c THEN c.peer_company ELSE c.owner_company END
         WHERE c.owner_company = :c OR c.peer_company = :c ORDER BY lastAt DESC LIMIT 300`,
        { c: req.user.company_id },
      ).map(({ peerSettings, peerUserCompany, ...c }) => {
        // если одна из компаний скрыла другую, переписка закрыта и контакты не показываем
        const blocked = !!q1('SELECT 1 FROM blocks WHERE (company_id = :a AND blocked_id = :b) OR (company_id = :b AND blocked_id = :a)', { a: req.user.company_id, b: c.peerCompanyId });
        return { ...c, blocked, peerPhone: blocked ? null : L.phoneFor(req.user, { phone: c.peerPhone, settings: peerSettings, company_id: peerUserCompany }) };
      }),
    );
  });
  app.get('/api/chats/:id/messages', auth, staff, (req, res) => {
    const chat = chatOf(req);
    const changed = run(
      `UPDATE messages SET is_read = 1 WHERE chat_id = ? AND is_read = 0 AND sender_id NOT IN (SELECT id FROM users WHERE company_id = ?)`,
      chat.id, req.user.company_id,
    ).changes;
    if (changed) L.push(chatUsers(chat), 'read', { chatId: chat.id });
    res.json(
      q(
        `SELECT m.id, m.sender_id AS senderId, u.name AS senderName, u.company_id AS companyId, m.text, m.is_read AS isRead, m.created_at AS createdAt,
           f.id AS f_id, f.filename AS f_name, f.mime AS f_mime, f.kind AS f_kind, f.size AS f_size
         FROM messages m JOIN users u ON u.id = m.sender_id LEFT JOIN files f ON f.id = m.file_id
         WHERE m.chat_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT 300`,
        // ?before=<id> — более ранние сообщения: длинная переписка подгружается порциями
        chat.id, Number(req.query.before) > 0 ? Number(req.query.before) : Number.MAX_SAFE_INTEGER,
      )
        .reverse()
        .map((m) => ({
          id: m.id, senderName: m.senderName, text: m.text, createdAt: m.createdAt, isRead: !!m.isRead, mine: m.companyId === req.user.company_id, me: m.senderId === req.user.id,
          file: m.f_id ? { id: m.f_id, filename: m.f_name, mime: m.f_mime, kind: m.f_kind, size: m.f_size } : null,
        })),
    );
  });
  app.post('/api/chats/:id/messages', auth, staff, (req, res) => {
    const chat = chatOf(req);
    const { text } = parse(z.object({ text: z.string().trim().min(1).max(2000) }), req.body);
    rateLimit('msg:' + req.user.id, 30, 60_000, 'Слишком много сообщений — подождите минуту');
    if (q1('SELECT 1 FROM blocks WHERE (company_id = :a AND blocked_id = :b) OR (company_id = :b AND blocked_id = :a)', { a: chat.owner_company, b: chat.peer_company }))
      throw bad('blocked', 'Переписка недоступна: одна из компаний скрыла другую', 403);
    res.json({ id: postMessage(chat.id, req.user, text) });
  });

  // файл в чате: фото груза, документы, реквизиты — сообщением со ссылкой на файл
  app.post('/api/chats/:id/files', auth, staff, (req, res) => {
    const chat = chatOf(req);
    const b = parse(fileSchema, req.body);
    rateLimit('file:' + req.user.id, 30, 3600_000, 'Слишком много файлов за час — попробуйте позже');
    if (q1('SELECT 1 FROM blocks WHERE (company_id = :a AND blocked_id = :b) OR (company_id = :b AND blocked_id = :a)', { a: chat.owner_company, b: chat.peer_company }))
      throw bad('blocked', 'Переписка недоступна: одна из компаний скрыла другую', 403);
    const fileId = saveFile(b, { scope: 'chat', refId: chat.id, userId: req.user.id, companyId: req.user.company_id });
    res.json({ id: postMessage(chat.id, req.user, `📎 ${b.filename}`, fileId), fileId });
  });
  // Просмотр файла — только участникам чата или рейса (водителю из команды — только своего рейса).
  app.get('/api/files/:id', auth, (req, res) => {
    const f = q1('SELECT * FROM files WHERE id = ?', Number(req.params.id));
    const deny = () => bad('not_found', 'Файл не найден', 404);
    if (!f) throw deny();
    if (f.scope === 'chat') {
      const chat = q1('SELECT * FROM chats WHERE id = ?', f.ref_id);
      if (!chat || req.user.company_role === 'driver' || (chat.owner_company !== req.user.company_id && chat.peer_company !== req.user.company_id)) throw deny();
    } else {
      const t = q1('SELECT * FROM trips WHERE id = ?', f.ref_id);
      if (!t || (t.customer_company !== req.user.company_id && t.carrier_company !== req.user.company_id)) throw deny();
      if (req.user.company_role === 'driver' && t.driver_user !== req.user.id) throw deny();
    }
    sendFile(res, f);
  });

  // ---------- рейсы ----------
  app.post('/api/trips/:id/files', auth, (req, res) => {
    const t = tripOf(req);
    const b = parse(fileSchema, req.body);
    rateLimit('file:' + req.user.id, 30, 3600_000, 'Слишком много файлов за час — попробуйте позже');
    res.json({ id: addTripFile(t, b, req.user) });
  });
  // водитель по ссылке: фото груза при погрузке, подписанная ТТН при выгрузке
  app.post('/api/drive/:token/files', (req, res) => {
    const t = tripByDriverToken(req);
    const b = parse(fileSchema, req.body);
    rateLimit('file:drive:' + t.id, 30, 3600_000, 'Слишком много файлов за час — попробуйте позже');
    res.json({ id: addTripFile(t, b, null) });
  });
  app.get('/api/drive/:token/files/:fid', (req, res) => {
    const t = tripByDriverToken(req);
    const f = q1(`SELECT * FROM files WHERE id = ? AND scope = 'trip' AND ref_id = ?`, Number(req.params.fid), t.id);
    if (!f) throw bad('not_found', 'Файл не найден', 404);
    sendFile(res, f);
  });

  app.get('/api/trips', auth, (req, res) => {
    // водитель из команды видит только свои рейсы
    const driver = req.user.company_role === 'driver';
    const where = driver ? 't.driver_user = :u' : '(t.customer_company = :c OR t.carrier_company = :c)';
    res.json(
      q(`${TRIP_SQL} WHERE ${where} ORDER BY (t.status = 'active') DESC, t.id DESC LIMIT 200`, driver ? { u: req.user.id } : { c: req.user.company_id })
        .map((t) => tripOut(withTerms(t), req.user)),
    );
  });
  app.get('/api/trips/:id', auth, (req, res) => res.json(tripOut(tripOf(req), req.user, true)));

  // Публичная ссылка отслеживания — без входа и без контактов сторон.
  app.get('/api/track/:token', (req, res) => {
    const t = withTerms(q1(`${TRIP_SQL} WHERE t.track_token = ?`, String(req.params.token)));
    // ссылка действует, пока идёт рейс, и ещё неделю после него
    // сорванный рейс получателю не показываем: машина к нему не едет
    if (!t || t.status === 'failed' || (t.finished_at && Date.now() - Date.parse(t.finished_at) > 7 * 86400_000)) throw bad('not_found', 'Ссылка недействительна', 404);
    const out = tripOut(t, null, true, 'public');
    // получателю хватает маршрута, этапа и положения машины: ни цены, ни заказчика, ни ссылок на объявление.
    // Название перевозчика нужно, чтобы узнать машину на погрузке.
    delete out.listingId;
    out.carrier = { name: t.carrier_name };
    out.customer = {};
    if (!t.share_gps && t.status === 'active') Object.assign(out, { position: null, track: [], remainingKm: null, etaHours: null });
    res.json(out);
  });

  // Сотрудник перевозчика ведёт рейс из приложения.
  const carrierOnly = (req) => {
    const t = tripOf(req);
    if (t.carrier_company !== req.user.company_id) throw bad('forbidden', 'Это действие выполняет перевозчик', 403);
    return t;
  };
  app.post('/api/trips/:id/stage', auth, (req, res) => {
    setStage(carrierOnly(req), parse(stageSchema, req.body).stage);
    res.json({ ok: true });
  });
  app.post('/api/trips/:id/gps', auth, (req, res) => {
    setGps(carrierOnly(req), parse(gpsSchema, req.body).share);
    res.json({ ok: true });
  });
  app.post('/api/trips/:id/position', auth, (req, res) => res.json(addPosition(carrierOnly(req), parse(posSchema, req.body))));

  // Водитель без аккаунта ведёт рейс по личной ссылке: видит маршрут и контакт на погрузке, но не цену.
  app.get('/api/drive/:token', (req, res) => res.json(tripOut(tripByDriverToken(req), null, true, 'driver')));
  app.post('/api/drive/:token/stage', (req, res) => {
    setStage(tripByDriverToken(req), parse(stageSchema, req.body).stage);
    res.json({ ok: true });
  });
  app.post('/api/drive/:token/gps', (req, res) => {
    setGps(tripByDriverToken(req), parse(gpsSchema, req.body).share);
    res.json({ ok: true });
  });
  app.post('/api/drive/:token/position', (req, res) => res.json(addPosition(tripByDriverToken(req), parse(posSchema, req.body))));
  // Перевозчик может выпустить новую ссылку, если прежняя попала не тому человеку.
  app.post('/api/trips/:id/driver-link', auth, staff, (req, res) => {
    const t = carrierOnly(req);
    const driverToken = L.token(18);
    run('UPDATE trips SET driver_token = ? WHERE id = ?', driverToken, t.id);
    res.json({ driverToken });
  });

  // Перевозчик подтверждает рейс: какая машина поедет и кто за рулём. Пока груз не в пути, машину и водителя можно заменить.
  const assignSchema = z.object({
    vehicleId: z.number().int().positive().nullable().optional(),
    brand: z.string().trim().max(60).default(''),
    plate: z.string().trim().max(20).default(''),
    trailerPlate: z.string().trim().max(20).default(''),
    driverUserId: z.number().int().positive().nullable().optional(),
    driverName: z.string().trim().max(100).default(''),
    driverPhone: z.string().trim().max(20).default(''),
  });
  app.post('/api/trips/:id/assign', auth, staff, (req, res) => {
    const t = carrierOnly(req);
    const b = parse(assignSchema, req.body);
    if (t.status !== 'active') throw bad('state', 'Рейс уже завершён', 409);
    if (L.STAGES.indexOf(t.stage) >= L.STAGES.indexOf('in_transit')) throw bad('state', 'Груз уже в пути — машину и водителя заменить нельзя', 409);
    let { brand, plate } = b;
    if (b.vehicleId) {
      const v = q1('SELECT brand, plate FROM vehicles WHERE id = ? AND company_id = ?', b.vehicleId, req.user.company_id);
      if (!v) throw bad('vehicle', 'Машина не найдена в вашем парке', 404);
      ({ brand, plate } = v);
    }
    let { driverName, driverPhone } = b;
    let driverUser = null;
    if (b.driverUserId) {
      const d = q1('SELECT id, name, phone FROM users WHERE id = ? AND company_id = ?', b.driverUserId, req.user.company_id);
      if (!d) throw bad('driver', 'Водитель не найден в вашей команде', 404);
      [driverUser, driverName, driverPhone] = [d.id, d.name, d.phone];
    }
    plate = plate.toUpperCase().replace(/\s+/g, ' ');
    // при перегоне у новой машины или спецтехники номера может ещё не быть
    const reloc = t.l_kind === 'relocation';
    if (!reloc && plate.length < 4) throw bad('validation', 'Госномер: укажите номер машины', 400);
    if (!brand && reloc) brand = t.vehicle_brand || t.l_brand || '';
    if (!brand) throw bad('validation', 'Марка: укажите марку машины', 400);
    if (driverName.length < 2) throw bad('validation', 'Водитель: укажите имя водителя', 400);
    driverPhone = L.normPhone(driverPhone);
    const first = !t.confirmed_at;
    run(`UPDATE trips SET vehicle_brand = ?, plate = ?, trailer_plate = ?, driver_user = ?, driver_name = ?, driver_phone = ?, confirmed_at = COALESCE(confirmed_at, ?) WHERE id = ?`,
      brand, plate, b.trailerPlate.toUpperCase(), driverUser, driverName, driverPhone, L.now(), t.id);
    L.push(tripUsers(t), 'trip', { tripId: t.id });
    notify(staffOf(t.customer_company), {
      kind: 'trip', title: first ? 'Перевозчик подтвердил рейс: {route}' : 'Перевозчик заменил машину или водителя: {route}',
      vars: routeOf(t.listing_id), body: `${brand}, ${plate} · ${driverName}`, link: `/trip/${t.id}`,
    });
    if (driverUser && driverUser !== t.driver_user) notify(driverUser, { kind: 'trip', title: 'Вас назначили на рейс: {route}', vars: routeOf(t.listing_id), link: `/trip/${t.id}` });
    res.json({ ok: true });
  });

  // Заказчик подтверждает доставку — рейс завершён, объявление уходит в «Закрытые».
  // Если заказчик молчит 72 часа после отметки «Доставлено», завершить может и перевозчик.
  app.post('/api/trips/:id/complete', auth, staff, (req, res) => {
    const t = tripOf(req);
    if (t.status !== 'active') throw bad('state', 'Рейс уже завершён', 409);
    if (t.stage !== 'delivered') throw bad('state', 'Перевозчик ещё не отметил доставку', 409);
    const isCustomer = t.customer_company === req.user.company_id;
    if (!isCustomer && Date.now() - Date.parse(deliveredAt(t.id) || L.now()) < AUTO_COMPLETE_HOURS * 3600_000)
      throw bad('forbidden', 'Завершение подтверждает заказчик. Если он не ответит за трое суток, рейс завершится сам', 403);
    completeTrip(t);
    notify(isCustomer ? staffOf(t.carrier_company) : staffOf(t.customer_company), {
      kind: 'trip', title: 'Доставка подтверждена: {route}', vars: routeOf(t.listing_id), body: isCustomer ? 'Оставьте отзыв о заказчике' : '', link: `/trip/${t.id}`,
    });
    res.json({ ok: true });
  });

  app.post('/api/trips/:id/cancel', auth, staff, (req, res) => {
    const t = tripOf(req);
    if (t.status !== 'active') throw bad('state', 'Рейс уже завершён', 409);
    if (L.STAGES.indexOf(t.stage) >= L.STAGES.indexOf('in_transit')) throw bad('state', 'Груз уже в пути — если рейс сорван, закройте его как сорванный', 409);
    run(`UPDATE trips SET status = 'cancelled', finished_at = ?, share_gps = 0 WHERE id = ?`, L.now(), t.id);
    L.push(tripUsers(t), 'trip', { tripId: t.id });
    notify(staffOf(t.customer_company === req.user.company_id ? t.carrier_company : t.customer_company), { kind: 'trip', title: 'Рейс отменён: {route}', vars: routeOf(t.listing_id), link: `/trip/${t.id}` });
    res.json({ ok: true });
  });

  // Рейс сорван: машина не приехала, груз не доставлен, заказчик отказался. Доступно любой стороне на любом этапе —
  // чтобы рейс не зависал, а о случившемся можно было оставить отзыв.
  app.post('/api/trips/:id/fail', auth, staff, (req, res) => {
    const t = tripOf(req);
    const { reason } = parse(z.object({ reason: z.string().trim().min(5).max(500) }), req.body);
    if (t.status !== 'active') throw bad('state', 'Рейс уже завершён', 409);
    tx(() => {
      run(`UPDATE trips SET status = 'failed', finished_at = ?, share_gps = 0, fail_reason = ?, failed_by = ? WHERE id = ?`, L.now(), reason, req.user.company_id, t.id);
      // по объявлению на несколько машин остальные рейсы продолжаются
      closeListingIfDone(t.listing_id, true);
    });
    L.push(tripUsers(t), 'trip', { tripId: t.id });
    notify(staffOf(t.customer_company === req.user.company_id ? t.carrier_company : t.customer_company), {
      kind: 'trip', title: 'Рейс закрыт как сорванный: {route}', vars: routeOf(t.listing_id), body: reason.slice(0, 140), link: `/trip/${t.id}`,
    });
    for (const a of q('SELECT id FROM users WHERE is_admin = 1')) notify(a.id, { kind: 'system', title: 'Сорванный рейс №{n}', vars: { n: t.id }, body: reason.slice(0, 140), link: '/cabinet/admin' });
    res.json({ ok: true });
  });

  // Отзыв можно оставить по завершённому, сорванному и отменённому рейсу; обязателен он только по завершённому.
  app.post('/api/trips/:id/review', auth, staff, (req, res) => {
    const t = tripOf(req);
    const b = parse(z.object({ rating: z.number().int().min(1).max(5), text: z.string().trim().max(1000).default('') }), req.body);
    if (t.status === 'active') throw bad('state', 'Отзыв можно оставить после завершения рейса', 409);
    const target = t.customer_company === req.user.company_id ? t.carrier_company : t.customer_company;
    if (q1('SELECT 1 FROM reviews WHERE trip_id = ? AND author_company = ?', t.id, req.user.company_id)) throw bad('duplicate', 'Отзыв уже оставлен', 409);
    run('INSERT INTO reviews(trip_id, author_user, author_company, target_company, rating, text) VALUES(?, ?, ?, ?, ?, ?)',
      t.id, req.user.id, req.user.company_id, target, b.rating, b.text);
    L.resetCompanyCache();
    notify(staffOf(target), { kind: 'review', title: 'О вашей компании оставили отзыв', body: 'Он станет виден, когда вы оставите свой отзыв по этому рейсу, или через 7 дней', link: `/trip/${t.id}` });
    res.json({ ok: true });
  });
}
