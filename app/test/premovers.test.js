import { test } from "node:test";
import assert from "node:assert/strict";
import { moversText, nyDates, beatLine, watchAdd, targetEvents } from "../lib/premovers.js";

const rows = [
  { ticker: "RUN", name: "Sunrun Inc. Common Stock" },
  { ticker: "LYFT", name: "Lyft Inc. Class A Common Stock" },
  { ticker: "AAPL", name: "Apple Inc." },
  { ticker: "DELL", name: "Dell Technologies Inc." },
  { ticker: "NOQ", name: "No Quote Corp" },
];
const quotes = {
  RUN: { price: 10.82, changePct: 23.09 },
  LYFT: { price: 19.9, changePct: 9.2 },
  AAPL: { price: 346, changePct: 0.4 },
  DELL: { price: 340, changePct: -10.6 },
  UBER: { price: 70.2, changePct: 0.47 },
};

test("lists the big gaps up and down, warns on the big jumps, and shows your stocks", () => {
  const t = moversText(rows, quotes, ["UBER"], { at: "17:00" });
  assert.match(t, /قبل الافتتاح الأمريكي \(الساعة 17:00/);
  assert.match(t, /⬆️ RUN: 10\.82\$ \(\+23\.1%\) ⚠️ قفزة كبيرة · Sunrun/);
  assert.match(t, /⬆️ LYFT: 19\.9\$ \(\+9\.2%\) · Lyft/);
  assert.doesNotMatch(t, /LYFT[^\n]*قفزة كبيرة/);
  assert.match(t, /🔴 أكبر النازلة:\n⬇️ DELL: 340\$ \(-10\.6%\)/);
  assert.doesNotMatch(t, /AAPL/);
  assert.doesNotMatch(t, /NOQ/);
  assert.match(t, /💼 أسهمك:\n• UBER: 70\.2\$ \(\+0\.5%\)/);
  // the biggest gap first
  assert.ok(t.indexOf("RUN") < t.indexOf("LYFT"));
});

test("says why a stock moves: its results came out, or the latest headline", () => {
  const t = moversText(rows, quotes, ["UBER"], { earn: { out: new Set(["RUN", "UBER"]) }, heads: { LYFT: "Lyft shares jump on robotaxi deal" } });
  assert.match(t, /RUN[^\n]*\n   📰 السبب: نتائجه طلعت/);
  assert.match(t, /LYFT[^\n]*\n   📰 Lyft shares jump on robotaxi deal/);
  assert.match(t, /• UBER: [^\n]*📰 نتائجه طلعت/);
});

test("the results calendar: the big companies tonight and tomorrow, yours first, small ones left out", () => {
  const earn = {
    tonight: [
      { code: "SNAP", name: "Snap Inc.", when: "post", cap: 9.6e9 },
      { code: "TINY", name: "Tiny Co", when: "post", cap: 50e6 },
      { code: "ORCL", name: "Oracle Corporation", when: "post", cap: 340e9 },
      { code: "HIMS", name: "Hims & Hers Health Inc.", when: "post", cap: 6e9 },
    ],
    tomorrow: [{ code: "DUK", name: "Duke Energy Corporation", when: "pre", cap: 90e9 }],
  };
  const t = moversText(rows, quotes, ["HIMS"], { earn });
  assert.match(t, /📅 نتائج الليلة بعد الإغلاق[^\n]*\n• HIMS 💼 · Hims & Hers Health \(6 مليار\$\)\n• ORCL · Oracle \(340 مليار\$\)\n• SNAP · Snap \(10 مليار\$\)/);
  assert.doesNotMatch(t, /TINY/);
  assert.match(t, /📅 نتائج بكرة قبل الافتتاح:\n• DUK · Duke Energy \(90 مليار\$\)/);
});

test("says so when nothing moved, and is empty with nothing at all", () => {
  const t = moversText(rows, { AAPL: { price: 346, changePct: 1 } }, ["AAPL"]);
  assert.match(t, /ما في سهم طالع 8% أو أكثر/);
  assert.match(t, /• AAPL/);
  assert.equal(moversText(rows, {}, ["UBER"]), "");
});

test("New York's business days around a date", () => {
  // Thursday 5 November 2026, 15:00 in Kuwait = 7:00 in New York
  assert.deepEqual(nyDates(Date.UTC(2026, 10, 5, 12)), { prev: "2026-11-04", today: "2026-11-05", next: "2026-11-06" });
  // Friday: the next business day is Monday; Monday: the previous is Friday
  assert.deepEqual(nyDates(Date.UTC(2026, 10, 6, 15)), { prev: "2026-11-05", today: "2026-11-06", next: "2026-11-09" });
  assert.deepEqual(nyDates(Date.UTC(2026, 10, 9, 15)).prev, "2026-11-06");
});

test("the last two quarters against the forecast: a star when both beat it", () => {
  assert.equal(beatLine([{ surprise: 14.17 }, { surprise: 6.2 }, { surprise: -15 }]), "⭐ آخر ربعين: ✅ +14% · ✅ +6%");
  assert.equal(beatLine([{ surprise: 14.17 }, { surprise: -16.13 }]), "آخر ربعين: ✅ +14% · ❌ -16%");
  assert.equal(beatLine([{ surprise: null }, { surprise: 3 }]), "آخر ربعين: ✅ +3%");
  assert.equal(beatLine([{ surprise: 0.2 }, { surprise: 61 }]), "آخر ربعين: ⚪ طابقت · ✅ +61%");
  assert.equal(beatLine([]), "");
  const t = moversText(rows, quotes, [], { earn: { tonight: [{ code: "ABNB", name: "Airbnb, Inc.", when: "post", cap: 100e9 }] }, surp: { ABNB: [{ surprise: 14.2 }, { surprise: 8 }] } });
  assert.match(t, /• ABNB · Airbnb \(100 مليار\$\)\n   ⭐ آخر ربعين: ✅ \+14% · ✅ \+8%/);
  assert.match(t, /⭐ = فاقت توقعات الربح آخر ربعين/);
});

test("the calendar shows each company's price, and the ⭐ ones followed after their results", () => {
  const t = moversText(rows, { ...quotes, VST: { price: 165.2, changePct: 1.24 } }, [], {
    earn: { tomorrow: [{ code: "VST", name: "Vistra Corp.", when: "pre", cap: 47e9 }] },
    surp: { VST: [{ surprise: 17 }, { surprise: 30 }] },
    follow: ["VST"],
  });
  assert.match(t, /• VST · Vistra \(47 مليار\$\) · 165\.2\$ \(\+1\.2%\)\n   ⭐ آخر ربعين/);
  assert.match(t, /🎯 بتابع لك ⭐ بعد نتائجها، وأنبهك لو طلعت \+5% و\+10% و\+15% من إغلاق ما قبل النتائج: VST/);
});

test("after the results: a message at +5%, +10% and +15% from the close before them, each once", () => {
  const watch = watchAdd([{ code: "VST", name: "Vistra" }], "2026-11-06", {});
  assert.deepEqual(watch.VST, { name: "Vistra", from: "2026-11-06", until: "2026-11-10", base: null, hit: 0 });
  // not yet: the results come out tomorrow
  assert.equal(targetEvents(watch, { VST: { price: 200, changePct: 20 } }, "2026-11-05").length, 0);
  // the reaction day: the base is yesterday's close (110 over +10% = 100)
  let ev = targetEvents(watch, { VST: { price: 110, changePct: 10 } }, "2026-11-06");
  assert.equal(watch.VST.base, 100);
  assert.equal(ev.length, 1);
  assert.match(ev[0], /🎯🟢🇺🇸 VST \(Vistra\): حقق الهدف 2 بعد النتائج \(\+10%\)/);
  assert.match(ev[0], /السعر 110\$ · إغلاق قبل النتائج 100\$ · من النتائج \+10\.0%\nالهدف الجاي: 115\$ \(\+15%\)/);
  // the same level again: nothing; the last target: once
  assert.equal(targetEvents(watch, { VST: { price: 111, changePct: 1 } }, "2026-11-09").length, 0);
  ev = targetEvents(watch, { VST: { price: 116, changePct: 5 } }, "2026-11-09");
  assert.match(ev[0], /حقق كل الأهداف 🎉 بعد النتائج \(\+15%\)/);
  assert.doesNotMatch(ev[0], /الهدف الجاي/);
  // after three business days it's dropped
  targetEvents(watch, {}, "2026-11-11");
  assert.equal(watch.VST, undefined);
});
