/**
 * หน้าที่: the real, in-memory Membership STORE — issuance, revoke, and
 * query. `./membership.ts` stays the pure type definition (unchanged);
 * this file is the store, mirroring the split `./identity.ts` /
 * `./identity-registry.ts` already uses. Built 2026-08-16 specifically so
 * `control/entry-context/` can resolve real Membership rows, never a
 * fabricated one, matching the exact same discipline
 * `../execution-policy/grants.ts` already established for `ExecutionGrant`.
 *
 * REAL, IN-MEMORY, NOT A MOCK: every function does real work against a
 * real `Map`. Durable cross-process persistence is `NOT_YET_BUILT` (same
 * honest gap as `../execution-policy/grants.ts` and
 * `./identity-registry.ts`) — this is a source-code-level model only.
 *
 * Input: `GrantMembershipInput` (issue), a `membership_id` (revoke/get),
 * an `identity_id` (list).
 * Output: `grantMembership`, `revokeMembership`, `getMembership`,
 * `listMembershipsForIdentity`, `MembershipRegistrationError`.
 * Dependency ที่อนุญาต: ./membership.ts.
 * สิ่งที่ห้ามแตะ: never delete a membership on revoke — set `revoked_at`
 * only, per ./membership.ts's own "never delete a Membership row's
 * history" rule. Never let `grantMembership` grant itself an
 * authorization boundary — like ../execution-policy/grants.ts, this file
 * has no notion of "who is allowed to grant a membership"; that gate is
 * `NOT_YET_BUILT` (see this file's own bottom note), not silently assumed.
 *
 * NOT_YET_BUILT: no owner-approval gate on membership issuance itself yet
 * (any caller with a reference to this module can grant any membership) —
 * a real gap, flagged rather than assumed away, same as
 * ../execution-policy/grants.ts's own note. No durable storage.
 */

import { randomUUID } from "node:crypto";
import type { Membership, MembershipScopeType } from "./membership";

export class MembershipRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MembershipRegistrationError";
  }
}

export interface GrantMembershipInput {
  identity_id: string;
  scope_type: MembershipScopeType;
  scope_id: string;
  role: string;
  granted_at?: string;
}

const memberships = new Map<string, Membership>();

function nowIsoDefault(): string {
  return new Date().toISOString();
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new MembershipRegistrationError(`membership field "${field}" must be a non-empty string, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function grantMembership(input: GrantMembershipInput): Membership {
  requireNonEmptyString(input.identity_id, "identity_id");
  requireNonEmptyString(input.scope_id, "scope_id");
  requireNonEmptyString(input.role, "role");
  if (input.scope_type !== "account" && input.scope_type !== "tenant" && input.scope_type !== "workspace") {
    throw new MembershipRegistrationError(`membership field "scope_type" must be "account", "tenant", or "workspace", got ${JSON.stringify(input.scope_type)}`);
  }

  const membership: Membership = {
    membership_id: randomUUID(),
    identity_id: input.identity_id,
    scope_type: input.scope_type,
    scope_id: input.scope_id,
    role: input.role,
    granted_at: input.granted_at ?? nowIsoDefault(),
  };
  memberships.set(membership.membership_id, membership);
  return membership;
}

/** Idempotent: revoking an already-revoked membership returns it unchanged (its original revoked_at is preserved). */
export function revokeMembership(membershipId: string, revokedAt: string = nowIsoDefault()): Membership {
  const existing = memberships.get(membershipId);
  if (!existing) {
    throw new MembershipRegistrationError(`no membership with id "${membershipId}"`);
  }
  if (existing.revoked_at) return existing;
  const revoked: Membership = { ...existing, revoked_at: revokedAt };
  memberships.set(membershipId, revoked);
  return revoked;
}

export function getMembership(membershipId: string): Membership | undefined {
  return memberships.get(membershipId);
}

/** Every membership row on record for this identity, revoked and active alike — filtering by scope/revocation happens in ../execution-policy/rules.ts, not here, so the caller always sees the complete real picture. */
export function listMembershipsForIdentity(identityId: string): readonly Membership[] {
  return [...memberships.values()].filter((m) => m.identity_id === identityId);
}

/** Test-only introspection — never imported by any future route. */
export function __debugMembershipCount(): number {
  return memberships.size;
}
