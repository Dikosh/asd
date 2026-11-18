// Перегон: машину или технику заказчика перегонщик ведёт своим ходом (например, погрузчик из Хоргоса на склад в 40 км).
// Заявка — обычное объявление вида 'relocation': отклик, чат, рейс с GPS и отзыв работают как у грузов.
// Здесь: поиск заявок, каталог перегонщиков, профиль «Я перегонщик» и короткая форма заявки.
import { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { CarFront, Plus, UserRound } from 'lucide-react';
import { api, Company, CUR, licenseLabel, Listing, num, opts, PAY_L, RELOC_VEHICLE_L, t, todayStr, useApp, useLoad } from '../core';
import { Chips, CitySelect, CompanyBadge, Empty, Field, Loading, Select, Tabs } from '../ui';
import { ContactButtons, ListingCard } from '../listing';

interface Profile { relocator: boolean; licenses: string[]; cityId: string | null; note: string }
interface Relocator { userId: number; name: string; cityId: string | null; km: number | null; licenses: string[]; note: string; done: number; phone: string | null; company: Company; mine: boolean }

export default function RelocationPage() {
  const { me } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const tab = new URLSearchParams(loc.search).get('tab') || 'requests';
  const teamDriver = me?.user.companyRole === 'driver';
  const profile = useLoad(() => api<Profile>('/relocator'), []);
  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">{t('Перегон')}</h1>
        {!teamDriver && <Link to="/relocation/new" className="btn primary"><Plus size={17} /> {t('Заказать перегон')}</Link>}
      </div>
      <p className="muted">{t('Перегонщик пригонит машину или технику своим ходом: из автосалона, с таможни, со стоянки — на ваш склад или объект. Заказчик видит машину на карте, как в обычном рейсе.')}</p>
      <Tabs
        items={[
          { value: 'requests', label: t('Заявки на перегон') },
          { value: 'drivers', label: t('Перегонщики') },
          ...(teamDriver ? [] : [{ value: 'profile', label: t('Я перегонщик') }]),
        ]}
        value={tab}
        onChange={(v) => nav(`/relocation${v === 'requests' ? '' : `?tab=${v}`}`, { replace: true })}
      />
      {tab === 'requests' && <Requests profile={profile.data} />}
      {tab === 'drivers' && <Drivers />}
      {tab === 'profile' && !teamDriver && (profile.data ? <ProfileForm initial={profile.data} onSaved={profile.reload} /> : <Loading />)}
      {tab === 'drivers' && <p className="muted small center"><Link to="/services?cat=relocation">{t('Компании, которые занимаются перегоном')}</Link> · <Link to="/services?cat=escort">{t('Сопровождение негабарита')}</Link></p>}
      <p className="muted small center"><Link to="/my/relocation">{t('Мои заявки на перегон')}</Link></p>
    </div>
  );
}

function Requests({ profile }: { profile: Profile | null }) {
  const { meta } = useApp();
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const myLic = profile?.licenses || [];
  const q = new URLSearchParams({ kind: 'relocation', ...(from && { from }), ...(to && { to }), ...(vehicle && { vehicle }), ...(mineOnly && myLic.length && { lic: myLic.join(',') }) });
  const { data, loading, reload } = useLoad(() => api<{ total: number; items: Listing[] }>(`/listings?${q}`), [q.toString()]);
  return (
    <>
      <div className="card form">
        <div className="grid2">
          <Field label={t('Откуда')}><CitySelect value={from} onChange={setFrom} placeholder={t('Любой город')} /></Field>
          <Field label={t('Куда')}><CitySelect value={to} onChange={setTo} placeholder={t('Любой город')} /></Field>
        </div>
        <Field label={t('Что перегнать')}>
          <Select value={vehicle} onChange={setVehicle} placeholder={t('Любая техника')} options={opts(meta.relocVehicles, RELOC_VEHICLE_L)} />
        </Field>
        {myLic.length > 0 && (
          <label className="switch">
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
            <span>{t('Только под мои права: {list}', { list: myLic.map(licenseLabel).join(', ') })}</span>
          </label>
        )}
      </div>
      {loading && !data ? <Loading /> : (
        <div className="list">
          <b>{t('Найдено заявок: {n}', { n: data?.total ?? 0 })}</b>
          {data?.items.map((l) => <ListingCard key={l.id} l={l} onChange={reload} />)}
          {data && data.total === 0 && (
            <div className="card">
              <Empty icon={<CarFront size={26} />} title={t('Заявок пока нет')}
                text={t('Включите «Я перегонщик», укажите город и права — мы пришлём уведомление, когда рядом появится подходящая заявка.')} />
            </div>
          )}
        </div>
      )}
    </>
  );
}

function Drivers() {
  const { meta, cityName } = useApp();
  const [cityId, setCityId] = useState<string | null>(null);
  const [lic, setLic] = useState('');
  const q = new URLSearchParams({ ...(cityId && { city: cityId }), ...(lic && { lic }) });
  const { data, loading } = useLoad(() => api<Relocator[]>(`/relocators?${q}`), [q.toString()]);
  return (
    <>
      <div className="card form">
        <div className="grid2">
          <Field label={t('Город')} hint={t('Покажем перегонщиков в радиусе 300 км')}><CitySelect value={cityId} onChange={setCityId} placeholder={t('Любой город')} /></Field>
          <Field label={t('Категория прав')}>
            <Select value={lic} onChange={setLic} placeholder={t('Любая')} options={meta.licenses.map((x) => ({ value: x, label: licenseLabel(x) }))} />
          </Field>
        </div>
      </div>
      {loading && !data ? <Loading /> : (
        <div className="list">
          {data?.map((r) => (
            <article key={r.userId} className="card stack-s">
              <div className="row between wrap">
                <b><UserRound size={16} /> {r.name}</b>
                <span className="muted small">
                  {r.cityId ? cityName(r.cityId) : ''}{r.km != null && r.km > 0 ? ` · ${t('{n} км от вас', { n: num(r.km) })}` : ''}
                </span>
              </div>
              <div className="chips">
                {r.licenses.map((x) => <span key={x} className="chip strong">{licenseLabel(x)}</span>)}
                <span className="chip light">{t('перегонов: {n}', { n: r.done })}</span>
              </div>
              {r.note && <p className="desc">{r.note}</p>}
              <div className="lcard-foot">
                <CompanyBadge c={r.company} />
                {!r.mine && (r.phone
                  ? <ContactButtons phone={r.phone} text={t('Здравствуйте! Нашёл вас в разделе «Перегон» на Jolda. Нужно перегнать машину.')} />
                  : <span className="muted small">{t('Телефон скрыт — разместите заявку, и перегонщик сможет откликнуться.')}</span>)}
              </div>
            </article>
          ))}
          {data && data.length === 0 && (
            <div className="card">
              <Empty icon={<UserRound size={26} />} title={t('Перегонщиков не найдено')}
                text={t('Разместите заявку на перегон — её увидят все перегонщики, а подходящим по городу и правам придёт уведомление.')}>
                <Link to="/relocation/new" className="btn primary">{t('Заказать перегон')}</Link>
              </Empty>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function ProfileForm({ initial, onSaved }: { initial: Profile; onSaved: () => void }) {
  const { meta, act } = useApp();
  const [p, setP] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (x: Partial<Profile>) => setP((v) => ({ ...v, ...x }));
  const missing = p.relocator ? (!p.cityId ? t('Укажите город, где вы находитесь') : !p.licenses.length ? t('Отметьте категории прав') : '') : '';
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || missing) return;
    setBusy(true);
    if (await act(() => api('/relocator', 'PUT', p), p.relocator ? t('Вы в каталоге перегонщиков') : t('Вы скрыты из каталога перегонщиков'))) onSaved();
    setBusy(false);
  };
  return (
    <form className="card form" onSubmit={save} noValidate>
      <label className="switch">
        <input type="checkbox" checked={p.relocator} onChange={(e) => set({ relocator: e.target.checked })} />
        <span>{t('Я перегонщик — показывать меня в каталоге и присылать подходящие заявки')}</span>
      </label>
      <div className="field">
        <span className="field-label">{t('Категории прав')}</span>
        <Chips options={meta.licenses.map((x) => ({ value: x, label: licenseLabel(x) }))} value={p.licenses} onChange={(v: string[]) => set({ licenses: v })} />
        <span className="field-hint">{t('Для погрузчиков, тракторов и экскаваторов нужно удостоверение тракториста-машиниста.')}</span>
      </div>
      <Field label={t('Где вы находитесь')} hint={t('Уведомления придут о заявках в радиусе 150 км от этого города')}>
        <CitySelect value={p.cityId} onChange={(id) => set({ cityId: id })} />
      </Field>
      <Field label={t('О себе (необязательно)')}>
        <textarea rows={3} value={p.note} onChange={(e) => set({ note: e.target.value })} maxLength={300} placeholder={t('Стаж, с какой техникой работали, готовность к дальним перегонам')} />
      </Field>
      {missing && <div className="field-error">{missing}</div>}
      <button className="btn primary block" disabled={busy || !!missing}>{t('Сохранить')}</button>
    </form>
  );
}

// ---------- заявка на перегон ----------
interface RForm {
  vehicleKind: string; brand: string; trucks: string; from: string | null; to: string | null; loadAddress: string; unloadAddress: string; loadTime: string;
  licenses: string[]; dateFrom: string; dateTo: string; rate: string; currency: string; payTerms: string[]; description: string;
}
const emptyForm = (): RForm => ({
  vehicleKind: '', brand: '', trucks: '1', from: null, to: null, loadAddress: '', unloadAddress: '', loadTime: '',
  licenses: [], dateFrom: todayStr(), dateTo: todayStr(7), rate: '', currency: 'KZT', payTerms: [], description: '',
});
const fromListing = (l: Listing, keepDates: boolean): RForm => ({
  vehicleKind: l.vehicleKind || '', brand: l.brand, trucks: String(l.trucks || 1), from: l.points[0], to: l.points[l.points.length - 1],
  loadAddress: l.loadAddress, unloadAddress: l.unloadAddress, loadTime: l.loadTime, licenses: l.licenses || [],
  dateFrom: keepDates ? l.dateFrom : todayStr(), dateTo: keepDates ? l.dateTo : todayStr(7), rate: l.rate ? String(l.rate) : '', currency: l.currency,
  payTerms: l.payTerms, description: l.description,
});

export function RelocationForm() {
  const { meta, toast, me } = useApp();
  const nav = useNavigate();
  const editId = Number(useParams().id) || null;
  const copyId = new URLSearchParams(useLocation().search).get('copy');
  const [f, setF] = useState<RForm | null>(editId || copyId ? null : emptyForm());
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    const src = editId || copyId;
    if (!src) return;
    api<Listing>(`/listings/${src}`).then((l) => {
      if (editId && l.company.id !== me?.company.id) {
        toast(t('Это не ваше объявление'), 'error');
        return nav('/my/relocation', { replace: true });
      }
      setF(fromListing(l, !!editId));
    }).catch(() => nav('/my/relocation', { replace: true }));
  }, [editId, copyId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!f) return <Loading />;
  const set = (x: Partial<RForm>) => {
    setF((v) => ({ ...v!, ...x }));
    setErr('');
  };
  const rate = f.rate.replace(/\s+/g, '');
  const n = Number(f.trucks);
  const errs: Record<string, string> = {};
  if (!f.vehicleKind) errs.vehicleKind = t('Укажите, что нужно перегнать');
  if (!f.brand.trim()) errs.brand = t('Укажите марку и модель');
  if (!Number.isInteger(n) || n < 1 || n > 50) errs.trucks = t('От 1 до 50 машин');
  if (!f.from) errs.from = t('Выберите город из списка');
  if (!f.to) errs.to = t('Выберите город из списка');
  else if (f.to === f.from) errs.to = t('Этот пункт совпадает с предыдущим');
  if (!f.dateFrom || !f.dateTo) errs.dateTo = t('Укажите даты');
  else if (f.dateTo < f.dateFrom) errs.dateTo = t('Дата окончания раньше даты начала');
  else if (f.dateTo < todayStr()) errs.dateTo = t('Эта дата уже прошла');
  if (rate && !/^\d+$/.test(rate)) errs.rate = t('Сумма — целое число без копеек, например 350000');
  const shown = (k: string) => (tried ? errs[k] : undefined);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (busy || Object.keys(errs).length) return;
    setBusy(true);
    const body = {
      kind: 'relocation', points: [f.from, f.to], vehicleKind: f.vehicleKind, brand: f.brand.trim(), trucks: n, licenses: f.licenses,
      loadAddress: f.loadAddress.trim(), unloadAddress: f.unloadAddress.trim(), loadTime: f.loadTime.trim(),
      dateFrom: f.dateFrom, dateTo: f.dateTo, rate: rate ? Number(rate) : null, currency: f.currency, payTerms: f.payTerms, description: f.description,
    };
    try {
      await (editId ? api(`/listings/${editId}`, 'PUT', body) : api('/listings', 'POST', body));
      toast(editId ? t('Изменения сохранены') : t('Заявка на перегон размещена'));
      nav('/my/relocation', { replace: true });
    } catch (x: any) {
      setErr(t(x.message));
    }
    setBusy(false);
  };
  const Err = ({ k }: { k: string }) => (shown(k) ? <span className="field-error">{shown(k)}</span> : null);
  return (
    <div className="narrow stack">
      <h1 className="page-title">{editId ? t('Изменить заявку на перегон') : t('Заказать перегон')}</h1>
      <form className="card form" onSubmit={save} noValidate>
        <Field label={t('Что перегнать')}>
          <Select value={f.vehicleKind} onChange={(v) => set({ vehicleKind: v })} placeholder={t('Выберите')} options={opts(meta.relocVehicles, RELOC_VEHICLE_L)} />
          <Err k="vehicleKind" />
        </Field>
        <Field label={t('Марка и модель')}>
          <input value={f.brand} onChange={(e) => set({ brand: e.target.value })} maxLength={60} placeholder={t('Например: погрузчик Hyundai 50D')} />
          <Err k="brand" />
        </Field>
        <Field label={t('Сколько машин')} hint={t('На каждую — свой перегонщик и свой рейс')}>
          <input inputMode="numeric" value={f.trucks} onChange={(e) => set({ trucks: e.target.value.replace(/\D/g, '') })} maxLength={2} />
          <Err k="trucks" />
        </Field>
        <div className="grid2">
          <Field label={t('Откуда забрать')}><CitySelect value={f.from} onChange={(id) => set({ from: id })} error={shown('from')} /></Field>
          <Field label={t('Куда доставить')}><CitySelect value={f.to} onChange={(id) => set({ to: id })} error={shown('to')} /></Field>
        </div>
        <Field label={t('Адрес, где забрать машину (необязательно)')}>
          <input value={f.loadAddress} onChange={(e) => set({ loadAddress: e.target.value })} maxLength={200} placeholder={t('Таможенный склад, автосалон, стоянка…')} />
        </Field>
        <Field label={t('Адрес, куда доставить (необязательно)')}>
          <input value={f.unloadAddress} onChange={(e) => set({ unloadAddress: e.target.value })} maxLength={200} placeholder={t('Улица, дом, склад или ориентир')} />
        </Field>
        <div className="field">
          <span className="field-label">{t('Какие права нужны перегонщику')}</span>
          <Chips options={meta.licenses.map((x) => ({ value: x, label: licenseLabel(x) }))} value={f.licenses} onChange={(v: string[]) => set({ licenses: v })} />
          <span className="field-hint">{t('Погрузчик, трактор, экскаватор — удостоверение тракториста-машиниста; грузовик — C или CE.')}</span>
        </div>
        <div className="grid2">
          <Field label={t('Дата с')}><input type="date" value={f.dateFrom} min={editId ? undefined : todayStr()} onChange={(e) => set({ dateFrom: e.target.value })} /></Field>
          <Field label={t('Дата по')}><input type="date" value={f.dateTo} min={f.dateFrom} onChange={(e) => set({ dateTo: e.target.value })} /><Err k="dateTo" /></Field>
        </div>
        <Field label={t('Когда забрать (необязательно)')}>
          <input value={f.loadTime} onChange={(e) => set({ loadTime: e.target.value })} maxLength={40} placeholder={t('Например: 9:00–13:00')} />
        </Field>
        <div className="grid2">
          <Field label={t('Оплата перегонщику')} hint={t('Пусто — договорная')}>
            <input inputMode="numeric" value={f.rate} onChange={(e) => set({ rate: e.target.value.replace(/[^\d\s]/g, '') })} maxLength={14} placeholder="40000" />
            <Err k="rate" />
          </Field>
          <Field label={t('Валюта')}>
            <Select value={f.currency} onChange={(v) => set({ currency: v })} options={meta.currencies.map((c) => ({ value: c, label: `${c} (${CUR[c]})` }))} />
          </Field>
        </div>
        <div className="field">
          <span className="field-label">{t('Условия оплаты')}<span className="opt"> · {t('необязательно')}</span></span>
          <Chips options={opts(meta.pay, PAY_L)} value={f.payTerms} onChange={(v) => set({ payTerms: v })} />
        </div>
        <Field label={t('Описание (необязательно)')}>
          <textarea rows={3} value={f.description} onChange={(e) => set({ description: e.target.value })} maxLength={2000}
            placeholder={t('Состояние техники, есть ли номера и документы, кто оплачивает топливо…')} />
        </Field>
        {err && <div className="form-error" role="alert">{err}</div>}
        {tried && Object.keys(errs).length > 0 && <div className="form-error" role="alert">{t('Проверьте поля, отмеченные красным')}</div>}
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={() => nav(-1)}>{t('Отмена')}</button>
          <button className="btn primary" disabled={busy}>{editId ? t('Сохранить') : t('Разместить')}</button>
        </div>
      </form>
      <p className="muted small">{t('Перегонщики рядом с пунктом отправления и с нужными правами получат уведомление о заявке.')}</p>
    </div>
  );
}
