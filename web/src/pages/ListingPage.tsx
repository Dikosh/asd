// Подробная карточка объявления: маршрут на карте, отклик, отклики владельцу, подходящие встречные объявления.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Bookmark, BookmarkCheck, Check, ChevronRight, Eye, FileCheck2, Flag, Globe2, MessageSquare, Send, Share2, ShieldAlert, StickyNote, TrendingUp, X } from 'lucide-react';
import { api, Company, fmtDates, fmtWhen, Listing, money, num, PAY_L, ROLE_L, t, useApp, useEvent, useLoad } from '../core';
import { CompanyBadge, Empty, Field, Loading, MapView, Select } from '../ui';
import { AcceptResponseModal, canRespondTo, ComplaintModal, ContactButtons, ListingCard, NoteModal, RateBlock, RouteTitle, SpecChips, useShare } from '../listing';

type Resp = { id: number; message: string; price: number | null; currency: string; status: string; createdAt: string; chatId: number | null; user: { id: number; name: string; phone: string }; company: Company };
type Detail = Listing & {
  market: { low: number; median: number; high: number; sample: number } | null;
  matches: Listing[];
  responses?: Resp[];
  chatId?: number | null;
};
const RESP_L: Record<string, string> = { sent: 'Ожидает ответа', accepted: 'Принят', declined: 'Отклонён', withdrawn: 'Отозван' };

export default function ListingPage() {
  const id = Number(useParams().id);
  const { city, act, meta, cityName, me } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const { data: l, loading, error, reload } = useLoad(() => api<Detail>(`/listings/${id}`), [id]);
  useEvent('response trip', reload);
  const [msg, setMsg] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('KZT');
  const [note, setNote] = useState(false);
  const [complain, setComplain] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false); // защита от двойного нажатия: второй запрос не уходит, пока идёт первый
  const [ask, setAsk] = useState<{ r: Resp; mode: 'accept' | 'decline' } | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const [formSeen, setFormSeen] = useState(false);
  const [navH, setNavH] = useState(60);
  const share = useShare();
  const broker = me?.company.kind === 'broker';
  const canRespond = !!l && canRespondTo(l);

  const map = useMemo(() => {
    if (!l) return null;
    const pts = l.points.map((p) => [city(p)!.lat, city(p)!.lon] as [number, number]);
    return {
      routes: [{ pts }],
      markers: pts.map((pos, i) => ({ pos, kind: (i === 0 ? 'a' : i === pts.length - 1 ? 'b' : 'stop') as 'a' | 'b' | 'stop', label: cityName(l.points[i]) })),
    };
  }, [l]); // eslint-disable-line react-hooks/exhaustive-deps

  const toForm = (smooth = true) => {
    form.current?.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
    form.current?.querySelector('textarea')?.focus({ preventScroll: true });
  };
  // кнопка «Откликнуться» внизу экрана телефона видна, пока форма отклика не попала на экран
  useEffect(() => {
    const el = form.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const h = (document.querySelector('.bottomnav') as HTMLElement | null)?.offsetHeight || 0;
    setNavH(h);
    // нижнее меню закрывает край экрана: форма «видна», только когда поднялась над ним
    const io = new IntersectionObserver(([e]) => setFormSeen(e.isIntersecting), { threshold: 0.25, rootMargin: `0px 0px -${h + 24}px 0px` });
    io.observe(el);
    return () => io.disconnect();
  }, [l?.id, canRespond]);
  // из карточки в поиске приходят по ссылке /listing/<id>#respond — сразу показываем форму
  useEffect(() => {
    if (!l || loc.hash !== '#respond' || !canRespond) return;
    const tm = setTimeout(() => toForm(false), 60);
    return () => clearTimeout(tm);
  }, [l?.id, loc.hash]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <Loading />;
  if (error || !l) return <div className="card"><Empty title={t('Объявление не найдено')}><Link to="/" className="btn soft">{t('На главную')}</Link></Empty></div>;

  const perKm = l.rate && l.currency === 'KZT' && l.distanceKm ? Math.round(l.rate / l.distanceKm) : null;
  const customs = l.flags.includes('customs');
  const unknown = l.company.verified !== 'verified' && l.company.trips === 0;
  const prepay = l.payTerms.includes('prepay');
  // пустое сообщение не мешает откликнуться: отправляем понятный текст по умолчанию
  const defaultMsg = broker
    ? t('Здравствуйте! Готовы помочь с таможенным оформлением этой перевозки.')
    : l.kind === 'cargo' ? t('Здравствуйте! Готовы перевезти ваш груз. Давайте обсудим детали.') : t('Здравствуйте! Есть груз для вашей машины. Давайте обсудим детали.');

  /** Один запрос за раз: пока он идёт, кнопки заблокированы. */
  const once = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await fn();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const respond = () => once(async () => {
    let chatId: number | null = null;
    const ok = await act(async () => {
      chatId = (await api<{ chatId: number | null }>(`/listings/${l.id}/responses`, 'POST', { message: msg.trim() || defaultMsg, price: price ? Number(price) : null, currency })).chatId;
    }, t('Отклик отправлен'));
    if (!ok) return;
    setMsg('');
    setPrice('');
    if (chatId) nav(`/cabinet/messages/${chatId}`);
    else reload();
  });
  const decide = (rid: number, action: string, okText: string) => once(async () => {
    let tripId: number | null = null;
    const ok = await act(async () => { tripId = (await api(`/responses/${rid}/${action}`, 'POST')).tripId; }, okText);
    setAsk(null);
    if (ok && tripId) nav(`/trip/${tripId}`);
    else reload(); // после ошибки тоже обновляем: отклик могли уже обработать
  });
  const showBar = canRespond && !formSeen;

  return (
    <div className={`stack detail-page ${showBar ? 'has-bar' : ''}`}>
      <button className="link back" onClick={() => nav(-1)}><ArrowLeft size={16} /> {t('Назад')}</button>
      <div className="detail-layout reflow">
        <div className="stack">
          <div className="card d-main">
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
            {!l.mine && (unknown || prepay) && (
              <Link to="/help/safety" className="banner warn slim prepay-warn">
                <ShieldAlert size={20} />
                <div>
                  <b>{t('Не переводите предоплату компании, которую не проверили')}</b>
                  <span>
                    {unknown
                      ? t('Эта компания не прошла проверку документов и ещё не завершила ни одного рейса на Jolda.')
                      : t('В условиях оплаты указана предоплата. Сначала проверьте компанию: документы, отзывы, чёрный список.')}
                    {' '}<u>{t('Как проверить партнёра')}</u>
                  </span>
                </div>
              </Link>
            )}
            {/* брокеру подсказка «найдите брокера» не нужна — ему показываем, что здесь ждут его услуг */}
            {broker && customs && !l.mine && (
              <div className="banner customs">
                <FileCheck2 size={20} />
                <div><b>{t('Для этой перевозки нужен таможенный брокер')}</b><span>{t('Предложите свои услуги: откликнитесь и укажите стоимость оформления.')}</span></div>
                {canRespond && <button className="btn primary" onClick={() => toForm()}>{t('Предложить услуги')}</button>}
              </div>
            )}
            {!broker && (customs || l.international) && (
              <Link to="/cabinet/catalog?kind=broker" className={`banner ${customs ? 'customs' : 'slim'}`}>
                {customs ? <FileCheck2 size={20} /> : <Globe2 size={18} />}
                <div>
                  <b>{customs ? t('Для этой перевозки нужен таможенный брокер') : t('Нужен таможенный брокер?')}</b>
                  <span>{t('Выберите проверенного брокера в каталоге компаний.')}</span>
                </div>
                <ChevronRight size={18} />
              </Link>
            )}
          </div>
          {map && <div className="card map-card d-map"><MapView routes={map.routes} markers={map.markers} height={300} fitKey={String(l.id)} /></div>}

          {l.mine && (
            <section className="d-responses">
              <h2>{t('Отклики')} {l.responses!.length > 0 && <span className="muted">· {l.responses!.length}</span>}</h2>
              <div className="list">
                {l.responses!.map((r) => {
                  const isBroker = r.company.kind === 'broker';
                  return (
                    <div className="card resp" key={r.id}>
                      <div className="row between wrap">
                        <div className="row wrap">
                          <CompanyBadge c={r.company} />
                          <span className={`tag ${isBroker ? 'customs' : ''}`}>{t(ROLE_L[r.company.kind] || r.company.kind)}</span>
                        </div>
                        <span className={`status ${r.status}`}>{t(RESP_L[r.status])}</span>
                      </div>
                      <div className="muted small">
                        {r.company.rating != null ? t('рейтинг {n}', { n: r.company.rating.toFixed(1) }) : t('оценок пока нет')} · {t('рейсов: {n}', { n: r.company.trips })} · {t('отзывов: {n}', { n: r.company.reviews })}
                      </div>
                      {r.company.indicator === 'red' && <div className="form-error">{t('Осторожно: у компании много плохих отзывов или записи в чёрном списке.')}</div>}
                      <p>{r.message}</p>
                      {isBroker && <div className="info-line">{t('Таможенный брокер: договоритесь об услугах в чате')}</div>}
                      <div className="row between wrap">
                        <div><b>{r.price ? money(r.price, r.currency) : t('Без предложения цены')}</b> <span className="muted small">· {r.user.name} · {fmtWhen(r.createdAt)}</span></div>
                        <div className="row wrap">
                          {r.user.phone && <ContactButtons phone={r.user.phone} />}
                          {r.chatId && <Link to={`/cabinet/messages/${r.chatId}`} className="btn soft"><MessageSquare size={16} /> {t('Чат')}</Link>}
                          {r.status === 'sent' && !l.tripId && (
                            <>
                              <button className="btn ghost" disabled={busy} onClick={() => setAsk({ r, mode: 'decline' })}><X size={16} /> {t('Отклонить')}</button>
                              {!isBroker && <button className="btn primary" disabled={busy} onClick={() => setAsk({ r, mode: 'accept' })}><Check size={16} /> {t('Принять')}</button>}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {l.responses!.length === 0 && <div className="card"><Empty title={t('Откликов пока нет')} text={t('Мы сообщим, как только кто-нибудь откликнется.')} /></div>}
              </div>
            </section>
          )}

          {l.mine && l.matches.length > 0 && (
            <section className="d-matches">
              <h2>{l.kind === 'cargo' ? t('Подходящий транспорт') : t('Подходящие грузы')}</h2>
              <p className="muted small">{t('Подобрано по маршруту, датам и вместимости — можно откликнуться самому, не дожидаясь отклика.')}</p>
              <div className="list">{l.matches.map((m) => <ListingCard key={m.id} l={m} onChange={reload} />)}</div>
            </section>
          )}
        </div>

        <aside className="stack">
          <div className="card d-company">
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
            {!l.mine && (l.user.phone ? <div className="row wrap"><ContactButtons full phone={l.user.phone} /></div> : <p className="muted small">{t('Телефон скрыт владельцем — свяжитесь через отклик и чат.')}</p>)}
          </div>

          {l.mine ? (
            <div className="card d-act">
              <b>{t('Это ваше объявление')}</b>
              <div className="muted small"><Eye size={14} /> {t('просмотров: {n}', { n: l.views })} · {t('откликов: {n}', { n: l.responsesCount })}</div>
              <button className="btn soft block" onClick={() => share(l)}><Share2 size={16} /> {t('Поделиться объявлением')}</button>
              {l.tripId ? <Link to={`/trip/${l.tripId}`} className="btn primary block">{t('Открыть рейс')}</Link> : <Link to={`/my/${l.kind}/${l.id}/edit`} className="btn soft block">{t('Изменить')}</Link>}
            </div>
          ) : (
            <div className="card d-act">
              {l.myResponse && (
                <div className="my-resp">
                  <span className={`status ${l.myResponse.status}`}>{t('Ваш отклик')}: {t(RESP_L[l.myResponse.status])}</span>
                  <div className="row wrap">
                    {l.chatId && <Link to={`/cabinet/messages/${l.chatId}`} className="btn primary"><MessageSquare size={16} /> {t('Открыть чат')}</Link>}
                    {l.myResponse.status === 'sent' && <button className="btn ghost" disabled={busy} onClick={() => decide(l.myResponse!.id, 'withdraw', t('Отклик отозван'))}>{t('Отозвать отклик')}</button>}
                    {l.tripId && l.myResponse.status === 'accepted' && <Link to={`/trip/${l.tripId}`} className="btn soft">{t('Открыть рейс')}</Link>}
                  </div>
                </div>
              )}
              {canRespond && (
                <form className="stack-s" id="respond" ref={form} onSubmit={(e) => { e.preventDefault(); respond(); }}>
                  <b>{broker ? t('Предложить услуги брокера') : t('Откликнуться')}</b>
                  <Field label={t('Сообщение (необязательно)')} hint={msg.trim() ? undefined : t('Если оставить пустым, отправим: «{text}»', { text: defaultMsg })}>
                    <textarea rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={1000}
                      placeholder={broker ? t('Какие услуги и сроки предлагаете') : l.kind === 'cargo' ? t('Какая машина, когда готовы встать на погрузку') : t('Какой груз, когда и откуда забирать')} />
                  </Field>
                  <div className="grid2">
                    <Field label={broker ? t('Стоимость ваших услуг (необязательно)') : t('Ваша цена (необязательно)')}>
                      <input inputMode="numeric" value={price} maxLength={10} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} />
                    </Field>
                    <Field label={t('Валюта')}><Select value={currency} onChange={setCurrency} options={meta.currencies.map((c) => ({ value: c, label: c }))} /></Field>
                  </div>
                  <button className="btn primary block" disabled={busy}><Send size={16} /> {busy ? t('Отправляем…') : t('Отправить отклик')}</button>
                  <p className="muted small">{t('После отправки откроется чат с владельцем объявления.')}</p>
                </form>
              )}
              {!canRespond && !l.myResponse && <p className="muted">{t('Объявление больше не принимает отклики.')}</p>}
              <div className="row wrap">
                <button className="btn soft" onClick={async () => (await act(() => api(`/listings/${l.id}/mark`, 'POST', { marked: !l.mark.marked }))) && reload()}>
                  {l.mark.marked ? <BookmarkCheck size={16} /> : <Bookmark size={16} />} {l.mark.marked ? t('Отмечено') : t('Отметить')}
                </button>
                <button className="btn soft" onClick={() => setNote(true)}><StickyNote size={16} /> {t('Заметка')}</button>
                <button className="btn soft" onClick={() => share(l)} aria-label={t('Поделиться')} title={t('Поделиться')}><Share2 size={16} /></button>
                <button className="btn ghost" onClick={() => setComplain(true)} aria-label={t('Пожаловаться')} title={t('Пожаловаться')}><Flag size={16} /></button>
              </div>
            </div>
          )}
        </aside>
      </div>

      {showBar && (
        <div className="respond-bar" style={{ bottom: navH + 8 }}>
          <RateBlock l={l} />
          <button className="btn primary" onClick={() => toForm()}><Send size={16} /> {broker ? t('Предложить услуги') : t('Откликнуться')}</button>
        </div>
      )}
      {note && <NoteModal l={l} onClose={() => setNote(false)} onSaved={reload} />}
      {complain && <ComplaintModal listingId={l.id} onClose={() => setComplain(false)} />}
      {ask && (
        <AcceptResponseModal
          r={ask.r}
          mode={ask.mode}
          listingRate={{ rate: l.rate, currency: l.currency }}
          onClose={() => setAsk(null)}
          onConfirm={() => (ask.mode === 'accept' ? decide(ask.r.id, 'accept', t('Рейс создан')) : decide(ask.r.id, 'decline', t('Отклик отклонён')))}
        />
      )}
    </div>
  );
}
