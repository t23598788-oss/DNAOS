/**
 * หน้าที่: the real decision logic behind the shared-secret network auth
 * gate used by transport-layer HTTP servers that were built assuming
 * loopback-only reachability (transport/owner-command-http,
 * dna-os-circuit/runtime — see their own headers, 2026-08-24 migration
 * hardening). Pure functions only: no `http`/`node:http` types, no
 * request/response objects — each server's own thin transport code reads
 * its own request/response shape and calls in here for the decision.
 *
 * FAIL-CLOSED BY DESIGN (Owner-equivalent review finding, 2026-08-24 —
 * flagged live by an independent peer review of the first draft of this
 * gate, which fail-OPENED on a missing secret): a missing/misconfigured
 * secret must never silently leave a non-loopback-bound server open. A
 * server binding to a non-loopback host with no secret configured MUST
 * refuse to start — see `evaluateBindPolicy`. A crashed deploy is visible
 * immediately; a silently-open endpoint is not.
 *
 * Input: raw `Authorization` header value + the real expected secret (for
 * `verifySharedSecret`); the real bind host + the real expected secret
 * (for `evaluateBindPolicy`).
 * Output: `verifySharedSecret` -> boolean (timing-safe). `evaluateBindPolicy`
 * -> `BindPolicyDecision`.
 * Dependency ที่อนุญาต: node:crypto only.
 * สิ่งที่ห้ามแตะ: never compare secrets with `===`/`!==` (timing leak —
 * this is a real auth path, see git history 2026-08-24 for the finding).
 * Never make `evaluateBindPolicy` return `allowed: true` for a
 * non-loopback host with no secret — that is the exact failure mode this
 * file exists to close.
 */

import { timingSafeEqual } from "node:crypto";
import type { BindPolicyDecision } from "./types";

const BEARER_PREFIX = "Bearer ";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

/** Timing-safe compare. Returns false (never throws) on any malformed input. */
export function verifySharedSecret(authorizationHeader: string | undefined, expectedSecret: string): boolean {
  if (typeof authorizationHeader !== "string" || !authorizationHeader.startsWith(BEARER_PREFIX)) return false;
  const provided = authorizationHeader.slice(BEARER_PREFIX.length);
  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(expectedSecret, "utf8");
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

/**
 * Startup-time decision, not a per-request one: may this server bind to
 * `bindHost` given whether a shared secret is configured? Loopback +
 * no secret -> allowed (today's real, unchanged Mac-process behavior).
 * Non-loopback + no secret -> refused, fail-closed. Any host + a real
 * secret configured -> allowed (the secret enforces per-request from
 * there via `verifySharedSecret`).
 */
export function evaluateBindPolicy(bindHost: string, secret: string | undefined): BindPolicyDecision {
  if (secret && secret.length > 0) {
    return { allowed: true, reason: "shared secret configured — enforced per-request" };
  }
  if (isLoopbackHost(bindHost)) {
    return { allowed: true, reason: "loopback bind with no secret — local-only, unchanged existing behavior" };
  }
  return {
    allowed: false,
    reason: `refusing to bind non-loopback host "${bindHost}" with no shared secret configured — this would be an unauthenticated public endpoint`,
  };
}
