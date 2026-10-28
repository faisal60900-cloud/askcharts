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

// big numbers short: 1.2 مليون, 350 ألف
const big = (v) => (v == null || !Number.isFinite(v) ? "—" : Math.abs(v) >= 1e9 ? `${n2(v / 1e9, 2)} مليار` : Math.abs(v) >= 1e6 ? `${n2(v / 1e6, 2)} مليون` : Math.abs(v) >= 1e3 ? `${n2(v / 1e3, 1)} ألف` : n2(v, 0));
const CUR = { kw: "د.ك", us: "$", sa: "ريال", ae: "درهم" };
// Buying and selling, estimated from where each bar closed in its range on its volume (the free
// feeds carry no trade-by-trade data): today from the 15-minute bars, the last 20 sessions, the
// money in and out, and the big days (twice the usual volume) with which side they leaned to.
export function flowText(market, row, r, today) {
  const t = r?.trades;
  if (!t && !today) return "";
  const money = (v) => `${big(market === "kw" ? v / 1000 : v)} ${CUR[market]}`;
  const lines = ["🔄 الصفقات الداخلة والخارجة (تقدير من الحجم وحركة السعر):"];
  if (today?.volume) {
    const buyQ = (today.volume * today.buyPct) / 100,
      sellQ = today.volume - buyQ;
    lines.push(`📅 اليوم: كمية الشراء ${big(buyQ)} سهم (${today.buyPct}%) · كمية البيع ${big(sellQ)} سهم (${100 - today.buyPct}%)`);
    lines.push(`   قيمة الشراء ${money(today.buyValue)} · قيمة البيع ${money(today.sellValue)} · الصافي ${today.buyValue >= today.sellValue ? "🟢 +" : "🔴 −"}${money(Math.abs(today.buyValue - today.sellValue))}`);
  }
  if (t?.period) {
    lines.push(`🗓 آخر ${t.period.bars} جلسة: الشراء ${t.period.buyPct}% · قيمة الشراء ${money(t.period.buyValue)} مقابل البيع ${money(t.period.sellValue)}`);
  }
  if (r?.flow) lines.push(`💰 السيولة الداخلة ${r.flow.inflowPct}% والخارجة ${r.flow.outflowPct}% · الصافي ${r.flow.net >= 0 ? "🟢 +" : "🔴 −"}${money(Math.abs(r.flow.net))}${r.flow.improving ? " (يتحسن)" : ""}`);
  const bigDays = (t?.big || []).slice(-4).reverse();
  if (bigDays.length)
    lines.push(`🐋 صفقات كبيرة (حجم 2x فأكثر):\n${bigDays.map((b) => `   ${b.kind === "buy" ? "🟢 شراء قوي" : "🔴 بيع قوي"} ${new Date(b.time * 1000).toISOString().slice(5, 10)} · ${n2(b.rel, 1)}x من المعتاد`).join("\n")}`);
  return lines.join("\n");
}

export function readingText({ market, stock }, row, r, note = null, today = null) {
  const $ = moneyOf(market);
  const p = row.plan;
  const lacks = entryRules(market).filter((k) => !FILTERS[k].test(row)).map((k) => FILTERS[k].ar);
  const b = row.breakout;
  const frames = (r?.frames || []).filter((f) => f.trend).map((f) => `${f.ar} ${f.trend.ar}`);
  return [
    `📊${FLAG[market]} ${stock.code}${stock.ar ? ` — ${stock.ar}` : stock.en && stock.en !== stock.code ? ` — ${stock.en}` : ""}`,
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

export async function answer(text) {
  if (/^\/?(start|help|مساعدة|\?|؟)$/i.test(String(text).trim())) return HELP;
  const found = findStock(text);
  if (!found) return `ما عرفت السهم «${String(text).slice(0, 30)}».\n\n${HELP}`;
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
  const base = readingText(found, row, r.error ? null : r, null, today);
  const note = await write(ANALYST, `اكتب قراءة من 3 إلى 5 أسطر لهذا السهم من هذي الأرقام فقط: الاتجاه، السيولة، أقرب دعم ومقاومة، وش اللي يغير الصورة. بدون كلمة "اشترِ" أو "بِع"، وبدون عبارة "ليست توصية" (مكتوبة تحت).\n\n${base}`, { maxTokens: 1500 }).catch(() => null);
  return note ? readingText(found, row, r.error ? null : r, note, today) : base;
}

export const start = () => kwwatch.onText(answer);
