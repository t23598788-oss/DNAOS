/**
 * DNA OS — Device AI capability runtime (PHASE A8, owner 2026-09-23).
 *
 * The third runtime contract (after Node/Next in A4–A6 and Deno in A7). The
 * device watcher (local-runtime/ai-task-watcher.mjs) keeps its whole working
 * process — polling, ai_tasks identity, tracing, RunPod pod lifecycle, callback,
 * LINE continuation — but it no longer holds the authority to pick Ollama/Qwen/
 * Thawatchai itself. It states a CAPABILITY; this module decides which adapter
 * serves it, using the SAME policy as the other two runtimes.
 *
 * Unlike Deno, the device runs on this machine, so it loads the canonical
 * registry straight from disk — no snapshot, no drift.
 *
 * Model identity is adapter configuration (registry capability_models /
 * default_model), never something the caller names.
 */
import { readFileSync } from "fs";
import { join } from "path";

const PROJECT_ROOT = join(new URL(".", import.meta.url).pathname, "..", "..");

export function loadDeviceAdapterRegistry(projectDir = PROJECT_ROOT) {
  return JSON.parse(readFileSync(join(projectDir, "registry", "ai-adapter-registry.json"), "utf8"));
}

export const DEVICE_RUNTIME = "device";

/**
 * Same algorithm as services/ai/resolver.ts and _shared/ai/runtime.ts:
 * declared → enabled ∧ runtime-compatible ∧ implemented → priority asc → id asc
 * → configured. Fail closed with the same codes; never a silent fallback.
 */
export function selectDeviceAdapter(capability, options = {}) {
  const registry = options.registry ?? loadDeviceAdapterRegistry(options.projectDir);
  if (!registry.capabilities?.[capability]) {
    return { ok: false, code: "AI_GATEWAY_CAPABILITY_NOT_REGISTERED", error: `AI_GATEWAY_CAPABILITY_NOT_REGISTERED: ${capability}` };
  }
  const capsOf = (a) => a.capabilities_by_runtime?.[DEVICE_RUNTIME] ?? a.capabilities ?? [];
  const usable = (registry.adapters ?? [])
    .filter((a) => a.enabled && (a.runtimes ?? []).includes(DEVICE_RUNTIME) && capsOf(a).includes(capability))
    .sort((a, b) => (a.priority !== b.priority ? a.priority - b.priority : a.id < b.id ? -1 : 1));
  if (usable.length === 0) {
    return { ok: false, code: "AI_NO_COMPATIBLE_ADAPTER", error: `AI_NO_COMPATIBLE_ADAPTER: no enabled, device-compatible adapter declares ${capability}` };
  }
  const chosen = usable[0];
  const model = chosen.configuration?.capability_models?.[capability] ?? null;
  return { ok: true, declaration: chosen, model };
}

/** The only device adapter implementation: the local/pod generation server. */
async function ollamaInvoke(request, config) {
  const endpoint = config.endpoint;
  if (!endpoint) throw new Error("AI_GATEWAY_OLLAMA_NOT_CONFIGURED");
  const res = await fetch(`${endpoint.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      system: request.systemPrompt,
      prompt: request.prompt,
      images: request.images,
      stream: false,
      format: request.images ? "json" : undefined,
    }),
  });
  if (!res.ok) throw new Error(`AI_GATEWAY_OLLAMA_HTTP_${res.status}`);
  const json = await res.json();
  if (typeof json.response !== "string" || !json.response.trim()) throw new Error("AI_GATEWAY_EMPTY_PROVIDER_RESULT");
  return json.response;
}

const DEVICE_ADAPTERS = { ollama: ollamaInvoke };

/**
 * Capability in, normalized result out. `evidence` is required and is called
 * BEFORE any provider request (so a run can never silently skip its evidence);
 * a failing evidence hook fails the call closed with the canonical code.
 */
export async function runDeviceAiCapability(capability, request, options) {
  const { endpoint, evidence, registry, projectDir } = options ?? {};
  if (typeof evidence !== "function") {
    return { ok: false, output: null, adapterId: null, model: null, error: "AI_GATEWAY_EVIDENCE_UNAVAILABLE" };
  }
  const selection = selectDeviceAdapter(capability, { registry, projectDir });
  if (!selection.ok) return { ok: false, output: null, adapterId: null, model: null, error: selection.error };

  const declaration = selection.declaration;
  const invoke = DEVICE_ADAPTERS[declaration.id];
  if (!invoke) return { ok: false, output: null, adapterId: declaration.id, model: null, error: `AI_NO_COMPATIBLE_ADAPTER: no ${DEVICE_RUNTIME} implementation for ${declaration.id}` };

  const envModel = declaration.configuration?.model_env ? process.env[declaration.configuration.model_env] : null;
  const model = selection.model ?? envModel ?? declaration.configuration?.default_model ?? null;
  const base = { capability, adapterId: declaration.id, model, endpoint: endpoint ?? null };

  try {
    await evidence({ ...base, status: "requested" });
  } catch (error) {
    return { ok: false, output: null, adapterId: declaration.id, model, error: error instanceof Error ? error.message : "AI_GATEWAY_EVIDENCE_FAILED" };
  }
  try {
    const output = await invoke(request, { model, endpoint });
    await evidence({ ...base, status: "completed" });
    return { ok: true, output, adapterId: declaration.id, model };
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI_GATEWAY_PROVIDER_FAILED";
    try { await evidence({ ...base, status: "failed", error: message }); } catch { /* already failing */ }
    return { ok: false, output: null, adapterId: declaration.id, model, error: message };
  }
}
