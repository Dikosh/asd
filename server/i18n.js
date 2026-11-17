// Тексты уведомлений на трёх языках. В базе хранится русский шаблон и подстановки —
// приложение переводит их само, а для push на телефон текст собирается здесь на языке пользователя.
import { cityById } from './geo.js';

const T = {
  'Новый отклик: {route}': ['Жаңа өтінім: {route}', 'New response: {route}'],
  'Отклик отклонён: {route}': ['Өтінім қабылданбады: {route}', 'Response declined: {route}'],
  'Отклик принят — рейс создан: {route}': ['Өтінім қабылданды — рейс құрылды: {route}', 'Response accepted — trip created: {route}'],
  'Машина едет на погрузку: {route}': ['Көлік тиеуге бара жатыр: {route}', 'Truck heading to loading: {route}'],
  'Идёт погрузка: {route}': ['Тиеу жүріп жатыр: {route}', 'Loading in progress: {route}'],
  'Груз в пути: {route}': ['Жүк жолда: {route}', 'Load in transit: {route}'],
  'Идёт выгрузка: {route}': ['Түсіру жүріп жатыр: {route}', 'Unloading in progress: {route}'],
  'Груз доставлен: {route}': ['Жүк жеткізілді: {route}', 'Load delivered: {route}'],
  'Проверьте груз и подтвердите доставку': ['Жүкті тексеріп, жеткізуді растаңыз', 'Check the load and confirm delivery'],
  'Доставка подтверждена: {route}': ['Жеткізу расталды: {route}', 'Delivery confirmed: {route}'],
  'Оставьте отзыв о заказчике': ['Тапсырыс беруші туралы пікір қалдырыңыз', 'Leave a review of the shipper'],
  'Рейс отменён: {route}': ['Рейстен бас тартылды: {route}', 'Trip cancelled: {route}'],
  'Новый отзыв о вашей компании: {n} из 5': ['Компанияңыз туралы жаңа пікір: 5-тен {n}', 'New review of your company: {n} out of 5'],
  'Новый груз: {route}': ['Жаңа жүк: {route}', 'New load: {route}'],
  'Новая машина: {route}': ['Жаңа көлік: {route}', 'New truck: {route}'],
  'По вашему поиску «{name}»': ['«{name}» іздеуіңіз бойынша', 'Matches your search “{name}”'],
  'Документ отклонён модератором': ['Модератор құжатты қабылдамады', 'Document rejected by a moderator'],
  'Блокировка компании снята': ['Компанияның бұғаты алынды', 'Company block lifted'],
  'Вы снова можете размещать объявления и откликаться.': ['Қайтадан хабарландыру орналастырып, өтінім жібере аласыз.', 'You can post listings and respond again.'],
  'Поддержка ответила на ваше обращение': ['Қолдау қызметі өтінішіңізге жауап берді', 'Support replied to your request'],
  'Ваше обращение закрыто': ['Өтінішіңіз жабылды', 'Your request was closed'],
  'Компания проверена': ['Компания тексерілді', 'Company verified'],
  'В объявлениях появилась отметка «Проверена».': ['Хабарландыруларда «Тексерілген» белгісі пайда болды.', 'Your listings now carry the “Verified” badge.'],
  'Проверка компании не пройдена': ['Компания тексеруден өтпеді', 'Company verification failed'],
  'Проверьте БИН и документы и отправьте заявку заново.': ['БСН мен құжаттарды тексеріп, өтінішті қайта жіберіңіз.', 'Check the BIN and documents and submit the request again.'],
  'Новая жалоба': ['Жаңа шағым', 'New report'],
  'Новое обращение в поддержку': ['Қолдау қызметіне жаңа өтініш', 'New support request'],
  'Объявление №{n} снято модератором': ['№{n} хабарландыруды модератор алып тастады', 'Listing No. {n} taken down by a moderator'],
  'Причина: жалоба пользователей. Если это ошибка, напишите в поддержку.': ['Себебі: пайдаланушылардың шағымы. Қате болса, қолдау қызметіне жазыңыз.', 'Reason: user reports. If this is a mistake, contact support.'],
  'Уведомления включены': ['Ескертулер қосылды', 'Notifications are on'],
  'Так будут приходить новые отклики и подходящие грузы.': ['Жаңа өтінімдер мен сәйкес жүктер осылай келеді.', 'This is how new responses and matching loads will arrive.'],
  'Вас пригласили в компанию «{name}»': ['Сізді «{name}» компаниясына шақырды', 'You were invited to “{name}”'],
  'Откройте «Команда», чтобы принять или отклонить приглашение': ['Шақыруды қабылдау немесе одан бас тарту үшін «Команда» бөлімін ашыңыз', 'Open “Team” to accept or decline the invitation'],
  'Рейс завершён автоматически: {route}': ['Рейс автоматты түрде аяқталды: {route}', 'Trip completed automatically: {route}'],
  'Оставьте отзыв о партнёре': ['Серіктес туралы пікір қалдырыңыз', 'Leave a review of your counterparty'],
  'Рейс закрыт как сорванный: {route}': ['Рейс үзілген деп жабылды: {route}', 'Trip closed as failed: {route}'],
  'Сорванный рейс №{n}': ['Үзілген рейс №{n}', 'Failed trip No. {n}'],
  'О вашей компании оставили отзыв': ['Компанияңыз туралы пікір қалдырылды', 'Your company received a review'],
  'Он станет виден, когда вы оставите свой отзыв по этому рейсу, или через 7 дней': ['Ол осы рейс бойынша өз пікіріңізді қалдырғанда немесе 7 күннен кейін көрінеді', 'It becomes visible once you leave your own review for this trip, or after 7 days'],
  'О вашей компании появилась запись в чёрном списке': ['Компанияңыз туралы қара тізімде жазба пайда болды', 'Your company was added to the blacklist'],
  'Вы можете ответить на неё на странице своей компании': ['Оған өз компанияңыздың бетінде жауап бере аласыз', 'You can reply to it on your company page'],
  'Компания заблокирована модератором': ['Компанияны модератор бұғаттады', 'Company blocked by a moderator'],
  'Подтвердите рейс: {route}': ['Рейсті растаңыз: {route}', 'Confirm the trip: {route}'],
  'Укажите машину и водителя': ['Көлік пен жүргізушіні көрсетіңіз', 'Specify the truck and the driver'],
  'Перевозчик подтвердил рейс: {route}': ['Тасымалдаушы рейсті растады: {route}', 'The carrier confirmed the trip: {route}'],
  'Перевозчик заменил машину или водителя: {route}': ['Тасымалдаушы көлікті немесе жүргізушіні ауыстырды: {route}', 'The carrier changed the truck or driver: {route}'],
  'Новый документ в рейсе: {route}': ['Рейсте жаңа құжат: {route}', 'New document in the trip: {route}'],
  'Вас назначили на рейс: {route}': ['Сізді рейске тағайындады: {route}', 'You were assigned to a trip: {route}'],
};
export const TEMPLATES = Object.keys(T);

/** Текст на языке пользователя; {route} собирается из названий городов. Неизвестная строка (текст человека) возвращается как есть. */
export function render(text, vars = {}, lang = 'ru') {
  const idx = lang === 'kz' ? 0 : lang === 'en' ? 1 : -1;
  // текст может быть написан человеком — ищем только среди собственных шаблонов
  let out = idx >= 0 && Object.hasOwn(T, text) ? T[text][idx] : String(text ?? '');
  const name = (id) => {
    const c = cityById.get(id);
    return c ? (lang === 'kz' ? c.kz : lang === 'en' ? c.en : c.ru) : '—';
  };
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, k === 'route' && Array.isArray(v) ? v.map(name).join(' → ') : String(v));
  return out;
}
