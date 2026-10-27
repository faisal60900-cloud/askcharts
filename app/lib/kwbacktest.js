// The Kuwait entry signal tested on six years of every listed stock's daily bars, on the server
// (where the market data is). It runs in the background; the page polls for progress and the
// result, which is kept in the data folder.
import { getCandles } from "./providers.js";
import * as store from "./store.js";
import { KUWAIT_STOCKS } from "../public/lib/kuwait-market.js";
import { signalsFor, compare } from "../public/lib/kuwait-backtest.js";

let job = store.read("kwbacktest", null);
let running = false;

export const status = () => ({ running, ...(job || {}) });

export function start({ limit = 1500 } = {}) {
  if (running) return status();
  running = true;
  job = { startedAt: new Date().toISOString(), done: 0, of: KUWAIT_STOCKS.length, stocks: 0, failed: [] };
  (async () => {
    const events = [];
    let i = 0;
    const worker = async () => {
      while (i < KUWAIT_STOCKS.length) {
        const s = KUWAIT_STOCKS[i++];
        try {
          const r = await getCandles(s.symbol, "1D", limit);
          const bars = r.candles || [];
          if (bars.length > 340) {
            job.stocks++;
            events.push(...signalsFor(s, bars));
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
    const first = events.reduce((m, e) => Math.min(m, e.time), Infinity);
    job = {
      ...job,
      finishedAt: new Date().toISOString(),
      from: Number.isFinite(first) ? new Date(first * 1000).toISOString().slice(0, 10) : null,
      ...compare(events),
      // the latest 40 signals, to look at by hand
      recent: events.sort((a, b) => b.time - a.time).slice(0, 40),
      total: events.length,
    };
    store.write("kwbacktest", job);
  })()
    .catch((e) => (job = { ...job, error: e.message }))
    .finally(() => (running = false));
  return status();
}
