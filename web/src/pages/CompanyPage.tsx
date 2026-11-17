// Страница компании: проверка контрагента — рейтинг, отзывы, документы, чёрный список.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, Ban, FileCheck2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { api, Company, DOC_L, fmtDate, Listing, ROLE_L, t, useApp, useLoad } from '../core';
import { CompanyBadge, Empty, Field, Loading, Modal, Stars } from '../ui';
import { ContactButtons, ListingCard } from '../listing';

type Full = Company & {
  bin: string | null; binValid: boolean; about: string; cityId: string | null; since: string; mine: boolean; vehicles: number; documents: string[];
  contacts: { name: string; phone: string; role: string }[];
  reviewList: { rating: number; text: string; createdAt: string; author: string; authorId: number }[];
  blacklist: { reason: string; review: string; createdAt: string; author: string; authorId: number }[];
  listings: Listing[];
};
const IND: Record<string, [string, string]> = {
  green: ['Хорошая репутация', 'Отзывы положительные, жалоб нет.'],
  red: ['Много плохих отзывов', 'Низкие оценки или несколько записей в чёрном списке. Будьте осторожны с предоплатой.'],
  gray: ['Пока мало отзывов', 'Компания новая на платформе или отзывы неоднозначны.'],
};

export default function CompanyPage() {
  const id = Number(useParams().id);
  const { cityName, act } = useApp();
  const nav = useNavigate();
  const { data: c, loading, reload } = useLoad(() => api<Full>(`/companies/${id}`), [id]);
  const [bl, setBl] = useState<{ reason: string; review: string } | null>(null);
  if (loading) return <Loading />;
  if (!c) return <div className="card"><Empty title={t('Компания не найдена')} /></div>;
  return (
    <div className="stack">
      <button className="link back" onClick={() => nav(-1)}><ArrowLeft size={16} /> {t('Назад')}</button>
      <div className="detail-layout">
        <div className="stack">
          <div className="card stack-s">
            <CompanyBadge c={c} link={false} />
            <div className="muted">{t(ROLE_L[c.kind])}{c.cityId ? ` · ${cityName(c.cityId)}` : ''} · {t('на платформе с {d}', { d: fmtDate(c.since) })}</div>
            <div className={`market ${c.indicator === 'red' ? 'low' : c.indicator === 'green' ? 'ok' : ''}`}>
              {c.indicator === 'red' ? <ShieldAlert size={20} /> : <ShieldCheck size={20} />}
              <div><b>{t(IND[c.indicator][0])}</b><span>{t(IND[c.indicator][1])}</span></div>
            </div>
            <div className="company-stats">
              <div><b>{c.trips}</b><span>{t('рейсов')}</span></div>
              <div><b>{c.rating?.toFixed(1) ?? '—'}</b><span>{t('рейтинг')}</span></div>
              <div><b>{c.reviews}</b><span>{t('отзывов')}</span></div>
              <div><b>{c.vehicles}</b><span>{t('машин')}</span></div>
            </div>
            {c.about && <p>{c.about}</p>}
          </div>

          <section>
            <h2>{t('Отзывы')} <span className="muted">· {c.reviewList.length}</span></h2>
            <div className="list">
              {c.reviewList.map((r, i) => (
                <div className="card review" key={i}>
                  <div className="row between"><Stars value={r.rating} size={15} /><span className="muted small">{fmtDate(r.createdAt)}</span></div>
                  {r.text && <p>{r.text}</p>}
                  <Link to={`/company/${r.authorId}`} className="muted small">{r.author}</Link>
                </div>
              ))}
              {c.reviewList.length === 0 && <div className="card"><Empty title={t('Отзывов пока нет')} text={t('Отзывы появляются после завершённых рейсов.')} /></div>}
            </div>
          </section>

          {c.listings.length > 0 && (
            <section>
              <h2>{t('Активные объявления')}</h2>
              <div className="list">{c.listings.map((l) => <ListingCard key={l.id} l={l} onChange={reload} />)}</div>
            </section>
          )}
        </div>

        <aside className="stack">
          <div className="card stack-s">
            <b>{t('Проверка')}</b>
            <div className="check"><span className={c.verified === 'verified' ? 'ok' : 'no'}><BadgeCheck size={17} /></span>{c.verified === 'verified' ? t('Компания проверена модератором') : t('Компания ещё не прошла проверку документов.')}</div>
            <div className="check"><span className={c.binValid ? 'ok' : 'no'}><FileCheck2 size={17} /></span>{c.bin ? `${t('БИН')} ${c.bin} — ${c.binValid ? t('контрольный разряд верен') : t('некорректен')}` : t('БИН не указан')}</div>
            {c.documents.map((d) => <div className="check" key={d}><span className="ok"><FileCheck2 size={17} /></span>{t(DOC_L[d])}: {t('Принят').toLowerCase()}</div>)}
            <div className="check"><span className={c.blacklist.length ? 'bad' : 'ok'}><Ban size={17} /></span>{c.blacklist.length ? t('Записей в чёрном списке: {n}', { n: c.blacklist.length }) : t('В чёрном списке не значится')}</div>
          </div>

          {c.blacklist.length > 0 && (
            <div className="card stack-s danger-card">
              <b><Ban size={16} /> {t('Чёрный список')}</b>
              {c.blacklist.map((b, i) => (
                <div key={i} className="review"><b>{b.reason}</b>{b.review && <p>{b.review}</p>}<span className="muted small">{b.author} · {fmtDate(b.createdAt)}</span></div>
              ))}
            </div>
          )}

          <div className="card stack-s">
            <b>{t('Контакты')}</b>
            {c.contacts.map((u) => (
              <div key={u.phone} className="stack-s">
                <div>{u.name} <span className="muted small">· {t(ROLE_L[u.role])}</span></div>
                {!c.mine && <div className="row wrap"><ContactButtons phone={u.phone} /></div>}
              </div>
            ))}
          </div>
          {!c.mine && <button className="btn ghost danger" onClick={() => setBl({ reason: '', review: '' })}><Ban size={16} /> {t('Добавить в чёрный список')}</button>}
        </aside>
      </div>

      {bl && (
        <Modal title={t('Добавить в чёрный список')} onClose={() => setBl(null)}>
          <p className="muted small">{t('Запись увидят все участники вместе с названием вашей компании. Указывайте только то, что можете подтвердить.')}</p>
          <Field label={t('Причина')}><input autoFocus value={bl.reason} onChange={(e) => setBl({ ...bl, reason: e.target.value })} maxLength={200} placeholder={t('Например: невозврат предоплаты')} /></Field>
          <Field label={t('Отзыв')}><textarea rows={4} value={bl.review} onChange={(e) => setBl({ ...bl, review: e.target.value })} maxLength={1000} placeholder={t('Что произошло, когда, чем закончилось')} /></Field>
          <div className="row end">
            <button className="btn ghost" onClick={() => setBl(null)}>{t('Отмена')}</button>
            <button className="btn danger" disabled={bl.reason.trim().length < 3} onClick={async () => {
              if (await act(() => api('/blacklist', 'POST', { companyId: c.id, ...bl }), t('Компания добавлена в чёрный список'))) {
                setBl(null);
                reload();
              }
            }}>{t('Добавить')}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
