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
import { getCandles, nasdaqLiveQuotes } from "./providers.js";
import * as store from "./store.js";
import * as trades from "./trades.js";
import * as watchlist from "./watchlist.js";
import { usVolumeShare } from "../public/lib/market-reader.js";

let st = store.read("usflow", { list: { UBER: { levels: [72, 75] } }, sent: {}, below: { "UBER|72": true, "UBER|75": true } });
// followed closely (تابع بشكل خاص): every 2% move up or down from yesterday's close, and their news
st.follow ||= ["UBER", "ORCL"];
const save = () => store.write("usflow", st);
export const list = () => st.list;
export const follow = () => st.follow;
export function setFollow(codes) {
  st.follow = [...new Set(codes.map((c) => String(c).toUpperCase().replace(/[^A-Z.]/g, "")).filter(Boolean))].slice(0, 15);
  for (const c of st.follow) st.list[c] ||= { levels: [] };
  save();
  return st.follow;
}
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
  for (const c of st.follow || []) out[c] ||= { levels: [] };
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
  // what a usual day trades in a stretch of the session: heavy at the open and close, light at
  // midday (the U-shaped day), so the open's busy bars aren't taken for unusual ones
  const median = [...t].sort((a, b) => a.volume - b.volume)[Math.floor(t.length / 2)].volume;
  const usual = (b, bars = 1) => {
    const m = nyMin(b.time) - 570;
    return avgDay > 0 ? avgDay * Math.max(0.004 * bars, usVolumeShare(m + 5 * bars) - usVolumeShare(m)) : median * bars;
  };
  const blocks = t
    .filter((b) => b.volume >= 4 * usual(b) && b.volume * b.close >= 5e6)
    .map((b) => ({ time: b.time, at: kwTime(b.time), volume: b.volume, price: b.close, x: b.volume / usual(b), kind: side(pos(b)) }))
    .filter((b) => b.kind);
  const last3 = t.slice(-3);
  const v3 = last3.reduce((a, b) => a + b.volume, 0);
  const u3 = last3.length === 3 ? usual(last3[0], 3) : 0;
  const surge = last3.length === 3 && v3 >= 3 * u3 ? { x: v3 / u3, kind: side(last3.reduce((a, b) => a + b.volume * pos(b), 0) / v3) || "mixed", at: kwTime(last3[0].time), volume: v3 } : null;
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
  // a followed stock: every 2% from yesterday's close, up or down
  if (cfg.follow && d.prev > 0) {
    const chg = (d.price / d.prev - 1) * 100;
    const step = Math.trunc(chg / 2);
    if (step !== 0 && seen(key(`move${step}`), true)) {
      ev.push(`${step > 0 ? "📈🟢" : "📉🔴"}🇺🇸 ${code}: ${step > 0 ? "طالع" : "نازل"} ${chg > 0 ? "+" : ""}${chg.toFixed(1)}% اليوم\nالسعر ${px(d.price)} (إغلاق أمس ${px(d.prev)}) · الشراء اليوم ${d.buyPct}%${cfg.mine ? `\n${cfg.mine}` : ""}`);
    }
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
    const d = today(b5, avgDay);
    if (d) {
      const prevBar = d1.length && nyDay(d1.at(-1).time) === d.day ? d1.at(-2) : d1.at(-1);
      d.prev = prevBar?.close || 0;
    }
    const followed = (st.follow || []).includes(code);
    const own = trades.list("us").find((t) => t.mine && t.code === code);
    const mine = own && own.qty && d ? `💰 صفقتك: ${own.qty} سهم من ${px(own.entry)} → ${(d.price - own.entry) * own.qty >= 0 ? "+" : ""}${Math.round((d.price - own.entry) * own.qty)}$` : "";
    for (const text of events(code, d, { ...cfg, follow: followed, mine }, st.sent)) {
      await send(text, code).catch(() => {});
      n++;
    }
  }
  const old = new Date(Date.now() - 4 * 86400e3).toISOString().slice(0, 10);
  for (const k of Object.keys(st.sent)) if (k.split("|").at(-1) < old) delete st.sent[k];
  save();
  return { sent: n };
}

// ---------- before the open and after the close ----------
// A followed stock moving in extended hours (results usually come out then): a message at every
// 3% step from yesterday's close (before the open) or today's close (after it), up or down, once
// each, from Nasdaq's live quotes (the last extended-hours trade). session: "pre" or "post".
export function extEvents(code, q, mem, { session, day, step = 3 } = {}) {
  if (!(q?.price > 0) || !Number.isFinite(q.changePct)) return [];
  const k = Math.trunc(q.changePct / step);
  if (k === 0) return [];
  const key = `${code}|ext|${session}|${k}|${day}`;
  if (mem[key]) return [];
  mem[key] = 1;
  const up = k > 0;
  const base = q.price / (1 + q.changePct / 100);
  return [
    `${session === "post" ? "🌙" : "🌅"}${up ? "🟢" : "🔴"}🇺🇸 ${code}: ${up ? "طالع" : "نازل"} ${q.changePct > 0 ? "+" : ""}${q.changePct.toFixed(1)}% ${session === "post" ? "بعد الإغلاق" : "قبل الافتتاح"}\n` +
      `السعر ${px(q.price)} (${session === "post" ? "إغلاق اليوم" : "إغلاق أمس"} ${px(base)})\n` +
      "سيولة التداول الممتد خفيفة، والحركة ممكن تتغير عند الافتتاح.",
  ];
}

export async function extCheck(send, { session, day }) {
  const codes = st.follow || [];
  if (!codes.length) return { sent: 0 };
  const quotes = await nasdaqLiveQuotes(codes, "stocks").catch(() => ({}));
  let n = 0;
  for (const c of codes) {
    // the change from the last regular close (yesterday's before the open, today's after the close):
    // Nasdaq's own change after the close is the regular session's, not the after-hours move
    const last = (await getCandles(`US:${c}`, "1D", 3).catch(() => ({ candles: [] }))).candles?.at(-1)?.close;
    const q = quotes[c]?.price > 0 && last > 0 ? { price: quotes[c].price, changePct: (quotes[c].price / last - 1) * 100 } : null;
    for (const text of extEvents(c, q, st.sent, { session, day })) {
      await send(text, c).catch(() => {});
      n++;
    }
  }
  save();
  return { sent: n };
}
