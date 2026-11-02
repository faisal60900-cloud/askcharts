// قطاعات السوق: where the money is going today, sector by sector. Every Boursa Kuwait stock is
// put in its sector; the US sectors are read from the SPDR sector funds (and SMH for chips). For
// each sector, from the daily bars: the money traded today, how that compares with a usual day by
// this time of the session, how much of it was buying (where each bar closed in its range), how
// that compares with the five days before, and the price move. Pure functions: lib/sectors.js
// fetches the bars.

// Boursa Kuwait sectors (approximate, from the companies' main business).
const KW = {
  banks: ["بنوك", "NBK KFH BOUBYAN GBK WARBABANK CBK ABK BURG KIB"],
  fin: ["خدمات مالية", "MARKAZ BOURSA ALIMTIAZ AAYAN NINV KPROJ KAMCO IFA OSOUL COAST KINV WARBACAP AMAR ARZAN ALOLA ALSAFAT GIH KFIC UNICAP FACIL EKTTITAB KMEFIC NOOR SECH TAMINV MADAR ALMANAR ALDEERA ASIYA BAYANINV TAHSSILAT EMIRATES NIH KPPC GFH BEYOUT SANAM OSOS RASIYAT"],
  re: ["العقار", "MABANEE ALTIJARIA SRE URC INJAZZAT KBT TIJARA ARKAN KRE MARAKEZ MUNSHAAT TAM MAZAYA AQAR AAYANRE ARGAN THURAYA ALAQARIA MENA NRE AREEC ARABREC MANAZEL MASHAER SOKOUK DALQANRE ERESCO"],
  ind: ["الصناعة", "SHIP MKHZN JTC CABLE INTEGRATED CGC CLEANING NIND ALKOUT NICBM ACICO KCPC MRC PCEM KCEM EQUIPMENT SPEC PAPER MUBARRAD"],
  tel: ["الاتصالات", "STC ZAIN OOREDOO"],
  cons: ["الخدمات الاستهلاكية", "JAZEERA HUMANSOFT IFAHR KHOT MUNTAZAHAT FUTUREKID GFC KCIN UPAC ALG NCCI"],
  stap: ["السلع الاستهلاكية", "MEZZAN PAPCO CATTL TROLLEY"],
  ins: ["التأمين", "GINS WINSRE AINS KINS KUWAITRE WETHAQ FTI"],
  energy: ["الطاقة", "ALFTAQA IPG NAPESCO ABAR OULAFUEL SOOR ENERGYH SENERGY"],
  mat: ["المواد الأساسية", "BPCC"],
  tech: ["التكنولوجيا", "ASC DIGITUS"],
  health: ["الرعاية الصحية", "MIDAN ATC"],
  util: ["المنافع", "AZNOULA"],
};
export const KW_SECTORS = Object.fromEntries(Object.entries(KW).map(([k, [ar, list]]) => [k, { ar, codes: list.split(" ") }]));
export const kwSectorOf = (code) => Object.keys(KW_SECTORS).find((k) => KW_SECTORS[k].codes.includes(code)) || null;

// The US sectors, one fund each.
export const US_SECTORS = [
  ["XLK", "التقنية"],
  ["SMH", "الشرائح"],
  ["XLC", "الاتصالات والإعلام"],
  ["XLY", "الاستهلاكي الكمالي"],
  ["XLP", "الاستهلاكي الأساسي"],
  ["XLF", "المالية والبنوك"],
  ["XLV", "الرعاية الصحية"],
  ["XLI", "الصناعة"],
  ["XLE", "الطاقة"],
  ["XLB", "المواد الأساسية"],
  ["XLU", "المنافع"],
  ["XLRE", "العقار"],
].map(([code, ar]) => ({ key: code, ar, codes: [code] }));

const pos = (b) => (b.high > b.low ? (b.close - b.low) / (b.high - b.low) : 0.5);

// One stock's (or fund's) numbers from its daily bars. scale: 1/1000 for Kuwaiti fils (to dinars).
// frac: how far through today's session the last bar is (1 when it is a finished day).
export function stockDay(bars, { scale = 1, frac = 1 } = {}) {
  const b = (bars || []).filter((x) => x && x.close > 0);
  if (b.length < 27) return null;
  const t = b.at(-1),
    y = b.at(-2);
  const val = (x) => (x.volume || 0) * x.close * scale;
  const today = val(t);
  const avg = b.slice(-21, -1).reduce((a, x) => a + val(x), 0) / 20;
  const prev5 = b.slice(-6, -1);
  return {
    value: today,
    avg: avg * frac,
    prev: val(y),
    buy: today * pos(t),
    value5: prev5.reduce((a, x) => a + val(x), 0),
    buy5: prev5.reduce((a, x) => a + val(x) * pos(x), 0),
    change: y.close ? ((t.close - y.close) / y.close) * 100 : 0,
    frac,
  };
}

const heatOf = (rel) => (rel >= 1.5 ? { k: "hot", ar: "ساخن", icon: "🔥" } : rel >= 1 ? { k: "active", ar: "نشط", icon: "🟢" } : rel >= 0.6 ? { k: "normal", ar: "طبيعي", icon: "⚪" } : { k: "cold", ar: "بارد", icon: "🔵" });
function flowOf(buyPct, buy5Pct, rel) {
  if (buyPct >= 58 && rel >= 0.8) return { k: "in", ar: "يستقبل", icon: "📥" };
  if (buyPct <= 42) return { k: "out", ar: "يفقد", icon: "📤" };
  if (buyPct - buy5Pct >= 8) return { k: "up", ar: "يتحسن", icon: "↗️" };
  if (buy5Pct - buyPct >= 8) return { k: "down", ar: "يضعف", icon: "↘️" };
  return { k: "flat", ar: "مستقر", icon: "➡️" };
}

// The table: sectors is [{ key, ar, codes }], days maps a code to stockDay(...) (or null).
export function sectorTable(sectors, days) {
  const rows = [];
  for (const s of sectors) {
    const ds = s.codes.map((c) => [c, days[c]]).filter(([, d]) => d && d.value >= 0);
    if (!ds.length) continue;
    const sum = (f) => ds.reduce((a, [, d]) => a + f(d), 0);
    const value = sum((d) => d.value),
      avg = sum((d) => d.avg),
      prev = sum((d) => d.prev),
      frac = ds[0][1].frac || 1;
    const buyPct = value ? (sum((d) => d.buy) / value) * 100 : 50;
    const v5 = sum((d) => d.value5);
    const buy5Pct = v5 ? (sum((d) => d.buy5) / v5) * 100 : 50;
    const rel = avg ? value / avg : 0;
    const change = value ? sum((d) => d.value * d.change) / value : sum((d) => d.change) / ds.length;
    const top = ds.slice().sort((a, b) => b[1].value - a[1].value)[0];
    rows.push({
      key: s.key,
      ar: s.ar,
      n: ds.length,
      up: ds.filter(([, d]) => d.change > 0).length,
      down: ds.filter(([, d]) => d.change < 0).length,
      value,
      rel,
      // today's money against yesterday's, today's scaled up to a whole day
      liqChange: prev ? ((value / frac) / prev - 1) * 100 : null,
      buyPct,
      buy5Pct,
      change,
      top: top && top[1].value > 0 ? { code: top[0], change: top[1].change, buyPct: top[1].value ? (top[1].buy / top[1].value) * 100 : 50 } : null,
      heat: heatOf(rel),
      flow: flowOf(buyPct, buy5Pct, rel),
      score: (buyPct - 50) / 10 + Math.min(3, rel) + Math.max(-3, Math.min(3, change)) / 2,
    });
  }
  // a sector with under 2% of the day's money (one or two small stocks) can't lead or be left:
  // it goes to the bottom, out of the strongest and the rotation
  const total = rows.reduce((a, r) => a + r.value, 0);
  for (const r of rows) r.small = total > 0 && r.value < total * 0.02;
  rows.sort((a, b) => a.small - b.small || b.score - a.score);
  const buyAll = total ? rows.reduce((a, r) => a + (r.value * r.buyPct) / 100, 0) / total * 100 : 50;
  const avgAll = rows.reduce((a, r) => a + (r.rel ? r.value / r.rel : 0), 0);
  const big = rows.filter((r) => !r.small);
  const hot = big[0] || null;
  const losing = big.filter((r) => r.flow.k === "out" || r.flow.k === "down").sort((a, b) => a.score - b.score)[0] || null;
  return {
    rows,
    hot,
    rotation: losing && hot && losing.key !== hot.key ? { from: losing, to: hot } : null,
    total,
    buyPct: buyAll,
    rel: avgAll ? total / avgAll : 0,
    state: buyAll >= 55 ? "ساخن، الشراء غالب" : buyAll <= 45 ? "بارد، البيع غالب" : "متوازن",
  };
}

const n1 = (v) => (v == null || !Number.isFinite(v) ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 1 }));
const sign = (v) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${n1(v)}%`);
export const money = (v, market) => {
  const cur = market === "kw" ? "د.ك" : "$";
  return v >= 1e9 ? `${n1(v / 1e9)} مليار ${cur}` : v >= 1e6 ? `${n1(v / 1e6)} مليون ${cur}` : `${n1(v / 1e3)} ألف ${cur}`;
};

// The Telegram text.
export function sectorsText(t, market) {
  if (!t?.rows?.length) return "ما قدرت أقرأ القطاعات الحين.";
  const flag = market === "kw" ? "🇰🇼" : "🇺🇸";
  const lines = [
    `${flag} قطاعات ${market === "kw" ? "السوق الكويتي" : "السوق الأمريكي"}`,
    `السوق: ${t.state} · الشراء ${Math.round(t.buyPct)}% · السيولة ${n1(t.rel)}x من المعتاد`,
    t.hot ? `🔥 الأقوى: ${t.hot.ar}` : "",
    t.rotation ? `🔄 السيولة تنتقل: من ${t.rotation.from.ar} ← إلى ${t.rotation.to.ar}` : "",
    "",
    ...t.rows.map((r) => `${r.flow.icon} ${r.ar}: ${r.flow.ar} · ${r.heat.icon} ${n1(r.rel)}x · الشراء ${Math.round(r.buyPct)}% · ${sign(r.change)}${r.top && market === "kw" ? ` · الأنشط ${r.top.code}` : ""}`),
    "",
    "📥 يستقبل: الشراء 58% وفوق بسيولة طبيعية أو أعلى · 📤 يفقد: الشراء 42% أو أقل",
  ];
  return lines.filter((x, i) => x !== "" || i > 2).join("\n");
}
