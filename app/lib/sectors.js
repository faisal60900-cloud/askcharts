// قطاعات السوق, server side: fetch the daily bars of every stock in Boursa Kuwait's sectors, or of
// the US sector funds, and build the table (public/lib/sectors.js). Kept for 3 minutes.
import { getCandles } from "./providers.js";
import { KUWAIT_STOCKS } from "../public/lib/kuwait-market.js";
import { KW_SECTORS, US_SECTORS, stockDay, sectorTable } from "../public/lib/sectors.js";
import { kuwaitSessionFraction, usSessionFraction } from "../public/lib/market-reader.js";

const cache = {};
const TTL = 3 * 60e3;

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]).catch(() => null);
      }
    }),
  );
  return out;
}

export async function sectors(market = "kw", { now = Date.now(), fresh = false } = {}) {
  market = market === "us" ? "us" : "kw";
  const hit = cache[market];
  if (!fresh && hit && now - hit.at < TTL) return hit.data;
  const kw = market === "kw";
  const list = kw ? KUWAIT_STOCKS.map((s) => ({ code: s.code, symbol: s.symbol })) : US_SECTORS.map((s) => ({ code: s.key, symbol: `US:${s.key}` }));
  const fracOf = kw ? kuwaitSessionFraction : usSessionFraction;
  const bars = await mapLimit(list, kw ? 4 : 6, (s) => getCandles(s.symbol, "1D", 40).then((r) => r.candles || []));
  const days = {};
  list.forEach((s, k) => {
    const b = bars[k];
    if (!b?.length) return;
    days[s.code] = stockDay(b, { scale: kw ? 1 / 1000 : 1, frac: fracOf(b.at(-1).time, now) });
  });
  const groups = kw ? Object.entries(KW_SECTORS).map(([key, s]) => ({ key, ...s })) : US_SECTORS;
  const data = { market, at: now, ...sectorTable(groups, days), read: Object.keys(days).length, of: list.length };
  cache[market] = { at: now, data };
  return data;
}
