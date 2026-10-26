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
    if (g && s.price - g.hi <= avg * 0.5) {
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

const strengthAr = (touches) => (touches >= 4 ? "قوي جدًا" : touches >= 3 ? "قوي" : touches === 2 ? "عادي" : "ضعيف");

// The whole reading. `byTf` maps a timeframe ("1D") to its bars; `main` is the timeframe for the
// detail block (zones, volume, RSI, state).
export function readMarket(byTf, { main = "1D", symbol = "" } = {}) {
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
  const relVol = volAvg > 0 ? vols.at(-1) / volAvg : null;
  const prevVol = volAvg > 0 && vols.length > 1 ? vols.at(-2) / volAvg : null;
  const squeeze = ok(atrNow) && ok(atrAvg) && atrNow < atrAvg * 0.8;

  const zone = (l) => (l ? { from: r1(Math.min(l.lo, l.price - atrNow * 0.15)), to: r1(Math.max(l.hi, l.price + atrNow * 0.15)) } : null);
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

  // a breakout bar may still be forming: confirm with the stronger of it and the bar before
  const confirmVol = Math.max(relVol ?? 0, prevVol ?? 0);
  // state, first match wins
  let state, stateKey;
  if (brokeUp && confirmVol >= 1.3) [stateKey, state] = ["breakout", `اختراق ${r1(brokeUp.price)} بسيولة`];
  else if (brokeDown && confirmVol >= 1.3) [stateKey, state] = ["breakdown", `كسر ${r1(brokeDown.price)} بسيولة`];
  else if (brokeUp) [stateKey, state] = ["weakBreakout", `اختراق ${r1(brokeUp.price)} بسيولة ضعيفة`];
  else if (brokeDown) [stateKey, state] = ["weakBreakdown", `كسر ${r1(brokeDown.price)} بسيولة ضعيفة`];
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
  if (up) breakout = { dir: "up", level: r1(up.price), confirmed: confirmVol >= 1.3, ar: confirmVol >= 1.3 ? "اختراق مؤكد بسيولة" : "اختراق بسيولة ضعيفة" };
  else if (dn) breakout = { dir: "down", level: r1(dn.price), confirmed: confirmVol >= 1.3, ar: confirmVol >= 1.3 ? "كسر مؤكد بسيولة" : "كسر بسيولة ضعيفة" };
  else if (res && dRes != null && dRes <= Math.max(0.6, (atrPct ?? 1) * 0.6) && (relVol ?? 0) >= 1)
    breakout = { dir: "near", level: r1(res.price), confirmed: false, ar: `قريب من اختراق ${r1(res.price)}` };
  else if (sup && dSup != null && dSup <= Math.max(0.6, (atrPct ?? 1) * 0.6) && (relVol ?? 0) >= 1)
    breakout = { dir: "nearDown", level: r1(sup.price), confirmed: false, ar: `قريب من كسر ${r1(sup.price)}` };

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

  // levels, not advice: where the idea would start, where it would be wrong, where it would aim
  const above = lv.filter((l) => l.price > price + (atrNow || 0) * 0.33).sort((a, b) => a.price - b.price);
  const t1 = res ? res.price : above[0]?.price;
  const t2 = above.find((l) => l.price > (t1 ?? price) * 1.003)?.price ?? null;
  const dz = zone(sup);
  const invalid = dz ? dz.from - (atrNow || 0) * 0.5 : null;
  const plan =
    t1 && invalid && invalid < price
      ? {
          entryZone: dz,
          invalidation: r1(invalid),
          target1: r1(t1),
          target2: t2 ? r1(t2) : null,
          riskPct: r1(((price - invalid) / price) * 100),
          rewardPct: r1(((t1 - price) / price) * 100),
          rr: Math.round(((t1 - price) / (price - invalid)) * 10) / 10,
        }
      : null;

  // the reading, in plain Arabic; descriptive only
  const parts = [`الاتجاه العام ${TREND[overall].ar}`, `${agree} من ${have.length} أطر ${agreeDir > 0 ? "صاعدة" : agreeDir < 0 ? "هابطة" : "محايدة"}`];
  if (stateKey === "accumulation") parts.push("السعر يهدأ قرب الدعم، راقب الثبات فوق " + r1(sup?.price ?? price));
  else if (stateKey === "distribution") parts.push("السعر يهدأ قرب المقاومة، راقب ردة الفعل عند " + r1(res?.price ?? price));
  else if (stateKey === "breakout" || stateKey === "weakBreakout") parts.push(`راقب الثبات فوق ${r1(brokeUp.price)}${stateKey === "weakBreakout" ? "، السيولة لا تؤكد الاختراق بعد" : ""}`);
  else if (stateKey === "breakdown" || stateKey === "weakBreakdown") parts.push(`راقب ${r1(brokeDown.price)} كمقاومة جديدة${stateKey === "weakBreakdown" ? "، السيولة لا تؤكد الكسر بعد" : ""}`);
  else if (position === "أقرب إلى المقاومة" && res) parts.push(`السعر قرب المقاومة ${r1(res.price)} (${r1(dRes)}%)`);
  else if (position === "أقرب إلى الدعم" && sup) parts.push(`السعر قرب الدعم ${r1(sup.price)} (${r1(dSup)}%)`);
  if (flow) parts.push(`السيولة الداخلة ${flow.inflowPct}% مقابل ${100 - flow.inflowPct}% خارجة`);
  if (liq === "ضعيفة") parts.push("والسيولة ضعيفة");
  else if (liq === "مرتفعة") parts.push("والسيولة مرتفعة");

  return {
    symbol,
    main,
    price: r1(price),
    overall: { key: overall, ar: TREND[overall].ar, score: r1(overallScore), agree, of: have.length },
    support: sup ? { price: r1(sup.price), distancePct: r1(dSup), touches: sup.touches, strength: strengthAr(sup.touches) } : null,
    resistance: res ? { price: r1(res.price), distancePct: r1(dRes), touches: res.touches, strength: strengthAr(res.touches) } : null,
    demandZone: zone(sup),
    supplyZone: zone(res),
    position,
    frames: frames.map((f) => ({
      tf: f.tf,
      ar: f.ar,
      trend: f.r ? { key: f.r.trend, ar: TREND[f.r.trend].ar, score: f.r.score } : null,
      support: f.r?.support ? r1(f.r.support.price) : null,
      resistance: f.r?.resistance ? r1(f.r.resistance.price) : null,
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
    reading: parts.join("، ") + ".",
    note: "قراءة وصفية للبيانات، وليست توصية شراء أو بيع.",
  };
}
