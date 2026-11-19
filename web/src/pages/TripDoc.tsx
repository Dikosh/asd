// Заявка на перевозку по рейсу — страница для печати или сохранения в PDF.
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { api, companyTitle, BODY_L, CARGO_L, LOADING_L, money, num, PAY_L, t, Trip, useApp, useLoad } from '../core';
import { Empty, Loading } from '../ui';

const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('ru-RU') : '—');

export default function TripDoc() {
  const id = Number(useParams().id);
  const { cityName } = useApp();
  const { data: trip, loading } = useLoad(() => api<Trip>(`/trips/${id}`), [id]);
  if (loading) return <Loading />;
  if (!trip) return <div className="card"><Empty title={t('Рейс не найден')} /></div>;
  const party = (title: string, p: Trip['carrier'] | Trip['customer']) => (
    <td>
      <b>{title}</b>
      <div>{companyTitle(p)}</div>
      <div>{t('БИН / ИИН')}: {p.bin || '________________'}</div>
      <div>{t('Контактное лицо')}: {p.userName}</div>
      <div>{t('Телефон')}: {p.phone}</div>
    </td>
  );
  const row = (label: string, value: React.ReactNode) => (<tr><th>{label}</th><td>{value || '—'}</td></tr>);
  const blank = '________________';
  const v = trip.vehicle;
  return (
    <div className="stack">
      <div className="row between wrap no-print">
        <Link to={`/trip/${trip.id}`} className="link back"><ArrowLeft size={16} /> {t('К рейсу')}</Link>
        <button className="btn primary" onClick={() => window.print()}><Printer size={16} /> {t('Печать или PDF')}</button>
      </div>
      <article className="doc">
        <header>
          <h1>{t('Заявка на перевозку груза')} № {trip.id}</h1>
          <span>{t('от')} {day(trip.createdAt)}</span>
        </header>
        <table className="doc-parties"><tbody><tr>{party(t('Заказчик'), trip.customer)}{party(t('Перевозчик'), trip.carrier)}</tr></tbody></table>
        <table className="doc-table">
          <tbody>
            {row(t('Маршрут'), trip.points.map(cityName).join(' → '))}
            {row(t('Адрес погрузки'), trip.loadAddress)}
            {row(t('Адрес выгрузки'), trip.unloadAddress)}
            {trip.loadTime && row(t('Время погрузки'), trip.loadTime)}
            {row(t('Расстояние'), `${num(trip.distanceKm)} ${t('км')}`)}
            {row(t('Период перевозки'), `${day(trip.dateFrom)} — ${day(trip.dateTo)}`)}
            {row(t('Груз'), [trip.cargoType && t(CARGO_L[trip.cargoType]), trip.weight && `${trip.weight} ${t('т')}`, trip.volume && `${trip.volume} ${t('м³')}`].filter(Boolean).join(', '))}
            {row(t('Транспорт'), [trip.confirmed ? v.brand : trip.brand, trip.bodyType && t(BODY_L[trip.bodyType])].filter(Boolean).join(', '))}
            {row(t('Госномер'), trip.confirmed ? [v.plate, v.trailerPlate && `${t('прицеп')} ${v.trailerPlate}`].filter(Boolean).join(', ') : blank)}
            {row(t('Способ погрузки'), trip.loading?.map((x) => t(LOADING_L[x])).join(', '))}
            {row(t('Стоимость перевозки'), <b>{money(trip.price ?? null, trip.currency)}</b>)}
            {row(t('Условия оплаты'), trip.payTerms?.map((x) => t(PAY_L[x])).join(', '))}
            {/* водитель — тот, кого назначил перевозчик; до подтверждения строка остаётся для заполнения от руки */}
            {row(t('Водитель'), trip.confirmed && trip.driver?.name ? `${trip.driver.name}, ${trip.driver.phone}` : blank)}
            {row(t('Особые условия'), trip.description)}
          </tbody>
        </table>
        <p className="doc-note">
          {t('Перевозчик обязуется подать исправный транспорт под погрузку в согласованный срок и доставить груз получателю. Заказчик обязуется предъявить груз к перевозке и оплатить услуги на указанных условиях. Во время рейса перевозчик передаёт местоположение машины через платформу Timma.')}
        </p>
        <table className="doc-sign"><tbody><tr>
          <td><b>{t('Заказчик')}</b><div className="sign-line" /><span>{t('подпись, фамилия, печать при наличии')}</span></td>
          <td><b>{t('Перевозчик')}</b><div className="sign-line" /><span>{t('подпись, фамилия, печать при наличии')}</span></td>
        </tr></tbody></table>
        <footer>{t('Сформировано на платформе Timma. Рейс №{n}.', { n: trip.id })}</footer>
      </article>
    </div>
  );
}
