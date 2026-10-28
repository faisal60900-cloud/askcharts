// Asking the bot about a stock: what was typed, to a stock and its market. Offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.QT_OFFLINE = "1";
process.env.QT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "qt-tgbot-"));
const B = await import("../lib/tgbot.js");
const f = (t) => {
  const r = B.findStock(t);
  return r ? `${r.market}:${r.stock.code}` : null;
};

test("codes and names find the stock and its market", () => {
  assert.equal(f("KFH"), "kw:KFH");
  assert.equal(f("kfh"), "kw:KFH");
  assert.equal(f("بيتك"), "kw:KFH");
  assert.equal(f("الوطني"), "kw:NBK");
  assert.equal(f("2222"), "sa:2222");
  assert.equal(f("أرامكو"), "sa:2222");
  assert.equal(f("الراجحي"), "sa:1120");
  assert.equal(f("EMAAR"), "ae:EMAAR");
  assert.equal(f("إعمار العقارية"), "ae:EMAAR");
  assert.equal(f("SPCX"), "us:SPCX");
  assert.equal(f("$NVDA"), "us:NVDA");
  assert.equal(f("us STC"), "us:STC");
  assert.equal(f("STC"), "kw:STC");
  assert.equal(f("كلام عشوائي ما له معنى"), null);
  assert.equal(f("hello world"), null);
});

test("help comes back for /start", async () => {
  assert.match(await B.answer("/start"), /رمز السهم أو اسمه/);
});

test("short names people use", () => {
  assert.equal(f("إعمار"), "ae:EMAAR");
  assert.equal(f("اجيليتي"), "kw:MKHZN");
  assert.equal(f("سالك"), "ae:SALIK");
});

test("the buying and selling lines: today's quantities and values, the period, the big days", () => {
  const t = B.flowText(
    "kw",
    {},
    { trades: { period: { bars: 20, buyPct: 62, buyValue: 5e9, sellValue: 3e9 }, big: [{ time: 1793000000, kind: "buy", rel: 2.6 }] }, flow: { inflowPct: 58, outflowPct: 42, net: 2e9, improving: true } },
    { volume: 1e6, buyPct: 70, buyValue: 5e8, sellValue: 2e8 },
  );
  for (const part of ["كمية الشراء 700 ألف سهم (70%)", "كمية البيع 300 ألف سهم (30%)", "قيمة الشراء 500 ألف د.ك", "🟢 +300 ألف د.ك", "آخر 20 جلسة", "🐋", "شراء قوي", "2.6x"]) assert.ok(t.includes(part), part);
});
