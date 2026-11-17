// «Инструменты»: расстояние и стоимость рейса, нагрузка на оси, курсы валют.
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, Plus, Route as RouteIcon, Trash2, Wallet } from 'lucide-react';
import { api, BODY_L, money, num, opts, t, useApp, useLoad } from '../core';
import { CitySelect, Empty, Field, Loading, MapView, Select, Tabs } from '../ui';

export default function ToolsPage() {
  const tab = useParams().tab || 'distance';
  const nav = useNavigate();
  return (
    <div className="stack">
      <h1 className="page-title">{t('Инструменты')}</h1>
      <Tabs
        value={tab}
        onChange={(v) => nav(`/tools/${v}`)}
        items={[{ value: 'distance', label: t('Расстояние и стоимость') }, { value: 'axles', label: t('Нагрузка на оси') }, { value: 'rates', label: t('Курсы валют') }]}
      />
      {tab === 'distance' && <Distance />}
      {tab === 'axles' && <Axles />}
      {tab === 'rates' && <Rates />}
    </div>
  );
}

// ---------- расстояние и стоимость ----------
function Distance() {
  const { city, cityName, meta } = useApp();
  const [points, setPoints] = useState<(string | null)[]>([null, null]);
  const [body, setBody] = useState('');
  const ready = points.every(Boolean) && points.length >= 2;
  const query = ready ? `points=${points.join(',')}&body=${body}` : '';
  const res = useLoad<any>(() => (query ? api(`/tools/route?${query}`) : Promise.resolve(null)), [query]);
  const map = useMemo(() => {
    const pts = points.filter(Boolean).map((p) => [city(p)!.lat, city(p)!.lon] as [number, number]);
    return {
      routes: pts.length > 1 ? [res.data?.geometry ? { pts: res.data.geometry as [number, number][], weight: 5 } : { pts, dashed: true }] : [],
      markers: pts.map((pos, i) => ({ pos, kind: (i === 0 ? 'a' : i === pts.length - 1 ? 'b' : 'stop') as 'a' | 'b' | 'stop', label: cityName(points.filter(Boolean)[i]) })),
    };
  }, [points, res.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = res.data;

  return (
    <div className="detail-layout">
      <div className="stack">
        <div className="card map-card"><MapView routes={map.routes} markers={map.markers} height={420} fitKey={points.join(',') + (d?.source || '')} /></div>
        {d && (
          <div className="stat-row">
            <div className="stat"><RouteIcon size={18} /><b>{num(d.km)} {t('км')}</b><span>{d.source === 'roads' ? t('по дорогам') : t('оценка по прямым отрезкам')}</span></div>
            <div className="stat"><Clock size={18} /><b>≈ {d.hours} {t('ч')}</b><span>{t('в пути без учёта отдыха')}</span></div>
            {d.cost && <div className="stat"><Wallet size={18} /><b>{money(d.cost.median)}</b><span>{t('обычная цена рейса')}</span></div>}
          </div>
        )}
        {d?.cost && (
          <div className="card">
            <b>{t('Сколько стоит такой рейс')}</b>
            <div className="range">
              <div><span>{t('дешевле обычного')}</span><b>{money(d.cost.low)}</b></div>
              <div className="mid"><span>{t('обычно')}</span><b>{money(d.cost.median)}</b></div>
              <div><span>{t('дороже обычного')}</span><b>{money(d.cost.high)}</b></div>
            </div>
            <p className="muted small">{t('Расчёт по ставкам из объявлений на платформе: {n} ₸/км, {s} объявлений в выборке. Это ориентир, а не предложение.', { n: num(d.cost.perKm), s: d.cost.sample })}</p>
          </div>
        )}
      </div>
      <aside className="card form">
        <b>{t('Маршрут')}</b>
        {points.map((p, i) => (
          <Field key={i} label={i === 0 ? t('Откуда') : i === points.length - 1 ? t('Куда') : t('Промежуточный пункт')}>
            <div className="row">
              <CitySelect value={p} onChange={(id) => setPoints(points.map((x, k) => (k === i ? id : x)))} />
              {i > 0 && i < points.length - 1 && (
                <button type="button" className="icon-btn" aria-label={t('Удалить пункт')} onClick={() => setPoints(points.filter((_, k) => k !== i))}><Trash2 size={18} /></button>
              )}
            </div>
          </Field>
        ))}
        {points.length < 8 && (
          <button type="button" className="btn soft" onClick={() => setPoints([...points.slice(0, -1), null, points[points.length - 1]])}><Plus size={16} /> {t('Добавить пункт')}</button>
        )}
        <Field label={t('Тип кузова')} hint={t('Влияет на оценку стоимости')}>
          <Select value={body} onChange={setBody} placeholder={t('Любой')} options={opts(meta.body, BODY_L)} />
        </Field>
        {!ready && <p className="muted small">{t('Выберите города — расстояние, время и ориентир по цене посчитаются сами.')}</p>}
        {res.loading && ready && <Loading />}
      </aside>
    </div>
  );
}

// ---------- нагрузка на оси ----------
const N = (s: string) => Number(String(s).replace(',', '.')) || 0;
function Axles() {
  // Седельный тягач с полуприцепом — самая частая сцепка. Все размеры в метрах, массы в тоннах.
  const [v, setV] = useState({
    front: '5.2', rear: '2.3', base: '3.6', saddle: '0.6', tractorAxles: '2',
    trailer: '7', pin: '7.7', trailerAxles: '3', cargo: '20', center: '5.2',
    limSingle: '10', limTandem: '16', limTridem: '22.5', limTotal: '44',
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const r = useMemo(() => {
    const D = N(v.pin) || 1;
    const L = N(v.base) || 1;
    const x = Math.min(Math.max(N(v.center), 0), D);
    // пустой полуприцеп давит на седло примерно четвертью массы
    const bogie = N(v.trailer) * 0.75 + (N(v.cargo) * x) / D;
    const pin = N(v.trailer) * 0.25 + N(v.cargo) * (1 - x / D);
    const front = N(v.front) + (pin * N(v.saddle)) / L;
    const rear = N(v.rear) + (pin * (L - N(v.saddle))) / L;
    const total = N(v.front) + N(v.rear) + N(v.trailer) + N(v.cargo);
    const lim = (n: number) => (n >= 3 ? N(v.limTridem) : n === 2 ? N(v.limTandem) : N(v.limSingle));
    const ta = Number(v.tractorAxles) - 1;
    const tr = Number(v.trailerAxles);
    return {
      total,
      rows: [
        { name: t('Передняя ось тягача'), load: front, limit: N(v.limSingle), axles: 1 },
        { name: ta > 1 ? t('Задняя тележка тягача') : t('Ведущая ось тягача'), load: rear, limit: lim(ta), axles: ta },
        { name: t('Тележка полуприцепа'), load: bogie, limit: lim(tr), axles: tr },
      ],
      limTotal: N(v.limTotal),
    };
  }, [v]);
  const over = r.rows.some((x) => x.load > x.limit) || r.total > r.limTotal;
  const inp = (k: keyof typeof v, label: string, hint?: string) => (
    <Field label={label} hint={hint}><input inputMode="decimal" value={v[k]} onChange={set(k)} /></Field>
  );

  return (
    <div className="detail-layout">
      <div className="stack">
        <div className={`banner ${over ? 'bad' : 'good'}`}>
          {over ? <AlertTriangle size={22} /> : <CheckCircle2 size={22} />}
          <div>
            <b>{over ? t('Есть перегруз') : t('Нагрузка в пределах заданных норм')}</b>
            <span>{t('Полная масса автопоезда: {n} т из {m} т допустимых', { n: r.total.toFixed(1), m: r.limTotal })}</span>
          </div>
        </div>
        <div className="card">
          {r.rows.map((x) => {
            const pct = Math.min(100, (x.load / (x.limit || 1)) * 100);
            const bad = x.load > x.limit;
            return (
              <div className="axle" key={x.name}>
                <div className="row between wrap">
                  <b>{x.name}</b>
                  <span className={bad ? 'minus-red' : ''}><b>{x.load.toFixed(1)} {t('т')}</b> {t('из')} {x.limit} {t('т')}{x.axles > 1 ? ` · ${(x.load / x.axles).toFixed(1)} ${t('т на ось')}` : ''}</span>
                </div>
                <div className={`progress ${bad ? 'bad' : ''}`}><span style={{ width: `${pct}%` }} /></div>
                {bad && <span className="muted small">{t('Перегруз {n} т. Сдвиньте груз или уменьшите массу.', { n: (x.load - x.limit).toFixed(1) })}</span>}
              </div>
            );
          })}
        </div>
        <p className="muted small">
          {t('Расчёт упрощённый: груз считается одной массой с центром тяжести в указанной точке. Допустимые нагрузки — значения по умолчанию, их можно изменить; перед рейсом сверьте их с действующими правилами и условиями разрешения.')}
        </p>
      </div>
      <aside className="card form">
        <b>{t('Груз')}</b>
        <div className="grid2">
          {inp('cargo', t('Масса груза, т'))}
          {inp('center', t('Центр груза от седла, м'), t('Ближе к осям полуприцепа — больше число'))}
        </div>
        <b>{t('Тягач')}</b>
        <div className="grid2">
          {inp('front', t('На переднюю ось, т'), t('без прицепа'))}
          {inp('rear', t('На заднюю ось, т'), t('без прицепа'))}
          {inp('base', t('Колёсная база, м'))}
          {inp('saddle', t('Седло впереди задней оси, м'))}
        </div>
        <Field label={t('Осей у тягача')}><Select value={v.tractorAxles} onChange={(x) => setV({ ...v, tractorAxles: x })} options={[{ value: '2', label: '2' }, { value: '3', label: '3' }]} /></Field>
        <b>{t('Полуприцеп')}</b>
        <div className="grid2">
          {inp('trailer', t('Масса пустого, т'))}
          {inp('pin', t('От седла до центра тележки, м'))}
        </div>
        <Field label={t('Осей у полуприцепа')}><Select value={v.trailerAxles} onChange={(x) => setV({ ...v, trailerAxles: x })} options={['1', '2', '3'].map((x) => ({ value: x, label: x }))} /></Field>
        <b>{t('Допустимые нагрузки, т')}</b>
        <div className="grid2">
          {inp('limSingle', t('Одиночная ось'))}
          {inp('limTandem', t('Двухосная тележка'))}
          {inp('limTridem', t('Трёхосная тележка'))}
          {inp('limTotal', t('Полная масса'))}
        </div>
      </aside>
    </div>
  );
}

// ---------- курсы валют ----------
function Rates() {
  const { data, loading } = useLoad<{ code: string; rate: number; date: string }[] | null>(() => api('/tools/rates'));
  const [amount, setAmount] = useState('1000');
  const [code, setCode] = useState('USD');
  if (loading) return <Loading />;
  if (!data) return <div className="card"><Empty title={t('Курсы сейчас недоступны')} text={t('Не удалось получить данные Национального банка. Попробуйте позже.')} /></div>;
  const rate = data.find((x) => x.code === code)?.rate || 0;
  return (
    <div className="detail-layout">
      <div className="card">
        <b>{t('Официальные курсы Национального банка Казахстана')}</b>
        {data.map((x) => (
          <div className="line" key={x.code}>
            <div className="grow"><b>1 {x.code}</b></div>
            <b>{x.rate < 1 ? x.rate.toFixed(4) : x.rate.toFixed(2)} ₸</b>
          </div>
        ))}
        <span className="muted small">{t('Дата курса')}: {data[0]?.date}</span>
      </div>
      <aside className="card form">
        <b>{t('Пересчёт в тенге')}</b>
        <div className="grid2">
          <Field label={t('Сумма')}><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label={t('Валюта')}><Select value={code} onChange={setCode} options={data.map((x) => ({ value: x.code, label: x.code }))} /></Field>
        </div>
        <div className="info-line">{num(Math.round(N(amount) * rate))} ₸</div>
      </aside>
    </div>
  );
}
