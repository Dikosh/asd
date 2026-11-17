// «Мои грузы» и «Мои машины»: списки по статусам и размещение в 4 шага.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, ArrowLeft, ArrowRight, Check, Package, Pencil, Plus, RotateCcw, Trash2, Truck, Users, Zap } from 'lucide-react';
import { api, BODY_L, CARGO_L, CUR, fmtDates, Listing, LOADING_L, money, num, opts, PAY_L, t, todayStr, useApp, useLoad } from '../core';
import { Chips, CitySelect, Empty, Field, Loading, Select, Tabs } from '../ui';
import { ListingCard } from '../listing';

type Kind = 'cargo' | 'truck';

export default function MyListings() {
  const kind = (useParams().kind === 'truck' ? 'truck' : 'cargo') as Kind;
  const { act, meta, reloadMe } = useApp();
  const nav = useNavigate();
  const [status, setStatus] = useState('active');
  const { data, loading, reload } = useLoad(() => api<Listing[]>(`/listings/mine?kind=${kind}`), [kind]);
  const by = (s: string) => (data || []).filter((l) => l.status === s);
  const setSt = async (l: Listing, s: string, ok: string) => (await act(() => api(`/listings/${l.id}/status`, 'POST', { status: s }), ok)) && reload();
  const boost = async (l: Listing) => {
    if (!confirm(t('Поднять объявление в топ на 24 часа за {n} ₸ с баланса компании?', { n: meta.boostPrice }))) return;
    if (await act(() => api(`/listings/${l.id}/boost`, 'POST'), t('Объявление поднято в топ'))) {
      reload();
      reloadMe();
    }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <Tabs
          items={[{ value: 'cargo', label: t('Мои грузы') }, { value: 'truck', label: t('Мои машины') }]}
          value={kind}
          onChange={(v) => nav(`/my/${v}`)}
        />
        <Link to={`/my/${kind}/new`} className="btn primary"><Plus size={17} /> {kind === 'cargo' ? t('Разместить груз') : t('Разместить транспорт')}</Link>
      </div>
      <Tabs
        items={[
          { value: 'active', label: t('Активные'), count: by('active').length },
          { value: 'closed', label: t('Закрытые'), count: by('closed').length },
          { value: 'archived', label: t('Архив'), count: by('archived').length },
        ]}
        value={status}
        onChange={setStatus}
      />
      {loading ? <Loading /> : (
        <div className="list">
          {by(status).map((l) => (
            <ListingCard
              key={l.id}
              l={l}
              onChange={reload}
              footer={
                <>
                  {l.status === 'active' && (
                    <>
                      <Link to={`/listing/${l.id}`} className="btn soft"><Users size={16} /> {t('Отклики')}{l.responsesCount > 0 && <span className="badge inline">{l.responsesCount}</span>}</Link>
                      {l.tripId ? (
                        <Link to={`/trip/${l.tripId}`} className="btn primary">{t('Открыть рейс')}</Link>
                      ) : (
                        <>
                          {!l.boosted && <button className="btn soft" onClick={() => boost(l)}><Zap size={16} /> <span className="hide-s">{t('В топ')}</span></button>}
                          <Link to={`/my/${kind}/${l.id}/edit`} className="btn soft" aria-label={t('Изменить')}><Pencil size={16} /></Link>
                          <button className="btn soft" onClick={() => setSt(l, 'closed', t('Объявление закрыто'))}><Check size={16} /> <span className="hide-s">{t('Закрыть')}</span></button>
                        </>
                      )}
                    </>
                  )}
                  {l.status === 'closed' && (
                    <>
                      <button className="btn soft" onClick={() => nav(`/my/${kind}/new?copy=${l.id}`)}><RotateCcw size={16} /> {t('Разместить снова')}</button>
                      <button className="btn soft" onClick={() => setSt(l, 'archived', t('Перенесено в архив'))}><Archive size={16} /> {t('В архив')}</button>
                    </>
                  )}
                  {l.status === 'archived' && <button className="btn soft" onClick={() => nav(`/my/${kind}/new?copy=${l.id}`)}><RotateCcw size={16} /> {t('Разместить снова')}</button>}
                </>
              }
            />
          ))}
          {by(status).length === 0 && (
            <div className="card">
              <Empty
                icon={kind === 'cargo' ? <Package size={26} /> : <Truck size={26} />}
                title={status === 'active' ? (kind === 'cargo' ? t('У вас нет активных грузов') : t('У вас нет активного транспорта')) : t('Здесь пока пусто')}
                text={status === 'active' ? t('Разместите объявление — это занимает четыре коротких шага.') : status === 'closed' ? t('Сюда попадают объявления после завершения работы заказчика и перевозчика.') : t('Архив хранит историю закрытых объявлений.')}
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
  dateFrom: string; dateTo: string; payTerms: string[]; withRate: boolean; rate: string; currency: string; description: string;
}
const empty = (): Form => ({
  points: [null, null], brand: '', bodyType: null, cargoType: null, weight: '', volume: '', loading: [],
  dateFrom: todayStr(), dateTo: todayStr(7), payTerms: [], withRate: true, rate: '', currency: 'KZT', description: '',
});
const fromListing = (l: Listing, keepDates: boolean): Form => ({
  points: l.points, brand: l.brand, bodyType: l.bodyType, cargoType: l.cargoType, weight: l.weight?.toString() || '', volume: l.volume?.toString() || '',
  loading: l.loading, dateFrom: keepDates ? l.dateFrom : todayStr(), dateTo: keepDates ? l.dateTo : todayStr(7), payTerms: l.payTerms,
  withRate: l.rate != null, rate: l.rate?.toString() || '', currency: l.currency, description: l.description,
});
const toNum = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

export function ListingForm() {
  const params = useParams();
  const kind = (params.kind === 'truck' ? 'truck' : 'cargo') as Kind;
  const editId = params.id ? Number(params.id) : null;
  const copyId = new URLSearchParams(location.search).get('copy');
  const { meta, act, cityName, city } = useApp();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [f, setF] = useState<Form>(empty);
  const [ready, setReady] = useState(!editId && !copyId);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const vehicles = useLoad(() => (kind === 'truck' ? api<any[]>('/vehicles') : Promise.resolve([])), [kind]);
  const set = (patch: Partial<Form>) => setF((x) => ({ ...x, ...patch }));

  useEffect(() => {
    const src = editId || copyId;
    if (!src) return;
    api<Listing>(`/listings/${src}`).then((l) => {
      setF(fromListing(l, !!editId));
      setReady(true);
    }).catch(() => nav(`/my/${kind}`));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pts = f.points.filter(Boolean) as string[];
  const errors = [
    f.points.some((p) => !p) ? t('Укажите все пункты маршрута') : pts.some((p, i) => i > 0 && p === pts[i - 1]) ? t('Соседние пункты маршрута совпадают') : '',
    kind === 'truck' && !f.brand.trim() ? t('Укажите марку транспорта') : [f.weight, f.volume].some((x) => x && !(Number(x.replace(',', '.')) > 0)) ? t('Вес и объём должны быть больше нуля') : '',
    !f.dateFrom || !f.dateTo ? t('Укажите период размещения') : f.dateTo < f.dateFrom ? t('Дата окончания раньше даты начала') : f.withRate && !(Number(f.rate) > 0) ? t('Введите сумму ставки или выберите «Без ставки»') : '',
    '',
  ];
  const km = pts.length === f.points.length && pts.length > 1
    ? Math.round(pts.slice(1).reduce((s, p, i) => s + dist(city(pts[i])!, city(p)!), 0) * 1.22)
    : 0;

  const save = async () => {
    setBusy(true);
    const body = {
      kind, points: pts, brand: f.brand, bodyType: f.bodyType, cargoType: kind === 'cargo' ? f.cargoType : null, weight: toNum(f.weight), volume: toNum(f.volume),
      loading: f.loading, dateFrom: f.dateFrom, dateTo: f.dateTo, payTerms: f.payTerms, rate: f.withRate ? toNum(f.rate) : null, currency: f.currency, description: f.description,
    };
    const ok = await act(() => (editId ? api(`/listings/${editId}`, 'PUT', body) : api('/listings', 'POST', body)), editId ? t('Изменения сохранены') : t('Объявление размещено'));
    setBusy(false);
    if (ok) nav(`/my/${kind}`);
  };

  const steps = [t('Маршрут'), kind === 'cargo' ? t('Характеристики груза') : t('Характеристики машины'), t('Даты и оплата'), t('Описание')];
  if (!ready) return <Loading />;

  return (
    <div className="narrow stack">
      <h1 className="page-title">{editId ? t('Изменить объявление') : kind === 'cargo' ? t('Разместить груз') : t('Разместить транспорт')}</h1>
      <ol className="stepper">
        {steps.map((s, i) => (
          <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>
            <button type="button" disabled={i > step} onClick={() => setStep(i)}>
              <span className="step-n">{i < step ? <Check size={14} /> : i + 1}</span>
              <span className="step-l">{s}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="card form">
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
                  <CitySelect value={p} onChange={(id) => set({ points: f.points.map((x, k) => (k === i ? id : x)) })} />
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
          </>
        )}

        {step === 1 && (
          <>
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
                <Field label={t('Марка транспорта')}>
                  <input value={f.brand} onChange={(e) => set({ brand: e.target.value })} placeholder="Volvo FH, DAF XF, КамАЗ…" maxLength={60} />
                </Field>
              </>
            )}
            {kind === 'cargo' && (
              <Field label={t('Тип груза')}>
                <Select value={f.cargoType || ''} onChange={(v) => set({ cargoType: v || null })} placeholder={t('Не выбран')} options={opts(meta.cargo, CARGO_L)} />
              </Field>
            )}
            <Field label={kind === 'cargo' ? t('Нужный тип кузова') : t('Тип кузова')}>
              <Select value={f.bodyType || ''} onChange={(v) => set({ bodyType: v || null })} placeholder={kind === 'cargo' ? t('Любой') : t('Не выбран')} options={opts(meta.body, BODY_L)} />
            </Field>
            <div className="grid2">
              <Field label={t('Вес, т')}><input inputMode="decimal" value={f.weight} onChange={(e) => set({ weight: e.target.value })} placeholder="20" /></Field>
              <Field label={t('Объём, м³')}><input inputMode="decimal" value={f.volume} onChange={(e) => set({ volume: e.target.value })} placeholder="82" /></Field>
            </div>
            <div className="field">
              <span className="field-label">{kind === 'cargo' ? t('Тип загрузки — какая нужна') : t('Тип загрузки — по устройству машины')}</span>
              <Chips options={opts(meta.loading, LOADING_L)} value={f.loading} onChange={(v) => set({ loading: v })} />
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="grid2">
              <Field label={t('Дата с')}><input type="date" value={f.dateFrom} min={editId ? undefined : todayStr()} onChange={(e) => set({ dateFrom: e.target.value })} /></Field>
              <Field label={t('Дата по')}><input type="date" value={f.dateTo} min={f.dateFrom} onChange={(e) => set({ dateTo: e.target.value })} /></Field>
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
              <div className="grid2">
                <Field label={t('Сумма')} hint={km > 0 && Number(f.rate) > 0 && f.currency === 'KZT' ? `≈ ${num(Math.round(Number(f.rate) / km))} ₸/${t('км')}` : undefined}>
                  <input inputMode="numeric" value={f.rate} onChange={(e) => set({ rate: e.target.value.replace(/[^\d]/g, '') })} placeholder="350000" />
                </Field>
                <Field label={t('Валюта')}>
                  <Select value={f.currency} onChange={(v) => set({ currency: v })} options={meta.currencies.map((c) => ({ value: c, label: `${c} (${CUR[c]})` }))} />
                </Field>
              </div>
            )}
            <div className="field">
              <span className="field-label">{t('Условия оплаты')}</span>
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
              <span>{num(km)} {t('км')} · {fmtDates(f.dateFrom, f.dateTo)}</span>
              <span>
                {[kind === 'truck' ? f.brand : f.cargoType && t(CARGO_L[f.cargoType]), f.bodyType && t(BODY_L[f.bodyType]), f.weight && `${f.weight} ${t('т')}`, f.volume && `${f.volume} ${t('м³')}`,
                  ...f.loading.map((x) => t(LOADING_L[x]))].filter(Boolean).join(' · ')}
              </span>
              <span>{money(f.withRate ? Number(f.rate) : null, f.currency)}{f.payTerms.length ? ` · ${f.payTerms.map((p) => t(PAY_L[p])).join(', ')}` : ''}</span>
            </div>
          </>
        )}

        {tried && errors[step] && <div className="form-error" role="alert">{errors[step]}</div>}
        <div className="row between form-actions">
          <button type="button" className="btn ghost" onClick={() => nav(`/my/${kind}`)}>{t('Отмена')}</button>
          <div className="row">
            {step > 0 && <button type="button" className="btn soft" onClick={() => setStep(step - 1)}><ArrowLeft size={16} /> {t('Назад')}</button>}
            {step < 3 ? (
              <button type="button" className="btn primary" onClick={() => (errors[step] ? setTried(true) : (setTried(false), setStep(step + 1)))}>{t('Далее')} <ArrowRight size={16} /></button>
            ) : (
              <button type="button" className="btn primary" disabled={busy || errors.some(Boolean)} onClick={save}>{editId ? t('Сохранить') : t('Сохранить и выставить')}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function dist(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
