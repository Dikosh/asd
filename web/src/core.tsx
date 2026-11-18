// Ядро клиента: API, типы, язык, справочники, форматирование, контекст приложения.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { KZ } from './kz';
import { EN } from './en';
import { ZH } from './zh';

// ---------- типы ----------
export interface City { id: string; ru: string; kz: string; en: string; zh: string; country: string; lat: number; lon: number; region: string }
export interface Company {
  id: number; name: string; form: string; kind: string; verified: string; rating: number | null;
  reviews: number; trips: number; blacklisted: number; pro?: boolean; banned?: boolean; indicator: 'green' | 'red' | 'gray';
}
export interface Listing {
  id: number; kind: Kind; status: 'active' | 'closed' | 'archived' | 'removed'; points: string[]; fromId: string; toId: string;
  brand: string; bodyType: string | null; cargoType: string | null; weight: number | null; volume: number | null; loading: string[];
  dateFrom: string; dateTo: string; payTerms: string[]; rate: number | null; currency: string; description: string; distanceKm: number;
  international: boolean; boosted: boolean; boostedUntil?: string | null; createdAt: string; tripId: number | null; company: Company;
  user: { id: number; name: string; phone: string | null }; mine: boolean; mark: { marked: boolean; note: string; hidden: boolean };
  adrClass: number | null; flags: string[]; views: number; partner: boolean; blocked: boolean; countries: string[];
  responsesCount: number; myResponse: { id: number; status: string } | null; match?: { score: number; detourKm: number }; detourKm?: number;
  trucks: number; booked: number; full: boolean; loadAddress: string; unloadAddress: string; loadTime: string; vehicleKind: string | null; licenses: string[];
}
/** Рейс по объявлению — в карточке объявления (у груза на несколько машин их несколько). */
export interface ListingTrip {
  id: number; status: string; stage: string; plate: string; vehicleBrand: string; driverName: string; confirmed: boolean; carrierName: string; customerName: string;
}
export interface Me {
  user: { id: number; name: string; phone: string; email: string; role: string; isAdmin: boolean; companyRole: string; settings: Record<string, any> };
  company: Company & { bin: string | null; binValid: boolean; about: string; cityId: string | null; balance: number; planUntil: string | null; verifyNote: string; banned?: boolean; banReason?: string };
  counters: { notifications: number; unread: number; responses: number; trips: number };
  pendingReviews: { tripId: number; companyName: string; finishedAt: string }[];
}
/** Вид объявления: груз, транспорт или заявка на перегон машины своим ходом. */
export type Kind = 'cargo' | 'truck' | 'relocation';

export interface Meta {
  demo: boolean; cities: City[]; roles: string[]; body: string[]; cargo: string[]; loading: string[]; pay: string[]; currencies: string[];
  stages: string[]; docKinds: string[]; boostPrice: number; flags: string[]; places: number; relocVehicles: string[]; licenses: string[];
  support: { phone: string; telegram: string; hours: string }; tiles: { url: string; attribution: string }; limits: { activeFree: number; activePro: number; perHour: number; boostsPro: number };
  plan: { price: number; days: number; free: { seats: number; alerts: number }; pro: { seats: number; alerts: number } }; stats: { cargo: number; truck: number; relocation: number; companies: number; trips: number };
}
export interface Trip {
  id: number; status: 'active' | 'completed' | 'cancelled' | 'failed'; kind?: Kind; stage: string; signalLost?: boolean; failReason?: string; driverToken?: string; autoCompleteAt?: string | null; shareGps: boolean; points: string[]; listingId: number;
  cargoType: string | null; bodyType: string | null; weight: number | null; volume: number | null; distanceKm: number; price?: number | null; currency: string;
  createdAt: string; finishedAt: string | null; carrier: { companyId: number; name: string; userName: string; phone?: string; form?: string; bin?: string | null };
  customer: { companyId: number; name: string; userName?: string; phone?: string; form?: string; bin?: string | null };
  dateFrom?: string; dateTo?: string; description?: string; loading?: string[]; payTerms?: string[]; brand?: string;
  position: { lat: number; lon: number; speed: number | null; at: string } | null; remainingKm: number | null; etaHours: number | null;
  myRole?: 'customer' | 'carrier'; trackToken?: string; reviewed?: boolean; chatId?: number | null;
  confirmed: boolean; vehicle: { brand: string; plate: string; trailerPlate: string; bodyType: string | null };
  driver?: { userId: number | null; name: string; phone: string }; loadAddress?: string; unloadAddress?: string; loadTime?: string;
  files?: TripFile[];
  events?: { stage: string; at: string }[]; track?: [number, number][]; reviews?: { rating: number; text: string; author: string; createdAt: string }[];
}

/** Файл рейса или чата: фото груза, ТТН, CMR и т. п. */
export interface TripFile {
  id: number; kind: string; filename: string; mime: string; size: number; note: string; createdAt: string; author: string; byDriverLink: boolean; companyId: number | null;
}

// ---------- API ----------
export class ApiError extends Error {
  field?: string;
  need?: number;
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}
// Названия полей и правила проверки — чтобы ошибку сервера показать на языке пользователя.
export const FIELD_L: Record<string, string> = {
  name: 'Имя', email: 'Почта', companyName: 'Название компании', phone: 'Телефон', code: 'Код', bin: 'БИН', about: 'О компании', weight: 'Вес', volume: 'Объём',
  rate: 'Ставка', price: 'Цена', description: 'Описание', text: 'Текст', message: 'Сообщение', title: 'Заголовок', body: 'Текст', brand: 'Марка', plate: 'Госномер',
  points: 'Маршрут', dateFrom: 'Дата начала', dateTo: 'Дата окончания', reason: 'Причина', review: 'Отзыв', note: 'Комментарий', salary: 'Оплата', position: 'Должность',
  reply: 'Ответ', vehicle: 'Машина', experience: 'Стаж', rating: 'Оценка', cityId: 'Город', role: 'Роль', kind: 'Тип',
};
export const RULE_L: Record<string, string> = {
  required: 'обязательное поле', min_len: 'не короче {n} симв.', max_len: 'не длиннее {n} симв.', min: 'не меньше {n}', max: 'не больше {n}',
  email: 'проверьте адрес почты', invalid: 'недопустимое значение',
};
export async function api<T = any>(url: string, method = 'GET', body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api' + url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    // браузер не достучался до сервера: понятный текст вместо «Failed to fetch»
    throw new ApiError(0, 'offline', t('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз'));
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const known = data?.rule && FIELD_L[data.field] && RULE_L[data.rule];
    const e = new ApiError(res.status, data?.error || 'error', data?.tpl ? t(data.tpl, data.vars) : known ? `${t(FIELD_L[data.field])}: ${t(RULE_L[data.rule], { n: data.n })}` : data?.message || `Ошибка ${res.status}`);
    e.field = data?.field;
    e.need = data?.need;
    throw e;
  }
  return data as T;
}

/** Загрузка данных с перезапросом: const { data, reload } = useLoad(() => api('/x'), [deps]). */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async () => {
    const n = ++seq.current;
    try {
      const d = await fnRef.current();
      if (n === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e: any) {
      if (n === seq.current) setError(e.message);
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    setLoading(true);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, reload, setData };
}

// ---------- события сервера (SSE) ----------
type Handler = (data: any) => void;
const handlers = new Map<string, Set<Handler>>();
let source: EventSource | null = null;
export function connectEvents(on: boolean) {
  source?.close();
  source = null;
  if (!on) return;
  source = new EventSource('/api/events');
  for (const type of ['message', 'read', 'response', 'trip', 'position', 'notify']) {
    source.addEventListener(type, (e) => {
      const data = JSON.parse((e as MessageEvent).data || '{}');
      handlers.get(type)?.forEach((h) => h(data));
    });
  }
}
export function useEvent(types: string, handler: Handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const h: Handler = (d) => ref.current(d);
    const list = types.split(' ');
    for (const type of list) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(h);
    }
    return () => list.forEach((type) => handlers.get(type)?.delete(h));
  }, [types]);
}

// ---------- язык ----------
export type Lang = 'ru' | 'kz' | 'en' | 'zh';
const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const stored = read('lang');
let lang: Lang = stored === 'kz' || stored === 'en' || stored === 'zh' ? stored : 'ru';
export const getLang = () => lang;
export function storeLang(l: Lang) {
  lang = l;
  try {
    localStorage.setItem('lang', l);
  } catch {
    /* хранилище недоступно — язык действует до перезагрузки */
  }
  document.documentElement.lang = l === 'kz' ? 'kk' : l === 'zh' ? 'zh-CN' : l;
}
/** Перевод: ключ — русская строка; для казахского берётся словарь, иначе остаётся русский текст. */
export function t(s: string, vars?: Record<string, string | number>): string {
  let out = lang === 'kz' ? KZ[s] ?? s : lang === 'en' ? EN[s] ?? s : lang === 'zh' ? ZH[s] ?? s : s;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}

// ---------- справочники ----------
export const BODY_L: Record<string, string> = {
  tent: 'Тент', ref: 'Рефрижератор', isotherm: 'Изотерм', board: 'Бортовой', container: 'Контейнеровоз', tank: 'Цистерна',
  tipper: 'Самосвал', trawl: 'Трал', carrier: 'Автовоз', grain: 'Зерновоз', van: 'Фургон',
  jumbo: 'Джамбо', mega: 'Мега', coupling: 'Сцепка', allmetal: 'Цельнометаллический', platform: 'Площадка без бортов', open: 'Открытый',
  timber: 'Лесовоз', cattle: 'Скотовоз', cement: 'Цементовоз', gas: 'Газовоз', bitumen: 'Битумовоз', foodtank: 'Пищевая цистерна',
  chemtank: 'Химическая цистерна', crane: 'Манипулятор', tow: 'Эвакуатор', concrete: 'Бетоносмеситель', pickup: 'Пикап',
  minibus: 'Микроавтобус', bus: 'Автобус', tractor: 'Тягач',
};
export const FLAG_L: Record<string, string> = { tir: 'TIR', cmr: 'CMR', ekmt: 'ЕКМТ', t1: 'T1', customs: 'Нужен таможенный брокер' };
export const COUNTRY_L: Record<string, string> = {
  KZ: 'Казахстан', RU: 'Россия', UZ: 'Узбекистан', KG: 'Кыргызстан', CN: 'Китай', TJ: 'Таджикистан', TM: 'Туркменистан', BY: 'Беларусь',
  AZ: 'Азербайджан', GE: 'Грузия', AM: 'Армения', TR: 'Турция', MN: 'Монголия', IR: 'Иран', PL: 'Польша', DE: 'Германия', LT: 'Литва',
  LV: 'Латвия', UA: 'Украина', AF: 'Афганистан',
};
export const CARGO_L: Record<string, string> = {
  food: 'Продукты питания', building: 'Стройматериалы', equipment: 'Оборудование', consumer: 'Товары народного потребления',
  agro: 'Зерно и сельхозпродукция', metal: 'Металл', fuel: 'ГСМ и наливные', groupage: 'Сборный груз', adr: 'Опасный груз (ADR)',
  oversize: 'Негабарит', cars: 'Автомобили', furniture: 'Мебель', other: 'Другое',
};
export const LOADING_L: Record<string, string> = { top: 'Верхняя', rear: 'Задняя', full: 'С полной растентовкой', side: 'Боковая' };
export const PAY_L: Record<string, string> = { prepay: 'С предоплатой', cash: 'Наличными', card: 'На карту', cashless_vat: 'Безнал с НДС', cashless_novat: 'Безнал без НДС' };
export const ROLE_L: Record<string, string> = { customer: 'Заказчик', carrier: 'Перевозчик', logist: 'Логист', broker: 'Брокер', driver: 'Водитель' };
export const ROLE_HINT: Record<string, string> = {
  customer: 'Размещаю грузы и ищу транспорт', carrier: 'Размещаю транспорт и ищу грузы', logist: 'Свожу заказчиков и перевозчиков',
  broker: 'Оформляю таможню и документы', driver: 'Ищу работу или рейсы',
};
export const STAGE_L: Record<string, string> = {
  planned: 'Рейс назначен', to_loading: 'Еду на погрузку', loading: 'Погрузка', in_transit: 'В пути', unloading: 'Выгрузка', delivered: 'Доставлено',
};
// у перегона свои названия этапов: перегонщик едет к машине, принимает её, ведёт и сдаёт
export const RELOC_STAGE_L: Record<string, string> = {
  planned: 'Перегон назначен', to_loading: 'Еду к машине', loading: 'Приёмка машины', in_transit: 'В пути', unloading: 'Сдача машины', delivered: 'Машина сдана',
};
/** Название этапа рейса с учётом вида: у перегона — свои. */
export const stageLabel = (stage: string, kind?: string) => t((kind === 'relocation' ? RELOC_STAGE_L : STAGE_L)[stage] || stage);
export const KIND_L: Record<string, string> = { cargo: 'Груз', truck: 'Транспорт', relocation: 'Перегон' };
export const RELOC_VEHICLE_L: Record<string, string> = {
  car: 'Легковой автомобиль', truck: 'Грузовик или тягач', special: 'Спецтехника: погрузчик, трактор, экскаватор', bus: 'Автобус или микроавтобус', moto: 'Мотоцикл', other: 'Другое',
};
/** Категории прав: буквы одинаковы на всех языках, кроме удостоверения тракториста-машиниста. */
export const licenseLabel = (x: string) => (x === 'tractor' ? t('Тракторист-машинист') : x);
export const DOC_L: Record<string, string> = {
  id_card: 'Удостоверение личности', selfie: 'Фото с удостоверением в руках', registration: 'Свидетельство о регистрации', license: 'Лицензия', customs_license: 'Свидетельство таможенного представителя', driver_license: 'Водительские права', other: 'Другое',
};
export const CUR: Record<string, string> = { KZT: '₸', USD: '$', RUB: '₽' };
export const FILE_KIND_L: Record<string, string> = {
  photo: 'Фото груза', ttn: 'ТТН', cmr: 'CMR', act: 'Акт выполненных работ', invoice: 'Счёт', waybill: 'Путевой лист', other: 'Другой документ',
};

/**
 * Подготовить файл к отправке: фото с телефона уменьшаются до 2000 px и пересжимаются в JPEG —
 * так они весят в несколько раз меньше и быстрее уходят по мобильному интернету. PDF отправляется как есть.
 */
export async function prepareUpload(f: File): Promise<{ filename: string; mime: string; data: string }> {
  const asBase64 = (blob: Blob) => new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(new Error(t('Не удалось прочитать файл')));
    r.readAsDataURL(blob);
  });
  if (f.type.startsWith('image/') && f.type !== 'image/gif') {
    try {
      const img = await createImageBitmap(f);
      const k = Math.min(1, 2000 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * k);
      canvas.height = Math.round(img.height * k);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.82));
      if (blob && blob.size < f.size) return { filename: f.name.replace(/\.[^.]+$/, '') + '.jpg', mime: 'image/jpeg', data: await asBase64(blob) };
    } catch {
      /* браузер не умеет пересжимать этот формат — отправим как есть */
    }
  }
  if (f.size > 5 * 1024 * 1024) throw new Error(t('Файл больше 5 МБ'));
  return { filename: f.name, mime: f.type, data: await asBase64(f) };
}
export const opts = (keys: string[], labels: Record<string, string>) => keys.map((k) => ({ value: k, label: t(labels[k] || k) }));

/** Название места на текущем языке интерфейса. */
export const placeName = (c: City) => (lang === 'kz' ? c.kz : lang === 'en' ? c.en : lang === 'zh' ? c.zh : c.ru);

// ---------- форматирование ----------
// Казахские названия месяцев задаём сами: не во всех браузерах есть данные локали kk-KZ.
const KZ_MONTHS = ['қаң.', 'ақп.', 'нау.', 'сәу.', 'мам.', 'мау.', 'шіл.', 'там.', 'қыр.', 'қаз.', 'қар.', 'жел.'];
// в английском и китайском интерфейсе — «1,450,000» и «1.5», в русском и казахском — «1 450 000» и «1,5»
export const num = (n: number) => new Intl.NumberFormat(lang === 'en' || lang === 'zh' ? 'en-US' : 'ru-RU').format(n);
export const money = (n: number | null, cur = 'KZT') => (n == null ? t('Договорная') : `${num(n)} ${CUR[cur] || cur}`);
export function fmtDate(iso: string) {
  const d = new Date(iso);
  if (lang === 'kz') return `${d.getDate()} ${KZ_MONTHS[d.getMonth()]}`;
  if (lang === 'zh') return `${d.getMonth() + 1}月${d.getDate()}日`;
  return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'short' });
}
export const fmtDates = (a: string, b: string) => (a === b ? fmtDate(a) : `${fmtDate(a)} — ${fmtDate(b)}`);
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
export function fmtWhen(iso: string) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? fmtTime(iso) : `${fmtDate(iso)}, ${fmtTime(iso)}`;
}
/** Название компании с формой: «ТОО «Ромашка»», а у водителя без компании — просто имя. */
export const companyTitle = (c: { form?: string; name: string }) => (c.form ? `${c.form} «${c.name}»` : c.name);
/** Какое устройство у человека — чтобы подсказать путь к настройкам именно для него. */
export const deviceKind = (): 'ios' | 'android' | 'desktop' => {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
};
/** Дата и время всегда вместе — для этапов рейса и истории операций, где «02:17» без даты непонятно. */
export const fmtStamp = (iso: string) => `${fmtDate(iso)}, ${fmtTime(iso)}`;
export const waLink = (phone: string, text = '') => `https://wa.me/${phone.replace(/\D/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
export const todayStr = (plus = 0) => new Date(Date.now() + plus * 86400_000).toISOString().slice(0, 10);

// ---------- контекст приложения ----------
export interface AppCtx {
  me: Me | null;
  meta: Meta;
  cities: City[];
  lang: Lang;
  setLang: (l: Lang) => void;
  setMe: (m: Me | null) => void;
  reloadMe: () => Promise<void>;
  city: (id: string | null | undefined) => City | undefined;
  cityName: (id: string | null | undefined) => string;
  routeName: (points: string[]) => string;
  toast: (text: string, kind?: 'ok' | 'error') => void;
  /** Выполнить действие и показать ошибку, если она случилась. */
  act: (fn: () => Promise<unknown>, okText?: string) => Promise<boolean>;
}
export const Ctx = createContext<AppCtx>(null as unknown as AppCtx);
export const useApp = () => useContext(Ctx);
