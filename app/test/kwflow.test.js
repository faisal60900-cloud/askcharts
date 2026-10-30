// Buying money into a Kuwaiti stock: the day's buying share, big blocks, a level taken back. Offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.QT_OFFLINE = "1";
process.env.QT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "qt-kwflow-"));
const F = await import("../lib/kwflow.js");
const t0 = Date.UTC(2026, 10, 1, 6) / 1000; // 9:00 in Kuwait
const b = (k, close, vol, low = close - 1, high = close + 1) => ({ time: t0 + k * 300, open: close, high, low, close, volume: vol });

test("today: volume, the buying share and a big buy block", () => {
  const bars = [b(0, 130, 50000, 129, 130), b(1, 131, 60000, 130, 131), b(2, 132, 1000000, 129, 132), b(3, 132, 40000)];
  const d = F.today(bars);
  assert.equal(d.volume, 1150000);
  assert.ok(d.buyPct > 80, `${d.buyPct}`);
  assert.equal(d.blocks.length, 1);
  assert.equal(d.blocks[0].kind, "buy");
  assert.equal(d.blocks[0].at, "09:10");
});

test("the messages: buying takes over once, the block once, a level taken back", () => {
  const mem = {};
  F.setStock("TEST", { levels: [130] });
  const low = F.today([b(0, 128, 100000, 127, 129)], 3e6);
  assert.deepEqual(F.events("TEST", low, 3e6, { levels: [130] }, mem).length, 0);
  const d = F.today([b(0, 128, 100000, 127, 129), b(1, 131, 1200000, 128, 131)], 3e6);
  const ev = F.events("TEST", d, 3e6, { levels: [130] }, mem);
  assert.ok(ev.some((e) => /سيولة شراء داخلة/.test(e)));
  assert.ok(ev.some((e) => /صفقة شراء كبيرة/.test(e)));
  assert.ok(ev.some((e) => /رجع فوق 130/.test(e)));
  assert.equal(F.events("TEST", d, 3e6, { levels: [130] }, mem).length, 0, "once");
});
