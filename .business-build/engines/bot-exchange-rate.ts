// Real BOT (Bank of Thailand) Exchange Rate lookup (owner, 2026-07-30):
// "อัตราแลกเปลี่ยน...ใช้ประเมินทิศทางดอกเบี้ยสำหรับวงเงินเครดิตคู่ค้าและการ
// สั่งซื้อเครื่องจักร/อะไหล่" — unlike fuel/weather, BOT's API requires a
// real registered app + subscription key (portal.api.bot.or.th, IBM API
// Connect) — the owner registered one himself (app "บริษัท ดีเอ็นเอ โอเอส
// จำกัด", BOT_API_KEY in .env.local) since this isn't a zero-setup public
// endpoint like Bangchak/Open-Meteo. Confirmed live via curl, 2026-07-30:
// this exact product ("Exchange Rates") works with that key; the sibling
// "Interest Rates" (LoanRate) product does not yet (403 — not fully
// subscribed/approved on BOT's side), so no engines/bot-interest-rate.ts
// exists yet — building it now would just return fabricated-looking errors
// for a feature that isn't actually authorized.

export interface ExchangeRateRow {
  currencyId: string;
  currencyNameTh: string;
  buyingSight: number;
  buyingTransfer: number;
  selling: number;
  midRate: number;
}

const BOT_EXCHANGE_RATE_API = "https://gateway.api.bot.or.th/Stat-ExchangeRate/v2/DAILY_AVG_EXG_RATE/";

function todayMinus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function getLatestExchangeRates(): Promise<{ rates: ExchangeRateRow[]; period: string } | null> {
  const apiKey = process.env.BOT_API_KEY;
  if (!apiKey) return null;

  // A 3-day window, not just "today" — BOT publishes on business days only
  // (no rate for weekends/holidays), so asking for exactly today can return
  // an empty data_detail. The API returns the latest available date within
  // the window regardless, per its own last_updated field.
  const url = `${BOT_EXCHANGE_RATE_API}?start_period=${todayMinus(4)}&end_period=${todayMinus(0)}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const detail: any[] = data?.result?.data?.data_detail ?? [];
    if (detail.length === 0) return null;

    const latestPeriod = detail[0].period;
    const latestRows = detail.filter((r) => r.period === latestPeriod);

    return {
      period: latestPeriod,
      rates: latestRows.map((r) => ({
        currencyId: r.currency_id,
        currencyNameTh: r.currency_name_th,
        buyingSight: Number(r.buying_sight),
        buyingTransfer: Number(r.buying_transfer),
        selling: Number(r.selling),
        midRate: Number(r.mid_rate),
      })),
    };
  } catch {
    return null; // honest failure — never fabricate a rate
  }
}

export async function getExchangeRateFor(currencyId: string): Promise<ExchangeRateRow | null> {
  const result = await getLatestExchangeRates();
  if (!result) return null;
  return result.rates.find((r) => r.currencyId.toUpperCase() === currencyId.toUpperCase()) ?? null;
}
