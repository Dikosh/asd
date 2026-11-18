// Кабинет, вторая часть: команда, партнёры и скрытые компании, тариф Pro, расширенная модерация.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Ban, Crown, EyeOff, Flag, Handshake, History, LifeBuoy, Newspaper, Plus, Search, Trash2, UserPlus, UserRound } from 'lucide-react';
import { api, companyTitle, Company, fmtDate, fmtWhen, Me, money, num, ROLE_L, t, useApp, useLoad } from '../core';
import { CompanyBadge, Empty, Field, Loading, Modal, ReasonModal, Select, Tabs } from '../ui';

// ---------- команда ----------
const TEAM_ROLE: Record<string, string> = { owner: 'Владелец', manager: 'Сотрудник', driver: 'Водитель' };
export function Team() {
  const { me, act } = useApp();
  const { data, loading, reload } = useLoad(() => api<{ seats: number; members: any[]; invites: any[]; myInvite: { companyName: string; companyForm: string; role: string } | null }>('/team'));
  const { setMe } = useApp();
  const answer = async (accept: boolean) => {
    if (accept && !confirm(t('Перейти в эту компанию? Ваши активные объявления уйдут в архив.'))) return;
    if (await act(() => api('/team/accept', 'POST', { accept }), accept ? t('Вы присоединились к компании') : t('Приглашение отклонено'))) {
      setMe(await api<Me>('/me'));
      reload();
    }
  };
  const [invite, setInvite] = useState<{ phone: string; name: string; role: string } | null>(null);
  const owner = me!.user.companyRole === 'owner';
  const used = (data?.members.length || 0) + (data?.invites.length || 0);
  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">{t('Команда')}</h1>
        {owner && <button className="btn primary" disabled={!!data && used >= data.seats} title={data && used >= data.seats ? t('Все места заняты') : undefined} onClick={() => setInvite({ phone: '', name: '', role: 'manager' })}><UserPlus size={17} /> {t('Пригласить')}</button>}
      </div>
      {data?.myInvite && (
        <div className="banner">
          <UserPlus size={20} />
          <div><b>{t('Вас пригласили в компанию «{name}»', { name: `${data.myInvite.companyForm ? `${data.myInvite.companyForm} ` : ''}${data.myInvite.companyName}` })}</b><span>{t('Если согласитесь, вы будете работать от имени этой компании.')}</span></div>
          <button className="btn ghost" onClick={() => answer(false)}>{t('Отклонить')}</button>
          <button className="btn primary" onClick={() => answer(true)}>{t('Принять')}</button>
        </div>
      )}
      <p className="muted">{t('У каждого сотрудника свой вход по номеру телефона. Все работают от имени одной компании: общие объявления, рейсы, рейтинг и баланс.')}</p>
      {data && <div className="info-line">{t('Занято мест: {n} из {m}', { n: used, m: data.seats })}{used >= data.seats ? <> · {t('все места заняты')}{me!.company.pro ? '' : <> — <Link to="/cabinet/balance">{t('на тарифе Pro мест больше')}</Link></>}</> : ''}</div>}
      {loading ? <Loading /> : (
        <div className="list">
          {data?.members.map((m) => (
            <div className="card line team-line" key={m.id}>
              <UserRound size={22} className="line-icon" />
              <div className="grow"><b>{m.name}</b>{m.me && <span className="muted"> · {t('это вы')}</span>}<div className="muted small">{m.phone} · {m.email}</div></div>
              <span className={`status ${m.companyRole === 'owner' ? 'sent' : ''}`}>{t(TEAM_ROLE[m.companyRole] || 'Сотрудник')}</span>
              {owner && !m.me && (
                <button className="icon-btn" aria-label={t('Удалить из команды')} onClick={async () => confirm(t('Убрать {name} из компании? Его сделки останутся в истории компании.', { name: m.name })) && (await act(() => api(`/team/members/${m.id}`, 'DELETE'), t('Сотрудник удалён из команды'))) && reload()}><Trash2 size={17} /></button>
              )}
            </div>
          ))}
          {data?.invites.map((i) => (
            <div className="card line team-line" key={`i${i.id}`}>
              <UserPlus size={22} className="line-icon muted" />
              <div className="grow"><b>{i.name || i.phone}</b><div className="muted small">{i.name ? `${i.phone} · ` : ''}{t(TEAM_ROLE[i.role] || 'Сотрудник')} · {t('приглашён {d}', { d: fmtDate(i.createdAt) })}</div></div>
              <span className="status">{i.existing ? t('Ждём, пока примет приглашение') : t('Ждём первого входа')}</span>
              {owner && <button className="icon-btn" aria-label={t('Отменить приглашение')} onClick={async () => (await act(() => api(`/team/invites/${i.id}`, 'DELETE'))) && reload()}><Trash2 size={17} /></button>}
            </div>
          ))}
        </div>
      )}
      {!owner && <p className="muted small">{t('Приглашать и удалять сотрудников может только владелец компании.')}</p>}
      {invite && (
        <Modal title={t('Пригласить в команду')} onClose={() => setInvite(null)}>
          <p className="muted small">{t('Сотруднику достаточно войти на платформу со своим номером — он сразу попадёт в вашу компанию.')}</p>
          <Field label={t('Номер телефона')}><input type="tel" autoFocus value={invite.phone} onChange={(e) => setInvite({ ...invite, phone: e.target.value })} placeholder="+7 701 123 45 67" /></Field>
          <p className="muted small">{t('Номер — тот, с которым человек входит на платформу. Если он уже зарегистрирован, приглашение придёт ему в уведомления.')}</p>
          <Field label={t('Имя (необязательно)')}><input value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} /></Field>
          <Field label={t('Кто это')} hint={invite.role === 'driver' ? t('Водитель видит только рейсы компании: включает GPS и отмечает этапы. Цены, чаты, баланс и объявления ему недоступны.') : t('Сотрудник размещает объявления, откликается, ведёт чаты и рейсы от имени компании. Баланс, тариф, документы и команда — только у владельца.')}>
            <Select value={invite.role} onChange={(v) => setInvite({ ...invite, role: v })} options={[{ value: 'manager', label: t('Сотрудник: логист, менеджер, диспетчер') }, { value: 'driver', label: t('Водитель') }]} />
          </Field>
          <div className="row end">
            <button className="btn ghost" onClick={() => setInvite(null)}>{t('Отмена')}</button>
            <button className="btn primary" disabled={invite.phone.replace(/\D/g, '').length < 10} onClick={async () => (await act(() => api('/team/invite', 'POST', invite), t('Приглашение создано'))) && (setInvite(null), reload())}>{t('Пригласить')}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------- партнёры и скрытые компании ----------
export function Partners() {
  const { act, cityName } = useApp();
  const [tab, setTab] = useState('partners');
  const { data, loading, reload } = useLoad(() => api<(Company & { cityId: string | null })[]>(tab === 'partners' ? '/partners' : '/blocks'), [tab]);
  const remove = async (c: Company) =>
    (await act(() => api(`/companies/${c.id}/${tab === 'partners' ? 'partner' : 'block'}`, 'POST', { on: false }), tab === 'partners' ? t('Убрано из партнёров') : t('Объявления компании снова видны'))) && reload();
  return (
    <div className="stack">
      <h1 className="page-title">{t('Партнёры')}</h1>
      <Tabs value={tab} onChange={setTab} items={[{ value: 'partners', label: t('Мои партнёры') }, { value: 'blocks', label: t('Скрытые компании') }]} />
      <p className="muted">
        {tab === 'partners'
          ? t('Компании, с которыми вы работаете постоянно. Их объявления помечены и находятся фильтром «от моих партнёров».')
          : t('Ваш личный чёрный список: объявления этих компаний вы не видите. Другим участникам список не показывается.')}
      </p>
      {loading ? <Loading /> : (
        <div className="list">
          {data?.map((c) => (
            <div className="card line" key={c.id}>
              <div className="grow"><CompanyBadge c={c} /><div className="muted small">{t(ROLE_L[c.kind])}{c.cityId ? ` · ${cityName(c.cityId)}` : ''}</div></div>
              <button className="btn ghost" onClick={() => remove(c)}>{tab === 'partners' ? t('Убрать') : t('Показывать снова')}</button>
            </div>
          ))}
          {data?.length === 0 && (
            <div className="card">
              {tab === 'partners'
                ? <Empty icon={<Handshake size={26} />} title={t('Партнёров пока нет')} text={t('Откройте страницу компании и нажмите «Добавить в партнёры».')}><Link to="/cabinet/catalog" className="btn soft">{t('Каталог компаний')}</Link></Empty>
                : <Empty icon={<EyeOff size={26} />} title={t('Скрытых компаний нет')} text={t('Скрыть компанию можно из меню «Действия» у её объявления.')} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- тариф Pro ----------
export function PlanCard({ onChange }: { onChange: () => void }) {
  const { me, meta, setMe, toast } = useApp();
  const pro = !!me!.company.pro;
  const owner = me!.user.companyRole === 'owner';
  const buy = async () => {
    if (!confirm(t('Подключить тариф Pro на {d} дней за {n} ₸ с баланса компании?', { d: meta.plan.days, n: num(meta.plan.price) }))) return;
    try {
      const m = await api<Me>('/plan/buy', 'POST');
      setMe(m);
      toast(pro && m.company.planUntil ? t('Тариф Pro продлён до {d}', { d: fmtDate(m.company.planUntil) }) : t('Тариф Pro подключён'));
      onChange();
    } catch (e: any) {
      // не хватает денег — говорим, сколько именно
      toast(e.code === 'balance' && e.need ? t('Не хватает {n} ₸ — пополните баланс ниже и повторите', { n: num(e.need) }) : t(e.message), 'error');
    }
  };
  return (
    <div className={`card plan ${pro ? 'on' : ''}`}>
      <div className="row between wrap">
        <b><Crown size={18} /> {t('Тариф Pro')}</b>
        {pro ? <span className="status accepted">{t('Активен до {d}', { d: fmtDate(me!.company.planUntil!) })}</span> : <span className="plan-price">{money(meta.plan.price)} <small>/ {t('{n} дней', { n: meta.plan.days })}</small></span>}
      </div>
      <ul className="plan-list">
        <li>{t('Поднятие объявлений в топ без доплаты')}</li>
        <li>{t('Подписки на поиск: до {n} вместо {m}', { n: meta.plan.pro.alerts, m: meta.plan.free.alerts })}</li>
        <li>{t('Команда до {n} человек вместо {m}', { n: meta.plan.pro.seats, m: meta.plan.free.seats })}</li>
        <li>{t('Отметка PRO рядом с названием компании')}</li>
      </ul>
      <p className="muted small">{t('Размещение, поиск, отклики, чат и контакты остаются бесплатными для всех.')}</p>
      {owner ? <button className={`btn ${pro ? 'soft' : 'primary'}`} onClick={buy}>{pro ? t('Продлить на {n} дней', { n: meta.plan.days }) : t('Подключить Pro')}</button> : <p className="muted small">{t('Подключить тариф может владелец компании.')}</p>}
    </div>
  );
}

// ---------- модератор: сводка, жалобы, обращения, новости ----------
const REASONS: Record<string, string> = {
  fraud: 'Похоже на мошенничество', outdated: 'Объявление устарело', wrong_info: 'Неверные данные', duplicate: 'Повтор объявления', rude: 'Грубость или угрозы', other: 'Другое',
};
const LOG_L: Record<string, string> = {
  ban: 'Блокировка компании', unban: 'Снятие блокировки', verify_approve: 'Компания проверена', verify_reject: 'Отказ в проверке', doc_approve: 'Документ принят',
  doc_reject: 'Документ отклонён', listing_remove: 'Объявление снято', complaint_dismiss: 'Жалоба закрыта без мер', blacklist_delete: 'Удалена запись чёрного списка',
  shipper_add: 'Добавлен заказчик', shipper_remove: 'Удалён заказчик', service_remove: 'Снята карточка услуги',
};
export function AdminExtra() {
  const { act } = useApp();
  const { data, loading, reload } = useLoad(() => api<any>('/admin/overview'));
  const news = useLoad(() => api<any[]>('/news'));
  const [post, setPost] = useState<{ title: string; body: string } | null>(null);
  const [ban, setBan] = useState<{ id: number; name: string } | null>(null);
  const [answer, setAnswer] = useState<any>(null);
  const [term, setTerm] = useState('');
  const found = useLoad(() => (term.trim().length >= 3 ? api<any[]>(`/admin/search?q=${encodeURIComponent(term.trim())}`) : Promise.resolve([])), [term]);
  if (loading || !data) return <Loading />;
  const s = data.stats;
  const unban = async (c: { id: number; name: string }) =>
    confirm(t('Снять блокировку с компании «{name}»?', { name: c.name })) && (await act(() => api(`/admin/companies/${c.id}/ban`, 'POST', { banned: false }), t('Блокировка снята'))) && (reload(), found.reload());
  return (
    <>
      <div className="stat-row">
        <div className="stat"><b>{num(s.users)}</b><span>{t('пользователей')} · +{s.week} {t('за неделю')}</span></div>
        <div className="stat"><b>{num(s.companies)}</b><span>{t('компаний')} · {s.verified} {t('проверено')}</span></div>
        <div className="stat"><b>{num(s.listings)}</b><span>{t('активных объявлений')} · {s.removed} {t('снято')}</span></div>
        <div className="stat"><b>{num(s.tripsActive)}</b><span>{t('рейсов в пути')} · {s.tripsDone} {t('завершено')}</span></div>
        <div className={`stat ${s.tripsFailed ? 'warn' : ''}`}><b>{num(s.tripsFailed)}</b><span>{t('рейсов сорвано')}</span></div>
        <div className="stat"><b>{num(s.banned)}</b><span>{t('компаний заблокировано')}</span></div>
        <div className="stat"><b>{num(s.pro)}</b><span>{t('компаний на Pro')}</span></div>
      </div>
      <div className="card form">
        <h3><Search size={17} /> {t('Найти компанию')}</h3>
        <div className="search-input"><Search size={17} /><input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('Название, БИН или телефон сотрудника')} /></div>
        {found.data?.map((c) => (
          <div className="line" key={c.id}>
            <div className="grow"><Link to={`/company/${c.id}`}><b>{companyTitle(c)}</b></Link>{c.banned && <span className="status declined"> {t('Заблокирована')}</span>}
              <div className="muted small">{c.bin ? `${t('БИН')} ${c.bin} · ` : ''}{c.people}</div></div>
            {c.banned
              ? <button className="btn soft" onClick={() => unban(c)}>{t('Снять блокировку')}</button>
              : <button className="btn ghost danger" onClick={() => setBan(c)}>{t('Заблокировать')}</button>}
          </div>
        ))}
        {term.trim().length > 0 && term.trim().length < 3 && <p className="muted small">{t('Введите не меньше 3 символов')}</p>}
        {term.trim().length >= 3 && found.data?.length === 0 && <p className="muted">{t('Ничего не найдено.')}</p>}
      </div>
      <div className="card form">
        <h3><Flag size={17} /> {t('Жалобы')}</h3>
        {data.complaints.map((c: any) => (
          <div className="line wrap" key={c.id}>
            <div className="grow">
              <b>{t(REASONS[c.reason] || c.reason)}</b> · <Link to={`/company/${c.companyId}`}>{c.companyName}</Link>
              {c.listingId && <> · <Link to={`/listing/${c.listingId}`}>{t('объявление №{n}', { n: c.listingId })}</Link></>}
              {c.text && <div>{c.text}</div>}
              <div className="muted small">{c.author} · {fmtWhen(c.createdAt)} · {t('всего жалоб на компанию: {n}', { n: c.total })}</div>
            </div>
            <button className="btn ghost" onClick={async () => (await act(() => api(`/admin/complaints/${c.id}`, 'POST', { action: 'dismiss' }), t('Жалоба закрыта'))) && reload()}>{t('Закрыть без мер')}</button>
            {c.listingId && <button className="btn danger" onClick={async () => confirm(t('Снять объявление с публикации?')) && (await act(() => api(`/admin/complaints/${c.id}`, 'POST', { action: 'close_listing' }), t('Объявление снято'))) && reload()}>{t('Снять объявление')}</button>}
            <button className="btn ghost danger" onClick={() => setBan({ id: c.companyId, name: c.companyName })}>{t('Заблокировать компанию')}</button>
          </div>
        ))}
        {data.complaints.length === 0 && <p className="muted">{t('Очередь пуста.')}</p>}
      </div>
      <div className="card form">
        <h3><LifeBuoy size={17} /> {t('Обращения в поддержку')}</h3>
        {data.feedback.map((f: any) => (
          <div className="line wrap" key={f.id}>
            <div className="grow"><div>{f.text}</div><div className="muted small">{f.userName} · <Link to={`/company/${f.companyId}`}>{f.companyName}</Link>{f.banned ? ` · ${t('Заблокирована')}` : ''} · <a href={`tel:${f.phone}`}>{f.phone}</a> · {fmtWhen(f.createdAt)}</div></div>
            <button className="btn ghost" onClick={async () => (await act(() => api(`/admin/feedback/${f.id}`, 'POST', {}), t('Обращение закрыто'))) && reload()}>{t('Закрыть без ответа')}</button>
            <button className="btn primary" onClick={() => setAnswer(f)}>{t('Ответить')}</button>
          </div>
        ))}
        {data.feedback.length === 0 && <p className="muted">{t('Очередь пуста.')}</p>}
      </div>
      <div className="card form">
        <h3><Ban size={17} /> {t('Заблокированные компании')}</h3>
        {data.banned.map((c: any) => (
          <div className="line" key={c.id}>
            <div className="grow"><Link to={`/company/${c.id}`}><b>{companyTitle(c)}</b></Link><div className="muted small">{c.bin ? `${t('БИН')} ${c.bin} · ` : ''}{t('Причина')}: {c.reason || '—'}</div></div>
            <button className="btn soft" onClick={() => unban(c)}>{t('Снять блокировку')}</button>
          </div>
        ))}
        {data.banned.length === 0 && <p className="muted">{t('Заблокированных компаний нет.')}</p>}
      </div>
      <div className="card form">
        <h3><AlertTriangle size={17} /> {t('Сорванные рейсы')}</h3>
        <p className="muted small">{t('Кто сорвал рейс и почему. Несколько срывов у одной компании — повод проверить её.')}</p>
        {data.failed.map((f: any) => (
          <div className="line" key={f.id}>
            <div className="grow">
              <Link to={`/company/${f.customerId}`}>{f.customer}</Link> ↔ <Link to={`/company/${f.carrierId}`}>{f.carrier}</Link>
              <div>{f.reason}</div>
              <div className="muted small">{f.failedBy ? t('Сообщила: {name} · всего её срывов: {n}', { name: f.failedBy, n: f.total }) : ''} · {fmtWhen(f.finishedAt)}</div>
            </div>
            {f.failedById && <button className="btn ghost danger" onClick={() => setBan({ id: f.failedById, name: f.failedBy })}>{t('Заблокировать')}</button>}
          </div>
        ))}
        {data.failed.length === 0 && <p className="muted">{t('Сорванных рейсов нет.')}</p>}
      </div>
      <div className="card form">
        <div className="row between wrap"><h3><Newspaper size={17} /> {t('Новости')}</h3><button className="btn soft" onClick={() => setPost({ title: '', body: '' })}><Plus size={16} /> {t('Добавить новость')}</button></div>
        {news.data?.map((n) => (
          <div className="line" key={n.id}>
            <div className="grow"><b>{n.title}</b><div className="muted small">{fmtDate(n.createdAt)}</div></div>
            <button className="icon-btn" aria-label={t('Удалить')} onClick={async () => confirm(t('Удалить новость?')) && (await act(() => api(`/admin/news/${n.id}`, 'DELETE'))) && news.reload()}><Trash2 size={17} /></button>
          </div>
        ))}
      </div>
      <div className="card form">
        <h3><History size={17} /> {t('Журнал модератора')}</h3>
        {data.log.map((l: any) => (
          <div className="line" key={l.id}>
            <div className="grow"><b>{t(LOG_L[l.action] || l.action)}</b> · {l.target}{l.note && <div>{l.note}</div>}<div className="muted small">{l.admin} · {fmtWhen(l.createdAt)}</div></div>
          </div>
        ))}
        {data.log.length === 0 && <p className="muted">{t('Действий пока не было.')}</p>}
      </div>
      {ban && (
        <ReasonModal title={t('Заблокировать компанию «{name}»', { name: ban.name })} danger confirm={t('Заблокировать')} label={t('Причина блокировки')}
          hint={t('Объявления компании пропадут из поиска, размещать и откликаться она не сможет. Причину компания увидит и сможет обжаловать через поддержку. Блокировку можно снять.')}
          onClose={() => setBan(null)}
          onSubmit={async (reason) => (await act(() => api(`/admin/companies/${ban.id}/ban`, 'POST', { banned: true, reason }), t('Компания заблокирована'))) && (setBan(null), reload(), found.reload())} />
      )}
      {answer && (
        <ReasonModal title={t('Ответ на обращение')} confirm={t('Отправить ответ')} label={t('Ваш ответ')} min={2} hint={`${answer.userName}: ${answer.text}`}
          onClose={() => setAnswer(null)}
          onSubmit={async (reply) => (await act(() => api(`/admin/feedback/${answer.id}`, 'POST', { reply }), t('Ответ отправлен'))) && (setAnswer(null), reload())} />
      )}
      {post && (
        <Modal title={t('Добавить новость')} onClose={() => setPost(null)}>
          <Field label={t('Заголовок')}><input autoFocus value={post.title} onChange={(e) => setPost({ ...post, title: e.target.value })} maxLength={160} /></Field>
          <Field label={t('Текст')}><textarea rows={5} value={post.body} onChange={(e) => setPost({ ...post, body: e.target.value })} maxLength={4000} /></Field>
          <div className="row end">
            <button className="btn ghost" onClick={() => setPost(null)}>{t('Отмена')}</button>
            <button className="btn primary" disabled={post.title.trim().length < 3 || post.body.trim().length < 3} onClick={async () => (await act(() => api('/admin/news', 'POST', post), t('Новость опубликована'))) && (setPost(null), news.reload())}>{t('Опубликовать')}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
