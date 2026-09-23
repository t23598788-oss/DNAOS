/**
 * DNA OS — AI Resolver (PHASE A5, owner 2026-09-23). The SINGLE logical
 * selection authority shared by every runtime contract (Next / Deno / device).
 *
 * Replaces the static CAPABILITY_PROVIDER map that used to live in gateway.ts.
 * Algorithm (deterministic, fail-closed, no silent fallback):
 *   1. the capability must be declared in the registry  -> AI_GATEWAY_CAPABILITY_NOT_REGISTERED
 *   2. candidates = declarations that support the capability, are runtime
 *      compatible, enabled, have a real implementation, and are configured
 *   3. if a privileged adapterConstraint is given, candidates are restricted to
 *      it; an empty result is AI_ADAPTER_CONSTRAINT_UNSATISFIED
 *   4. an empty candidate set is AI_NO_COMPATIBLE_ADAPTER (never a fallback)
 *   5. otherwise: priority ascending, then adapter id ascending -> one adapter
 *
 * A5.1: the initial policy is chosen so the EFFECTIVE routing is unchanged for
 * all 9 pre-existing capabilities. A5.2: selection is driven by the resolver,
 * never by the caller (providerHint no longer exists on the request).
 */
import { readFileSync } from "fs";
import { join } from "path";
import type {
  AiAdapter, AiAdapterDeclaration, AiAdapterId, AiAdapterInvokeContext, AiAdapterInvokeRequest,
  AiAdapterRegistryFile, AiCapability, AiRuntimeKind, AiSelectionFailureCode,
} from "./adapterContract";
import { AI_ADAPTER_IMPLEMENTATIONS } from "./adapters";

export interface AiAdapterConstraint {
  adapterId: AiAdapterId;
  /** Privileged reason — never a business route. */
  reason: "runtime" | "diagnostic" | "owner-config";
}

export interface AiResolverOptions {
  /** Test/DI seam: a fixture registry (proves a new provider needs zero business edits). */
  registry?: AiAdapterRegistryFile;
  /** Test/DI seam: adapter implementations keyed by id (a mock adapter lives here). */
  implementations?: Partial<Record<AiAdapterId, AiAdapter>>;
  runtime?: AiRuntimeKind;
  adapterConstraint?: AiAdapterConstraint;
  context?: AiAdapterInvokeContext;
}

export type AiSelection =
  | { ok: true; adapter: AiAdapter; declaration: AiAdapterDeclaration; id: AiAdapterId; runtime: AiRuntimeKind; model: string | null }
  | { ok: false; code: AiSelectionFailureCode | string; error: string; candidates: AiAdapterId[] };

/**
 * The registry is DATA, read from disk at runtime — deliberately not a static
 * `@/registry/...` import: the layer rules in registry/dependency-graph.json let
 * `services` import only `core`, and this mirrors the sanctioned precedent already
 * used inside core/runtime/*.ts (readFileSync + JSON.parse of a registry file).
 */
const REGISTRY_PATH = join(process.cwd(), "registry", "ai-adapter-registry.json");

export function loadAiAdapterRegistry(): AiAdapterRegistryFile {
  const parsed = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as AiAdapterRegistryFile;
  if (!parsed || parsed.kind !== "ai_adapter_registry" || !Array.isArray(parsed.adapters)) {
    throw new Error("AI_ADAPTER_REGISTRY_INVALID");
  }
  return parsed;
}

/** Capabilities this system can serve at all (registry-declared). */
export function listDeclaredCapabilities(registry: AiAdapterRegistryFile = loadAiAdapterRegistry()): AiCapability[] {
  return Object.keys(registry.capabilities) as AiCapability[];
}

const order = (a: AiAdapterDeclaration, b: AiAdapterDeclaration): number =>
  a.priority !== b.priority ? a.priority - b.priority : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function selectAiAdapter(capability: AiCapability, options: AiResolverOptions = {}): AiSelection {
  const registry = options.registry ?? loadAiAdapterRegistry();
  const implementations = options.implementations ?? AI_ADAPTER_IMPLEMENTATIONS;
  const runtime = options.runtime ?? "next";

  if (!registry.capabilities[capability]) {
    return { ok: false, code: "AI_GATEWAY_CAPABILITY_NOT_REGISTERED", error: `AI_GATEWAY_CAPABILITY_NOT_REGISTERED: ${capability}`, candidates: [] };
  }

  const supported = registry.adapters.filter((d) => d.capabilities.includes(capability));
  const usable = supported
    .filter((d) => d.enabled && d.runtimes.includes(runtime) && Boolean(implementations[d.id]))
    .sort(order);

  let candidates = usable;
  if (options.adapterConstraint) {
    candidates = usable.filter((d) => d.id === options.adapterConstraint!.adapterId);
    if (candidates.length === 0) {
      return {
        ok: false,
        code: "AI_ADAPTER_CONSTRAINT_UNSATISFIED",
        error: `AI_ADAPTER_CONSTRAINT_UNSATISFIED: ${options.adapterConstraint.adapterId} (${options.adapterConstraint.reason}) cannot serve ${capability} on runtime ${runtime}`,
        candidates: usable.map((d) => d.id),
      };
    }
  }
  if (candidates.length === 0) {
    return {
      ok: false,
      code: "AI_NO_COMPATIBLE_ADAPTER",
      error: `AI_NO_COMPATIBLE_ADAPTER: no enabled, runtime-compatible, implemented adapter declares ${capability} (runtime ${runtime})`,
      candidates: [],
    };
  }

  const configured = candidates.filter((d) => implementations[d.id]!.status(options.context).configured);
  const chosen = configured[0] ?? null;
  if (!chosen) {
    // Fail closed exactly like the pre-A4 gateway did for an unconfigured
    // provider: the SAME declared error code, no invocation, and — critically —
    // no attempt at any other provider.
    const first = candidates[0];
    return { ok: false, code: first.configuration.unconfigured_error, error: first.configuration.unconfigured_error, candidates: candidates.map((d) => d.id) };
  }

  // Model is configuration: the declaration decides it for this capability (a
  // per-capability override wins, then the env var, then the declared default) —
  // the adapter only receives the answer, and the caller never sees a model name.
  const model = chosen.configuration.capability_models?.[capability] ?? null;

  return {
    ok: true,
    adapter: implementations[chosen.id]!,
    declaration: chosen,
    id: chosen.id,
    runtime,
    model,
  };
}

/**
 * Worker/route-layer convenience: ask the resolver what would serve a capability
 * instead of each layer reading provider env vars itself (A6.4). This keeps ONE
 * provider-selection authority — callers describe, the resolver decides.
 */
export interface AiAdapterDescription {
  available: boolean;
  reason: string;
  adapterId: AiAdapterId | null;
  model: string | null;
  /** Adapter-declared endpoint (configuration), never read from env by callers. */
  endpoint: string | null;
}

export function describeAiAdapterFor(capability: AiCapability, options: AiResolverOptions = {}): AiAdapterDescription {
  const selection = selectAiAdapter(capability, options);
  if (!selection.ok) return { available: false, reason: selection.error, adapterId: null, model: null, endpoint: null };
  const status = selection.adapter.status(options.context);
  return { available: status.configured, reason: status.reason, adapterId: selection.id, model: selection.model ?? status.model, endpoint: status.endpoint };
}

/** Thin invoke helper so every runtime executes a selection the same way. */
export async function invokeSelectedAdapter(
  selection: AiSelection,
  request: AiAdapterInvokeRequest,
  context: AiAdapterInvokeContext = { runtime: "next" },
): Promise<string> {
  if (!selection.ok) throw new Error(selection.error);
  return selection.adapter.invoke(request, { ...context, runtime: selection.runtime, model: selection.model });
}
