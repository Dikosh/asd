// Показатели площадки для встреч с крупными заказчиками: сколько перевозчиков и машин, активность, рейсы.
// Только для администратора; страницу можно распечатать или сохранить в PDF.
import { useState } from 'react';
import { Printer, Target } from 'lucide-react';
import { api, BODY_L, fmtDate, num, ROLE_L, t, useApp, useLoad } from '../core';
import { Loading } from '../ui';

interface Metrics {
  at: string; withDemo: boolean; demoAvailable: boolean; users: number; roles: Record<string, number>; goal: number;
  active7: number; active30: number; new30: number; carriers: number; carriersVerified: number; customers: number; vehicles: number;
  bodies: { key: string; n: number }[]; cities: { key: string; n: number }[];
  listings30: { cargo: number; truck: number; relocation: number }; responses30: number; tripsDone: number; tripsDone30: number;
  weeks: { from: string; n: number }[]; shippers: { name: string; clicks: number }[];
}

function Bars({ rows }: { rows: { label: string; n: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="mbars">
      {rows.map((r) => (
        <div className="mbar" key={r.label}>
          <span>{r.label}</span>
          <div><i style={{ width: `${(r.n / max) * 100}%` }} /></div>
          <b>{num(r.n)}</b>
        </div>
      ))}
    </div>
  );
}

export default function MetricsTab() {
  const { cityName } = useApp();
  const [demo, setDemo] = useState(false);
  const { data } = useLoad(() => api<Metrics>(`/admin/metrics${demo ? '?demo=1' : ''}`), [demo]);
  if (!data) return <Loading />;
  const d = data;
  const pct = Math.min(100, Math.round((d.users / d.goal) * 100));
  const weekMax = Math.max(1, ...d.weeks.map((w) => w.n));
  return (
    <div className="stack metrics">
      <div className="page-head">
        <h1 className="page-title">{t('Показатели площадки')}</h1>
        <button className="btn soft no-print" onClick={() => window.print()}><Printer size={16} /> {t('Распечатать или сохранить в PDF')}</button>
      </div>
      <p className="muted">{t('Цифры для встреч с крупными заказчиками на {d}', { d: fmtDate(d.at) })} · {d.withDemo ? t('С демо-данными.') : t('Только настоящие пользователи, без демо-данных.')}</p>
      {d.demoAvailable && (
        <label className="switch no-print">
          <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
          <span>{t('Учитывать демо-данные')}</span>
        </label>
      )}

      <div className="card form">
        <h3><Target size={17} /> {t('Цель: {n} пользователей', { n: num(d.goal) })}</h3>
        <div className="goal"><i style={{ width: `${pct}%` }} /></div>
        <p className="muted small">{t('Сейчас {n} — это {p}% от цели. Осталось {left}.', { n: num(d.users), p: pct, left: num(Math.max(0, d.goal - d.users)) })}</p>
      </div>

      <div className="stat-row">
        <div className="stat"><b>{num(d.users)}</b><span>{t('пользователей')} · +{num(d.new30)} {t('за 30 дней')}</span></div>
        <div className="stat"><b>{num(d.active30)}</b><span>{t('заходили за 30 дней')} · {num(d.active7)} {t('за неделю')}</span></div>
        <div className="stat"><b>{num(d.carriers)}</b><span>{t('перевозчиков')} · {num(d.carriersVerified)} {t('проверено')}</span></div>
        <div className="stat"><b>{num(d.vehicles)}</b><span>{t('машин у перевозчиков')}</span></div>
        <div className="stat"><b>{num(d.customers)}</b><span>{t('заказчиков и экспедиторов')}</span></div>
        <div className="stat"><b>{num(d.tripsDone)}</b><span>{t('рейсов завершено')} · {num(d.tripsDone30)} {t('за 30 дней')}</span></div>
      </div>

      <div className="card form">
        <h3>{t('Новые пользователи по неделям')}</h3>
        <div className="weeks">
          {d.weeks.map((w, i) => (
            <div key={w.from} title={`${fmtDate(w.from)}: ${w.n}`}>
              <b>{w.n || ''}</b>
              <i style={{ height: `${(w.n / weekMax) * 100}%` }} />
              {/* подпись у каждой третьей недели — иначе даты не помещаются на телефоне */}
              <span>{i % 3 === 0 ? fmtDate(w.from) : '\u00a0'}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="metrics-grid">
        <div className="card form">
          <h3>{t('Кто зарегистрирован')}</h3>
          <Bars rows={Object.entries(d.roles).map(([k, n]) => ({ label: t(ROLE_L[k] || k), n }))} />
        </div>
        <div className="card form">
          <h3>{t('Активность за 30 дней')}</h3>
          <Bars rows={[
            { label: t('Грузов размещено'), n: d.listings30.cargo },
            { label: t('Машин предложено'), n: d.listings30.truck },
            { label: t('Заявок на перегон'), n: d.listings30.relocation },
            { label: t('Откликов'), n: d.responses30 },
          ]} />
        </div>
        <div className="card form">
          <h3>{t('Типы кузовов')}</h3>
          {d.bodies.length ? <Bars rows={d.bodies.map((b) => ({ label: t(BODY_L[b.key] || b.key), n: b.n }))} /> : <p className="muted">{t('Перевозчики ещё не добавили машины.')}</p>}
        </div>
        <div className="card form">
          <h3>{t('Перевозчики по городам')}</h3>
          {d.cities.length ? <Bars rows={d.cities.map((c) => ({ label: cityName(c.key), n: c.n }))} /> : <p className="muted">{t('Пока нет данных.')}</p>}
        </div>
        {d.shippers.length > 0 && (
          <div className="card form">
            <h3>{t('Переходы на сайты заказчиков')}</h3>
            <Bars rows={d.shippers.map((s) => ({ label: s.name, n: s.clicks }))} />
          </div>
        )}
      </div>
    </div>
  );
}
