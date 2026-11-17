// «Цены»: статистика ставок по направлениям и типам кузова — по объявлениям платформы.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';
import { api, BODY_L, money, num, opts, t, useApp, useLoad } from '../core';
import { Empty, Loading, Select, Tabs } from '../ui';

interface Stats {
  sample: number;
  overall: { low: number; median: number; high: number; sample: number } | null;
  directions: { fromId: string; toId: string; count: number; distanceKm: number; rate: number; perKm: number }[];
  byBody: { body: string; count: number; perKm: number }[];
}

export default function PricesPage() {
  const { meta, cityName } = useApp();
  const [kind, setKind] = useState('cargo');
  const [body, setBody] = useState('');
  const { data, loading } = useLoad(() => api<Stats>(`/stats/prices?kind=${kind}&body=${body}`), [kind, body]);
  const max = Math.max(1, ...(data?.byBody.map((b) => b.perKm) || [1]));
  return (
    <div className="stack">
      <h1 className="page-title">{t('Цены на перевозки')}</h1>
      <p className="muted">{t('Средние ставки по объявлениям платформы за последние полгода. Помогают назвать честную цену и не продешевить.')}</p>
      <div className="page-head">
        <Tabs value={kind} onChange={setKind} items={[{ value: 'cargo', label: t('Ставки заказчиков') }, { value: 'truck', label: t('Ставки перевозчиков') }]} />
        <div className="city-filter"><Select value={body} onChange={setBody} placeholder={t('Все типы кузова')} options={opts(meta.body, BODY_L)} /></div>
      </div>
      {loading ? <Loading /> : !data || data.sample === 0 ? (
        <div className="card"><Empty icon={<TrendingUp size={26} />} title={t('Пока мало данных')} text={t('Статистика появится, когда наберётся достаточно объявлений со ставкой.')} /></div>
      ) : (
        <>
          {data.overall && (
            <div className="stat-row">
              <div className="stat"><b>{num(data.overall.median)} ₸/{t('км')}</b><span>{t('обычная ставка')}</span></div>
              <div className="stat"><b>{num(data.overall.low)}–{num(data.overall.high)} ₸/{t('км')}</b><span>{t('половина всех объявлений')}</span></div>
              <div className="stat"><b>{num(data.sample)}</b><span>{t('объявлений в расчёте')}</span></div>
            </div>
          )}
          <div className="detail-layout">
            <div className="card">
              <b>{t('Направления')}</b>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>{t('Маршрут')}</th><th className="r">{t('км')}</th><th className="r">{t('Обычная цена')}</th><th className="r">₸/{t('км')}</th><th className="r">{t('Объявлений')}</th></tr></thead>
                  <tbody>
                    {data.directions.map((d) => (
                      <tr key={d.fromId + d.toId}>
                        <td><Link to={`/search/${kind}?from=${d.fromId}&to=${d.toId}`}>{cityName(d.fromId)} → {cityName(d.toId)}</Link></td>
                        <td className="r" data-l={t('км')}>{num(d.distanceKm)}</td>
                        <td className="r" data-l={t('Обычная цена')}><b>{money(d.rate)}</b></td>
                        <td className="r" data-l={`₸/${t('км')}`}>{num(d.perKm)}</td>
                        <td className="r muted" data-l={t('Объявлений')}>{d.count}{d.count < 5 ? ` · ${t('мало данных')}` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <aside className="card">
              <b>{t('По типам кузова, ₸/км')}</b>
              {data.byBody.map((b) => (
                <div className="bar-row" key={b.body}>
                  <span>{t(BODY_L[b.body])}</span>
                  <div className="bar"><span style={{ width: `${(b.perKm / max) * 100}%` }} /></div>
                  <b>{num(b.perKm)}</b>
                </div>
              ))}
              <span className="muted small">{t('Среднее по объявлениям в тенге со ставкой.')}</span>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
