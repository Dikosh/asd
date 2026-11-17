// Главная: информация о платформе, активный рейс и рекомендации по роли.
import { Link } from 'react-router-dom';
import { ArrowRight, BadgeCheck, Briefcase, Package, Plus, ShieldAlert, Truck } from 'lucide-react';
import { api, Listing, num, ROLE_L, t, Trip, useApp, useEvent, useLoad } from '../core';
import { Empty, Loading } from '../ui';
import { ListingCard } from '../listing';
import { TripSummary } from './TripPage';

export default function HomePage() {
  const { me, meta } = useApp();
  const trips = useLoad(() => api<Trip[]>('/trips'));
  const rec = useLoad(() => api<{ kind: 'cargo' | 'truck'; items: (Listing & { matchFor?: number })[] }[]>('/recommendations'));
  useEvent('trip position', () => { trips.reload(); });
  const active = trips.data?.find((x) => x.status === 'active');
  const role = me!.user.role;
  const c = me!.company;

  return (
    <div className="stack">
      <section className="hero">
        <div>
          <div className="muted-on-blue">{t(ROLE_L[role])} · {c.form} «{c.name}»</div>
          <h1>{t('Здравствуйте, {name}!', { name: me!.user.name.split(' ')[0] })}</h1>
          <p>{t('Jolda — биржа грузов и транспорта: заказчики и перевозчики договариваются напрямую, а рейс виден на карте.')}</p>
          <div className="row wrap">
            <Link to="/my/cargo/new" className="btn white"><Plus size={17} /> {t('Разместить груз')}</Link>
            <Link to="/my/truck/new" className="btn white-ghost"><Plus size={17} /> {t('Разместить транспорт')}</Link>
          </div>
        </div>
        <div className="hero-stats">
          <div><Package size={18} /><b>{num(meta.stats.cargo)}</b><span>{t('грузов сейчас')}</span></div>
          <div><Truck size={18} /><b>{num(meta.stats.truck)}</b><span>{t('машин свободно')}</span></div>
          <div><BadgeCheck size={18} /><b>{num(meta.stats.companies)}</b><span>{t('компаний')}</span></div>
          <div><ArrowRight size={18} /><b>{num(meta.stats.trips)}</b><span>{t('рейсов завершено')}</span></div>
        </div>
      </section>

      {c.verified !== 'verified' && (
        <Link to="/cabinet/profile" className="banner warn">
          <ShieldAlert size={20} />
          <div>
            <b>{c.verified === 'pending' ? t('Проверка компании идёт') : t('Подтвердите компанию')}</b>
            <span>{c.verified === 'pending' ? t('Модератор проверяет документы. Обычно это занимает до одного рабочего дня.') : t('Проверенным компаниям откликаются охотнее: укажите БИН и загрузите документы.')}</span>
          </div>
          <ArrowRight size={18} />
        </Link>
      )}

      <section>
        <div className="section-head">
          <h2>{t('Активный рейс')}</h2>
          <Link to="/cabinet/trips">{t('Все рейсы')} <ArrowRight size={15} /></Link>
        </div>
        {trips.loading ? <Loading /> : active ? (
          <TripSummary trip={active} />
        ) : (
          <div className="card">
            <Empty icon={<Truck size={26} />} title={t('Активных рейсов нет')} text={t('Рейс появится, когда отклик будет принят. Вся история — во вкладке «Рейсы».')}>
              <Link to="/cabinet/trips" className="btn soft">{t('Открыть рейсы')}</Link>
            </Empty>
          </div>
        )}
      </section>

      {role === 'driver' && (
        <Link to="/jobs" className="banner">
          <Briefcase size={20} />
          <div><b>{t('Работа для водителей')}</b><span>{t('Вакансии перевозчиков и ваше резюме — во вкладке «Работа».')}</span></div>
          <ArrowRight size={18} />
        </Link>
      )}

      {rec.loading && <Loading />}
      {rec.data?.map((group) => (
        <section key={group.kind}>
          <div className="section-head">
            <h2>{group.kind === 'cargo' ? t('Рекомендуемые грузы') : t('Рекомендуемый транспорт')}</h2>
            <Link to={`/search/${group.kind}`}>{t('Весь поиск')} <ArrowRight size={15} /></Link>
          </div>
          {group.items.some((i) => i.match) && <p className="muted small">{t('Сначала показаны объявления, подобранные под ваши активные объявления по маршруту, датам и вместимости.')}</p>}
          <div className="list">
            {group.items.map((l) => <ListingCard key={l.id} l={l} onChange={rec.reload} />)}
            {group.items.length === 0 && <div className="card"><Empty title={t('Пока нет подходящих объявлений')} /></div>}
          </div>
        </section>
      ))}
    </div>
  );
}
