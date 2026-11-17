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
};
export const TEMPLATES = Object.keys(T);

/** Текст на языке пользователя; {route} собирается из названий городов. Неизвестная строка (текст человека) возвращается как есть. */
export function render(text, vars = {}, lang = 'ru') {
  const idx = lang === 'kz' ? 0 : lang === 'en' ? 1 : -1;
  let out = idx >= 0 && T[text] ? T[text][idx] : text;
  const name = (id) => {
    const c = cityById.get(id);
    return c ? (lang === 'kz' ? c.kz : lang === 'en' ? c.en : c.ru) : '—';
  };
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, k === 'route' && Array.isArray(v) ? v.map(name).join(' → ') : String(v));
  return out;
}
