// Gulf market watch, one per market (Saudi: lib/sawatch.js, Dubai: lib/aewatch.js): while the market
// is open, scan every listed stock every few minutes and send each new buy signal to Telegram with
// its entry, stop, trailing stop and resistances, an Arabic analyst note from the person's own AI
// and the signal's record; follow each signal until it ends (lib/trades.js); after the close send a
// short summary; and once a day say when the whole market crosses its 200-day average. Runs on the
// server.
import { getCandles } from "./providers.js";
import * as store from "./store.js";
import * as alerts from "./alerts.js";
import * as kwwatch from "./kwwatch.js";
import * as trades from "./trades.js";
import { flowFor } from "./flow.js";
import * as prealert from "./prealert.js";
import { addFlow } from "./uswatch.js";
import { write, ANALYST } from "./ai-write.js";
import { scanRow, FILTERS, entryRules, TRAILS } from "../public/lib/kuwait-scan.js";
import { equalIndex } from "../public/lib/kuwait-backtest.js";
import { ema } from "../public/lib/indicators.js";

const n2 = (v, d = 2) => (v == null || !Number.isFinite(v) ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d }));
const pct = (v) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${n2(v, 2)}%`);
const mil = (v) => (v >= 1e9 ? `${n2(v / 1e9, 2)} مليار` : `${n2(v / 1e6, 1)} مليون`);

// The whole market from the scan itself: an equal-weighted index of all the stocks read, above or
// under its 50 and 200-day averages, and how many stocks rose today.
export function marketOf(barsList) {
  const idx = equalIndex(barsList);
  if (idx.length < 60) return null;
  const closes = idx.map((b) => b.close);
  const e = ema(closes, 50);
  const sma200 = closes.length >= 200 ? closes.slice(-200).reduce((a, v) => a + v, 0) / 200 : null;
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
  return { up: last.close > e.at(-1), up200: sma200 ? last.close > sma200 : null, from200: sma200 ? ((last.close - sma200) / sma200) * 100 : null, change: ((last.close - prev.close) / prev.close) * 100, rising: up, falling: down };
}

// M: { market, list, flag, title ("السوق السعودي"), cur ("ريال"), utc (hours), days ([0..4]),
//      open, end, closeFrom, closeTo (minutes of the local day), minValue, regimeUp, regimeDown }
export function createWatch(M) {
const RULES = entryRules(M.market),
  TRAIL = TRAILS[M.market] || 2.5;
const DEFAULTS = { on: false, every: 5, minValue: M.minValue, ai: true, briefs: true, regime: true, prealerts: true };
let cfg = { ...DEFAULTS, ...store.read(`${M.market}watch`, {}) };
let state = { sent: {}, lastRun: null, lastEntries: [], near: [], lastError: null, closeFor: null, market: null, regimeFor: null, regimeUp: null, ...store.read(`${M.market}watch-state`, {}) };
const saveState = () => store.write(`${M.market}watch-state`, state);
let timer = null,
  tradesTimer = null,
  busy = false;

// the market's local time (no summer time in the Gulf)
function clock(d = new Date()) {
  const k = new Date(d.getTime() + M.utc * 3600e3);
  const day = k.getUTCDay();
  return { day, min: k.getUTCHours() * 60 + k.getUTCMinutes(), date: k.toISOString().slice(0, 10), weekday: M.days.includes(day) };
}
// the continuous session and the closing auction, then the hour after it
const sessionOpen = (m = clock()) => m.weekday && m.min >= M.open && m.min <= M.end;
const closeWindow = (m = clock()) => m.weekday && m.min >= M.closeFrom && m.min <= M.closeTo;

const settings = () => ({ ...cfg, telegram: kwwatch.settings().telegram, sessionOpen: sessionOpen(), lastRun: state.lastRun, lastEntries: state.lastEntries, near: state.near, lastError: state.lastError, market: state.market, trades: trades.list(M.market), rules: RULES.map((k) => FILTERS[k].ar) });

function update(patch = {}) {
  const next = { ...cfg };
  for (const k of ["on", "ai", "briefs", "regime", "prealerts"]) if (k in patch) next[k] = !!patch[k];
  if ("every" in patch) next.every = Math.min(60, Math.max(5, Number(patch.every) || 5));
  if ("minValue" in patch) next.minValue = Math.max(0, Number(patch.minValue) || 0);
  cfg = next;
  store.write(`${M.market}watch`, cfg);
  schedule();
  return settings();
}

async function send(text, symbol = "") {
  const t = text.length > 3900 ? text.slice(0, 3890) + "…" : text;
  await alerts.notify({ symbol, name: "", text: t, notify: { toast: true, sound: true, desktop: true } });
  if (kwwatch.settings().telegram) await kwwatch.sendTelegram(t, M.market).catch((e) => (state.lastError = `تيليجرام: ${e.message}`));
}
const ai = (prompt, maxTokens) => (cfg.ai ? write(ANALYST, prompt, { maxTokens }) : Promise.resolve(null));

const sar = (v) => `${n2(v)} ${M.cur}`;

function track() {
  const live = store.read(`${M.market}backtest`, null)?.live;
  if (!live?.all?.n) return "";
  const ys = Object.keys(live.byYear || {}).sort();
  const bad = ys.filter((y) => live.byYear[y].avgRet < 0);
  return `📊 السجل التاريخي بهالخطة (${ys[0]}–${ys.at(-1)}): ${live.all.n} إشارة، ${live.all.profitable}% منها انتهت بربح، ومتوسط ${pct(live.all.avgRet)} للصفقة بعد العمولة.${bad.length ? ` كانت سلبية في ${bad.join("، ")}.` : ""}`;
}

function entryMessage(r, { market = null, note = null } = {}) {
  const p = r.plan;
  const entry = p ? (p.entryZone.from + p.entryZone.to) / 2 : r.price;
  const away = p ? ((r.price - p.entryZone.to) / p.entryZone.to) * 100 : null;
  return [
    `🟢${M.flag} إشارة شراء — ${r.code} ${r.ar || r.en}${r.sector ? ` (${r.sector})` : ""}`,
    `السعر الآن: ${sar(r.price)} (${pct(r.changePct)} اليوم) · تداول يومي ${mil(r.value)} ${M.cur}`,
    `📈 الاختراق: ${sar(r.breakout?.level)} ✓ بسيولة ${n2(r.breakout?.vol, 1)}x · سيولة داخلة ${r.flow?.inflowPct}% · الشراء ${r.buyToday}%`,
    `الاتجاه الأسبوعي ${(r.weekly ?? 0) > 0 ? "صاعد" : "غير صاعد"} · RSI ${n2(r.rsi, 0)} · الإشارات ${r.positives}✓ ${r.negatives}✗`,
    p ? `🎯 الشراء من منطقة: ${sar(p.entryZone.from)} – ${sar(p.entryZone.to)}` : "",
    away != null && away > 3 ? `⚠️ السعر فوق منطقة الشراء بـ ${n2(away, 1)}%: الشراء من هنا مخاطرته أعلى، والأحسن تنتظر رجوع السعر للمنطقة.` : away != null && away <= 0 ? "✅ السعر داخل منطقة الشراء الآن." : "",
    p ? `🛑 وقف الخسارة الأولي: ${sar(p.stop)} (${pct(-((entry - p.stop) / entry) * 100)} من الدخول)` : "",
    r.trail ? `🔒 بعدها وقف متحرك: أعلى سعر بعد الشراء ناقص ${sar(r.trail.dist)} (${TRAIL} ATR) — هذا الخروج اللي انختبر تاريخيًا` : "",
    p?.targets?.length ? `🧱 مقاومات في الطريق (أهداف للمتابعة): ${p.targets.map((t) => `${sar(t.price)} (${pct(t.pct)})`).join("، ")}` : "",
    market ? (market.up ? `✅ ${M.title} العام صاعد (فوق متوسط 50)` : `⚠️ ${M.title} العام تحت متوسط 50`) : "",
    note ? `🧠 قراءة المحلل:\n${note}` : "",
    track(),
    "إشارة من قواعد ثابتة، ولا تضمن الربح. لا تخاطر بأكثر من 1-2% من محفظتك في الصفقة.",
  ]
    .filter(Boolean)
    .join("\n");
}

// Follow a signal from now on: its resistances and the trailing stop (lib/trades.js).
function follow(r) {
  const p = r.plan;
  if (!p) return false;
  const entry = (p.entryZone.from + p.entryZone.to) / 2;
  if (!(p.stop < entry)) return false;
  const targets = (p.targets || []).map((t) => t.price).filter((v) => v > entry);
  return trades.open(trades.newTrade({ market: M.market, code: r.code, symbol: r.symbol, name: r.ar || r.en, entry, stop: p.stop, targets, trailDist: r.trail?.dist ?? null, price: r.price, bar: r.bar }));
}
const checkTrades = () => trades.check(M.market, (t) => getCandles(t.symbol, "1D", 3).then((r) => trades.fromBar(t, (r.candles || []).at(-1))), (text, t) => send(text, t.symbol));

function missing(r) {
  const m = [];
  if (r.breakout?.dir !== "up") m.push("ما فيه اختراق");
  else if (!r.breakout.confirmed) m.push("الاختراق بدون سيولة كافية");
  for (const k of RULES) if (k !== "breakout" && !FILTERS[k].test(r)) m.push(FILTERS[k].ar);
  return [...new Set(m)].join("، ");
}

// The market's turn: the equal-weighted index crossing its 200-day average, either way.
function regimeMessage(m, wasUp) {
  if (m?.up200 == null || wasUp == null || m.up200 === wasUp) return null;
  return m.up200 ? `📈${M.flag} ${M.title} رجع فوق متوسط 200 يوم (${pct(m.from200)} فوقه)\n${M.regimeUp}` : `📉${M.flag} ${M.title} نزل تحت متوسط 200 يوم (${pct(m.from200)})\n${M.regimeDown}`;
}
async function regimeCheck() {
  const bars = [];
  let i = 0;
  const worker = async () => {
    while (i < M.list.length) {
      const s = M.list[i++];
      const r = await getCandles(s.symbol, "1D", 300).catch(() => null);
      if (r?.candles?.length > 60) bars.push(r.candles);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const m = marketOf(bars);
  if (!m) return { sent: false };
  state.market = m;
  const text = regimeMessage(m, state.regimeUp);
  if (text) await send(text);
  state.regimeUp = m.up200;
  state.regimeFor = clock().date;
  saveState();
  return { sent: !!text, up200: m.up200, from200: m.from200 };
}

async function runOnce({ force = false } = {}) {
  if (busy) return { busy: true };
  busy = true;
  try {
    const rows = [],
      all = [];
    let i = 0,
      limited = false;
    const worker = async () => {
      while (!limited && i < M.list.length) {
        const s = M.list[i++];
        try {
          const r = await getCandles(s.symbol, "1D", 300);
          const bars = r.candles || [];
          if (bars.length > 60) all.push(bars);
          rows.push({ ...scanRow(s, bars, Date.now(), { market: M.market }), bar: bars.at(-1) });
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
    const date = clock().date;
    const fresh = entries.filter((r) => force || !state.sent[`${r.code}|${r.breakout?.level}|${date}`]);
    for (const r of fresh) {
      state.sent[`${r.code}|${r.breakout?.level}|${date}`] = Date.now();
      const note = await ai(
        `حلل إشارة الشراء هذي في سهم من ${M.title} في 4 إلى 6 أسطر: قوة الاختراق والسيولة، وضع ${M.title} العام، أي المقاومات تبدو واقعية، المخاطر (المسافة للوقف)، ومتى تعتبر الفكرة فاشلة.\n\n${entryMessage(r, { market })}`,
        2500,
      );
      const flow = await flowFor(r.symbol, M.market).catch(() => "");
      await send(addFlow(entryMessage(r, { market, note }), flow), r.symbol);
      follow(r);
    }
    for (const [k, at] of Object.entries(state.sent)) if (Date.now() - at > 5 * 86400e3) delete state.sent[k];
    state.lastRun = new Date().toISOString();
    if (cfg.prealerts && sessionOpen()) await prealert.sendNew(ok, M.market, { minValue: cfg.minValue, date, sent: (state.pre ||= {}), send: (text, r) => send(text, r.symbol) });
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
async function closeBrief() {
  const m = state.market;
  const open = trades.summary(M.market);
  const facts = [
    m ? `${M.title} (مؤشر متساوي الأوزان من الأسهم): ${pct(m.change)} اليوم · ${m.up ? "فوق" : "تحت"} متوسط 50 · ${m.rising} سهم صاعد مقابل ${m.falling} هابط` : "",
    state.lastEntries.length ? `إشارات الشراء اليوم: ${state.lastEntries.join("، ")}` : "لا توجد إشارات شراء اليوم.",
    state.near.length ? `أقرب الأسهم للإشارة:\n${state.near.map((r) => `${r.code} ${r.ar} ${sar(r.price)}: ينقصه ${r.why}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const note = await ai(`اكتب ملخص إغلاق ${M.title} في 4 إلى 7 أسطر من هذي المعطيات فقط: أداء السوق واتساعه، إشارات اليوم، أقرب الأسهم وما ينقصها، وما يستحق المراقبة بكرة.\n\n${facts}`, 2500);
  await send([`🌙${M.flag} إغلاق ${M.title}`, facts, open ? `📂 الصفقات المفتوحة:\n${open}` : "", note ? `🧠 قراءة المحلل:\n${note}` : ""].filter(Boolean).join("\n\n"));
  state.closeFor = clock().date;
  saveState();
  return { ok: true, ai: !!note };
}

async function tick() {
  const m = clock();
  // once a day after the close, even with the buy alerts off
  if (cfg.regime && closeWindow(m) && state.regimeFor !== m.date) await regimeCheck().catch((e) => (state.lastError = e.message));
  if (!cfg.on) return;
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
  if (!cfg.on && !cfg.regime) return;
  let last = 0;
  // every minute, a scan when its time has come
  timer = setInterval(() => {
    const m = clock();
    const wait = sessionOpen(m) ? cfg.every * 60e3 : 60e3;
    if (Date.now() - last >= wait) {
      last = Date.now();
      tick();
    }
  }, 60e3);
  // the open trades, every 3 minutes in the session and the hour after it
  tradesTimer = setInterval(() => {
    const m = clock();
    if ((sessionOpen(m) || closeWindow(m)) && trades.list(M.market).length) checkTrades().catch(() => {});
  }, 3 * 60e3);
  timer.unref?.();
  tradesTimer.unref?.();
}
return { clock, sessionOpen, closeWindow, settings, update, entryMessage, regimeMessage, regimeCheck, runOnce, closeBrief, checkTrades, follow, track, start: () => schedule(), stop: () => {
  clearInterval(timer);
  clearInterval(tradesTimer);
} };
}
