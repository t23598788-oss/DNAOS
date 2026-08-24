/**
 * หน้าที่: `acceptIngressRequest()` — STAGE 1 (INGRESS) of the DNA OS
 * Self-Understanding Pipeline. The ONE bounded entry a caller uses to
 * request inspection of something in this repository. Validates the
 * request is well-formed and genuinely bounded (never fabricates a
 * missing field, never lets `target` escape the declared `scope`) —
 * decides nothing beyond that. This stage never scans the filesystem,
 * never classifies, never registers; it only proves the request is safe
 * to hand to a downstream stage (STAGE 2 — INVENTORY,
 * `control/repository-discovery/`, structurally the mandatory consumer
 * of this stage's real output — see ./tests/ingress.test.ts).
 *
 * Reuses `connections/github/repo-path.ts`'s real, already-verified
 * `checkRepoPath()` for both `target` and `scope` — the same
 * repo-relative, no-traversal, no-absolute-path boundary
 * `control/target-resolution/resolver.ts` already trusts for the exact
 * same purpose. No new path-validation algorithm invented here.
 *
 * Input: `unknown` (a caller-supplied candidate request — never trusted
 * as already-typed).
 * Output: `acceptIngressRequest` -> `IngressResult`.
 * Dependency ที่อนุญาต: ../../connections/github/repo-path.ts
 * (checkRepoPath only), ./types.ts.
 * สิ่งที่ห้ามแตะ: never accept a `target` that is not provably within
 * `scope`. Never touch the filesystem here — that is STAGE 2's job
 * alone. Never let a missing/malformed field fall through to ACCEPTED.
 */

import { checkRepoPath } from "../../connections/github/repo-path";
import type { IngressResult, SelfUnderstandingIngressRequest } from "./types";

function rejected(requestId: string | null, reasonCode: string): IngressResult {
  return { status: "REJECTED", request_id: requestId, reason_code: reasonCode, validated_request: null };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function acceptIngressRequest(candidate: unknown): IngressResult {
  if (typeof candidate !== "object" || candidate === null) {
    return rejected(null, "MALFORMED_REQUEST");
  }
  const raw = candidate as Partial<Record<keyof SelfUnderstandingIngressRequest, unknown>>;
  const requestId = isNonEmptyString(raw.request_id) ? raw.request_id : null;

  if (!isNonEmptyString(raw.request_id)) {
    return rejected(null, "MISSING_REQUEST_ID");
  }
  if (!isNonEmptyString(raw.requested_capability)) {
    return rejected(requestId, "MISSING_REQUESTED_CAPABILITY");
  }

  const scopeCheck = checkRepoPath(raw.scope, { allowRoot: true });
  if (!scopeCheck.ok) {
    return rejected(requestId, `INVALID_SCOPE:${scopeCheck.reason}`);
  }

  const targetCheck = checkRepoPath(raw.target, { allowRoot: false });
  if (!targetCheck.ok) {
    return rejected(requestId, `INVALID_TARGET:${targetCheck.reason}`);
  }

  // The bound this whole stage exists to enforce: target must provably
  // fall within scope — the Agent declares what it wants inspected AND
  // the boundary it is confined to; this stage never trusts one without
  // checking it against the other.
  const scopePrefix = scopeCheck.normalized === "" ? "" : `${scopeCheck.normalized}/`;
  const withinScope = scopeCheck.normalized === targetCheck.normalized || targetCheck.normalized.startsWith(scopePrefix);
  if (!withinScope) {
    return rejected(requestId, `TARGET_OUTSIDE_SCOPE:target="${targetCheck.normalized}" is not within scope="${scopeCheck.normalized}"`);
  }

  const validated: SelfUnderstandingIngressRequest = {
    request_id: raw.request_id as string,
    target: targetCheck.normalized,
    scope: scopeCheck.normalized,
    requested_capability: raw.requested_capability as string,
  };
  return { status: "ACCEPTED", request_id: requestId, reason_code: null, validated_request: validated };
}
