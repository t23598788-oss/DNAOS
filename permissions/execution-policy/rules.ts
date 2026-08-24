/**
 * หน้าที่: the individual deterministic rules execution-policy evaluates,
 * in the fixed order policy.ts runs them. Each rule is a pure function:
 * same request + context in, same RuleOutcome out, every time — no clock
 * reads except where explicitly named (expiry checks), no randomness, no
 * I/O. This is what makes the whole layer testable without a real
 * database per STEP 6 of ../../reports/EXECUTION_MIGRATION_PLAN.md.
 *
 * Input: `ExecutionPermissionRequest`, `ExecutionPolicyContext`, plus for
 * expiry checks a `nowIso` string the caller supplies (never `Date.now()`
 * read internally, so tests are fully deterministic).
 * Output: `RuleOutcome` per rule — "continue" lets policy.ts proceed to
 * the next rule; any other value is terminal and policy.ts must stop.
 * Dependency ที่อนุญาต: ./types.ts, ./evidence.ts.
 * สิ่งที่ห้ามแตะ: never make a rule return "ALLOW" — only the final grant
 * -resolution rule (`resolveGrant`) may ever produce ALLOW, and only when
 * it finds a real, unrevoked, unexpired, non-superseded allow grant. Every
 * other rule may only ever produce "continue", "DENY", or "OWNER_REVIEW" —
 * this is the fail-closed guarantee from STEP 5 enforced structurally.
 *
 * NOT_YET_BUILT: no caller outside ./policy.ts and ./tests/ yet.
 */

import { fail, pass } from "./evidence";
import type {
  CommandPolicyDescriptor,
  ExecutionGrant,
  ExecutionPermissionRequest,
  ExecutionPolicyContext,
  ExecutionReasonCode,
  RuleEvidence,
} from "./types";

export type RuleOutcome =
  | { kind: "continue"; evidence: RuleEvidence }
  | { kind: "DENY"; evidence: RuleEvidence; reason_code: ExecutionReasonCode }
  | { kind: "OWNER_REVIEW"; evidence: RuleEvidence; reason_code: ExecutionReasonCode }
  | { kind: "ALLOW"; evidence: RuleEvidence; expires_at?: string };

/** Every rule except the final grant-resolution rule may only ever continue or deny — never ALLOW. Narrowing the return type here (rather than just by convention) is what makes that a compile-time guarantee. */
export type GateOutcome = Extract<RuleOutcome, { kind: "continue" | "DENY" | "OWNER_REVIEW" }>;

/** resolveGrant is the only rule allowed to ALLOW, and it is always terminal — it never continues. */
export type TerminalOutcome = Exclude<RuleOutcome, { kind: "continue" }>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Rule 1 — the request itself must be structurally well-formed before anything else is checked. Malformed input is never ALLOW. */
export function ruleWellFormedRequest(request: ExecutionPermissionRequest): GateOutcome {
  const requiredStringFields: Array<[string, unknown]> = [
    ["identity_id", request.identity_id],
    ["account_id", request.account_id],
    ["workspace_id", request.workspace_id],
    ["capability", request.capability],
    ["command_id", request.command_id],
    ["action", request.action],
    ["cwd_scope", request.cwd_scope],
    ["correlation_id", request.correlation_id],
  ];
  for (const [field, value] of requiredStringFields) {
    if (!isNonEmptyString(value)) {
      return {
        kind: "DENY",
        reason_code: "MALFORMED_REQUEST",
        evidence: fail("well_formed_request", field, "non-empty string", value === undefined ? "absent" : JSON.stringify(value)),
      };
    }
  }
  if (!Array.isArray(request.requested_args) || request.requested_args.some((arg) => typeof arg !== "string")) {
    return {
      kind: "DENY",
      reason_code: "MALFORMED_REQUEST",
      evidence: fail("well_formed_request", "requested_args", "array of strings", JSON.stringify(request.requested_args)),
    };
  }
  return { kind: "continue", evidence: pass("well_formed_request", "request", "structurally valid", "structurally valid") };
}

/** Rule 2 — the identity must actually resolve to a known Identity, and must match the request's own identity_id (no impersonation via a mismatched request field). */
export function ruleIdentityKnown(request: ExecutionPermissionRequest, context: ExecutionPolicyContext): GateOutcome {
  if (!context.identity) {
    return {
      kind: "DENY",
      reason_code: "UNKNOWN_IDENTITY",
      evidence: fail("identity_known", "identity", "resolved Identity", "absent"),
    };
  }
  if (context.identity.identity_id !== request.identity_id) {
    return {
      kind: "DENY",
      reason_code: "UNKNOWN_IDENTITY",
      evidence: fail("identity_known", "identity_id", request.identity_id, context.identity.identity_id),
    };
  }
  return { kind: "continue", evidence: pass("identity_known", "identity_id", request.identity_id, context.identity.identity_id) };
}

function findActiveMembership(
  memberships: ExecutionPolicyContext["memberships"],
  identityId: string,
  scopeType: "account" | "workspace",
  scopeId: string,
): { found: boolean; revoked: boolean } {
  const matches = memberships.filter((m) => m.identity_id === identityId && m.scope_type === scopeType && m.scope_id === scopeId);
  if (matches.length === 0) return { found: false, revoked: false };
  const anyActive = matches.some((m) => !m.revoked_at);
  return { found: true, revoked: !anyActive };
}

/** Rule 3 — the identity must hold an active (non-revoked) account-scope Membership for request.account_id. */
export function ruleAccountMembershipValid(request: ExecutionPermissionRequest, context: ExecutionPolicyContext): GateOutcome {
  const result = findActiveMembership(context.memberships, request.identity_id, "account", request.account_id);
  if (!result.found) {
    return {
      kind: "DENY",
      reason_code: "MISSING_ACCOUNT_MEMBERSHIP",
      evidence: fail("account_membership_valid", "account_id", `active membership for ${request.account_id}`, "no membership row"),
    };
  }
  if (result.revoked) {
    return {
      kind: "DENY",
      reason_code: "REVOKED_MEMBERSHIP",
      evidence: fail("account_membership_valid", "account_id", `active membership for ${request.account_id}`, "revoked"),
    };
  }
  return { kind: "continue", evidence: pass("account_membership_valid", "account_id", request.account_id, "active membership found") };
}

/** Rule 4 — same as rule 3, but for the workspace scope. A valid account membership does not imply a valid workspace membership. */
export function ruleWorkspaceMembershipValid(request: ExecutionPermissionRequest, context: ExecutionPolicyContext): GateOutcome {
  const result = findActiveMembership(context.memberships, request.identity_id, "workspace", request.workspace_id);
  if (!result.found) {
    return {
      kind: "DENY",
      reason_code: "MISSING_WORKSPACE_MEMBERSHIP",
      evidence: fail("workspace_membership_valid", "workspace_id", `active membership for ${request.workspace_id}`, "no membership row"),
    };
  }
  if (result.revoked) {
    return {
      kind: "DENY",
      reason_code: "REVOKED_MEMBERSHIP",
      evidence: fail("workspace_membership_valid", "workspace_id", `active membership for ${request.workspace_id}`, "revoked"),
    };
  }
  return { kind: "continue", evidence: pass("workspace_membership_valid", "workspace_id", request.workspace_id, "active membership found") };
}

/** Rule 5 — command_id must resolve to a real CommandPolicyDescriptor. An unrecognized command is never ALLOW, regardless of grants. */
export function ruleCommandKnown(request: ExecutionPermissionRequest, context: ExecutionPolicyContext): GateOutcome {
  if (!context.command || context.command.command_id !== request.command_id) {
    return {
      kind: "DENY",
      reason_code: "UNKNOWN_COMMAND",
      evidence: fail("command_known", "command_id", `registered command ${request.command_id}`, context.command ? context.command.command_id : "absent"),
    };
  }
  return { kind: "continue", evidence: pass("command_known", "command_id", request.command_id, request.command_id) };
}

/** Rule 6 — the request's capability must match the command's declared required_capability exactly. */
export function ruleCapabilityScope(request: ExecutionPermissionRequest, command: CommandPolicyDescriptor): GateOutcome {
  if (request.capability !== command.required_capability) {
    return {
      kind: "DENY",
      reason_code: "CROSS_CAPABILITY",
      evidence: fail("capability_scope", "capability", command.required_capability, request.capability),
    };
  }
  return { kind: "continue", evidence: pass("capability_scope", "capability", command.required_capability, request.capability) };
}

/** Rule 7 — the requested action must be one the command declares as allowed. */
export function ruleActionScope(request: ExecutionPermissionRequest, command: CommandPolicyDescriptor): GateOutcome {
  if (!command.allowed_actions.includes(request.action)) {
    return {
      kind: "DENY",
      reason_code: "ACTION_NOT_ALLOWED",
      evidence: fail("action_scope", "action", command.allowed_actions.join("|"), request.action),
    };
  }
  return { kind: "continue", evidence: pass("action_scope", "action", request.action, request.action) };
}

/** Rule 8 — the requested cwd_scope must fall under one of the command's declared allowed prefixes. Prevents scope-widening via a crafted cwd path. */
export function ruleCwdScope(request: ExecutionPermissionRequest, command: CommandPolicyDescriptor): GateOutcome {
  const matchesAny = command.allowed_cwd_scope_prefixes.some((prefix) => request.cwd_scope === prefix || request.cwd_scope.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`));
  if (!matchesAny) {
    return {
      kind: "DENY",
      reason_code: "CWD_SCOPE_VIOLATION",
      evidence: fail("cwd_scope", "cwd_scope", command.allowed_cwd_scope_prefixes.join("|"), request.cwd_scope),
    };
  }
  return { kind: "continue", evidence: pass("cwd_scope", "cwd_scope", request.cwd_scope, request.cwd_scope) };
}

function grantMatchesRequest(grant: ExecutionGrant, request: ExecutionPermissionRequest): boolean {
  if (grant.identity_id !== request.identity_id) return false;
  if (grant.account_id !== request.account_id) return false;
  if (grant.workspace_id !== request.workspace_id) return false;
  if (grant.capability !== request.capability) return false;
  if (grant.command_id !== request.command_id) return false;
  if (grant.action !== request.action) return false;
  const prefix = grant.cwd_scope_prefix.endsWith("/") ? grant.cwd_scope_prefix : `${grant.cwd_scope_prefix}/`;
  return request.cwd_scope === grant.cwd_scope_prefix || request.cwd_scope.startsWith(prefix);
}

function isExpired(expiresAt: string | undefined, nowIso: string): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= new Date(nowIso).getTime();
}

/**
 * Rule 9 (final) — the only rule allowed to produce ALLOW. Resolves every
 * grant matching this exact request (identity/account/workspace/
 * capability/command/action/cwd-prefix), applying, in order:
 * explicit deny overrides allow; revoked -> DENY; expired -> DENY; no
 * matching grant -> DENY; malformed grant record -> OWNER_REVIEW. Only a
 * clean, unrevoked, unexpired allow grant with no conflicting deny -> ALLOW.
 */
export function resolveGrant(request: ExecutionPermissionRequest, context: ExecutionPolicyContext, nowIso: string): TerminalOutcome {
  const candidates = context.grants.filter((g) => grantMatchesRequest(g, request));

  const malformed = candidates.find((g) => g.effect !== "allow" && g.effect !== "deny");
  if (malformed) {
    return {
      kind: "OWNER_REVIEW",
      reason_code: "AMBIGUOUS_GRANT_STATE",
      evidence: fail("resolve_grant", "grant.effect", "allow | deny", JSON.stringify((malformed as unknown as { effect: unknown }).effect)),
    };
  }

  const denies = candidates.filter((g) => g.effect === "deny" && !isExpired(g.expires_at, nowIso));
  if (denies.length > 0) {
    return {
      kind: "DENY",
      reason_code: "EXPLICIT_DENY",
      evidence: fail("resolve_grant", "grant.effect", "no matching deny grant", `deny grant ${denies[0].grant_id}`),
    };
  }

  const allows = candidates.filter((g) => g.effect === "allow");
  if (allows.length === 0) {
    return {
      kind: "DENY",
      reason_code: "NO_MATCHING_GRANT",
      evidence: fail("resolve_grant", "grant", "at least one matching allow grant", "none found"),
    };
  }

  const activeAllows = allows.filter((g) => !g.revoked_at);
  if (activeAllows.length === 0) {
    return {
      kind: "DENY",
      reason_code: "REVOKED_GRANT",
      evidence: fail("resolve_grant", "grant.revoked_at", "unrevoked allow grant", "every matching allow grant is revoked"),
    };
  }

  const unexpiredAllows = activeAllows.filter((g) => !isExpired(g.expires_at, nowIso));
  if (unexpiredAllows.length === 0) {
    return {
      kind: "DENY",
      reason_code: "EXPIRED_GRANT",
      evidence: fail("resolve_grant", "grant.expires_at", "unexpired allow grant", "every matching allow grant is expired"),
    };
  }

  const chosen = unexpiredAllows.slice().sort((a, b) => new Date(a.granted_at).getTime() - new Date(b.granted_at).getTime())[0];
  return {
    kind: "ALLOW",
    expires_at: chosen.expires_at,
    evidence: pass("resolve_grant", "grant", `matching allow grant ${chosen.grant_id}`, chosen.grant_id),
  };
}
