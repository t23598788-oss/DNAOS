/**
 * หน้าที่: `runPostCommitVerification()` — the one real entry point:
 *
 * COMMIT SHA -> BUILD/TEST REQUIREMENT RESOLUTION -> RUN REQUIRED CHECKS
 *   -> COLLECT RESULTS -> BUILD/TEST DECISION -> PASS | FAIL | UNRESOLVED
 *   -> STOP
 *
 * Every check below is a fixed comparison against real, already-produced
 * state (the real, persisted `SourceExecutionResult` Evidence row this
 * commit_sha must trace back to) or a real, freshly-run check
 * (`./run-checks.ts`) — never a re-classification, never a
 * re-duplicate-check, never a re-mapped destination/target, never a
 * re-decided policy/admission, never a new commit/push/deploy.
 *
 * Idempotency: before running anything, this function checks for an
 * already-persisted `post_commit_verification` Evidence row for the SAME
 * (task_id, commit_sha, artifact_resource_id) — if found, the exact same
 * result is replayed, and no check is ever re-run.
 *
 * Input: `PostCommitVerificationInput`, a real `RegistryStore` (unused
 * directly here — kept for interface symmetry with every other stage
 * this session; this stage's only real reads are agent-gateway Evidence).
 * Output: `runPostCommitVerification` -> `PostCommitVerificationResult`
 * (also persisted as Evidence, kind="post_commit_verification"; each
 * individual check as kind="post_commit_check").
 * Dependency ที่อนุญาต: ../agent-gateway/contract.ts (loadEvidenceForTask,
 * saveEvidence), ./requirement-resolution.ts, ./run-checks.ts, ./decision.ts,
 * ./host-runtime.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never call classifyCandidate/resolveDuplicate/
 * resolveArtifactDestination/resolveTarget/resolvePolicy/evaluateAdmission
 * /executeSource here. Never persist a `status` this function did not
 * itself compute from real `CheckResult`s.
 */

import { loadEvidenceForTask, saveEvidence } from "../agent-gateway/contract";
import { resolveRequiredChecks } from "./requirement-resolution";
import { runOneCheck } from "./run-checks";
import { decideVerification } from "./decision";
import { newVerificationId, nowIso } from "./host-runtime";
import type { CheckResult, CheckType, PostCommitVerificationInput, PostCommitVerificationResult, VerificationReasonCode } from "./types";

const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

function finalize(input: PostCommitVerificationInput, status: PostCommitVerificationResult["status"], reason_code: VerificationReasonCode, checks: readonly CheckResult[] = [], requiredChecks: readonly CheckType[] = []): PostCommitVerificationResult {
  const passed = checks.filter((c) => c.status === "PASSED").map((c) => c.check_type);
  const failed = checks.filter((c) => c.status === "FAILED").map((c) => c.check_type);
  const result: PostCommitVerificationResult = {
    verification_id: newVerificationId(),
    commit_sha: input.commit_sha,
    artifact_resource_id: input.artifact_resource_id,
    required_checks: requiredChecks,
    passed_checks: passed,
    failed_checks: failed,
    checks,
    status,
    reason_code,
    evidence_refs: input.evidence_refs,
    correlation_id: input.correlation_id,
    created_at: nowIso(),
  };
  saveEvidence({
    evidence_id: result.verification_id,
    task_id: input.task_id,
    kind: "post_commit_verification",
    source: "control/post-commit-verification/resolver.ts",
    recorded_at: result.created_at,
    payload: result,
  });
  return result;
}

export async function runPostCommitVerification(input: PostCommitVerificationInput): Promise<PostCommitVerificationResult> {
  // Idempotency — a prior verification for this EXACT (task_id, commit_sha,
  // artifact_resource_id), if any, is replayed as-is; checks are never re-run.
  const priorEvidence = loadEvidenceForTask(input.task_id).find((e) => {
    if (e.kind !== "post_commit_verification") return false;
    const payload = e.payload as PostCommitVerificationResult;
    return payload.commit_sha === input.commit_sha && payload.artifact_resource_id === input.artifact_resource_id;
  });
  if (priorEvidence) return priorEvidence.payload as PostCommitVerificationResult;

  // Fail-closed commit_sha shape check (STEP requirement E).
  if (!COMMIT_SHA_PATTERN.test(input.commit_sha)) {
    return finalize(input, "UNRESOLVED", "INVALID_COMMIT_SHA");
  }

  // The commit_sha must trace back to a REAL, persisted, SUCCEEDED
  // Source Execution result for this exact artifact_resource_id — never
  // trusting a caller's bare claim (STEP requirement F: a result
  // belonging to a different commit/artifact must be rejected).
  const sourceExecutionEvidence = loadEvidenceForTask(input.task_id).find((e) => {
    if (e.kind !== "execution_output") return false;
    const payload = e.payload as { commit_sha: string | null; artifact_resource_id: string; execution_status: string };
    return payload.commit_sha === input.commit_sha && payload.artifact_resource_id === input.artifact_resource_id && payload.execution_status === "SUCCEEDED";
  });
  if (!sourceExecutionEvidence) {
    return finalize(input, "UNRESOLVED", "COMMIT_NOT_FOUND_FOR_ARTIFACT");
  }

  // Requirement resolution — deterministic, never a guess (./requirement-resolution.ts).
  const requirements = resolveRequiredChecks();
  if (requirements.length === 0) {
    return finalize(input, "UNRESOLVED", "VERIFICATION_REQUIREMENT_NOT_FOUND");
  }

  // Run each required check through the existing execution/run/ engine —
  // sequential, since some checks (e.g. npm.test_integration) declare an
  // exclusiveLockKey and must never run concurrently with themselves.
  const checks: CheckResult[] = [];
  for (const requirement of requirements) {
    const check = await runOneCheck(requirement, input.correlation_id, {
      saveCheckEvidence: (checkResult, req, correlationId) => {
        const evidenceId = checkResult.check_id;
        saveEvidence({
          evidence_id: evidenceId,
          task_id: input.task_id,
          kind: "post_commit_check",
          source: "control/post-commit-verification/run-checks.ts",
          recorded_at: nowIso(),
          payload: { ...checkResult, commit_sha: input.commit_sha, artifact_resource_id: input.artifact_resource_id, requirement: req, correlation_id: correlationId },
        });
        return evidenceId;
      },
    });
    checks.push(check);
  }

  const requiredTypes = requirements.map((r) => r.check_type);
  const decision = decideVerification(requiredTypes, checks);
  return finalize(input, decision.status, decision.reason_code, checks, requiredTypes);
}
