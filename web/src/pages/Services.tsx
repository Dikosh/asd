// Каталог услуг: перегонщики, машины сопровождения негабарита, таможенные брокеры.
// Исполнитель размещает карточку и оплачивает показ с баланса компании; заказчики звонят ему напрямую.
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Plus, Trash2, Pencil, Megaphone, MapPin, Eye } from 'lucide-react';
import { api, Company, fmtDate, money, t, useApp, useLoad } from '../core';
import { CitySelect, CompanyBadge, Empty, Field, Loading, Modal, Select, Tabs } from '../ui';
import { ContactButtons } from '../listing';

export const SERVICE_L: Record<string, string> = {
  relocation: 'Перегон машин и техники', escort: 'Сопровождение негабаритных грузов', broker: 'Таможенный брокер',
};
const SERVICE_HINT: Record<string, string> = {
  relocation: 'Перегонщики с правами нужных категорий пригонят машину, тягач или спецтехнику своим ходом.',
  escort: 'Машины прикрытия с проблесковыми маячками и табличкой «Крупногабаритный груз» — по закону нужны для негабарита.',
  broker: 'Таможенное оформление, декларации, сертификаты, СВХ.',
};
interface Service {
  id: number; category: string; title: string; cities: string[]; allCountry: boolean; description: string; phone: string;
  paidUntil: string | null; active: boolean; mine: boolean; views?: number; company: Company;
}
const CATS = ['relocation', 'escort', 'broker'];
// короткие названия для вкладок — длинные не помещаются на телефоне
const TAB_L: Record<string, string> = { relocation: 'Перегон', escort: 'Сопровождение негабарита', broker: 'Таможенный брокер' };

export default function ServicesPage() {
  const { me } = useApp();
  const nav = useNavigate();
  const tab = new URLSearchParams(useLocation().search).get('cat') || 'relocation';
  const [form, setForm] = useState<Partial<Service> | null>(null);
  const teamDriver = me?.user.companyRole === 'driver';
  const mine = useLoad(() => api<{ price: number; days: number; items: Service[] }>('/services/mine'), []);
  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">{t('Услуги')}</h1>
        {!teamDriver && <button className="btn primary" onClick={() => setForm({ category: CATS.includes(tab) ? tab : 'relocation' })}><Plus size={17} /> {t('Разместить свою компанию')}</button>}
      </div>
      <Tabs
        items={[...CATS.map((c) => ({ value: c, label: t(TAB_L[c]) })), ...(teamDriver ? [] : [{ value: 'mine', label: t('Мои карточки'), count: mine.data?.items.length }])]}
        value={tab}
        onChange={(v) => nav(`/services?cat=${v}`, { replace: true })}
      />
      {tab === 'mine' ? <Mine data={mine.data} reload={mine.reload} onEdit={setForm} /> : <Catalog cat={tab} onAdd={() => setForm({ category: tab })} />}
      {form && <ServiceForm initial={form} price={mine.data?.price} onClose={() => setForm(null)} onSaved={() => { setForm(null); mine.reload(); nav('/services?cat=mine', { replace: true }); }} />}
    </div>
  );
}

function Cities({ s }: { s: Service }) {
  const { cityName } = useApp();
  if (s.allCountry) return <span className="muted small"><MapPin size={13} /> {t('Весь Казахстан')}</span>;
  const shown = s.cities.slice(0, 6).map(cityName).join(', ');
  return <span className="muted small"><MapPin size={13} /> {shown}{s.cities.length > 6 ? ` ${t('и ещё {n}', { n: s.cities.length - 6 })}` : ''}</span>;
}

function Catalog({ cat, onAdd }: { cat: string; onAdd: () => void }) {
  const [city, setCity] = useState<string | null>(null);
  const { data, loading } = useLoad(() => api<Service[]>(`/services?category=${cat}${city ? `&city=${city}` : ''}`), [cat, city]);
  return (
    <>
      <p className="muted">{t(SERVICE_HINT[cat] || '')}</p>
      {cat === 'relocation' && <p className="muted small">{t('Нужен перегон конкретной машины? Разместите заявку в разделе «Перегон» — перегонщики сами откликнутся.')} <Link to="/relocation">{t('Перейти в «Перегон»')}</Link></p>}
      <div className="card form">
        <Field label={t('Город')}><CitySelect value={city} onChange={setCity} placeholder={t('Любой город')} /></Field>
      </div>
      {loading && !data ? <Loading /> : (
        <div className="list">
          {data?.map((s) => (
            <article key={s.id} className="card stack-s">
              <b>{s.title}</b>
              <Cities s={s} />
              {s.description && <p className="desc">{s.description}</p>}
              <div className="lcard-foot">
                <CompanyBadge c={s.company} />
                {!s.mine && s.phone && (
                  <div onClickCapture={() => { api(`/services/${s.id}/view`, 'POST').catch(() => {}); }}>
                    <ContactButtons phone={s.phone} text={t('Здравствуйте! Нашёл вас в каталоге услуг Timma.')} />
                  </div>
                )}
              </div>
            </article>
          ))}
          {data && data.length === 0 && (
            <div className="card">
              <Empty icon={<Megaphone size={26} />} title={t('Здесь пока никого нет')} text={t('Оказываете такие услуги? Разместите карточку компании — заказчики будут звонить вам напрямую.')}>
                <button className="btn primary" onClick={onAdd}>{t('Разместить свою компанию')}</button>
              </Empty>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function Mine({ data, reload, onEdit }: { data: { price: number; days: number; items: Service[] } | null; reload: () => void; onEdit: (s: Service) => void }) {
  const { act, me, reloadMe } = useApp();
  const owner = me?.user.companyRole === 'owner';
  if (!data) return <Loading />;
  const pay = async (s: Service) => {
    if (!confirm(t('Оплатить показ карточки на {d} дней за {n}? Сумма спишется с баланса компании.', { d: data.days, n: money(data.price) }))) return;
    if (await act(() => api(`/services/${s.id}/pay`, 'POST'), t('Карточка показывается в каталоге'))) {
      reload();
      reloadMe();
    }
  };
  const remove = async (s: Service) => {
    if (!confirm(t('Удалить карточку? Оплаченные дни не возвращаются.'))) return;
    if (await act(() => api(`/services/${s.id}`, 'DELETE'), t('Карточка удалена'))) reload();
  };
  return (
    <div className="list">
      <p className="muted">{t('Показ в каталоге стоит {n} за {d} дней. Оплата — с баланса компании, продление прибавляется к оставшемуся сроку.', { n: money(data.price), d: data.days })} {owner && <Link to="/cabinet/balance">{t('Пополнить баланс')}</Link>}</p>
      {data.items.map((s) => (
        <article key={s.id} className="card stack-s">
          <div className="row between wrap">
            <span className="tag">{t(SERVICE_L[s.category])}</span>
            <span className={`status ${s.active ? 'accepted' : 'declined'}`}>{s.active ? t('В каталоге до {d}', { d: fmtDate(s.paidUntil!) }) : t('Не показывается — не оплачено')}</span>
          </div>
          <b>{s.title}</b>
          <Cities s={s} />
          {s.description && <p className="desc">{s.description}</p>}
          {s.active && <span className="muted small"><Eye size={13} /> {t('обращений: {n}', { n: s.views ?? 0 })}</span>}
          <div className="row wrap">
            {owner
              ? <button className="btn primary" onClick={() => pay(s)}>{s.active ? t('Продлить на {d} дней', { d: data.days }) : t('Оплатить показ — {n}', { n: money(data.price) })}</button>
              : <span className="muted small">{t('Оплатить показ может владелец компании.')}</span>}
            <button className="btn soft" onClick={() => onEdit(s)}><Pencil size={16} /> {t('Изменить')}</button>
            <button className="btn ghost" onClick={() => remove(s)}><Trash2 size={16} /> {t('Удалить')}</button>
          </div>
        </article>
      ))}
      {data.items.length === 0 && (
        <div className="card"><Empty icon={<Megaphone size={26} />} title={t('У вас пока нет карточек')} text={t('Разместите карточку компании, чтобы заказчики находили вас в каталоге услуг.')} /></div>
      )}
    </div>
  );
}

function ServiceForm({ initial, price, onClose, onSaved }: { initial: Partial<Service>; price?: number; onClose: () => void; onSaved: () => void }) {
  const { act, cityName } = useApp();
  const [f, setF] = useState({
    category: initial.category || 'relocation', title: initial.title || '', cities: initial.cities || [], allCountry: !!initial.allCountry,
    description: initial.description || '', phone: initial.phone || '',
  });
  const [add, setAdd] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (x: Partial<typeof f>) => setF((v) => ({ ...v, ...x }));
  const problem = f.title.trim().length < 3 ? t('Название: не короче 3 символов') : !f.allCountry && !f.cities.length ? t('Укажите города, где вы работаете, или отметьте «Вся страна»') : '';
  const save = async () => {
    if (busy || problem) return;
    setBusy(true);
    const ok = await act(() => (initial.id ? api(`/services/${initial.id}`, 'PUT', f) : api('/services', 'POST', f)),
      initial.id ? t('Изменения сохранены') : t('Карточка создана — оплатите показ, чтобы она появилась в каталоге'));
    setBusy(false);
    if (ok) onSaved();
  };
  return (
    <Modal title={initial.id ? t('Изменить карточку') : t('Разместить свою компанию')} onClose={() => !busy && onClose()}>
      {!initial.id && price != null && <p className="muted small">{t('Карточка появится в каталоге после оплаты показа: {n} за 30 дней.', { n: money(price) })}</p>}
      <Field label={t('Услуга')}>
        <Select value={f.category} onChange={(v) => set({ category: v })} options={CATS.map((c) => ({ value: c, label: t(SERVICE_L[c]) }))} />
      </Field>
      <Field label={t('Название')}>
        <input value={f.title} onChange={(e) => set({ title: e.target.value })} maxLength={100}
          placeholder={f.category === 'escort' ? t('Например: Сопровождение негабарита 24/7') : f.category === 'broker' ? t('Например: Таможенное оформление на Хоргосе') : t('Например: Перегон спецтехники по Казахстану')} />
      </Field>
      <label className="switch">
        <input type="checkbox" checked={f.allCountry} onChange={(e) => set({ allCountry: e.target.checked })} />
        <span>{t('Вся страна')}</span>
      </label>
      {!f.allCountry && (
        <div className="field">
          <span className="field-label">{t('Города, где вы работаете')}</span>
          <div className="chips">
            {f.cities.map((c) => (
              <button type="button" key={c} className="chip on" onClick={() => set({ cities: f.cities.filter((x) => x !== c) })} aria-label={t('Удалить пункт')}>{cityName(c)} ×</button>
            ))}
          </div>
          {f.cities.length < 20 && <CitySelect value={add} placeholder={t('Добавить город')} onChange={(id) => { if (id && !f.cities.includes(id)) set({ cities: [...f.cities, id] }); setAdd(null); }} />}
        </div>
      )}
      <Field label={t('Описание (необязательно)')}>
        <textarea rows={4} value={f.description} onChange={(e) => set({ description: e.target.value })} maxLength={1500}
          placeholder={f.category === 'escort' ? t('Сколько машин прикрытия, маячки и табличка, опыт с тралами, работа ночью') : f.category === 'broker' ? t('Какие посты и режимы, сроки, сертификация') : t('Категории прав, с какой техникой работаете, дальние перегоны')} />
      </Field>
      <Field label={t('Телефон для заказчиков')} hint={t('Если не указать — ваш номер из профиля')}>
        <input value={f.phone} onChange={(e) => set({ phone: e.target.value })} inputMode="tel" maxLength={20} placeholder="+7 701 123 45 67" />
      </Field>
      {problem && (f.title || initial.id) && <div className="field-error">{problem}</div>}
      <div className="row end">
        <button className="btn ghost" onClick={onClose}>{t('Отмена')}</button>
        <button className="btn primary" disabled={busy || !!problem} onClick={save}>{t('Сохранить')}</button>
      </div>
    </Modal>
  );
}
