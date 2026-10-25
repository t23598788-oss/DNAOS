/**
 * DNA OS — Deno AI capability runtime (PHASE A7). An implementation of the same
 * contract as services/ai/*: selection is deterministic and fail-closed, there is
 * no static capability→provider map and no silent fallback, and only the ADAPTER
 * touches a provider credential — business callers name a capability only.
 *
 * Evidence: canonical AI execution must not run and silently drop its evidence
 * (A7.10), so readiness (credential present + evidence path available) is checked
 * BEFORE any provider call; a missing evidence path fails closed with the same
 * code the Node/Next contract uses.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4";
import {
  DENO_AI_DECLARATIONS, DENO_AI_POLICY,
  type DenoAiAdapterDeclaration, type DenoAiCapability, type DenoAiResult,
} from "./contract.ts";
import { ensureTraceId } from "./traceContract.ts";

const readEnv = (name: string): string | undefined => Deno.env.get(name) ?? undefined;

export interface DenoAiInvokeRequest {
  systemPrompt?: string;
  prompt: string;
  image?: { base64: string; mediaType: string };
  maxTokens: number;
}

interface DenoAiAdapter {
  id: string;
  invoke(request: DenoAiInvokeRequest, config: { model: string | null }): Promise<string>;
}

/** The ONLY place a provider credential is read, inside this runtime boundary. */
function credentialOf(declaration: DenoAiAdapterDeclaration): string | null {
  for (const name of declaration.credential_env) {
    const value = readEnv(name);
    if (value) return value;
  }
  return null;
}

const anthropicAdapter: DenoAiAdapter = {
  id: "anthropic",
  async invoke(request, config) {
    const apiKey = readEnv("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("AI_GATEWAY_ANTHROPIC_NOT_CONFIGURED");
    const contentBlock = request.image
      ? [
          { type: "text", text: request.prompt },
          request.image.mediaType === "application/pdf"
            ? { type: "document", source: { type: "base64", media_type: request.image.mediaType, data: request.image.base64 } }
            : { type: "image", source: { type: "base64", media_type: request.image.mediaType, data: request.image.base64 } },
        ]
      : request.prompt;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: config.model ?? "claude-haiku-4-5-20251001",
        max_tokens: request.maxTokens,
        temperature: 0,
        system: request.systemPrompt ?? "",
        messages: [{ role: "user", content: contentBlock }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`AI_GATEWAY_ANTHROPIC_HTTP_${res.status}`);
    const json = await res.json();
    const block = json?.content?.find((c: { type?: string }) => c.type === "text");
    const text = typeof block?.text === "string" ? block.text.trim() : "";
    if (!text) throw new Error("AI_GATEWAY_EMPTY_PROVIDER_RESULT");
    return text;
  },
};

const geminiAdapter: DenoAiAdapter = {
  id: "gemini",
  async invoke(request, config) {
    const apiKey = readEnv("GEMINI_API_KEY");
    if (!apiKey) throw new Error("AI_GATEWAY_GEMINI_NOT_CONFIGURED");
    // Same model configuration as services/ai/adapters.ts: capability model →
    // AI_GATEWAY_GEMINI_MODEL → declared default (gemini-2.5-flash-lite).
    const model = config.model ?? readEnv("AI_GATEWAY_GEMINI_MODEL") ?? "gemini-2.5-flash-lite";
    // Key travels in the x-goog-api-key header, never in the URL.
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `${request.systemPrompt ?? ""}\n\n${request.prompt}` }] }],
        generationConfig: { maxOutputTokens: request.maxTokens, temperature: 0.1, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`AI_GATEWAY_GEMINI_HTTP_${res.status}`);
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string" || !text.trim()) throw new Error("AI_GATEWAY_EMPTY_PROVIDER_RESULT");
    return text.trim();
  },
};

const ADAPTERS: Record<string, DenoAiAdapter> = { anthropic: anthropicAdapter, gemini: geminiAdapter };

export type DenoAiSelection =
  | { ok: true; declaration: DenoAiAdapterDeclaration; adapter: DenoAiAdapter; model: string | null }
  | { ok: false; code: string; error: string };

/** Same algorithm as services/ai/resolver.ts, executed in the Deno runtime. */
export function selectDenoAiAdapter(capability: DenoAiCapability, runtime = "deno"): DenoAiSelection {
  const declared = DENO_AI_DECLARATIONS.some((d) => d.capabilities.includes(capability));
  if (!declared) {
    return { ok: false, code: "AI_GATEWAY_CAPABILITY_NOT_REGISTERED", error: `AI_GATEWAY_CAPABILITY_NOT_REGISTERED: ${capability}` };
  }
  const capsOf = (d: DenoAiAdapterDeclaration) => d.capabilities_by_runtime?.[runtime] ?? d.capabilities;
  const usable = DENO_AI_DECLARATIONS
    .filter((d) => d.enabled && d.runtimes.includes(runtime) && ADAPTERS[d.id] && capsOf(d).includes(capability))
    .sort((a, b) => (a.priority !== b.priority ? a.priority - b.priority : a.id < b.id ? -1 : 1));
  if (usable.length === 0) {
    return { ok: false, code: "AI_NO_COMPATIBLE_ADAPTER", error: `AI_NO_COMPATIBLE_ADAPTER: no enabled, runtime-compatible adapter declares ${capability} (runtime ${runtime})` };
  }
  // Capability constraint (2026-10-20): same env name and semantics as Node
  // (services/ai/resolver.ts). Restricts to ONE adapter; no priority change, no fallback.
  const constraintId = readEnv(`AI_GATEWAY_PREFERRED_ADAPTER_${capability.replace(/\./g, "_").toUpperCase()}`)?.trim();
  const constrained = constraintId ? usable.filter((d) => d.id === constraintId) : usable;
  if (constrained.length === 0) {
    return { ok: false, code: "AI_ADAPTER_CONSTRAINT_UNSATISFIED", error: `AI_ADAPTER_CONSTRAINT_UNSATISFIED: ${constraintId} cannot serve ${capability} on runtime ${runtime}` };
  }
  const configured = constrained.find((d) => d.credential_env.length === 0 || credentialOf(d) !== null);
  if (!configured) {
    // Fail closed with the same code the Node/Next contract produces — never a
    // silent attempt with a different provider.
    return { ok: false, code: constrained[0].unconfigured_error, error: constrained[0].unconfigured_error };
  }
  return { ok: true, declaration: configured, adapter: ADAPTERS[configured.id], model: configured.capability_models?.[capability] ?? null };
}

/** Readiness for health/observability — separated, not collapsed into "provider answers". */
export interface DenoAiAdapterReadiness {
  id: string;
  runtimeCompatible: boolean;
  enabled: boolean;
  configured: boolean;
  credentialPresent: boolean;
  capabilityReady: DenoAiCapability[];
  reason: string;
}

export function describeDenoAiReadiness(runtime = "deno"): DenoAiAdapterReadiness[] {
  return DENO_AI_DECLARATIONS.map((d) => {
    const runtimeCompatible = d.runtimes.includes(runtime);
    const credentialPresent = d.credential_env.length === 0 ? true : credentialOf(d) !== null;
    const declaredForRuntime = d.capabilities_by_runtime?.[runtime] ?? d.capabilities;
    const capabilityReady = d.enabled && runtimeCompatible && credentialPresent
      ? declaredForRuntime.filter((c) => selectDenoAiAdapter(c, runtime).ok)
      : [];
    const reason = !d.enabled ? "disabled by the adapter registry"
      : !runtimeCompatible ? `not declared for the ${runtime} runtime`
      : !credentialPresent ? `credential not present (${d.credential_env.join("/")})`
      : "configured and runtime-compatible";
    return { id: d.id, runtimeCompatible, enabled: d.enabled, configured: credentialPresent, credentialPresent, capabilityReady, reason };
  });
}

function evidenceClient() {
  const url = readEnv("SUPABASE_URL");
  const key = readEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key);
}

/** Record one AI invocation. Throws when the evidence path is unavailable. */
export async function emitAiEvidence(event: Record<string, unknown>): Promise<void> {
  const client = evidenceClient();
  if (!client) throw new Error("AI_GATEWAY_EVIDENCE_UNAVAILABLE");
  const { error } = await client.from("system_health_status").upsert({
    service_key: "dna_os_ai_gateway",
    check_kind: "ai_invocation",
    status: event.status === "failed" ? "degraded" : "healthy",
    consecutive_failures: event.status === "failed" ? 1 : 0,
    last_check_at: new Date().toISOString(),
    last_error: (event.error as string | undefined) ?? null,
    detail: event,
  }, { onConflict: "service_key" });
  if (error) throw new Error(`AI_GATEWAY_EVIDENCE_FAILED:${error.message}`);
}

/**
 * The Deno entry point every business caller uses: capability in, normalized
 * result out, with the adapter/model that really executed reported as evidence.
 */
export async function runAiCapability(
  capability: DenoAiCapability,
  request: DenoAiInvokeRequest,
  options: { origin: string; ownerId: string; sessionId: string; traceId?: string },
): Promise<DenoAiResult> {
  // Trace id: reuse the caller's id, mint one when absent (2026-10-20).
  const traceId = ensureTraceId(options.traceId, () => crypto.randomUUID());
  const selection = selectDenoAiAdapter(capability);
  if (!selection.ok) {
    return { ok: false, output: null, adapterId: null, model: null, error: selection.error, evidenceRecorded: false, traceId };
  }
  // Request ID is minted here and stored in every evidence row, so one AI call
  // can be traced from business caller to the provider that answered (2026-10-20).
  const requestId = crypto.randomUUID();
  const base = {
    traceId, requestId, capability, origin: options.origin, ownerId: options.ownerId, sessionId: options.sessionId,
    adapterId: selection.declaration.id, model: selection.model, policy: DENO_AI_POLICY.selection,
  };
  try {
    // Readiness before execution: no provider call happens if evidence cannot be written.
    await emitAiEvidence({ ...base, status: "requested" });
    const raw = await selection.adapter.invoke(request, { model: selection.model });
    // Same normalization as services/ai/outputNormalization.ts (Node) — one standard.
    const output = raw.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/<\|[a-z_]+\|>/gi, "").trim();
    if (!output) throw new Error("AI_GATEWAY_EMPTY_PROVIDER_RESULT");
    await emitAiEvidence({ ...base, status: "completed" });
    return { ok: true, output, adapterId: selection.declaration.id, model: selection.model, requestId, traceId, evidenceRecorded: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI_GATEWAY_PROVIDER_FAILED";
    try { await emitAiEvidence({ ...base, status: "failed", error: message }); } catch { /* the failure is already being reported */ }
    return {
      ok: false, output: null, adapterId: selection.declaration.id, model: selection.model,
      requestId, traceId, error: message, evidenceRecorded: message !== "AI_GATEWAY_EVIDENCE_UNAVAILABLE",
    };
  }
}


