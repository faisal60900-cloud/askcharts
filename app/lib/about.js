// What a company does (الشركة وش تسوي): one Arabic line for every message about a stock, so a
// signal for a name you don't know says what the business is. The well-known ones are written here;
// any other is written once by your AI from the company's name, exchange and sector (and told to say
// so when it doesn't know the company), then kept in the data folder.
import * as store from "./store.js";
import { write } from "./ai-write.js";
import { nasdaqScreener } from "./providers.js";

const KNOWN = {
  NVDA: "تصمم معالجات الرسوم (GPU) اللي تشغّل الذكاء الاصطناعي، رقم واحد في العالم.",
  AMD: "معالجات كمبيوتر وسيرفرات وشرائح ذكاء اصطناعي، منافسة إنفيديا وإنتل.",
  AVGO: "شرائح شبكات للداتا سنتر وشرائح ذكاء اصطناعي مخصصة (مثل جوجل)، وبرامج VMware.",
  MRVL: "شرائح ذكاء اصطناعي مخصصة وشرائح نقل البيانات داخل الداتا سنتر.",
  ARM: "تصمم مخطط المعالج وتبيع رخصته؛ تقريبًا كل جوال في العالم فيه تصميمها.",
  INTC: "معالجات الكمبيوترات والسيرفرات، وتبني مصانع شرائح للغير.",
  TSM: "أكبر مصنع شرائح في العالم (تايوان)، يصنع شرائح إنفيديا وأبل وAMD.",
  ASML: "تصنع الماكينات اللي تصنع الشرائح المتطورة (هولندا)، الوحيدة في العالم.",
  ANET: "أجهزة الشبكات (السويتشات) اللي تربط سيرفرات الداتا سنتر.",
  VRT: "أنظمة الكهرباء والتبريد للداتا سنتر.",
  CLS: "تصنّع وتجمّع السيرفرات وأجهزة الشبكات لشركات السحابة الكبيرة (كندا).",
  DELL: "كمبيوترات شخصية وسيرفرات ذكاء اصطناعي.",
  MSFT: "ويندوز وأوفيس وسحابة Azure، وشريكة OpenAI.",
  GOOGL: "بحث جوجل ويوتيوب وأندرويد وسحابة جوجل وWaymo.",
  GOOG: "بحث جوجل ويوتيوب وأندرويد وسحابة جوجل وWaymo.",
  AMZN: "التسوق أونلاين وسحابة AWS (أكبر سحابة في العالم) والإعلانات.",
  META: "فيسبوك وإنستغرام وواتساب؛ دخلها تقريبًا كله إعلانات.",
  ORCL: "قواعد بيانات للشركات، وتبني داتا سنترات ذكاء اصطناعي ضخمة.",
  NOW: "برامج تنظيم شغل الشركات الكبيرة (الدعم الفني والموارد البشرية) بالاشتراك.",
  PLTR: "برامج تحليل البيانات والذكاء الاصطناعي للحكومات والشركات.",
  NFLX: "أفلام ومسلسلات بالاشتراك، وباقات بإعلانات.",
  SPCX: "صواريخ فالكون وستارشيب، وإنترنت ستارلينك بالأقمار الصناعية، وذكاء اصطناعي (xAI).",
  AAPL: "آيفون وماك والساعات، وخدمات مثل App Store وiCloud.",
  TSLA: "سيارات كهربائية، وبطاريات تخزين طاقة، وقيادة ذاتية وروبوتات.",
  UBER: "تطبيق توصيل الركاب (تاكسي) وتوصيل الطلبات (أوبر إيتس).",
  FTNT: "أمن سيبراني: جدران نارية (Firewalls) وحماية شبكات الشركات.",
  PANW: "أمن سيبراني: جدران نارية وحماية سحابية للشركات.",
  CRWD: "أمن سيبراني: حماية أجهزة الشركات من الاختراق عبر السحابة.",
  NET: "شبكة توصيل وحماية مواقع الإنترنت (Cloudflare).",
  CRM: "برامج إدارة العملاء والمبيعات للشركات (Salesforce).",
  MU: "شرائح الذاكرة (DRAM وHBM للذكاء الاصطناعي) والتخزين.",
  QCOM: "معالجات الجوالات وشرائح الاتصال (5G).",
  BA: "طائرات ركاب (بوينغ) وصناعات دفاعية.",
  KFH: "بنك إسلامي (بيت التمويل الكويتي)، أكبر بنك في الكويت.",
  NBK: "بنك الكويت الوطني، أكبر بنك تجاري في الكويت.",
  ALSAFAT: "شركة استثمار: عقارات للتأجير واستثمارات في أسهم وشركات وإدارة محافظ.",
};

let cache = store.read("about", {});
// The line, or "" when nothing is known. stock: { code, en, ar, sector }; market: kw | us | sa | ae.
export async function about(stock, market = "us", { ai = true } = {}) {
  const code = String(stock?.code || "").toUpperCase();
  if (!code) return "";
  if (KNOWN[code]) return KNOWN[code];
  const key = `${market}:${code}`;
  if (cache[key] != null) return cache[key];
  if (!ai) return "";
  let sector = stock.sector || "",
    industry = "",
    name = stock.en || code;
  if (market === "us") {
    const row = (await nasdaqScreener("stocks").catch(() => [])).find((r) => r.ticker === code);
    if (row) {
      sector = row.sector || sector;
      industry = row.industry || "";
      name = row.name || name;
    }
  }
  const where = { us: "السوق الأمريكي", kw: "بورصة الكويت", sa: "السوق السعودي", ae: "سوق دبي" }[market] || "";
  const text = await write(
    "تكتب وصف قصير ودقيق لنشاط شركة مدرجة، بالعربي الخليجي البسيط، سطر واحد بس (15 كلمة أو أقل): وش تبيع أو تقدم ومن وين دخلها. بدون أرقام وبدون رأي. إذا ما تعرف الشركة بالتحديد اكتب بس: غير معروف",
    `الشركة: ${name}\nالرمز: ${code}\nالسوق: ${where}\nالقطاع: ${sector || "—"}\nالصناعة: ${industry || "—"}${stock.ar ? `\nالاسم العربي: ${stock.ar}` : ""}`,
    { maxTokens: 800 },
  ).catch(() => null);
  // the AI not reachable and nothing else known: try again next time
  if (text == null && !sector && !industry) return "";
  const line = text && !/غير معروف/.test(text) ? text.trim().split("\n")[0].replace(/^[-•\s]+/, "").slice(0, 160) : sector || industry ? `${sector}${industry ? ` · ${industry}` : ""}` : "";
  cache[key] = line;
  store.write("about", cache);
  return line;
}
export const aboutLine = (line) => (line ? `🏢 الشركة: ${line}` : "");
