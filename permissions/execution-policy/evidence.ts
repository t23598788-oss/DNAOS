/**
 * หน้าที่: the one place that constructs a `RuleEvidence` record, so every
 * rule in rules.ts produces evidence in exactly the same shape. Enforces
 * "no opaque boolean-only decisions" (STEP 7 of
 * ../../reports/EXECUTION_MIGRATION_PLAN.md) at the type-construction
 * level, not just by convention.
 *
 * Input: a rule id, the input field being checked, its expected value
 * (as a string), the actual value observed (as a string), and the result.
 * Output: `pass()`, `fail()`, `skipped()` — three narrow constructors
 * instead of one function with a result parameter, so a caller cannot
 * accidentally swap expected/actual and mislabel the result.
 * Dependency ที่อนุญาต: ./types.ts.
 * สิ่งที่ห้ามแตะ: never let `expected`/`actual` be empty strings when the
 * underlying value is genuinely unknown — write "unknown" or "absent"
 * explicitly, so the evidence line is never silently misleading.
 *
 * NOT_YET_BUILT: no caller outside this folder's own policy.ts and
 * rules.ts yet.
 */

import type { RuleEvidence } from "./types";

export function pass(rule_id: string, input_field: string, expected: string, actual: string): RuleEvidence {
  return { rule_id, input_field, expected, actual, result: "pass" };
}

export function fail(rule_id: string, input_field: string, expected: string, actual: string): RuleEvidence {
  return { rule_id, input_field, expected, actual, result: "fail" };
}

export function skipped(rule_id: string, input_field: string, reason: string): RuleEvidence {
  return { rule_id, input_field, expected: "n/a (skipped)", actual: reason, result: "skipped" };
}
