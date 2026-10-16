/**
 * DNA OS — AI adapter implementations (PHASE A4/A5, owner 2026-09-23).
 *
 * The two providers that used to live INSIDE services/ai/gateway.ts
 * (anthropicProvider()/ollamaProvider()) now live here, behaviour-identical, so
 * gateway.ts stops being registry + resolver + provider implementations + entry
 * point in one file. Gemini is declared because the A0–A3 census found real
 * callers (line-webhook-v2/helpers.ts) — its capabilities are named by the WORK
 * (text.entity_extract / location.geocode), never by the provider.
 *
 * Model identity is configuration (env + declared default) — never a capability.
 * A4.2: no model value is replaced in this phase.
 */
import Anthropic from "@anthropic-ai/sdk";
import type {
  AiAdapter, AiAdapterId, AiAdapterInvokeContext, AiAdapterStatus,
} from "./adapterContract";

/** Same timeout the pre-A4 inline ollama provider used. */
export const OLLAMA_TIMEOUT_MS = 60_000;
/** Same literal the pre-A4 inline anthropic provider used (A4.2: unchanged). */
export const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
/** Same default model the pre-A4 inline ollama provider used. */
export const OLLAMA_DEFAULT_MODEL = "thawatchai";
/** Mirrors the model the real Deno Gemini callers use today. */
export const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash-lite";

const envOf = (context?: AiAdapterInvokeContext) => context?.env ?? ((name: string) => process.env[name]);
const fetchOf = (context: AiAdapterInvokeContext) => context.fetchImpl ?? fetch;

export const ollamaAdapter: AiAdapter = {
  id: "ollama",
  kind: "ai",
  capabilities: ["conversation.answer", "intent.classify", "screen.describe", "document.crop", "memory.draft", "material.resolve"],
  runtimes: ["next", "device"],
  status(context): AiAdapterStatus {
    const env = envOf(context);
    const endpoint = env("AI_GATEWAY_OLLAMA_URL") ?? null;
    return {
      configured: Boolean(endpoint),
      reason: endpoint ? "AI_GATEWAY_OLLAMA_URL present" : "AI_GATEWAY_OLLAMA_URL missing",
      model: env("AI_GATEWAY_OLLAMA_MODEL") ?? OLLAMA_DEFAULT_MODEL,
      endpoint: endpoint ? endpoint.replace(/\/$/, "") : null,
    };
  },
  async invoke(request, context) {
    const env = envOf(context);
    const baseUrl = env("AI_GATEWAY_OLLAMA_URL");
    if (!baseUrl) throw new Error("AI_GATEWAY_OLLAMA_NOT_CONFIGURED");
    const response = await fetchOf(context)(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Model is configuration: the resolver hands down the declaration's
        // per-capability value, then the env, then the declared default.
        model: context.model ?? env("AI_GATEWAY_OLLAMA_MODEL") ?? OLLAMA_DEFAULT_MODEL,
        system: request.systemPrompt,
        prompt: request.prompt,
        images: request.image ? [request.image.base64] : undefined,
        stream: false,
        // Deterministic outputs (intent.classify / OCR / structured) — temp 0
        options: { temperature: 0 },
        // Transport correlation (2026-10-17): request id สำหรับจับคู่ log บน
        // เครื่องที่รัน Ollama จริง — Ollama เองเมินคีย์ที่ไม่รู้จักอยู่แล้ว
        // (body ที่เหลือเหมือนเดิมทุกฟิลด์ — เปลี่ยนสัญญา provider ไม่แตะ)
        request_id: context.transportRequestId ?? undefined,
      }),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`AI_GATEWAY_OLLAMA_HTTP_${response.status}`);
    const body = await response.json() as { response?: unknown };
    if (typeof body.response !== "string" || !body.response.trim()) throw new Error("AI_GATEWAY_EMPTY_PROVIDER_RESULT");
    return body.response.trim();
  },
};


export const anthropicAdapter: AiAdapter = {
  id: "anthropic",
  kind: "ai",
  capabilities: ["document.ocr", "document.event_extract", "code.generate", "intent.classify", "conversation.answer"],
  runtimes: ["next"],
  status(context): AiAdapterStatus {
    const configured = Boolean(envOf(context)("ANTHROPIC_API_KEY"));
    return {
      configured,
      reason: configured ? "ANTHROPIC_API_KEY present" : "ANTHROPIC_API_KEY missing",
      model: ANTHROPIC_MODEL,
      endpoint: null,
    };
  },
  async invoke(request, context) {
    const apiKey = envOf(context)("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("AI_GATEWAY_ANTHROPIC_NOT_CONFIGURED");
    const client = new Anthropic({ apiKey });
    const content = request.image
      ? [
          { type: "text" as const, text: request.prompt },
          request.image.mediaType === "application/pdf"
            ? { type: "document" as const, source: { type: "base64" as const, media_type: request.image.mediaType, data: request.image.base64 } }
            : { type: "image" as const, source: { type: "base64" as const, media_type: request.image.mediaType, data: request.image.base64 } },
        ]
      : request.prompt;
    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: request.maxTokens,
      temperature: 0,
      system: request.systemPrompt ?? "",
      messages: [{ role: "user", content }],
    });
    const block = response.content.find((item) => item.type === "text");
    if (block?.type !== "text" || !block.text.trim()) throw new Error("AI_GATEWAY_EMPTY_PROVIDER_RESULT");
    return block.text.trim();
  },
};

/** Literal the openai adapter uses as its default (OPENAI_API_KEY พร้อมแล้วบน Railway). */
export const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";

export const geminiAdapter: AiAdapter = {
  id: "gemini",
  kind: "ai",
  capabilities: ["text.entity_extract", "location.geocode"],
  runtimes: ["deno", "next"],
  status(context): AiAdapterStatus {
    const configured = Boolean(envOf(context)("GEMINI_API_KEY"));
    return {
      configured,
      reason: configured ? "GEMINI_API_KEY present" : "GEMINI_API_KEY missing",
      model: envOf(context)("AI_GATEWAY_GEMINI_MODEL") ?? GEMINI_DEFAULT_MODEL,
      endpoint: "generativelanguage.googleapis.com",
    };
  },
  async invoke(request, context) {
    const env = envOf(context);
    const apiKey = env("GEMINI_API_KEY");
    if (!apiKey) throw new Error("AI_GATEWAY_GEMINI_NOT_CONFIGURED");
    const model = env("AI_GATEWAY_GEMINI_MODEL") ?? GEMINI_DEFAULT_MODEL;
    const response = await fetchOf(context)(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `${request.systemPrompt ?? ""}\n\n${request.prompt}` }] }],
        }),
        signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
      },
    );
    if (!response.ok) throw new Error(`AI_GATEWAY_GEMINI_HTTP_${response.status}`);
    const body = await response.json() as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] };
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string" || !text.trim()) throw new Error("AI_GATEWAY_EMPTY_PROVIDER_RESULT");
    return text.trim();
  },
};

/**
 * OpenAI adapter (owner mission 2026-10-10, LINE BUSINESS AI). OPENAI_API_KEY
 * was already provisioned on Railway but no adapter existed to use it — the
 * resolver therefore returned AI_NO_COMPATIBLE_ADAPTER and every free-text
 * question collapsed to "ไม่มี AI". Same contract as gemini (fetch-based, no
 * new dependency): configured = OPENAI_API_KEY present.
 */
export const openaiAdapter: AiAdapter = {
  id: "openai",
  kind: "ai",
  capabilities: ["conversation.answer", "intent.classify", "text.entity_extract"],
  runtimes: ["next", "deno"],
  status(context): AiAdapterStatus {
    const configured = Boolean(envOf(context)("OPENAI_API_KEY"));
    return {
      configured,
      reason: configured ? "OPENAI_API_KEY present" : "OPENAI_API_KEY missing",
      model: envOf(context)("AI_GATEWAY_OPENAI_MODEL") ?? OPENAI_DEFAULT_MODEL,
      endpoint: "api.openai.com",
    };
  },
  async invoke(request, context) {
    const env = envOf(context);
    const apiKey = env("OPENAI_API_KEY");
    if (!apiKey) throw new Error("AI_GATEWAY_OPENAI_NOT_CONFIGURED");
    const model = env("AI_GATEWAY_OPENAI_MODEL") ?? OPENAI_DEFAULT_MODEL;
    const response = await fetchOf(context)("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          ...(request.systemPrompt ? [{ role: "system", content: request.systemPrompt }] : []),
          { role: "user", content: request.prompt },
        ],
      }),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`AI_GATEWAY_OPENAI_HTTP_${response.status}`);
    const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) throw new Error("AI_GATEWAY_EMPTY_PROVIDER_RESULT");
    return text.trim();
  },
};

/**
 * Implementations the gateway may execute, keyed by adapter id. `digitalocean`
 * is deliberately absent: its real execution path is the worker adapter
 * (workerAdapters/digitalOceanWorkerAdapter.ts) and the registry keeps it
 * disabled — a declared provider with no executable adapter must never be
 * selectable, which the resolver enforces.
 */
export const AI_ADAPTER_IMPLEMENTATIONS: Partial<Record<AiAdapterId, AiAdapter>> = {
  ollama: ollamaAdapter,
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
  openai: openaiAdapter,
};
