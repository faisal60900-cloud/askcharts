// متابعة الصفقات (trade follow-up): every entry signal sent is followed until it ends, and a message
// goes out when a target is reached, when the stop moves and when the stop or the last target ends
// it. The US signals follow their five targets (a fifth sold at each, the stop to the entry after the
// first and to the previous target after each next one); the Kuwaiti ones their resistances and the
// trailing stop (the highest price since the signal minus 2.5 ATR). The rules are the same ones the
// historical tests used, so what is reported here can be compared with them.
import * as store from "./store.js";

const KEY = "trades";
let book = store.read(KEY, { open: {}, closed: [] });
const save = () => store.write(KEY, book);
export const reset = (b = { open: {}, closed: [] }) => (book = b);

// how many calendar days a signal is followed (60 sessions in New York, 40 in Kuwait)
export const MAX_DAYS = { us: 90, kw: 60, sa: 60, ae: 90 };
const r2 = (v) => Math.round(v * 100) / 100;

// A new trade from a signal. Targets the price had already passed when the signal was sent count as
// passed (the entry message said so), so they don't arrive later as news.
// bar: the signal day's candle, so its range before the signal isn't counted later.
// qty and mine: a position of your own (your shares and your stop), with the money in its messages
export function newTrade({ market, code, symbol, name, entry, stop, targets, trailDist = null, price = entry, at = Date.now(), bar = null, qty = null, mine = false }) {
  const t = { market, code, symbol, name, entry, stop0: stop, stop, targets, trailDist, high: Math.max(entry, price), hit: 0, sold: 0, value: 0, opened: at, last: price, lastAt: at, qty, mine };
  if (bar) Object.assign(t, { dDate: new Date(bar.time * 1000).toISOString().slice(0, 10), dh: bar.high, dl: bar.low });
  if (market === "us") while (t.hit < targets.length && price >= targets[t.hit]) take(t, targets[t.hit]);
  else while (t.hit < targets.length && price >= targets[t.hit]) t.hit++;
  return t;
}
// the US plan: a fifth sold at the target, the stop up behind it
function take(t, px) {
  t.value += px / t.targets.length;
  t.sold += 1 / t.targets.length;
  t.hit++;
  t.stop = Math.max(t.stop, t.hit === 1 ? t.entry : t.targets[t.hit - 2]);
}
// the result in percent: the parts sold at targets and the rest at the exit price
export const result = (t, exit) => r2((t.market === "us" ? (t.value + (1 - t.sold) * exit - t.entry) / t.entry : (exit - t.entry) / t.entry) * 100);

// One look at the price. q: { price, high, low } since the last look (high and low may be the day's).
// Returns what happened, in order: { kind: "target", k, price, stop } | { kind: "trail", stop }
// | { kind: "stop", price, ret } | { kind: "done", ret } | { kind: "expired", price, ret }.
export function step(t, q, now = Date.now()) {
  const ev = [];
  const high = Math.max(q.high ?? q.price, q.price),
    low = Math.min(q.low ?? q.price, q.price);
  t.last = q.price;
  t.lastAt = now;
  // the stop first, as in the tests (a day that touched both is counted as stopped)
  if (low <= t.stop) {
    const px = Math.min(t.stop, q.price <= t.stop ? q.price : t.stop);
    ev.push({ kind: "stop", price: px, ret: result(t, px), hit: t.hit });
    t.closed = { at: now, price: px, ret: result(t, px), why: "stop" };
    return ev;
  }
  // your own position: a warning once a day when the price comes within 1% of your stop
  const day = new Date(now).toISOString().slice(0, 10);
  if (t.mine && low <= t.stop * 1.01 && t.nearDay !== day) {
    t.nearDay = day;
    ev.push({ kind: "near", price: q.price });
  }
  if (t.market === "us") {
    while (t.hit < t.targets.length && high >= t.targets[t.hit]) {
      take(t, t.targets[t.hit]);
      ev.push({ kind: "target", k: t.hit, price: t.targets[t.hit - 1], stop: t.stop });
    }
    if (t.hit === t.targets.length) {
      ev.push({ kind: "done", ret: result(t, t.targets.at(-1)) });
      t.closed = { at: now, price: t.targets.at(-1), ret: result(t, t.targets.at(-1)), why: "done" };
      return ev;
    }
  } else {
    while (t.hit < t.targets.length && high >= t.targets[t.hit]) {
      t.hit++;
      ev.push({ kind: "target", k: t.hit, price: t.targets[t.hit - 1], stop: null });
    }
  }
  if (high > t.high) t.high = high;
  if (t.trailDist) {
    const s = t.high - t.trailDist;
    // a step worth telling: the trailing stop moved by a third of its distance or more
    if (s > t.stop) {
      const moved = s - (t.told ?? t.stop0);
      t.stop = s;
      if (moved >= t.trailDist / 3 || ev.length) {
        t.told = s;
        for (const e of ev) e.stop = s;
        if (!ev.length) ev.push({ kind: "trail", stop: s });
      }
    }
  }
  if (now - t.opened > MAX_DAYS[t.market] * 86400e3) {
    ev.push({ kind: "expired", price: q.price, ret: result(t, q.price) });
    t.closed = { at: now, price: q.price, ret: result(t, q.price), why: "expired" };
  }
  return ev;
}

// The look from the day's candle: its high or low counts only where it went further than at the last
// look the same day, so a dip this morning doesn't hit a stop raised this afternoon. The first look
// (the trade's signal day starts with that day's range up to the signal).
export function fromBar(t, bar) {
  if (!bar?.close) return null;
  const day = new Date(bar.time * 1000).toISOString().slice(0, 10);
  const same = t.dDate === day;
  const q = { price: bar.close, high: !same || bar.high > t.dh ? bar.high : bar.close, low: !same || bar.low < t.dl ? bar.low : bar.close };
  t.dDate = day;
  t.dh = same ? Math.max(t.dh, bar.high) : bar.high;
  t.dl = same ? Math.min(t.dl, bar.low) : bar.low;
  return q;
}

// ---------- messages ----------
const FLAG = { us: "🇺🇸", kw: "🇰🇼", sa: "🇸🇦", ae: "🇦🇪" };
const moneyOf = (market, v) => (market === "us" ? `${n2(v)}$` : market === "sa" ? `${n2(v)} ريال` : market === "ae" ? `${n2(v)} درهم` : n2(v));
const n2 = (v) => (v == null || !Number.isFinite(v) ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 3 }));
const pct = (v) => `${v > 0 ? "+" : ""}${n2(r2(v))}%`;
export function message(t, e) {
  const money = (v) => moneyOf(t.market, v);
  const head = `${FLAG[t.market] || ""} ${t.code}${t.name ? ` (${t.name})` : ""}`;
  const fromEntry = (px) => pct(((px - t.entry) / t.entry) * 100);
  const n = t.targets.length;
  if (e.kind === "target") {
    const next = t.targets[e.k];
    if (t.market === "us")
      return [
        `✅ ${head}: تحقق الهدف ${e.k} من ${n} عند ${money(e.price)} (${fromEntry(e.price)} من الدخول)`,
        `📋 حسب الخطة: بيع 20% · ارفع الوقف إلى ${money(e.stop)}${e.k === 1 ? " (سعر الدخول: الصفقة صارت بلا خسارة)" : ` (الهدف ${e.k - 1})`}`,
        next ? `🎯 الهدف التالي: ${money(next)} (${fromEntry(next)})` : "",
      ].filter(Boolean).join("\n");
    return [
      `✅ ${head}: وصل للمقاومة ${e.k} من ${n} عند ${money(e.price)} (${fromEntry(e.price)} من الدخول)`,
      e.stop ? `🔒 الوقف المتحرك الآن: ${money(e.stop)} (${fromEntry(e.stop)})` : "",
      next ? `🧱 المقاومة التالية: ${money(next)}` : "الصفقة مستمرة بالوقف المتحرك.",
    ].filter(Boolean).join("\n");
  }
  if (e.kind === "trail") return `🔒 ${head}: ارتفع الوقف المتحرك إلى ${money(e.stop)} (${fromEntry(e.stop)} من الدخول) · آخر سعر ${money(t.last)}`;
  // the money for your own position: (price - cost) × shares, fils to dinars in Kuwait
  const pnl = (px) => (t.qty ? `\n💰 ${px >= t.entry ? "ربحك" : "خسارتك"}: ${n2(Math.abs(((px - t.entry) * t.qty) / (t.market === "kw" ? 1000 : 1)))} ${{ kw: "د.ك", us: "$", sa: "ريال", ae: "درهم" }[t.market]} (${fromEntry(px)})` : "");
  if (e.kind === "near") return `⚠️ ${head}: السعر ${money(e.price)} قريب من وقف الخسارة ${money(t.stop)} (يبعد ${n2(((e.price - t.stop) / e.price) * 100)}%)${pnl(t.stop).replace("💰 خسارتك", "💰 خسارتك لو ضرب الوقف")}\nراقب السهم.`;
  if (e.kind === "stop" && t.mine) return `🛑 ${head}: السعر وصل وقف الخسارة اللي حددته ${money(t.stop)} (آخر سعر ${money(e.price)}).${pnl(e.price)}\nهذا تنبيه، والبيع تسويه أنت من تطبيق الوسيط.`;
  if (e.kind === "target" && t.mine) return `✅ ${head}: وصل ${money(e.price)} (الهدف ${e.k} من ${n}).${pnl(e.price)}${t.targets[e.k] ? `\n🎯 اللي بعده: ${money(t.targets[e.k])}` : ""}`;
  if (e.kind === "stop") {
    if (t.market === "us" && e.hit) return `🔒 ${head}: رجع السعر لوقف الربح ${money(e.price)} بعد ${e.hit === 1 ? "الهدف الأول" : `${e.hit} أهداف`}. انتهت الصفقة.\n📊 النتيجة الإجمالية حسب الخطة: ${pct(e.ret)}`;
    return `${e.ret >= 0 ? "🔒" : "🛑"} ${head}: ضرب ${e.ret >= 0 ? "الوقف المتحرك" : "وقف الخسارة"} عند ${money(e.price)}. انتهت الصفقة.\n📊 النتيجة: ${pct(e.ret)}`;
  }
  if (e.kind === "done") return `🏆 ${head}: تحقق الهدف الخامس والأخير! اكتملت الصفقة.\n📊 النتيجة الإجمالية حسب الخطة: ${pct(e.ret)}`;
  if (e.kind === "expired") return `⌛ ${head}: انتهت مدة المتابعة (${MAX_DAYS[t.market]} يوم). السعر ${money(e.price)}، النتيجة لو أُغلقت الآن: ${pct(e.ret)}`;
  return "";
}

// ---------- the book ----------
const id = (t) => `${t.market}:${t.code}`;
export function open(t) {
  if (book.open[id(t)]) return false; // already followed: the first signal's plan stands
  book.open[id(t)] = t;
  save();
  return true;
}
export const remove = (key) => {
  if (!book.open[key]) return false;
  delete book.open[key];
  save();
  return true;
};
export const list = (market) => Object.values(book.open).filter((t) => !market || t.market === market);
export const closed = (market) => book.closed.filter((t) => !market || t.market === market);

// Look at every open trade of a market. quote(t) → { price, high, low } or null; send(text) delivers.
export async function check(market, quote, send, now = Date.now()) {
  let sent = 0;
  for (const t of list(market)) {
    const q = await quote(t).catch(() => null);
    if (!q?.price) continue;
    for (const e of step(t, q, now)) {
      const text = message(t, e);
      if (text) {
        await send(text, t).catch(() => {});
        sent++;
      }
    }
    if (t.closed) {
      delete book.open[id(t)];
      book.closed.unshift(t);
      book.closed = book.closed.slice(0, 200);
    }
  }
  save();
  return { sent, open: list(market).length };
}

// one line per open trade, for the close brief
export function summary(market) {
  const money = (v) => moneyOf(market, v);
  return list(market)
    .map((t) => `• ${t.code}: ${money(t.last)} (${pct(((t.last - t.entry) / t.entry) * 100)} من الدخول) · ${t.hit ? `حقق ${t.hit} من ${t.targets.length}` : "ما وصل هدف بعد"} · الوقف ${money(t.stop)}`)
    .join("\n");
}
