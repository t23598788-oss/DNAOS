/**
 * หน้าที่: the one place that constructs a `WriteGateEvidence` record —
 * same discipline as `../execution-policy/evidence.ts`, so every rule in
 * ./rules.ts produces evidence in exactly the same shape.
 *
 * Input: rule id, input field, expected, actual, result.
 * Output: `pass()`, `fail()`.
 * Dependency ที่อนุญาต: `../../contracts/write-intent/write-intent.ts` (type only).
 * สิ่งที่ห้ามแตะ: never leave expected/actual empty when the real value is
 * unknown — write "unknown"/"absent" explicitly.
 */

import type { WriteGateEvidence } from "../../contracts/write-intent/write-intent";

export function pass(rule_id: string, input_field: string, expected: string, actual: string): WriteGateEvidence {
  return { rule_id, input_field, expected, actual, result: "pass" };
}

export function fail(rule_id: string, input_field: string, expected: string, actual: string): WriteGateEvidence {
  return { rule_id, input_field, expected, actual, result: "fail" };
}
