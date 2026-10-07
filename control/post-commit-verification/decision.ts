/**
 * หน้าที่: BUILD/TEST DECISION — the ONE pure combinator that turns a set
 * of already-run `CheckResult`s into the final `VerificationStatus`. No
 * I/O, no re-running anything, no default-to-VERIFIED path.
 *
 * Rule: every required check PASSED -> VERIFIED. Any check FAILED ->
 * FAILED. Otherwise (a required check is missing from `checks`, or any
 * check is UNRESOLVED) -> UNRESOLVED.
 *
 * Input: the list of required `CheckType`s, the real `CheckResult[]`
 * that were actually run.
 * Output: `decideVerification` -> `{status, reason_code}`.
 * Dependency ที่อนุญาต: ./types.ts.
 * สิ่งที่ห้ามแตะ: never return VERIFIED unless every required check_type
 * has a real, PASSED CheckResult present in `checks`.
 */

import type { CheckResult, CheckType, VerificationReasonCode, VerificationStatus } from "./types";

export function decideVerification(requiredChecks: readonly CheckType[], checks: readonly CheckResult[]): { status: VerificationStatus; reason_code: VerificationReasonCode } {
  const byType = new Map<CheckType, CheckResult>();
  for (const check of checks) byType.set(check.check_type, check);

  if (checks.some((c) => c.status === "FAILED")) {
    return { status: "FAILED", reason_code: "CHECK_FAILED" };
  }

  const allRequiredPresentAndPassed = requiredChecks.every((type) => byType.get(type)?.status === "PASSED");
  if (allRequiredPresentAndPassed) {
    return { status: "VERIFIED", reason_code: "VERIFIED" };
  }

  return { status: "UNRESOLVED", reason_code: "CHECK_EXECUTION_UNRESOLVED" };
}
