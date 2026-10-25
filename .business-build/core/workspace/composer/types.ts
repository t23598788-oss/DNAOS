// Capability Composer Foundation (Phase 7.5) — pure planning types. Zero
// runtime dependency: no import here can execute anything, only describe a
// plan. This is deliberately a separate system from core/workspace/application.ts
// (Phase 5's ApplicationDefinition/PresenterId, which already powers the
// live /workspace-preview/apps/[appId] pages) — that system's PresenterId is
// a closed union of 8 known names, incompatible with the free-form
// CapabilityId format the Registry uses. Not merged here; that's a future,
// separate integration decision, not something to guess at now.

export type ValidationIssueType =
  | "MissingCapability"
  | "DuplicateCapability"
  | "CircularDependency"
  | "VersionConflict"
  | "MissingDependency"
  | "InvalidContract";

export interface ValidationIssue {
  type: ValidationIssueType;
  capabilityId: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

// What a caller asks the Composer to assemble. requestedCapabilityIds is
// what was explicitly asked for; the Composer expands this with transitive
// dependencies to produce the full plan.
export interface CompositionRequest {
  applicationId: string;
  workspaceId: string;
  requestedCapabilityIds: string[];
}

export interface CompositionPlan {
  applicationId: string;
  workspaceId: string;
  requestedCapabilityIds: string[];
  capabilityIds: string[]; // full resolved set: requested + transitive dependencies
  dependencyGraph: Record<string, string[]>; // capabilityId -> its direct Dependencies, resolved-set only
  executionOrder: string[]; // topologically sorted, dependencies before dependents
  validationResult: ValidationResult;
  metadata: {
    generatedAt: string;
    registryVersion: string;
    registryChecksum: string;
  };
}