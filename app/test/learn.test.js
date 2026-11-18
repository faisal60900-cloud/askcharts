import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
process.env.QT_DATA_DIR ||= mkdtempSync(path.join(os.tmpdir(), "learn-"));
const learn = await import("../lib/learn.js");

const day = (i) => Math.floor(Date.UTC(2026, 0, 1) / 1000) + i * 86400;
const bar = (i, o, h, l, c, v = 1000) => ({ time: day(i), open: o, high: h, low: l, close: c, volume: v });

test("a pick's result: first target before the stop, the stop first, both in one bar, neither, never triggered", () => {
  const b = [bar(0, 10, 10, 10, 10), bar(1, 10, 10.5, 9.8, 10.2), bar(2, 10.2, 11.2, 10.1, 11), bar(3, 11, 11, 10, 10.5)];
  assert.equal(learn.outcome(b, 1, { entry: 10.4, stop: 9.5, t1: 11, days: 3 }).res, "win");
  assert.equal(learn.outcome(b, 1, { entry: 10.4, stop: 10.15, t1: 12, days: 3 }).res, "loss");
  // the stop and the target in one bar: a loss, to be safe
  assert.equal(learn.outcome(b, 2, { entry: null, stop: 10.15, t1: 11.1, days: 2 }).res, "loss");
  assert.equal(learn.outcome(b, 1, { entry: 10.4, stop: 9, t1: 13, days: 3 }).res, "flat");
  assert.equal(learn.outcome(b, 1, { entry: 12, stop: 9, t1: 13, days: 3 }).res, "none");
  // a zone: entered when a bar trades in it
  assert.equal(learn.outcome(b, 1, { lo: 9.9, hi: 10.1, stop: 9.5, t1: 11, days: 3 }).res, "win");
  // not enough bars yet: still running
  assert.equal(learn.outcome(b, 2, { entry: 10.4, stop: 9, t1: 13, days: 5 }).res, "open");
});

test("the setup's buckets, and the odds learned from history", () => {
  // 260 bars rising slowly, with a breakout on bar 250
  const b = Array.from({ length: 260 }, (_, i) => bar(i, 100 + i * 0.1, 100.5 + i * 0.1, 99.5 + i * 0.1, 100 + i * 0.1, 1000));
  const f = learn.features(b, 250);
  assert.equal(f.up50, true);
  assert.equal(f.up200, true);
  assert.deepEqual(learn.buckets(f).map((k) => k.split(":")[0]), ["rsi", "vol", "close", "day", "trend", "5d"]);
  learn.reset();
  // every 3rd bar from 200 a setup; the next bar wins (it rises 0.1 a bar, the target is 0.05 over the entry)
  const res = learn.backfill("momentum", [b], (bb, i) => (i % 3 === 0 ? { entry: bb[i].high, stop: bb[i].low - 5, t1: bb[i].high + 0.05 } : null), { at: "2026-11-18" });
  assert.ok(res.cases >= 15);
  assert.equal(res.rate, 1);
  const o = learn.odds("momentum", f);
  assert.equal(o.rate, 1);
  assert.equal(learn.state().backAt, "2026-11-18");
  assert.equal(learn.odds("tech", f), null);
});

test("scoring the picks: each resolved one goes into the live record once", () => {
  learn.reset();
  const b = Array.from({ length: 80 }, (_, i) => bar(i, 50, 50.5, 49.5, 50));
  b.push(bar(80, 50, 52, 49.8, 51.5)); // the pick's day: target 51 reached
  const d80 = new Date(day(80) * 1000).toISOString().slice(0, 10);
  const picks = [
    { agent: "momentum", code: "AAA", day: d80, price: 50, entry: 50.2, stop: 49, t1: 51 },
    { agent: "earn", code: "AAA", day: d80, price: 50, entry: 50, stop: 49, t1: 51, post: true }, // counts from the next day: none yet
  ];
  const rows = learn.score(picks, { AAA: b }, { today: d80 });
  assert.equal(rows[0].res, "win");
  assert.equal(rows[0].at, d80);
  assert.equal(rows[1].res, "open");
  assert.equal(learn.record("momentum").w, 1);
  learn.score(picks, { AAA: b }, { today: d80 });
  assert.equal(learn.record("momentum").w, 1);
});
