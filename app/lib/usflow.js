// سيولة غير عادية في أسهمك الأمريكية: during the New York session, every 3 minutes, read today's
// 5-minute bars of your US stocks (the list here, your own open positions, and the fallen-leaders
// watchlist) and send a Telegram message when:
//  🐋 a big block prints: one 5-minute bar of 4 times a usual one and $5M at least, closing near
//     its high (buying) or its low (selling);
//  ⚡ money rushes in: the last 15 minutes traded 3 times the usual, with its direction;
//  💧 buying takes over: 60% or more of the day's money is buying, with a normal day's volume or
//     more for this time of the session;
//  📈 the price gets back over a level you set.
// Each once a day, and only when a second look a few minutes on shows the same thing (a wrong bar
// from the feed is corrected before it is sent). Buying and selling are estimated from where each
// bar closes in its range: the free feeds carry no trade-by-trade data.
import { getCandles } from "./providers.js";
import * as store from "./store.js";
import * as trades from "./trades.js";
import * as watchlist from "./watchlist.js";
import { usVolumeShare } from "../public/lib/market-reader.js";

let st = store.read("usflow", { list: { UBER: { levels: [72, 75] } }, sent: {}, below: { "UBER|72": true, "UBER|75": true } });
const save = () => store.write("usflow", st);
export const list = () => st.list;
export function setStock(code, { levels = [] } = {}) {
  st.list[String(code).toUpperCase()] = { levels: levels.map(Number).filter((v) => v > 0).sort((a, b) => a - b) };
  save();
  return st.list;
}
export function removeStock(code) {
  delete st.list[String(code).toUpperCase()];
  save();
  return st.list;
}
// every stock watched: the list, your own open positions, the fallen leaders
export function watched() {
  const out = { ...Object.fromEntries(watchlist.codes().map((c) => [c, { levels: [] }])) };
  for (const t of trades.list("us")) if (t.mine) out[t.code] = { levels: [] };
  return { ...out, ...st.list };
}

const NY = "America/New_York";
const nyParts = (ms) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: NY, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
const nyDay = (t) => {
  const p = nyParts(t * 1000);
  return `${p.year}-${p.month}-${p.day}`;
};
const nyMin = (t) => {
  const p = nyParts(t * 1000);
  return Number(p.hour) * 60 + Number(p.minute);
};
const kwTime = (t) => new Date(t * 1000 + 3 * 3600e3).toISOString().slice(11, 16);
const pos = (b) => (b.high > b.low ? (b.close - b.low) / (b.high - b.low) : 0.5);
const side = (p) => (p >= 0.7 ? "buy" : p <= 0.3 ? "sell" : null);

// Today's regular-session picture from the 5-minute bars. avgDay: the usual daily volume (shares).
export function today(bars5, avgDay = 0) {
  if (!bars5?.length) return null;
  const day = nyDay(bars5.at(-1).time);
  const t = bars5.filter((b) => nyDay(b.time) === day && (b.volume || 0) > 0 && nyMin(b.time) >= 570 && nyMin(b.time) < 960);
  if (!t.length) return null;
  const vol = t.reduce((a, b) => a + b.volume, 0);
  const buy = t.reduce((a, b) => a + b.volume * pos(b), 0);
  const usualBar = avgDay > 0 ? avgDay / 78 : [...t].sort((a, b) => a.volume - b.volume)[Math.floor(t.length / 2)].volume;
  const blocks = t
    .filter((b) => b.volume >= 4 * usualBar && b.volume * b.close >= 5e6)
    .map((b) => ({ time: b.time, at: kwTime(b.time), volume: b.volume, price: b.close, x: b.volume / usualBar, kind: side(pos(b)) }))
    .filter((b) => b.kind);
  const last3 = t.slice(-3);
  const v3 = last3.reduce((a, b) => a + b.volume, 0);
  const surge = last3.length === 3 && v3 >= 3 * 3 * usualBar ? { x: v3 / (3 * usualBar), kind: side(last3.reduce((a, b) => a + b.volume * pos(b), 0) / v3) || "mixed", at: kwTime(last3[0].time), volume: v3 } : null;
  const minNow = nyMin(t.at(-1).time) + 5 - 570;
  return { day, volume: vol, buyPct: Math.round((buy / vol) * 100), blocks, surge, price: t.at(-1).close, rel: avgDay > 0 ? vol / (avgDay * usVolumeShare(minNow)) : null };
}

const big = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)} مليون` : `${Math.round(v / 1000)} ألف`);
const usd = (v) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)} مليار$` : `${(v / 1e6).toFixed(1)} مليون$`);
const px = (v) => `${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}$`;

// The messages due now for one stock (each once a day, on a second look).
export function events(code, d, cfg, mem, below = st.below) {
  const ev = [];
  if (!d) return ev;
  const key = (k) => `${code}|${k}|${d.day}`;
  const seen = (k, ok) => {
    const p = `pend|${k}`;
    if (!ok) {
      delete mem[p];
      return false;
    }
    if (mem[k]) return false;
    if (!mem[p]) {
      mem[p] = 1;
      return false;
    }
    delete mem[p];
    mem[k] = 1;
    return true;
  };
  if (seen(key("inflow"), d.buyPct >= 60 && (d.rel ?? 0) >= 1)) {
    ev.push(`💧🟢🇺🇸 ${code}: سيولة شراء داخلة\nالشراء ${d.buyPct}% من تداول اليوم (${big(d.volume)} سهم، ${d.rel?.toFixed(1)}x المعتاد بهالوقت) · السعر ${px(d.price)}`);
  }
  const now = new Set(d.blocks.map((b) => key(`block${b.time}|${b.kind}`)));
  for (const k of Object.keys(mem)) if (k.startsWith(`pend|${code}|block`) && k.endsWith(d.day) && !now.has(k.slice(5))) delete mem[k];
  for (const b of d.blocks) {
    if (!seen(key(`block${b.time}|${b.kind}`), true)) continue;
    ev.push(`🐋${b.kind === "buy" ? "🟢" : "🔴"}🇺🇸 ${code}: صفقة ${b.kind === "buy" ? "شراء" : "بيع"} كبيرة\n${big(b.volume)} سهم (≈ ${usd(b.volume * b.price)}) الساعة ${b.at} بتوقيت الكويت على ${px(b.price)}\n${b.x.toFixed(1)} ضعف الكمية المعتادة في 5 دقايق، والسعر سكّر قرب ${b.kind === "buy" ? "أعلى" : "أدنى"} الفترة`);
  }
  if (d.surge && seen(key(`surge|${d.surge.kind}`), true)) {
    const k = d.surge.kind;
    ev.push(`⚡${k === "buy" ? "🟢" : k === "sell" ? "🔴" : "⚪"}🇺🇸 ${code}: سيولة مفاجئة\nآخر 15 دقيقة (من ${d.surge.at}) انتداول ${big(d.surge.volume)} سهم، ${d.surge.x.toFixed(1)} ضعف المعتاد\nالاتجاه: ${k === "buy" ? "شراء" : k === "sell" ? "بيع" : "مختلط"} · السعر ${px(d.price)}`);
  }
  for (const lv of cfg.levels || []) {
    const b = `${code}|${lv}`;
    if (d.price < lv) below[b] = true;
    else if (seen(key(`lv${lv}`), below[b] && d.price >= lv)) {
      delete below[b];
      ev.push(`📈🇺🇸 ${code}: رجع فوق ${px(lv)}\nالسعر ${px(d.price)} · الشراء اليوم ${d.buyPct}%`);
    }
  }
  return ev;
}

export async function check(send) {
  let n = 0;
  for (const [code, cfg] of Object.entries(watched())) {
    const sym = `US:${code}`;
    const [b5, d1] = await Promise.all([getCandles(sym, "5m", 120).then((r) => r.candles || []).catch(() => []), getCandles(sym, "1D", 25).then((r) => r.candles || []).catch(() => [])]);
    const avgDay = d1.slice(-21, -1).reduce((a, b) => a + (b.volume || 0), 0) / Math.max(1, Math.min(20, d1.length - 1));
    for (const text of events(code, today(b5, avgDay), cfg, st.sent)) {
      await send(text, code).catch(() => {});
      n++;
    }
  }
  const old = new Date(Date.now() - 4 * 86400e3).toISOString().slice(0, 10);
  for (const k of Object.keys(st.sent)) if (k.split("|").at(-1) < old) delete st.sent[k];
  save();
  return { sent: n };
}
