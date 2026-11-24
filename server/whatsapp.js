// Вход через WhatsApp — бесплатная замена SMS: человек сам пишет нам, и WhatsApp подтверждает его номер.
//
// Кода мы не присылаем: по правилам Meta коды входа идут только платным шаблоном. Вместо этого:
// 1. Ovi даёт ссылку wa.me с готовым сообщением и одноразовой меткой. Человек отправляет его со своего WhatsApp —
//    номер отправителя в сообщении ставит сам WhatsApp, подделать его нельзя.
// 2. С устройства, где под этим номером уже входили, вход открывается сразу.
// 3. С нового устройства бот просит написать число, которое показано на экране Ovi. Иначе хватило бы прислать
//    человеку готовую ссылку: он нажмёт «Отправить» — и в его аккаунт войдёт мошенник. Попытка одна.
// Экран входа спрашивает сервер о состоянии (POST /api/auth/whatsapp) и открывается сам.
//
// Деньги: входящие бесплатны; наши ответы бесплатны, пока их меньше тысячи в месяц на номер. Поэтому ответы считаются
// (WHATSAPP_MONTH_MAX), на посторонние сообщения бот не отвечает, а когда запас кончился — вход через WhatsApp
// выключается до следующего месяца.
//
// Подключение — README, «Вход через WhatsApp».
import crypto from 'node:crypto';
import { q, q1, run } from './db.js';
import { rateLimit } from './lib.js';
import { notify } from './notify.js';

const env = (k) => (process.env[k] || '').trim();
/** Настройки; адрес API подменяется в тестах. */
export const wa = {
  api: (env('WHATSAPP_API') || 'https://graph.facebook.com/v27.0').replace(/\/+$/, ''),
  number: env('WHATSAPP_NUMBER').replace(/\D/g, ''), // номер, на который пишут люди
  phoneId: env('WHATSAPP_PHONE_ID'),
  token: env('WHATSAPP_TOKEN'),
  secret: env('WHATSAPP_APP_SECRET'),
  verify: env('WHATSAPP_VERIFY_TOKEN'),
  monthMax: Number(env('WHATSAPP_MONTH_MAX') || 950),
};
export const WA_WAIT = 15 * 60_000; // сколько ждём сообщение от человека
const ready = () => !!(wa.number && wa.phoneId && wa.token && wa.secret && wa.verify);
/** Подключён ли WhatsApp и не кончился ли месячный запас бесплатных ответов. */
export const waOn = () => ready() && replies() < wa.monthMax;

const month = () => `wa:${new Date().toISOString().slice(0, 7)}`;
function replies() {
  return Number(q1('SELECT value FROM app_state WHERE key = ?', month())?.value || 0);
}
function countReply() {
  run(`INSERT INTO app_state(key, value) VALUES(?, '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1`, month());
  if (replies() !== wa.monthMax) return;
  console.error(`[whatsapp] за месяц отправлено ${wa.monthMax} ответов — вход через WhatsApp выключен до следующего месяца (WHATSAPP_MONTH_MAX)`);
  for (const a of q('SELECT id FROM users WHERE is_admin = 1')) {
    notify(a.id, { kind: 'system', title: 'Вход через WhatsApp приостановлен', body: 'За месяц отправлено {n} ответов в WhatsApp — бесплатный запас кончился. Вход через WhatsApp включится в следующем месяце.', vars: { n: wa.monthMax }, link: '/cabinet/admin' });
  }
}

// Тексты: ru, kz, en, zh. Язык — тот, что выбран в Ovi.
const LANGS = ['ru', 'kz', 'en', 'zh'];
const T = {
  hello: ['Войти в Ovi. Не меняйте это сообщение, просто отправьте его: #{start}', 'Ovi-ге кіру. Бұл хабарламаны өзгертпей жіберіңіз: #{start}', 'Sign in to Ovi. Do not edit this message, just send it: #{start}', '登录 Ovi。请不要修改此消息，直接发送：#{start}'],
  pick: [
    'Кто-то входит в Ovi с вашим номером. Если это вы — напишите сюда двузначное число с экрана Ovi и вернитесь в Ovi: вход откроется сам.\n\nЕсли вы не входите в Ovi или вас попросили об этом — ничего не пишите: это мошенники.',
    'Біреу сіздің нөміріңізбен Ovi-ге кіріп жатыр. Бұл сіз болсаңыз — Ovi экранындағы екі таңбалы санды осында жазып, Ovi-ге оралыңыз: кіру өзі ашылады.\n\nOvi-ге кірмесеңіз немесе сізден мұны сұраса — ештеңе жазбаңыз: бұл алаяқтар.',
    'Someone is signing in to Ovi with your number. If it is you, reply with the two-digit number from the Ovi screen and return to Ovi: it will open by itself.\n\nIf you are not signing in to Ovi, or someone asked you to do this, do not reply: it is a scam.',
    '有人正在使用您的号码登录 Ovi。如果是您本人，请在此回复 Ovi 屏幕上的两位数字，然后返回 Ovi，系统会自动登录。\n\n如果您没有登录 Ovi，或是别人让您这样做，请不要回复：这是诈骗。',
  ],
  wrong: ['Число не совпало, вход отменён. Если это были вы — вернитесь в Ovi и начните заново.', 'Сан сәйкес келмеді, кіру тоқтатылды. Бұл сіз болсаңыз — Ovi-ге оралып, қайта бастаңыз.', 'The number did not match, sign-in cancelled. If it was you, go back to Ovi and start again.', '数字不一致，登录已取消。如果是您本人，请返回 Ovi 重新开始。'],
  mismatch: ['В Ovi введён другой номер, не тот, с которого вы пишете. Вернитесь в Ovi и введите номер этого WhatsApp.', 'Ovi-ге басқа нөмір енгізілген. Ovi-ге оралып, осы WhatsApp нөмірін енгізіңіз.', 'A different number was entered in Ovi. Go back to Ovi and enter the number of this WhatsApp.', '您在 Ovi 输入的不是此 WhatsApp 的号码。请返回 Ovi 输入此 WhatsApp 的号码。'],
  expired: ['Запрос входа устарел. Вернитесь в Ovi и начните заново.', 'Кіру сұрауы ескірді. Ovi-ге оралып, қайта бастаңыз.', 'The sign-in request has expired. Go back to Ovi and start again.', '登录请求已过期。请返回 Ovi 重新开始。'],
  hidden: ['Ваш номер в WhatsApp скрыт, подтвердить его не получается. Вернитесь в Ovi и выберите другой способ входа.', 'WhatsApp-та нөміріңіз жасырылған, оны растау мүмкін емес. Ovi-ге оралып, басқа кіру тәсілін таңдаңыз.', 'Your number is hidden in WhatsApp, so we cannot confirm it. Go back to Ovi and choose another way to sign in.', '您的 WhatsApp 号码已隐藏，无法验证。请返回 Ovi 选择其他登录方式。'],
};
export const waLang = (l) => (LANGS.includes(l) ? l : 'ru');
const text = (key, lang, vars = {}) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), T[key][LANGS.indexOf(waLang(lang))]);

// метка без похожих знаков (0/O, 1/I): её видно в сообщении
const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newStart = () => Array.from({ length: 10 }, () => ABC[crypto.randomInt(ABC.length)]).join('');
export const newPick = () => String(crypto.randomInt(10, 100));
/** Ссылка с готовым сообщением. */
export const waUrl = (start, lang) => `https://wa.me/${wa.number}?text=${encodeURIComponent(text('hello', lang, { start }))}`;

/** Ответить человеку. Считаем только принятые Meta ответы; одному отправителю — не больше шести в сутки. */
async function reply(to, message) {
  if (replies() >= wa.monthMax) return false;
  try {
    rateLimit(`wa:${to.to || to.recipient}`, 6, 86400_000);
  } catch {
    return false;
  }
  try {
    const res = await fetch(`${wa.api}/${wa.phoneId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${wa.token}` },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...to, type: 'text', text: { body: message } }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      countReply();
      return true;
    }
    const err = (await res.json().catch(() => null))?.error;
    console.error(`[whatsapp] ответ не отправлен: ${res.status} ${err?.code || ''} ${err?.message || ''}`.trim());
  } catch (e) {
    console.error(`[whatsapp] ответ не отправлен: ${e.message}`);
  }
  return false;
}

/** Подпись Meta: HMAC-SHA256 тела запроса ключом приложения. Без неё любой прислал бы «сообщение» с чужого номера. */
export function signed(raw, header) {
  if (!wa.secret || !Buffer.isBuffer(raw)) return false;
  const want = Buffer.from('sha256=' + crypto.createHmac('sha256', wa.secret).update(raw).digest('hex'));
  const got = Buffer.from(String(header || ''));
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

const set = (ticket, state) => run('UPDATE login_codes SET wa_state = ? WHERE ticket = ?', state, ticket);

/** Одно входящее сообщение. Meta может прислать его повторно: каждое состояние проходит только вперёд. */
export async function handleMessage(m) {
  if (m?.type !== 'text') return;
  const body = String(m.text?.body || '');
  const start = /#([A-Z2-9]{10})(?![A-Z0-9])/.exec(body)?.[1];
  // номер — ровно тот, что поставил WhatsApp (полный международный); местные записи здесь не разбираются
  const phone = /^\d{8,15}$/.test(m.from || '') ? '+' + m.from : null;
  if (start) {
    const row = q1(`SELECT ticket, phone, known, expires, wa_state AS state, wa_lang AS lang FROM login_codes WHERE wa_start = ? AND channel = 'wa'`, start);
    if (!row || row.state !== 'new') return; // чужая, уже использованная или выдуманная метка
    // человек скрыл номер в WhatsApp: вместо номера приходит внутренний идентификатор, подтвердить нечего
    if (!phone) {
      set(row.ticket, 'fail');
      return m.from_user_id ? reply({ recipient: m.from_user_id }, text('hidden', row.lang)) : undefined;
    }
    const to = { to: phone };
    if (row.expires < Date.now()) return reply(to, text('expired', row.lang));
    if (row.phone !== phone) return reply(to, text('mismatch', row.lang));
    if (row.known) return set(row.ticket, 'ok');
    set(row.ticket, 'pick');
    if (!(await reply(to, text('pick', row.lang)))) set(row.ticket, 'fail');
    return;
  }
  const pick = /^\s*(\d{2})\s*$/.exec(body)?.[1];
  if (!pick || !phone) return;
  const row = q1(`SELECT ticket, wa_pick AS pick, wa_lang AS lang FROM login_codes WHERE phone = ? AND channel = 'wa' AND wa_state = 'pick' AND expires > ? ORDER BY created_at DESC, rowid DESC LIMIT 1`, phone, Date.now());
  if (!row) return;
  if (row.pick === pick) return set(row.ticket, 'ok');
  // не совпало — закрываем все ожидающие входы этого номера: число нельзя подбирать
  run(`UPDATE login_codes SET wa_state = 'no' WHERE phone = ? AND channel = 'wa' AND wa_state IN ('new', 'pick')`, phone);
  return reply({ to: phone }, text('wrong', row.lang));
}

/** Тело уведомления от Meta: сообщения нашему номеру, остальное (статусы доставки и чужие номера) не нужно. */
export async function handleWebhook(data) {
  if (data?.object !== 'whatsapp_business_account') return;
  for (const e of data.entry || []) for (const c of e.changes || []) {
    if (c.field !== 'messages' || c.value?.metadata?.phone_number_id !== wa.phoneId) continue;
    for (const m of c.value.messages || []) {
      try {
        await handleMessage(m);
      } catch (err) {
        console.error('[whatsapp]', err);
      }
    }
  }
}
