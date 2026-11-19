// Защита базы контактов от выкачивания. Телефон и точные адреса отдаются только в открытой карточке объявления
// или компании, и число таких открытий на компанию в сутки ограничено: человеку, который ищет груз или машину,
// предела хватает с запасом, а программа конкурента упирается в него за минуты. Свои объявления, объявления,
// на которые компания откликнулась, и партнёры по рейсам в счёт не идут.
import { q, q1 } from './db.js';
import { notify } from './notify.js';
import { LIMITS, today } from './lib.js';

const opened = new Map(); // «компания:день» → набор открытых карточек
let day = '';

/**
 * Можно ли показать этой компании контакты карточки `key` («l:12» — объявление, «c:7» — компания).
 * Уже открытая сегодня карточка открывается повторно без счёта. Модераторы получают уведомление, когда компания
 * исчерпала предел: это либо очень активный участник, либо сбор базы.
 */
export function contactAllowed(user, key) {
  if (user.is_admin) return true;
  const now = today();
  if (now !== day) {
    opened.clear();
    day = now;
  }
  const k = `${user.company_id}:${now}`;
  const set = opened.get(k) || opened.set(k, new Set()).get(k);
  if (set.has(key)) return true;
  const c = q1('SELECT name, form, verified, pro FROM company_stats WHERE id = ?', user.company_id);
  const cap = c?.verified === 'verified' || c?.pro ? LIMITS.contactsTrusted : LIMITS.contactsNew;
  if (set.size >= cap) return false;
  set.add(key);
  if (set.size === cap) {
    notify(q('SELECT id FROM users WHERE is_admin = 1').map((a) => a.id), {
      kind: 'system', title: 'Компания открыла слишком много контактов',
      body: '«{name}» за сутки открыла {n} карточек с контактами — предел исчерпан. Так выглядит сбор базы: проверьте компанию.',
      vars: { name: c?.form ? `${c.form} ${c.name}` : c?.name || '', n: cap }, link: `/company/${user.company_id}`,
    });
  }
  return true;
}
/** Для тестов: начать счёт заново. */
export const resetContacts = () => opened.clear();
