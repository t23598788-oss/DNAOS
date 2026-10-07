/**
 * หน้าที่: the deterministic rule table Permission / Policy Resolution
 * evaluates against — no LLM, no free-text policy generation, no runtime
 * AI reasoning anywhere in this file. Every rule here is a plain data
 * lookup or a fixed set membership test.
 *
 * Input: none (pure data + lookup helpers).
 * Output: `isKnownAction`, `allowedActionsFor`, `requiresOwnerApproval`,
 * `requiresEvidence`.
 * Dependency ที่อนุญาต: ./types.ts.
 * สิ่งที่ห้ามแตะ: never add a wildcard/catch-all entry that would let an
 * (resource_type, target_class) pair with no explicit row here resolve to
 * anything but "no match" — see ./resolver.ts's fail-closed default.
 */

import type { RequestedAction } from "./types";

/**
 * MINIMUM RULES 1-3 (+ their natural extensions to sibling resource_types
 * already established by control/artifact-destination/'s own mapping —
 * MODULE/API/ADAPTER share CAPABILITY_GRAPH with CAPABILITY, and
 * EXECUTION_EVIDENCE/REGISTRATION_EVIDENCE share EVIDENCE_STORE with
 * TEST_RESULT). Keyed `${resource_type}:${target_class}`.
 */
const ACTION_RULES: Readonly<Record<string, readonly RequestedAction[]>> = {
  "SOURCE_REFERENCE:SOURCE_AUTHORITY": ["WRITE_SOURCE"],
  "TEST_RESULT:EVIDENCE_STORE": ["APPEND_EVIDENCE"],
  "EXECUTION_EVIDENCE:EVIDENCE_STORE": ["APPEND_EVIDENCE"],
  "REGISTRATION_EVIDENCE:EVIDENCE_STORE": ["APPEND_EVIDENCE"],
  "CAPABILITY:CAPABILITY_GRAPH": ["REGISTER_CAPABILITY", "UPDATE_CAPABILITY"],
  "MODULE:CAPABILITY_GRAPH": ["REGISTER_CAPABILITY", "UPDATE_CAPABILITY"],
  "API:CAPABILITY_GRAPH": ["REGISTER_CAPABILITY", "UPDATE_CAPABILITY"],
  "ADAPTER:CAPABILITY_GRAPH": ["REGISTER_CAPABILITY", "UPDATE_CAPABILITY"],
  // MINIMUM RULE 4 — AI_INGRESS/SYSTEM_SERVICE mutate SYSTEM_REGISTRY.
  // The mutation is permitted to reach the decision table at all only
  // through this explicit row; SYSTEM_CONTROL_ACTIONS below then forces
  // the outcome to REQUIRE_APPROVAL — see ./resolver.ts.
  "AI_INGRESS:SYSTEM_REGISTRY": ["REGISTER_SYSTEM_RESOURCE", "UPDATE_SYSTEM_RESOURCE"],
  "SYSTEM_SERVICE:SYSTEM_REGISTRY": ["REGISTER_SYSTEM_RESOURCE", "UPDATE_SYSTEM_RESOURCE"],
};

/** READ_SYSTEM_STATE is read-only and target_class-agnostic — one explicit rule, never a silent fallback. */
const READ_SYSTEM_STATE: RequestedAction = "READ_SYSTEM_STATE";

/** System-level actions that MINIMUM RULE 14 always escalates to REQUIRE_APPROVAL, never ALLOW, once every fail-closed check passes. */
const SYSTEM_CONTROL_ACTIONS: ReadonlySet<RequestedAction> = new Set(["REGISTER_SYSTEM_RESOURCE", "UPDATE_SYSTEM_RESOURCE", "PREPARE_DEPLOYMENT"]);

/** Every mutating action requires real evidence (MINIMUM RULE 12) — READ_SYSTEM_STATE is the one read-only exception. */
const EVIDENCE_EXEMPT_ACTIONS: ReadonlySet<RequestedAction> = new Set(["READ_SYSTEM_STATE"]);

const ALL_ACTIONS: ReadonlySet<string> = new Set<RequestedAction>([
  "WRITE_SOURCE", "APPEND_EVIDENCE", "REGISTER_CAPABILITY", "UPDATE_CAPABILITY",
  "REGISTER_SYSTEM_RESOURCE", "UPDATE_SYSTEM_RESOURCE", "PREPARE_DEPLOYMENT", "READ_SYSTEM_STATE",
]);

export function isKnownAction(action: string): action is RequestedAction {
  return ALL_ACTIONS.has(action);
}

/** True only when this exact (resource_type, target_class) pair has an explicit row in ACTION_RULES — distinguishes MINIMUM RULE 9's "no relationship at all" (SOURCE_TARGET_MISMATCH) from "a real relationship exists but this action isn't one of its allowed ones" (ACTION_NOT_ALLOWED_FOR_DESTINATION). READ_SYSTEM_STATE never needs a row — it is read-only and target_class-agnostic. */
export function hasDestinationRule(resourceType: string, targetClass: string): boolean {
  return Object.prototype.hasOwnProperty.call(ACTION_RULES, `${resourceType}:${targetClass}`);
}

/** Returns the actions permitted for this exact (resource_type, target_class) pair — empty array if no row matches (fail-closed, never a guess). READ_SYSTEM_STATE is always permitted regardless of the pair, since it never mutates anything. */
export function allowedActionsFor(resourceType: string, targetClass: string): readonly RequestedAction[] {
  const row = ACTION_RULES[`${resourceType}:${targetClass}`] ?? [];
  return [...row, READ_SYSTEM_STATE];
}

export function requiresOwnerApproval(action: RequestedAction): boolean {
  return SYSTEM_CONTROL_ACTIONS.has(action);
}

export function requiresEvidence(action: RequestedAction): boolean {
  return !EVIDENCE_EXEMPT_ACTIONS.has(action);
}
