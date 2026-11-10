// One short piece of writing from the AI the person set up in Settings, AskCharts AI (their key,
// their model): no tools, no streaming. Used for the Arabic analyst notes, briefs and news in the
// market watch. Returns null when no AI is set up or it fails, so callers fall back to plain text.
import { agentConfig } from "./copilot.js";
import * as store from "./store.js";

// ---------- the AI meter: calls and tokens per day, by what asked for them ----------
// Kept 14 days in store "ai-usage": { "2026-11-10": { "uswatch:runOnce": { calls, in, out } } }.
const FEATURE = [
  [/\bnewsCheck\b/, "news"], [/\babout\b|about\.js/, "company"], [/\bactivities\b/, "agents-arabic"], [/agents\.js/, "agents"],
  [/tgbot\.js/, "telegram-chat"], [/gulfwatch\.js/, "gulf"], [/\b(brief|radar|preOpen|closeBrief)\b/, "us-brief"], [/uswatch\.js/, "us-signal"],
];
export function featureOf(stack = "") {
  const frames = String(stack).split("\n").slice(1).filter((l) => !/ai-write\.js|node:internal|\(<anonymous>\)/.test(l));
  const all = frames.slice(0, 6).join("\n");
  for (const [re, name] of FEATURE) if (re.test(all)) return name;
  const f = frames[0]?.match(/lib[\\/](\w+)\.js/);
  return f ? f[1] : "other";
}
export function meter(feature, usage, day = new Date().toISOString().slice(0, 10)) {
  const u = store.read("ai-usage", {});
  const d = (u[day] ||= {});
  const r = (d[feature] ||= { calls: 0, in: 0, out: 0 });
  r.calls++;
  r.in += usage?.input_tokens ?? usage?.prompt_tokens ?? 0;
  r.out += usage?.output_tokens ?? usage?.completion_tokens ?? 0;
  for (const k of Object.keys(u)) if (k < new Date(Date.parse(day) - 14 * 86400e3).toISOString().slice(0, 10)) delete u[k];
  store.write("ai-usage", u);
}
export const usage = () => store.read("ai-usage", {});

// the meter in Arabic: today and the last 7 days, the biggest first. Cost at Sonnet's prices
// ($3 per million in, $15 per million out): an estimate.
const AR = { news: "📰 ترجمة الأخبار", "us-signal": "🇺🇸 تحليل إشارات أمريكا", "us-brief": "🇺🇸 ملخصات أمريكا (قبل/افتتاح/إغلاق)", company: "🏢 نبذة الشركات", gulf: "🇰🇼🇸🇦🇦🇪 إشارات وملخصات الخليج", agents: "👥 تقارير الفريق", "agents-arabic": "👥 نشاط الشركات بالعربي", "telegram-chat": "💬 أسئلتك للبوت", other: "أخرى" };
export const cost = (r) => (r.in * 3 + r.out * 15) / 1e6;
export function usageText(u = usage(), today = new Date().toISOString().slice(0, 10)) {
  const days = Object.keys(u).sort().slice(-7);
  if (!days.length) return "📊 للحين ما في استهلاك مسجل. العداد بدأ الحين، وبكرة تشوف الأرقام.";
  const sum = (list) => {
    const out = {};
    for (const d of list) for (const [f, r] of Object.entries(u[d] || {})) {
      const o = (out[f] ||= { calls: 0, in: 0, out: 0 });
      o.calls += r.calls; o.in += r.in; o.out += r.out;
    }
    return Object.entries(out).sort((a, b) => cost(b[1]) - cost(a[1]));
  };
  const block = (rows) => {
    const tot = rows.reduce((t, [, r]) => t + cost(r), 0);
    return rows.map(([f, r]) => `• ${AR[f] || f}: ${r.calls} مرة · ${Math.round((r.in + r.out) / 1000)} ألف توكن · ~${cost(r).toFixed(2)}$ (${tot ? Math.round((cost(r) / tot) * 100) : 0}%)`).join("\n") + `\n💰 المجموع: ~${tot.toFixed(2)}$`;
  };
  const t = sum([today]);
  return [`📊 استهلاك الذكاء الاصطناعي`, t.length ? `\nاليوم:\n${block(t)}` : "\nاليوم: ولا شي للحين", days.length > 1 ? `\nآخر ${days.length} أيام:\n${block(sum(days))}` : "", `\nالتكلفة تقديرية بأسعار Sonnet. الأدق في صفحة الاستهلاك عند مزود المفتاح.`].filter(Boolean).join("\n");
}

export let lastError = null;
export async function write(system, prompt, { maxTokens = 900, fetchImpl = fetch } = {}) {
  const c = agentConfig();
  if (!c?.key || !c?.model) {
    lastError = "ما فيه مفتاح أو موديل في Settings, AskCharts AI";
    return null;
  }
  lastError = null;
  try {
    if (c.provider.kind === "anthropic") {
      const res = await fetchImpl(`${c.base}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": c.key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: c.model, max_tokens: maxTokens, system, messages: [{ role: "user", content: prompt }] }),
        signal: AbortSignal.timeout(60000),
      });
      const j = await res.json();
      if (!res.ok) {
        lastError = `${res.status}: ${String(j?.error?.message || "").split(c.key).join("…").slice(0, 200)}`;
        return null;
      }
      try { meter(featureOf(new Error().stack), j.usage); } catch {}
      const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
      if (!text) lastError = `ما رجع نص (stop: ${j.stop_reason}, blocks: ${(j.content || []).map((b) => b.type).join(",") || "none"}, model: ${j.model || c.model})`;
      return text || null;
    }
    const res = await fetchImpl(`${c.base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${c.key}` },
      body: JSON.stringify({ model: c.model, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(60000),
    });
    const j = await res.json();
    if (!res.ok) {
      lastError = `${res.status}: ${String(j?.error?.message || "").split(c.key).join("…").slice(0, 200)}`;
      return null;
    }
    try { meter(featureOf(new Error().stack), j.usage); } catch {}
    return j.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    lastError = e.message;
    return null;
  }
}

// What every market-watch note is told: describe, don't advise; only the numbers given.
export const ANALYST = `أنت محلل فني خبير في الأسهم الأمريكية، تكتب لمتداول كويتي على تيليجرام.
- اكتب بالعربي الواضح البسيط، جمل قصيرة، بدون مقدمات ولا تحية.
- استخدم الأرقام المعطاة فقط، ولا تخترع أي رقم أو خبر أو سعر.
- صف ما تقوله الأرقام والمخاطر بوضوح، ولا تقل "اشترِ" أو "بع"؛ القرار للمتداول.
- إذا كانت المعطيات ضعيفة أو متعارضة فقل ذلك صراحة.
- بدون Markdown ولا نجوم، فقط نص عادي وإيموجي قليل عند الحاجة.`;
