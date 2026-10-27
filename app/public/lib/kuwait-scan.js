// ماسح السوق الكويتي: one row per stock from its daily bars, read with the Market Reader, and the
// filters the scan offers. Pure numbers in and out, so it can be tested without a page.
import { readMarket, kuwaitSessionFraction, usSessionFraction, readTimeframe } from "./market-reader.js";
import { resample } from "./series.js";

// Average daily traded value over the last n sessions, in the stock's own money (Kuwaiti bars
// are in fils, so / 1000 gives dinars).
export function tradedValue(bars, n = 20, fils = true) {
  const part = bars.slice(-n);
  if (!part.length) return 0;
  const v = part.reduce((s, b) => s + (b.volume || 0) * b.close, 0) / part.length;
  return fils ? v / 1000 : v;
}

// The filters. Each is a test on a row; "entry" is all of the buy-entry conditions together.
export const FILTERS = {
  breakout: { ar: "اختراق مؤكد بسيولة", test: (r) => r.breakout?.dir === "up" && r.breakout.confirmed },
  anyBreakout: { ar: "اختراق (مؤكد أو قريب)", test: (r) => r.breakout?.dir === "up" || r.breakout?.dir === "near" },
  inflow: { ar: "السيولة الداخلة 55% فأكثر", test: (r) => (r.flow?.inflowPct ?? 0) >= 55 },
  improving: { ar: "صافي السيولة يتحسن", test: (r) => !!r.flow?.improving },
  buying: { ar: "الشراء اليوم أكبر من البيع", test: (r) => (r.buyToday ?? r.buyPeriod ?? 0) > 50 },
  signals: { ar: "ميزان الإشارات إيجابي", test: (r) => (r.signalKey ?? 0) > 0 },
  rr: { ar: "العائد:المخاطرة 1.5 فأكثر", test: (r) => (r.plan?.targets?.[0]?.rr ?? 0) >= 1.5 },
  weeklyUp: { ar: "الاتجاه الأسبوعي صاعد", test: (r) => (r.weekly ?? 0) > 0 },
  rsiZone: { ar: "RSI بين 50 و70", test: (r) => r.rsi >= 50 && r.rsi < 70 },
  strongClose: { ar: "إغلاق قرب قمة اليوم", test: (r) => (r.closePos ?? 0) >= 0.7 },
  vol2: { ar: "سيولة الاختراق 2x فأكثر", test: (r) => (r.breakout?.vol ?? 0) >= 2 },
};

// The breakout signal: a confirmed breakout, money coming in, buying ahead and the checks leaning
// positive. On its own it reached its first target 65% of the time from 2021 to 2026 but lost money
// on average (the target was near and the stop far). With the week trending up, RSI 50-70 and a
// close near the day's high, and a trailing stop instead of the near target, it made money both on
// the years the rules were chosen on and on the years kept aside (lib/kwbacktest.js).
export const BASE_RULES = ["breakout", "inflow", "buying", "signals"];
export const ENTRY_RULES = [...BASE_RULES, "weeklyUp", "rsiZone", "strongClose"];
// the trailing stop: the highest price since entry minus this many ATRs
export const TRAIL_ATR = 2.5;
// The US: tested on the 300 most traded large US stocks from 2022 (lib/kwbacktest.js). Kuwait's
// week/RSI/close conditions did worse there; what held in both the choosing years (2022-2024) and
// the checking years (2025-2026) was a breakout on twice the usual volume or more, with a wider
// trailing stop (3 ATR): +1.65% and +1.68% a trade after costs.
export const US_ENTRY_RULES = [...BASE_RULES, "vol2"];
export const US_TRAIL_ATR = 3;
// Managed with five targets at 1R to 5R, a fifth sold at each, the stop to the entry after the first
// and to the previous target after each next one: 53% of trades ended in profit (37% with the
// trailing stop alone), for +0.8% a trade on average instead of +1.7%.
export const US_TARGETS_R = [1, 2, 3, 4, 5];
export const US_LIVE = { variant: "vol2", exit: "scale5" };
export const entryRules = (market) => (market === "us" ? US_ENTRY_RULES : ENTRY_RULES);
export const isEntry = (row, market = row?.market || "kw") => entryRules(market).every((k) => FILTERS[k].test(row));
export const isBaseSignal = (row) => BASE_RULES.every((k) => FILTERS[k].test(row));

const closePos = (b) => (b && b.high > b.low ? Math.round(((b.close - b.low) / (b.high - b.low)) * 100) / 100 : 0.5);
function weekTrend(bars) {
  const last = bars.at(-1);
  const wk = resample(bars, "1W").filter((w) => w.time + 7 * 86400 <= last.time + 86400);
  const r = wk.length >= 30 ? readTimeframe(wk.slice(-150)) : null;
  return r ? r.trend : 0;
}

// One stock: its reading on the daily bars, flattened into what the table and filters need.
// market "kw" (prices in fils, Boursa Kuwait's session) or "us" (dollars, New York's session)
export function scanRow(stock, bars, now = Date.now(), { market = "kw" } = {}) {
  if (!bars || bars.length < 60) return { ...stock, error: "لا توجد بيانات كافية" };
  // A session that has only just opened has a candle with almost no volume, which would read as
  // "no liquidity" everywhere: read the last completed session instead, and say so.
  const vols = bars.slice(-21, -1).map((b) => b.volume || 0);
  const avg = vols.reduce((a, v) => a + v, 0) / Math.max(1, vols.length);
  const early = avg > 0 && (bars.at(-1).volume || 0) < avg * 0.1;
  if (early) bars = bars.slice(0, -1);
  const r = readMarket({ "1D": bars }, { main: "1D", symbol: stock.symbol, sessionFraction: early || !now ? 1 : (market === "us" ? usSessionFraction : kuwaitSessionFraction)(bars.at(-1).time, now) });
  if (r.error) return { ...stock, error: r.error };
  const last = bars.at(-1),
    prev = bars.at(-2);
  const row = {
    ...stock,
    price: r.price,
    changePct: prev?.close ? Math.round(((last.close - prev.close) / prev.close) * 1000) / 10 : null,
    value: Math.round(tradedValue(bars, 20, market !== "us")),
    trend: r.overall,
    state: r.state,
    breakout: r.breakout,
    relVol: r.liquidity.relVol,
    flow: r.flow,
    buyPeriod: r.trades?.period?.buyPct ?? null,
    buyToday: r.trades?.lastBar?.buyPct ?? null,
    signalKey: r.signal.key,
    signalAr: r.signal.ar,
    positives: r.signal.positive,
    negatives: r.signal.negative,
    rsi: r.rsi,
    plan: r.plan,
    early,
    // the week trend from the weeks that have closed (this week's is still forming)
    weekly: weekTrend(bars),
    closePos: closePos(bars.at(-1)),
    market,
    trail: r.atrPct && r.price ? { atr: market === "us" ? US_TRAIL_ATR : TRAIL_ATR, dist: Math.round(((r.atrPct * r.price) / 100) * (market === "us" ? US_TRAIL_ATR : TRAIL_ATR) * 100) / 100 } : null,
  };
  // one number to sort by: what the filters reward, with volume as the tie breaker
  row.score =
    (r.breakout?.dir === "up" ? (r.breakout.confirmed ? 4 : 2) : r.breakout?.dir === "near" ? 1 : r.breakout?.dir === "down" ? -3 : 0) +
    (r.flow ? (r.flow.inflowPct - 50) / 10 : 0) +
    (r.flow?.improving ? 1 : 0) +
    (r.signal.positive - r.signal.negative) +
    Math.min(2, (r.liquidity.relVol ?? 1) - 1);
  row.score = Math.round(row.score * 10) / 10;
  row.entry = isEntry(row);
  return row;
}
