// Тексты уведомлений на четырёх языках (ru, kz, en, zh). В базе хранится русский шаблон и подстановки —
// приложение переводит их само, а для push на телефон текст собирается здесь на языке пользователя.
import { cityById } from './geo.js';

const T = {
  'Новый отклик: {route}': ['Жаңа өтінім: {route}', 'New response: {route}', '新报价：{route}'],
  'Отклик отклонён: {route}': ['Өтінім қабылданбады: {route}', 'Response declined: {route}', '报价被拒绝：{route}'],
  'Отклик принят — рейс создан: {route}': ['Өтінім қабылданды — рейс құрылды: {route}', 'Response accepted — trip created: {route}', '报价已接受——行程已创建：{route}'],
  'Машина едет на погрузку: {route}': ['Көлік тиеуге бара жатыр: {route}', 'Truck heading to loading: {route}', '车辆前往装货地：{route}'],
  'Идёт погрузка: {route}': ['Тиеу жүріп жатыр: {route}', 'Loading in progress: {route}', '正在装货：{route}'],
  'Груз в пути: {route}': ['Жүк жолда: {route}', 'Load in transit: {route}', '货物在途：{route}'],
  'Идёт выгрузка: {route}': ['Түсіру жүріп жатыр: {route}', 'Unloading in progress: {route}', '正在卸货：{route}'],
  'Груз доставлен: {route}': ['Жүк жеткізілді: {route}', 'Load delivered: {route}', '货物已送达：{route}'],
  'Проверьте груз и подтвердите доставку': ['Жүкті тексеріп, жеткізуді растаңыз', 'Check the load and confirm delivery', '请检查货物并确认送达'],
  'Доставка подтверждена: {route}': ['Жеткізу расталды: {route}', 'Delivery confirmed: {route}', '已确认送达：{route}'],
  'Оставьте отзыв о заказчике': ['Тапсырыс беруші туралы пікір қалдырыңыз', 'Leave a review of the shipper', '请评价货主'],
  'Рейс отменён: {route}': ['Рейстен бас тартылды: {route}', 'Trip cancelled: {route}', '行程已取消：{route}'],
  'Новый отзыв о вашей компании: {n} из 5': ['Компанияңыз туралы жаңа пікір: 5-тен {n}', 'New review of your company: {n} out of 5', '您的公司收到新评价：{n}/5'],
  'Новый груз: {route}': ['Жаңа жүк: {route}', 'New load: {route}', '新货源：{route}'],
  'Новая машина: {route}': ['Жаңа көлік: {route}', 'New truck: {route}', '新车源：{route}'],
  'По вашему поиску «{name}»': ['«{name}» іздеуіңіз бойынша', 'Matches your search “{name}”', '符合您的搜索“{name}”'],
  'Документ отклонён модератором': ['Модератор құжатты қабылдамады', 'Document rejected by a moderator', '文件被审核员驳回'],
  'Блокировка компании снята': ['Компанияның бұғаты алынды', 'Company block lifted', '公司封禁已解除'],
  'Вы снова можете размещать объявления и откликаться.': ['Қайтадан хабарландыру орналастырып, өтінім жібере аласыз.', 'You can post listings and respond again.', '您可以再次发布信息和报价。'],
  'Поддержка ответила на ваше обращение': ['Қолдау қызметі өтінішіңізге жауап берді', 'Support replied to your request', '客服已回复您的工单'],
  'Ваше обращение закрыто': ['Өтінішіңіз жабылды', 'Your request was closed', '您的工单已关闭'],
  'Компания проверена': ['Компания тексерілді', 'Company verified', '公司已认证'],
  'В объявлениях появилась отметка «Проверена».': ['Хабарландыруларда «Тексерілген» белгісі пайда болды.', 'Your listings now carry the “Verified” badge.', '您的信息现已带有“已认证”标识。'],
  'Проверка компании не пройдена': ['Компания тексеруден өтпеді', 'Company verification failed', '公司认证未通过'],
  'Проверьте БИН и документы и отправьте заявку заново.': ['БСН мен құжаттарды тексеріп, өтінішті қайта жіберіңіз.', 'Check the BIN and documents and submit the request again.', '请检查BIN和文件后重新提交申请。'],
  'Новая жалоба': ['Жаңа шағым', 'New report', '新举报'],
  'Новое обращение в поддержку': ['Қолдау қызметіне жаңа өтініш', 'New support request', '新的客服工单'],
  'Объявление №{n} снято модератором': ['№{n} хабарландыруды модератор алып тастады', 'Listing No. {n} taken down by a moderator', '信息 №{n} 已被审核员下架'],
  'Причина: жалоба пользователей. Если это ошибка, напишите в поддержку.': ['Себебі: пайдаланушылардың шағымы. Қате болса, қолдау қызметіне жазыңыз.', 'Reason: user reports. If this is a mistake, contact support.', '原因：用户举报。如有误，请联系客服。'],
  'Уведомления включены': ['Ескертулер қосылды', 'Notifications are on', '通知已开启'],
  'Так будут приходить новые отклики и подходящие грузы.': ['Жаңа өтінімдер мен сәйкес жүктер осылай келеді.', 'This is how new responses and matching loads will arrive.', '新报价和匹配货源将以这种方式通知您。'],
  'Вас пригласили в компанию «{name}»': ['Сізді «{name}» компаниясына шақырды', 'You were invited to “{name}”', '您受邀加入“{name}”公司'],
  'Откройте «Команда», чтобы принять или отклонить приглашение': ['Шақыруды қабылдау немесе одан бас тарту үшін «Команда» бөлімін ашыңыз', 'Open “Team” to accept or decline the invitation', '打开“团队”以接受或拒绝邀请'],
  'Рейс завершён автоматически: {route}': ['Рейс автоматты түрде аяқталды: {route}', 'Trip completed automatically: {route}', '行程已自动完成：{route}'],
  'Оставьте отзыв о партнёре': ['Серіктес туралы пікір қалдырыңыз', 'Leave a review of your counterparty', '请评价合作方'],
  'Рейс закрыт как сорванный: {route}': ['Рейс үзілген деп жабылды: {route}', 'Trip closed as failed: {route}', '行程已作为失败关闭：{route}'],
  'Сорванный рейс №{n}': ['Үзілген рейс №{n}', 'Failed trip No. {n}', '失败行程 №{n}'],
  'О вашей компании оставили отзыв': ['Компанияңыз туралы пікір қалдырылды', 'Your company received a review', '您的公司收到一条评价'],
  'Он станет виден, когда вы оставите свой отзыв по этому рейсу, или через 7 дней': ['Ол осы рейс бойынша өз пікіріңізді қалдырғанда немесе 7 күннен кейін көрінеді', 'It becomes visible once you leave your own review for this trip, or after 7 days', '您对该行程留下评价后或 7 天后可见'],
  'О вашей компании появилась запись в чёрном списке': ['Компанияңыз туралы қара тізімде жазба пайда болды', 'Your company was added to the blacklist', '您的公司被加入黑名单'],
  'Вы можете ответить на неё на странице своей компании': ['Оған өз компанияңыздың бетінде жауап бере аласыз', 'You can reply to it on your company page', '您可以在公司页面上回复'],
  'Компания заблокирована модератором': ['Компанияны модератор бұғаттады', 'Company blocked by a moderator', '公司已被审核员封禁'],
  'Подтвердите рейс: {route}': ['Рейсті растаңыз: {route}', 'Confirm the trip: {route}', '请确认行程：{route}'],
  'Укажите машину и водителя': ['Көлік пен жүргізушіні көрсетіңіз', 'Specify the truck and the driver', '请指定车辆和司机'],
  'Перевозчик подтвердил рейс: {route}': ['Тасымалдаушы рейсті растады: {route}', 'The carrier confirmed the trip: {route}', '承运商已确认行程：{route}'],
  'Перевозчик заменил машину или водителя: {route}': ['Тасымалдаушы көлікті немесе жүргізушіні ауыстырды: {route}', 'The carrier changed the truck or driver: {route}', '承运商已更换车辆或司机：{route}'],
  'Новый документ в рейсе: {route}': ['Рейсте жаңа құжат: {route}', 'New document in the trip: {route}', '行程中有新文件：{route}'],
  'Новая заявка на перегон: {route}': ['Айдауға жаңа өтінім: {route}', 'New vehicle relocation request: {route}', '新的代驾转运需求：{route}'],
  'Подходит под ваши права и город': ['Куәлігіңізге және қалаңызға сай келеді', 'Matches your licence and city', '符合您的驾照类别和所在城市'],
  'Перегонщик едет к машине: {route}': ['Айдаушы көлікке бара жатыр: {route}', 'The driver is heading to the vehicle: {route}', '转运司机正前往车辆所在地：{route}'],
  'Перегонщик принимает машину: {route}': ['Айдаушы көлікті қабылдап жатыр: {route}', 'The driver is taking over the vehicle: {route}', '转运司机正在接车：{route}'],
  'Машина в пути: {route}': ['Көлік жолда: {route}', 'Vehicle on the way: {route}', '车辆在途：{route}'],
  'Перегонщик сдаёт машину: {route}': ['Айдаушы көлікті тапсырып жатыр: {route}', 'The driver is handing over the vehicle: {route}', '转运司机正在交车：{route}'],
  'Машина доставлена: {route}': ['Көлік жеткізілді: {route}', 'Vehicle delivered: {route}', '车辆已送达：{route}'],
  'Проверьте машину и подтвердите приёмку': ['Көлікті тексеріп, қабылдауды растаңыз', 'Check the vehicle and confirm receipt', '请检查车辆并确认接收'],
  'Вас назначили на рейс: {route}': ['Сізді рейске тағайындады: {route}', 'You were assigned to a trip: {route}', '您已被指派到行程：{route}'],
};
export const TEMPLATES = Object.keys(T);

/** Текст на языке пользователя; {route} собирается из названий городов. Неизвестная строка (текст человека) возвращается как есть. */
export function render(text, vars = {}, lang = 'ru') {
  const idx = { kz: 0, en: 1, zh: 2 }[lang] ?? -1;
  // текст может быть написан человеком — ищем только среди собственных шаблонов
  let out = idx >= 0 && Object.hasOwn(T, text) ? T[text][idx] : String(text ?? '');
  const name = (id) => {
    const c = cityById.get(id);
    return c ? (lang === 'kz' ? c.kz : lang === 'en' ? c.en : lang === 'zh' ? c.zh : c.ru) : '—';
  };
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, k === 'route' && Array.isArray(v) ? v.map(name).join(' → ') : String(v));
  return out;
}
