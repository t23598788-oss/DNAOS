// Execution Plan Generator (Phase 7.6) — pure planning types. An
// ExecutionPlan describes WHICH order capabilities could run in and how
// they group into dependency-free stages — it never runs anything, creates
// no objects from Capabilities, injects no dependencies. Purely descriptive
// data derived from an already-validated CompositionPlan.

export type ExecutionValidationIssueType =
  | "DuplicateStage"
  | "MissingCapability"
  | "UnresolvedDependency"
  | "DuplicateExecution"
  | "NotFrozen";

export interface ExecutionValidationIssue {
  type: ExecutionValidationIssueType;
  capabilityId: string;
  message: string;
}

export interface ExecutionValidationResult {
  valid: boolean;
  issues: ExecutionValidationIssue[];
}

export interface ExecutionPlan {
  executionId: string;
  applicationId: string;
  workspaceId: string;
  orderedCapabilities: string[]; // flat order, stage 0 first, deterministic within each stage
  executionStages: string[][]; // stage[0] = capabilities with no unresolved dependency, stage[N] = depends only on stage 0..N-1
  dependencyLevels: Record<string, number>; // capabilityId -> its stage index
  validationResult: ExecutionValidationResult;
  metadata: {
    generatedAt: string;
    registryVersion: string;
    registryChecksum: string;
    sourceCompositionValid: boolean;
  };
}