/**
 * Compute relay RUNTIME (Phase 2) — pure orchestration without a live DB so
 * the acceptance test can drive the REAL decision logic with stub inputs
 * (the same stub technique scripts/connect-core-acceptance-test.ts uses).
 *
 * Trust model (unchanged from deviceCommands.ts):
 *  - grants come from the caller (the route loads scoped_grants rows);
 *  - deny-by-default via the SAME core/policy/scope.evaluateScope;
 *  - the daemon token is compared timing-safely when a heartbeat/probe
 *    endpoint wants to prove itself (never logged, only its SHA-256
 *    fingerprint may appear in reports).
 */
import { createHash, timingSafeEqual } from "crypto";
import https from "https";
import { evaluateScope, type GrantRow, type ScopeDecision } from "@/core/policy/scope";

/** Phase 4 — https face of the relay fetch function over node:https with a
 * REAL mTLS agent (CA-verified server + client-identity cert). Returned
 * function matches the same minimal {ok, status, json} contract as fetch.
 * Reject unauthorized (server cert must chain to the CA) — never negotiated
 * down midway; used for https:// daemons ONLY (never mixed). */
export function buildHttpsFetch(tls: { caPem: string; certPem: string; keyPem: string }): (url: string, init: { method: string; headers: Record<string, string>; body?: string; timeoutMs: number }) => Promise<{ ok: boolean; status: number; body: string }> {
  return (url, init) =>
    new Promise((resolve, reject) => {
      try {
        const agent = new https.Agent({
          ca: tls.caPem,
          cert: tls.certPem,
          key: tls.keyPem,
          rejectUnauthorized: true, // server cert MUST chain to our CA (Phase 4)
          minVersion: "TLSv1.2" as const,
        });
        const u = new URL(url);
        const req = https.request(
          { hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: init.method, headers: init.headers, agent },
          (res) => {
            let body = "";
            res.on("data", (c: Buffer) => (body += String(c)));
            res.on("end", () => resolve({ ok: (res.statusCode ?? 500) < 400, status: res.statusCode ?? 500, body }));
          },
        );
        req.setTimeout(init.timeoutMs, () => req.destroy(new Error("timeout")));
        req.on("error", reject);
        if (init.body) req.write(init.body);
        req.end();
      } catch (error) {
        reject(error);
      }
    });
}

/** Compute server grants are device-scoped rows in scoped_grants with
 * resource = compute tool id; evaluateScope's existing resource matching
 * does the real decision. */
export function evaluateComputeScope(deviceId: string, toolId: string, grants: GrantRow[], jobId?: string): ScopeDecision {
  return evaluateScope({ subject: { deviceId }, action: "run", resource: toolId, jobId }, grants);
}

/** Timing-safe token fingerprint compare — used by probes, never by the daemon. */
export function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

export function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, "utf-8");
  const b = Buffer.from(expected, "utf-8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** One owner-facing orchestration step list (documentation-as-code): the
 * route MUST run these in order and refuse forward on any earlier failure:
 *   1. resolveRelayConfig()          — env fail-closed BEFORE any row write
 *   2. evaluateComputeScope()        — deny-by-default on scoped_grants
 *   3. createDeviceCommand()         — idempotent submit-by-key
 *   4. ackCommand()                  — dispatched→running + scope re-check
 *   5. forwardToComputeDaemon()      — the only network hop
 *   6. completeCommand()             — terminal EXACTLY ONCE, honest status
 * Phases that skip a step (e.g. forward without ack) are forbidden here by
 * construction: this module exports the ordered list and the route asserts
 * it in its own acceptance test (source assertion style). */
export const RELAY_STEP_ORDER = ["config", "scope", "create", "ack", "forward", "complete"] as const;
