// Раздел «Заказчики»: крупные компании со своими сайтами заявок на перевозку.
// Перевозчик в один клик переходит на сайт компании. Карточки ведёт администратор — только после договорённости.
import { useState } from 'react';
import { Building, ExternalLink, EyeOff, MapPin, MousePointerClick, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { api, CARGO_L, num, opts, prepareUpload, t, useApp, useLoad } from '../core';
import { Chips, CitySelect, Empty, Field, Loading, Modal } from '../ui';

interface Shipper {
  id: number; name: string; url: string; about: string; cities: string[]; cargo: string[]; logo: string | null;
  visible?: boolean; clicks?: number; sort?: number;
}

export default function ShippersPage() {
  const { me, act } = useApp();
  const isAdmin = !!me?.user.isAdmin;
  const { data, loading, reload } = useLoad(() => api<Shipper[]>('/shippers'), []);
  const [form, setForm] = useState<Partial<Shipper> | null>(null);
  const remove = async (s: Shipper) => confirm(t('Удалить компанию «{name}» из раздела?', { name: s.name })) && (await act(() => api(`/admin/shippers/${s.id}`, 'DELETE'), t('Удалено'))) && reload();
  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">{t('Заказчики')}</h1>
        {isAdmin && <button className="btn primary" onClick={() => setForm({ visible: true })}><Plus size={17} /> {t('Добавить компанию')}</button>}
      </div>
      <p className="muted">{t('Крупные компании, которые сами размещают заявки на перевозку. Нажмите «Перейти к заявкам» — откроется сайт компании.')}</p>
      {isAdmin && <p className="muted small">{t('Добавляйте компанию только после договорённости с ней: название и логотип здесь выглядят как партнёрство. Скрытые карточки видит только администратор.')}</p>}
      {loading && !data ? <Loading /> : (
        <div className="shipper-grid">
          {data?.map((s) => <ShipperCard key={s.id} s={s} admin={isAdmin} onEdit={() => setForm(s)} onRemove={() => remove(s)} />)}
          {data && data.length === 0 && (
            <div className="card">
              <Empty icon={<Building size={26} />} title={t('Здесь пока никого нет')}
                text={isAdmin ? t('Раздел скрыт из меню, пока в нём нет ни одной видимой компании.') : t('Скоро здесь появятся крупные заказчики со своими заявками.')} />
            </div>
          )}
        </div>
      )}
      {form && <ShipperForm initial={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} />}
    </div>
  );
}

// логотип не загрузился — показываем первую букву названия, а не значок сломанной картинки
function Logo({ src, name }: { src: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  return src && !broken ? <img src={src} alt="" onError={() => setBroken(true)} /> : <span>{name.slice(0, 1).toUpperCase()}</span>;
}

function ShipperCard({ s, admin, onEdit, onRemove }: { s: Shipper; admin: boolean; onEdit: () => void; onRemove: () => void }) {
  const { cityName } = useApp();
  return (
    <article className={`card shipper ${admin && !s.visible ? 'dim' : ''}`}>
      <div className="shipper-head">
        <div className="shipper-logo"><Logo src={s.logo} name={s.name} /></div>
        <div className="grow">
          <b>{s.name}</b>
          {s.cities.length > 0 && <div className="muted small"><MapPin size={13} /> {s.cities.slice(0, 5).map(cityName).join(', ')}{s.cities.length > 5 ? ` ${t('и ещё {n}', { n: s.cities.length - 5 })}` : ''}</div>}
        </div>
      </div>
      {s.about && <p className="desc">{s.about}</p>}
      {s.cargo.length > 0 && <div className="chips">{s.cargo.map((c) => <span key={c} className="tag">{t(CARGO_L[c] || c)}</span>)}</div>}
      {admin && (
        <div className="row wrap muted small">
          {!s.visible && <span className="status declined"><EyeOff size={13} /> {t('Скрыта')}</span>}
          <span><MousePointerClick size={13} /> {t('Переходов: {n}', { n: num(s.clicks ?? 0) })}</span>
        </div>
      )}
      <div className="row between wrap">
        <a className="btn primary" href={s.url} target="_blank" rel="noopener noreferrer" onClick={() => { api(`/shippers/${s.id}/open`, 'POST').catch(() => {}); }}>
          <ExternalLink size={16} /> {t('Перейти к заявкам')}
        </a>
        {admin && (
          <div className="row">
            <button className="icon-btn" aria-label={t('Изменить')} onClick={onEdit}><Pencil size={17} /></button>
            <button className="icon-btn" aria-label={t('Удалить')} onClick={onRemove}><Trash2 size={17} /></button>
          </div>
        )}
      </div>
    </article>
  );
}

function ShipperForm({ initial, onClose, onSaved }: { initial: Partial<Shipper>; onClose: () => void; onSaved: () => void }) {
  const { act, meta, cityName } = useApp();
  const [f, setF] = useState({
    name: initial.name || '', url: initial.url || 'https://', about: initial.about || '', cities: initial.cities || [], cargo: initial.cargo || [],
    visible: initial.visible ?? true, sort: initial.sort ?? 0,
  });
  // undefined — логотип не меняли, null — убрали
  const [logo, setLogo] = useState<{ mime: string; data: string; preview: string } | null | undefined>(undefined);
  const [city, setCity] = useState<string | null>(null);
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const shownLogo = logo === undefined ? initial.logo : logo?.preview;
  const pick = async (file?: File) => {
    if (!file) return;
    await act(async () => {
      const u = await prepareUpload(file);
      setLogo({ mime: u.mime, data: u.data, preview: `data:${u.mime};base64,${u.data}` });
    });
  };
  const save = () => act(async () => {
    const body = { ...f, ...(logo === undefined ? {} : { logo: logo && { mime: logo.mime, data: logo.data } }) };
    await (initial.id ? api(`/admin/shippers/${initial.id}`, 'PUT', body) : api('/admin/shippers', 'POST', body));
    onSaved();
  }, t('Сохранено'));
  return (
    <Modal title={initial.id ? t('Изменить компанию') : t('Добавить компанию')} onClose={onClose} wide>
      <Field label={t('Название компании')}><input autoFocus value={f.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} /></Field>
      <Field label={t('Адрес страницы с заявками')} hint={t('Куда попадёт перевозчик, нажав «Перейти к заявкам»')}>
        <input type="url" value={f.url} onChange={(e) => set({ url: e.target.value })} maxLength={300} />
      </Field>
      <Field label={t('Логотип')} hint={t('JPG, PNG или WEBP, до 1 МБ')}>
        <div className="row wrap">
          <div className="shipper-logo"><Logo src={shownLogo || null} name={f.name || '?'} /></div>
          <label className="btn soft"><Upload size={16} /> {t('Выбрать файл')}<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => pick(e.target.files?.[0])} /></label>
          {shownLogo && <button className="btn ghost" onClick={() => setLogo(null)}>{t('Убрать логотип')}</button>}
        </div>
      </Field>
      <Field label={t('О компании')}><textarea rows={3} value={f.about} onChange={(e) => set({ about: e.target.value })} maxLength={600} placeholder={t('Что возит, какие требования к перевозчикам')} /></Field>
      <Field label={t('Города')}>
        <CitySelect value={city} onChange={(id) => { if (id && !f.cities.includes(id)) set({ cities: [...f.cities, id] }); setCity(null); }} placeholder={t('Добавить город')} />
        {f.cities.length > 0 && (
          <div className="chips">
            {f.cities.map((c) => <button type="button" key={c} className="chip on" aria-label={t('Удалить пункт')} onClick={() => set({ cities: f.cities.filter((x) => x !== c) })}>{cityName(c)} ×</button>)}
          </div>
        )}
      </Field>
      <Field label={t('Какие грузы')}><Chips options={opts(meta.cargo, CARGO_L)} value={f.cargo} onChange={(v: string[]) => set({ cargo: v })} /></Field>
      <Field label={t('Порядок в списке')} hint={t('Меньше — выше')}><input type="number" min={0} max={999} value={f.sort} onChange={(e) => set({ sort: Math.max(0, Math.min(999, Number(e.target.value) || 0)) })} /></Field>
      <label className="switch">
        <input type="checkbox" checked={f.visible} onChange={(e) => set({ visible: e.target.checked })} />
        <span>{t('Показывать пользователям')}</span>
      </label>
      <div className="row end">
        <button className="btn ghost" onClick={onClose}>{t('Отмена')}</button>
        <button className="btn primary" disabled={f.name.trim().length < 2 || !/^https?:\/\/\S+\.\S+/.test(f.url.trim())} onClick={save}>{t('Сохранить')}</button>
      </div>
    </Modal>
  );
}
