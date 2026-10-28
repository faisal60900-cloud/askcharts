// The entry signal tested on years of daily bars, on the server (where the market data is), for
// Boursa Kuwait (every listed stock) or the US (the most traded large companies, with SPY for the
// whole market's direction). It runs in the background; the page polls for progress and the
// result, which is kept in the data folder.
import { getCandles, nasdaqScreener } from "./providers.js";
import * as store from "./store.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KUWAIT_STOCKS } from "../public/lib/kuwait-market.js";
import { SAUDI_STOCKS } from "../public/lib/saudi-market.js";
import { UAE_STOCKS } from "../public/lib/uae-market.js";
import { signalsFor, compare, equalIndex, VARIANTS, VARIANTS_US, VARIANTS_SA, LIVE } from "../public/lib/kuwait-backtest.js";
import { US_LIVE, SA_LIVE, AE_LIVE } from "../public/lib/kuwait-scan.js";

const KEY = { kw: "kwbacktest", us: "usbacktest", sa: "sabacktest", ae: "aebacktest" };
const jobs = Object.fromEntries(Object.entries(KEY).map(([m, k]) => [m, store.read(k, null)]));
const running = { kw: false, us: false, sa: false, ae: false };
const LISTS = { kw: KUWAIT_STOCKS, sa: SAUDI_STOCKS, ae: UAE_STOCKS };
const SETS = { kw: { variants: VARIANTS, live: LIVE }, us: { variants: VARIANTS_US, live: US_LIVE }, sa: { variants: VARIANTS_SA, live: SA_LIVE }, ae: { variants: VARIANTS_SA, live: AE_LIVE } };

export const status = (market = "kw") => ({ market, running: running[market], ...(jobs[market] || {}) });

async function usList(size) {
  const rows = await nasdaqScreener("stocks");
  return rows
    .filter((r) => r.price >= 5 && r.marketCap >= 2e9 && r.volume > 0 && /^[A-Z]{1,5}$/.test(r.ticker))
    .sort((a, b) => b.price * b.volume - a.price * a.volume)
    .slice(0, size)
    .map((r) => ({ code: r.ticker, symbol: r.symbol, en: r.name, ar: null }));
}

export function start({ market = "kw", limit = 1500, size = 300 } = {}) {
  market = KEY[market] ? market : "kw";
  if (running[market]) return status(market);
  running[market] = true;
  let job = (jobs[market] = { startedAt: new Date().toISOString(), done: 0, of: 0, stocks: 0, failed: [] });
  (async () => {
    const list = market === "us" ? await usList(Math.min(1000, Math.max(50, Number(size) || 300))) : LISTS[market];
    let index = market === "us" ? (await getCandles("US:SPY", "1D", limit).catch(() => ({ candles: [] }))).candles : null;
    // Saudi: every stock's bars first, for the equal-weighted market index, then the signals
    const held = market === "sa" || market === "ae" ? new Map() : null;
    job.of = list.length;
    const events = [];
    let i = 0;
    const worker = async () => {
      while (i < list.length) {
        const s = list[i++];
        try {
          const r = await getCandles(s.symbol, "1D", limit);
          const bars = r.candles || [];
          if (held) held.set(s.code, bars);
          if (bars.length > 340) {
            job.stocks++;
            if (!held) events.push(...signalsFor(s, bars, { market, index }));
          } else job.failed.push(s.code);
        } catch {
          job.failed.push(s.code);
        }
        job.done++;
        // let the server answer requests between stocks
        await new Promise((res) => setImmediate(res));
      }
    };
    await Promise.all([worker(), worker()]);
    if (held) {
      index = equalIndex([...held.values()]);
      for (const s of list) {
        const bars = held.get(s.code);
        if (bars?.length > 340) events.push(...signalsFor(s, bars, { market, index }));
        await new Promise((res) => setImmediate(res));
      }
    }
    const first = events.reduce((m, e) => Math.min(m, e.time), Infinity);
    job = jobs[market] = {
      ...job,
      finishedAt: new Date().toISOString(),
      from: Number.isFinite(first) ? new Date(first * 1000).toISOString().slice(0, 10) : null,
      indexBars: index?.length ?? null,
      ...compare(events, SETS[market]),
      recent: events.sort((a, b) => b.time - a.time).slice(0, 40),
      total: events.length,
    };
    store.write(KEY[market], job);
  })()
    .catch((e) => (jobs[market] = { ...job, error: e.message }))
    .finally(() => (running[market] = false));
  return status(market);
}

// For research: every stock's daily bars of a market, written to app/research/<market>-bars.json
// (compact: [time, open, high, low, close, volume] rows).
export async function dump({ market = "sa", limit = 1500 } = {}) {
  const list = LISTS[market] || (await usList(300));
  const out = {};
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const s = list[i++];
      const bars = (await getCandles(s.symbol, "1D", limit).catch(() => ({ candles: [] }))).candles || [];
      if (bars.length) out[s.code] = { ...s, bars: bars.map((b) => [b.time, b.open, b.high, b.low, b.close, b.volume || 0]) };
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "research");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${market}-bars.json`);
  fs.writeFileSync(file, JSON.stringify(out));
  return { file, stocks: Object.keys(out).length };
}
