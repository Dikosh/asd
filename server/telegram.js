// Коды входа через бота в Telegram — бесплатная замена SMS.
//
// Бот не может написать человеку первым по номеру телефона. Поэтому человек один раз открывает бота и нажимает
// «Поделиться номером»: Telegram сам подтверждает, что номер принадлежит этому аккаунту. Связка «номер → чат»
// сохраняется (tg_links), и дальше коды приходят в этот чат без лишних нажатий.
//
// Подключение: создать бота у @BotFather и указать TELEGRAM_BOT_TOKEN в /etc/jolda.env. Сообщения бот получает
// длинным опросом (getUpdates) — домен и HTTPS для этого не нужны. Один бот — один сервер: два сервера с одним
// токеном будут перехватывать сообщения друг у друга.
import { q1, run } from './db.js';
import { normPhone } from './lib.js';

/** Настройки: адрес API подменяется в тестах, имя бота узнаётся у Telegram при запуске. */
export const tg = {
  api: (process.env.TELEGRAM_API || 'https://api.telegram.org').replace(/\/+$/, ''), // свой адрес — только для проверки без Telegram
  token: (process.env.TELEGRAM_BOT_TOKEN || '').trim(),
  name: (process.env.TELEGRAM_BOT_NAME || '').trim().replace(/^@/, ''),
};
/** Имя бота, если вход через Telegram включён; иначе пустая строка. */
export const tgBot = () => (tg.token && tg.name ? tg.name : '');

export const CODE_TTL = 5 * 60_000; // сколько живёт код после отправки
const PENDING_TTL = 15 * 60_000; // сколько ждём, пока человек откроет бота и поделится номером

// Тексты бота: ru, kz, en, zh. Язык — тот, что выбран в Telegram у человека.
const T = {
  ask: [
    'Чтобы получать коды входа в Ovi, нажмите кнопку «Поделиться номером» внизу экрана.',
    'Ovi-ге кіру кодтарын алу үшін экранның төменгі жағындағы «Нөмірмен бөлісу» түймесін басыңыз.',
    'To receive Ovi sign-in codes, tap “Share my number” at the bottom of the screen.',
    '要接收 Ovi 登录验证码，请点击屏幕下方的“分享我的号码”。',
  ],
  button: ['Поделиться номером', 'Нөмірмен бөлісу', 'Share my number', '分享我的号码'],
  code: [
    'Код входа в Ovi: <code>{code}</code>\nНажмите на код, чтобы скопировать, и введите его в Ovi. Никому его не сообщайте.',
    'Ovi-ге кіру коды: <code>{code}</code>\nКөшіру үшін кодты басыңыз да, оны Ovi-ге енгізіңіз. Оны ешкімге айтпаңыз.',
    'Your Ovi sign-in code: <code>{code}</code>\nTap the code to copy it, then enter it in Ovi. Do not share it with anyone.',
    'Ovi 登录验证码：<code>{code}</code>\n点击验证码即可复制，然后在 Ovi 中输入。请勿告诉任何人。',
  ],
  // описание бота: его видит человек, который открыл бота впервые, ещё до первой кнопки
  about: [
    'Бот присылает коды для входа в Ovi — биржу грузов и транспорта.\n\nЗапустите бота и нажмите «Поделиться номером» — код придёт в этот чат.',
    'Бот Ovi — жүк және көлік биржасына кіру кодтарын жібереді.\n\nБотты іске қосып, «Нөмірмен бөлісу» түймесін басыңыз — код осы чатқа келеді.',
    'This bot sends sign-in codes for Ovi, the freight and transport exchange.\n\nStart the bot and tap “Share my number” — the code will arrive in this chat.',
    '此机器人发送 Ovi 货运与运力交易平台的登录验证码。\n\n启动机器人并点击“分享我的号码”，验证码将发送到此聊天。',
  ],
  short: ['Коды входа в Ovi', 'Ovi-ге кіру кодтары', 'Ovi sign-in codes', 'Ovi 登录验证码'],
  linked: [
    'Готово. Вернитесь в Ovi и запросите код — он придёт в этот чат.',
    'Дайын. Ovi-ге оралып, код сұраңыз — ол осы чатқа келеді.',
    'Done. Go back to Ovi and request a code — it will arrive in this chat.',
    '完成。请返回 Ovi 获取验证码，验证码将发送到此聊天。',
  ],
  ready: [
    'Этот Telegram уже привязан к номеру {phone}. Запросите код в Ovi — он придёт сюда.',
    'Бұл Telegram {phone} нөміріне байланған. Ovi-де код сұраңыз — ол осында келеді.',
    'This Telegram is already linked to {phone}. Request a code in Ovi — it will arrive here.',
    '此 Telegram 已绑定号码 {phone}。请在 Ovi 获取验证码，验证码将发送到这里。',
  ],
  mismatch: [
    'Номер этого Telegram ({phone}) не совпадает с номером, который вы ввели в Ovi. Введите в Ovi номер {phone} и запросите код заново.',
    'Бұл Telegram нөмірі ({phone}) Ovi-ге енгізген нөміріңізге сәйкес келмейді. Ovi-ге {phone} нөмірін енгізіп, кодты қайта сұраңыз.',
    'The number of this Telegram ({phone}) does not match the number you entered in Ovi. Enter {phone} in Ovi and request a code again.',
    '此 Telegram 的号码（{phone}）与您在 Ovi 输入的号码不一致。请在 Ovi 输入 {phone} 并重新获取验证码。',
  ],
  notOwn: [
    'Нужен номер этого аккаунта Telegram. Нажмите кнопку «Поделиться номером» — чужой контакт не подойдёт.',
    'Осы Telegram аккаунтының нөмірі керек. «Нөмірмен бөлісу» түймесін басыңыз — бөтен контакт жарамайды.',
    'We need the number of this Telegram account. Tap “Share my number” — someone else’s contact will not work.',
    '需要此 Telegram 账号自己的号码。请点击“分享我的号码”，他人的联系人无效。',
  ],
  expired: [
    'Запрос кода устарел. Вернитесь в Ovi и запросите код заново.',
    'Код сұрауы ескірді. Ovi-ге оралып, кодты қайта сұраңыз.',
    'The code request has expired. Go back to Ovi and request a new code.',
    '验证码请求已过期。请返回 Ovi 重新获取。',
  ],
};
const LANGS = ['ru', 'kz', 'en', 'zh'];
/** Язык из настроек Telegram: kk → kz, zh-hans → zh; незнакомый — русский. */
export const tgLang = (code) => {
  const c = String(code || '').toLowerCase().slice(0, 2);
  return c === 'kk' ? 'kz' : LANGS.includes(c) ? c : 'ru';
};
const text = (key, lang, vars = {}) => {
  let out = T[key][Math.max(0, LANGS.indexOf(lang))];
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
};

/** Вызов Bot API. Возвращает { ok, result, error_code, description }; сетевой сбой — { ok: false, error_code: 0 }. */
export async function tgCall(method, body = {}, timeout = 8000) {
  try {
    const res = await fetch(`${tg.api}/bot${tg.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error_code: 0, description: e.message };
  }
}
const say = (chatId, message, extra = {}) => tgCall('sendMessage', { chat_id: chatId, text: message, ...extra });
const hideKeyboard = { reply_markup: { remove_keyboard: true } };
const contactKeyboard = (lang) => ({
  reply_markup: { keyboard: [[{ text: text('button', lang), request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
});

/** Чат Telegram, привязанный к номеру. */
export const tgLink = (phone) => q1('SELECT phone, chat_id AS chatId, lang FROM tg_links WHERE phone = ?', phone);

/**
 * Отправить код в привязанный чат. 'ok' — ушло; 'gone' — человек удалил или заблокировал бота (связка снята,
 * номер нужно привязать заново); 'error' — Telegram недоступен.
 */
export async function tgSendCode(link, code) {
  // <code> — в Telegram такой текст копируется одним нажатием
  const r = await say(link.chatId, text('code', link.lang, { code }), { ...hideKeyboard, parse_mode: 'HTML' });
  if (r.ok) return 'ok';
  if (r.error_code === 403 || (r.error_code === 400 && /chat not found/i.test(r.description || ''))) {
    run('DELETE FROM tg_links WHERE phone = ?', link.phone);
    return 'gone';
  }
  console.error(`[telegram] sendMessage: ${r.error_code} ${r.description || ''}`.trim());
  return 'error';
}

// Между «Начать» и «Поделиться номером»: какой запрос кода привёл человека в бота.
const pending = new Map(); // чат → { start, at }

/** Отдать код по ожидающему запросу: по метке из ссылки, а без неё — по последнему запросу этого номера. */
async function deliver(link, start) {
  const fresh = Date.now() - PENDING_TTL;
  const row = start
    ? q1('SELECT ticket, phone, code, created_at FROM login_codes WHERE tg_start = ?', start)
    : q1(`SELECT ticket, phone, code, created_at FROM login_codes WHERE phone = ? AND channel = 'tg' AND tg_start IS NOT NULL ORDER BY created_at DESC LIMIT 1`, link.phone);
  if (!row) return start ? say(link.chatId, text('expired', link.lang), hideKeyboard) : say(link.chatId, text('linked', link.lang), hideKeyboard);
  if (Date.parse(row.created_at) < fresh) return say(link.chatId, text('expired', link.lang), hideKeyboard);
  if (row.phone !== link.phone) return say(link.chatId, text('mismatch', link.lang, { phone: link.phone }), hideKeyboard);
  // метка одноразовая; срок кода отсчитывается от отправки, а не от запроса
  run('UPDATE login_codes SET tg_start = NULL, expires = ? WHERE ticket = ?', Date.now() + CODE_TTL, row.ticket);
  return tgSendCode(link, row.code);
}

/** Одно сообщение боту. Отдельно экспортируется для тестов. */
export async function handleUpdate(update) {
  const m = update?.message;
  if (!m || m.chat?.type !== 'private' || !m.from) return;
  const chatId = m.chat.id;
  const lang = tgLang(m.from.language_code);
  const linked = q1('SELECT phone, chat_id AS chatId, lang FROM tg_links WHERE chat_id = ?', chatId);

  if (m.contact) {
    // свой номер приходит только с кнопки: у него user_id совпадает с отправителем. Пересланный чужой контакт не подходит
    if (m.contact.user_id !== m.from.id) return say(chatId, text('notOwn', lang), contactKeyboard(lang));
    let phone;
    try {
      phone = normPhone(m.contact.phone_number);
    } catch {
      return say(chatId, text('notOwn', lang), contactKeyboard(lang));
    }
    // у аккаунта Telegram один номер, у номера — один чат: прежние связки заменяются
    run('DELETE FROM tg_links WHERE chat_id = ? OR phone = ?', chatId, phone);
    run('INSERT INTO tg_links(phone, chat_id, lang) VALUES(?, ?, ?)', phone, chatId, lang);
    const start = pending.get(chatId)?.start;
    pending.delete(chatId);
    return deliver({ phone, chatId, lang }, start);
  }

  const start = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{8,64})$/.exec(m.text || '')?.[1];
  if (linked) {
    if (linked.lang !== lang) run('UPDATE tg_links SET lang = ? WHERE chat_id = ?', lang, chatId);
    if (start) return deliver({ ...linked, lang }, start);
    return say(chatId, text('ready', lang, { phone: linked.phone }), hideKeyboard);
  }
  if (start) {
    if (pending.size > 5000) for (const [k, v] of pending) if (Date.now() - v.at > PENDING_TTL) pending.delete(k);
    pending.set(chatId, { start, at: Date.now() });
  }
  return say(chatId, text('ask', lang), contactKeyboard(lang));
}

let polling = false;
/** Запуск бота: узнать его имя и слушать сообщения. Сбои связи сервер не останавливают — бот пробует снова. */
export async function startTelegram() {
  if (!tg.token || polling) return;
  polling = true;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (;;) {
    const me = await tgCall('getMe');
    if (me.ok) {
      tg.name = me.result.username;
      break;
    }
    if (me.error_code === 401 || me.error_code === 404) {
      console.error('[telegram] TELEGRAM_BOT_TOKEN не подходит — вход через Telegram выключен. Проверьте токен у @BotFather.');
      polling = false;
      tg.name = '';
      return;
    }
    await sleep(15_000);
  }
  await tgCall('deleteWebhook'); // иначе getUpdates не работает
  // подсказка для того, кто открыл бота впервые; язык Telegram подставит сам (без языка — русский)
  for (const [i, code] of [undefined, 'kk', 'en', 'zh'].entries()) {
    await tgCall('setMyDescription', { description: T.about[i], language_code: code });
    await tgCall('setMyShortDescription', { short_description: T.short[i], language_code: code });
  }
  console.log(`Telegram: бот @${tg.name} выдаёт коды входа`);
  let offset = 0;
  for (;;) {
    const r = await tgCall('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] }, 65_000);
    if (!r.ok) {
      if (r.error_code === 409) console.error('[telegram] сообщения бота получает другой сервер: у каждого сервера должен быть свой бот');
      await sleep(r.error_code === 409 ? 30_000 : 5000);
      continue;
    }
    for (const u of r.result) {
      offset = u.update_id + 1;
      try {
        await handleUpdate(u);
      } catch (e) {
        console.error('[telegram]', e);
      }
    }
  }
}
