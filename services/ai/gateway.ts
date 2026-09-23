/**
 * DNA OS — AI Gateway (entry point). PHASE A5 refactor, owner 2026-09-23.
 *
 * `invokeAiGateway()` stays the canonical Next entry with the SAME signature,
 * context validation, effect guard, prompt cap, evidence emission, provenance
 * shape, result contract and error vocabulary. What changed is what sits behind
 * it — this file is no longer registry + resolver + provider implementations +
 * entry point at once:
 *
 *   capability (business request)
 *     -> services/ai/resolver.ts            (selection authority, shared contract)
 *     -> registry/ai-adapter-registry.json  (machine-readable declarations)
 *     -> services/ai/adapters.ts            (implementation)
 *     -> provenance records the adapter ACTUALLY selected (evidence, not instruction)
 *
 * A5.2: `providerHint` is gone from the business request; privileged explicit
 * selection survives only as `deps.adapterConstraint` (runtime/diagnostic/
 * owner-config). A4/A5: the AI has no canonical-write authority — this file only
 * returns text.
 */
import { supabaseAdmin } from "@/services/supabase/queries";
import { loadAiAdapterRegistry, selectAiAdapter, type AiAdapterConstraint } from "./resolver";
import type {
  AiAdapter, AiAdapterId, AiAdapterRegistryFile, AiCapability, AiEvidenceEvent, AiGatewayRequest,
  AiGatewayResult, AiProviderName, AiProvenance, AiRuntimeKind, AiAdapterInvokeContext,
} from "./adapterContract";

export type {
  AiCapability, AiEffect, AiProviderName, AiAdapterId, AiRuntimeKind,
  AiGatewayImage, AiGatewayRequest, AiProvenance, AiGatewayResult, AiEvidenceEvent,
  AiAdapter, AiAdapterDeclaration, AiAdapterStatus, AiAdapterRegistryFile,
} from "./adapterContract";

export interface AiGatewayDependencies {
  emitEvidence?: (event: AiEvidenceEvent) => Promise<void>;
  reportFailure?: (input: { request: AiGatewayRequest; error: string; evidenceId: string }) => Promise<void>;
  now?: () => string;
  requestId?: () => string;
  /** Privileged explicit selection (test/diagnostics/owner-config) — A5.2. */
  adapterConstraint?: AiAdapterConstraint;
  /** Test/DI seam: a fixture registry (proves an added adapter needs no business edit). */
  registry?: AiAdapterRegistryFile;
  /** Test/DI seam: adapter implementations keyed by id. */
  implementations?: Partial<Record<AiAdapterId, AiAdapter>>;
  /** Which runtime contract this caller obeys (default "next"). */
  runtime?: AiRuntimeKind;
  /** Test/DI seam passed through to the selected adapter. */
  context?: AiAdapterInvokeContext;
}


function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Same guards as before A5. The capability check now asks the registry — a
 * capability exists iff at least one adapter declares it — instead of the
 * removed static map. */
function assertSafeRequest(request: AiGatewayRequest): void {
  if (!request.origin || !request.ownerId || !request.sessionId) throw new Error("AI_GATEWAY_CONTEXT_REQUIRED");
  if (!request.capability || !loadAiAdapterRegistry().capabilities[request.capability]) throw new Error("AI_GATEWAY_CAPABILITY_NOT_REGISTERED");
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

export async function invokeAiGateway(request: AiGatewayRequest, deps: AiGatewayDependencies = {}): Promise<AiGatewayResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const requestId = deps.requestId?.() ?? id("ai");
  const evidenceId = id("evidence");
  // Selection runs BEFORE the guard block only so a denied request still carries
  // the same adapter identity it had pre-A4 (evidence parity). Selection never
  // invokes anything — the guards below still decide the outcome.
  const selection = selectAiAdapter(request.capability, {
    adapterConstraint: deps.adapterConstraint,
    registry: deps.registry,
    implementations: deps.implementations,
    runtime: deps.runtime ?? "next",
    context: deps.context,
  });
  const provenance: AiProvenance = {
    requestId,
    origin: request.origin,
    ownerId: request.ownerId,
    sessionId: request.sessionId,
    capability: request.capability,
    effect: request.effect,
    provider: selection.ok ? selection.id : "unselected",
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

  if (!selection.ok) {
    // Fail closed: no compatible adapter means NO invocation and NO fallback to
    // another provider — the resolver's reason becomes the result and evidence.
    await emit({ ...provenance, status: "failed", error: selection.error });
    await deps.reportFailure?.({ request, error: selection.error, evidenceId });
    return { ok: false, output: null, error: selection.error, provenance };
  }

  await emit({ ...provenance, status: "requested" });
  try {
    const output = await selection.adapter.invoke(
      {
        capability: request.capability,
        systemPrompt: request.systemPrompt,
        prompt: request.prompt,
        image: request.image,
        maxTokens: request.maxTokens ?? 600,
      },
      { ...(deps.context ?? {}), runtime: selection.runtime, model: selection.model },
    );
    await emit({ ...provenance, status: "completed" });
    return { ok: true, output, provenance };
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI_GATEWAY_PROVIDER_FAILED";
    await emit({ ...provenance, status: "failed", error: message });
    await deps.reportFailure?.({ request, error: message, evidenceId });
    return { ok: false, output: null, error: message, provenance };
  }
}

/**
 * Kept for back-compat (it had no caller even before A5). It now answers from the
 * resolver instead of the removed static map: the adapter that WOULD serve this
 * capability, or null when nothing declares it.
 */
export function aiGatewayProviderFor(capability: AiCapability): AiProviderName | null {
  const registry = loadAiAdapterRegistry();
  if (!registry.capabilities[capability]) return null;
  const selection = selectAiAdapter(capability);
  if (selection.ok) return selection.id;
  const declared = registry.adapters
    .filter((d) => d.capabilities.includes(capability))
    .sort((a, b) => (a.priority - b.priority) || (a.id < b.id ? -1 : 1))[0];
  return declared ? declared.id : null;
}


