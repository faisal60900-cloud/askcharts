// فريق الوكلاء: the risk manager's report, the insider purchases, and the daily clock. Offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.QT_DATA_DIR ||= mkdtempSync(path.join(os.tmpdir(), "agents-"));
const { riskText, parseOpenInsider, insidersText, due } = await import("../lib/agents.js");

test("the risk manager: profit in dollars and dinars, the stop's result, and where to raise it", () => {
  const t = riskText([{ market: "us", code: "UBER", name: "UBER", mine: true, entry: 65.83, stop: 59.5, targets: [72, 75, 80, 88, 100], qty: 493, last: 69.46 }]);
  assert.match(t, /🛡️ مدير المخاطر · تقريرك الخاص/);
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
  // 16:15 and 16:50 New York: risk, then results
  assert.deepEqual(due(Date.UTC(2026, 10, 6, 21, 15), {}).map((x) => x[0]), ["risk"]);
  assert.deepEqual(due(Date.UTC(2026, 10, 6, 21, 50), {}).map((x) => x[0]), ["earn"]);
  // Sunday 8 November, 10:35 in Kuwait: Kuwait's analyst (and nothing American on a Sunday)
  assert.deepEqual(due(Date.UTC(2026, 10, 8, 7, 35), {}), [["kw", "2026-11-08"]]);
  // Friday 10:35 in Kuwait: no Kuwaiti report
  assert.deepEqual(due(Date.UTC(2026, 10, 6, 7, 35), {}), []);
});
