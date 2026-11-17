// Курсы Национального банка Казахстана: обновляются раз в 6 часов, между обновлениями берутся из памяти.
// Нужны, чтобы сравнивать ставки в разных валютах и показывать курсы в «Инструментах».
let cache = { at: 0, data: null };
// запасные значения на случай, если сайт банка недоступен при первом запуске
const FALLBACK = { USD: 480, RUB: 5.5, EUR: 520 };

export async function loadRates() {
  if (Date.now() - cache.at < 6 * 3600_000) return cache.data;
  try {
    const xml = await (await fetch('https://nationalbank.kz/rss/rates_all.xml', { signal: AbortSignal.timeout(6000) })).text();
    const out = {};
    for (const m of xml.matchAll(/<item>\s*<title>([A-Z]{3})<\/title>\s*<pubDate>([^<]*)<\/pubDate>\s*<description>([\d.]+)<\/description>\s*<quant>(\d+)<\/quant>/g)) {
      out[m[1]] = { rate: Number(m[3]) / Number(m[4]), date: m[2] };
    }
    if (out.USD) cache = { at: Date.now(), data: out };
    else cache.at = Date.now() - 6 * 3600_000 + 10 * 60_000;
  } catch {
    cache.at = Date.now() - 6 * 3600_000 + 10 * 60_000; // не вышло — повторим через 10 минут
  }
  return cache.data;
}

/** Сумма в тенге по последнему известному курсу (синхронно — для сортировки и фильтров). */
export function toKzt(amount, currency) {
  if (!amount || currency === 'KZT') return amount || 0;
  return amount * (cache.data?.[currency]?.rate ?? FALLBACK[currency] ?? 1);
}
