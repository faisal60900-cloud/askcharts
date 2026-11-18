// 🏛️ US politicians' stock trades (members of Congress, from their STOCK Act filings), through
// Bargo's free Congress Trades API (keyless: 30 calls and 100 rows a day per address, so it is
// read every 2 hours at most). The fields are read by name loosely, since the API's own names
// aren't documented in one place.
const API = "https://www.bargo.ai/free-apis/congress/v1/trades";

const pick = (o, ...names) => {
  for (const n of names) {
    const k = Object.keys(o || {}).find((x) => x.toLowerCase() === n.toLowerCase());
    if (k && o[k] != null && o[k] !== "") return o[k];
  }
  return null;
};

// "$1,001 - $15,000" or { min, max } or a number → { lo, hi }
export function amountOf(v) {
  if (v == null) return { lo: 0, hi: 0 };
  if (typeof v === "number") return { lo: v, hi: v };
  if (typeof v === "object") return { lo: Number(pick(v, "min", "low", "from")) || 0, hi: Number(pick(v, "max", "high", "to")) || 0 };
  const nums = String(v).replace(/,/g, "").match(/\d+(\.\d+)?/g)?.map(Number) || [];
  const m = /m(il)?/i.test(String(v)) && !/\$\s*\d{1,3}(,\d{3}){2}/.test(String(v)) ? 1e6 : 1;
  return { lo: (nums[0] || 0) * m, hi: (nums[1] ?? nums[0] ?? 0) * m };
}

// one row of the API → { who, chamber, party, state, code, asset, type ("buy"|"sell"|...), lo, hi, txDate, filed }
export function normalize(r) {
  const who = pick(r, "member", "name", "politician", "representative", "senator", "full_name", "memberName");
  const t = String(pick(r, "transactionType", "transaction_type", "type", "transaction", "txType") || "").toLowerCase();
  const lo0 = Number(pick(r, "amount_low", "amountLow")), hi0 = Number(pick(r, "amount_high", "amountHigh"));
  const amt = lo0 || hi0 ? { lo: lo0 || 0, hi: hi0 || lo0 || 0 } : amountOf(pick(r, "amount_range", "amount", "valueRange", "value_range", "range", "amountRange", "size", "value"));
  return {
    who: typeof who === "object" ? pick(who, "name", "full_name") : who,
    chamber: pick(r, "chamber", "house"),
    party: pick(r, "party"),
    state: pick(r, "state"),
    code: String(pick(r, "ticker", "symbol", "issuerTicker") || "").toUpperCase().replace(/[^A-Z.]/g, ""),
    asset: pick(r, "assetDescription", "asset_description", "asset", "issuer", "description"),
    type: /purchase|buy/.test(t) ? "buy" : /sale|sell/.test(t) ? "sell" : t || null,
    lo: amt.lo,
    hi: amt.hi,
    est: Number(pick(r, "est_price", "estPrice")) || null,
    txDate: String(pick(r, "transactionDate", "transaction_date", "txDate", "traded") || "").slice(0, 10),
    filed: String(pick(r, "disclosureDate", "disclosure_date", "filedDate", "filed", "pubDate", "reported") || "").slice(0, 10),
  };
}

export async function trades({ fromDate, fetchImpl = fetch } = {}) {
  const u = new URL(API);
  if (fromDate) u.searchParams.set("fromDate", fromDate);
  const res = await fetchImpl(u, { headers: { accept: "application/json", "user-agent": "AskCharts/1.0" }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Congress trades ${res.status}`);
  const j = await res.json();
  const rows = Array.isArray(j) ? j : j.trades || j.data || j.results || j.items || [];
  return { raw: rows.slice(0, 2), rows: rows.map(normalize) };
}

// the big buys worth a message: a purchase of a listed stock, at least $50,000 at the top of its range
export const bigBuys = (rows, { min = 50e3 } = {}) => rows.filter((r) => r.type === "buy" && r.code && /^[A-Z]{1,5}(\.[A-Z])?$/.test(r.code) && r.hi >= min);
