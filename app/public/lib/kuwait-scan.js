// ماسح السوق الكويتي: one row per stock from its daily bars, read with the Market Reader, and the
// filters the scan offers. Pure numbers in and out, so it can be tested without a page.
import { readMarket } from "./market-reader.js";

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
};

// "إشارة دخول": a confirmed breakout, money coming in, buying ahead and the checks leaning positive
export const ENTRY_RULES = ["breakout", "inflow", "buying", "signals"];
export const isEntry = (row) => ENTRY_RULES.every((k) => FILTERS[k].test(row));

// One stock: its reading on the daily bars, flattened into what the table and filters need.
export function scanRow(stock, bars) {
  if (!bars || bars.length < 60) return { ...stock, error: "لا توجد بيانات كافية" };
  // A session that has only just opened has a candle with almost no volume, which would read as
  // "no liquidity" everywhere: read the last completed session instead, and say so.
  const vols = bars.slice(-21, -1).map((b) => b.volume || 0);
  const avg = vols.reduce((a, v) => a + v, 0) / Math.max(1, vols.length);
  const early = avg > 0 && (bars.at(-1).volume || 0) < avg * 0.1;
  if (early) bars = bars.slice(0, -1);
  const r = readMarket({ "1D": bars }, { main: "1D", symbol: stock.symbol });
  if (r.error) return { ...stock, error: r.error };
  const last = bars.at(-1),
    prev = bars.at(-2);
  const row = {
    ...stock,
    price: r.price,
    changePct: prev?.close ? Math.round(((last.close - prev.close) / prev.close) * 1000) / 10 : null,
    value: Math.round(tradedValue(bars)),
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
