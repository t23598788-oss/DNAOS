export const OWNER_NOTIFICATION_BACKEND = "OWNER_NOTIFICATION_BACKEND_V1" as const;

export const NOTIFICATION_TYPES = [
  "WORK_STARTED", "WORK_PROGRESS", "WORK_COMPLETED",
  "CODING_STARTED", "BUILD_COMPLETED", "BUILD_FAILED", "TEST_COMPLETED", "TEST_FAILED", "REVIEW_READY",
  "OWNER_APPROVAL_REQUIRED",
  "PUBLISH_STARTED", "PUBLISHED",
  "DEPLOYMENT_STARTED", "DEPLOYED", "DEPLOYMENT_FAILED",
  "RUNTIME_VERIFIED", "RUNTIME_VERIFICATION_FAILED",
  "CAPABILITY_REGISTERED", "CAPABILITY_AVAILABLE", "CAPABILITY_DISABLED",
  "ROLLBACK_STARTED", "ROLLBACK_COMPLETED", "ROLLBACK_FAILED",
  "CONNECTION_CHANGED", "RESOURCE_CHANGED",
  "INBOUND_MESSAGE", "INBOUND_EMAIL", "INBOUND_SYSTEM_EVENT",
  "SYSTEM_WARNING", "SYSTEM_ERROR",
  "SECURITY_SENSITIVE_REAUTH", "DEVELOPMENT_PROPOSAL_READY",
] as const;
export type NotificationType = typeof NOTIFICATION_TYPES[number];

export const POLICY_DECISIONS = ["IGNORE", "ACTIVITY_ONLY", "NOTIFY", "NOTIFY_ACTION_REQUIRED", "NOTIFY_CRITICAL"] as const;
export type PolicyDecision = typeof POLICY_DECISIONS[number];

export const NATIVE_PERMISSION_STATES = [
  "NOT_REQUESTED", "AUTHORIZED", "DENIED", "PROVISIONAL", "NOT_AVAILABLE", "ERROR",
] as const;
export type NativePermissionState = typeof NATIVE_PERMISSION_STATES[number];

export type NotificationSeverity = "INFO" | "WARNING" | "CRITICAL";
export type DeliveryChannel = "OWNER_SURFACE" | "MACOS_NATIVE";
export type DeliveryState =
  | "PENDING"
  | "DELIVERED_SURFACE"
  | "DELIVERY_REQUESTED"
  | "DELIVERY_ACCEPTED_BY_OS"
  | "DELIVERY_FAILED"
  | "SKIPPED_NATIVE";

export interface OwnerNotificationV1 {
  readonly schema: "OWNER_NOTIFICATION_V1";
  readonly notification_id: string;
  readonly event_id: string;
  readonly entity_id: string;
  readonly work_id: string | null;
  readonly command_id: string | null;
  readonly source_system: string;
  readonly notification_type: NotificationType | string;
  readonly severity: NotificationSeverity;
  readonly title_key: string;
  readonly message_key: string;
  readonly structured_facts: Readonly<Record<string, string | number | boolean | null>>;
  readonly state_before: string | null;
  readonly state_after: string | null;
  readonly action_required: boolean;
  readonly owner_action_refs: readonly string[];
  readonly resource_refs: readonly string[];
  readonly capability_refs: readonly string[];
  readonly evidence_refs: readonly string[];
  readonly created_at: string;
  readonly read_at: string | null;
  readonly dismissed_at: string | null;
  readonly delivery_state: DeliveryState;
  readonly delivery_channels: readonly DeliveryChannel[];
  readonly deduplication_key: string;
  readonly version: number;
}

export interface HumanNotificationProjectionV1 {
  readonly schema: "HUMAN_NOTIFICATION_PROJECTION_V1";
  readonly notification_id: string;
  readonly title: string;
  readonly message: string;
  readonly severity: NotificationSeverity;
  readonly time: string;
  readonly source_label: string;
  readonly action_required: boolean;
  readonly human_actions: readonly string[];
  readonly technical_detail_ref: string;
  readonly HUMAN_NOTIFICATION_REQUIRES_AI: false;
}

export interface OwnerActiveWorkProjectionV1 {
  readonly schema: "OWNER_ACTIVE_WORK_PROJECTION_V1";
  readonly activity_id: string;
  readonly actor: string;
  readonly actor_type: string;
  readonly work_id: string;
  readonly subject: string;
  readonly goal: string;
  readonly stage: string;
  readonly status: string;
  readonly started_at: string;
  readonly last_activity_at: string;
  readonly progress_summary: string;
  readonly evidence_refs: readonly string[];
}

export interface OwnerAttentionIndexV1 {
  readonly schema: "OWNER_ATTENTION_INDEX_V1";
  readonly unread_count: number;
  readonly attention_required_count: number;
  readonly warning_count: number;
  readonly critical_count: number;
}

export interface NotificationDeliveryEvidenceV1 {
  readonly schema: "NOTIFICATION_DELIVERY_EVIDENCE_V1";
  readonly notification_id: string;
  readonly delivery_channel: DeliveryChannel;
  readonly permission_state: NativePermissionState | "N_A";
  readonly delivery_requested_at: string;
  readonly delivery_request_result: "DELIVERY_REQUESTED" | "DELIVERY_ACCEPTED_BY_OS" | "DELIVERY_FAILED" | "SKIPPED" | "DELIVERED_SURFACE";
  readonly error_code: string | null;
  readonly USER_VIEWED_UNKNOWN: true;
}

export interface OwnerNotificationEnablementV1 {
  readonly schema: "OWNER_NOTIFICATION_ENABLEMENT_V1";
  readonly native_enabled: boolean;
  readonly owner_surface_enabled: true;
  readonly updated_at: string;
  readonly NEW_NOTIFICATION_PERMISSION_AUTO_REQUESTED: false;
}

export interface NotificationMetricsV1 {
  EVENTS_EVALUATED: number;
  EVENTS_IGNORED: number;
  ACTIVITY_ONLY_EVENTS: number;
  NOTIFICATIONS_CREATED: number;
  NOTIFICATIONS_DEDUPLICATED: number;
  OWNER_SURFACE_DELIVERIES: number;
  MACOS_DELIVERY_REQUESTS: number;
  MACOS_DELIVERY_ACCEPTED: number;
  MACOS_DELIVERY_FAILED: number;
  UNREAD_COUNT: number;
  OWNER_ATTENTION_COUNT: number;
}
