/**
 * หน้าที่: type contracts for the External System Lifecycle — the single
 * canonical pipeline for every Model / Model Family / Provider / External
 * System / capability, DISCOVER through COMPLETE. Never provider-specific
 * — a GitHub connector, a macOS credential provider, and a future AI
 * model all pass through the exact same 16 stages here; only the
 * evidence each stage is fed differs.
 *
 * Input: none (pure type definitions).
 * Output: `LifecycleStage`, `LifecycleStageStatus`, `LifecycleEvent`,
 * `LifecycleRun`, `ExternalSystemLifecycleInput`,
 * `ExternalSystemLifecycleResult`.
 * Dependency ที่อนุญาต: ../event-pipeline/contract.ts (RegistrationCandidate,
 * CandidateRelationship types only), ../integration-verification/contract.ts,
 * ../runtime-verification/contract.ts (types only), ./delivery-classification.ts (types only).
 * สิ่งที่ห้ามแตะ: never add a field that lets a caller set `status` or
 * `current_stage` directly on a `LifecycleRun` — both are always
 * recomputed by replaying `./store.ts`'s real, persisted event log, never
 * held only in memory.
 */

export type LifecycleStage =
  | "DISCOVER"
  | "CLASSIFY"
  | "DUPLICATE_CHECK"
  | "BOUNDARY_REPO_DECISION"
  | "BUILD"
  | "TEST"
  | "VERIFY"
  | "REGISTRATION_PIPELINE"
  | "REGISTRY_WRITER"
  | "RELATIONSHIP"
  | "INTEGRATION"
  | "TARGET_RESOLUTION"
  | "PERMISSION_ADMISSION"
  | "DEPLOY_INSTALL"
  | "RUNTIME_VERIFY"
  | "COMPLETE";

export type LifecycleStageStatus = "PASSED" | "FAILED" | "BLOCKED" | "UNRESOLVED" | "NOT_APPLICABLE";

/** The external-system pipeline has 15 operational stages and one terminal state. COMPLETE is never counted as an operational stage. */
export const EXTERNAL_OPERATIONAL_STAGES: readonly Exclude<LifecycleStage, "COMPLETE">[] = [
  "DISCOVER", "CLASSIFY", "DUPLICATE_CHECK", "BOUNDARY_REPO_DECISION", "BUILD", "TEST", "VERIFY",
  "REGISTRATION_PIPELINE", "REGISTRY_WRITER", "RELATIONSHIP", "INTEGRATION", "TARGET_RESOLUTION",
  "PERMISSION_ADMISSION", "DEPLOY_INSTALL", "RUNTIME_VERIFY",
];

/** Explicit reconciliation: architecture governance is a 14-entry index; external registration is a 15-stage operational pipeline. */
export const CANONICAL_LIFECYCLE_MAPPING: Readonly<Record<Exclude<LifecycleStage, "COMPLETE">, readonly string[]>> = {
  DISCOVER: ["connection-census", "target-identity-discovery"],
  CLASSIFY: ["semantic-contract-discovery"],
  DUPLICATE_CHECK: ["capability-folder-law", "capability-catalog-dry-run"],
  BOUNDARY_REPO_DECISION: ["capability-repository-lineage", "cross-system-instance-registry"],
  BUILD: ["vercel-boundary"],
  TEST: ["operational-lifecycle-model"],
  VERIFY: ["operational-lifecycle-model"],
  REGISTRATION_PIPELINE: ["capability-catalog-dry-run"],
  REGISTRY_WRITER: ["capability-catalog-projection"],
  RELATIONSHIP: ["cross-system-instance-registry"],
  INTEGRATION: ["connection-contract"],
  TARGET_RESOLUTION: ["target-identity-discovery"],
  PERMISSION_ADMISSION: ["vercel-boundary"],
  DEPLOY_INSTALL: ["vercel-boundary"],
  RUNTIME_VERIFY: ["operational-lifecycle-model"],
};

/** One real, append-only event — the persistent source of truth `./store.ts` writes and replays. Never mutated after being written. */
export interface LifecycleEvent {
  event_id: string;
  candidate_id: string;
  stage: LifecycleStage;
  status: LifecycleStageStatus;
  reason: string;
  evidence_ref: string | null;
  occurred_at: string;
  correlation_id: string;
}

/** Rebuilt entirely by replaying `LifecycleEvent`s for one candidate_id — never a caller-supplied or in-memory-only value. */
export interface LifecycleRun {
  candidate_id: string;
  events: readonly LifecycleEvent[];
  current_stage: LifecycleStage | null;
  current_status: LifecycleStageStatus | null;
  is_complete: boolean;
}

/** Relationship the caller wants bound during the RELATIONSHIP stage — reuses control/registration-update's own vocabulary, never invents a new one. Always binds FROM the named consumer TO this run's own new capability (the only direction any real relationship in this repo has needed so far — see credentials/macos-keychain's registration). */
export interface LifecycleRelationshipRequest {
  consumer_canonical_name: string;
  to_type: string;
  relationship_kind: string;
}

export interface ExternalSystemLifecycleInput {
  /** Passed through verbatim to control/registration-pipeline/ — this stage never re-derives it. */
  candidate: import("../event-pipeline/contract").RegistrationCandidate;
  /** Consumers to bind a relationship to during RELATIONSHIP, each already-registered by canonical_name. */
  relationships: readonly LifecycleRelationshipRequest[];
  /** Proofs Integration Verification re-checks independently — see control/integration-verification/types.ts. */
  integration_proofs: readonly import("../integration-verification/contract").ConsumerRelationshipProof[];
  /** Routing input only for this orchestrator's own DEPLOY_INSTALL branch — see ./delivery-classification.ts's header for why this is not control/target-resolution's job. */
  delivery_target_evidence: import("./delivery-classification").DeliveryTargetEvidence;
  /** Required for RUNTIME_VERIFY — a real, caller-produced probe evidence file. */
  runtime_evidence_ref?: string;
  correlation_id: string;
}

export interface ExternalSystemLifecycleResult {
  candidate_id: string;
  resource_id: string | null;
  capability_id: string | null;
  final_stage: LifecycleStage;
  final_status: LifecycleStageStatus;
  is_complete: boolean;
  run: LifecycleRun;
}
