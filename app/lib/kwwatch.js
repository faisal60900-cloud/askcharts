// Kuwait market watch (مراقبة السوق الكويتي): while Boursa Kuwait is open, scan every listed stock
// every few minutes and send a notification for each new buy-entry signal (a confirmed breakout,
// money coming in, buying ahead, the checks leaning positive). It runs on the server, so it keeps
// going with the browser closed, as long as AskCharts is running.
import { getCandles } from "./providers.js";
import * as store from "./store.js";
import * as alerts from "./alerts.js";
import { KUWAIT_STOCKS } from "../public/lib/kuwait-market.js";
import { scanRow } from "../public/lib/kuwait-scan.js";

const DEFAULTS = { on: false, every: 15, minValue: 10000, webhook: "", afterClose: true, waPhone: "", waKey: "" };
let cfg = { ...DEFAULTS, ...store.read("kwwatch", {}) };
let state = store.read("kwwatch-state", { sent: {}, lastRun: null, lastEntries: [], lastError: null });
let timer = null,
  running = null;

const kuwaitNow = (d = new Date()) => {
  const k = new Date(d.getTime() + 3 * 3600e3); // Kuwait is UTC+3 all year
  return { day: k.getUTCDay(), min: k.getUTCHours() * 60 + k.getUTCMinutes(), date: k.toISOString().slice(0, 10) };
};
// Sunday to Thursday, 9:00 to 12:45 (the close is 12:40, the closing auction a few minutes before)
export function sessionOpen(d = new Date()) {
  const k = kuwaitNow(d);
  return k.day >= 0 && k.day <= 4 && k.min >= 9 * 60 && k.min <= 12 * 60 + 45;
}
const afterCloseWindow = (d = new Date()) => {
  const k = kuwaitNow(d);
  return k.day >= 0 && k.day <= 4 && k.min > 12 * 60 + 45 && k.min <= 13 * 60 + 30;
};

// The WhatsApp key is never sent back to the page: only whether one is saved, and the number with
// its middle hidden.
const maskPhone = (p) => (p ? p.slice(0, 4) + "•••" + p.slice(-3) : "");
export const settings = () => {
  const { waKey, waPhone, ...rest } = cfg;
  return { ...rest, whatsapp: !!(waKey && waPhone), waPhone: maskPhone(waPhone), sessionOpen: sessionOpen(), lastRun: state.lastRun, lastEntries: state.lastEntries, lastError: state.lastError, lastWhatsApp: state.lastWhatsApp || null };
};

// WhatsApp through CallMeBot (free, for messages to your own number): a GET with the number, the
// text and the key the bot gave you.
export function whatsappUrl(phone, key, text) {
  return `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(key)}`;
}
export async function sendWhatsApp(text) {
  if (!cfg.waPhone || !cfg.waKey) throw Object.assign(new Error("أدخل رقم الواتساب والمفتاح أولًا"), { status: 400 });
  try {
    const res = await fetch(whatsappUrl(cfg.waPhone, cfg.waKey, text), { signal: AbortSignal.timeout(20000) });
    const body = (await res.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
    const ok = res.ok && !/error|invalid|not\s+(allowed|registered|active)/i.test(body);
    state.lastWhatsApp = { at: new Date().toISOString(), ok, note: ok ? "" : body || `HTTP ${res.status}` };
    store.write("kwwatch-state", state);
    if (!ok) throw new Error(`الواتساب ما وصل: ${state.lastWhatsApp.note}`);
    return { ok: true };
  } catch (e) {
    if (!state.lastWhatsApp || state.lastWhatsApp.ok) {
      state.lastWhatsApp = { at: new Date().toISOString(), ok: false, note: e.message };
      store.write("kwwatch-state", state);
    }
    throw Object.assign(e, { status: e.status || 502 });
  }
}

export function update(patch = {}) {
  const next = { ...cfg };
  if ("on" in patch) next.on = !!patch.on;
  if ("every" in patch) next.every = Math.min(60, Math.max(5, Number(patch.every) || 15));
  if ("minValue" in patch) next.minValue = Math.max(0, Number(patch.minValue) || 0);
  if ("afterClose" in patch) next.afterClose = !!patch.afterClose;
  if ("waPhone" in patch) {
    const ph = String(patch.waPhone || "").replace(/[\s-]/g, "");
    if (ph && !/^\+\d{8,15}$/.test(ph)) throw Object.assign(new Error("اكتب الرقم مع رمز الدولة، مثل +96550000000"), { status: 400 });
    next.waPhone = ph;
  }
  // an empty key leaves the saved one as it is; "-" removes it
  if ("waKey" in patch && String(patch.waKey || "").trim()) next.waKey = patch.waKey === "-" ? "" : String(patch.waKey).trim().slice(0, 64);
  if ("webhook" in patch) {
    const w = String(patch.webhook || "").trim();
    if (w && !/^https:\/\/\S+$/i.test(w)) throw Object.assign(new Error("رابط الإرسال لازم يبدأ بـ https://"), { status: 400 });
    next.webhook = w;
  }
  cfg = next;
  store.write("kwwatch", cfg);
  schedule();
  return settings();
}

const num = (v) => (v == null ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 }));
export function message(r) {
  const p = r.plan,
    t1 = p?.targets?.[0];
  return [
    `${r.code}${r.ar ? ` (${r.ar})` : ` (${r.en})`} — السعر ${num(r.price)}`,
    `اختراق ${num(r.breakout?.level)} ✓ بسيولة ${num(r.relVol)}x · سيولة داخلة ${r.flow?.inflowPct}% · شراء ${r.buyToday}%`,
    `ميزان الإشارات ${r.positives}✓ ${r.negatives}✗`,
    p ? `دخول ${num(p.entryZone.from)}–${num(p.entryZone.to)} · وقف ${num(p.stop)} · هدف ${num(t1?.price)} (1:${num(t1?.rr)})` : "",
    "فلترة فنية بقواعد ثابتة، وليست توصية.",
  ]
    .filter(Boolean)
    .join("\n");
}

// One scan of the whole market; a signal is sent once per stock, breakout level and day.
export async function runOnce({ force = false } = {}) {
  if (running) return running;
  running = (async () => {
    const rows = [];
    let i = 0,
      limited = false;
    const worker = async () => {
      while (!limited && i < KUWAIT_STOCKS.length) {
        const s = KUWAIT_STOCKS[i++];
        try {
          const r = await getCandles(s.symbol, "1D", 300);
          rows.push(scanRow(s, r.candles || []));
        } catch (e) {
          if (/rate limit/i.test(e.message)) limited = true;
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    const today = kuwaitNow().date;
    const entries = rows.filter((r) => r.entry && (r.value ?? 0) >= cfg.minValue);
    const fresh = [];
    for (const r of entries) {
      const key = `${r.code}|${r.breakout?.level}|${today}`;
      if (!force && state.sent[key]) continue;
      state.sent[key] = Date.now();
      fresh.push(r);
    }
    for (const r of fresh) {
      const text = message(r);
      await alerts.notify({ symbol: r.symbol, name: "إشارة دخول فنية", text, webhook: cfg.webhook, notify: { toast: true, sound: true, desktop: true } });
      if (cfg.waPhone && cfg.waKey) await sendWhatsApp(`🔔 إشارة دخول فنية\n${text}`).catch(() => {});
    }
    // forget sent keys after four days
    for (const [k, at] of Object.entries(state.sent)) if (Date.now() - at > 4 * 86400e3) delete state.sent[k];
    state.lastRun = new Date().toISOString();
    state.lastEntries = entries.map((r) => r.code);
    state.lastError = limited ? "Yahoo حدّ الطلبات، اكتمل جزء من المسح" : rows.length ? null : "ما وصلت بيانات";
    store.write("kwwatch-state", state);
    return { scanned: rows.length, entries: entries.length, sent: fresh.length, limited };
  })().finally(() => (running = null));
  return running;
}

let closeDoneFor = null;
function schedule() {
  clearTimeout(timer);
  if (!cfg.on) return;
  const tick = async () => {
    try {
      if (sessionOpen()) await runOnce();
      else if (cfg.afterClose && afterCloseWindow() && closeDoneFor !== kuwaitNow().date) {
        closeDoneFor = kuwaitNow().date;
        await runOnce();
      }
    } catch (e) {
      state.lastError = e.message;
    }
    timer = setTimeout(tick, (sessionOpen() ? cfg.every : 5) * 60e3);
  };
  timer = setTimeout(tick, 5000);
}

export const start = () => schedule();
export const stop = () => clearTimeout(timer);
