// Карточка объявления и общие части для грузов и транспорта.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight, Ban, Bookmark, BookmarkCheck, EyeOff, Eye, ExternalLink, Flag, Globe2, Handshake, MessageCircle, MoreHorizontal, Phone, Share2, StickyNote,
  TriangleAlert, Zap,
} from 'lucide-react';
import { api, BODY_L, CARGO_L, FLAG_L, fmtDates, Listing, LOADING_L, money, num, PAY_L, t, useApp, waLink } from './core';
import { CompanyBadge, Field, Modal, Select } from './ui';

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

export function SpecChips({ l }: { l: Pick<Listing, 'kind' | 'cargoType' | 'bodyType' | 'weight' | 'volume' | 'loading' | 'brand'> & Partial<Pick<Listing, 'adrClass' | 'flags'>> }) {
  return (
    <div className="chips">
      {l.kind === 'truck' && l.brand && <span className="chip strong">{l.brand}</span>}
      {l.cargoType && <span className="chip strong">{t(CARGO_L[l.cargoType])}</span>}
      {l.bodyType && <span className="chip">{t(BODY_L[l.bodyType])}</span>}
      {l.weight != null && <span className="chip">{num(l.weight)} {t('т')}</span>}
      {l.volume != null && <span className="chip">{num(l.volume)} {t('м³')}</span>}
      {l.adrClass != null && <span className="chip adr"><TriangleAlert size={12} /> ADR {l.adrClass}</span>}
      {l.flags?.map((x) => <span className="chip doc" key={x}>{t(FLAG_L[x])}</span>)}
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

const REASONS: Record<string, string> = {
  fraud: 'Похоже на мошенничество', outdated: 'Объявление устарело', wrong_info: 'Неверные данные', duplicate: 'Повтор объявления', rude: 'Грубость или угрозы', other: 'Другое',
};
/** Жалоба модератору на объявление или компанию. */
export function ComplaintModal({ listingId, companyId, onClose }: { listingId?: number; companyId?: number; onClose: () => void }) {
  const { act } = useApp();
  const [reason, setReason] = useState('fraud');
  const [text, setText] = useState('');
  return (
    <Modal title={t('Пожаловаться')} onClose={onClose}>
      <p className="muted small">{t('Жалобу увидит только модератор. Он проверит объявление и компанию и примет меры.')}</p>
      <Field label={t('Что не так')}><Select value={reason} onChange={setReason} options={Object.keys(REASONS).map((k) => ({ value: k, label: t(REASONS[k]) }))} /></Field>
      <Field label={t('Подробности (необязательно)')}><textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} /></Field>
      <div className="row end">
        <button className="btn ghost" onClick={onClose}>{t('Отмена')}</button>
        <button className="btn danger" onClick={async () => (await act(() => api('/complaints', 'POST', { listingId, companyId, reason, text }), t('Жалоба отправлена модератору'))) && onClose()}>{t('Отправить жалобу')}</button>
      </div>
    </Modal>
  );
}

/** Поделиться объявлением: системное меню на телефоне, иначе — ссылка в буфер обмена. */
export function useShare() {
  const { toast, routeName } = useApp();
  return async (l: Listing) => {
    const url = `${location.origin}/listing/${l.id}`;
    const title = `${l.kind === 'cargo' ? t('Груз') : t('Транспорт')}: ${routeName(l.points)}${l.rate ? ` · ${money(l.rate, l.currency)}` : ''}`;
    try {
      if (navigator.share) await navigator.share({ title, text: title, url });
      else {
        await navigator.clipboard.writeText(`${title}\n${url}`);
        toast(t('Ссылка скопирована'));
      }
    } catch {
      /* пользователь закрыл окно «Поделиться» */
    }
  };
}

/** Меню «Действия»: открыть, отметить, заметка, поделиться, скрыть, пожаловаться. */
function ActionsMenu({ l, onChange }: { l: Listing; onChange: () => void }) {
  const { act } = useApp();
  const nav = useNavigate();
  const share = useShare();
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<'note' | 'complaint' | null>(null);
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
  const blockCompany = async () => {
    setOpen(false);
    if (!confirm(t('Скрыть все объявления компании «{name}»? Вернуть можно в кабинете, в чёрном списке.', { name: l.company.name }))) return;
    if (await act(() => api(`/companies/${l.company.id}/block`, 'POST', { on: true }), t('Объявления компании скрыты'))) onChange();
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
          <button role="menuitem" onClick={() => { setOpen(false); setModal('note'); }}><StickyNote size={16} /> {t('Заметка')}</button>
          <button role="menuitem" onClick={() => { setOpen(false); share(l); }}><Share2 size={16} /> {t('Поделиться')}</button>
          {!l.mine && (
            <>
              <button role="menuitem" onClick={() => mark({ hidden: !l.mark.hidden }, l.mark.hidden ? t('Объявление возвращено') : t('Объявление скрыто'))}>
                {l.mark.hidden ? <Eye size={16} /> : <EyeOff size={16} />} {l.mark.hidden ? t('Вернуть в выдачу') : t('Скрыть')}
              </button>
              <button role="menuitem" onClick={blockCompany}><Ban size={16} /> {t('Скрыть все от этой компании')}</button>
              <button role="menuitem" className="danger" onClick={() => { setOpen(false); setModal('complaint'); }}><Flag size={16} /> {t('Пожаловаться')}</button>
            </>
          )}
        </div>
      )}
      {modal === 'note' && <NoteModal l={l} onClose={() => setModal(null)} onSaved={onChange} />}
      {modal === 'complaint' && <ComplaintModal listingId={l.id} onClose={() => setModal(null)} />}
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
            {l.partner && <span className="tag partner"><Handshake size={12} /> {t('Партнёр')}</span>}
            {l.mark.marked && <span className="tag marked"><BookmarkCheck size={12} /> {t('Отмечено')}</span>}
            {l.myResponse?.status === 'sent' && <span className="tag sent">{t('Вы откликнулись')}</span>}
            {l.tripId && <span className="tag trip">{t('В рейсе')}</span>}
          </div>
          <Link to={`/listing/${l.id}`} className="lcard-title"><RouteTitle points={l.points} /></Link>
          <div className="muted small">
            {num(l.distanceKm)} {t('км')} · {fmtDates(l.dateFrom, l.dateTo)}
            {l.detourKm ? ` · ${t('крюк ~{n} км', { n: l.detourKm })}` : ''}
            {l.mine ? ` · ${t('просмотров: {n}', { n: l.views })}` : ''}
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
