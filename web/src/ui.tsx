// Переиспользуемые элементы интерфейса.
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { BadgeCheck, ChevronDown, MapPin, Star, X } from 'lucide-react';
import { City, Company, companyTitle, COUNTRY_L, Lang, placeName, t, useApp } from './core';

export function Modal({ title, onClose, children, wide }: { title: string; onClose?: () => void; children: ReactNode; wide?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const focusable = () => [...(box.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])') || [])];
    // фокус остаётся внутри окна, а после закрытия возвращается туда, откуда окно открыли
    if (!box.current?.contains(document.activeElement)) (focusable().find((x) => !x.classList.contains('icon-btn')) || focusable()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return close.current?.();
      if (e.key !== 'Tab') return;
      const f = focusable();
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      before?.focus?.();
    };
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={box} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h3>{title}</h3>
          {onClose && (
            <button className="icon-btn" onClick={onClose} aria-label={t('Закрыть')}>
              <X size={20} />
            </button>
          )}
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** Набор «галочек»-чипов: одиночный или множественный выбор. */
export function Chips<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T[] | T | null; onChange: (v: any) => void }) {
  const multi = Array.isArray(value);
  const has = (v: T) => (multi ? (value as T[]).includes(v) : value === v);
  const toggle = (v: T) => {
    if (multi) onChange(has(v) ? (value as T[]).filter((x) => x !== v) : [...(value as T[]), v]);
    else onChange(has(v) ? null : v);
  };
  return (
    <div className="chips-select">
      {options.map((o) => (
        <button type="button" key={o.value} className={`chip-btn ${has(o.value) ? 'on' : ''}`} aria-pressed={has(o.value)} onClick={() => toggle(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <div className="select">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={16} />
    </div>
  );
}

// ---------- выбор города ----------
// Для поиска названия упрощаются: без регистра, «ё» = «е», казахские буквы приравнены к русским, дефис = пробел.
const FOLD: { [letter: string]: string } = { ё: 'е', ә: 'а', ғ: 'г', қ: 'к', ң: 'н', ө: 'о', ұ: 'у', ү: 'у', һ: 'х', і: 'и' };
const fold = (s: string) => s.toLowerCase().replace(/[ёәғқңөұүһі]/g, (ch) => FOLD[ch]).replace(/[\s\-–.,]+/g, ' ').trim();
const cityIndex = new WeakMap<City[], string[][]>();
/** Упрощённые названия (ru/kz/en) каждого места; считаются один раз на справочник. */
function cityNames(cities: City[]) {
  let idx = cityIndex.get(cities);
  if (!idx) {
    idx = cities.map((c) => [...new Set([fold(c.ru), fold(c.kz), fold(c.en), fold(c.zh)])]);
    cityIndex.set(cities, idx);
  }
  return idx;
}
const rows = [new Uint8Array(64), new Uint8Array(64), new Uint8Array(64)];
/** Сколько правок (замена, лишняя или пропущенная буква, перестановка соседних) отделяет набранное от начала названия; больше max — возвращает max + 1. */
function prefixDist(q: string, name: string, max: number) {
  const n = q.length;
  const m = Math.min(name.length, n + max);
  if (m < n - max) return max + 1;
  let [pp, prev, cur] = rows;
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    let best = i;
    for (let j = 1; j <= m; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (q[i - 1] === name[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && q[i - 1] === name[j - 2] && q[i - 2] === name[j - 1]) v = Math.min(v, pp[j - 2] + 1);
      cur[j] = v;
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    [pp, prev, cur] = [prev, cur, pp];
  }
  let d = max + 1;
  for (let j = 0; j <= m; j++) if (prev[j] < d) d = prev[j];
  return d;
}
/** Подсказки по набранному: сначала названия, которые так начинаются, затем содержащие; если начал нет — похожие с опечаткой. */
function searchCities(cities: City[], text: string): City[] {
  const s = fold(text);
  if (!s) return cities.slice(0, 40);
  const idx = cityNames(cities);
  const starts: City[] = [];
  const inside: City[] = [];
  for (let k = 0; k < cities.length; k++) {
    const names = idx[k];
    if (names.some((n) => n.startsWith(s))) starts.push(cities[k]);
    else if (inside.length < 40 && names.some((n) => n.includes(s))) inside.push(cities[k]);
  }
  // справочник отсортирован по населению, поэтому крупные города оказываются выше
  if (starts.length || s.length < 4 || s.length > 40) return [...starts, ...inside].slice(0, 40);
  const max = s.length < 6 ? 1 : 2;
  const near: City[][] = [[], [], []];
  for (let k = 0; k < cities.length; k++) {
    let d = max + 1;
    for (const n of idx[k]) d = Math.min(d, prefixDist(s, n, max));
    if (d <= max) near[d].push(cities[k]);
  }
  return [...new Set([...near[0], ...near[1], ...inside, ...near[2]])].slice(0, 40);
}
let citySeq = 0;

/** Выбор города из справочника: поиск по русскому, казахскому и английскому названию, прощает опечатки. `error` — текст ошибки под полем. */
export function CitySelect({ value, onChange, placeholder, error }: { value: string | null; onChange: (id: string | null) => void; placeholder?: string; error?: string }) {
  const { cities, cityName, lang } = useApp();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [miss, setMiss] = useState(false); // набранный текст не удалось сопоставить с городом
  const keep = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const hintId = useRef('');
  if (!hintId.current) hintId.current = `city-hint-${++citySeq}`;
  useEffect(() => {
    if (keep.current) {
      keep.current = false; // город сбросили сами, а набранный текст оставили на виду
      return;
    }
    setText(value ? cityName(value) : '');
    setMiss(false);
  }, [value, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = !!value && text === cityName(value);
  const list = useMemo(() => (chosen ? cities.slice(0, 40) : searchCities(cities, text)), [text, cities, chosen]);
  const choose = (c: City) => {
    onChange(c.id);
    setText(placeName(c));
    setOpen(false);
    setMiss(false);
  };
  /** Поле покидают: принимаем точное совпадение или первую подсказку; если подобрать нечего — текст остаётся, под полем подсказка. */
  const settle = () => {
    setOpen(false);
    const s = fold(text);
    if (!s) {
      if (text) setText('');
      if (value) onChange(null);
      return;
    }
    if (chosen) return;
    const idx = cityNames(cities);
    const pick = cities.find((_, k) => idx[k].includes(s)) ?? (list.length === 1 || s.length >= 2 ? list[hi] ?? list[0] : undefined);
    if (pick) return choose(pick);
    setMiss(true);
    if (value) {
      keep.current = true;
      onChange(null);
    }
  };
  const hint = !open && (miss ? (list.length ? t('Выберите город из списка') : t('Такого города нет в справочнике — проверьте написание')) : error);
  return (
    <div className={`city-select ${hint ? 'invalid' : ''}`}>
      <MapPin size={16} className="city-pin" />
      <input
        ref={input}
        value={text}
        placeholder={placeholder || t('Город')}
        onFocus={(e) => {
          // у заполненного поля список не раскрываем, пока не начали печатать: на телефоне он закрывал бы следующее поле
          if (!chosen) setOpen(true);
          e.target.select();
        }}
        onBlur={settle}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setHi(0);
          setMiss(false);
          if (!e.target.value && value) onChange(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (open) setHi((h) => Math.min(h + 1, list.length - 1));
            else setOpen(true);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter' && open && list[hi]) {
            e.preventDefault();
            choose(list[hi]);
          } else if (e.key === 'Enter' && text.trim() && !chosen) {
            e.preventDefault(); // текст набран, а город не выбран — сначала показываем подсказки
            setOpen(true);
          } else if (e.key === 'Escape') setOpen(false);
        }}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-invalid={hint ? true : undefined}
        aria-describedby={hint ? hintId.current : undefined}
        autoComplete="off"
      />
      {(value || text) && (
        <button
          type="button"
          className="city-clear"
          tabIndex={-1}
          aria-label={t('Очистить')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setText('');
            setMiss(false);
            if (value) onChange(null);
            input.current?.focus();
            setOpen(true);
          }}
        >
          <X size={14} />
        </button>
      )}
      {open && (
        <ul className="city-list" role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {list.length === 0 && <li className="muted">{t('Город не найден')}</li>}
          {list.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === hi} className={i === hi ? 'hi' : ''} onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); choose(c); }}>
              {placeName(c)}
              <span className="muted small"> {c.country !== 'KZ' ? `· ${t(COUNTRY_L[c.country] || c.country)}` : c.region && c.region !== c.ru ? `· ${t(c.region)}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
      {hint && <span className="city-hint" id={hintId.current} role="alert">{hint}</span>}
    </div>
  );
}

export function Tabs({ items, value, onChange }: { items: { value: string; label: string; count?: number }[]; value: string; onChange: (v: string) => void }) {
  // на телефоне вкладки листаются: выбранная всегда на виду, а справа — подсказка, что есть ещё
  const el = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const check = () => {
    const d = el.current;
    if (d) setMore(d.scrollWidth - d.clientWidth - d.scrollLeft > 8);
  };
  useEffect(() => {
    const d = el.current;
    const on = d?.querySelector<HTMLElement>('.on');
    if (d && on) d.scrollLeft = Math.max(0, on.offsetLeft - (d.clientWidth - on.offsetWidth) / 2);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [value, items.length]);
  return (
    <div className={`tabs-wrap ${more ? 'more' : ''}`}>
      <div className="tabs" role="tablist" ref={el} onScroll={check}>
        {items.map((i) => (
          <button key={i.value} role="tab" aria-selected={value === i.value} className={value === i.value ? 'on' : ''} onClick={() => onChange(i.value)}>
            {i.label}
            {i.count !== undefined && i.count > 0 && <span className="tab-count">{i.count}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Empty({ icon, title, text, children }: { icon?: ReactNode; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <b>{title}</b>
      {text && <p>{text}</p>}
      {children}
    </div>
  );
}
export const Loading = () => <div className="loading" aria-label={t('Загрузка')} />;

export function Stars({ value, onChange, size = 18 }: { value: number; onChange?: (v: number) => void; size?: number }) {
  return (
    <span className={`stars ${onChange ? 'editable' : ''}`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button type="button" key={i} disabled={!onChange} onClick={() => onChange?.(i)} aria-label={`${i}`}>
          <Star size={size} fill={i <= Math.round(value) ? 'currentColor' : 'none'} />
        </button>
      ))}
    </span>
  );
}

/** Окно с обязательным текстом: причина отказа, блокировки, ответ на обращение. */
export function ReasonModal({ title, hint, label, min = 5, confirm, danger, onSubmit, onClose }: {
  title: string; hint?: string; label: string; min?: number; confirm: string; danger?: boolean; onSubmit: (text: string) => void | Promise<unknown>; onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      {hint && <p className="muted small">{hint}</p>}
      <Field label={label}><textarea autoFocus rows={4} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      <div className="row end">
        <button className="btn ghost" onClick={onClose}>{t('Отмена')}</button>
        <button className={`btn ${danger ? 'danger' : 'primary'}`} disabled={busy || text.trim().length < min} onClick={async () => { setBusy(true); await onSubmit(text.trim()); setBusy(false); }}>{confirm}</button>
      </div>
    </Modal>
  );
}

const IND_TEXT = { green: 'Хорошая репутация', red: 'Много плохих отзывов', gray: 'Пока мало отзывов' };
/** Компания с индикатором репутации: зелёный — хорошая, красный — много плохих отзывов. */
export function CompanyBadge({ c, link = true }: { c: Company; link?: boolean }) {
  const body = (
    <>
      <span className={`dot ${c.indicator}`} title={t(IND_TEXT[c.indicator])} />
      <span className="cb-name">
        {companyTitle(c)}
      </span>
      {c.verified === 'verified' && <BadgeCheck size={16} className="verified" aria-label={t('Компания проверена')} />}
      {c.pro && <span className="pro" title={t('Тариф Pro')}>PRO</span>}
      {c.indicator === 'red' && <span className="cb-warn">{c.banned ? t('Заблокирована') : t('Плохая репутация')}</span>}
      {c.rating != null && (
        <span className="cb-rating">
          <Star size={13} fill="currentColor" /> {c.rating.toFixed(1)}
        </span>
      )}
    </>
  );
  return link ? (
    <Link to={`/company/${c.id}`} className="company-badge" title={t(IND_TEXT[c.indicator])}>
      {body}
    </Link>
  ) : (
    <span className="company-badge">{body}</span>
  );
}

// ---------- карта ----------
export interface MapRoute { pts: [number, number][]; color?: string; dashed?: boolean; weight?: number }
export interface MapMarker { pos: [number, number]; kind: 'a' | 'b' | 'stop' | 'truck'; label?: string }

export function MapView({ routes, markers, height = 320, fitKey }: { routes: MapRoute[]; markers: MapMarker[]; height?: number; fitKey?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef<string | null>(null);
  const tiles = useApp().meta.tiles;

  useEffect(() => {
    // на телефоне один палец листает страницу, карту двигают двумя — иначе под ней не прокрутить экран
    const touch = window.matchMedia?.('(pointer: coarse)').matches;
    const m = L.map(el.current!, { zoomControl: true, attributionControl: true, scrollWheelZoom: false, zoomAnimation: false, markerZoomAnimation: false, dragging: !touch }).setView([48, 68], 5);
    L.tileLayer(tiles.url, { maxZoom: 18, attribution: tiles.attribution }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current!);
    return () => {
      ro.disconnect();
      m.stop(); // прерываем анимацию, иначе Leaflet обратится к уже удалённой карте
      m.remove();
    };
  }, []);

  useEffect(() => {
    const m = map.current!;
    const g = layer.current!;
    g.clearLayers();
    const all: [number, number][] = [];
    for (const r of routes) {
      if (r.pts.length < 2) continue;
      L.polyline(r.pts, { color: r.color || '#2d5bb9', weight: r.weight || 4, opacity: 0.85, dashArray: r.dashed ? '6 8' : undefined }).addTo(g);
      all.push(...r.pts);
    }
    for (const mk of markers) {
      const icon = L.divIcon({ className: '', html: `<div class="mk mk-${mk.kind}">${mk.kind === 'truck' ? '🚚' : ''}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] });
      const marker = L.marker(mk.pos, { icon, zIndexOffset: mk.kind === 'truck' ? 1000 : 0 }).addTo(g);
      if (mk.label) {
        // подпись — только текстом: строка, переданная в Leaflet как есть, становится разметкой страницы
        const tip = document.createElement('span');
        tip.textContent = mk.label;
        marker.bindTooltip(tip, { direction: 'top', offset: [0, -10] });
      }
      all.push(mk.pos);
    }
    const key = fitKey ?? String(all.length);
    if (all.length && fitted.current !== key) {
      fitted.current = key;
      m.fitBounds(L.latLngBounds(all).pad(0.15), { maxZoom: 10, animate: false });
    }
  }, [routes, markers, fitKey]);

  return <div ref={el} className="map" style={{ height }} data-hint={t('Двигайте карту двумя пальцами')} />;
}

export function Logo() {
  return (
    <span className="logo">
      <svg viewBox="0 0 64 64" width="30" height="30" aria-hidden="true">
        <rect width="64" height="64" rx="15" fill="#2d5bb9" />
        <path d="M16 44c10 0 12-24 22-24h10" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
        <circle cx="48" cy="20" r="6.5" fill="#e5383b" stroke="#fff" strokeWidth="3" />
        <circle cx="16" cy="44" r="4.5" fill="#fff" />
      </svg>
      timma
    </span>
  );
}

const LANGS: [Lang, string, string][] = [['ru', 'РУС', 'Русский'], ['kz', 'ҚАЗ', 'Қазақша'], ['en', 'ENG', 'English'], ['zh', '中文', '中文']];

export function LangSwitch() {
  const { lang, setLang } = useApp();
  return (
    <div className="lang" role="group" aria-label="Язык / Тіл / Language / 语言">
      {LANGS.map(([l, short, full]) => (
        <button key={l} className={lang === l ? 'on' : ''} aria-pressed={lang === l} lang={l === 'kz' ? 'kk' : l === 'zh' ? 'zh-CN' : l}
          aria-label={full} onClick={() => setLang(l)}>
          {short}
        </button>
      ))}
    </div>
  );
}
