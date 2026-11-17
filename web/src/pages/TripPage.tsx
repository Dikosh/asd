// Рейс: карта с живой позицией, этапы, GPS, завершение и отзыв. Публичная страница отслеживания.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Clock, Copy, FileText, MapPin, MessageSquare, Navigation, Play, Share2, Smartphone, Square } from 'lucide-react';
import { api, BODY_L, CARGO_L, fmtWhen, money, num, STAGE_L, t, Trip, useApp, useEvent, useLoad } from '../core';
import { Empty, Loading, Logo, MapMarker, MapRoute, MapView, Stars } from '../ui';
import { ContactButtons, RouteTitle } from '../listing';

/** Флаг демо-симуляции: пока она идёт, реальная геолокация не отправляется. */
export const simulating = { on: false };

function useTripMap(trip: Trip | null) {
  const { city, cityName } = useApp();
  return useMemo(() => {
    if (!trip) return { routes: [] as MapRoute[], markers: [] as MapMarker[] };
    const pts = trip.points.map((p) => [city(p)!.lat, city(p)!.lon] as [number, number]);
    const routes: MapRoute[] = [{ pts, color: '#9db4dc', dashed: true }];
    if (trip.track && trip.track.length > 1) routes.push({ pts: trip.track, color: '#1554d1', weight: 5 });
    const markers: MapMarker[] = pts.map((pos, i) => ({ pos, kind: i === 0 ? 'a' : i === pts.length - 1 ? 'b' : 'stop', label: cityName(trip.points[i]) }));
    if (trip.position) markers.push({ pos: [trip.position.lat, trip.position.lon], kind: 'truck', label: `${trip.carrier.name} · ${fmtWhen(trip.position.at)}` });
    return { routes, markers };
  }, [trip]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function StageBar({ trip }: { trip: Trip }) {
  const { meta } = useApp();
  const cur = meta.stages.indexOf(trip.stage);
  return (
    <ol className="stagebar">
      {meta.stages.map((s, i) => {
        const at = trip.events?.find((e) => e.stage === s)?.at;
        return (
          <li key={s} className={i < cur || trip.status === 'completed' ? 'done' : i === cur ? 'on' : ''}>
            <span className="stage-dot">{i < cur || trip.status === 'completed' ? <Check size={12} /> : null}</span>
            <span className="stage-l">{t(STAGE_L[s])}</span>
            {at && <span className="stage-t">{fmtWhen(at)}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function Eta({ trip }: { trip: Trip }) {
  if (trip.status !== 'active') return null;
  return (
    <div className="eta">
      {trip.position ? (
        <>
          <span><Navigation size={15} /> {t('Осталось ~{n} км', { n: num(trip.remainingKm || 0) })}</span>
          {trip.etaHours && <span><Clock size={15} /> {t('≈ {n} ч в пути', { n: trip.etaHours })}</span>}
          <span className="muted small">{t('Позиция обновлена')}: {fmtWhen(trip.position.at)}</span>
        </>
      ) : (
        <span className="muted"><MapPin size={15} /> {trip.shareGps ? t('Ждём первую GPS-позицию от водителя') : t('Водитель ещё не включил передачу GPS')}</span>
      )}
    </div>
  );
}

/** Краткая карточка рейса для главной и списка рейсов. */
export function TripSummary({ trip }: { trip: Trip }) {
  const { meta } = useApp();
  const pct = trip.status === 'completed' ? 100 : (meta.stages.indexOf(trip.stage) / (meta.stages.length - 1)) * 100;
  return (
    <Link to={`/trip/${trip.id}`} className="card trip-card">
      <div className="row between wrap">
        <b className="trip-route"><RouteTitle points={trip.points} /></b>
        <span className={`status ${trip.status === 'active' ? 'sent' : trip.status === 'completed' ? 'accepted' : 'declined'}`}>
          {trip.status === 'active' ? t(STAGE_L[trip.stage]) : trip.status === 'completed' ? t('Завершён') : t('Отменён')}
        </span>
      </div>
      <div className="progress"><span style={{ width: `${pct}%` }} /></div>
      <div className="row between wrap muted small">
        <span>{trip.myRole === 'carrier' ? `${t('Заказчик')}: ${trip.customer.name}` : `${t('Перевозчик')}: ${trip.carrier.name}`}</span>
        <span>
          {trip.status === 'active' && trip.remainingKm != null ? `${t('Осталось ~{n} км', { n: num(trip.remainingKm) })} · ` : ''}
          {money(trip.price, trip.currency)}
        </span>
      </div>
    </Link>
  );
}

export default function TripPage() {
  const id = Number(useParams().id);
  const { act, meta, city, reloadMe } = useApp();
  const nav = useNavigate();
  const { data: trip, loading, error, reload } = useLoad(() => api<Trip>(`/trips/${id}`), [id]);
  useEvent('trip position', (d) => d.tripId === id && reload());
  const map = useTripMap(trip);
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [sim, setSim] = useState(false);
  const pos = useRef<{ lat: number; lon: number } | null>(null);
  pos.current = trip?.position || null;

  // Демо: «едем» по прямой к пункту назначения, отправляя позиции как настоящий трекер.
  useEffect(() => {
    if (!sim || !trip) return;
    simulating.on = true;
    const dest = city(trip.points[trip.points.length - 1])!;
    const start = city(trip.points[0])!;
    const timer = setInterval(async () => {
      const cur = pos.current || start;
      const dLat = dest.lat - cur.lat;
      const dLon = dest.lon - cur.lon;
      const len = Math.hypot(dLat, dLon);
      const step = Math.min(0.18, len);
      if (len < 0.02) return setSim(false);
      await api(`/trips/${id}/position`, 'POST', { lat: cur.lat + (dLat / len) * step, lon: cur.lon + (dLon / len) * step, speed: 78 }).catch(() => setSim(false));
    }, 2000);
    return () => {
      clearInterval(timer);
      simulating.on = false;
    };
  }, [sim, trip?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <Loading />;
  if (error || !trip) return <div className="card"><Empty title={t('Рейс не найден')}><Link to="/cabinet/trips" className="btn soft">{t('К рейсам')}</Link></Empty></div>;

  const carrier = trip.myRole === 'carrier';
  const active = trip.status === 'active';
  const stageIdx = meta.stages.indexOf(trip.stage);
  const next = meta.stages[stageIdx + 1];
  const other = carrier ? trip.customer : trip.carrier;
  const trackUrl = `${location.origin}/t/${trip.trackToken}`;
  const post = async (path: string, body?: object, ok?: string) => {
    if (await act(() => api(`/trips/${id}/${path}`, 'POST', body), ok)) {
      reload();
      reloadMe();
    }
  };

  return (
    <div className="stack">
      <button className="link back" onClick={() => nav('/cabinet/trips')}><ArrowLeft size={16} /> {t('Все рейсы')}</button>
      <div className="detail-layout">
        <div className="stack">
          <div className="card">
            <div className="row between wrap">
              <h1 className="detail-title"><RouteTitle points={trip.points} /></h1>
              <span className={`status big ${active ? 'sent' : trip.status === 'completed' ? 'accepted' : 'declined'}`}>
                {active ? t(STAGE_L[trip.stage]) : trip.status === 'completed' ? t('Завершён') : t('Отменён')}
              </span>
            </div>
            <div className="muted">
              {t('Рейс №{n}', { n: trip.id })} · {num(trip.distanceKm)} {t('км')} · {money(trip.price, trip.currency)}
              {trip.cargoType ? ` · ${t(CARGO_L[trip.cargoType])}` : ''}{trip.weight ? ` · ${trip.weight} ${t('т')}` : ''}
            </div>
            <Eta trip={trip} />
          </div>
          <div className="card map-card"><MapView routes={map.routes} markers={map.markers} height={380} fitKey={String(trip.id)} /></div>
          <div className="card"><StageBar trip={trip} /></div>
        </div>

        <aside className="stack">
          {active && carrier && (
            <div className="card stack-s">
              <b>{t('Управление рейсом')}</b>
              <label className="switch">
                <input type="checkbox" checked={trip.shareGps} onChange={(e) => post('gps', { share: e.target.checked }, e.target.checked ? t('Передача GPS включена') : t('Передача GPS выключена'))} />
                <span>{t('Делиться GPS')}</span>
              </label>
              <div className="gps-how">
                <Smartphone size={18} />
                <span>{t('Откройте этот рейс на телефоне, который едет в машине, и разрешите доступ к геолокации. Пока Jolda открыта, позиция уходит заказчику, а экран не гаснет.')}</span>
              </div>
              {trip.shareGps && !trip.position && <div className="form-error">{t('Позиция ещё не получена. Проверьте, что на телефоне включена геолокация и она разрешена для сайта.')}</div>}
              {next && (
                <button className="btn primary block" onClick={() => post('stage', { stage: next }, t('Этап обновлён'))}>
                  <Check size={16} /> {t('Отметить')}: {t(STAGE_L[next])}
                </button>
              )}
              {!next && <div className="info-line">{t('Доставка отмечена. Ждём подтверждения заказчика.')}</div>}
              {meta.demo && trip.shareGps && (
                <button className="btn soft block" onClick={() => setSim(!sim)}>
                  {sim ? <Square size={15} /> : <Play size={15} />} {sim ? t('Остановить симуляцию') : t('Демо: симулировать движение')}
                </button>
              )}
            </div>
          )}
          {active && !carrier && (
            <div className="card stack-s">
              <b>{t('Контроль рейса')}</b>
              {trip.stage === 'delivered' ? (
                <>
                  <p>{t('Перевозчик отметил доставку. Проверьте груз и подтвердите завершение.')}</p>
                  <button className="btn primary block" onClick={() => post('complete', undefined, t('Рейс завершён'))}><Check size={16} /> {t('Подтвердить доставку')}</button>
                </>
              ) : (
                <p className="muted small">{t('Вы видите местоположение водителя и этап пути. Когда перевозчик отметит доставку, здесь появится кнопка подтверждения.')}</p>
              )}
            </div>
          )}

          {trip.status === 'completed' && !trip.reviewed && (
            <div className="card stack-s highlight">
              <b>{t('Оцените работу компании «{name}»', { name: other.name })}</b>
              <p className="muted small">{t('Отзыв обязателен — без него нельзя размещать новые объявления и откликаться.')}</p>
              <div className="center"><Stars value={rating} onChange={setRating} size={32} /></div>
              <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Что понравилось или не понравилось?')} maxLength={1000} />
              <button className="btn primary block" disabled={!rating} onClick={() => post('review', { rating, text }, t('Спасибо за отзыв!'))}>{t('Отправить отзыв')}</button>
            </div>
          )}
          {trip.reviews && trip.reviews.length > 0 && (
            <div className="card stack-s">
              <b>{t('Отзывы по рейсу')}</b>
              {trip.reviews.map((r, i) => (
                <div key={i} className="review"><Stars value={r.rating} size={14} /> <span className="muted small">{r.author}</span>{r.text && <p>{r.text}</p>}</div>
              ))}
            </div>
          )}

          <div className="card stack-s">
            <div className="muted small">{carrier ? t('Заказчик') : t('Перевозчик')}</div>
            <Link to={`/company/${other.companyId}`} className="company-link">{other.name}</Link>
            <div className="muted small">{other.userName}</div>
            <div className="row wrap">
              {other.phone && <ContactButtons phone={other.phone} />}
              {trip.chatId && <Link to={`/cabinet/messages/${trip.chatId}`} className="btn soft"><MessageSquare size={16} /> {t('Чат')}</Link>}
            </div>
          </div>

          <Link to={`/trip/${trip.id}/doc`} className="btn soft"><FileText size={16} /> {t('Заявка на перевозку — печать или PDF')}</Link>

          <div className="card stack-s">
            <b><Share2 size={16} /> {t('Ссылка для получателя')}</b>
            <p className="muted small">{t('По этой ссылке рейс виден на карте без регистрации — отправьте её грузополучателю.')}</p>
            <div className="copy-row">
              <input readOnly value={trackUrl} onFocus={(e) => e.target.select()} />
              <button className="btn soft" aria-label={t('Скопировать')} onClick={() => act(() => navigator.clipboard.writeText(trackUrl), t('Ссылка скопирована'))}><Copy size={16} /></button>
            </div>
          </div>

          {active && stageIdx < meta.stages.indexOf('in_transit') && (
            <button className="btn ghost danger" onClick={() => confirm(t('Отменить рейс? Объявление вернётся в поиск.')) && post('cancel', undefined, t('Рейс отменён'))}>{t('Отменить рейс')}</button>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Публичное отслеживание по ссылке: без входа и без контактов сторон. */
export function PublicTrack() {
  const { token } = useParams();
  const { data: trip, loading, reload } = useLoad(() => api<Trip>(`/track/${token}`), [token]);
  const map = useTripMap(trip);
  useEffect(() => {
    const id = setInterval(reload, 15000);
    return () => clearInterval(id);
  }, [reload]);
  return (
    <div className="public">
      <header className="row between"><a href="/"><Logo /></a><span className="muted small">{t('Отслеживание рейса')}</span></header>
      {loading ? <Loading /> : !trip ? (
        <div className="card"><Empty title={t('Ссылка недействительна')} text={t('Попросите отправителя прислать ссылку ещё раз.')} /></div>
      ) : (
        <div className="stack">
          <div className="card">
            <div className="row between wrap">
              <h1 className="detail-title"><RouteTitle points={trip.points} /></h1>
              <span className={`status big ${trip.status === 'active' ? 'sent' : 'accepted'}`}>{trip.status === 'active' ? t(STAGE_L[trip.stage]) : trip.status === 'completed' ? t('Завершён') : t('Отменён')}</span>
            </div>
            <div className="muted">
              {t('Перевозчик')}: {trip.carrier.name}{trip.bodyType ? ` · ${t(BODY_L[trip.bodyType])}` : ''} · {num(trip.distanceKm)} {t('км')}
            </div>
            <Eta trip={trip} />
          </div>
          <div className="card map-card"><MapView routes={map.routes} markers={map.markers} height={420} fitKey={String(trip.id)} /></div>
          <div className="card"><StageBar trip={trip} /></div>
          <p className="muted small center">{t('Страница обновляется автоматически. Jolda — биржа грузов и транспорта.')}</p>
        </div>
      )}
    </div>
  );
}
