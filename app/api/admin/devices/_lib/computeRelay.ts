/**
 * Business ↔ Compute RELAY (Phase 2, 2026-10-16).
 *
 * The ONLY bridge between the existing device_commands lifecycle
 * (deviceCommands.ts: create→pull→ack→complete→requeue) and the standalone
 * dna-os-compute daemon (POST /commands). Deliberate boundaries:
 *  - NO Business Runtime authority lives remote: the daemon never imports
 *    this file, never receives a Supabase key, and can only answer what the
 *    token-bearing relay asserts (see the trust model below).
 *  - The daemon is NOT a new permission system: every real scope decision
 *    here is the EXISTING core/policy/scope.evaluateScope — reached through
 *    createDeviceCommand's deny-by-default grant check AND ackCommand's
 *    jobId-bound re-check (route.ts orchestrates; this file is transport).
 *  - Closed tool-id allowlist (command-kind discipline as deviceCommands.ts
 *    COMMAND_KINDS): exactly FOUR compute tool ids exist; anything else is
 *    TOOL_KIND_UNKNOWN without a single byte reaching the daemon.
 *  - Env contract (fail-closed, honest, never logged):
 *      DNA_COMPUTE_DAEMON_URL   e.g. http://127.0.0.1:PORT
 *      DNA_COMPUTE_TOKEN        the daemon's bearer token
 *    No URL/token → every forward returns RELAY_NOT_CONFIGURED; the route
 *    checks BEFORE creating any device_command row, so an unconfigured
 *    daemon can never leave a stale dispatched command behind.
 *  - Workspace root is asserted SERVER-SIDE ONLY (never from the client):
 *    this keeps Phase 1's guard contract intact — a bearer token never
 *    widens anything beyond what DNA OS itself states.
 */
import { createHash, timingSafeEqual } from "crypto";

/** The closed compute tool-id set (managed.run payload.tool_id). */
export const COMPUTE_TOOL_IDS = ["compute.code.read", "compute.build.run", "compute.test.run", "compute.ai.infer"] as const;
export type ComputeToolId = (typeof COMPUTE_TOOL_IDS)[number];

export type DaemonRequestKind = "code.read" | "build.run" | "test.run" | "ai.infer";

/** Map closed tool id → daemon command kind (no guessing, no default). */
export function toolIdToDaemonKind(toolId: string): DaemonRequestKind | null {
  switch (toolId) {
    case "compute.code.read": return "code.read";
    case "compute.build.run": return "build.run";
    case "compute.test.run": return "test.run";
    case "compute.ai.infer": return "ai.infer";
    default: return null;
  }
}

export interface RelayConfig { url: string; token: string; }
export type RelayConfigResult =
  | { ok: true; config: RelayConfig }
  | { ok: false; code: "RELAY_NOT_CONFIGURED"; error: string };

/** Read env once per call; honest when either half is missing. Public URL is
 * fine to expose (it answers to /health), but the token NEVER leaves this
 * module except into the Authorization header — never into logs/proposals. */
export function resolveRelayConfig(readEnv: (k: string) => string | undefined = (k) => process.env[k]): RelayConfigResult {
  const url = (readEnv("DNA_COMPUTE_DAEMON_URL") ?? "").trim();
  const token = (readEnv("DNA_COMPUTE_TOKEN") ?? "").trim();
  if (!url || !/^https?:\/\//.test(url)) return { ok: false, code: "RELAY_NOT_CONFIGURED", error: "DNA_COMPUTE_DAEMON_URL is not configured (set it to the compute daemon's http://host:port)" };
  if (!token) return { ok: false, code: "RELAY_NOT_CONFIGURED", error: "DNA_COMPUTE_TOKEN is not configured (the daemon's bearer token)" };
  return { ok: true, config: { url: url.replace(/\/$/, ""), token } };
}

/** Recursive stable stringify so identical semantics always hash equal. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

/** Deterministic idempotency key so an owner retry reuses the SAME command
 * row (deviceCommands' submit-by-key contract) instead of duplicating work. */
export function denseIdempotencyKey(toolId: string, payload: Record<string, unknown>, deviceId: string, ownerId: string): string {
  const canonical = stableStringify({ deviceId, ownerId, payload, toolId });
  return `dns-relay-${createHash("sha256").update(canonical).digest("hex").slice(0, 40)}`;
}

/** Which daemon payload shape a tool id carries (validated again by daemon). */
export function buildDaemonPayload(toolId: string, payload: { [k: string]: unknown }): Record<string, unknown> | null {
  switch (toolId) {
    case "compute.code.read": {
      const path = payload.path;
      if (typeof path !== "string" || !path.trim()) return null;
      return { path, startLine: typeof payload.startLine === "number" ? payload.startLine : undefined, maxBytes: typeof payload.maxBytes === "number" ? payload.maxBytes : undefined };
    }
    case "compute.build.run":
    case "compute.test.run": {
      const script = payload.script;
      if (typeof script !== "string" || !script.trim()) return null;
      return { script };
    }
    case "compute.ai.infer": {
      const prompt = payload.prompt;
      if (typeof prompt !== "string" || prompt.length === 0 || prompt.length > 200_000) return null;
      return { prompt, system: typeof payload.system === "string" ? payload.system : undefined };
    }
    default: return null;
  }
}

/** Real forward. HTTP POST /commands with bearer auth + short timeout;
 * the daemon's honest NOT_CONFIGURED/SCOPE_DENIED/KIND_UNKNOWN statuses are
 * carried through VERBATIM (never coerced). */
export type ForwardResult =
  | { ok: true; status: "SUCCEEDED" | "FAILED" | "NOT_CONFIGURED" | "SCOPE_DENIED" | "KIND_UNKNOWN"; result: Record<string, unknown> }
  | { ok: false; code: "RELAY_NOT_CONFIGURED" | "RELAY_UNREACHABLE" | "TOOL_KIND_UNKNOWN" | "PAYLOAD_INVALID"; error: string };

export async function forwardToComputeDaemon(input: {
  toolId: string;
  payload: { [k: string]: unknown };
  commandId: string;
  /** Server-asserted workspace root (absolute); null only for ai.infer. */
  workspaceRoot: string | null;
}, configResult: RelayConfigResult, fetchFn: typeof fetch = fetch, timeoutMs = 600_000): Promise<ForwardResult> {
  if (toolIdToDaemonKind(input.toolId) === null) {
    return { ok: false, code: "TOOL_KIND_UNKNOWN", error: `tool_id '${input.toolId}' is not in the closed relay set: ${COMPUTE_TOOL_IDS.join(", ")}` };
  }
  const payload = buildDaemonPayload(input.toolId, input.payload);
  if (payload === null) {
    return { ok: false, code: "PAYLOAD_INVALID", error: `payload does not satisfy the '${input.toolId}' contract` };
  }
  if (!configResult.ok) return { ok: false, code: "RELAY_NOT_CONFIGURED", error: configResult.error };
  const { url, token } = configResult.config;
  try {
    const res = await fetchFn(`${url}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ commandId: input.commandId, kind: toolIdToDaemonKind(input.toolId), payload, workspaceRoot: input.workspaceRoot }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      return { ok: false, code: "RELAY_UNREACHABLE", error: `daemon answered HTTP ${res.status} for POST /commands` };
    }
    const json = (await res.json()) as { ok?: boolean; result?: { status?: string; [k: string]: unknown } };
    const status = json.result?.status;
    if (!json.ok || typeof status !== "string") {
      return { ok: false, code: "RELAY_UNREACHABLE", error: "daemon response did not carry a real result.status" };
    }
    return { ok: true, status: status as "SUCCEEDED" | "FAILED" | "NOT_CONFIGURED" | "SCOPE_DENIED" | "KIND_UNKNOWN", result: (json.result ?? {}) as Record<string, unknown> };
  } catch (error) {
    return { ok: false, code: "RELAY_UNREACHABLE", error: `daemon not reachable: ${error instanceof Error ? error.message : String(error)}` };
  }
}
