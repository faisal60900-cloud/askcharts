// The Kuwait market scan: rows, filters and the buy-entry signal, on made-up daily bars.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scanRow, isEntry, isBaseSignal, FILTERS, tradedValue } from "../public/lib/kuwait-scan.js";
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
  assert.equal(isBaseSignal(hot), hot.flow.inflowPct >= 55 && hot.signalKey > 0, "the breakout signal is exactly its rules");
  assert.equal(hot.entry, isBaseSignal(hot) && hot.weekly > 0 && hot.rsi >= 50 && hot.rsi < 70 && hot.closePos >= 0.7, "entry adds the week, RSI and close");
  assert.ok(hot.trail?.dist > 0, "a trailing stop distance");
  assert.ok(hot.score > calm.score, `${hot.score} vs ${calm.score}`);
  assert.equal(calm.entry, false);
});

test("too few bars gives an Arabic error row instead of throwing", () => {
  assert.match(scanRow(stock, range(20)).error, /بيانات/);
  assert.match(scanRow(stock, null).error, /بيانات/);
});

test("isEntry needs every rule", () => {
  const ok = { breakout: { dir: "up", confirmed: true }, flow: { inflowPct: 60 }, buyToday: 70, signalKey: 1, weekly: 1, rsi: 60, closePos: 0.8 };
  assert.ok(isEntry(ok));
  assert.ok(!isEntry({ ...ok, weekly: 0 }), "the week must be trending up");
  assert.ok(!isEntry({ ...ok, rsi: 72 }), "not overbought");
  assert.ok(!isEntry({ ...ok, closePos: 0.5 }), "a close near the high");
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

import { kuwaitSessionFraction } from "../public/lib/market-reader.js";

test("session fraction: today's bar an hour into the session is about a quarter of a day", () => {
  const now = Date.UTC(2026, 9, 27, 7, 9); // 10:09 Kuwait
  const today = Date.UTC(2026, 9, 27, 6) / 1000,
    yesterday = Date.UTC(2026, 9, 26, 6) / 1000;
  const f = kuwaitSessionFraction(today, now);
  assert.ok(f > 0.25 && f < 0.35, `${f}`);
  assert.equal(kuwaitSessionFraction(yesterday, now), 1);
});

test("a break on a thin bar isn't confirmed by a busy bar before it", () => {
  // the busy day closes under the 825 tops; the break comes the next day on light volume
  const bars = range(200);
  const t = bars.at(-1).time;
  bars.push({ time: t + 86400, open: 812, high: 824, low: 810, close: 823, volume: 400000 });
  bars.push({ time: t + 2 * 86400, open: 823, high: 846, low: 822, close: 845, volume: 60000 });
  const r = scanRow(stock, bars);
  assert.equal(r.breakout?.dir, "up", JSON.stringify(r.breakout));
  assert.equal(r.breakout.confirmed, false, "0.6x on the breaking bar");
  assert.equal(r.entry, false);
});

import { usSessionFraction } from "../public/lib/market-reader.js";

test("US stocks: values in dollars, and today's volume measured against New York's session", () => {
  const now = Date.UTC(2026, 9, 27, 15, 30); // 11:30 in New York
  const f = usSessionFraction(Date.UTC(2026, 9, 27) / 1000, now);
  assert.ok(f > 0.28 && f < 0.34, `${f}`);
  assert.equal(usSessionFraction(Date.UTC(2026, 9, 26) / 1000, now), 1);
  const bars = range(200, { start: 50, amp: 2, vol: 1e6 });
  const us = scanRow({ code: "TST", symbol: "US:TST", en: "Test", ar: null }, bars, 0, { market: "us" });
  assert.ok(us.value > 4e7 && us.value < 6e7, `${us.value} dollars a day`);
  assert.ok(scanRow(stock, bars, 0).value < 1e5, "the same bars read as fils are dinars");
});

test("US entry: the base signal plus a breakout on 2x volume; no week/RSI/close conditions; a 3 ATR trail", () => {
  const base = { breakout: { dir: "up", confirmed: true, vol: 2.4 }, flow: { inflowPct: 60 }, buyToday: 70, signalKey: 1, weekly: -1, rsi: 75, closePos: 0.3 };
  assert.ok(isEntry({ ...base, market: "us" }), "Kuwait's extra conditions don't apply");
  assert.ok(!isEntry({ ...base, market: "us", breakout: { dir: "up", confirmed: true, vol: 1.6 } }), "1.6x isn't enough in the US");
  assert.ok(!isEntry({ ...base, market: "kw" }), "but in Kuwait they do");
  const bars = range(200, { start: 50, amp: 2, vol: 1e6 });
  assert.equal(scanRow({ code: "TST", symbol: "US:TST", en: "Test", ar: null }, bars, 0, { market: "us" }).trail.atr, 3);
  assert.equal(scanRow(stock, bars, 0).trail.atr, 2.5);
});
