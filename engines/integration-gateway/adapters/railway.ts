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
