import type {
  SemanticPreflight,
  SemanticPreflightHostAdapter,
  SemanticPreflightPackageResult,
  SemanticPreflightRequest,
} from "./types.js";
import { SemanticPreflightPackageError } from "./types.js";

export * from "./types.js";

const EVIDENCE_CLASSIFICATIONS = new Set(["VERIFIED_LIVE", "CONFIGURED", "SOURCE_REFERENCE", "UNKNOWN"]);

function assertRequest(request: SemanticPreflightRequest): void {
  if (!request.workspaceSessionId || !request.ownerId || !request.actor) {
    throw new SemanticPreflightPackageError("INVALID_REQUEST", "workspaceSessionId, ownerId, and actor are required; the package does not mint identity.");
  }
  if (request.changedFiles && request.changedFiles.some((file) => typeof file !== "string")) {
    throw new SemanticPreflightPackageError("INVALID_REQUEST", "changedFiles must contain only strings.");
  }
}

function assertHostPreflight(value: SemanticPreflight | undefined): asserts value is SemanticPreflight {
  if (!value || (value.status !== "READY" && value.status !== "UNKNOWN")) {
    throw new SemanticPreflightPackageError("INVALID_HOST_RESULT", "host Context Planner did not return a valid Semantic Preflight status.");
  }
  if (!value.capabilityAuthority?.registry || typeof value.capabilityAuthority.frozen !== "boolean" || !Array.isArray(value.capabilityAuthority.capabilities)) {
    throw new SemanticPreflightPackageError("INVALID_HOST_RESULT", "host Semantic Preflight is missing capability authority metadata.");
  }
  if (!Array.isArray(value.dependencies) || !Array.isArray(value.runtimeEvidence) || !Array.isArray(value.authorityBoundaries) || !Array.isArray(value.constraints) || !Array.isArray(value.unknowns) || !value.sourceFingerprint) {
    throw new SemanticPreflightPackageError("INVALID_HOST_RESULT", "host Semantic Preflight is missing required evidence, boundary, constraint, unknown, or fingerprint fields.");
  }
  if (value.runtimeEvidence.some((evidence) => !EVIDENCE_CLASSIFICATIONS.has(evidence.classification))) {
    throw new SemanticPreflightPackageError("INVALID_HOST_RESULT", "host Semantic Preflight contains a runtime evidence classification outside the public contract.");
  }
  if (value.status === "UNKNOWN" && value.unknowns.length === 0) {
    throw new SemanticPreflightPackageError("INVALID_HOST_RESULT", "UNKNOWN status must include an explicit unknown reason; the package never infers one.");
  }
}

/**
 * Delegates all authority-sensitive work to the caller's existing Context
 * Planner, validates its public contract, and returns the exact preflight.
 * It never scans source, reads a registry/map, invokes connectors, persists
 * data, or broadens requested scope.
 */
export async function prepareSemanticPreflight(
  adapter: SemanticPreflightHostAdapter,
  request: SemanticPreflightRequest,
): Promise<SemanticPreflightPackageResult> {
  assertRequest(request);
  const plan = await adapter.prepareContextPlan({ ...request, changedFiles: request.changedFiles ? [...request.changedFiles] : [] });
  assertHostPreflight(plan?.semanticPreflight);
  return {
    semanticPreflight: plan.semanticPreflight,
    input: { workspaceSessionId: request.workspaceSessionId, changedFiles: request.changedFiles ? [...request.changedFiles] : [] },
    authority: "HOST_CONTEXT_PLANNER",
  };
}