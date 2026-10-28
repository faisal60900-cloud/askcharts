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
