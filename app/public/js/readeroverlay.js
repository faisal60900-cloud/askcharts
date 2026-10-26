// قارئ السوق on the chart itself: a compact Arabic table over the top right of the active chart,
// a state card under it, and the demand and supply zones as shaded bands on the price scale.
// On by default; the × on the table or the button in the Market Reader panel turns it off
// (app.settings.readerOverlay). It follows the active chart, re-reads when the symbol or interval
// changes and every minute, and keeps the bands on their prices while you scroll or zoom.
import { loadReading } from "./marketreader.js";
import { READER_TFS } from "../lib/market-reader.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const num = (v) => (v == null ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: Math.abs(v) < 1 ? 6 : Math.abs(v) < 100 ? 3 : 2 }));
const cls = (k) => (k == null ? "ov-na" : k > 0 ? "ov-up" : k < 0 ? "ov-dn" : "ov-flat");
const stateCls = (key) =>
  ["breakout", "uptrend", "accumulation", "oversold"].includes(key) ? "ov-up" : ["breakdown", "downtrend", "distribution", "overbought"].includes(key) ? "ov-dn" : key === "squeeze" ? "ov-blue" : "ov-flat";

// traded value in the symbol's own money: Kuwaiti prices are in fils
function money(v, sym, sign = true) {
  if (v == null || !Number.isFinite(v)) return "—";
  const kw = /\.KW$/.test(sym),
    sr = /\.SR$/.test(sym);
  const x = kw ? v / 1000 : v;
  const a = Math.abs(x);
  const t = a >= 1e9 ? (x / 1e9).toFixed(2) + "B" : a >= 1e6 ? (x / 1e6).toFixed(2) + "M" : a >= 1e3 ? (x / 1e3).toFixed(1) + "K" : x.toFixed(0);
  return `${sign && x > 0 ? "+" : ""}${t} ${kw ? "د.ك" : sr ? "ر.س" : "$"}`;
}
const tone = (k) => (k > 0 ? "ov-f-up" : k < 0 ? "ov-f-dn" : "ov-f-flat");

export function initReaderOverlay(app) {
  if (app.settings.readerOverlay === undefined) app.settings.readerOverlay = true;
  let pane = null,
    key = "",
    reading = null,
    loadedAt = 0,
    small = !!app.settings.readerOverlaySmall,
    lines = app.settings.readerPlanLines !== false,
    els = null,
    raf = 0,
    job = null;

  const remove = () => {
    els?.table.remove();
    els?.card.remove();
    els?.demand.remove();
    els?.supply.remove();
    els?.tag.remove();
    els?.marks.remove();
    els = null;
  };
  const mount = (p) => {
    remove();
    const mk = (c) => Object.assign(document.createElement("div"), { className: c });
    els = { table: mk("ov-table"), card: mk("ov-card"), demand: mk("ov-zone ov-demand"), supply: mk("ov-zone ov-supply"), tag: mk("ov-tag"), marks: mk("ov-marks") };
    els.table.dir = els.card.dir = "rtl";
    els.demand.innerHTML = "<span>DEMAND · منطقة طلب</span>";
    els.supply.innerHTML = "<span>SUPPLY · منطقة عرض</span>";
    els.tag.dir = "rtl";
    p.el.append(els.demand, els.supply, els.marks, els.tag, els.table, els.card);
    els.table.onclick = (e) => {
      const b = e.target.closest("[data-ov]");
      if (!b) return;
      if (b.dataset.ov === "close") return set(false);
      if (b.dataset.ov === "lines") {
        lines = !lines;
        app.settings.readerPlanLines = lines;
        app.persist();
        paint();
      }
      if (b.dataset.ov === "small") {
        small = !small;
        app.settings.readerOverlaySmall = small;
        app.persist();
        paint();
      }
    };
    // the cards sit over the chart but let the chart keep its own mouse everywhere else
    els.card.onclick = (e) => {
      if (e.target.closest('[data-ov="close"]')) set(false);
      if (e.target.closest('[data-ov="lines"]')) {
        lines = !lines;
        app.settings.readerPlanLines = lines;
        app.persist();
        paint();
      }
    };
    for (const el of [els.table, els.card]) el.addEventListener("mousedown", (e) => e.stopPropagation());
  };

  function paint() {
    if (!els) return;
    buildMarks();
    const r = reading;
    if (!r) {
      els.table.innerHTML = `<div class="ov-head"><b>قارئ السوق</b><span class="ov-btns"><button data-ov="close" title="إخفاء من الشارت">×</button></span></div><div class="ov-wait">جاري القراءة…</div>`;
      els.card.hidden = true;
      return;
    }
    if (r.error) {
      els.table.innerHTML = `<div class="ov-head"><b>قارئ السوق</b><span class="ov-btns"><button data-ov="close">×</button></span></div><div class="ov-wait">${esc(r.error)}</div>`;
      els.card.hidden = true;
      return;
    }
    const head = `<div class="ov-head"><b>قارئ السوق</b><span class="ov-sym">${esc(r.symbol.replace(/^[A-Z_]+:/, ""))}</span><span class="ov-px">${num(r.price)}</span>
      <span class="ov-btns"><button data-ov="small" title="${small ? "توسيع" : "تصغير"}">${small ? "▾" : "▴"}</button><button data-ov="close" title="إخفاء من الشارت">×</button></span></div>`;
    const trendRow = `<div class="ov-r"><span>الاتجاه العام</span><b class="ov-pill ${cls(r.overall.key)}">● ${esc(r.overall.ar)}</b><em>${r.overall.agree}/${r.overall.of}</em></div>`;
    if (small) {
      els.table.innerHTML = head + trendRow;
      els.card.hidden = true;
      return;
    }
    const lvl = (label, l, up) =>
      `<div class="ov-r ${up ? "ov-bg-up" : "ov-bg-dn"}"><span>${label}</span><b>${num(l?.price)}</b><em>${l ? esc(l.strength) : ""}</em><em class="ov-pct">${l ? num(l.distancePct) + "%" : ""}</em></div>`;
    const zone = (label, z, up) => `<div class="ov-r ${up ? "ov-bg-up" : "ov-bg-dn"}"><span>${label}</span><b class="ov-span">${z ? `<bdi dir="ltr">${num(z.from)} – ${num(z.to)}</bdi>` : "—"}</b></div>`;
    const main = r.main;
    els.table.innerHTML = `${head}${trendRow}
      ${lvl("الدعم الأقرب", r.support, true)}
      ${lvl("المقاومة الأقرب", r.resistance, false)}
      ${zone("منطقة الطلب", r.demandZone, true)}
      ${zone("منطقة العرض", r.supplyZone, false)}
      <div class="ov-r"><span>حالة السعر</span><b class="ov-span">${esc(r.position)}</b></div>
      <table><thead><tr><th>الإطار</th><th>الاتجاه</th><th>الدعم</th><th>المقاومة</th></tr></thead><tbody>
      ${r.frames
        .map((f) => `<tr class="${f.tf === main ? "ov-main" : ""}"><td>${esc(f.ar)}</td><td class="${cls(f.trend?.key)}">${f.trend ? "● " + esc(f.trend.ar) : "—"}</td><td>${num(f.support)}</td><td>${num(f.resistance)}</td></tr>`)
        .join("")}
      </tbody></table>`;
    const rsiK = r.rsi == null ? 0 : r.rsi >= 70 ? -1 : r.rsi <= 30 ? 1 : r.rsi >= 50 ? 1 : -1;
    const liqK = r.liquidity.ar === "ضعيفة" ? -1 : r.liquidity.ar === "مرتفعة" ? 1 : 0;
    const stK = stateCls(r.state.key) === "ov-up" ? 1 : stateCls(r.state.key) === "ov-dn" ? -1 : 0;
    const b = r.breakout;
    const bK = !b ? 0 : b.dir === "up" ? 1 : b.dir === "down" ? -1 : b.dir === "near" ? 0.5 : -0.5;
    const f = r.flow;
    const sg = r.signal;
    const cell = (label, value, k, extra = "") => `<tr><th>${label}</th><td class="${typeof k === "string" ? k : tone(k)}"${extra}>${value}</td></tr>`;
    const tip = esc(sg.checks.map((c) => `${c.v > 0 ? "✓" : c.v < 0 ? "✗" : "•"} ${c.ar}`).join("\n"));
    const pl = r.plan,
      tr = r.trades;
    els.card.hidden = false;
    els.card.innerHTML = `<table>
      <thead><tr><th>البند</th><th>القراءة</th></tr></thead><tbody>
      ${cell("الحالة", esc(r.state.ar), stK === 0 && r.state.key === "squeeze" ? "ov-f-blue" : stK)}
      ${cell("الاختراق", b ? `${b.dir === "up" ? "▲ اختراق" : b.dir === "down" ? "▼ كسر" : b.dir === "near" ? "◬ قرب اختراق" : "◬ قرب كسر"} <bdi>${num(b.level)}</bdi><small>${b.confirmed ? "مؤكد بسيولة" : b.dir.startsWith("near") ? "" : "سيولة ضعيفة"}</small>` : "لا يوجد", bK > 0 ? 1 : bK < 0 ? -1 : b ? "ov-f-gold" : 0)}
      ${cell("السيولة", r.liquidity.relVol == null ? "—" : `${r.liquidity.relVol}x <small>${esc(r.liquidity.ar)}</small>`, liqK)}
      ${f ? cell("السيولة الداخلة", `${f.inflowPct}% <small>خارجة ${f.outflowPct}%</small><span class="ov-flow"><i style="width:${f.inflowPct}%"></i></span>`, f.inflowPct >= 55 ? 1 : f.inflowPct <= 45 ? -1 : 0) : ""}
      ${f ? cell("صافي السيولة", `<bdi dir="ltr">${money(f.net, r.symbol)}</bdi><small>${f.improving ? "يتحسن ↑" : "يضعف ↓"}</small>`, f.net > 0 ? 1 : f.net < 0 ? -1 : 0) : ""}
      ${cell("RSI", num(r.rsi), r.rsi >= 70 || r.rsi <= 30 ? "ov-f-gold" : rsiK)}
      ${cell("ATR%", `${num(r.atrPct)}%<small>${r.squeeze ? "تقلب منخفض" : "تقلب عادي"}</small>`, "ov-f-blue")}
      ${cell("قوة الحالة", `${r.confidence}%`, "ov-f-gold")}
      ${cell("ميزان الإشارات", `${esc(sg.ar)}<small>${sg.positive} ✓ · ${sg.negative} ✗ من ${sg.of}</small>`, sg.key, ` title="${tip}"`)}
      ${tr ? `<tr class="ov-plan-h"><th colspan="2">صفقات الشراء والبيع <small>(تقدير)</small></th></tr>
      ${tr.today ? cell("اليوم", `شراء ${tr.today.buyPct}% · بيع ${100 - tr.today.buyPct}%<small><bdi dir="ltr">${money(tr.today.buyValue, r.symbol, false)}</bdi> شراء · <bdi dir="ltr">${money(tr.today.sellValue, r.symbol, false)}</bdi> بيع</small><span class="ov-flow"><i style="width:${tr.today.buyPct}%"></i></span>`, tr.today.buyPct >= 55 ? 1 : tr.today.buyPct <= 45 ? -1 : 0) : ""}
      ${cell(`آخر ${tr.period.bars} جلسة`, `شراء ${tr.period.buyPct}% · بيع ${100 - tr.period.buyPct}%<span class="ov-flow"><i style="width:${tr.period.buyPct}%"></i></span>`, tr.period.buyPct >= 55 ? 1 : tr.period.buyPct <= 45 ? -1 : 0)}
      ${cell("صفقات كبيرة", tr.big.length ? `${tr.big.filter((x) => x.kind === "buy").length} شراء · ${tr.big.filter((x) => x.kind === "sell").length} بيع<small>آخر 60 شمعة، حجم 2x فأكثر</small>` : "لا يوجد", tr.big.length ? (tr.big.at(-1).kind === "buy" ? 1 : -1) : 0)}` : ""}
      ${pl ? `<tr class="ov-plan-h"><th colspan="2">خطة شراء <button class="ov-mini" data-ov="lines" title="إظهار أو إخفاء الخطوط على الشارت">${lines ? "إخفاء الخطوط" : "ارسم الخطوط"}</button></th></tr>
      ${cell("منطقة الدخول", `<bdi dir="ltr">${num(pl.entryZone.from)} – ${num(pl.entryZone.to)}</bdi><small>${esc(pl.entryWhy)}</small>`, "ov-f-blue")}
      ${cell("وقف الخسارة", `<bdi>${num(pl.stop)}</bdi><small>-${num(pl.stopPct)}% من الدخول</small>`, -1)}
      ${pl.targets.map((t) => cell(`الهدف ${["الأول", "الثاني", "الثالث"][t.n - 1]}`, `<bdi>${num(t.price)}</bdi><small>+${num(t.pct)}% · عائد:مخاطرة 1:${num(t.rr)}</small>`, t.rr >= 2 ? 1 : t.rr < 1 ? "ov-f-gold" : 1)).join("")}
      ${cell("موقع السعر", esc(pl.where), "ov-f-flat")}` : ""}
      <tr><th>التفسير</th><td class="ov-f-blue ov-read">${esc(r.reading)}</td></tr>
      </tbody></table>
      <div class="ov-foot">مستويات محسوبة بقواعد فنية ثابتة وتقدير للصفقات من الشموع، وليست توصية. القرار وإدارة المخاطرة عليك.</div>`;
  }

  // the plan's lines and the big-volume candles, built once per reading and moved every frame
  let marks = [];
  function buildMarks() {
    if (!els) return;
    els.marks.innerHTML = "";
    marks = [];
    const r = reading;
    if (!r || r.error) return;
    const add = (cls, html, at) => {
      const el = document.createElement("div");
      el.className = cls;
      el.innerHTML = html;
      els.marks.append(el);
      marks.push({ el, ...at });
    };
    const pl = r.plan;
    if (pl && lines) {
      add("ov-pl ov-pl-entry", `<span>دخول <bdi dir="ltr">${num(pl.entryZone.from)} – ${num(pl.entryZone.to)}</bdi></span>`, { from: pl.entryZone.from, to: pl.entryZone.to });
      add("ov-pl ov-pl-stop", `<span>وقف خسارة ${num(pl.stop)} <small>-${num(pl.stopPct)}%</small></span>`, { price: pl.stop });
      for (const t of pl.targets) add("ov-pl ov-pl-tp", `<span>هدف ${t.n}: ${num(t.price)} <small>+${num(t.pct)}% · 1:${num(t.rr)}</small></span>`, { price: t.price });
    }
    for (const b of r.trades?.big || [])
      add(`ov-bt ${b.kind === "buy" ? "ov-bt-buy" : "ov-bt-sell"}`, b.kind === "buy" ? `▲<small>شراء ${b.rel}x</small>` : `<small>بيع ${b.rel}x</small>▼`, { time: b.time, price: b.price, kind: b.kind });
  }

  // keep the cards clear of the price scale and the bands on their prices
  function place() {
    raf = requestAnimationFrame(place);
    if (!els || !pane?.main) return;
    let scaleW = 0,
      plotW = 0;
    try {
      scaleW = pane.chart.priceScale(pane.scaleId).width();
      plotW = pane.chart.timeScale().width();
    } catch {
      return;
    }
    const right = (pane.scaleId === "right" ? scaleW : 0) + 8;
    els.table.style.right = els.card.style.right = `${right}px`;
    let paneH = 0;
    try {
      paneH = pane.chart.panes()[0].getHeight();
    } catch {}
    const below = els.table.offsetTop + els.table.offsetHeight + 6;
    const cardH = els.card.offsetHeight,
      tableW = els.table.offsetWidth;
    // under the table when it fits, beside it when the chart is short but wide enough, and
    // otherwise under the table with its own scroll
    els.card.style.maxHeight = "";
    if (!paneH || below + cardH <= paneH) {
      els.card.style.top = `${Math.max(below, paneH - cardH - 6)}px`;
    } else if (plotW > tableW + els.card.offsetWidth + 40) {
      els.card.style.top = `${els.table.offsetTop}px`;
      els.card.style.right = `${right + tableW + 8}px`;
      els.card.style.maxHeight = `${Math.max(120, paneH - els.table.offsetTop - 6)}px`;
    } else {
      els.card.style.top = `${below}px`;
      els.card.style.maxHeight = `${Math.max(120, paneH - below - 6)}px`;
    }
    const b = reading?.breakout;
    const ty = b ? pane.main.priceToCoordinate(b.level) : null;
    if (!b || ty == null || ty < 0 || (paneH && ty > paneH)) els.tag.hidden = true;
    else {
      els.tag.hidden = false;
      els.tag.className = `ov-tag ${b.dir === "up" ? "ov-tag-up" : b.dir === "down" ? "ov-tag-dn" : "ov-tag-near"}`;
      const txt = `${b.dir === "up" ? "▲ اختراق" : b.dir === "down" ? "▼ كسر" : b.dir === "near" ? "قرب اختراق" : "قرب كسر"} ${num(b.level)}${b.confirmed ? " ✓" : ""}`;
      if (els.tag.textContent !== txt) els.tag.textContent = txt;
      Object.assign(els.tag.style, { top: `${ty - 11}px`, left: `${pane.plotLeft + plotW * 0.3}px` });
    }
    const band = (el, z) => {
      if (!z || !reading || reading.error) return (el.hidden = true);
      const y1 = pane.main.priceToCoordinate(z.to),
        y2 = pane.main.priceToCoordinate(z.from);
      if (y1 == null || y2 == null) return (el.hidden = true);
      const top = Math.max(0, Math.min(y1, y2)),
        bot = Math.min(paneH || Infinity, Math.max(y1, y2));
      if (bot - top < 2) return (el.hidden = true);
      el.hidden = false;
      const left = pane.plotLeft + plotW * 0.45;
      Object.assign(el.style, { top: `${top}px`, height: `${bot - top}px`, left: `${left}px`, width: `${Math.max(0, pane.plotLeft + plotW - left)}px` });
    };
    band(els.demand, reading?.demandZone);
    band(els.supply, reading?.supplyZone);
    const x0 = pane.plotLeft + plotW * 0.55,
      w = Math.max(0, pane.plotLeft + plotW - x0);
    for (const m of marks) {
      if (m.time != null) {
        const x = pane.timeToX(m.time),
          y = pane.main.priceToCoordinate(m.price);
        if (x == null || y == null || x < pane.plotLeft || x > pane.plotLeft + plotW || y < 0 || (paneH && y > paneH)) {
          m.el.hidden = true;
          continue;
        }
        m.el.hidden = false;
        m.el.style.left = `${x}px`;
        m.el.style.top = `${m.kind === "buy" ? y + 4 : y - 4}px`;
        continue;
      }
      if (m.from != null) {
        const y1 = pane.main.priceToCoordinate(m.to),
          y2 = pane.main.priceToCoordinate(m.from);
        const top = y1 == null || y2 == null ? 0 : Math.max(0, Math.min(y1, y2)),
          bot = y1 == null || y2 == null ? 0 : Math.min(paneH || Infinity, Math.max(y1, y2));
        if (bot - top < 2) {
          m.el.hidden = true;
          continue;
        }
        m.el.hidden = false;
        Object.assign(m.el.style, { left: `${x0}px`, width: `${w}px`, top: `${top}px`, height: `${bot - top}px` });
        continue;
      }
      const y = pane.main.priceToCoordinate(m.price);
      if (y == null || y < 0 || (paneH && y > paneH)) {
        m.el.hidden = true;
        continue;
      }
      m.el.hidden = false;
      Object.assign(m.el.style, { left: `${x0}px`, width: `${w}px`, top: `${y}px` });
    }
  }

  async function refresh(force = false) {
    const p = app.active;
    if (!app.settings.readerOverlay || !p) return;
    const sym = p.cfg.symbol,
      main = READER_TFS.some((f) => f.tf === p.cfg.tf) ? p.cfg.tf : "1D";
    const k = `${sym}|${main}`;
    if (p !== pane) {
      pane = p;
      mount(p);
      paint();
    }
    if (k !== key) {
      key = k;
      reading = null;
      paint();
      force = true;
    }
    if (!force && Date.now() - loadedAt < 60_000) return;
    const mine = (job = loadReading(sym, main).catch((e) => ({ error: `تعذّرت القراءة: ${e.message || e}`, symbol: sym })));
    const r = await mine;
    if (mine !== job || key !== k) return;
    reading = r;
    loadedAt = Date.now();
    paint();
  }

  function set(on) {
    app.settings.readerOverlay = on;
    app.persist();
    if (on) {
      key = "";
      pane = null;
      refresh(true);
      cancelAnimationFrame(raf);
      place();
    } else {
      cancelAnimationFrame(raf);
      remove();
      pane = null;
    }
    app.onReaderOverlay?.(on);
  }

  setInterval(() => app.settings.readerOverlay && refresh(), 2000);
  if (app.settings.readerOverlay) {
    setTimeout(() => refresh(true), 800);
    place();
  }
  return { set, isOn: () => !!app.settings.readerOverlay };
}
