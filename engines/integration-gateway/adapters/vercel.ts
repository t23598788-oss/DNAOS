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
