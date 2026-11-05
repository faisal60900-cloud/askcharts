// قبل الافتتاح الأمريكي: the biggest pre-market movers among the US stocks the market scan watches
// (price 5$ or more, company 2 billion$ or more, the most traded first), and where your own US
// stocks stand, from Nasdaq's live quotes (the last pre-market trade and its change from
// yesterday's close). Sent once a day before the opening auction, and on demand ("قبل الافتتاح").
// Pre-market volume is thin and big gaps often fade after the open, so this says where to look at
// the open, not what to buy.
import { nasdaqScreener, nasdaqLiveQuotes } from "./providers.js";
import * as trades from "./trades.js";
import * as usflow from "./usflow.js";

const n2 = (v) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
const pct = (v) => `${v > 0 ? "+" : ""}${Number(v).toFixed(1)}%`;
const short = (n) =>
  String(n || "")
    .replace(/\s+(Inc\.?|Corp\.?|Corporation|Common Stock|Class [A-Z]|Ordinary Shares|American Depositary|Holdings?|Ltd\.?|Limited|plc|N\.V\.|S\.A\.)\b.*$/i, "")
    .slice(0, 28);
const kwNow = (ms = Date.now()) => new Date(ms + 3 * 3600e3).toISOString().slice(11, 16);

// rows: the screener rows ({ ticker, name }); quotes: { TICKER: { price, changePct } };
// mine: your own codes (followed and open positions), always listed when they have a quote.
export function moversText(rows, quotes, mine = [], { at = "", min = 8, up = 8, down = 5 } = {}) {
  const list = rows.map((r) => ({ ...r, q: quotes[r.ticker] })).filter((r) => r.q?.price > 0 && Number.isFinite(r.q.changePct));
  const ups = list.filter((r) => r.q.changePct >= min).sort((a, b) => b.q.changePct - a.q.changePct).slice(0, up);
  const downs = list.filter((r) => r.q.changePct <= -min).sort((a, b) => a.q.changePct - b.q.changePct).slice(0, down);
  const line = (r) => `${r.q.changePct > 0 ? "⬆️" : "⬇️"} ${r.ticker}: ${n2(r.q.price)}$ (${pct(r.q.changePct)})${r.q.changePct >= 15 ? " ⚠️ قفزة كبيرة" : ""}${r.name ? ` · ${short(r.name)}` : ""}`;
  const own = [...new Set(mine)].map((c) => ({ c, q: quotes[c] })).filter((x) => x.q?.price > 0 && Number.isFinite(x.q.changePct)).map((x) => `• ${x.c}: ${n2(x.q.price)}$ (${pct(x.q.changePct)})`);
  if (!ups.length && !downs.length && !own.length) return "";
  return [
    `📡🇺🇸 قبل الافتتاح الأمريكي${at ? ` (الساعة ${at} بتوقيت الكويت)` : ""}`,
    ups.length ? `🟢 أكبر الطالعة (${min}% وأكثر):\n${ups.map(line).join("\n")}` : `ما في سهم طالع ${min}% أو أكثر من الأسهم المراقبة.`,
    downs.length ? `🔴 أكبر النازلة:\n${downs.map(line).join("\n")}` : "",
    own.length ? `💼 أسهمك:\n${own.join("\n")}` : "",
    "⚠️ سيولة ما قبل الافتتاح خفيفة، والقفزات الكبيرة كثير ترجع بعد الافتتاح. انتظر أول 15–30 دقيقة قبل أي قرار. للمعلومة، مو توصية.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function movers({ size = 1000 } = {}) {
  const rows = (await nasdaqScreener("stocks"))
    .filter((r) => r.price >= 5 && r.marketCap >= 2e9 && /^[A-Z]{1,5}$/.test(r.ticker))
    .sort((a, b) => b.price * b.volume - a.price * a.volume)
    .slice(0, size);
  const mine = [...new Set([...usflow.follow(), ...trades.list("us").filter((t) => t.mine).map((t) => t.code)])];
  const codes = [...new Set([...mine, ...rows.map((r) => r.ticker)])];
  // a few hundred at a time, so Nasdaq isn't asked for a thousand quotes at once
  const quotes = {};
  for (let i = 0; i < codes.length; i += 200) Object.assign(quotes, await nasdaqLiveQuotes(codes.slice(i, i + 200), "stocks").catch(() => ({})));
  return moversText(rows, quotes, mine, { at: kwNow() });
}
