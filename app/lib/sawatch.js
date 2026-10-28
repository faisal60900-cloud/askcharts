// Saudi market watch (مراقبة السوق السعودي): Tadawul, Sunday to Thursday, 10:00-15:00 Riyadh time
// (UTC+3, the same clock as Kuwait) and the closing auction to 15:10. Tested from 2022, no way of
// buying Saudi stocks made money in 2025-2026 (the market fell), so the buy alerts stay off by
// default and the market's turn is what gets a message (lib/gulfwatch.js).
import { createWatch, marketOf } from "./gulfwatch.js";
import { SAUDI_STOCKS } from "../public/lib/saudi-market.js";

const W = createWatch({
  market: "sa",
  list: SAUDI_STOCKS,
  flag: "🇸🇦",
  title: "السوق السعودي",
  cur: "ريال",
  utc: 3,
  days: [0, 1, 2, 3, 4],
  open: 10 * 60,
  end: 15 * 60 + 10,
  closeFrom: 15 * 60 + 20,
  closeTo: 16 * 60,
  minValue: 5e6,
  regimeUp: "هذي أول علامة إن الاتجاه النازل ممكن ينتهي. في فترات الصعود (2022–2024) كانت اختراقات القمم تربح، فنقدر نرجع نختبر ونشغل توصيات السعودية. ما زالت علامة مبكرة، ويمكن يرجع ينزل تحت المتوسط.",
  regimeDown: "الاتجاه العام صار نازل: تاريخيًا أغلب صفقات الشراء القصيرة خسرت في هالحالة. الحذر أولى.",
});
export const { sessionOpen, closeWindow, settings, update, entryMessage, regimeMessage, regimeCheck, runOnce, closeBrief, checkTrades, follow, track, start, stop } = W;
export const riyadh = W.clock;
export { marketOf };
