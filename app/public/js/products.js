// TradingView's Products menu (the grid button on the right toolbar): every tool here opens a panel
// on the right or a tab of the bottom panel. A starred one also gets its own toolbar button, in
// this order. Plain data, so the server's Copilot guide can read it too. Icons are drawn in a 28px
// box at TradingView's sizes (about 24px, thin lines). AskCharts AI's is a robot,
// drawn a little past its box (see app.css), a touch wider than the radar.
export const PRODUCTS = [
  { id: "copilot", label: "AskCharts AI", tip: "AskCharts AI", panel: "copilot", icon: '<circle class="fill" cx="14" cy="2.44" r="2.16"/><path d="M14 4.5v3.83"/><rect x="1.7" y="8.33" width="24.6" height="18.84" rx="6.26"/><path class="fill" d="M1.7 14.36h-.63a2.14 2.14 0 0 0-2.14 2.14v2.64a2.14 2.14 0 0 0 2.14 2.14h.63zM26.3 14.36h.63a2.14 2.14 0 0 1 2.14 2.14v2.64a2.14 2.14 0 0 1-2.14 2.14h-.63z"/><circle class="fill" cx="9.11" cy="16.62" r="1.88"/><circle class="fill" cx="18.89" cy="16.62" r="1.88"/><path d="M10.74 21.27Q14 24.91 17.26 21.27"/>' },
  { id: "reader", label: "Market Reader", tip: "قارئ السوق (Market Reader)", panel: "reader", icon: '<path d="M3 25h22"/><path d="M6 21v-6M11 21V9M16 21v-8M21 21V5"/><circle cx="21" cy="5" r="1.6" class="fill"/>' },
  { id: "screener", label: "Screener", bottom: "screener", icon: '<circle cx="14" cy="14" r="13.4"/><circle cx="14" cy="14" r="7.3"/><path d="M14 14l8.5-8.5"/><circle cx="14" cy="14" r="1.1" class="fill"/>' },
  { id: "pine", label: "Pine Editor", panel: "pine", icon: '<path d="M14 3l6 8H8z"/><path d="M8.5 13.5h11l6.5 12H2z"/>' },
  { id: "calendar", label: "Calendars", panel: "calendar", icon: '<rect x="2.5" y="5" width="23" height="20.5" rx="2.5"/><path d="M2.5 10.5h23M9 2.5v5M19 2.5v5"/>' },
  { id: "news", label: "News", panel: "news", icon: '<path d="M3.5 14.5a10 10 0 0 1 10 10M3.5 8.5a16 16 0 0 1 16 16M3.5 2.5a22 22 0 0 1 22 22"/><circle cx="4.6" cy="23.4" r="1.5" class="fill"/>' },
  { id: "tester", label: "Strategy tester", bottom: "tester", icon: '<path d="M3 25h22M4 20l6-7 4.5 3.5L22 7"/><path d="M17 7h5v5"/>' },
  { id: "heatmap", label: "Heatmap", bottom: "heatmap", icon: '<rect x="3" y="3" width="13" height="13" rx="1.5"/><rect x="18" y="3" width="7" height="8" rx="1.5"/><rect x="18" y="13" width="7" height="12" rx="1.5"/><rect x="3" y="18" width="13" height="7" rx="1.5"/>' },
  { id: "seasonals", label: "Seasonals", bottom: "seasonals", icon: '<path d="M3 25h22M6 22v-7M11 22V8M16 22v-9M21 22V4"/>' },
  { id: "financials", label: "Financials", bottom: "financials", icon: '<path d="M6 2.5h11l5.5 5.5v17.5H6z"/><path d="M17 2.5V8h5.5M10 13.5h8M10 17.5h8M10 21.5h5"/>' },
  { id: "paper", label: "Paper trading", bottom: "paper", icon: '<rect x="2.5" y="8" width="23" height="16" rx="2"/><path d="M10 8V5h8v3M2.5 14.5h23M12.5 14.5v3h3v-3"/>' },
  { id: "editor", label: "Indicator editor", bottom: "editor", icon: '<path d="M9.5 7.5L3 14l6.5 6.5M18.5 7.5L25 14l-6.5 6.5M16 4l-4 20"/>' },
];
export const SOCIAL = [
  { id: "notifications", label: "Notifications", panel: "notifications", icon: '<path d="M14 2v2.5M6 19.5v-7a8 8 0 0 1 16 0v7l3 3.5H3z"/><path d="M10.5 23a3.5 3.5 0 0 0 7 0"/>' },
];
export const ALL_PRODUCTS = [...PRODUCTS, ...SOCIAL];
// The toolbar before anything is starred or unstarred: TradingView's own set, for this terminal.
export const DEFAULT_FAVORITES = ["copilot", "reader", "screener", "pine", "calendar", "news", "notifications"];
