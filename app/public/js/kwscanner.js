// ماسح السوق الكويتي: a bottom-panel tab that reads every Boursa Kuwait stock's daily bars, scores
// it with the Market Reader and filters for breakouts with money coming in. A click on a row
// opens the chart, where the Market Reader draws its levels and plan.
import { api } from "./api.js";
import { KUWAIT_STOCKS } from "../lib/kuwait-market.js";
import { SAUDI_STOCKS } from "../lib/saudi-market.js";
import { scanRow, FILTERS, entryRules } from "../lib/kuwait-scan.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const num = (v, d = 1) => (v == null || !Number.isFinite(v) ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d }));
// One state per market, each remembered in this browser.
const MARKETS = {
  kw: { key: "askcharts.kwscan", minValue: 10000, cur: "د.ك", title: "السوق الكويتي" },
  us: { key: "askcharts.usscan", minValue: 20e6, cur: "$", title: "السوق الأمريكي" },
  sa: { key: "askcharts.sascan", minValue: 5e6, cur: "ريال", title: "السوق السعودي" },
};
function makeState(m) {
  const st = { rows: [], at: 0, running: false, stop: false, done: 0, failed: 0, of: 0, on: new Set(), entryOnly: false, minValue: MARKETS[m].minValue, size: 500, q: "", sort: "score", dir: -1, m };
  try {
    const saved = JSON.parse(localStorage.getItem(MARKETS[m].key) || "null");
    if (saved?.rows?.length) Object.assign(st, { rows: saved.rows, at: saved.at });
    if (saved?.prefs) {
      st.on = new Set(saved.prefs.on || []);
      st.entryOnly = !!saved.prefs.entryOnly;
      st.minValue = saved.prefs.minValue ?? MARKETS[m].minValue;
      st.size = saved.prefs.size ?? 500;
    }
  } catch {}
  return st;
}
const states = { kw: makeState("kw"), us: makeState("us"), sa: makeState("sa") };
const save = (st) => {
  try {
    localStorage.setItem(MARKETS[st.m].key, JSON.stringify({ rows: st.rows, at: st.at, prefs: { on: [...st.on], entryOnly: st.entryOnly, minValue: st.minValue, size: st.size } }));
  } catch {}
};

// The US list: every Nasdaq-listed company from the screener, $5 and up, $2B and up, the most
// traded (price × volume) first.
async function usUniverse(size) {
  const rows = await api.get("/api/screener?universe=us");
  return rows
    .filter((r) => r.price >= 5 && r.marketCap >= 2e9 && r.volume > 0 && /^[A-Z]{1,5}$/.test(r.ticker))
    .sort((a, b) => b.price * b.volume - a.price * a.volume)
    .slice(0, size)
    .map((r) => ({ code: r.ticker, symbol: r.symbol, en: r.name.replace(/\s+(Common Stock|Class [A-Z] Common Stock|Ordinary Shares).*$/i, ""), ar: null, sector: r.sector }));
}

async function runScan(st, list, onProgress) {
  st.running = true;
  st.stop = false;
  st.done = st.failed = 0;
  st.of = list.length;
  const out = [];
  let i = 0,
    limited = false;
  const worker = async () => {
    while (!st.stop && !limited && i < list.length) {
      const s = list[i++];
      try {
        const r = await api.candles(s.symbol, "1D", 300);
        out.push(scanRow(s, r?.candles || [], Date.now(), { market: st.m }));
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
    save(st);
  }
  return { limited, stopped: st.stop };
}

function visible(st) {
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

export function renderKwScan(box, app, market = "kw") {
  const st = states[market],
    M = MARKETS[market],
    kw = market === "kw",
    sa = market === "sa";
  const cols = [
    ["code", "السهم"],
    ["price", "السعر"],
    ["changePct", "التغير%"],
    ["value", `قيمة التداول (${M.cur})`],
    ["breakoutLevel", "الاختراق"],
    ["relVol", "السيولة"],
    ["inflowPct", "داخلة%"],
    ["buyToday", "شراء اليوم%"],
    ["positives", "الإشارات"],
    ["entryZone", "منطقة الدخول"],
    ["stop", "وقف أولي"],
    ["trail", "وقف متحرك"],
    ["target", "مقاومة قريبة"],
    ["weekly", "الأسبوعي"],
    ["score", "التقييم"],
  ];
  const sortable = { code: 1, price: 1, changePct: 1, value: 1, relVol: 1, buyToday: 1, positives: 1, score: 1 };

  function table() {
    const t = box.querySelector("#kwTable");
    if (!t) return;
    if (!st.rows.length) {
      t.innerHTML = `<div class="pad hint-text">اضغط <b>ابدأ المسح</b> ليقرأ البرنامج ${kw ? `${KUWAIT_STOCKS.length} سهمًا في بورصة الكويت (أقل من دقيقة)` : sa ? `${SAUDI_STOCKS.length} سهم في السوق السعودي الرئيسي (تقريبًا دقيقة)` : `أنشط ${st.size} سهم أمريكي (سعر فوق 5$ وقيمة سوقية فوق 2 مليار، الأعلى تداولًا أولًا). يأخذ تقريبًا ${Math.ceil(st.size / 100)} دقيقة`}.</div>`;
      return;
    }
    const rows = visible(st);
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
          <td>${kw ? num(r.value, 0) : r.value >= 1e9 ? num(r.value / 1e9, 2) + "B" : num(r.value / 1e6, 1) + "M"}</td>
          <td>${bk(r.breakout)}</td>
          <td class="${(r.relVol ?? 0) >= 1.3 ? "up" : (r.relVol ?? 1) < 0.8 ? "down" : ""}">${r.relVol == null ? "—" : num(r.relVol) + "x"}</td>
          <td class="${(r.flow?.inflowPct ?? 50) >= 55 ? "up" : (r.flow?.inflowPct ?? 50) <= 45 ? "down" : ""}">${r.flow ? r.flow.inflowPct + "%" + (r.flow.improving ? " ↑" : "") : "—"}</td>
          <td class="${(r.buyToday ?? 50) > 55 ? "up" : (r.buyToday ?? 50) < 45 ? "down" : ""}">${r.buyToday == null ? "—" : r.buyToday + "%"}</td>
          <td><span class="up">${r.positives}✓</span> <span class="down">${r.negatives}✗</span></td>
          <td>${p ? `<bdi dir="ltr">${num(p.entryZone.from, 2)} – ${num(p.entryZone.to, 2)}</bdi>` : "—"}</td>
          <td class="down">${p ? num(p.stop, 2) : "—"}</td>
          <td>${r.trail ? `−${num(r.trail.dist, 2)}` : "—"}</td>
          <td>${t1 ? `${num(t1.price, 2)} <small class="muted">+${num(t1.pct)}%</small>` : "—"}</td>
          <td class="${(r.weekly ?? 0) > 0 ? "up" : (r.weekly ?? 0) < 0 ? "down" : ""}">${(r.weekly ?? 0) > 0 ? "صاعد" : (r.weekly ?? 0) < 0 ? "هابط" : "محايد"}</td>
          <td><b>${num(r.score)}</b></td></tr>`;
        })
        .join("")}</tbody></table>
      <div class="pad hint-text">${st.rows.some((r) => r.early) ? `<b class="kw-gold">الجلسة بدأت للتو لـ ${st.rows.filter((r) => r.early).length} سهم، فقُرئت على آخر جلسة مكتملة.</b><br>` : ""}${rows.length} سهم مطابق من ${st.rows.filter((r) => !r.error).length} · <b class="up">${entries} إشارة دخول</b> · ${st.rows.filter((r) => r.error).length} بلا بيانات · آخر مسح ${st.at ? new Date(st.at).toLocaleTimeString("ar-KW", { hour: "2-digit", minute: "2-digit" }) : "—"}. اضغط على أي سهم لفتح شارته مع خطة المستويات.<br>
      <b>إشارة دخول</b> = اختراق مؤكد بسيولة + سيولة داخلة 55% فأكثر + الشراء أكبر من البيع + ميزان إشارات إيجابي + <b>${entryRules(market).slice(4).map((k) => FILTERS[k].ar).join(" + ")}</b>. الخروج المختبر تاريخيًا: <b>وقف متحرك</b> = أعلى سعر بعد الدخول ناقص ${market === "us" ? "3" : "2.5"} ATR (العمود «وقف متحرك»)، والمقاومة القريبة للمعلومة فقط. صفقات الشراء والبيع تقدير. هذه نتائج فلترة فنية وليست توصية، والقرار وحجم المخاطرة عليك.</div>`;
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

  box.innerHTML = `<div class="pad kw-head" data-m="${market}" dir="rtl"><div class="row-flex">
    <button class="btn primary" id="kwRun">${st.running ? "إيقاف" : st.rows.length ? "أعد المسح" : "ابدأ المسح"}</button>
    <span id="kwProg" class="hint-text"></span>
    <label class="field">بحث<input id="kwQ" value="${esc(st.q)}" style="width:110px" placeholder="رمز أو اسم"></label>
    ${kw || sa ? "" : `<label class="field">عدد الأسهم<select id="kwSize">${[100, 300, 500, 1000].map((n) => `<option value="${n}" ${n === st.size ? "selected" : ""}>أنشط ${n}</option>`).join("")}</select></label>`}
    <label class="field">أقل قيمة تداول يومية (${M.cur})<input id="kwMin" type="number" min="0" step="${kw ? 1000 : 1000000}" value="${st.minValue}" style="width:120px"></label>
    <button class="btn ${st.entryOnly ? "primary" : ""}" id="kwEntry" title="${entryRules(market).map((k) => FILTERS[k].ar).join(" + ")}">${st.entryOnly ? "✓ " : ""}إشارات دخول شراء فقط</button>
  </div>
  ${kw ? '<div class="kw-watch" id="kwWatch"></div>' : sa ? '<div class="kw-watch" id="saWatch"></div><div class="kw-watch hint-text">🇸🇦 السوق السعودي الرئيسي (بدون صناديق الريت). الأسعار بالريال، والجلسة من 10:00 الصبح إلى 3:00 العصر (نفس توقيت الكويت) ثم مزاد الإغلاق، والسيولة مقارنة بالجزء اللي مضى من الجلسة.</div>' : '<div class="kw-watch" id="usWatch"></div><div class="kw-watch hint-text">🇺🇸 شروط خاصة بالسوق الأمريكي من اختبار تاريخه: اختراق بسيولة <b>2x فأكثر</b> ووقف متحرك أوسع (3 ATR). الأسعار بالدولار، والسيولة مقارنة بالجزء اللي مضى من جلسة نيويورك (4:30 العصر إلى 11 الليل بتوقيت الكويت).</div>'}
  <div class="kw-watch" id="kwTrack"></div>
  <div class="row-flex kw-chips">${Object.entries(FILTERS)
    .map(([k, f]) => `<label class="kw-chip ${st.on.has(k) ? "on" : ""}"><input type="checkbox" data-fl="${k}" ${st.on.has(k) ? "checked" : ""} ${st.entryOnly ? "disabled" : ""}>${esc(f.ar)}</label>`)
    .join("")}</div></div>
  <div id="kwTable" dir="rtl"></div>`;

  const prog = () => {
    const el = box.querySelector("#kwProg");
    if (el) el.textContent = st.running ? `جاري المسح… ${st.done} من ${st.of || "…"}` : "";
  };
  box.querySelector("#kwRun").onclick = async (e) => {
    if (st.running) {
      st.stop = true;
      return;
    }
    e.target.textContent = "إيقاف";
    prog();
    let list;
    try {
      list = kw ? KUWAIT_STOCKS : sa ? SAUDI_STOCKS : await usUniverse(st.size);
    } catch (err) {
      app.toast?.(`ما قدرت أجيب قائمة الأسهم الأمريكية: ${err.message}`);
      return renderKwScan(box, app, market);
    }
    const r = await runScan(st, list, prog);
    if (r.limited) app.toast?.("مصدر البيانات بدأ يحدّ الطلبات، عرضت النتائج اللي وصلت. أعد المسح بعد دقائق.");
    else app.toast?.(`انتهى مسح ${M.title}: ${st.rows.filter((x) => x.entry).length} إشارة دخول.`);
    // the bottom panel may show another tab by now
    if (box.querySelector(`.kw-head[data-m="${market}"]`)) renderKwScan(box, app, market);
  };
  box.querySelector("#kwQ").oninput = (e) => {
    st.q = e.target.value;
    table();
  };
  box.querySelector("#kwMin").oninput = (e) => {
    st.minValue = Number(e.target.value) || 0;
    save(st);
    table();
  };
  box.querySelector("#kwEntry").onclick = () => {
    st.entryOnly = !st.entryOnly;
    save(st);
    renderKwScan(box, app, market);
  };
  box.querySelectorAll("[data-fl]").forEach((cb) => {
    cb.onchange = () => {
      cb.checked ? st.on.add(cb.dataset.fl) : st.on.delete(cb.dataset.fl);
      cb.closest(".kw-chip").classList.toggle("on", cb.checked);
      save(st);
      table();
    };
  });
  box.querySelector("#kwSize") &&
    (box.querySelector("#kwSize").onchange = (e) => {
      st.size = Number(e.target.value);
      save(st);
      table();
    });
  prog();
  table();
  if (kw) watchBox();
  else if (sa) saWatchBox();
  else usWatchBox();
  trackBox();

  // 🔔 the US watch on the server: signals, Arabic news and three briefs a day to Telegram
  async function usWatchBox() {
    const el = box.querySelector("#usWatch");
    if (!el) return;
    let w;
    try {
      w = await api.get("/api/uswatch");
    } catch {
      el.innerHTML = '<span class="hint-text">مراقبة أمريكا تحتاج إعادة تشغيل البرنامج.</span>';
      return;
    }
    const when = w.lastRun ? new Date(w.lastRun).toLocaleTimeString("ar-KW", { hour: "2-digit", minute: "2-digit" }) : "—";
    const chip = (k, label) => `<label class="kw-chip ${w[k] ? "on" : ""}"><input type="checkbox" data-us="${k}" ${w[k] ? "checked" : ""}>${label}</label>`;
    const nyClock = `${String(Math.floor(w.ny.min / 60)).padStart(2, "0")}:${String(w.ny.min % 60).padStart(2, "0")}`;
    el.innerHTML = `<div class="row-flex">
      <button class="btn ${w.on ? "primary" : ""}" id="usOn">${w.on ? "🔔 مراقبة أمريكا شغالة" : "🔕 شغّل مراقبة أمريكا"}</button>
      <label class="field">مسح كل<select id="usEvery">${[5, 10, 15, 30].map((m) => `<option value="${m}" ${m === w.every ? "selected" : ""}>${m} دقيقة</option>`).join("")}</select></label>
      <label class="field">عدد الأسهم<select id="usSize">${[100, 300, 500, 1000].map((n) => `<option value="${n}" ${n === w.size ? "selected" : ""}>أنشط ${n}</option>`).join("")}</select></label>
      ${chip("briefs", "تقارير الافتتاح والإغلاق")}${chip("news", "أخبار بالعربي")}${chip("ai", "تحليل Claude")}
    </div>
    <div class="row-flex" style="margin-top:6px">
      <button class="btn" data-usnow="run">افحص الآن وأرسل</button>
      <button class="btn" data-usnow="pre">أرسل تقرير السوق الآن</button>
      <button class="btn" data-usnow="radar">رادار ما قبل الافتتاح الآن</button>
      <button class="btn" data-usnow="close">أرسل ملخص الإغلاق الآن</button>
    </div>
    <div class="hint-text">${w.telegram ? "📱 يرسل على تيليجرام" : '<span class="down">تيليجرام مو مربوط: اربطه من تبويب ماسح الكويت ← 📱 للجوال</span>'} · الوقت في نيويورك ${nyClock} · آخر مسح ${when}${w.lastEntries?.length ? ` · الإشارات: ${w.lastEntries.join("، ")}` : ""}${w.lastError ? ` · <span class="down">${esc(w.lastError)}</span>` : ""}<br>
    التقارير بتوقيت الكويت: ${w.ny.date >= "2026-11-01" && w.ny.date < "2027-03-14" ? "قبل الافتتاح 5:00 العصر · رادار قبل المزاد 5:15 · مسح كل 5 دقايق من الافتتاح 5:30 لين 6:00 · بعد الافتتاح 5:40 · الإغلاق 12:05 بعد نص الليل" : "قبل الافتتاح 4:00 العصر · رادار قبل المزاد 4:15 · مسح كل 5 دقايق من الافتتاح 4:30 لين 5:00 · بعد الافتتاح 4:40 · الإغلاق 11:05 الليل"}. تحليل Claude يستخدم مفتاحك ويصرف من رصيده (قليل).${w.near?.length ? `<br>أقرب الأسهم للإشارة: ${w.near.map((r) => `<b>${esc(r.code)}</b> (ينقصه ${esc(r.why)})`).join(" · ")}` : ""}</div>`;
    const post = async (patch) => {
      try {
        await api.post("/api/uswatch", patch);
      } catch (e) {
        app.toast?.(e.message);
      }
      usWatchBox();
    };
    el.querySelector("#usOn").onclick = () => post({ on: !w.on });
    el.querySelector("#usEvery").onchange = (e) => post({ every: Number(e.target.value) });
    el.querySelector("#usSize").onchange = (e) => post({ size: Number(e.target.value) });
    el.querySelectorAll("[data-us]").forEach((cb) => (cb.onchange = () => post({ [cb.dataset.us]: cb.checked })));
    el.querySelectorAll("[data-usnow]").forEach(
      (b) =>
        (b.onclick = async () => {
          const k = b.dataset.usnow;
          b.disabled = true;
          b.textContent = "جاري…";
          try {
            const r = k === "run" ? await api.post("/api/uswatch/run") : k === "radar" ? await api.post("/api/uswatch/radar") : await api.post(`/api/uswatch/brief?kind=${k}`);
            app.toast?.(k === "run" ? (r.busy ? "فيه مسح شغال الحين." : r.sent ? `أُرسلت ${r.sent} إشارة دخول.` : `مسح ${r.scanned} سهم: لا توجد إشارة دخول جديدة.`) : k === "radar" ? (r.sent ? `أُرسل الرادار: ${r.sent} سهم يستحق المراقبة ✓` : "الرادار: ما فيه تحرك لافت قبل الافتتاح (أو السوق مو في وقت التداول المبكر).") : `أُرسل التقرير${r.ai ? " مع تحليل Claude" : ""} ✓`);
          } catch (e) {
            app.toast?.(e.message);
          }
          usWatchBox();
        }),
    );
  }

  // 🔔 the Saudi watch on the server: buy signals, their follow-up and the close summary to Telegram
  async function saWatchBox() {
    const el = box.querySelector("#saWatch");
    if (!el) return;
    let w;
    try {
      w = await api.get("/api/sawatch");
    } catch {
      el.innerHTML = '<span class="hint-text">مراقبة السعودية تحتاج إعادة تشغيل البرنامج.</span>';
      return;
    }
    const when = w.lastRun ? new Date(w.lastRun).toLocaleTimeString("ar-KW", { hour: "2-digit", minute: "2-digit" }) : "—";
    const chip = (k, label) => `<label class="kw-chip ${w[k] ? "on" : ""}"><input type="checkbox" data-sa="${k}" ${w[k] ? "checked" : ""}>${label}</label>`;
    el.innerHTML = `<div class="row-flex">
      <button class="btn ${w.on ? "primary" : ""}" id="saOn">${w.on ? "🔔 مراقبة السعودية شغالة" : "🔕 شغّل مراقبة السعودية"}</button>
      <label class="field">مسح كل<select id="saEvery">${[5, 10, 15, 30].map((m) => `<option value="${m}" ${m === w.every ? "selected" : ""}>${m} دقيقة</option>`).join("")}</select></label>
      ${chip("regime", "نبهني إذا تغير اتجاه السوق")}${chip("briefs", "ملخص الإغلاق")}${chip("ai", "تحليل Claude")}
      <button class="btn" data-sanow="run">افحص الآن وأرسل</button>
      <button class="btn" data-sanow="close">أرسل ملخص الإغلاق الآن</button>
    </div>
    <div class="hint-text">${w.telegram ? "📱 يرسل على تيليجرام" : '<span class="down">تيليجرام مو مربوط: اربطه من تبويب ماسح الكويت ← 📱 للجوال</span>'} · السوق الحين ${w.sessionOpen ? '<b class="up">مفتوح</b>' : "مغلق"} · آخر مسح ${when}${w.market ? ` · السوق العام ${w.market.up ? '<b class="up">فوق متوسط 50</b>' : '<b class="down">تحت متوسط 50</b>'}${w.market.up200 != null ? ` و${w.market.up200 ? '<b class="up">فوق</b>' : '<b class="down">تحت</b>'} متوسط 200` : ""}` : ""}${w.lastEntries?.length ? ` · الإشارات: ${w.lastEntries.join("، ")}` : ""}${w.trades?.length ? ` · صفقات تحت المتابعة: ${w.trades.map((t) => esc(t.code)).join("، ")}` : ""}${w.lastError ? ` · <span class="down">${esc(w.lastError)}</span>` : ""}<br>
    ⚠️ اختبرت عدة طرق شراء على السوق السعودي من 2022: كلها خسرت في 2025–2026 لأن السوق نازل، فإشارات الشراء التلقائية مطفأة. «نبهني إذا تغير اتجاه السوق» يرسل لك على تيليجرام لما يرجع السوق فوق متوسط 200 يوم (أو ينزل تحته).<br>إذا شغلت المراقبة: يمسح من الأحد للخميس 10:00–3:10 العصر، ويتابع كل إشارة (المقاومات والوقف المتحرك)، وملخص الإغلاق 3:20 العصر.${w.near?.length ? `<br>أقرب الأسهم للإشارة: ${w.near.map((r) => `<b>${esc(r.code)} ${esc(r.ar)}</b> (ينقصه ${esc(r.why)})`).join(" · ")}` : ""}</div>`;
    const post = async (patch) => {
      try {
        await api.post("/api/sawatch", { minValue: st.minValue, ...patch });
      } catch (e) {
        app.toast?.(e.message);
      }
      saWatchBox();
    };
    el.querySelector("#saOn").onclick = () => post({ on: !w.on });
    el.querySelector("#saEvery").onchange = (e) => post({ every: Number(e.target.value) });
    el.querySelectorAll("[data-sa]").forEach((cb) => (cb.onchange = () => post({ [cb.dataset.sa]: cb.checked })));
    el.querySelectorAll("[data-sanow]").forEach(
      (b) =>
        (b.onclick = async () => {
          const k = b.dataset.sanow;
          b.disabled = true;
          b.textContent = "جاري…";
          try {
            const r = await api.post(k === "run" ? "/api/sawatch/run" : "/api/sawatch/close");
            app.toast?.(k === "run" ? (r.busy ? "فيه مسح شغال الحين." : r.sent ? `أُرسلت ${r.sent} إشارة شراء.` : `مسح ${r.scanned} سهم: لا توجد إشارة شراء جديدة.`) : "أُرسل ملخص الإغلاق ✓");
          } catch (e) {
            app.toast?.(e.message);
          }
          saWatchBox();
        }),
    );
  }

  // 📊 the signal's record in the market's history (lib/kwbacktest.js), and a button to test again
  async function trackBox(poll = false) {
    const el = box.querySelector("#kwTrack");
    if (!el) return;
    let b;
    try {
      b = await api.get(`/api/kwbacktest?market=${market}`);
    } catch {
      el.hidden = true;
      return;
    }
    const L = b.live,
      sign = (v) => `${v > 0 ? "+" : ""}${num(v, 2)}%`;
    const row = (label, x) => (x?.n ? `<tr><td>${label}</td><td>${x.n}</td><td class="${x.avgRet >= 0 ? "up" : "down"}">${sign(x.avgRet)}</td><td>${x.profitable != null ? x.profitable + "%" : "—"}</td><td>${x.profitFactor ?? "—"}</td><td>${num(x.avgDays)}</td></tr>` : "");
    el.innerHTML = b.running
      ? `<span class="hint-text">📊 جاري اختبار الإشارة على تاريخ السوق… ${b.done} من ${b.of} سهم</span>`
      : L?.all?.n
        ? `<div class="row-flex"><b>📊 سجل إشارة الدخول تاريخيًا</b><span class="hint-text">${b.stocks} سهم منذ ${esc(b.from)} · بعد عمولة تقديرية 0.3%</span><button class="btn" id="kwBtRun">أعد الاختبار</button></div>
          <table class="t kw-t kw-bt"><thead><tr><th>الفترة</th><th>إشارات</th><th>متوسط الصفقة</th><th>رابحة</th><th>معامل الربح</th><th>أيام</th></tr></thead><tbody>
          ${row("كل الفترة", L.all)}${row("حتى 2024 (اختيرت عليها الشروط)", L.train)}${row("2025–2026 (للتأكد)", L.check)}
          ${Object.entries(L.byYear || {}).map(([y, x]) => row(`سنة ${y}`, x)).join("")}
          ${row("للمقارنة: الشروط القديمة + البيع عند الهدف الأول", b.grid?.["base|t1"] && { ...b.grid["base|t1"].train, n: b.grid["base|t1"].train.n + b.grid["base|t1"].check.n, avgRet: Math.round(((b.grid["base|t1"].train.avgRet * b.grid["base|t1"].train.n + b.grid["base|t1"].check.avgRet * b.grid["base|t1"].check.n) / (b.grid["base|t1"].train.n + b.grid["base|t1"].check.n)) * 100) / 100, profitable: null, profitFactor: null, avgDays: b.grid["base|t1"].train.avgDays })}
          </tbody></table>
          <div class="hint-text">الدخول بسعر افتتاح الجلسة التالية، والخروج بالوقف المتحرك. النتائج الماضية لا تضمن المستقبل.${kw ? " سنة 2026 كانت أضعف." : sa ? " قائمة الأسهم هي المدرجة اليوم، فالشركات اللي انشطبت مو فيها." : " القائمة الأمريكية هي أنشط الأسهم اليوم، فالنتائج قد تكون أفضل من الواقع (أسهم نجحت فبقيت نشطة)."}</div>`
        : `<div class="row-flex"><span class="hint-text">📊 ما انختبرت الإشارة على تاريخ ${M.title} بعد.</span><button class="btn" id="kwBtRun">اختبرها على آخر 5 سنوات</button></div>`;
    const run = el.querySelector("#kwBtRun");
    if (run)
      run.onclick = async () => {
        await api.post("/api/kwbacktest", { market, limit: 1500, size: 300 });
        trackBox(true);
      };
    if (b.running || poll) setTimeout(() => box.querySelector("#kwTrack") && (b.running || poll) && trackBox(b.running), 3000);
  }

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
      <button class="btn ${w.telegram || w.whatsapp ? "primary" : ""}" id="kwWPhone">${w.telegram ? "✓ 📱 تيليجرام" : w.whatsapp ? "✓ 📱 واتساب" : "📱 للجوال"}</button>
    </div>
    <div class="hint-text">${w.on ? `يمسح السوق كل ${w.every} دقيقة من الأحد للخميس 9:00–12:45${w.afterClose ? " ومرة بعد الإغلاق" : ""}، ويرسل تنبيه لكل إشارة دخول جديدة (مرة وحدة لكل سهم في اليوم).` : "شغّله ليمسح السوق خلال الجلسة ويرسل لك تنبيه بأي إشارة دخول جديدة، حتى لو المتصفح مقفل."} السوق الحين ${w.sessionOpen ? '<b class="up">مفتوح</b>' : "مغلق"} · آخر مسح ${when}${w.lastEntries?.length ? ` · الإشارات: ${w.lastEntries.join("، ")}` : ""}${w.lastError ? ` · <span class="down">${esc(w.lastError)}</span>` : ""}${w.telegram ? ` · 📱 تيليجرام مفعّل (@${esc(w.tgBot)})` : ""}${w.lastTelegram && !w.lastTelegram.ok ? ` · <span class="down">آخر رسالة تيليجرام ما وصلت: ${esc(w.lastTelegram.note)}</span>` : ""}${w.whatsapp ? ` · 📱 الواتساب مفعّل على ${esc(w.waPhone)}` : ""}${w.lastWhatsApp && !w.lastWhatsApp.ok ? ` · <span class="down">آخر رسالة واتساب ما وصلت: ${esc(w.lastWhatsApp.note)}</span>` : ""}${w.webhook ? " · 🔗 رابط إرسال مفعّل" : ""}</div>
    <div id="kwWPhoneBox" hidden class="kw-phone-box">
      <div class="kw-tg"><b>📱 تيليجرام</b>${w.telegram ? ` <span class="up">مربوط مع @${esc(w.tgBot)} ✓</span>` : ""}
      <ol class="hint-text"><li>في تيليجرام افتح <b>@BotFather</b> ← اكتب <code dir="ltr">/newbot</code> ← اختر اسم للبوت ثم اسم مستخدم ينتهي بـ <code dir="ltr">bot</code>.</li>
      <li>يرسل لك <b>رمز (token)</b> طويل، انسخه والصقه هنا واضغط «حفظ».</li>
      <li>افتح البوت الجديد في تيليجرام واضغط <b>Start</b>، ثم ارجع هنا واضغط «ربط».</li></ol>
      <div class="kw-phone"><label class="field">رمز البوت (token)<input id="kwTgToken" type="password" autocomplete="off" placeholder="${w.tgToken ? "محفوظ ••••" : "123456789:AA..."}" style="width:230px" dir="ltr"></label>
      <button class="btn" id="kwTgSave">حفظ</button><button class="btn primary" id="kwTgLink" ${w.tgToken ? "" : "disabled"}>ربط</button><button class="btn" id="kwTgTest" ${w.telegram ? "" : "disabled"}>رسالة تجريبية</button>${w.tgToken ? '<button class="btn" id="kwTgOff">إلغاء</button>' : ""}</div>
      <div class="hint-text">الرمز يبقى محفوظ على جهازك فقط ولا يظهر مرة ثانية، والرسائل تروح من جهازك لتيليجرام مباشرة.</div></div>
      <details><summary class="hint-text">واتساب عبر CallMeBot</summary>
      <div class="hint-text"><b>تفعيل الواتساب (مرة وحدة):</b> 1) افتح موقع <b>callmebot.com</b> ← WhatsApp، وخذ رقم البوت وأضفه في جهات الاتصال. 2) أرسل له من جوالك: <code dir="ltr">I allow callmebot to send me messages</code> 3) يرد عليك برسالة فيها <b>apikey</b>. 4) اكتب رقمك والمفتاح هنا واضغط حفظ، ثم «رسالة تجريبية».</div>
      <div class="kw-phone"><label class="field">رقم الواتساب مع رمز الدولة<input id="kwWaPhone" placeholder="+96550000000" style="width:150px" dir="ltr"></label>
      <label class="field">المفتاح (apikey)<input id="kwWaKey" type="password" autocomplete="off" placeholder="${w.whatsapp ? "محفوظ ••••" : "من رسالة البوت"}" style="width:130px" dir="ltr"></label>
      <button class="btn primary" id="kwWaSave">حفظ</button><button class="btn" id="kwWaTest" ${w.whatsapp ? "" : "disabled"}>رسالة تجريبية</button>${w.whatsapp ? '<button class="btn" id="kwWaOff">إيقاف الواتساب</button>' : ""}</div>
      <div class="hint-text">الرسائل تمر عبر خدمة CallMeBot المجانية (طرف ثالث). المفتاح يبقى محفوظ على جهازك فقط ولا يظهر مرة ثانية.</div>
      </details>
      <details><summary class="hint-text">متقدم: رابط Discord أو Slack</summary><div class="kw-phone"><label class="field">رابط الإرسال<input id="kwWHook" value="${esc(w.webhook || "")}" placeholder="https://api.telegram.org/bot…/sendMessage?chat_id=…" style="width:320px" dir="ltr"></label><button class="btn" id="kwWHookSave">حفظ</button></div></details>
    </div>`;
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
    el.querySelector("#kwWaSave").onclick = async () => {
      const phone = el.querySelector("#kwWaPhone").value.trim(),
        key = el.querySelector("#kwWaKey").value.trim();
      const patch = {};
      if (phone) patch.waPhone = phone;
      if (key) patch.waKey = key;
      if (!Object.keys(patch).length) return app.toast?.("اكتب الرقم والمفتاح أولًا.");
      try {
        await api.post("/api/kwwatch", patch);
        app.toast?.("حُفظ. اضغط «رسالة تجريبية» للتأكد.");
      } catch (e) {
        app.toast?.(e.message);
      }
      await watchBox();
      el.querySelector("#kwWPhoneBox").hidden = false;
    };
    el.querySelector("#kwWaOff") &&
      (el.querySelector("#kwWaOff").onclick = () => post({ waPhone: "", waKey: "-" }));
    const call = async (url, body, okMsg) => {
      try {
        await api.post(url, body);
        if (okMsg) app.toast?.(okMsg);
      } catch (e) {
        app.toast?.(e.message);
      }
      await watchBox();
      el.querySelector("#kwWPhoneBox").hidden = false;
    };
    el.querySelector("#kwTgSave").onclick = () => {
      const t = el.querySelector("#kwTgToken").value.trim();
      if (!t) return app.toast?.("الصق رمز البوت أولًا.");
      call("/api/kwwatch", { tgToken: t }, "حُفظ الرمز. افتح البوت في تيليجرام واضغط Start، ثم اضغط «ربط».");
    };
    el.querySelector("#kwTgLink").onclick = () => call("/api/kwwatch/telegram-link", {}, "تم الربط ✓ شوف تيليجرام، وصلتك رسالة.");
    el.querySelector("#kwTgTest").onclick = () => call("/api/kwwatch/telegram-test", {}, "أُرسلت رسالة تجريبية على تيليجرام ✓");
    el.querySelector("#kwTgOff") && (el.querySelector("#kwTgOff").onclick = () => call("/api/kwwatch", { tgToken: "-" }, "أُلغي ربط تيليجرام."));
    el.querySelector("#kwWaTest").onclick = async (e) => {
      e.target.disabled = true;
      e.target.textContent = "جاري الإرسال…";
      try {
        await api.post("/api/kwwatch/whatsapp-test");
        app.toast?.("أُرسلت رسالة تجريبية على الواتساب ✓");
      } catch (err) {
        app.toast?.(err.message);
      }
      await watchBox();
      el.querySelector("#kwWPhoneBox").hidden = false;
    };
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
