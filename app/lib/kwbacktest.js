// The entry signal tested on years of daily bars, on the server (where the market data is), for
// Boursa Kuwait (every listed stock) or the US (the most traded large companies, with SPY for the
// whole market's direction). It runs in the background; the page polls for progress and the
// result, which is kept in the data folder.
import { getCandles, nasdaqScreener } from "./providers.js";
import * as store from "./store.js";
import { KUWAIT_STOCKS } from "../public/lib/kuwait-market.js";
import { SAUDI_STOCKS } from "../public/lib/saudi-market.js";
import { signalsFor, compare, equalIndex, VARIANTS, VARIANTS_US, VARIANTS_SA, LIVE } from "../public/lib/kuwait-backtest.js";
import { US_LIVE, SA_LIVE } from "../public/lib/kuwait-scan.js";

const KEY = { kw: "kwbacktest", us: "usbacktest", sa: "sabacktest" };
const jobs = { kw: store.read(KEY.kw, null), us: store.read(KEY.us, null), sa: store.read(KEY.sa, null) };
const running = { kw: false, us: false, sa: false };
const SETS = { kw: { variants: VARIANTS, live: LIVE }, us: { variants: VARIANTS_US, live: US_LIVE }, sa: { variants: VARIANTS_SA, live: SA_LIVE } };

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
  market = ["us", "sa"].includes(market) ? market : "kw";
  if (running[market]) return status(market);
  running[market] = true;
  let job = (jobs[market] = { startedAt: new Date().toISOString(), done: 0, of: 0, stocks: 0, failed: [] });
  (async () => {
    const list = market === "us" ? await usList(Math.min(1000, Math.max(50, Number(size) || 300))) : market === "sa" ? SAUDI_STOCKS : KUWAIT_STOCKS;
    let index = market === "us" ? (await getCandles("US:SPY", "1D", limit).catch(() => ({ candles: [] }))).candles : null;
    // Saudi: every stock's bars first, for the equal-weighted market index, then the signals
    const held = market === "sa" ? new Map() : null;
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
