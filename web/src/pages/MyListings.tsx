// «Мои грузы» и «Мои машины»: списки по статусам и размещение в 4 шага.
import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Archive, ArrowLeft, ArrowRight, Check, ChevronDown, Copy, Package, Pencil, Plus, RotateCcw, Trash2, Truck, Undo2, Users, Zap } from 'lucide-react';
import { api, BODY_L, CARGO_L, CUR, FLAG_L, fmtDates, fmtWhen, Listing, LOADING_L, money, num, opts, PAY_L, t, todayStr, useApp, useLoad } from '../core';
import { Chips, CitySelect, Empty, Field, Loading, Select, Tabs } from '../ui';
import { ListingCard } from '../listing';

type Kind = 'cargo' | 'truck';

export default function MyListings() {
  const k = useParams().kind;
  const kind = (k === 'truck' || k === 'relocation' ? k : 'cargo') as Kind | 'relocation';
  // заявки на перегон размещаются своей короткой формой в разделе «Перегон»
  const newUrl = kind === 'relocation' ? '/relocation/new' : `/my/${kind}/new`;
  const editUrl = (id: number) => (kind === 'relocation' ? `/relocation/${id}/edit` : `/my/${kind}/${id}/edit`);
  const { act, me, meta, reloadMe } = useApp();
  const nav = useNavigate();
  const [status, setStatus] = useState('active');
  const { data, loading, reload } = useLoad(() => api<Listing[]>(`/listings/mine?kind=${kind}`), [kind]);
  const by = (s: string) => (data || []).filter((l) => l.status === s);
  const setSt = async (l: Listing, s: string, ok: string) => (await act(() => api(`/listings/${l.id}/status`, 'POST', { status: s }), ok)) && reload();
  const pro = !!me?.company.pro;
  const boost = async (l: Listing) => {
    const ask = pro
      ? t('Поднять объявление в топ на 24 часа? Это входит в тариф Pro.')
      : t('Поднять объявление в топ на 24 часа за {n} ₸ с баланса компании? Деньги списываются сразу и не возвращаются, если закрыть объявление раньше.', { n: meta.boostPrice });
    if (!confirm(ask)) return;
    if (await act(() => api(`/listings/${l.id}/boost`, 'POST'), t('Объявление поднято в топ'))) {
      reload();
      reloadMe();
    }
  };
  const close = (l: Listing) => {
    if (!confirm(t('Закрыть объявление? Оно пропадёт из поиска, а отклики без ответа будут отклонены. Вернуть его можно на вкладке «Закрытые».'))) return;
    setSt(l, 'closed', t('Объявление закрыто'));
  };
  const repeat = (l: Listing) => nav(`${newUrl}?copy=${l.id}`);

  return (
    <div className="stack">
      <div className="page-head">
        <Tabs
          items={[{ value: 'cargo', label: t('Мои грузы') }, { value: 'truck', label: t('Мои машины') }, { value: 'relocation', label: t('Мои перегоны') }]}
          value={kind}
          onChange={(v) => nav(`/my/${v}`)}
        />
        <Link to={newUrl} className="btn primary"><Plus size={17} /> {kind === 'cargo' ? t('Разместить груз') : kind === 'truck' ? t('Разместить транспорт') : t('Заказать перегон')}</Link>
      </div>
      <Tabs
        items={[
          { value: 'active', label: t('Активные'), count: by('active').length },
          { value: 'closed', label: t('Закрытые'), count: by('closed').length },
          { value: 'archived', label: t('Архив'), count: by('archived').length + by('removed').length },
        ]}
        value={status}
        onChange={setStatus}
      />
      {loading ? <Loading /> : (
        <div className="list">
          {(status === 'archived' ? [...by('removed'), ...by('archived')] : by(status)).map((l) => (
            <ListingCard
              key={l.id}
              l={l}
              onChange={reload}
              footer={
                <div className="my-actions">
                  {l.status === 'active' && (
                    <>
                      <Link to={`/listing/${l.id}`} className="btn soft"><Users size={16} /> {t('Отклики')}{l.responsesCount > 0 && <span className="badge inline">{l.responsesCount}</span>}</Link>
                      {l.tripId ? (
                        <Link to={`/trip/${l.tripId}`} className="btn primary">{t('Открыть рейс')}</Link>
                      ) : (
                        <Link to={editUrl(l.id)} className="btn soft"><Pencil size={16} /> {t('Изменить')}</Link>
                      )}
                      <button type="button" className="btn soft" onClick={() => repeat(l)}><Copy size={16} /> {t('Разместить снова')}</button>
                      {!l.tripId && <button type="button" className="btn ghost" onClick={() => close(l)}><Check size={16} /> {t('Закрыть')}</button>}
                      {!l.tripId && !l.boosted && (
                        <button type="button" className="btn boost" onClick={() => boost(l)}>
                          <Zap size={16} /> {t('В топ')} <span className="boost-price">{pro ? 'Pro' : `${num(meta.boostPrice)} ₸`}</span>
                        </button>
                      )}
                      {l.boostedUntil && <span className="muted small"><Zap size={13} /> {t('В топе до {d}', { d: fmtWhen(l.boostedUntil) })}</span>}
                    </>
                  )}
                  {l.status === 'closed' && (
                    <>
                      {/* сервер не вернёт в активные объявление с истёкшим сроком — для него остаётся «Разместить снова» */}
                      {l.dateTo >= todayStr() && (
                        <button type="button" className="btn soft" onClick={() => setSt(l, 'active', t('Объявление снова активно'))}><Undo2 size={16} /> {t('Вернуть в активные')}</button>
                      )}
                      <button type="button" className="btn soft" onClick={() => repeat(l)}><RotateCcw size={16} /> {t('Разместить снова')}</button>
                      <button type="button" className="btn ghost" onClick={() => setSt(l, 'archived', t('Перенесено в архив'))}><Archive size={16} /> {t('В архив')}</button>
                    </>
                  )}
                  {l.status === 'archived' && <button type="button" className="btn soft" onClick={() => repeat(l)}><RotateCcw size={16} /> {t('Разместить снова')}</button>}
                  {l.status === 'removed' && <span className="status declined">{t('Снято модератором')}</span>}
                </div>
              }
            />
          ))}
          {(status === 'archived' ? by('archived').length + by('removed').length : by(status).length) === 0 && (
            <div className="card">
              <Empty
                icon={kind === 'cargo' ? <Package size={26} /> : <Truck size={26} />}
                title={status === 'active' ? (kind === 'cargo' ? t('У вас нет активных грузов') : kind === 'truck' ? t('У вас нет активного транспорта') : t('У вас нет активных заявок на перегон')) : t('Здесь пока пусто')}
                text={status === 'active' ? (kind === 'relocation' ? t('Нужно перегнать машину или технику своим ходом? Оформите заявку — перегонщики рядом получат уведомление.') : t('Разместите объявление — это занимает четыре коротких шага.')) : status === 'closed' ? t('Сюда попадают выполненные, истёкшие и закрытые вами объявления. Их можно разместить снова.') : t('Архив хранит историю закрытых объявлений.')}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- размещение: 4 шага ----------
interface Form {
  points: (string | null)[]; brand: string; bodyType: string | null; cargoType: string | null; weight: string; volume: string; loading: string[];
  adrClass: string; flags: string[];
  dateFrom: string; dateTo: string; payTerms: string[]; withRate: boolean; rate: string; currency: string; description: string;
  trucks: string; loadAddress: string; unloadAddress: string; loadTime: string;
}
const empty = (): Form => ({
  points: [null, null], brand: '', bodyType: null, cargoType: null, weight: '', volume: '', loading: [], adrClass: '', flags: [],
  dateFrom: todayStr(), dateTo: todayStr(7), payTerms: [], withRate: true, rate: '', currency: 'KZT', description: '',
  trucks: '1', loadAddress: '', unloadAddress: '', loadTime: '',
});
const fromListing = (l: Listing, keepDates: boolean): Form => ({
  points: l.points, brand: l.brand, bodyType: l.bodyType, cargoType: l.cargoType, weight: l.weight?.toString() || '', volume: l.volume?.toString() || '',
  loading: l.loading, adrClass: l.adrClass ? String(l.adrClass) : '', flags: l.flags || [],
  dateFrom: keepDates ? l.dateFrom : todayStr(), dateTo: keepDates ? l.dateTo : todayStr(7), payTerms: l.payTerms,
  withRate: l.rate != null, rate: l.rate?.toString() || '', currency: l.currency, description: l.description,
  trucks: String(l.trucks || 1), loadAddress: l.loadAddress || '', unloadAddress: l.unloadAddress || '', loadTime: l.loadTime || '',
});

// Пределы — те же, что проверяет сервер (server/routes/listings.js).
const MAX_WEIGHT = 500;
const MAX_VOLUME = 1000;
const MAX_RATE = 1e9;
const MAX_DAYS = 180;
/** Число из поля ввода: пусто — null, «1,5» — 1.5, не число — NaN. */
const toNum = (s: string) => {
  const x = s.replace(/\s+/g, '').replace(',', '.');
  return x === '' ? null : /^\d+(\.\d+)?$/.test(x) ? Number(x) : NaN;
};
const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

type FieldKey = 'brand' | 'bodyType' | 'weight' | 'volume' | 'dateFrom' | 'dateTo' | 'rate' | 'trucks' | 'adrClass';
const MAX_TRUCKS = 50;
/** Ошибки по полям: показываются под полем на том шаге, где оно вводится. */
function validate(f: Form, kind: Kind, isNew: boolean) {
  const e: Partial<Record<FieldKey, string>> = {};
  const points = f.points.map((p, i) => (!p ? t('Выберите город из списка') : i > 0 && p === f.points[i - 1] ? t('Этот пункт совпадает с предыдущим') : ''));
  if (kind === 'truck' && !f.brand.trim()) e.brand = t('Укажите марку транспорта');
  if (kind === 'truck' && !f.bodyType) e.bodyType = t('Выберите тип кузова');
  const w = toNum(f.weight);
  if (w === null) e.weight = kind === 'cargo' ? t('Укажите вес груза в тоннах') : t('Укажите грузоподъёмность в тоннах');
  else if (isNaN(w)) e.weight = t('Введите число, например 20 или 1,5');
  else if (w <= 0) e.weight = t('Вес должен быть больше нуля');
  else if (w > MAX_WEIGHT) e.weight = t('Вес указывается в тоннах — не больше {n} т', { n: MAX_WEIGHT });
  const v = toNum(f.volume);
  if (v !== null) {
    if (isNaN(v)) e.volume = t('Введите число, например 20 или 1,5');
    else if (v <= 0) e.volume = t('Объём должен быть больше нуля');
    else if (v > MAX_VOLUME) e.volume = t('Объём — не больше {n} м³', { n: MAX_VOLUME });
  }
  if (kind === 'cargo' && f.cargoType === 'adr' && !f.adrClass) e.adrClass = t('Для опасного груза укажите класс ADR');
  if (kind === 'cargo') {
    const n = toNum(f.trucks);
    if (n === null || isNaN(n) || !Number.isInteger(n) || n < 1) e.trucks = t('Укажите число машин, например 1 или 3');
    else if (n > MAX_TRUCKS) e.trucks = t('Не больше {n} машин в одном объявлении', { n: MAX_TRUCKS });
  }
  const today = todayStr();
  const last = todayStr(MAX_DAYS);
  if (!f.dateFrom) e.dateFrom = t('Укажите дату начала');
  else if (isNew && f.dateFrom < today) e.dateFrom = t('Эта дата уже прошла');
  else if (f.dateFrom > last) e.dateFrom = t('Период размещения — не дальше полугода, до {d}', { d: dmy(last) });
  if (!f.dateTo) e.dateTo = t('Укажите дату окончания');
  else if (f.dateTo < today) e.dateTo = t('Эта дата уже прошла');
  else if (f.dateFrom && f.dateTo < f.dateFrom) e.dateTo = t('Дата окончания раньше даты начала');
  else if (f.dateTo > last) e.dateTo = t('Период размещения — не дальше полугода, до {d}', { d: dmy(last) });
  if (f.withRate) {
    const r = f.rate.replace(/\s+/g, '');
    if (!r) e.rate = t('Введите сумму ставки или выберите «Без ставки»');
    else if (!/^\d+$/.test(r)) e.rate = t('Сумма — целое число без копеек, например 350000');
    else if (Number(r) <= 0) e.rate = t('Введите сумму ставки или выберите «Без ставки»');
    else if (Number(r) > MAX_RATE) e.rate = t('Слишком большая сумма');
  }
  return { points, ...e };
}

// На каком шаге вводится поле, которое отклонил сервер.
const FIELD_STEP: Record<string, number> = {
  points: 0, loadAddress: 0, unloadAddress: 0, loadTime: 0, brand: 1, bodyType: 1, cargoType: 1, weight: 1, volume: 1, loading: 1, adrClass: 1, flags: 1, trucks: 1,
  dateFrom: 2, dateTo: 2, payTerms: 2, rate: 2, currency: 2, description: 3,
};
function stepOfError(e: { field?: string; message?: string }) {
  if (e.field && e.field in FIELD_STEP) return FIELD_STEP[e.field];
  const m = (e.message || '').toLowerCase();
  if (/маршрут|пункт|город|points/.test(m)) return 0;
  if (/вес|объ[её]м|кузов|марк|weight|volume|brand|bodytype|cargotype|loading|adr|flags/.test(m)) return 1;
  if (/дат|период|срок|ставк|сумм|валют|оплат|date|rate|currency|payterms/.test(m)) return 2;
  if (/описани|description/.test(m)) return 3;
  return -1;
}

// Черновик хранится на устройстве, отдельно для груза и транспорта, и стирается после размещения.
const DRAFT_DAYS = 30;
function loadDraft(key: string): Record<string, unknown> | null {
  try {
    const d = JSON.parse(localStorage.getItem(key) || 'null');
    return d && typeof d.f === 'object' && d.f && Date.now() - Number(d.at) < DRAFT_DAYS * 86400_000 ? d.f : null;
  } catch {
    return null; // хранилище недоступно или запись испорчена — начинаем с чистой формы
  }
}
function saveDraft(key: string, f: Form | null) {
  try {
    if (f) localStorage.setItem(key, JSON.stringify({ f, at: Date.now() }));
    else localStorage.removeItem(key);
  } catch {
    /* хранилище недоступно — форма работает без черновика */
  }
}

/** Поле формы: отметка обязательного или необязательного, ошибка под полем вместо подсказки. */
function F({ label, req, opt, error, errId, hint, children }: { label: string; req?: boolean; opt?: boolean; error?: string; errId?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {req && <span className="req" aria-hidden="true"> *</span>}
        {opt && <span className="opt"> · {t('необязательно')}</span>}
      </span>
      {children}
      {error ? <span className="field-error" id={errId}>{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function ListingForm() {
  const params = useParams();
  const kind = (params.kind === 'truck' ? 'truck' : 'cargo') as Kind;
  const editId = params.id ? Number(params.id) : null;
  const loc = useLocation();
  const query = new URLSearchParams(loc.search);
  const copyId = editId ? null : query.get('copy');
  const { meta, toast, cityName, city, me } = useApp();
  const nav = useNavigate();
  const [base, setBase] = useState<Form | null>(null); // с чего форма началась; null — ещё загружается
  const [f, setF] = useState<Form>(empty);
  const [restored, setRestored] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState<Record<number, boolean>>({});
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [serverErr, setServerErr] = useState<{ step: number; text: string; duplicate?: boolean } | null>(null);
  const [extraOpen, setExtraOpen] = useState<boolean | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const gone = useRef(false); // форму покидают — черновик больше не пишем
  const vehicles = useLoad(() => (kind === 'truck' ? api<any[]>('/vehicles') : Promise.resolve([])), [kind]);
  const set = (patch: Partial<Form>) => {
    setF((x) => ({ ...x, ...patch }));
    setServerErr(null);
  };
  const draftKey = `jolda.draft.${kind}${editId ? `.edit${editId}` : copyId ? `.copy${copyId}` : ''}`;
  const listUrl = `/my/${kind}`;

  /** Черновик из хранилища приводим к виду формы: чужие и устаревшие значения отбрасываем. */
  const fromDraft = (d: Record<string, any>, b: Form): Form => {
    const str = (v: unknown, fb: string) => (typeof v === 'string' ? v : fb);
    const arr = (v: unknown, allowed: string[]) => (Array.isArray(v) ? v.filter((x) => allowed.includes(x)) : []);
    const one = (v: unknown, allowed: string[]) => (typeof v === 'string' && allowed.includes(v) ? v : null);
    const date = (v: unknown, fb: string) => (typeof v === 'string' && (v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : fb);
    let points: (string | null)[] = Array.isArray(d.points) ? d.points.slice(0, 8).map((p: unknown) => (typeof p === 'string' && city(p) ? p : null)) : b.points;
    if (points.length < 2) points = b.points;
    let dateFrom = date(d.dateFrom, b.dateFrom);
    let dateTo = date(d.dateTo, b.dateTo);
    if (!editId) {
      // черновик мог пролежать несколько дней: прошедшие даты сдвигаем на сегодня
      const today = todayStr();
      if (dateFrom && dateFrom < today) dateFrom = today;
      if (dateTo && dateTo < dateFrom) dateTo = dateFrom > todayStr(7) ? dateFrom : todayStr(7);
    }
    return {
      points, brand: str(d.brand, b.brand).slice(0, 60), bodyType: one(d.bodyType, meta.body), cargoType: one(d.cargoType, meta.cargo),
      weight: str(d.weight, b.weight), volume: str(d.volume, b.volume), loading: arr(d.loading, meta.loading),
      adrClass: /^[1-9]$/.test(str(d.adrClass, '')) ? d.adrClass : '', flags: arr(d.flags, meta.flags),
      dateFrom, dateTo, payTerms: arr(d.payTerms, meta.pay), withRate: typeof d.withRate === 'boolean' ? d.withRate : b.withRate,
      rate: str(d.rate, b.rate), currency: one(d.currency, meta.currencies) || b.currency, description: str(d.description, b.description).slice(0, 2000),
      trucks: str(d.trucks, b.trucks).slice(0, 3), loadAddress: str(d.loadAddress, b.loadAddress).slice(0, 200), unloadAddress: str(d.unloadAddress, b.unloadAddress).slice(0, 200),
      loadTime: str(d.loadTime, b.loadTime).slice(0, 40),
    };
  };

  useEffect(() => {
    let off = false;
    gone.current = false;
    setBase(null);
    const init = (b: Form) => {
      if (off) return;
      const d = loadDraft(draftKey);
      const start = d ? fromDraft(d, b) : b;
      setBase(b);
      setF(start);
      setRestored(!!d && JSON.stringify(start) !== JSON.stringify(b));
      setTried({});
      setTouched({});
      setServerErr(null);
      setExtraOpen(null);
    };
    const src = editId || copyId;
    if (!src) init(empty());
    else api<Listing>(`/listings/${src}`).then((l) => {
      // чужое объявление редактировать нельзя — не показываем форму, которую потом не сохранить
      if (editId && l.company.id !== me?.company.id) {
        toast(t('Это не ваше объявление'), 'error');
        return !off && nav(listUrl, { replace: true });
      }
      init(fromListing(l, !!editId));
    }).catch(() => !off && nav(listUrl, { replace: true }));
    return () => {
      off = true;
    };
  }, [draftKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = !!base && JSON.stringify(f) !== JSON.stringify(base);
  useEffect(() => {
    if (base && !gone.current) saveDraft(draftKey, dirty ? f : null);
  }, [f, base]); // eslint-disable-line react-hooks/exhaustive-deps

  const pts = f.points.filter(Boolean) as string[];
  const errs = validate(f, kind, !editId);
  const stepBad = [
    errs.points.some(Boolean),
    !!(errs.brand || errs.bodyType || errs.weight || errs.volume || errs.trucks || errs.adrClass),
    !!(errs.dateFrom || errs.dateTo || errs.rate),
    false,
  ];
  const km = pts.length === f.points.length && pts.length > 1
    ? Math.round(pts.slice(1).reduce((s, p, i) => s + dist(city(pts[i])!, city(p)!), 0) * 1.22)
    : 0;

  // ---- шаги: каждый — запись в истории браузера, «Назад» возвращает на предыдущий ----
  const depth: number = (loc.state as { jf?: number } | null)?.jf ?? 0; // сколько предыдущих шагов лежит в истории прямо за этим
  const urlStep = Math.min(3, Math.max(0, (Number(query.get('step')) || 1) - 1));
  const firstBad = stepBad.findIndex(Boolean);
  // дальше первого шага с ошибкой не пускаем: например, после перезагрузки без черновика или перехода «Вперёд»
  const step = firstBad >= 0 ? Math.min(urlStep, firstBad) : urlStep;
  const stepUrl = (i: number) => {
    const q = new URLSearchParams(loc.search);
    if (i > 0) q.set('step', String(i + 1));
    else q.delete('step');
    const s = q.toString();
    return loc.pathname + (s ? `?${s}` : '');
  };
  const go = (i: number) => {
    if (i === urlStep) return;
    if (i === urlStep + 1) nav(stepUrl(i), { state: { jf: depth + 1 } });
    else if (i < urlStep && depth >= urlStep - i) nav(i - urlStep);
    else nav(stepUrl(i), { replace: true, state: { jf: 0 } });
  };
  useEffect(() => {
    if (!base || step === urlStep) return;
    setTried((x) => ({ ...x, [step]: true }));
    nav(stepUrl(step), { replace: true, state: { jf: 0 } });
  }, [base, step, urlStep]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (base) window.scrollTo(0, 0);
  }, [step, !base]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Уйти из формы к списку так, чтобы «Назад» в браузере не возвращал на её шаги. */
  const leave = () => {
    gone.current = true;
    if (depth > 0) {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        window.removeEventListener('popstate', finish);
        nav(listUrl, { replace: true });
      };
      window.addEventListener('popstate', finish);
      setTimeout(finish, 400); // на случай, если браузер не сообщит о переходе
      nav(-depth);
    } else nav(listUrl, { replace: true });
  };
  const cancel = () => {
    if (dirty && !confirm(t('Закрыть форму? Всё, что вы ввели, будет удалено.'))) return;
    saveDraft(draftKey, null);
    leave();
  };
  const startOver = () => {
    if (!base || !confirm(t('Очистить форму? Всё, что вы ввели, будет удалено.'))) return;
    setF(base);
    setRestored(false);
    setTried({});
    setTouched({});
    setServerErr(null);
    saveDraft(draftKey, null);
    go(0);
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setServerErr(null);
    const body = {
      kind, points: pts, brand: f.brand, bodyType: f.bodyType, cargoType: kind === 'cargo' ? f.cargoType : null, weight: toNum(f.weight), volume: toNum(f.volume),
      loading: f.loading, adrClass: f.adrClass ? Number(f.adrClass) : null, flags: f.flags, dateFrom: f.dateFrom, dateTo: f.dateTo, payTerms: f.payTerms,
      rate: f.withRate ? Number(f.rate.replace(/\s+/g, '')) : null, currency: f.currency, description: f.description,
      trucks: kind === 'cargo' ? Number(toNum(f.trucks)) || 1 : 1,
      loadAddress: kind === 'cargo' ? f.loadAddress.trim() : '', unloadAddress: kind === 'cargo' ? f.unloadAddress.trim() : '', loadTime: kind === 'cargo' ? f.loadTime.trim() : '',
    };
    try {
      await (editId ? api(`/listings/${editId}`, 'PUT', body) : api('/listings', 'POST', body));
    } catch (e: any) {
      const text = t(e.message);
      const at = e.code === 'validation' ? stepOfError(e) : -1;
      setServerErr({ step: at >= 0 ? at : 3, text, duplicate: e.code === 'duplicate' });
      if (e.code !== 'duplicate') toast(text, 'error');
      if (at >= 0) {
        setTried((x) => ({ ...x, [at]: true }));
        go(at); // возвращаем на шаг, где это поле вводится
      }
      setBusy(false);
      return;
    }
    gone.current = true;
    saveDraft(draftKey, null);
    toast(editId ? t('Изменения сохранены') : t('Объявление размещено'));
    leave();
  };

  const next = () => {
    if (!stepBad[step]) return go(step + 1);
    setTried((x) => ({ ...x, [step]: true }));
    // после отрисовки ошибок ставим курсор в первое поле с ошибкой
    setTimeout(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (step < 3) next();
    else if (!stepBad.some(Boolean)) save();
  };

  const steps = [t('Маршрут'), kind === 'cargo' ? t('Груз') : t('Машина'), t('Даты и оплата'), t('Описание')];
  if (!base) return <Loading />;

  const shown = (k: FieldKey) => (tried[step] || touched[k] ? errs[k] : undefined);
  const touch = (k: FieldKey) => () => setTouched((x) => (x[k] ? x : { ...x, [k]: true }));
  /** Свойства поля ввода: отметка об ошибке и связь с её текстом. */
  const inv = (k: FieldKey) => ({ 'aria-invalid': shown(k) ? true : undefined, 'aria-describedby': shown(k) ? `lf-${k}-err` : undefined, onBlur: touch(k) });
  const intl = pts.some((p) => city(p)?.country !== 'KZ');
  const docFlags = meta.flags.filter((x) => x !== 'customs');
  const extraCount = (f.adrClass ? 1 : 0) + f.flags.length;
  const extraIsOpen = extraOpen ?? (extraCount > 0 || intl || f.cargoType === 'adr');

  return (
    <div className="narrow stack">
      <h1 className="page-title">{editId ? t('Изменить объявление') : kind === 'cargo' ? t('Разместить груз') : t('Разместить транспорт')}</h1>
      <ol className="stepper">
        {steps.map((s, i) => (
          <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>
            <button type="button" disabled={i > step && !(editId && !stepBad.slice(0, i).some(Boolean))} aria-current={i === step ? 'step' : undefined} aria-label={t('Шаг {n} из 4: {s}', { n: i + 1, s })} onClick={() => go(i)}>
              <span className="step-n">{i < step ? <Check size={14} /> : i + 1}</span>
              <span className="step-l">{s}</span>
            </button>
          </li>
        ))}
      </ol>

      {restored && (
        <div className="info-line draft-note">
          <span>{t('Мы восстановили несохранённый черновик.')}</span>
          <button type="button" className="link" onClick={startOver}>{t('Очистить форму')}</button>
        </div>
      )}

      <form className="card form" ref={formRef} onSubmit={submit} noValidate>
        {step === 0 && (
          <>
            <p className="muted">
              {kind === 'cargo'
                ? t('Откуда и куда везти груз. «Добавить пункт» — город, где водителю нужно оставить часть груза.')
                : t('Откуда и куда едет машина. «Добавить пункт» — промежуточный город, где водитель будет останавливаться.')}
            </p>
            {f.points.map((p, i) => (
              <Field key={i} label={i === 0 ? t('Откуда') : i === f.points.length - 1 ? t('Куда') : t('Промежуточный пункт')}>
                <div className="row">
                  <CitySelect value={p} error={tried[0] ? errs.points[i] : undefined} onChange={(id) => set({ points: f.points.map((x, k) => (k === i ? id : x)) })} />
                  {i > 0 && i < f.points.length - 1 && (
                    <button type="button" className="icon-btn" aria-label={t('Удалить пункт')} onClick={() => set({ points: f.points.filter((_, k) => k !== i) })}><Trash2 size={18} /></button>
                  )}
                </div>
              </Field>
            ))}
            {f.points.length < 8 && (
              <button type="button" className="btn soft" onClick={() => set({ points: [...f.points.slice(0, -1), null, f.points[f.points.length - 1]] })}>
                <Plus size={16} /> {t('Добавить пункт')}
              </button>
            )}
            {km > 0 && <div className="info-line">{t('Расстояние по маршруту: ~{n} км', { n: num(km) })}</div>}
            {kind === 'cargo' && (
              <details className="opt-block" open={!!(f.loadAddress || f.unloadAddress || f.loadTime)}>
                <summary>
                  <span className="opt-title">{t('Адреса и время погрузки')}</span>
                  <span className="opt-note">{t('необязательно — водитель увидит их в рейсе')}</span>
                </summary>
                <div className="opt-body">
                  <F label={t('Адрес погрузки')} opt>
                    <input value={f.loadAddress} onChange={(e) => set({ loadAddress: e.target.value })} maxLength={200} placeholder={t('Улица, дом, склад или ориентир')} />
                  </F>
                  <F label={t('Адрес выгрузки')} opt>
                    <input value={f.unloadAddress} onChange={(e) => set({ unloadAddress: e.target.value })} maxLength={200} placeholder={t('Улица, дом, склад или ориентир')} />
                  </F>
                  <F label={t('Время погрузки')} opt>
                    <input value={f.loadTime} onChange={(e) => set({ loadTime: e.target.value })} maxLength={40} placeholder={t('Например: 9:00–13:00')} />
                  </F>
                </div>
              </details>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <p className="muted small"><span className="req">*</span> {t('— обязательные поля')}</p>
            {kind === 'truck' && (
              <>
                {vehicles.data && vehicles.data.length > 0 && (
                  <Field label={t('Взять из «Мои машины»')}>
                    <Select
                      value=""
                      placeholder={t('Выберите машину из парка')}
                      onChange={(id) => {
                        const v = vehicles.data!.find((x) => String(x.id) === id);
                        if (v) set({ brand: v.brand, bodyType: v.bodyType, weight: v.weight?.toString() || '', volume: v.volume?.toString() || '', loading: v.loading });
                      }}
                      options={vehicles.data.map((v) => ({ value: String(v.id), label: `${v.brand}${v.plate ? ` · ${v.plate}` : ''}` }))}
                    />
                  </Field>
                )}
                <F label={t('Марка транспорта')} req error={shown('brand')} errId="lf-brand-err">
                  <input value={f.brand} onChange={(e) => set({ brand: e.target.value })} placeholder="Volvo FH, DAF XF, КамАЗ…" maxLength={60} aria-required="true" {...inv('brand')} />
                </F>
              </>
            )}
            {kind === 'cargo' && (
              <F label={t('Сколько машин нужно')} req error={shown('trucks')} errId="lf-trucks-err" hint={t('Если груз везут несколько машин — по каждой будет отдельный рейс')}>
                <input inputMode="numeric" value={f.trucks} onChange={(e) => set({ trucks: e.target.value.replace(/\D/g, '') })} maxLength={2} aria-required="true" {...inv('trucks')} />
              </F>
            )}
            {kind === 'cargo' && (
              <F label={t('Тип груза')} opt>
                <Select value={f.cargoType || ''} onChange={(v) => set({ cargoType: v || null })} placeholder={t('Не выбран')} options={opts(meta.cargo, CARGO_L)} />
              </F>
            )}
            <F label={kind === 'cargo' ? t('Нужный тип кузова') : t('Тип кузова')} req={kind === 'truck'} opt={kind === 'cargo'} error={shown('bodyType')} errId="lf-bodyType-err">
              <div className="select">
                <select value={f.bodyType || ''} onChange={(e) => set({ bodyType: e.target.value || null })} aria-required={kind === 'truck' ? 'true' : undefined} {...inv('bodyType')}>
                  <option value="">{kind === 'cargo' ? t('Любой') : t('Не выбран')}</option>
                  {opts(meta.body, BODY_L).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <ChevronDown size={16} />
              </div>
            </F>
            <div className="grid2 lf-pair">
              <F label={kind === 'cargo' ? t('Вес, т') : t('Грузоподъёмность, т')} req error={shown('weight')} errId="lf-weight-err">
                <input inputMode="decimal" value={f.weight} onChange={(e) => set({ weight: e.target.value })} placeholder="20" maxLength={12} aria-required="true" {...inv('weight')} />
              </F>
              <F label={t('Объём, м³')} opt error={shown('volume')} errId="lf-volume-err">
                <input inputMode="decimal" value={f.volume} onChange={(e) => set({ volume: e.target.value })} placeholder="82" maxLength={12} {...inv('volume')} />
              </F>
            </div>
            <div className="field">
              <span className="field-label">{kind === 'cargo' ? t('Тип загрузки — какая нужна') : t('Тип загрузки — по устройству машины')}<span className="opt"> · {t('необязательно')}</span></span>
              <Chips options={opts(meta.loading, LOADING_L)} value={f.loading} onChange={(v) => set({ loading: v })} />
            </div>
            <details className="opt-block" open={extraIsOpen} onToggle={(e) => setExtraOpen(e.currentTarget.open)}>
              <summary>
                <span className="opt-title">{t('Опасный груз и международные документы')}{extraCount > 0 && <span className="badge inline">{extraCount}</span>}</span>
                <span className="opt-note">{t('необязательно — для опасных грузов и международных рейсов')}</span>
              </summary>
              <div className="opt-body">
                <Field label={kind === 'cargo' ? t('Опасный груз (ADR)') : t('Допуск к опасным грузам (ADR)')}>
                  <Select value={f.adrClass} onChange={(v) => set({ adrClass: v })} placeholder={kind === 'cargo' ? t('Груз не опасный') : t('Нет допуска')}
                    options={[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ value: String(n), label: t('Класс {n}', { n }) }))} />
                  {errs.adrClass && (tried[1] || f.cargoType === 'adr') && <span className="field-error">{errs.adrClass}</span>}
                </Field>
                <div className="field">
                  <span className="field-label">{kind === 'cargo' ? t('Документы, которые нужны для рейса') : t('Документы, которые есть у перевозчика')}</span>
                  <Chips options={opts(docFlags, FLAG_L)} value={f.flags.filter((x) => x !== 'customs')} onChange={(v: string[]) => set({ flags: [...v, ...f.flags.filter((x) => x === 'customs')] })} />
                  <span className="field-hint">{t('Для международных рейсов: CMR — накладная, TIR — книжка МДП, ЕКМТ — разрешение, T1 — транзитная декларация.')}</span>
                </div>
                {meta.flags.includes('customs') && (
                  <label className="switch">
                    <input type="checkbox" checked={f.flags.includes('customs')} onChange={(e) => set({ flags: e.target.checked ? [...f.flags, 'customs'] : f.flags.filter((x) => x !== 'customs') })} />
                    <span>{t(FLAG_L.customs)}</span>
                  </label>
                )}
              </div>
            </details>
          </>
        )}

        {step === 2 && (
          <>
            <div className="grid2 lf-pair">
              <F label={t('Дата с')} req error={shown('dateFrom')} errId="lf-dateFrom-err">
                <input type="date" value={f.dateFrom} min={editId ? undefined : todayStr()} max={todayStr(MAX_DAYS)} onChange={(e) => set({ dateFrom: e.target.value })} aria-required="true" {...inv('dateFrom')} />
              </F>
              <F label={t('Дата по')} req error={shown('dateTo')} errId="lf-dateTo-err">
                <input type="date" value={f.dateTo} min={f.dateFrom > todayStr() ? f.dateFrom : todayStr()} max={todayStr(MAX_DAYS)} onChange={(e) => set({ dateTo: e.target.value })} aria-required="true" {...inv('dateTo')} />
              </F>
            </div>
            <div className="field">
              <span className="field-label">{t('Ставка')}</span>
              <Chips
                options={[{ value: 'rate', label: t('Со ставкой') }, { value: 'none', label: t('Без ставки') }]}
                value={f.withRate ? 'rate' : 'none'}
                onChange={(v) => v && set({ withRate: v === 'rate' })}
              />
            </div>
            {f.withRate && (
              <div className="grid2 lf-pair">
                <F
                  label={t('Сумма')}
                  req
                  error={shown('rate')}
                  errId="lf-rate-err"
                  hint={km > 0 && !errs.rate && f.currency === 'KZT' ? `≈ ${num(Math.round(Number(f.rate.replace(/\s+/g, '')) / km))} ₸/${t('км')}` : t('Целое число, без копеек')}
                >
                  <input inputMode="numeric" value={f.rate} onChange={(e) => set({ rate: e.target.value.replace(/[^\d\s.,-]/g, '') })} placeholder="350000" maxLength={14} aria-required="true" {...inv('rate')} />
                </F>
                <Field label={t('Валюта')}>
                  <Select value={f.currency} onChange={(v) => set({ currency: v })} options={meta.currencies.map((c) => ({ value: c, label: `${c} (${CUR[c]})` }))} />
                </Field>
              </div>
            )}
            <div className="field">
              <span className="field-label">{t('Условия оплаты')}<span className="opt"> · {t('необязательно')}</span></span>
              <Chips options={opts(meta.pay, PAY_L)} value={f.payTerms} onChange={(v) => set({ payTerms: v })} />
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <Field label={t('Описание (необязательно)')}>
              <textarea rows={4} value={f.description} onChange={(e) => set({ description: e.target.value })} maxLength={2000}
                placeholder={kind === 'cargo' ? t('Упаковка, количество мест, особые условия погрузки…') : t('Состояние машины, документы, готовность взять догруз…')} />
            </Field>
            <div className="summary">
              <b>{pts.map(cityName).join(' → ')}</b>
              <span>{num(km)} {t('км')} · {fmtDates(f.dateFrom, f.dateTo)}{kind === 'cargo' && Number(f.trucks) > 1 ? ` · ${t('Нужно машин: {n}', { n: f.trucks })}` : ''}</span>
              {kind === 'cargo' && (f.loadAddress || f.unloadAddress) && <span>{[f.loadAddress, f.unloadAddress].filter(Boolean).join(' → ')}{f.loadTime ? ` · ${f.loadTime}` : ''}</span>}
              <span>
                {[kind === 'truck' ? f.brand : f.cargoType && t(CARGO_L[f.cargoType]), f.bodyType && t(BODY_L[f.bodyType]), f.weight && `${f.weight} ${t('т')}`, f.volume && `${f.volume} ${t('м³')}`,
                  ...f.loading.map((x) => t(LOADING_L[x])), f.adrClass && `ADR ${f.adrClass}`, ...f.flags.map((x) => t(FLAG_L[x] || x))].filter(Boolean).join(' · ')}
              </span>
              <span>{money(f.withRate ? Number(f.rate.replace(/\s+/g, '')) : null, f.currency)}{f.payTerms.length ? ` · ${f.payTerms.map((p) => t(PAY_L[p])).join(', ')}` : ''}</span>
            </div>
          </>
        )}

        {serverErr && serverErr.step === step && (
          serverErr.duplicate ? (
            <div className="form-error form-error-rich" role="alert">
              <b>{t('Такое объявление у вас уже размещено')}</b>
              <span>{t('У вас уже есть активное объявление с тем же маршрутом, датами, весом и типом кузова. Измените даты или отредактируйте существующее объявление.')}</span>
              <span className="row wrap">
                <button type="button" className="btn ghost" onClick={() => go(2)}>{t('Изменить даты')}</button>
                <Link to={listUrl} className="btn ghost">{kind === 'cargo' ? t('Открыть мои грузы') : t('Открыть мои машины')}</Link>
              </span>
            </div>
          ) : (
            <div className="form-error" role="alert">{serverErr.text}</div>
          )
        )}
        <div className="form-actions">
          <button type="button" className="btn ghost fa-cancel" onClick={cancel}>{t('Отмена')}</button>
          {step > 0 && <button type="button" className="btn soft fa-back" onClick={() => go(step - 1)}><ArrowLeft size={16} /> {t('Назад')}</button>}
          {step < 3 ? (
            <button type="submit" className="btn primary fa-next">{t('Далее')} <ArrowRight size={16} /></button>
          ) : (
            <button type="submit" className="btn primary fa-next" disabled={busy || stepBad.some(Boolean)}>{editId ? t('Сохранить') : t('Разместить')}</button>
          )}
        </div>
      </form>
    </div>
  );
}

function dist(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
