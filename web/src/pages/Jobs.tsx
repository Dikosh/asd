// «Работа»: вакансии владельцев транспорта и резюме водителей. Связь — по телефону или в WhatsApp.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Briefcase, CarFront, MapPin, Megaphone, Plus, Trash2, UserPlus } from 'lucide-react';
import { api, fmtDate, t, useApp, useLoad } from '../core';
import { CitySelect, Empty, Field, Loading, Modal, Tabs } from '../ui';
import { ContactButtons } from '../listing';

const blank = { title: '', cityId: null as string | null, vehicle: '', licenseCats: '', experience: '', salary: '', dateFrom: '', description: '' };

export default function JobsPage() {
  const { me, act, cityName } = useApp();
  const [kind, setKind] = useState(me!.user.role === 'driver' ? 'vacancy' : 'resume');
  const [city, setCity] = useState<string | null>(null);
  const [form, setForm] = useState<(typeof blank & { kind: string }) | null>(null);
  const { data, loading, reload } = useLoad(() => api<any[]>(`/jobs?kind=${kind}${city ? `&city=${city}` : ''}`), [kind, city]);
  const set = (p: Partial<typeof blank>) => setForm((f) => f && { ...f, ...p });
  const save = async () => {
    const body = { ...form, experience: form!.experience === '' ? null : Number(form!.experience), dateFrom: form!.dateFrom || null };
    if (await act(() => api('/jobs', 'POST', body), form!.kind === 'vacancy' ? t('Вакансия размещена') : t('Резюме размещено'))) {
      setKind(form!.kind);
      if (city && form!.cityId !== city) setCity(form!.cityId);
      setForm(null);
      reload();
    }
  };
  const [hired, setHired] = useState<number[]>([]);
  const hire = async (j: any) =>
    (await act(() => api('/employees', 'POST', { name: j.userName, phone: j.phone, position: t('Водитель'), licenseCats: j.licenseCats, experience: j.experience }), t('Добавлен в «Сотрудники»'))) && setHired((x) => [...x, j.id]);
  const isVac = form?.kind === 'vacancy';
  // водителю не показываем действия работодателя
  const isDriver = me!.user.role === 'driver';
  // водитель из команды смотрит вакансии, но резюме и заявки на перегон — не его раздел
  const teamDriver = me!.user.companyRole === 'driver';
  const canHire = !isDriver && me!.user.companyRole === 'owner';

  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">{t('Работа')}</h1>
        <div className="row wrap">
          {/* город из фильтра подставляем сразу: иначе объявление «пропадает» из отфильтрованного списка */}
          {!isDriver && <button className="btn primary" onClick={() => setForm({ ...blank, cityId: city, kind: 'vacancy' })}><Plus size={17} /> {t('Ищу водителя')}</button>}
          {!teamDriver && <button className={`btn ${isDriver ? 'primary' : 'soft'}`} onClick={() => setForm({ ...blank, cityId: city, kind: 'resume' })}><Plus size={17} /> {t('Ищу работу')}</button>}
        </div>
      </div>
      <p className="muted">{t('Поиск водителей и работы внутри платформы — без перехода на другие сайты.')}</p>
      {/* перегон машин живёт здесь, в «Работе»: заявки на перегон и подработка перегонщиком */}
      {!teamDriver && (
        <Link to="/relocation" className="banner">
          <CarFront size={20} />
          <div><b>{t('Перегон машин и техники')}</b><span>{t('Заявки на перегон своим ходом и подработка перегонщиком')}</span></div>
          <ArrowRight size={18} />
        </Link>
      )}
      <div className="row wrap">
        <Link to="/services?cat=escort" className="btn soft"><Megaphone size={16} /> {t('Сопровождение негабарита')}</Link>
      </div>
      <div className="page-head">
        <Tabs value={kind} onChange={setKind} items={[{ value: 'vacancy', label: t('Вакансии') }, { value: 'resume', label: t('Резюме водителей') }]} />
        <div className="city-filter"><CitySelect value={city} onChange={setCity} placeholder={t('Любой город')} /></div>
      </div>
      {loading ? <Loading /> : (
        <div className="list">
          {data?.map((j) => (
            <article className="card lcard" key={j.id}>
              <div className="lcard-top">
                <div>
                  <div className="lcard-title">{j.title}</div>
                  <div className="muted small">
                    {j.cityId && <><MapPin size={13} /> {cityName(j.cityId)} · </>}
                    {kind === 'vacancy' ? <Link to={`/company/${j.companyId}`}>{j.companyName}</Link> : j.userName} · {fmtDate(j.createdAt)}
                  </div>
                </div>
                {j.salary && <div className="rate"><b>{j.salary}</b></div>}
              </div>
              <div className="chips">
                {j.vehicle && <span className="chip strong">{j.vehicle}</span>}
                {j.licenseCats && <span className="chip">{t('Категории')}: {j.licenseCats}</span>}
                {j.experience != null && <span className="chip">{kind === 'vacancy' ? t('стаж от {n} г.', { n: j.experience }) : t('стаж {n} г.', { n: j.experience })}</span>}
                {j.dateFrom && <span className="chip light">{t('с {d}', { d: fmtDate(j.dateFrom) })}</span>}
              </div>
              {j.description && <p className="desc full">{j.description}</p>}
              <div className="lcard-foot">
                <span />
                <div className="row wrap">
                  {j.mine ? (
                    <button className="btn ghost" onClick={async () => confirm(t('Снять объявление?')) && (await act(() => api(`/jobs/${j.id}`, 'DELETE'), t('Объявление снято'))) && reload()}><Trash2 size={16} /> {t('Снять')}</button>
                  ) : (
                    <>
                      <ContactButtons full phone={j.phone} text={`${t('Здравствуйте! Пишу по объявлению на Timma')}: ${j.title}`} />
                      {kind === 'resume' && canHire && <button className="btn soft" disabled={hired.includes(j.id)} onClick={() => hire(j)}><UserPlus size={16} /> {t('В сотрудники')}</button>}
                    </>
                  )}
                </div>
              </div>
            </article>
          ))}
          {data?.length === 0 && <div className="card"><Empty icon={<Briefcase size={26} />} title={kind === 'vacancy' ? t('Вакансий пока нет') : t('Резюме пока нет')} text={t('Разместите своё объявление — это бесплатно.')} /></div>}
        </div>
      )}

      {form && (
        <Modal title={isVac ? t('Вакансия: ищу водителя') : t('Резюме: ищу работу')} onClose={() => setForm(null)}>
          <Field label={isVac ? t('Кого ищете') : t('Кто вы')}>
            <input autoFocus value={form.title} onChange={(e) => set({ title: e.target.value })} maxLength={120} placeholder={isVac ? t('Водитель CE на рефрижератор') : t('Водитель CE, стаж 10 лет')} />
          </Field>
          <div className="grid2">
            <Field label={t('Город')} hint={form.cityId ? undefined : t('Обязательно — по городу ищут работу и водителей')}><CitySelect value={form.cityId} onChange={(v) => set({ cityId: v })} /></Field>
            <Field label={isVac ? t('Транспорт') : t('На чём работал')}><input value={form.vehicle} onChange={(e) => set({ vehicle: e.target.value })} placeholder="Volvo FH, тент 20 т" /></Field>
            <Field label={t('Категории прав')}><input value={form.licenseCats} onChange={(e) => set({ licenseCats: e.target.value })} placeholder="C, CE" /></Field>
            <Field label={isVac ? t('Стаж от, лет') : t('Стаж, лет')}><input inputMode="numeric" value={form.experience} onChange={(e) => set({ experience: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label={isVac ? t('Оплата') : t('Ожидания по оплате')}><input value={form.salary} onChange={(e) => set({ salary: e.target.value })} placeholder={t('от 500 000 ₸')} /></Field>
            <Field label={t('Дата выхода')}><input type="date" value={form.dateFrom} onChange={(e) => set({ dateFrom: e.target.value })} /></Field>
          </div>
          <Field label={isVac ? t('Требования и условия') : t('Опыт и навыки')}><textarea rows={4} value={form.description} onChange={(e) => set({ description: e.target.value })} maxLength={2000} /></Field>
          <p className="muted small">{t('В объявлении будет показан ваш номер {phone} — с вами свяжутся по телефону или в WhatsApp.', { phone: me!.user.phone })}</p>
          <div className="row end">
            <button className="btn ghost" onClick={() => setForm(null)}>{t('Отмена')}</button>
            <button className="btn primary" disabled={form.title.trim().length < 3 || !form.cityId} onClick={save}>{t('Разместить')}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
