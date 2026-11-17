// Карточка объявления и общие части для грузов и транспорта.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Bookmark, BookmarkCheck, EyeOff, Eye, ExternalLink, Globe2, MessageCircle, MoreHorizontal, Phone, StickyNote, Zap } from 'lucide-react';
import { api, BODY_L, CARGO_L, fmtDates, Listing, LOADING_L, money, num, PAY_L, t, useApp, waLink } from './core';
import { CompanyBadge, Modal } from './ui';

export function RouteTitle({ points }: { points: string[] }) {
  const { cityName } = useApp();
  return (
    <span className="route">
      {points.map((p, i) => (
        <span key={i} className={i > 0 && i < points.length - 1 ? 'via' : ''}>
          {i > 0 && <ArrowRight size={15} />}
          {cityName(p)}
        </span>
      ))}
    </span>
  );
}

export function SpecChips({ l }: { l: Pick<Listing, 'kind' | 'cargoType' | 'bodyType' | 'weight' | 'volume' | 'loading' | 'brand'> }) {
  return (
    <div className="chips">
      {l.kind === 'truck' && l.brand && <span className="chip strong">{l.brand}</span>}
      {l.cargoType && <span className="chip strong">{t(CARGO_L[l.cargoType])}</span>}
      {l.bodyType && <span className="chip">{t(BODY_L[l.bodyType])}</span>}
      {l.weight != null && <span className="chip">{num(l.weight)} {t('т')}</span>}
      {l.volume != null && <span className="chip">{num(l.volume)} {t('м³')}</span>}
      {l.loading.map((x) => (
        <span className="chip light" key={x}>{t(LOADING_L[x])}</span>
      ))}
    </div>
  );
}

export function RateBlock({ l }: { l: Listing }) {
  return (
    <div className="rate">
      <b>{money(l.rate, l.currency)}</b>
      {l.rate && l.distanceKm > 0 && l.currency === 'KZT' && <small>{num(Math.round(l.rate / l.distanceKm))} ₸/{t('км')}</small>}
    </div>
  );
}

export function NoteModal({ l, onClose, onSaved }: { l: Listing; onClose: () => void; onSaved: () => void }) {
  const { act } = useApp();
  const [note, setNote] = useState(l.mark.note);
  return (
    <Modal title={t('Заметка к объявлению')} onClose={onClose}>
      <p className="muted">{t('Заметку видите только вы. Объявление попадёт в «Отмеченные».')}</p>
      <textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} autoFocus maxLength={500} placeholder={t('Например: перезвонить после 15:00')} />
      <div className="row end">
        <button className="btn ghost" onClick={onClose}>{t('Отмена')}</button>
        <button
          className="btn primary"
          onClick={async () => {
            if (await act(() => api(`/listings/${l.id}/mark`, 'POST', { note, marked: true }), t('Заметка сохранена'))) {
              onSaved();
              onClose();
            }
          }}
        >
          {t('Сохранить')}
        </button>
      </div>
    </Modal>
  );
}

/** Меню «Действия»: открыть, отметить, заметка, скрыть. */
function ActionsMenu({ l, onChange }: { l: Listing; onChange: () => void }) {
  const { act } = useApp();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const mark = async (body: object, ok: string) => {
    setOpen(false);
    if (await act(() => api(`/listings/${l.id}/mark`, 'POST', body), ok)) onChange();
  };
  return (
    <div className="menu-wrap" ref={box}>
      <button className="btn soft" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        <MoreHorizontal size={17} /> <span className="hide-s">{t('Действия')}</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <button role="menuitem" onClick={() => nav(`/listing/${l.id}`)}><ExternalLink size={16} /> {t('Открыть')}</button>
          <button role="menuitem" onClick={() => mark({ marked: !l.mark.marked }, l.mark.marked ? t('Отметка снята') : t('Добавлено в «Отмеченные»'))}>
            {l.mark.marked ? <BookmarkCheck size={16} /> : <Bookmark size={16} />} {l.mark.marked ? t('Снять отметку') : t('Отметить')}
          </button>
          <button role="menuitem" onClick={() => { setOpen(false); setNote(true); }}><StickyNote size={16} /> {t('Заметка')}</button>
          <button role="menuitem" onClick={() => mark({ hidden: !l.mark.hidden }, l.mark.hidden ? t('Объявление возвращено') : t('Объявление скрыто'))}>
            {l.mark.hidden ? <Eye size={16} /> : <EyeOff size={16} />} {l.mark.hidden ? t('Вернуть в выдачу') : t('Скрыть')}
          </button>
        </div>
      )}
      {note && <NoteModal l={l} onClose={() => setNote(false)} onSaved={onChange} />}
    </div>
  );
}

export function ContactButtons({ phone, text }: { phone: string; text?: string }) {
  return (
    <>
      <a className="btn soft" href={`tel:${phone}`}><Phone size={16} /> <span className="hide-s">{t('Позвонить')}</span></a>
      <a className="btn soft wa" href={waLink(phone, text)} target="_blank" rel="noreferrer"><MessageCircle size={16} /> <span className="hide-s">WhatsApp</span></a>
    </>
  );
}

export function ListingCard({ l, onChange, footer }: { l: Listing; onChange: () => void; footer?: React.ReactNode }) {
  const { routeName } = useApp();
  return (
    <article className={`card lcard ${l.boosted ? 'boosted' : ''}`}>
      <div className="lcard-top">
        <div>
          <div className="lcard-tags">
            <span className={`tag ${l.kind}`}>{l.kind === 'cargo' ? t('Груз') : t('Транспорт')}</span>
            {l.boosted && <span className="tag top"><Zap size={12} /> {t('В топе')}</span>}
            {l.international && <span className="tag intl"><Globe2 size={12} /> {t('Международный')}</span>}
            {l.match && <span className="tag match">{t('Совпадение {n}%', { n: l.match.score })}</span>}
            {l.mark.marked && <span className="tag marked"><BookmarkCheck size={12} /> {t('Отмечено')}</span>}
            {l.myResponse?.status === 'sent' && <span className="tag sent">{t('Вы откликнулись')}</span>}
            {l.tripId && <span className="tag trip">{t('В рейсе')}</span>}
          </div>
          <Link to={`/listing/${l.id}`} className="lcard-title"><RouteTitle points={l.points} /></Link>
          <div className="muted small">
            {num(l.distanceKm)} {t('км')} · {fmtDates(l.dateFrom, l.dateTo)}
            {l.detourKm ? ` · ${t('крюк ~{n} км', { n: l.detourKm })}` : ''}
          </div>
        </div>
        <RateBlock l={l} />
      </div>
      <SpecChips l={l} />
      {l.payTerms.length > 0 && <div className="muted small">{l.payTerms.map((p) => t(PAY_L[p])).join(' · ')}</div>}
      {l.description && <p className="desc">{l.description}</p>}
      {l.mark.note && <p className="note"><StickyNote size={14} /> {l.mark.note}</p>}
      <div className="lcard-foot">
        <CompanyBadge c={l.company} />
        <div className="row">
          {footer ?? (
            <>
              {!l.mine && l.user.phone && <ContactButtons phone={l.user.phone} text={`${t('Здравствуйте! Пишу по объявлению на Jolda')}: ${routeName(l.points)}`} />}
              <ActionsMenu l={l} onChange={onChange} />
            </>
          )}
        </div>
      </div>
    </article>
  );
}
