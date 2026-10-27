// The Kuwait market scan: rows, filters and the buy-entry signal, on made-up daily bars.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scanRow, isEntry, FILTERS, tradedValue } from "../public/lib/kuwait-scan.js";
import { KUWAIT_STOCKS } from "../public/lib/kuwait-market.js";

function range(n, { start = 800, amp = 25, period = 20, vol = 100000 } = {}) {
  const out = [];
  let t = 1_700_000_000;
  for (let i = 0; i < n; i++) {
    const mid = start + amp * Math.sin((i / period) * 2 * Math.PI);
    out.push({ time: (t += 86400), open: mid - 1, close: mid + 1, high: mid + 4, low: mid - 4, volume: vol });
  }
  return out;
}
const stock = { code: "TEST", symbol: "YAHOO:TEST.KW", en: "Test", ar: null };

test("the list is the whole market, one row per code, as Yahoo .KW symbols", () => {
  assert.equal(KUWAIT_STOCKS.length, 133);
  assert.equal(new Set(KUWAIT_STOCKS.map((s) => s.code)).size, 133);
  assert.ok(KUWAIT_STOCKS.every((s) => /^YAHOO:[A-Z]+\.KW$/.test(s.symbol)));
  assert.equal(KUWAIT_STOCKS.find((s) => s.code === "NBK").ar, "بنك الكويت الوطني");
});

test("traded value is in dinars for fils prices", () => {
  assert.equal(tradedValue([{ close: 800, volume: 1000 }]), 800);
  assert.equal(tradedValue([{ close: 8, volume: 1000 }], 20, false), 8000);
});

test("a breakout on heavy buying volume is a buy-entry row and sorts first", () => {
  const quiet = range(200);
  const bars = range(200);
  const t = bars.at(-1).time;
  // three green days on rising volume, the last one closing at its high through the 825 tops
  bars.push({ time: t + 86400, open: 810, high: 818, low: 808, close: 817, volume: 180000 });
  bars.push({ time: t + 2 * 86400, open: 817, high: 824, low: 815, close: 823, volume: 220000 });
  bars.push({ time: t + 3 * 86400, open: 823, high: 846, low: 822, close: 845, volume: 450000 });
  const hot = scanRow(stock, bars),
    calm = scanRow(stock, quiet);
  assert.equal(hot.breakout?.dir, "up", JSON.stringify(hot.breakout));
  assert.ok(hot.breakout.confirmed);
  assert.ok(FILTERS.breakout.test(hot));
  assert.ok(hot.buyToday > 90, `${hot.buyToday}`);
  assert.equal(hot.entry, hot.flow.inflowPct >= 55 && hot.signalKey > 0, "entry is exactly its rules");
  assert.ok(hot.score > calm.score, `${hot.score} vs ${calm.score}`);
  assert.equal(calm.entry, false);
});

test("too few bars gives an Arabic error row instead of throwing", () => {
  assert.match(scanRow(stock, range(20)).error, /بيانات/);
  assert.match(scanRow(stock, null).error, /بيانات/);
});

test("isEntry needs every rule", () => {
  const ok = { breakout: { dir: "up", confirmed: true }, flow: { inflowPct: 60 }, buyToday: 70, signalKey: 1 };
  assert.ok(isEntry(ok));
  assert.ok(!isEntry({ ...ok, signalKey: 0 }));
  assert.ok(!isEntry({ ...ok, breakout: { dir: "up", confirmed: false } }));
  assert.ok(!isEntry({ ...ok, flow: { inflowPct: 50 } }));
});

test("a session that has only just opened is read on the last completed session", () => {
  const bars = range(200);
  bars.push({ ...bars.at(-1), time: bars.at(-1).time + 86400, volume: 50 });
  const r = scanRow(stock, bars);
  assert.equal(r.early, true);
  assert.ok(r.relVol > 0.5, `${r.relVol}`);
});
