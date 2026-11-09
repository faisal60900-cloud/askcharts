// فريق الوكلاء: five specialists, each sending its own daily report to Telegram, on top of the
// market watches (nothing here replaces them):
//  📈 المحلل الفني (tech), before the US open: the stocks closest to a full entry signal, with the
//     entry zone, stop and targets the market scan computes (uswatch.preview), and the AI's view;
//  🕵️ متتبع الكبار (insiders), before the US open: the biggest insider purchases of the last week
//     (SEC Form 4, from OpenInsider), your stocks marked;
//  📰 محلل النتائج (earn), after the US close: the big companies that reported tonight, their move
//     after hours, their last quarters against the forecast, and the latest headline;
//  🛡️ مدير المخاطر (risk), after the US close: each of your positions, its profit, how far the
//     stop is, and where it could be raised to protect the profit;
//  🇰🇼 محلل الكويت (kw), mid-morning in Kuwait: where the money is going, sector by sector.
// Each on or off (store "agents"), once a day, and on demand from Telegram or POST /api/agents/run.
import * as store from "./store.js";
import * as trades from "./trades.js";
import * as usflow from "./usflow.js";
import * as kwwatch from "./kwwatch.js";
import { write, ANALYST } from "./ai-write.js";
import { nasdaqEarnings, nasdaqSurprise, nasdaqLiveQuotes, getCandles, nasdaqScreener } from "./providers.js";
import { news as newsOf } from "./market-info.js";
import { nyDates, beatLine } from "./premovers.js";
import { sectors } from "./sectors.js";
import { sectorsText } from "../public/lib/sectors.js";

export const AGENTS = {
  tech: { icon: "📈", name: "سالم", ar: "المحلل الفني", when: "قبل الافتتاح (5:05 العصر)، ومتابعة 6:00 المغرب و12:05 بالليل", job: "يدوّر على أقرب الأسهم لإشارة دخول، بمنطقة شراء ووقف وأهداف" },
  momentum: { icon: "🚀", name: "سعود", ar: "محلل الزخم", when: "قبل الافتتاح (5:15 العصر)، ومتابعة 6:00 المغرب و12:05 بالليل", job: "يمسح أكبر 300 سهم أمريكي ويختار اللي اخترقت أمس بسيولة وشراء قوي، بدخول ووقف وأهداف" },
  insiders: { icon: "🕵️", name: "خالد", ar: "متتبع الكبار", when: "قبل افتتاح أمريكا (4:30 العصر)", job: "يتابع مين من المدراء والصناديق اشترى من فلوسه" },
  earn: { icon: "📰", name: "نورة", ar: "محللة النتائج", when: "قبل الافتتاح (4:45 العصر) وبعد الإغلاق (12:45 بالليل)", job: "تقرا نتائج الشركات الكبيرة أول ما تطلع" },
  risk: { icon: "🛡️", name: "فهد", ar: "مدير المخاطر", when: "بعد إغلاق أمريكا (12:10 بالليل)", job: "يراجع صفقاتك، ويقول لك وين ترفع الوقف" },
  kw: { icon: "🇰🇼", name: "عبدالله", ar: "محلل الكويت", when: "10:30 الصبح (الأحد–الخميس)", job: "يقرا السيولة والقطاعات في بورصة الكويت" },
  hr: { icon: "👩‍💼", name: "مريم", ar: "مديرة الموارد البشرية", when: "كل جمعة بعد إغلاق أمريكا", job: "تقيّم شغل الفريق بالأرقام: مين توصياته نجحت ومين لا" },
};
const KWD = 3.26; // dollars to a Kuwaiti dinar, for the profit in dinars

let st = store.read("agents", { on: Object.fromEntries(Object.keys(AGENTS).map((k) => [k, true])), sent: {} });
st.picks ||= []; // what the analysts named, for the HR review: { agent, code, day, price, stop, t1 }
st.fired ||= {}; // agent → the day HR let it go
st.record ||= {}; // agent → its last review line, shown on its reports
for (const k of Object.keys(AGENTS)) if (!(k in st.on)) st.on[k] = true;
const save = () => store.write("agents", st);
// the office page (public/office.html): the team, each one's last report and record, today's picks
export const settings = () => ({
  on: st.on,
  agents: AGENTS,
  sent: st.sent,
  last: st.last || {},
  record: st.record || {},
  fired: st.fired || {},
  picks: (st.picks || []).slice(-40).reverse(),
  ar: st.ar || {},
});
function keep(name, text) {
  if (!text) return;
  const owner = { earnpre: "earn", open: "momentum", close: "momentum", kickoff: "hr", intro: "hr" }[name] || name;
  (st.last ||= {})[owner] = { at: Date.now(), text: text.slice(0, 6000) };
  save();
}
export function update({ on } = {}) {
  for (const k of Object.keys(AGENTS)) if (on && k in on) st.on[k] = !!on[k];
  save();
  return settings();
}

const n2 = (v, d = 2) => (v == null || !Number.isFinite(v) ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d }));
const pct = (v) => `${v > 0 ? "+" : ""}${Number(v).toFixed(1)}%`;
const head = (k) => `${AGENTS[k].icon} ${AGENTS[k].name} · ${AGENTS[k].ar}\nتقريرك الخاص${st.record?.[k] ? `\n📋 سجله معك: ${st.record[k]}` : ""}`;

// ---------- 🛡️ مدير المخاطر ----------
// trades: the open trades marked as yours (trades.list().filter(t => t.mine)), each with its last price.
export function riskText(list) {
  const mine = list.filter((t) => t.mine && t.entry > 0);
  if (!mine.length) return `${head("risk")}\n\nما عندي صفقات مسجلة لك. سجّل صفقتك من AskCharts أو قول لي (السهم، والكمية، وسعر الدخول، والوقف) وأتابعها.`;
  const rows = mine.map((t) => {
    const last = t.last || t.entry;
    const kw = t.market === "kw";
    const unit = kw ? 1000 : 1; // Kuwaiti prices are in fils
    const qty = t.qty || 0;
    const pnl = (qty * (last - t.entry)) / unit; // dinars for Kuwait, dollars otherwise
    const kwd = kw ? pnl : pnl / KWD;
    const value = ((qty * last) / unit) * (kw ? KWD : 1); // in dollars, to compare the positions
    const atStop = (qty * (t.stop - t.entry)) / unit; // the result if the stop is hit
    const stopKwd = kw ? atStop : atStop / KWD;
    const upPct = (last / t.entry - 1) * 100;
    const nextTarget = (t.targets || []).find((x) => x > last);
    // where the stop could go: the entry once 5% up, the last target passed once one is passed
    const passed = (t.targets || []).filter((x) => x <= last);
    let move = "";
    if (passed.length >= 2) move = `ارفع الوقف لـ ${n2(passed.at(-2))} (الهدف اللي قبل الأخير)`;
    else if (passed.length === 1 && t.stop < t.entry) move = `ارفع الوقف لسعر الدخول ${n2(t.entry)}: الهدف الأول تحقق`;
    else if (upPct >= 5 && t.stop < t.entry) move = `ارفع الوقف لسعر الدخول ${n2(t.entry)}: الصفقة بدون خسارة`;
    return { t, last, qty, pnl, kwd, value, stopKwd, upPct, nextTarget, move, kw };
  });
  const total = rows.reduce((a, r) => a + r.value, 0);
  const lines = rows.map((r) => {
    const cur = r.kw ? "فلس" : "$";
    const share = total > 0 ? Math.round((r.value / total) * 100) : 0;
    return [
      `${r.pnl >= 0 ? "🟢" : "🔴"} ${r.t.code}${r.t.name && r.t.name !== r.t.code ? ` (${r.t.name})` : ""}: ${n2(r.last)}${cur} · ${pct(r.upPct)}`,
      `   الربح: ${r.qty ? `${r.pnl >= 0 ? "+" : ""}${n2(r.pnl, 0)}${r.kw ? " د.ك" : `$ ≈ ${r.kwd >= 0 ? "+" : ""}${n2(r.kwd, 0)} د.ك`}` : "سجّل الكمية عشان أحسبه"}`,
      `   🛑 الوقف ${n2(r.t.stop)}${cur} (${pct((r.t.stop / r.last - 1) * 100)})${r.qty ? `: لو ضرب، النتيجة ${r.stopKwd >= 0 ? "+" : ""}${n2(r.stopKwd, 0)} د.ك` : ""}`,
      r.nextTarget ? `   🎯 الهدف الجاي: ${n2(r.nextTarget)}${cur} (${pct((r.nextTarget / r.last - 1) * 100)})` : "   🎯 حقق كل الأهداف",
      r.move ? `   💡 ${r.move}` : "",
      rows.length > 1 ? `   حجمها ${share}% من صفقاتك${share >= 60 ? " ⚠️ تركيز عالي" : ""}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  });
  const sumKwd = rows.reduce((a, r) => a + (r.qty ? r.kwd : 0), 0);
  return [head("risk"), lines.join("\n\n"), `💰 المجموع: ${sumKwd >= 0 ? "+" : ""}${n2(sumKwd, 0)} د.ك`, "الوقف والأهداف من صفقتك المسجلة. اقتراح رفع الوقف قاعدة ثابتة (بعد +5% أو بعد كل هدف)، والقرار لك."].join("\n\n");
}

// ---------- 🕵️ متتبع الكبار ----------
// OpenInsider's latest purchases table: one row a trade (filing, trade date, ticker, company,
// insider, title, type, price, qty, owned, ΔOwn, value).
export function parseOpenInsider(html) {
  const body = String(html || "").match(/<table[^>]*class="tinytable"[^>]*>([\s\S]*?)<\/table>/i)?.[1] || "";
  // quote-aware: the ticker's tooltip holds an <img> inside an attribute
  const strip = (s) => s.replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").trim();
  const num = (s) => Number(String(s).replace(/[$,+]/g, "")) || 0;
  return [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => strip(c[1])))
    .filter((c) => c.length >= 13)
    .map((c) => ({ filed: c[1].slice(0, 10), date: c[2].slice(0, 10), code: c[3], company: c[4], who: c[5], title: c[6], type: c[7], price: num(c[8]), qty: num(c[9]), own: c[11], value: num(c[12]) }))
    .filter((r) => r.code && /^P/.test(r.type));
}

export function insidersText(rows, { since = "", mine = [], top = 10, min = 250e3, acts = {}, lv = {} } = {}) {
  const mineSet = new Set(mine);
  // one trade reported by several related funds is listed once
  const seen = new Set();
  const big = rows.filter((r) => r.value >= min && (!since || r.date >= since) && !seen.has(`${r.code}|${r.date}|${r.qty}`) && seen.add(`${r.code}|${r.date}|${r.qty}`)).sort((a, b) => mineSet.has(b.code) - mineSet.has(a.code) || b.value - a.value).slice(0, top);
  const money = (v) => (v >= 1e6 ? `${n2(v / 1e6, 1)} مليون$` : `${n2(v / 1e3, 0)} ألف$`);
  const yours = rows.filter((r) => mineSet.has(r.code));
  return [
    head("insiders"),
    big.length
      ? `🟢 أكبر شراء من داخل الشركات (من فلوسهم، آخر أسبوع):\n\n${big
          .map((r) => {
            const L = lv[r.code] || {};
            return stockBlock(r.code, { act: acts[r.code], mine: mineSet.has(r.code), lo: L.lo, hi: L.hi, stop: L.stop, targets: L.targets, price: L.price, fresh: L.fresh, note: `👔 ${roleAr(r.title, r.who)} اشترى ${n2(r.qty, 0)} سهم على ${n2(r.price)}$ = ${money(r.value)} (${r.date})${/^\+\d/.test(r.own) ? ` · زادت حصته ${r.own}` : /new/i.test(r.own) ? " · مركز جديد" : ""}` });
          })
          .join("\n\n")}`
      : "ما في شراء كبير من داخل الشركات آخر أسبوع.",
    mine.length && !yours.length ? `💼 أسهمك (${mine.join("، ")}): ما في مدير اشترى فيها آخر أسبوع.` : "",
    "المصدر: إفصاحات هيئة الأوراق المالية الأمريكية (Form 4). الأهداف والوقف من مسح السوق. شراء المدير إشارة ثقة، مو توقيت: مدير إنتل اشترى على 95$ والسهم نزل −39% بعدها.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function insiders(ms = Date.now()) {
  const res = await fetch("http://openinsider.com/latest-insider-purchases-25k", { headers: { "user-agent": "Mozilla/5.0 AskCharts" }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`OpenInsider ${res.status}`);
  const rows = parseOpenInsider(await res.text());
  const since = new Date(ms - 7 * 86400e3).toISOString().slice(0, 10);
  // the ten listed: their business and levels
  const seen0 = new Set();
  const listed = rows.filter((r) => r.value >= 250e3 && r.date >= since && !seen0.has(r.code) && seen0.add(r.code)).sort((a, b) => b.value - a.value).slice(0, 10).map((r) => r.code);
  const acts = await activities(listed);
  const lv = {};
  for (const c of listed) lv[c] = await levels(c).catch(() => ({}));
  const text = insidersText(rows, { since, mine: myCodes("us"), acts, lv });
  // the five biggest, for the HR review: how the stocks the insiders bought did afterwards
  const seen = new Set();
  rows.filter((r) => r.value >= 250e3 && r.date >= since && !seen.has(r.code) && seen.add(r.code)).sort((a, b) => b.value - a.value).slice(0, 5).forEach((r) => {
    // with the levels shown in the report, so the bot follows its targets and stop like the analysts'
    const L = lv[r.code] || {};
    const ok = L.stop > 0 && L.targets?.length;
    pick("insiders", r.code, { price: r.price, ...(ok ? { stop: L.stop, t1: L.targets[0], targets: L.targets.slice(0, 3), ...(L.fresh || !(L.lo && L.hi) ? { entry: L.price } : { lo: L.lo, hi: L.hi }) } : {}) });
  });
  return text;
}

// ---------- Arabic for every stock: its business, price, targets and stop ----------
// Only the symbol stays in English. The business is written once by the AI and kept (st.ar), with
// the sector in Arabic as the fallback.
const SECTOR_AR = { Technology: "تقنية", "Health Care": "رعاية صحية", Finance: "خدمات مالية", Energy: "طاقة", "Consumer Discretionary": "سلع وخدمات استهلاكية", "Consumer Staples": "سلع استهلاكية أساسية", Industrials: "صناعة", "Real Estate": "عقار", Utilities: "مرافق وكهرباء", "Basic Materials": "مواد أساسية", Telecommunications: "اتصالات", Miscellaneous: "متنوعة" };
export function sectorAr(sector) {
  return SECTOR_AR[sector] || "";
}
export async function activities(codes, { writeImpl = write } = {}) {
  st.ar ||= {};
  const need = codes.filter((c) => !st.ar[c]);
  if (need.length) {
    const rows = await nasdaqScreener("stocks").catch(() => []);
    const meta = Object.fromEntries(rows.map((r) => [r.ticker, r]));
    const list = need.map((c) => `${c}: ${meta[c]?.name || ""} (${meta[c]?.industry || meta[c]?.sector || ""})`).join("\n");
    const text = await writeImpl("أنت تكتب بالعربي البسيط لمتداول كويتي.", `لكل شركة أمريكية تحت، اكتب نشاطها بالعربي في 3 إلى 6 كلمات (مثل: «صناعة رقائق الذكاء الاصطناعي» أو «تطبيق توصيل ومشاوير»). رجّع JSON بس، بدون شرح: {"الرمز": "النشاط"}\n\n${list}`, { maxTokens: 6000 }).catch(() => null);
    let got = {};
    try {
      got = JSON.parse(String(text || "").match(/\{[\s\S]*\}/)?.[0] || "{}");
    } catch {}
    for (const c of need) {
      const a = String(got[c] || "").trim();
      if (a && /[؀-ۿ]/.test(a)) st.ar[c] = a.slice(0, 50);
      else if (sectorAr(meta[c]?.sector)) st.ar[c] = `قطاع ${sectorAr(meta[c].sector)}`;
    }
    save();
  }
  return Object.fromEntries(codes.map((c) => [c, st.ar[c] || ""]));
}

// The zone, stop and first three targets the US market scan gives a stock (uswatch.preview).
export function levelsOf(text) {
  const num = (v) => Number(String(v).replace(/,/g, ""));
  const zone = String(text || "").match(/منطقة: ([\d.,]+)\$ – ([\d.,]+)\$/);
  const stop = String(text || "").match(/وقف الخسارة الأولي: ([\d.,]+)\$/);
  const targets = [...String(text || "").matchAll(/[1-5]️⃣ ([\d.,]+)\$/g)].map((m) => num(m[1])).slice(0, 3);
  return { lo: zone ? num(zone[1]) : null, hi: zone ? num(zone[2]) : null, stop: stop ? num(stop[1]) : null, targets };
}
// The scan's levels belong to the stock's last setup; when the price has left them (well over the
// zone, under the stop, or past the first target) they're replaced by ones around today's price:
// the stop two average daily ranges (ATR 14) under it, the targets 2, 4 and 6 ATR over it.
export function freshLevels(L, price, bars = []) {
  const ok = L.lo && L.hi && L.stop && L.targets?.length && price >= L.stop && price <= L.hi * 1.05 && price < L.targets[0];
  if (ok || !(price > 0)) return { ...L, fresh: false };
  const b = bars.slice(-15);
  let atr = 0;
  for (let i = 1; i < b.length; i++) atr += Math.max(b[i].high - b[i].low, Math.abs(b[i].high - b[i - 1].close), Math.abs(b[i].low - b[i - 1].close));
  atr = b.length > 1 ? atr / (b.length - 1) : price * 0.03;
  const r2 = (v) => +v.toFixed(2);
  return { lo: null, hi: null, entry: null, stop: r2(price - 2 * atr), targets: [2, 4, 6].map((k) => r2(price + k * atr)), fresh: true };
}
async function levels(code, price) {
  const us = await import("./uswatch.js");
  const p = await us.preview(code).catch(() => null);
  const L = p?.text ? levelsOf(p.text) : { targets: [] };
  const px = price || Number((p?.text?.match(/السعر الآن: ([\d.,]+)\$/) || [])[1]?.replace(/,/g, "")) || null;
  const bars = (await getCandles(`US:${code}`, "1D", 30).catch(() => ({ candles: [] }))).candles || [];
  return { ...freshLevels(L, px, bars), price: px };
}

// One stock, in Arabic: the symbol, its business, the price, the entry, the targets and the stop.
export function stockBlock(code, { act = "", price, chg, entry, lo, hi, stop, targets = [], note = "", mine = false, fresh = false } = {}) {
  return [
    `• ${code}${mine ? " 💼" : ""}${act ? ` · ${act}` : ""}`,
    price > 0 ? `   💵 السعر: ${n2(price)}$${Number.isFinite(chg) ? ` (${pct(chg)})` : ""}` : "",
    entry ? `   🟢 الدخول فوق: ${n2(entry)}$` : lo && hi ? `   🟢 منطقة الشراء: ${n2(lo)}$ – ${n2(hi)}$` : "",
    targets.length ? `   🎯 الأهداف${fresh ? " (من السعر الحالي)" : ""}: ${targets.map((t) => `${n2(t)}$`).join(" · ")}` : "",
    stop ? `   🛑 وقف الخسارة: ${n2(stop)}$` : "",
    note ? `   ${note}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const ROLE_AR = [[/chief executive|\bceo\b/i, "الرئيس التنفيذي"], [/\bcfo\b|chief financial/i, "المدير المالي"], [/\bcoo\b/i, "مدير العمليات"], [/chair|cob\b/i, "رئيس مجلس الإدارة"], [/\bpres/i, "الرئيس"], [/\bdir/i, "عضو مجلس إدارة"], [/10%/, "مساهم كبير (10%+)"], [/\bgc\b|general counsel/i, "المستشار القانوني"], [/\bevp|\bsvp|\bvp\b/i, "نائب رئيس"]];
export function roleAr(title, who = "") {
  if (/berkshire/i.test(who)) return "بيركشاير هاثاواي (وارن بافيت)";
  const r = ROLE_AR.find(([re]) => re.test(title || ""));
  return r ? r[1] : "من داخل الشركة";
}

// ---------- 📈 المحلل الفني ----------
async function tech() {
  const us = await import("./uswatch.js");
  const near = (us.settings().near || []).slice(0, 4);
  if (!near.length) return `${head("tech")}\n\nما في أسهم قريبة من إشارة دخول كاملة الحين. أول ما يصير اختراق بسيولة، توصلك إشارة الدخول من مراقبة أمريكا.`;
  const reads = [];
  for (const n of near) {
    const p = await us.preview(n.code).catch(() => null);
    if (p?.text) {
      const num = (re) => Number((p.text.match(re) || [])[1]?.replace(/,/g, "")) || null;
      const zone = p.text.match(/منطقة: ([\d.,]+)\$ – ([\d.,]+)\$/);
      pick("tech", n.code, { price: num(/السعر الآن: ([\d.,]+)\$/), stop: num(/وقف الخسارة الأولي: ([\d.,]+)\$/), t1: num(/1️⃣ ([\d.,]+)\$/), targets: levelsOf(p.text).targets, lo: zone ? Number(zone[1].replace(/,/g, "")) : null, hi: zone ? Number(zone[2].replace(/,/g, "")) : null });
    }
    if (p?.text) reads.push({ code: n.code, why: n.why, full: p.text, text: p.text.split("\n").filter((l) => /السعر الآن|منطقة|وقف الخسارة|1️⃣|2️⃣|3️⃣|مقاومات/.test(l)).join("\n"), record: p.text.split("\n").find((l) => /السجل التاريخي/.test(l)) });
  }
  const acts = await activities(reads.map((r) => r.code));
  const view = await write(ANALYST, `هذي أسهم أمريكية قريبة من إشارة دخول، مع الناقص لكل واحد وأرقامها:\n\n${reads.map((r) => `${r.code} (ناقصه: ${r.why})\n${r.text}`).join("\n\n")}\n\nرتّب الـ ${reads.length} أسهم كلها من الأقوى للأضعف، سطر واحد لكل سهم (${reads.length} أسطر، ولا تترك ولا سهم): ليش، والشي اللي يأكد الدخول (السعر أو السيولة). بالعربي البسيط، اكتب رمز السهم بالإنجليزي بس والباقي عربي، بدون مقدمات، ولا تضمن ربح.`, { maxTokens: 8000 }).catch(() => null);
  return [
    head("tech"),
    "أقرب الأسهم لإشارة دخول كاملة:",
    reads.map((r) => { const L = levelsOf(r.full); const px = Number((r.full.match(/السعر الآن: ([\d.,]+)\$ \(([-+\d.]+)%/) || [])[1]?.replace(/,/g, "")); const chg = Number((r.full.match(/السعر الآن: [\d.,]+\$ \(([-+\d.]+)%/) || [])[1]); return stockBlock(r.code, { act: acts[r.code], price: px, chg, lo: L.lo, hi: L.hi, stop: L.stop, targets: L.targets, note: `⏳ ناقصه: ${r.why}` }); }).join("\n\n"),
    view ? `🧠 رأي المحلل:\n${view}` : "",
    reads.find((r) => r.record)?.record || "",
    "تحليل، مو توصية. الإشارة الكاملة توصلك أول ما تتحقق كل الشروط.",
  ].filter(Boolean).join("\n\n");
}

// ---------- 📰 محلل النتائج ----------
async function earn(ms = Date.now(), phase = "post") {
  const d = nyDates(ms);
  const pre = phase === "pre";
  const rows = (await nasdaqEarnings(d.today).catch(() => [])).filter((r) => (pre ? r.when === "pre" : r.when !== "pre"));
  const mine = new Set(myCodes("us"));
  const chosen = rows.filter((r) => r.cap >= 5e9 || mine.has(r.code)).sort((a, b) => mine.has(b.code) - mine.has(a.code) || b.cap - a.cap).slice(0, 10);
  if (!chosen.length) return `${head("earn")}\n\nما في شركات كبيرة أعلنت نتائجها ${pre ? "الصبح قبل الافتتاح" : "الليلة"}.`;
  const quotes = await nasdaqLiveQuotes(chosen.map((r) => r.code), "stocks").catch(() => ({}));
  const out = [];
  for (const r of chosen) {
    const close = (await getCandles(`US:${r.code}`, "1D", 3).catch(() => ({ candles: [] }))).candles?.at(-1)?.close;
    const q = quotes[r.code];
    const move = q?.price > 0 && close > 0 ? (q.price / close - 1) * 100 : null;
    const surp = await nasdaqSurprise(r.code).catch(() => []);
    const h = (await newsOf(`US:${r.code}`).catch(() => ({ items: [] }))).items.find((x) => !x.time || x.time >= ms - 12 * 3600e3);
    out.push({ ...r, move, price: q?.price, beat: beatLine(surp), head: h?.title });
  }
  const view = await write(ANALYST, `شركات أمريكية أعلنت نتائجها ${pre ? "الصبح قبل الافتتاح، وحركتها قبل الافتتاح" : "الليلة، وحركتها بعد الإغلاق"} وآخر خبر:\n${out.map((r) => `${r.code} ${r.name}: ${r.move == null ? "—" : pct(r.move)} · ${r.beat} · ${r.head || ""}`).join("\n")}\n\nبسطرين: أقوى نتيجة وأضعف نتيجة وليش، بالعربي البسيط (رمز السهم بالإنجليزي بس، والباقي عربي، وترجم معنى الأخبار)، بدون ضمانات.`, { maxTokens: 6000 }).catch(() => null);
  const acts = await activities(out.map((r) => r.code));
  for (const r of out) {
    const { price: _, ...L } = await levels(r.code, r.price);
    Object.assign(r, L);
    // with its levels, so the bot follows its targets and stop like the analysts'
    if (r.price > 0 && L.stop > 0 && L.targets?.length) pick("earn", r.code, { price: r.price, stop: L.stop, t1: L.targets[0], targets: L.targets.slice(0, 3), ...(L.fresh || !(L.lo && L.hi) ? { entry: r.price } : { lo: L.lo, hi: L.hi }) });
  }
  return [
    head("earn"),
    `نتائج ${pre ? "الصبح قبل الافتتاح" : "الليلة بعد الإغلاق"}:`,
    out.map((r) => stockBlock(r.code, { act: acts[r.code], mine: mine.has(r.code), price: r.price, chg: r.move, lo: r.lo, hi: r.hi, stop: r.stop, targets: r.targets, fresh: r.fresh, note: [r.move == null ? "" : `${r.move >= 0 ? "🟢" : "🔴"} ${pre ? "قبل الافتتاح" : "بعد الإغلاق"} ${pct(r.move)}`, r.beat].filter(Boolean).join(" · ") })).join("\n\n"),
    view ? `🧠 رأي المحلل:\n${view}` : "",
    pre ? "حركة ما قبل الافتتاح بسيولة خفيفة، والاتجاه الحقيقي يبان بعد الافتتاح بنص ساعة." : "حركة ما بعد الإغلاق بسيولة خفيفة، والاتجاه الحقيقي يبان بكرة بعد الافتتاح.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ---------- 🇰🇼 محلل الكويت ----------
async function kw() {
  const t = await sectors("kw");
  return [head("kw"), sectorsText(t, "kw")].join("\n\n");
}

// ---------- 🚀 محلل الزخم ----------
const rsiOf = (c, n = 14) => {
  let g = 0, l = 0;
  for (let i = c.length - n; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    d > 0 ? (g += d) : (l -= d);
  }
  return 100 - 100 / (1 + g / (l || 1e-9));
};
// One stock's last daily bar against its own history: a breakout of the 20-day high on more
// volume than usual, closing near the high, over the 50- and 200-day averages, not overbought.
export function momentumRow(code, b) {
  if (!b || b.length < 200) return null;
  const t = b.at(-1), p = b.at(-2);
  const cl = b.map((x) => x.close);
  const ma = (n) => cl.slice(-n).reduce((a, v) => a + v, 0) / n;
  const avg = b.slice(-21, -1).reduce((a, x) => a + x.volume, 0) / 20;
  const hi20 = Math.max(...b.slice(-21, -1).map((x) => x.high));
  const pos = t.high > t.low ? (t.close - t.low) / (t.high - t.low) : 0.5;
  const chg = (t.close / p.close - 1) * 100;
  const rel = avg > 0 ? t.volume / avg : 0;
  const rsi = rsiOf(cl);
  const ok = t.close > hi20 && rel >= 1.5 && pos >= 0.65 && t.close > ma(50) && t.close > ma(200) && rsi >= 50 && rsi <= 72 && chg > 0 && chg < 8;
  if (!ok) return null;
  // entry over today's high, stop under today's low (at most 8% away), targets at 1, 2 and 3 times the risk
  const entry = +(t.high * 1.002).toFixed(2);
  const stop = +Math.max(t.low * 0.995, entry * 0.92).toFixed(2);
  const r = entry - stop;
  return { code, price: t.close, chg, rel, buy: Math.round(pos * 100), rsi: Math.round(rsi), entry, stop, targets: [1, 2, 3].map((k) => +(entry + k * r).toFixed(2)), score: rel * (pos + 0.5) };
}

export function momentumText(rows, acts = {}) {
  if (!rows.length) return `${head("momentum")}\n\nما في سهم كبير اخترق أمس بكل الشروط (سيولة 1.5 ضعف، وإغلاق قرب القمة، وفوق متوسط 50 و200 يوم، وRSI بين 50 و72). أحيانًا الأفضل ما تدخل.`;
  return [
    head("momentum"),
    "أقوى اختراقات أمس (من أكبر 300 سهم أمريكي):",
    rows.map((r) => stockBlock(r.code, { act: acts[r.code], price: r.price, chg: r.chg, entry: r.entry, stop: r.stop, targets: r.targets, note: `📊 سيولة ${n2(r.rel, 1)} ضعف · شراء ${r.buy}% · RSI ${r.rsi}` })).join("\n\n"),
    "الدخول بس لو السعر عدّى قمة أمس بعد الافتتاح، وانتظر أول 15 دقيقة. تحليل، مو توصية.",
  ].join("\n\n");
}

async function momentum() {
  const rows = (await nasdaqScreener("stocks"))
    .filter((r) => r.price >= 5 && r.marketCap >= 5e9 && /^[A-Z]{1,5}$/.test(r.ticker))
    .sort((a, b) => b.price * b.volume - a.price * a.volume)
    .slice(0, 300);
  const found = [];
  const q = rows.map((r) => r.ticker);
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (q.length) {
        const c = q.shift();
        const b = (await getCandles(`US:${c}`, "1D", 260).catch(() => ({ candles: [] }))).candles;
        const r = momentumRow(c, b);
        if (r) found.push(r);
      }
    }),
  );
  const top = found.sort((a, b) => b.score - a.score).slice(0, 5);
  for (const r of top) pick("momentum", r.code, { price: r.entry, stop: r.stop, t1: r.targets[0], targets: r.targets.slice(0, 3), entry: r.entry });
  return momentumText(top, await activities(top.map((r) => r.code)));
}

// ---------- 🔔 متابعة توصيات اليوم: عند الافتتاح وبعد الإغلاق ----------
// Where each of today's picks by سالم and سعود stands: in the zone, over the entry, at the first
// target, or under the stop. phase "open" (half an hour in) or "close".
export function followText(picks, quotes, phase, buys = {}) {
  const rows = picks.filter((p) => quotes[p.code]?.price > 0);
  if (!rows.length) return "";
  const status = (p, px) => {
    if (p.t1 && px >= p.t1) return "🎯 وصل الهدف الأول";
    if (p.stop && px <= p.stop) return "🛑 تحت الوقف";
    if (p.entry) return px >= p.entry ? "✅ عدّى نقطة الدخول" : "⏳ للحين تحت نقطة الدخول";
    if (p.lo && p.hi) return px < p.lo ? "⬇️ تحت منطقة الشراء" : px <= p.hi ? "✅ داخل منطقة الشراء" : "⏳ فوق منطقة الشراء";
    return "";
  };
  const by = (a) => rows.filter((p) => p.agent === a);
  const block = (a) =>
    by(a).length
      ? `${AGENTS[a].icon} ${AGENTS[a].name}:\n${by(a)
          .map((p) => {
            const q = quotes[p.code];
            return `• ${p.code}: ${n2(q.price)}$${Number.isFinite(q.changePct) ? ` (${pct(q.changePct)} اليوم)` : ""}${buys[p.code] != null ? ` · شراء ${buys[p.code]}%` : ""}\n   ${status(p, q.price)}${p.entry ? ` · الدخول ${n2(p.entry)}$` : p.lo ? ` · المنطقة ${n2(p.lo)}–${n2(p.hi)}$` : ""} · الوقف ${n2(p.stop)}$ · الهدف ${n2(p.t1)}$`;
          })
          .join("\n")}`
      : "";
  return [
    `🔔 ${phase === "open" ? "بعد الافتتاح بنص ساعة" : "بعد الإغلاق"} · متابعة توصيات اليوم`,
    block("momentum"),
    block("tech"),
    phase === "open" ? "اللي «عدّى نقطة الدخول» بشراء فوق 55% إشارته أقوى. اللي تحت الوقف انتهى." : "مريم تحسب النتيجة النهائية لكل توصية يوم الجمعة.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

// today's quotes and buying share (the whole day and the last 15 minutes) for some codes
async function liveState(codes, ms = Date.now()) {
  const quotes = await nasdaqLiveQuotes(codes, "stocks").catch(() => ({}));
  const buys = {}, recent = {};
  const share = (bars) => {
    const vol = bars.reduce((a, b) => a + b.volume, 0);
    return vol ? Math.round((bars.reduce((a, b) => a + b.volume * (b.high > b.low ? (b.close - b.low) / (b.high - b.low) : 0.5), 0) / vol) * 100) : null;
  };
  for (const c of codes) {
    const bars = ((await getCandles(`US:${c}`, "5m", 90).catch(() => ({ candles: [] }))).candles || []).filter((b) => new Date(b.time * 1000).toISOString().slice(0, 10) === new Date(ms).toISOString().slice(0, 10) && b.volume > 0);
    buys[c] = share(bars);
    recent[c] = share(bars.slice(-3));
  }
  return { quotes, buys, recent };
}

async function follow(phase, ms = Date.now()) {
  const today = nyDates(ms).today;
  const picks = st.picks.filter((p) => p.day === today && (p.agent === "tech" || p.agent === "momentum"));
  if (!picks.length) return "";
  const { quotes, buys } = await liveState([...new Set(picks.map((p) => p.code))], ms);
  return followText(picks, quotes, phase, buys);
}

// ---------- ⚡ فرصة الحين، 🎯 الأهداف و 🛑 الوقف ----------
// During the session an analyst writes: the moment one of today's picks confirms (over the entry,
// or inside the zone, with the day's buying at 60% or more and the last 15 minutes buying too);
// and for each pick of the last 5 business days, every target it reaches (1, 2, 3), the stop
// before any target, and after the first target a fall back to the entry (the raised stop).
// Each once (mem). today: New York's date, for "today's picks only" on the opportunity.
const ORD = ["الأول", "الثاني", "الثالث"];
export function liveEvents(picks, { quotes = {}, buys = {}, recent = {} } = {}, mem = {}, acts = {}, { today } = {}) {
  const ev = [];
  for (const p of picks) {
    const q = quotes[p.code];
    if (!(q?.price > 0)) continue;
    const px = q.price, a = AGENTS[p.agent];
    const key = (k) => `${p.agent}|${p.code}|${p.day}|${k}`;
    const once = (k) => (mem[key(k)] ? false : (mem[key(k)] = 1));
    const entry = p.entry || (p.lo && p.hi ? (p.lo + p.hi) / 2 : p.price);
    // older picks kept the first target only: the scan's targets are evenly spaced by the risk
    const R = p.t1 && entry > 0 && p.stop ? p.t1 - entry : 0;
    const T = (p.targets?.length ? p.targets : R > 0 ? [p.t1, p.t1 + R, p.t1 + 2 * R].map((v) => Math.round(v * 100) / 100) : [p.t1]).filter((v) => v > 0);
    const when = !today || p.day === today ? "من توصية اليوم" : `من توصية ${p.day}`;
    const gain = entry > 0 ? ` (${px >= entry ? "+" : ""}${n2(((px - entry) / entry) * 100, 1)}% من الدخول ${n2(entry)}$)` : "";
    const block = (note) => `${a.icon} ${a.name} · ${a.ar}\n${note}\n\n${stockBlock(p.code, { act: acts[p.code], price: px, chg: q.changePct, entry: p.entry, lo: p.lo, hi: p.hi, stop: p.stop, targets: T })}`;
    const reached = T.reduce((n, t, i) => (px >= t ? i + 1 : n), 0);
    const hitBefore = T.some((_, i) => mem[key(`t${i + 1}`)]);
    if (reached) {
      // the highest target reached, once; the lower ones count as reached with it
      const fresh = !mem[key(`t${reached}`)];
      for (let i = 1; i <= reached; i++) mem[key(`t${i}`)] = 1;
      if (fresh) {
        const all = reached === T.length && T.length > 1;
        const next = all || !T[reached] ? "" : `\nالهدف الجاي: ${n2(T[reached])}$.`;
        const tip = reached === 1 ? " اللي دخل يرفع الوقف لسعر دخوله." : ` اللي دخل يرفع الوقف للهدف ${ORD[reached - 2]} (${n2(T[reached - 2])}$).`;
        ev.push(block(`🎯 ${p.code} ${all ? `حقق كل الأهداف 🎉 (${T.length})` : `وصل الهدف ${ORD[reached - 1]}`} ${when}${gain}.${all ? "" : tip}${next}`));
      }
      continue;
    }
    if (hitBefore) {
      // after a target: back at the entry, where the raised stop is
      if (entry > 0 && px <= entry && once("back")) ev.push(block(`↩️ ${p.code} رجع لسعر الدخول بعد ما حقق الهدف الأول ${when}. اللي رفع وقفه للدخول طلع بدون خسارة.`));
      continue;
    }
    if (p.stop && px <= p.stop) {
      if (once("stop")) ev.push(block(`🛑 ${p.code} نزل تحت وقف الخسارة ${when}${gain}. التوصية انتهت.`));
      continue;
    }
    if (today && p.day !== today) continue; // the opportunity: today's picks only
    const inEntry = p.entry ? px >= p.entry && px < (T[0] || Infinity) : p.lo && p.hi ? px >= p.lo && px <= p.hi : false;
    if (inEntry && buys[p.code] >= 60 && recent[p.code] >= 60 && once("go")) ev.push(block(`⚡ فرصة الحين: ${p.code} ${p.entry ? "عدّى نقطة الدخول" : "داخل منطقة الشراء"} والشراء قوي (اليوم ${buys[p.code]}%، وآخر 15 دقيقة ${recent[p.code]}%).\nتأكيد، مو ضمان. حط الوقف من البداية.`));
  }
  return ev;
}

// the picks still followed: the analysts', and Khaled's and Noura's with levels, from the last 5 business days
export function followedPicks(picks, today, on = {}) {
  const d = new Date(`${today}T12:00:00Z`);
  let n = 0;
  while (n < 4) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (![0, 6].includes(d.getUTCDay())) n++;
  }
  const from = d.toISOString().slice(0, 10);
  return picks.filter((p) => (p.agent === "tech" || p.agent === "momentum" || (p.stop > 0 && p.t1 > 0)) && on[p.agent] !== false && p.day >= from && p.day <= today);
}

async function live(send, ms = Date.now()) {
  const today = nyDates(ms).today;
  const picks = followedPicks(st.picks, today, st.on);
  if (!picks.length) return 0;
  const codes = [...new Set(picks.map((p) => p.code))];
  st.live ||= {};
  const ev = liveEvents(picks, await liveState(codes, ms), st.live, st.ar || {}, { today });
  save();
  for (const t of ev) {
    keep(Object.keys(AGENTS).find((k) => t.startsWith(AGENTS[k].icon)) || "tech", t);
    await send(t);
  }
  return ev.length;
}

// ---------- 👤 خاص لك: your own US positions as they move ----------
// Every 1% step in the price of one of your trades (from the last message), a private message with
// the price, the day's change, your profit in dollars and dinars, the next target and the stop.
// The first look of the day only learns where it is. To your private chat only, never the group.
export function mineMoveEvents(list, quotes = {}, mem = {}, { day = "", step = 1, acts = {} } = {}) {
  const ev = [];
  for (const t of list.filter((t) => t.mine && t.entry > 0 && t.market !== "kw" && !t.closed)) {
    const q = quotes[t.code];
    if (!(q?.price > 0)) continue;
    const px = q.price;
    const m = mem[t.code];
    if (!m || m.day !== day) {
      mem[t.code] = { day, at: px };
      continue;
    }
    const moved = ((px - m.at) / m.at) * 100;
    if (Math.abs(moved) < step) continue;
    m.at = px;
    const qty = t.qty || 0;
    const pnl = qty * (px - t.entry);
    const kwd = pnl / KWD;
    const up = (px / t.entry - 1) * 100;
    const next = (t.targets || []).find((x) => x > px);
    const name = acts[t.code] ? ` · ${acts[t.code]}` : "";
    ev.push(
      [
        `👤 خاص لك · ${moved > 0 ? "📈" : "📉"} ${t.code}${name}`,
        `💵 السعر الحين: ${n2(px)}$ (${q.changePct >= 0 ? "+" : ""}${n2(q.changePct, 1)}% اليوم) · ${moved > 0 ? "طلع" : "نزل"} ${n2(Math.abs(moved), 1)}% من آخر رسالة`,
        qty ? `${pnl >= 0 ? "🟢" : "🔴"} ربحك: ${pnl >= 0 ? "+" : ""}${n2(pnl, 0)}$ ≈ ${kwd >= 0 ? "+" : ""}${n2(kwd, 0)} د.ك (${pct(up)} من دخولك ${n2(t.entry)}$ · ${n2(qty, 0)} سهم)` : `${pct(up)} من دخولك ${n2(t.entry)}$ (سجّل الكمية عشان أحسب ربحك)`,
        [next ? `🎯 الهدف الجاي: ${n2(next)}$ (${pct((next / px - 1) * 100)})` : "", t.stop ? `🛑 الوقف: ${n2(t.stop)}$` : ""].filter(Boolean).join(" · "),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return ev;
}
async function mineMoves(ms = Date.now()) {
  const list = trades.list().filter((t) => t.mine && t.market !== "kw");
  if (!list.length) return 0;
  const quotes = await nasdaqLiveQuotes([...new Set(list.map((t) => t.code))], "stocks").catch(() => ({}));
  st.mine ||= {};
  const ev = mineMoveEvents(list, quotes, st.mine, { day: nyDates(ms).today, acts: st.ar || {} });
  save();
  for (const t of ev) if (kwwatch.settings().telegram) await kwwatch.sendTelegram(t, null).catch(() => {});
  return ev.length;
}

// ⚡ خالد: a big purchase by a company's own chief (or Berkshire) the moment it's filed
export function bigInsiderNew(rows, seen = {}, { since = "", min = 1e6 } = {}) {
  const top = /chief executive|\bceo\b|\bcfo\b|chief financial|\bpres|chair|\bcob\b/i;
  return rows.filter((r) => r.value >= min && (!since || r.date >= since) && (top.test(r.title) || /berkshire/i.test(r.who)) && !seen[`${r.code}|${r.date}|${r.qty}`] && (seen[`${r.code}|${r.date}|${r.qty}`] = 1));
}
async function liveInsiders(send, ms = Date.now()) {
  const res = await fetch("http://openinsider.com/latest-insider-purchases-25k", { headers: { "user-agent": "Mozilla/5.0 AskCharts" }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) return 0;
  const rows = parseOpenInsider(await res.text());
  st.seenIns ||= {};
  const first = !Object.keys(st.seenIns).length; // the first look only learns what's already there
  const fresh = bigInsiderNew(rows, st.seenIns, { since: new Date(ms - 3 * 86400e3).toISOString().slice(0, 10) });
  save();
  if (first) return 0;
  const acts = await activities(fresh.map((r) => r.code));
  for (const r of fresh) {
    const L = await levels(r.code).catch(() => ({}));
    await send(`${AGENTS.insiders.icon} ${AGENTS.insiders.name} · ${AGENTS.insiders.ar}\n⚡ شراء كبير جديد من داخل الشركة\n\n${stockBlock(r.code, { act: acts[r.code], price: L.price, lo: L.lo, hi: L.hi, stop: L.stop, targets: L.targets, fresh: L.fresh, note: `👔 ${roleAr(r.title, r.who)} اشترى ${n2(r.qty, 0)} سهم على ${n2(r.price)}$ = ${n2(r.value / 1e6, 1)} مليون$ (${r.date})` })}\n\nشراء المدير إشارة ثقة، مو توقيت.`);
  }
  return fresh.length;
}

// ---------- 👩‍💼 الموارد البشرية ----------
function pick(agent, code, { price = null, stop = null, t1 = null, ...extra } = {}) {
  const day = nyDates().today;
  if (!(price > 0) || st.picks.some((p) => p.agent === agent && p.code === code && p.day === day)) return;
  st.picks.push({ agent, code, day, price, stop, t1, ...extra });
  st.picks = st.picks.slice(-300);
  save();
}

// How each pick did from its day on, from the daily bars after it: the first target before the
// stop (tech), and the change since (both). bars: { CODE: [{ time, high, low, close }] }.
export function review(picks, bars, { today } = {}) {
  const res = { tech: [], momentum: [], insiders: [] };
  for (const p of picks) {
    const after = (bars[p.code] || []).filter((b) => new Date(b.time * 1000).toISOString().slice(0, 10) > p.day);
    if (!after.length || !res[p.agent]) continue;
    let outcome = "open";
    if ((p.agent === "tech" || p.agent === "momentum") && p.t1 && p.stop) {
      for (const b of after) {
        if (b.low <= p.stop) { outcome = "stop"; break; }
        if (b.high >= p.t1) { outcome = "target"; break; }
      }
    }
    res[p.agent].push({ ...p, outcome, change: (after.at(-1).close / p.price - 1) * 100, days: after.length });
  }
  return res;
}

// An analyst whose closed picks (a target or the stop) hit the stop most of the time is let go:
// six closed picks at least, under 40% reaching the first target, and losing on average.
export function verdict(rows) {
  const won = rows.filter((r) => r.outcome === "target").length, lost = rows.filter((r) => r.outcome === "stop").length;
  const done = won + lost;
  const avg = rows.length ? rows.reduce((s, r) => s + r.change, 0) / rows.length : 0;
  const rate = done ? Math.round((won / done) * 100) : null;
  const fire = done >= 6 && rate < 40 && avg < 0;
  return { won, lost, done, open: rows.length - done, rate, avg, fire, line: `${rows.length} توصية · ${rate == null ? "للحين ما تسكّرت" : `نجاح ${rate}% (${won} هدف، ${lost} وقف)`} · متوسط ${pct(avg)}` };
}

export function hrText(res, { fired = [] } = {}) {
  const avg = (a) => (a.length ? a.reduce((s, r) => s + r.change, 0) / a.length : 0);
  const grade = (v) => (v.fire ? "🔴 انفصل" : v.rate != null && v.rate >= 55 && v.avg > 0 ? "⭐ ممتاز" : v.avg >= 0 ? "✅ جيد" : "⚠️ تحت المراقبة");
  const parts = [head("hr")];
  for (const k of ["tech", "momentum"]) {
    const t = res[k] || [];
    if (!t.length) continue;
    const v = verdict(t);
    parts.push(`${AGENTS[k].icon} ${AGENTS[k].name} (${AGENTS[k].ar}): ${v.line}\n   التقييم: ${grade(v)}\n` + t.slice(-6).map((r) => `   • ${r.code} (${r.day}): ${pct(r.change)} ${r.outcome === "target" ? "🎯" : r.outcome === "stop" ? "🛑" : "⏳"}`).join("\n"));
  }
  const i = res.insiders || [];
  if (i.length) parts.push(`${AGENTS.insiders.icon} ${AGENTS.insiders.name} (${AGENTS.insiders.ar}): ${i.length} سهم اشترى فيها المدراء\n   متوسط حركتها من سعر شراء المدير: ${pct(avg(i))} · التقييم: ${avg(i) >= 0 ? "✅ جيد" : "⚠️ تحت المراقبة"}\n` + [...i].sort((a, b) => b.change - a.change).slice(0, 6).map((r) => `   • ${r.code}: ${pct(r.change)}`).join("\n"));
  if (!(res.tech || []).length && !(res.momentum || []).length && !i.length) parts.push("للحين ما في توصيات كافية للتقييم. أول تقييم حقيقي بعد أسبوع شغل.");
  if (fired.length) parts.push(`🚪 قرار الفصل: ${fired.map((k) => `${AGENTS[k].name} (${AGENTS[k].ar})`).join("، ")}. أكثر توصياته ضربت الوقف وخسرت بالمتوسط، فوقفت تقاريره. لو تبي ترجّعه: اكتب «رجع ${AGENTS[fired[0]].name}».`);
  parts.push(`${AGENTS.earn.icon} ${AGENTS.earn.name}، و${AGENTS.risk.icon} ${AGENTS.risk.name}، و${AGENTS.kw.icon} ${AGENTS.kw.name}: شغلهم تقارير ومراجعة، مو توصيات، فما ينقاس بنسبة نجاح.`);
  parts.push("قاعدة الفصل: 6 توصيات مسكّرة أو أكثر، ونجاح أقل من 40%، وخسارة بالمتوسط. التقييم من الأسعار الفعلية، والأداء السابق ما يضمن الجاي.");
  return parts.join("\n\n");
}

async function hr() {
  const since = new Date(Date.now() - 35 * 86400e3).toISOString().slice(0, 10);
  const picks = st.picks.filter((p) => p.day >= since);
  const bars = {};
  for (const c of [...new Set(picks.map((p) => p.code))]) bars[c] = (await getCandles(`US:${c}`, "1D", 40).catch(() => ({ candles: [] }))).candles || [];
  const res = review(picks, bars);
  // the record each analyst shows on its reports, and who is let go
  const fired = [];
  for (const k of ["tech", "momentum"]) {
    if (!res[k].length) continue;
    const v = verdict(res[k]);
    st.record[k] = v.line;
    if (v.fire && st.on[k]) {
      st.on[k] = false;
      st.fired[k] = nyDates().today;
      fired.push(k);
    }
  }
  if (res.insiders.length) st.record.insiders = `${res.insiders.length} سهم · متوسط حركتها ${pct(res.insiders.reduce((a, r) => a + r.change, 0) / res.insiders.length)}`;
  save();
  return hrText(res, { fired });
}
export function rehire(k) {
  if (!AGENTS[k]) return null;
  st.on[k] = true;
  delete st.fired[k];
  save();
  return `👩‍💼 مريم: رجّعت ${AGENTS[k].name} (${AGENTS[k].ar}) للفريق. تقاريره ترجع من بكرة.`;
}

export function introText() {
  return [
    "📢 إعلان توظيف · فريقك الجديد",
    "👩‍💼 مريم، مديرة الموارد البشرية: «اخترت لك 6 موظفين، كل واحد متخصص، وأغلبهم على سوق أمريكا كل يوم. أنا أراقب شغلهم كل أسبوع بالأرقام، واللي توصياته ما تنجح أفصله.»",
    Object.entries(AGENTS).filter(([k]) => k !== "hr").map(([, a]) => `${a.icon} ${a.name} · ${a.ar}\n   ${a.job}\n   ⏰ ${a.when}`).join("\n\n"),
    "كل تقرير يوصلك باسم صاحبه. وتقدر تطلب أي واحد بأي وقت: اكتب اسمه (سالم، خالد، نورة، فهد، عبدالله، مريم).",
    "هذا إضافة على تنبيهاتك وإشاراتك، وما يغيّر منها شي.",
  ].join("\n\n");
}

// مريم starts the team's day: who sends what today, in Kuwait's time
export function kickoffText(ms = Date.now()) {
  const k = parts(ms, "Asia/Kuwait");
  const fri = k.weekday === "Fri", sat = k.weekday === "Sat";
  const list = [
    !fri && !sat ? `${AGENTS.kw.icon} ${AGENTS.kw.name}: 10:30 الصبح` : "",
    `${AGENTS.insiders.icon} ${AGENTS.insiders.name}: 4:30 العصر`,
    `${AGENTS.earn.icon} ${AGENTS.earn.name}: 4:45 العصر (نتائج الصبح قبل الافتتاح)`,
    `${AGENTS.tech.icon} ${AGENTS.tech.name}: 5:05 العصر`,
    `${AGENTS.momentum.icon} ${AGENTS.momentum.name}: 5:15 العصر`,
    "🔔 سالم وسعود: 6:00 المغرب (وين وصلت توصياتهم بعد الافتتاح)",
    "⚡ وأي وقت وقت السوق: لو توصية تأكدت بشراء قوي، أو وصلت الهدف، أو مدير كبير اشترى",
    "🔔 سالم وسعود: 12:05 بالليل (وين سكّرت توصياتهم)",
    `${AGENTS.risk.icon} ${AGENTS.risk.name}: 12:10 بالليل`,
    `${AGENTS.earn.icon} ${AGENTS.earn.name}: 12:45 بالليل`,
    fri ? `${AGENTS.hr.icon} ${AGENTS.hr.name}: تقييم الأسبوع 12:30 بالليل` : "",
  ].filter(Boolean);
  return [`${AGENTS.hr.icon} ${AGENTS.hr.name} · ${AGENTS.hr.ar}`, "🟢 بدينا الشغل من اليوم! الفريق كله على مكتبه، وأول التقارير توصلك اليوم:", list.join("\n"), "من اليوم كل توصية من سالم وسعود وخالد تنسجّل، وكل جمعة أقيّمهم بالأرقام. اللي ينجح يستمر، واللي ما ينجح أفصله.", "تبي أي واحد الحين؟ اكتب اسمه للبوت."].join("\n\n");
}

const myCodes = (market) => [...new Set([...(market === "us" ? usflow.follow() : []), ...trades.list(market).filter((t) => t.mine).map((t) => t.code)])];

export async function run(name, ms = Date.now()) {
  if (name === "risk") return riskText(trades.list());
  if (name === "insiders") return insiders(ms);
  if (name === "tech") return tech();
  if (name === "momentum") return momentum();
  if (name === "earn") return earn(ms);
  if (name === "earnpre") return earn(ms, "pre");
  if (name === "open") return follow("open", ms);
  if (name === "close") return follow("close", ms);
  if (name === "kw") return kw();
  if (name === "hr") return hr();
  if (name === "intro") return introText();
  if (name === "kickoff") return kickoffText();
  throw new Error(`ما أعرف الوكيل ${name}`);
}

// ---------- the clock ----------
const NY = "America/New_York";
const parts = (ms, tz) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
// which agents are due at this moment: New York times for the US ones (weekdays), Kuwait's for Kuwait (Sunday–Thursday)
export function due(ms = Date.now(), sent = st.sent) {
  const n = parts(ms, NY);
  const k = parts(ms, "Asia/Kuwait");
  const nyMin = Number(n.hour) * 60 + Number(n.minute);
  const kwMin = Number(k.hour) * 60 + Number(k.minute);
  const nyDay = `${n.year}-${n.month}-${n.day}`;
  const kwDay = `${k.year}-${k.month}-${k.day}`;
  const nyWork = !["Sat", "Sun"].includes(n.weekday);
  const kwWork = !["Fri", "Sat"].includes(k.weekday);
  const win = (min, from, len = 20) => min >= from && min < from + len;
  const out = [];
  if (nyWork && win(nyMin, 8 * 60 + 30) && !sent[`insiders|${nyDay}`]) out.push(["insiders", nyDay]);
  if (nyWork && win(nyMin, 9 * 60 + 5) && !sent[`tech|${nyDay}`]) out.push(["tech", nyDay]);
  if (nyWork && win(nyMin, 9 * 60 + 15) && !sent[`momentum|${nyDay}`]) out.push(["momentum", nyDay]);
  if (nyWork && win(nyMin, 8 * 60 + 45) && !sent[`earnpre|${nyDay}`]) out.push(["earnpre", nyDay]);
  if (nyWork && win(nyMin, 10 * 60) && !sent[`open|${nyDay}`]) out.push(["open", nyDay]);
  if (nyWork && win(nyMin, 16 * 60 + 5) && !sent[`close|${nyDay}`]) out.push(["close", nyDay]);
  if (nyWork && win(nyMin, 16 * 60 + 10) && !sent[`risk|${nyDay}`]) out.push(["risk", nyDay]);
  if (nyWork && win(nyMin, 16 * 60 + 45, 30) && !sent[`earn|${nyDay}`]) out.push(["earn", nyDay]);
  if (kwWork && win(kwMin, 10 * 60 + 30) && !sent[`kw|${kwDay}`]) out.push(["kw", kwDay]);
  // the weekly review: Friday after the US close
  if (n.weekday === "Fri" && win(nyMin, 16 * 60 + 30) && !sent[`hr|${nyDay}`]) out.push(["hr", nyDay]);
  return out;
}

// where a report goes: Kuwait's to the Kuwait chat, فهد's (your positions and profit) to your
// private chat only, the rest to the US one
const marketOf = (name) => (name === "kw" ? "kw" : name === "risk" ? null : "us");
// one report now, to Telegram too
export async function sendNow(name) {
  const text = await run(name);
  keep(name, text);
  if (text && kwwatch.settings().telegram) await kwwatch.sendTelegram(text.length > 3900 ? text.slice(0, 3890) + "…" : text, marketOf(name));
  return text;
}

let timer = null;
async function tick() {
  for (const [name, day] of due()) {
    const owner = { earnpre: "earn", open: "momentum", close: "momentum" }[name] || name;
    if (!st.on[owner] && !(name !== owner && st.on.tech)) continue;
    st.sent[`${name}|${day}`] = Date.now(); // marked first, so a failing feed doesn't retry every minute
    save();
    const text = await run(name).catch((e) => `${head(name)}\n\nما قدرت أجهز التقرير اليوم: ${e.message}`);
    keep(name, text);
    if (text && kwwatch.settings().telegram) await kwwatch.sendTelegram(text.length > 3900 ? text.slice(0, 3890) + "…" : text, marketOf(name)).catch(() => {});
  }
  // any time in the session: the picks that confirm (every 5 minutes), and the big insider buys (every 30)
  const n = parts(Date.now(), NY);
  const nyMin = Number(n.hour) * 60 + Number(n.minute);
  const work = !["Sat", "Sun"].includes(n.weekday);
  const tg = (t) => (kwwatch.settings().telegram ? kwwatch.sendTelegram(t.length > 3900 ? t.slice(0, 3890) + "…" : t, "us").catch(() => {}) : null);
  if (work && nyMin >= 9 * 60 + 35 && nyMin < 16 * 60 && Date.now() - (st.liveAt || 0) >= 5 * 60e3) {
    st.liveAt = Date.now();
    await live(tg).catch(() => {});
  }
  if (work && nyMin >= 9 * 60 + 30 && nyMin < 16 * 60 && Date.now() - (st.mineAt || 0) >= 2 * 60e3) {
    st.mineAt = Date.now();
    await mineMoves().catch(() => {});
  }
  if (st.on.insiders && work && nyMin >= 8 * 60 && nyMin < 18 * 60 && Date.now() - (st.insAt || 0) >= 30 * 60e3) {
    st.insAt = Date.now();
    await liveInsiders(tg).catch(() => {});
  }
  const old = new Date(Date.now() - 10 * 86400e3).toISOString().slice(0, 10);
  for (const k of Object.keys(st.sent)) if (k.split("|")[1] < old) delete st.sent[k];
  for (const k of Object.keys(st.live || {})) if (k.split("|")[2] < old) delete st.live[k];
}
export function start() {
  clearInterval(timer);
  timer = setInterval(() => tick().catch(() => {}), 60e3);
}
