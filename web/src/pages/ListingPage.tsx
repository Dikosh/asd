// Подробная карточка объявления: маршрут на карте, отклик, отклики владельцу, подходящие встречные объявления.
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Bookmark, BookmarkCheck, Check, Globe2, MessageSquare, StickyNote, TrendingUp, X } from 'lucide-react';
import { api, fmtDates, fmtWhen, Listing, money, num, PAY_L, t, useApp, useEvent, useLoad } from '../core';
import { CompanyBadge, Empty, Field, Loading, MapView, Select } from '../ui';
import { ContactButtons, ListingCard, NoteModal, RateBlock, RouteTitle, SpecChips } from '../listing';

type Detail = Listing & {
  market: { low: number; median: number; high: number; sample: number } | null;
  matches: Listing[];
  responses?: { id: number; message: string; price: number | null; currency: string; status: string; createdAt: string; chatId: number | null; user: { id: number; name: string; phone: string }; company: any }[];
  chatId?: number | null;
};
const RESP_L: Record<string, string> = { sent: 'Ожидает ответа', accepted: 'Принят', declined: 'Отклонён', withdrawn: 'Отозван' };

export default function ListingPage() {
  const id = Number(useParams().id);
  const { city, act, meta, cityName } = useApp();
  const nav = useNavigate();
  const { data: l, loading, error, reload } = useLoad(() => api<Detail>(`/listings/${id}`), [id]);
  useEvent('response trip', reload);
  const [msg, setMsg] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('KZT');
  const [note, setNote] = useState(false);

  const map = useMemo(() => {
    if (!l) return null;
    const pts = l.points.map((p) => [city(p)!.lat, city(p)!.lon] as [number, number]);
    return {
      routes: [{ pts }],
      markers: pts.map((pos, i) => ({ pos, kind: (i === 0 ? 'a' : i === pts.length - 1 ? 'b' : 'stop') as 'a' | 'b' | 'stop', label: cityName(l.points[i]) })),
    };
  }, [l]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <Loading />;
  if (error || !l) return <div className="card"><Empty title={t('Объявление не найдено')}><Link to="/" className="btn soft">{t('На главную')}</Link></Empty></div>;

  const perKm = l.rate && l.currency === 'KZT' && l.distanceKm ? Math.round(l.rate / l.distanceKm) : null;
  const respond = async () => {
    const ok = await act(() => api(`/listings/${l.id}/responses`, 'POST', { message: msg, price: price ? Number(price) : null, currency }), t('Отклик отправлен'));
    if (ok) {
      setMsg('');
      setPrice('');
      reload();
    }
  };
  const decide = async (rid: number, action: string, okText: string) => {
    let tripId: number | null = null;
    const ok = await act(async () => { tripId = (await api(`/responses/${rid}/${action}`, 'POST')).tripId; }, okText);
    if (ok && tripId) nav(`/trip/${tripId}`);
    else if (ok) reload();
  };
  const canRespond = !l.mine && l.status === 'active' && !l.tripId && l.myResponse?.status !== 'sent';

  return (
    <div className="stack">
      <button className="link back" onClick={() => nav(-1)}><ArrowLeft size={16} /> {t('Назад')}</button>
      <div className="detail-layout">
        <div className="stack">
          <div className="card">
            <div className="lcard-top">
              <div>
                <div className="lcard-tags">
                  <span className={`tag ${l.kind}`}>{l.kind === 'cargo' ? t('Груз') : t('Транспорт')}</span>
                  {l.status !== 'active' && <span className="tag">{l.status === 'closed' ? t('Закрыто') : t('В архиве')}</span>}
                  {l.international && <span className="tag intl"><Globe2 size={12} /> {t('Международный')}</span>}
                  {l.tripId && <span className="tag trip">{t('В рейсе')}</span>}
                </div>
                <h1 className="detail-title"><RouteTitle points={l.points} /></h1>
                <div className="muted">{num(l.distanceKm)} {t('км')} · {fmtDates(l.dateFrom, l.dateTo)} · №{l.id}</div>
              </div>
              <RateBlock l={l} />
            </div>
            <SpecChips l={l} />
            {l.payTerms.length > 0 && <div className="kv"><span>{t('Условия оплаты')}</span><b>{l.payTerms.map((p) => t(PAY_L[p])).join(', ')}</b></div>}
            {l.description && <p className="desc full">{l.description}</p>}
            {l.mark.note && <p className="note"><StickyNote size={14} /> {l.mark.note}</p>}
            {l.market && perKm && (
              <div className={`market ${perKm < l.market.low ? 'low' : perKm > l.market.high ? 'high' : ''}`}>
                <TrendingUp size={18} />
                <div>
                  <b>{t('Ставка {n} ₸/км', { n: num(perKm) })} — {perKm < l.market.low ? t('ниже рынка') : perKm > l.market.high ? t('выше рынка') : t('в рынке')}</b>
                  <span>{t('Обычно на платформе: {a}–{b} ₸/км (по {n} объявлениям)', { a: num(l.market.low), b: num(l.market.high), n: l.market.sample })}</span>
                </div>
              </div>
            )}
            {l.international && (
              <Link to="/cabinet/catalog?kind=broker" className="banner slim">
                <Globe2 size={18} /><div><b>{t('Нужен таможенный брокер?')}</b><span>{t('Выберите проверенного брокера в каталоге компаний.')}</span></div>
              </Link>
            )}
          </div>
          {map && <div className="card map-card"><MapView routes={map.routes} markers={map.markers} height={300} fitKey={String(l.id)} /></div>}

          {l.mine && (
            <section>
              <h2>{t('Отклики')} {l.responses!.length > 0 && <span className="muted">· {l.responses!.length}</span>}</h2>
              <div className="list">
                {l.responses!.map((r) => (
                  <div className="card resp" key={r.id}>
                    <div className="row between wrap">
                      <CompanyBadge c={r.company} />
                      <span className={`status ${r.status}`}>{t(RESP_L[r.status])}</span>
                    </div>
                    {r.company.indicator === 'red' && <div className="form-error">{t('Осторожно: у компании много плохих отзывов или записи в чёрном списке.')}</div>}
                    <p>{r.message}</p>
                    <div className="row between wrap">
                      <div><b>{r.price ? money(r.price, r.currency) : t('Без предложения цены')}</b> <span className="muted small">· {r.user.name} · {fmtWhen(r.createdAt)}</span></div>
                      <div className="row wrap">
                        <ContactButtons phone={r.user.phone} />
                        {r.chatId && <Link to={`/cabinet/messages/${r.chatId}`} className="btn soft"><MessageSquare size={16} /> {t('Чат')}</Link>}
                        {r.status === 'sent' && !l.tripId && (
                          <>
                            <button className="btn ghost" onClick={() => decide(r.id, 'decline', t('Отклик отклонён'))}><X size={16} /> {t('Отклонить')}</button>
                            <button className="btn primary" onClick={() => confirm(t('Принять отклик и создать рейс с этой компанией?')) && decide(r.id, 'accept', t('Рейс создан'))}><Check size={16} /> {t('Принять')}</button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {l.responses!.length === 0 && <div className="card"><Empty title={t('Откликов пока нет')} text={t('Мы сообщим, как только кто-нибудь откликнется.')} /></div>}
              </div>
            </section>
          )}

          {l.mine && l.matches.length > 0 && (
            <section>
              <h2>{l.kind === 'cargo' ? t('Подходящий транспорт') : t('Подходящие грузы')}</h2>
              <p className="muted small">{t('Подобрано по маршруту, датам и вместимости — можно откликнуться самому, не дожидаясь отклика.')}</p>
              <div className="list">{l.matches.map((m) => <ListingCard key={m.id} l={m} onChange={reload} />)}</div>
            </section>
          )}
        </div>

        <aside className="stack">
          <div className="card">
            <div className="muted small">{l.kind === 'cargo' ? t('Заказчик') : t('Перевозчик')}</div>
            <CompanyBadge c={l.company} />
            <div className="company-stats">
              <div><b>{l.company.trips}</b><span>{t('рейсов')}</span></div>
              <div><b>{l.company.rating?.toFixed(1) ?? '—'}</b><span>{t('рейтинг')}</span></div>
              <div><b>{l.company.reviews}</b><span>{t('отзывов')}</span></div>
            </div>
            {l.company.indicator === 'red' && <div className="form-error">{t('Осторожно: у компании много плохих отзывов или записи в чёрном списке.')}</div>}
            {l.company.verified !== 'verified' && <p className="muted small">{t('Компания ещё не прошла проверку документов.')}</p>}
            <div className="muted small">{t('Контакт')}: {l.user.name}</div>
            {!l.mine && (l.user.phone ? <div className="row wrap"><ContactButtons phone={l.user.phone} /></div> : <p className="muted small">{t('Телефон скрыт владельцем — свяжитесь через отклик и чат.')}</p>)}
          </div>

          {l.mine ? (
            <div className="card">
              <b>{t('Это ваше объявление')}</b>
              {l.tripId ? <Link to={`/trip/${l.tripId}`} className="btn primary block">{t('Открыть рейс')}</Link> : <Link to={`/my/${l.kind}/${l.id}/edit`} className="btn soft block">{t('Изменить')}</Link>}
            </div>
          ) : (
            <div className="card">
              {l.myResponse && (
                <div className="my-resp">
                  <span className={`status ${l.myResponse.status}`}>{t('Ваш отклик')}: {t(RESP_L[l.myResponse.status])}</span>
                  <div className="row wrap">
                    {l.chatId && <Link to={`/cabinet/messages/${l.chatId}`} className="btn primary"><MessageSquare size={16} /> {t('Открыть чат')}</Link>}
                    {l.myResponse.status === 'sent' && <button className="btn ghost" onClick={() => decide(l.myResponse!.id, 'withdraw', t('Отклик отозван'))}>{t('Отозвать отклик')}</button>}
                    {l.tripId && l.myResponse.status === 'accepted' && <Link to={`/trip/${l.tripId}`} className="btn soft">{t('Открыть рейс')}</Link>}
                  </div>
                </div>
              )}
              {canRespond && (
                <form className="stack-s" onSubmit={(e) => { e.preventDefault(); respond(); }}>
                  <b>{t('Откликнуться')}</b>
                  <Field label={t('Ваше предложение')}>
                    <textarea rows={3} required value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={1000}
                      placeholder={l.kind === 'cargo' ? t('Какая машина, когда готовы встать на погрузку') : t('Какой груз, когда и откуда забирать')} />
                  </Field>
                  <div className="grid2">
                    <Field label={t('Ваша цена (необязательно)')}><input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} /></Field>
                    <Field label={t('Валюта')}><Select value={currency} onChange={setCurrency} options={meta.currencies.map((c) => ({ value: c, label: c }))} /></Field>
                  </div>
                  <button className="btn primary block" disabled={!msg.trim()}>{t('Отправить отклик')}</button>
                  <p className="muted small">{t('После отправки откроется чат с владельцем объявления.')}</p>
                </form>
              )}
              {!canRespond && !l.myResponse && <p className="muted">{t('Объявление больше не принимает отклики.')}</p>}
              <div className="row wrap">
                <button className="btn soft" onClick={async () => (await act(() => api(`/listings/${l.id}/mark`, 'POST', { marked: !l.mark.marked }))) && reload()}>
                  {l.mark.marked ? <BookmarkCheck size={16} /> : <Bookmark size={16} />} {l.mark.marked ? t('Отмечено') : t('Отметить')}
                </button>
                <button className="btn soft" onClick={() => setNote(true)}><StickyNote size={16} /> {t('Заметка')}</button>
              </div>
            </div>
          )}
        </aside>
      </div>
      {note && <NoteModal l={l} onClose={() => setNote(false)} onSaved={reload} />}
    </div>
  );
}
