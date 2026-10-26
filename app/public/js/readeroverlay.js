// قارئ السوق on the chart itself: a compact Arabic table over the top right of the active chart,
// a state card under it, and the demand and supply zones as shaded bands on the price scale.
// On by default; the × on the table or the button in the Market Reader panel turns it off
// (app.settings.readerOverlay). It follows the active chart, re-reads when the symbol or interval
// changes and every minute, and keeps the bands on their prices while you scroll or zoom.
import { loadReading } from "./marketreader.js";
import { READER_TFS } from "../lib/market-reader.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const num = (v) => (v == null ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 }));
const cls = (k) => (k == null ? "ov-na" : k > 0 ? "ov-up" : k < 0 ? "ov-dn" : "ov-flat");
const stateCls = (key) =>
  ["breakout", "uptrend", "accumulation", "oversold"].includes(key) ? "ov-up" : ["breakdown", "downtrend", "distribution", "overbought"].includes(key) ? "ov-dn" : key === "squeeze" ? "ov-blue" : "ov-flat";

export function initReaderOverlay(app) {
  if (app.settings.readerOverlay === undefined) app.settings.readerOverlay = true;
  let pane = null,
    key = "",
    reading = null,
    loadedAt = 0,
    small = !!app.settings.readerOverlaySmall,
    els = null,
    raf = 0,
    job = null;

  const remove = () => {
    els?.table.remove();
    els?.card.remove();
    els?.demand.remove();
    els?.supply.remove();
    els = null;
  };
  const mount = (p) => {
    remove();
    const mk = (c) => Object.assign(document.createElement("div"), { className: c });
    els = { table: mk("ov-table"), card: mk("ov-card"), demand: mk("ov-zone ov-demand"), supply: mk("ov-zone ov-supply") };
    els.table.dir = els.card.dir = "rtl";
    els.demand.innerHTML = "<span>DEMAND · منطقة طلب</span>";
    els.supply.innerHTML = "<span>SUPPLY · منطقة عرض</span>";
    p.el.append(els.demand, els.supply, els.table, els.card);
    els.table.onclick = (e) => {
      const b = e.target.closest("[data-ov]");
      if (!b) return;
      if (b.dataset.ov === "close") return set(false);
      if (b.dataset.ov === "small") {
        small = !small;
        app.settings.readerOverlaySmall = small;
        app.persist();
        paint();
      }
    };
    // the cards sit over the chart but let the chart keep its own mouse everywhere else
    for (const el of [els.table, els.card]) el.addEventListener("mousedown", (e) => e.stopPropagation());
  };

  function paint() {
    if (!els) return;
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
    const rsiC = r.rsi == null ? "ov-flat" : r.rsi >= 70 ? "ov-dn" : r.rsi <= 30 ? "ov-up" : "ov-flat";
    const liqC = r.liquidity.ar === "ضعيفة" ? "ov-dn" : r.liquidity.ar === "مرتفعة" ? "ov-up" : "ov-flat";
    els.card.hidden = false;
    els.card.innerHTML = `
      <div class="ov-c"><span>الحالة</span><b class="${stateCls(r.state.key)}">${esc(r.state.ar)}</b></div>
      <div class="ov-c"><span>السيولة</span><b class="${liqC}">${r.liquidity.relVol == null ? "—" : r.liquidity.relVol + "x"} <small>${esc(r.liquidity.ar)}</small></b></div>
      <div class="ov-c"><span>RSI</span><b class="${rsiC}">${num(r.rsi)}</b></div>
      <div class="ov-c"><span>ATR%</span><b class="${r.squeeze ? "ov-blue" : "ov-flat"}">${num(r.atrPct)}%</b></div>
      <div class="ov-c"><span>قوة الحالة</span><b class="ov-gold">${r.confidence}%</b></div>
      <div class="ov-read">${esc(r.reading)}</div>`;
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
    els.card.style.top = `${els.table.offsetTop + els.table.offsetHeight + 6}px`;
    const band = (el, z) => {
      if (!z || !reading || small) return (el.hidden = true);
      const y1 = pane.main.priceToCoordinate(z.to),
        y2 = pane.main.priceToCoordinate(z.from);
      if (y1 == null || y2 == null) return (el.hidden = true);
      el.hidden = false;
      const left = pane.plotLeft + plotW * 0.45;
      Object.assign(el.style, { top: `${Math.min(y1, y2)}px`, height: `${Math.max(3, Math.abs(y2 - y1))}px`, left: `${left}px`, width: `${Math.max(0, pane.plotLeft + plotW - left)}px` });
    };
    band(els.demand, reading?.demandZone);
    band(els.supply, reading?.supplyZone);
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
