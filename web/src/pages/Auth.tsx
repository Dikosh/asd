// Вход по номеру телефона и регистрация одной формой; для гостей — витрина свежих объявлений.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BadgeCheck, FileCheck2, Lock, MapPinned, MessageCircle, Phone, Send, Users } from 'lucide-react';
import { api, BODY_L, CARGO_L, fmtDates, Me, money, num, KIND_L, ROLE_HINT, ROLE_L, t, useApp, useLoad, waLink } from '../core';
import { Field, LangSwitch, Logo, Select } from '../ui';

const CODES = [
  { value: '+7', label: '🇰🇿 +7' }, { value: '+998', label: '🇺🇿 +998' }, { value: '+996', label: '🇰🇬 +996' }, { value: '+992', label: '🇹🇯 +992' },
  { value: '+993', label: '🇹🇲 +993' }, { value: '+86', label: '🇨🇳 +86' }, { value: '+375', label: '🇧🇾 +375' }, { value: '+994', label: '🇦🇿 +994' },
  { value: '+995', label: '🇬🇪 +995' }, { value: '+90', label: '🇹🇷 +90' },
];
interface Invite { name: string; companyName: string; companyForm: string; role: string }
interface PublicListing { id: number; kind: 'cargo' | 'truck' | 'relocation'; points: string[]; bodyType: string | null; cargoType: string | null; weight: number | null; dateFrom: string; dateTo: string; rate: number | null; currency: string; distanceKm: number }

export default function AuthPage() {
  const { meta, setMe, act, routeName, toast } = useApp();
  const [step, setStep] = useState<'phone' | 'code' | 'reg'>('phone');
  const [prefix, setPrefix] = useState('+7');
  const [number, setNumber] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState('');
  // код входа приходит по SMS или в Telegram (бот); tgUrl — ссылка на чат с ботом, tgSent — код уже там (номер привязан)
  const [via, setVia] = useState<'sms' | 'telegram'>('sms');
  const [tgUrl, setTgUrl] = useState('');
  const [tgSent, setTgSent] = useState(false);
  const [regToken, setRegToken] = useState('');
  const [invite, setInvite] = useState<Invite | null>(null);
  const [join, setJoin] = useState(true);
  const [accept, setAccept] = useState(false);
  const [reg, setReg] = useState({ name: '', email: '', companyName: '', companyForm: '', role: 'customer' });
  const [busy, setBusy] = useState(false);
  // повторная отправка кода — не чаще раза в минуту
  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);
  const phoneInput = useRef<HTMLInputElement>(null);
  const feed = useLoad(() => api<PublicListing[]>('/public/listings').catch(() => []));
  // «+7 701…», «8 701…» и «701…» при коде +7 — один и тот же номер
  const local = (() => {
    const d = number.replace(/\D/g, '');
    return prefix === '+7' && d.length === 11 && (d[0] === '7' || d[0] === '8') ? d.slice(1) : d;
  })();
  const phone = prefix + local;
  const phoneOk = prefix === '+7' ? local.length === 10 : local.length >= 7;
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await act(fn);
    setBusy(false);
  };
  const joining = !!invite && join;
  // водителю своя компания не нужна: сервер заведёт запись на его имя без формы ИП/ТОО
  const isDriver = reg.role === 'driver';
  // чего не хватает для регистрации — показываем словами, а не только серой кнопкой
  const regMissing = [
    reg.name.trim().length < 2 && t('ФИО'),
    !joining && !isDriver && !reg.companyForm && t('форма компании (ТОО или ИП)'),
    !joining && !isDriver && reg.companyName.trim().length < 2 && t('наименование компании'),
    !accept && t('согласие с правилами'),
  ].filter(Boolean) as string[];
  const emailOptional = joining ? invite!.role === 'driver' : isDriver;

  const canSms = meta.login?.sms ?? true;
  const canTelegram = !!meta.login?.telegram;
  const requestCode = (how: 'sms' | 'telegram' = via) =>
    run(async () => {
      const r = await api('/auth/request-code', 'POST', how === 'telegram' ? { phone, via: 'telegram' } : { phone });
      setVia(how);
      setTgUrl(r.telegramUrl || '');
      setTgSent(!!r.sent);
      setDevCode(r.devCode || '');
      setCode('');
      setWait(60);
      setStep('code');
    });
  const verify = () =>
    run(async () => {
      const r = await api('/auth/verify', 'POST', { phone, code });
      if (r.registered) setMe(r as Me);
      else {
        setRegToken(r.regToken);
        setInvite(r.invite);
        setJoin(!!r.invite);
        if (r.invite?.name) setReg((x) => ({ ...x, name: r.invite.name }));
        setStep('reg');
      }
    });
  const register = () =>
    run(async () => setMe(await api<Me>('/auth/register', 'POST', joining ? { regToken, name: reg.name, email: reg.email, joinInvite: true, accept } : { regToken, ...reg, ...(isDriver ? { companyName: reg.name.trim(), companyForm: '' } : {}), accept })));
  const demo = (role: string) => run(async () => setMe(await api<Me>('/auth/demo', 'POST', { role })));

  const features = [
    { icon: <MapPinned size={22} />, title: t('GPS-рейсы'), text: t('Заказчик видит машину на карте и этап пути, получатель — по ссылке без регистрации.') },
    { icon: <BadgeCheck size={22} />, title: t('Проверенные компании'), text: t('БИН, документы, рейтинг по отзывам и чёрный список — до начала сделки.') },
    { icon: <Users size={22} />, title: t('Все участники в одном месте'), text: t('Заказчик, перевозчик, логист, брокер и водитель работают в одной системе.') },
    { icon: <FileCheck2 size={22} />, title: t('Сделка под контролем'), text: t('Отклик, чат, рейс, статус и отзыв — в одной цепочке, ничего не теряется.') },
  ];

  return (
    <div className="auth">
      <section className="auth-hero">
        <div className="auth-hero-top">
          <Logo />
          <LangSwitch />
        </div>
        <h1>{t('Грузы и транспорт находят друг друга напрямую')}</h1>
        <p className="lead">{t('Биржа грузоперевозок Казахстана и СНГ: размещайте объявления, откликайтесь, договаривайтесь в чате и ведите рейс с GPS.')}</p>
      </section>
      <section className="auth-more">
        <div className="auth-stats">
          <div><b>{num(meta.stats.cargo)}</b><span>{t('грузов сейчас')}</span></div>
          <div><b>{num(meta.stats.truck)}</b><span>{t('машин свободно')}</span></div>
          <div><b>{num(meta.stats.companies)}</b><span>{t('компаний')}</span></div>
        </div>
        <ul className="features">
          {features.map((f) => (
            <li key={f.title}>
              <span className="feature-icon">{f.icon}</span>
              <div><b>{f.title}</b><p>{f.text}</p></div>
            </li>
          ))}
        </ul>
        {feed.data && feed.data.length > 0 && (
          <div className="feed">
            <b>{t('Свежие объявления')}</b>
            {feed.data.slice(0, 5).map((l) => (
              <button key={l.id} className="feed-item" onClick={() => { toast(t('Войдите, чтобы увидеть контакты и откликнуться')); phoneInput.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); phoneInput.current?.focus({ preventScroll: true }); }}>
                <span className={`tag ${l.kind}`}>{t(KIND_L[l.kind])}</span>
                <span className="feed-route">{routeName([l.points[0], l.points[l.points.length - 1]])}</span>
                <span className="feed-meta">
                  {[l.cargoType && t(CARGO_L[l.cargoType]), l.bodyType && t(BODY_L[l.bodyType]), l.weight && `${l.weight} ${t('т')}`, fmtDates(l.dateFrom, l.dateTo)].filter(Boolean).join(' · ')}
                </span>
                <span className="feed-rate">{money(l.rate, l.currency)} <Lock size={12} /></span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="auth-panel">
        <form className="card auth-card" onSubmit={(e) => { e.preventDefault(); step === 'phone' ? requestCode(canSms || !canTelegram ? 'sms' : 'telegram') : step === 'code' ? verify() : register(); }}>
          {step === 'phone' && (
            <>
              <h2>{t('Вход и регистрация')}</h2>
              <p className="muted">{t('Введите номер — пришлём код. Если аккаунта нет, создадим его за минуту.')}</p>
              <Field label={t('Номер телефона')}>
                <div className="phone-row">
                  <Select value={prefix} onChange={setPrefix} options={CODES} />
                  <input ref={phoneInput} type="tel" inputMode="tel" autoFocus placeholder="701 123 45 67" value={number} onChange={(e) => setNumber(e.target.value)} autoComplete="tel-national" />
                </div>
              </Field>
              {(canSms || !canTelegram) && <button className="btn primary block" disabled={busy || !phoneOk}>{t('Получить код')}</button>}
              {canTelegram && (
                <button type={canSms ? 'button' : 'submit'} className={`btn ${canSms ? 'soft' : 'primary'} block`} disabled={busy || !phoneOk} onClick={canSms ? () => requestCode('telegram') : undefined}>
                  <Send size={16} /> {t('Получить код в Telegram')}
                </button>
              )}
              {!phoneOk && number.replace(/\D/g, '').length > 0 && <p className="muted small">{t('Введите номер полностью: 10 цифр, например 701 123 45 67')}</p>}
            </>
          )}
          {step === 'code' && (
            <>
              <h2>{via === 'telegram' ? t('Код из Telegram') : t('Код из SMS')}</h2>
              {via !== 'telegram' && <p className="muted">{t('Отправили код на {phone}', { phone })}</p>}
              {via === 'telegram' && (
                <>
                  <p className="muted">
                    {tgSent
                      ? t('Код отправлен в Telegram, в чат с ботом @{bot}. Скопируйте его там и введите здесь.', { bot: meta.login?.telegram || '' })
                      : t('Нажмите «Открыть Telegram», запустите бота @{bot} и нажмите «Поделиться номером». Бот пришлёт код — введите его здесь.', { bot: meta.login?.telegram || '' })}
                  </p>
                  {tgUrl && <a className="btn soft block" href={tgUrl} target="_blank" rel="noopener noreferrer"><Send size={16} /> {t('Открыть Telegram')}</a>}
                </>
              )}
              {devCode && <div className="demo-note">{t('Демо-режим: SMS не отправляется, ваш код')} <b>{devCode}</b></div>}
              <Field label={t('Код')}>
                <input className="code-input" inputMode="numeric" autoFocus maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoComplete="one-time-code" />
              </Field>
              <button className="btn primary block" disabled={busy || code.length < 6}>{t('Продолжить')}</button>
              <button type="button" className="btn ghost block" disabled={busy || wait > 0} onClick={() => requestCode()}>{wait > 0 ? t('Отправить код ещё раз через {n} с', { n: wait }) : t('Отправить код ещё раз')}</button>
              <button type="button" className="btn ghost block" onClick={() => setStep('phone')}>{t('Изменить номер')}</button>
            </>
          )}
          {/* человеку, которому не пришёл код, больше некуда обратиться: форма обращения — только после входа */}
          {step !== 'reg' && (meta.support.phone || meta.support.telegram) && (
            <div className="stack-s">
              <span className="muted small">{t('Не получается войти? Напишите в поддержку')}</span>
              <div className="row wrap">
                {meta.support.phone && <a className="btn soft" href={`tel:${meta.support.phone}`}><Phone size={16} /> {meta.support.phone}</a>}
                {meta.support.phone && <a className="btn soft wa" href={waLink(meta.support.phone)} target="_blank" rel="noreferrer"><MessageCircle size={16} /> WhatsApp</a>}
                {meta.support.telegram && <a className="btn soft" href={meta.support.telegram} target="_blank" rel="noreferrer"><Send size={16} /> Telegram</a>}
              </div>
            </div>
          )}
          {step === 'reg' && (
            <>
              <h2>{t('Регистрация')}</h2>
              {invite ? (
                <div className="invite-box">
                  <b>{t('Вас пригласили в компанию «{name}»', { name: `${invite.companyForm ? `${invite.companyForm} ` : ''}${invite.companyName}` })}</b>
                  <div className="chips-select">
                    <button type="button" className={`chip-btn ${join ? 'on' : ''}`} aria-pressed={join} onClick={() => setJoin(true)}>{t('Присоединиться')}</button>
                    <button type="button" className={`chip-btn ${!join ? 'on' : ''}`} aria-pressed={!join} onClick={() => setJoin(false)}>{t('Создать свою компанию')}</button>
                  </div>
                </div>
              ) : (
                <p className="muted">{t('Номер {phone} подтверждён. Осталось немного — расскажите о себе.', { phone })}</p>
              )}
              <Field label={t('ФИО')}>
                <input autoFocus required minLength={2} maxLength={100} value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })} autoComplete="name" />
              </Field>
              <Field label={emailOptional ? t('Почта (необязательно)') : t('Почта')}>
                <input type="email" required={!emailOptional} maxLength={120} value={reg.email} onChange={(e) => setReg({ ...reg, email: e.target.value })} autoComplete="email" />
              </Field>
              {!joining && (
                <>
                  <div className="field">
                    <span className="field-label">{t('Кто вы')}</span>
                    <div className="role-grid">
                      {meta.roles.map((r) => (
                        <button type="button" key={r} className={`role ${reg.role === r ? 'on' : ''}`} aria-pressed={reg.role === r} onClick={() => setReg({ ...reg, role: r })}>
                          <b>{t(ROLE_L[r])}</b>
                          <span>{t(ROLE_HINT[r])}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  {isDriver ? (
                    <p className="muted small">{t('Компания водителю не нужна. Работаете у перевозчика? Попросите его добавить ваш номер в «Команду» — рейсы компании появятся у вас сами.')}</p>
                  ) : (
                    <Field label={t('Наименование компании')} hint={t('Работаете один? Выберите ИП и впишите свою фамилию.')}>
                      <div className="phone-row">
                        <Select value={reg.companyForm} onChange={(v) => setReg({ ...reg, companyForm: v })} placeholder={t('Форма')} options={[{ value: 'ТОО', label: t('ТОО') }, { value: 'ИП', label: t('ИП') }]} />
                        <input required minLength={2} maxLength={120} value={reg.companyName} onChange={(e) => setReg({ ...reg, companyName: e.target.value })} placeholder={t('Без кавычек и формы')} autoComplete="organization" />
                      </div>
                    </Field>
                  )}
                </>
              )}
              <label className="switch small consent">
                <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
                <span>{t('Принимаю правила платформы и согласен на обработку персональных данных')}. <Link to="/rules" target="_blank">{t('Читать правила')}</Link></span>
              </label>
              <button className="btn primary block" disabled={busy || regMissing.length > 0}>{joining ? t('Присоединиться') : t('Зарегистрироваться')}</button>
              {regMissing.length > 0 && <p className="muted small">{t('Осталось заполнить')}: {regMissing.join(', ')}</p>}
            </>
          )}
        </form>

        {meta.demo && step === 'phone' && (
          <div className="card demo-card">
            <b>{t('Демо-доступ')}</b>
            <p className="muted small">{t('Посмотрите платформу глазами любого участника — с готовыми данными.')}</p>
            <div className="chips-select">
              {[...meta.roles, 'admin'].map((r) => (
                <button key={r} className="chip-btn" disabled={busy} onClick={() => demo(r)}>
                  {r === 'admin' ? t('Админ (арбитраж)') : t(ROLE_L[r])}
                </button>
              ))}
            </div>
          </div>
        )}
        <Link to="/rules" className="link center-link">{t('Правила платформы')} <ArrowRight size={14} /></Link>
      </section>
    </div>
  );
}
