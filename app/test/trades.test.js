// Following a signal: targets, the stop behind them, the trailing stop, and the messages. Offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.QT_OFFLINE = "1";
process.env.QT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "qt-trades-"));
const T = await import("../lib/trades.js");

const us = () => T.newTrade({ market: "us", code: "ABC", symbol: "US:ABC", name: "Abc", entry: 100, stop: 95, targets: [105, 110, 115, 120, 125], at: Date.now() });

test("US: each target sells a fifth and raises the stop: to the entry, then to the previous target", () => {
  const t = us();
  let ev = T.step(t, { price: 105.5 }, 1);
  assert.deepEqual(ev.map((e) => [e.kind, e.k, e.stop]), [["target", 1, 100]]);
  assert.match(T.message(t, ev[0]), /تحقق الهدف 1 من 5/);
  assert.match(T.message(t, ev[0]), /بلا خسارة/);
  ev = T.step(t, { price: 116, high: 116 }, 2);
  assert.deepEqual(ev.map((e) => [e.k, e.stop]), [[2, 105], [3, 110]], "two targets in one look");
  ev = T.step(t, { price: 109 }, 3);
  assert.equal(ev[0].kind, "stop");
  // 105+110+115 sold a fifth each, the other two fifths at 109 (the price was already under the 110 stop)
  assert.equal(ev[0].ret, 9.6);
  assert.ok(t.closed);
  assert.match(T.message(t, ev[0]), /وقف الربح/);
});

test("US: the fifth target ends the trade; the stop before any target is a loss", () => {
  const t = us();
  const ev = T.step(t, { price: 126 }, 1);
  assert.equal(ev.at(-1).kind, "done");
  assert.equal(ev.at(-1).ret, 15);
  const l = us();
  const s = T.step(l, { price: 94 }, 1);
  assert.equal(s[0].kind, "stop");
  assert.equal(s[0].ret, -6, "a gap under the stop exits at the price");
  assert.match(T.message(l, s[0]), /وقف الخسارة/);
});

test("targets already passed when the signal was sent are not announced again", () => {
  const t = T.newTrade({ market: "us", code: "X", entry: 100, stop: 95, targets: [105, 110, 115, 120, 125], price: 107 });
  assert.equal(t.hit, 1);
  assert.equal(t.stop, 100);
  assert.deepEqual(T.step(t, { price: 108 }), []);
});

test("Kuwait: resistances are announced and the trailing stop follows the highest price", () => {
  const t = T.newTrade({ market: "kw", code: "KFH", entry: 800, stop: 760, targets: [830, 860], trailDist: 50, at: 0 });
  let ev = T.step(t, { price: 835 }, 1);
  assert.equal(ev[0].kind, "target");
  assert.equal(ev[0].stop, 785, "835 - 50");
  ev = T.step(t, { price: 840 }, 2);
  assert.deepEqual(ev, [], "a small move of the trail isn't news");
  ev = T.step(t, { price: 855 }, 3);
  assert.equal(ev[0].kind, "trail");
  assert.equal(ev[0].stop, 805);
  ev = T.step(t, { price: 804 }, 4);
  assert.equal(ev[0].kind, "stop");
  assert.ok(ev[0].ret > 0);
  assert.match(T.message(t, ev[0]), /الوقف المتحرك/);
});

test("the day's range counts only where it went past the last look the same day", () => {
  const day = Date.UTC(2026, 9, 28, 13, 30) / 1000;
  const t = T.newTrade({ market: "us", code: "Y", entry: 100, stop: 95, targets: [105, 110, 115, 120, 125], price: 101, bar: { time: day, high: 101, low: 94, close: 101 } });
  const q = T.fromBar(t, { time: day, high: 102, low: 94, close: 101.5 });
  assert.equal(q.low, 101.5, "the morning's 94 was before the signal");
  assert.equal(q.high, 102);
  const next = T.fromBar(t, { time: day + 86400, high: 103, low: 99, close: 102 });
  assert.equal(next.low, 99, "a new day counts in full");
});

test("the book follows a stock once and reports what happened", async () => {
  T.reset();
  assert.equal(T.open(us()), true);
  assert.equal(T.open(us()), false);
  const out = [];
  const r = await T.check("us", async () => ({ price: 111 }), async (text) => out.push(text));
  assert.equal(r.sent, 2);
  assert.match(T.summary("us"), /حقق 2 من 5/);
  await T.check("us", async () => ({ price: 104 }), async (text) => out.push(text));
  assert.equal(T.list("us").length, 0);
  assert.equal(T.closed("us")[0].closed.why, "stop");
});

test("your own position: a warning near the stop once a day, and the money in dinars", () => {
  const t = T.newTrade({ market: "kw", code: "ALSAFAT", name: "الصفاة", entry: 131.2, stop: 127, targets: [136, 140], qty: 85957, mine: true, price: 128, at: Date.now() });
  const ev = T.step(t, { price: 128 }, Date.UTC(2026, 9, 29, 9));
  assert.equal(ev[0].kind, "near");
  assert.match(T.message(t, ev[0]), /قريب من وقف الخسارة/);
  assert.match(T.message(t, ev[0]), /361/, "(131.2 - 127) × 85,957 / 1000 ≈ 361 د.ك");
  assert.deepEqual(T.step(t, { price: 128 }, Date.UTC(2026, 9, 29, 9, 5)), [], "once a day");
  const s = T.step(t, { price: 126 }, Date.UTC(2026, 9, 30, 9));
  assert.equal(s[0].kind, "stop");
  assert.match(T.message(t, s[0]), /البيع تسويه أنت/);
});
