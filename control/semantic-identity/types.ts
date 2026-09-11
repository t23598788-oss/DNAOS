/**
 * Semantic Identity & Discovery V1 — typed vocabulary only.
 * Derived graph is NON_AUTHORITATIVE. Existing registries remain law.
 *
 * Bluetooth analogy (architecture only, not radio/GATT libraries):
 * TYPE ID → DISCOVERY → MATCH → RELATIONSHIP → OBSERVATION.
 */

export const SEMANTIC_IDENTITY_CONTRACT_ID = "dna-os/semantic-identity-v1" as const;
export const SEMANTIC_IDENTITY_CONTRACT_VERSION = "1.0.0" as const;

/** Closed identity kinds. */
export type SemanticKind =
  | "repository"
  | "capability"
  | "contract"
  | "policy"
  | "adapter"
  | "connection"
  | "credential"
  | "endpoint"
  | "executor"
  | "test"
  | "evidence";

/** Human-inspectable canonical ID string. */
export type SemanticId = string;

/** Finite relationship vocabulary V1. */
export type SemanticRelation =
  | "OWNS"
  | "IMPLEMENTS"
  | "DEPENDS_ON"
  | "REQUIRES"
  | "AUTHORIZED_BY"
  | "EXECUTED_BY"
  | "USES_CONNECTION"
  | "USES_CREDENTIAL"
  | "REACHABLE_AT"
  | "VERIFIED_BY"
  | "PROVEN_BY"
  | "SUPERSEDES";

/** Constructive lifecycle — not PASS/FAIL. */
export type SemanticLifecycleState =
  | "DISCOVERED"
  | "IDENTIFIED"
  | "CLASSIFIED"
  | "LINKED"
  | "RESOLVED"
  | "OBSERVED"
  | "VERIFIED"
  | "PROVEN"
  | "CANONICAL"
  | "UNRESOLVED"
  | "AWAITING_RELATION"
  | "AWAITING_RUNTIME_OBSERVATION"
  | "AWAITING_EVIDENCE";

/** Invariant violations only. */
export type SemanticInvariantError =
  | "BROKEN_REFERENCE"
  | "DUPLICATE_CANONICAL_ID"
  | "DEPENDENCY_CYCLE"
  | "CONFLICTING_AUTHORITY"
  | "INVALID_SEMANTIC_ID"
  | "MISSING_IMPLEMENTATION"
  | "MISSING_EDGE_SOURCE"
  | "MISSING_EDGE_TARGET";

export interface SemanticSourceRef {
  readonly repositoryId: SemanticId;
  readonly commitSha: string | null;
  readonly path: string;
  readonly symbol?: string;
}

export interface SemanticImplementationRef {
  readonly repositoryId: SemanticId;
  readonly path: string;
  readonly symbol?: string;
}

export interface SemanticDescriptor {
  readonly id: SemanticId;
  readonly kind: SemanticKind;
  readonly title?: string;
  readonly ownerRepository?: SemanticId;
  readonly implements?: readonly SemanticId[];
  readonly dependsOn?: readonly SemanticId[];
  readonly requires?: readonly SemanticId[];
  readonly authorizedBy?: readonly SemanticId[];
  readonly executedBy?: readonly SemanticId[];
  readonly usesConnection?: readonly SemanticId[];
  readonly usesCredential?: readonly SemanticId[];
  readonly reachableAt?: readonly SemanticId[];
  readonly verifiedBy?: readonly SemanticId[];
  readonly provenBy?: readonly SemanticId[];
  readonly supersedes?: readonly SemanticId[];
  readonly implementation?: SemanticImplementationRef;
  /** Pilot/static authority may mark CANONICAL; scanner never invents this from runtime. */
  readonly declaredCanonical?: boolean;
}

export interface SemanticEdge {
  readonly from: SemanticId;
  readonly relation: SemanticRelation;
  readonly to: SemanticId;
  readonly source: SemanticSourceRef;
}

export interface SemanticNode {
  readonly id: SemanticId;
  readonly kind: SemanticKind;
  readonly semantic_key: string;
  readonly title: string | null;
  readonly ownerRepository: SemanticId | null;
  readonly implementation: SemanticImplementationRef | null;
  readonly declaredCanonical: boolean;
  /** True only for discovery placeholders (missing edge endpoints). */
  readonly synthetic: boolean;
  readonly state: SemanticLifecycleState;
  readonly source: SemanticSourceRef;
}

export interface SemanticObservation {
  readonly semantic_id: SemanticId;
  readonly observed_at: string;
  readonly occurrence_id: string | null;
  readonly kind: "STATIC" | "RUNTIME" | "TEST" | "EVIDENCE" | "AUTHORITY";
  readonly note: string;
}

export interface SemanticGraph {
  readonly nodes: readonly SemanticNode[];
  readonly edges: readonly SemanticEdge[];
  readonly source_revision: string | null;
  readonly derived: true;
  readonly authoritative: false;
}

/** Derived evidence from discovery — not a registry, not durable authority. */
export interface SemanticDiagnostic {
  readonly code: SemanticInvariantError;
  readonly message: string;
  readonly raw?: string;
  readonly field?: string;
  readonly relation?: SemanticRelation;
  readonly descriptor_id?: string;
  readonly edge_from?: string;
  readonly edge_to?: string;
  readonly path?: string;
}

export interface SemanticDiscoveryDiagnostics {
  readonly duplicate_ids: readonly SemanticId[];
  readonly invalid_ids: readonly SemanticDiagnostic[];
  readonly missing_sources: readonly SemanticId[];
  readonly missing_targets: readonly SemanticId[];
  readonly unresolved_references: readonly SemanticId[];
  readonly invalid_implementations: readonly SemanticDiagnostic[];
}

export interface SemanticDiscoveryResult {
  readonly graph: SemanticGraph;
  readonly diagnostics: SemanticDiscoveryDiagnostics;
}

export interface SemanticDoctorReport {
  readonly nodes: number;
  readonly edges: number;
  readonly by_state: Readonly<Record<string, number>>;
  readonly awaiting_relation: number;
  readonly duplicate_semantic_ids: number;
  readonly duplicate_ids: readonly SemanticId[];
  readonly invalid_ids: readonly SemanticDiagnostic[];
  readonly missing_sources: readonly SemanticId[];
  readonly missing_targets: readonly SemanticId[];
  readonly unresolved_references: readonly SemanticId[];
  readonly invalid_implementations: readonly SemanticDiagnostic[];
  readonly dependency_cycles: number;
  readonly conflicting_authority: number;
  readonly cycle_samples: readonly string[];
  readonly source_revision: string | null;
  readonly healthy: boolean;
}

export interface ParsedSemanticId {
  readonly scheme: SemanticKind;
  readonly namespace: string;
  readonly name: string;
  readonly version: string | null;
  readonly canonical: SemanticId;
}
