export const INBOUND_EVENT_ADAPTER_FABRIC = "INBOUND_EVENT_ADAPTER_FABRIC_V1" as const;
export const OWNER_CONTINUOUS_WORK_VISIBILITY = "OWNER_CONTINUOUS_WORK_VISIBILITY_V1" as const;

export const PROVIDER_CLASSES = [
  "CODING_CLIENT", "EMAIL_PROVIDER", "MESSAGING_PROVIDER", "FILE_SOURCE", "GITHUB",
  "DEPLOYMENT_PROVIDER", "DATABASE_PROVIDER", "LOCAL_APPLICATION", "MACOS",
  "REMOTE_SERVICE", "SYSTEM_INTERNAL",
] as const;
export type ProviderClass = typeof PROVIDER_CLASSES[number];

export const CODING_STAGES = [
  "WORK_ACCEPTED", "CONTEXT_LOADING", "IMPLEMENTING", "BUILDING", "TESTING",
  "REVIEWING", "WAITING", "BLOCKED", "COMPLETED_CANDIDATE", "HANDOFF_COMPLETE",
] as const;
export type CodingStage = typeof CODING_STAGES[number];

export const STALENESS_STATES = ["ACTIVE", "IDLE_EXPECTED", "WAITING", "STALE", "BLOCKED", "COMPLETED"] as const;
export type StalenessState = typeof STALENESS_STATES[number];

export interface InboundAdapterV1 {
  readonly schema: "INBOUND_EVENT_ADAPTER_V1";
  readonly adapter_id: string;
  readonly provider_id: string;
  readonly provider_type: ProviderClass;
  readonly source_system: string;
  readonly transport: string;
  readonly event_types: readonly string[];
  readonly authentication_state: string;
  readonly authority_state: "DENY" | "OWNER_DISABLED" | "OWNER_ENABLED";
  readonly runtime_verified: boolean;
  readonly owner_enabled: boolean;
  readonly last_event_at: string | null;
  readonly health: "VERIFIED" | "CONNECTED" | "NOT_WIRED" | "NOT_AVAILABLE" | "BLOCKED";
  readonly evidence_refs: readonly string[];
  readonly discovery_grants_authority: false;
}

export interface OwnerSubmittedWorkV1 {
  readonly schema: "OWNER_SUBMITTED_WORK_V1";
  readonly submission_id: string;
  readonly work_id: string;
  readonly work_order_id: string;
  readonly subject: string;
  readonly submitted_from_surface: string;
  readonly assigned_client: string;
  readonly submitted_at: string;
  readonly accepted_at: string | null;
  readonly current_stage: string;
  readonly latest_activity: string;
  readonly reports_created: number;
  readonly results_created: number;
  readonly artifacts_created: number;
  readonly reviews_ready: number;
  readonly failures: number;
  readonly attention_required: boolean;
  readonly final_result_ref: string | null;
  readonly client_connected: boolean;
  readonly WORK_COMPLETED: boolean;
  readonly machine_verified_status: string | null;
  readonly reported_status: string | null;
  readonly last_activity_at: string;
  readonly expected_activity_window_ms: number;
}

export interface CodingClientActivityV1 {
  readonly schema: "CODING_CLIENT_ACTIVITY_ADAPTER_V1";
  readonly client_id: string;
  readonly work_id: string;
  readonly work_order_id: string;
  readonly subject: string;
  readonly goal: string;
  readonly repository_id: string;
  readonly workspace_id: string;
  readonly current_stage: string;
  readonly current_action: string;
  readonly started_at: string;
  readonly last_activity_at: string;
  readonly reported_status: string;
  readonly machine_verified_status: string | null;
  readonly result_refs: readonly string[];
  readonly report_count: number;
}

export interface WorkOutputRecordV1 {
  readonly schema: "WORK_OUTPUT_ACCOUNTING_V1";
  readonly output_id: string;
  readonly work_id: string;
  readonly kind: "report" | "result" | "artifact" | "evidence_bundle" | "review" | "deployment" | "runtime_result";
  readonly report_id: string | null;
  readonly result_id: string | null;
  readonly artifact_id: string | null;
  readonly evidence_bundle_id: string | null;
  readonly review_id: string | null;
  readonly deployment_id: string | null;
  readonly runtime_result_id: string | null;
  readonly created_at: string;
}

export interface NormalizedInboundEventV1 {
  readonly adapter_id: string;
  readonly provider_id: string;
  readonly external_event_id: string;
  readonly event_type: string;
  readonly work_id: string | null;
  readonly entity_id: string;
  readonly source_system: string;
  readonly current_state: string | null;
  readonly previous_state: string | null;
  readonly facts: Readonly<Record<string, string | number | boolean | null>>;
  readonly evidence_refs: readonly string[];
  readonly owner_attention?: boolean;
  readonly action_required?: boolean;
  readonly severity?: "INFO" | "WARN" | "ERROR";
}
