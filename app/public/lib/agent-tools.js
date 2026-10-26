// AskCharts AI's tools: what the AI may do in the app, the same things a person does on screen. One
// catalog for every door: the AI panel calls them through its provider's tool calling now, and an
// outside AI will reach the same list over MCP. Names are snake_case under 64 characters and inputs
// stay flat (no oneOf, anyOf or $ref), so Claude, OpenAI and Gemini all take them.
//
// `runs`: "page" tools run in the open AskCharts tab (the page holds the charts); "server" tools run
// on the server. `read`: changes nothing. `view`: changes only what's on screen, nothing saved (no
// Undo needed). Everything else is a change the person can undo.
//
// Never here, on purpose: JavaScript indicators (they run as code), keys and data feed settings,
// accounts and sign-in, files, free-form network access, alert webhooks, and
// paper or live trading.
import { TOOLS as DRAWING_TOOLS } from "../js/drawings.js";

// Drawing tools the AI may place: not the measuring tools that vanish, not the ones that need a
// file, a link, a glyph or freehand strokes.
const NOT_DRAWABLE = new Set(["ruler", "zoom", "image", "post", "idea", "table", "emoji", "sticker", "icon", "brush", "highlighter", "ghostfeed"]);
export const DRAWABLE = DRAWING_TOOLS.filter((t) => !t.ephemeral && !NOT_DRAWABLE.has(t.id));
const drawingList = DRAWABLE.map((t) => `${t.id} (${t.label}, ${t.points ? `${t.points} point${t.points > 1 ? "s" : ""}` : "2 or more points"})`).join("; ");

const chartArg = { type: "integer", minimum: 1, description: "Which chart in the layout, 1 for the first. Leave out for the active chart." };
const when = (what) => ({ type: "string", description: `${what}: a date and time in UTC, like 2026-10-19 or 2026-10-19T14:30.` });
const point = {
  type: "object",
  description: "One anchor. Give bars_ago (0 is the latest bar) or time, and either price or at.",
  properties: {
    bars_ago: { type: "integer", description: "Bars back from the latest bar on the chart (0 is the latest; negative goes into the future)." },
    time: when("Instead of bars_ago, the bar's time"),
    price: { type: "number", description: "The price. Leave out and give at to use a bar's own price." },
    at: { type: "string", enum: ["high", "low", "open", "close"], description: "Use this price of the bar at bars_ago or time." },
  },
};

export const AGENT_TOOLS = [
  // ---------- read ----------
  {
    name: "chart_read",
    runs: "page",
    read: true,
    description:
      "What is on the open charts now: the layout, each chart's symbol, interval, chart type, scale, visible dates, last bar, indicators (uid, id, inputs, latest values) and drawings (id, type, anchors). Use it before changing something that's already there.",
    input_schema: { type: "object", properties: { chart: chartArg, drawings: { type: "boolean", description: "Include the drawings' anchors (default true)." } } },
  },
  {
    name: "chart_snapshot",
    runs: "page",
    read: true,
    description: "A picture of a chart as it looks on screen, to see patterns, levels and drawings. Use it when the shape of the chart matters.",
    input_schema: { type: "object", properties: { chart: chartArg } },
  },
  {
    name: "market_search",
    runs: "page",
    read: true,
    description:
      "Find symbols by name or ticker. Returns exact symbols as EXCHANGE:TICKER (like KRAKEN:XRPUSD, BINANCE:BTCUSDT, US:AAPL). Always use a symbol from here when changing the chart; never guess one.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "A name, ticker or pair, like XRP, bitcoin, AAPL, EUR/USD." } }, required: ["query"] },
  },
  {
    name: "market_bars",
    runs: "page",
    read: true,
    description:
      "A symbol's bars: a summary (first and last time, high, low, change, average range) and the most recent bars as [time, open, high, low, close, volume]. Defaults to the active chart's symbol and interval.",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "EXCHANGE:TICKER from market_search. Leave out for the active chart's." },
        interval: { type: "string", description: "Like 1m, 15m, 1h, 4h, 1D, 1W. Leave out for the active chart's." },
        count: { type: "integer", minimum: 1, maximum: 200, description: "How many recent bars to return (default 60, at most 200)." },
      },
    },
  },
  {
    name: "market_levels",
    runs: "page",
    read: true,
    description:
      "Recent swing highs and lows, the last completed swing (for Fibonacci tools), and likely support and resistance levels near the price, each with exact times and prices. Use these as anchors for drawings.",
    input_schema: {
      type: "object",
      properties: {
        chart: chartArg,
        strength: { type: "integer", minimum: 2, maximum: 20, description: "How many bars on each side a swing must stand above or below (default 5; larger finds bigger swings)." },
        lookback: { type: "integer", minimum: 50, maximum: 2000, description: "How many recent bars to look at (default 300)." },
      },
    },
  },
  {
    name: "market_reader",
    runs: "page",
    read: true,
    description:
      "The Market Reader (قارئ السوق): one reading of a symbol on seven timeframes (monthly to 15 minutes): the overall trend and how many timeframes agree, each timeframe's trend with its nearest support and resistance, the nearest support and resistance on the main timeframe with touches and distance %, demand and supply zones, where the price sits between them, the market state (accumulation, distribution, breakout, breakdown, trend, squeeze, overbought or oversold), relative volume, money flow (inflow and outflow %, net, improving or not), a breakout or breakdown (or a near one) with whether volume confirms it, a technical signal balance (eight checks, each positive or negative), a levels plan (entry zone, invalidation, targets, reward to risk), RSI, ATR% and a one-line Arabic reading. Use it when someone asks about a symbol's situation, trend, levels or what the timeframes say; quote its numbers, not your own.",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "EXCHANGE:TICKER from market_search. Leave out for the active chart's symbol." },
        interval: { type: "string", enum: ["1M", "1W", "1D", "4h", "1h", "30m", "15m"], description: "The main timeframe for levels, zones and state (default: the active chart's, or 1D)." },
      },
    },
  },
  {
    name: "indicator_catalog",
    runs: "page",
    read: true,
    description: "Find indicators and strategies to add: built-ins, my Pine scripts and my own indicators, with their ids and inputs. Search by name or leave the query out for the list of names.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "Part of a name, like rsi, moving average, bollinger, supertrend." } } },
  },
  {
    name: "indicator_values",
    runs: "page",
    read: true,
    description: "The latest values of an indicator: one on a chart (by uid from chart_read), or any built-in indicator by id for any symbol and interval.",
    input_schema: {
      type: "object",
      properties: {
        chart: chartArg,
        uid: { type: "string", description: "An indicator on the chart, from chart_read." },
        id: { type: "string", description: "Or a built-in indicator id from indicator_catalog, worked out on the bars of symbol and interval." },
        symbol: { type: "string", description: "With id: EXCHANGE:TICKER. Leave out for the active chart's." },
        interval: { type: "string", description: "With id: like 1h or 1D. Leave out for the active chart's." },
        inputs: { type: "object", description: "With id: input values by key, from indicator_catalog." },
        count: { type: "integer", minimum: 1, maximum: 100, description: "How many recent values (default 10)." },
      },
    },
  },
  // ---------- the chart ----------
  {
    name: "chart_set",
    runs: "page",
    description:
      "Change a chart: its symbol, interval, chart type; the layout (how many charts); or the theme. Only what you give changes. The layout comes first, then the chart is picked, then the rest.",
    input_schema: {
      type: "object",
      properties: {
        chart: chartArg,
        layout: { type: "string", enum: ["1", "2v", "2h", "3", "4", "6", "8", "16"], description: "How many charts: 1, 2 side by side (2v), 2 stacked (2h), 3, 4, 6, 8 or 16." },
        symbol: { type: "string", description: "EXCHANGE:TICKER from market_search." },
        interval: { type: "string", description: "Like 1m, 5m, 15m, 1h, 4h, 1D, 1W, 1M." },
        type: {
          type: "string",
          enum: ["candles", "bars", "hollow", "volcandles", "line", "linemarkers", "step", "area", "hlcarea", "baseline", "columns", "highlow", "heikin", "renko", "linebreak", "kagi", "pnf", "range"],
          description: "The chart type.",
        },
        theme: { type: "string", enum: ["dark", "light"] },
      },
    },
  },
  {
    name: "chart_view",
    runs: "page",
    view: true,
    description: "Move or scale the view: show the last N bars, a date range, or center on a date; log scale on or off; auto scale; or reset the view.",
    input_schema: {
      type: "object",
      properties: {
        chart: chartArg,
        last_bars: { type: "integer", minimum: 5, maximum: 5000, description: "Show the last N bars." },
        from: when("Show from"),
        to: when("Show to"),
        go_to: when("Center the view on"),
        log: { type: "boolean", description: "Log price scale on or off." },
        auto_scale: { type: "boolean", description: "true fits the price scale to what's in view." },
        reset: { type: "boolean", description: "true resets the view, as a double-click on the time scale does." },
      },
    },
  },
  {
    name: "chart_compare",
    runs: "page",
    description: "Add a symbol to compare on a chart (the price scale switches to percent), or remove one.",
    input_schema: {
      type: "object",
      properties: { chart: chartArg, add: { type: "string", description: "EXCHANGE:TICKER from market_search." }, remove: { type: "string", description: "A compared symbol to remove." } },
    },
  },
  {
    name: "chart_replay",
    runs: "page",
    view: true,
    description: "Bar replay: start at a date or some bars back, step forward or back, play, pause, or stop and go back to live.",
    input_schema: {
      type: "object",
      properties: {
        chart: chartArg,
        action: { type: "string", enum: ["start", "step", "play", "pause", "stop"] },
        start: when("With start, the bar to start from"),
        bars_ago: { type: "integer", minimum: 1, description: "With start, instead of a date: start this many bars back." },
        steps: { type: "integer", description: "With step: how many bars (negative steps back). Default 1." },
      },
      required: ["action"],
    },
  },
  // ---------- indicators ----------
  {
    name: "indicator_add",
    runs: "page",
    description: "Add an indicator or strategy to a chart, by id from indicator_catalog, with input values and colors. Returns its uid. One with the same id and inputs already on the chart isn't added twice: its uid comes back with already: true.",
    input_schema: {
      type: "object",
      properties: {
        chart: chartArg,
        id: { type: "string", description: "The id from indicator_catalog, like rsi, ema, bb, macd, pine:myscript." },
        inputs: { type: "object", description: "Input values by key (from indicator_catalog), like {\"length\": 50}. Leave out for the defaults." },
        colors: { type: "object", description: "Line colors by output key, as #rrggbb, like {\"plot\": \"#2962ff\"}." },
      },
      required: ["id"],
    },
  },
  {
    name: "indicator_edit",
    runs: "page",
    description: "Change an indicator on a chart: its inputs, colors, or hide or show it. Find its uid with chart_read.",
    input_schema: {
      type: "object",
      properties: {
        chart: chartArg,
        uid: { type: "string" },
        inputs: { type: "object", description: "Input values to change, by key." },
        colors: { type: "object", description: "Colors to change, by output key, as #rrggbb." },
        hidden: { type: "boolean" },
      },
      required: ["uid"],
    },
  },
  {
    name: "indicator_remove",
    runs: "page",
    description: "Remove indicators from a chart by uid, or all of them. Removing more than one asks the person first.",
    input_schema: { type: "object", properties: { chart: chartArg, uids: { type: "array", items: { type: "string" } }, all: { type: "boolean" } } },
  },
  {
    name: "favorite_set",
    runs: "page",
    description: "Make an indicator or strategy a favorite (shown in the Indicators dialog's Favorites and the favorites menu), or take it off.",
    input_schema: { type: "object", properties: { id: { type: "string", description: "The id from indicator_catalog." }, on: { type: "boolean" } }, required: ["id", "on"] },
  },
  // ---------- drawings ----------
  {
    name: "drawing_add",
    runs: "page",
    description: `Draw on a chart. Anchors use bars_ago or time, with price or at; never invent times or prices, take them from market_levels, market_bars or chart_read. Types and their anchors: ${drawingList}.`,
    input_schema: {
      type: "object",
      properties: {
        chart: chartArg,
        type: { type: "string", enum: DRAWABLE.map((t) => t.id) },
        points: { type: "array", items: point, description: "The anchors, in order (a Fibonacci retracement goes from the swing's start to its end)." },
        text: { type: "string", description: "Text for text, note, callout and similar tools." },
        color: { type: "string", description: "#rrggbb. Leave out for the tool's own color." },
        risk_reward: { type: "number", description: "For long and short positions: the target as a multiple of the risk (default 1)." },
      },
      required: ["type", "points"],
    },
  },
  {
    name: "drawing_edit",
    runs: "page",
    description: "Change a drawing by id (from chart_read): its anchors, text or color; lock or unlock; hide or show.",
    input_schema: {
      type: "object",
      properties: {
        chart: chartArg,
        id: { type: "string" },
        points: { type: "array", items: point, description: "New anchors, all of them, in order." },
        text: { type: "string" },
        color: { type: "string", description: "#rrggbb" },
        locked: { type: "boolean" },
        hidden: { type: "boolean" },
      },
      required: ["id"],
    },
  },
  {
    name: "drawing_remove",
    runs: "page",
    description: "Remove drawings by id, or all on the chart's symbol. More than three, or all, asks the person first.",
    input_schema: { type: "object", properties: { chart: chartArg, ids: { type: "array", items: { type: "string" } }, all: { type: "boolean" } } },
  },
  // ---------- lists ----------
  {
    name: "watchlist_edit",
    runs: "page",
    description: "Add symbols to a watchlist or remove them, or start a new list. Defaults to the list on screen.",
    input_schema: {
      type: "object",
      properties: {
        list: { type: "string", description: "The list's name. Leave out for the active list." },
        create: { type: "boolean", description: "true starts a new list named list." },
        add: { type: "array", items: { type: "string" }, description: "EXCHANGE:TICKER symbols from market_search." },
        remove: { type: "array", items: { type: "string" } },
      },
    },
  },
];

export const AGENT_TOOL_BY_NAME = Object.fromEntries(AGENT_TOOLS.map((t) => [t.name, t]));

// The provider's view of a tool: name, description and inputs only.
// Two indicators the same: one id, every input equal (an input left out reads as its default)
export const sameIndicator = (def, a, b) => a.id === b.id && (def?.inputs || []).every((i) => String(a.params?.[i.key] ?? i.default) === String(b.params?.[i.key] ?? i.default));

export const toolSpecs = () => AGENT_TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
