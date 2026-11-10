// 🕌 فلتر الشرعية: which stocks the bot may recommend, on the AAOIFI screens (the standard most
// Gulf Shariah boards use):
//   1. the activity: no conventional banks, insurance or lending, no alcohol, tobacco, pork,
//      gambling or casinos, no mortgage REITs;
//   2. the debt: interest-bearing debt under 30% of the market value;
//   3. the cash: cash and short-term investments (interest-bearing) under 30% of the market value.
// The interest income (under 5% of revenue) isn't in the free statements, so it isn't checked.
// US stocks get all three (Nasdaq's industry, balance sheet and market value, kept 30 days);
// Kuwaiti ones the activity (the conventional banks and insurers by name). Other markets pass.
// This is a screen, not a fatwa.
import * as store from "./store.js";
import { financials } from "./market-info.js";

const KEY = "sharia";
// the rules' version: a change of the lists clears the kept screens
const VERSION = 2;
let st = store.read(KEY, { on: true, cache: {} });
if (st.v !== VERSION) st = { ...st, v: VERSION, cache: {} };
const save = () => store.write(KEY, st);
export const reset = (s = { on: true, cache: {} }) => (st = { v: VERSION, ...s });
export const settings = () => ({ on: st.on !== false, cached: Object.keys(st.cache || {}).length });
export function setOn(on) {
  st.on = !!on;
  save();
  return settings();
}

export const DEBT_MAX = 30;
export const CASH_MAX = 30;
const DAY = 86400e3;

// activities by Nasdaq's industry
const BAD_INDUSTRY = [
  [/\bbanks?\b|savings institutions|savings & loan/i, "بنك تقليدي (فوائد)"],
  [/insurance|insurers/i, "تأمين تقليدي"],
  [/finance companies|investment bankers|brokers|investment managers|finance\/investors services|consumer lending|specialty finance|mortgage|credit services|capital markets|asset management/i, "تمويل بالفوائد"],
  [/cigarettes|tobacco/i, "تبغ"],
  [/casino|gaming|gambling|lotter|betting/i, "قمار"],
  [/beer|wine|distill|brewer|liquor|alcohol/i, "خمور"],
];
// activities a broad industry hides (beverages, food, REITs, hotels): by the company
const BAD_CODES = {
  "خمور": ["TAP", "STZ", "BF.A", "BF.B", "BF-B", "DEO", "SAM", "BUD", "MGPI", "ABEV", "CCU", "WVVI", "VINE", "EAST"],
  "لحم خنزير": ["HRL", "TSN", "SFD"],
  "قمار وكازينوهات": ["LVS", "WYNN", "MGM", "CZR", "PENN", "DKNG", "BYD", "CHDN", "RSI", "FLUT", "GDEN", "MCRI", "IGT", "LNW", "BALY", "VICI", "GLPI", "EVRI", "SGHC", "GAMB", "AGS", "INSE", "ACEL", "MLCO"],
  "تبغ": ["MO", "PM", "BTI", "VGR", "TPB", "UVV", "ISPR", "KAVL", "XXII"],
  "تمويل عقاري بالفوائد": ["AGNC", "NLY", "STWD", "BXMT", "ABR", "RITM", "TWO", "ARI", "LADR", "KREF", "TRTX", "PMT", "MFA", "CIM", "EFC", "DX", "ORC", "IVR", "RC", "ACRE", "MITT", "NYMT", "ARR", "BRSP", "GPMT", "FBRT", "SEVN"],
  // "Finance: Consumer Services" mixes lenders with bitcoin miners, data centres and rating
  // agencies: the lenders by name
  "إقراض وبطاقات ائتمان بالفوائد": ["AXP", "SOFI", "AFRM", "UPST", "SYF", "ALLY", "DFS", "COF", "OMF", "SLM", "NAVI", "LC", "ENVA", "CACC", "WRLD", "OPRT", "PRAA", "ECPG", "NNI", "LPRO", "MRLN", "OPFI", "DAVE", "MQ", "PGY", "RM", "ATLC", "QD", "FINV", "LX", "YRD", "CPSS", "NAVI", "BFH", "NMIH", "ESNT", "RDN", "MTG"],
  "إقراض (شركات تطوير الأعمال)": ["MAIN", "ARCC", "FSK", "OBDC", "BXSL", "GBDC", "HTGC", "PSEC", "TSLX", "OCSL", "GSBD", "NMFC", "CSWC", "TRIN", "CGBD", "BBDC", "SLRC", "FDUS", "GAIN", "PFLT", "TCPC", "CCAP", "MFIC", "OFS", "HRZN", "TPVG", "SAR", "WHF", "PNNT", "BCSF", "CION", "MSDL", "KBDC", "PSBD", "NCDL"],
};
const CODE_WHY = Object.fromEntries(Object.entries(BAD_CODES).flatMap(([why, list]) => list.map((c) => [c, why])));

// Kuwait: the conventional banks and insurers (the Islamic ones, KFH, Boubyan, Warba, KIB, pass)
const KW_BAD = {
  NBK: "بنك تقليدي (فوائد)", GBK: "بنك تقليدي (فوائد)", CBK: "بنك تقليدي (فوائد)", ABK: "بنك تقليدي (فوائد)", BURG: "بنك تقليدي (فوائد)",
  GINS: "تأمين تقليدي", KINS: "تأمين تقليدي", AINS: "تأمين تقليدي", WINSRE: "تأمين تقليدي", KUWAITRE: "إعادة تأمين تقليدي",
};

const plain = (code) => String(code || "").replace(/^[A-Z]{2}:/, "").toUpperCase();
const kwOf = (code) => /^KW:/i.test(String(code || ""));

// the activity alone, from the industry and the code
export function activity({ code, industry = "" } = {}) {
  const c = plain(code);
  if (kwOf(code)) return KW_BAD[c] ? { ok: false, why: KW_BAD[c] } : { ok: true };
  if (CODE_WHY[c]) return { ok: false, why: CODE_WHY[c] };
  for (const [re, why] of BAD_INDUSTRY) if (re.test(industry)) return { ok: false, why };
  return { ok: true };
}

// "$2,273,497" (thousands) → 2273497000; "--" → 0
const money = (v) => {
  const s = String(v ?? "").replace(/[$,\s]/g, "");
  if (!s || s === "--") return 0;
  const n = Number(s.replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(n) ? n * 1000 : 0;
};
const row = (table, re) => {
  const r = (table?.rows || []).find((x) => re.test(String(x[0] ?? x.label ?? "")));
  return r ? money(r[1] ?? r.values?.[0]) : 0;
};
const stat = (stats, label) => (stats || []).find((s) => s.label === label)?.value || "";

// the three screens from Nasdaq's quarterly statements
export function screen(f, code) {
  const industry = stat(f?.stats, "Industry");
  const act = activity({ code, industry });
  if (!act.ok) return { status: "no", why: act.why };
  const cap = Number(String(stat(f?.stats, "Market Cap")).replace(/[$,]/g, "")) || 0;
  if (!(cap > 0) || !f?.balance) return { status: "unknown", why: "ما في بيانات مالية كافية" };
  const debt = row(f.balance, /^Short-Term Debt/i) + row(f.balance, /^Long-Term Debt/i);
  const cash = row(f.balance, /^Cash and Cash Equivalents/i) + row(f.balance, /^Short-Term Investments/i);
  const debtPct = (debt / cap) * 100, cashPct = (cash / cap) * 100;
  const r = { debtPct: Math.round(debtPct * 10) / 10, cashPct: Math.round(cashPct * 10) / 10 };
  if (debtPct >= DEBT_MAX) return { status: "no", why: `الديون ${Math.round(debtPct)}% من قيمة الشركة (الحد ${DEBT_MAX}%)`, ...r };
  if (cashPct >= CASH_MAX) return { status: "no", why: `الكاش والودائع ${Math.round(cashPct)}% من قيمة الشركة (الحد ${CASH_MAX}%)`, ...r };
  return { status: "ok", ...r };
}

// one stock: { status: "ok" | "no" | "unknown", why?, debtPct?, cashPct? }, kept 30 days
export async function check(code, { finImpl = financials, now = Date.now() } = {}) {
  const c = String(code || "").toUpperCase();
  const id = /^[A-Z]{2}:/.test(c) ? c : `US:${c}`;
  if (!id.startsWith("US:")) {
    const a = activity({ code: id });
    return a.ok ? { status: id.startsWith("KW:") ? "ok" : "unknown", ...(id.startsWith("KW:") ? { note: "فحص النشاط بس" } : {}) } : { status: "no", why: a.why };
  }
  const hit = st.cache[id];
  if (hit && now - hit.at < 30 * DAY) return hit.r;
  // the activity first: a bank or a brewer needs no statements
  const a = activity({ code: id });
  let r;
  if (!a.ok) r = { status: "no", why: a.why };
  else r = screen(await finImpl(id, "quarterly").catch(() => null), id);
  // an unknown (a failed fetch) is kept a day only
  st.cache[id] = { at: r.status === "unknown" ? now - 29 * DAY : now, r };
  save();
  return r;
}

// keep only the compliant ones (unknown ones too, marked), when the filter is on.
// codeOf(item) gives the code ("UBER", "US:UBER", "KW:NBK"). Six at a time.
export async function keep(items, codeOf = (x) => x.code, opts = {}) {
  if (st.on === false || !items?.length) return items || [];
  const res = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const k = i++;
      res[k] = await check(codeOf(items[k]), opts).catch(() => ({ status: "unknown" }));
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, items.length) }, worker));
  return items.filter((_, k) => res[k].status !== "no");
}

// one line for a stock's message
export const label = (r) =>
  !r ? "" : r.status === "ok" ? `🕌 متوافق مع الشريعة${r.debtPct != null ? ` (الديون ${Math.round(r.debtPct)}%، الكاش ${Math.round(r.cashPct)}%)` : r.note ? ` (${r.note})` : ""}` : r.status === "no" ? `⛔ غير متوافق: ${r.why}` : "⚠️ الشرعية: ما قدرت أتأكد";
