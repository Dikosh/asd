// Переиспользуемые элементы интерфейса.
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { BadgeCheck, ChevronDown, MapPin, Star, X } from 'lucide-react';
import { City, Company, Lang, t, useApp } from './core';

export function Modal({ title, onClose, children, wide }: { title: string; onClose?: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
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

/** Выбор города из справочника с поиском по русскому и казахскому названию. */
export function CitySelect({ value, onChange, placeholder }: { value: string | null; onChange: (id: string | null) => void; placeholder?: string }) {
  const { meta, cityName, lang } = useApp();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setText(value ? cityName(value) : '');
  }, [value, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) {
        setOpen(false);
        setText(value ? cityName(value) : '');
      }
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  });
  const list = useMemo(() => {
    const s = text.trim().toLowerCase();
    const all = meta.cities;
    if (!s || (value && text === cityName(value))) return all.slice(0, 40);
    const starts: City[] = [];
    const inside: City[] = [];
    for (const c of all) {
      const a = c.ru.toLowerCase();
      const b = c.kz.toLowerCase();
      if (a.startsWith(s) || b.startsWith(s)) starts.push(c);
      else if (a.includes(s) || b.includes(s)) inside.push(c);
    }
    return [...starts, ...inside].slice(0, 40);
  }, [text, meta.cities, value]); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (c: City) => {
    onChange(c.id);
    setText(lang === 'kz' ? c.kz : c.ru);
    setOpen(false);
  };
  return (
    <div className="city-select" ref={box}>
      <MapPin size={16} className="city-pin" />
      <input
        value={text}
        placeholder={placeholder || t('Город')}
        onFocus={(e) => {
          setOpen(true);
          e.target.select();
        }}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setHi(0);
          if (!e.target.value) onChange(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setHi((h) => Math.min(h + 1, list.length - 1));
          else if (e.key === 'ArrowUp') setHi((h) => Math.max(h - 1, 0));
          else if (e.key === 'Enter' && open && list[hi]) {
            e.preventDefault();
            choose(list[hi]);
          } else if (e.key === 'Escape') setOpen(false);
        }}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {value && (
        <button type="button" className="city-clear" onClick={() => onChange(null)} aria-label={t('Очистить')}>
          <X size={14} />
        </button>
      )}
      {open && (
        <ul className="city-list" role="listbox">
          {list.length === 0 && <li className="muted">{t('Город не найден')}</li>}
          {list.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === hi} className={i === hi ? 'hi' : ''} onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); choose(c); }}>
              {lang === 'kz' ? c.kz : c.ru}
              {c.country !== 'KZ' && <span className="muted"> · {c.country}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Tabs({ items, value, onChange }: { items: { value: string; label: string; count?: number }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((i) => (
        <button key={i.value} role="tab" aria-selected={value === i.value} className={value === i.value ? 'on' : ''} onClick={() => onChange(i.value)}>
          {i.label}
          {i.count !== undefined && i.count > 0 && <span className="tab-count">{i.count}</span>}
        </button>
      ))}
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

const IND_TEXT = { green: 'Хорошая репутация', red: 'Много плохих отзывов', gray: 'Пока мало отзывов' };
/** Компания с индикатором репутации: зелёный — хорошая, красный — много плохих отзывов. */
export function CompanyBadge({ c, link = true }: { c: Company; link?: boolean }) {
  const body = (
    <>
      <span className={`dot ${c.indicator}`} title={t(IND_TEXT[c.indicator])} />
      <span className="cb-name">
        {c.form} «{c.name}»
      </span>
      {c.verified === 'verified' && <BadgeCheck size={16} className="verified" aria-label={t('Компания проверена')} />}
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

  useEffect(() => {
    const m = L.map(el.current!, { zoomControl: true, attributionControl: true, scrollWheelZoom: false, zoomAnimation: false, markerZoomAnimation: false }).setView([48, 68], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(m);
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
      L.polyline(r.pts, { color: r.color || '#1554d1', weight: r.weight || 4, opacity: 0.85, dashArray: r.dashed ? '6 8' : undefined }).addTo(g);
      all.push(...r.pts);
    }
    for (const mk of markers) {
      const icon = L.divIcon({ className: '', html: `<div class="mk mk-${mk.kind}">${mk.kind === 'truck' ? '🚚' : ''}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] });
      const marker = L.marker(mk.pos, { icon, zIndexOffset: mk.kind === 'truck' ? 1000 : 0 }).addTo(g);
      if (mk.label) marker.bindTooltip(mk.label, { direction: 'top', offset: [0, -10] });
      all.push(mk.pos);
    }
    const key = fitKey ?? String(all.length);
    if (all.length && fitted.current !== key) {
      fitted.current = key;
      m.fitBounds(L.latLngBounds(all).pad(0.15), { maxZoom: 10, animate: false });
    }
  }, [routes, markers, fitKey]);

  return <div ref={el} className="map" style={{ height }} />;
}

export function Logo() {
  return (
    <span className="logo">
      <svg viewBox="0 0 64 64" width="30" height="30" aria-hidden="true">
        <rect width="64" height="64" rx="15" fill="#1554d1" />
        <path d="M16 44c10 0 12-24 22-24h10" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
        <circle cx="48" cy="20" r="6.5" fill="#e5383b" stroke="#fff" strokeWidth="3" />
        <circle cx="16" cy="44" r="4.5" fill="#fff" />
      </svg>
      Jolda
    </span>
  );
}

export function LangSwitch() {
  const { lang, setLang } = useApp();
  return (
    <div className="lang" role="group" aria-label="Язык / Тіл">
      {(['ru', 'kz'] as Lang[]).map((l) => (
        <button key={l} className={lang === l ? 'on' : ''} onClick={() => setLang(l)}>
          {l === 'ru' ? 'РУС' : 'ҚАЗ'}
        </button>
      ))}
    </div>
  );
}
