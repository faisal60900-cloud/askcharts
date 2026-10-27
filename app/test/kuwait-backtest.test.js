// The historical test of the Kuwait entry signal: outcomes, stats and the rule sets, on made-up bars.
import { test } from "node:test";
import assert from "node:assert/strict";
import { signalsFor, stats, compare, VARIANTS, EXITS, simulate } from "../public/lib/kuwait-backtest.js";

const stock = { code: "SIM", symbol: "YAHOO:SIM.KW", en: "Sim", ar: null };
function walk(n, seed = 7) {
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out = [];
  let p = 500,
    t = 1_500_000_000;
  for (let i = 0; i < n; i++) {
    const o = p;
    p = Math.max(50, p * (1 + (rnd() - 0.48) * 0.03));
    out.push({ time: (t += 86400), open: o, high: Math.max(o, p) * (1 + rnd() * 0.01), low: Math.min(o, p) * (1 - rnd() * 0.01), close: p, volume: Math.round(1e6 * (rnd() < 0.08 ? 3 : 0.6 + rnd())) });
  }
  return out;
}

test("every signal enters after it, with a stop below and a target above, and an outcome", () => {
  const ev = signalsFor(stock, walk(1500));
  assert.ok(ev.length > 0, "a 6-year random walk has some breakouts");
  for (const e of ev) {
    assert.ok(e.stop < e.entry && e.target > e.entry, JSON.stringify(e));
    assert.ok(["win", "loss", "timeout"].includes(e.result));
    if (e.result === "loss") assert.ok(e.r <= -0.99 || e.ret < 0, JSON.stringify(e));
    if (e.result === "win") assert.ok(e.r > 0, JSON.stringify(e));
  }
  // at least ten sessions between two signals on one stock
  for (let k = 1; k < ev.length; k++) assert.ok(ev[k].time - ev[k - 1].time >= 10 * 86400);
});

test("no signal sees the future: cutting the history after a signal doesn't change it", () => {
  const bars = walk(1500);
  const ev = signalsFor(stock, bars);
  const e = ev[0];
  const cut = bars.findIndex((b) => b.time === e.time) + 1 + 60;
  const again = signalsFor(stock, bars.slice(0, cut + 1)).find((x) => x.time === e.time);
  assert.deepEqual({ ...again, ret10: 0 }, { ...e, ret10: 0 });
});

test("stats count wins, losses and timeouts, and compare scores every rule set", () => {
  const ev = [
    { result: "win", ret: 4, ret10: 3, r: 2, days: 3, time: 1.6e9 },
    { result: "loss", ret: -2, ret10: -2, r: -1, days: 2, time: 1.6e9 },
    { result: "timeout", ret: 1, ret10: 1, r: 0.5, days: 20, time: 1.7e9 },
  ];
  const s = stats(ev);
  assert.equal(s.n, 3);
  assert.equal(s.winRate, 33);
  assert.equal(s.hitTargetFirst, 50);
  assert.equal(s.avgRet, 1);
  assert.equal(s.profitFactor, 2.5);
  const exits = (e) => Object.fromEntries(Object.keys(EXITS).map((k) => [k, { result: e.result, ret: e.ret, r: e.r, days: e.days }]));
  const c = compare(ev.map((e) => ({ ...e, exits: exits(e), weekly: 1, rsi: 60, breakVol: 2.5, value: 1e5, closePos: 0.9, aboveEma50: true, rr: 2 })));
  assert.equal(Object.keys(c.grid).length, Object.keys(VARIANTS).length * Object.keys(EXITS).length);
  assert.deepEqual(Object.keys(c.byVariant), Object.keys(VARIANTS));
  assert.equal(c.byVariant.combo.n, 3);
  assert.deepEqual(Object.keys(c.byYear).sort(), ["2020", "2023"]);
});

test("exits: a trailing stop locks in a run, a 2R target is twice the risk, and a gap through the stop fills at the open", () => {
  const b = (o, h, l, c) => ({ time: 0, open: o, high: h, low: l, close: c, volume: 1 });
  // entry 100, stop 95 (R = 5), ATR 2
  const up = [b(99, 100, 98, 99), b(100, 104, 99, 103), b(103, 109, 102, 108), b(108, 112, 107, 111), b(111, 111, 105, 106)];
  const r2 = simulate(up, 0, 100, 95, 2, 104, EXITS.r2);
  assert.equal(r2.result, "win");
  assert.equal(r2.r, 2);
  const tr = simulate(up, 0, 100, 95, 2, 104, EXITS.trail);
  assert.equal(tr.result, "trail", "the stop rose to 112 - 5 = 107 and was hit");
  assert.equal(tr.r, 1.4);
  const gap = [b(99, 100, 98, 99), b(90, 91, 88, 89)];
  assert.equal(simulate(gap, 0, 100, 95, 2, 104, EXITS.t1).r, -2, "filled at 90, not 95");
});

test("the market filter reads the index on the signal's own day", () => {
  const bars = walk(1500);
  // an index that is "up" (above its EMA 50) only in the first half
  const index = bars.map((b, k) => ({ ...b, close: k < 750 ? 100 + k : 100 + 750 - (k - 750) * 3 }));
  const ev = signalsFor(stock, bars, { index });
  const mid = bars[800].time;
  assert.ok(ev.filter((e) => e.time > mid + 30 * 86400).every((e) => e.marketUp === false));
});

import { excursion } from "../public/lib/kuwait-backtest.js";

test("five targets: a fifth at each, the stop to the entry after the first, and how far a trade got", () => {
  const b = (o, h, l, c) => ({ time: 0, open: o, high: h, low: l, close: c, volume: 1 });
  // entry 100, stop 95 (R = 5): targets 105, 110, 115, 120, 125
  const run = [b(99, 100, 98, 99), b(100, 106, 99, 105), b(105, 111, 104, 110), b(110, 112, 99, 100)];
  const r = simulate(run, 0, 100, 95, 2, 104, EXITS.scale5);
  // 1/5 at 105, 1/5 at 110, then the stop (moved to 105 after the second target) takes the rest at 105
  assert.equal(r.targetsHit, 2);
  assert.equal(r.result, "partial");
  assert.equal(r.r, Math.round(((0.2 * 105 + 0.2 * 110 + 0.6 * 105 - 100) / 5) * 100) / 100);
  assert.equal(excursion(run, 0, 100, 95), 2.4, "a high of 112 is 2.4R before any stop");
  const lose = [b(99, 100, 98, 99), b(99, 101, 94, 95)];
  assert.equal(simulate(lose, 0, 100, 95, 2, 104, EXITS.scale5).result, "loss");
});
