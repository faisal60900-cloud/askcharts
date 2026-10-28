// Get ready (👀 استعد): a buy signal needs the breakout to have happened, so it can only come after
// the price has started to move. This is the warning before it: a stock just under a tested
// resistance, volume already above normal, money coming in and buying ahead, so the level can be
// watched (or an order placed at it) before it breaks. One per stock a day, the closest few a scan.
import { FILTERS } from "../public/lib/kuwait-scan.js";

const FLAG = { kw: "🇰🇼", us: "🇺🇸", sa: "🇸🇦", ae: "🇦🇪" };
const n2 = (v, d = 2) => (v == null || !Number.isFinite(v) ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d }));
const money = (m) => (v) => (m === "us" ? `${n2(v)}$` : m === "kw" ? `${n2(v)} فلس` : m === "sa" ? `${n2(v)} ريال` : `${n2(v)} درهم`);

// What else each market's signal asks for, besides the breakout itself (lib/kuwait-scan.js).
const NEED = {
  us: "سيولة الاختراق 2x فأكثر",
  ae: "سيولة 2x فأكثر وإغلاق قرب قمة اليوم",
  kw: "سيولة واضحة وإغلاق قرب قمة اليوم",
  sa: "سيولة واضحة وإغلاق قرب قمة اليوم",
};

export const distance = (r) => (r.breakout?.level && r.price ? ((r.breakout.level - r.price) / r.price) * 100 : null);

// The stocks worth a warning now: just under the level, and everything else already in place.
export function candidates(rows, market, minValue = 0, max = 3) {
  return rows
    .filter((r) => !r.error && !r.entry && r.breakout?.dir === "near" && (r.value ?? 0) >= minValue)
    .filter((r) => FILTERS.inflow.test(r) && FILTERS.buying.test(r) && FILTERS.signals.test(r))
    .filter((r) => (market === "us" ? true : FILTERS.weeklyUp.test(r)))
    .filter((r) => {
      const d = distance(r);
      return d != null && d > 0 && d <= 2;
    })
    .sort((a, b) => distance(a) - distance(b))
    .slice(0, max);
}

export function message(r, market) {
  const $ = money(market);
  const lvl = r.breakout.level,
    d = distance(r);
  const p = r.plan;
  return [
    `👀${FLAG[market]} استعد — ${r.code}${r.ar ? ` ${r.ar}` : r.en && r.en !== r.code ? ` (${r.en})` : ""}`,
    `السعر ${$(r.price)} تحت مقاومة ${$(lvl)} بـ ${n2(d, 1)}% بس`,
    `💧 السيولة ${n2(r.relVol, 1)}x من المعتاد · داخلة ${r.flow?.inflowPct}% · الشراء اليوم ${r.buyToday}%`,
    `🚦 تصير إشارة شراء إذا اخترق ${$(lvl)} مع ${NEED[market]}.`,
    p ? `🛑 لو صار: الوقف المبدئي تقريبًا ${$(p.stop)}` : "",
    `💡 عشان ما تتأخر: راقب ${$(lvl)}، أو تقدر تحط أمر شراء مشروط (Stop) فوقه بشوي من تطبيق الوسيط.`,
    "تنبيه مبكر للمراقبة، وليس إشارة شراء. كثير من هالحالات ما تخترق.",
  ]
    .filter(Boolean)
    .join("\n");
}

// Send the new ones: `sent` is the watcher's state object, keyed by stock and day.
export async function sendNew(rows, market, { minValue = 0, date, sent, send }) {
  let n = 0;
  for (const r of candidates(rows, market, minValue)) {
    const k = `${r.code}|${date}`;
    if (sent[k]) continue;
    sent[k] = Date.now();
    await send(message(r, market), r).catch(() => {});
    n++;
  }
  for (const [k, at] of Object.entries(sent)) if (Date.now() - at > 3 * 86400e3) delete sent[k];
  return n;
}
