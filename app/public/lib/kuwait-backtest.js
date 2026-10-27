// How the Kuwait scanner's entry signal did in the past: every day in a stock's history where the
// signal fired (as the scanner would have seen it that day, from the bars up to then), what
// happened next. Entry at the next session's open; a win is the plan's first target reached before
// its stop, a loss the stop first (both in one day counts as a loss), and after 20 sessions without
// either the trade is closed at that day's close. Each signal also keeps the facts the stricter
// rule sets below test, so one pass over the history scores them all.
import { scanRow, isBaseSignal } from "./kuwait-scan.js";
import { ema, rsiOf, atr } from "./indicators.js";
import { resample } from "./series.js";
import { readTimeframe } from "./market-reader.js";

const WINDOW = 300; // bars the scanner reads, as it does live
const HOLD = 20; // sessions a trade is given
const COST = 0.3; // round trip, % (commission and spread, a rough Kuwaiti figure)

// The rule sets compared: the scanner's own, then stricter ones. Each is a test on a signal's facts.
export const VARIANTS = {
  base: { ar: "الشروط الحالية", test: () => true },
  weeklyUp: { ar: "+ الاتجاه الأسبوعي صاعد", test: (e) => e.weekly > 0 },
  rsiOk: { ar: "+ RSI بين 50 و70", test: (e) => e.rsi >= 50 && e.rsi < 70 },
  vol2: { ar: "+ سيولة الاختراق 2x فأكثر", test: (e) => e.breakVol >= 2 },
  liquid: { ar: "+ قيمة تداول 50 ألف د.ك فأكثر", test: (e) => e.value >= 50000 },
  strongClose: { ar: "+ إغلاق قرب قمة اليوم", test: (e) => e.closePos >= 0.7 },
  aboveEma50: { ar: "+ السعر فوق متوسط 50", test: (e) => e.aboveEma50 },
  rr15: { ar: "+ عائد:مخاطرة 1.5 فأكثر", test: (e) => e.rr >= 1.5 },
  combo: { ar: "الأسبوعي صاعد + RSI 50-70 + إغلاق قوي", test: (e) => e.weekly > 0 && e.rsi >= 50 && e.rsi < 70 && e.closePos >= 0.7 },
  comboLiquid: { ar: "الأسبوعي صاعد + فوق متوسط 50 + سيولة 2x", test: (e) => e.weekly > 0 && e.aboveEma50 && e.breakVol >= 2 },
};

// Ways out of a trade, all from the same entry and the same first stop:
//   t1     the plan's first target, 20 sessions at most (what the alerts give today)
//   r2/r3  a target at 2 or 3 times the risk, 30 sessions at most
//   hold10 just the stop, out at the 10th session's close
//   trail  the stop follows the price: the highest high since entry minus 2.5 ATR, 40 sessions
//   trailT1 half out at the first target, the rest on the trailing stop
export const EXITS = {
  t1: { ar: "البيع عند الهدف الأول", target: "t1", max: 20 },
  r2: { ar: "هدف بضعف المخاطرة (2R)", target: 2, max: 30 },
  r3: { ar: "هدف بثلاثة أضعاف المخاطرة (3R)", target: 3, max: 30 },
  hold10: { ar: "الاحتفاظ 10 جلسات مع الوقف", max: 10 },
  trail: { ar: "وقف متحرك يلحق السعر (2.5 ATR)", trail: 2.5, max: 40 },
  trailT1: { ar: "نصف عند الهدف الأول والباقي بوقف متحرك", half: true, trail: 2.5, max: 40 },
};

export function simulate(bars, i, entry, stop, atrAtEntry, t1, x) {
  const n = bars.length,
    R = entry - stop;
  const last = Math.min(n - 1, i + x.max);
  const target = x.target === "t1" ? t1 : x.target ? entry + R * x.target : null;
  let s = stop,
    high = entry,
    halfAt = null;
  const done = (exit, result, k) => {
    const px = halfAt != null ? (halfAt + exit) / 2 : exit;
    const ret = ((px - entry) / entry) * 100 - COST;
    return { result, days: k - i, ret: Math.round(ret * 100) / 100, r: Math.round(((px - entry) / R) * 100) / 100 };
  };
  for (let k = i + 1; k <= last; k++) {
    const b = bars[k];
    if (b.low <= s) return done(b.open <= s ? b.open : s, halfAt != null || s > stop ? "trail" : "loss", k);
    if (target != null && b.high >= target) return done(b.open >= target ? b.open : target, "win", k);
    if (x.half && halfAt == null && b.high >= t1) halfAt = b.open >= t1 ? b.open : t1;
    if (x.trail) {
      high = Math.max(high, b.high);
      s = Math.max(s, high - x.trail * atrAtEntry);
    }
  }
  return done(bars[last].close, "timeout", last);
}

// A cheap test first: a confirmed breakout needs an up day on 1.3x volume within the last 3 bars.
function maybe(bars, i, avgVol) {
  for (let j = i; j > i - 3 && j > 0; j--) if (bars[j].close > bars[j - 1].close && avgVol[j] > 0 && bars[j].volume >= avgVol[j] * 1.3) return true;
  return false;
}

export function signalsFor(stock, bars) {
  const out = [];
  if (!bars || bars.length < WINDOW + HOLD) return out;
  const n = bars.length;
  const avgVol = bars.map((_, i) => (i < 20 ? 0 : bars.slice(i - 20, i).reduce((s, b) => s + (b.volume || 0), 0) / 20));
  const closes = bars.map((b) => b.close);
  const atrs = atr(bars, 14);
  const e50 = ema(closes, 50),
    rsi = rsiOf(closes, 14);
  const weeks = resample(bars, "1W");
  let lastSignal = -Infinity;
  for (let i = WINDOW; i < n - 1; i++) {
    if (i - lastSignal < 10 || !maybe(bars, i, avgVol)) continue;
    const row = scanRow(stock, bars.slice(i - WINDOW + 1, i + 1), 0); // 0: a past day, read as a full session
    if (!isBaseSignal(row) || !row.plan) continue;
    lastSignal = i;
    const b = bars[i];
    const entry = bars[i + 1].open,
      stop = row.plan.stop,
      target = row.plan.targets[0].price;
    if (!(entry > stop) || !(target > entry)) continue;
    // the week trend as of this day: the weeks that had closed by then
    const wk = weeks.filter((w) => w.time + 7 * 86400 <= b.time + 86400);
    const wr = wk.length >= 30 ? readTimeframe(wk.slice(-150)) : null;
    // what happened, under each way out
    const a = atrs[i] || entry - stop;
    const exits = {};
    for (const [k, x] of Object.entries(EXITS)) exits[k] = simulate(bars, i, entry, stop, a, target, x);
    const main = exits.t1;
    const range = b.high - b.low;
    out.push({
      code: stock.code,
      time: b.time,
      entry,
      stop,
      target,
      ...main,
      exits,
      ret10: Math.round((((bars[Math.min(n - 1, i + 10)].close - entry) / entry) * 100 - COST) * 100) / 100,
      // the facts the stricter rules test
      rsi: Math.round(rsi[i] || 0),
      weekly: wr ? wr.trend : 0,
      breakVol: row.breakout?.vol ?? 0,
      value: row.value,
      closePos: range > 0 ? Math.round(((b.close - b.low) / range) * 100) / 100 : 0.5,
      aboveEma50: b.close > (e50[i] || Infinity),
      rr: row.plan.targets[0].rr,
    });
  }
  return out;
}

// Win rate, average return and the rest, for one list of signals.
export function stats(events, exit = null) {
  if (exit) events = events.map((e) => ({ ...e, ...e.exits[exit] }));
  const n = events.length;
  if (!n) return { n: 0 };
  const wins = events.filter((e) => e.result === "win").length,
    losses = events.filter((e) => e.result === "loss").length;
  const sum = (k) => events.reduce((s, e) => s + e[k], 0);
  const gain = events.filter((e) => e.ret > 0).reduce((s, e) => s + e.ret, 0),
    loss = -events.filter((e) => e.ret < 0).reduce((s, e) => s + e.ret, 0);
  const r2 = (v) => Math.round(v * 100) / 100;
  return {
    n,
    wins,
    losses,
    timeouts: n - wins - losses,
    winRate: Math.round((wins / n) * 100),
    hitTargetFirst: wins + losses ? Math.round((wins / (wins + losses)) * 100) : 0,
    avgRet: r2(sum("ret") / n),
    avgRet10: r2(sum("ret10") / n),
    total: r2(sum("ret")),
    profitable: Math.round((events.filter((e) => e.ret > 0).length / n) * 100),
    avgR: r2(sum("r") / n),
    profitFactor: loss ? r2(gain / loss) : null,
    avgDays: Math.round((sum("days") / n) * 10) / 10,
  };
}

// Every rule set under every way out, on the years used to choose (before 2025) and on the
// years kept aside to check the choice (2025 on), plus the whole history by year.
export const SPLIT = Date.UTC(2025, 0, 1) / 1000;
// the rules and exit the scanner and the alerts use (kuwait-scan.js ENTRY_RULES and TRAIL_ATR)
export const LIVE = { variant: "combo", exit: "trail" };
export function compare(events) {
  const train = events.filter((e) => e.time < SPLIT),
    check = events.filter((e) => e.time >= SPLIT);
  const grid = {};
  for (const [v, V] of Object.entries(VARIANTS))
    for (const x of Object.keys(EXITS)) {
      const tr = stats(train.filter(V.test), x),
        ck = stats(check.filter(V.test), x);
      grid[`${v}|${x}`] = { variant: v, exit: x, ar: `${V.ar} · ${EXITS[x].ar}`, train: tr, check: ck };
    }
  // the choice: the best average return on the earlier years, among rule sets with 100+ signals there
  const best = Object.values(grid)
    .filter((g) => g.train.n >= 100)
    .sort((a, b) => b.train.avgRet - a.train.avgRet)[0];
  const byVariant = {};
  for (const [k, v] of Object.entries(VARIANTS)) byVariant[k] = { ar: v.ar, ...stats(events.filter(v.test)) };
  const yearsOf = (es) => {
    const y = {};
    for (const e of es) (y[new Date(e.time * 1000).getUTCFullYear()] ||= []).push(e);
    return y;
  };
  const byYear = Object.fromEntries(Object.entries(yearsOf(events)).map(([y, es]) => [y, stats(es)]));
  const bestByYear = best ? Object.fromEntries(Object.entries(yearsOf(events.filter(VARIANTS[best.variant].test))).map(([y, es]) => [y, stats(es, best.exit)])) : null;
  // what the live alerts use now: the combo rules with the trailing stop
  const liveEv = events.filter(VARIANTS[LIVE.variant].test);
  const live = { ...LIVE, all: stats(liveEv, LIVE.exit), train: stats(liveEv.filter((e) => e.time < SPLIT), LIVE.exit), check: stats(liveEv.filter((e) => e.time >= SPLIT), LIVE.exit), byYear: Object.fromEntries(Object.entries(yearsOf(liveEv)).map(([y, es]) => [y, stats(es, LIVE.exit)])) };
  return { byVariant, byYear, grid, best, bestByYear, live };
}
