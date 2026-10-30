// Leading stocks that fell hard (قائمة الارتداد): a message when one starts to turn up, and one when
// it breaks to a new low, so a fall isn't bought while it's still falling. Read from the daily bars
// during the New York session, from 10:00 (the first half hour is too noisy), each at most once a
// day per kind.
import { getCandles } from "./providers.js";
import * as store from "./store.js";

export const DEFAULT = ["GOOGL", "NFLX", "META", "INTC", "NOW", "AMZN", "AVGO", "ORCL", "MSFT"];
let st = store.read("watchlist", { codes: DEFAULT, sent: {} });
const save = () => store.write("watchlist", st);
export const codes = () => st.codes;
export function set(list) {
  st.codes = [...new Set(list.map((c) => String(c).toUpperCase().replace(/[^A-Z.]/g, "")).filter(Boolean))].slice(0, 40);
  save();
  return st.codes;
}

const rsi14 = (closes) => {
  const d = closes.slice(-15).map((v, k, a) => (k ? v - a[k - 1] : 0)).slice(1);
  const up = d.filter((x) => x > 0).reduce((a, v) => a + v, 0) / 14,
    dn = -d.filter((x) => x < 0).reduce((a, v) => a + v, 0) / 14;
  return dn ? 100 - 100 / (1 + up / dn) : 100;
};

// What today's bar says: "turn" — up 1.5% or more, over yesterday's high, closing in the top 40% of
// its range, after an oversold reading (RSI under 40) in the last five days; "break" — under the
// lowest low of the 20 sessions before. bars: daily, today's last.
export function evaluate(bars) {
  if (!bars || bars.length < 40) return null;
  const t = bars.at(-1),
    y = bars.at(-2);
  const closes = bars.map((b) => b.close);
  const minRsi = Math.min(...[0, 1, 2, 3, 4].map((k) => rsi14(closes.slice(0, closes.length - k))));
  const change = ((t.close - y.close) / y.close) * 100;
  const pos = t.high > t.low ? (t.close - t.low) / (t.high - t.low) : 0.5;
  const low20 = Math.min(...bars.slice(-21, -1).map((b) => b.low));
  const high = Math.max(...bars.slice(-260).map((b) => b.high));
  const base = { price: t.close, change, fromHigh: ((t.close - high) / high) * 100, rsi: rsi14(closes), dayHigh: t.high, yHigh: y.high, low20 };
  if (change >= 1.5 && t.close > y.high && pos >= 0.6 && minRsi < 40) return { kind: "turn", ...base };
  if (t.close < low20) return { kind: "break", ...base };
  return null;
}

const n2 = (v, d = 2) => Number(v).toLocaleString("en-US", { maximumFractionDigits: d });
const pct = (v) => `${v > 0 ? "+" : ""}${n2(v, 1)}%`;
export function message(code, e, company = "") {
  const co = company ? `🏢 الشركة: ${company}` : "";
  if (e.kind === "turn")
    return [
      `🟢🇺🇸 ${code} بدأ يرتد`,
      co,
      `السعر ${n2(e.price)}$ (${pct(e.change)} اليوم) · فوق أعلى سعر أمس ${n2(e.yHigh)}$`,
      `نازل ${pct(e.fromHigh)} من أعلى سعر في سنة · RSI ${n2(e.rsi, 0)} (كان في تشبع بيعي قبل أيام)`,
      `🛑 لو رجع نزل تحت ${n2(e.low20)}$ (أدنى سعر في 20 يوم) تكون المحاولة فشلت.`,
      "أول علامة ارتداد، مو تأكيد. الأحوط تدخل على دفعات وبكمية صغيرة.",
    ]
      .filter(Boolean)
      .join("\n");
  return [
    `🔴🇺🇸 ${code} كسر قاعه`,
    co,
    `السعر ${n2(e.price)}$ (${pct(e.change)} اليوم) تحت أدنى سعر في 20 يوم (${n2(e.low20)}$)`,
    `نازل ${pct(e.fromHigh)} من أعلى سعر في سنة · RSI ${n2(e.rsi, 0)}`,
    "النزول مستمر: لا تستعجل الشراء.",
  ]
    .filter(Boolean)
    .join("\n");
}

// One look at every stock in the list; send(text, code) delivers.
export async function check(send, date, companyOf = async () => "") {
  let n = 0;
  for (const code of st.codes) {
    const bars = await getCandles(`US:${code}`, "1D", 300).then((r) => r.candles || []).catch(() => []);
    const e = evaluate(bars);
    if (!e) continue;
    const k = `${code}|${e.kind}|${date}`;
    if (st.sent[k]) continue;
    st.sent[k] = Date.now();
    await send(message(code, e, await companyOf(code).catch(() => "")), code).catch(() => {});
    n++;
  }
  for (const [k, at] of Object.entries(st.sent)) if (Date.now() - at > 5 * 86400e3) delete st.sent[k];
  save();
  return { sent: n };
}
