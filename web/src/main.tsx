import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Link, BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Bell, Bookmark, Briefcase, Building, Building2, Calculator, CarFront, Megaphone, ChevronDown, Home as HomeIcon, LifeBuoy, Menu, MessageSquare, Package, Route as RouteIcon, Search as SearchIcon, TrendingUp, Truck, UserRound, Ban } from 'lucide-react';
import './styles.css';
import { api, AppCtx, City, connectEvents, Ctx, getLang, Lang, Me, Meta, placeName, storeLang, t, Trip, useApp, useEvent } from './core';
import { registerWorker } from './push';
import { Loading, Logo, LangSwitch, Modal, Stars } from './ui';
import AuthPage from './pages/Auth';
import HomePage from './pages/Home';
import MyListings, { ListingForm } from './pages/MyListings';
import SearchPage from './pages/Search';
import ListingPage from './pages/ListingPage';
import MarkedPage from './pages/Marked';
import Cabinet from './pages/Cabinet';
import TripPage, { DrivePage, PublicTrack, sharesFromThisDevice, TripBeacon } from './pages/TripPage';
import CompanyPage from './pages/CompanyPage';
import JobsPage from './pages/Jobs';
import RelocationPage, { RelocationForm } from './pages/Relocation';
import ServicesPage from './pages/Services';
import ShippersPage from './pages/Shippers';
import ToolsPage from './pages/Tools';
import PricesPage from './pages/Prices';
import HelpPage, { DeleteAccountPage, PrivacyPage, PublicHelp, RulesPage } from './pages/Help';
import NotificationsPage from './pages/Notifications';
import TripDoc from './pages/TripDoc';

/** Платформа требует отзыв после завершения рейса: три дня можно отложить, потом без отзыва работа блокируется. */
const REVIEW_GRACE_MS = 72 * 3600_000;
function ReviewGate() {
  const { me, reloadMe, act } = useApp();
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [later, setLater] = useState<number[]>([]);
  const p = me?.pendingReviews.find((r) => !later.includes(r.tripId) || Date.now() - Date.parse(r.finishedAt) > REVIEW_GRACE_MS);
  const loc = useLocation();
  // на странице того же рейса отзыв оставляют в его карточке; на остальных страницах окно показывается всегда
  if (!p || loc.pathname.startsWith(`/trip/${p.tripId}`) || loc.pathname.startsWith('/d/') || loc.pathname.startsWith('/t/')) return null;
  const canDefer = Date.now() - Date.parse(p.finishedAt) < REVIEW_GRACE_MS;
  return (
    <Modal title={t('Оцените завершённый рейс')} onClose={canDefer ? () => setLater((x) => [...x, p.tripId]) : undefined}>
      <p>
        {t('Рейс с компанией «{name}» завершён. Отзыв обязателен — из отзывов складывается рейтинг компаний.', { name: p.companyName })}
        {canDefer && ` ${t('Можно отложить: без отзыва работа заблокируется через три дня после рейса.')}`}
      </p>
      <div className="center"><Stars value={rating} onChange={setRating} size={34} /></div>
      <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Что понравилось или не понравилось?')} maxLength={1000} />
      <button
        className="btn primary block"
        disabled={!rating}
        onClick={async () => {
          if (await act(() => api(`/trips/${p.tripId}/review`, 'POST', { rating, text }), t('Спасибо за отзыв!'))) {
            setRating(0);
            setText('');
            await reloadMe();
          }
        }}
      >
        {t('Отправить отзыв')}
      </button>
      {canDefer && <button className="btn ghost block" onClick={() => setLater((x) => [...x, p.tripId])}>{t('Позже')}</button>}
    </Modal>
  );
}

/** Передача GPS-позиции: только для рейсов, включённых на этом устройстве (телефон в машине, а не компьютер в офисе). */
function GpsBeacon() {
  const { me } = useApp();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [, bump] = useState(0);
  const load = useCallback(() => api<Trip[]>('/trips').then(setTrips).catch(() => {}), []);
  useEffect(() => { load(); }, [load, me?.counters.trips]);
  useEvent('trip', load);
  useEffect(() => {
    const on = () => bump((x) => x + 1);
    window.addEventListener('gps-device', on);
    return () => window.removeEventListener('gps-device', on);
  }, []);
  const mine = trips.filter((x) => x.status === 'active' && x.shareGps && x.myRole === 'carrier' && sharesFromThisDevice(x.id));
  return <>{mine.map((x) => <TripBeacon key={x.id} tripId={x.id} />)}</>;
}

function Layout() {
  const { me, reloadMe, meta } = useApp();
  const { toast } = useApp();
  useEvent('message read response trip logout', () => { reloadMe(); });
  const { routeName } = useApp();
  useEvent('notify', (n) => {
    reloadMe();
    toast(t(n.title, Object.fromEntries(Object.entries(n.vars || {}).map(([k, v]) => [k, Array.isArray(v) ? routeName(v as string[]) : (v as string)]))));
  });
  useEffect(() => { registerWorker(); }, []);
  const loc = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0); // в новых браузерах возвращает Promise — эффект не должен его возвращать
  }, [loc.pathname]);
  const mineKind = me!.user.role === 'carrier' || me!.user.role === 'driver' ? 'truck' : 'cargo';
  // водитель из команды не размещает объявления и не ищет грузы — у него рейсы, работа и помощь
  const teamDriver = me!.user.companyRole === 'driver';
  const nav = teamDriver ? [
    { to: '/', icon: <HomeIcon size={20} />, label: t('Главная'), end: true },
    { to: '/cabinet/trips', icon: <RouteIcon size={20} />, label: t('Мои рейсы') },
    { to: '/jobs', icon: <Briefcase size={20} />, label: t('Работа') },
    { to: '/help', icon: <LifeBuoy size={20} />, label: t('Помощь') },
  ] : [
    { to: '/', icon: <HomeIcon size={20} />, label: t('Главная'), end: true },
    { to: `/my/${mineKind}`, match: '/my', icon: <Package size={20} />, label: t('Мои объявления') },
    { to: '/search/cargo', icon: <SearchIcon size={20} />, label: t('Найти груз') },
    { to: '/search/truck', icon: <Truck size={20} />, label: t('Найти транспорт') },
    { to: '/jobs', label: t('Работа') },
  ];
  // остальные разделы собраны в одно меню, чтобы шапка не переполнялась на любом языке
  const more = [
    { to: '/relocation', icon: <CarFront size={17} />, label: t('Перегон') },
    { to: '/services', icon: <Megaphone size={17} />, label: t('Услуги: перегон, сопровождение, брокеры') },
    // раздел «Заказчики» появляется, когда администратор добавит первую компанию
    ...(meta.stats.shippers > 0 || me!.user.isAdmin ? [{ to: '/shippers', icon: <Building size={17} />, label: t('Заказчики') }] : []),
    { to: '/prices', icon: <TrendingUp size={17} />, label: t('Цены') },
    { to: '/tools', icon: <Calculator size={17} />, label: t('Инструменты') },
    { to: '/cabinet/catalog', icon: <Building2 size={17} />, label: t('Каталог компаний') },
    { to: '/marked', icon: <Bookmark size={17} />, label: t('Отмеченные') },
    { to: '/help', icon: <LifeBuoy size={17} />, label: t('Помощь') },
    // водителю из команды объявления и ставки закрыты, поэтому разделов с ними в меню нет
  ].filter((m) => !teamDriver || !['/relocation', '/prices', '/marked'].includes(m.to));
  const [menu, setMenu] = useState(false);
  const menuBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setMenu(false);
  }, [loc.pathname]);
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => !menuBox.current?.contains(e.target as Node) && setMenu(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [menu]);
  const badge = me!.counters.unread + me!.counters.responses;
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-in">
          <NavLink to="/" aria-label="Ovi"><Logo /></NavLink>
          <nav className="topnav">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive || (n.match && loc.pathname.startsWith(n.match)) ? 'on' : '')}>
                {n.label}
              </NavLink>
            ))}
            <div className="menu-wrap" ref={menuBox}>
              <button className={`nav-more ${more.some((m) => loc.pathname.startsWith(m.to)) ? 'on' : ''}`} onClick={() => setMenu(!menu)} aria-haspopup="menu" aria-expanded={menu}>
                {t('Сервисы')} <ChevronDown size={15} />
              </button>
              {menu && (
                <div className="menu down" role="menu">
                  {more.map((m) => (
                    <NavLink key={m.to} to={m.to} role="menuitem">{m.icon} {m.label}</NavLink>
                  ))}
                </div>
              )}
            </div>
          </nav>
          <div className="topbar-right">
            <span className="hide-s"><LangSwitch /></span>
            <NavLink to="/notifications" className="icon-btn" aria-label={t('Уведомления')} title={t('Уведомления')}>
              <Bell size={20} />
              {me!.counters.notifications > 0 && <span className="badge">{me!.counters.notifications}</span>}
            </NavLink>
            {!teamDriver && (
              <NavLink to="/cabinet/messages" className="icon-btn" aria-label={t('Сообщения')} title={t('Сообщения')}>
                <MessageSquare size={20} />
                {me!.counters.unread > 0 && <span className="badge">{me!.counters.unread}</span>}
              </NavLink>
            )}
            <NavLink to="/cabinet" className="user-chip">
              <UserRound size={18} />
              <span className="hide-s">{me!.user.name.split(' ')[0]}</span>
              {me!.counters.responses > 0 && <span className="badge">{me!.counters.responses}</span>}
            </NavLink>
          </div>
        </div>
      </header>
      <main className="content">
        {me!.company.banned && (
          <Link to="/help/support" className="banner bad ban-banner">
            <Ban size={20} />
            <div><b>{t('Компания заблокирована модератором')}</b><span>{me!.company.banReason ? `${t('Причина')}: ${me!.company.banReason}. ` : ''}{t('Размещать объявления и откликаться нельзя. Не согласны — напишите в поддержку.')}</span></div>
          </Link>
        )}
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/my/:kind" element={<MyListings />} />
          <Route path="/my/:kind/new" element={<ListingForm />} />
          <Route path="/my/:kind/:id/edit" element={<ListingForm />} />
          <Route path="/search/:kind" element={<SearchPage />} />
          <Route path="/listing/:id" element={<ListingPage />} />
          <Route path="/marked" element={<MarkedPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/relocation" element={<RelocationPage />} />
          <Route path="/services" element={<ServicesPage />} />
          <Route path="/shippers" element={<ShippersPage />} />
          <Route path="/relocation/new" element={<RelocationForm />} />
          <Route path="/relocation/:id/edit" element={<RelocationForm />} />
          <Route path="/cabinet" element={<Cabinet />} />
          <Route path="/cabinet/:tab" element={<Cabinet />} />
          <Route path="/cabinet/:tab/:id" element={<Cabinet />} />
          <Route path="/tools" element={<ToolsPage />} />
          <Route path="/tools/:tab" element={<ToolsPage />} />
          <Route path="/prices" element={<PricesPage />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/help/:tab" element={<HelpPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/trip/:id" element={<TripPage />} />
          <Route path="/trip/:id/doc" element={<TripDoc />} />
          <Route path="/company/:id" element={<CompanyPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <nav className="bottomnav">
        {[nav[0], nav[1], nav[2], nav[3], { to: '/cabinet', icon: <Menu size={20} />, label: t('Ещё'), match: '/cabinet' }].map((n: any) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive || (n.match && loc.pathname.startsWith(n.match)) ? 'on' : '')}>
            {n.icon}
            <span>{n.label}</span>
            {n.to === '/cabinet' && badge > 0 && <span className="badge">{badge}</span>}
          </NavLink>
        ))}
      </nav>
      <ReviewGate />
      <GpsBeacon />
    </div>
  );
}

function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const [me, setMeState] = useState<Me | null | undefined>(undefined);
  const [lang, setLangState] = useState<Lang>(getLang());
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: string }[]>([]);
  const [fatal, setFatal] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    storeLang(lang);
    Promise.all([api<Meta>('/meta'), api<Me | null>('/me'), api<any[][]>('/places')])
      .then(([m, u, rows]) => {
        setCities(rows.map(([id, ru, kz, en, country, lat, lon, region, zh]) => ({ id, ru, kz, en, zh: zh || en, country, lat, lon, region })));
        setMeta(m);
        setMeState(u);
      })
      .catch((e) => setFatal(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const logged = !!me;
  useEffect(() => {
    connectEvents(logged);
    return () => connectEvents(false);
  }, [logged]);
  // Уведомления сервер пишет на языке из настроек человека. Язык, выбранный до входа, он не знает,
  // поэтому после входа (и при каждой смене языка) сообщаем его серверу.
  const myId = me?.user.id;
  useEffect(() => {
    if (me && me.user.settings?.lang !== lang) api<Me>('/me', 'PATCH', { settings: { lang } }).then((u) => setMeState((cur) => (cur ? u : cur))).catch(() => {});
  }, [myId, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const ctx = useMemo<AppCtx | null>(() => {
    if (!meta || me === undefined) return null;
    const byId = new Map(cities.map((c) => [c.id, c]));
    const cityName = (id: string | null | undefined) => {
      const c = id ? byId.get(id) : undefined;
      return c ? placeName(c) : '—';
    };
    const toast = (text: string, kind: 'ok' | 'error' = 'ok') => {
      const id = ++seq.current;
      // одинаковые подряд не копим, на экране не больше трёх
      // новое сообщение вытесняет прежние: старая ошибка не висит рядом со свежим «Сохранено»
      setToasts((x) => [...x.filter((y) => y.text !== text && y.kind === kind && kind === 'error'), { id, text, kind }].slice(-2));
      setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 3800);
    };
    return {
      me, meta, lang, cities,
      setLang: (l) => {
        storeLang(l);
        setLangState(l);
      },
      setMe: setMeState,
      reloadMe: async () => setMeState(await api<Me | null>('/me')),
      city: (id) => (id ? byId.get(id) : undefined),
      cityName,
      routeName: (points) => points.map(cityName).join(' → '),
      toast,
      act: async (fn, okText) => {
        try {
          await fn();
          if (okText) toast(okText);
          return true;
        } catch (e: any) {
          toast(t(e.message), 'error');
          return false;
        }
      },
    };
  }, [meta, me, lang, cities]);

  if (fatal) return <div className="splash"><Logo /><p>{t('Не удалось связаться с сервером')}: {fatal}</p></div>;
  if (!ctx) return <div className="splash"><Logo /><Loading /></div>;
  return (
    <Ctx.Provider value={ctx}>
      <div key={lang} className="root">
        <Routes>
          <Route path="/t/:token" element={<PublicTrack />} />
          <Route path="/d/:token" element={<DrivePage />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/delete-account" element={<DeleteAccountPage />} />
          {/* справка открывается и без входа: вопросы, безопасность и правила нужны до регистрации */}
          {!ctx.me && <Route path="/help" element={<PublicHelp />} />}
          {!ctx.me && <Route path="/help/:tab" element={<PublicHelp />} />}
          <Route path="*" element={ctx.me ? <Layout /> : <AuthPage />} />
        </Routes>
      </div>
      <div className="toasts" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={`toast ${x.kind}`}>{x.text}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
