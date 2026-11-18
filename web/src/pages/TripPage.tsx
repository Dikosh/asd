// Рейс: карта с живой позицией, этапы, GPS, завершение и отзыв. Страницы по ссылке: для получателя и для водителя.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Camera, Check, Clock, Copy, FileText, MapPin, MessageSquare, Navigation, Paperclip, Phone, Play, RefreshCw, Share2, Smartphone, Square, TriangleAlert, Truck, User, WifiOff,
} from 'lucide-react';
import { api, BODY_L, CARGO_L, deviceKind, FILE_KIND_L, fmtDates, fmtStamp, fmtWhen, LOADING_L, money, num, opts, prepareUpload, STAGE_L, t, Trip, useApp, useEvent, useLoad, waLink } from '../core';
import { Empty, Field, Loading, Logo, MapMarker, MapRoute, MapView, Modal, Select, Stars } from '../ui';
import { ContactButtons, RouteTitle } from '../listing';

/** Флаг демо-симуляции: пока она идёт, реальная геолокация не отправляется. */
export const simulating = { on: false };

// Позицию передаёт только то устройство, на котором это включили: телефон в машине, а не компьютер в офисе.
const deviceKey = (id: number) => `gps:${id}`;
export const sharesFromThisDevice = (id: number) => {
  try {
    return localStorage.getItem(deviceKey(id)) === '1';
  } catch {
    return false;
  }
};
const setDeviceShare = (id: number, on: boolean) => {
  try {
    if (on) localStorage.setItem(deviceKey(id), '1');
    else localStorage.removeItem(deviceKey(id));
  } catch {
    /* хранилище недоступно */
  }
  window.dispatchEvent(new Event('gps-device'));
};

const STATUS_L: Record<string, string> = { completed: 'Завершён', cancelled: 'Отменён', failed: 'Сорван' };
const statusClass = (tr: Trip) => (tr.status === 'active' ? 'sent' : tr.status === 'completed' ? 'accepted' : 'declined');
const statusText = (tr: Trip) => (tr.status === 'active' ? (tr.confirmed ? t(STAGE_L[tr.stage]) : t('Ждёт подтверждения')) : t(STATUS_L[tr.status]));

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
            {at && <span className="stage-t">{fmtStamp(at)}</span>}
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
          <span><Navigation size={15} /> {(trip.remainingKm ?? 0) < 5 ? t('Машина в пункте выгрузки') : t('Осталось ~{n} км', { n: num(trip.remainingKm || 0) })}</span>
          {trip.etaHours && <span><Clock size={15} /> {t('≈ {n} ч в пути', { n: trip.etaHours })}</span>}
          <span className={`small ${trip.signalLost ? 'lost' : 'muted'}`}>
            {trip.signalLost && <WifiOff size={14} />} {trip.signalLost ? t('Связь с машиной потеряна. Последняя позиция') : t('Позиция обновлена')}: {fmtWhen(trip.position.at)}
          </span>
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
        <span className={`status ${statusClass(trip)}`}>{statusText(trip)}</span>
      </div>
      <div className="progress"><span style={{ width: `${pct}%` }} /></div>
      <div className="row between wrap muted small">
        <span>{trip.myRole === 'carrier' ? `${t('Заказчик')}: ${trip.customer.name}` : `${t('Перевозчик')}: ${trip.carrier.name}`}</span>
        <span>
          {trip.status === 'active' && trip.signalLost ? `${t('нет связи с машиной')} · ` : trip.status === 'active' && trip.remainingKm != null ? `${t('Осталось ~{n} км', { n: num(trip.remainingKm) })} · ` : ''}
          {trip.price != null ? money(trip.price, trip.currency) : ''}
        </span>
      </div>
    </Link>
  );
}

/** Передача позиции с этого устройства: геолокация браузера + экран, который не гаснет. */
function useGeoSender(active: boolean, send: (body: { lat: number; lon: number; speed: number | null }) => Promise<unknown>) {
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [jump, setJump] = useState(false);
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    if (!active) return;
    if (!navigator.geolocation) {
      setError(t('Этот браузер не умеет определять местоположение'));
      return;
    }
    let last = 0;
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        setError('');
        if (simulating.on || Date.now() - last < 15000) return;
        last = Date.now();
        sendRef.current({ lat: pos.coords.latitude, lon: pos.coords.longitude, speed: pos.coords.speed != null ? Math.round(pos.coords.speed * 3.6) : null }).then((r: any) => setJump(r?.reason === 'jump')).catch(() => {});
      },
      (e) => setError(e.code === 1 ? t('Доступ к геолокации запрещён. Разрешите его для этого сайта в настройках браузера') : t('Не удаётся определить местоположение. Проверьте, что на телефоне включён GPS')),
      { enableHighAccuracy: true, maximumAge: 10000 },
    );
    // в фоне браузер перестаёт отдавать геолокацию — просим телефон не гасить экран
    let lock: any = null;
    const take = () => (navigator as any).wakeLock?.request('screen').then((l: any) => { lock = l; }).catch(() => {});
    const onVisible = () => document.visibilityState === 'visible' && take();
    take();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      navigator.geolocation.clearWatch(watch);
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release?.().catch(() => {});
    };
  }, [active, attempt]);
  return { error, jump, retry: () => { setError(''); setAttempt((n) => n + 1); } };
}


const GEO_STEPS: Record<string, string[]> = {
  ios: [
    'Откройте «Настройки» → «Конфиденциальность» → «Службы геолокации» и включите их.',
    'Там же найдите Safari (или ваш браузер) и выберите «При использовании».',
    'Вернитесь сюда и нажмите «Повторить».',
  ],
  android: [
    'Опустите шторку сверху и включите «Местоположение».',
    'Нажмите на значок слева от адреса сайта → «Разрешения» → «Местоположение» → «Разрешить».',
    'Нажмите «Повторить».',
  ],
  desktop: [
    'Нажмите на значок слева от адреса сайта и разрешите «Местоположение».',
    'Нажмите «Повторить». Лучше вести рейс с телефона, который едет в машине.',
  ],
};
/** Что делать, если телефон не отдаёт геолокацию: шаги для этого устройства и кнопка «Повторить». */
function GpsHelp({ error, retry }: { error: string; retry: () => void }) {
  return (
    <div className="gps-help">
      <b>{error}</b>
      <ol>
        {GEO_STEPS[deviceKind()].map((s) => <li key={s}>{t(s)}</li>)}
      </ol>
      <button className="btn soft block" onClick={retry}><RefreshCw size={16} /> {t('Повторить')}</button>
    </div>
  );
}
// Кнопки этапов — действием, а не названием статуса
const STAGE_ACT: Record<string, string> = {
  to_loading: 'Выехал на погрузку', loading: 'Приехал на погрузку', in_transit: 'Загрузился — выезжаю', unloading: 'Приехал на выгрузку', delivered: 'Груз выгружен',
};
const confirmStage = (s: string) => confirm(t('Отметить: «{s}»? Заказчик сразу это увидит, отменить отметку нельзя.', { s: t(STAGE_ACT[s]) }));
/** Копирование с понятной ошибкой: в части браузеров буфер обмена недоступен. */
const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    throw new Error(t('Не удалось скопировать — выделите ссылку и скопируйте вручную'));
  }
};

/** Невидимый передатчик в приложении: работает на любом экране, пока рейс включён на этом устройстве. */
export function TripBeacon({ tripId }: { tripId: number }) {
  useGeoSender(true, (body) => api(`/trips/${tripId}/position`, 'POST', body));
  return null;
}

/** Машина и водитель рейса: госномер крупно, чтобы узнать машину на погрузке. */
function VehicleInfo({ trip, showDriver = true }: { trip: Trip; showDriver?: boolean }) {
  if (!trip.confirmed) return null;
  const v = trip.vehicle;
  return (
    <div className="stack-s">
      <div className="vehicle-line">
        <Truck size={18} />
        <span>{v.brand}{v.bodyType ? ` · ${t(BODY_L[v.bodyType])}` : ''}</span>
        {v.plate && <span className="plate">{v.plate}</span>}
        {v.trailerPlate && <span className="muted small">{t('прицеп')}</span>}
        {v.trailerPlate && <span className="plate">{v.trailerPlate}</span>}
      </div>
      {showDriver && trip.driver?.name && (
        <div className="vehicle-line">
          <User size={18} />
          <span>{trip.driver.name}</span>
          {trip.driver.phone && <a href={`tel:${trip.driver.phone}`} className="link"><Phone size={14} /> {trip.driver.phone}</a>}
        </div>
      )}
    </div>
  );
}

/** Адреса и время погрузки из заявки. */
function Addresses({ trip }: { trip: Trip }) {
  if (!trip.loadAddress && !trip.unloadAddress && !trip.loadTime) return null;
  return (
    <div className="addr">
      {trip.loadAddress && <div className="kv"><span><MapPin size={14} /> {t('Адрес погрузки')}</span><b>{trip.loadAddress}</b></div>}
      {trip.unloadAddress && <div className="kv"><span><MapPin size={14} /> {t('Адрес выгрузки')}</span><b>{trip.unloadAddress}</b></div>}
      {trip.loadTime && <div className="kv"><span><Clock size={14} /> {t('Время погрузки')}</span><b>{trip.loadTime}</b></div>}
    </div>
  );
}

/**
 * Документы и фото рейса: ТТН, CMR, акты, фото груза. Видят обе стороны и водитель; удалить нельзя —
 * это подтверждение для обеих сторон. base — адрес API рейса (/trips/5 или /drive/<ссылка>).
 */
function TripFiles({ trip, base, onDone, driverLink = false }: { trip: Trip; base: string; onDone: () => void; driverLink?: boolean }) {
  const { act } = useApp();
  const [kind, setKind] = useState(driverLink ? 'photo' : 'ttn');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const files = trip.files || [];
  const canAdd = trip.status === 'active' || (!!trip.finishedAt && Date.now() - Date.parse(trip.finishedAt) < 30 * 86400_000);
  const url = (id: number) => (driverLink ? `/api${base}/files/${id}` : `/api/files/${id}`);
  const upload = async (f: File) => {
    setBusy(true);
    const ok = await act(async () => api(`${base}/files`, 'POST', { kind, ...(await prepareUpload(f)) }), t('Файл добавлен'));
    setBusy(false);
    if (input.current) input.current.value = '';
    if (ok) onDone();
  };
  const kinds = Object.keys(FILE_KIND_L);
  return (
    <div className="card stack-s">
      <b><Paperclip size={16} /> {t('Документы и фото')}{files.length > 0 && <span className="muted"> · {files.length}</span>}</b>
      {files.length === 0 && <p className="muted small">{driverLink ? t('Сфотографируйте груз при погрузке и подписанную ТТН при выгрузке — заказчик сразу их увидит.') : t('ТТН, CMR, акты и фото груза в одном месте: их видят обе стороны и водитель.')}</p>}
      {files.length > 0 && (
        <div className="file-grid">
          {files.map((f) => (
            <a key={f.id} href={url(f.id)} target="_blank" rel="noreferrer" className="file-item">
              {f.mime.startsWith('image/') ? <img src={url(f.id)} alt={f.filename} loading="lazy" /> : <span className="file-icon"><FileText size={26} /></span>}
              <span className="file-meta">
                <b>{t(FILE_KIND_L[f.kind] || f.kind)}</b>
                <span className="muted small">{f.byDriverLink ? `${t('Водитель')}${f.author ? ` ${f.author}` : ''}` : f.author} · {fmtWhen(f.createdAt)}</span>
              </span>
            </a>
          ))}
        </div>
      )}
      {canAdd && (
        <div className="row wrap">
          <div className="grow"><Select value={kind} onChange={setKind} options={opts(kinds, FILE_KIND_L)} /></div>
          <label className={`btn primary ${busy ? 'disabled' : ''}`}>
            {kind === 'photo' ? <Camera size={16} /> : <Paperclip size={16} />} {busy ? t('Отправляем…') : t('Добавить файл')}
            <input ref={input} type="file" hidden accept="image/*,application/pdf" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
        </div>
      )}
      {canAdd && <p className="muted small">{t('Фото, PDF до 5 МБ. Добавленные файлы удалить нельзя — это подтверждение для обеих сторон.')}</p>}
    </div>
  );
}

type Vehicle = { id: number; brand: string; plate: string };
type Member = { id: number; name: string; phone: string; companyRole: string };
type Employee = { id: number; name: string; phone: string; position: string };

/** Перевозчик подтверждает рейс: машина из парка или вручную, водитель из команды, из сотрудников или вручную. */
function AssignModal({ trip, onClose, onDone }: { trip: Trip; onClose: () => void; onDone: () => void }) {
  const { act } = useApp();
  const parkL = useLoad(() => api<Vehicle[]>('/vehicles').catch(() => []), []);
  const teamL = useLoad(() => api<{ members: Member[] }>('/team').then((x) => x.members).catch(() => []), []);
  const staffL = useLoad(() => api<Employee[]>('/employees').catch(() => []), []);
  const park = parkL.data || [];
  const team = (teamL.data || []).filter((m) => m.companyRole === 'driver').concat((teamL.data || []).filter((m) => m.companyRole !== 'driver'));
  const people = staffL.data || [];
  const [vehicle, setVehicle] = useState(''); // id машины из парка или '' — вручную
  const [brand, setBrand] = useState(trip.vehicle.brand || trip.brand || '');
  const [plate, setPlate] = useState(trip.vehicle.plate || '');
  const [trailer, setTrailer] = useState(trip.vehicle.trailerPlate || '');
  const [driver, setDriver] = useState(trip.driver?.userId ? `u${trip.driver.userId}` : ''); // u<id> — из команды, e<id> — из сотрудников, '' — вручную
  const [name, setName] = useState(trip.driver?.name || '');
  const [phone, setPhone] = useState(trip.driver?.phone || '');
  const [busy, setBusy] = useState(false);
  const pickVehicle = (id: string) => {
    setVehicle(id);
    const v = park.find((x) => String(x.id) === id);
    if (v) {
      setBrand(v.brand);
      setPlate(v.plate);
    }
  };
  const pickDriver = (id: string) => {
    setDriver(id);
    const p = id.startsWith('u') ? team.find((m) => `u${m.id}` === id) : people.find((e) => `e${e.id}` === id);
    if (p) {
      setName(p.name);
      setPhone(p.phone);
    }
  };
  const ok = brand.trim() && plate.trim().length >= 4 && name.trim().length >= 2 && phone.replace(/\D/g, '').length >= 10;
  const save = async () => {
    if (busy) return;
    setBusy(true);
    const done = await act(() => api(`/trips/${trip.id}/assign`, 'POST', {
      vehicleId: vehicle ? Number(vehicle) : null, brand: brand.trim(), plate: plate.trim(), trailerPlate: trailer.trim(),
      driverUserId: driver.startsWith('u') ? Number(driver.slice(1)) : null, driverName: name.trim(), driverPhone: phone.trim(),
    }), trip.confirmed ? t('Машина и водитель обновлены') : t('Рейс подтверждён'));
    setBusy(false);
    if (done) onDone();
  };
  return (
    <Modal title={trip.confirmed ? t('Машина и водитель') : t('Подтвердить рейс')} onClose={() => !busy && onClose()}>
      <p className="muted small">{t('Заказчик увидит марку, госномер и водителя — так он узнает машину на погрузке. Эти данные попадут в заявку на перевозку.')}</p>
      {park.length > 0 && (
        <Field label={t('Машина из парка')}>
          <Select value={vehicle} onChange={pickVehicle} placeholder={t('Другая машина — ввести вручную')} options={park.map((v) => ({ value: String(v.id), label: `${v.brand}${v.plate ? ` · ${v.plate}` : ''}` }))} />
        </Field>
      )}
      <div className="grid2">
        <Field label={t('Марка')}><input value={brand} onChange={(e) => { setBrand(e.target.value); setVehicle(''); }} maxLength={60} placeholder="Volvo FH" /></Field>
        <Field label={t('Госномер')}><input value={plate} onChange={(e) => { setPlate(e.target.value.toUpperCase()); setVehicle(''); }} maxLength={20} placeholder="123 ABC 02" /></Field>
      </div>
      <Field label={t('Госномер прицепа (необязательно)')}><input value={trailer} onChange={(e) => setTrailer(e.target.value.toUpperCase())} maxLength={20} /></Field>
      {(team.length > 0 || people.length > 0) && (
        <Field label={t('Водитель')}>
          <Select value={driver} onChange={pickDriver} placeholder={t('Другой водитель — ввести вручную')}
            options={[
              ...team.map((m) => ({ value: `u${m.id}`, label: `${m.name}${m.companyRole === 'driver' ? ` · ${t('водитель в приложении')}` : ''}` })),
              ...people.map((e) => ({ value: `e${e.id}`, label: `${e.name}${e.position ? ` · ${e.position}` : ''}` })),
            ]} />
        </Field>
      )}
      <div className="grid2">
        <Field label={t('Имя водителя')}><input value={name} disabled={driver.startsWith('u')} onChange={(e) => { setName(e.target.value); if (driver.startsWith('e')) setDriver(''); }} maxLength={100} /></Field>
        <Field label={t('Телефон водителя')}><input value={phone} disabled={driver.startsWith('u')} inputMode="tel" onChange={(e) => { setPhone(e.target.value); if (driver.startsWith('e')) setDriver(''); }} maxLength={20} placeholder="+7 701 123 45 67" /></Field>
      </div>
      {driver.startsWith('u') && <p className="muted small">{t('Водитель из команды увидит этот рейс в своём приложении и сможет вести его сам.')}</p>}
      <div className="row end">
        <button className="btn ghost" onClick={onClose} disabled={busy}>{t('Отмена')}</button>
        <button className="btn primary" onClick={save} disabled={busy || !ok}><Check size={16} /> {trip.confirmed ? t('Сохранить') : t('Подтвердить рейс')}</button>
      </div>
    </Modal>
  );
}

export default function TripPage() {
  const id = Number(useParams().id);
  const { act, meta, city, reloadMe, me, toast } = useApp();
  const nav = useNavigate();
  const { data: trip, loading, error, reload } = useLoad(() => api<Trip>(`/trips/${id}`), [id]);
  useEvent('trip position', (d) => d.tripId === id && reload());
  const map = useTripMap(trip);
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [sim, setSim] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const [onDevice, setOnDevice] = useState(sharesFromThisDevice(id));
  const [assign, setAssign] = useState(false);
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
      const step = Math.min(0.6, len);
      if (len < 0.02) return setSim(false);
      await api(`/trips/${id}/position`, 'POST', { lat: cur.lat + (dLat / len) * step, lon: cur.lon + (dLon / len) * step, speed: 78, sim: true }).catch(() => setSim(false));
    }, 1600);
    return () => {
      clearInterval(timer);
      simulating.on = false;
    };
  }, [sim, trip?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <Loading />;
  if (error || !trip) return <div className="card"><Empty title={t('Рейс не найден')}><Link to="/cabinet/trips" className="btn soft">{t('К рейсам')}</Link></Empty></div>;

  const carrier = trip.myRole === 'carrier';
  const isDriver = me!.user.companyRole === 'driver';
  const active = trip.status === 'active';
  const stageIdx = meta.stages.indexOf(trip.stage);
  const next = meta.stages[stageIdx + 1];
  const other = carrier ? trip.customer : trip.carrier;
  const trackUrl = `${location.origin}/t/${trip.trackToken}`;
  const driveUrl = `${location.origin}/d/${trip.driverToken}`;
  const post = async (path: string, body?: object, ok?: string) => {
    const done = await act(() => api(`/trips/${id}/${path}`, 'POST', body), ok);
    if (done) {
      reload();
      reloadMe();
    }
    return done;
  };
  const toggleGps = async (on: boolean) => {
    // включаем передачу именно с этого устройства
    setDeviceShare(id, on);
    setOnDevice(on);
    if (on === trip.shareGps) {
      // передача по рейсу уже включена (на другом телефоне или у водителя) — меняется только этот телефон
      toast(on ? t('Этот телефон тоже будет передавать позицию') : t('Этот телефон больше не передаёт позицию'));
      return;
    }
    if (!on && stageIdx > 0) {
      // после выезда передачу по рейсу выключить нельзя — перестаёт передавать только этот телефон
      toast(t('Этот телефон больше не передаёт позицию. Передача по рейсу продолжится с телефона водителя.'));
      return;
    }
    if (!(await post('gps', { share: on }, on ? t('GPS включён — ждём первую позицию с телефона') : t('Передача GPS выключена'))) && on) {
      setDeviceShare(id, false);
      setOnDevice(false);
    }
  };

  return (
    <div className="stack">
      <button className="link back" onClick={() => nav('/cabinet/trips')}><ArrowLeft size={16} /> {t('Все рейсы')}</button>
      <div className="detail-layout trip-layout">
        <div className="stack">
          <div className="card t-head">
            <div className="row between wrap">
              <h1 className="detail-title"><RouteTitle points={trip.points} /></h1>
              <span className={`status big ${statusClass(trip)}`}>{statusText(trip)}</span>
            </div>
            <div className="muted">
              {t('Рейс №{n}', { n: trip.id })} · {num(trip.distanceKm)} {t('км')}{trip.price != null ? ` · ${money(trip.price, trip.currency)}` : ''}
              {trip.cargoType ? ` · ${t(CARGO_L[trip.cargoType])}` : ''}{trip.weight ? ` · ${trip.weight} ${t('т')}` : ''}
            </div>
            <Eta trip={trip} />
            <Addresses trip={trip} />
            {trip.status === 'failed' && <div className="form-error"><b>{t('Рейс закрыт как сорванный')}.</b> {trip.failReason}</div>}
          </div>
          <div className="card map-card"><MapView routes={map.routes} markers={map.markers} height={380} fitKey={String(trip.id)} /></div>
          <div className="card"><StageBar trip={trip} /></div>
          <TripFiles trip={trip} base={`/trips/${trip.id}`} onDone={reload} />
        </div>

        <aside className="stack">
          {active && carrier && !trip.confirmed && (
            <div className="card stack-s assign-card">
              <b><Truck size={16} /> {t('Подтвердите рейс')}</b>
              <p className="muted small">{isDriver ? t('Перевозчик ещё не подтвердил рейс. Обратитесь к диспетчеру.') : t('Укажите машину и водителя. Пока рейс не подтверждён, заказчик ждёт, а этапы отмечать нельзя.')}</p>
              {!isDriver && <button className="btn primary block big" onClick={() => setAssign(true)}><Check size={18} /> {t('Указать машину и водителя')}</button>}
            </div>
          )}
          {trip.confirmed && (
            <div className="card stack-s">
              <b>{t('Машина и водитель')}</b>
              <VehicleInfo trip={trip} />
              {active && carrier && !isDriver && stageIdx < meta.stages.indexOf('in_transit') && (
                <button className="btn ghost" onClick={() => setAssign(true)}>{t('Заменить машину или водителя')}</button>
              )}
            </div>
          )}
          {active && !carrier && !trip.confirmed && (
            <div className="info-line">{t('Ждём, пока перевозчик подтвердит рейс: укажет машину и водителя. Мы пришлём уведомление.')}</div>
          )}

          {active && carrier && trip.confirmed && (
            <div className="card stack-s t-ctl">
              <b>{t('Управление рейсом')}</b>
              <label className="switch">
                <input type="checkbox" checked={trip.shareGps && onDevice} onChange={(e) => toggleGps(e.target.checked)} />
                <span>{t('Делиться GPS с этого устройства')}</span>
              </label>
              <div className={`small ${trip.shareGps ? 'ok-text' : 'muted'}`}>
                {trip.shareGps ? (onDevice ? t('Позиция уходит с этого телефона') : t('Позиция уходит с другого телефона или у водителя по ссылке')) : t('Передача GPS по рейсу выключена')}
              </div>
              <div className="gps-how">
                <Smartphone size={18} />
                <span>{t('Включайте на телефоне, который едет в машине. Пока Jolda открыта, позиция уходит заказчику, а экран не гаснет. Если за рулём другой человек — отправьте ему ссылку для водителя ниже.')}</span>
              </div>

              {trip.shareGps && onDevice && !trip.position && <div className="info-line">{t('Ждём первую позицию с этого телефона. Если она не появится за минуту — проверьте, что геолокация включена и разрешена для сайта.')}</div>}
              {next && (
                <button className="btn primary block big" onClick={() => confirmStage(next) && post('stage', { stage: next }, t('Этап обновлён'))}>
                  <Check size={18} /> {t(STAGE_ACT[next])}
                </button>
              )}
              {!next && (
                <div className="info-line">
                  {t('Доставка отмечена. Ждём подтверждения заказчика.')}
                  {trip.autoCompleteAt && ` ${t('Если он не ответит, рейс завершится сам {d}.', { d: fmtWhen(trip.autoCompleteAt) })}`}
                </div>
              )}
              {meta.demo && trip.shareGps && (
                <button className="btn soft block" onClick={() => setSim(!sim)}>
                  {sim ? <Square size={15} /> : <Play size={15} />} {sim ? t('Остановить симуляцию') : t('Демо: симулировать движение')}
                </button>
              )}
            </div>
          )}

          {active && carrier && !isDriver && (
            <div className="card stack-s">
              <b><Smartphone size={16} /> {t('Ссылка для водителя')}</b>
              <p className="muted small">{t('Отправьте её водителю: без регистрации он откроет рейс на телефоне, включит GPS и будет отмечать этапы. Цену сделки он не увидит.')}</p>
              <div className="copy-row">
                <input readOnly value={driveUrl} onFocus={(e) => e.target.select()} aria-label={t('Ссылка для водителя')} />
                <button className="btn soft" onClick={() => act(() => copyText(driveUrl), t('Ссылка скопирована'))}><Copy size={16} /> {t('Скопировать')}</button>
              </div>
              <div className="row wrap">
                <a className="btn soft wa" href={waLink('', `${t('Рейс на Jolda — откройте ссылку на телефоне и включите GPS')}: ${driveUrl}`)} target="_blank" rel="noreferrer"><MessageSquare size={16} /> WhatsApp</a>
                <button className="btn ghost" onClick={async () => confirm(t('Выпустить новую ссылку? Старая перестанет работать.')) && (await post('driver-link', undefined, t('Новая ссылка готова')))}><RefreshCw size={15} /> {t('Новая ссылка')}</button>
              </div>
            </div>
          )}

          {active && !carrier && (
            <div className="card stack-s">
              <b>{t('Контроль рейса')}</b>
              {trip.stage === 'delivered' ? (
                <>
                  <p>{t('Перевозчик отметил доставку. Проверьте груз и подтвердите завершение.')}</p>
                  <button className="btn primary block" onClick={() => post('complete', undefined, t('Рейс завершён'))}><Check size={16} /> {t('Подтвердить доставку')}</button>
                  {trip.autoCompleteAt && <p className="muted small">{t('Без вашего ответа рейс завершится сам {d}.', { d: fmtWhen(trip.autoCompleteAt) })}</p>}
                </>
              ) : (
                <p className="muted small">{trip.position ? t('Вы видите местоположение водителя и этап пути. Когда перевозчик отметит доставку, здесь появится кнопка подтверждения.') : t('Как только водитель включит GPS, машина появится на карте. Когда перевозчик отметит доставку, здесь появится кнопка подтверждения.')}</p>
              )}
            </div>
          )}

          {!active && !trip.reviewed && !isDriver && (
            <div className="card stack-s highlight">
              <b>{t('Оцените работу компании «{name}»', { name: other.name })}</b>
              <p className="muted small">
                {trip.status === 'completed' ? t('Оставьте отзыв в течение трёх дней — потом без него нельзя будет размещать объявления и откликаться.') : t('Рейс не состоялся — расскажите, что произошло. Это поможет другим участникам.')}
                {' '}{t('Партнёр увидит ваш отзыв после того, как оставит свой, или через 7 дней.')}
              </p>
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
              {trip.reviewed && trip.reviews.length === 1 && <p className="muted small">{t('Отзыв партнёра появится, когда он его оставит.')}</p>}
            </div>
          )}

          <div className="card stack-s">
            <div className="muted small">{carrier ? t('Заказчик') : t('Перевозчик')}</div>
            <Link to={`/company/${other.companyId}`} className="company-link">{other.name}</Link>
            <div className="muted small">{other.userName}</div>
            <div className="row wrap">
              {other.phone && <ContactButtons phone={other.phone} />}
              {trip.chatId && !isDriver && <Link to={`/cabinet/messages/${trip.chatId}`} className="btn soft"><MessageSquare size={16} /> {t('Чат')}</Link>}
            </div>
          </div>

          {!isDriver && <Link to={`/trip/${trip.id}/doc`} className="btn soft"><FileText size={16} /> {t('Заявка на перевозку — печать или PDF')}</Link>}

          {trip.status !== 'failed' && trip.status !== 'cancelled' && <div className="card stack-s">
            <b><Share2 size={16} /> {t('Ссылка для получателя')}</b>
            <p className="muted small">{t('По этой ссылке рейс виден на карте без регистрации — отправьте её грузополучателю.')}</p>
            <div className="copy-row">
              <input readOnly value={trackUrl} onFocus={(e) => e.target.select()} aria-label={t('Ссылка для получателя')} />
              <button className="btn soft" onClick={() => act(() => copyText(trackUrl), t('Ссылка скопирована'))}><Copy size={16} /> {t('Скопировать')}</button>
            </div>
          </div>}

          {active && !isDriver && (
            <div className="row wrap">
              {stageIdx < meta.stages.indexOf('in_transit') && (
                <button className="btn ghost danger" onClick={() => confirm(t('Отменить рейс? Объявление вернётся в поиск.')) && post('cancel', undefined, t('Рейс отменён'))}>{t('Отменить рейс')}</button>
              )}
              <button className="btn ghost danger" onClick={() => setFail('')}><TriangleAlert size={15} /> {t('Рейс сорван')}</button>
              <p className="muted small">
                {stageIdx < meta.stages.indexOf('in_transit')
                  ? t('«Отменить рейс» — если планы изменились до выезда: объявление вернётся в поиск. «Рейс сорван» — если машина не приехала, груз не доставлен или вторая сторона пропала.')
                  : t('«Рейс сорван» — если груз не доставлен, повреждён или вторая сторона пропала. Отменить рейс после погрузки нельзя.')}
              </p>
            </div>
          )}
        </aside>
      </div>

      {assign && <AssignModal trip={trip} onClose={() => setAssign(false)} onDone={() => { setAssign(false); reload(); }} />}
      {fail !== null && (
        <Modal title={t('Закрыть рейс как сорванный')} onClose={() => setFail(null)}>
          <p className="muted small">{t('Используйте, если машина не приехала, груз не доставлен, пропала связь или вторая сторона отказалась. Рейс закроется, обе стороны смогут оставить отзыв, модератор получит сигнал.')}</p>
          <Field label={t('Что произошло')}><textarea rows={4} autoFocus value={fail} onChange={(e) => setFail(e.target.value)} maxLength={500} placeholder={t('Например: водитель не выходит на связь вторые сутки')} /></Field>
          <div className="row end">
            <button className="btn ghost" onClick={() => setFail(null)}>{t('Отмена')}</button>
            <button className="btn danger" disabled={fail.trim().length < 5} onClick={async () => (await post('fail', { reason: fail }, t('Рейс закрыт как сорванный'))) && setFail(null)}>{t('Закрыть рейс')}</button>
          </div>
        </Modal>
      )}
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
              <span className={`status big ${statusClass(trip)}`}>{statusText(trip)}</span>
            </div>
            <div className="muted">
              {t('Перевозчик')}: {trip.carrier.name}{trip.bodyType ? ` · ${t(BODY_L[trip.bodyType])}` : ''} · {num(trip.distanceKm)} {t('км')}
            </div>
            <VehicleInfo trip={trip} showDriver={false} />
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

/** Страница водителя по ссылке: без регистрации. Большие кнопки — включить GPS и отметить этап. */
export function DrivePage() {
  const { token } = useParams();
  const { meta, act } = useApp();
  const { data: trip, loading, reload } = useLoad(() => api<Trip>(`/drive/${token}`), [token]);
  const map = useTripMap(trip);
  const sharing = !!trip && trip.status === 'active' && trip.shareGps;
  const geo = useGeoSender(sharing, (body) => api(`/drive/${token}/position`, 'POST', body).then(() => reload()));
  const geoError = geo.error;
  useEffect(() => {
    const id = setInterval(reload, 20000);
    return () => clearInterval(id);
  }, [reload]);
  const post = async (path: string, body: object, ok?: string) => (await act(() => api(`/drive/${token}/${path}`, 'POST', body), ok)) && reload();
  const next = trip ? meta.stages[meta.stages.indexOf(trip.stage) + 1] : undefined;
  return (
    <div className="public drive">
      <header className="row between"><Logo />{trip && <span className="muted small">{t('Рейс для водителя')}</span>}</header>
      {loading ? <Loading /> : !trip ? (
        <div className="card"><Empty title={t('Ссылка недействительна')} text={t('Попросите диспетчера прислать новую ссылку.')} /></div>
      ) : (
        <div className="stack">
          <div className="card">
            <h1 className="detail-title"><RouteTitle points={trip.points} /></h1>
            <div className="muted">
              {num(trip.distanceKm)} {t('км')}{trip.dateFrom && trip.dateTo ? ` · ${fmtDates(trip.dateFrom, trip.dateTo)}` : ''}
              {trip.cargoType ? ` · ${t(CARGO_L[trip.cargoType])}` : ''}{trip.weight ? ` · ${trip.weight} ${t('т')}` : ''}
              {trip.loading?.length ? ` · ${trip.loading.map((x) => t(LOADING_L[x])).join(', ')}` : ''}
            </div>
            {trip.description && <p className="desc full">{trip.description}</p>}
            <Addresses trip={trip} />
            <VehicleInfo trip={trip} showDriver={false} />
            <span className={`status big ${statusClass(trip)}`}>{statusText(trip)}</span>
          </div>

          {trip.status === 'active' && !trip.confirmed ? (
            <div className="card"><Empty title={t('Рейс ещё не подтверждён')} text={t('Диспетчер перевозчика должен указать машину и водителя. Обновите страницу чуть позже.')} /></div>
          ) : trip.status === 'active' ? (
            <div className="card stack-s">
              {!trip.shareGps ? (
                <>
                  <b>{t('Шаг 1. Включите передачу GPS')}</b>
                  <p className="muted small">{t('Заказчик будет видеть машину на карте. Телефон спросит разрешение на геолокацию — нажмите «Разрешить».')}</p>
                  <button className="btn primary block big" onClick={() => post('gps', { share: true }, t('Передача GPS включена'))}><Navigation size={20} /> {t('Включить GPS')}</button>
                </>
              ) : (
                <>
                  <div className={`gps-state ${geoError ? 'bad' : trip.position && !trip.signalLost ? 'ok' : ''}`}>
                    <Navigation size={20} />
                    <div>
                      <b>{geoError ? t('GPS не работает') : trip.position ? t('GPS передаётся') : t('Определяем местоположение…')}</b>
                      <span>{geoError ? t('Заказчик не видит машину') : trip.position ? `${t('Позиция обновлена')}: ${fmtWhen(trip.position.at)}` : t('Обычно это занимает несколько секунд')}</span>
                    </div>
                  </div>
                  {geoError && <GpsHelp error={geoError} retry={geo.retry} />}
                  {!geoError && geo.jump && <div className="form-error">{t('Новая точка не принята: она слишком далеко от предыдущей. Так бывает при сбое GPS — позиция обновится сама через несколько минут.')}</div>}
                  <p className="muted small">{t('Не закрывайте эту страницу до конца рейса: пока она открыта, экран не погаснет и позиция будет уходить заказчику.')}</p>
                  {next ? (
                    <>
                    <button className="btn primary block big" disabled={!!geoError && meta.stages.indexOf(next) >= meta.stages.indexOf('in_transit')} onClick={() => confirmStage(next) && post('stage', { stage: next }, t('Этап обновлён'))}><Check size={20} /> {t(STAGE_ACT[next])}</button>
                    {!!geoError && meta.stages.indexOf(next) >= meta.stages.indexOf('in_transit') && <p className="muted small center">{t('Сначала включите геолокацию — без неё этот этап не отметить')}</p>}
                    </>
                  ) : (
                    <div className="info-line">{t('Доставка отмечена. Ждём подтверждения заказчика.')}</div>
                  )}
                  {next && <p className="muted small center">{t('Сейчас: {s}. Нажмите кнопку, когда это произойдёт.', { s: t(STAGE_L[trip.stage]) })}</p>}
                </>
              )}
            </div>
          ) : (
            <div className="card"><Empty title={t('Рейс закрыт')} text={t('Передача GPS остановлена. Спасибо за работу!')} /></div>
          )}

          {trip.customer.phone && trip.status === 'active' && (
            <div className="card stack-s">
              <div className="muted small">{t('Контакт заказчика')}</div>
              <b>{trip.customer.userName} · {trip.customer.name}</b>
              <a className="btn soft block" href={`tel:${trip.customer.phone}`}><Phone size={16} /> {trip.customer.phone}</a>
            </div>
          )}
          {trip.confirmed && <TripFiles trip={trip} base={`/drive/${token}`} onDone={reload} driverLink />}
          <div className="card map-card"><MapView routes={map.routes} markers={map.markers} height={300} fitKey={String(trip.id)} /></div>
          <div className="card"><StageBar trip={trip} /></div>
        </div>
      )}
    </div>
  );
}
