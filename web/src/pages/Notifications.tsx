// Уведомления: отклики, рейсы, подходящие грузы по подпискам, решения модератора.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellRing, Inbox, Route as RouteIcon, ShieldCheck, Sparkles, Star } from 'lucide-react';
import { api, deviceKind, fmtWhen, t, useApp, useEvent, useLoad } from '../core';
import { Empty, Loading } from '../ui';
import { enablePush, pushState, PushState } from '../push';

const ICON: Record<string, JSX.Element> = {
  response: <Inbox size={18} />, trip: <RouteIcon size={18} />, match: <Sparkles size={18} />, review: <Star size={18} />, system: <ShieldCheck size={18} />,
};

/** Кнопка включения push — используется здесь и в настройках. */
export function PushToggle() {
  const { act } = useApp();
  const [state, setState] = useState<PushState>('off');
  useEffect(() => { pushState().then(setState); }, []);
  if (state === 'unsupported') return <p className="muted small">{t('Этот браузер не поддерживает push-уведомления. На iPhone сначала добавьте Jolda на экран «Домой».')}</p>;
  if (state === 'denied') {
    const d = deviceKind();
    return (
      <p className="muted small">
        {t('Уведомления для этого сайта выключены в браузере.')}{' '}
        {d === 'ios'
          ? t('На iPhone: «Настройки» → «Уведомления» → Jolda → «Допуск уведомлений», затем откройте Jolda снова.')
          : d === 'android'
            ? t('На Android: нажмите на значок слева от адреса сайта → «Разрешения» → «Уведомления» → «Разрешить», затем обновите страницу.')
            : t('Нажмите на значок слева от адреса сайта, разрешите уведомления и обновите страницу.')}
      </p>
    );
  }
  if (state === 'on')
    return (
      <div className="row wrap">
        <span className="status accepted"><BellRing size={14} /> {t('Push-уведомления включены')}</span>
        <button className="btn soft" onClick={() => act(() => api('/push/test', 'POST'))}>{t('Проверить')}</button>
      </div>
    );
  return (
    <button className="btn primary" onClick={() => act(async () => setState(await enablePush()), t('Готово'))}>
      <BellRing size={16} /> {t('Включить уведомления на этом устройстве')}
    </button>
  );
}

export default function NotificationsPage() {
  const { reloadMe, act, routeName } = useApp();
  const nav = useNavigate();
  // шаблон + подстановки: маршрут собирается из названий городов на языке интерфейса
  const text = (s: string, vars: Record<string, any>) => t(s, Object.fromEntries(Object.entries(vars || {}).map(([k, v]) => [k, Array.isArray(v) ? routeName(v) : v])));
  const { data, loading, reload } = useLoad(() => api<any[]>('/notifications'));
  useEvent('notify', reload);
  const open = async (n: any) => {
    if (!n.isRead) await api('/notifications/read', 'POST', { id: n.id }).catch(() => {});
    reloadMe();
    if (n.link) nav(n.link);
    else reload();
  };
  return (
    <div className="narrow stack">
      <div className="page-head">
        <h1 className="page-title">{t('Уведомления')}</h1>
        {data?.some((n) => !n.isRead) && (
          <button className="btn soft" onClick={async () => (await act(() => api('/notifications/read', 'POST', {}))) && (reload(), reloadMe())}>{t('Прочитать все')}</button>
        )}
      </div>
      <div className="card">
        <b>{t('На телефон, даже когда платформа закрыта')}</b>
        <PushToggle />
      </div>
      {loading ? <Loading /> : (
        <div className="list">
          {data?.map((n) => (
            <button key={n.id} className={`card notif ${n.isRead ? '' : 'unread'}`} onClick={() => open(n)}>
              <span className={`notif-icon ${n.kind}`}>{ICON[n.kind] || <Bell size={18} />}</span>
              <span className="grow">
                <b>{text(n.title, n.vars)}</b>
                {n.body && <span className="notif-body">{text(n.body, n.vars)}</span>}
                <span className="muted small">{fmtWhen(n.createdAt)}</span>
              </span>
            </button>
          ))}
          {data?.length === 0 && <div className="card"><Empty icon={<Bell size={26} />} title={t('Уведомлений пока нет')} text={t('Здесь появятся отклики, изменения по рейсам и новые грузы по вашим подпискам.')} /></div>}
        </div>
      )}
    </div>
  );
}
