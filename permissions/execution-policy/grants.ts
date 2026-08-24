/**
 * หน้าที่: the real `ExecutionGrant` source of truth — issuance, revoke,
 * and query. `./policy.ts`'s `evaluateExecutionPermission()` never reads
 * grants itself (see `./types.ts`'s `ExecutionPolicyContext` header: "every
 * `ExecutionGrant` on record ... always resolved and supplied by the
 * caller, never looked up by this module") — a real caller is expected to
 * call `listExecutionGrantsForIdentity()` here, then pass the result into
 * `ExecutionPolicyContext.grants` before calling
 * `evaluateExecutionPermission()`. This file IS "the source" the Owner's
 * 2026-08-16 instruction refers to: "execution-policy ต้องอ่านจาก source
 * นี้ผ่าน contract เท่านั้น" — i.e. only through `./contract.ts`'s
 * re-exports, never by reaching into this file directly.
 *
 * PROCESS-LOCAL, IN-MEMORY, REAL — NOT A MOCK, NOT A FIXTURE: every
 * function here does real work against a real `Map` (issue actually
 * stores a new grant; revoke actually sets `revoked_at` and is visible to
 * every subsequent read; list actually filters the real stored set).
 * What's `NOT_YET_BUILT` is durable/cross-process persistence — the same
 * honest gap `../../execution/run/audit.ts`'s in-memory sink already
 * documents for the same reason (no real database was wired this round,
 * per Owner instruction — "ห้ามใช้ JSON fixture เป็น production source"
 * ruled out a static file just as much as it ruled out a mock).
 *
 * Input: `IssueExecutionGrantInput` (issue), a `grant_id` (revoke/get), an
 * `identity_id` (list).
 * Output: `issueExecutionGrant`, `revokeExecutionGrant`,
 * `getExecutionGrant`, `listExecutionGrantsForIdentity`,
 * `GrantValidationError`.
 * Dependency ที่อนุญาต: ./types.ts.
 * สิ่งที่ห้ามแตะ: never delete a grant on revoke — set `revoked_at` only,
 * matching this repo's append-and-link discipline (see
 * `../access-control/membership.ts`'s same rule). Never accept an
 * `effect` other than the literal `"allow"`/`"deny"` — reject at issuance,
 * do not let a malformed value reach storage (this is what makes
 * `./rules.ts`'s `resolveGrant()` `AMBIGUOUS_GRANT_STATE` branch a
 * defense-in-depth check on a value that should already be impossible,
 * not the only line of defense). Never let `issueExecutionGrant` grant
 * itself — this file has no notion of "who is allowed to issue a grant";
 * that authorization boundary is `NOT_YET_BUILT` (see this file's own
 * bottom note) and must not be silently assumed here.
 *
 * NOT_YET_BUILT: no owner-approval gate on grant issuance itself yet (any
 * caller with a reference to this module can issue any grant) — a real
 * gap, flagged here rather than assumed away, since building that gate is
 * a distinct, later capability (likely `governance/permission-rules/`),
 * not this round's task. No durable storage — see header.
 */

import { randomUUID } from "node:crypto";
import type { ExecutionGrant } from "./types";

export class GrantValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrantValidationError";
  }
}

export interface IssueExecutionGrantInput {
  identity_id: string;
  account_id: string;
  workspace_id: string;
  capability: string;
  command_id: string;
  action: string;
  cwd_scope_prefix: string;
  effect: "allow" | "deny";
  /** Defaults to the real current time — accepts an explicit value only so tests stay deterministic, matching `./policy.ts`'s own `nowIso` parameter convention. */
  granted_at?: string;
  expires_at?: string;
}

const grants = new Map<string, ExecutionGrant>();

function nowIsoDefault(): string {
  return new Date().toISOString();
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new GrantValidationError(`grant field "${field}" must be a non-empty string, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function issueExecutionGrant(input: IssueExecutionGrantInput): ExecutionGrant {
  requireNonEmptyString(input.identity_id, "identity_id");
  requireNonEmptyString(input.account_id, "account_id");
  requireNonEmptyString(input.workspace_id, "workspace_id");
  requireNonEmptyString(input.capability, "capability");
  requireNonEmptyString(input.command_id, "command_id");
  requireNonEmptyString(input.action, "action");
  requireNonEmptyString(input.cwd_scope_prefix, "cwd_scope_prefix");
  if (input.effect !== "allow" && input.effect !== "deny") {
    throw new GrantValidationError(`grant field "effect" must be "allow" or "deny", got ${JSON.stringify(input.effect)}`);
  }
  if (input.expires_at !== undefined && Number.isNaN(new Date(input.expires_at).getTime())) {
    throw new GrantValidationError(`grant field "expires_at" is not a valid date: ${JSON.stringify(input.expires_at)}`);
  }

  const grant: ExecutionGrant = {
    grant_id: randomUUID(),
    identity_id: input.identity_id,
    account_id: input.account_id,
    workspace_id: input.workspace_id,
    capability: input.capability,
    command_id: input.command_id,
    action: input.action,
    cwd_scope_prefix: input.cwd_scope_prefix,
    effect: input.effect,
    granted_at: input.granted_at ?? nowIsoDefault(),
    expires_at: input.expires_at,
  };
  grants.set(grant.grant_id, grant);
  return grant;
}

/** Idempotent: revoking an already-revoked grant returns it unchanged (its original `revoked_at` is preserved, never overwritten). */
export function revokeExecutionGrant(grantId: string, revokedAt: string = nowIsoDefault()): ExecutionGrant {
  const existing = grants.get(grantId);
  if (!existing) {
    throw new GrantValidationError(`no grant with id "${grantId}"`);
  }
  if (existing.revoked_at) return existing;
  const revoked: ExecutionGrant = { ...existing, revoked_at: revokedAt };
  grants.set(grantId, revoked);
  return revoked;
}

export function getExecutionGrant(grantId: string): ExecutionGrant | undefined {
  return grants.get(grantId);
}

/** Every grant on record for this identity, revoked and active alike — filtering by scope/effect/expiry happens inside `./rules.ts`'s `resolveGrant()`, not here, so the caller always sees the complete real picture. */
export function listExecutionGrantsForIdentity(identityId: string): readonly ExecutionGrant[] {
  return [...grants.values()].filter((g) => g.identity_id === identityId);
}

/** Test-only introspection — never imported by any future route. */
export function __debugGrantCount(): number {
  return grants.size;
}
