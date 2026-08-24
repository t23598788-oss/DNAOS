/**
 * หน้าที่: PHASE 3/4/5/6 composition — continues ONE already-REGISTERED
 * artifact (from ./ingress.ts's real `ingestWorkResult()` output) through
 * the already-real, already-verified continuation:
 *
 *   ARTIFACT_DESTINATION -> TARGET_RESOLUTION
 *   -> PERMISSION_POLICY_RESOLUTION -> ADMISSION
 *   -> (ADMITTED only) SOURCE_EXECUTION
 *   -> (SUCCEEDED only) POST_COMMIT_VERIFICATION
 *
 * `control/work-result-ingress/` owns POST-WORK result ingestion and
 * registration (per the Owner's explicit PHASE 3 responsibility
 * assignment) — this file extends that SAME ownership to what happens
 * immediately after a successful registration for a real software
 * write. It is not a new orchestrator and not a new capability folder:
 * every stage below is called through its own real, unmodified
 * contract.ts, exactly once, in the fixed order those stages already
 * require of each other. No resolver here recomputes another resolver's
 * decision (Iron Rule 6).
 *
 * DUPLICATE/REJECTED/UNRESOLVED registration outcomes never reach past
 * NOT_APPLICABLE here — only a genuine, fresh "REGISTERED" decision (see
 * ./ingress.ts's `RegisteredArtifact`) is ever continued (Iron Rule 12).
 * A self-registry destination_class (CAPABILITY_GRAPH/EVIDENCE_STORE/
 * SYSTEM_REGISTRY) stops honestly at ARTIFACT_DESTINATION — the
 * registration itself already completed that artifact's real write;
 * there is nothing further to admit or execute.
 *
 * SOURCE_EXECUTION is only ever reached when Admission's real decision is
 * ADMITTED and the caller supplied real `source_content` — DENY,
 * REQUIRE_APPROVAL, and UNRESOLVED all stop here with zero source write
 * (Iron Rule 10). POST_COMMIT_VERIFICATION is only ever reached after a
 * real SUCCEEDED execution with a real commit_sha (Iron Rule 11) — this
 * file never fabricates one to reach further stages artificially.
 *
 * Input: `ContinuationInput`, a real `RegistryStore`.
 * Output: `continueRegisteredArtifact` -> `ContinuationResult`.
 * Dependency ที่อนุญาต: ../artifact-destination/contract.ts,
 * ../target-resolution/contract.ts,
 * ../permission-policy-resolution/contract.ts, ../admission/contract.ts,
 * ../source-execution/contract.ts,
 * ../post-commit-verification/contract.ts,
 * ../../software/registry-database/contract.ts (RegistryStore type
 * only), ../../contracts/connector/connection.ts (type only), ./types.ts.
 * สิ่งที่ห้ามแตะ: never call resolveArtifactDestination, resolveTarget,
 * resolvePolicy, evaluateAdmission, executeSource, or
 * runPostCommitVerification more than once each per artifact. Never
 * fabricate a commit_sha/execution_output to reach POST_COMMIT_VERIFICATION.
 * Never call connections/github's write API directly — only through
 * executeSource().
 */

import { resolveArtifactDestination } from "../artifact-destination/contract";
import type { ArtifactDestinationResult } from "../artifact-destination/contract";
import { resolveTarget } from "../target-resolution/contract";
import type { ResolvedTarget } from "../target-resolution/contract";
import { resolvePolicy } from "../permission-policy-resolution/contract";
import type { PolicyResult } from "../permission-policy-resolution/contract";
import { evaluateAdmission } from "../admission/contract";
import type { AdmissionResult } from "../admission/contract";
import { executeSource } from "../source-execution/contract";
import type { SourceExecutionResult, GithubRepositoryReference } from "../source-execution/contract";
import { runPostCommitVerification } from "../post-commit-verification/contract";
import type { PostCommitVerificationResult } from "../post-commit-verification/contract";
import type { RegistryStore } from "../../software/registry-database/contract";
import type { ConnectionRegistration } from "../../contracts/connector/connection";
import type { RegisteredArtifact } from "./types";

export type ContinuationStage = "NOT_APPLICABLE" | "ARTIFACT_DESTINATION" | "TARGET_RESOLUTION" | "PERMISSION_POLICY_RESOLUTION" | "ADMISSION" | "SOURCE_EXECUTION" | "POST_COMMIT_VERIFICATION";

export interface ContinuationInput {
  artifact: RegisteredArtifact;
  source_location: string;
  /** Real file bytes, only ever required for a SOURCE_AUTHORITY-destined artifact — never fabricated. Null when the caller has none to supply (e.g. TEST_RESULT/CAPABILITY artifacts never need this). */
  source_content: string | null;
  connection: ConnectionRegistration | null;
  task_id: string;
  worker_id: string;
  correlation_id: string;
  evidence_refs: readonly string[];
}

export interface ContinuationResult {
  stage: ContinuationStage;
  reason: string;
  destination: ArtifactDestinationResult | null;
  target: ResolvedTarget | null;
  policy: PolicyResult | null;
  admission: AdmissionResult | null;
  execution: SourceExecutionResult | null;
  post_commit: PostCommitVerificationResult | null;
}

function stop(stage: ContinuationStage, reason: string, partial: Partial<Omit<ContinuationResult, "stage" | "reason">> = {}): ContinuationResult {
  return {
    stage,
    reason,
    destination: partial.destination ?? null,
    target: partial.target ?? null,
    policy: partial.policy ?? null,
    admission: partial.admission ?? null,
    execution: partial.execution ?? null,
    post_commit: partial.post_commit ?? null,
  };
}

function toRepositoryReference(connection: ConnectionRegistration | null): GithubRepositoryReference | null {
  if (!connection?.target) return null;
  return { owner: connection.target.owner, repo: connection.target.repository, branch: connection.target.branch };
}

export async function continueRegisteredArtifact(input: ContinuationInput, deps: { store: RegistryStore }): Promise<ContinuationResult> {
  // Only a genuinely fresh REGISTERED decision is ever continued — a
  // DUPLICATE/REJECTED/UNRESOLVED registration outcome must never
  // silently enter destination/target/policy/admission/execution.
  if (input.artifact.decision !== "REGISTERED" || !input.artifact.resource_id) {
    return stop("NOT_APPLICABLE", `artifact decision was ${input.artifact.decision} (resource_id=${input.artifact.resource_id ?? "null"}) — only a real REGISTERED artifact with a real resource_id is ever continued`);
  }

  // 1. ARTIFACT_DESTINATION — real, unmodified.
  const destination = resolveArtifactDestination({ resource_id: input.artifact.resource_id, resource_type: input.artifact.resource_type, capability_id: input.artifact.capability_id, evidence_ref: input.evidence_refs[0] ?? input.source_location });
  if (destination.destination_status !== "AVAILABLE") {
    return stop("ARTIFACT_DESTINATION", destination.next_action, { destination });
  }
  if (destination.destination_class !== "SOURCE_AUTHORITY") {
    return stop("ARTIFACT_DESTINATION", `destination_class=${destination.destination_class} is a self-registry class — the real registration already completed this artifact's real write; nothing further to admit or execute`, { destination });
  }

  // 2. TARGET_RESOLUTION — real, unmodified, composes destination itself internally.
  const target = resolveTarget(
    { resource_id: input.artifact.resource_id, resource_type: input.artifact.resource_type, capability_id: input.artifact.capability_id, source_location: input.source_location, evidence_ref: input.evidence_refs[0] ?? input.source_location },
    { connections: input.connection ? [input.connection] : [] },
  );
  if (target.target_status !== "RESOLVED") {
    return stop("TARGET_RESOLUTION", target.reason, { destination, target });
  }

  // 3. PERMISSION_POLICY_RESOLUTION — real, unmodified.
  const policy = resolvePolicy(
    { artifact_resource_id: input.artifact.resource_id, artifact_resource_type: input.artifact.resource_type, source_capability_id: null, target_capability_id: target.destination_capability_id, target_class: target.destination_class, task_id: input.task_id, worker_id: input.worker_id, requested_action: "WRITE_SOURCE", evidence_refs: input.evidence_refs, correlation_id: input.correlation_id },
    { store: deps.store },
  );

  // 4. ADMISSION — real, unmodified; independently re-reads the real
  // persisted policy Evidence rather than trusting `policy` directly —
  // always called so that DENY/REQUIRE_APPROVAL/UNRESOLVED are reported
  // through Admission's own real, authoritative decision.
  const admission = evaluateAdmission(
    { artifact_resource_id: input.artifact.resource_id, task_id: input.task_id, correlation_id: input.correlation_id, resolved_target: target, policy_decision_id: policy.policy_decision_id, policy_decision: policy.decision, evidence_refs: input.evidence_refs },
    { store: deps.store },
  );
  if (admission.decision !== "ADMITTED") {
    // DENY -> NOT_ADMITTED, REQUIRE_APPROVAL -> REQUIRE_APPROVAL, unresolvable prerequisite -> UNRESOLVED. Zero source write in every case.
    return stop("ADMISSION", `${admission.decision}:${admission.reason_code}`, { destination, target, policy, admission });
  }
  if (input.source_content === null) {
    return stop("ADMISSION", "ADMITTED, but the caller supplied no real source_content — never fabricating a write to reach SOURCE_EXECUTION", { destination, target, policy, admission });
  }

  // 5. SOURCE_EXECUTION — real, unmodified; only reachable when ADMITTED.
  const execution = await executeSource(
    {
      admission_id: admission.admission_id,
      artifact_resource_id: input.artifact.resource_id,
      task_id: input.task_id,
      correlation_id: input.correlation_id,
      authorized_action: admission.execution_ready_reference!.authorized_action,
      resolved_target: target,
      source_location: input.source_location,
      source_content: input.source_content,
      connection: input.connection,
      repository_reference: toRepositoryReference(input.connection),
      commit_message: `work-result-ingress continuation: ${input.source_location}`,
      evidence_refs: input.evidence_refs,
    },
    { store: deps.store },
  );
  if (execution.execution_status !== "SUCCEEDED") {
    return stop("SOURCE_EXECUTION", `${execution.execution_status}:${execution.reason_code}`, { destination, target, policy, admission, execution });
  }

  // 6. POST_COMMIT_VERIFICATION — real, unmodified; only reachable after a real SUCCEEDED execution with a real commit_sha. Never fabricated.
  const postCommit = await runPostCommitVerification({
    artifact_resource_id: input.artifact.resource_id,
    task_id: input.task_id,
    commit_sha: execution.commit_sha!,
    repository_reference: execution.repository_reference!,
    branch: execution.branch!,
    source_path: execution.source_path,
    correlation_id: input.correlation_id,
    evidence_refs: input.evidence_refs,
  });
  return stop("POST_COMMIT_VERIFICATION", `${postCommit.status}:${postCommit.reason_code}`, { destination, target, policy, admission, execution, post_commit: postCommit });
}
