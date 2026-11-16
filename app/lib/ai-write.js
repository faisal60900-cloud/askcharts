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
export function meter(feature, usage, day = new Date().toISOString().slice(0, 10), { cheap = false } = {}) {
  const u = store.read("ai-usage", {});
  const d = (u[day] ||= {});
  const r = (d[feature] ||= { calls: 0, in: 0, out: 0 });
  r.calls++;
  const i = usage?.input_tokens ?? usage?.prompt_tokens ?? 0, o = usage?.output_tokens ?? usage?.completion_tokens ?? 0;
  if (cheap) {
    r.inH = (r.inH || 0) + i;
    r.outH = (r.outH || 0) + o;
  } else {
    r.in += i;
    r.out += o;
  }
  for (const k of Object.keys(u)) if (k < new Date(Date.parse(day) - 14 * 86400e3).toISOString().slice(0, 10)) delete u[k];
  store.write("ai-usage", u);
}
export const usage = () => store.read("ai-usage", {});

// the meter in Arabic: today and the last 7 days, the biggest first. Cost at Sonnet's prices
// ($3 per million in, $15 per million out): an estimate.
const AR = { news: "📰 ترجمة الأخبار", "us-signal": "🇺🇸 تحليل إشارات أمريكا", "us-brief": "🇺🇸 ملخصات أمريكا (قبل/افتتاح/إغلاق)", company: "🏢 نبذة الشركات", gulf: "🇰🇼🇸🇦🇦🇪 إشارات وملخصات الخليج", agents: "👥 تقارير الفريق", "agents-arabic": "👥 نشاط الشركات بالعربي", "telegram-chat": "💬 أسئلتك للبوت", "app-chat": "💻 محادثة AskCharts AI (على الشارت)", other: "أخرى" };
// Sonnet $3 / $15 per million in / out; Haiku $1 / $5 (estimates)
export const cost = (r) => (r.in * 3 + r.out * 15 + (r.inH || 0) * 1 + (r.outH || 0) * 5) / 1e6;
export function usageText(u = usage(), today = new Date().toISOString().slice(0, 10)) {
  const days = Object.keys(u).sort().slice(-7);
  if (!days.length) return "📊 للحين ما في استهلاك مسجل. العداد بدأ الحين، وبكرة تشوف الأرقام.";
  const sum = (list) => {
    const out = {};
    for (const d of list) for (const [f, r] of Object.entries(u[d] || {})) {
      const o = (out[f] ||= { calls: 0, in: 0, out: 0 });
      o.calls += r.calls; o.in += r.in; o.out += r.out; o.inH = (o.inH || 0) + (r.inH || 0); o.outH = (o.outH || 0) + (r.outH || 0);
    }
    return Object.entries(out).sort((a, b) => cost(b[1]) - cost(a[1]));
  };
  const block = (rows) => {
    const tot = rows.reduce((t, [, r]) => t + cost(r), 0);
    return rows.map(([f, r]) => `• ${AR[f] || f}: ${r.calls} مرة · ${Math.round((r.in + r.out + (r.inH || 0) + (r.outH || 0)) / 1000)} ألف توكن${r.inH || r.outH ? " (Haiku)" : ""} · ~${cost(r).toFixed(2)}$ (${tot ? Math.round((cost(r) / tot) * 100) : 0}%)`).join("\n") + `\n💰 المجموع: ~${tot.toFixed(2)}$`;
  };
  const t = sum([today]);
  return [`📊 استهلاك الذكاء الاصطناعي`, t.length ? `\nاليوم:\n${block(t)}` : "\nاليوم: ولا شي للحين", days.length > 1 ? `\nآخر ${days.length} أيام:\n${block(sum(days))}` : "", `\nالتكلفة تقديرية بأسعار Sonnet. الأدق في صفحة الاستهلاك عند مزود المفتاح.`].filter(Boolean).join("\n");
}

export let lastError = null;
// These are short writing jobs (translate, summarise, a few lines on numbers), not puzzles: on
// Claude, no thinking before the answer (thinking "between_tools", the lowest; with no tools there
// is none) and a low effort. Thinking is billed as output, the dear part, and was most of it.
// If the API refuses these fields (an older model), it's asked again without them, and remembered.
let lean = true;
// The plain jobs (translating news, a company's line, the activities in Arabic) go to Claude's
// small model, about a third of the price; if it isn't there for this key, the usual model.
export const CHEAP_MODEL = process.env.QT_CHEAP_MODEL || "claude-haiku-5-5";
let cheapOk = true, cheapLean = true;
// the switch: off, the bot spends no tokens at all (its signals and alerts go out without the AI's lines)
export const aiOn = () => store.read("ai-settings", { on: true }).on !== false;
export function setAiOn(on) {
  store.write("ai-settings", { on: !!on });
  return aiOn();
}

export async function write(system, prompt, { maxTokens = 900, fetchImpl = fetch, cheap = false } = {}) {
  if (!aiOn()) {
    lastError = "الذكاء الاصطناعي موقوف (أمر: الذكاء شغل)";
    return null;
  }
  const c = agentConfig();
  if (!c?.key || !c?.model) {
    lastError = "ما فيه مفتاح أو موديل في Settings, AskCharts AI";
    return null;
  }
  lastError = null;
  try {
    if (c.provider.kind === "anthropic") {
      const small = cheap && cheapOk && c.provider.id === "anthropic";
      const isLean = small ? cheapLean : lean;
      const res = await fetchImpl(`${c.base}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": c.key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: small ? CHEAP_MODEL : c.model, max_tokens: maxTokens, system, messages: [{ role: "user", content: prompt }], ...(isLean ? { thinking: { type: "between_tools" }, output_config: { effort: "low" } } : {}) }),
        signal: AbortSignal.timeout(60000),
      });
      const j = await res.json();
      const msg = String(j?.error?.message || "");
      if (!res.ok && isLean && res.status === 400 && /thinking|effort|output_config|between_tools/i.test(msg)) {
        if (small) cheapLean = false;
        else lean = false;
        return write(system, prompt, { maxTokens, fetchImpl, cheap });
      }
      // the small model not there for this key: the usual one, from now on
      if (!res.ok && small && (res.status === 404 || (res.status === 400 && /model/i.test(msg)) || res.status === 403)) {
        cheapOk = false;
        return write(system, prompt, { maxTokens, fetchImpl });
      }
      if (!res.ok) {
        lastError = `${res.status}: ${msg.split(c.key).join("…").slice(0, 200)}`;
        return null;
      }
      try { meter(featureOf(new Error().stack), j.usage, undefined, { cheap: small }); } catch {}
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
