/**
 * หน้าที่: the type contracts for execution-policy — the third question
 * this repo's permission model answers ("holding the software, how much
 * execution right does this Identity actually have, right now, for this
 * one command"). Distinct from ../access-control/ (who is this identity,
 * what account) and ../software-scope/ (which account holds which
 * software) per this folder's README.
 *
 * Input: none (pure type definitions).
 * Output: `ExecutionPermissionRequest`, `ExecutionPermissionDecision`,
 * `ExecutionDecisionValue`, `ExecutionReasonCode`, `RuleEvidence`,
 * `CommandPolicyDescriptor`, `ExecutionGrant`.
 * Dependency ที่อนุญาต: ../access-control/identity.ts,
 * ../access-control/membership.ts (type shapes only).
 * สิ่งที่ห้ามแตะ: never add a raw shell string field anywhere in this file
 * — `requested_args` is a structured array, matching
 * ../../reports/EXECUTION_MIGRATION_PLAN.md's PUBLIC_CONTRACT, which
 * forbids freeform shell strings by design. Never add a field that lets a
 * caller assert its own account_id/workspace_id membership as valid —
 * membership is always looked up from real Membership rows by the caller
 * of evaluateExecutionPermission, never trusted from the request itself.
 *
 * NOT_YET_BUILT: nothing calls evaluateExecutionPermission() yet —
 * ../../control/command-router/ and ../../execution/run/ are both
 * NOT_YET_BUILT. This file exists so the permission boundary can be
 * designed and tested before either of those exist, per Owner instruction
 * (2026-08-16): build the missing execution-scope permission layer before
 * migrating the EXECUTION runtime.
 */

import type { Identity } from "../access-control/identity";
import type { Membership } from "../access-control/membership";

/** One caller's request to run one specific command, scoped to one account/workspace. */
export interface ExecutionPermissionRequest {
  identity_id: string;
  account_id: string;
  workspace_id: string;
  capability: string; // which capability folder's execution this belongs to, e.g. "execution.run"
  command_id: string; // the allowlisted command being requested — never a raw shell string
  action: string; // e.g. "run", "cancel" — the specific verb within the command's scope
  cwd_scope: string; // the working-directory scope the command would run under, e.g. a repo-relative path prefix
  requested_args: readonly string[]; // structured argv-style tokens only — never a single joined shell string
  correlation_id: string;
}

export type ExecutionDecisionValue = "ALLOW" | "DENY" | "OWNER_REVIEW";

export type ExecutionReasonCode =
  | "MALFORMED_REQUEST"
  | "UNKNOWN_IDENTITY"
  | "MISSING_ACCOUNT_MEMBERSHIP" // also covers "cross-account": identity known, but holds no active membership for the requested account
  | "MISSING_WORKSPACE_MEMBERSHIP" // also covers "cross-workspace": identity known, but holds no active membership for the requested workspace
  | "REVOKED_MEMBERSHIP" // Membership (see ../access-control/membership.ts) has no expiry field, only revoked_at — there is no separate "expired membership" state to detect
  | "UNKNOWN_COMMAND"
  | "CROSS_CAPABILITY"
  | "ACTION_NOT_ALLOWED"
  | "CWD_SCOPE_VIOLATION"
  | "EXPLICIT_DENY"
  | "REVOKED_GRANT"
  | "EXPIRED_GRANT"
  | "NO_MATCHING_GRANT"
  | "AMBIGUOUS_GRANT_STATE"
  | "POLICY_EVALUATION_ERROR"
  | "GRANTED";

/** One deterministic rule outcome — never a bare boolean, matching this repo's no-silent-failure discipline (see ../../contracts/command/routing-result.ts). */
export interface RuleEvidence {
  rule_id: string;
  input_field: string;
  expected: string;
  actual: string;
  result: "pass" | "fail" | "skipped";
}

export interface ExecutionPermissionDecision {
  decision: ExecutionDecisionValue;
  reason_codes: readonly ExecutionReasonCode[];
  matched_rules: readonly string[]; // rule_ids that passed
  denied_rules: readonly string[]; // rule_ids that failed or triggered OWNER_REVIEW
  scope: {
    account_id: string;
    workspace_id: string;
    capability: string;
    command_id: string;
  };
  expires_at?: string; // set only when decision === "ALLOW" and the matching grant carries an expiry
  evidence: readonly RuleEvidence[]; // every rule actually evaluated, in evaluation order, up to and including the one that decided the outcome
  decision_id: string;
  correlation_id: string;
  decided_at: string;
}

/**
 * The minimal command metadata execution-policy is allowed to read.
 * Deliberately NOT the executor and NOT the allowlist registry itself —
 * once ../../execution/run/registry.ts exists, its caller is expected to
 * project a CommandPolicyDescriptor from the real allowlist entry, never
 * the reverse (execution-policy never imports execution/run/). See
 * ../../reports/EXECUTION_MIGRATION_PLAN.md STEP 4 (command registry
 * boundary): this layer may validate command_id / required_capability /
 * required_action / allowed_cwd_scope, but must never execute a command or
 * accept an arbitrary shell string.
 */
export interface CommandPolicyDescriptor {
  command_id: string;
  required_capability: string;
  allowed_actions: readonly string[];
  allowed_cwd_scope_prefixes: readonly string[];
}

/**
 * One explicit permission grant (or explicit deny) — the only source of
 * ALLOW. No grant, no ALLOW: absence is DENY, per Owner instruction "no
 * matching permission -> DENY."
 */
export interface ExecutionGrant {
  grant_id: string;
  identity_id: string;
  account_id: string;
  workspace_id: string;
  capability: string;
  command_id: string;
  action: string;
  cwd_scope_prefix: string; // requested cwd_scope must start with this prefix to match
  effect: "allow" | "deny";
  granted_at: string;
  revoked_at?: string;
  expires_at?: string;
}

/**
 * Everything evaluateExecutionPermission() needs beyond the request
 * itself — always resolved and supplied by the caller (the future
 * ../../control/command-router/), never looked up by this module. This is
 * the enforced separation from STEP 9 of the migration plan: Identity /
 * Membership context -> Execution Permission Request -> execution-policy.
 * execution-policy consumes resolved context; it never becomes the
 * identity system.
 */
export interface ExecutionPolicyContext {
  identity: Identity | undefined; // undefined = identity could not be resolved by the caller
  memberships: readonly Membership[]; // every Membership row on record for this identity, both revoked and active — filtering happens inside the policy, not before it, so the evidence trail is complete
  grants: readonly ExecutionGrant[]; // every ExecutionGrant on record that could plausibly apply — narrowed inside the policy
  command: CommandPolicyDescriptor | undefined; // undefined = command_id is not a known allowlisted command
}
