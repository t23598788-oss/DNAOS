/**
 * หน้าที่: the type contracts for Deployable Artifact Readiness — the
 * layer strictly after Post-Commit Verification:
 *
 * VERIFIED COMMIT -> PROJECT/RUNTIME DISCOVERY -> BUILD REQUIREMENT
 *   RESOLUTION -> BUILD EXECUTION -> ARTIFACT DISCOVERY -> ARTIFACT
 *   VALIDATION -> READY | FAILED | UNRESOLVED | BUILD_NOT_REQUIRED -> STOP
 *
 * Answers exactly one question: "does this already-VERIFIED commit have
 * a real, deployable artifact ready to hand to a (not-yet-built)
 * Deployment Pipeline?" No cloud provider, no Vercel, no deploy.
 *
 * Input: none (pure type definitions).
 * Output: `Language`, `RuntimeDiscoveryResult`, `BuildRequirement`,
 * `BuildResult`, `ArtifactDescriptor`, `ArtifactValidationResult`,
 * `ReadinessStatus`, `ReadinessReasonCode`,
 * `DeployableArtifactReadinessInput`, `DeployableArtifactReadinessResult`.
 * Dependency ที่อนุญาต: none.
 */

export interface RuntimeDiscoveryResult {
  status: "RESOLVED" | "UNRESOLVED";
  reason_code: "RUNTIME_RESOLVED" | "RUNTIME_NOT_RESOLVED";
  languages: readonly string[];
  runtimes: readonly string[];
  frameworks: readonly string[];
  package_managers: readonly string[];
  build_systems: readonly string[];
  evidence_refs: readonly string[];
}

export type BuildRequirementStatus = "REQUIRED" | "NOT_REQUIRED" | "UNRESOLVED";

export interface BuildRequirement {
  status: BuildRequirementStatus;
  reason_code: "BUILD_COMMAND_RESOLVED" | "BUILD_NOT_REQUIRED_PROVEN" | "UNRESOLVED_BUILD_REQUIREMENT";
  command_id: string | null;
  command_reference: string | null;
  command_source: string | null;
  evidence_refs: readonly string[];
}

export type BuildExecutionStatus = "PASSED" | "FAILED" | "UNRESOLVED";

export interface BuildResult {
  build_id: string;
  commit_sha: string;
  command_reference: string;
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
  status: BuildExecutionStatus;
  evidence_ref: string;
}

export interface ArtifactDescriptor {
  artifact_id: string;
  artifact_type: string;
  artifact_path: string;
  content_hash: string;
  size_bytes: number;
  source_commit_sha: string;
  runtime: string | null;
  framework: string | null;
  evidence_refs: readonly string[];
}

export interface ArtifactValidationResult {
  exists: boolean;
  non_empty: boolean;
  matches_commit: boolean;
  type_matches_runtime: boolean;
  required_files_complete: boolean;
  no_path_escape: boolean;
  not_cache_or_temp: boolean;
  ok: boolean;
  reason_codes: readonly string[];
}

export type ReadinessStatus = "READY" | "FAILED" | "UNRESOLVED" | "BUILD_NOT_REQUIRED";

export type ReadinessReasonCode =
  | "READY"
  | "RUNTIME_NOT_RESOLVED"
  | "UNRESOLVED_BUILD_REQUIREMENT"
  | "BUILD_NOT_REQUIRED"
  | "BUILD_FAILED"
  | "BUILD_UNRESOLVED"
  | "ARTIFACT_NOT_FOUND"
  | "ARTIFACT_INVALID"
  | "INVALID_COMMIT_SHA"
  | "COMMIT_NOT_FOUND_FOR_ARTIFACT";

export interface DeployableArtifactReadinessInput {
  artifact_resource_id: string;
  task_id: string;
  commit_sha: string;
  repository_reference: { owner: string; repo: string; branch: string };
  branch: string;
  source_path: string;
  correlation_id: string;
  evidence_refs: readonly string[];
}

export interface DeployableArtifactReadinessResult {
  readiness_id: string;
  commit_sha: string;
  artifact_resource_id: string;
  runtime_discovery: RuntimeDiscoveryResult;
  build_requirement: BuildRequirement | null;
  build_result: BuildResult | null;
  artifact: ArtifactDescriptor | null;
  artifact_validation: ArtifactValidationResult | null;
  status: ReadinessStatus;
  reason_code: ReadinessReasonCode;
  evidence_refs: readonly string[];
  correlation_id: string;
  created_at: string;
}
