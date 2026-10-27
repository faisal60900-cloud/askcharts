// One short piece of writing from the AI the person set up in Settings, AskCharts AI (their key,
// their model): no tools, no streaming. Used for the Arabic analyst notes, briefs and news in the
// market watch. Returns null when no AI is set up or it fails, so callers fall back to plain text.
import { agentConfig } from "./copilot.js";

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
