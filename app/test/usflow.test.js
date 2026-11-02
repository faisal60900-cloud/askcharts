// Unusual money in a US stock: a big block, a rush, buying taking over, a level. Offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.QT_OFFLINE = "1";
process.env.QT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "qt-usflow-"));
const F = await import("../lib/usflow.js");
const t0 = Date.UTC(2026, 10, 2, 14, 30) / 1000; // 9:30 in New York (winter time)
const b = (k, close, vol, low = close - 0.2, high = close + 0.2) => ({ time: t0 + k * 300, open: close, high, low, close, volume: vol });
const avgDay = 78 * 100000; // a usual 5-minute bar: 100,000 shares

test("today: the session's money, a big buy block and a rush", () => {
  const bars = [b(0, 65, 100000), b(1, 65.2, 120000), b(2, 65.6, 900000, 65.1, 65.6), b(3, 65.7, 350000, 65.4, 65.7), b(4, 65.8, 300000, 65.5, 65.8)];
  const d = F.today(bars, avgDay);
  assert.equal(d.volume, 1770000);
  assert.equal(d.blocks.length, 1);
  assert.equal(d.blocks[0].kind, "buy");
  assert.equal(d.blocks[0].at, "17:40");
  assert.ok(d.surge && d.surge.kind === "buy", JSON.stringify(d.surge));
  assert.ok(d.buyPct > 60);
});

test("a block smaller than $5M is not one", () => {
  const d = F.today([b(0, 5, 100000), b(1, 5.1, 900000, 5, 5.1)], avgDay);
  assert.equal(d.blocks.length, 0);
});

test("the messages: sent on the second look, once, and a level taken back", () => {
  const mem = {},
    below = { "X|65.5": true };
  const d = F.today([b(0, 65, 100000), b(1, 65.2, 120000), b(2, 65.6, 900000, 65.1, 65.6), b(3, 65.7, 350000, 65.4, 65.7), b(4, 65.8, 300000, 65.5, 65.8)], avgDay);
  assert.deepEqual(F.events("X", d, { levels: [65.5] }, mem, below), []);
  const ev = F.events("X", d, { levels: [65.5] }, mem, below);
  assert.ok(ev.some((e) => /صفقة شراء كبيرة/.test(e)));
  assert.ok(ev.some((e) => /سيولة مفاجئة/.test(e)));
  assert.ok(ev.some((e) => /سيولة شراء داخلة/.test(e)));
  assert.ok(ev.some((e) => /رجع فوق 65.5\$/.test(e)));
  assert.equal(F.events("X", d, { levels: [65.5] }, mem, below).length, 0);
});

test("a followed stock: a message for every 2% from yesterday's close, once each", () => {
  const mem = {};
  const d = F.today([b(0, 65, 100000), b(1, 67.2, 120000, 66.8, 67.3)], avgDay);
  d.prev = 65.25;
  F.events("UBER", d, { follow: true, mine: "💰 صفقتك" }, mem, {});
  const ev = F.events("UBER", d, { follow: true, mine: "💰 صفقتك" }, mem, {});
  assert.ok(ev.some((e) => /طالع \+3\.0% اليوم/.test(e) && /صفقتك/.test(e)), ev.join("\n"));
  assert.equal(F.events("UBER", d, { follow: true }, mem, {}).filter((e) => /اليوم\n/.test(e)).length, 0);
});
