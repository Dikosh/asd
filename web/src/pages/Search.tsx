// «Найти груз» и «Найти транспорт»: фильтр, сохранённые поиски, список и карта.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftRight, Bell, BellOff, HelpCircle, List, Map as MapIcon, Save, SlidersHorizontal, X } from 'lucide-react';
import { api, BODY_L, CARGO_L, COUNTRY_L, FLAG_L, Listing, LOADING_L, num, opts, PAY_L, t, useApp, useLoad } from '../core';
import { Chips, CitySelect, Empty, Field, Loading, MapView, Modal, Select, Tabs } from '../ui';
import { ListingCard } from '../listing';

type Filter = Record<string, string>;
const clean = (f: Filter) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '' && v != null));

export default function SearchPage() {
  const kind = useParams().kind === 'truck' ? 'truck' : 'cargo';
  const { meta, city, act, routeName } = useApp();
  const nav = useNavigate();
  // условия можно передать ссылкой: /search/cargo?from=almaty&to=astana
  const fromUrl = () => clean(Object.fromEntries(new URLSearchParams(location.search)));
  const [f, setF] = useState<Filter>(fromUrl);
  const [debounced, setDebounced] = useState<Filter>(fromUrl);
  const [notifyNew, setNotifyNew] = useState(true);
  const firstKind = useRef(kind);
  const [view, setView] = useState<'list' | 'map'>('list');
  const [panel, setPanel] = useState(false);
  const [hint, setHint] = useState(false);
  const [saveName, setSaveName] = useState<string | null>(null);
  const set = (k: string, v: string | null) => setF((x) => clean({ ...x, [k]: v ?? '' }));

  useEffect(() => {
    if (firstKind.current !== kind) setF({});
    firstKind.current = kind;
  }, [kind]);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(f), 250);
    return () => clearTimeout(id);
  }, [f]);
  const query = new URLSearchParams({ kind, ...debounced }).toString();
  const res = useLoad(() => api<{ total: number; items: Listing[] }>(`/listings?${query}`), [query]);
  const saved = useLoad(() => api<{ id: number; kind: string; name: string; params: Filter; notify: boolean }[]>('/searches'));
  const flag = (k: string, label: string) => (
    <label className="switch small"><input type="checkbox" checked={f[k] === '1'} onChange={(e) => set(k, e.target.checked ? '1' : '')} /><span>{label}</span></label>
  );
  const active = Object.keys(f).filter((k) => k !== 'sort').length;
  const foundLabel = kind === 'cargo' ? t('Найдено грузов: {n}', { n: res.data?.total ?? '…' }) : t('Найдено машин: {n}', { n: res.data?.total ?? '…' });

  const map = useMemo(() => {
    const items = (res.data?.items || []).slice(0, 60);
    return {
      routes: items.map((l) => ({ pts: l.points.map((p) => [city(p)!.lat, city(p)!.lon] as [number, number]), color: l.kind === 'cargo' ? '#1554d1' : '#e5383b', weight: 3 })),
      markers: items.flatMap((l) => [
        { pos: [city(l.fromId)!.lat, city(l.fromId)!.lon] as [number, number], kind: 'a' as const, label: routeName(l.points) },
        { pos: [city(l.toId)!.lat, city(l.toId)!.lon] as [number, number], kind: 'b' as const, label: routeName(l.points) },
      ]),
    };
  }, [res.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const defaultName = [f.from && city(f.from)?.ru, f.to && city(f.to)?.ru].filter(Boolean).join(' → ') || (kind === 'cargo' ? t('Все грузы') : t('Весь транспорт'));

  const filters = (
    <div className="filters">
      <div className="filters-head">
        <b>{t('Фильтр')}</b>
        <button className="link" onClick={() => setHint(true)}><HelpCircle size={15} /> {t('Как пользоваться')}</button>
      </div>
      <Field label={t('Место погрузки')}><CitySelect value={f.from || null} onChange={(v) => set('from', v)} placeholder={t('Любой город')} /></Field>
      <button className="swap" onClick={() => setF(clean({ ...f, from: f.to || '', to: f.from || '' }))} aria-label={t('Поменять местами')}><ArrowLeftRight size={15} /></button>
      <Field label={t('Место разгрузки')}><CitySelect value={f.to || null} onChange={(v) => set('to', v)} placeholder={t('Любой город')} /></Field>
      <Field label={t('Радиус от города')}>
        <Select value={f.radius || ''} onChange={(v) => set('radius', v)} placeholder={t('Только этот город')}
          options={[50, 100, 200, 300].map((r) => ({ value: String(r), label: `+ ${r} ${t('км')}` }))} />
      </Field>
      <div className="grid2">
        <Field label={t('Дата с')}><input type="date" value={f.dateFrom || ''} onChange={(e) => set('dateFrom', e.target.value)} /></Field>
        <Field label={t('Дата по')}><input type="date" value={f.dateTo || ''} onChange={(e) => set('dateTo', e.target.value)} /></Field>
      </div>
      <Field label={t('Тип кузова')}><Select value={f.body || ''} onChange={(v) => set('body', v)} placeholder={t('Любой')} options={opts(meta.body, BODY_L)} /></Field>
      {kind === 'cargo' && <Field label={t('Тип груза')}><Select value={f.cargoType || ''} onChange={(v) => set('cargoType', v)} placeholder={t('Любой')} options={opts(meta.cargo, CARGO_L)} /></Field>}
      <div className="grid2">
        <Field label={t('Вес от, т')}><input inputMode="decimal" value={f.wMin || ''} onChange={(e) => set('wMin', e.target.value)} /></Field>
        <Field label={t('Вес до, т')}><input inputMode="decimal" value={f.wMax || ''} onChange={(e) => set('wMax', e.target.value)} /></Field>
        <Field label={t('Объём от, м³')}><input inputMode="decimal" value={f.vMin || ''} onChange={(e) => set('vMin', e.target.value)} /></Field>
        <Field label={t('Объём до, м³')}><input inputMode="decimal" value={f.vMax || ''} onChange={(e) => set('vMax', e.target.value)} /></Field>
      </div>
      <div className="field">
        <span className="field-label">{t('Способ погрузки')}</span>
        <Chips options={opts(meta.loading, LOADING_L)} value={f.loading ? f.loading.split(',') : []} onChange={(v: string[]) => set('loading', v.join(','))} />
      </div>
      <div className="grid2">
        <Field label={t('Ставка от')}><input inputMode="numeric" value={f.rateMin || ''} onChange={(e) => set('rateMin', e.target.value.replace(/\D/g, ''))} /></Field>
        <Field label={t('Ставка до')}><input inputMode="numeric" value={f.rateMax || ''} onChange={(e) => set('rateMax', e.target.value.replace(/\D/g, ''))} /></Field>
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
        <Chips options={opts(meta.flags, FLAG_L)} value={f.flags ? f.flags.split(',') : []} onChange={(v: string[]) => set('flags', v.join(','))} />
      </div>
      <div className="field checks">
        <span className="field-label">{t('Показывать только')}</span>
        {flag('verified', t('от проверенных компаний'))}
        {flag('direct', kind === 'cargo' ? t('от прямых заказчиков') : t('от владельцев машин'))}
        {flag('partners', t('от моих партнёров'))}
        {flag('fresh', t('новые за сутки'))}
        {flag('withRate', t('с указанной ставкой'))}
        {flag('adr', t('опасные грузы (ADR)'))}
        {flag('intl', t('международные рейсы'))}
      </div>
      <Field label={t('Сортировка')}>
        <Select value={f.sort || 'new'} onChange={(v) => set('sort', v === 'new' ? '' : v)}
          options={[
            { value: 'new', label: t('Сначала новые') }, { value: 'rate_desc', label: t('Ставка: по убыванию') }, { value: 'rate_asc', label: t('Ставка: по возрастанию') },
            { value: 'rate_km', label: t('Выгоднее за километр') }, { value: 'date_asc', label: t('Ближайшая дата') }, { value: 'weight_desc', label: t('Больше вес') }, { value: 'distance_asc', label: t('Короче маршрут') },
          ]} />
      </Field>
      <div className="filters-actions">
        <button className="btn ghost" onClick={() => setF({})} disabled={!active && !f.sort}><X size={16} /> {t('Сбросить')}</button>
        <button className="btn soft" onClick={() => setSaveName(defaultName)}><Save size={16} /> {t('Сохранить поиск')}</button>
      </div>
      <button className="btn primary block only-s" onClick={() => setPanel(false)}>{t('Показать')} · {foundLabel}</button>
    </div>
  );

  return (
    <div className="stack">
      <div className="page-head">
        <Tabs items={[{ value: 'cargo', label: t('Найти груз') }, { value: 'truck', label: t('Найти транспорт') }]} value={kind} onChange={(v) => nav(`/search/${v}`)} />
        <div className="row">
          <button className="btn soft only-s" onClick={() => setPanel(true)}>
            <SlidersHorizontal size={16} /> {t('Фильтр')}{active > 0 && <span className="badge inline">{active}</span>}
          </button>
          <div className="seg">
            <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} aria-label={t('Список')}><List size={17} /></button>
            <button className={view === 'map' ? 'on' : ''} onClick={() => setView('map')} aria-label={t('Карта')}><MapIcon size={17} /></button>
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
                onClick={async () => (await act(() => api(`/searches/${s.id}`, 'PATCH', { notify: !s.notify }), s.notify ? t('Уведомления по поиску выключены') : t('Сообщим о новых объявлениях по этому поиску'))) && saved.reload()}
              >
                {s.notify ? <Bell size={13} /> : <BellOff size={13} />}
              </button>
              <button onClick={() => setF(s.params)}>{s.name}</button>
              <button aria-label={t('Удалить')} onClick={async () => (await act(() => api(`/searches/${s.id}`, 'DELETE'))) && saved.reload()}><X size={13} /></button>
            </span>
          ))}
        </div>
      )}

      <div className="search-layout">
        <aside className={`filter-panel card ${panel ? 'open' : ''}`}>
          <button className="icon-btn only-s panel-close" onClick={() => setPanel(false)} aria-label={t('Закрыть')}><X size={20} /></button>
          {filters}
        </aside>
        <section className="results">
          <div className="results-head">
            <b>{foundLabel}</b>
            {res.data && res.data.total > res.data.items.length && <span className="muted small">{t('показаны первые {n}', { n: res.data.items.length })}</span>}
          </div>
          {view === 'map' && <div className="card map-card"><MapView routes={map.routes} markers={map.markers} height={420} fitKey={query} /></div>}
          {res.loading && !res.data ? <Loading /> : (
            <div className="list">
              {res.data?.items.map((l) => <ListingCard key={l.id} l={l} onChange={res.reload} />)}
              {res.data?.total === 0 && (
                <div className="card">
                  <Empty title={t('Ничего не найдено')} text={t('Попробуйте увеличить радиус, убрать часть условий или сохранить поиск — и вернуться позже.')}>
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
