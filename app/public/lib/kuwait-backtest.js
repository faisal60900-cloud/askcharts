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
  trail3: { ar: "وقف متحرك أوسع (3 ATR)", trail: 3, max: 60 },
  // five targets at 1R..5R, a fifth of the position at each; the stop moves to the entry after the
  // first target and to the previous target after each next one
  scale5: { ar: "5 أهداف: 20% عند كل هدف + الوقف للدخول بعد الهدف الأول", scale: [1, 2, 3, 4, 5], max: 60 },
  // the same with nearer targets (0.75R steps), for a higher share of trades that reach the first ones
  scale5n: { ar: "5 أهداف قريبة (0.75R، 1.5R…) + الوقف للدخول بعد الأول", scale: [0.75, 1.5, 2.25, 3, 4], max: 60 },
};

export function simulate(bars, i, entry, stop, atrAtEntry, t1, x) {
  const n = bars.length,
    R = entry - stop;
  const last = Math.min(n - 1, i + x.max);
  if (x.scale) return scaleOut(bars, i, entry, stop, x, last);
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

// Selling a fifth at each target. A day that reaches the stop is read first (the careful way).
function scaleOut(bars, i, entry, stop, x, last) {
  const R = entry - stop,
    targets = x.scale.map((m) => entry + R * m),
    part = 1 / targets.length;
  let s = stop,
    hit = 0,
    sold = 0,
    value = 0;
  const done = (exitPx, k, result) => {
    value += (1 - sold) * exitPx;
    const ret = ((value - entry) / entry) * 100 - COST;
    return { result, days: k - i, ret: Math.round(ret * 100) / 100, r: Math.round(((value - entry) / R) * 100) / 100, targetsHit: hit };
  };
  for (let k = i + 1; k <= last; k++) {
    const b = bars[k];
    if (b.low <= s) return done(b.open <= s ? b.open : s, k, hit ? "partial" : "loss");
    while (hit < targets.length && b.high >= targets[hit]) {
      value += part * Math.max(targets[hit], hit === 0 && k === i + 1 ? b.open : targets[hit]);
      sold += part;
      hit++;
      s = hit === 1 ? entry : targets[hit - 2];
    }
    if (hit === targets.length) return { result: "win", days: k - i, ret: Math.round((((value - entry) / entry) * 100 - COST) * 100) / 100, r: Math.round(((value - entry) / R) * 100) / 100, targetsHit: hit };
  }
  return done(bars[last].close, last, hit ? "partial" : "timeout");
}

// How far a trade went for us before its first stop: the highest high, in R, until a day's low
// reaches the stop (within 60 sessions). Target k was reached when this is k or more.
export function excursion(bars, i, entry, stop, max = 60) {
  const R = entry - stop;
  let best = 0;
  for (let k = i + 1; k <= Math.min(bars.length - 1, i + max); k++) {
    if (bars[k].low <= stop) break;
    best = Math.max(best, (bars[k].high - entry) / R);
  }
  return Math.round(best * 100) / 100;
}

// The US market: more money, stronger momentum (strong stocks often stay above RSI 70) and a big
// part of every move is the whole market's. These sets test that.
const usLiquid = (e) => e.value >= 100e6;
export const VARIANTS_US = {
  base: { ar: "الشروط الأساسية", test: () => true },
  marketUp: { ar: "+ السوق صاعد (S&P 500 فوق متوسط 50)", test: (e) => e.marketUp },
  weeklyUp: { ar: "+ الاتجاه الأسبوعي صاعد", test: (e) => e.weekly > 0 },
  rsi5580: { ar: "+ RSI بين 55 و80", test: (e) => e.rsi >= 55 && e.rsi < 80 },
  rsi5070: { ar: "+ RSI بين 50 و70", test: (e) => e.rsi >= 50 && e.rsi < 70 },
  vol2: { ar: "+ سيولة الاختراق 2x فأكثر", test: (e) => e.breakVol >= 2 },
  vol3: { ar: "+ سيولة الاختراق 3x فأكثر", test: (e) => e.breakVol >= 3 },
  liquid: { ar: "+ تداول 100 مليون $ يوميًا فأكثر", test: usLiquid },
  strongClose: { ar: "+ إغلاق قرب قمة اليوم", test: (e) => e.closePos >= 0.7 },
  kwCombo: { ar: "شروط الكويت (أسبوعي + RSI 50-70 + إغلاق قوي)", test: (e) => e.weekly > 0 && e.rsi >= 50 && e.rsi < 70 && e.closePos >= 0.7 },
  momentum: { ar: "السوق صاعد + أسبوعي صاعد + RSI 55-80", test: (e) => e.marketUp && e.weekly > 0 && e.rsi >= 55 && e.rsi < 80 },
  momentumVol: { ar: "السوق صاعد + أسبوعي صاعد + سيولة 2x + إغلاق قوي", test: (e) => e.marketUp && e.weekly > 0 && e.breakVol >= 2 && e.closePos >= 0.7 },
  marketWeekly: { ar: "السوق صاعد + أسبوعي صاعد", test: (e) => e.marketUp && e.weekly > 0 },
};

// Saudi Arabia: Kuwait's sets and the US ones, with the whole market (an equal-weighted index of
// the listed stocks, built by lib/kwbacktest.js) above its 50-day average.
export const VARIANTS_SA = {
  base: { ar: "الشروط الأساسية", test: () => true },
  weeklyUp: { ar: "+ الاتجاه الأسبوعي صاعد", test: (e) => e.weekly > 0 },
  rsiOk: { ar: "+ RSI بين 50 و70", test: (e) => e.rsi >= 50 && e.rsi < 70 },
  vol2: { ar: "+ سيولة الاختراق 2x فأكثر", test: (e) => e.breakVol >= 2 },
  strongClose: { ar: "+ إغلاق قرب قمة اليوم", test: (e) => e.closePos >= 0.7 },
  aboveEma50: { ar: "+ السعر فوق متوسط 50", test: (e) => e.aboveEma50 },
  marketUp: { ar: "+ السوق صاعد (فوق متوسط 50)", test: (e) => e.marketUp },
  liquid: { ar: "+ تداول 10 ملايين ريال يوميًا فأكثر", test: (e) => e.value >= 10e6 },
  combo: { ar: "الأسبوعي صاعد + RSI 50-70 + إغلاق قوي", test: (e) => e.weekly > 0 && e.rsi >= 50 && e.rsi < 70 && e.closePos >= 0.7 },
  comboMarket: { ar: "السوق صاعد + الأسبوعي صاعد + RSI 50-70 + إغلاق قوي", test: (e) => e.marketUp && e.weekly > 0 && e.rsi >= 50 && e.rsi < 70 && e.closePos >= 0.7 },
  comboVol: { ar: "الأسبوعي صاعد + سيولة 2x + إغلاق قوي", test: (e) => e.weekly > 0 && e.breakVol >= 2 && e.closePos >= 0.7 },
  marketWeekly: { ar: "السوق صاعد + أسبوعي صاعد", test: (e) => e.marketUp && e.weekly > 0 },
  marketVol2: { ar: "السوق صاعد + سيولة 2x", test: (e) => e.marketUp && e.breakVol >= 2 },
};

// An equal-weighted index from many stocks' daily bars: each day the average change of the stocks
// that traded both that day and the one before, chained from 100. For a market without a usable
// index feed (Yahoo's ^TASI.SR has no history).
export function equalIndex(barsList) {
  const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);
  const moves = new Map();
  for (const bars of barsList)
    for (let i = 1; i < bars.length; i++) {
      const p = bars[i - 1].close,
        c = bars[i].close;
      if (!(p > 0) || !(c > 0) || Math.abs(c / p - 1) > 0.3) continue;
      const d = day(bars[i].time);
      const m = moves.get(d) || { t: bars[i].time, sum: 0, n: 0 };
      m.sum += c / p - 1;
      m.n++;
      moves.set(d, m);
    }
  let level = 100;
  return [...moves.values()]
    .filter((m) => m.n >= 5)
    .sort((a, b) => a.t - b.t)
    .map((m) => ({ time: m.t, close: (level *= 1 + m.sum / m.n) }));
}

// A cheap test first: a confirmed breakout needs an up day on 1.3x volume within the last 3 bars.
function maybe(bars, i, avgVol) {
  for (let j = i; j > i - 3 && j > 0; j--) if (bars[j].close > bars[j - 1].close && avgVol[j] > 0 && bars[j].volume >= avgVol[j] * 1.3) return true;
  return false;
}

// `index`: the market's own daily bars (SPY for the US), for "is the whole market going up".
export function signalsFor(stock, bars, { market = "kw", index = null } = {}) {
  const out = [];
  if (!bars || bars.length < WINDOW + HOLD) return out;
  const n = bars.length;
  const avgVol = bars.map((_, i) => (i < 20 ? 0 : bars.slice(i - 20, i).reduce((s, b) => s + (b.volume || 0), 0) / 20));
  const closes = bars.map((b) => b.close);
  const atrs = atr(bars, 14);
  const e50 = ema(closes, 50),
    rsi = rsiOf(closes, 14);
  const weeks = resample(bars, "1W");
  const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);
  let up = null;
  if (index?.length) {
    const ie = ema(index.map((b) => b.close), 50);
    up = new Map(index.map((b, k) => [day(b.time), b.close > (ie[k] || Infinity)]));
  }
  let lastSignal = -Infinity;
  for (let i = WINDOW; i < n - 1; i++) {
    if (i - lastSignal < 10 || !maybe(bars, i, avgVol)) continue;
    const row = scanRow(stock, bars.slice(i - WINDOW + 1, i + 1), 0, { market }); // 0: a past day, read as a full session
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
    const mfeR = excursion(bars, i, entry, stop);
    const range = b.high - b.low;
    out.push({
      code: stock.code,
      time: b.time,
      entry,
      stop,
      target,
      ...main,
      exits,
      mfeR,
      ret10: Math.round((((bars[Math.min(n - 1, i + 10)].close - entry) / entry) * 100 - COST) * 100) / 100,
      // the facts the stricter rules test
      rsi: Math.round(rsi[i] || 0),
      weekly: wr ? wr.trend : 0,
      breakVol: row.breakout?.vol ?? 0,
      value: row.value,
      closePos: range > 0 ? Math.round(((b.close - b.low) / range) * 100) / 100 : 0.5,
      aboveEma50: b.close > (e50[i] || Infinity),
      marketUp: up ? !!up.get(day(b.time)) : true,
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
    // how often each risk multiple was reached before the first stop
    reach: events[0]?.mfeR != null ? Object.fromEntries([0.75, 1, 1.5, 2, 2.25, 3, 4, 5].map((m) => [m, Math.round((events.filter((e) => e.mfeR >= m).length / n) * 100)])) : undefined,
    // trades that ended at breakeven or better (with the stop moved to the entry, "no loss")
    noLoss: Math.round((events.filter((e) => e.ret > -COST - 0.01).length / n) * 100),
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
export function compare(events, { variants = VARIANTS, live = LIVE } = {}) {
  const train = events.filter((e) => e.time < SPLIT),
    check = events.filter((e) => e.time >= SPLIT);
  const grid = {};
  for (const [v, V] of Object.entries(variants))
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
  for (const [k, v] of Object.entries(variants)) byVariant[k] = { ar: v.ar, ...stats(events.filter(v.test)) };
  const yearsOf = (es) => {
    const y = {};
    for (const e of es) (y[new Date(e.time * 1000).getUTCFullYear()] ||= []).push(e);
    return y;
  };
  const byYear = Object.fromEntries(Object.entries(yearsOf(events)).map(([y, es]) => [y, stats(es)]));
  const bestByYear = best ? Object.fromEntries(Object.entries(yearsOf(events.filter(variants[best.variant].test))).map(([y, es]) => [y, stats(es, best.exit)])) : null;
  // what the live alerts use now: the combo rules with the trailing stop
  const liveEv = live && variants[live.variant] ? events.filter(variants[live.variant].test) : [];
  const liveStats = live && variants[live.variant] ? { ...live, all: stats(liveEv, live.exit), train: stats(liveEv.filter((e) => e.time < SPLIT), live.exit), check: stats(liveEv.filter((e) => e.time >= SPLIT), live.exit), byYear: Object.fromEntries(Object.entries(yearsOf(liveEv)).map(([y, es]) => [y, stats(es, live.exit)])) } : null;
  return { byVariant, byYear, grid, best, bestByYear, live: liveStats };
}
