// US market watch (مراقبة السوق الأمريكي): while New York is open, scan the most traded US stocks
// every few minutes and send each new entry signal to Telegram with its breakout, stop, trailing
// stop and targets, an Arabic analyst note from the person's own AI, and the signal's record. It
// also sends Arabic news for the stocks it signalled, and three briefs a day: before the open, after
// the open and after the close. Runs on the server, with the browser closed.
import { getCandles, nasdaqScreener, usMarket } from "./providers.js";
import * as store from "./store.js";
import * as alerts from "./alerts.js";
import * as kwwatch from "./kwwatch.js";
import { news as newsOf } from "./market-info.js";
import { write, ANALYST } from "./ai-write.js";
import * as aiw from "./ai-write.js";
import { scanRow } from "../public/lib/kuwait-scan.js";
import { ema } from "../public/lib/indicators.js";

const DEFAULTS = { on: false, every: 15, size: 300, minValue: 20e6, news: true, briefs: true, ai: true };
let cfg = { ...DEFAULTS, ...store.read("uswatch", {}) };
let state = { sent: {}, newsSeen: {}, watched: {}, briefs: {}, lastRun: null, lastScanAt: 0, lastNewsAt: 0, lastEntries: [], near: [], lastError: null, ...store.read("uswatch-state", {}) };
const saveState = () => store.write("uswatch-state", state);
let timer = null,
  busy = false;

// ---------- New York time ----------
export function ny(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, day, min: Number(p.hour) * 60 + Number(p.minute), weekday: day >= 1 && day <= 5 };
}
// What a minute of the day calls for. Briefs: before the open (9:00-9:29), after the first
// half hour (9:45-11:00, after a scan) and after the close (16:02-17:30).
export function due(m, flags = {}) {
  if (!m.weekday) return {};
  return {
    pre: m.min >= 9 * 60 && m.min < 9 * 60 + 30 && !flags.pre,
    open: m.min >= 9 * 60 + 45 && m.min < 11 * 60 && !flags.open,
    close: m.min >= 16 * 60 + 2 && m.min < 17 * 60 + 30 && !flags.close,
    news: m.min >= 7 * 60 && m.min < 18 * 60,
  };
}

export const settings = () => ({ ...cfg, aiError: aiw.lastError, ny: ny(), telegram: kwwatch.settings().telegram, lastRun: state.lastRun, lastEntries: state.lastEntries, near: state.near, lastError: state.lastError, watched: Object.keys(state.watched), briefsToday: state.briefs[ny().date] || {} });

export function update(patch = {}) {
  const next = { ...cfg };
  for (const k of ["on", "news", "briefs", "ai"]) if (k in patch) next[k] = !!patch[k];
  if ("every" in patch) next.every = Math.min(60, Math.max(5, Number(patch.every) || 15));
  if ("size" in patch) next.size = [100, 300, 500, 1000].includes(Number(patch.size)) ? Number(patch.size) : 300;
  if ("minValue" in patch) next.minValue = Math.max(0, Number(patch.minValue) || 0);
  cfg = next;
  store.write("uswatch", cfg);
  schedule();
  return settings();
}

// ---------- sending ----------
async function send(text, { symbol = "", name = "السوق الأمريكي" } = {}) {
  const t = text.length > 3900 ? text.slice(0, 3890) + "…" : text;
  await alerts.notify({ symbol, name, text: t, notify: { toast: true, sound: true, desktop: true } });
  if (kwwatch.settings().telegram) await kwwatch.sendTelegram(t).catch((e) => (state.lastError = `تيليجرام: ${e.message}`));
}
const ai = (prompt, maxTokens) => (cfg.ai ? write(ANALYST, prompt, { maxTokens }) : Promise.resolve(null));

const n2 = (v, d = 2) => (v == null || !Number.isFinite(v) ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d }));
const pct = (v) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${n2(v, 2)}%`);
const usd = (v) => `${n2(v)}$`;

// ---------- the market's state ----------
export async function snapshot() {
  const last2 = (bars) => [bars.at(-2), bars.at(-1)];
  const get = (sym, n = 120) => getCandles(sym, "1D", n).then((r) => r.candles || []).catch(() => []);
  const [spy, es, vix, rows, head] = await Promise.all([get("US:SPY", 120), get("CME:ES1!", 5), get("YAHOO:^VIX", 5), nasdaqScreener("stocks").catch(() => []), newsOf("US:SPY").catch(() => ({ items: [] }))]);
  const out = {};
  if (spy.length > 55) {
    const e = ema(spy.map((b) => b.close), 50);
    const [p, l] = last2(spy);
    out.spy = { close: l.close, change: ((l.close - p.close) / p.close) * 100, ema50: e.at(-1), up: l.close > e.at(-1), date: new Date(l.time * 1000).toISOString().slice(0, 10) };
  }
  if (es.length > 1) {
    const [p, l] = last2(es);
    out.futures = { last: l.close, change: ((l.close - p.close) / p.close) * 100 };
  }
  if (vix.length > 1) {
    const [p, l] = last2(vix);
    out.vix = { last: l.close, change: ((l.close - p.close) / p.close) * 100 };
  }
  const big = rows.filter((r) => r.marketCap >= 2e9 && Number.isFinite(r.changePct));
  if (big.length) out.breadth = { up: big.filter((r) => r.changePct > 0).length, down: big.filter((r) => r.changePct < 0).length, of: big.length };
  out.headlines = (head.items || []).slice(0, 6).map((h) => h.title);
  return out;
}

export function snapshotText(s) {
  return [
    s.spy ? `S&P 500 (SPY): ${usd(s.spy.close)} ${pct(s.spy.change)} · ${s.spy.up ? "فوق" : "تحت"} متوسط 50 (${usd(s.spy.ema50)})` : "",
    s.futures ? `العقود الآجلة لـ S&P 500: ${pct(s.futures.change)}` : "",
    s.vix ? `مؤشر الخوف VIX: ${n2(s.vix.last)} (${pct(s.vix.change)})` : "",
    s.breadth ? `اتساع السوق: ${s.breadth.up} سهم صاعد مقابل ${s.breadth.down} هابط (من ${s.breadth.of} شركة فوق 2 مليار)` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------- scanning ----------
async function universe(size) {
  const rows = await nasdaqScreener("stocks");
  return rows
    .filter((r) => r.price >= 5 && r.marketCap >= 2e9 && r.volume > 0 && /^[A-Z]{1,5}$/.test(r.ticker))
    .sort((a, b) => b.price * b.volume - a.price * a.volume)
    .slice(0, size)
    .map((r) => ({ code: r.ticker, symbol: r.symbol, en: r.name.replace(/\s+(Common Stock|Class [A-Z] Common Stock|Ordinary Shares).*$/i, ""), ar: null }));
}

export function track() {
  const live = store.read("usbacktest", null)?.live;
  if (!live?.all?.n) return "";
  const ys = Object.keys(live.byYear || {}).sort();
  return `📊 السجل التاريخي (${ys[0]}–${ys.at(-1)}): ${live.all.n} إشارة، متوسط ${pct(live.all.avgRet)} للصفقة بعد العمولة، ${live.all.profitable}% رابحة. كانت سلبية في سنوات هبوط السوق (${ys.filter((y) => live.byYear[y].avgRet < 0).join("، ") || "—"}).`;
}

// The entry message: everything a trader needs to judge it, in order.
export function entryMessage(r, { market = null, note = null } = {}) {
  const p = r.plan;
  const entry = p ? (p.entryZone.from + p.entryZone.to) / 2 : r.price;
  const R = p ? entry - p.stop : null;
  const tR = (m) => (R ? entry + R * m : null);
  const away = p ? ((r.price - p.entryZone.to) / p.entryZone.to) * 100 : null;
  return [
    `🇺🇸 إشارة دخول فنية — ${r.code} (${r.en})`,
    `السعر الآن: ${usd(r.price)} (${pct(r.changePct)} اليوم)`,
    `📈 الاختراق: ${usd(r.breakout?.level)} ✓ بسيولة ${n2(r.breakout?.vol, 1)}x · سيولة داخلة ${r.flow?.inflowPct}% · الشراء ${r.buyToday}%`,
    p ? `🎯 منطقة الدخول: ${usd(p.entryZone.from)} – ${usd(p.entryZone.to)}` : "",
    away != null && away > 3 ? `⚠️ السعر الآن فوق منطقة الدخول بـ ${n2(away, 1)}%${R && r.price >= tR(2) ? " وتجاوز الهدف الأول" : ""}: الدخول من هنا مخاطرته أعلى لأن الوقف صار أبعد، والانتظار لرجوع السعر للمنطقة أحوط.` : away != null && away > 0 ? `السعر قريب من منطقة الدخول (فوقها بـ ${n2(away, 1)}%).` : p ? "✅ السعر داخل منطقة الدخول الآن." : "",
    p ? `🛑 وقف الخسارة الأولي: ${usd(p.stop)} (${pct(-((entry - p.stop) / entry) * 100)} من الدخول)` : "",
    r.trail ? `🔁 وقف متحرك بعد الدخول: أعلى سعر يوصله السهم ناقص ${usd(r.trail.dist)} (${r.trail.atr} ATR)` : "",
    R ? `🎯 الأهداف: الأول ${usd(tR(2))} (${pct((2 * R * 100) / entry)}) · الثاني ${usd(tR(3))} (${pct((3 * R * 100) / entry)})${p.targets?.length ? ` · مقاومات في الطريق: ${p.targets.map((t) => usd(t.price)).join("، ")}` : ""}` : "",
    market?.spy ? (market.spy.up ? "✅ السوق العام صاعد (S&P 500 فوق متوسط 50)" : "⚠️ السوق العام تحت متوسط 50: الإشارات تاريخيًا أضعف في هالحالة") : "",
    note ? `🧠 قراءة المحلل:\n${note}` : "",
    track(),
    "فلترة فنية بقواعد ثابتة، وليست توصية. القرار وحجم المخاطرة عليك.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runOnce({ force = false } = {}) {
  if (busy) return { busy: true };
  busy = true;
  try {
    const list = await universe(cfg.size);
    const rows = [];
    let i = 0,
      limited = false;
    const worker = async () => {
      while (!limited && i < list.length) {
        const s = list[i++];
        try {
          const r = await getCandles(s.symbol, "1D", 300);
          rows.push(scanRow(s, r.candles || [], Date.now(), { market: "us" }));
        } catch (e) {
          if (/rate limit/i.test(e.message)) limited = true;
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    const ok = rows.filter((r) => !r.error);
    const entries = ok.filter((r) => r.entry && (r.value ?? 0) >= cfg.minValue);
    const date = ny().date;
    const fresh = entries.filter((r) => force || !state.sent[`${r.code}|${r.breakout?.level}|${date}`]);
    const market = fresh.length ? await snapshot().catch(() => null) : null;
    for (const r of fresh) {
      state.sent[`${r.code}|${r.breakout?.level}|${date}`] = Date.now();
      const heads = (await newsOf(r.symbol).catch(() => ({ items: [] }))).items.slice(0, 4).map((h) => h.title);
      const note = await ai(
        `حلل إشارة الاختراق هذي في 4 إلى 6 أسطر: قوة الاختراق والسيولة، وضع السوق العام، المخاطر (المسافة للوقف، المقاومات القريبة، أي خبر مهم)، ومتى تعتبر الفكرة فاشلة.\n\n${entryMessage(r, { market })}\n\nآخر عناوين أخبار السهم (بالإنجليزي):\n${heads.join("\n") || "لا توجد"}\n\nحالة السوق:\n${market ? snapshotText(market) : "غير متاحة"}`,
        2500,
      );
      await send(entryMessage(r, { market, note }), { symbol: r.symbol, name: "" });
      state.watched[r.code] = { symbol: r.symbol, en: r.en, since: Date.now() };
    }
    for (const [k, at] of Object.entries(state.sent)) if (Date.now() - at > 5 * 86400e3) delete state.sent[k];
    state.lastRun = new Date().toISOString();
    state.lastScanAt = Date.now();
    state.lastEntries = entries.map((r) => r.code);
    state.near = ok
      .filter((r) => !r.entry && (r.value ?? 0) >= cfg.minValue)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((r) => ({ code: r.code, en: r.en, price: r.price, breakout: r.breakout, inflow: r.flow?.inflowPct, vol: r.breakout?.vol ?? r.relVol, why: missing(r) }));
    state.lastError = limited ? "مصدر البيانات حدّ الطلبات، اكتمل جزء من المسح" : ok.length ? null : "ما وصلت بيانات";
    saveState();
    return { scanned: ok.length, entries: entries.length, sent: fresh.length, limited };
  } finally {
    busy = false;
  }
}
// what a near signal still lacks, in words
function missing(r) {
  const m = [];
  if (r.breakout?.dir !== "up") m.push("ما فيه اختراق");
  else if (!r.breakout.confirmed) m.push("الاختراق بدون سيولة كافية");
  else if ((r.breakout.vol ?? 0) < 2) m.push(`سيولة الاختراق ${n2(r.breakout.vol, 1)}x أقل من 2x`);
  if ((r.flow?.inflowPct ?? 0) < 55) m.push(`السيولة الداخلة ${r.flow?.inflowPct ?? "—"}%`);
  if ((r.buyToday ?? 0) <= 50) m.push("يحتاج الشراء يكون أكبر من البيع");
  if ((r.signalKey ?? 0) <= 0) m.push("ميزان الإشارات غير إيجابي");
  return m.join("، ");
}

// ---------- briefs ----------
const TITLES = { pre: "🌅 قبل افتتاح السوق الأمريكي", open: "🔔 بعد افتتاح السوق الأمريكي", close: "🌙 إغلاق السوق الأمريكي" };
const ASK = {
  pre: "اكتب قراءة ما قبل الافتتاح في 6 إلى 9 أسطر: اتجاه السوق المتوقع من العقود الآجلة ومؤشر الخوف، هل السوق العام صاعد أو هابط (متوسط 50)، أهم 2-3 أخبار من العناوين وتأثيرها المحتمل، وما الذي يستحق المراقبة في الافتتاح ومزاد الافتتاح.",
  open: "اكتب قراءة أول نص ساعة في 5 إلى 8 أسطر: كيف افتتح السوق، اتساع السوق (الصاعد مقابل الهابط)، والإشارات أو الأسهم القريبة من الإشارة.",
  close: "اكتب ملخص الإغلاق في 6 إلى 9 أسطر: أداء السوق اليوم، اتساعه، إشارات اليوم إن وجدت، أقرب الأسهم للإشارة وما ينقصها، وما يستحق المراقبة غدًا.",
};
export async function brief(kind = "pre") {
  const snap = await snapshot();
  const sig = state.lastEntries.length ? `إشارات الدخول في آخر مسح: ${state.lastEntries.join("، ")}` : "لا توجد إشارات دخول في آخر مسح.";
  const near = state.near.length ? `أقرب الأسهم للإشارة:\n${state.near.map((r) => `${r.code} (${r.en}) ${usd(r.price)}: ينقصه ${r.why || "—"}`).join("\n")}` : "";
  const facts = `${snapshotText(snap)}\n\n${sig}\n${near}\n\nعناوين أخبار السوق (بالإنجليزي):\n${snap.headlines.join("\n") || "لا توجد"}`;
  const note = await ai(`${ASK[kind]}\n\nالمعطيات:\n${facts}`, 3000);
  const text = [TITLES[kind], snapshotText(snap), note ? `🧠 قراءة المحلل:\n${note}` : `${sig}${near ? `\n${near}` : ""}`, snap.spy && !snap.spy.up ? "⚠️ السوق تحت متوسط 50 يوم: إشارات الاختراق تاريخيًا أضعف في هالحالة." : "", "قراءة فنية للمعلومة، وليست توصية."]
    .filter(Boolean)
    .join("\n\n");
  await send(text, { name: "" });
  (state.briefs[ny().date] ||= {})[kind] = Date.now();
  for (const d of Object.keys(state.briefs)) if (d < ny(new Date(Date.now() - 7 * 86400e3)).date) delete state.briefs[d];
  saveState();
  return { ok: true, ai: !!note };
}

// ---------- news ----------
export async function newsCheck() {
  const since = Date.now() - 5 * 86400e3;
  let sent = 0;
  for (const [code, w] of Object.entries(state.watched)) {
    if (w.since < since) {
      delete state.watched[code];
      continue;
    }
    const items = (await newsOf(w.symbol).catch(() => ({ items: [] }))).items.filter((h) => h.url && !state.newsSeen[h.url] && (h.time || Date.now()) >= w.since - 86400e3).slice(0, 3);
    if (!items.length) continue;
    for (const h of items) state.newsSeen[h.url] = Date.now();
    const ar = await ai(`ترجم هذه الأخبار عن سهم ${code} (${w.en}) للعربي، ولكل خبر سطرين: العنوان مترجم، ثم خلاصة قصيرة وهل يبدو إيجابي أو سلبي أو محايد للسهم وليش. لا تضف معلومات غير موجودة.\n\n${items.map((h, k) => `${k + 1}. ${h.title}\n${h.summary || ""}\n(${h.source || ""})`).join("\n\n")}`, 2500);
    await send([`📰 أخبار ${code} (${w.en})`, ar || items.map((h) => `• ${h.title}`).join("\n"), items.map((h) => h.url).join("\n")].join("\n\n"), { symbol: w.symbol, name: "" });
    sent += items.length;
  }
  for (const [u, at] of Object.entries(state.newsSeen)) if (Date.now() - at > 14 * 86400e3) delete state.newsSeen[u];
  state.lastNewsAt = Date.now();
  saveState();
  return { sent };
}

export async function aiTest() {
  const text = await write(ANALYST, "اكتب سطر واحد: جاهز للتحليل.", { maxTokens: 400 });
  return { ok: !!text, text, error: aiw.lastError };
}

// ---------- the clock ----------
async function tick() {
  if (!cfg.on) return;
  const m = ny();
  const flags = state.briefs[m.date] || {};
  const d = due(m, flags);
  try {
    const mk = m.weekday ? await usMarket().catch(() => ({ open: false, businessDay: true })) : { open: false, businessDay: false };
    if (!mk.businessDay) return;
    if (cfg.briefs && d.pre) await brief("pre");
    if (mk.open && Date.now() - state.lastScanAt >= cfg.every * 60e3) await runOnce();
    if (cfg.briefs && d.open && state.lastScanAt > Date.now() - 20 * 60e3) await brief("open");
    if (cfg.briefs && d.close) {
      await runOnce();
      await brief("close");
    }
    if (cfg.news && d.news && Date.now() - state.lastNewsAt >= 30 * 60e3 && Object.keys(state.watched).length) await newsCheck();
  } catch (e) {
    state.lastError = e.message;
    saveState();
  }
}
function schedule() {
  clearInterval(timer);
  if (cfg.on) timer = setInterval(tick, 60e3);
}
export const start = () => schedule();
export const stop = () => clearInterval(timer);
