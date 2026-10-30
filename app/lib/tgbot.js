// Ask the bot about a stock (اسأل البوت عن سهم): send the Telegram bot a stock's code or Arabic name
// from anywhere (KFH, بيتك, 2222, إعمار, SPCX) and it answers with the Market Reader's reading: the
// trend on each timeframe, money flow, support and resistance, the buy zone, stop and targets, and
// whether the buy signal is there or what it still lacks, with a short note from the analyst. Only
// your own chats get an answer (lib/kwwatch.js).
import { getCandles } from "./providers.js";
import * as kwwatch from "./kwwatch.js";
import { write, ANALYST } from "./ai-write.js";
import { GULF, normAr } from "./gulf.js";
import { KUWAIT_STOCKS } from "../public/lib/kuwait-market.js";
import { SAUDI_STOCKS } from "../public/lib/saudi-market.js";
import { UAE_STOCKS } from "../public/lib/uae-market.js";
import { scanRow, FILTERS, entryRules } from "../public/lib/kuwait-scan.js";
import { readMarket, todayFlow } from "../public/lib/market-reader.js";
import { flowText } from "./flow.js";
import * as trades from "./trades.js";
import * as store from "./store.js";
import { about, aboutLine } from "./about.js";
export { flowText };

const LISTS = [
  ["kw", KUWAIT_STOCKS],
  ["sa", SAUDI_STOCKS],
  ["ae", UAE_STOCKS],
];
const FLAG = { kw: "🇰🇼", us: "🇺🇸", sa: "🇸🇦", ae: "🇦🇪" };
const key = (s) => normAr(s).replace(/^ال/, "");

// short names people use for a stock whose listed name is longer or shared
const ALIAS = { [key("إعمار")]: "EMAAR", [key("اجيليتي")]: "MKHZN", [key("أجيليتي")]: "MKHZN", [key("ديوا")]: "DEWA", [key("الإمارات دبي")]: "EMIRATESNBD" };

// What was typed, as { market, stock }, or null. Codes first (a Kuwaiti, Saudi or Dubai code, then a
// US ticker), then Arabic names: the Kuwaiti nicknames (بيتك) and every list's Arabic names.
export function findStock(text) {
  let t = String(text || "").trim().replace(/^[\/$#]/, "");
  if (!t || t.length > 40) return null;
  const us = /^(us|usa|امريكا|أمريكا)\s+/i.test(t);
  if (us) t = t.replace(/^\S+\s+/, "");
  if (/[؀-ۿ]/.test(t)) {
    const k = key(t);
    if (k.length < 2) return null;
    const g = GULF.find((x) => x.ar.some((n) => key(n) === k));
    if (g) {
      const code = g.t.split(".")[0];
      for (const [m, list] of LISTS) {
        const s = list.find((x) => x.code === code && x.symbol.endsWith(g.t.slice(code.length)));
        if (s) return { market: m, stock: s };
      }
    }
    if (ALIAS[k]) return findStock(ALIAS[k]);
    for (const [m, list] of LISTS) {
      const s = list.find((x) => x.ar && key(x.ar) === k);
      if (s) return { market: m, stock: s };
    }
    // a part of a name: the names starting with it first, then the shortest
    const near = LISTS.flatMap(([m, list]) => list.filter((x) => x.ar && key(x.ar).includes(k)).map((s) => ({ market: m, stock: s, n: key(s.ar) })));
    near.sort((a, b) => (b.n.startsWith(k) ? 1 : 0) - (a.n.startsWith(k) ? 1 : 0) || a.n.length - b.n.length);
    return near.length ? { market: near[0].market, stock: near[0].stock } : null;
  }
  const code = t.toUpperCase().replace(/\s+/g, "").replace(/\.(KW|SR|AE)$/, "");
  if (!us)
    for (const [m, list] of LISTS) {
      const s = list.find((x) => x.code === code);
      if (s) return { market: m, stock: s };
    }
  if (/^[A-Z]{1,5}(\.[A-Z])?$/.test(code)) return { market: "us", stock: { code, symbol: `US:${code}`, en: code, ar: null } };
  return null;
}

const n2 = (v, d = 2) => (v == null || !Number.isFinite(v) ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d }));
const pct = (v) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${n2(v, 1)}%`);
const moneyOf = (m) => (v) => (m === "us" ? `${n2(v)}$` : m === "kw" ? `${n2(v)} فلس` : m === "sa" ? `${n2(v)} ريال` : `${n2(v)} درهم`);

export function readingText({ market, stock }, row, r, note = null, today = null, company = "") {
  const $ = moneyOf(market);
  const p = row.plan;
  const lacks = entryRules(market).filter((k) => !FILTERS[k].test(row)).map((k) => FILTERS[k].ar);
  const b = row.breakout;
  const frames = (r?.frames || []).filter((f) => f.trend).map((f) => `${f.ar} ${f.trend.ar}`);
  return [
    `📊${FLAG[market]} ${stock.code}${stock.ar ? ` — ${stock.ar}` : stock.en && stock.en !== stock.code ? ` — ${stock.en}` : ""}`,
    aboutLine(company),
    `السعر: ${$(row.price)} (${pct(row.changePct)} اليوم)${row.early ? " · الجلسة بدأت للتو، القراءة على آخر جلسة مكتملة" : ""}`,
    r?.overall ? `📈 الاتجاه العام: ${r.overall.ar}${r.state?.ar ? ` · ${r.state.ar}` : ""}` : "",
    frames.length ? `الأطر: ${frames.join(" · ")}` : "",
    `RSI ${n2(row.rsi, 0)} · الإشارات ${row.positives}✓ ${row.negatives}✗ (${row.signalAr || "—"})`,
    `💧 السيولة: ${row.relVol == null ? "—" : `${n2(row.relVol, 1)}x من المعتاد`} · داخلة ${row.flow?.inflowPct ?? "—"}%${row.flow?.improving ? " ↑" : ""} · الشراء اليوم ${row.buyToday ?? "—"}%`,
    b?.dir === "up" ? (b.confirmed ? `🚀 اختراق مؤكد ${$(b.level)} ✓ بسيولة ${n2(b.vol, 1)}x` : `↗️ فوق ${$(b.level)} بس بدون سيولة كافية (اختراق غير مؤكد)`) : b?.dir === "near" ? `👀 قريب من الاختراق: ${$(b.level)}` : b?.dir === "down" ? `🔻 كسر دعم ${$(b.level)}` : "",
    flowText(market, row, r, today),
    r?.demandZone ? `🟩 الدعم: ${$(r.demandZone.from)} – ${$(r.demandZone.to)}` : "",
    r?.supplyZone ? `🟥 المقاومة: ${$(r.supplyZone.from)} – ${$(r.supplyZone.to)}` : "",
    p ? `🎯 منطقة الشراء: ${$(p.entryZone.from)} – ${$(p.entryZone.to)} · 🛑 الوقف: ${$(p.stop)}` : "",
    p?.targets?.length ? `الأهداف: ${p.targets.map((t) => `${$(t.price)} (${pct(t.pct)})`).join("، ")}` : "",
    row.entry ? "🟢 فيه إشارة شراء حسب شروط البوت الحين." : `⚪ ما فيه إشارة شراء الحين. ينقصه: ${lacks.join("، ") || "—"}`,
    note ? `🧠 المحلل:\n${note}` : "",
    "قراءة فنية للمعلومة، وليست توصية.",
  ]
    .filter(Boolean)
    .join("\n");
}

const HELP = "اكتب لي رمز السهم أو اسمه، وأرد عليك بتحليله:\n🇰🇼 KFH أو بيتك · NBK أو الوطني\n🇸🇦 2222 أو أرامكو · 1120 أو الراجحي\n🇦🇪 EMAAR أو إعمار\n🇺🇸 SPCX · NVDA · AAPL\n(لسهم أمريكي رمزه يشبه سهم خليجي اكتب: us STC)";

// The reading without the analyst's note, for a stock found from what was typed (or null).
async function plainReading(found) {
  const { market, stock } = found;
  const get = (tf, n) => getCandles(stock.symbol, tf, n).then((x) => x.candles || []).catch(() => []);
  const [d, w, h4, h1, m15] = await Promise.all([get("1D", 300), get("1W", 200), get("4h", 300), get("1h", 300), get("15m", 300)]);
  if (d.length < 60) return null;
  const row = scanRow(stock, d, Date.now(), { market });
  if (row.error) return null;
  const r = readMarket({ "1D": d, "1W": w, "4h": h4, "1h": h1, "15m": m15 }, { main: "1D", symbol: stock.symbol });
  const tf = todayFlow(m15);
  const today = tf && { ...tf, volume: m15.filter((b) => new Date(b.time * 1000).toISOString().slice(0, 10) === tf.day).reduce((a, b) => a + (b.volume || 0), 0) };
  return readingText(found, row, r.error ? null : r, null, today, await about(stock, market).catch(() => "")).replace(/\nقراءة فنية للمعلومة، وليست توصية\.$/, "");
}

// ---------- talking with the analyst ----------
// Anything that isn't just a stock's name goes to the analyst, with the last turns of the talk, your
// own positions, and the reading of any stock the message names (so it reasons on real numbers).
const CHAT_SYSTEM = `أنت محلل أسهم خبير (فني وأساسي) تتكلم مع متداول كويتي اسمه فيصل على تيليجرام، كأنك صديقه المحلل.
- اكتب بالعربي الخليجي البسيط، جمل قصيرة وواضحة، بدون Markdown ولا نجوم.
- ناقشه بصدق: قول له رأيك بالتحليل والمخاطر والسيناريوهات، ولا تجامله إذا فكرته فيها خطر.
- استخدم الأرقام المعطاة لك بس. ما عندك أسعار أو أخبار إلا اللي تحت؛ إذا سأل عن شي ما عندك معلومته، قول له بصراحة إنك ما تعرفه الحين أو اطلب منه يكتب رمز السهم.
- لا تقول "اشترِ" أو "بِع" كأمر؛ اعرض الخيارات وإيجابيات وسلبيات كل واحد، والقرار له. وذكّره بحجم المخاطرة والوقف لما يكون مناسب.
- الرد مختصر (لين 10 أسطر) إلا إذا طلب تفصيل.`;
const chats = new Map(); // chat id → [{ role, text }]
const tokensOf = (text) => [...new Set(String(text).split(/[\s،,.؟?!:()"«»]+/).filter((w) => w.length >= 2))];
function exactArabic(cand) {
  const bare = cand.replace(/^(و|ف)?(ب|ل|ك)?(?=ال|[\u0600-\u06ff]{3})/, "");
  for (const c of [...new Set([cand, bare, bare.replace(/^ال/, "")])]) {
    const k = key(c);
    if (k.length < 3) continue;
    if (ALIAS[k]) return findStock(ALIAS[k]);
    const g = GULF.find((x) => x.ar.some((n) => key(n) === k));
    if (g) return findStock(g.ar[0]);
    for (const [m, list] of LISTS) {
      const s = list.find((x) => x.ar && key(x.ar) === k);
      if (s) return { market: m, stock: s };
    }
  }
  return null;
}
export function stocksIn(text) {
  const seen = new Map();
  const words = tokensOf(text);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    // codes in capitals (NVDA, KFH), Saudi numbers, Arabic names of one or two words
    if (/^[A-Z]{2,6}$/.test(w) || /^\d{4}$/.test(w)) {
      const f = findStock(w);
      if (f && !seen.has(f.stock.code)) seen.set(f.stock.code, f);
      continue;
    }
    if (!/[\u0600-\u06ff]/.test(w)) continue;
    // Arabic: a whole name only (one or two words), with و/ب/ل/ف in front taken off
    for (const cand of [words[i + 1] ? `${w} ${words[i + 1]}` : null, w]) {
      if (!cand) continue;
      const f = exactArabic(cand);
      if (f && !seen.has(f.stock.code)) {
        seen.set(f.stock.code, f);
        if (cand.includes(" ")) i++;
        break;
      }
    }
  }
  return [...seen.values()].slice(0, 3);
}
export async function chat(text, chatId = "me", { positions = [] } = {}) {
  const hist = chats.get(chatId) || [];
  const found = stocksIn(text);
  const readings = (await Promise.all(found.map((f) => plainReading(f).catch(() => null)))).filter(Boolean);
  const pos = positions.length ? `صفقات فيصل المفتوحة:\n${positions.map((t) => `${t.code}: ${t.qty ? `${t.qty} سهم ` : ""}بتكلفة ${t.entry}، الوقف ${t.stop}، آخر سعر ${t.last}`).join("\n")}` : "";
  const prompt = [
    hist.length ? `المحادثة قبل:\n${hist.map((h) => `${h.role === "me" ? "فيصل" : "أنت"}: ${h.text}`).join("\n")}` : "",
    pos,
    readings.length ? `بيانات الأسهم المذكورة (الحين):\n${readings.join("\n\n")}` : "",
    `رسالة فيصل الحين: ${text}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const reply = await write(CHAT_SYSTEM, prompt, { maxTokens: 3000 }).catch(() => null);
  if (!reply) return "المحلل ما رد الحين (تأكد من مفتاح Claude في الإعدادات). تقدر تكتب رمز سهم وأعطيك قراءته.";
  hist.push({ role: "me", text: String(text).slice(0, 600) }, { role: "ai", text: reply.slice(0, 1200) });
  chats.set(chatId, hist.slice(-12));
  return reply;
}

// talking with the analyst is off unless turned on (data/tgbot.json { "chat": true })
export const chatOn = () => !!store.read("tgbot", { chat: false }).chat;
export const setChat = (on) => (store.write("tgbot", { chat: !!on }), !!on);
export async function answer(text, chatId = "me") {
  const t = String(text).trim();
  if (/^\/?(start|help|مساعدة|\?|؟)$/i.test(t)) return HELP;
  if (/^\/?(new|جديد)$/i.test(t)) {
    chats.delete(chatId);
    return "بدينا محادثة جديدة 👍";
  }
  // just a stock's name or code (a word or two): its reading; anything else: a talk with the analyst
  const words = t.split(/\s+/).length;
  const arabic = /[\u0600-\u06ff]/.test(t);
  const found = words > 3 ? null : !arabic ? findStock(t) : exactArabic(t) || (words === 1 ? findStock(t) : null);
  if (!found) return chatOn() ? chat(t, chatId, { positions: trades.list().filter((x) => x.mine) }) : `ما عرفت السهم «${t.slice(0, 30)}».\n\n${HELP}`;
  const { market, stock } = found;
  const get = (tf, n) => getCandles(stock.symbol, tf, n).then((x) => x.candles || []).catch(() => []);
  const [d, w, h4, h1, m15] = await Promise.all([get("1D", 300), get("1W", 200), get("4h", 300), get("1h", 300), get("15m", 300)]);
  if (d.length < 60) return `ما لقيت بيانات كافية لـ ${stock.code}. تأكد من الرمز.\n\n${HELP}`;
  const row = scanRow(stock, d, Date.now(), { market });
  if (row.error) return `${stock.code}: ${row.error}`;
  const r = readMarket({ "1D": d, "1W": w, "4h": h4, "1h": h1, "15m": m15 }, { main: "1D", symbol: stock.symbol });
  // today's buying and selling from the 15-minute bars, with the shares traded
  const tf = todayFlow(m15);
  const today = tf && { ...tf, volume: m15.filter((b) => new Date(b.time * 1000).toISOString().slice(0, 10) === tf.day).reduce((a, b) => a + (b.volume || 0), 0) };
  const company = await about(stock, market).catch(() => "");
  const base = readingText(found, row, r.error ? null : r, null, today, company);
  const note = await write(ANALYST, `اكتب قراءة من 3 إلى 5 أسطر لهذا السهم من هذي الأرقام فقط: الاتجاه، السيولة، أقرب دعم ومقاومة، وش اللي يغير الصورة. بدون كلمة "اشترِ" أو "بِع"، وبدون عبارة "ليست توصية" (مكتوبة تحت).\n\n${base}`, { maxTokens: 1500 }).catch(() => null);
  return note ? readingText(found, row, r.error ? null : r, note, today, company) : base;
}

export const start = () => kwwatch.onText(answer);
