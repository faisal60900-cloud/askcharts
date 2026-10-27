// ماسح السوق الكويتي: a bottom-panel tab that reads every Boursa Kuwait stock's daily bars, scores
// it with the Market Reader and filters for breakouts with money coming in. A click on a row
// opens the chart, where the Market Reader draws its levels and plan.
import { api } from "./api.js";
import { KUWAIT_STOCKS } from "../lib/kuwait-market.js";
import { scanRow, FILTERS, ENTRY_RULES } from "../lib/kuwait-scan.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const num = (v, d = 1) => (v == null || !Number.isFinite(v) ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d }));
const KEY = "askcharts.kwscan";

const st = {
  rows: [],
  at: 0,
  running: false,
  stop: false,
  done: 0,
  failed: 0,
  on: new Set(),
  entryOnly: false,
  minValue: 10000,
  q: "",
  sort: "score",
  dir: -1,
};
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || "null");
  if (saved?.rows?.length) Object.assign(st, { rows: saved.rows, at: saved.at });
  if (saved?.prefs) {
    st.on = new Set(saved.prefs.on || []);
    st.entryOnly = !!saved.prefs.entryOnly;
    st.minValue = saved.prefs.minValue ?? 10000;
  }
} catch {}
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ rows: st.rows, at: st.at, prefs: { on: [...st.on], entryOnly: st.entryOnly, minValue: st.minValue } }));
  } catch {}
};

async function runScan(onProgress) {
  st.running = true;
  st.stop = false;
  st.done = st.failed = 0;
  const out = [];
  let i = 0,
    limited = false;
  const worker = async () => {
    while (!st.stop && !limited && i < KUWAIT_STOCKS.length) {
      const s = KUWAIT_STOCKS[i++];
      try {
        const r = await api.candles(s.symbol, "1D", 300);
        out.push(scanRow(s, r?.candles || []));
      } catch (e) {
        const msg = String(e.message || e);
        if (/rate limit/i.test(msg)) limited = true;
        out.push({ ...s, error: /rate limit/i.test(msg) ? "Yahoo مشغول، أعد المحاولة بعد دقائق" : "لا توجد بيانات" });
        st.failed++;
      }
      st.done++;
      onProgress();
    }
  };
  // three at a time: quick enough, and gentle on Yahoo
  await Promise.all([worker(), worker(), worker()]);
  st.running = false;
  if (out.length) {
    st.rows = out;
    st.at = Date.now();
    save();
  }
  return { limited, stopped: st.stop };
}

function visible() {
  const q = st.q.trim().toUpperCase();
  return st.rows
    .filter((r) => !r.error)
    .filter((r) => (r.value ?? 0) >= (st.minValue || 0))
    .filter((r) => !q || r.code.includes(q) || (r.ar || "").includes(st.q.trim()) || r.en.toUpperCase().includes(q))
    .filter((r) => (st.entryOnly ? r.entry : [...st.on].every((k) => FILTERS[k]?.test(r))))
    .sort((a, b) => {
      const k = st.sort,
        av = k === "code" ? a.code : a[k] ?? -Infinity,
        bv = k === "code" ? b.code : b[k] ?? -Infinity;
      return (av > bv ? 1 : av < bv ? -1 : 0) * st.dir;
    });
}

const bk = (b) =>
  !b ? '<span class="muted">—</span>' : b.dir === "up" ? `<b class="${b.confirmed ? "up" : "kw-gold"}">▲ ${num(b.level, 2)}${b.confirmed ? " ✓" : ""}</b>` : b.dir === "down" ? `<b class="down">▼ ${num(b.level, 2)}</b>` : b.dir === "near" ? `<span class="kw-gold">قرب ${num(b.level, 2)}</span>` : `<span class="muted">قرب كسر</span>`;

export function renderKwScan(box, app) {
  const cols = [
    ["code", "السهم"],
    ["price", "السعر"],
    ["changePct", "التغير%"],
    ["value", "قيمة التداول (د.ك)"],
    ["breakoutLevel", "الاختراق"],
    ["relVol", "السيولة"],
    ["inflowPct", "داخلة%"],
    ["buyToday", "شراء اليوم%"],
    ["positives", "الإشارات"],
    ["entryZone", "منطقة الدخول"],
    ["stop", "وقف الخسارة"],
    ["target", "الهدف 1"],
    ["rr", "ع:م"],
    ["score", "التقييم"],
  ];
  const sortable = { code: 1, price: 1, changePct: 1, value: 1, relVol: 1, buyToday: 1, positives: 1, score: 1 };

  function table() {
    const t = box.querySelector("#kwTable");
    if (!t) return;
    if (!st.rows.length) {
      t.innerHTML = `<div class="pad hint-text">اضغط <b>ابدأ المسح</b> ليقرأ البرنامج ${KUWAIT_STOCKS.length} سهمًا في بورصة الكويت (يأخذ دقيقة إلى دقيقتين).</div>`;
      return;
    }
    const rows = visible();
    const entries = st.rows.filter((r) => r.entry && (r.value ?? 0) >= (st.minValue || 0)).length;
    t.innerHTML = `<table class="t kw-t"><thead><tr>${cols.map(([k, l]) => `<th ${sortable[k] ? `data-k="${k}"` : ""} class="${k === "code" ? "l" : ""}">${l}${st.sort === k ? (st.dir < 0 ? " ↓" : " ↑") : ""}</th>`).join("")}</tr></thead><tbody>
      ${rows
        .slice(0, 300)
        .map((r) => {
          const p = r.plan,
            t1 = p?.targets?.[0];
          return `<tr data-s="${esc(r.symbol)}" class="${r.entry ? "kw-entry" : ""}">
          <td class="l"><b>${esc(r.code)}</b>${r.entry ? ' <span class="kw-badge">إشارة دخول</span>' : ""}<div class="muted kw-name">${esc(r.ar || r.en)}</div></td>
          <td>${num(r.price, 2)}</td>
          <td class="${(r.changePct ?? 0) >= 0 ? "up" : "down"}">${r.changePct == null ? "—" : (r.changePct > 0 ? "+" : "") + num(r.changePct) + "%"}</td>
          <td>${num(r.value, 0)}</td>
          <td>${bk(r.breakout)}</td>
          <td class="${(r.relVol ?? 0) >= 1.3 ? "up" : (r.relVol ?? 1) < 0.8 ? "down" : ""}">${r.relVol == null ? "—" : num(r.relVol) + "x"}</td>
          <td class="${(r.flow?.inflowPct ?? 50) >= 55 ? "up" : (r.flow?.inflowPct ?? 50) <= 45 ? "down" : ""}">${r.flow ? r.flow.inflowPct + "%" + (r.flow.improving ? " ↑" : "") : "—"}</td>
          <td class="${(r.buyToday ?? 50) > 55 ? "up" : (r.buyToday ?? 50) < 45 ? "down" : ""}">${r.buyToday == null ? "—" : r.buyToday + "%"}</td>
          <td><span class="up">${r.positives}✓</span> <span class="down">${r.negatives}✗</span></td>
          <td>${p ? `<bdi dir="ltr">${num(p.entryZone.from, 2)} – ${num(p.entryZone.to, 2)}</bdi>` : "—"}</td>
          <td class="down">${p ? num(p.stop, 2) : "—"}</td>
          <td class="up">${t1 ? `${num(t1.price, 2)} <small class="muted">+${num(t1.pct)}%</small>` : "—"}</td>
          <td class="${(t1?.rr ?? 0) >= 2 ? "up" : (t1?.rr ?? 0) < 1 ? "down" : ""}">${t1 ? "1:" + num(t1.rr) : "—"}</td>
          <td><b>${num(r.score)}</b></td></tr>`;
        })
        .join("")}</tbody></table>
      <div class="pad hint-text">${st.rows.some((r) => r.early) ? `<b class="kw-gold">الجلسة بدأت للتو لـ ${st.rows.filter((r) => r.early).length} سهم، فقُرئت على آخر جلسة مكتملة.</b><br>` : ""}${rows.length} سهم مطابق من ${st.rows.filter((r) => !r.error).length} · <b class="up">${entries} إشارة دخول</b> · ${st.rows.filter((r) => r.error).length} بلا بيانات · آخر مسح ${st.at ? new Date(st.at).toLocaleTimeString("ar-KW", { hour: "2-digit", minute: "2-digit" }) : "—"}. اضغط على أي سهم لفتح شارته مع خطة المستويات.<br>
      <b>إشارة دخول</b> = اختراق مؤكد بسيولة + سيولة داخلة 55% فأكثر + الشراء اليوم أكبر من البيع + ميزان إشارات إيجابي. منطقة الدخول ووقف الخسارة والأهداف محسوبة بقواعد فنية ثابتة من الشموع اليومية، وصفقات الشراء والبيع تقدير. هذه نتائج فلترة فنية وليست توصية، والقرار وحجم المخاطرة عليك.</div>`;
    t.querySelectorAll("th[data-k]").forEach((th) => {
      th.onclick = () => {
        const k = th.dataset.k;
        st.dir = st.sort === k ? -st.dir : k === "code" ? 1 : -1;
        st.sort = k;
        table();
      };
    });
    t.querySelectorAll("tr[data-s]").forEach((tr) => (tr.onclick = () => app.setSymbol(tr.dataset.s)));
  }

  box.innerHTML = `<div class="pad kw-head" dir="rtl"><div class="row-flex">
    <button class="btn primary" id="kwRun">${st.running ? "إيقاف" : st.rows.length ? "أعد المسح" : "ابدأ المسح"}</button>
    <span id="kwProg" class="hint-text"></span>
    <label class="field">بحث<input id="kwQ" value="${esc(st.q)}" style="width:110px" placeholder="رمز أو اسم"></label>
    <label class="field">أقل قيمة تداول يومية (د.ك)<input id="kwMin" type="number" min="0" step="1000" value="${st.minValue}" style="width:110px"></label>
    <button class="btn ${st.entryOnly ? "primary" : ""}" id="kwEntry" title="${ENTRY_RULES.map((k) => FILTERS[k].ar).join(" + ")}">${st.entryOnly ? "✓ " : ""}إشارات دخول شراء فقط</button>
  </div>
  <div class="kw-watch" id="kwWatch"></div>
  <div class="row-flex kw-chips">${Object.entries(FILTERS)
    .map(([k, f]) => `<label class="kw-chip ${st.on.has(k) ? "on" : ""}"><input type="checkbox" data-fl="${k}" ${st.on.has(k) ? "checked" : ""} ${st.entryOnly ? "disabled" : ""}>${esc(f.ar)}</label>`)
    .join("")}</div></div>
  <div id="kwTable" dir="rtl"></div>`;

  const prog = () => {
    const el = box.querySelector("#kwProg");
    if (el) el.textContent = st.running ? `جاري المسح… ${st.done} من ${KUWAIT_STOCKS.length}` : "";
  };
  box.querySelector("#kwRun").onclick = async (e) => {
    if (st.running) {
      st.stop = true;
      return;
    }
    e.target.textContent = "إيقاف";
    prog();
    const r = await runScan(prog);
    if (r.limited) app.toast?.("Yahoo بدأ يحدّ الطلبات، عرضت النتائج اللي وصلت. أعد المسح بعد دقائق.");
    else app.toast?.(`انتهى مسح السوق الكويتي: ${st.rows.filter((x) => x.entry).length} إشارة دخول.`);
    // the bottom panel may show another tab by now
    if (box.querySelector(".kw-head")) renderKwScan(box, app);
  };
  box.querySelector("#kwQ").oninput = (e) => {
    st.q = e.target.value;
    table();
  };
  box.querySelector("#kwMin").oninput = (e) => {
    st.minValue = Number(e.target.value) || 0;
    save();
    table();
  };
  box.querySelector("#kwEntry").onclick = () => {
    st.entryOnly = !st.entryOnly;
    save();
    renderKwScan(box, app);
  };
  box.querySelectorAll("[data-fl]").forEach((cb) => {
    cb.onchange = () => {
      cb.checked ? st.on.add(cb.dataset.fl) : st.on.delete(cb.dataset.fl);
      cb.closest(".kw-chip").classList.toggle("on", cb.checked);
      save();
      table();
    };
  });
  prog();
  table();
  watchBox();

  // 🔔 the server-side watch: it scans during the session and sends each new entry signal
  async function watchBox() {
    const el = box.querySelector("#kwWatch");
    if (!el) return;
    let w;
    try {
      w = await api.get("/api/kwwatch");
    } catch {
      el.innerHTML = '<span class="hint-text">التنبيه التلقائي يحتاج إعادة تشغيل البرنامج مرة وحدة.</span>';
      return;
    }
    const when = w.lastRun ? new Date(w.lastRun).toLocaleTimeString("ar-KW", { hour: "2-digit", minute: "2-digit" }) : "—";
    el.innerHTML = `<div class="row-flex">
      <button class="btn ${w.on ? "primary" : ""}" id="kwWOn">${w.on ? "🔔 التنبيه التلقائي شغال" : "🔕 شغّل التنبيه التلقائي"}</button>
      <label class="field">كل<select id="kwWEvery">${[5, 10, 15, 30].map((m) => `<option value="${m}" ${m === w.every ? "selected" : ""}>${m} دقيقة</option>`).join("")}</select></label>
      <label class="kw-chip ${w.afterClose ? "on" : ""}"><input type="checkbox" id="kwWClose" ${w.afterClose ? "checked" : ""}>مسح بعد الإغلاق</label>
      <button class="btn" id="kwWNow">افحص الآن وأرسل</button>
      <button class="btn" id="kwWPhone">📱 للجوال</button>
    </div>
    <div class="hint-text">${w.on ? `يمسح السوق كل ${w.every} دقيقة من الأحد للخميس 9:00–12:45${w.afterClose ? " ومرة بعد الإغلاق" : ""}، ويرسل تنبيه لكل إشارة دخول جديدة (مرة وحدة لكل سهم في اليوم).` : "شغّله ليمسح السوق خلال الجلسة ويرسل لك تنبيه بأي إشارة دخول جديدة، حتى لو المتصفح مقفل."} السوق الحين ${w.sessionOpen ? '<b class="up">مفتوح</b>' : "مغلق"} · آخر مسح ${when}${w.lastEntries?.length ? ` · الإشارات: ${w.lastEntries.join("، ")}` : ""}${w.lastError ? ` · <span class="down">${esc(w.lastError)}</span>` : ""}${w.webhook ? " · 📱 الإرسال للجوال مفعّل" : ""}</div>
    <div id="kwWPhoneBox" hidden class="kw-phone"><label class="field">رابط الإرسال (Telegram أو Discord أو Slack)<input id="kwWHook" value="${esc(w.webhook || "")}" placeholder="https://api.telegram.org/bot…/sendMessage?chat_id=…" style="width:340px" dir="ltr"></label><button class="btn" id="kwWHookSave">حفظ</button></div>`;
    const post = async (patch) => {
      try {
        await api.post("/api/kwwatch", patch);
      } catch (e) {
        app.toast?.(e.message);
      }
      watchBox();
    };
    el.querySelector("#kwWOn").onclick = async () => {
      if (!w.on && "Notification" in window && Notification.permission === "default") await Notification.requestPermission().catch(() => {});
      post({ on: !w.on, minValue: st.minValue });
    };
    el.querySelector("#kwWEvery").onchange = (e) => post({ every: Number(e.target.value) });
    el.querySelector("#kwWClose").onchange = (e) => post({ afterClose: e.target.checked });
    el.querySelector("#kwWPhone").onclick = () => (el.querySelector("#kwWPhoneBox").hidden = !el.querySelector("#kwWPhoneBox").hidden);
    el.querySelector("#kwWHookSave").onclick = () => post({ webhook: el.querySelector("#kwWHook").value });
    el.querySelector("#kwWNow").onclick = async (e) => {
      e.target.disabled = true;
      e.target.textContent = "جاري المسح…";
      try {
        await api.post("/api/kwwatch", { minValue: st.minValue });
        const r = await api.post("/api/kwwatch/run");
        app.toast?.(r.sent ? `أُرسلت ${r.sent} إشارة دخول جديدة.` : r.entries ? `${r.entries} إشارة دخول، وكلها أُرسلت لك سابقًا اليوم.` : `مسح ${r.scanned} سهم: لا توجد إشارة دخول الآن.`);
      } catch (err) {
        app.toast?.(err.message);
      }
      watchBox();
    };
  }
}
