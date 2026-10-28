// Buying and selling, estimated (الصفقات الداخلة والخارجة): the lines the bot's answers and the
// buy-signal messages share.
import { getCandles } from "./providers.js";
import { orderFlow, moneyFlow, todayFlow, clean } from "../public/lib/market-reader.js";

const n2 = (v, d = 2) => (v == null || !Number.isFinite(v) ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d }));
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


// For a signal's message: today's and the last 20 sessions' buying and selling, fetched fresh.
export async function flowFor(symbol, market) {
  const get = (tf, n) => getCandles(symbol, tf, n).then((x) => x.candles || []).catch(() => []);
  const [d, m15] = await Promise.all([get("1D", 120), get("15m", 120)]);
  if (d.length < 30) return "";
  const bars = clean(d);
  const f = moneyFlow(bars);
  const tf = todayFlow(m15);
  const today = tf && { ...tf, volume: m15.filter((b) => new Date(b.time * 1000).toISOString().slice(0, 10) === tf.day).reduce((a, b) => a + (b.volume || 0), 0) };
  return flowText(market, {}, { trades: orderFlow(bars), flow: f && { inflowPct: f.inflowPct, outflowPct: 100 - f.inflowPct, net: f.net, improving: f.improving } }, today);
}
