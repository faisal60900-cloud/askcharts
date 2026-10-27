// Market Reader (قارئ السوق): one reading of a symbol across timeframes, in Arabic, for the
// side panel and for AskCharts AI. Plain numbers in, plain object out; no page needed.
//
// For each timeframe: a trend score from four checks (price vs EMA 20, EMA 20 vs EMA 50, the
// slope of EMA 20, and swing structure: higher highs and lows or lower ones), and the nearest
// support and resistance from swing clusters. For the main timeframe also: demand and supply
// zones (the cluster's range, widened by a fraction of ATR), relative volume, RSI, ATR%, a
// compression check, the market state and a one-line reading. Every level carries how many
// times price turned there, so "strong" means something you can count.
//
// Bars are {time, open, high, low, close, volume}, oldest first.
import { ema, atr, rsiOf, sma } from "./indicators.js";
import { swings } from "./agent-analysis.js";

export const READER_TFS = [
  { tf: "1M", ar: "شهري", weight: 3 },
  { tf: "1W", ar: "أسبوعي", weight: 3 },
  { tf: "1D", ar: "يومي", weight: 2.5 },
  { tf: "4h", ar: "4 ساعات", weight: 2 },
  { tf: "1h", ar: "ساعة", weight: 1.5 },
  { tf: "30m", ar: "30 دقيقة", weight: 1 },
  { tf: "15m", ar: "15 دقيقة", weight: 1 },
];

const ok = (v) => typeof v === "number" && Number.isFinite(v);
const last = (a) => {
  for (let i = a.length - 1; i >= 0; i--) if (ok(a[i])) return a[i];
  return NaN;
};
const r1 = (v) => (ok(v) ? Math.round(v * 10) / 10 : null);
// prices keep the precision they need: 9635.4, 753.25, 3.524, 0.0001234
export const rp = (v) => {
  if (!ok(v)) return null;
  const a = Math.abs(v);
  const d = a >= 1000 ? 1 : a >= 100 ? 2 : a >= 1 ? 3 : Math.min(8, 3 - Math.floor(Math.log10(a || 1e-9)));
  return Number(v.toFixed(d));
};
const pct = (a, b) => (ok(a) && ok(b) && b !== 0 ? ((a - b) / b) * 100 : null);

export const TREND = {
  2: { ar: "صاعد قوي", dir: 1 },
  1: { ar: "صاعد", dir: 1 },
  0: { ar: "محايد", dir: 0 },
  "-1": { ar: "هابط", dir: -1 },
  "-2": { ar: "هابط قوي", dir: -1 },
};
// -4..4 to the five labels
const band = (s) => (s >= 3 ? 2 : s >= 1 ? 1 : s <= -3 ? -2 : s <= -1 ? -1 : 0);

// Swing clusters: swing prices within half an average bar range join one level. Each level keeps
// its range (for zones) and its touch count.
export function clusters(bars, { strength = 3, lookback = 300 } = {}) {
  const part = bars.slice(-lookback);
  if (part.length < strength * 2 + 3) return [];
  const avg = part.reduce((a, b) => a + (b.high - b.low), 0) / part.length || 1e-9;
  const groups = [];
  for (const s of swings(part, strength).sort((a, b) => a.price - b.price)) {
    const g = groups.at(-1);
    // join the level within half a bar's range, and never let one level grow past one bar's range
    // (a chain of near prices would otherwise make a 600-800 "level")
    if (g && s.price - g.hi <= avg * 0.5 && s.price - g.lo <= avg) {
      g.prices.push(s.price);
      g.hi = s.price;
      g.kinds.add(s.kind);
      g.lastTime = Math.max(g.lastTime, s.time);
    } else groups.push({ prices: [s.price], lo: s.price, hi: s.price, kinds: new Set([s.kind]), lastTime: s.time });
  }
  return groups.map((g) => ({
    price: g.prices.reduce((a, b) => a + b, 0) / g.prices.length,
    lo: g.lo,
    hi: g.hi,
    touches: g.prices.length,
    lastTime: g.lastTime,
  }));
}

// Higher highs and higher lows (+1), lower highs and lower lows (-1), mixed (0), from the last two
// swing highs and the last two swing lows.
export function structure(bars, strength = 3) {
  const sw = swings(bars.slice(-200), strength);
  const hs = sw.filter((s) => s.kind === "high").slice(-2);
  const ls = sw.filter((s) => s.kind === "low").slice(-2);
  if (hs.length < 2 || ls.length < 2) return 0;
  const up = hs[1].price > hs[0].price && ls[1].price > ls[0].price;
  const dn = hs[1].price < hs[0].price && ls[1].price < ls[0].price;
  return up ? 1 : dn ? -1 : 0;
}

// Bars with a high or low far from the closes around them are bad prints (old Yahoo history
// has some: an NBK.KW month with a high of 107,381 fils). They would become fake levels, so
// they go; so do bars with no price at all.
export function clean(bars) {
  if (!bars?.length) return [];
  const good = bars.filter((b) => ok(b.close) && ok(b.high) && ok(b.low) && b.close > 0);
  return good.filter((b, i) => {
    const near = good.slice(Math.max(0, i - 6), i + 7).map((x) => x.close).sort((x, y) => x - y);
    const med = near[near.length >> 1];
    return b.high <= med * 3 && b.low >= med / 3;
  });
}

// One timeframe's trend and its nearest levels.
export function readTimeframe(raw) {
  const bars = clean(raw);
  if (bars.length < 30) return null;
  const close = bars.map((b) => b.close);
  const e20 = ema(close, 20),
    e50 = ema(close, Math.min(50, Math.max(20, bars.length - 5)));
  const price = close.at(-1);
  const a = last(e20),
    b = last(e50),
    a5 = e20[e20.length - 6];
  const checks = {
    aboveEma20: ok(a) ? Math.sign(price - a) : 0,
    ema20OverEma50: ok(a) && ok(b) ? Math.sign(a - b) : 0,
    ema20Slope: ok(a) && ok(a5) ? Math.sign(a - a5) : 0,
    structure: structure(bars),
  };
  const score = Object.values(checks).reduce((s, v) => s + v, 0);
  const lv = clusters(bars, { strength: 4 });
  // The nearest level worth naming: not one the price is sitting on (within a third of an ATR),
  // and one price turned at twice or more when there is such a level.
  const gap = (last(atr(bars, 14)) || 0) * 0.33;
  const pick = (arr) => arr.find((l) => l.touches >= 2) || arr[0] || null;
  const sup = pick(lv.filter((l) => l.price < price - gap).sort((x, y) => y.price - x.price));
  const res = pick(lv.filter((l) => l.price > price + gap).sort((x, y) => x.price - y.price));
  return { price, score, trend: band(score), checks, support: sup, resistance: res, ema20: a, ema50: b };
}

// Money in and out over the last n bars: a bar's traded value (volume × typical price) counts as
// inflow when its typical price rose from the bar before, outflow when it fell. Also Chaikin
// Money Flow (where closes sit in their bars, weighted by volume) and whether net flow is
// improving against the n bars before.
export function moneyFlow(bars, n = 20) {
  if (bars.length < n + 2) return null;
  const tp = (b) => (b.high + b.low + b.close) / 3;
  const flows = (from, to) => {
    let inn = 0,
      out = 0;
    for (let i = Math.max(1, from); i < to; i++) {
      const v = (bars[i].volume || 0) * tp(bars[i]);
      if (tp(bars[i]) > tp(bars[i - 1])) inn += v;
      else if (tp(bars[i]) < tp(bars[i - 1])) out += v;
    }
    return { inn, out };
  };
  const now = flows(bars.length - n, bars.length);
  const before = flows(bars.length - 2 * n, bars.length - n);
  let mfv = 0,
    vol = 0;
  for (const b of bars.slice(-n)) {
    const range = b.high - b.low;
    mfv += range > 0 ? (((b.close - b.low) - (b.high - b.close)) / range) * (b.volume || 0) : 0;
    vol += b.volume || 0;
  }
  const total = now.inn + now.out;
  if (!total) return null;
  const net = now.inn - now.out,
    netBefore = before.inn - before.out;
  return {
    inflow: now.inn,
    outflow: now.out,
    net,
    inflowPct: Math.round((now.inn / total) * 100),
    cmf: vol ? Math.round((mfv / vol) * 100) / 100 : 0,
    improving: net > netBefore,
  };
}

// Buying and selling volume, estimated from each candle: the share of the bar's range below the
// close counts as buying, the share above as selling (close at the high: all buying). Real
// trade-by-trade data isn't in the free feeds, so this is an estimate and says so. Also the bars
// with unusual volume (2x the 20-bar average) that closed strongly one way: big buying or selling.
const split = (b) => {
  const r = b.high - b.low,
    v = b.volume || 0;
  const buy = r > 0 ? v * ((b.close - b.low) / r) : b.close >= b.open ? v : 0;
  return { buy, sell: v - buy, value: v * ((b.high + b.low + b.close) / 3) };
};
export function orderFlow(bars, n = 20) {
  if (bars.length < n + 1) return null;
  const sum = (arr) => arr.reduce((t, b) => {
    const x = split(b);
    t.buy += x.buy;
    t.sell += x.sell;
    t.buyValue += x.value * (x.buy / Math.max(1, x.buy + x.sell));
    t.sellValue += x.value * (x.sell / Math.max(1, x.buy + x.sell));
    return t;
  }, { buy: 0, sell: 0, buyValue: 0, sellValue: 0 });
  const period = sum(bars.slice(-n)),
    last = sum(bars.slice(-1));
  const vols = bars.map((b) => b.volume || 0);
  const big = [];
  for (let i = Math.max(21, bars.length - 60); i < bars.length; i++) {
    const avg = vols.slice(i - 20, i).reduce((a, v) => a + v, 0) / 20;
    if (!avg || vols[i] < avg * 2) continue;
    const b = bars[i],
      r = b.high - b.low,
      at = r > 0 ? (b.close - b.low) / r : 0.5;
    if (at >= 0.6 && b.close >= b.open) big.push({ time: b.time, kind: "buy", rel: Math.round((vols[i] / avg) * 10) / 10, price: b.low });
    else if (at <= 0.4 && b.close <= b.open) big.push({ time: b.time, kind: "sell", rel: Math.round((vols[i] / avg) * 10) / 10, price: b.high });
  }
  const pctOf = (t) => (t.buy + t.sell ? Math.round((t.buy / (t.buy + t.sell)) * 100) : 50);
  return {
    period: { bars: n, buyPct: pctOf(period), buyValue: period.buyValue, sellValue: period.sellValue },
    lastBar: { buyPct: pctOf(last), buyValue: last.buyValue, sellValue: last.sellValue },
    big,
    estimated: true,
  };
}
// The same split over today's 15-minute bars: the session as it happens.
export function todayFlow(bars15) {
  if (!bars15?.length) return null;
  const day = new Date(bars15.at(-1).time * 1000).toISOString().slice(0, 10);
  const today = bars15.filter((b) => new Date(b.time * 1000).toISOString().slice(0, 10) === day);
  if (!today.length) return null;
  let buy = 0,
    sell = 0,
    bv = 0,
    sv = 0;
  for (const b of today) {
    const x = split(b),
      tot = Math.max(1, x.buy + x.sell);
    buy += x.buy;
    sell += x.sell;
    bv += (x.value * x.buy) / tot;
    sv += (x.value * x.sell) / tot;
  }
  return { day, bars: today.length, buyPct: buy + sell ? Math.round((buy / (buy + sell)) * 100) : 50, buyValue: bv, sellValue: sv };
}

const strengthAr = (touches) => (touches >= 4 ? "قوي جدًا" : touches >= 3 ? "قوي" : touches === 2 ? "عادي" : "ضعيف");

// The whole reading. `byTf` maps a timeframe ("1D") to its bars; `main` is the timeframe for the
// detail block (zones, volume, RSI, state).
// How far through Boursa Kuwait's session (9:00-12:40 Kuwait, Sunday to Thursday) a daily bar
// is, when that bar is today's: its volume so far is that share of a full day's. 1 otherwise.
export function kuwaitSessionFraction(barTime, now = Date.now()) {
  const k = new Date(now + 3 * 3600e3),
    day = k.toISOString().slice(0, 10);
  if (new Date(barTime * 1000 + 3 * 3600e3).toISOString().slice(0, 10) !== day) return 1;
  const min = k.getUTCHours() * 60 + k.getUTCMinutes();
  return Math.min(1, Math.max(0.05, (min - 9 * 60) / 220));
}

// The same for the US session (9:30-16:00 New York time, Monday to Friday, summer time included).
export function usSessionFraction(barTime, now = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  // daily bars are stamped at midnight or the open, UTC: their UTC date is the session's date
  if (new Date(barTime * 1000).toISOString().slice(0, 10) !== today) return 1;
  const min = Number(parts.hour) * 60 + Number(parts.minute);
  return usVolumeShare(min - (9 * 60 + 30));
}
// The share of a US day's volume traded by a minute of the session: the opening auction and first
// half hour are heavy, midday light, the last half hour and closing auction heavy again (a typical
// U-shaped day). Linear between these points.
const US_CURVE = [[0, 0.03], [30, 0.15], [90, 0.3], [150, 0.42], [210, 0.52], [270, 0.62], [330, 0.75], [360, 0.83], [390, 1]];
export function usVolumeShare(m) {
  if (m <= 0) return US_CURVE[0][1];
  for (let k = 1; k < US_CURVE.length; k++) {
    const [m1, v1] = US_CURVE[k],
      [m0, v0] = US_CURVE[k - 1];
    if (m <= m1) return v0 + ((v1 - v0) * (m - m0)) / (m1 - m0);
  }
  return 1;
}

export function readMarket(byTf, { main = "1D", symbol = "", sessionFraction = 1 } = {}) {
  const frames = READER_TFS.map((f) => ({ ...f, r: readTimeframe(byTf[f.tf]) }));
  const mainBars = clean(byTf[main]);
  if (mainBars.length < 30) return { symbol, error: "لا توجد بيانات كافية لهذا الإطار." };
  const m = readTimeframe(mainBars);
  const price = m.price;

  // overall: the weighted score of every timeframe that has data, back on the -4..4 scale
  const have = frames.filter((f) => f.r);
  const wsum = have.reduce((s, f) => s + f.weight, 0) || 1;
  const overallScore = have.reduce((s, f) => s + f.r.score * f.weight, 0) / wsum;
  const overall = band(Math.round(overallScore));
  const dirs = have.map((f) => TREND[f.r.trend].dir);
  const agreeDir = Math.sign(overallScore) || 0;
  const agree = agreeDir ? dirs.filter((d) => d === agreeDir).length : dirs.filter((d) => d === 0).length;

  // the main timeframe's numbers
  const close = mainBars.map((b) => b.close);
  const rsi = last(rsiOf(close, 14));
  const atrArr = atr(mainBars, 14);
  const atrNow = last(atrArr);
  const atrAvg = last(sma(atrArr.map((v) => (ok(v) ? v : NaN)), 50)) || atrNow;
  const atrPct = ok(atrNow) && price ? (atrNow / price) * 100 : null;
  const vols = mainBars.map((b) => b.volume || 0);
  const volAvg = vols.slice(-21, -1).reduce((s, v) => s + v, 0) / Math.max(1, Math.min(20, vols.length - 1));
  // today's bar while the session is open: compare its volume with that share of a normal day
  const frac = Math.min(1, Math.max(0.05, sessionFraction || 1));
  const relVol = volAvg > 0 ? vols.at(-1) / (volAvg * frac) : null;
  const prevVol = volAvg > 0 && vols.length > 1 ? vols.at(-2) / volAvg : null;
  const squeeze = ok(atrNow) && ok(atrAvg) && atrNow < atrAvg * 0.8;

  // a zone is the level's own range, widened to at least ±0.15 ATR and never past ±0.6 ATR
  const zone = (l) => (l ? { from: rp(Math.max(l.price - atrNow * 0.6, Math.min(l.lo, l.price - atrNow * 0.15))), to: rp(Math.min(l.price + atrNow * 0.6, Math.max(l.hi, l.price + atrNow * 0.15))) } : null);
  const sup = m.support,
    res = m.resistance;
  const dSup = sup ? pct(price, sup.price) : null; // how far above support, %
  const dRes = res ? pct(res.price, price) : null; // how far below resistance, %
  let position = "في المنتصف";
  if (sup && res) {
    const f = (price - sup.price) / (res.price - sup.price);
    position = f >= 0.66 ? "أقرب إلى المقاومة" : f <= 0.34 ? "أقرب إلى الدعم" : "في المنتصف";
  } else if (!res) position = "فوق كل المقاومات القريبة";
  else if (!sup) position = "تحت كل الدعوم القريبة";

  // broke a level in the last 3 bars?
  const prior = mainBars.slice(-4, -1);
  const lv = clusters(mainBars, { strength: 4 });
  const brokeUp = lv.find((l) => price > l.hi && prior.some((b) => b.close <= l.hi) && l.touches >= 2);
  const brokeDown = lv.find((l) => price < l.lo && prior.some((b) => b.close >= l.lo) && l.touches >= 2);

  // A break is confirmed by the volume of the bar that made it (today's measured against the share
  // of the session gone), not by a busy bar before it that didn't break anything.
  const n = mainBars.length;
  const relAt = (i) => (volAvg > 0 ? vols[i] / (volAvg * (i === n - 1 ? frac : 1)) : 0);
  const breakVol = (l, up) => {
    for (let i = n - 1; i >= Math.max(1, n - 3); i--) {
      const c = mainBars[i].close,
        pc = mainBars[i - 1].close;
      if (up ? c > l.hi && pc <= l.hi : c < l.lo && pc >= l.lo) return relAt(i);
    }
    return relVol ?? 0;
  };
  const confirmVol = brokeUp ? breakVol(brokeUp, true) : brokeDown ? breakVol(brokeDown, false) : relVol ?? 0;
  // state, first match wins
  let state, stateKey;
  if (brokeUp && confirmVol >= 1.3) [stateKey, state] = ["breakout", `اختراق ${rp(brokeUp.price)} بسيولة`];
  else if (brokeDown && confirmVol >= 1.3) [stateKey, state] = ["breakdown", `كسر ${rp(brokeDown.price)} بسيولة`];
  else if (brokeUp) [stateKey, state] = ["weakBreakout", `اختراق ${rp(brokeUp.price)} بسيولة ضعيفة`];
  else if (brokeDown) [stateKey, state] = ["weakBreakdown", `كسر ${rp(brokeDown.price)} بسيولة ضعيفة`];
  else if (ok(rsi) && rsi >= 70) [stateKey, state] = ["overbought", "تشبع شرائي"];
  else if (ok(rsi) && rsi <= 30) [stateKey, state] = ["oversold", "تشبع بيعي"];
  else if (squeeze && position !== "أقرب إلى المقاومة" && overall <= 0) [stateKey, state] = ["accumulation", "تجميع هادئ"];
  else if (squeeze && position === "أقرب إلى المقاومة" && overall >= 0) [stateKey, state] = ["distribution", "تصريف هادئ"];
  else if (squeeze) [stateKey, state] = ["squeeze", "تذبذب ضيق"];
  else if (overall >= 1 && ok(rsi) && rsi >= 50) [stateKey, state] = ["uptrend", "اتجاه صاعد"];
  else if (overall <= -1 && ok(rsi) && rsi <= 50) [stateKey, state] = ["downtrend", "اتجاه هابط"];
  else [stateKey, state] = ["range", "تذبذب"];

  // how much the timeframes back the overall direction, 0-100
  const confidence = Math.round((agree / Math.max(1, have.length)) * 100);

  const liq = relVol == null ? "غير متاحة" : relVol >= 1.5 ? "مرتفعة" : relVol >= 0.8 ? "طبيعية" : "ضعيفة";

  // ---------- money flow, breakout, signal balance and a levels plan ----------
  const flow = moneyFlow(mainBars, 20);
  const up = brokeUp ? lv.filter((l) => price > l.hi && prior.some((b) => b.close <= l.hi) && l.touches >= 2).sort((a, b) => b.price - a.price)[0] : null;
  const dn = brokeDown ? lv.filter((l) => price < l.lo && prior.some((b) => b.close >= l.lo) && l.touches >= 2).sort((a, b) => a.price - b.price)[0] : null;
  let breakout = null;
  if (up) breakout = { dir: "up", level: rp(up.price), vol: Math.round(confirmVol * 10) / 10, confirmed: confirmVol >= 1.3, ar: confirmVol >= 1.3 ? "اختراق مؤكد بسيولة" : "اختراق بسيولة ضعيفة" };
  else if (dn) breakout = { dir: "down", level: rp(dn.price), vol: Math.round(confirmVol * 10) / 10, confirmed: confirmVol >= 1.3, ar: confirmVol >= 1.3 ? "كسر مؤكد بسيولة" : "كسر بسيولة ضعيفة" };
  else if (res && dRes != null && dRes <= Math.max(0.6, (atrPct ?? 1) * 0.6) && (relVol ?? 0) >= 1)
    breakout = { dir: "near", level: rp(res.price), confirmed: false, ar: `قريب من اختراق ${rp(res.price)}` };
  else if (sup && dSup != null && dSup <= Math.max(0.6, (atrPct ?? 1) * 0.6) && (relVol ?? 0) >= 1)
    breakout = { dir: "nearDown", level: rp(sup.price), confirmed: false, ar: `قريب من كسر ${rp(sup.price)}` };

  const mainTrend = TREND[m.trend].dir;
  const checks = [
    { ar: "الاتجاه العام صاعد", ok: overall > 0, bad: overall < 0, badAr: "الاتجاه العام هابط" },
    { ar: `اتجاه الإطار الرئيسي صاعد`, ok: mainTrend > 0, bad: mainTrend < 0, badAr: "اتجاه الإطار الرئيسي هابط" },
    { ar: "السعر فوق متوسط 20", ok: m.checks.aboveEma20 > 0, bad: m.checks.aboveEma20 < 0, badAr: "السعر تحت متوسط 20" },
    { ar: "RSI في منطقة قوة (50 - 70)", ok: ok(rsi) && rsi >= 50 && rsi < 70, bad: ok(rsi) && (rsi < 45 || rsi >= 75), badAr: ok(rsi) && rsi >= 75 ? "RSI في تشبع شرائي" : "RSI ضعيف (تحت 45)" },
    { ar: "السيولة الداخلة أكبر من الخارجة", ok: !!flow && flow.inflowPct >= 55, bad: !!flow && flow.inflowPct <= 45, badAr: "السيولة الخارجة أكبر من الداخلة" },
    { ar: "صافي السيولة يتحسن", ok: !!flow && flow.improving && flow.net > 0, bad: !!flow && !flow.improving && flow.net < 0, badAr: "صافي السيولة يضعف" },
    { ar: "اختراق مؤكد لمقاومة", ok: breakout?.dir === "up" && breakout.confirmed, bad: breakout?.dir === "down" && breakout.confirmed, badAr: "كسر مؤكد لدعم" },
    { ar: "السعر قرب دعم قوي", ok: position === "أقرب إلى الدعم" && (sup?.touches ?? 0) >= 3, bad: position === "أقرب إلى المقاومة" && (res?.touches ?? 0) >= 3, badAr: "السعر قرب مقاومة قوية" },
  ].map((c) => ({ ar: c.ok ? c.ar : c.bad ? c.badAr : c.ar, v: c.ok ? 1 : c.bad ? -1 : 0 }));
  const pos = checks.filter((c) => c.v > 0).length,
    neg = checks.filter((c) => c.v < 0).length;
  const net = pos - neg;
  const signal = {
    positive: pos,
    negative: neg,
    of: checks.length,
    key: net >= 4 ? 2 : net >= 2 ? 1 : net <= -4 ? -2 : net <= -2 ? -1 : 0,
    checks,
  };
  signal.ar = { 2: "إشارات إيجابية قوية", 1: "إشارات إيجابية", 0: "إشارات متعادلة", "-1": "إشارات سلبية", "-2": "إشارات سلبية قوية" }[signal.key];

  // ---------- a buy plan by fixed rules: entry zone, stop, three targets ----------
  // Entry: a retest of a level just broken, else the demand zone, else just under the price.
  // Stop: half an ATR under the entry zone and at least one ATR under its middle. Targets: the
  // next three levels above, filled in with 1.5R / 2.5R / 3.5R when there are fewer.
  const A = atrNow || price * 0.01;
  let entry;
  if (breakout?.dir === "up") entry = { from: breakout.level - A * 0.3, to: breakout.level + A * 0.3, why: `إعادة اختبار الاختراق ${rp(breakout.level)}` };
  else if (sup) entry = { from: Math.max(sup.price - A * 0.6, Math.min(sup.lo, sup.price - A * 0.15)), to: Math.min(sup.price + A * 0.6, Math.max(sup.hi, sup.price + A * 0.15)), why: `منطقة الطلب عند الدعم ${rp(sup.price)}` };
  else entry = { from: price - A * 0.5, to: price, why: "تحت السعر الحالي بنصف ATR" };
  const mid = (entry.from + entry.to) / 2;
  const stop = Math.min(entry.from - A * 0.5, mid - A);
  const risk = mid - stop;
  const lvAbove = lv.filter((l) => l.price > mid + A * 0.5).sort((a, b) => a.price - b.price);
  const tps = [];
  for (const l of lvAbove) if (!tps.length || l.price > tps.at(-1) + A * 0.5) tps.push(l.price);
  const fromLevels = new Set(tps.slice(0, 3));
  while (tps.length < 3) tps.push(Math.max(mid + risk * [1.5, 2.5, 3.5][tps.length], (tps.at(-1) ?? mid) + Math.max(A, risk)));
  const targets = tps.slice(0, 3).map((t, i) => ({ n: i + 1, price: rp(t), pct: r1(((t - mid) / mid) * 100), rr: Math.round(((rp(t) - rp(mid)) / (rp(mid) - rp(stop))) * 10) / 10, from: fromLevels.has(t) ? "مقاومة" : "مضاعف المخاطرة" }));
  const where = price > entry.to ? `السعر فوق منطقة الدخول بـ ${r1(((price - entry.to) / entry.to) * 100)}%` : price < entry.from ? `السعر تحت منطقة الدخول بـ ${r1(((entry.from - price) / entry.from) * 100)}%` : "السعر داخل منطقة الدخول الآن";
  const plan =
    risk > 0 && targets.length
      ? {
          entryZone: { from: rp(entry.from), to: rp(entry.to) },
          entry: rp(mid),
          entryWhy: entry.why,
          where,
          stop: rp(stop),
          stopPct: r1((risk / mid) * 100),
          targets,
          // older names the panel and AI already read
          invalidation: rp(stop),
          target1: targets[0].price,
          target2: targets[1]?.price ?? null,
          riskPct: r1((risk / mid) * 100),
          rewardPct: targets[0].pct,
          rr: targets[0].rr,
          note: "مستويات محسوبة بقواعد ثابتة، وليست توصية. القرار وإدارة المخاطرة عليك.",
        }
      : null;

  // ---------- buying and selling, estimated from the candles ----------
  const trades = orderFlow(mainBars, 20);
  const intra = byTf["15m"] ? todayFlow(clean(byTf["15m"])) : null;

  // the reading, in plain Arabic; descriptive only
  const parts = [`الاتجاه العام ${TREND[overall].ar}`, `${agree} من ${have.length} أطر ${agreeDir > 0 ? "صاعدة" : agreeDir < 0 ? "هابطة" : "محايدة"}`];
  if (stateKey === "accumulation") parts.push("السعر يهدأ قرب الدعم، راقب الثبات فوق " + rp(sup?.price ?? price));
  else if (stateKey === "distribution") parts.push("السعر يهدأ قرب المقاومة، راقب ردة الفعل عند " + rp(res?.price ?? price));
  else if (stateKey === "breakout" || stateKey === "weakBreakout") parts.push(`راقب الثبات فوق ${rp(brokeUp.price)}${stateKey === "weakBreakout" ? "، السيولة لا تؤكد الاختراق بعد" : ""}`);
  else if (stateKey === "breakdown" || stateKey === "weakBreakdown") parts.push(`راقب ${rp(brokeDown.price)} كمقاومة جديدة${stateKey === "weakBreakdown" ? "، السيولة لا تؤكد الكسر بعد" : ""}`);
  else if (position === "أقرب إلى المقاومة" && res) parts.push(`السعر قرب المقاومة ${rp(res.price)} (${r1(dRes)}%)`);
  else if (position === "أقرب إلى الدعم" && sup) parts.push(`السعر قرب الدعم ${rp(sup.price)} (${r1(dSup)}%)`);
  if (flow) parts.push(`السيولة الداخلة ${flow.inflowPct}% مقابل ${100 - flow.inflowPct}% خارجة`);
  if (liq === "ضعيفة") parts.push("والسيولة ضعيفة");
  else if (liq === "مرتفعة") parts.push("والسيولة مرتفعة");

  return {
    symbol,
    main,
    price: rp(price),
    overall: { key: overall, ar: TREND[overall].ar, score: r1(overallScore), agree, of: have.length },
    support: sup ? { price: rp(sup.price), distancePct: r1(dSup), touches: sup.touches, strength: strengthAr(sup.touches) } : null,
    resistance: res ? { price: rp(res.price), distancePct: r1(dRes), touches: res.touches, strength: strengthAr(res.touches) } : null,
    demandZone: zone(sup),
    supplyZone: zone(res),
    position,
    frames: frames.map((f) => ({
      tf: f.tf,
      ar: f.ar,
      trend: f.r ? { key: f.r.trend, ar: TREND[f.r.trend].ar, score: f.r.score } : null,
      support: f.r?.support ? rp(f.r.support.price) : null,
      resistance: f.r?.resistance ? rp(f.r.resistance.price) : null,
    })),
    state: { key: stateKey, ar: state },
    liquidity: { relVol: relVol == null ? null : Math.round(relVol * 10) / 10, previousBar: prevVol == null ? null : Math.round(prevVol * 10) / 10, ar: liq },
    rsi: r1(rsi),
    atrPct: atrPct == null ? null : Math.round(atrPct * 100) / 100,
    squeeze,
    confidence,
    flow: flow && { inflowPct: flow.inflowPct, outflowPct: 100 - flow.inflowPct, inflow: flow.inflow, outflow: flow.outflow, net: flow.net, cmf: flow.cmf, improving: flow.improving },
    breakout,
    signal,
    plan,
    trades: trades && { ...trades, today: intra },
    reading: parts.join("، ") + ".",
    note: "قراءة وصفية للبيانات، وليست توصية شراء أو بيع.",
  };
}
