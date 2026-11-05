import { test } from "node:test";
import assert from "node:assert/strict";
import { moversText, nyDates } from "../lib/premovers.js";

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
