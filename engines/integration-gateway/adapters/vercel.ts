/**
 * Integration Gateway — Vercel Adapter (owner, 2026-08-05). Observe Channel
 * only: normalizes real Vercel deployment webhook payloads
 * (deployment.created / deployment.succeeded / deployment.error /
 * deployment.canceled) into GatewayEvent. Signature verification uses
 * Vercel's real scheme (HMAC-SHA1 over the raw body with the webhook's
 * signing secret, header `x-vercel-signature`).
 */
import { createHmac, timingSafeEqual } from "crypto";
import type { GatewayEvent } from "../contracts/event";
import {
  DNA_OS_RUNTIME_STATE_BOUNDARY,
  type RuntimeProviderStatus,
} from "../contracts/runtime-provider";

export function verifyVercelSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha1", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const HANDLED_TYPES = new Set([
  "deployment.created",
  "deployment.succeeded",
  "deployment.error",
  "deployment.canceled",
]);

/** Returns null for any Vercel webhook `type` this adapter doesn't yet
 * handle — never fabricates a GatewayEvent for something it can't honestly
 * normalize. */
export function normalizeVercelWebhook(payload: any): GatewayEvent | null {
  const type: string | undefined = payload?.type;
  if (!type || !HANDLED_TYPES.has(type)) return null;

  const deployment = payload.payload?.deployment ?? payload.payload;
  return {
    event_id: `EVT-vercel-${type}-${payload.id ?? Date.now()}`,
    provider: "vercel",
    capability: "deployment.status.observed",
    channel: "observe",
    action: "observe",
    session_id: null,
    change_id: deployment?.meta?.githubCommitSha ?? deployment?.id ?? null,
    evidence: {
      type,
      deployment_id: deployment?.id,
      url: deployment?.url,
      target: deployment?.target,
      project: payload.payload?.project?.name ?? deployment?.name,
    },
    requested_effect: "none",
    requires_owner_approval: false,
    occurred_at: new Date().toISOString(),
  };
}

export interface VercelRuntimeProviderConfig {
  runtimeUrl?: string | null;
  available?: boolean;
  healthy?: boolean;
  latencyMs?: number | null;
  paid?: boolean;
  ownerApproved?: boolean;
  capabilities?: string[];
}

export function vercelRuntimeProviderStatus(config: VercelRuntimeProviderConfig = {}): RuntimeProviderStatus {
  const runtimeUrl = config.runtimeUrl ?? process.env.VERCEL_RUNTIME_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? null;
  const paid = config.paid ?? process.env.VERCEL_RUNTIME_PAID === "true";
  const ownerApproved = config.ownerApproved ?? process.env.VERCEL_RUNTIME_OWNER_APPROVED === "true";
  const available = config.available ?? Boolean(runtimeUrl);
  const healthy = config.healthy ?? Boolean(runtimeUrl);

  return {
    provider_id: "vercel",
    availability: available ? "available" : "unavailable",
    health: healthy ? "healthy" : "unhealthy",
    latency_ms: config.latencyMs ?? null,
    cost: {
      paid,
      owner_approved: ownerApproved,
      requires_owner_approval: paid && !ownerApproved,
    },
    runtime_url: runtimeUrl,
    capabilities: config.capabilities ?? ["runtime.render", "runtime.display", "domain.bind"],
    state_boundary: DNA_OS_RUNTIME_STATE_BOUNDARY,
  };
}

export const vercelRuntimeProvider = {
  provider_id: "vercel" as const,
  observeRuntimeStatus: vercelRuntimeProviderStatus,
};
