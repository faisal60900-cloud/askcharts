// قطاعات السوق: a bottom-panel tab with where the money is going, sector by sector (Kuwait or the
// US), refreshed every 3 minutes while it is on screen. A click on a Kuwaiti sector's busiest stock,
// or on a US sector fund, opens its chart.
import { api } from "./api.js";
import { money } from "../lib/sectors.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const n1 = (v) => (v == null || !Number.isFinite(v) ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 1 }));
const sign = (v) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${n1(v)}%`);
const tone = (k) => ({ in: "sec-good", up: "sec-good", out: "sec-bad", down: "sec-bad", hot: "sec-hot", active: "sec-good", cold: "sec-cold" })[k] || "";
const timers = {};

export function renderSectors(box, app, market = "kw") {
  const kw = market === "kw";
  box.innerHTML = `<div class="sec-wrap" dir="rtl"><div class="sec-head"><b>${kw ? "🇰🇼 قطاعات السوق الكويتي" : "🇺🇸 قطاعات السوق الأمريكي"}</b><span class="hint-text" id="secAt"></span><button class="btn" id="secRefresh">تحديث</button><button class="btn" id="secOnChart"></button></div><div id="secBody"><div class="pad hint-text">يقرأ ${kw ? "كل أسهم بورصة الكويت (أقل من دقيقة)" : "صناديق القطاعات الأمريكية"}…</div></div></div>`;
  const body = box.querySelector("#secBody");
  async function load(fresh = false) {
    try {
      const t = await api.get(`/api/sectors?market=${market}${fresh ? "&fresh=1" : ""}`);
      if (!box.isConnected || !box.querySelector("#secBody")) return;
      box.querySelector("#secAt").textContent = `آخر تحديث ${new Date(t.at).toLocaleTimeString("ar-KW", { hour: "2-digit", minute: "2-digit" })} · ${t.read}/${t.of}`;
      body.innerHTML = `<div class="sec-sum">
          <span>الحالة: <b>${esc(t.state)}</b></span>
          <span>الشراء: <b>${Math.round(t.buyPct)}%</b></span>
          <span>السيولة: <b>${n1(t.rel)}x</b> من المعتاد</span>
          ${t.hot ? `<span class="sec-hot">🔥 الأقوى: <b>${esc(t.hot.ar)}</b></span>` : ""}
          ${t.rotation ? `<span>🔄 الانتقال: <b>${esc(t.rotation.from.ar)}</b> ← <b>${esc(t.rotation.to.ar)}</b></span>` : ""}
        </div>
        <table class="t kw-t sec-t"><thead><tr><th>#</th><th class="l">القطاع</th><th>سيولة اليوم</th><th>النشاط</th><th>الحرارة</th><th>الشراء%</th><th>آخر 5 أيام%</th><th>التدفق</th><th>تغير السيولة</th><th>السعر</th><th>طالع/نازل</th>${kw ? "<th>الأنشط</th>" : "<th>الصندوق</th>"}</tr></thead><tbody>
        ${t.rows
          .map(
            (r, i) => `<tr ${kw ? (r.top ? `data-s="YAHOO:${esc(r.top.code)}.KW"` : "") : `data-s="US:${esc(r.key)}"`}>
            <td>${i + 1}</td><td class="l"><b>${esc(r.ar)}</b> <span class="hint-text">(${r.n})</span></td>
            <td>${money(r.value, market)}</td>
            <td class="${tone(r.heat.k)}">${n1(r.rel)}x</td>
            <td class="${tone(r.heat.k)}">${r.heat.icon} ${r.heat.ar}</td>
            <td class="${r.buyPct >= 55 ? "sec-good" : r.buyPct <= 45 ? "sec-bad" : ""}">${Math.round(r.buyPct)}%</td>
            <td>${Math.round(r.buy5Pct)}%</td>
            <td class="${tone(r.flow.k)}">${r.flow.icon} ${r.flow.ar}</td>
            <td>${sign(r.liqChange)}</td>
            <td class="${r.change > 0 ? "sec-good" : r.change < 0 ? "sec-bad" : ""}">${sign(r.change)}</td>
            <td>${r.up}/${r.down}</td>
            <td>${kw ? (r.top ? `${esc(r.top.code)} <span class="hint-text">${sign(r.top.change)}</span>` : "—") : esc(r.key)}</td></tr>`,
          )
          .join("")}
        </tbody></table>
        <div class="pad hint-text">📥 يستقبل: الشراء 58% وفوق بسيولة طبيعية أو أعلى · ↗️ يتحسن: الشراء أعلى من آخر 5 أيام بـ 8 نقاط · 📤 يفقد: الشراء 42% أو أقل. الشراء والبيع تقدير من مكان الإغلاق في مدى اليوم. ${kw ? "تصنيف القطاعات تقريبي." : "القطاعات من صناديق SPDR (وSMH للشرائح)."}</div>`;
      body.querySelectorAll("tr[data-s]").forEach((tr) => (tr.onclick = () => app.setSymbol(tr.dataset.s)));
    } catch (e) {
      body.innerHTML = `<div class="pad hint-text">ما قدرت أقرأ القطاعات: ${esc(e.message)}</div>`;
    }
  }
  box.querySelector("#secRefresh").onclick = () => load(true);
  const onChart = box.querySelector("#secOnChart");
  const label = () => (onChart.textContent = app.sectorOverlay?.isOn() ? "إخفاء من الشارت" : "عرض على الشارت");
  label();
  onChart.onclick = () => {
    app.sectorOverlay?.set(!app.sectorOverlay.isOn());
    label();
  };
  clearInterval(timers[market]);
  timers[market] = setInterval(() => (box.querySelector(".sec-wrap") ? load() : clearInterval(timers[market])), 3 * 60e3);
  load();
}
