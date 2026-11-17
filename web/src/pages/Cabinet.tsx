// Кабинет: профиль и документы, отклики, сообщения, рейсы, машины, сотрудники, баланс, каталог, чёрный список, настройки.
import { ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, BadgeCheck, Ban, Bookmark, Briefcase, Building2, Calculator, ChevronRight, FileText, Handshake, Inbox, LifeBuoy, LogOut, MessageSquare, Pencil, Plus,
  Route as RouteIcon, Search, Send, Settings, ShieldCheck, Trash2, TrendingUp, Truck, Upload, UserRound, Users, UsersRound, Wallet,
} from 'lucide-react';
import { api, BODY_L, Company, DOC_L, fmtDate, fmtWhen, LOADING_L, Me, money, num, opts, ROLE_L, t, Trip, useApp, useEvent, useLoad } from '../core';
import { Chips, CitySelect, CompanyBadge, Empty, Field, LangSwitch, Loading, Modal, Select, Tabs } from '../ui';
import { TripSummary } from './TripPage';
import { AdminExtra, Partners, PlanCard, Team } from './CabinetExtra';
import { PushToggle } from './Notifications';

export default function Cabinet() {
  const { tab, id } = useParams();
  const { me } = useApp();
  const items: { key: string; label: string; icon: ReactNode; badge?: number; el: ReactNode }[] = [
    { key: 'profile', label: t('Кабинет'), icon: <UserRound size={19} />, el: <Profile /> },
    { key: 'responses', label: t('Отклики'), icon: <Inbox size={19} />, badge: me!.counters.responses, el: <Responses /> },
    { key: 'messages', label: t('Сообщения'), icon: <MessageSquare size={19} />, badge: me!.counters.unread, el: <Messages chatId={id ? Number(id) : null} /> },
    { key: 'trips', label: t('Рейсы'), icon: <RouteIcon size={19} />, badge: me!.counters.trips, el: <Trips /> },
    { key: 'vehicles', label: t('Машины'), icon: <Truck size={19} />, el: <Vehicles /> },
    { key: 'team', label: t('Команда'), icon: <UsersRound size={19} />, el: <Team /> },
    { key: 'employees', label: t('Сотрудники'), icon: <Users size={19} />, el: <Employees /> },
    { key: 'balance', label: t('Баланс и тариф'), icon: <Wallet size={19} />, el: <Balance /> },
    { key: 'catalog', label: t('Каталог компаний'), icon: <Building2 size={19} />, el: <Catalog /> },
    { key: 'partners', label: t('Партнёры'), icon: <Handshake size={19} />, el: <Partners /> },
    { key: 'blacklist', label: t('Чёрный список'), icon: <Ban size={19} />, el: <Blacklist /> },
    { key: 'settings', label: t('Настройки'), icon: <Settings size={19} />, el: <SettingsTab /> },
    ...(me!.user.isAdmin ? [{ key: 'admin', label: t('Модерация'), icon: <ShieldCheck size={19} />, el: <Admin /> }] : []),
  ];
  const current = items.find((i) => i.key === tab);
  return (
    <div className={`cabinet ${current ? 'has-tab' : ''}`}>
      <aside className="card cab-menu">
        <div className="cab-user">
          <b>{me!.user.name}</b>
          <span className="muted small">{t(ROLE_L[me!.user.role])} · {me!.company.form} «{me!.company.name}»</span>
        </div>
        {items.map((i) => (
          <Link key={i.key} to={`/cabinet/${i.key}`} className={(current?.key ?? 'profile') === i.key ? 'on' : ''}>
            {i.icon}<span>{i.label}</span>
            {!!i.badge && <span className="badge inline">{i.badge}</span>}
            <ChevronRight size={16} className="only-s chev" />
          </Link>
        ))}
        <div className="cab-more only-s">
          <Link to="/marked"><Bookmark size={19} /><span>{t('Отмеченные')}</span><ChevronRight size={16} className="chev" /></Link>
          <Link to="/jobs"><Briefcase size={19} /><span>{t('Работа')}</span><ChevronRight size={16} className="chev" /></Link>
          <Link to="/prices"><TrendingUp size={19} /><span>{t('Цены')}</span><ChevronRight size={16} className="chev" /></Link>
          <Link to="/tools"><Calculator size={19} /><span>{t('Инструменты')}</span><ChevronRight size={16} className="chev" /></Link>
          <Link to="/help"><LifeBuoy size={19} /><span>{t('Помощь')}</span><ChevronRight size={16} className="chev" /></Link>
        </div>
      </aside>
      <section className="cab-body">
        <Link to="/cabinet" className="link back only-s"><ArrowLeft size={16} /> {t('Кабинет')}</Link>
        {(current ?? items[0]).el}
      </section>
    </div>
  );
}

// ---------- профиль, проверка, документы ----------
function Profile() {
  const { me, setMe, act, meta } = useApp();
  const c = me!.company;
  const [user, setUser] = useState({ name: me!.user.name, email: me!.user.email });
  const [comp, setComp] = useState({ bin: c.bin || '', about: c.about, cityId: c.cityId });
  const docs = useLoad(() => api<any[]>('/documents'));
  const history = useLoad(() => api<Trip[]>('/trips'));
  const [kind, setKind] = useState('registration');
  const file = useRef<HTMLInputElement>(null);
  const VER: Record<string, string> = { none: 'Не проверена', pending: 'На проверке', verified: 'Проверена', rejected: 'Проверка не пройдена' };
  const DOC_ST: Record<string, string> = { pending: 'На проверке', approved: 'Принят', rejected: 'Отклонён' };

  const upload = async (f: File) => {
    if (f.size > 5 * 1024 * 1024) return act(() => Promise.reject(new Error('Файл больше 5 МБ')));
    const data = await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1]);
      r.readAsDataURL(f);
    });
    if (await act(() => api('/documents', 'POST', { kind, filename: f.name, mime: f.type, data }), t('Документ загружен'))) docs.reload();
  };

  return (
    <div className="stack">
      <h1 className="page-title">{t('Кабинет')}</h1>
      <div className="card form">
        <h3>{t('Общая информация')}</h3>
        <div className="grid2">
          <Field label={t('ФИО')}><input value={user.name} onChange={(e) => setUser({ ...user, name: e.target.value })} /></Field>
          <Field label={t('Почта')}><input type="email" value={user.email} onChange={(e) => setUser({ ...user, email: e.target.value })} /></Field>
          <Field label={t('Номер телефона')}><input value={me!.user.phone} disabled /></Field>
          <Field label={t('Роль')}><input value={t(ROLE_L[me!.user.role])} disabled /></Field>
        </div>
        <div className="row end"><button className="btn primary" onClick={() => act(async () => setMe(await api<Me>('/me', 'PATCH', user)), t('Сохранено'))}>{t('Сохранить')}</button></div>
      </div>

      <div className="card form">
        <div className="row between wrap">
          <h3>{c.form} «{c.name}»</h3>
          <span className={`status ${c.verified === 'verified' ? 'accepted' : c.verified === 'pending' ? 'sent' : 'declined'}`}>
            {c.verified === 'verified' && <BadgeCheck size={14} />} {t(VER[c.verified])}
          </span>
        </div>
        <div className="company-stats">
          <div><b>{c.trips}</b><span>{t('рейсов')}</span></div>
          <div><b>{c.rating?.toFixed(1) ?? '—'}</b><span>{t('рейтинг')}</span></div>
          <div><b>{c.reviews}</b><span>{t('отзывов')}</span></div>
        </div>
        <div className="grid2">
          <Field label={t('БИН / ИИН')} hint={comp.bin && comp.bin.length === 12 ? undefined : t('12 цифр — проверяем контрольный разряд')}>
            <input inputMode="numeric" maxLength={12} value={comp.bin} onChange={(e) => setComp({ ...comp, bin: e.target.value.replace(/\D/g, '') })} />
          </Field>
          <Field label={t('Город')}><CitySelect value={comp.cityId} onChange={(v) => setComp({ ...comp, cityId: v })} /></Field>
        </div>
        <Field label={t('О компании')}><textarea rows={3} value={comp.about} onChange={(e) => setComp({ ...comp, about: e.target.value })} maxLength={1000} /></Field>
        <div className="row end wrap">
          <button className="btn soft" onClick={() => act(async () => setMe(await api<Me>('/company', 'PATCH', comp)), t('Сохранено'))}>{t('Сохранить')}</button>
          {c.verified !== 'verified' && c.verified !== 'pending' && (
            <button className="btn primary" onClick={() => act(async () => { await api('/company/verify-request', 'POST'); setMe(await api<Me>('/me')); }, t('Заявка на проверку отправлена'))}>
              <ShieldCheck size={16} /> {t('Отправить на проверку')}
            </button>
          )}
        </div>
      </div>

      <div className="card form">
        <h3>{t('Документы для проверки')}</h3>
        <p className="muted small">{t('Удостоверение личности, свидетельство о регистрации, лицензия, права. PDF или фото до 5 МБ. Документы видит только модератор.')}</p>
        <div className="row wrap">
          <Select value={kind} onChange={setKind} options={opts(meta.docKinds, DOC_L)} />
          <input ref={file} type="file" hidden accept=".pdf,image/jpeg,image/png,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
          <button className="btn soft" onClick={() => file.current?.click()}><Upload size={16} /> {t('Загрузить файл')}</button>
        </div>
        {docs.data?.map((d) => (
          <div className="line" key={d.id}>
            <FileText size={18} />
            <div className="grow"><a href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer">{d.filename}</a><div className="muted small">{t(DOC_L[d.kind])} · {fmtDate(d.createdAt)}</div></div>
            <span className={`status ${d.status === 'approved' ? 'accepted' : d.status === 'pending' ? 'sent' : 'declined'}`}>{t(DOC_ST[d.status])}</span>
            <button className="icon-btn" aria-label={t('Удалить')} onClick={async () => confirm(t('Удалить документ?')) && (await act(() => api(`/documents/${d.id}`, 'DELETE'))) && docs.reload()}><Trash2 size={17} /></button>
          </div>
        ))}
        {docs.data?.length === 0 && <p className="muted">{t('Документы ещё не загружены.')}</p>}
      </div>

      <div className="card form">
        <h3>{t('Мои посылки')}</h3>
        <p className="muted small">{t('История грузов и рейсов компании.')}</p>
        {history.data?.filter((x) => x.status !== 'active').slice(0, 5).map((x) => <TripSummary key={x.id} trip={x} />)}
        {history.data?.filter((x) => x.status !== 'active').length === 0 && <p className="muted">{t('Завершённых рейсов пока нет.')}</p>}
        <Link to="/cabinet/trips" className="link">{t('Все рейсы')} →</Link>
      </div>
    </div>
  );
}

// ---------- отклики ----------
const RESP_L: Record<string, string> = { sent: 'Ожидает ответа', accepted: 'Принят', declined: 'Отклонён', withdrawn: 'Отозван' };
function Responses() {
  const { cityName, act } = useApp();
  const nav = useNavigate();
  const [tab, setTab] = useState('incoming');
  const { data, loading, reload } = useLoad(() => api<{ incoming: any[]; outgoing: any[] }>('/responses'));
  useEvent('response', reload);
  const list = data?.[tab as 'incoming' | 'outgoing'] || [];
  const decide = async (r: any, action: string, ok: string) => {
    let tripId: number | null = null;
    if (await act(async () => { tripId = (await api(`/responses/${r.id}/${action}`, 'POST')).tripId; }, ok)) tripId ? nav(`/trip/${tripId}`) : reload();
  };
  return (
    <div className="stack">
      <h1 className="page-title">{t('Отклики')}</h1>
      <Tabs value={tab} onChange={setTab} items={[
        { value: 'incoming', label: t('На мои объявления'), count: data?.incoming.filter((r) => r.status === 'sent').length },
        { value: 'outgoing', label: t('Мои отклики') },
      ]} />
      {loading ? <Loading /> : (
        <div className="list">
          {list.map((r) => (
            <div className="card resp" key={r.id}>
              <div className="row between wrap">
                <Link to={`/listing/${r.listingId}`} className="lcard-title small">{r.kind === 'cargo' ? t('Груз') : t('Транспорт')}: {cityName(r.fromId)} → {cityName(r.toId)}</Link>
                <span className={`status ${r.status}`}>{t(RESP_L[r.status])}</span>
              </div>
              <p>{r.message}</p>
              <div className="row between wrap">
                <span className="muted small">
                  {tab === 'incoming' ? <Link to={`/company/${r.companyId}`}>{r.companyName}</Link> : <Link to={`/company/${r.ownerCompanyId}`}>{r.ownerCompany}</Link>}
                  {' · '}{r.price ? money(r.price, r.currency) : t('Без предложения цены')} · {fmtWhen(r.createdAt)}
                </span>
                <div className="row wrap">
                  {r.chatId && <Link to={`/cabinet/messages/${r.chatId}`} className="btn soft"><MessageSquare size={16} /> {t('Чат')}</Link>}
                  {r.tripId && <Link to={`/trip/${r.tripId}`} className="btn soft">{t('Рейс')}</Link>}
                  {r.status === 'sent' && tab === 'outgoing' && <button className="btn ghost" onClick={() => decide(r, 'withdraw', t('Отклик отозван'))}>{t('Отозвать отклик')}</button>}
                  {r.status === 'sent' && tab === 'incoming' && (
                    <>
                      <button className="btn ghost" onClick={() => decide(r, 'decline', t('Отклик отклонён'))}>{t('Отклонить')}</button>
                      <button className="btn primary" onClick={() => confirm(t('Принять отклик и создать рейс с этой компанией?')) && decide(r, 'accept', t('Рейс создан'))}>{t('Принять')}</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
          {list.length === 0 && <div className="card"><Empty icon={<Inbox size={26} />} title={t('Откликов пока нет')} text={tab === 'incoming' ? t('Здесь появятся отклики на ваши грузы и транспорт.') : t('Откликайтесь на объявления из поиска — отклики соберутся здесь.')} /></div>}
        </div>
      )}
    </div>
  );
}

// ---------- сообщения ----------
function Messages({ chatId }: { chatId: number | null }) {
  const { cityName, act, reloadMe } = useApp();
  const chats = useLoad(() => api<any[]>('/chats'));
  const msgs = useLoad(() => (chatId ? api<any[]>(`/chats/${chatId}/messages`) : Promise.resolve([])), [chatId]);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEvent('message read', (d) => {
    chats.reload();
    if (d.chatId === chatId) msgs.reload();
  });
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs.data?.length]);
  useEffect(() => { if (chatId && msgs.data) { reloadMe(); chats.reload(); } }, [chatId, msgs.data?.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const chat = chats.data?.find((c) => c.id === chatId);
  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    if (!(await act(() => api(`/chats/${chatId}/messages`, 'POST', { text: body })))) setText(body);
  };
  return (
    <div className={`chat-layout ${chatId ? 'open' : ''}`}>
      <div className="card chat-list">
        <h1 className="page-title">{t('Сообщения')}</h1>
        {chats.loading && <Loading />}
        {chats.data?.map((c) => (
          <Link key={c.id} to={`/cabinet/messages/${c.id}`} className={`chat-item ${c.id === chatId ? 'on' : ''}`}>
            <div className="row between"><b>{c.peerCompany}</b>{c.unread > 0 && <span className="badge inline">{c.unread}</span>}</div>
            <div className="muted small">{cityName(c.fromId)} → {cityName(c.toId)} · {c.peerName}</div>
            <div className="chat-last">{c.lastText}</div>
          </Link>
        ))}
        {chats.data?.length === 0 && <Empty icon={<MessageSquare size={26} />} title={t('Сообщений пока нет')} text={t('Чат открывается после отклика на объявление.')} />}
      </div>
      {chatId && (
        <div className="card chat-box">
          <header>
            <Link to="/cabinet/messages" className="icon-btn only-s" aria-label={t('Назад')}><ArrowLeft size={20} /></Link>
            {chat && (
              <div className="grow">
                <Link to={`/company/${chat.peerCompanyId}`}><b>{chat.peerCompany}</b></Link>
                <div className="muted small"><Link to={`/listing/${chat.listingId}`}>{chat.kind === 'cargo' ? t('Груз') : t('Транспорт')}: {cityName(chat.fromId)} → {cityName(chat.toId)}</Link></div>
              </div>
            )}
          </header>
          <div className="chat-msgs">
            {msgs.data?.map((m) => (
              <div key={m.id} className={`msg ${m.mine ? 'mine' : ''}`}>
                <p>{m.text}</p>
                <span>{fmtWhen(m.createdAt)}{m.mine && (m.isRead ? ' ✓✓' : ' ✓')}</span>
              </div>
            ))}
            <div ref={end} />
          </div>
          <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Напишите сообщение…')} maxLength={2000} autoFocus />
            <button className="btn primary" disabled={!text.trim()} aria-label={t('Отправить')}><Send size={17} /></button>
          </form>
        </div>
      )}
    </div>
  );
}

// ---------- рейсы ----------
function Trips() {
  const [tab, setTab] = useState('active');
  const { data, loading, reload } = useLoad(() => api<Trip[]>('/trips'));
  useEvent('trip', reload);
  const list = (data || []).filter((x) => (tab === 'active') === (x.status === 'active'));
  return (
    <div className="stack">
      <h1 className="page-title">{t('Рейсы')}</h1>
      <Tabs value={tab} onChange={setTab} items={[{ value: 'active', label: t('Активные'), count: data?.filter((x) => x.status === 'active').length }, { value: 'done', label: t('Неактивные') }]} />
      {loading ? <Loading /> : (
        <div className="list">
          {list.map((x) => <TripSummary key={x.id} trip={x} />)}
          {list.length === 0 && <div className="card"><Empty icon={<RouteIcon size={26} />} title={tab === 'active' ? t('Активных рейсов нет') : t('Завершённых рейсов пока нет.')} text={t('Рейс появится, когда отклик будет принят. Вся история — во вкладке «Рейсы».')} /></div>}
        </div>
      )}
    </div>
  );
}

// ---------- машины ----------
function Vehicles() {
  const { act, meta } = useApp();
  const { data, loading, reload } = useLoad(() => api<any[]>('/vehicles'));
  const [edit, setEdit] = useState<any | null>(null);
  const save = async () => {
    const body = { ...edit, weight: edit.weight === '' || edit.weight == null ? null : Number(edit.weight), volume: edit.volume === '' || edit.volume == null ? null : Number(edit.volume) };
    if (await act(() => (edit.id ? api(`/vehicles/${edit.id}`, 'PUT', body) : api('/vehicles', 'POST', body)), t('Сохранено'))) {
      setEdit(null);
      reload();
    }
  };
  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">{t('Машины')}</h1>
        <button className="btn primary" onClick={() => setEdit({ brand: '', plate: '', bodyType: null, weight: '', volume: '', loading: [] })}><Plus size={17} /> {t('Добавить машину')}</button>
      </div>
      {loading ? <Loading /> : (
        <div className="list">
          {data?.map((v) => (
            <div className="card line" key={v.id}>
              <Truck size={22} className="line-icon" />
              <div className="grow">
                <b>{v.brand}</b> {v.plate && <span className="plate">{v.plate}</span>}
                <div className="muted small">{[v.bodyType && t(BODY_L[v.bodyType]), v.weight && `${v.weight} ${t('т')}`, v.volume && `${v.volume} ${t('м³')}`, ...v.loading.map((x: string) => t(LOADING_L[x]))].filter(Boolean).join(' · ')}</div>
              </div>
              <button className="icon-btn" aria-label={t('Изменить')} onClick={() => setEdit({ ...v, weight: v.weight ?? '', volume: v.volume ?? '' })}><Pencil size={17} /></button>
              <button className="icon-btn" aria-label={t('Удалить')} onClick={async () => confirm(t('Удалить машину?')) && (await act(() => api(`/vehicles/${v.id}`, 'DELETE'))) && reload()}><Trash2 size={17} /></button>
            </div>
          ))}
          {data?.length === 0 && <div className="card"><Empty icon={<Truck size={26} />} title={t('Парк пока пуст')} text={t('Добавьте машины — при размещении транспорта характеристики подставятся сами.')} /></div>}
        </div>
      )}
      {edit && (
        <Modal title={edit.id ? t('Изменить машину') : t('Добавить машину')} onClose={() => setEdit(null)}>
          <div className="grid2">
            <Field label={t('Марка транспорта')}><input autoFocus value={edit.brand} onChange={(e) => setEdit({ ...edit, brand: e.target.value })} /></Field>
            <Field label={t('Госномер')}><input value={edit.plate} onChange={(e) => setEdit({ ...edit, plate: e.target.value })} /></Field>
          </div>
          <Field label={t('Тип кузова')}><Select value={edit.bodyType || ''} onChange={(v) => setEdit({ ...edit, bodyType: v || null })} placeholder={t('Не выбран')} options={opts(meta.body, BODY_L)} /></Field>
          <div className="grid2">
            <Field label={t('Вес, т')}><input inputMode="decimal" value={edit.weight} onChange={(e) => setEdit({ ...edit, weight: e.target.value })} /></Field>
            <Field label={t('Объём, м³')}><input inputMode="decimal" value={edit.volume} onChange={(e) => setEdit({ ...edit, volume: e.target.value })} /></Field>
          </div>
          <div className="field"><span className="field-label">{t('Тип загрузки — по устройству машины')}</span><Chips options={opts(meta.loading, LOADING_L)} value={edit.loading} onChange={(v) => setEdit({ ...edit, loading: v })} /></div>
          <div className="row end"><button className="btn ghost" onClick={() => setEdit(null)}>{t('Отмена')}</button><button className="btn primary" disabled={!edit.brand.trim()} onClick={save}>{t('Сохранить')}</button></div>
        </Modal>
      )}
    </div>
  );
}

// ---------- сотрудники ----------
const ESUTD_L: Record<string, string> = { unknown: 'Не проверен', registered: 'Договор зарегистрирован', missing: 'Договора нет' };
function Employees() {
  const { act } = useApp();
  const { data, loading, reload } = useLoad(() => api<any[]>('/employees'));
  const [edit, setEdit] = useState<any | null>(null);
  const save = async () => {
    const body = { ...edit, experience: edit.experience === '' || edit.experience == null ? null : Number(edit.experience) };
    if (await act(() => (edit.id ? api(`/employees/${edit.id}`, 'PUT', body) : api('/employees', 'POST', body)), t('Сохранено'))) {
      setEdit(null);
      reload();
    }
  };
  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">{t('Сотрудники')}</h1>
        <button className="btn primary" onClick={() => setEdit({ name: '', phone: '', position: t('Водитель'), licenseCats: '', experience: '', esutd: 'unknown', esutdNumber: '' })}><Plus size={17} /> {t('Добавить сотрудника')}</button>
      </div>
      <div className="banner slim">
        <ShieldCheck size={18} />
        <div><b>{t('ЕСУТД')}</b><span>{t('Отмечайте, зарегистрирован ли трудовой договор в esutd.gov.kz. Автоматическая сверка появится после подключения API ЕСУТД.')}</span></div>
      </div>
      {loading ? <Loading /> : (
        <div className="list">
          {data?.map((e) => (
            <div className="card line" key={e.id}>
              <UserRound size={22} className="line-icon" />
              <div className="grow">
                <b>{e.name}</b> <span className="muted">· {e.position}</span>
                <div className="muted small">{[e.phone, e.licenseCats && `${t('Категории')}: ${e.licenseCats}`, e.experience != null && t('стаж {n} лет', { n: e.experience })].filter(Boolean).join(' · ')}</div>
              </div>
              <span className={`status ${e.esutd === 'registered' ? 'accepted' : e.esutd === 'missing' ? 'declined' : ''}`}>{t('ЕСУТД')}: {t(ESUTD_L[e.esutd])}</span>
              <button className="icon-btn" aria-label={t('Изменить')} onClick={() => setEdit({ ...e, experience: e.experience ?? '' })}><Pencil size={17} /></button>
              <button className="icon-btn" aria-label={t('Удалить')} onClick={async () => confirm(t('Удалить сотрудника?')) && (await act(() => api(`/employees/${e.id}`, 'DELETE'))) && reload()}><Trash2 size={17} /></button>
            </div>
          ))}
          {data?.length === 0 && <div className="card"><Empty icon={<Users size={26} />} title={t('Сотрудников пока нет')} text={t('Добавьте водителей вручную или наймите из вкладки «Работа».')}><Link to="/jobs" className="btn soft">{t('Открыть «Работу»')}</Link></Empty></div>}
        </div>
      )}
      {edit && (
        <Modal title={edit.id ? t('Изменить сотрудника') : t('Добавить сотрудника')} onClose={() => setEdit(null)}>
          <div className="grid2">
            <Field label={t('ФИО')}><input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label={t('Номер телефона')}><input type="tel" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label={t('Должность')}><input value={edit.position} onChange={(e) => setEdit({ ...edit, position: e.target.value })} /></Field>
            <Field label={t('Категории прав')}><input value={edit.licenseCats} onChange={(e) => setEdit({ ...edit, licenseCats: e.target.value })} placeholder="C, CE" /></Field>
            <Field label={t('Стаж, лет')}><input inputMode="numeric" value={edit.experience} onChange={(e) => setEdit({ ...edit, experience: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label={t('ЕСУТД')}><Select value={edit.esutd} onChange={(v) => setEdit({ ...edit, esutd: v })} options={Object.keys(ESUTD_L).map((k) => ({ value: k, label: t(ESUTD_L[k]) }))} /></Field>
          </div>
          <Field label={t('Номер договора в ЕСУТД')}><input value={edit.esutdNumber} onChange={(e) => setEdit({ ...edit, esutdNumber: e.target.value })} /></Field>
          <div className="row end"><button className="btn ghost" onClick={() => setEdit(null)}>{t('Отмена')}</button><button className="btn primary" disabled={edit.name.trim().length < 2} onClick={save}>{t('Сохранить')}</button></div>
        </Modal>
      )}
    </div>
  );
}

// ---------- баланс ----------
function Balance() {
  const { act, meta, reloadMe } = useApp();
  const { data, loading, reload } = useLoad(() => api<{ balance: number; transactions: any[] }>('/balance'));
  const KIND: Record<string, string> = { topup: 'Пополнение', boost: 'Поднятие в топ', plan: 'Тариф Pro' };
  const topup = async (amount: number) => (await act(() => api('/balance/topup', 'POST', { amount }), t('Баланс пополнен'))) && (reload(), reloadMe());
  return (
    <div className="stack">
      <h1 className="page-title">{t('Баланс и тариф')}</h1>
      <div className="card balance">
        <div><span className="muted">{t('На счёте компании')}</span><b>{money(data?.balance ?? 0)}</b></div>
        <p className="muted small">{t('С баланса оплачивается поднятие объявлений в топ ({n} ₸ за 24 часа). Размещение, поиск и отклики бесплатны.', { n: meta.boostPrice })}</p>
        {meta.demo ? (
          <div className="row wrap">
            {[1000, 5000, 10000].map((a) => <button key={a} className="btn soft" onClick={() => topup(a)}>+ {num(a)} ₸</button>)}
            <span className="muted small">{t('Демо-пополнение: онлайн-оплата подключается отдельно.')}</span>
          </div>
        ) : <p className="muted small">{t('Онлайн-оплата скоро появится.')}</p>}
      </div>
      <PlanCard onChange={reload} />
      {loading ? <Loading /> : (
        <div className="card">
          <h3>{t('История операций')}</h3>
          {data?.transactions.map((x) => (
            <div className="line" key={x.id}>
              <div className="grow">{t(KIND[x.kind] || x.kind)}<div className="muted small">{x.note} · {fmtWhen(x.createdAt)}</div></div>
              <b className={x.amount > 0 ? 'plus' : 'minus'}>{x.amount > 0 ? '+' : '−'}{num(Math.abs(x.amount))} ₸</b>
            </div>
          ))}
          {data?.transactions.length === 0 && <p className="muted">{t('Операций пока нет.')}</p>}
        </div>
      )}
    </div>
  );
}

// ---------- каталог компаний ----------
function Catalog() {
  const { meta, cityName } = useApp();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState(new URLSearchParams(location.search).get('kind') || '');
  const { data, loading } = useLoad(() => api<(Company & { cityId: string | null; bin: string | null })[]>(`/companies?q=${encodeURIComponent(q)}&kind=${kind}`), [q, kind]);
  return (
    <div className="stack">
      <h1 className="page-title">{t('Каталог компаний')}</h1>
      <p className="muted">{t('Проверяйте контрагента до сделки: сколько рейсов выполнено, какая оценка, есть ли записи в чёрном списке.')}</p>
      <div className="row wrap">
        <div className="search-input grow"><Search size={17} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Название или БИН')} /></div>
        <Select value={kind} onChange={setKind} placeholder={t('Все участники')} options={opts(meta.roles, ROLE_L)} />
      </div>
      {loading ? <Loading /> : (
        <div className="list">
          {data?.map((c) => (
            <Link to={`/company/${c.id}`} className="card line" key={c.id}>
              <div className="grow">
                <CompanyBadge c={c} link={false} />
                <div className="muted small">{t(ROLE_L[c.kind])}{c.cityId ? ` · ${cityName(c.cityId)}` : ''}{c.bin ? ` · ${t('БИН')} ${c.bin}` : ''}</div>
              </div>
              <div className="cat-stats"><b>{c.trips}</b><span>{t('рейсов')}</span></div>
              <div className="cat-stats"><b>{c.reviews}</b><span>{t('отзывов')}</span></div>
              {c.blacklisted > 0 && <span className="status declined"><Ban size={13} /> {t('ЧС')}: {c.blacklisted}</span>}
              <ChevronRight size={18} className="muted" />
            </Link>
          ))}
          {data?.length === 0 && <div className="card"><Empty title={t('Компании не найдены')} /></div>}
        </div>
      )}
    </div>
  );
}

// ---------- чёрный список ----------
function Blacklist() {
  const { act } = useApp();
  const [q, setQ] = useState('');
  const { data, loading, reload } = useLoad(() => api<any[]>(`/blacklist?q=${encodeURIComponent(q)}`), [q]);
  return (
    <div className="stack">
      <h1 className="page-title">{t('Чёрный список')}</h1>
      <p className="muted">{t('Компании, на которых пожаловались участники. У каждой записи — причина и отзыв. Добавить компанию можно с её страницы в каталоге.')}</p>
      <div className="search-input"><Search size={17} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Название или БИН')} /></div>
      {loading ? <Loading /> : (
        <div className="list">
          {data?.map((b) => (
            <div className="card resp" key={b.id}>
              <div className="row between wrap">
                <Link to={`/company/${b.companyId}`} className="company-link"><span className="dot red" /> {b.form} «{b.name}»</Link>
                <span className="status declined">{t('Жалоб: {n}', { n: b.total })}</span>
              </div>
              <div><b>{t('Причина')}:</b> {b.reason}</div>
              {b.review && <p>{b.review}</p>}
              <div className="row between wrap">
                <span className="muted small">{b.author} · {fmtDate(b.createdAt)}{b.bin ? ` · ${t('БИН')} ${b.bin}` : ''}</span>
                {b.mine && <button className="btn ghost" onClick={async () => confirm(t('Убрать вашу запись из чёрного списка?')) && (await act(() => api(`/blacklist/${b.id}`, 'DELETE'))) && reload()}>{t('Убрать мою запись')}</button>}
              </div>
            </div>
          ))}
          {data?.length === 0 && <div className="card"><Empty icon={<Ban size={26} />} title={t('Записей нет')} /></div>}
        </div>
      )}
      <Link to="/cabinet/catalog" className="btn soft">{t('Найти компанию в каталоге')}</Link>
    </div>
  );
}

// ---------- настройки ----------
function SettingsTab() {
  const { me, setMe, act } = useApp();
  const s = me!.user.settings;
  const toggle = (key: string, def: boolean) => (
    <input type="checkbox" checked={s[key] ?? def} onChange={(e) => act(async () => setMe(await api<Me>('/me', 'PATCH', { settings: { [key]: e.target.checked } })))} />
  );
  return (
    <div className="stack">
      <h1 className="page-title">{t('Настройки')}</h1>
      <div className="card form">
        <h3>{t('Язык интерфейса')}</h3>
        <LangSwitch />
      </div>
      <div className="card form">
        <h3>{t('Уведомления')}</h3>
        <p className="muted small">{t('Новые отклики, изменения по рейсам и грузы по вашим подпискам — на телефон, даже когда платформа закрыта.')}</p>
        <PushToggle />
      </div>
      <div className="card form">
        <h3>{t('Согласия')}</h3>
        <label className="switch">{toggle('showPhone', true)}<span>{t('Показывать мой телефон в объявлениях')}</span></label>
        <label className="switch">{toggle('gpsConsent', true)}<span>{t('Согласен передавать GPS-позицию во время рейса')}</span></label>
        <label className="switch">{toggle('news', false)}<span>{t('Получать новости платформы')}</span></label>
      </div>
      <button className="btn ghost danger" onClick={() => act(async () => { await api('/auth/logout', 'POST'); setMe(null); })}><LogOut size={16} /> {t('Выйти из аккаунта')}</button>
    </div>
  );
}

// ---------- модерация ----------
function Admin() {
  const { act } = useApp();
  const { data, loading, reload } = useLoad(() => api<{ companies: any[]; documents: any[] }>('/admin/queue'));
  const decide = async (path: string, approve: boolean) => (await act(() => api(path, 'POST', { approve }), approve ? t('Одобрено') : t('Отклонено'))) && reload();
  if (loading) return <Loading />;
  return (
    <div className="stack">
      <h1 className="page-title">{t('Модерация')}</h1>
      <div className="card form">
        <h3>{t('Компании на проверке')}</h3>
        {data?.companies.map((c) => (
          <div className="line" key={c.id}>
            <div className="grow"><Link to={`/company/${c.id}`}><b>{c.form} «{c.name}»</b></Link><div className="muted small">{t('БИН')} {c.bin} · {t(ROLE_L[c.kind])}</div></div>
            <button className="btn ghost" onClick={() => decide(`/admin/companies/${c.id}`, false)}>{t('Отклонить')}</button>
            <button className="btn primary" onClick={() => decide(`/admin/companies/${c.id}`, true)}>{t('Одобрить')}</button>
          </div>
        ))}
        {data?.companies.length === 0 && <p className="muted">{t('Очередь пуста.')}</p>}
      </div>
      <div className="card form">
        <h3>{t('Документы на проверке')}</h3>
        {data?.documents.map((d) => (
          <div className="line" key={d.id}>
            <FileText size={18} />
            <div className="grow"><a href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer">{d.filename}</a><div className="muted small">{t(DOC_L[d.kind])} · {d.companyName}</div></div>
            <button className="btn ghost" onClick={() => decide(`/admin/documents/${d.id}`, false)}>{t('Отклонить')}</button>
            <button className="btn primary" onClick={() => decide(`/admin/documents/${d.id}`, true)}>{t('Одобрить')}</button>
          </div>
        ))}
        {data?.documents.length === 0 && <p className="muted">{t('Очередь пуста.')}</p>}
      </div>
      <AdminExtra />
    </div>
  );
}
