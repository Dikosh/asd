// «Найти груз» и «Найти транспорт»: фильтр, сохранённые поиски, список и карта.
// Условия фильтра, сортировка и режим «список / карта» хранятся в адресе страницы — ссылкой можно поделиться,
// а после возврата из объявления поиск остаётся тем же и на том же месте.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useNavigationType, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, BadgeCheck, Bell, BellOff, ChevronDown, FileCheck2, HelpCircle, List, Map as MapIcon, Save, SlidersHorizontal, X } from 'lucide-react';
import { api, BODY_L, CARGO_L, COUNTRY_L, FLAG_L, fmtDates, Listing, LOADING_L, money, num, opts, PAY_L, t, useApp, useLoad } from '../core';
import { Chips, CitySelect, Empty, Field, Loading, MapView, Modal, Select, Tabs } from '../ui';
import { ListingCard, RouteTitle } from '../listing';

type Filter = Record<string, string>;
type View = 'list' | 'map';
type Result = { total: number; items: Listing[] };

// те же имена, что принимает API (FILTER_KEYS на сервере), — ссылки вида /search/cargo?flags=customs работают как есть
const KEYS = ['from', 'to', 'radius', 'fromCountry', 'toCountry', 'dateFrom', 'dateTo', 'body', 'cargoType', 'wMin', 'wMax', 'vMin', 'vMax', 'loading',
  'rateMin', 'rateMax', 'currency', 'pay', 'flags', 'adr', 'withRate', 'verified', 'noRed', 'direct', 'partners', 'fresh', 'intl', 'sort'];
// редкие условия спрятаны за «Ещё фильтры»
const EXTRA = ['vMin', 'vMax', 'loading', 'rateMin', 'rateMax', 'currency', 'pay', 'fromCountry', 'toCountry', 'flags', 'direct', 'partners', 'fresh', 'withRate', 'adr', 'intl'];
const DECIMAL = ['wMin', 'wMax', 'vMin', 'vMax'];
const INTEGER = ['rateMin', 'rateMax', 'radius'];
/** Только цифры и один десятичный разделитель: «12,5» → «12.5», «abc» → «». */
const decimal = (s: string) => {
  const v = s.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const i = v.indexOf('.');
  return (i < 0 ? v : v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, '')).slice(0, 8);
};
const clean = (f: Filter): Filter => {
  const out: Filter = {};
  for (const k of KEYS) {
    let v = f[k];
    if (v == null || v === '') continue;
    if (DECIMAL.includes(k)) v = decimal(v);
    else if (INTEGER.includes(k)) v = v.replace(/\D/g, '').slice(0, 10);
    if (v !== '') out[k] = v;
  }
  return out;
};
const parse = (sp: URLSearchParams): { f: Filter; view: View } => ({ f: clean(Object.fromEntries(sp)), view: sp.get('view') === 'map' ? 'map' : 'list' });
const serialize = (f: Filter, view: View) => new URLSearchParams({ ...clean(f), ...(view === 'map' ? { view: 'map' } : {}) }).toString();

// последняя выдача и положение прокрутки: при возврате «Назад» список появляется сразу и на прежнем месте
let lastResult: { query: string; data: Result } | null = null;
const SCROLL = 'jolda:search-scroll:';
const store = {
  get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* хранилище недоступно */ } },
};

export default function SearchPage() {
  const kind = useParams().kind === 'truck' ? 'truck' : 'cargo';
  const { meta, city, cityName, act, me } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const navType = useNavigationType();
  const [sp, setSp] = useSearchParams();
  const init = useRef(parse(sp)).current;
  const [f, setF] = useState<Filter>(init.f);
  const [view, setView] = useState<View>(init.view);
  const [debounced, setDebounced] = useState<Filter>(init.f);
  const [notifyNew, setNotifyNew] = useState(true);
  const [panel, setPanel] = useState(false);
  const [more, setMore] = useState(() => EXTRA.some((k) => init.f[k]));
  const [hint, setHint] = useState(false);
  const [saveName, setSaveName] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null); // город, выбранный на карте
  const set = (k: string, v: string | null) => setF((x) => clean({ ...x, [k]: v ?? '' }));
  const broker = me?.company.kind === 'broker';

  // ---- адрес ⇄ фильтр ----
  const written = useRef(serialize(init.f, init.view)); // то, что уже отражено и в адресе, и в состоянии
  const prevKind = useRef(kind);
  const inUrl = serialize(parse(sp).f, parse(sp).view);
  useEffect(() => {
    // адрес изменился не нами: «Назад/Вперёд», переход по ссылке, другая вкладка «груз / транспорт»
    if (inUrl === written.current && prevKind.current === kind) return;
    prevKind.current = kind;
    written.current = inUrl;
    const p = parse(sp);
    setF(p.f);
    setDebounced(p.f);
    setView(p.view);
    setSel(null);
  }, [inUrl, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // из адреса убираем то, что фильтр не понимает (например, ?wMin=abc)
    if (sp.toString() !== written.current) setSp(written.current, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const id = setTimeout(() => {
      setDebounced(f);
      const s = serialize(f, view);
      if (s !== written.current) {
        written.current = s;
        setSp(s, { replace: true });
      }
    }, 250);
    return () => clearTimeout(id);
  }, [f, view]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = new URLSearchParams({ kind, ...debounced }).toString();
  const res = useLoad(async () => {
    const q = query;
    const data = await api<Result>(`/listings?${q}`);
    lastResult = { query: q, data };
    return data;
  }, [query]);
  const data = res.data ?? (lastResult?.query === query ? lastResult.data : null);
  const saved = useLoad(() => api<{ id: number; kind: string; name: string; params: Filter; notify: boolean }[]>('/searches'));

  // ---- положение прокрутки ----
  const locKey = useRef(loc.key);
  locKey.current = loc.key;
  const restore = useRef<number | null>(null);
  useEffect(() => {
    if (navType === 'POP') {
      const y = Number(store.get(SCROLL + loc.key));
      if (y > 0) restore.current = y;
    }
    let y = window.scrollY;
    const onScroll = () => { y = window.scrollY; };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      store.set(SCROLL + locKey.current, String(Math.round(y)));
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // ждём и выдачу, и строку сохранённых поисков над ней — иначе список сдвинется уже после прокрутки
    if (restore.current == null || !data || saved.loading) return;
    const y = restore.current;
    restore.current = null;
    // общий каркас при смене страницы прокручивает вверх — возвращаемся уже после него
    const id = requestAnimationFrame(() => window.scrollTo(0, y));
    return () => cancelAnimationFrame(id);
  }, [data, saved.loading]);

  // ---- панель фильтра на телефоне: во весь экран, фон не прокручивается, Esc закрывает ----
  useEffect(() => {
    if (!panel) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.overlay') && setPanel(false);
    document.addEventListener('keydown', esc);
    document.documentElement.classList.add('filter-open');
    return () => {
      document.removeEventListener('keydown', esc);
      document.documentElement.classList.remove('filter-open');
    };
  }, [panel]);

  const flag = (k: string, label: string) => (
    <label className="switch small"><input type="checkbox" checked={f[k] === '1'} onChange={(e) => set(k, e.target.checked ? '1' : '')} /><span>{label}</span></label>
  );
  const active = Object.keys(f).filter((k) => k !== 'sort').length;
  const extraActive = EXTRA.filter((k) => f[k]).length;
  useEffect(() => {
    if (extraActive > 0) setMore(true); // применили сохранённый поиск или ссылку с редким условием — показываем его
  }, [extraActive > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const foundLabel = kind === 'cargo' ? t('Найдено грузов: {n}', { n: data?.total ?? '…' }) : t('Найдено машин: {n}', { n: data?.total ?? '…' });
  const flags = f.flags ? f.flags.split(',') : [];
  const toggleFlag = (x: string) => set('flags', (flags.includes(x) ? flags.filter((y) => y !== x) : [...flags, x]).join(','));

  // ---- карта: одна точка на город, по нажатию — объявления этого города ----
  const MAP_LIMIT = 60;
  const map = useMemo(() => {
    const items = (data?.items || []).slice(0, MAP_LIMIT).filter((l) => l.points.every((p) => city(p)));
    const pos = (id: string) => [city(id)!.lat, city(id)!.lon] as [number, number];
    const byCity = new Map<string, { id: string; from: Listing[]; to: Listing[] }>();
    const at = (id: string) => byCity.get(id) || byCity.set(id, { id, from: [], to: [] }).get(id)!;
    for (const l of items) {
      at(l.fromId).from.push(l);
      at(l.toId).to.push(l);
    }
    // сначала места только выгрузки, потом места погрузки — они оказываются сверху
    const groups = [...byCity.values()].sort((a, b) => Number(a.from.length > 0) - Number(b.from.length > 0));
    const markers = groups.map((g) => ({
      pos: pos(g.id),
      kind: (g.from.length ? 'a' : 'b') as 'a' | 'b',
      label: [cityName(g.id), g.from.length ? `${t('погрузка')}: ${g.from.length}` : '', g.to.length ? `${t('разгрузка')}: ${g.to.length}` : ''].filter(Boolean).join(' · '),
    }));
    const routes = items.map((l) => ({ pts: l.points.map(pos), color: l.kind === 'cargo' ? '#1554d1' : '#7c3aed', weight: 2 }));
    // карту наводим на места погрузки, отбросив далёкие одиночные точки, — иначе видна вся Евразия
    let focus = groups.filter((g) => g.from.length);
    if (focus.length > 4) {
      const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
      const c = [med(focus.map((g) => pos(g.id)[0])), med(focus.map((g) => pos(g.id)[1]))];
      const dist = (g: { id: string }) => Math.hypot(pos(g.id)[0] - c[0], (pos(g.id)[1] - c[1]) * Math.cos((c[0] * Math.PI) / 180));
      const limit = Math.max(med(focus.map(dist)) * 2.5, 4);
      focus = focus.filter((g) => dist(g) <= limit);
    }
    const fit = focus.map((g) => ({ pos: pos(g.id), kind: 'a' as const }));
    return { groups, markers, routes, fit, fitKey: `${kind}:${focus.map((g) => g.id).sort().join(',')}`, shown: items.length };
  }, [data, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  // MapView подгоняет масштаб один раз на каждый fitKey: сначала отдаём ему только точки, на которые надо навести карту,
  // а следующим кадром — все маршруты и точки (масштаб при этом уже не меняется)
  const [fitted, setFitted] = useState<string | null>(null);
  useEffect(() => {
    if (view !== 'map') {
      if (fitted !== null) setFitted(null);
    } else if (map.fit.length && fitted !== map.fitKey) setFitted(map.fitKey);
  }, [view, map, fitted]);
  const mapFull = fitted === map.fitKey;
  const narrow = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 900px)').matches; // на телефоне карта ниже: под ней сразу видны легенда и объявления города
  const selGroup = sel ? map.groups.find((g) => g.id === sel) : null;
  const onMapPick = (e: React.MouseEvent | React.KeyboardEvent) => {
    if ('key' in e && e.key !== 'Enter') return;
    const icon = (e.target as Element).closest?.('.leaflet-marker-icon');
    if (!icon?.parentElement || !mapFull) return;
    // значки на карте идут в том же порядке, что и переданные точки
    const g = map.groups[Array.prototype.indexOf.call(icon.parentElement.children, icon)];
    if (g) setSel(g.id);
  };
  const cityRows = (title: string, items: Listing[], key: 'from' | 'to') => items.length > 0 && (
    <div className="map-sel-group">
      <div className="muted small">{title}: {items.length}</div>
      {items.slice(0, 4).map((l) => (
        <Link key={l.id} to={`/listing/${l.id}`} className="map-row">
          <span className="map-row-main"><b><RouteTitle points={l.points} /></b><span className="muted small">{fmtDates(l.dateFrom, l.dateTo)}{l.weight != null ? ` · ${num(l.weight)} ${t('т')}` : ''}</span></span>
          <b className="map-row-rate">{money(l.rate, l.currency)}</b>
        </Link>
      ))}
      {items.length > 4 && (
        <button className="link" onClick={() => { setF(clean({ ...f, [key]: sel! })); setView('list'); }}>{t('Показать все {n} в списке', { n: items.length })}</button>
      )}
    </div>
  );

  // перевёрнутые диапазоны дают пустую выдачу — говорим об этом прямо в фильтре
  const gt = (a?: string, b?: string) => !!a && !!b && Number(a.replace(',', '.')) > Number(b.replace(',', '.'));
  const rangeErrors = [
    gt(f.wMin, f.wMax) && t('Вес «от» больше, чем «до»'),
    gt(f.vMin, f.vMax) && t('Объём «от» больше, чем «до»'),
    gt(f.rateMin, f.rateMax) && t('Ставка «от» больше, чем «до»'),
    !!f.dateFrom && !!f.dateTo && f.dateFrom > f.dateTo && t('Дата «с» позже, чем «по»'),
  ].filter(Boolean) as string[];
  const hasCity = !!(f.from || f.to);
  const defaultName = [f.from && city(f.from)?.ru, f.to && city(f.to)?.ru].filter(Boolean).join(' → ') || (kind === 'cargo' ? t('Все грузы') : t('Весь транспорт'));
  const numField = (k: string, label: string, int = false) => (
    <Field label={label}>
      <input inputMode={int ? 'numeric' : 'decimal'} autoComplete="off" value={f[k] || ''} onChange={(e) => set(k, int ? e.target.value.replace(/\D/g, '') : decimal(e.target.value))} />
    </Field>
  );

  const filters = (
    <>
      <div className="fpanel-head">
        <b>{t('Фильтр')}{active > 0 && <span className="badge inline">{active}</span>}</b>
        <button className="link" onClick={() => setHint(true)}><HelpCircle size={15} /> {t('Как пользоваться')}</button>
        <button className="icon-btn fpanel-close" onClick={() => setPanel(false)} aria-label={t('Закрыть')}><X size={20} /></button>
      </div>
      <div className="fpanel-body filters">
        <Field label={t('Место погрузки')}><CitySelect value={f.from || null} onChange={(v) => set('from', v)} placeholder={t('Любой город')} /></Field>
        <button className="swap" onClick={() => setF(clean({ ...f, from: f.to || '', to: f.from || '' }))} aria-label={t('Поменять местами')}><ArrowLeftRight size={15} /></button>
        <Field label={t('Место разгрузки')}><CitySelect value={f.to || null} onChange={(v) => set('to', v)} placeholder={t('Любой город')} /></Field>
        <Field label={t('Радиус от города')} hint={hasCity ? undefined : t('Сначала выберите город погрузки или разгрузки')}>
          {hasCity ? (
            <Select value={f.radius || '50'} onChange={(v) => set('radius', v === '50' ? '' : v)}
              options={[{ value: '0', label: t('Только этот город') }, ...[50, 100, 200, 300].map((r) => ({ value: String(r), label: r === 50 ? t('Город и окрестности, 50 км') : `+ ${r} ${t('км')}` }))]} />
          ) : (
            <Select value="" onChange={() => {}} placeholder={t('Город не выбран')} options={[]} />
          )}
        </Field>
        <div className="grid2">
          <Field label={t('Дата с')}><input type="date" value={f.dateFrom || ''} max={f.dateTo || undefined} onChange={(e) => set('dateFrom', e.target.value)} /></Field>
          <Field label={t('Дата по')}><input type="date" value={f.dateTo || ''} min={f.dateFrom || undefined} onChange={(e) => set('dateTo', e.target.value)} /></Field>
        </div>
        <Field label={t('Тип кузова')}><Select value={f.body || ''} onChange={(v) => set('body', v)} placeholder={t('Любой')} options={opts(meta.body, BODY_L)} /></Field>
        {kind === 'cargo' && <Field label={t('Тип груза')}><Select value={f.cargoType || ''} onChange={(v) => set('cargoType', v)} placeholder={t('Любой')} options={opts(meta.cargo, CARGO_L)} /></Field>}
        <div className="grid2">
          {numField('wMin', t('Вес от, т'))}
          {numField('wMax', t('Вес до, т'))}
        </div>
        <div className="field checks">
          <span className="field-label">{t('Показывать только')}</span>
          {flag('verified', t('от проверенных компаний'))}
          {flag('noRed', t('без компаний с плохой репутацией'))}
        </div>
        <Field label={t('Сортировка')}>
          <Select value={f.sort || 'new'} onChange={(v) => set('sort', v === 'new' ? '' : v)}
            options={[
              { value: 'new', label: t('Сначала новые') }, { value: 'rate_desc', label: t('Ставка: по убыванию') }, { value: 'rate_asc', label: t('Ставка: по возрастанию') },
              { value: 'rate_km', label: t('Выгоднее за километр') }, { value: 'date_asc', label: t('Ближайшая дата') }, { value: 'weight_desc', label: t('Больше вес') }, { value: 'distance_asc', label: t('Короче маршрут') },
            ]} />
        </Field>

        <button className={`more-toggle ${more ? 'open' : ''}`} onClick={() => setMore(!more)} aria-expanded={more} aria-controls="more-filters">
          <span>{t('Ещё фильтры')}{extraActive > 0 && <span className="badge inline">{extraActive}</span>}</span>
          <span className="muted small">{t('объём, ставка, оплата, документы')}</span>
          <ChevronDown size={17} />
        </button>
        {more && (
          <div className="filters" id="more-filters">
            <div className="grid2">
              {numField('vMin', t('Объём от, м³'))}
              {numField('vMax', t('Объём до, м³'))}
            </div>
            <div className="field">
              <span className="field-label">{t('Способ погрузки')}</span>
              <Chips options={opts(meta.loading, LOADING_L)} value={f.loading ? f.loading.split(',') : []} onChange={(v: string[]) => set('loading', v.join(','))} />
            </div>
            <div className="grid2">
              {numField('rateMin', t('Ставка от'), true)}
              {numField('rateMax', t('Ставка до'), true)}
            </div>
            <Field label={t('Валюта')}><Select value={f.currency || ''} onChange={(v) => set('currency', v)} placeholder={t('Любая')} options={meta.currencies.map((c) => ({ value: c, label: c }))} /></Field>
            <div className="field">
              <span className="field-label">{t('Оплата')}</span>
              <Chips options={opts(meta.pay, PAY_L)} value={f.pay ? f.pay.split(',') : []} onChange={(v: string[]) => set('pay', v.join(','))} />
            </div>
            <div className="grid2">
              <Field label={t('Страна погрузки')}><Select value={f.fromCountry || ''} onChange={(v) => set('fromCountry', v)} placeholder={t('Любая')} options={opts(Object.keys(COUNTRY_L), COUNTRY_L)} /></Field>
              <Field label={t('Страна разгрузки')}><Select value={f.toCountry || ''} onChange={(v) => set('toCountry', v)} placeholder={t('Любая')} options={opts(Object.keys(COUNTRY_L), COUNTRY_L)} /></Field>
            </div>
            <div className="field">
              <span className="field-label">{t('Документы')}</span>
              <Chips options={opts(meta.flags, FLAG_L)} value={flags} onChange={(v: string[]) => set('flags', v.join(','))} />
            </div>
            <div className="field checks">
              <span className="field-label">{t('Показывать только')}</span>
              {flag('direct', kind === 'cargo' ? t('от прямых заказчиков') : t('от владельцев машин'))}
              {flag('partners', t('от моих партнёров'))}
              {flag('fresh', t('новые за сутки'))}
              {flag('withRate', t('с указанной ставкой'))}
              {flag('adr', t('опасные грузы (ADR)'))}
              {flag('intl', t('международные рейсы'))}
            </div>
          </div>
        )}
        <button className="btn soft block only-s" onClick={() => setSaveName(defaultName)}><Save size={16} /> {t('Сохранить поиск')}</button>
      </div>
      {rangeErrors.length > 0 && <div className="form-error fpanel-err" role="alert">{rangeErrors.join('. ')}</div>}
      <div className="fpanel-foot">
        <button className="btn ghost" onClick={() => setF({})} disabled={!active && !f.sort}><X size={16} /> {t('Сбросить')}</button>
        <button className="btn soft hide-s" onClick={() => setSaveName(defaultName)}><Save size={16} /> {t('Сохранить поиск')}</button>
        <button className="btn primary only-s fpanel-show" onClick={() => setPanel(false)}>{t('Показать')} · {foundLabel}</button>
      </div>
    </>
  );

  return (
    <div className="stack">
      <div className="page-head">
        <Tabs items={[{ value: 'cargo', label: t('Найти груз') }, { value: 'truck', label: t('Найти транспорт') }]} value={kind} onChange={(v) => {
          // общие условия (маршрут, даты, вес, кузов, надёжность) переносим на другую вкладку
          const keep = new URLSearchParams();
          for (const k of ['from', 'to', 'radius', 'dateFrom', 'dateTo', 'body', 'wMin', 'wMax', 'verified', 'noRed', 'intl']) if (f[k]) keep.set(k, f[k]);
          const s = keep.toString();
          nav(`/search/${v}${s ? `?${s}` : ''}`);
        }} />
        <div className="row">
          <button className="btn soft only-s" onClick={() => setPanel(true)}>
            <SlidersHorizontal size={16} /> {t('Фильтр')}{active > 0 && <span className="badge inline">{active}</span>}
          </button>
          <div className="seg" role="group" aria-label={t('Вид')}>
            <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} aria-label={t('Список')} aria-pressed={view === 'list'} title={t('Список')}><List size={17} /></button>
            <button className={view === 'map' ? 'on' : ''} onClick={() => setView('map')} aria-label={t('Карта')} aria-pressed={view === 'map'} title={t('Карта')}><MapIcon size={17} /></button>
          </div>
        </div>
      </div>

      {saved.data && saved.data.filter((s) => s.kind === kind).length > 0 && (
        <div className="saved">
          <span className="muted small">{t('Сохранённые поиски')}:</span>
          {saved.data.filter((s) => s.kind === kind).map((s) => (
            <span className="saved-chip" key={s.id}>
              <button
                className={s.notify ? 'bell on' : 'bell'}
                title={s.notify ? t('Уведомления включены — нажмите, чтобы выключить') : t('Сообщать о новых объявлениях по этому поиску')}
                aria-label={s.notify ? t('Выключить уведомления') : t('Включить уведомления')}
                aria-pressed={s.notify}
                onClick={async () => (await act(() => api(`/searches/${s.id}`, 'PATCH', { notify: !s.notify }), s.notify ? t('Уведомления по поиску выключены') : t('Сообщим о новых объявлениях по этому поиску'))) && saved.reload()}
              >
                {s.notify ? <Bell size={13} /> : <BellOff size={13} />}
                <span className="bell-label">{s.notify ? t('Уведомления вкл.') : t('Уведомления выкл.')}</span>
              </button>
              <button onClick={() => setF(clean(s.params))}>{s.name}</button>
              <button aria-label={t('Удалить')} onClick={async () => (await act(() => api(`/searches/${s.id}`, 'DELETE'))) && saved.reload()}><X size={13} /></button>
            </span>
          ))}
        </div>
      )}

      <div className="search-layout">
        <aside className={`filter-panel card fpanel ${panel ? 'open' : ''}`} aria-label={t('Фильтр')}>
          {filters}
        </aside>
        <section className="results">
          <div className="results-head">
            <b>{foundLabel}</b>
            {data && data.total > data.items.length && <span className="muted small">{t('показаны первые {n}', { n: data.items.length })}</span>}
            <div className="quick-filters">
              <button className={`chip-btn ${f.verified === '1' ? 'on' : ''}`} aria-pressed={f.verified === '1'} onClick={() => set('verified', f.verified === '1' ? '' : '1')}>
                <BadgeCheck size={15} /> {t('Только проверенные')}
              </button>
              {broker && (
                <button className={`chip-btn ${flags.includes('customs') ? 'on' : ''}`} aria-pressed={flags.includes('customs')} onClick={() => toggleFlag('customs')}>
                  <FileCheck2 size={15} /> {t(FLAG_L.customs)}
                </button>
              )}
            </div>
          </div>
          {view === 'map' && (
            <div className="card map-card search-map">
              <div className="map-click" onClick={onMapPick} onKeyDown={onMapPick}>
                <MapView routes={mapFull ? map.routes : []} markers={mapFull ? map.markers : map.fit} height={narrow ? 320 : 420} fitKey={map.fitKey} />
              </div>
              {data?.total !== 0 && <div className="map-legend">
                <span><i className="lg-dot a" /> {t('Погрузка')}</span>
                <span><i className="lg-dot b" /> {t('Только разгрузка')}</span>
                <span><i className={`lg-line ${kind}`} /> {kind === 'cargo' ? t('Маршрут груза') : t('Маршрут транспорта')}</span>
                {data && data.total > map.shown && <span className="muted">{t('на карте первые {n}', { n: map.shown })}</span>}
              </div>}
              {selGroup ? (
                <div className="map-sel" aria-live="polite">
                  <div className="row between">
                    <b>{cityName(selGroup.id)}</b>
                    <button className="icon-btn" onClick={() => setSel(null)} aria-label={t('Закрыть')}><X size={18} /></button>
                  </div>
                  {cityRows(t('Погрузка здесь'), selGroup.from, 'from')}
                  {cityRows(t('Разгрузка здесь'), selGroup.to, 'to')}
                </div>
              ) : data?.total === 0 ? null : (
                <p className="map-tip muted small">{t('Нажмите на точку на карте — покажем объявления этого города.')}</p>
              )}
            </div>
          )}
          {res.loading && !data ? <Loading /> : (
            <div className="list">
              {data?.items.map((l) => <ListingCard key={l.id} l={l} onChange={res.reload} />)}
              {data?.total === 0 && (
                <div className="card">
                  <Empty title={t('Ничего не найдено')} text={rangeErrors.length ? `${rangeErrors.join('. ')}.` : hasCity ? t('Попробуйте увеличить радиус, убрать часть условий или сохранить поиск — и вернуться позже.') : t('Попробуйте убрать часть условий или сохранить поиск — и вернуться позже.')}>
                    <button className="btn soft" onClick={() => setF({})}>{t('Сбросить фильтр')}</button>
                  </Empty>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {hint && (
        <Modal title={t('Как пользоваться фильтром')} onClose={() => setHint(false)}>
          <ul className="hint-list">
            <li><b>{t('Место погрузки и разгрузки')}.</b> {t('Начните с них — остальные поля необязательны. Пустое поле означает «любой город».')}</li>
            <li><b>{t('Радиус')}.</b> {t('Добавляет соседние города: «+100 км» от Караганды найдёт и Темиртау.')}</li>
            <li><b>{kind === 'truck' ? t('Транспорт по пути') : t('Грузы по пути')}.</b> {kind === 'truck' ? t('Машина найдётся, даже если ваши города — промежуточные точки её маршрута.') : t('Чтобы найти догруз, разместите транспорт — подходящие грузы появятся в рекомендациях.')}</li>
            <li><b>{t('Вес, объём, кузов, погрузка')}.</b> {t('Сужают выдачу под вашу машину или груз.')}</li>
            <li><b>{t('Сортировка')}.</b> {t('«Выгоднее за километр» ставит наверх объявления с лучшей ставкой за км; сортировка по ставке работает в одной валюте (по умолчанию — тенге).')}</li>
            <li><b>{t('Сохранить поиск')}.</b> {t('Сохраняет все условия — потом они применяются одним нажатием.')}</li>
            <li><b>{t('Колокольчик')}.</b> {t('Включите его у сохранённого поиска — и платформа сама сообщит о новом подходящем объявлении, даже на телефон.')}</li>
          </ul>
        </Modal>
      )}
      {saveName !== null && (
        <Modal title={t('Сохранить поиск')} onClose={() => setSaveName(null)}>
          <Field label={t('Название')}><input autoFocus value={saveName} onChange={(e) => setSaveName(e.target.value)} maxLength={80} /></Field>
          <label className="switch"><input type="checkbox" checked={notifyNew} onChange={(e) => setNotifyNew(e.target.checked)} /><span>{t('Сообщать о новых объявлениях по этому поиску')}</span></label>
          <p className="muted small">{t('Уведомление придёт в уведомления Timma и push-сообщением на телефон, если разрешить их в разделе «Уведомления».')} <Link to="/notifications">{t('Открыть уведомления')}</Link></p>
          <p className="muted small">{t('Условий в фильтре: {n}', { n: num(active) })}</p>
          <div className="row end">
            <button className="btn ghost" onClick={() => setSaveName(null)}>{t('Отмена')}</button>
            <button className="btn primary" disabled={!saveName.trim()} onClick={async () => {
              if (await act(() => api('/searches', 'POST', { kind, name: saveName, params: clean(f), notify: notifyNew }), t('Поиск сохранён'))) {
                saved.reload();
                setSaveName(null);
              }
            }}>{t('Сохранить')}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
