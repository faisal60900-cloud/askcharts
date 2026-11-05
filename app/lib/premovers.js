// قبل الافتتاح الأمريكي: the biggest pre-market movers among the US stocks the market scan watches
// (price 5$ or more, company 2 billion$ or more, the most traded first), why they move (results
// out, or the latest headline), where your own US stocks stand, and the big companies reporting
// tonight after the close and tomorrow before the open: a stock jumps or drops the moment its
// results come out, so the calendar is the warning that comes before the move. From Nasdaq's live
// quotes (the last pre-market trade and its change from yesterday's close) and its earnings
// calendar. Sent once a day before the opening auction, and on demand ("قبل الافتتاح").
// Pre-market volume is thin and big gaps often fade after the open, so this says where to look at
// the open, not what to buy.
import { nasdaqScreener, nasdaqLiveQuotes, nasdaqEarnings } from "./providers.js";
import { news as newsOf } from "./market-info.js";
import * as trades from "./trades.js";
import * as usflow from "./usflow.js";

const n2 = (v) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
const pct = (v) => `${v > 0 ? "+" : ""}${Number(v).toFixed(1)}%`;
const bn = (v) => (v >= 1e9 ? `${Math.round(v / 1e9)} مليار$` : `${Math.round(v / 1e6)} مليون$`);
const short = (n) =>
  String(n || "")
    .replace(/\s+(Inc\.?|Corp\.?|Corporation|Common Stock|Class [A-Z]|Ordinary Shares|American Depositary|Holdings?|Ltd\.?|Limited|plc|N\.V\.|S\.A\.)\b.*$/i, "")
    .replace(/,$/, "")
    .slice(0, 28);
const kwNow = (ms = Date.now()) => new Date(ms + 3 * 3600e3).toISOString().slice(11, 16);

// New York's date, and the business days around it (weekends skipped; holidays aren't known here)
export function nyDates(ms = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const today = `${p.year}-${p.month}-${p.day}`;
  const step = (d, by) => {
    const t = new Date(`${d}T12:00:00Z`);
    do t.setUTCDate(t.getUTCDate() + by);
    while ([0, 6].includes(t.getUTCDay()));
    return t.toISOString().slice(0, 10);
  };
  return { prev: step(today, -1), today, next: step(today, 1) };
}

// rows: the screener rows ({ ticker, name }); quotes: { TICKER: { price, changePct } };
// mine: your own codes (followed and open positions), always listed when they have a quote.
// earn: { out: Set of codes whose results came out since yesterday's close, tonight: [...],
// tomorrow: [...] } (calendar rows); heads: { TICKER: latest headline } for the big movers.
export function moversText(rows, quotes, mine = [], { at = "", min = 8, up = 8, down = 5, earn = {}, heads = {}, minCap = 2e9 } = {}) {
  const out = earn.out || new Set();
  const list = rows.map((r) => ({ ...r, q: quotes[r.ticker] })).filter((r) => r.q?.price > 0 && Number.isFinite(r.q.changePct));
  const ups = list.filter((r) => r.q.changePct >= min).sort((a, b) => b.q.changePct - a.q.changePct).slice(0, up);
  const downs = list.filter((r) => r.q.changePct <= -min).sort((a, b) => a.q.changePct - b.q.changePct).slice(0, down);
  const why = (c) => (out.has(c) ? "\n   📰 السبب: نتائجه طلعت" : heads[c] ? `\n   📰 ${String(heads[c]).slice(0, 90)}` : "");
  const line = (r) => `${r.q.changePct > 0 ? "⬆️" : "⬇️"} ${r.ticker}: ${n2(r.q.price)}$ (${pct(r.q.changePct)})${r.q.changePct >= 15 ? " ⚠️ قفزة كبيرة" : ""}${r.name ? ` · ${short(r.name)}` : ""}${why(r.ticker)}`;
  const minePct = [...new Set(mine)].map((c) => ({ c, q: quotes[c] })).filter((x) => x.q?.price > 0 && Number.isFinite(x.q.changePct));
  const own = minePct.map((x) => `• ${x.c}: ${n2(x.q.price)}$ (${pct(x.q.changePct)})${out.has(x.c) ? " · 📰 نتائجه طلعت" : ""}`);
  // the calendar: the big companies first, yours always
  const cal = (rowsOf) => {
    const mineSet = new Set(mine);
    const pick = (rowsOf || []).filter((r) => r.cap >= minCap || mineSet.has(r.code)).sort((a, b) => mineSet.has(b.code) - mineSet.has(a.code) || b.cap - a.cap).slice(0, 10);
    return pick.map((r) => `• ${r.code}${mineSet.has(r.code) ? " 💼" : ""} · ${short(r.name)}${r.cap ? ` (${bn(r.cap)})` : ""}`).join("\n");
  };
  const tonight = cal(earn.tonight);
  const tomorrow = cal(earn.tomorrow);
  if (!ups.length && !downs.length && !own.length && !tonight && !tomorrow) return "";
  return [
    `📡🇺🇸 قبل الافتتاح الأمريكي${at ? ` (الساعة ${at} بتوقيت الكويت)` : ""}`,
    ups.length ? `🟢 أكبر الطالعة (${min}% وأكثر):\n${ups.map(line).join("\n")}` : `ما في سهم طالع ${min}% أو أكثر من الأسهم المراقبة.`,
    downs.length ? `🔴 أكبر النازلة:\n${downs.map(line).join("\n")}` : "",
    own.length ? `💼 أسهمك:\n${own.join("\n")}` : "",
    tonight ? `📅 نتائج الليلة بعد الإغلاق (ممكن تقفز أو تطيح بقوة بكرة):\n${tonight}` : "",
    tomorrow ? `📅 نتائج بكرة قبل الافتتاح:\n${tomorrow}` : "",
    "⚠️ سيولة ما قبل الافتتاح خفيفة، والقفزات الكبيرة كثير ترجع بعد الافتتاح. انتظر أول 15–30 دقيقة قبل أي قرار. وموعد النتائج ما يقول الاتجاه: ممكن طلوع وممكن نزول. للمعلومة، مو توصية.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function movers({ size = 1000, ms = Date.now() } = {}) {
  const rows = (await nasdaqScreener("stocks"))
    .filter((r) => r.price >= 5 && r.marketCap >= 2e9 && /^[A-Z]{1,5}$/.test(r.ticker))
    .sort((a, b) => b.price * b.volume - a.price * a.volume)
    .slice(0, size);
  const mine = [...new Set([...usflow.follow(), ...trades.list("us").filter((t) => t.mine).map((t) => t.code)])];
  const codes = [...new Set([...mine, ...rows.map((r) => r.ticker)])];
  // a few hundred at a time, so Nasdaq isn't asked for a thousand quotes at once
  const quotes = {};
  for (let i = 0; i < codes.length; i += 200) Object.assign(quotes, await nasdaqLiveQuotes(codes.slice(i, i + 200), "stocks").catch(() => ({})));
  // the results calendar: yesterday after the close and today before the open explain today's gaps
  const d = nyDates(ms);
  const [prev, today, next] = await Promise.all([d.prev, d.today, d.next].map((x) => nasdaqEarnings(x).catch(() => [])));
  const earn = {
    // a time not given (""): yesterday's counts as after its close, today's as before the open
    out: new Set([...prev.filter((r) => r.when !== "pre").map((r) => r.code), ...today.filter((r) => r.when !== "post").map((r) => r.code)]),
    tonight: today.filter((r) => r.when === "post"),
    tomorrow: next.filter((r) => r.when === "pre"),
  };
  // for the biggest movers without results out, the latest headline
  const big = rows
    .filter((r) => Math.abs(quotes[r.ticker]?.changePct || 0) >= 8 && !earn.out.has(r.ticker))
    .sort((a, b) => Math.abs(quotes[b.ticker].changePct) - Math.abs(quotes[a.ticker].changePct))
    .slice(0, 5);
  // one at a time: the news feeds refuse a burst of requests
  const heads = {};
  for (const r of big) {
    const it = (await newsOf(`US:${r.ticker}`).catch(() => ({ items: [] }))).items.find((h) => !h.time || h.time >= ms - 48 * 3600e3);
    if (it?.title) heads[r.ticker] = it.title;
  }
  return moversText(rows, quotes, mine, { at: kwNow(ms), earn, heads });
}
