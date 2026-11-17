// Вход по номеру телефона и регистрация одной формой.
import { useState } from 'react';
import { BadgeCheck, FileCheck2, MapPinned, Users } from 'lucide-react';
import { api, Me, num, ROLE_HINT, ROLE_L, t, useApp } from '../core';
import { Field, LangSwitch, Logo, Select } from '../ui';

const CODES = [
  { value: '+7', label: '🇰🇿 +7' }, { value: '+998', label: '🇺🇿 +998' }, { value: '+996', label: '🇰🇬 +996' }, { value: '+992', label: '🇹🇯 +992' },
  { value: '+993', label: '🇹🇲 +993' }, { value: '+86', label: '🇨🇳 +86' }, { value: '+375', label: '🇧🇾 +375' }, { value: '+994', label: '🇦🇿 +994' },
  { value: '+995', label: '🇬🇪 +995' }, { value: '+90', label: '🇹🇷 +90' },
];

export default function AuthPage() {
  const { meta, setMe, act } = useApp();
  const [step, setStep] = useState<'phone' | 'code' | 'reg'>('phone');
  const [prefix, setPrefix] = useState('+7');
  const [number, setNumber] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState('');
  const [regToken, setRegToken] = useState('');
  const [reg, setReg] = useState({ name: '', email: '', companyName: '', companyForm: 'ТОО', role: 'customer' });
  const [busy, setBusy] = useState(false);
  const phone = prefix + number.replace(/\D/g, '');
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await act(fn);
    setBusy(false);
  };

  const requestCode = () =>
    run(async () => {
      const r = await api('/auth/request-code', 'POST', { phone });
      setDevCode(r.devCode || '');
      setCode('');
      setStep('code');
    });
  const verify = () =>
    run(async () => {
      const r = await api('/auth/verify', 'POST', { phone, code });
      if (r.registered) setMe(r as Me);
      else {
        setRegToken(r.regToken);
        setStep('reg');
      }
    });
  const register = () => run(async () => setMe(await api<Me>('/auth/register', 'POST', { regToken, ...reg })));
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
      </section>

      <section className="auth-panel">
        <form className="card auth-card" onSubmit={(e) => { e.preventDefault(); step === 'phone' ? requestCode() : step === 'code' ? verify() : register(); }}>
          {step === 'phone' && (
            <>
              <h2>{t('Вход и регистрация')}</h2>
              <p className="muted">{t('Введите номер — пришлём код. Если аккаунта нет, создадим его за минуту.')}</p>
              <Field label={t('Номер телефона')}>
                <div className="phone-row">
                  <Select value={prefix} onChange={setPrefix} options={CODES} />
                  <input type="tel" inputMode="tel" autoFocus placeholder="701 123 45 67" value={number} onChange={(e) => setNumber(e.target.value)} autoComplete="tel-national" />
                </div>
              </Field>
              <button className="btn primary block" disabled={busy || number.replace(/\D/g, '').length < 7}>{t('Получить код')}</button>
            </>
          )}
          {step === 'code' && (
            <>
              <h2>{t('Код из SMS')}</h2>
              <p className="muted">{t('Отправили код на {phone}', { phone })}</p>
              {devCode && <div className="demo-note">{t('Демо-режим: SMS не отправляется, ваш код')} <b>{devCode}</b></div>}
              <Field label={t('Код')}>
                <input className="code-input" inputMode="numeric" autoFocus maxLength={4} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoComplete="one-time-code" />
              </Field>
              <button className="btn primary block" disabled={busy || code.length < 4}>{t('Продолжить')}</button>
              <button type="button" className="btn ghost block" onClick={() => setStep('phone')}>{t('Изменить номер')}</button>
            </>
          )}
          {step === 'reg' && (
            <>
              <h2>{t('Регистрация')}</h2>
              <p className="muted">{t('Номер {phone} подтверждён. Осталось четыре поля.', { phone })}</p>
              <Field label={t('ФИО')}>
                <input autoFocus required value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })} autoComplete="name" />
              </Field>
              <Field label={t('Почта')}>
                <input type="email" required value={reg.email} onChange={(e) => setReg({ ...reg, email: e.target.value })} autoComplete="email" />
              </Field>
              <Field label={t('Наименование компании')}>
                <div className="phone-row">
                  <Select value={reg.companyForm} onChange={(v) => setReg({ ...reg, companyForm: v })} options={[{ value: 'ТОО', label: 'ТОО' }, { value: 'ИП', label: 'ИП' }]} />
                  <input required value={reg.companyName} onChange={(e) => setReg({ ...reg, companyName: e.target.value })} placeholder={t('Без кавычек и формы')} autoComplete="organization" />
                </div>
              </Field>
              <div className="field">
                <span className="field-label">{t('Роль')}</span>
                <div className="role-grid">
                  {meta.roles.map((r) => (
                    <button type="button" key={r} className={`role ${reg.role === r ? 'on' : ''}`} aria-pressed={reg.role === r} onClick={() => setReg({ ...reg, role: r })}>
                      <b>{t(ROLE_L[r])}</b>
                      <span>{t(ROLE_HINT[r])}</span>
                    </button>
                  ))}
                </div>
              </div>
              <button className="btn primary block" disabled={busy}>{t('Зарегистрироваться')}</button>
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
                  {r === 'admin' ? t('Модератор') : t(ROLE_L[r])}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
