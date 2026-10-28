// Dubai market watch (مراقبة سوق دبي): DFM, Monday to Friday, 10:00-15:00 UAE time (UTC+4, 9:00-14:00
// in Kuwait). The same scan, alerts and follow-up as the Saudi one (lib/gulfwatch.js).
import { createWatch } from "./gulfwatch.js";
import { UAE_STOCKS } from "../public/lib/uae-market.js";

const W = createWatch({
  market: "ae",
  list: UAE_STOCKS,
  flag: "🇦🇪",
  title: "سوق دبي",
  cur: "درهم",
  utc: 4,
  days: [1, 2, 3, 4, 5],
  open: 10 * 60,
  end: 15 * 60,
  closeFrom: 15 * 60 + 10,
  closeTo: 16 * 60,
  minValue: 2e6,
  regimeUp: "الاتجاه العام لسوق دبي صار صاعد، وإشارات الاختراق تاريخيًا أحسن في هالحالة.",
  regimeDown: "الاتجاه العام لسوق دبي صار نازل: الحذر أولى، وإشارات الشراء تاريخيًا أضعف في هالحالة.",
});
export const { sessionOpen, closeWindow, settings, update, entryMessage, regimeMessage, regimeCheck, runOnce, closeBrief, checkTrades, follow, track, start, stop } = W;
export const clock = W.clock;
