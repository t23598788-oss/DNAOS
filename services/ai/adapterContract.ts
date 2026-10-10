/**
 * DNA OS — AI Adapter Contract (PHASE A4, owner 2026-09-23).
 *
 * ONE LOGICAL AI AUTHORITY, NOT ONE NETWORK HOP (owner decision after A0–A3):
 * this file is the shared *contract* every runtime obeys. Next, Deno and the
 * device/local runtime may each execute an adapter inside their own process, but
 * all three use the same capability identity, adapter declaration semantics,
 * selection rules, result contract, evidence requirements and authority limits.
 * No runtime may invent its own provider-selection policy.
 *
 * Terminology (locked here, used identically everywhere):
 *   Capability = what DNA OS needs done         (e.g. "document.ocr")
 *   Adapter    = implementation able to do it   (e.g. the ollama adapter)
 *   Provider   = the external/local AI service behind that adapter
 *   Model      = adapter CONFIGURATION, never a capability identity
 *   Resolver   = DNA OS selection authority (services/ai/resolver.ts)
 *
 * A business caller names ONLY a capability — never a provider, model or runtime.
 * That is what makes a new provider require zero business-caller edits.
 */
export type AiCapability =
  | "conversation.answer"
  | "intent.classify"
  | "screen.describe"
  | "document.ocr"
  | "document.event_extract"
  | "document.crop"
  | "memory.draft"
  | "material.resolve"
  | "code.generate"
  // A5.5 — added from real Deno callers in line-webhook-v2/helpers.ts, named by
  // the WORK requested, never by Gemini (the provider that happens to implement
  // them today):
  //   extractStructuredEntitiesWithGemini(text) -> text.entity_extract
  //   resolveAddressToCoordinates(address)      -> location.geocode
  | "text.entity_extract"
  | "location.geocode";

export type AiEffect = "analysis" | "classification" | "draft";

/** Adapter ids. A provider name is an adapter id — never a capability. */
export type AiAdapterId = "ollama" | "anthropic" | "gemini" | "digitalocean" | "openai";

/** Back-compat alias: was `"anthropic" | "ollama"` before A4 — only widened
 * (additive), so every existing comparison still type-checks. */
export type AiProviderName = AiAdapterId;

/** Where an adapter may execute. The same contract is portable across these. */
export type AiRuntimeKind = "next" | "deno" | "device";

/** Fail-closed reasons. There is no silent fallback to another provider. */
export type AiSelectionFailureCode =
  | "AI_GATEWAY_CAPABILITY_NOT_REGISTERED"
  | "AI_NO_COMPATIBLE_ADAPTER"
  | "AI_ADAPTER_CONSTRAINT_UNSATISFIED";

export interface AiGatewayImage {
  base64: string;
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
  // `providerHint` was intentionally REMOVED in A5.2: a business caller must not
  // choose a provider. Explicit selection survives only as a privileged resolver
  // option (AiGatewayDependencies.adapterConstraint).
}

export interface AiProvenance {
  requestId: string;
  origin: string;
  ownerId: string;
  sessionId: string;
  capability: AiCapability;
  effect: AiEffect;
  /** The adapter ACTUALLY selected by the resolver (evidence, not instruction).
   *  "unselected" = selection failed BEFORE any adapter could serve this request
   *  (fail-closed). It is never a provider name and never a fallback. */
  provider: AiProviderName | "unselected";
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
  /** Adapter the resolver selected; "unselected" = fail-closed before selection. */
  provider: AiProviderName | "unselected";
  occurredAt: string;
  error?: string;
}

/** What an adapter receives. Deliberately free of business workflow. */
export interface AiAdapterInvokeRequest {
  capability: AiCapability;
  systemPrompt?: string;
  prompt: string;
  image?: AiGatewayImage;
  maxTokens: number;
}

export interface AiAdapterInvokeContext {
  /** Resolver-selected runtime (the same adapter may run in more than one). */
  runtime: AiRuntimeKind;
  /** Model the resolver read from the adapter declaration for THIS capability.
   *  Model is configuration — never something a business caller names. */
  model?: string | null;
  /** Test/DI seam only — never a production path around configuration. */
  env?: (name: string) => string | undefined;
  fetchImpl?: typeof fetch;
}

export interface AiAdapterStatus {
  configured: boolean;
  reason: string;
  /** Model identity is adapter configuration, never a capability. */
  model: string | null;
  endpoint: string | null;
}

export interface AiAdapter {
  id: AiAdapterId;
  kind: "ai";
  /** Capabilities this adapter really implements (proven by census). */
  capabilities: AiCapability[];
  runtimes: AiRuntimeKind[];
  status(context?: AiAdapterInvokeContext): AiAdapterStatus;
  invoke(request: AiAdapterInvokeRequest, context: AiAdapterInvokeContext): Promise<string>;
}

/** One machine-readable adapter declaration (registry/ai-adapter-registry.json). */
export interface AiAdapterDeclaration {
  id: AiAdapterId;
  kind: "ai";
  provider: string;
  /** Human-readable name for configuration screens (A10) — data, not a second list. */
  display_name?: string;
  runtimes: AiRuntimeKind[];
  capabilities: AiCapability[];
  /** A8: where each capability is really available, per runtime. Adapter
   *  CONFIGURATION — never a business capability→provider map. */
  capabilities_by_runtime?: Record<string, AiCapability[]>;
  enabled: boolean;
  /** Lower number wins. Deterministic policy — never a capability→provider map. */
  priority: number;
  authorization: { requirement: "none" | "owner-approved" | "credential"; note: string };
  configuration: {
    required_any_env: string[];
    endpoint_env: string | null;
    model_env: string | null;
    default_model: string | null;
    /** Per-capability model — configuration the RESOLVER reads and hands to the
     *  adapter, so a caller never names a model. Proven values only. */
    capability_models?: Record<string, string>;
    /** Same code the pre-A4 gateway threw, so error parity is preserved. */
    unconfigured_error: string;
  };
  execution: { status: "gateway-adapter" | "worker-adapter-only"; note: string };
  declared_by: string;
  evidence: string;
}

export interface AiAdapterRegistryFile {
  version: number;
  kind: "ai_adapter_registry";
  note: string;
  authority: { entry: string; selection: string };
  policy: { selection: string; fallback: string; fail_closed: boolean; tie_break: string };
  /** capability -> the business work it names (documentation, not routing). */
  capabilities: Record<string, string>;
  adapters: AiAdapterDeclaration[];
}

