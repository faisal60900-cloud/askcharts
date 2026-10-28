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
  const t = U.entryMessage(r, { market: { spy: { up: false } }, note: "قراءة تجريبية", reach: { 1: 54, 2: 38, 3: 29, 4: 22, 5: 15 } });
  for (const part of ["NVDA", "178.2$", "2.6x", "177.6$", "172.3$", "الأهداف الخمسة", "190$", "تحت متوسط 50", "قراءة تجريبية", "بيع 20%", "لسعر الدخول", "إشارة شراء"]) assert.ok(t.includes(part), part);
  // five targets at 1R..5R from the middle of the entry zone (178.3, risk 6), each with its reach
  for (const [px, hit] of [["184.3$", "54%"], ["190.3$", "38%"], ["196.3$", "29%"], ["202.3$", "22%"], ["208.3$", "15%"]]) assert.ok(t.includes(px) && t.includes(hit), px);
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
  assert.match(U.entryMessage({ ...base, price: 635.2 }), /فوق منطقة الشراء بـ 6%.*وتجاوز الهدف 2/);
  assert.match(U.entryMessage({ ...base, price: 595 }), /داخل منطقة الشراء/);
});

import { usVolumeShare } from "../public/lib/market-reader.js";

test("US volume is U-shaped: heavy at the open and close, light at midday", () => {
  assert.ok(usVolumeShare(1) < 0.04, "the opening auction is a few percent");
  assert.ok(Math.abs(usVolumeShare(30) - 0.15) < 1e-9, "15% by 10:00");
  assert.equal(usVolumeShare(390), 1);
  assert.ok(usVolumeShare(210) - usVolumeShare(150) < usVolumeShare(30) - usVolumeShare(0), "an hour at midday trades less than the first half hour");
});

test("the radar and the fast scans come before and right after the open", () => {
  const at = (h, m) => ({ date: "2026-10-27", day: 2, min: h * 60 + m, weekday: true });
  assert.equal(U.due(at(9, 20)).radar, true);
  assert.equal(U.due(at(9, 20), { radar: 1 }).radar, false);
  assert.equal(U.due(at(9, 31)).fast, true);
  assert.equal(U.due(at(10, 5)).fast, false);
});

test("the radar flags a stock above its breakout level, a gap, and a signalled stock below its stop", () => {
  const list = [
    { code: "AAA", close: 100, level: 102, dir: "near", stop: 95 },
    { code: "BBB", close: 50, level: 55, dir: "near", stop: 45 },
    { code: "CCC", close: 80, level: 78, dir: "up", stop: 76 },
    { code: "DDD", close: 30, level: 31, dir: "near", stop: 28 },
  ];
  const quotes = { AAA: { price: 103, changePct: 3 }, BBB: { price: 52, changePct: 4 }, CCC: { price: 75, changePct: -6.3 }, DDD: { price: 30.1, changePct: 0.3 } };
  const lines = U.radarLines(list, quotes, { CCC: {} });
  assert.equal(lines.length, 3, lines.join("\n"));
  assert.match(lines[0], /CCC.*تحت وقف/, "the stop warning comes first");
  assert.match(lines[1], /AAA.*فوق مستوى الاختراق/);
  assert.match(lines[2], /BBB.*فجوة/);
});

test("a brief sent by hand before its time doesn't stop the scheduled one", () => {
  const early = Date.parse("2026-10-27T08:05:00Z"), // 4:05 New York
    onTime = Date.parse("2026-10-27T13:01:00Z"); // 9:01
  assert.deepEqual(U.scheduledFlags("2026-10-27", { "2026-10-27": { pre: early, radar: early } }), {});
  assert.deepEqual(Object.keys(U.scheduledFlags("2026-10-27", { "2026-10-27": { pre: onTime } })), ["pre"]);
});

test("a signal the price already ran 3% past the buy zone is a chase, not sent", () => {
  const plan = { entryZone: { from: 100, to: 102 }, stop: 96 };
  assert.equal(U.chased({ price: 103, plan }), false);
  assert.equal(U.chased({ price: 105.2, plan }), true);
  assert.equal(U.chased({ price: 105.2, plan: null }), false);
});

test("the buying and selling lines go before the analyst's note", () => {
  assert.equal(U.addFlow("a\nb\n🧠 note\n📊 record", "FLOW"), "a\nb\nFLOW\n🧠 note\n📊 record");
  assert.equal(U.addFlow("a\nb", "FLOW"), "a\nb\nFLOW");
  assert.equal(U.addFlow("a", ""), "a");
});
