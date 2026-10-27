// قارئ السوق (Market Reader): the side panel. It loads the active chart's symbol on seven
// timeframes, reads them with lib/market-reader.js and shows the reading in Arabic, right to left.
// A click on a level draws it on the chart; "ارسم على الشارت" draws both levels and both zones.
// While the panel is open it refreshes every minute and when the symbol or interval changes.
import { api } from "./api.js";
import { AgentTools } from "./agent.js";
import { readMarket, READER_TFS, kuwaitSessionFraction } from "../lib/market-reader.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const num = (v) => (v == null ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: Math.abs(v) < 1 ? 6 : Math.abs(v) < 100 ? 3 : 2 }));
const cache = new Map(); // `${sym}|${tf}` -> { at, bars }
const FRESH_MS = 55_000;
let timer = null,
  busy = null,
  lastKey = "";

const mainTfOf = (tf) => (READER_TFS.some((f) => f.tf === tf) ? tf : "1D");

async function barsFor(sym, tf) {
  const k = `${sym}|${tf}`,
    c = cache.get(k);
  if (c && Date.now() - c.at < FRESH_MS) return c.bars;
  const r = await api.candles(sym, tf, 300);
  const bars = r?.candles || [];
  cache.set(k, { at: Date.now(), bars });
  return bars;
}

// The latest reading for a symbol, also used by AskCharts AI's market_reader tool.
export async function loadReading(sym, main = "1D") {
  const results = await Promise.allSettled(READER_TFS.map((f) => barsFor(sym, f.tf)));
  const byTf = {};
  READER_TFS.forEach((f, i) => {
    if (results[i].status === "fulfilled" && results[i].value.length) byTf[f.tf] = results[i].value;
  });
  // Kuwaiti stocks: today's daily volume is measured against the share of the session gone
  const last = byTf[main]?.at(-1);
  const sessionFraction = /\.KW$/.test(sym) && main === "1D" && last ? kuwaitSessionFraction(last.time) : 1;
  return readMarket(byTf, { main, symbol: sym, sessionFraction });
}

const trendCls = (k) => (k == null ? "mr-na" : k > 0 ? (k > 1 ? "mr-up2" : "mr-up") : k < 0 ? (k < -1 ? "mr-dn2" : "mr-dn") : "mr-flat");
const dot = (k) => `<i class="mr-dot ${trendCls(k)}"></i>`;

function stateCls(key) {
  if (["breakout", "uptrend", "accumulation", "oversold"].includes(key)) return "mr-up";
  if (["breakdown", "downtrend", "distribution", "overbought"].includes(key)) return "mr-dn";
  if (key === "squeeze") return "mr-blue";
  return "mr-flat";
}

function view(r, sym, main) {
  if (r.error) return `<div class="mr-empty">${esc(r.error)}</div>`;
  const s = r.support,
    res = r.resistance;
  const lvl = (label, l, kind) =>
    `<button class="mr-row mr-click ${kind === "s" ? "mr-up-soft" : "mr-dn-soft"}" data-draw="${kind}" data-price="${l?.price ?? ""}" ${l ? "" : "disabled"} title="اضغط لرسم الخط على الشارت">
      <span class="mr-k">${label}</span><b>${num(l?.price)}</b><span class="mr-str">${l ? `${esc(l.strength)} <small>(${l.touches})</small>` : "—"}</span><span class="mr-pct">${l ? num(l.distancePct) + "%" : ""}</span></button>`;
  const zone = (label, z, kind) => `<div class="mr-row ${kind === "s" ? "mr-up-soft" : "mr-dn-soft"}"><span class="mr-k">${label}</span><b class="mr-wide">${z ? `<bdi dir="ltr">${num(z.from)} – ${num(z.to)}</bdi>` : "—"}</b></div>`;
  const rsiCls = r.rsi == null ? "mr-flat" : r.rsi >= 70 ? "mr-dn" : r.rsi <= 30 ? "mr-up" : "mr-flat";
  const liqCls = r.liquidity.ar === "ضعيفة" ? "mr-dn" : r.liquidity.ar === "مرتفعة" ? "mr-up" : "mr-flat";
  return `
  <div class="mr-top">
    <div><div class="mr-sym">${esc(sym.replace(/^YAHOO:/, ""))}</div><div class="mr-price">${num(r.price)}</div></div>
    <div class="mr-badge ${trendCls(r.overall.key)}">${dot(r.overall.key)}${esc(r.overall.ar)}</div>
  </div>
  <div class="mr-agree">توافق الأطر: <b>${r.overall.agree} من ${r.overall.of}</b> <span class="mr-bar"><span style="width:${r.confidence}%"></span></span> <b>${r.confidence}%</b></div>
  <div class="mr-sec">المستويات <span class="mr-sub">الإطار ${esc(READER_TFS.find((f) => f.tf === main)?.ar || main)}</span></div>
  ${lvl("الدعم الأقرب", s, "s")}
  ${lvl("المقاومة الأقرب", res, "r")}
  ${zone("منطقة الطلب", r.demandZone, "s")}
  ${zone("منطقة العرض", r.supplyZone, "r")}
  <div class="mr-row"><span class="mr-k">موقع السعر</span><b class="mr-wide">${esc(r.position)}</b></div>
  <div class="mr-sec">الأطر الزمنية</div>
  <table class="mr-tf"><thead><tr><th>الإطار</th><th>الاتجاه</th><th>الدعم</th><th>المقاومة</th></tr></thead><tbody>
  ${r.frames
    .map(
      (f) => `<tr class="${f.tf === main ? "mr-main" : ""}"><td>${esc(f.ar)}</td><td class="${trendCls(f.trend?.key)}">${f.trend ? dot(f.trend.key) + esc(f.trend.ar) : "لا بيانات"}</td><td>${num(f.support)}</td><td>${num(f.resistance)}</td></tr>`,
    )
    .join("")}
  </tbody></table>
  <div class="mr-sec">الحالة</div>
  <div class="mr-grid">
    <div><span>الحالة</span><b class="${stateCls(r.state.key)}">${esc(r.state.ar)}</b></div>
    <div><span>السيولة</span><b class="${liqCls}">${r.liquidity.relVol == null ? "—" : r.liquidity.relVol + "x"}<small>${esc(r.liquidity.ar)}</small></b></div>
    <div><span>RSI</span><b class="${rsiCls}">${num(r.rsi)}</b></div>
    <div><span>ATR%</span><b class="${r.squeeze ? "mr-blue" : "mr-flat"}">${num(r.atrPct)}%<small>${r.squeeze ? "تقلب منخفض" : "تقلب عادي"}</small></b></div>
  </div>
  ${r.breakout ? `<div class="mr-break ${r.breakout.dir === "up" ? "mr-up-soft" : r.breakout.dir === "down" ? "mr-dn-soft" : "mr-near"}"><b>${r.breakout.dir === "up" ? "▲ اختراق" : r.breakout.dir === "down" ? "▼ كسر" : r.breakout.dir === "near" ? "◬ قرب اختراق" : "◬ قرب كسر"} ${num(r.breakout.level)}</b><span>${esc(r.breakout.ar)}</span></div>` : ""}
  ${r.flow ? `<div class="mr-sec">السيولة الداخلة والخارجة <span class="mr-sub">آخر 20 شمعة</span></div>
  <div class="mr-flowbar"><span class="mr-in" style="width:${r.flow.inflowPct}%">داخلة ${r.flow.inflowPct}%</span><span class="mr-out">خارجة ${r.flow.outflowPct}%</span></div>
  <div class="mr-row"><span class="mr-k">صافي السيولة</span><b class="mr-wide ${r.flow.net >= 0 ? "mr-up" : "mr-dn"}">${r.flow.net >= 0 ? "داخلة" : "خارجة"} · ${r.flow.improving ? "تتحسن ↑" : "تضعف ↓"} · CMF ${num(r.flow.cmf)}</b></div>` : ""}
  <div class="mr-sec">ميزان الإشارات الفنية <span class="mr-sub ${r.signal.key > 0 ? "mr-up" : r.signal.key < 0 ? "mr-dn" : "mr-flat"}">${esc(r.signal.ar)} · ${r.signal.positive}✓ ${r.signal.negative}✗</span></div>
  <ul class="mr-checks">${r.signal.checks.map((c) => `<li class="${c.v > 0 ? "mr-up" : c.v < 0 ? "mr-dn" : "mr-na"}"><i>${c.v > 0 ? "✓" : c.v < 0 ? "✗" : "•"}</i>${esc(c.ar)}</li>`).join("")}</ul>
  ${r.trades ? `<div class="mr-sec">صفقات الشراء والبيع <span class="mr-sub">تقدير من الشموع</span></div>
  ${r.trades.today ? `<div class="mr-k" style="font-size:12px">اليوم</div><div class="mr-flowbar"><span class="mr-in" style="width:${r.trades.today.buyPct}%">شراء ${r.trades.today.buyPct}%</span><span class="mr-out">بيع ${100 - r.trades.today.buyPct}%</span></div>` : ""}
  <div class="mr-k" style="font-size:12px">آخر ${r.trades.period.bars} جلسة</div><div class="mr-flowbar"><span class="mr-in" style="width:${r.trades.period.buyPct}%">شراء ${r.trades.period.buyPct}%</span><span class="mr-out">بيع ${100 - r.trades.period.buyPct}%</span></div>
  <div class="mr-row"><span class="mr-k">صفقات كبيرة</span><b class="mr-wide">${r.trades.big.filter((x) => x.kind === "buy").length} شراء · ${r.trades.big.filter((x) => x.kind === "sell").length} بيع <small style="color:var(--muted);font-weight:400">(حجم 2x فأكثر، آخر 60 شمعة)</small></b></div>` : ""}
  ${r.plan ? `<div class="mr-sec">خطة شراء <span class="mr-sub">${esc(r.plan.where)}</span></div>
  <div class="mr-row mr-up-soft"><span class="mr-k">منطقة الدخول</span><b class="mr-wide"><bdi dir="ltr">${num(r.plan.entryZone.from)} – ${num(r.plan.entryZone.to)}</bdi> <small style="color:var(--muted);font-weight:400">${esc(r.plan.entryWhy)}</small></b></div>
  <div class="mr-row mr-dn-soft"><span class="mr-k">وقف الخسارة</span><b>${num(r.plan.stop)}</b><span></span><span class="mr-pct mr-dn">-${num(r.plan.stopPct)}%</span></div>
  ${r.plan.targets.map((t) => `<div class="mr-row mr-up-soft"><span class="mr-k">الهدف ${t.n}</span><b>${num(t.price)}</b><span class="mr-str">1:${num(t.rr)} <small>${esc(t.from)}</small></span><span class="mr-pct mr-up">+${num(t.pct)}%</span></div>`).join("")}
  <div class="mr-note">${esc(r.plan.note)}</div>` : ""}
  <div class="mr-reading">${esc(r.reading)}</div>
  <div class="mr-note">${esc(r.note)} البيانات من مصدر الشارت وقد تتأخر.</div>`;
}

export function renderReader(side, app) {
  const p = app.active;
  const sym = p?.cfg.symbol,
    main = mainTfOf(p?.cfg.tf);
  side.innerHTML = `<div class="sp-fill" id="mrRoot" dir="rtl">
    <div class="sp-head"><span class="sp-name">قارئ السوق</span><span class="spacer" style="flex:1"></span>
      <button class="btn small${app.settings.readerOverlay ? " primary" : ""}" id="mrOverlay" title="اعرض القراءة فوق الشارت مثل جدول المؤشر">${app.settings.readerOverlay ? "✓ " : ""}على الشارت</button>
      <button class="btn small" id="mrDraw" title="ارسم الدعم والمقاومة ومناطق العرض والطلب على الشارت">ارسم على الشارت</button>
      <button class="sp-icon" id="mrRefresh" title="تحديث"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/></svg></button>
    </div>
    <div class="sp-scroll mr-body" id="mrBody"><div class="mr-empty">جاري قراءة السوق على 7 أطر زمنية…</div></div>
  </div>`;
  if (!sym) {
    side.querySelector("#mrBody").innerHTML = '<div class="mr-empty">افتح شارتًا أولًا.</div>';
    return;
  }
  let reading = null;
  const body = side.querySelector("#mrBody");
  const load = async (force = false) => {
    if (force) for (const f of READER_TFS) cache.delete(`${sym}|${f.tf}`);
    const key = `${sym}|${main}`;
    const job = (busy = loadReading(sym, main));
    try {
      const r = await job;
      if (busy !== job || !side.querySelector("#mrRoot")) return;
      reading = r;
      lastKey = key;
      body.innerHTML = view(r, sym, main) + `<div class="mr-time">آخر تحديث ${new Date().toLocaleTimeString("ar-KW", { hour: "2-digit", minute: "2-digit" })}</div>`;
    } catch (e) {
      if (busy === job) body.innerHTML = `<div class="mr-empty">تعذّرت القراءة: ${esc(e.message || e)}</div>`;
    }
  };
  let own = null;
  const tools = () => {
    if (app.copilot) return (app.copilot.tools ||= new AgentTools(app));
    return (own ||= new AgentTools(app));
  };
  const draw = async (items) => {
    for (const input of items) {
      const out = await tools().run({ name: "drawing_add", input });
      if (out.error) return app.toast?.(out.error);
    }
    app.toast?.(items.length > 1 ? "رُسمت المستويات والمناطق على الشارت." : "رُسم الخط على الشارت.");
  };
  body.onclick = (e) => {
    const b = e.target.closest("[data-draw]");
    if (!b || !b.dataset.price) return;
    const sup = b.dataset.draw === "s";
    draw([{ type: "hline", points: [{ bars_ago: 0, price: Number(b.dataset.price) }], color: sup ? "#089981" : "#f23645", text: `${sup ? "دعم" : "مقاومة"} ${b.dataset.price}` }]);
  };
  side.querySelector("#mrDraw").onclick = () => {
    if (!reading || reading.error) return;
    const items = [];
    const line = (l, sup) => l && items.push({ type: "hline", points: [{ bars_ago: 0, price: l.price }], color: sup ? "#089981" : "#f23645", text: `${sup ? "دعم" : "مقاومة"} ${l.price}` });
    const box = (z, sup) => z && items.push({ type: "rect", points: [{ bars_ago: 40, price: z.to }, { bars_ago: -8, price: z.from }], color: sup ? "#089981" : "#f23645", text: sup ? "منطقة طلب" : "منطقة عرض" });
    line(reading.support, true);
    line(reading.resistance, false);
    box(reading.demandZone, true);
    box(reading.supplyZone, false);
    if (items.length) draw(items);
  };
  side.querySelector("#mrRefresh").onclick = () => load(true);
  side.querySelector("#mrOverlay").onclick = () => app.readerOverlay?.set(!app.settings.readerOverlay);
  load();
  clearInterval(timer);
  timer = setInterval(() => {
    if (!document.querySelector("#mrRoot")) return clearInterval(timer);
    load();
  }, 60_000);
}

// Called when the active chart changes: re-read only if the symbol or main interval moved.
export function readerChanged(app) {
  const p = app.active;
  return `${p?.cfg.symbol}|${mainTfOf(p?.cfg.tf)}` !== lastKey;
}
