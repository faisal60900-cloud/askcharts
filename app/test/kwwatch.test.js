// The Kuwait market watch: the session window, the settings and the notification text. Offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.QT_OFFLINE = "1";
process.env.QT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "qt-kwwatch-"));
const W = await import("../lib/kwwatch.js");
const A = await import("../lib/alerts.js");

// times in UTC; Kuwait is UTC+3
const at = (iso) => new Date(iso);

test("the session is Sunday to Thursday, 9:00 to 12:45 Kuwait time", () => {
  assert.equal(W.sessionOpen(at("2026-10-27T06:30:00Z")), true, "Tuesday 9:30");
  assert.equal(W.sessionOpen(at("2026-10-27T05:59:00Z")), false, "Tuesday 8:59");
  assert.equal(W.sessionOpen(at("2026-10-27T09:46:00Z")), false, "Tuesday 12:46");
  assert.equal(W.sessionOpen(at("2026-10-25T07:00:00Z")), true, "Sunday 10:00");
  assert.equal(W.sessionOpen(at("2026-10-30T07:00:00Z")), false, "Friday");
  assert.equal(W.sessionOpen(at("2026-10-31T07:00:00Z")), false, "Saturday");
});

test("settings are clamped and saved; a webhook must be https", () => {
  const s = W.update({ on: true, every: 1, minValue: -5 });
  assert.equal(s.on, true);
  assert.equal(s.every, 5);
  assert.equal(s.minValue, 0);
  assert.throws(() => W.update({ webhook: "http://example.com" }), /https/);
  assert.equal(W.update({ webhook: "https://api.telegram.org/botX/sendMessage?chat_id=1" }).webhook.startsWith("https://"), true);
  W.update({ on: false, webhook: "" });
  W.stop();
});

test("the message names the stock, the breakout, the money and the plan, and says it isn't advice", () => {
  const text = W.message({
    code: "KRE", ar: null, en: "Kuwait Real Estate Co.", price: 356,
    breakout: { level: 352.34 }, relVol: 1.6, flow: { inflowPct: 63 }, buyToday: 70, positives: 5, negatives: 1,
    plan: { entryZone: { from: 350.03, to: 354.65 }, stop: 344.64, targets: [{ price: 361.87, rr: 1.2 }] },
  });
  for (const part of ["KRE", "352.34", "63%", "350.03", "344.64", "361.87", "1:1.2", "ليست توصية"]) assert.ok(text.includes(part), part);
});

test("a watch notification goes into the alert log and reaches listeners", async () => {
  let heard = null;
  const off = A.onFire((e) => (heard = e));
  const e = await A.notify({ symbol: "YAHOO:KRE.KW", name: "إشارة دخول فنية", text: "test" });
  off();
  assert.equal(heard.id, e.id);
  assert.equal(A.history()[0].id, e.id);
  assert.equal(e.text, "إشارة دخول فنية: test");
});

test("WhatsApp: the number needs its country code, the key is never sent back, and the URL is CallMeBot's", () => {
  assert.throws(() => W.update({ waPhone: "50000000" }), /رمز الدولة/);
  const s = W.update({ waPhone: "+965 5000 0123", waKey: "123456" });
  assert.equal(s.whatsapp, true);
  assert.equal(s.waKey, undefined, "the key stays on the server");
  assert.equal(s.waPhone, "+965•••123");
  assert.equal(W.update({ waKey: "" }).whatsapp, true, "an empty key keeps the saved one");
  assert.equal(W.update({ waPhone: "", waKey: "-" }).whatsapp, false);
  const u = new URL(W.whatsappUrl("+96550000123", "abc", "اختراق 352 ✓"));
  assert.equal(u.host, "api.callmebot.com");
  assert.equal(u.searchParams.get("phone"), "+96550000123");
  assert.equal(u.searchParams.get("text"), "اختراق 352 ✓");
  assert.equal(u.searchParams.get("apikey"), "abc");
  W.stop();
});

test("Telegram: the token is checked for shape, kept on the server, and cleared with '-'", () => {
  assert.throws(() => W.update({ tgToken: "not-a-token" }), /رمز البوت/);
  const s = W.update({ tgToken: "123456789:AAH4ZJ8kq_example_token_abcdefghijk" });
  assert.equal(s.tgToken, true, "only whether one is saved");
  assert.equal(s.telegram, false, "not linked until /start is found");
  assert.equal(W.update({ tgToken: "-" }).tgToken, false);
  W.stop();
});
