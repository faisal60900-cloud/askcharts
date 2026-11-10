import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
process.env.QT_DATA_DIR ||= mkdtempSync(path.join(os.tmpdir(), "sharia-"));
const sharia = await import("../lib/sharia.js");

// Nasdaq's quarterly statements, in thousands of dollars
const fin = (industry, cap, { debt = 0, ltd = 0, cash = 0, sti = "--" } = {}) => ({
  stats: [{ label: "Industry", value: industry }, { label: "Market Cap", value: cap.toLocaleString("en-US") }],
  balance: { rows: [["Cash and Cash Equivalents", `$${cash.toLocaleString("en-US")}`], ["Short-Term Investments", sti], ["Short-Term Debt / Current Portion of Long-Term Debt", debt ? `$${debt.toLocaleString("en-US")}` : "--"], ["Long-Term Debt", `$${ltd.toLocaleString("en-US")}`]] },
});

test("the activity: banks, insurers, lenders, alcohol, pork, gambling and tobacco out; the rest in", () => {
  assert.deepEqual(sharia.activity({ code: "JPM", industry: "Major Banks" }), { ok: false, why: "بنك تقليدي (فوائد)" });
  assert.equal(sharia.activity({ code: "MET", industry: "Life Insurance" }).why, "تأمين تقليدي");
  assert.equal(sharia.activity({ code: "ARES", industry: "Investment Managers" }).why, "تمويل بالفوائد");
  assert.equal(sharia.activity({ code: "TAP", industry: "Beverages (Production/Distribution)" }).why, "خمور");
  assert.equal(sharia.activity({ code: "KO", industry: "Beverages (Production/Distribution)" }).ok, true);
  assert.equal(sharia.activity({ code: "HRL", industry: "Meat/Poultry/Fish" }).why, "لحم خنزير");
  assert.equal(sharia.activity({ code: "VICI", industry: "Real Estate Investment Trusts" }).why, "قمار وكازينوهات");
  assert.equal(sharia.activity({ code: "PLD", industry: "Real Estate Investment Trusts" }).ok, true);
  assert.equal(sharia.activity({ code: "MO", industry: "Medicinal Chemicals and Botanical Products" }).why, "تبغ");
  assert.equal(sharia.activity({ code: "MAIN", industry: "Finance/Investors Services" }).ok, false);
  // the broad consumer-finance class: the lenders out, a data centre or a rating agency in
  assert.equal(sharia.activity({ code: "SOFI", industry: "Finance: Consumer Services" }).ok, false);
  assert.equal(sharia.activity({ code: "IREN", industry: "Finance: Consumer Services" }).ok, true);
  assert.equal(sharia.activity({ code: "SPGI", industry: "Finance: Consumer Services" }).ok, true);
  // Kuwait: the conventional banks out, the Islamic ones in
  assert.equal(sharia.activity({ code: "KW:NBK" }).ok, false);
  assert.equal(sharia.activity({ code: "KW:KFH" }).ok, true);
  assert.equal(sharia.activity({ code: "KW:WARBABANK" }).ok, true);
});

test("the ratios: debt and cash each under 30% of the market value", () => {
  // Prologis: 36.8 billion of debt on 124 billion
  const ok = sharia.screen(fin("Real Estate Investment Trusts", 124_070_461_890, { ltd: 36_832_482, cash: 2_273_497 }), "US:PLD");
  assert.equal(ok.status, "ok");
  assert.equal(ok.debtPct, 29.7);
  const debt = sharia.screen(fin("Packaged Foods", 19e9, { debt: 2_000_000, ltd: 12_000_000, cash: 500_000 }), "US:GIS");
  assert.equal(debt.status, "no");
  assert.match(debt.why, /الديون 74% من قيمة الشركة \(الحد 30%\)/);
  const cash = sharia.screen(fin("Computer Software", 10e9, { cash: 2_500_000, sti: "$1,000,000" }), "US:X");
  assert.match(cash.why, /الكاش والودائع 35%/);
  assert.equal(sharia.screen(null, "US:Y").status, "unknown");
  assert.equal(sharia.screen(fin("Major Banks", 1e9), "US:Z").status, "no");
});

test("keep: the non-compliant out, the unknown kept, each stock fetched once a month", async () => {
  sharia.reset();
  let calls = 0;
  const finImpl = async (id) => {
    calls++;
    if (id === "US:BAD") return fin("Packaged Foods", 1e9, { ltd: 900_000 });
    if (id === "US:ERR") throw new Error("down");
    if (id === "US:JPM") return fin("Major Banks", 1e9);
    return fin("Computer Software", 1e9, { ltd: 10_000 });
  };
  const items = [{ code: "GOOD" }, { code: "BAD" }, { code: "JPM" }, { code: "ERR" }, { code: "TAP" }];
  sharia.reset({ on: true, cache: {} });
  const kept = await sharia.keep(items, (x) => x.code, { finImpl });
  assert.deepEqual(kept.map((x) => x.code), ["GOOD", "ERR"]);
  assert.equal(calls, 4); // TAP needed no statements
  await sharia.keep(items, (x) => x.code, { finImpl });
  assert.equal(calls, 4);
  // off: everything passes
  sharia.setOn(false);
  assert.equal((await sharia.keep(items, (x) => x.code, { finImpl })).length, 5);
  sharia.setOn(true);
  assert.match(sharia.label({ status: "ok", debtPct: 12.3, cashPct: 4 }), /🕌 متوافق مع الشريعة \(الديون 12%، الكاش 4%\)/);
  assert.match(sharia.label({ status: "no", why: "خمور" }), /⛔ غير متوافق: خمور/);
});
