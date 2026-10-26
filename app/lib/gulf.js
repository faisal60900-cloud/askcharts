// Gulf stocks: Boursa Kuwait (and the largest Saudi names), findable by ticker, English name or
// Arabic name. They chart through Yahoo as YAHOO:<code>.KW / YAHOO:<code>.SR, which resolve()
// already handles; this list is what lets search find "الوطني" or "بيتك" or "zain".
//
// Kuwaiti prices from Yahoo are in fils (1 KWD = 1000 fils), the way Boursa Kuwait quotes them.
// Boursa Kuwait trades Sunday to Thursday, 9:00 to 12:30 Kuwait time; Tadawul Sunday to Thursday, 10:00 to 15:00.

export const GULF = [
  // Kuwait — banks
  { t: "NBK.KW", en: "National Bank of Kuwait", ar: ["بنك الكويت الوطني", "الوطني", "الوطني الكويتي"] },
  { t: "KFH.KW", en: "Kuwait Finance House", ar: ["بيت التمويل الكويتي", "بيتك", "بيت التمويل"] },
  { t: "BOUBYAN.KW", en: "Boubyan Bank", ar: ["بنك بوبيان", "بوبيان"] },
  { t: "GBK.KW", en: "Gulf Bank", ar: ["بنك الخليج", "الخليج"] },
  { t: "WARBABANK.KW", en: "Warba Bank", ar: ["بنك وربة", "وربة"] },
  { t: "CBK.KW", en: "Commercial Bank of Kuwait", ar: ["البنك التجاري الكويتي", "التجاري"] },
  { t: "ABK.KW", en: "Al Ahli Bank of Kuwait", ar: ["البنك الأهلي الكويتي", "الأهلي"] },
  { t: "BURG.KW", en: "Burgan Bank", ar: ["بنك برقان", "برقان"] },
  { t: "KIB.KW", en: "Kuwait International Bank", ar: ["بنك الكويت الدولي", "الدولي"] },
  // Kuwait — telecom
  { t: "ZAIN.KW", en: "Zain (Mobile Telecommunications)", ar: ["زين"] },
  { t: "OOREDOO.KW", en: "Ooredoo Kuwait (National Mobile Telecom)", ar: ["أريدو", "اوريدو", "الوطنية للاتصالات"] },
  { t: "STC.KW", en: "stc Kuwait (Kuwait Telecommunications)", ar: ["إس تي سي", "stc الكويت", "الكويتية للاتصالات"] },
  // Kuwait — real estate, industry, services
  { t: "MABANEE.KW", en: "Mabanee", ar: ["المباني", "مباني"] },
  { t: "KRE.KW", en: "Kuwait Real Estate Company", ar: ["عقارات الكويت"] },
  { t: "URC.KW", en: "United Real Estate Company", ar: ["المتحدة العقارية"] },
  { t: "AGLTY.KW", en: "Agility", ar: ["أجيليتي", "اجيليتي", "المخازن العمومية"] },
  { t: "HUMANSOFT.KW", en: "Humansoft", ar: ["هيومن سوفت"] },
  { t: "BOURSA.KW", en: "Boursa Kuwait Securities", ar: ["بورصة الكويت", "البورصة"] },
  { t: "NIND.KW", en: "National Industries Group", ar: ["مجموعة الصناعات الوطنية", "الصناعات الوطنية"] },
  { t: "KPROJ.KW", en: "Kuwait Projects Company (KIPCO)", ar: ["مشاريع الكويت", "كيبكو"] },
  { t: "JAZEERA.KW", en: "Jazeera Airways", ar: ["طيران الجزيرة", "الجزيرة"] },
  { t: "MEZZAN.KW", en: "Mezzan Holding", ar: ["ميزان"] },
  { t: "GINS.KW", en: "Gulf Insurance Group", ar: ["الخليج للتأمين", "مجموعة الخليج للتأمين"] },
  { t: "BPCC.KW", en: "Boubyan Petrochemical", ar: ["بوبيان للبتروكيماويات"] },
  { t: "ALG.KW", en: "Ali Alghanim Sons Automotive", ar: ["علي الغانم", "الغانم للسيارات"] },
  { t: "CABLE.KW", en: "Gulf Cables & Electrical Industries", ar: ["الخليج للكابلات", "الكابلات"] },
  { t: "GFH.KW", en: "GFH Financial Group", ar: ["جي إف إتش", "بيت التمويل الخليجي"] },
  // Saudi (Tadawul) — the largest names
  { t: "2222.SR", en: "Saudi Aramco", ar: ["أرامكو", "ارامكو", "أرامكو السعودية"] },
  { t: "1120.SR", en: "Al Rajhi Bank", ar: ["مصرف الراجحي", "الراجحي"] },
  { t: "1180.SR", en: "Saudi National Bank", ar: ["البنك الأهلي السعودي"] },
  { t: "2010.SR", en: "SABIC", ar: ["سابك"] },
  { t: "7010.SR", en: "stc (Saudi Telecom)", ar: ["الاتصالات السعودية"] },
];

// Arabic as people type it: hamza forms, taa marbuta, alef maqsura, tatweel and diacritics folded,
// spaces dropped (resolve() strips them too), so "بيت التمويل" and "بيتالتمويل" match the same entry.
export function normAr(s) {
  return String(s || "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, "")
    .toUpperCase();
}

const hasArabic = (s) => /[؀-ۿ]/.test(s);
const keyOf = (s) => normAr(s).replace(/^ال/, "");
const country = (t) => (t.endsWith(".KW") ? "Boursa Kuwait" : "Tadawul");

const row = (g) => ({
  symbol: `YAHOO:${g.t}`,
  name: `${g.en} · ${g.ar[0]}`,
  type: "stock",
  exchange: country(g.t),
});

// Search rows for what was typed: a ticker prefix (NBK, NBK.KW, 2222), a word of the English name,
// or any Arabic name, with or without "ال". Exact hits first.
export function searchGulf(q) {
  const raw = String(q || "").trim();
  if (!raw) return [];
  const exact = [], partial = [];
  if (hasArabic(raw)) {
    const k = keyOf(raw);
    if (k.length < 2) return [];
    for (const g of GULF) {
      const names = g.ar.map(keyOf);
      if (names.includes(k)) exact.push(row(g));
      else if (names.some((n) => n.includes(k))) partial.push(row(g));
    }
  } else {
    const Q = raw.toUpperCase().replace(/\s+/g, " ");
    if (Q.length < 2) return [];
    for (const g of GULF) {
      const code = g.t.split(".")[0];
      if (code === Q || g.t === Q) exact.push(row(g));
      else if (code.startsWith(Q) || (Q.length >= 3 && g.en.toUpperCase().includes(Q)))
        partial.push(row(g));
    }
  }
  return [...exact, ...partial];
}

// An Arabic name typed straight into the symbol box ("بيتك", "زين") as its symbol, or null.
// Only an exact name: a partial one could mean several stocks, and search lists those.
export function resolveGulfName(raw) {
  if (!hasArabic(String(raw || ""))) return null;
  const k = keyOf(raw);
  const g = GULF.find((x) => x.ar.some((n) => keyOf(n) === k));
  return g ? { id: `YAHOO:${g.t}`, exchange: "YAHOO", ticker: g.t } : null;
}
