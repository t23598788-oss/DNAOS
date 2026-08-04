import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/services/supabase/queries";

export type AiCapability =
  | "conversation.answer"
  | "intent.classify"
  | "screen.describe"
  | "document.ocr"
  | "document.event_extract"
  | "document.crop"
  | "memory.draft"
  | "material.resolve";

export type AiEffect = "analysis" | "classification" | "draft";
export type AiProviderName = "anthropic" | "ollama";

export interface AiGatewayImage {
  base64: string;
  // Real Anthropic SDK accepted literals (node_modules/@anthropic-ai/sdk
  // resources/messages/messages.d.ts's Base64ImageSource for images,
  // Base64PDFSource for documents) — a bare `string` doesn't narrow to
  // these, which is what made anthropicProvider()'s content-block call
  // fail type-check.
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" | "application/pdf";
}

export interface AiGatewayRequest {
  origin: string;
  ownerId: string;
  sessionId: string;
  capability: AiCapability;
  effect: AiEffect;
  systemPrompt?: string;
  prompt: string;
  image?: AiGatewayImage;
  maxTokens?: number;
  providerHint?: AiProviderName;
}

export interface AiProvenance {
  requestId: string;
  origin: string;
  ownerId: string;
  sessionId: string;
  capability: AiCapability;
  effect: AiEffect;
  provider: AiProviderName;
  evidenceId: string;
  occurredAt: string;
}

export interface AiGatewayResult {
  ok: boolean;
  output: string | null;
  error?: string;
  provenance: AiProvenance;
}

export interface AiEvidenceEvent {
  evidenceId: string;
  requestId: string;
  status: "requested" | "completed" | "failed" | "denied";
  origin: string;
  ownerId: string;
  sessionId: string;
  capability: AiCapability;
  effect: AiEffect;
  provider: AiProviderName;
  occurredAt: string;
  error?: string;
}

export interface AiProviderRequest {
  systemPrompt?: string;
  prompt: string;
  image?: AiGatewayImage;
  maxTokens: number;
}

export interface AiProvider {
  complete(request: AiProviderRequest): Promise<string>;
}

export interface AiGatewayDependencies {
  providers?: Partial<Record<AiProviderName, AiProvider>>;
  emitEvidence?: (event: AiEvidenceEvent) => Promise<void>;
  reportFailure?: (input: { request: AiGatewayRequest; error: string; evidenceId: string }) => Promise<void>;
  now?: () => string;
  requestId?: () => string;
}

const CAPABILITY_PROVIDER: Record<AiCapability, AiProviderName> = {
  "conversation.answer": "ollama",
  "intent.classify": "ollama",
  "screen.describe": "ollama",
  "document.ocr": "anthropic",
  "document.event_extract": "anthropic",
  "document.crop": "ollama",
  "memory.draft": "ollama",
  "material.resolve": "ollama",
};

function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function assertSafeRequest(request: AiGatewayRequest): void {
  if (!request.origin || !request.ownerId || !request.sessionId) throw new Error("AI_GATEWAY_CONTEXT_REQUIRED");
  if (!request.capability || !CAPABILITY_PROVIDER[request.capability]) throw new Error("AI_GATEWAY_CAPABILITY_NOT_REGISTERED");
  if (!["analysis", "classification", "draft"].includes(request.effect)) throw new Error("AI_GATEWAY_EFFECT_DENIED");
  if (!request.prompt || request.prompt.length > 200_000) throw new Error("AI_GATEWAY_PROMPT_INVALID");
}

async function emitDefaultEvidence(event: AiEvidenceEvent): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("AI_GATEWAY_EVIDENCE_UNAVAILABLE");
  }
  const { error } = await supabaseAdmin().from("system_health_status").upsert({
    service_key: "dna_os_ai_gateway",
    check_kind: "ai_invocation",
    status: event.status === "failed" || event.status === "denied" ? "degraded" : "healthy",
    consecutive_failures: event.status === "failed" || event.status === "denied" ? 1 : 0,
    last_check_at: event.occurredAt,
    last_error: event.error ?? null,
    detail: event,
  }, { onConflict: "service_key" });
  if (error) throw new Error(`AI_GATEWAY_EVIDENCE_FAILED:${error.message}`);
}

function anthropicProvider(): AiProvider {
  return {
    async complete(request) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
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
        model: "claude-haiku-4-5-20251001",
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
}

function ollamaProvider(): AiProvider {
  return {
    async complete(request) {
      const baseUrl = process.env.AI_GATEWAY_OLLAMA_URL;
      if (!baseUrl) throw new Error("AI_GATEWAY_OLLAMA_NOT_CONFIGURED");
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.AI_GATEWAY_OLLAMA_MODEL ?? "thawatchai",
          system: request.systemPrompt,
          prompt: request.prompt,
          images: request.image ? [request.image.base64] : undefined,
          stream: false,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`AI_GATEWAY_OLLAMA_HTTP_${response.status}`);
      const body = await response.json() as { response?: unknown };
      if (typeof body.response !== "string" || !body.response.trim()) throw new Error("AI_GATEWAY_EMPTY_PROVIDER_RESULT");
      return body.response.trim();
    },
  };
}

export async function invokeAiGateway(request: AiGatewayRequest, deps: AiGatewayDependencies = {}): Promise<AiGatewayResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const requestId = deps.requestId?.() ?? id("ai");
  const evidenceId = id("evidence");
  const providerName = request.providerHint ?? CAPABILITY_PROVIDER[request.capability];
  const provenance: AiProvenance = {
    requestId,
    origin: request.origin,
    ownerId: request.ownerId,
    sessionId: request.sessionId,
    capability: request.capability,
    effect: request.effect,
    provider: providerName,
    evidenceId,
    occurredAt: now(),
  };
  const emit = deps.emitEvidence ?? emitDefaultEvidence;

  try {
    assertSafeRequest(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI_GATEWAY_REQUEST_DENIED";
    await emit({ ...provenance, status: "denied", error: message });
    return { ok: false, output: null, error: message, provenance };
  }

  await emit({ ...provenance, status: "requested" });
  try {
    const provider = deps.providers?.[providerName] ?? (providerName === "anthropic" ? anthropicProvider() : ollamaProvider());
    const output = await provider.complete({
      systemPrompt: request.systemPrompt,
      prompt: request.prompt,
      image: request.image,
      maxTokens: request.maxTokens ?? 600,
    });
    await emit({ ...provenance, status: "completed" });
    return { ok: true, output, provenance };
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI_GATEWAY_PROVIDER_FAILED";
    await emit({ ...provenance, status: "failed", error: message });
    await deps.reportFailure?.({ request, error: message, evidenceId });
    return { ok: false, output: null, error: message, provenance };
  }
}

export function aiGatewayProviderFor(capability: AiCapability): AiProviderName {
  return CAPABILITY_PROVIDER[capability];
}
