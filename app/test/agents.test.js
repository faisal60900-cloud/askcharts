// فريق الوكلاء: the risk manager's report, the insider purchases, and the daily clock. Offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.QT_DATA_DIR ||= mkdtempSync(path.join(os.tmpdir(), "agents-"));
const { riskText, parseOpenInsider, insidersText, due, review, hrText, introText, verdict, momentumRow, momentumText, followText } = await import("../lib/agents.js");

test("the risk manager: profit in dollars and dinars, the stop's result, and where to raise it", () => {
  const t = riskText([{ market: "us", code: "UBER", name: "UBER", mine: true, entry: 65.83, stop: 59.5, targets: [72, 75, 80, 88, 100], qty: 493, last: 69.46 }]);
  assert.match(t, /^🛡️ فهد · مدير المخاطر\nتقريرك الخاص/);
  assert.match(t, /🟢 UBER: 69\.46\$ · \+5\.5%/);
  assert.match(t, /الربح: \+1,790\$ ≈ \+549 د\.ك/);
  assert.match(t, /🛑 الوقف 59\.5\$ \(-14\.3%\): لو ضرب، النتيجة -957 د\.ك/);
  assert.match(t, /🎯 الهدف الجاي: 72\$ \(\+3\.7%\)/);
  assert.match(t, /💡 ارفع الوقف لسعر الدخول 65\.83: الصفقة بدون خسارة/);
  assert.doesNotMatch(t, /من صفقاتك/);
});

test("the risk manager: past a target, the stop to the entry; a Kuwaiti position in fils and dinars; concentration", () => {
  const t = riskText([
    { market: "us", code: "UBER", mine: true, entry: 65.83, stop: 59.5, targets: [72, 75], qty: 493, last: 73 },
    { market: "kw", code: "KFH", name: "بيتك", mine: true, entry: 790.9, stop: 700, targets: [820], qty: 1000, last: 754 },
    { market: "us", code: "XYZ", mine: false, entry: 10, stop: 9, targets: [11], last: 10 },
  ]);
  assert.match(t, /💡 ارفع الوقف لسعر الدخول 65\.83: الهدف الأول تحقق/);
  assert.match(t, /🔴 KFH \(بيتك\): 754فلس · -4\.7%\n   الربح: -37 د\.ك/);
  assert.match(t, /حجمها 94% من صفقاتك ⚠️ تركيز عالي/);
  assert.doesNotMatch(t, /XYZ/);
  assert.match(t, /💰 المجموع: \+1,\d{3} د\.ك/);
  assert.match(riskText([]), /ما عندي صفقات مسجلة لك/);
});

const HTML = `<table width="100%" class="tinytable"><thead><tr><th>X</th></tr></thead><tbody>
<tr><td></td><td>2026-11-04 17:02:11</td><td>2026-11-02</td><td><b><a href="/INTC" onmouseover="Tip('<img src=&quot;c.png&quot;>', DELAY, 1)" onmouseout="UnTip()">INTC</a></b></td><td><a>Intel Corp</a></td><td><a>Tan Lip-Bu</a></td><td>CEO</td><td>P - Purchase</td><td>$64.73</td><td>+150,000</td><td>1,460,000</td><td>+11%</td><td>+$9,709,680</td><td></td></tr>
<tr><td></td><td>2026-11-04 16:00:00</td><td>2026-10-30</td><td><a>SIRI</a></td><td>Sirius XM Holdings</td><td>Berkshire Hathaway Inc</td><td>10%</td><td>P - Purchase</td><td>$28.89</td><td>+743,965</td><td>120,000,000</td><td>+1%</td><td>+$21,494,116</td><td></td></tr>
<tr><td></td><td>2026-11-03 16:00:00</td><td>2026-11-01</td><td><a>TINY</a></td><td>Tiny Co</td><td>Someone</td><td>Dir</td><td>P - Purchase</td><td>$2.00</td><td>+10,000</td><td>50,000</td><td>+25%</td><td>+$20,000</td><td></td></tr>
<tr><td></td><td>2026-11-03 16:00:00</td><td>2026-11-01</td><td><a>SELL</a></td><td>Seller Co</td><td>Someone</td><td>CFO</td><td>S - Sale</td><td>$50</td><td>-10,000</td><td>0</td><td>-100%</td><td>-$500,000</td><td></td></tr>
</tbody></table>`;

test("the insider purchases: parsed from OpenInsider, the biggest first, small ones and sales left out", () => {
  const rows = parseOpenInsider(HTML);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { filed: "2026-11-04", date: "2026-11-02", code: "INTC", company: "Intel Corp", who: "Tan Lip-Bu", title: "CEO", type: "P - Purchase", price: 64.73, qty: 150000, own: "+11%", value: 9709680 });
  const t = insidersText(rows, { since: "2026-10-29", mine: ["UBER"] });
  assert.match(t, /• SIRI · Sirius XM Holdings\n   Berkshire Hathaway Inc \(10%\): 743,965 سهم على 28\.89\$ = 21\.5 مليون\$ · 2026-10-30/);
  assert.ok(t.indexOf("SIRI") < t.indexOf("INTC"));
  assert.doesNotMatch(t, /TINY|SELL/);
  // the same trade by two related funds, once
  assert.equal((insidersText([...rows, { ...rows[1], who: "Berkshire affiliate" }], { since: "2026-10-29" }).match(/SIRI/g) || []).length, 1);
  assert.match(t, /💼 أسهمك \(UBER\): ما في مدير اشترى فيها آخر أسبوع/);
  // yours first, even a smaller one
  assert.ok(insidersText(rows, { since: "2026-10-29", mine: ["INTC"] }).indexOf("INTC 💼") < insidersText(rows, { since: "2026-10-29", mine: ["INTC"] }).indexOf("SIRI"));
});

test("the clock: each agent once a day at its time, US weekdays and Kuwaiti working days", () => {
  // Friday 6 November 2026, 8:35 in New York (16:35 in Kuwait, a Kuwaiti weekend day)
  const fri = Date.UTC(2026, 10, 6, 13, 35);
  assert.deepEqual(due(fri, {}), [["insiders", "2026-11-06"]]);
  assert.deepEqual(due(fri, { "insiders|2026-11-06": 1 }), []);
  // 9:10 New York: the technical analyst
  assert.deepEqual(due(Date.UTC(2026, 10, 6, 14, 10), {}).map((x) => x[0]), ["tech"]);
  assert.deepEqual(due(Date.UTC(2026, 10, 6, 14, 20), {}).map((x) => x[0]), ["tech", "momentum"]);
  // 16:15 and 16:50 New York: risk, then results
  assert.deepEqual(due(Date.UTC(2026, 10, 6, 21, 15), {}).map((x) => x[0]), ["close", "risk"]);
  // 8:50 New York: نورة on the morning's results; 10:05: the picks after the open
  assert.deepEqual(due(Date.UTC(2026, 10, 6, 13, 50), {}).map((x) => x[0]), ["earnpre"]);
  assert.deepEqual(due(Date.UTC(2026, 10, 6, 15, 5), {}).map((x) => x[0]), ["open"]);
  assert.deepEqual(due(Date.UTC(2026, 10, 6, 21, 50), {}).map((x) => x[0]), ["earn"]);
  // Sunday 8 November, 10:35 in Kuwait: Kuwait's analyst (and nothing American on a Sunday)
  assert.deepEqual(due(Date.UTC(2026, 10, 8, 7, 35), {}), [["kw", "2026-11-08"]]);
  // Friday 10:35 in Kuwait: no Kuwaiti report
  assert.deepEqual(due(Date.UTC(2026, 10, 6, 7, 35), {}), []);
});

test("the HR review: each analyst's picks against the prices after them", () => {
  const bar = (d, high, low, close) => ({ time: Date.parse(`${d}T20:00:00Z`) / 1000, high, low, close });
  const picks = [
    { agent: "tech", code: "AAA", day: "2026-11-02", price: 100, stop: 96, t1: 104 },
    { agent: "tech", code: "BBB", day: "2026-11-02", price: 50, stop: 48, t1: 52 },
    { agent: "tech", code: "CCC", day: "2026-11-05", price: 20, stop: 19, t1: 21 },
    { agent: "insiders", code: "SIRI", day: "2026-11-02", price: 29 },
  ];
  const bars = {
    AAA: [bar("2026-11-02", 101, 99, 100), bar("2026-11-03", 105, 100, 104.5), bar("2026-11-04", 106, 103, 105)],
    BBB: [bar("2026-11-03", 50.5, 47.5, 48)],
    CCC: [bar("2026-11-06", 20.5, 19.5, 20.2)],
    SIRI: [bar("2026-11-03", 30, 29, 30.45)],
  };
  const r = review(picks, bars);
  assert.deepEqual(r.tech.map((x) => [x.code, x.outcome, +x.change.toFixed(1)]), [["AAA", "target", 5], ["BBB", "stop", -4], ["CCC", "open", 1]]);
  const t = hrText(r);
  assert.match(t, /^👩‍💼 مريم · مديرة الموارد البشرية/);
  assert.match(t, /📈 سالم \(المحلل الفني\): 3 توصية · نجاح 50% \(1 هدف، 1 وقف\) · متوسط \+0\.7%\n   التقييم: ✅ جيد/);
  assert.match(t, /🕵️ خالد \(متتبع الكبار\): 1 سهم[^\n]*\n   متوسط حركتها من سعر شراء المدير: \+5\.0%/);
  assert.match(hrText({ tech: [], insiders: [] }), /ما في توصيات كافية للتقييم/);
});

test("the hiring announcement names the team", () => {
  const t = introText();
  for (const n of ["مريم", "سالم", "خالد", "نورة", "فهد", "عبدالله"]) assert.match(t, new RegExp(n));
  assert.match(t, /إضافة على تنبيهاتك/);
});

test("the HR review is due Friday after the US close", () => {
  assert.deepEqual(due(Date.UTC(2026, 10, 6, 21, 35), {}).map((x) => x[0]), ["hr"]);
  assert.deepEqual(due(Date.UTC(2026, 10, 5, 21, 35), {}).map((x) => x[0]), []);
});

test("HR lets an analyst go: six closed picks, under 40% at the first target, losing on average", () => {
  const mk = (outcome, change) => ({ outcome, change });
  assert.equal(verdict([mk("stop", -4), mk("stop", -4), mk("stop", -4), mk("stop", -4), mk("target", 5), mk("open", 1)]).fire, false); // five closed
  const bad = verdict([mk("stop", -4), mk("stop", -4), mk("stop", -4), mk("stop", -4), mk("stop", -4), mk("target", 5)]);
  assert.equal(bad.fire, true);
  assert.equal(bad.rate, 17);
  const ok = verdict([mk("stop", -4), mk("stop", -4), mk("stop", -4), mk("target", 6), mk("target", 6), mk("target", 6)]);
  assert.equal(ok.fire, false);
  const t = hrText({ tech: [{ code: "A", day: "2026-11-02", outcome: "stop", change: -4 }], momentum: [], insiders: [] }, { fired: ["tech"] });
  assert.match(t, /🚪 قرار الفصل: سالم \(المحلل الفني\)/);
  assert.match(t, /اكتب «رجع سالم»/);
});

test("the momentum analyst: yesterday's breakout on volume, near the high, over the averages", () => {
  // 220 days rising slowly, then a breakout day on three times the volume
  const b = Array.from({ length: 220 }, (_, i) => ({ time: i * 86400, open: 50 + i * 0.1, high: 50.5 + i * 0.1, low: 49.5 + i * 0.1, close: 50 + i * 0.1, volume: 1e6 + (i % 5) * 1e5 }));
  // a pause so RSI isn't overbought
  for (let i = 200; i < 220; i++) Object.assign(b[i], { open: 70, high: 70.5, low: 69.5, close: 70 + (i % 2 ? 0.3 : -0.3) });
  b.push({ time: 221 * 86400, open: 70.2, high: 72, low: 70, close: 71.8, volume: 3.6e6 });
  const r = momentumRow("ABC", b);
  assert.ok(r, "a breakout");
  assert.equal(r.entry, 72.14);
  assert.equal(r.stop, 69.65);
  assert.deepEqual(r.targets, [74.63, 77.12, 79.61]);
  assert.match(momentumText([r]), /1️⃣ ABC: 71\.8\$ \(\+[\d.]+%\) · سيولة [\d.]+x · شراء 90% · RSI \d+\n   🟢 الدخول فوق: 72\.14\$ · 🛑 الوقف: 69\.65\$/);
  // no breakout on ordinary volume
  b.at(-1).volume = 1e6;
  assert.equal(momentumRow("ABC", b), null);
  assert.match(momentumText([]), /أحيانًا الأفضل ما تدخل/);
});

test("the follow-up after the open: where each of today's picks stands", () => {
  const picks = [
    { agent: "momentum", code: "AAA", day: "2026-11-06", price: 50, entry: 50, stop: 48, t1: 52 },
    { agent: "momentum", code: "BBB", day: "2026-11-06", price: 20, entry: 20, stop: 19, t1: 21 },
    { agent: "tech", code: "CCC", day: "2026-11-06", price: 78, lo: 74.33, hi: 76, stop: 72.39, t1: 77.94 },
    { agent: "tech", code: "DDD", day: "2026-11-06", price: 50, lo: 49.5, hi: 50.2, stop: 48.9, t1: 50.9 },
    { agent: "tech", code: "EEE", day: "2026-11-06", price: 30, stop: 28, t1: 32 },
  ];
  const t = followText(picks, { AAA: { price: 50.6, changePct: 2.1 }, BBB: { price: 19.7, changePct: -0.4 }, CCC: { price: 75.2, changePct: -3.5 }, DDD: { price: 51, changePct: 1 }, EEE: { price: 27.5, changePct: -5 } }, "open", { AAA: 71 });
  assert.match(t, /^🔔 بعد الافتتاح بنص ساعة · متابعة توصيات اليوم/);
  assert.match(t, /🚀 سعود:\n• AAA: 50\.6\$ \(\+2\.1% اليوم\) · شراء 71%\n   ✅ عدّى نقطة الدخول · الدخول 50\$ · الوقف 48\$ · الهدف 52\$/);
  assert.match(t, /• BBB: [^\n]*\n   ⏳ للحين تحت نقطة الدخول/);
  assert.match(t, /📈 سالم:\n• CCC: [^\n]*\n   ✅ داخل منطقة الشراء · المنطقة 74\.33–76\$/);
  assert.match(t, /• DDD: [^\n]*\n   🎯 وصل الهدف الأول/);
  assert.match(t, /• EEE: [^\n]*\n   🛑 تحت الوقف/);
  assert.ok(t.indexOf("سعود") < t.indexOf("سالم"));
  assert.equal(followText(picks, {}, "close"), "");
  assert.match(followText(picks, { AAA: { price: 50.6 } }, "close"), /^🔔 بعد الإغلاق/);
});
