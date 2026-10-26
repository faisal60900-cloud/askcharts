// Gulf stocks: Boursa Kuwait and Tadawul names, Arabic and English, through search and resolve.
// Offline: no live calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.QT_OFFLINE = "1";
process.env.QT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "qt-gulf-"));
const G = await import("../lib/gulf.js");
const P = await import("../lib/providers.js");

const syms = (rows) => rows.map((r) => r.symbol);

test("Arabic names find their stock, with or without ال and with any hamza", () => {
  assert.equal(G.searchGulf("بيتك")[0].symbol, "YAHOO:KFH.KW");
  assert.equal(G.searchGulf("الوطني")[0].symbol, "YAHOO:NBK.KW");
  assert.equal(G.searchGulf("وطني")[0].symbol, "YAHOO:NBK.KW");
  assert.equal(G.searchGulf("زين")[0].symbol, "YAHOO:ZAIN.KW");
  assert.equal(G.searchGulf("ارامكو")[0].symbol, "YAHOO:2222.SR");
  assert.equal(G.searchGulf("أرامكو")[0].symbol, "YAHOO:2222.SR");
  assert.equal(G.searchGulf("بيت التمويل")[0].symbol, "YAHOO:KFH.KW");
});

test("a partial Arabic name lists every match", () => {
  const banks = syms(G.searchGulf("بنك"));
  for (const s of ["YAHOO:NBK.KW", "YAHOO:BOUBYAN.KW", "YAHOO:BURG.KW"]) assert.ok(banks.includes(s), s);
});

test("tickers and English names find their stock", () => {
  assert.equal(G.searchGulf("NBK")[0].symbol, "YAHOO:NBK.KW");
  assert.equal(G.searchGulf("nbk.kw")[0].symbol, "YAHOO:NBK.KW");
  assert.equal(G.searchGulf("2222")[0].symbol, "YAHOO:2222.SR");
  assert.equal(G.searchGulf("boubyan")[0].symbol, "YAHOO:BOUBYAN.KW");
  assert.ok(syms(G.searchGulf("aramco")).includes("YAHOO:2222.SR"));
  assert.deepEqual(G.searchGulf("x"), []);
  assert.deepEqual(G.searchGulf(""), []);
});

test("an Arabic name typed into the symbol box resolves; an unknown one is still refused", async () => {
  assert.equal((await P.resolve("بيتك")).id, "YAHOO:KFH.KW");
  assert.equal((await P.resolve("بنك بوبيان")).id, "YAHOO:BOUBYAN.KW");
  assert.equal((await P.resolve("الراجحي")).id, "YAHOO:1120.SR");
  await assert.rejects(P.resolve("كلامعشوائي"));
});

test("suffixed Gulf tickers still resolve through Yahoo, and US tickers are unchanged", async () => {
  assert.equal((await P.resolve("NBK.KW")).id, "YAHOO:NBK.KW");
  assert.equal((await P.resolve("2222.SR")).id, "YAHOO:2222.SR");
  assert.equal((await P.resolve("AAPL")).id, "US:AAPL");
});

test("the app's search lists Gulf stocks first for their ticker or Arabic name", async () => {
  assert.equal((await P.search("بيتك"))[0].symbol, "YAHOO:KFH.KW");
  assert.equal((await P.search("NBK"))[0].symbol, "YAHOO:NBK.KW");
  assert.equal((await P.search("2222"))[0].symbol, "YAHOO:2222.SR");
  assert.ok(syms(await P.search("BTC")).some((s) => s.startsWith("BINANCE:BTC")), "crypto search unchanged");
});
