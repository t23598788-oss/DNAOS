/**
 * หน้าที่: the type contracts for Post-Commit Build/Test Verification —
 * the layer strictly after Source Execution:
 *
 * COMMIT SHA -> BUILD/TEST REQUIREMENT RESOLUTION -> RUN REQUIRED CHECKS
 *   -> COLLECT RESULTS -> BUILD/TEST DECISION -> PASS | FAIL | UNRESOLVED
 *   -> STOP
 *
 * Answers exactly one question: "does this already-committed commit pass
 * the build/test checks this repo itself declares are required?" Never
 * re-classifies, never re-checks duplicates, never re-maps a
 * destination/target, never re-decides policy/admission, never commits/
 * pushes/deploys — see ./resolver.ts.
 *
 * Input: none (pure type definitions).
 * Output: `CheckType`, `CheckStatus`, `CheckResult`, `VerificationStatus`,
 * `VerificationReasonCode`, `PostCommitVerificationInput`,
 * `PostCommitVerificationResult`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never add a field that lets a caller pre-supply a
 * `status`/`exit_code`/`commit_sha` result — every field here is only
 * ever produced by ./resolver.ts running the real requirement resolution
 * and the real check execution.
 */

export type CheckType = "typecheck" | "unit_test" | "integration_test" | "build";

export type CheckStatus = "PASSED" | "FAILED" | "UNRESOLVED";

export interface CheckResult {
  check_id: string;
  check_type: CheckType;
  command_reference: string;
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
  status: CheckStatus;
  evidence_ref: string;
}

export type VerificationStatus = "VERIFIED" | "FAILED" | "UNRESOLVED";

export type VerificationReasonCode =
  | "VERIFIED"
  | "CHECK_FAILED"
  | "VERIFICATION_REQUIREMENT_NOT_FOUND"
  | "INVALID_COMMIT_SHA"
  | "COMMIT_NOT_FOUND_FOR_ARTIFACT"
  | "SOURCE_EXECUTION_NOT_SUCCEEDED"
  | "CHECK_EXECUTION_UNRESOLVED";

/**
 * Exactly what Source Execution already produced, plus nothing else —
 * this stage never re-derives destination/target/policy/admission, only
 * consumes their already-finished output (STEP "Build Post-Commit
 * Build/Test Gate").
 */
export interface PostCommitVerificationInput {
  artifact_resource_id: string;
  task_id: string;
  commit_sha: string;
  repository_reference: { owner: string; repo: string; branch: string };
  branch: string;
  source_path: string;
  correlation_id: string;
  evidence_refs: readonly string[];
}

export interface PostCommitVerificationResult {
  verification_id: string;
  commit_sha: string;
  artifact_resource_id: string;
  required_checks: readonly CheckType[];
  passed_checks: readonly CheckType[];
  failed_checks: readonly CheckType[];
  checks: readonly CheckResult[];
  status: VerificationStatus;
  reason_code: VerificationReasonCode;
  evidence_refs: readonly string[];
  correlation_id: string;
  created_at: string;
}
