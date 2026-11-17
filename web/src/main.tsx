import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Bookmark, Briefcase, Home as HomeIcon, MessageSquare, Package, Search as SearchIcon, Truck, UserRound } from 'lucide-react';
import './styles.css';
import { api, AppCtx, connectEvents, Ctx, getLang, Lang, Me, Meta, storeLang, t, Trip, useApp, useEvent } from './core';
import { Loading, Logo, LangSwitch, Modal, Stars } from './ui';
import AuthPage from './pages/Auth';
import HomePage from './pages/Home';
import MyListings, { ListingForm } from './pages/MyListings';
import SearchPage from './pages/Search';
import ListingPage from './pages/ListingPage';
import MarkedPage from './pages/Marked';
import Cabinet from './pages/Cabinet';
import TripPage, { PublicTrack, simulating } from './pages/TripPage';
import CompanyPage from './pages/CompanyPage';
import JobsPage from './pages/Jobs';

/** Платформа обязательно требует отзыв после завершения рейса. */
function ReviewGate() {
  const { me, reloadMe, act } = useApp();
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const p = me?.pendingReviews[0];
  const loc = useLocation();
  if (!p || loc.pathname.startsWith('/trip/')) return null;
  return (
    <Modal title={t('Оцените завершённый рейс')}>
      <p>
        {t('Рейс с компанией «{name}» завершён. Отзыв обязателен — из отзывов складывается рейтинг компаний.', { name: p.companyName })}
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
    </Modal>
  );
}

/** Передача GPS-позиции, пока приложение открыто у перевозчика в активном рейсе. */
function GpsBeacon() {
  const { me } = useApp();
  const [trips, setTrips] = useState<Trip[]>([]);
  const load = useCallback(() => api<Trip[]>('/trips').then(setTrips).catch(() => {}), []);
  useEffect(() => { load(); }, [load, me?.counters.trips]);
  useEvent('trip', load);
  const ids = trips.filter((x) => x.status === 'active' && x.shareGps && x.myRole === 'carrier').map((x) => x.id).join(',');
  useEffect(() => {
    if (!ids || !navigator.geolocation) return;
    let last = 0;
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        if (simulating.on || Date.now() - last < 15000) return;
        last = Date.now();
        const body = { lat: pos.coords.latitude, lon: pos.coords.longitude, speed: pos.coords.speed != null ? Math.round(pos.coords.speed * 3.6) : null };
        for (const id of ids.split(',')) api(`/trips/${id}/position`, 'POST', body).catch(() => {});
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 10000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [ids]);
  return null;
}

function Layout() {
  const { me, reloadMe } = useApp();
  useEvent('message read response trip', () => { reloadMe(); });
  const loc = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0); // в новых браузерах возвращает Promise — эффект не должен его возвращать
  }, [loc.pathname]);
  const mineKind = me!.user.role === 'carrier' || me!.user.role === 'driver' ? 'truck' : 'cargo';
  const nav = [
    { to: '/', icon: <HomeIcon size={20} />, label: t('Главная'), end: true },
    { to: `/my/${mineKind}`, match: '/my', icon: <Package size={20} />, label: t('Мои объявления') },
    { to: '/search/cargo', icon: <SearchIcon size={20} />, label: t('Найти груз') },
    { to: '/search/truck', icon: <Truck size={20} />, label: t('Найти транспорт') },
    { to: '/marked', icon: <Bookmark size={20} />, label: t('Отмеченные') },
    { to: '/jobs', icon: <Briefcase size={20} />, label: t('Работа') },
  ];
  const badge = me!.counters.unread + me!.counters.responses;
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-in">
          <NavLink to="/" aria-label="Jolda"><Logo /></NavLink>
          <nav className="topnav">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive || (n.match && loc.pathname.startsWith(n.match)) ? 'on' : '')}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="topbar-right">
            <LangSwitch />
            <NavLink to="/cabinet/messages" className="icon-btn" aria-label={t('Сообщения')}>
              <MessageSquare size={20} />
              {me!.counters.unread > 0 && <span className="badge">{me!.counters.unread}</span>}
            </NavLink>
            <NavLink to="/cabinet" className="user-chip">
              <UserRound size={18} />
              <span className="hide-s">{me!.user.name.split(' ')[0]}</span>
              {me!.counters.responses > 0 && <span className="badge">{me!.counters.responses}</span>}
            </NavLink>
          </div>
        </div>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/my/:kind" element={<MyListings />} />
          <Route path="/my/:kind/new" element={<ListingForm />} />
          <Route path="/my/:kind/:id/edit" element={<ListingForm />} />
          <Route path="/search/:kind" element={<SearchPage />} />
          <Route path="/listing/:id" element={<ListingPage />} />
          <Route path="/marked" element={<MarkedPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/cabinet" element={<Cabinet />} />
          <Route path="/cabinet/:tab" element={<Cabinet />} />
          <Route path="/cabinet/:tab/:id" element={<Cabinet />} />
          <Route path="/trip/:id" element={<TripPage />} />
          <Route path="/company/:id" element={<CompanyPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <nav className="bottomnav">
        {[nav[0], nav[1], nav[2], nav[3], { to: '/cabinet', icon: <UserRound size={20} />, label: t('Кабинет'), match: '/cabinet' }].map((n: any) => (
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
  const [me, setMeState] = useState<Me | null | undefined>(undefined);
  const [lang, setLangState] = useState<Lang>(getLang());
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: string }[]>([]);
  const [fatal, setFatal] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    storeLang(lang);
    Promise.all([api<Meta>('/meta'), api<Me | null>('/me')])
      .then(([m, u]) => {
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

  const ctx = useMemo<AppCtx | null>(() => {
    if (!meta || me === undefined) return null;
    const byId = new Map(meta.cities.map((c) => [c.id, c]));
    const cityName = (id: string | null | undefined) => {
      const c = id ? byId.get(id) : undefined;
      return c ? (lang === 'kz' ? c.kz : c.ru) : '—';
    };
    const toast = (text: string, kind: 'ok' | 'error' = 'ok') => {
      const id = ++seq.current;
      setToasts((x) => [...x, { id, text, kind }]);
      setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 3800);
    };
    return {
      me, meta, lang,
      setLang: (l) => { storeLang(l); setLangState(l); },
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
  }, [meta, me, lang]);

  if (fatal) return <div className="splash"><Logo /><p>{t('Не удалось связаться с сервером')}: {fatal}</p></div>;
  if (!ctx) return <div className="splash"><Logo /><Loading /></div>;
  return (
    <Ctx.Provider value={ctx}>
      <div key={lang} className="root">
        <Routes>
          <Route path="/t/:token" element={<PublicTrack />} />
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
