// Кабинет: профиль и документы, отклики, сообщения, рейсы, машины, сотрудники, баланс, каталог, чёрный список, настройки.
import { Fragment, ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, BadgeCheck, BarChart3, Ban, Bookmark, Briefcase, Building2, Calculator, ChevronRight, FileText, Flag, Handshake, Inbox, LifeBuoy, LogOut, MessageSquare, Paperclip, Pencil, Plus,
  Route as RouteIcon, Search, Send, Settings, ShieldCheck, Trash2, TrendingUp, Truck, Upload, UserRound, Users, UsersRound, Wallet,
} from 'lucide-react';
import { api, companyTitle, BODY_L, Company, DOC_L, fmtDate, fmtStamp, fmtTime, fmtWhen, KIND_L, LOADING_L, Me, money, num, opts, prepareUpload, ROLE_L, t, Trip, useApp, useEvent, useLoad } from '../core';
import { Chips, CitySelect, CompanyBadge, Empty, Field, LangSwitch, Loading, Modal, Select, Tabs, ReasonModal } from '../ui';
import { TripSummary } from './TripPage';
import { ComplaintModal, ContactButtons } from '../listing';
import { AdminExtra, Partners, PlanCard, Team } from './CabinetExtra';
import { PushToggle } from './Notifications';
import MetricsTab from './Metrics';

export default function Cabinet() {
  const { tab, id } = useParams();
  const { me } = useApp();
  const items: { key: string; label: string; icon: ReactNode; badge?: number; el: ReactNode }[] = [
    { key: 'profile', label: t('Профиль'), icon: <UserRound size={19} />, el: <Profile /> },
    { key: 'responses', label: t('Отклики'), icon: <Inbox size={19} />, badge: me!.counters.responses, el: <Responses /> },
    { key: 'messages', label: t('Сообщения'), icon: <MessageSquare size={19} />, badge: me!.counters.unread, el: <Messages chatId={id ? Number(id) : null} /> },
    { key: 'trips', label: t('Рейсы'), icon: <RouteIcon size={19} />, badge: me!.counters.trips, el: <Trips /> },
    { key: 'vehicles', label: t('Машины'), icon: <Truck size={19} />, el: <Vehicles /> },
    { key: 'team', label: t('Команда'), icon: <UsersRound size={19} />, el: <Team /> },
    { key: 'employees', label: t('Водители и персонал'), icon: <Users size={19} />, el: <Employees /> },
    { key: 'balance', label: t('Баланс и тариф'), icon: <Wallet size={19} />, el: <Balance /> },
    { key: 'catalog', label: t('Каталог компаний'), icon: <Building2 size={19} />, el: <Catalog /> },
    { key: 'partners', label: t('Партнёры'), icon: <Handshake size={19} />, el: <Partners /> },
    { key: 'blacklist', label: t('Чёрный список'), icon: <Ban size={19} />, el: <Blacklist /> },
    { key: 'settings', label: t('Настройки'), icon: <Settings size={19} />, el: <SettingsTab /> },
    ...(me!.user.isAdmin ? [
      { key: 'admin', label: t('Админ (арбитраж)'), icon: <ShieldCheck size={19} />, el: <Admin /> },
      { key: 'metrics', label: t('Показатели площадки'), icon: <BarChart3 size={19} />, el: <MetricsTab /> },
    ] : []),
  ];
  // водитель из команды ведёт рейсы; сделки, деньги и документы — у владельца и сотрудников
  // водителю-одиночке не показываем то, что нужно только компаниям
  const visible = me!.user.companyRole === 'driver' ? items.filter((i) => ['profile', 'trips', 'team', 'catalog', 'settings'].includes(i.key))
    : me!.user.role === 'driver' ? items.filter((i) => !['employees', 'partners'].includes(i.key))
    // заказчику парк машин и список водителей не нужны; деньги и тариф — у владельца компании
    : items.filter((i) => !(me!.user.role === 'customer' && ['vehicles', 'employees'].includes(i.key)) && !(me!.user.companyRole !== 'owner' && i.key === 'balance'));
  const current = visible.find((i) => i.key === tab);
  // закрытый для роли раздел по прямой ссылке — объясняем, а не молча показываем профиль
  if (tab && !current)
    return (
      <div className="card">
        <Empty icon={<ShieldCheck size={26} />} title={t('Раздел недоступен')} text={items.some((i) => i.key === tab) ? t('Этот раздел недоступен для вашей роли в компании.') : t('Такого раздела нет.')}>
          <Link to="/cabinet" className="btn soft">{t('В кабинет')}</Link>
        </Empty>
      </div>
    );
  return (
    <div className={`cabinet ${current ? 'has-tab' : ''}`}>
      <aside className="card cab-menu">
        <div className="cab-user">
          <b>{me!.user.name}</b>
          <span className="muted small">{t(ROLE_L[me!.user.role])} · {companyTitle(me!.company)}</span>
        </div>
        {visible.map((i) => (
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
        {(current ?? visible[0]).el}
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
  const binSaved = !!c.bin && c.binValid;
  const hasDoc = !!docs.data?.some((d) => (d.kind === 'registration' || d.kind === 'id_card') && d.status !== 'rejected');
  const canVerify = binSaved && hasDoc;

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
      <h1 className="page-title">{t('Профиль')}</h1>
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
          <h3>{companyTitle(c)}</h3>
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
          {c.verified === 'rejected' && c.verifyNote && <div className="form-error"><b>{t('Причина отказа')}:</b> {c.verifyNote}</div>}
          {c.verified !== 'verified' && c.verified !== 'pending' && (
            <button className="btn primary" disabled={!canVerify} onClick={() => act(async () => { await api('/company/verify-request', 'POST'); setMe(await api<Me>('/me')); }, t('Заявка на проверку отправлена'))}>
              <ShieldCheck size={16} /> {t('Отправить на проверку')}
            </button>
          )}
        </div>
        {c.verified !== 'verified' && c.verified !== 'pending' && (
          <ul className="checklist">
            <li className={binSaved ? 'done' : ''}>{binSaved ? <BadgeCheck size={16} /> : <span className="todo-dot" />} {t('Укажите БИН или ИИН и нажмите «Сохранить»')}</li>
            <li className={hasDoc ? 'done' : ''}>{hasDoc ? <BadgeCheck size={16} /> : <span className="todo-dot" />} {t('Загрузите свидетельство о регистрации или удостоверение личности')}{!hasDoc && !!docs.data?.length && <span className="muted small"> — {t('в «Виде документа» выберите один из этих двух')}</span>}</li>
            <li>{<span className="todo-dot" />} {t('Отправьте на проверку — модератор отвечает в течение рабочего дня')}</li>
          </ul>
        )}
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
            <div className="grow"><a href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer">{d.filename}</a><div className="muted small">{t(DOC_L[d.kind])} · {fmtDate(d.createdAt)}</div>{d.status === 'rejected' && d.note && <div className="form-error"><b>{t('Причина отказа')}:</b> {d.note}</div>}</div>
            <span className={`status ${d.status === 'approved' ? 'accepted' : d.status === 'pending' && c.verified !== 'none' && c.verified !== 'rejected' ? 'sent' : d.status === 'pending' ? '' : 'declined'}`}>
              {/* пока компания не отправила заявку, документ просто загружен — модератор его ещё не видит */}
              {d.status === 'pending' && (c.verified === 'none' || c.verified === 'rejected') ? t('Загружен, не отправлен') : t(DOC_ST[d.status])}
            </span>
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
                <Link to={`/listing/${r.listingId}`} className="lcard-title small">{t(KIND_L[r.kind])}: {cityName(r.fromId)} → {cityName(r.toId)}</Link>
                <span className={`status ${r.status}`}>{t(RESP_L[r.status])}</span>
              </div>
              <p>{r.message}</p>
              <div className="row between wrap">
                <span className="muted small">
                  {tab === 'incoming' ? <><Link to={`/company/${r.companyId}`}>{r.companyName}</Link> · {t(ROLE_L[r.companyKind])}{r.companyVerified === 'verified' ? ` · ${t('Проверена')}` : ''}{r.companyRating != null ? ` · ★ ${r.companyRating.toFixed(1)}` : ''}</> : <Link to={`/company/${r.ownerCompanyId}`}>{r.ownerCompany}</Link>}
                  {' · '}{r.price ? money(r.price, r.currency) : t('Без предложения цены')} · {fmtWhen(r.createdAt)}
                </span>
                <div className="row wrap">
                  {r.chatId && <Link to={`/cabinet/messages/${r.chatId}`} className="btn soft"><MessageSquare size={16} /> {t('Чат')}</Link>}
                  {r.tripId && <Link to={`/trip/${r.tripId}`} className="btn soft">{t('Рейс')}</Link>}
                  {r.status === 'sent' && tab === 'outgoing' && <button className="btn ghost" onClick={() => decide(r, 'withdraw', t('Отклик отозван'))}>{t('Отозвать отклик')}</button>}
                  {r.status === 'sent' && tab === 'incoming' && (
                    <>
                      <button className="btn ghost" onClick={() => confirm(t('Отклонить отклик компании «{name}»?', { name: r.companyName })) && decide(r, 'decline', t('Отклик отклонён'))}>{t('Отклонить')}</button>
                      {r.companyKind === 'broker' && r.kind === 'cargo'
                        ? <span className="muted small">{t('Таможенный брокер: договоритесь об услугах в чате')}</span>
                        : <button className="btn primary" onClick={() => confirm(t('Создать рейс с компанией «{name}»{price}? Остальные отклики останутся без ответа, объявление скроется из поиска.', { name: r.companyName, price: r.price ? ` — ${money(r.price, r.currency)}` : '' })) && decide(r, 'accept', t('Рейс создан'))}>{t('Принять')}</button>}
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
  // ранние сообщения длинной переписки подгружаются по кнопке
  const [older, setOlder] = useState<any[]>([]);
  const [moreOld, setMoreOld] = useState(true);
  useEffect(() => { setOlder([]); setMoreOld(true); }, [chatId]);
  const all = [...older, ...(msgs.data || [])];
  const loadOlder = async () => {
    const first = all[0];
    if (!first) return;
    const prev = await api<any[]>(`/chats/${chatId}/messages?before=${first.id}`).catch(() => []);
    setOlder((x) => [...prev, ...x]);
    if (prev.length < 300) setMoreOld(false);
  };
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEvent('message read', (d) => {
    chats.reload();
    if (d.chatId === chatId) msgs.reload();
  });
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs.data?.length]); // при подгрузке ранних не прыгаем вниз
  useEffect(() => { if (chatId && msgs.data) { reloadMe(); chats.reload(); } }, [chatId, msgs.data?.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const chat = chats.data?.find((c) => c.id === chatId);
  const MAX_MSG = 2000;
  const send = async () => {
    const body = text.trim();
    if (!body || body.length > MAX_MSG) return;
    setText('');
    if (!(await act(() => api(`/chats/${chatId}/messages`, 'POST', { text: body })))) setText(body);
  };
  // фото груза, техпаспорт, реквизиты — файлом прямо в переписку
  const [sending, setSending] = useState(false);
  const [complain, setComplain] = useState(false);
  const attach = async (f: File) => {
    setSending(true);
    await act(async () => api(`/chats/${chatId}/files`, 'POST', await prepareUpload(f)));
    setSending(false);
  };
  return (
    <div className={`chat-layout ${chatId ? 'open' : ''}`}>
      <div className="card chat-list">
        <h1 className="page-title">{t('Сообщения')}</h1>
        {chats.loading && <Loading />}
        {chats.data?.map((c) => (
          <Link key={c.id} to={`/cabinet/messages/${c.id}`} className={`chat-item ${c.id === chatId ? 'on' : ''}`}>
            <div className="row between"><b>{c.peerCompany}</b>{c.unread > 0 && <span className="badge inline">{c.unread}</span>}</div>
            <div className="muted small">{cityName(c.fromId)} → {cityName(c.toId)}{c.peerName ? ` · ${c.peerName}` : ''}</div>
            <div className="chat-last">{c.blocked ? t('Переписка закрыта') : c.lastText}</div>
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
                <div className="muted small"><Link to={`/listing/${chat.listingId}`}>{t(KIND_L[chat.kind])}: {cityName(chat.fromId)} → {cityName(chat.toId)}</Link></div>
              </div>
            )}
            {chat?.peerPhone && <div className="row chat-contacts"><ContactButtons phone={chat.peerPhone} /></div>}
            {chat && <button className="icon-btn" onClick={() => setComplain(true)} aria-label={t('Пожаловаться')} title={t('Пожаловаться')}><Flag size={18} /></button>}
          </header>
          {complain && chat && <ComplaintModal companyId={chat.peerCompanyId} onClose={() => setComplain(false)} />}
          {msgs.error && <Empty icon={<MessageSquare size={26} />} title={t('Чат не найден')} text={t('Возможно, он принадлежит другой компании или ссылка устарела.')}><Link to="/cabinet/messages" className="btn soft">{t('Все сообщения')}</Link></Empty>}
          <div className="chat-msgs">
            {moreOld && all.length >= 300 && <button className="btn ghost small-btn center-btn" onClick={loadOlder}>{t('Показать более ранние сообщения')}</button>}
            {all.map((m, i) => (
              <Fragment key={m.id}>
              {/* разделитель дня: в длинной переписке видно, когда что было сказано */}
              {(i === 0 || fmtDate(all[i - 1].createdAt) !== fmtDate(m.createdAt)) && <div className="msg-day">{fmtDate(m.createdAt)}</div>}
              <div className={`msg ${m.mine ? 'mine' : ''}`}>
                {/* чат общий для компании: подписываем, кто из коллег или партнёров написал */}
                {!m.me && <b className="msg-author">{m.senderName}</b>}
                {m.file ? (
                  m.file.mime.startsWith('image/')
                    ? <a className="msg-file" href={`/api/files/${m.file.id}`} target="_blank" rel="noreferrer"><img src={`/api/files/${m.file.id}`} alt={m.file.filename} loading="lazy" /></a>
                    : <a className="msg-file doc" href={`/api/files/${m.file.id}`} target="_blank" rel="noreferrer"><FileText size={16} /> {m.file.filename}</a>
                ) : <p>{m.text}</p>}
                {m.warn && <div className="msg-warn">{t('Осторожно: сотрудники Timma не просят код из SMS и переводы на карту. Не отправляйте деньги незнакомой компании.')}</div>}
                <span>{fmtTime(m.createdAt)}{m.mine && (m.isRead ? ' ✓✓' : ' ✓')}</span>
              </div>
              </Fragment>
            ))}
            <div ref={end} />
          </div>
          {chat?.blocked ? (
            <div className="info-line chat-blocked">{t('Переписка закрыта: одна из компаний скрыла другую. Новые сообщения отправить нельзя.')}</div>
          ) : !msgs.error && (
          <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <label className={`icon-btn attach ${sending ? 'disabled' : ''}`} aria-label={t('Прикрепить фото или документ')} title={t('Прикрепить фото или документ')}>
              <Paperclip size={19} />
              <input type="file" hidden accept="image/*,application/pdf" disabled={sending} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) attach(f); }} />
            </label>
            {/* Enter — отправить, Shift+Enter — новая строка */}
            <div className="grow chat-text">
              <textarea rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Напишите сообщение…')} autoFocus aria-label={t('Сообщение')}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
              {text.length > MAX_MSG - 200 && <span className={`small ${text.length > MAX_MSG ? 'field-error' : 'muted'}`}>{text.length} / {MAX_MSG}</span>}
            </div>
            <button className="btn primary" disabled={!text.trim() || text.length > MAX_MSG} aria-label={t('Отправить')}><Send size={17} /></button>
          </form>
          )}
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
        <h1 className="page-title">{t('Водители и персонал')}</h1>
        <button className="btn primary" onClick={() => setEdit({ name: '', phone: '', position: t('Водитель'), licenseCats: '', experience: '', esutd: 'unknown', esutdNumber: '' })}><Plus size={17} /> {t('Добавить сотрудника')}</button>
      </div>
      <p className="muted small">{t('Список людей без входа в Timma: их данные подставляются в рейс и в заявку. Тем, кто должен сам вести рейсы в приложении, отправьте приглашение в разделе «Команда».')}</p>
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
  const KIND: Record<string, string> = { topup: 'Пополнение', boost: 'Поднятие в топ', plan: 'Тариф Pro', service: 'Каталог услуг' };
  const topup = async (amount: number) => (await act(() => api('/balance/topup', 'POST', { amount }), t('Баланс пополнен'))) && (reload(), reloadMe());
  return (
    <div className="stack">
      <h1 className="page-title">{t('Баланс и тариф')}</h1>
      <div className="card balance">
        <div><span className="muted">{t('На счёте компании')}</span><b>{money(data?.balance ?? 0)}</b></div>
        <p className="muted small">{t('С баланса оплачиваются поднятие объявлений в топ ({n} ₸ за 24 часа) и показ в каталоге услуг. Размещение, поиск и отклики бесплатны.', { n: meta.boostPrice })}</p>
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
              <div className="grow">{t(KIND[x.kind] || x.kind)}<div className="muted small">{txNote(x.note)} · {fmtStamp(x.createdAt)}</div></div>
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
                <div className="muted small">{c.verified === 'verified' ? `${t('Проверена')} · ` : ''}{t(ROLE_L[c.kind])}{c.cityId ? ` · ${cityName(c.cityId)}` : ''}{c.bin ? ` · ${t('БИН')} ${c.bin}` : ''}</div>
              </div>
              <div className="cat-stats"><b>{c.trips}</b><span>{t('рейсов')}</span></div>
              <div className="cat-stats"><b>{c.reviews}</b><span>{t('отзывов')}</span></div>
              {c.blacklisted > 0 && <span className="status declined" title={t('Записи в чёрном списке от проверенных компаний')}><Ban size={13} /> {t('ЧС')}: {c.blacklisted}</span>}
              <ChevronRight size={18} className="muted" />
            </Link>
          ))}
          {data?.length === 0 && <div className="card"><Empty title={t('Компании не найдены')} /></div>}
        </div>
      )}
    </div>
  );
}

/** Подпись операции хранится по-русски — показываем её на языке интерфейса и с датой в обычном виде. */
function txNote(note: string) {
  const ad = /^Объявление №(\d+)$/.exec(note);
  if (ad) return t('Объявление №{n}', { n: ad[1] });
  const plan = /^Тариф Pro до (\d{4}-\d\d-\d\d)$/.exec(note);
  if (plan) return t('Тариф Pro до {d}', { d: fmtDate(plan[1]) });
  const svc = /^Каталог услуг до (\d{4}-\d\d-\d\d)$/.exec(note);
  if (svc) return t('Показ в каталоге услуг до {d}', { d: fmtDate(svc[1]) });
  return t(note);
}

// ---------- чёрный список ----------
function Blacklist() {
  const { act, me } = useApp();
  const [q, setQ] = useState('');
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const isOwner = me!.user.companyRole === 'owner';
  const { data, loading, reload } = useLoad(() => api<any[]>(`/blacklist?q=${encodeURIComponent(q)}`), [q]);
  return (
    <div className="stack">
      <h1 className="page-title">{t('Чёрный список')}</h1>
      <p className="muted">{t('Компании, которых участники внесли в чёрный список после рейса с ними. У каждой записи — причина и отзыв. Внести компанию можно с её страницы — кнопка появляется, если у вас был с ней рейс. Жалоба модератору — отдельное действие: она в этот список не попадает.')}</p>
      <div className="search-input"><Search size={17} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Название или БИН')} /></div>
      {loading ? <Loading /> : (
        <div className="list">
          {data?.map((b) => (
            <div className="card resp" key={b.id}>
              <div className="row between wrap">
                <Link to={`/company/${b.companyId}`} className="company-link"><span className="dot red" /> {companyTitle(b)}</Link>
                <span className="status declined">{t('Записей о компании: {n}', { n: b.total })}</span>
              </div>
              <div><b>{t('Причина')}:</b> {b.reason}</div>
              {b.review && <p>{b.review}</p>}
              {b.reply && <p className="bl-reply"><b>{t('Ответ компании')}:</b> {b.reply}</p>}
              {b.aboutUs && !b.reply && isOwner && <button className="link" onClick={() => setReplyTo(b.id)}>{t('Ответить')}</button>}
              <div className="row between wrap">
                <span className="muted small">{b.author} · {fmtDate(b.createdAt)}{b.bin ? ` · ${t('БИН')} ${b.bin}` : ''}{b.counted ? '' : ` · ${t('автор не проверен — в индикаторе не учитывается')}`}</span>
                {b.canDelete && !b.mine && <button className="btn ghost danger" onClick={async () => confirm(t('Удалить эту запись из чёрного списка? Действие попадёт в журнал модератора.')) && (await act(() => api(`/blacklist/${b.id}`, 'DELETE'), t('Запись удалена'))) && reload()}>{t('Удалить запись')}</button>}
                {b.mine && <button className="btn ghost" onClick={async () => confirm(t('Убрать вашу запись из чёрного списка?')) && (await act(() => api(`/blacklist/${b.id}`, 'DELETE'))) && reload()}>{t('Убрать мою запись')}</button>}
              </div>
            </div>
          ))}
          {data?.length === 0 && <div className="card"><Empty icon={<Ban size={26} />} title={t('Записей нет')} /></div>}
        </div>
      )}
      <Link to="/cabinet/catalog" className="btn soft">{t('Найти компанию в каталоге')}</Link>
      {replyTo !== null && (
        <ReasonModal title={t('Ответ на запись')} hint={t('Ответ увидят все, кто смотрит вашу компанию. Изменить его потом нельзя.')} label={t('Ваш ответ')} confirm={t('Опубликовать')}
          onClose={() => setReplyTo(null)}
          onSubmit={async (text) => (await act(() => api(`/blacklist/${replyTo}/reply`, 'POST', { reply: text }), t('Ответ опубликован'))) && (setReplyTo(null), reload())} />
      )}
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
        <label className="switch">{toggle('news', false)}<span>{t('Получать новости платформы')}</span></label>
      </div>
      <div className="row wrap">
        <button className="btn ghost danger" onClick={() => act(async () => { await api('/auth/logout', 'POST', {}); setMe(null); })}><LogOut size={16} /> {t('Выйти из аккаунта')}</button>
        <button className="btn ghost" onClick={() => confirm(t('Выйти на всех устройствах?')) && act(async () => { await api('/auth/logout', 'POST', { everywhere: true }); setMe(null); })}>{t('Выйти на всех устройствах')}</button>
      </div>
      <div className="card form">
        <h3>{t('Удаление аккаунта')}</h3>
        <p className="muted small">{t('Имя, телефон, почта, уведомления и подписки будут удалены, вход закроется на всех устройствах. В рейсах и переписке у партнёров останется запись «Аккаунт удалён». С этим номером потом можно зарегистрироваться заново.')}</p>
        <p className="muted small"><Link to="/privacy" className="link">{t('Политика конфиденциальности')}</Link></p>
        <div className="row wrap">
          <button className="btn ghost danger" onClick={() => confirm(t('Удалить аккаунт навсегда? Отменить это нельзя.')) && act(async () => { await api('/me', 'DELETE'); setMe(null); })}><Trash2 size={16} /> {t('Удалить аккаунт')}</button>
        </div>
      </div>
    </div>
  );
}

// ---------- модерация ----------
function Admin() {
  const { act } = useApp();
  const { data, loading, reload } = useLoad(() => api<{ companies: any[]; documents: any[] }>('/admin/queue'));
  // при отказе модератор объясняет причину — компания увидит её в кабинете
  const [reject, setReject] = useState<string | null>(null);
  const decide = async (path: string, approve: boolean, note = '') => {
    if (!approve && !note) return setReject(path);
    if (await act(() => api(path, 'POST', { approve, note }), approve ? t('Одобрено') : t('Отклонено'))) { setReject(null); reload(); }
  };
  if (loading) return <Loading />;
  return (
    <div className="stack">
      <h1 className="page-title">{t('Админ (арбитраж)')}</h1>
      <div className="card form">
        <h3>{t('Компании на проверке')}</h3>
        {data?.companies.map((c) => (
          <div className="line actions-line" key={c.id}>
            <div className="grow"><Link to={`/company/${c.id}`}><b>{companyTitle(c)}</b></Link><div className="muted small">{t('БИН')} {c.bin} · {t(ROLE_L[c.kind])}</div>
              <div className="doc-chips">{c.docs.map((d: any) => <a key={d.id} className={`chip doc-${d.status}`} href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer"><FileText size={13} /> {t(DOC_L[d.kind])}</a>)}{c.docs.length === 0 && <span className="muted small">{t('Документы не загружены')}</span>}</div></div>
            <button className="btn ghost" onClick={() => decide(`/admin/companies/${c.id}`, false)}>{t('Отклонить')}</button>
            <button className="btn primary" onClick={() => decide(`/admin/companies/${c.id}`, true)}>{t('Одобрить')}</button>
          </div>
        ))}
        {data?.companies.length === 0 && <p className="muted">{t('Очередь пуста.')}</p>}
      </div>
      <div className="card form">
        <h3>{t('Новые документы проверенных компаний')}</h3>
        {data?.documents.map((d) => (
          <div className="line actions-line" key={d.id}>
            <FileText size={18} />
            <div className="grow"><a href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer">{d.filename}</a><div className="muted small">{t(DOC_L[d.kind])} · {d.companyName}</div></div>
            <button className="btn ghost" onClick={() => decide(`/admin/documents/${d.id}`, false)}>{t('Отклонить')}</button>
            <button className="btn primary" onClick={() => decide(`/admin/documents/${d.id}`, true)}>{t('Одобрить')}</button>
          </div>
        ))}
        {data?.documents.length === 0 && <p className="muted">{t('Очередь пуста.')}</p>}
      </div>
      <AdminExtra />
      {reject && <ReasonModal title={t('Причина отказа')} hint={t('Причина отказа — её увидит компания')} label={t('Что нужно исправить')} confirm={t('Отклонить')} danger onClose={() => setReject(null)} onSubmit={(note) => decide(reject, false, note)} />}
    </div>
  );
}
