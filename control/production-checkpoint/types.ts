export const PRODUCTION_CHECKPOINT_RECONCILIATION = "PRODUCTION_CHECKPOINT_RECONCILIATION_V1" as const;
export const PRODUCTION_CHECKPOINT = "PRODUCTION_CHECKPOINT_V1" as const;
export const CONTINUOUS_PRODUCTION_RECONCILER = "CONTINUOUS_PRODUCTION_RECONCILER_V1" as const;
export const WORK_COMPLETION_READINESS = "WORK_COMPLETION_READINESS_V1" as const;
export const PRODUCTION_CHECKPOINT_STALENESS = "PRODUCTION_CHECKPOINT_STALENESS_V1" as const;
export const WORK_COMPLETION_REPORT = "WORK_COMPLETION_REPORT_V1" as const;
export const OWNER_WORK_COMPLETION_NOTIFICATION = "OWNER_WORK_COMPLETION_NOTIFICATION_V1" as const;
export const PRODUCTION_ADMISSION_AND_LINEAGE_CLOSURE = "PRODUCTION_ADMISSION_AND_LINEAGE_CLOSURE_V1" as const;
export const SOURCE_LINEAGE_CLOSURE = "SOURCE_LINEAGE_CLOSURE_V1" as const;
export const PRODUCTION_ADMISSION_READINESS = "PRODUCTION_ADMISSION_READINESS_V1" as const;
export const WORK_STATE_FINALIZATION = "WORK_STATE_FINALIZATION_V1" as const;
export const OWNER_PRODUCTION_READINESS_SUMMARY = "OWNER_PRODUCTION_READINESS_SUMMARY_V1" as const;

export const WORK_CLASSIFICATIONS = [
  "READY_FOR_ADMISSION",
  "WAITING_FOR_MACHINE_VERIFICATION",
  "WAITING_FOR_INTEGRATION",
  "WAITING_FOR_CANONICAL_COMMIT",
  "WAITING_FOR_PUBLISH",
  "WAITING_FOR_DEPLOYMENT",
  "WAITING_FOR_RUNTIME_VERIFY",
  "WAITING_FOR_OWNER_ENABLE",
  "BLOCKED_BY_FAILURE",
  "NOT_PRODUCTION_BOUND",
  "UNREGISTERED_ACTIVITY",
] as const;
export type WorkClassification = typeof WORK_CLASSIFICATIONS[number];

export const ACTIVITY_CLASSES = ["ACTIVE", "WAITING", "STALE", "BLOCKED", "READY_FOR_ADMISSION"] as const;
export type ActivityClass = typeof ACTIVITY_CLASSES[number];

export const LINEAGE_STATUSES = [
  "ALIGNED",
  "DIVERGED_AT_WORKSPACE",
  "DIVERGED_AT_CANONICAL",
  "DIVERGED_AT_REMOTE",
  "DIVERGED_AT_DEPLOYMENT",
  "DIVERGED_AT_RUNTIME",
  "NOT_AVAILABLE",
] as const;
export type LineageStatus = typeof LINEAGE_STATUSES[number];

export const FINALIZATION_STATES = ["SUPERSEDED", "COMPLETED", "ABANDONED", "BLOCKED"] as const;
export type FinalizationState = typeof FINALIZATION_STATES[number];

export const CHECKPOINT_TYPES = [
  "WORK_CREATED",
  "WORK_ACCEPTED",
  "IMPLEMENTING",
  "BUILD_VERIFIED",
  "TEST_VERIFIED",
  "REVIEW_READY",
  "OWNER_APPROVAL_REQUIRED",
  "ADMITTED",
  "INTEGRATED",
  "CANONICAL_COMMIT_CREATED",
  "REMOTE_PUBLISHED",
  "DEPLOYMENT_STARTED",
  "DEPLOYED",
  "RUNTIME_VERIFIED",
  "CAPABILITY_REGISTERED",
  "OWNER_ENABLED",
  "WORK_COMPLETED",
] as const;
export type CheckpointType = typeof CHECKPOINT_TYPES[number];

export const CHECKPOINT_STATES = [
  "PENDING",
  "ACTIVE",
  "VERIFIED",
  "FAILED",
  "BLOCKED",
  "NOT_APPLICABLE",
  "NOT_AVAILABLE",
] as const;
export type CheckpointState = typeof CHECKPOINT_STATES[number];

export const STUCK_STATES = [
  "WAITING_FOR_INTEGRATION",
  "WAITING_FOR_PUBLISH",
  "WAITING_FOR_DEPLOYMENT",
  "WAITING_FOR_RUNTIME_VERIFY",
  "WAITING_FOR_OWNER_ENABLE",
  "WAITING_FOR_CLIENT",
  "BLOCKED_BY_FAILURE",
  "UNREGISTERED_AGENT_ACTIVITY",
  "NONE",
] as const;
export type StuckState = typeof STUCK_STATES[number];

export const PRODUCTION_ENVIRONMENTS = ["LOCAL_FIXTURE", "REMOTE_REAL", "NOT_WIRED", "NOT_AVAILABLE"] as const;
export type ProductionEnvironment = typeof PRODUCTION_ENVIRONMENTS[number];

export const SOURCE_OF_TRUTH: Record<CheckpointType, string> = {
  WORK_CREATED: "OWNER_SUBMISSION",
  WORK_ACCEPTED: "OWNER_SUBMISSION",
  IMPLEMENTING: "CODING_CLIENT",
  BUILD_VERIFIED: "BUILD_TOOL",
  TEST_VERIFIED: "TEST_TOOL",
  REVIEW_READY: "ADMISSION_AUTHORITY",
  OWNER_APPROVAL_REQUIRED: "OWNER_POLICY",
  ADMITTED: "ADMISSION_AUTHORITY",
  INTEGRATED: "INTEGRATION_AUTHORITY",
  CANONICAL_COMMIT_CREATED: "GIT_REMOTE_PROVIDER",
  REMOTE_PUBLISHED: "GIT_REMOTE_PROVIDER",
  DEPLOYMENT_STARTED: "DEPLOYMENT_TARGET",
  DEPLOYED: "DEPLOYMENT_TARGET",
  RUNTIME_VERIFIED: "RUNTIME_HEALTH",
  CAPABILITY_REGISTERED: "CAPABILITY_REGISTRY",
  OWNER_ENABLED: "OWNER_POLICY",
  WORK_COMPLETED: "MACHINE_CHECKPOINT_CONJUNCTION",
};

export const TRUTH_LOCKS = {
  AGENT_DONE_EQUALS_WORK_COMPLETED: false,
  LOCAL_COMMIT_EQUALS_REMOTE_PUBLISHED: false,
  REMOTE_PUBLISHED_EQUALS_DEPLOYED: false,
  DEPLOYED_EQUALS_RUNTIME_VERIFIED: false,
  OWNER_UI_PRESENCE_REQUIRED: false,
  CODING_CLIENT_FRONTMOST_REQUIRED: false,
  REPOSITORY_REDISCOVERY_REQUIRED: false,
  AGENT_STATUS_QUERY_REQUIRED: false,
  NATIVE_NOTIFICATION_AUTO_REQUESTED: false,
} as const;

export interface ProductionCheckpointV1 {
  readonly schema: typeof PRODUCTION_CHECKPOINT;
  readonly checkpoint_id: string;
  readonly work_id: string;
  readonly subject: string;
  readonly checkpoint_type: CheckpointType;
  readonly state: CheckpointState;
  readonly source_of_truth: string;
  readonly revision: string | "NOT_AVAILABLE" | "UNRESOLVED";
  readonly artifact_refs: readonly string[];
  readonly report_refs: readonly string[];
  readonly evidence_refs: readonly string[];
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly verified_at: string | null;
  readonly failure_reason: string | null;
  readonly owner_attention_required: boolean;
}

export interface WorkCompletionReadinessV1 {
  readonly schema: typeof WORK_COMPLETION_READINESS;
  readonly work_id: string;
  readonly WORK_COMPLETED: boolean;
  readonly required_checkpoints: readonly CheckpointType[];
  readonly satisfied: readonly CheckpointType[];
  readonly missing: readonly CheckpointType[];
  readonly stuck_state: StuckState;
  readonly owner_attention_required: boolean;
}

export interface SourceLineageStatusV1 {
  readonly schema: "SOURCE_LINEAGE_STATUS_V1";
  readonly work_id: string;
  readonly workspace_base_revision: string;
  readonly candidate_revision: string;
  readonly canonical_revision: string;
  readonly remote_revision: string;
  readonly deployment_revision: string;
  readonly runtime_revision: string;
  readonly SOURCE_LINEAGE_ALIGNED: boolean;
  readonly divergence_boundary: string | null;
}

export interface WorkCompletionReportV1 {
  readonly schema: typeof WORK_COMPLETION_REPORT;
  readonly work_id: string;
  readonly subject: string;
  readonly client: string;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly final_checkpoint: CheckpointType;
  readonly reports_created: number;
  readonly artifacts_created: number;
  readonly tests_summary: string;
  readonly integration_summary: string;
  readonly publish_summary: string;
  readonly deployment_summary: string;
  readonly runtime_summary: string;
  readonly capability_summary: string;
  readonly remaining_actions: readonly string[];
  readonly evidence_refs: readonly string[];
  readonly deployment_target_type: ProductionEnvironment;
  readonly runtime_verification_type: ProductionEnvironment;
  readonly PRODUCTION_ENVIRONMENT: ProductionEnvironment;
}

export interface OwnerWorkItemProjectionV1 {
  readonly work_id: string;
  readonly subject: string;
  readonly client: string;
  readonly current_checkpoint: CheckpointType;
  readonly current_stage: string;
  readonly last_verified_checkpoint: CheckpointType | "NOT_AVAILABLE";
  readonly next_expected_checkpoint: CheckpointType | "NOT_AVAILABLE" | "NONE";
  readonly reports_created: number;
  readonly last_activity_at: string;
  readonly attention_required: boolean;
  readonly stuck_state: StuckState;
  readonly CANONICAL_REVISION: string;
  readonly REMOTE_REVISION: string;
  readonly DEPLOYMENT_STATE: string;
  readonly RUNTIME_STATE: string;
  readonly OWNER_ATTENTION: boolean;
}

export interface CurrentWorkOwnerReportV1 {
  readonly CURRENT_RUNNING_WORK: number;
  readonly CURRENT_COMPLETED_WORK: number;
  readonly CURRENT_BLOCKED_WORK: number;
  readonly CURRENT_WAITING_OWNER: number;
  readonly CURRENT_REPORTS_CREATED: number;
  readonly items: readonly OwnerWorkItemProjectionV1[];
  readonly catchup_notifications: number;
  readonly PRODUCTION_ENVIRONMENT: ProductionEnvironment;
  readonly SOURCE_LINEAGE_ALIGNED: boolean | "UNRESOLVED";
}

export interface SourceLineageClosureV1 {
  readonly schema: typeof SOURCE_LINEAGE_CLOSURE;
  readonly work_id: string;
  readonly base_revision: string;
  readonly workspace_revision: string;
  readonly candidate_revision: string;
  readonly canonical_revision: string;
  readonly remote_revision: string;
  readonly deployment_revision: string;
  readonly runtime_revision: string;
  readonly LINEAGE_STATUS: LineageStatus;
  readonly AUTO_REPAIR_ALLOWED: false;
}

export interface ProductionAdmissionReadinessV1 {
  readonly schema: typeof PRODUCTION_ADMISSION_READINESS;
  readonly work_id: string;
  readonly READY: boolean;
  readonly scope_valid: boolean;
  readonly lease_evidence_valid: boolean;
  readonly source_mutation_evidence_valid: boolean;
  readonly required_build_passed: boolean;
  readonly required_tests_passed: boolean;
  readonly revision_preimage_passed: boolean;
  readonly no_unresolved_conflict: boolean;
  readonly work_output_exists: boolean;
  readonly candidate_source_handle_exists: boolean;
  readonly missing: readonly string[];
}

export interface WorkStateFinalizationV1 {
  readonly schema: typeof WORK_STATE_FINALIZATION;
  readonly work_id: string;
  readonly previous_activity_class: ActivityClass;
  readonly finalized_as: FinalizationState;
  readonly evidence_refs: readonly string[];
  readonly finalized_at: string;
  readonly history_retained: true;
  readonly AUTO_REPAIR_ALLOWED: false;
}

export interface DeploymentTargetStatusV1 {
  readonly target_id: string;
  readonly target_type: ProductionEnvironment;
  readonly authentication_ready: boolean;
  readonly runtime_verified: boolean;
  readonly owner_enabled: boolean;
  readonly mutation_wired: boolean;
  readonly health_probe_wired: boolean;
}

export interface ClosedWorkItemV1 {
  readonly work_id: string;
  readonly subject: string;
  readonly STATE_CLASSIFICATION: WorkClassification;
  readonly activity_class: ActivityClass;
  readonly CURRENT_CHECKPOINT: string;
  readonly LAST_VERIFIED_CHECKPOINT: string;
  readonly LINEAGE_STATUS: LineageStatus;
  readonly OWNER_ATTENTION: boolean;
  readonly finalized_as: FinalizationState | null;
}

export const EXISTING_REMOTE_PRODUCTION_DISCOVERY = "EXISTING_REMOTE_PRODUCTION_DISCOVERY_AND_BINDING_V1" as const;
export const REMOTE_RESOURCE_IDENTITY = "REMOTE_RESOURCE_IDENTITY_V1" as const;
export const EXISTING_DEPLOYMENT_TARGET_NORMALIZATION = "EXISTING_DEPLOYMENT_TARGET_NORMALIZATION_V1" as const;
export const REAL_PRODUCTION_LINEAGE = "REAL_PRODUCTION_LINEAGE_V1" as const;

export type ResourceExistenceFact = "true" | "false" | "unknown";
export type CapabilityAtomStateV1 =
  | "NOT_AVAILABLE"
  | "DECLARED"
  | "ADAPTER_PRESENT"
  | "AUTHENTICATION_READY"
  | "RUNTIME_VERIFIED"
  | "OWNER_ENABLED";

export interface RemoteResourceIdentityV1 {
  readonly schema: typeof REMOTE_RESOURCE_IDENTITY;
  readonly provider: string;
  readonly resource_type: string;
  readonly provider_resource_id: string;
  readonly canonical_resource_id: string;
  readonly name: string;
  readonly environment: string;
  readonly repository_binding: string | null;
  readonly service_binding: string | null;
  readonly runtime_url_ref: string | null;
  readonly credential_ref: string | null;
  readonly discovery_source: string;
  readonly evidence_refs: readonly string[];
  readonly RESOURCE_EXISTS: boolean;
  readonly RESOURCE_REGISTERED: boolean;
  readonly AUTHENTICATION_READY: boolean;
  readonly RUNTIME_REACHABLE: boolean;
  readonly MUTATION_WIRED: boolean;
  readonly OWNER_ENABLED: boolean;
}

export interface ExistingDeploymentTargetNormalizationV1 {
  readonly schema: typeof EXISTING_DEPLOYMENT_TARGET_NORMALIZATION;
  readonly target_id: string;
  readonly provider: string;
  readonly provider_resource_id: string;
  readonly target_type: "REMOTE_REAL";
  readonly environment: string;
  readonly deployment_method: string;
  readonly runtime_probe: string | null;
  readonly repository_binding: string;
  readonly owner_enabled: false;
  readonly mutation_capability: "NOT_WIRED" | "NOT_AVAILABLE";
  readonly evidence_refs: readonly string[];
  readonly duplicate_created: false;
}

export interface RealProductionLineageV1 {
  readonly schema: typeof REAL_PRODUCTION_LINEAGE;
  readonly REAL_CANONICAL_REVISION: string;
  readonly REAL_REMOTE_REVISION: string;
  readonly REAL_DEPLOYMENT_REVISION: string;
  readonly REAL_RUNTIME_REVISION: string;
  readonly REAL_LINEAGE_STATUS:
    | "ALIGNED"
    | "DIVERGED_AT_CANONICAL"
    | "DIVERGED_AT_REMOTE"
    | "DIVERGED_AT_DEPLOYMENT"
    | "DIVERGED_AT_RUNTIME"
    | "INCOMPLETE"
    | "NOT_AVAILABLE";
  readonly FIXTURE_REVISIONS_EXCLUDED_FROM_REAL_LINEAGE: true;
}

export interface WaitingDeploymentMappingV1 {
  readonly WORK_ID: string;
  readonly CANDIDATE_REVISION: string;
  readonly TARGET_ID: string;
  readonly TARGET_BINDING_STATUS: string;
  readonly DEPLOYMENT_CAPABILITY_STATUS: string;
  readonly NEXT_REQUIRED_ACTION: string;
  readonly DEPLOY_EXECUTED: false;
  readonly blocking_condition: string;
}

export interface RemoteProductionDiscoveryV1 {
  readonly schema: typeof EXISTING_REMOTE_PRODUCTION_DISCOVERY;
  readonly EXISTING_REMOTE_DISCOVERY_FIRST: true;
  readonly NEW_REMOTE_CREATION_DEFAULT: false;
  readonly NEW_REMOTE_PROJECT_CREATED: false;
  readonly REMOTE_RESOURCE_DISCOVERY_GRANTS_AUTHORITY: false;
  readonly EXISTING_RESOURCE_REUSED: boolean;
  readonly resources: readonly RemoteResourceIdentityV1[];
  readonly targets: readonly ExistingDeploymentTargetNormalizationV1[];
  readonly lineage: RealProductionLineageV1;
  readonly HISTORICAL_REMOTE_PRODUCTION: "VERIFIED_REAL" | "PARTIAL" | "FIXTURE_ONLY" | "NOT_FOUND";
  readonly GITHUB_REPOSITORY_REACHABLE: boolean;
  readonly GITHUB_AUTHENTICATION_READY: boolean;
  readonly GITHUB_ENVIRONMENTS_API: string;
  readonly GITHUB_ENVIRONMENT_PERMISSION: string;
  readonly GITHUB_ENVIRONMENTS: readonly string[];
  readonly GITHUB_UNAUTHENTICATED_HTTP: number | null;
  readonly GITHUB_UNAUTHENTICATED_NOT_FINAL: true;
  readonly RAILWAY_RESOURCE_EXISTS: boolean;
  readonly RAILWAY_REGISTERED: boolean;
  readonly RAILWAY_AUTH_READY: boolean;
  readonly RAILWAY_READ_VERIFIED: boolean;
  readonly RAILWAY_DEPLOY_MUTATION_WIRED: false;
  readonly RAILWAY_RUNTIME_PROBE_WIRED: boolean;
  readonly SUPABASE_RESOURCE_ROLE: "DATABASE_RESOURCE";
  readonly DEPLOYMENT_METHOD: string;
  readonly REMOTE_REAL_TARGET_ID: string;
  readonly REMOTE_REAL_TARGET_REGISTERED: boolean;
  readonly REMOTE_REAL_TARGET_OWNER_ENABLED: false;
  readonly capabilities: Record<string, CapabilityAtomStateV1>;
  readonly waiting: WaitingDeploymentMappingV1;
  readonly REMOTE_PRODUCTION_READY: false;
  readonly RUNTIME_VERIFIED: false;
  readonly observed_at: string;
}

export const RAILWAY_REGISTERED_DEPLOY_MUTATION = "RAILWAY_REGISTERED_DEPLOY_MUTATION_V1" as const;
export const REMOTE_PRODUCTION_EXECUTION_CLOSURE = "REMOTE_PRODUCTION_EXECUTION_CLOSURE_V1" as const;
export const RAILWAY_DEPLOYMENT_REVISION_RESOLUTION = "RAILWAY_DEPLOYMENT_REVISION_RESOLUTION_V1" as const;
export const RAILWAY_DEPLOY_REVISION = "RAILWAY_DEPLOY_REVISION_V1" as const;
