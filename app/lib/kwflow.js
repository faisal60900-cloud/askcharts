// Buying money into your Kuwaiti stocks (سيولة الشراء): during Boursa Kuwait's session, every few
// minutes, read today's 5-minute bars of each stock on your list and send a Telegram message when
// buying takes over (the day's estimated buying share crosses 60% on real volume), when a big buy
// or sell block prints (a 5-minute bar of 5 times the day's usual and at least 300,000 shares, closing
// near its high or low), and when the price gets back over a level you set. Buying and selling are
// estimated from where each bar closes in its range: the free feeds carry no trade-by-trade data.
import { getCandles } from "./providers.js";
import * as store from "./store.js";

// ALSAFAT closed at 129 on 29 Oct 2026: under all three levels
let st = store.read("kwflow", { list: { ALSAFAT: { levels: [130, 136, 140] } }, sent: {}, below: { "ALSAFAT|130": true, "ALSAFAT|136": true, "ALSAFAT|140": true } });
const save = () => store.write("kwflow", st);
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

const kwDay = (t) => new Date(t * 1000 + 3 * 3600e3).toISOString().slice(0, 10);
const kwTime = (t) => new Date(t * 1000 + 3 * 3600e3).toISOString().slice(11, 16);
const pos = (b) => (b.high > b.low ? (b.close - b.low) / (b.high - b.low) : 0.5);

// Today's picture from the 5-minute bars: volume, estimated buying share, big blocks, last price.
// A block: 5 times a usual 5-minute bar (the usual day's volume over its 44 bars, or today's median
// when that isn't known), and 300,000 shares at least.
export function today(bars5, avgDay = 0) {
  if (!bars5?.length) return null;
  const day = kwDay(bars5.at(-1).time);
  const t = bars5.filter((b) => kwDay(b.time) === day && (b.volume || 0) > 0);
  if (!t.length) return null;
  const vol = t.reduce((a, b) => a + b.volume, 0);
  const buy = t.reduce((a, b) => a + b.volume * pos(b), 0);
  const sorted = t.map((b) => b.volume).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  const blocks = t
    .filter((b) => b.volume >= Math.max(300000, 5 * (avgDay > 0 ? avgDay / 44 : median)))
    .map((b) => ({ time: b.time, at: kwTime(b.time), volume: b.volume, price: b.close, kind: pos(b) >= 0.7 ? "buy" : pos(b) <= 0.3 ? "sell" : null }))
    .filter((b) => b.kind);
  return { day, volume: vol, buyPct: Math.round((buy / vol) * 100), blocks, price: t.at(-1).close, bars: t.length };
}

const big = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)} مليون` : `${Math.round(v / 1000)} ألف`);

// The messages due now for one stock. avgDay: its usual daily volume (20 sessions).
export function events(code, d, avgDay, cfg, mem) {
  const ev = [];
  if (!d) return ev;
  const key = (k) => `${code}|${k}|${d.day}`;
  // buying takes over: 60%+ of the day's volume, with at least a third of a usual day traded
  if (d.buyPct >= 60 && d.volume >= avgDay / 3 && !mem[key("inflow")]) {
    mem[key("inflow")] = 1;
    ev.push(`💧🟢🇰🇼 ${code}: سيولة شراء داخلة\nالشراء ${d.buyPct}% من تداول اليوم (${big(d.volume)} سهم) · السعر ${d.price} فلس\nأول مرة اليوم يصير الشراء هو الغالب بوضوح.`);
  }
  for (const b of d.blocks) {
    const k = key(`block${b.time}`);
    if (mem[k]) continue;
    mem[k] = 1;
    ev.push(b.kind === "buy" ? `🐋🟢🇰🇼 ${code}: صفقة شراء كبيرة\n${big(b.volume)} سهم الساعة ${b.at} على ${b.price} فلس (السعر سكّر قرب أعلى الفترة)` : `🐋🔴🇰🇼 ${code}: صفقة بيع كبيرة\n${big(b.volume)} سهم الساعة ${b.at} على ${b.price} فلس (السعر سكّر قرب أدنى الفترة)`);
  }
  for (const lv of cfg.levels || []) {
    const below = `${code}|${lv}`;
    if (d.price < lv) st.below[below] = true;
    else if (st.below[below] && d.price >= lv && !mem[key(`lv${lv}`)]) {
      mem[key(`lv${lv}`)] = 1;
      delete st.below[below];
      ev.push(`📈🇰🇼 ${code}: رجع فوق ${lv} فلس\nالسعر ${d.price} فلس · الشراء اليوم ${d.buyPct}% · ${big(d.volume)} سهم`);
    }
  }
  return ev;
}

export async function check(send) {
  let n = 0;
  for (const [code, cfg] of Object.entries(st.list)) {
    const sym = `YAHOO:${code}.KW`;
    const [b5, d1] = await Promise.all([getCandles(sym, "5m", 120).then((r) => r.candles || []).catch(() => []), getCandles(sym, "1D", 25).then((r) => r.candles || []).catch(() => [])]);
    const avgDay = d1.slice(-21, -1).reduce((a, b) => a + (b.volume || 0), 0) / Math.max(1, Math.min(20, d1.length - 1));
    for (const text of events(code, today(b5, avgDay), avgDay, cfg, st.sent)) {
      await send(text).catch(() => {});
      n++;
    }
  }
  for (const k of Object.keys(st.sent)) if (k.split("|").at(-1) < new Date(Date.now() - 4 * 86400e3).toISOString().slice(0, 10)) delete st.sent[k];
  save();
  return { sent: n };
}
