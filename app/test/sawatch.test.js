// The Saudi market watch: Riyadh's clock, the market from the scan, the buy message. Offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.QT_OFFLINE = "1";
process.env.QT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "qt-sawatch-"));
const S = await import("../lib/sawatch.js");
const { SAUDI_STOCKS } = await import("../public/lib/saudi-market.js");
const { saudiSessionFraction } = await import("../public/lib/market-reader.js");

test("the Saudi list: unique codes, Yahoo symbols, Arabic names", () => {
  const codes = SAUDI_STOCKS.map((s) => s.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.ok(codes.length > 200);
  assert.ok(SAUDI_STOCKS.every((s) => /^YAHOO:\d{4}\.SR$/.test(s.symbol) && s.ar && s.market === "sa"));
  assert.equal(SAUDI_STOCKS.find((s) => s.code === "2222").ar, "أرامكو السعودية");
});

test("Tadawul's session: Sunday to Thursday, 10:00 to 15:10 Riyadh time", () => {
  const at = (iso) => S.riyadh(new Date(iso));
  assert.equal(S.sessionOpen(at("2026-10-28T07:30:00Z")), true, "Wednesday 10:30");
  assert.equal(S.sessionOpen(at("2026-10-28T06:30:00Z")), false, "9:30, before the open");
  assert.equal(S.sessionOpen(at("2026-10-30T08:00:00Z")), false, "Friday");
  assert.equal(S.closeWindow(at("2026-10-28T12:25:00Z")), true, "15:25");
  // half the session gone at 12:35
  const bar = Date.UTC(2026, 9, 28) / 1000;
  assert.ok(Math.abs(saudiSessionFraction(bar, Date.UTC(2026, 9, 28, 9, 35)) - 0.5) < 0.01);
  assert.equal(saudiSessionFraction(bar - 86400, Date.UTC(2026, 9, 28, 9, 35)), 1, "yesterday's bar is complete");
});

test("the market from the scan: an equal-weighted index over its 50-day average", () => {
  const mk = (drift) => Array.from({ length: 120 }, (_, i) => ({ time: 1.7e9 + i * 86400, close: 100 + drift * i }));
  const up = S.marketOf(Array.from({ length: 6 }, () => mk(0.5)));
  assert.equal(up.up, true);
  assert.equal(up.rising, 6);
  assert.equal(S.marketOf(Array.from({ length: 6 }, () => mk(-0.3))).up, false);
});

test("the buy message has the zone, the stop, the trailing stop and the risk note, in riyals", () => {
  const t = S.entryMessage(
    { code: "1120", ar: "الراجحي", sector: "بنوك", price: 61.2, changePct: 2.1, value: 650e6, breakout: { level: 60.5, vol: 2.3 }, flow: { inflowPct: 64 }, buyToday: 71, weekly: 1, rsi: 62, positives: 6, negatives: 1, plan: { entryZone: { from: 60.4, to: 61 }, stop: 58.9, targets: [{ price: 63.5, pct: 4 }] }, trail: { dist: 2.4 } },
    { market: { up: true } },
  );
  for (const part of ["إشارة شراء", "الراجحي", "60.4 ريال", "58.9 ريال", "وقف متحرك", "63.5 ريال", "650 مليون", "صاعد", "لا تضمن الربح"]) assert.ok(t.includes(part), part);
});

test("the market's turn is sent once, when it crosses the 200-day average", () => {
  assert.equal(S.regimeMessage({ up200: true, from200: 1.2 }, null), null, "the first look only notes it");
  assert.equal(S.regimeMessage({ up200: false, from200: -3 }, false), null, "no change");
  assert.match(S.regimeMessage({ up200: true, from200: 1.2 }, false), /رجع فوق متوسط 200/);
  assert.match(S.regimeMessage({ up200: false, from200: -0.5 }, true), /نزل تحت متوسط 200/);
});
