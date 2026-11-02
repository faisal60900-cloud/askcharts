import test from "node:test";
import assert from "node:assert/strict";
import { KW_SECTORS, kwSectorOf, stockDay, sectorTable, sectorsText, US_SECTORS } from "../public/lib/sectors.js";
import { KUWAIT_STOCKS } from "../public/lib/kuwait-market.js";

const bars = (n, { vol = 1000, close = 100, last } = {}) => {
  const b = Array.from({ length: n }, (_, i) => ({ time: i * 86400, open: close, high: close + 2, low: close - 2, close, volume: vol }));
  if (last) b[b.length - 1] = { ...b.at(-1), ...last };
  return b;
};

test("every Kuwaiti stock is in exactly one sector", () => {
  const all = Object.values(KW_SECTORS).flatMap((s) => s.codes);
  assert.equal(new Set(all).size, all.length);
  for (const s of KUWAIT_STOCKS) assert.ok(kwSectorOf(s.code), s.code);
  assert.equal(kwSectorOf("NBK"), "banks");
  assert.equal(kwSectorOf("ALSAFAT"), "fin");
  assert.equal(US_SECTORS.length, 12);
});

test("stockDay: today's money against a usual day by this time", () => {
  const d = stockDay(bars(30, { last: { volume: 3000, close: 102, high: 102, low: 98 } }), { frac: 0.5 });
  assert.equal(d.value, 3000 * 102);
  assert.equal(d.avg, 1000 * 100 * 0.5);
  assert.equal(d.buy, d.value); // closed at the high
  assert.ok(Math.abs(d.change - 2) < 1e-9);
  assert.equal(stockDay(bars(10)), null);
});

test("sectorTable: buying with more money than usual is 'receiving', the weak one is where it comes from", () => {
  const strong = stockDay(bars(30, { last: { volume: 3000, close: 102, high: 102, low: 98 } }));
  const weak = stockDay(bars(30, { last: { volume: 1000, close: 98, high: 102, low: 98 } }));
  const t = sectorTable(
    [
      { key: "a", ar: "أ", codes: ["X"] },
      { key: "b", ar: "ب", codes: ["Y"] },
    ],
    { X: strong, Y: weak },
  );
  assert.equal(t.rows[0].key, "a");
  assert.equal(t.rows[0].flow.k, "in");
  assert.equal(t.rows[0].heat.k, "hot");
  assert.equal(t.rows[1].flow.k, "out");
  assert.equal(t.rotation.from.key, "b");
  assert.equal(t.rotation.to.key, "a");
  const text = sectorsText(t, "kw");
  assert.match(text, /قطاعات السوق الكويتي/);
  assert.match(text, /تنتقل: من ب ← إلى أ/);
});

test("sectorTable: a sector with almost no money can't be the strongest", () => {
  const big = stockDay(bars(30, { vol: 100000, last: { volume: 100000, close: 100, high: 101, low: 99 } }));
  const tiny = stockDay(bars(30, { vol: 10, last: { volume: 30, close: 110, high: 110, low: 100 } }));
  const t = sectorTable([{ key: "tiny", ar: "ص", codes: ["T"] }, { key: "big", ar: "ك", codes: ["B"] }], { T: tiny, B: big });
  assert.equal(t.hot.key, "big");
  assert.equal(t.rows.at(-1).key, "tiny");
});
