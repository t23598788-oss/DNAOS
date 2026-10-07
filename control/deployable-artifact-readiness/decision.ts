/**
 * หน้าที่: FINAL DECISION — the ONE pure combinator turning
 * runtime-discovery + build-requirement + build-result +
 * artifact-validation into the final `ReadinessStatus`. No I/O, no
 * default-to-READY path.
 *
 * Rule (checked in order):
 *   1. runtime UNRESOLVED -> UNRESOLVED/RUNTIME_NOT_RESOLVED.
 *   2. build requirement UNRESOLVED -> UNRESOLVED/UNRESOLVED_BUILD_REQUIREMENT.
 *   3. build requirement NOT_REQUIRED (proven) -> BUILD_NOT_REQUIRED
 *      (terminal — never proceeds to artifact discovery/validation).
 *   4. build REQUIRED but build result missing/UNRESOLVED -> UNRESOLVED/BUILD_UNRESOLVED.
 *   5. build result FAILED -> FAILED/BUILD_FAILED.
 *   6. build result PASSED but no artifact discovered -> FAILED/ARTIFACT_NOT_FOUND.
 *   7. build result PASSED, artifact discovered but validation.ok===false -> FAILED/ARTIFACT_INVALID.
 *   8. build result PASSED, artifact discovered, validation.ok===true -> READY.
 *
 * Input: the real `RuntimeDiscoveryResult`, `BuildRequirement`,
 * `BuildResult | null`, `ArtifactDescriptor | null`,
 * `ArtifactValidationResult | null`.
 * Output: `decideReadiness` -> `{status, reason_code}`.
 * Dependency ที่อนุญาต: ./types.ts.
 * สิ่งที่ห้ามแตะ: never return READY unless a real build PASSED and a
 * real artifact both exist and validated ok===true.
 */

import type { ArtifactDescriptor, ArtifactValidationResult, BuildRequirement, BuildResult, ReadinessReasonCode, ReadinessStatus, RuntimeDiscoveryResult } from "./types";

export function decideReadiness(
  runtimeDiscovery: RuntimeDiscoveryResult,
  buildRequirement: BuildRequirement,
  buildResult: BuildResult | null,
  artifact: ArtifactDescriptor | null,
  artifactValidation: ArtifactValidationResult | null,
): { status: ReadinessStatus; reason_code: ReadinessReasonCode } {
  if (runtimeDiscovery.status === "UNRESOLVED") {
    return { status: "UNRESOLVED", reason_code: "RUNTIME_NOT_RESOLVED" };
  }
  if (buildRequirement.status === "UNRESOLVED") {
    return { status: "UNRESOLVED", reason_code: "UNRESOLVED_BUILD_REQUIREMENT" };
  }
  if (buildRequirement.status === "NOT_REQUIRED") {
    return { status: "BUILD_NOT_REQUIRED", reason_code: "BUILD_NOT_REQUIRED" };
  }
  // buildRequirement.status === "REQUIRED" from here on.
  if (!buildResult || buildResult.status === "UNRESOLVED") {
    return { status: "UNRESOLVED", reason_code: "BUILD_UNRESOLVED" };
  }
  if (buildResult.status === "FAILED") {
    return { status: "FAILED", reason_code: "BUILD_FAILED" };
  }
  // buildResult.status === "PASSED" from here on.
  if (!artifact) {
    return { status: "FAILED", reason_code: "ARTIFACT_NOT_FOUND" };
  }
  if (!artifactValidation || !artifactValidation.ok) {
    return { status: "FAILED", reason_code: "ARTIFACT_INVALID" };
  }
  return { status: "READY", reason_code: "READY" };
}
