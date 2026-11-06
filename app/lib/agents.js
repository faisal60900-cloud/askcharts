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
import { nasdaqEarnings, nasdaqSurprise, nasdaqLiveQuotes, getCandles } from "./providers.js";
import { news as newsOf } from "./market-info.js";
import { nyDates, beatLine } from "./premovers.js";
import { sectors } from "./sectors.js";
import { sectorsText } from "../public/lib/sectors.js";

export const AGENTS = {
  tech: { icon: "📈", ar: "المحلل الفني", when: "قبل افتتاح أمريكا (5:05 العصر)" },
  insiders: { icon: "🕵️", ar: "متتبع الكبار", when: "قبل افتتاح أمريكا (4:30 العصر)" },
  earn: { icon: "📰", ar: "محلل النتائج", when: "بعد إغلاق أمريكا (12:45 بالليل)" },
  risk: { icon: "🛡️", ar: "مدير المخاطر", when: "بعد إغلاق أمريكا (12:10 بالليل)" },
  kw: { icon: "🇰🇼", ar: "محلل الكويت", when: "10:30 الصبح" },
};
const KWD = 3.26; // dollars to a Kuwaiti dinar, for the profit in dinars

let st = store.read("agents", { on: Object.fromEntries(Object.keys(AGENTS).map((k) => [k, true])), sent: {} });
const save = () => store.write("agents", st);
export const settings = () => ({ on: st.on, agents: AGENTS, sent: st.sent });
export function update({ on } = {}) {
  for (const k of Object.keys(AGENTS)) if (on && k in on) st.on[k] = !!on[k];
  save();
  return settings();
}

const n2 = (v, d = 2) => (v == null || !Number.isFinite(v) ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d }));
const pct = (v) => `${v > 0 ? "+" : ""}${Number(v).toFixed(1)}%`;
const head = (k) => `${AGENTS[k].icon} ${AGENTS[k].ar} · تقريرك الخاص`;

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

export function insidersText(rows, { since = "", mine = [], top = 10, min = 250e3 } = {}) {
  const mineSet = new Set(mine);
  // one trade reported by several related funds is listed once
  const seen = new Set();
  const big = rows.filter((r) => r.value >= min && (!since || r.date >= since) && !seen.has(`${r.code}|${r.date}|${r.qty}`) && seen.add(`${r.code}|${r.date}|${r.qty}`)).sort((a, b) => mineSet.has(b.code) - mineSet.has(a.code) || b.value - a.value).slice(0, top);
  const money = (v) => (v >= 1e6 ? `${n2(v / 1e6, 1)} مليون$` : `${n2(v / 1e3, 0)} ألف$`);
  const yours = rows.filter((r) => mineSet.has(r.code));
  return [
    head("insiders"),
    big.length ? `🟢 أكبر شراء من المدراء (من فلوسهم، آخر أسبوع):\n${big.map((r) => `• ${r.code}${mineSet.has(r.code) ? " 💼" : ""} · ${r.company.slice(0, 28)}\n   ${r.who.slice(0, 26)}${r.title ? ` (${r.title.slice(0, 20)})` : ""}: ${n2(r.qty, 0)} سهم على ${n2(r.price)}$ = ${money(r.value)} · ${r.date}${/^\+\d/.test(r.own) ? ` · زادت حصته ${r.own}` : /new/i.test(r.own) ? " · مركز جديد" : ""}`).join("\n")}` : "ما في شراء كبير من المدراء آخر أسبوع.",
    mine.length && !yours.length ? `💼 أسهمك (${mine.join("، ")}): ما في مدير اشترى فيها آخر أسبوع.` : "",
    "المصدر: إفصاحات Form 4 لهيئة الأوراق المالية الأمريكية. شراء المدير إشارة ثقة، مو توقيت: مدير إنتل اشترى على 95$ والسهم نزل −39% بعدها.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function insiders(ms = Date.now()) {
  const res = await fetch("http://openinsider.com/latest-insider-purchases-25k", { headers: { "user-agent": "Mozilla/5.0 AskCharts" }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`OpenInsider ${res.status}`);
  const rows = parseOpenInsider(await res.text());
  const since = new Date(ms - 7 * 86400e3).toISOString().slice(0, 10);
  return insidersText(rows, { since, mine: myCodes("us") });
}

// ---------- 📈 المحلل الفني ----------
async function tech() {
  const us = await import("./uswatch.js");
  const near = (us.settings().near || []).slice(0, 4);
  if (!near.length) return `${head("tech")}\n\nما في أسهم قريبة من إشارة دخول كاملة الحين. أول ما يصير اختراق بسيولة، توصلك إشارة الدخول من مراقبة أمريكا.`;
  const reads = [];
  for (const n of near) {
    const p = await us.preview(n.code).catch(() => null);
    if (p?.text) reads.push({ code: n.code, why: n.why, text: p.text.split("\n").filter((l) => /السعر الآن|منطقة|وقف الخسارة|1️⃣|2️⃣|3️⃣|مقاومات/.test(l)).join("\n"), record: p.text.split("\n").find((l) => /السجل التاريخي/.test(l)) });
  }
  const view = await write(ANALYST, `هذي أسهم أمريكية قريبة من إشارة دخول، مع الناقص لكل واحد وأرقامها:\n\n${reads.map((r) => `${r.code} (ناقصه: ${r.why})\n${r.text}`).join("\n\n")}\n\nرتّب الـ ${reads.length} أسهم كلها من الأقوى للأضعف، سطر واحد لكل سهم (${reads.length} أسطر، ولا تترك ولا سهم): ليش، والشي اللي يأكد الدخول (السعر أو السيولة). بالعربي البسيط، بدون مقدمات، ولا تضمن ربح.`, { maxTokens: 8000 }).catch(() => null);
  return [head("tech"), "أقرب الأسهم لإشارة دخول كاملة (الأرقام من مسح السوق):", ...reads.map((r) => `🔸 ${r.code} · ناقصها: ${r.why}\n${r.text}`), view ? `🧠 رأي المحلل:\n${view}` : "", reads.find((r) => r.record)?.record || "", "النسبة جنب كل هدف: كم مرة وصل السعر له تاريخيًا قبل الوقف. تحليل، مو توصية. الإشارة الكاملة توصلك أول ما تتحقق كل الشروط."].filter(Boolean).join("\n\n");
}

// ---------- 📰 محلل النتائج ----------
async function earn(ms = Date.now()) {
  const d = nyDates(ms);
  const rows = (await nasdaqEarnings(d.today).catch(() => [])).filter((r) => r.when !== "pre");
  const mine = new Set(myCodes("us"));
  const pick = rows.filter((r) => r.cap >= 5e9 || mine.has(r.code)).sort((a, b) => mine.has(b.code) - mine.has(a.code) || b.cap - a.cap).slice(0, 10);
  if (!pick.length) return `${head("earn")}\n\nما في شركات كبيرة أعلنت نتائجها الليلة.`;
  const quotes = await nasdaqLiveQuotes(pick.map((r) => r.code), "stocks").catch(() => ({}));
  const out = [];
  for (const r of pick) {
    const close = (await getCandles(`US:${r.code}`, "1D", 3).catch(() => ({ candles: [] }))).candles?.at(-1)?.close;
    const q = quotes[r.code];
    const move = q?.price > 0 && close > 0 ? (q.price / close - 1) * 100 : null;
    const surp = await nasdaqSurprise(r.code).catch(() => []);
    const h = (await newsOf(`US:${r.code}`).catch(() => ({ items: [] }))).items.find((x) => !x.time || x.time >= ms - 12 * 3600e3);
    out.push({ ...r, move, price: q?.price, beat: beatLine(surp), head: h?.title });
  }
  const view = await write(ANALYST, `شركات أمريكية أعلنت نتائجها الليلة، وحركتها بعد الإغلاق وآخر خبر:\n${out.map((r) => `${r.code} ${r.name}: ${r.move == null ? "—" : pct(r.move)} · ${r.beat} · ${r.head || ""}`).join("\n")}\n\nبسطرين: أقوى نتيجة وأضعف نتيجة وليش، بالعربي البسيط، بدون ضمانات.`, { maxTokens: 6000 }).catch(() => null);
  return [
    head("earn"),
    out.map((r) => `${r.move == null ? "⚪" : r.move >= 0 ? "🟢" : "🔴"} ${r.code}${mine.has(r.code) ? " 💼" : ""} · ${r.name.slice(0, 26)}${r.price ? `: ${n2(r.price)}$` : ""}${r.move != null ? ` (${pct(r.move)} بعد الإغلاق)` : ""}${r.beat ? `\n   ${r.beat}` : ""}${r.head ? `\n   📰 ${r.head.slice(0, 90)}` : ""}`).join("\n"),
    view ? `🧠 رأي المحلل:\n${view}` : "",
    "حركة ما بعد الإغلاق بسيولة خفيفة، والاتجاه الحقيقي يبان بكرة بعد الافتتاح.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ---------- 🇰🇼 محلل الكويت ----------
async function kw() {
  const t = await sectors("kw");
  return [head("kw"), sectorsText(t, "kw")].join("\n\n");
}

const myCodes = (market) => [...new Set([...(market === "us" ? usflow.follow() : []), ...trades.list(market).filter((t) => t.mine).map((t) => t.code)])];

export async function run(name, ms = Date.now()) {
  if (name === "risk") return riskText(trades.list());
  if (name === "insiders") return insiders(ms);
  if (name === "tech") return tech();
  if (name === "earn") return earn(ms);
  if (name === "kw") return kw();
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
  if (nyWork && win(nyMin, 16 * 60 + 10) && !sent[`risk|${nyDay}`]) out.push(["risk", nyDay]);
  if (nyWork && win(nyMin, 16 * 60 + 45, 30) && !sent[`earn|${nyDay}`]) out.push(["earn", nyDay]);
  if (kwWork && win(kwMin, 10 * 60 + 30) && !sent[`kw|${kwDay}`]) out.push(["kw", kwDay]);
  return out;
}

let timer = null;
async function tick() {
  for (const [name, day] of due()) {
    if (!st.on[name]) continue;
    st.sent[`${name}|${day}`] = Date.now(); // marked first, so a failing feed doesn't retry every minute
    save();
    const text = await run(name).catch((e) => `${head(name)}\n\nما قدرت أجهز التقرير اليوم: ${e.message}`);
    if (text && kwwatch.settings().telegram) await kwwatch.sendTelegram(text.length > 3900 ? text.slice(0, 3890) + "…" : text, name === "kw" ? "kw" : "us").catch(() => {});
  }
  const old = new Date(Date.now() - 10 * 86400e3).toISOString().slice(0, 10);
  for (const k of Object.keys(st.sent)) if (k.split("|")[1] < old) delete st.sent[k];
}
export function start() {
  clearInterval(timer);
  timer = setInterval(() => tick().catch(() => {}), 60e3);
}
