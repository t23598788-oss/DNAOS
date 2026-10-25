/**
 * Public, host-neutral contract. This package intentionally defines neither a
 * capability registry nor a dependency/runtime resolver. The host remains the
 * only authority that can produce an authoritative Semantic Preflight.
 */
export type RuntimeEvidenceClassification = "VERIFIED_LIVE" | "CONFIGURED" | "SOURCE_REFERENCE" | "UNKNOWN";

export interface SemanticPreflightCapability {
  capabilityId: string;
  ownerModule: string;
  exportName: string;
  mutability: string;
  status: string;
  authority: "FROZEN_CAPABILITY_REGISTRY";
}

export interface SemanticPreflightDependency {
  ownerModule: string;
  dependent: string;
  target: string;
  kind: string;
  source: "auto-dependency-graph" | "infra-dependency-graph";
}

export interface SemanticPreflightRuntimeEvidence {
  classification: RuntimeEvidenceClassification;
  relationship: string;
  evidence: string;
}

export interface SemanticPreflight {
  status: "READY" | "UNKNOWN";
  capabilityAuthority: {
    registry: string;
    frozen: boolean;
    capabilities: SemanticPreflightCapability[];
  };
  dependencies: SemanticPreflightDependency[];
  runtimeEvidence: SemanticPreflightRuntimeEvidence[];
  authorityBoundaries: string[];
  constraints: string[];
  unknowns: string[];
  sourceFingerprint: string;
}

export interface SemanticPreflightRequest {
  workspaceSessionId: string;
  ownerId: string;
  actor: string;
  changedFiles?: readonly string[];
}

/** Host integration point. It must delegate to the host's existing Context
 * Planner authority; this package never resolves capabilities itself. */
export interface SemanticPreflightHostAdapter {
  prepareContextPlan(request: SemanticPreflightRequest): PromiseLike<{ semanticPreflight: SemanticPreflight }> | { semanticPreflight: SemanticPreflight };
}

export interface SemanticPreflightPackageResult {
  semanticPreflight: SemanticPreflight;
  input: {
    workspaceSessionId: string;
    changedFiles: string[];
  };
  authority: "HOST_CONTEXT_PLANNER";
}

export class SemanticPreflightPackageError extends Error {
  constructor(public readonly code: "INVALID_REQUEST" | "INVALID_HOST_RESULT", message: string) {
    super(message);
    this.name = "SemanticPreflightPackageError";
  }
}