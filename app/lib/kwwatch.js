// Kuwait market watch (مراقبة السوق الكويتي): while Boursa Kuwait is open, scan every listed stock
// every few minutes and send a notification for each new buy-entry signal (a confirmed breakout,
// money coming in, buying ahead, the checks leaning positive). It runs on the server, so it keeps
// going with the browser closed, as long as AskCharts is running.
import { getCandles } from "./providers.js";
import * as store from "./store.js";
import * as alerts from "./alerts.js";
import { KUWAIT_STOCKS } from "../public/lib/kuwait-market.js";
import { scanRow } from "../public/lib/kuwait-scan.js";
import * as trades from "./trades.js";
import { flowFor } from "./flow.js";
import * as prealert from "./prealert.js";
import * as kwflow from "./kwflow.js";

const DEFAULTS = { on: false, every: 15, minValue: 10000, webhook: "", afterClose: true, waPhone: "", waKey: "", tgToken: "", tgChat: "", tgBot: "", prealerts: true };
let cfg = { ...DEFAULTS, ...store.read("kwwatch", {}) };
let state = store.read("kwwatch-state", { sent: {}, lastRun: null, lastEntries: [], lastError: null });
// sent keys were stock|level|day; now stock|day (one signal a stock a day)
for (const k of Object.keys(state.sent || {})) {
  const p = k.split("|");
  if (p.length === 3) state.sent[`${p[0]}|${p[2]}`] = state.sent[k];
}

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
  const { waKey, waPhone, tgToken, tgChat, ...rest } = cfg;
  return { ...rest, tgChats: Object.fromEntries(Object.keys(cfg.tgChats || {}).map((k) => [k, true])), telegram: !!(tgToken && tgChat), tgToken: !!tgToken, tgBot: cfg.tgBot, lastTelegram: state.lastTelegram || null, whatsapp: !!(waKey && waPhone), waPhone: maskPhone(waPhone), sessionOpen: sessionOpen(), lastRun: state.lastRun, lastEntries: state.lastEntries, lastError: state.lastError, lastWhatsApp: state.lastWhatsApp || null };
};

// Telegram: your own bot (from @BotFather). The token stays on the server; the chat is found from
// the /start message you send the bot, so nobody has to look up a chat id.
const tg = async (method, body, ms = 15000) => {
  const res = await fetch(`https://api.telegram.org/bot${cfg.tgToken}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(ms),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) throw Object.assign(new Error(j.description === "Unauthorized" ? "رمز البوت غير صحيح" : `تيليجرام: ${j.description || `HTTP ${res.status}`}`), { status: 400 });
  return j.result;
};
export async function linkTelegram() {
  if (!cfg.tgToken) throw Object.assign(new Error("الصق رمز البوت أولًا"), { status: 400 });
  const me = await tg("getMe");
  cfg.tgBot = me.username || "";
  const ups = await tg("getUpdates");
  const chat = [...ups].reverse().map((u) => u.message?.chat || u.my_chat_member?.chat).find((c) => c?.type === "private");
  if (!chat) {
    store.write("kwwatch", cfg);
    throw Object.assign(new Error(`افتح البوت @${cfg.tgBot} في تيليجرام واضغط Start (أو أرسل له أي رسالة)، ثم اضغط «ربط» مرة ثانية.`), { status: 400 });
  }
  cfg.tgChat = String(chat.id);
  store.write("kwwatch", cfg);
  await sendTelegram(`✅ AskCharts مربوط. تنبيهات إشارات الدخول من ماسح السوق الكويتي راح توصلك هنا يا ${chat.first_name || ""}.`);
  return settings();
}
// One Telegram group per market, if you want: add the bot to a group and send it the market's
// command there (/kw@yourbot, /us@yourbot, /sa@yourbot or /ae@yourbot; /off@yourbot sends that
// group's market back to the private chat). A market without its own group goes to the private chat.
export const MARKET_NAMES = { kw: "🇰🇼 السوق الكويتي", us: "🇺🇸 السوق الأمريكي", sa: "🇸🇦 السوق السعودي", ae: "🇦🇪 سوق دبي" };
export function routeCommand(text, bot = "") {
  const m = String(text || "").trim().match(/^\/(kw|us|sa|ae|off)(?:@(\w+))?\s*$/i);
  if (!m) return null;
  if (m[2] && bot && m[2].toLowerCase() !== bot.toLowerCase()) return null;
  return m[1].toLowerCase();
}
export const chatFor = (market) => (market && cfg.tgChats?.[market]) || cfg.tgChat;
let tgPolling = false;
// A message that isn't a command, from one of your own chats (the private one or a market group),
// goes to this handler (lib/tgbot.js: a stock's reading) and its answer back to that chat. Anyone
// else writing to the bot gets nothing.
let textHandler = null;
export const onText = (fn) => (textHandler = fn);
const mine = (chat) => chat === cfg.tgChat || Object.values(cfg.tgChats || {}).includes(chat);
export async function pollTelegram({ wait = 0 } = {}) {
  if (!cfg.tgToken || tgPolling) return { changed: 0 };
  tgPolling = true;
  let changed = 0;
  try {
    const ups = await tg("getUpdates", { offset: (state.tgOffset || 0) + 1, timeout: wait, allowed_updates: ["message", "channel_post"] }, (wait + 15) * 1000);
    for (const u of ups) {
      state.tgOffset = Math.max(state.tgOffset || 0, u.update_id);
      store.write("kwwatch-state", state);
      const msg = u.message || u.channel_post;
      const cmd = routeCommand(msg?.text, cfg.tgBot);
      if (!cmd && msg?.text && msg.chat && textHandler && mine(String(msg.chat.id))) {
        const chat = String(msg.chat.id);
        await tg("sendChatAction", { chat_id: chat, action: "typing" }).catch(() => {});
        const reply = await textHandler(msg.text).catch((e) => `صار خطأ: ${e.message}`);
        if (reply) await tg("sendMessage", { chat_id: chat, text: reply.slice(0, 4000), disable_web_page_preview: true }).catch(() => {});
        continue;
      }
      if (!cmd || !msg.chat) continue;
      const chat = String(msg.chat.id);
      cfg.tgChats = { ...(cfg.tgChats || {}) };
      if (cmd === "off") {
        const gone = Object.keys(cfg.tgChats).filter((k) => cfg.tgChats[k] === chat);
        for (const k of gone) delete cfg.tgChats[k];
        await tg("sendMessage", { chat_id: chat, text: gone.length ? `تم. ${gone.map((k) => MARKET_NAMES[k]).join("، ")} رجع يوصل على الخاص.` : "هالمجموعة ما فيها سوق مربوط." }).catch(() => {});
      } else {
        cfg.tgChats[cmd] = chat;
        await tg("sendMessage", { chat_id: chat, text: `✅ تم. توصيات ومتابعة ${MARKET_NAMES[cmd]} صارت توصل هنا.` }).catch(() => {});
      }
      changed++;
      store.write("kwwatch", cfg);
    }
    store.write("kwwatch-state", state);
  } finally {
    tgPolling = false;
  }
  return { changed };
}
export async function sendTelegram(text, market = null) {
  if (!cfg.tgToken || !cfg.tgChat) throw Object.assign(new Error("اربط تيليجرام أولًا"), { status: 400 });
  let msg = null;
  try {
    try {
      msg = await tg("sendMessage", { chat_id: chatFor(market), text, disable_web_page_preview: true });
    } catch (e) {
      // a group the bot was removed from: fall back to the private chat
      if (chatFor(market) === cfg.tgChat) throw e;
      msg = await tg("sendMessage", { chat_id: cfg.tgChat, text, disable_web_page_preview: true });
    }
    state.lastTelegram = { at: new Date().toISOString(), ok: true, note: "" };
  } catch (e) {
    state.lastTelegram = { at: new Date().toISOString(), ok: false, note: e.message };
    throw e;
  } finally {
    store.write("kwwatch-state", state);
  }
  return { ok: true, chat: msg?.chat?.id, id: msg?.message_id };
}
// Replace a message already sent (a signal sent at once, then completed with the analyst's note).
export async function editTelegram(sent, text) {
  if (!cfg.tgToken || !sent?.chat || !sent?.id) return false;
  await tg("editMessageText", { chat_id: sent.chat, message_id: sent.id, text: text.slice(0, 4000), disable_web_page_preview: true });
  return true;
}

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
  if ("prealerts" in patch) next.prealerts = !!patch.prealerts;
  if ("waPhone" in patch) {
    const ph = String(patch.waPhone || "").replace(/[\s-]/g, "");
    if (ph && !/^\+\d{8,15}$/.test(ph)) throw Object.assign(new Error("اكتب الرقم مع رمز الدولة، مثل +96550000000"), { status: 400 });
    next.waPhone = ph;
  }
  if ("tgToken" in patch && String(patch.tgToken || "").trim()) {
    const t = String(patch.tgToken).trim();
    if (t === "-") Object.assign(next, { tgToken: "", tgChat: "", tgBot: "", tgChats: {} });
    else if (!/^\d{5,12}:[A-Za-z0-9_-]{30,50}$/.test(t)) throw Object.assign(new Error("هذا مو شكل رمز البوت. انسخه كامل من رسالة @BotFather (أرقام ثم : ثم حروف)"), { status: 400 });
    else Object.assign(next, { tgToken: t, tgChat: "", tgBot: "", tgChats: {} });
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
// The signal's record in the market's history (from the last historical test), for the message.
export function track() {
  const live = store.read("kwbacktest", null)?.live;
  if (!live?.all?.n) return "";
  const years = Object.keys(live.byYear || {}).sort();
  const lastY = years.at(-1),
    ly = live.byYear?.[lastY];
  const sign = (v) => `${v > 0 ? "+" : ""}${num(v)}%`;
  return `السجل التاريخي (${years[0]}–${lastY}): ${live.all.n} إشارة، متوسط ${sign(live.all.avgRet)} للصفقة بعد العمولة، ${live.all.profitable}% منها رابحة${ly?.n ? ` (سنة ${lastY}: ${sign(ly.avgRet)})` : ""}.`;
}

export function message(r) {
  const p = r.plan,
    tg = p?.targets || [];
  return [
    `${r.code}${r.ar ? ` (${r.ar})` : ` (${r.en})`} — السعر ${num(r.price)}`,
    `اختراق ${num(r.breakout?.level)} ✓ بسيولة ${num(r.breakout?.vol ?? r.relVol)}x · سيولة داخلة ${r.flow?.inflowPct}% · شراء ${r.buyToday}%`,
    `الاتجاه الأسبوعي صاعد · RSI ${num(r.rsi)} · إغلاق قرب القمة · الإشارات ${r.positives}✓ ${r.negatives}✗`,
    p ? `الشراء من ${num(p.entryZone.from)}–${num(p.entryZone.to)} · وقف أولي ${num(p.stop)}` : "",
    r.trail ? `وقف متحرك: أعلى سعر بعد الدخول ناقص ${num(r.trail.dist)} (2.5 ATR)` : "",
    tg.length ? `مقاومات قريبة: ${tg.map((t) => num(t.price)).join("، ")}` : "",
    track(),
    "إشارة من قواعد ثابتة، ولا تضمن الربح. لا تخاطر بأكثر من 1-2% من محفظتك في الصفقة.",
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
          rows.push({ ...scanRow(s, r.candles || []), bar: (r.candles || []).at(-1) });
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
      const key = `${r.code}|${today}`;
      if (!force && state.sent[key]) continue;
      // late (more than 3% over the buy zone, or up more than 5% today): not sent, maybe later
      if (!force && ((r.plan && (r.price - r.plan.entryZone.to) / r.plan.entryZone.to > 0.03) || (r.changePct ?? 0) > 5)) continue;
      state.sent[key] = Date.now();
      fresh.push(r);
    }
    for (const r of fresh) {
      const flow = await flowFor(r.symbol, "kw").catch(() => "");
      const text = message(r) + (flow ? `\n${flow}` : "");
      await alerts.notify({ symbol: r.symbol, name: "إشارة شراء", text, webhook: cfg.webhook, notify: { toast: true, sound: true, desktop: true } });
      if (cfg.tgToken && cfg.tgChat) await sendTelegram(`🟢🇰🇼 إشارة شراء\n${text}`, "kw").catch(() => {});
      if (cfg.waPhone && cfg.waKey) await sendWhatsApp(`🟢🇰🇼 إشارة شراء\n${text}`).catch(() => {});
      follow(r);
    }
    // forget sent keys after four days
    for (const [k, at] of Object.entries(state.sent)) if (Date.now() - at > 4 * 86400e3) delete state.sent[k];
    state.lastRun = new Date().toISOString();
    if (cfg.prealerts && sessionOpen())
      await prealert.sendNew(rows, "kw", {
        minValue: cfg.minValue,
        date: today,
        sent: (state.pre ||= {}),
        send: async (text) => {
          await alerts.notify({ symbol: "", name: "", text, notify: { toast: true, sound: false, desktop: true } });
          if (cfg.tgToken && cfg.tgChat) await sendTelegram(text, "kw").catch(() => {});
        },
      });
    state.lastEntries = entries.map((r) => r.code);
    state.lastError = limited ? "Yahoo حدّ الطلبات، اكتمل جزء من المسح" : rows.length ? null : "ما وصلت بيانات";
    store.write("kwwatch-state", state);
    return { scanned: rows.length, entries: entries.length, sent: fresh.length, limited };
  })().finally(() => (running = null));
  return running;
}

// Follow a signal from now on: its resistances and the trailing stop (lib/trades.js).
export function follow(r) {
  const p = r.plan;
  if (!p) return false;
  const entry = (p.entryZone.from + p.entryZone.to) / 2;
  if (!(p.stop < entry)) return false;
  const targets = (p.targets || []).map((t) => t.price).filter((v) => v > entry);
  return trades.open(trades.newTrade({ market: "kw", code: r.code, symbol: r.symbol, name: r.ar || r.en, entry, stop: p.stop, targets, trailDist: r.trail?.dist ?? null, price: r.price, bar: r.bar }));
}
async function deliver(text) {
  await alerts.notify({ symbol: "", name: "متابعة صفقة", text, webhook: cfg.webhook, notify: { toast: true, sound: true, desktop: true } });
  if (cfg.tgToken && cfg.tgChat) await sendTelegram(text, "kw").catch(() => {});
  if (cfg.waPhone && cfg.waKey) await sendWhatsApp(text).catch(() => {});
}
export const checkTrades = () => trades.check("kw", (t) => getCandles(t.symbol, "1D", 3).then((r) => trades.fromBar(t, (r.candles || []).at(-1))), deliver);
// every 3 minutes in the session and the half hour after it
let tradesTimer = null;
function followTrades() {
  clearInterval(tradesTimer);
  if (!cfg.on) return;
  tradesTimer = setInterval(() => {
    if ((sessionOpen() || afterCloseWindow()) && trades.list("kw").length) checkTrades().catch(() => {});
    // buying money into your own stocks (lib/kwflow.js)
    if (sessionOpen()) kwflow.check(deliver).catch(() => {});
  }, 3 * 60e3);
  tradesTimer.unref?.();
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
    // no data at all (just after a restart the network may not be up yet): try again in two minutes
    const retry = sessionOpen() && state.lastError === "ما وصلت بيانات";
    timer = setTimeout(tick, (retry ? 2 : sessionOpen() ? cfg.every : 5) * 60e3);
  };
  timer = setTimeout(tick, 5000);
  followTrades();
}

// the bot's messages (group commands and questions about a stock), read as they come: Telegram holds
// each request up to 25 seconds until something arrives
let tgLoop = false;
const pause = (ms) => new Promise((r) => setTimeout(r, ms).unref?.());
export const start = () => {
  schedule();
  if (tgLoop) return;
  tgLoop = true;
  (async () => {
    while (tgLoop) {
      if (!cfg.tgToken) {
        await pause(30e3);
        continue;
      }
      await pollTelegram({ wait: 25 }).catch(() => pause(10e3));
    }
  })();
};
export const stop = () => {
  clearTimeout(timer);
  clearInterval(tradesTimer);
  tgLoop = false;
};
