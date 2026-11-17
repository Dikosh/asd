// Отправка SMS. Провайдер подключается через SMS_WEBHOOK_URL: на него уходит POST {phone, text}.
// В демо-режиме код показывается на экране входа и SMS не нужны. Вне демо без провайдера вход невозможен:
// писать коды в журнал сервера небезопасно.
import { DEMO, HttpError } from './lib.js';

export async function sendSms(phone, text) {
  const url = process.env.SMS_WEBHOOK_URL;
  if (!url) {
    if (DEMO) return;
    console.error('[sms] SMS_WEBHOOK_URL не задан — коды входа отправлять некуда');
    throw new HttpError(503, 'sms_off', 'Вход временно недоступен: не подключена отправка SMS');
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.SMS_WEBHOOK_TOKEN || ''}` },
    body: JSON.stringify({ phone, text }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new HttpError(502, 'sms_failed', 'Не удалось отправить SMS, попробуйте позже');
}
