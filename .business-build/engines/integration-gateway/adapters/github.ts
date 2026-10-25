/**
 * Integration Gateway — GitHub Adapter (owner, 2026-08-05). Observe Channel
 * only: normalizes real GitHub webhook payloads (push, pull_request,
 * workflow_run) into GatewayEvent. Never requests an effect — every event
 * this adapter produces has requested_effect: "none" and action: "observe".
 * Signature verification (HMAC-SHA256, GitHub's real webhook signing scheme)
 * lives here because it's GitHub-specific; the ingress route
 * (app/api/gateway/observe/github/route.ts) calls it before ever touching
 * the payload.
 */
import { createHmac, timingSafeEqual } from "crypto";
import type { GatewayEvent } from "../contracts/event";

export function verifyGithubSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function newEventId(githubEvent: string, deliveryId: string | null): string {
  return `EVT-github-${githubEvent}-${deliveryId ?? Date.now()}`;
}

/** push — a real commit landed on a branch. */
function normalizePush(payload: any, deliveryId: string | null): GatewayEvent {
  return {
    event_id: newEventId("push", deliveryId),
    provider: "github",
    capability: "source.change.detected",
    channel: "observe",
    action: "observe",
    session_id: null,
    change_id: payload.after ?? null,
    evidence: {
      ref: payload.ref,
      repository: payload.repository?.full_name,
      commits: (payload.commits ?? []).map((c: any) => ({ id: c.id, message: c.message, author: c.author?.name })),
      pusher: payload.pusher?.name,
    },
    requested_effect: "none",
    requires_owner_approval: false,
    occurred_at: new Date().toISOString(),
  };
}

/** pull_request — opened/synchronize/closed etc. */
function normalizePullRequest(payload: any, deliveryId: string | null): GatewayEvent {
  return {
    event_id: newEventId("pull_request", deliveryId),
    provider: "github",
    capability: "source.change.detected",
    channel: "observe",
    action: "observe",
    session_id: null,
    change_id: payload.pull_request?.head?.sha ?? null,
    evidence: {
      action: payload.action,
      number: payload.number,
      repository: payload.repository?.full_name,
      title: payload.pull_request?.title,
      base: payload.pull_request?.base?.ref,
      head: payload.pull_request?.head?.ref,
      state: payload.pull_request?.state,
    },
    requested_effect: "none",
    requires_owner_approval: false,
    occurred_at: new Date().toISOString(),
  };
}

/** workflow_run — CI status (e.g. the DNA OS Governance Gate itself). */
function normalizeWorkflowRun(payload: any, deliveryId: string | null): GatewayEvent {
  return {
    event_id: newEventId("workflow_run", deliveryId),
    provider: "github",
    capability: "source.workflow.status",
    channel: "observe",
    action: "observe",
    session_id: null,
    change_id: payload.workflow_run?.head_sha ?? null,
    evidence: {
      name: payload.workflow_run?.name,
      status: payload.workflow_run?.status,
      conclusion: payload.workflow_run?.conclusion,
      repository: payload.repository?.full_name,
      run_url: payload.workflow_run?.html_url,
    },
    requested_effect: "none",
    requires_owner_approval: false,
    occurred_at: new Date().toISOString(),
  };
}

/** Returns null for any GitHub event type this adapter doesn't yet handle —
 * never fabricates a GatewayEvent for something it can't honestly normalize. */
export function normalizeGithubWebhook(githubEvent: string, payload: any, deliveryId: string | null): GatewayEvent | null {
  switch (githubEvent) {
    case "push":
      return normalizePush(payload, deliveryId);
    case "pull_request":
      return normalizePullRequest(payload, deliveryId);
    case "workflow_run":
      return normalizeWorkflowRun(payload, deliveryId);
    default:
      return null;
  }
}
