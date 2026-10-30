// What a company does: the written ones, and nothing (not a guess) when nothing is known. Offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.QT_OFFLINE = "1";
process.env.QT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "qt-about-"));
const A = await import("../lib/about.js");

test("known companies have their line; an unknown one without AI or sector has none", async () => {
  assert.match(await A.about({ code: "NVDA" }, "us"), /معالجات الرسوم/);
  assert.match(await A.about({ code: "ALSAFAT" }, "kw"), /استثمار/);
  assert.equal(await A.about({ code: "ZZZZ", en: "Unknown Co" }, "us"), "");
  assert.equal(A.aboutLine(""), "");
  assert.match(A.aboutLine("بنك"), /🏢 الشركة: بنك/);
});

test("a stock with a sector and no AI answer gets its sector", async () => {
  assert.equal(await A.about({ code: "1120", en: "Al Rajhi", sector: "بنوك" }, "sa"), "بنوك");
});
