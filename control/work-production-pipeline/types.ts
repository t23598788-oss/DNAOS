export const PIPELINE_SCHEMA = "DNA_OS_WORK_PRODUCTION_PIPELINE_V1" as const;

export const ARTIFACT_STATES = [
  "REQUESTED",
  "CONTEXT_RESOLVED",
  "AUTHORIZED_FOR_DEVELOPMENT",
  "IN_DEVELOPMENT",
  "AUTHORED",
  "ASSEMBLED",
  "BUILD_VERIFIED",
  "TEST_VERIFIED",
  "INTEGRATION_VERIFIED",
  "REVIEW_READY",
  "OWNER_REVIEW_REQUIRED",
  "APPROVED_FOR_PUBLISH",
  "PUBLISHED",
  "PROMOTION_READY",
  "DEPLOYMENT_READY",
  "DEPLOYED",
  "RUNTIME_VERIFYING",
  "RUNTIME_VERIFIED",
  "CAPABILITY_REGISTERED",
  "ACTIVE",
  "BLOCKED",
  "BLOCKED_INCOMPLETE",
  "FAILED",
  "ROLLED_BACK",
  "RETIRED",
] as const;

export type ArtifactState = typeof ARTIFACT_STATES[number];
export type WorkLane = "DEVELOPMENT_LANE" | "CAPABILITY_USAGE_LANE";
export type RiskClass = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
export type PromotionRemoteState = "LOCAL_ONLY" | "INTEGRATED" | "PUBLISHED_REMOTE" | "REMOTE_VERIFIED";
export type CleanupOutcomeStatus = "CLEANED" | "RETAINED_REQUIRED" | "BLOCKED";
export type GateDecision = "READY" | "NOT_READY" | "OWNER_APPROVAL_REQUIRED" | "BLOCKED";
export type RuntimeVerifyResult = "RUNTIME_VERIFIED" | "PARTIALLY_VERIFIED" | "FAILED" | "UNKNOWN";
export type AffectClass = "DIRECTLY_AFFECTED" | "TRANSITIVELY_AFFECTED" | "UNAFFECTED" | "UNKNOWN";

export const MEANINGFUL_NOTIFICATIONS = [
  "REVIEW_READY",
  "OWNER_APPROVAL_REQUIRED",
  "TEST_FAILED",
  "BUILD_FAILED",
  "DEPLOYMENT_FAILED",
  "RUNTIME_VERIFICATION_FAILED",
  "DEPLOYED",
  "RUNTIME_VERIFIED",
  "CAPABILITY_REGISTERED",
  "ROLLBACK_OCCURRED",
] as const;

export interface OwnerDevelopmentIntentV1 {
  readonly schema: "OWNER_DEVELOPMENT_INTENT_V1";
  readonly intent_id: string;
  readonly work_id: string;
  readonly owner_goal: string;
  readonly requested_change: string;
  readonly target_domain: string;
  readonly target_system: string;
  readonly target_repository: string;
  readonly known_resources: readonly string[];
  readonly known_capabilities: readonly string[];
  readonly affected_components: readonly string[];
  readonly risk_class: RiskClass;
  readonly required_evidence: readonly string[];
  readonly acceptance_criteria: readonly string[];
  readonly production_intent: boolean;
  readonly deployment_target: string | null;
  readonly authority_requirements: readonly string[];
}

export interface DeterministicCodeWorkOrderV1 {
  readonly schema: "DETERMINISTIC_CODE_WORK_ORDER_V1";
  readonly work_order_id: string;
  readonly work_id: string;
  readonly goal: string;
  readonly repository_id: string;
  readonly base_revision: string;
  readonly target_components: readonly string[];
  readonly target_files: readonly string[];
  readonly allowed_paths: readonly string[];
  readonly forbidden_paths: readonly string[];
  readonly related_interfaces: readonly string[];
  readonly related_schemas: readonly string[];
  readonly dependencies: readonly string[];
  readonly required_tests: readonly string[];
  readonly required_builds: readonly string[];
  readonly acceptance_criteria: readonly string[];
  readonly expected_outputs: readonly string[];
  readonly side_effect_policy: string;
  readonly production_policy: string;
  readonly evidence_requirements: readonly string[];
  readonly discovery_required: false;
}

export interface PipelineRecordV1 {
  readonly schema: typeof PIPELINE_SCHEMA;
  readonly work_id: string;
  readonly lane: WorkLane;
  readonly intent: OwnerDevelopmentIntentV1;
  readonly work_order: DeterministicCodeWorkOrderV1;
  readonly state: ArtifactState;
  readonly risk_class: RiskClass;
  readonly source_revision: string | null;
  readonly remote_sha: string | null;
  readonly promotion: PromotionRemoteState;
  readonly artifact_id: string | null;
  readonly deployment_id: string | null;
  readonly capability_id: string | null;
  readonly previous_verified_revision: string | null;
  readonly owner_enabled: boolean;
  readonly runtime_verified: boolean;
  readonly missing: readonly string[];
  readonly evidence: Record<string, unknown>;
  readonly metrics: Record<string, number>;
  readonly transitions: readonly Record<string, unknown>[];
  readonly lineage: Record<string, unknown>;
  readonly created_at: string;
  readonly updated_at: string;
}
