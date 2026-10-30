// The fallen leaders: a turn up after an oversold fall, and a break to a new low. Offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.QT_OFFLINE = "1";
process.env.QT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "qt-wl-"));
const W = await import("../lib/watchlist.js");
const bar = (i, c, o = c, h = c + 1, l = c - 1) => ({ time: 1.7e9 + i * 86400, open: o, high: h, low: l, close: c });

test("a fall then a strong up day over yesterday's high is a turn", () => {
  const bars = [];
  for (let i = 0; i < 60; i++) bars.push(bar(i, 200 - i * 2)); // a steady fall: oversold
  const y = bars.at(-1);
  bars.push(bar(60, y.close * 1.03, y.close, y.close * 1.032, y.close * 0.995));
  const e = W.evaluate(bars);
  assert.equal(e.kind, "turn");
  assert.match(W.message("GOOGL", e), /بدأ يرتد/);
});

test("a close under the 20-day low is a break; a quiet day is nothing", () => {
  const bars = [];
  for (let i = 0; i < 60; i++) bars.push(bar(i, 100 + Math.sin(i) * 2));
  assert.equal(W.evaluate(bars), null);
  bars.push(bar(60, 90, 97, 97, 89.5));
  assert.equal(W.evaluate(bars).kind, "break");
});
