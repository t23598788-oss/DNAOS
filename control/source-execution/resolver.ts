/**
 * หน้าที่: `executeSource()` — the one real entry point for
 * Admitted Source -> Execution Dispatch -> GitHub Source Executor ->
 * Write/Commit/Push -> Execution Result -> Evidence/Version Reference.
 * Every check below is a fixed comparison against real, already-produced
 * state (the real, persisted `AdmissionResult`, the caller-supplied
 * connection/repository data) — never a re-classification, never a
 * re-duplicate-check, never a re-resolve of destination/target, never a
 * re-decision of policy. The Agent never holds a GitHub credential and
 * never calls GitHub directly — this function, called only by DNA OS
 * itself, is the one place that happens.
 *
 * ADMITTED SOURCE -> EXECUTION DISPATCH -> GITHUB SOURCE EXECUTOR
 *   -> WRITE/COMMIT/PUSH -> EXECUTION RESULT -> EVIDENCE/VERSION REFERENCE
 *   -> RETURN TO DNA OS -> STOP
 *
 * Idempotency (STEP requirement L): before ever calling GitHub, this
 * function checks for an already-persisted `execution_output` Evidence
 * row for the SAME `admission_id` — if found, the exact same result is
 * returned, and GitHub is never called a second time. A new commit
 * requires a new, real Admission (a new `admission_id`), never a bare
 * retry of the same one.
 *
 * Input: `SourceExecutionInput`, a real `RegistryStore`.
 * Output: `executeSource` -> `SourceExecutionResult` (also persisted as
 * Evidence, kind="execution_output", and — only on a real commit — the
 * commit SHA is recorded back onto the artifact's own resource through
 * the existing `control/registration-update/` path, never a new
 * capability).
 * Dependency ที่อนุญาต: ../agent-gateway/contract.ts (getTask,
 * loadEvidenceForTask, saveEvidence), ../../software/registry-database/contract.ts
 * (findResourceById, RegistryStore — read-only), ../registration-update/contract.ts
 * (applyMutation — the existing update path, never a new write path),
 * ../../connections/github/repo-path.ts (checkRepoPath), ../../connections/github/credential-resolution.ts,
 * ../../connections/github/github-read-api.ts (getRepository), ../../connections/github/write-api.ts
 * (putFileContents — the one real GitHub write call), ./types.ts, ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ: never call classifyCandidate/resolveDuplicate/
 * resolveArtifactDestination/resolveTarget/resolvePolicy here. Never call
 * `commitRegisteredCandidate`/`runRegistrationPipeline` (no new
 * resource/capability for a commit — only registration-update's
 * ADD_EVIDENCE). Never hardcode an owner/repo/branch/token — every one of
 * those must come from `input.connection`/`input.repository_reference`.
 */

import { getTask, loadEvidenceForTask, saveEvidence } from "../agent-gateway/contract";
import { findResourceById } from "../../software/registry-database/contract";
import type { RegistryStore } from "../../software/registry-database/contract";
import { applyMutation } from "../registration-update/contract";
import { checkRepoPath } from "../../connections/github/repo-path";
import { resolveGithubCredential } from "../../connections/github/credential-resolution";
import { getRepository } from "../../connections/github/github-read-api";
import { putFileContents } from "../../connections/github/write-api";
import { newExecutionId, nowIso } from "./host-runtime";
import type { AdmissionResult } from "../admission/contract";
import type { ExecutionReasonCode, SourceExecutionInput, SourceExecutionResult } from "./types";

export interface SourceExecutionContext {
  store: RegistryStore;
}

function finalize(input: SourceExecutionInput, execution_status: SourceExecutionResult["execution_status"], reason_code: ExecutionReasonCode, extra: Partial<Pick<SourceExecutionResult, "target_capability_id" | "repository_reference" | "branch" | "commit_sha">> = {}): SourceExecutionResult {
  const result: SourceExecutionResult = {
    execution_id: newExecutionId(),
    admission_id: input.admission_id,
    artifact_resource_id: input.artifact_resource_id,
    target_capability_id: extra.target_capability_id ?? input.resolved_target.destination_capability_id,
    repository_reference: extra.repository_reference ?? input.repository_reference,
    branch: extra.branch ?? input.repository_reference?.branch ?? null,
    source_path: input.source_location,
    commit_sha: extra.commit_sha ?? null,
    execution_status,
    reason_code,
    evidence_refs: input.evidence_refs,
    correlation_id: input.correlation_id,
    created_at: nowIso(),
  };
  saveEvidence({
    evidence_id: result.execution_id,
    task_id: input.task_id,
    kind: "execution_output",
    source: "control/source-execution/resolver.ts",
    recorded_at: result.created_at,
    payload: result,
  });
  return result;
}

export async function executeSource(input: SourceExecutionInput, context: SourceExecutionContext): Promise<SourceExecutionResult> {
  // Idempotency (requirement L) — a prior execution for this EXACT
  // admission_id, if any, is replayed as-is; GitHub is never called twice
  // for the same admission.
  const priorEvidence = loadEvidenceForTask(input.task_id).find((e) => e.kind === "execution_output" && (e.payload as SourceExecutionResult).admission_id === input.admission_id);
  if (priorEvidence) return priorEvidence.payload as SourceExecutionResult;

  // 1/2/3/4 — the real, persisted AdmissionResult, re-read independently
  // (never trusting a caller-supplied "it was ADMITTED" claim on its own).
  const admissionEvidence = loadEvidenceForTask(input.task_id).find((e) => e.kind === "admission" && e.evidence_id === input.admission_id);
  if (!admissionEvidence) return finalize(input, "UNRESOLVED", "ADMISSION_NOT_FOUND");
  const admission = admissionEvidence.payload as AdmissionResult;

  if (admission.artifact_resource_id !== input.artifact_resource_id || admission.task_id !== input.task_id) {
    return finalize(input, "FAILED", "IDENTITY_MISMATCH");
  }
  if (admission.decision !== "ADMITTED" || !admission.execution_ready_reference) {
    return finalize(input, "FAILED", "NOT_ADMITTED");
  }
  if (admission.execution_ready_reference.resolved_target.target_ref !== input.resolved_target.target_ref) {
    return finalize(input, "FAILED", "TARGET_MISMATCH");
  }

  // 5 — this round supports exactly one authorized_action.
  if (input.authorized_action !== "WRITE_SOURCE") {
    return finalize(input, "FAILED", "EXECUTION_NOT_SUPPORTED");
  }

  // Structural sanity — the artifact must still be a real registration.
  if (!findResourceById(input.artifact_resource_id, context.store)) {
    return finalize(input, "UNRESOLVED", "ADMISSION_NOT_FOUND");
  }

  // Task still exists (Admission already checked it was active; here we
  // only confirm it is still findable — never re-decide task validity).
  if (!getTask(input.task_id)) {
    return finalize(input, "UNRESOLVED", "ADMISSION_NOT_FOUND");
  }

  // Source path — the same real, reused validator every other stage uses.
  const pathCheck = checkRepoPath(input.source_location);
  if (!pathCheck.ok) {
    return finalize(input, "FAILED", "INVALID_SOURCE_PATH");
  }

  // GitHub connection — real, caller-supplied, never fabricated.
  if (!input.connection || input.connection.adapter !== "github" || input.connection.status !== "connected") {
    return finalize(input, "UNRESOLVED", "GITHUB_CONNECTION_NOT_REGISTERED");
  }

  // Credential — resolved only through the existing DNA OS credential
  // boundary (connections/github/credential-resolution.ts), never inline.
  const credential = await resolveGithubCredential(input.connection);
  if (!credential.ok) {
    return finalize(input, "UNRESOLVED", "CREDENTIAL_NOT_RESOLVED");
  }

  // Repository — real, caller-supplied target, verified live.
  if (!input.repository_reference) {
    return finalize(input, "UNRESOLVED", "REPOSITORY_NOT_FOUND");
  }
  const repoLookup = await getRepository(credential.token, input.repository_reference);
  if (repoLookup.kind !== "found") {
    return finalize(input, "UNRESOLVED", "REPOSITORY_NOT_FOUND", { repository_reference: input.repository_reference, branch: input.repository_reference.branch });
  }

  // The one real write: create-or-update one file, one commit, on the
  // registered branch.
  const writeResult = await putFileContents(credential.token, input.repository_reference, pathCheck.normalized, input.source_content, input.commit_message);
  if (writeResult.kind !== "written") {
    return finalize(input, "FAILED", "GITHUB_WRITE_FAILED", { repository_reference: input.repository_reference, branch: input.repository_reference.branch });
  }

  const succeeded = finalize(input, "SUCCEEDED", "SUCCEEDED", {
    repository_reference: input.repository_reference,
    branch: input.repository_reference.branch,
    commit_sha: writeResult.commit_sha,
  });

  // Version reference — recorded back through the EXISTING update path
  // only (never a new capability for a new commit). SOURCE_REFERENCE
  // artifacts are resource-only rows (no capability_id) — see
  // control/registration-update/'s "" sentinel.
  applyMutation(
    {
      resource_id: input.artifact_resource_id,
      capability_id: "",
      expected_current_version: (findResourceById(input.artifact_resource_id, context.store)?.version) ?? "1.0.0",
      mutation_type: "ADD_EVIDENCE",
      mutation_payload: { evidence_ref: `github-commit-sha:${writeResult.commit_sha}` },
      evidence_refs: [],
      correlation_id: input.correlation_id,
    },
    context.store,
  );

  return succeeded;
}
