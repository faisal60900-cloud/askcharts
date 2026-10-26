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
