/**
 * หน้าที่: the public boundary of `control/deployable-artifact-readiness/`
 * — the only file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: `runDeployableArtifactReadiness`, `discoverProjectRuntime`,
 * `resolveBuildRequirement`, `decideReadiness`, plus every type a caller
 * needs.
 * Dependency ที่อนุญาต: ./resolver.ts, ./runtime-discovery.ts,
 * ./build-requirement-resolution.ts, ./decision.ts, ./types.ts.
 */

export { runDeployableArtifactReadiness } from "./resolver";
export { discoverProjectRuntime, provesNodeTypescriptBuildNotRequired } from "./runtime-discovery";
export { resolveBuildRequirement } from "./build-requirement-resolution";
export { deriveArtifactExpectation, discoverArtifact, isCacheOrTempPath } from "./artifact-discovery";
export type { ArtifactExpectation } from "./artifact-discovery";
export { validateArtifact } from "./artifact-validation";
export { decideReadiness } from "./decision";
export type {
  RuntimeDiscoveryResult,
  BuildRequirement,
  BuildRequirementStatus,
  BuildResult,
  BuildExecutionStatus,
  ArtifactDescriptor,
  ArtifactValidationResult,
  ReadinessStatus,
  ReadinessReasonCode,
  DeployableArtifactReadinessInput,
  DeployableArtifactReadinessResult,
} from "./types";
