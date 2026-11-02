// قطاعات السوق on the chart: a compact Arabic table over the top left of the active chart, like the
// TradingView sector tables: the market's state, the strongest sector, where the money is moving,
// and each sector's flow, buying share, activity and move. Kuwait for a Kuwaiti chart, the US
// otherwise (or the one picked with 🇰🇼/🇺🇸). On by default; × hides it, and the قطاعات tab shows
// it again (app.settings.sectorOverlay). Refreshed every 3 minutes.
import { api } from "./api.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const n1 = (v) => (v == null || !Number.isFinite(v) ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 1 }));
const sign = (v) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${n1(v)}%`);
const flowCls = (k) => (k === "in" || k === "up" ? "sov-up" : k === "out" ? "sov-dn" : k === "down" ? "sov-purple" : "sov-flat");
const heatCls = (k) => (k === "hot" ? "sov-hot" : k === "active" ? "sov-up" : k === "cold" ? "sov-cold" : "sov-flat");

export function initSectorOverlay(app) {
  if (app.settings.sectorOverlay === undefined) app.settings.sectorOverlay = true;
  let el = null,
    pane = null,
    data = {},
    loadedAt = {},
    pick = app.settings.sectorOverlayMarket || "",
    small = !!app.settings.sectorOverlaySmall;

  const marketOf = () => pick || (/(\.KW$|^KSE:|^YAHOO:.*\.KW$)/i.test(app.active?.cfg?.symbol || "") ? "kw" : "us");

  function mount(p) {
    el?.remove();
    el = Object.assign(document.createElement("div"), { className: "sov" });
    el.dir = "rtl";
    p.el.append(el);
    el.addEventListener("mousedown", (e) => e.stopPropagation());
    el.onclick = (e) => {
      const b = e.target.closest("[data-sov]");
      if (!b) return;
      const a = b.dataset.sov;
      if (a === "close") return set(false);
      if (a === "small") {
        small = !small;
        app.settings.sectorOverlaySmall = small;
      }
      if (a === "kw" || a === "us") {
        pick = a;
        app.settings.sectorOverlayMarket = a;
        load();
      }
      app.persist();
      paint();
    };
  }

  function paint() {
    if (!el) return;
    const m = marketOf(),
      t = data[m];
    const head = `<div class="sov-head"><b>${m === "kw" ? "🇰🇼 قطاعات الكويت" : "🇺🇸 قطاعات أمريكا"}</b>
      <span class="sov-btns"><button data-sov="kw" class="${m === "kw" ? "on" : ""}" title="الكويت">🇰🇼</button><button data-sov="us" class="${m === "us" ? "on" : ""}" title="أمريكا">🇺🇸</button><button data-sov="small" title="${small ? "توسيع" : "تصغير"}">${small ? "▾" : "▴"}</button><button data-sov="close" title="إخفاء من الشارت">×</button></span></div>`;
    if (!t) return void (el.innerHTML = `${head}<div class="sov-wait">جاري القراءة…</div>`);
    if (t.error) return void (el.innerHTML = `${head}<div class="sov-wait">${esc(t.error)}</div>`);
    const stateCls = t.buyPct >= 55 ? "sov-up" : t.buyPct <= 45 ? "sov-dn" : "sov-flat";
    const sum = `<div class="sov-sum"><span class="${stateCls}">${esc(t.state)}</span><span>الشراء <b>${Math.round(t.buyPct)}%</b></span><span>السيولة <b>${n1(t.rel)}x</b></span></div>
      ${t.hot ? `<div class="sov-line sov-hot">🔥 الأقوى: <b>${esc(t.hot.ar)}</b></div>` : ""}
      ${t.rotation ? `<div class="sov-line sov-purple">🔄 الانتقال: <b>${esc(t.rotation.from.ar)}</b> ← <b>${esc(t.rotation.to.ar)}</b></div>` : ""}`;
    if (small) return void (el.innerHTML = head + sum);
    el.innerHTML = `${head}${sum}<table><thead><tr><th>القطاع</th><th>التدفق</th><th>الشراء</th><th>النشاط</th><th>التغير</th></tr></thead><tbody>
      ${t.rows
        .map(
          (r) => `<tr class="${r.small ? "sov-small" : ""}"><td>${esc(r.ar)}</td><td class="${flowCls(r.flow.k)}">${r.flow.icon} ${esc(r.flow.ar)}</td><td class="${r.buyPct >= 55 ? "sov-up" : r.buyPct <= 45 ? "sov-dn" : "sov-flat"}">${Math.round(r.buyPct)}%</td><td class="${heatCls(r.heat.k)}">${n1(r.rel)}x</td><td class="${r.change > 0 ? "sov-t-up" : r.change < 0 ? "sov-t-dn" : ""}"><bdi>${sign(r.change)}</bdi></td></tr>`,
        )
        .join("")}</tbody></table>
      <div class="sov-foot">يتحدث كل 3 دقايق · ${new Date(t.at).toLocaleTimeString("ar-KW", { hour: "2-digit", minute: "2-digit" })}</div>`;
  }

  async function load(force = false) {
    const m = marketOf();
    if (!force && data[m] && Date.now() - (loadedAt[m] || 0) < 3 * 60e3) return paint();
    loadedAt[m] = Date.now();
    try {
      data[m] = await api.get(`/api/sectors?market=${m}`);
    } catch (e) {
      data[m] = { error: `تعذّرت القراءة: ${e.message || e}` };
    }
    paint();
  }

  function tick() {
    if (!app.settings.sectorOverlay) return;
    const p = app.active;
    if (!p) return;
    if (p !== pane || !el?.isConnected) {
      pane = p;
      mount(p);
      paint();
    }
    load();
  }

  function set(on) {
    app.settings.sectorOverlay = on;
    app.persist();
    if (on) {
      pane = null;
      tick();
    } else {
      el?.remove();
      el = null;
      pane = null;
    }
  }

  // a chart too narrow for this table and the Market Reader's side by side: this one goes to the
  // bottom left, folded unless opened
  let narrowSeen = false;
  function place() {
    if (!el || !pane?.el) return;
    const narrow = pane.el.clientWidth < 620;
    el.classList.toggle("sov-narrow", narrow);
    if (narrow && !narrowSeen && app.settings.sectorOverlaySmall === undefined) {
      narrowSeen = true;
      small = true;
      paint();
    }
  }
  setInterval(() => (tick(), place()), 3000);
  if (app.settings.sectorOverlay) setTimeout(tick, 1200);
  return { set, isOn: () => !!app.settings.sectorOverlay };
}
