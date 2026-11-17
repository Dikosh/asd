// Отправка SMS. Провайдер подключается через SMS_WEBHOOK_URL: на него уходит POST {phone, text}.
// Без провайдера сообщение пишется в лог (в демо-режиме код дополнительно показывается на экране входа).
export async function sendSms(phone, text) {
  const url = process.env.SMS_WEBHOOK_URL;
  if (!url) {
    console.log(`[sms] ${phone}: ${text}`);
    return;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.SMS_WEBHOOK_TOKEN || ''}` },
    body: JSON.stringify({ phone, text }),
  });
  if (!res.ok) throw new Error(`SMS provider responded ${res.status}`);
}
