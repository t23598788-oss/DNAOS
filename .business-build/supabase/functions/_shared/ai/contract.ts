/**
 * DNA OS — Deno AI capability contract (PHASE A7, owner 2026-09-23).
 *
 * ONE LOGICAL AI AUTHORITY, NOT ONE NETWORK HOP: the Deno/Supabase-Functions
 * runtime obeys the SAME contract A4–A6 proved for Node/Next — capability
 * identity, adapter identity, supported capabilities, enabled state, priority,
 * runtime compatibility, fail-closed behaviour, no-fallback policy, credential
 * requirement, readiness requirements and the normalized result/evidence
 * vocabulary. Deno executes inside its own runtime (no forced HTTP hop to the
 * Next gateway), but it is an *implementation* of that one contract — never a
 * second selection authority.
 *
 * The declarations below mirror registry/ai-adapter-registry.json. They are a
 * checked snapshot, not a second source of truth: scripts/ai-deno-cutover-test.ts
 * fails if they drift from the canonical registry.
 */
export type DenoAiCapability =
  | "conversation.answer"
  | "intent.classify"
  | "screen.describe"
  | "document.ocr"
  | "document.event_extract"
  | "document.crop"
  | "memory.draft"
  | "material.resolve"
  | "code.generate"
  | "text.entity_extract"
  | "location.geocode";

export interface DenoAiAdapterDeclaration {
  id: string;
  capabilities: DenoAiCapability[];
  /** A8: where each capability is really available, per runtime. */
  capabilities_by_runtime?: Record<string, DenoAiCapability[]>;
  /** Runtime contracts this adapter can execute in ("deno" = this runtime). */
  runtimes: string[];
  enabled: boolean;
  /** Lower wins; deterministic tie-break on id. */
  priority: number;
  /** Credential env names the ADAPTER may read (never a business caller). */
  credential_env: string[];
  model_env: string | null;
  default_model: string | null;
  /** Same code the Node/Next contract produces for the same situation. */
  unconfigured_error: string;
  /** What the model is when a capability has its own proven value. */
  capability_models?: Record<string, string>;
}

export interface DenoAiResult {
  ok: boolean;
  output: string | null;
  /** Evidence of which adapter/model really executed — never an instruction. */
  adapterId: string | null;
  model: string | null;
  /** Trace id of the business request (reused when supplied, minted when absent). */
  traceId?: string;
  /** Gateway invocation id; the same id is written to every evidence row. */
  requestId?: string;
  error?: string;
  evidenceRecorded: boolean;
}

export const DENO_AI_POLICY = {
  selection: "registry_order_then_adapter_priority",
  fallback: "none",
  fail_closed: true,
  tie_break: "priority ascending, then adapter id ascending (deterministic)",
} as const;

export const DENO_AI_DECLARATIONS: DenoAiAdapterDeclaration[] = [
  {
    id: "anthropic",
    capabilities: ["code.generate", "conversation.answer", "document.event_extract", "document.ocr", "intent.classify", "memory.draft", "text.entity_extract"],
    capabilities_by_runtime: {
      next: ["document.ocr", "document.event_extract", "code.generate", "text.entity_extract"],
      deno: ["document.ocr", "conversation.answer", "memory.draft", "intent.classify", "text.entity_extract"],
    },
    runtimes: ["next", "deno"],
    enabled: true,
    priority: 20,
    credential_env: ["ANTHROPIC_API_KEY"],
    model_env: null,
    default_model: "claude-haiku-4-5-20251001",
    unconfigured_error: "AI_GATEWAY_ANTHROPIC_NOT_CONFIGURED",
  },
  {
    id: "gemini",
    capabilities: ["location.geocode", "text.entity_extract"],
    capabilities_by_runtime: {
      next: ["text.entity_extract", "location.geocode"],
      deno: ["text.entity_extract", "location.geocode"],
    },
    runtimes: ["deno", "next"],
    enabled: true,
    priority: 30,
    credential_env: ["GEMINI_API_KEY"],
    model_env: "AI_GATEWAY_GEMINI_MODEL",
    default_model: "gemini-2.5-flash-lite",
    unconfigured_error: "AI_GATEWAY_GEMINI_NOT_CONFIGURED",
  },
  {
    id: "ollama",
    capabilities: ["conversation.answer", "document.crop", "intent.classify", "material.resolve", "memory.draft", "screen.describe", "document.ocr", "text.entity_extract"],
    capabilities_by_runtime: {
      next: ["conversation.answer", "intent.classify", "screen.describe", "document.crop", "memory.draft", "material.resolve"],
      device: ["document.ocr", "text.entity_extract", "conversation.answer", "memory.draft", "material.resolve"],
    },
    runtimes: ["next", "device"],
    enabled: true,
    priority: 10,
    credential_env: [],
    model_env: "AI_GATEWAY_OLLAMA_MODEL",
    default_model: "thawatchai",
    unconfigured_error: "AI_GATEWAY_OLLAMA_NOT_CONFIGURED",
    capability_models: { "screen.describe": "qwen2.5vl:7b", "document.ocr": "qwen2.5vl:72b", "text.entity_extract": "thawatchai", "intent.classify": "qwen3:8b", "conversation.answer": "qwen3:8b" },
  },
  // mlx mirrors registry/ai-adapter-registry.json (PHASE A, 2026-10-18). Declared for
  // T29 parity only: runtimes = ["next"], so the Deno runtime never selects it, and
  // ADAPTERS in runtime.ts deliberately has no mlx implementation.
  {
    id: "mlx",
    capabilities: ["conversation.answer", "intent.classify"],
    capabilities_by_runtime: {
      next: ["conversation.answer", "intent.classify"],
    },
    runtimes: ["next"],
    enabled: true,
    priority: 15,
    credential_env: [],
    model_env: "AI_GATEWAY_MLX_MODEL",
    default_model: "mlx-community/Qwen3-4B-Instruct-2507-4bit",
    unconfigured_error: "AI_GATEWAY_MLX_NOT_CONFIGURED",
    capability_models: { "conversation.answer": "mlx-community/Qwen3-4B-Instruct-2507-4bit", "intent.classify": "mlx-community/Qwen3-4B-Instruct-2507-4bit" },
  },
  {
    id: "digitalocean",
    capabilities: ["code.generate"],
    runtimes: ["next"],
    enabled: false,
    priority: 40,
    credential_env: ["DIGITALOCEAN_INFERENCE_API_KEY"],
    model_env: "DIGITALOCEAN_INFERENCE_MODEL",
    default_model: "llama3-8b-instruct",
    unconfigured_error: "AI_GATEWAY_DIGITALOCEAN_NOT_CONFIGURED",
  },
  // openai mirrors registry/ai-adapter-registry.json (owner mission 2026-10-10,
  // then disabled by owner order 2026-07-25 + incident 2026-10-11 — see
  // disabled_reason in the canonical registry). Declared-but-disabled exactly
  // like digitalocean: present for T29 field-by-field parity, never selectable
  // (enabled: false AND no ADAPTERS["openai"] implementation in runtime.ts).
  {
    id: "openai",
    capabilities: ["conversation.answer", "intent.classify", "text.entity_extract"],
    capabilities_by_runtime: {
      next: ["conversation.answer", "intent.classify", "text.entity_extract"],
      deno: ["conversation.answer", "intent.classify", "text.entity_extract"],
    },
    runtimes: ["next", "deno"],
    enabled: false,
    priority: 30,
    credential_env: ["OPENAI_API_KEY"],
    model_env: "AI_GATEWAY_OPENAI_MODEL",
    default_model: "gpt-4o-mini",
    unconfigured_error: "AI_GATEWAY_OPENAI_NOT_CONFIGURED",
  },
];
