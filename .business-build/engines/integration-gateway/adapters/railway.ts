/**
 * Integration Gateway — Railway Adapter (owner, 2026-09-18). Observe Channel
 * only: normalizes real Railway project-webhook payloads into GatewayEvent.
 * Capability parity with the existing Vercel adapter
 * (engines/integration-gateway/adapters/vercel.ts) under the same
 * deployment.status.observed contract — Vercel is not removed.
 *
 * Real Railway webhook payload shape (docs.railway.com/observability/webhooks):
 *   { "type": "Deployment.failed" | "Deployment.success" | ...,
 *     "details": { id, source, status, branch, commitHash, commitAuthor,
 *                  commitMessage, ... },
 *     "resource": { workspace, project, environment, service, deployment },
 *     "severity": ..., "timestamp": ... }
 *
 * Transport reality (same docs): Railway webhook payloads are NOT
 * cryptographically signed — the docs' prescribed verification is a secret
 * carried in the configured webhook URL ("include a secret in the webhook
 * URL ... and reject any request that does not carry it"). The ingress route
 * (app/api/gateway/observe/railway/route.ts) owns that check; this module
 * stays a pure normalizer + deployment-status mapping.
 */
import type { GatewayEvent } from "../contracts/event";
import { DNA_OS_RUNTIME_STATE_BOUNDARY, type RuntimeProviderStatus } from "../contracts/runtime-provider";
import type {
  ExternalConnectActivationRequest,
  ExternalConnectActivationResult,
  ExternalConnectStatus,
} from "../contracts/external-connect";

/** Railway's public deployment states — mirrors the real DeploymentStatus
 * enum of the platform's GraphQL API (BUILDING/DEPLOYING/SUCCESS/FAILED/
 * CRASHED/REMOVED/REMOVING/SKIPPED/INITIALIZING/QUEUED/WAITING/SLEEPING). */
export type RailwayDeploymentStatus =
  | "BUILDING" | "DEPLOYING" | "SUCCESS" | "FAILED" | "CRASHED"
  | "REMOVED" | "REMOVING" | "SKIPPED" | "INITIALIZING" | "QUEUED"
  | "WAITING" | "SLEEPING";

/** Map a Railway webhook `type` onto the deployment-status family it
 * belongs to. Returns null for any non-deployment event (alerts, volume
 * monitors) — never fabricates a deployment event for something else. */
export function railwayWebhookTypeToStatus(type: string): RailwayDeploymentStatus | null {
  const t = type.toLowerCase();
  if (t.startsWith("deployment.")) {
    const suffix = t.slice("deployment.".length);
    const upper = suffix.toUpperCase();
    // Real statuses pass straight through when they already match the enum.
    if (
      upper === "BUILDING" || upper === "DEPLOYING" || upper === "SUCCESS" ||
      upper === "FAILED" || upper === "CRASHED" || upper === "REMOVED" ||
      upper === "REMOVING" || upper === "SKIPPED" || upper === "INITIALIZING" ||
      upper === "QUEUED" || upper === "WAITING" || upper === "SLEEPING"
    ) {
      return upper as RailwayDeploymentStatus;
    }
    // Documented non-enum aliases map onto the real family they describe.
    if (upper === "STARTED") return "BUILDING";
    if (upper === "SUCCESS" || upper === "SUCCEEDED") return "SUCCESS";
    if (upper === "ERROR" || upper === "CRASH") return "FAILED";
    // Unknown Deployment.* suffix — drop it (null), same contract as the
    // Vercel adapter: the ingress route reports it as skipped, honestly.
    return null;
  }
  return null;
}

/** Terminal states: the deployment reached a final, observable outcome. */
export function isRailwayTerminalStatus(status: RailwayDeploymentStatus): boolean {
  return status === "SUCCESS" || status === "FAILED" || status === "CRASHED" ||
    status === "REMOVED" || status === "SKIPPED";
}

/** Returns null for any Railway webhook `type` this adapter doesn't yet
 * handle — never fabricates a GatewayEvent for something it can't honestly
 * normalize (same contract as normalizeVercelWebhook). */
export function normalizeRailwayWebhook(payload: any): GatewayEvent | null {
  const type: string | undefined = payload?.type;
  if (!type) return null;
  const status = railwayWebhookTypeToStatus(type);
  if (!status) return null;

  const details = payload.details ?? {};
  const resource = payload.resource ?? {};
  const deployment = resource.deployment ?? {};
  const service = resource.service ?? {};
  const project = resource.project ?? {};
  const environment = resource.environment ?? {};

  const commitHash: string | null = details.commitHash ?? details.commit_hash ?? null;

  return {
    event_id: `EVT-railway-${type}-${details.id ?? deployment.id ?? Date.now()}`,
    provider: "railway",
    capability: "deployment.status.observed",
    channel: "observe",
    action: "observe",
    session_id: null,
    change_id: commitHash,
    evidence: {
      type,
      status,
      terminal: isRailwayTerminalStatus(status),
      deployment_id: details.id ?? deployment.id ?? null,
      service_id: service.id ?? null,
      service_name: service.name ?? null,
      project_id: project.id ?? null,
      project_name: project.name ?? null,
      environment_name: environment.name ?? null,
      branch: details.branch ?? null,
      commit_hash: commitHash,
      commit_author: details.commitAuthor ?? null,
      commit_message: details.commitMessage ?? null,
      severity: payload.severity ?? null,
      occurred_at: payload.timestamp ?? null,
    },
    requested_effect: "none",
    requires_owner_approval: false,
    occurred_at: new Date().toISOString(),
  };
}

// ── Runtime-provider view (BATCH 2 adopted from runtime-connect-service-router
// a57c315 — the observe adapter above stays canonical main; this block is what
// the router needs: is Railway available/healthy/paid, under the same state
// boundary contract as every other provider). ──────────────────────────────

export interface RailwayRuntimeProviderConfig {
  runtimeUrl?: string | null;
  available?: boolean;
  healthy?: boolean;
  latencyMs?: number | null;
  paid?: boolean;
  ownerApproved?: boolean;
  capabilities?: string[];
}

type RuntimeHealthFetch = (input: string, init: RequestInit) => Promise<{ ok: boolean }>;

async function probeRuntimeUrl(runtimeUrl: string, fetchImpl: RuntimeHealthFetch): Promise<{ available: boolean; healthy: boolean; latencyMs: number }> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetchImpl(runtimeUrl, { method: "GET", cache: "no-store", signal: controller.signal });
    return { available: true, healthy: response.ok, latencyMs: Date.now() - startedAt };
  } catch {
    return { available: false, healthy: false, latencyMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

export function railwayRuntimeProviderStatus(config: RailwayRuntimeProviderConfig = {}): RuntimeProviderStatus {
  const runtimeUrl = config.runtimeUrl ?? process.env.RAILWAY_RUNTIME_URL ?? null;
  const paid = config.paid ?? process.env.RAILWAY_RUNTIME_PAID === "true";
  const ownerApproved = config.ownerApproved ?? process.env.RAILWAY_RUNTIME_OWNER_APPROVED === "true";
  const available = config.available ?? Boolean(runtimeUrl);
  const healthy = config.healthy ?? Boolean(runtimeUrl);

  return {
    provider_id: "railway",
    availability: available ? "available" : "unavailable",
    health: healthy ? "healthy" : "unhealthy",
    latency_ms: config.latencyMs ?? null,
    cost: { paid, owner_approved: ownerApproved, requires_owner_approval: paid && !ownerApproved },
    runtime_url: runtimeUrl,
    capabilities: config.capabilities ?? ["runtime.render", "runtime.display"],
    state_boundary: DNA_OS_RUNTIME_STATE_BOUNDARY,
  };
}

export async function observeRailwayRuntimeProviderStatus(
  config: RailwayRuntimeProviderConfig = {},
  fetchImpl: RuntimeHealthFetch = fetch,
): Promise<RuntimeProviderStatus> {
  const base = railwayRuntimeProviderStatus(config);
  if (!base.runtime_url || config.available !== undefined || config.healthy !== undefined || config.latencyMs !== undefined) return base;
  const probe = await probeRuntimeUrl(base.runtime_url, fetchImpl);
  return { ...base, availability: probe.available ? "available" : "unavailable", health: probe.healthy ? "healthy" : "unhealthy", latency_ms: probe.latencyMs };
}

export async function observeRailwayConnectStatus(config: RailwayRuntimeProviderConfig = {}): Promise<ExternalConnectStatus> {
  const runtime = await observeRailwayRuntimeProviderStatus(config);
  const installed = process.env.RAILWAY_EXTERNAL_CONNECT_INSTALLED === "true";
  return {
    provider_id: "railway",
    installed,
    ready: installed && process.env.RAILWAY_EXTERNAL_CONNECT_READY === "true",
    release_version: process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.RUNTIME_RELEASE_SHA ?? null,
    runtime,
  };
}

export async function activateRailwayRelease(_request: ExternalConnectActivationRequest): Promise<ExternalConnectActivationResult> {
  return { ok: false, code: "EXTERNAL_CONNECT_NOT_INSTALLED" };
}

export const railwayRuntimeProvider = {
  provider_id: "railway" as const,
  observeRuntimeStatus: observeRailwayRuntimeProviderStatus,
};

export const railwayExternalConnect = {
  provider_id: "railway" as const,
  observeConnectStatus: observeRailwayConnectStatus,
  activateRelease: activateRailwayRelease,
};
