// The US market watch: New York's clock, what each minute calls for, and the messages. Offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.QT_OFFLINE = "1";
process.env.QT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "qt-uswatch-"));
const U = await import("../lib/uswatch.js");

test("New York time follows summer time: 13:30 UTC is 9:30 in October and 8:30 in December", () => {
  const oct = U.ny(new Date("2026-10-27T13:30:00Z")),
    dec = U.ny(new Date("2026-12-01T13:30:00Z"));
  assert.equal(oct.min, 9 * 60 + 30);
  assert.equal(dec.min, 8 * 60 + 30);
  assert.equal(oct.weekday, true);
  assert.equal(U.ny(new Date("2026-10-31T15:00:00Z")).weekday, false, "Saturday");
});

test("the briefs come once each, in their windows, and not at the weekend", () => {
  const at = (h, m, day = 2) => ({ date: "2026-10-27", day, min: h * 60 + m, weekday: day >= 1 && day <= 5 });
  assert.equal(U.due(at(9, 5)).pre, true);
  assert.equal(U.due(at(9, 5), { pre: 1 }).pre, false, "already sent today");
  assert.equal(U.due(at(9, 35)).pre, false, "too late for the pre-market brief");
  assert.equal(U.due(at(9, 50)).open, true);
  assert.equal(U.due(at(16, 5)).close, true);
  assert.equal(U.due(at(15, 59)).close, false);
  assert.deepEqual(U.due(at(9, 5, 6)), {}, "Saturday");
});

test("the entry message has the breakout, entry zone, stop, trailing stop, targets and the market, and says it isn't advice", () => {
  const r = {
    code: "NVDA", en: "NVIDIA", price: 182.4, changePct: 3.1, breakout: { level: 178.2, vol: 2.6 }, flow: { inflowPct: 64 }, buyToday: 81,
    plan: { entryZone: { from: 177.6, to: 179 }, stop: 172.3, targets: [{ price: 190 }] }, trail: { atr: 3, dist: 12.4 },
  };
  const t = U.entryMessage(r, { market: { spy: { up: false } }, note: "قراءة تجريبية" });
  for (const part of ["NVDA", "178.2$", "2.6x", "177.6$", "172.3$", "12.4$", "الأهداف", "190$", "تحت متوسط 50", "قراءة تجريبية", "وليست توصية"]) assert.ok(t.includes(part), part);
  // targets at 2R and 3R from the middle of the entry zone (178.3, risk 6)
  assert.ok(t.includes("190.3$") && t.includes("196.3$"), t);
});

test("settings are clamped", () => {
  const s = U.update({ on: true, every: 2, size: 7 });
  assert.equal(s.every, 5);
  assert.equal(s.size, 300);
  U.update({ on: false });
  U.stop();
});

test("a price that ran past the entry zone is flagged, and one inside it is said so", () => {
  const base = { code: "LMT", en: "Lockheed", changePct: 5, breakout: { level: 594.2, vol: 2.3 }, flow: { inflowPct: 72 }, buyToday: 95, plan: { entryZone: { from: 589, to: 599.4 }, stop: 576.9, targets: [] }, trail: { atr: 3, dist: 52 } };
  assert.match(U.entryMessage({ ...base, price: 635.2 }), /فوق منطقة الدخول بـ 6%.*وتجاوز الهدف الأول/);
  assert.match(U.entryMessage({ ...base, price: 595 }), /داخل منطقة الدخول/);
});
