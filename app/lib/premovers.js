// قبل الافتتاح الأمريكي: the biggest pre-market movers among the US stocks the market scan watches
// (price 5$ or more, company 2 billion$ or more, the most traded first), why they move (results
// out, or the latest headline), where your own US stocks stand, and the big companies reporting
// tonight after the close and tomorrow before the open: a stock jumps or drops the moment its
// results come out, so the calendar is the warning that comes before the move. From Nasdaq's live
// quotes (the last pre-market trade and its change from yesterday's close) and its earnings
// calendar. Sent once a day before the opening auction, and on demand ("قبل الافتتاح").
// Pre-market volume is thin and big gaps often fade after the open, so this says where to look at
// the open, not what to buy.
import { nasdaqScreener, nasdaqLiveQuotes, nasdaqEarnings, nasdaqSurprise } from "./providers.js";
import { news as newsOf } from "./market-info.js";
import * as trades from "./trades.js";
import * as usflow from "./usflow.js";
import * as store from "./store.js";

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
// The last two reported quarters against the forecast, newest first: ⭐ when both beat it.
export function beatLine(rows) {
  const two = (rows || []).filter((r) => Number.isFinite(r.surprise)).slice(0, 2);
  if (!two.length) return "";
  const one = (r) => (Math.round(r.surprise) === 0 ? "⚪ طابقت" : `${r.surprise > 0 ? "✅ +" : "❌ "}${Math.round(r.surprise)}%`);
  return `${two.length === 2 && two.every((r) => Math.round(r.surprise) > 0) ? "⭐ " : ""}آخر ربعين: ${two.map(one).join(" · ")}`;
}

export const isStar = (rows) => beatLine(rows).startsWith("⭐");
export const TARGETS = [5, 10, 15];

export function moversText(rows, quotes, mine = [], { at = "", min = 8, up = 8, down = 5, earn = {}, heads = {}, minCap = 2e9, surp = {}, follow = [] } = {}) {
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
    const px = (c) => (quotes[c]?.price > 0 ? ` · ${n2(quotes[c].price)}$${Number.isFinite(quotes[c].changePct) ? ` (${pct(quotes[c].changePct)})` : ""}` : "");
    return pick.map((r) => `• ${r.code}${mineSet.has(r.code) ? " 💼" : ""} · ${short(r.name)}${r.cap ? ` (${bn(r.cap)})` : ""}${px(r.code)}${beatLine(surp[r.code]) ? `\n   ${beatLine(surp[r.code])}` : ""}`).join("\n");
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
    follow.length ? `🎯 بتابع لك ⭐ بعد نتائجها، وأنبهك لو طلعت ${TARGETS.map((t) => `+${t}%`).join(" و")} من إغلاق ما قبل النتائج: ${follow.join("، ")}` : "",
    tonight || tomorrow ? "⭐ = فاقت توقعات الربح آخر ربعين. ✅ فوق التوقعات · ❌ تحت · ⚪ طابقت. هذا تاريخ الشركة، مو ضمان: أوبر مثلًا فاقت التوقعات أغلب المرات ونزل سهمها يوم النتائج 7 مرات من 8." : "",
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
  // the last two quarters of the big companies reporting tonight and tomorrow (one at a time)
  const mineSet = new Set(mine);
  // the same ten a list as the message shows
  const top = (list) => list.filter((r) => r.cap >= 2e9 || mineSet.has(r.code)).sort((a, b) => mineSet.has(b.code) - mineSet.has(a.code) || b.cap - a.cap).slice(0, 10);
  const soon = [...top(earn.tonight), ...top(earn.tomorrow)];
  const surp = {};
  for (const r of soon) surp[r.code] = await nasdaqSurprise(r.code).catch(() => []);
  // their prices too (a company in the calendar may be outside the scanned list)
  const missing = soon.map((r) => r.code).filter((c) => !quotes[c]);
  if (missing.length) Object.assign(quotes, await nasdaqLiveQuotes(missing, "stocks").catch(() => ({})));
  // the ⭐ ones (beat the forecast both last quarters) are followed after their results
  const follow = soon.filter((r) => isStar(surp[r.code])).map((r) => r.code);
  watchAdd(follow.map((c) => ({ code: c, name: short(soon.find((r) => r.code === c)?.name) })), d.next);
  return moversText(rows, quotes, mine, { at: kwNow(ms), earn, heads, surp, follow });
}

// ---------- after the results: the ⭐ companies' targets ----------
// Watched from the day their results move the stock (the next business day) for three business
// days. The base is the last close before the results (that day's price over its change); a
// message the first time the price is 5%, 10% and 15% above it.
let wst = store.read("premovers", { watch: {} });
const wsave = () => store.write("premovers", wst);
const after = (date, n) => {
  let d = date;
  for (let i = 0; i < n; i++) d = nyDates(Date.parse(`${d}T16:00:00Z`)).next;
  return d;
};
export function watchAdd(list, from, watch = wst.watch) {
  for (const { code, name } of list) if (!watch[code] || watch[code].until < from) watch[code] = { name: name || "", from, until: after(from, 2), base: null, hit: 0 };
  if (watch === wst.watch) wsave();
  return watch;
}
export const watching = () => wst.watch;

// The messages due now; watch is changed in place (bases set, targets marked, old ones dropped).
export function targetEvents(watch, quotes, today) {
  const ev = [];
  for (const [code, w] of Object.entries(watch)) {
    if (today > w.until) {
      delete watch[code];
      continue;
    }
    const q = quotes[code];
    if (today < w.from || !(q?.price > 0)) continue;
    if (!w.base && Number.isFinite(q.changePct)) w.base = +(q.price / (1 + q.changePct / 100)).toFixed(4);
    if (!w.base) continue;
    const up = (q.price / w.base - 1) * 100;
    let reached = 0;
    TARGETS.forEach((t, i) => up >= t && (reached = i + 1));
    if (reached > w.hit) {
      w.hit = reached;
      const next = TARGETS[reached];
      ev.push(
        `🎯🟢🇺🇸 ${code}${w.name ? ` (${w.name})` : ""}: ${reached === TARGETS.length ? "حقق كل الأهداف 🎉" : `حقق الهدف ${reached}`} بعد النتائج (+${TARGETS[reached - 1]}%)\n` +
          `السعر ${n2(q.price)}$ · إغلاق قبل النتائج ${n2(w.base)}$ · من النتائج ${pct(up)}` +
          (next ? `\nالهدف الجاي: ${n2(w.base * (1 + next / 100))}$ (+${next}%)` : "") +
          "\n⭐ فاقت التوقعات آخر ربعين. للمعلومة، مو توصية.",
      );
    }
  }
  return ev;
}

export async function checkTargets(send, ms = Date.now()) {
  const today = nyDates(ms).today;
  const codes = Object.entries(wst.watch).filter(([, w]) => today >= w.from).map(([c]) => c);
  const quotes = codes.length ? await nasdaqLiveQuotes(codes, "stocks").catch(() => ({})) : {};
  const ev = targetEvents(wst.watch, quotes, today);
  wsave();
  for (const text of ev) await send(text).catch(() => {});
  return { sent: ev.length, watching: Object.keys(wst.watch).length };
}
