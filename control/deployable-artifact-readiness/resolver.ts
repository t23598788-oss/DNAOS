/**
 * หน้าที่: `runDeployableArtifactReadiness()` — the one real entry point:
 *
 * VERIFIED COMMIT -> PROJECT/RUNTIME DISCOVERY -> BUILD REQUIREMENT
 *   RESOLUTION -> BUILD EXECUTION -> ARTIFACT DISCOVERY -> ARTIFACT
 *   VALIDATION -> READY | FAILED | UNRESOLVED | BUILD_NOT_REQUIRED -> STOP
 *
 * Same commit-provenance discipline as
 * `control/post-commit-verification/resolver.ts`: the commit_sha must
 * trace back to a real, persisted, SUCCEEDED `execution_output` Evidence
 * row for this exact `artifact_resource_id` before anything else runs —
 * never trusting a caller's bare claim.
 *
 * Idempotency: an already-persisted `deployable_artifact_readiness`
 * Evidence row for the SAME (task_id, commit_sha, artifact_resource_id)
 * is replayed as-is — no build/discovery/validation is ever re-run.
 *
 * Input: `DeployableArtifactReadinessInput`, an optional repo root
 * (defaults to `process.cwd()`).
 * Output: `runDeployableArtifactReadiness` -> `DeployableArtifactReadinessResult`
 * (also persisted as Evidence: kind="runtime_discovery",
 * kind="build_execution" (only when a build actually ran),
 * kind="deployable_artifact_readiness" for the final result).
 * Dependency ที่อนุญาต: ../agent-gateway/contract.ts, ./runtime-discovery.ts,
 * ./build-requirement-resolution.ts, ./run-build.ts, ./artifact-discovery.ts,
 * ./artifact-validation.ts, ./decision.ts, ./host-runtime.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never call classifyCandidate/resolveDuplicate/
 * resolveArtifactDestination/resolveTarget/resolvePolicy/evaluateAdmission/
 * executeSource/runPostCommitVerification here. Never select a cloud
 * provider, never call Vercel, never deploy anything.
 */

import { loadEvidenceForTask, saveEvidence } from "../agent-gateway/contract";
import { discoverProjectRuntime } from "./runtime-discovery";
import { resolveBuildRequirement } from "./build-requirement-resolution";
import { runBuildCommand } from "./run-build";
import { deriveArtifactExpectation, discoverArtifact } from "./artifact-discovery";
import { validateArtifact } from "./artifact-validation";
import { decideReadiness } from "./decision";
import { newReadinessId, nowIso } from "./host-runtime";
import type { ArtifactDescriptor, ArtifactValidationResult, BuildRequirement, BuildResult, DeployableArtifactReadinessInput, DeployableArtifactReadinessResult, ReadinessReasonCode, ReadinessStatus, RuntimeDiscoveryResult } from "./types";

const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

function finalize(
  input: DeployableArtifactReadinessInput,
  status: ReadinessStatus,
  reason_code: ReadinessReasonCode,
  runtimeDiscovery: RuntimeDiscoveryResult,
  buildRequirement: BuildRequirement | null,
  buildResult: BuildResult | null,
  artifact: ArtifactDescriptor | null,
  artifactValidation: ArtifactValidationResult | null,
): DeployableArtifactReadinessResult {
  const result: DeployableArtifactReadinessResult = {
    readiness_id: newReadinessId(),
    commit_sha: input.commit_sha,
    artifact_resource_id: input.artifact_resource_id,
    runtime_discovery: runtimeDiscovery,
    build_requirement: buildRequirement,
    build_result: buildResult,
    artifact,
    artifact_validation: artifactValidation,
    status,
    reason_code,
    evidence_refs: input.evidence_refs,
    correlation_id: input.correlation_id,
    created_at: nowIso(),
  };
  saveEvidence({ evidence_id: result.readiness_id, task_id: input.task_id, kind: "deployable_artifact_readiness", source: "control/deployable-artifact-readiness/resolver.ts", recorded_at: result.created_at, payload: result });
  return result;
}

export async function runDeployableArtifactReadiness(input: DeployableArtifactReadinessInput, repoRoot: string = process.cwd()): Promise<DeployableArtifactReadinessResult> {
  // Idempotency.
  const priorEvidence = loadEvidenceForTask(input.task_id).find((e) => {
    if (e.kind !== "deployable_artifact_readiness") return false;
    const payload = e.payload as DeployableArtifactReadinessResult;
    return payload.commit_sha === input.commit_sha && payload.artifact_resource_id === input.artifact_resource_id;
  });
  if (priorEvidence) return priorEvidence.payload as DeployableArtifactReadinessResult;

  const emptyRuntime: RuntimeDiscoveryResult = { status: "UNRESOLVED", reason_code: "RUNTIME_NOT_RESOLVED", languages: [], runtimes: [], frameworks: [], package_managers: [], build_systems: [], evidence_refs: [] };

  if (!COMMIT_SHA_PATTERN.test(input.commit_sha)) {
    return finalize(input, "UNRESOLVED", "INVALID_COMMIT_SHA", emptyRuntime, null, null, null, null);
  }

  const sourceExecutionEvidence = loadEvidenceForTask(input.task_id).find((e) => {
    if (e.kind !== "execution_output") return false;
    const payload = e.payload as { commit_sha: string | null; artifact_resource_id: string; execution_status: string };
    return payload.commit_sha === input.commit_sha && payload.artifact_resource_id === input.artifact_resource_id && payload.execution_status === "SUCCEEDED";
  });
  if (!sourceExecutionEvidence) {
    return finalize(input, "UNRESOLVED", "COMMIT_NOT_FOUND_FOR_ARTIFACT", emptyRuntime, null, null, null, null);
  }

  // Also require the commit to have actually passed Post-Commit Verification (VERIFIED) — this stage's own STEP names its predecessor explicitly as "VERIFIED COMMIT".
  const postCommitEvidence = loadEvidenceForTask(input.task_id).find((e) => {
    if (e.kind !== "post_commit_verification") return false;
    const payload = e.payload as { commit_sha: string; artifact_resource_id: string; status: string };
    return payload.commit_sha === input.commit_sha && payload.artifact_resource_id === input.artifact_resource_id && payload.status === "VERIFIED";
  });
  if (!postCommitEvidence) {
    return finalize(input, "UNRESOLVED", "COMMIT_NOT_FOUND_FOR_ARTIFACT", emptyRuntime, null, null, null, null);
  }

  // 1. PROJECT/RUNTIME DISCOVERY.
  const runtimeDiscovery = discoverProjectRuntime(repoRoot);
  saveEvidence({ evidence_id: `runtime-discovery-${input.correlation_id}`, task_id: input.task_id, kind: "runtime_discovery", source: "control/deployable-artifact-readiness/runtime-discovery.ts", recorded_at: nowIso(), payload: runtimeDiscovery });
  if (runtimeDiscovery.status === "UNRESOLVED") {
    return finalize(input, "UNRESOLVED", "RUNTIME_NOT_RESOLVED", runtimeDiscovery, null, null, null, null);
  }

  // 2. BUILD REQUIREMENT RESOLUTION.
  const buildRequirement = resolveBuildRequirement(repoRoot, runtimeDiscovery);
  if (buildRequirement.status === "UNRESOLVED") {
    return finalize(input, "UNRESOLVED", "UNRESOLVED_BUILD_REQUIREMENT", runtimeDiscovery, buildRequirement, null, null, null);
  }
  if (buildRequirement.status === "NOT_REQUIRED") {
    return finalize(input, "BUILD_NOT_REQUIRED", "BUILD_NOT_REQUIRED", runtimeDiscovery, buildRequirement, null, null, null);
  }

  // 3. BUILD EXECUTION.
  const buildResult = await runBuildCommand(buildRequirement, input.commit_sha, input.correlation_id, {
    saveBuildEvidence: (result, requirement, correlationId) => {
      const evidenceId = result.build_id;
      saveEvidence({ evidence_id: evidenceId, task_id: input.task_id, kind: "build_execution", source: "control/deployable-artifact-readiness/run-build.ts", recorded_at: nowIso(), payload: { ...result, requirement, correlation_id: correlationId } });
      return evidenceId;
    },
  });
  if (buildResult.status !== "PASSED") {
    const decisionAfterBuild = decideReadiness(runtimeDiscovery, buildRequirement, buildResult, null, null);
    return finalize(input, decisionAfterBuild.status, decisionAfterBuild.reason_code, runtimeDiscovery, buildRequirement, buildResult, null, null);
  }

  // 4. ARTIFACT DISCOVERY (only after a real PASSED build).
  const expectation = deriveArtifactExpectation(repoRoot, runtimeDiscovery);
  if (!expectation) {
    return finalize(input, "FAILED", "ARTIFACT_NOT_FOUND", runtimeDiscovery, buildRequirement, buildResult, null, null);
  }
  const artifact = discoverArtifact(repoRoot, expectation, input.commit_sha);
  if (!artifact) {
    return finalize(input, "FAILED", "ARTIFACT_NOT_FOUND", runtimeDiscovery, buildRequirement, buildResult, null, null);
  }

  // 5. ARTIFACT VALIDATION.
  const artifactValidation = validateArtifact(artifact, repoRoot, input.commit_sha, expectation);
  const finalDecision = decideReadiness(runtimeDiscovery, buildRequirement, buildResult, artifact, artifactValidation);
  return finalize(input, finalDecision.status, finalDecision.reason_code, runtimeDiscovery, buildRequirement, buildResult, artifact, artifactValidation);
}
