// The warning before a breakout: which stocks, in what order, and the message. Offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.QT_OFFLINE = "1";
process.env.QT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "qt-pre-"));
const P = await import("../lib/prealert.js");
const row = (code, price, level, extra = {}) => ({ code, price, value: 50e6, relVol: 1.4, breakout: { dir: "near", level }, flow: { inflowPct: 62 }, buyToday: 66, signalKey: 1, weekly: 1, plan: { stop: price * 0.95 }, ...extra });

test("only stocks just under the level with money coming in, the closest first", () => {
  const rows = [row("A", 100, 101.5), row("B", 100, 100.4), row("C", 100, 104), row("D", 100, 100.8, { flow: { inflowPct: 40 } }), row("E", 100, 100.2, { entry: true })];
  assert.deepEqual(P.candidates(rows, "us").map((r) => r.code), ["B", "A"]);
  assert.deepEqual(P.candidates([row("F", 100, 100.5, { weekly: -1 })], "kw"), [], "Kuwait wants the week up");
});

test("the message says what's missing and that it isn't a signal yet", () => {
  const t = P.message(row("NVDA", 200, 202), "us");
  for (const part of ["👀🇺🇸 استعد", "202$", "1%", "2x", "Stop", "ليس إشارة شراء"]) assert.ok(t.includes(part), part);
});

test("once a stock a day", async () => {
  const sent = {},
    out = [];
  const send = async (t) => out.push(t);
  await P.sendNew([row("B", 100, 100.4)], "us", { date: "2026-10-28", sent, send });
  await P.sendNew([row("B", 100, 100.4)], "us", { date: "2026-10-28", sent, send });
  assert.equal(out.length, 1);
});
