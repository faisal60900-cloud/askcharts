// 🎓 How the team learns: every pick is scored on what the price did after it, and the odds of each
// kind of setup are kept, so the next picks lean on the kinds that worked and skip the ones that
// didn't. No AI and no tokens: arithmetic on daily bars.
//
// A pick "wins" when its first target comes before its stop within 5 trading days, "loses" when the
// stop comes first (both in one bar counts as a loss, to be safe), and is "flat" when neither came.
// A pick whose entry never triggered isn't counted. The kind of a setup is its buckets: RSI, the
// volume against its average, where the bar closed in its range, the day's change, the trend (over
// the 50 and 200 day averages) and the last 5 days' move.
import * as store from "./store.js";

const KEY = "learn";
let st = store.read(KEY, { live: {}, back: {}, backAt: null, days: {} });
const save = () => store.write(KEY, st);
export const reset = (s = { live: {}, back: {}, backAt: null, days: {} }) => (st = s);
export const state = () => st;

const dayOf = (b) => new Date(b.time * 1000).toISOString().slice(0, 10);
const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
export function rsi(cl, n = 14) {
  if (cl.length <= n) return 50;
  let g = 0, l = 0;
  for (let i = cl.length - n; i < cl.length; i++) {
    const d = cl[i] - cl[i - 1];
    if (d > 0) g += d;
    else l -= d;
  }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

// the setup at bar i (its close), from bars[0..i]
export function features(b, i) {
  if (!b || i < 60 || i >= b.length) return null;
  const t = b[i], p = b[i - 1];
  const cl = b.slice(0, i + 1).map((x) => x.close);
  const ma = (n) => avg(cl.slice(-n));
  const vol = avg(b.slice(Math.max(0, i - 20), i).map((x) => x.volume));
  return {
    rsi: Math.round(rsi(cl)),
    rel: vol > 0 ? +(t.volume / vol).toFixed(2) : 1,
    pos: t.high > t.low ? Math.round(((t.close - t.low) / (t.high - t.low)) * 100) : 50,
    chg: +((t.close / p.close - 1) * 100).toFixed(2),
    d5: +((t.close / b[i - 5].close - 1) * 100).toFixed(2),
    up50: t.close > ma(50),
    up200: cl.length >= 200 ? t.close > ma(200) : null,
  };
}

// the buckets a setup falls in
export function buckets(f) {
  if (!f) return [];
  const cut = (v, edges, names) => names[edges.findIndex((e) => v < e) === -1 ? names.length - 1 : edges.findIndex((e) => v < e)];
  return [
    `rsi:${cut(f.rsi, [35, 50, 60, 70], ["<35", "35-50", "50-60", "60-70", "70+"])}`,
    `vol:${cut(f.rel, [1, 1.5, 2.5], ["<1", "1-1.5", "1.5-2.5", "2.5+"])}`,
    `close:${cut(f.pos, [40, 70], ["low", "mid", "high"])}`,
    `day:${cut(f.chg, [-3, 0, 3, 6], ["<-3", "-3-0", "0-3", "3-6", "6+"])}`,
    `trend:${f.up50 && f.up200 ? "up" : !f.up50 && f.up200 === false ? "down" : "mixed"}`,
    `5d:${cut(f.d5, [-5, 0, 5, 10], ["<-5", "-5-0", "0-5", "5-10", "10+"])}`,
  ];
}

// What the price did from bar `from` on (up to `days` bars): "win" (first target before the stop),
// "loss" (stop first, or both in one bar), "flat" (neither), "none" (the entry never triggered),
// "open" (not enough bars yet, still running). entry: a price to reach, or a zone [lo, hi], or
// null (bought at the open of `from`).
export function outcome(b, from, { entry = null, lo = null, hi = null, stop, t1, days = 5 }) {
  if (!(stop > 0) || !(t1 > 0) || from >= b.length) return { res: from >= b.length ? "open" : "none" };
  let inAt = entry == null && lo == null ? from : -1;
  const end = Math.min(b.length - 1, from + days - 1);
  for (let j = from; j <= end; j++) {
    const x = b[j];
    if (inAt < 0) {
      const hit = lo != null ? x.low <= hi && x.high >= lo : x.high >= entry;
      if (!hit) continue;
      inAt = j;
    }
    if (x.low <= stop) return { res: "loss", at: j };
    if (x.high >= t1) return { res: "win", at: j };
  }
  if (inAt < 0) return { res: end - from + 1 >= days ? "none" : "open" };
  return { res: end - from + 1 >= days ? "flat" : "open" };
}

const add = (tbl, keys, res) => {
  for (const k of ["all", ...keys]) {
    const r = (tbl[k] ||= { w: 0, l: 0, f: 0 });
    if (res === "win") r.w++;
    else if (res === "loss") r.l++;
    else if (res === "flat") r.f++;
  }
};
const n = (r) => (r ? r.w + r.l + r.f : 0);
const rate = (r) => (n(r) ? r.w / n(r) : null);

// The odds of a setup for an agent: each of its buckets with 15 or more past cases, weighted by
// how many; the history (back) and the live record together. { rate, n } or null when unknown.
export function odds(agent, f, s = st) {
  const tbls = [s.back[agent], s.live[agent]].filter(Boolean);
  if (!tbls.length || !f) return null;
  const merged = (k) => tbls.reduce((m, t) => (t[k] ? { w: m.w + t[k].w, l: m.l + t[k].l, f: m.f + t[k].f } : m), { w: 0, l: 0, f: 0 });
  let sw = 0, sn = 0;
  for (const k of buckets(f)) {
    const r = merged(k);
    if (n(r) >= 15) {
      sw += rate(r) * n(r);
      sn += n(r);
    }
  }
  const all = merged("all");
  if (!sn) return n(all) >= 15 ? { rate: rate(all), n: n(all) } : null;
  return { rate: sw / sn, n: n(all) };
}

// Learn the momentum setup from history: every day in the bars where the setup (isSetup(b, i))
// showed, bought over that day's high the next days, first target 1R. Replaces the old history.
export function backfill(agent, series, isSetup, { days = 5, at = new Date().toISOString().slice(0, 10) } = {}) {
  const tbl = {};
  let cases = 0;
  for (const b of series) {
    for (let i = 200; i < b.length - 1; i++) {
      const s = isSetup(b, i);
      if (!s) continue;
      const o = outcome(b, i + 1, { entry: s.entry, stop: s.stop, t1: s.t1, days });
      if (o.res === "open" || o.res === "none") continue;
      add(tbl, buckets(features(b, i)), o.res);
      cases++;
    }
  }
  st.back[agent] = tbl;
  st.backAt = at;
  save();
  return { cases, rate: rate(tbl.all) };
}

// Score the picks: each one's result from its day on (a pick made after the close counts from the
// next day), its setup from the close before. Resolved ones go into the live record once.
// bars: { CODE: [...] }. Returns the rows for the day's report.
export function score(picks, bars, { today, days = 5 } = {}) {
  const rows = [];
  for (const p of picks) {
    const b = bars[p.code];
    if (!b?.length || !(p.stop > 0) || !(p.t1 > 0)) continue;
    const from = b.findIndex((x) => (p.post ? dayOf(x) > p.day : dayOf(x) >= p.day));
    if (from < 0) {
      rows.push({ ...p, res: "open" });
      continue;
    }
    const o = outcome(b, from, { entry: p.entry ?? null, lo: p.entry ? null : p.lo ?? null, hi: p.entry ? null : p.hi ?? null, stop: p.stop, t1: p.t1, days });
    const last = b.at(-1).close;
    const base = p.entry || (p.lo && p.hi ? (p.lo + p.hi) / 2 : p.price);
    const row = { ...p, res: o.res, at: o.at != null ? dayOf(b[o.at]) : null, now: last, move: base > 0 ? ((last / base - 1) * 100) : null };
    rows.push(row);
    const key = `${p.agent}|${p.code}|${p.day}`;
    if (["win", "loss", "flat"].includes(o.res) && !st.days[key]) {
      st.days[key] = o.res;
      add((st.live[p.agent] ||= {}), buckets(features(b, from - 1)), o.res);
    }
  }
  // the record of resolved picks: 120 days
  const old = new Date(Date.parse(`${today || new Date().toISOString().slice(0, 10)}T00:00:00Z`) - 120 * 86400e3).toISOString().slice(0, 10);
  for (const k of Object.keys(st.days)) if (k.split("|")[2] < old) delete st.days[k];
  save();
  return rows;
}

// the live record of an agent: wins, losses, flat, rate
export function record(agent, s = st) {
  const r = s.live[agent]?.all;
  return r ? { ...r, n: n(r), rate: rate(r) } : { w: 0, l: 0, f: 0, n: 0, rate: null };
}
export const backRecord = (agent, s = st) => {
  const r = s.back[agent]?.all;
  return r ? { ...r, n: n(r), rate: rate(r) } : null;
};

// ---------- what each analyst learned, in words ----------
const LABEL = {
  rsi: { "<35": "RSI تحت 35 (تشبع بيع)", "35-50": "RSI بين 35 و50", "50-60": "RSI بين 50 و60", "60-70": "RSI بين 60 و70", "70+": "RSI فوق 70 (تشبع شراء)" },
  vol: { "<1": "سيولة أقل من المعدل", "1-1.5": "سيولة عادية", "1.5-2.5": "سيولة 1.5–2.5 ضعف", "2.5+": "سيولة أكثر من 2.5 ضعف" },
  close: { low: "إغلاق قرب قاع اليوم", mid: "إغلاق نص النطاق", high: "إغلاق قرب قمة اليوم" },
  day: { "<-3": "يوم نازل أكثر من 3%", "-3-0": "يوم نازل شوي", "0-3": "يوم طالع لين 3%", "3-6": "يوم طالع 3–6%", "6+": "يوم طالع أكثر من 6%" },
  trend: { up: "اتجاه صاعد (فوق متوسط 50 و200)", down: "اتجاه هابط (تحت المتوسطين)", mixed: "اتجاه مختلط" },
  "5d": { "<-5": "نازل أكثر من 5% بأسبوع", "-5-0": "نازل شوي بأسبوع", "0-5": "طالع لين 5% بأسبوع", "5-10": "طالع 5–10% بأسبوع", "10+": "طالع أكثر من 10% بأسبوع" },
};
export const labelOf = (k) => {
  const [g, v] = k.split(":");
  return LABEL[g]?.[v] || k;
};
// The agent's whole record (history and live) and its best and worst kinds: each with 15 or more cases.
export function lessons(agent, s = st, { min = 15, top = 3 } = {}) {
  const tbls = [s.back[agent], s.live[agent]].filter(Boolean);
  if (!tbls.length) return null;
  const keys = new Set(tbls.flatMap((t) => Object.keys(t)));
  const merged = (k) => tbls.reduce((m, t) => (t[k] ? { w: m.w + t[k].w, l: m.l + t[k].l, f: m.f + t[k].f } : m), { w: 0, l: 0, f: 0 });
  const all = merged("all");
  const rows = [...keys].filter((k) => k !== "all").map((k) => ({ k, r: merged(k) })).filter((x) => n(x.r) >= min).map((x) => ({ k: x.k, label: labelOf(x.k), rate: rate(x.r), n: n(x.r) }));
  rows.sort((a, b) => b.rate - a.rate);
  return { rate: rate(all), n: n(all), best: rows.slice(0, top), worst: rows.slice(-top).reverse().filter((x) => !rows.slice(0, top).includes(x)) };
}
