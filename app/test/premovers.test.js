import { test } from "node:test";
import assert from "node:assert/strict";
import { moversText } from "../lib/premovers.js";

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

test("says so when nothing moved, and is empty with no quotes at all", () => {
  const t = moversText(rows, { AAPL: { price: 346, changePct: 1 } }, ["AAPL"]);
  assert.match(t, /ما في سهم طالع 8% أو أكثر/);
  assert.match(t, /• AAPL/);
  assert.equal(moversText(rows, {}, ["UBER"]), "");
});
