/**
 * หน้าที่: the individual deterministic rules ./policy.ts evaluates, in
 * fixed order — same pattern as `../execution-policy/rules.ts`. Every rule
 * is a pure function: same intent + context in, same outcome out.
 *
 * Owner's ข้อ 7 rule set, implemented literally:
 * - CREATE + zero real overlaps found in the registry index -> continue (policy.ts terminals as ALLOW_CREATE)
 * - CREATE + exactly one real overlap found -> REUSE_EXISTING, with the real canonical path + evidence
 * - CREATE + more than one overlap (cannot prove a single canonical) -> UNKNOWN
 * - MODIFY/DELETE/MOVE/RENAME + exactly one real overlap -> ALLOW_MODIFY, with the real canonical path
 * - MODIFY/DELETE/MOVE/RENAME + zero overlaps (nothing real to touch) -> DENY
 * - MODIFY/DELETE/MOVE/RENAME + more than one overlap -> UNKNOWN
 *
 * Input: `WriteIntent`, `WriteGateContext`.
 * Output: `RuleOutcome` per rule.
 * Dependency ที่อนุญาต: ./evidence.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never make `ruleWellFormedIntent` return anything but
 * "continue"/"DENY" — only `ruleRegistryLookup` may ever produce a
 * terminal ALLOW_CREATE/ALLOW_MODIFY/REUSE_EXISTING/UNKNOWN, matching
 * `../execution-policy/rules.ts`'s own "only the final rule may ALLOW"
 * structural guarantee.
 */

import { fail, pass } from "./evidence";
import type { WriteGateCanonicalReference, WriteGateEvidence, WriteGateContext, WriteIntent } from "./types";
import type { CapabilityMetadata } from "../../software/capability-registrar/contract";
import { searchOverlap } from "../../software/capability-registrar/contract";

export type RuleOutcome =
  | { kind: "continue"; evidence: WriteGateEvidence }
  | { kind: "DENY"; evidence: WriteGateEvidence; reason_code: string; canonical: null }
  | { kind: "UNKNOWN"; evidence: WriteGateEvidence; reason_code: string; canonical: null }
  | { kind: "REUSE_EXISTING"; evidence: WriteGateEvidence; reason_code: string; canonical: WriteGateCanonicalReference }
  | { kind: "ALLOW_MODIFY"; evidence: WriteGateEvidence; reason_code: string; canonical: WriteGateCanonicalReference };

export type GateOutcome = Extract<RuleOutcome, { kind: "continue" | "DENY" }>;
export type TerminalOutcome = Exclude<RuleOutcome, { kind: "continue" }>;

const VALID_OPERATIONS = new Set(["CREATE", "MODIFY", "DELETE", "MOVE", "RENAME"]);
const VALID_TARGET_TYPES = new Set(["FILE", "MODULE", "FUNCTION", "API", "TABLE", "CONTRACT", "CAPABILITY"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Rule 1 — the intent itself must be structurally real before the registry is ever consulted. */
export function ruleWellFormedIntent(intent: WriteIntent): GateOutcome {
  const requiredFields: Array<[string, unknown]> = [
    ["intent_id", intent.intent_id],
    ["capability", intent.capability],
    ["target_path", intent.target_path],
    ["requested_change", intent.requested_change],
    ["correlation_id", intent.correlation_id],
  ];
  for (const [field, value] of requiredFields) {
    if (!isNonEmptyString(value)) {
      return { kind: "DENY", reason_code: "MALFORMED_INTENT", canonical: null, evidence: fail("well_formed_intent", field, "non-empty string", value === undefined ? "absent" : JSON.stringify(value)) };
    }
  }
  if (!VALID_OPERATIONS.has(intent.operation)) {
    return { kind: "DENY", reason_code: "MALFORMED_INTENT", canonical: null, evidence: fail("well_formed_intent", "operation", [...VALID_OPERATIONS].join("|"), String(intent.operation)) };
  }
  if (!VALID_TARGET_TYPES.has(intent.target_type)) {
    return { kind: "DENY", reason_code: "MALFORMED_INTENT", canonical: null, evidence: fail("well_formed_intent", "target_type", [...VALID_TARGET_TYPES].join("|"), String(intent.target_type)) };
  }
  return { kind: "continue", evidence: pass("well_formed_intent", "intent", "structurally valid", "structurally valid") };
}

function toCanonical(record: CapabilityMetadata): WriteGateCanonicalReference {
  return { software_id: record.SOFTWARE_ID, owner_folder: record.OWNER_FOLDER, evidence_source: record.EVIDENCE_SOURCE };
}

/**
 * Real, literal overlap search against the caller-supplied registry
 * index — delegates entirely to `software/capability-registrar/`'s own
 * `searchOverlap()`. CLOSED 2026-08-21: this file used to reimplement
 * that exact normalize+filter algorithm inline (a real, verified
 * duplicate). A first attempt to delegate directly crashed
 * `control/command-router/tests/router.test.ts` with a real module-load
 * cycle (`capability-registrar/index.ts` computed its capability index
 * eagerly at module load, reaching back into
 * `control/command-router/contract.ts` while it was still mid-load via
 * command-router -> agent-gateway -> ai-write-adapter -> write-gate ->
 * capability-registrar -> command-router). The real root cause was fixed
 * at its source instead of worked around here:
 * `software/capability-registrar/index.ts`'s capability index is now
 * lazily computed and memoized on first real call (`getCapabilityIndex()`)
 * rather than eagerly at module load — merely importing
 * `capability-registrar/contract.ts` is now always safe regardless of
 * import order, so this file can safely import `searchOverlap` directly.
 * See that file's own header for the full account.
 *
 * This is still a DIFFERENT decision from Duplicate Resolution's
 * semantic-fingerprint check (control/registration-pipeline/duplicate-resolution.ts)
 * — path overlap answers "does this write collide with an existing
 * capability boundary?", never "is this the same capability/content?".
 * The two stay deliberately separate; only the folder-overlap
 * IMPLEMENTATION is shared now.
 */
function findOverlaps(intent: WriteIntent, registryIndex: readonly CapabilityMetadata[]): readonly CapabilityMetadata[] {
  return searchOverlap(intent.target_path, registryIndex);
}

/** Rule 2 (final) — the only rule allowed to produce a terminal ALLOW_CREATE (via "continue", terminaled by policy.ts)/ALLOW_MODIFY/REUSE_EXISTING/UNKNOWN. Owner ข้อ 7, literally. */
export function ruleRegistryLookup(intent: WriteIntent, context: WriteGateContext): GateOutcome | TerminalOutcome {
  const overlaps = findOverlaps(intent, context.registryIndex);

  if (intent.operation === "CREATE") {
    if (overlaps.length === 0) {
      return { kind: "continue", evidence: pass("registry_lookup", "target_path", "no existing capability overlaps this path", "no overlap found") };
    }
    if (overlaps.length === 1) {
      return {
        kind: "REUSE_EXISTING",
        reason_code: "EXISTING_CAPABILITY_FOUND",
        canonical: toCanonical(overlaps[0]),
        evidence: fail("registry_lookup", "target_path", "no existing capability overlaps this path", `overlaps real registered capability "${overlaps[0].CAPABILITY_ID}" at "${overlaps[0].OWNER_FOLDER}"`),
      };
    }
    return {
      kind: "UNKNOWN",
      reason_code: "AMBIGUOUS_OVERLAP",
      canonical: null,
      evidence: fail("registry_lookup", "target_path", "at most one overlapping capability", `overlaps ${overlaps.length} real registered capabilities: ${overlaps.map((o) => o.CAPABILITY_ID).join(", ")} — cannot prove a single canonical`),
    };
  }

  // MODIFY / DELETE / MOVE / RENAME — must target something real and unambiguous.
  if (overlaps.length === 0) {
    return {
      kind: "DENY",
      reason_code: "NO_MATCHING_CAPABILITY",
      canonical: null,
      evidence: fail("registry_lookup", "target_path", "an existing registered capability at this path", "no matching capability found — nothing real to modify/delete/move/rename"),
    };
  }
  if (overlaps.length > 1) {
    return {
      kind: "UNKNOWN",
      reason_code: "AMBIGUOUS_OVERLAP",
      canonical: null,
      evidence: fail("registry_lookup", "target_path", "exactly one matching capability", `matches ${overlaps.length} real registered capabilities: ${overlaps.map((o) => o.CAPABILITY_ID).join(", ")} — cannot prove which one`),
    };
  }
  return {
    kind: "ALLOW_MODIFY",
    reason_code: "MATCHED_EXISTING_CAPABILITY",
    canonical: toCanonical(overlaps[0]),
    evidence: pass("registry_lookup", "target_path", `an existing registered capability at this path`, `matches real registered capability "${overlaps[0].CAPABILITY_ID}" at "${overlaps[0].OWNER_FOLDER}"`),
  };
}
