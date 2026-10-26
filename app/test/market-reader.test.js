// Market Reader: trend per timeframe, levels, zones, state and the Arabic reading, on made-up bars.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readMarket, readTimeframe, clusters, READER_TFS } from "../public/lib/market-reader.js";

// A wavy series: `drift` per bar plus a sine wave so there are swings to find.
function series(n, { start = 100, drift = 0, amp = 3, period = 12, vol = 1000, lastVol } = {}) {
  const out = [];
  let t = 1_700_000_000;
  for (let i = 0; i < n; i++) {
    const mid = start + drift * i + amp * Math.sin((i / period) * 2 * Math.PI);
    const open = mid - drift / 2,
      close = mid + drift / 2;
    out.push({ time: (t += 86400), open, close, high: Math.max(open, close) + 0.6, low: Math.min(open, close) - 0.6, volume: vol });
  }
  if (lastVol != null) out.at(-1).volume = lastVol;
  return out;
}
const all = (bars) => Object.fromEntries(READER_TFS.map((f) => [f.tf, bars]));

test("a rising market reads as rising on every timeframe", () => {
  const r = readMarket(all(series(300, { drift: 0.5 })), { symbol: "TEST" });
  assert.equal(r.overall.ar, "صاعد قوي");
  assert.equal(r.overall.agree, 7);
  assert.ok(r.frames.every((f) => f.trend.key > 0));
  assert.equal(r.confidence, 100);
  assert.match(r.reading, /الاتجاه العام صاعد قوي/);
});

test("a falling market reads as falling", () => {
  const r = readMarket(all(series(300, { start: 300, drift: -0.5 })));
  assert.ok(r.overall.key < 0, r.overall.ar);
  assert.ok(r.frames.every((f) => f.trend.key < 0));
});

test("support sits below the price and resistance above, with distances and zones", () => {
  const r = readMarket(all(series(300, { amp: 5 })));
  assert.ok(r.support.price < r.price && r.resistance.price > r.price);
  assert.ok(r.support.distancePct > 0 && r.resistance.distancePct > 0);
  assert.ok(r.demandZone.from <= r.support.price && r.demandZone.to >= r.support.price);
  assert.ok(r.supplyZone.from <= r.resistance.price && r.supplyZone.to >= r.resistance.price);
  assert.ok(r.support.touches >= 2, "a sine wave turns at the same price many times");
});

test("volume against its 20-bar average reads as liquidity", () => {
  assert.equal(readMarket(all(series(200, { amp: 4, lastVol: 200 }))).liquidity.ar, "ضعيفة");
  assert.equal(readMarket(all(series(200, { amp: 4, lastVol: 2500 }))).liquidity.ar, "مرتفعة");
  assert.equal(readMarket(all(series(200, { amp: 4 }))).liquidity.relVol, 1);
});

test("RSI and ATR% are filled; missing timeframes show as empty rows, not errors", () => {
  const bars = series(200, { amp: 4 });
  const r = readMarket({ "1D": bars, "1W": bars });
  assert.ok(r.rsi > 0 && r.rsi < 100);
  assert.ok(r.atrPct > 0);
  assert.equal(r.overall.of, 2);
  assert.equal(r.frames.find((f) => f.tf === "15m").trend, null);
});

test("too few bars on the main timeframe gives a clear Arabic message", () => {
  assert.match(readMarket({ "1D": series(10) }).error, /بيانات/);
  assert.equal(readTimeframe(series(10)), null);
  assert.deepEqual(clusters([]), []);
});

test("every reading says it is not advice", () => {
  assert.match(readMarket(all(series(200))).note, /ليست توصية/);
});

import { moneyFlow } from "../public/lib/market-reader.js";

test("money flow: rising closes on volume read as inflow, falling as outflow", () => {
  const upFlow = moneyFlow(series(80, { drift: 0.5, amp: 0.5 }));
  const dnFlow = moneyFlow(series(80, { start: 200, drift: -0.5, amp: 0.5 }));
  assert.ok(upFlow.inflowPct > 70, `${upFlow.inflowPct}`);
  assert.ok(dnFlow.inflowPct < 30, `${dnFlow.inflowPct}`);
  assert.equal(moneyFlow(series(10)), null);
});

test("a close through a twice-tested resistance on heavy volume reads as a confirmed breakout", () => {
  // a range between 95 and 105 for 120 bars, then a jump to 108 on three times the volume
  const bars = series(120, { start: 100, amp: 5, period: 20 });
  const t = bars.at(-1).time;
  bars.push({ time: t + 86400, open: 104, high: 108.6, low: 103.8, close: 108, volume: 3000 });
  const r = readMarket({ "1D": bars });
  assert.equal(r.breakout?.dir, "up", JSON.stringify(r.breakout));
  assert.equal(r.breakout.confirmed, true);
  assert.equal(r.state.key, "breakout");
  assert.match(r.state.ar, /اختراق/);
  assert.ok(r.signal.checks.some((c) => c.ar === "اختراق مؤكد لمقاومة" && c.v === 1));
});

test("the signal balance counts its checks and the plan's numbers hang together", () => {
  const r = readMarket(all(series(300, { drift: 0.5 })));
  assert.equal(r.signal.positive + r.signal.negative <= r.signal.of, true);
  assert.equal(r.signal.checks.length, 8);
  assert.ok(r.signal.key > 0, r.signal.ar);
  const f = readMarket(all(series(300, { amp: 5 })));
  if (f.plan) {
    assert.ok(f.plan.invalidation < f.price && f.plan.target1 > f.price);
    assert.ok(f.plan.rr > 0);
  }
});

import { clean } from "../public/lib/market-reader.js";

test("a bad print far from its neighbours is dropped before it can become a level", () => {
  const bars = series(60, { start: 800, amp: 10 });
  bars[20] = { ...bars[20], high: 107381.5 };
  const c = clean(bars);
  assert.equal(c.length, 59);
  assert.ok(c.every((b) => b.high < 1000));
});

import { orderFlow, todayFlow } from "../public/lib/market-reader.js";

test("buying and selling volume: a close at the high is all buying, at the low all selling", () => {
  const base = series(40, { amp: 2 });
  const t = base.at(-1).time;
  const atHigh = [...base, { time: t + 86400, open: 100, high: 104, low: 100, close: 104, volume: 5000 }];
  const atLow = [...base, { time: t + 86400, open: 104, high: 104, low: 100, close: 100, volume: 5000 }];
  assert.equal(orderFlow(atHigh).lastBar.buyPct, 100);
  assert.equal(orderFlow(atLow).lastBar.buyPct, 0);
  assert.equal(orderFlow(atHigh).big.at(-1).kind, "buy", "5x volume closing at the high is big buying");
  assert.equal(orderFlow(atLow).big.at(-1).kind, "sell");
  assert.ok(orderFlow(atHigh).estimated);
});

test("today's flow only counts the last day's 15-minute bars", () => {
  const day1 = Date.UTC(2026, 9, 25, 6) / 1000,
    day2 = Date.UTC(2026, 9, 26, 6) / 1000;
  const b = (time, close) => ({ time, open: 100, high: 101, low: 99, close, volume: 100 });
  const r = todayFlow([b(day1, 99), b(day1 + 900, 99), b(day2, 101), b(day2 + 900, 101)]);
  assert.equal(r.bars, 2);
  assert.equal(r.buyPct, 100);
});

test("the buy plan: stop under the entry, targets above it in order, reward to risk from the entry", () => {
  const r = readMarket(all(series(300, { amp: 6, period: 25 })));
  const p = r.plan;
  assert.ok(p, "a ranging market has a plan");
  assert.ok(p.stop < p.entryZone.from && p.entryZone.from <= p.entryZone.to);
  assert.equal(p.targets.length, 3);
  assert.ok(p.targets[0].price > p.entry && p.targets[1].price > p.targets[0].price && p.targets[2].price > p.targets[1].price);
  for (const t of p.targets) assert.ok(Math.abs(t.rr - (t.price - p.entry) / (p.entry - p.stop)) < 0.06, `${t.rr}`);
  assert.match(p.note, /ليست توصية/);
});

import { rp } from "../public/lib/market-reader.js";

test("prices keep the precision a cheap stock or a coin needs", () => {
  assert.equal(rp(9635.44), 9635.4);
  assert.equal(rp(753.256), 753.26);
  assert.equal(rp(3.52449), 3.524);
  assert.equal(rp(0.000123456), 0.0001235);
});
