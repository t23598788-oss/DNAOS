export const MACOS_NATIVE_CONTROL_BRIDGE_SCHEMA = "MACOS_NATIVE_CONTROL_BRIDGE_V1" as const;
export const MACOS_NATIVE_ROUTE_POLICY_SCHEMA = "MACOS_NATIVE_ROUTE_POLICY_V1" as const;
export const OWNER_COMMAND_QUEUE_SCHEMA = "OWNER_COMMAND_QUEUE_V1" as const;
export const COMMAND_CONFLICT_POLICY_SCHEMA = "COMMAND_CONFLICT_POLICY_V1" as const;
export const MACOS_EVENT_CORRELATION_SCHEMA = "MACOS_EVENT_CORRELATION_V1" as const;
export const ENDPOINT_SECURITY_BRIDGE_SCHEMA = "ENDPOINT_SECURITY_BRIDGE_V1" as const;
export const SYSTEM_ACTIVITY_CLASSIFICATION_SCHEMA = "SYSTEM_ACTIVITY_CLASSIFICATION_V1" as const;
export const MACOS_PERMISSION_STATE_SCHEMA = "MACOS_PERMISSION_STATE_V1" as const;
export const OWNER_MACHINE_BASELINE_SCHEMA = "OWNER_MACHINE_BASELINE_V1" as const;
export const MACOS_CAPABILITY_DRIFT_SCHEMA = "MACOS_CAPABILITY_DRIFT_V1" as const;

export type NativeInterfaceType =
  | "APP_INTENTS"
  | "APP_SHORTCUTS"
  | "LAUNCH_SERVICES"
  | "NSWORKSPACE"
  | "PROCESS_GATE"
  | "OS_SERVICE"
  | "ENDPOINT_SECURITY_NOTIFY"
  | "ENDPOINT_SECURITY_AUTH"
  | "ACCESSIBILITY_FALLBACK";

export type BridgeAvailability =
  | "DISCOVERED"
  | "INTERFACE_FOUND"
  | "CAPABILITY_VERIFIED"
  | "OWNER_ENABLED"
  | "UNAVAILABLE"
  | "UNSUPPORTED"
  | "NOT_AVAILABLE";

export type CommandQueueState =
  | "RECEIVED"
  | "VALIDATED"
  | "WAITING_FOR_APPROVAL"
  | "QUEUED"
  | "EXECUTING"
  | "VERIFYING"
  | "COMPLETED"
  | "BLOCKED"
  | "REJECTED";

export type ConflictResolution = "SERIALIZE" | "BLOCK" | "OWNER_REVIEW_REQUIRED";
export type ActivityClass = "EXPECTED" | "BACKGROUND_KNOWN" | "UNRELATED" | "UNEXPECTED" | "POLICY_VIOLATION_ATTEMPT";
export type EnforcementMaturity = "OBSERVE" | "CORRELATE" | "VERIFY" | "ENFORCE_ELIGIBLE" | "ENFORCED";
export type PermissionTruth = "REQUIRED" | "GRANTED" | "DENIED" | "NOT_REQUESTED" | "NOT_AVAILABLE";
export type DriftClass = "NO_CHANGE" | "CAPABILITY_ADDED" | "CAPABILITY_REMOVED" | "PERMISSION_CHANGED" | "RUNTIME_CHANGED" | "OWNER_REVIEW_REQUIRED";
export type VerificationResult = "VERIFIED" | "PARTIALLY_VERIFIED" | "UNVERIFIED" | "BLOCKED";

export const MACOS_NATIVE_ROUTE_ORDER = [
  "OWNER_POLICY",
  "VERIFIED_CAPABILITY",
  "APP_INTENT",
  "APP_SHORTCUT",
  "LAUNCH_SERVICES_NSWORKSPACE",
  "REGISTERED_OS_SERVICE",
  "PROCESS_GATE",
  "ACCESSIBILITY_FALLBACK",
] as const;

export const NATIVE_INTERFACE_RANK: Readonly<Record<NativeInterfaceType, number>> = {
  APP_INTENTS: 1,
  APP_SHORTCUTS: 2,
  LAUNCH_SERVICES: 3,
  NSWORKSPACE: 3,
  OS_SERVICE: 4,
  PROCESS_GATE: 5,
  ENDPOINT_SECURITY_NOTIFY: 6,
  ENDPOINT_SECURITY_AUTH: 7,
  ACCESSIBILITY_FALLBACK: 8,
};

export interface MacosNativeBridgeV1 {
  readonly schema: typeof MACOS_NATIVE_CONTROL_BRIDGE_SCHEMA;
  readonly bridge_id: string;
  readonly machine_id: string;
  readonly macos_version: string;
  readonly interface_type: NativeInterfaceType;
  readonly native_identity: string;
  readonly capabilities_declared: readonly string[];
  readonly capabilities_verified: readonly string[];
  readonly authority_required: "OWNER_GRANT";
  readonly tcc_requirement: string;
  readonly entitlement_requirement: string;
  readonly execution_scope: readonly string[];
  readonly observation_scope: readonly string[];
  readonly side_effect_class: string;
  readonly availability: BridgeAvailability;
  readonly runtime_verified: boolean;
  readonly owner_enabled: boolean;
  readonly evidence_policy: "LOCAL_EXECUTION_ENVELOPE";
  readonly grants_authority: false;
}

export interface DiscoveredIntentV1 {
  readonly application_id: string;
  readonly intent_id: string;
  readonly intent_title: string;
  readonly parameters: readonly string[];
  readonly input_schema: Record<string, unknown>;
  readonly output_schema: Record<string, unknown>;
  readonly side_effects: string;
  readonly foreground_required: boolean;
  readonly owner_authority_state: "DENY";
  readonly grants_execution_permission: false;
}

export interface OwnerCommandV1 {
  readonly schema: typeof OWNER_COMMAND_QUEUE_SCHEMA;
  readonly command_id: string;
  readonly work_id: string;
  readonly canonical_action: string;
  readonly resources: readonly string[];
  readonly requested_by: string;
  readonly authority_state: "ALLOW" | "DENY" | "OWNER_APPROVAL_REQUIRED";
  readonly priority: number;
  readonly dependencies: readonly string[];
  readonly preconditions: readonly string[];
  readonly preview_ref: string | null;
  readonly execution_state: CommandQueueState;
  readonly result_ref: string | null;
  readonly native_route: NativeInterfaceType | null;
  readonly conflict_resolution: ConflictResolution | null;
  readonly conflict_reason: string | null;
  readonly session_id: string;
  readonly payload: Record<string, unknown>;
  readonly expected_events: readonly string[];
  readonly observed_events: readonly string[];
  readonly verification: VerificationResult | null;
  readonly created_at: string;
}

export interface MacosEventCorrelationV1 {
  readonly schema: typeof MACOS_EVENT_CORRELATION_SCHEMA;
  readonly event_type: string;
  readonly command_id: string | null;
  readonly work_id: string | null;
  readonly execution_id: string | null;
  readonly process: string | null;
  readonly resource: string | null;
  readonly application: string | null;
  readonly timestamp: string;
  readonly classification: ActivityClass;
  readonly expected: boolean;
  readonly policy_correlation: string;
}

export interface MacosPermissionStateV1 {
  readonly schema: typeof MACOS_PERMISSION_STATE_SCHEMA;
  readonly permission: string;
  readonly state: PermissionTruth;
  readonly api_exists: boolean;
  readonly dna_os_has_permission: boolean;
  readonly auto_requested: false;
}

export interface OwnerMachineBaselineV1 {
  readonly schema: typeof OWNER_MACHINE_BASELINE_SCHEMA;
  readonly baseline_id: string;
  readonly machine_id: string;
  readonly macos_version: string;
  readonly recorded_at: string;
  readonly registered_apps: readonly string[];
  readonly verified_native_interfaces: readonly NativeInterfaceType[];
  readonly registered_devices: readonly string[];
  readonly owner_enabled_resources: readonly string[];
  readonly tcc_states: readonly MacosPermissionStateV1[];
  readonly registered_command_capabilities: readonly string[];
  readonly secrets_copied: false;
}

export interface CapabilityDriftV1 {
  readonly schema: typeof MACOS_CAPABILITY_DRIFT_SCHEMA;
  readonly classification: DriftClass;
  readonly detail: string;
  readonly auto_enabled: false;
}
