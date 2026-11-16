// AskCharts AI: the model behind the AI panel. You bring your own API key (Anthropic, OpenAI or xAI,
// one each). It is kept on this computer in data/copilot.json (readable by this account only, never in
// git, never sent to the browser) and is only ever sent to its own provider, in a request header.
//
// The chat streams: the browser posts the conversation, this server adds the help guide (and,
// if you allow it, what's on the chart) and relays the provider's answer as it's written.

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./store.js";
import { systemBlocks } from "./copilot-guide.js";
import * as oai from "./ai-openai.js";

const FILE = path.join(DATA_DIR, "copilot.json");
// kind is how the provider is spoken to: Anthropic's Messages API, or OpenAI's chat completions (which
// xAI speaks too). QT_AI_BASE, QT_AI_BASE_OPENAI and QT_AI_BASE_XAI point a provider at a stand-in
// server, for tests only (they never use a real key).
export const PROVIDERS = [
  { id: "anthropic", kind: "anthropic", name: "Anthropic (Claude, hosted)", label: "Anthropic", base: process.env.QT_AI_BASE || "https://api.anthropic.com" },
  { id: "openai", kind: "openai", name: "OpenAI (GPT, hosted)", label: "OpenAI", base: process.env.QT_AI_BASE_OPENAI || "https://api.openai.com" },
  { id: "xai", kind: "openai", name: "xAI (Grok, hosted)", label: "xAI", base: process.env.QT_AI_BASE_XAI || "https://api.x.ai" },
];
const API_VERSION = "2023-06-01";
const MAX_TOKENS = 2048;
const MAX_TURNS = 20;
const MAX_CHARS = 8000;
const bad = (message, status = 400) => Object.assign(new Error(message), { status });

let cfg = load();
function load() {
  try {
    return upgrade(JSON.parse(fs.readFileSync(FILE, "utf8")));
  } catch {
    return upgrade({});
  }
}
// Each provider keeps its own key and model, in keys[provider]. Before 0.1.17 there was only Anthropic's,
// at the top (key, model, modelName); it moves in under keys.anthropic on the next save.
export function upgrade(raw) {
  const { key, model, modelName, keys, ...rest } = raw && typeof raw === "object" ? raw : {};
  const out = { provider: "anthropic", context: true, ...rest, keys: {} };
  for (const p of PROVIDERS) {
    const k = keys?.[p.id];
    if (k?.key) out.keys[p.id] = { key: String(k.key), model: String(k.model || ""), modelName: String(k.modelName || ""), ...(k.images === false ? { images: false } : {}) };
  }
  if (key && !out.keys.anthropic) out.keys.anthropic = { key: String(key), model: String(model || ""), modelName: String(modelName || "") };
  if (!PROVIDERS.some((p) => p.id === out.provider)) out.provider = "anthropic";
  return out;
}
function save() {
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
  fs.chmodSync(FILE, 0o600);
}
const providerOf = (id) => PROVIDERS.find((p) => p.id === (id || "anthropic")) || null;

// What the browser may see: never a key, only that there is one and its last four characters. The top
// level is the provider in use; providers lists what each one has saved.
const saved = (id) => cfg.keys[id] || { key: "", model: "", modelName: "" };
const shown = (k) => ({ hasKey: !!k.key, keyHint: k.key ? k.key.slice(-4) : "", model: k.model, modelName: k.modelName });
export function publicConfig() {
  const { hasKey, keyHint, model, modelName } = shown(saved(cfg.provider));
  return {
    provider: cfg.provider,
    providers: PROVIDERS.map(({ id, name, label }) => ({ id, name, label, ...shown(saved(id)) })),
    model,
    modelName,
    context: cfg.context !== false,
    askFirst: cfg.askFirst === true,
    hasKey,
    keyHint,
  };
}

// For the server only (lib/agent.js): where to send, and with what. Never sent to the browser.
export const agentConfig = () => {
  const p = providerOf(cfg.provider),
    k = saved(p.id);
  return { provider: p, base: p.base, key: k.key, model: k.model, modelName: k.modelName, images: k.images !== false, context: cfg.context !== false };
};

// The provider's error, without ever repeating the key. OpenAI's error is an object with a message,
// xAI's may be a plain string.
export function apiError(status, body, key, p = PROVIDERS[0]) {
  const e = body?.error;
  const msg = (typeof e === "string" ? e : e?.message) || `HTTP ${status}`;
  const clean = key ? String(msg).split(key).join("…") : String(msg);
  const who = p.label;
  if (status === 401) return `${who} didn't accept that key (${clean}).`;
  if (status === 403) return `That key isn't allowed to do this (${clean}).`;
  if (status === 429) return `${who} says slow down: rate limit or spend limit reached (${clean}).`;
  if (status === 529 || e?.type === "overloaded_error") return `${who} is overloaded right now. Try again in a minute.`;
  if (/v1\/responses|not a chat model|not supported in the v1\/chat\/completions/i.test(clean)) return `That model doesn't work here (${clean}). Pick another one in Settings, AskCharts AI.`;
  if (/api key|api_key/i.test(clean) && status === 400) return `${who} didn't accept that key (${clean}).`;
  return `${who} replied: ${clean}`;
}

// The models a key can use, newest first: the key just typed, or this provider's saved one (never
// another provider's). No provider named: the one in use.
export async function listModels({ provider, key } = {}, fetchImpl = fetch) {
  const p = providerOf(provider || cfg.provider);
  if (!p) throw bad("Pick a provider.");
  const k = String(key || "").trim() || saved(p.id).key;
  if (!k) throw bad("Paste an API key first.");
  const anthropic = p.kind === "anthropic";
  let r;
  try {
    r = await fetchImpl(anthropic ? `${p.base}/v1/models?limit=100` : `${p.base}/v1/${p.id === "xai" ? "language-models" : "models"}`, {
      headers: anthropic ? { "x-api-key": k, "anthropic-version": API_VERSION } : { authorization: `Bearer ${k}` },
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    throw bad(`Couldn't reach ${p.label}: ${e.message}`, 502);
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw bad(apiError(r.status, body, k, p), r.status === 400 || r.status === 401 || r.status === 403 ? 400 : 502);
  if (p.id === "openai") return oai.openaiModels(body);
  if (p.id === "xai") return oai.xaiModels(body);
  return (body.data || [])
    .filter((m) => m && m.type === "model" && m.id && m.lifecycle !== "retired")
    .map((m) => ({ id: m.id, name: m.display_name || m.id, created: m.created_at || "", deprecated: m.lifecycle === "deprecated" }));
}

// Save the settings. A new key is checked against the provider first and the model must be one
// it offers, so a typo can't be saved. No provider named: the one in use stays.
export async function setConfig(input = {}, fetchImpl = fetch) {
  const p = providerOf(input.provider || cfg.provider);
  if (!p) throw bad("Pick a provider.");
  const key = String(input.key || "").trim();
  const had = saved(p.id);
  const next = { ...cfg, provider: p.id, keys: { ...cfg.keys } };
  if (typeof input.context === "boolean") next.context = input.context;
  if (typeof input.askFirst === "boolean") next.askFirst = input.askFirst;
  if (key || input.model !== undefined) {
    if (!key && !had.key) throw bad("Paste an API key first.");
    const models = await listModels({ provider: p.id, key }, fetchImpl);
    const model = input.model || had.model;
    const m = models.find((x) => x.id === model);
    if (!m) throw bad(model ? `That key can't use ${model}. Test the key and pick a model from the list.` : "Pick a model.");
    next.keys[p.id] = { key: key || had.key, model: m.id, modelName: m.name, ...(m.images === false ? { images: false } : {}) };
  } else if (!had.key && p.id !== cfg.provider) throw bad(`Paste your ${p.label} key and Test it first.`);
  cfg = next;
  save();
  return publicConfig();
}

// Removes one provider's key (the one in use when none is named).
export function removeKey(provider) {
  const p = providerOf(provider || cfg.provider);
  if (!p) throw bad("Pick a provider.");
  const keys = { ...cfg.keys };
  delete keys[p.id];
  cfg = { ...cfg, keys };
  save();
  return publicConfig();
}

// The conversation from the browser: plain text turns, user first, alternating, the last N only.
function cleanMessages(list) {
  if (!Array.isArray(list)) throw bad("Send the conversation as a list.");
  let out = list
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
  out = out.slice(-MAX_TURNS);
  while (out.length && out[0].role !== "user") out.shift();
  const merged = [];
  for (const m of out) {
    const prev = merged.at(-1);
    if (prev && prev.role === m.role) prev.content += `\n\n${m.content}`;
    else merged.push({ ...m });
  }
  if (!merged.length || merged.at(-1).role !== "user") throw bad("Ask a question first.");
  return merged;
}

// One answer at a time (one person uses this terminal); Stop or a closed tab ends it upstream too.
let busy = false;
export async function chat(input, res, fetchImpl = fetch) {
  const c = agentConfig(),
    p = c.provider;
  if (!c.key) throw bad("Add an API key in Settings, AskCharts AI first.");
  if (!c.model) throw bad("Pick a model in Settings, AskCharts AI first.");
  const messages = cleanMessages(input?.messages);
  const system = systemBlocks(cfg.context !== false ? input?.context : null);
  const ask =
    p.kind === "openai"
      ? oai.request(c, { system, messages })
      : {
          url: `${p.base}/v1/messages`,
          headers: { "x-api-key": c.key, "anthropic-version": API_VERSION, "content-type": "application/json" },
          body: { model: c.model, max_tokens: MAX_TOKENS, system, messages, stream: true },
        };
  if (busy) throw bad("AskCharts AI is still answering. Wait for it, or press Stop.", 429);
  busy = true;
  const ac = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) ac.abort();
  });
  try {
    let r;
    try {
      r = await fetchImpl(ask.url, { method: "POST", headers: ask.headers, body: JSON.stringify(ask.body), signal: ac.signal });
    } catch (e) {
      if (ac.signal.aborted) return;
      throw bad(`Couldn't reach ${p.label}: ${e.message}`, 502);
    }
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw bad(apiError(r.status, body, c.key, p), r.status === 429 ? 429 : 502);
    }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    send({ t: "start", model: c.modelName || c.model });
    let stop = null,
      usage = {},
      done = null;
    try {
      if (p.kind === "openai")
        done = await oai.read(c, r.body, readEvents, {
          text: (v) => send({ t: "text", v }),
          call: () => {},
          error: (d) => send({ t: "error", message: apiError(0, d, c.key, p) }),
        });
      else
        await readEvents(r.body, (type, data) => {
          if (type === "content_block_delta" && data.delta?.type === "text_delta") send({ t: "text", v: data.delta.text });
          else if (type === "message_start") usage = { ...usage, ...(data.message?.usage || {}) };
          else if (type === "message_delta") {
            stop = data.delta?.stop_reason || stop;
            usage = { ...usage, ...(data.usage || {}) };
          } else if (type === "error") send({ t: "error", message: apiError(0, data, c.key, p) });
        });
    } catch (e) {
      if (!ac.signal.aborted) send({ t: "error", message: `The answer broke off: ${e.message}` });
    }
    if (!res.writableEnded) {
      if (done?.empty && done.stop === "max_tokens") send({ t: "error", message: oai.THOUGHT_OUT });
      send(done ? { t: "done", stop: done.stop, usage: done.usage } : { t: "done", stop, usage: { input: usage.input_tokens || 0, output: usage.output_tokens || 0, cached: usage.cache_read_input_tokens || 0 } });
      res.end();
    }
  } finally {
    busy = false;
  }
}

// Server-sent events from the provider: "event: x" and "data: {...}" lines, a blank line between.
export async function readEvents(stream, on) {
  const dec = new TextDecoder();
  let buf = "";
  // the AI meter (lib/ai-write.js): the tokens of the in-app chat
  const use = { input_tokens: 0, output_tokens: 0 };
  const on0 = on;
  on = (type, obj) => {
    const u = obj?.message?.usage || obj?.usage;
    if (u) {
      if (type === "message_start") use.input_tokens += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + Math.round((u.cache_read_input_tokens || 0) / 10);
      else if (type === "message_delta") use.output_tokens = Math.max(use.output_tokens, u.output_tokens || 0);
      else if (u.prompt_tokens != null) Object.assign(use, { input_tokens: u.prompt_tokens, output_tokens: u.completion_tokens || 0 });
    }
    return on0(type, obj);
  };
  const flush = (block) => {
    let type = "",
      data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) type = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) return;
    let obj;
    try {
      obj = JSON.parse(data);
    } catch {
      return;
    }
    on(type || obj.type, obj);
  };
  for await (const chunk of stream) {
    buf += dec.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      flush(buf.slice(0, i));
      buf = buf.slice(i + 2);
    }
  }
  if (buf.trim()) flush(buf);
  if (use.input_tokens || use.output_tokens) import("./ai-write.js").then((m) => m.meter("app-chat", use)).catch(() => {});
}
