// Saudi market watch (مراقبة السوق السعودي): while Tadawul is open (Sunday to Thursday, 10:00 to
// 15:00 Riyadh time, the same clock as Kuwait), scan every main-market stock every few minutes and
// send each new buy signal to Telegram with its entry, stop, trailing stop and resistances, an
// Arabic analyst note from the person's own AI and the signal's record; follow each signal until it
// ends (lib/trades.js); and after the close send a short summary. Runs on the server.
import { getCandles } from "./providers.js";
import * as store from "./store.js";
import * as alerts from "./alerts.js";
import * as kwwatch from "./kwwatch.js";
import * as trades from "./trades.js";
import { write, ANALYST } from "./ai-write.js";
import { SAUDI_STOCKS } from "../public/lib/saudi-market.js";
import { scanRow, SA_ENTRY_RULES, FILTERS, SA_TRAIL_ATR } from "../public/lib/kuwait-scan.js";
import { equalIndex } from "../public/lib/kuwait-backtest.js";
import { ema } from "../public/lib/indicators.js";

const DEFAULTS = { on: false, every: 5, minValue: 5e6, ai: true, briefs: true };
let cfg = { ...DEFAULTS, ...store.read("sawatch", {}) };
let state = { sent: {}, lastRun: null, lastEntries: [], near: [], lastError: null, closeFor: null, market: null, ...store.read("sawatch-state", {}) };
const saveState = () => store.write("sawatch-state", state);
let timer = null,
  tradesTimer = null,
  busy = false;

// Riyadh is UTC+3 all year, like Kuwait
export function riyadh(d = new Date()) {
  const k = new Date(d.getTime() + 3 * 3600e3);
  const day = k.getUTCDay();
  return { day, min: k.getUTCHours() * 60 + k.getUTCMinutes(), date: k.toISOString().slice(0, 10), weekday: day >= 0 && day <= 4 };
}
// the continuous session and the closing auction (15:00-15:10)
export const sessionOpen = (m = riyadh()) => m.weekday && m.min >= 10 * 60 && m.min <= 15 * 60 + 10;
export const closeWindow = (m = riyadh()) => m.weekday && m.min >= 15 * 60 + 20 && m.min <= 16 * 60;

export const settings = () => ({ ...cfg, telegram: kwwatch.settings().telegram, sessionOpen: sessionOpen(), lastRun: state.lastRun, lastEntries: state.lastEntries, near: state.near, lastError: state.lastError, market: state.market, trades: trades.list("sa"), rules: SA_ENTRY_RULES.map((k) => FILTERS[k].ar) });

export function update(patch = {}) {
  const next = { ...cfg };
  for (const k of ["on", "ai", "briefs"]) if (k in patch) next[k] = !!patch[k];
  if ("every" in patch) next.every = Math.min(60, Math.max(5, Number(patch.every) || 5));
  if ("minValue" in patch) next.minValue = Math.max(0, Number(patch.minValue) || 0);
  cfg = next;
  store.write("sawatch", cfg);
  schedule();
  return settings();
}

async function send(text, symbol = "") {
  const t = text.length > 3900 ? text.slice(0, 3890) + "…" : text;
  await alerts.notify({ symbol, name: "", text: t, notify: { toast: true, sound: true, desktop: true } });
  if (kwwatch.settings().telegram) await kwwatch.sendTelegram(t).catch((e) => (state.lastError = `تيليجرام: ${e.message}`));
}
const ai = (prompt, maxTokens) => (cfg.ai ? write(ANALYST, prompt, { maxTokens }) : Promise.resolve(null));

const n2 = (v, d = 2) => (v == null || !Number.isFinite(v) ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d }));
const pct = (v) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${n2(v, 2)}%`);
const sar = (v) => `${n2(v)} ريال`;
const mil = (v) => (v >= 1e9 ? `${n2(v / 1e9, 2)} مليار` : `${n2(v / 1e6, 1)} مليون`);

// The whole market from the scan itself: an equal-weighted index of all the stocks read, above or
// under its 50-day average, and how many stocks rose today.
export function marketOf(barsList) {
  const idx = equalIndex(barsList);
  if (idx.length < 60) return null;
  const e = ema(idx.map((b) => b.close), 50);
  const last = idx.at(-1),
    prev = idx.at(-2);
  let up = 0,
    down = 0;
  for (const bars of barsList) {
    const [p, l] = [bars.at(-2), bars.at(-1)];
    if (!p || !l) continue;
    if (l.close > p.close) up++;
    else if (l.close < p.close) down++;
  }
  return { up: last.close > e.at(-1), change: ((last.close - prev.close) / prev.close) * 100, rising: up, falling: down };
}

export function track() {
  const live = store.read("sabacktest", null)?.live;
  if (!live?.all?.n) return "";
  const ys = Object.keys(live.byYear || {}).sort();
  const bad = ys.filter((y) => live.byYear[y].avgRet < 0);
  return `📊 السجل التاريخي بهالخطة (${ys[0]}–${ys.at(-1)}): ${live.all.n} إشارة، ${live.all.profitable}% منها انتهت بربح، ومتوسط ${pct(live.all.avgRet)} للصفقة بعد العمولة.${bad.length ? ` كانت سلبية في ${bad.join("، ")}.` : ""}`;
}

export function entryMessage(r, { market = null, note = null } = {}) {
  const p = r.plan;
  const entry = p ? (p.entryZone.from + p.entryZone.to) / 2 : r.price;
  const away = p ? ((r.price - p.entryZone.to) / p.entryZone.to) * 100 : null;
  return [
    `🟢🇸🇦 إشارة شراء — ${r.code} ${r.ar || r.en}${r.sector ? ` (${r.sector})` : ""}`,
    `السعر الآن: ${sar(r.price)} (${pct(r.changePct)} اليوم) · تداول يومي ${mil(r.value)} ريال`,
    `📈 الاختراق: ${sar(r.breakout?.level)} ✓ بسيولة ${n2(r.breakout?.vol, 1)}x · سيولة داخلة ${r.flow?.inflowPct}% · الشراء ${r.buyToday}%`,
    `الاتجاه الأسبوعي ${(r.weekly ?? 0) > 0 ? "صاعد" : "غير صاعد"} · RSI ${n2(r.rsi, 0)} · الإشارات ${r.positives}✓ ${r.negatives}✗`,
    p ? `🎯 الشراء من منطقة: ${sar(p.entryZone.from)} – ${sar(p.entryZone.to)}` : "",
    away != null && away > 3 ? `⚠️ السعر فوق منطقة الشراء بـ ${n2(away, 1)}%: الشراء من هنا مخاطرته أعلى، والأحسن تنتظر رجوع السعر للمنطقة.` : away != null && away <= 0 ? "✅ السعر داخل منطقة الشراء الآن." : "",
    p ? `🛑 وقف الخسارة الأولي: ${sar(p.stop)} (${pct(-((entry - p.stop) / entry) * 100)} من الدخول)` : "",
    r.trail ? `🔒 بعدها وقف متحرك: أعلى سعر بعد الشراء ناقص ${sar(r.trail.dist)} (${SA_TRAIL_ATR} ATR) — هذا الخروج اللي انختبر تاريخيًا` : "",
    p?.targets?.length ? `🧱 مقاومات في الطريق (أهداف للمتابعة): ${p.targets.map((t) => `${sar(t.price)} (${pct(t.pct)})`).join("، ")}` : "",
    market ? (market.up ? "✅ السوق السعودي العام صاعد (فوق متوسط 50)" : "⚠️ السوق السعودي العام تحت متوسط 50") : "",
    note ? `🧠 قراءة المحلل:\n${note}` : "",
    track(),
    "إشارة من قواعد ثابتة، ولا تضمن الربح. لا تخاطر بأكثر من 1-2% من محفظتك في الصفقة.",
  ]
    .filter(Boolean)
    .join("\n");
}

// Follow a signal from now on: its resistances and the trailing stop (lib/trades.js).
export function follow(r) {
  const p = r.plan;
  if (!p) return false;
  const entry = (p.entryZone.from + p.entryZone.to) / 2;
  if (!(p.stop < entry)) return false;
  const targets = (p.targets || []).map((t) => t.price).filter((v) => v > entry);
  return trades.open(trades.newTrade({ market: "sa", code: r.code, symbol: r.symbol, name: r.ar || r.en, entry, stop: p.stop, targets, trailDist: r.trail?.dist ?? null, price: r.price, bar: r.bar }));
}
export const checkTrades = () => trades.check("sa", (t) => getCandles(t.symbol, "1D", 3).then((r) => trades.fromBar(t, (r.candles || []).at(-1))), (text, t) => send(text, t.symbol));

function missing(r) {
  const m = [];
  if (r.breakout?.dir !== "up") m.push("ما فيه اختراق");
  else if (!r.breakout.confirmed) m.push("الاختراق بدون سيولة كافية");
  for (const k of SA_ENTRY_RULES) if (k !== "breakout" && !FILTERS[k].test(r)) m.push(FILTERS[k].ar);
  return [...new Set(m)].join("، ");
}

export async function runOnce({ force = false } = {}) {
  if (busy) return { busy: true };
  busy = true;
  try {
    const rows = [],
      all = [];
    let i = 0,
      limited = false;
    const worker = async () => {
      while (!limited && i < SAUDI_STOCKS.length) {
        const s = SAUDI_STOCKS[i++];
        try {
          const r = await getCandles(s.symbol, "1D", 300);
          const bars = r.candles || [];
          if (bars.length > 60) all.push(bars);
          rows.push({ ...scanRow(s, bars, Date.now(), { market: "sa" }), bar: bars.at(-1) });
        } catch (e) {
          if (/rate limit/i.test(e.message)) limited = true;
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    const ok = rows.filter((r) => !r.error);
    const market = marketOf(all);
    state.market = market;
    const entries = ok.filter((r) => r.entry && (r.value ?? 0) >= cfg.minValue);
    const date = riyadh().date;
    const fresh = entries.filter((r) => force || !state.sent[`${r.code}|${r.breakout?.level}|${date}`]);
    for (const r of fresh) {
      state.sent[`${r.code}|${r.breakout?.level}|${date}`] = Date.now();
      const note = await ai(
        `حلل إشارة الشراء هذي في سهم سعودي في 4 إلى 6 أسطر: قوة الاختراق والسيولة، وضع السوق السعودي العام، أي المقاومات تبدو واقعية، المخاطر (المسافة للوقف)، ومتى تعتبر الفكرة فاشلة.\n\n${entryMessage(r, { market })}`,
        2500,
      );
      await send(entryMessage(r, { market, note }), r.symbol);
      follow(r);
    }
    for (const [k, at] of Object.entries(state.sent)) if (Date.now() - at > 5 * 86400e3) delete state.sent[k];
    state.lastRun = new Date().toISOString();
    state.lastEntries = entries.map((r) => r.code);
    state.near = ok
      .filter((r) => !r.entry && (r.value ?? 0) >= cfg.minValue)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((r) => ({ code: r.code, ar: r.ar, price: r.price, why: missing(r) }));
    state.lastError = limited ? "مصدر البيانات حدّ الطلبات، اكتمل جزء من المسح" : ok.length ? null : "ما وصلت بيانات";
    saveState();
    return { scanned: ok.length, entries: entries.length, sent: fresh.length, limited };
  } finally {
    busy = false;
  }
}

// After the close: the market, today's signals, the open trades and the nearest stocks.
export async function closeBrief() {
  const m = state.market;
  const open = trades.summary("sa");
  const facts = [
    m ? `السوق السعودي (مؤشر متساوي الأوزان من الأسهم): ${pct(m.change)} اليوم · ${m.up ? "فوق" : "تحت"} متوسط 50 · ${m.rising} سهم صاعد مقابل ${m.falling} هابط` : "",
    state.lastEntries.length ? `إشارات الشراء اليوم: ${state.lastEntries.join("، ")}` : "لا توجد إشارات شراء اليوم.",
    state.near.length ? `أقرب الأسهم للإشارة:\n${state.near.map((r) => `${r.code} ${r.ar} ${sar(r.price)}: ينقصه ${r.why}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const note = await ai(`اكتب ملخص إغلاق السوق السعودي في 4 إلى 7 أسطر من هذي المعطيات فقط: أداء السوق واتساعه، إشارات اليوم، أقرب الأسهم وما ينقصها، وما يستحق المراقبة بكرة.\n\n${facts}`, 2500);
  await send(["🌙🇸🇦 إغلاق السوق السعودي", facts, open ? `📂 الصفقات المفتوحة:\n${open}` : "", note ? `🧠 قراءة المحلل:\n${note}` : ""].filter(Boolean).join("\n\n"));
  state.closeFor = riyadh().date;
  saveState();
  return { ok: true, ai: !!note };
}

async function tick() {
  if (!cfg.on) return;
  const m = riyadh();
  try {
    if (sessionOpen(m)) await runOnce();
    else if (closeWindow(m) && state.closeFor !== m.date) {
      state.closeFor = m.date;
      await runOnce();
      if (cfg.briefs) await closeBrief();
    }
  } catch (e) {
    state.lastError = e.message;
    saveState();
  }
}
function schedule() {
  clearInterval(timer);
  clearInterval(tradesTimer);
  if (!cfg.on) return;
  let last = 0;
  // every minute, a scan when its time has come
  timer = setInterval(() => {
    const m = riyadh();
    const wait = sessionOpen(m) ? cfg.every * 60e3 : 60e3;
    if (Date.now() - last >= wait) {
      last = Date.now();
      tick();
    }
  }, 60e3);
  // the open trades, every 3 minutes in the session and the hour after it
  tradesTimer = setInterval(() => {
    const m = riyadh();
    if ((sessionOpen(m) || closeWindow(m)) && trades.list("sa").length) checkTrades().catch(() => {});
  }, 3 * 60e3);
  timer.unref?.();
  tradesTimer.unref?.();
}
export const start = () => schedule();
export const stop = () => {
  clearInterval(timer);
  clearInterval(tradesTimer);
};
