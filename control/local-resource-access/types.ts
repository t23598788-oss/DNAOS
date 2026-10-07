/**
 * Canonical LOCAL_RESOURCE_V1, capability, authority, egress, and evidence types.
 * Leaf contract. Never carry raw secrets or unrestricted absolute paths.
 */

export const LOCAL_RESOURCE_SCHEMA = "LOCAL_RESOURCE_V1" as const;
export const OS_RESOURCE_SCHEMA = "OS_RESOURCE_V1" as const;
export const APPLICATION_RESOURCE_SCHEMA = "APPLICATION_RESOURCE_V1" as const;
export const LOCAL_PROCESS_GATE_SCHEMA = "LOCAL_PROCESS_GATE_V1" as const;
export const OWNER_MACHINE_POLICY_SCHEMA = "OWNER_MACHINE_POLICY_V1" as const;
export const EVERYDAY_DATA_ACTIONS_SCHEMA = "EVERYDAY_DATA_ACTIONS_V1" as const;
export const REMOTE_RESOURCE_ACTION_SCHEMA = "REMOTE_RESOURCE_ACTION_V1" as const;
export const MACHINE_CAPABILITY_INVENTORY_SCHEMA = "MACHINE_CAPABILITY_INVENTORY_V1" as const;
export const REMOTE_SERVICE_CAPABILITY_BINDING_SCHEMA = "REMOTE_SERVICE_CAPABILITY_BINDING_V1" as const;
export const OWNER_CAPABILITY_BINDING_POLICY_SCHEMA = "OWNER_CAPABILITY_BINDING_POLICY_V1" as const;

export type LocalResourceType =
  | "FILE_SYSTEM"
  | "APPLICATION"
  | "DATABASE"
  | "LOCAL_COMPUTE"
  | "GIT_REPOSITORY"
  | "DEVICE"
  | "LOCAL_SERVICE"
  | "PROCESS"
  | "PORT"
  | "NETWORK_INTERFACE"
  | "DISK"
  | "MOUNT"
  | "SYSTEM_METRIC"
  | "INVENTORY"
  | "REMOTE_SERVICE";

export type Availability = "AVAILABLE" | "UNAVAILABLE" | "DEGRADED";
export type AuthorityRequired = "OWNER_GRANT" | "OWNER_APPROVAL_REQUIRED";
export type DataClassification = "PUBLIC" | "INTERNAL" | "SENSITIVE" | "SECRET" | "CREDENTIAL";
export type Locality = "THIS_MACHINE" | "REGISTERED_WORKSPACE";
export type NetworkEgressPolicy = "LOCAL_ONLY" | "MINIMIZED_EXTERNAL" | "OWNER_APPROVAL_REQUIRED" | "DENIED";
export type CostClass = "TRIVIAL" | "LOCAL_CPU" | "OWNER_REVIEW";
export type EvidencePolicy = "LOCAL_EXECUTION_ENVELOPE";
export type AccessClass = "READ" | "WRITE" | "EXECUTE" | "CREATE" | "MODIFY" | "MOVE" | "DELETE" | "SHARE_EXTERNAL" | "PUBLISH_EXTERNAL";
export type ExecutionLocality = "LOCAL" | "EXTERNAL_AI";
export type AuthorityDecision = "ALLOW" | "DENY" | "OWNER_APPROVAL_REQUIRED";
export type LocalCapabilityName =
  | "local.files.search"
  | "local.files.metadata"
  | "local.files.read_range"
  | "local.workspace.create"
  | "local.workspace.inspect"
  | "local.workspace.list_results"
  | "local.git.status"
  | "local.git.diff"
  | "local.git.search"
  | "local.compute.run_registered_job"
  | "local.app.list_registered"
  | "local.app.invoke_registered_action"
  | "local.app.discover_installed"
  | "local.resource.list"
  | "local.resource.capabilities"
  | "local.resource.status"
  | "local.system.process.list"
  | "local.system.process.inspect"
  | "local.system.port.list"
  | "local.system.network.summary"
  | "local.system.disk.summary"
  | "local.system.mount.list"
  | "local.system.service.status"
  | "local.system.resource_usage"
  | "local.file.read"
  | "local.file.create"
  | "local.file.copy"
  | "local.file.move"
  | "local.file.rename"
  | "local.file.delete"
  | "local.folder.create"
  | "local.folder.list"
  | "local.folder.search"
  | "local.document.extract_text"
  | "local.document.metadata"
  | "local.pdf.extract_text"
  | "local.pdf.metadata"
  | "local.image.metadata"
  | "local.image.convert_registered"
  | "local.document.convert_registered"
  | "local.document.summarize"
  | "local.file.share_external"
  | "local.file.publish_external"
  | "local.inventory.refresh"
  | "local.inventory.get"
  | "local.capability.route"
  | "local.remote.github.read_identity";

export type LocalObservabilityEventType =
  | "WORK_RECEIVED"
  | "AI_REQUEST_RECEIVED"
  | "CAPABILITY_REQUESTED"
  | "AUTHORITY_CHECKED"
  | "WORKSPACE_CREATED"
  | "LOCAL_EXECUTION_STARTED"
  | "FILE_READ"
  | "FILE_WRITE"
  | "PROCESS_STARTED"
  | "PROCESS_COMPLETED"
  | "NETWORK_EGRESS"
  | "AI_DATA_SENT"
  | "AI_RESULT_RECEIVED"
  | "WORK_COMPLETED"
  | "WORK_BLOCKED"
  | "PROCESS_DISCOVERED"
  | "PROCESS_INSPECTED"
  | "PORT_DISCOVERED"
  | "NETWORK_DESTINATION_OBSERVED"
  | "APPLICATION_DISCOVERED"
  | "APPLICATION_ACTION_REQUESTED"
  | "APPLICATION_ACTION_ALLOWED"
  | "APPLICATION_ACTION_DENIED"
  | "PROCESS_JOB_REQUESTED"
  | "PROCESS_JOB_STARTED"
  | "PROCESS_JOB_COMPLETED"
  | "ANOMALY_DETECTED"
  | "RESOURCE_SEARCHED"
  | "RESOURCE_READ"
  | "RESOURCE_CREATED"
  | "RESOURCE_WRITTEN"
  | "RESOURCE_COPIED"
  | "RESOURCE_MOVED"
  | "RESOURCE_RENAMED"
  | "RESOURCE_DELETE_REQUESTED"
  | "RESOURCE_DELETED"
  | "IMPORT_STARTED"
  | "IMPORT_COMPLETED"
  | "EXPORT_STARTED"
  | "EXPORT_COMPLETED"
  | "TRANSFER_VERIFIED"
  | "DOCUMENT_EXTRACTED"
  | "DOCUMENT_CONVERTED"
  | "SUMMARY_LOCAL_PREPROCESS"
  | "SUMMARY_EXTERNAL_DATA_SENT"
  | "APPLICATION_ACTION_EXECUTED"
  | "OWNER_APPROVAL_REQUIRED"
  | "MACHINE_INVENTORY_REFRESHED"
  | "APPLICATION_REGISTERED"
  | "CAPABILITY_DECLARED"
  | "CAPABILITY_VERIFIED"
  | "CAPABILITY_BLOCKED"
  | "REMOTE_SERVICE_DISCOVERED"
  | "REMOTE_SERVICE_BOUND"
  | "REMOTE_SERVICE_UNAVAILABLE"
  | "OWNER_CAPABILITY_ENABLED"
  | "OWNER_CAPABILITY_DISABLED"
  | "CAPABILITY_ROUTE_RESOLVED"
  | "AI_CLIENT_DISCOVERED"
  | "AI_CLIENT_CONNECTED"
  | "AI_TOOL_DISCOVERY"
  | "AI_CAPABILITY_REQUESTED"
  | "AI_LOCAL_WORK_STARTED"
  | "AI_LOCAL_WORK_COMPLETED"
  | "AI_EXTERNAL_DATA_SENT"
  | "AI_RESULT_RETURNED"
  | "AI_HANDOFF_CREATED"
  | "OWNER_REVIEW_REQUESTED"
  | "OWNER_DECISION_APPLIED"
  | "CLIENT_AUTHENTICATED"
  | "CLIENT_AUTHORIZATION_CHECKED"
  | "OWNER_ENVIRONMENT_SELECTED"
  | "RESOURCE_HANDLE_CREATED"
  | "OWNER_COMPUTE_ROUTE_SELECTED"
  | "EXTERNAL_REASONING_REQUIRED"
  | "EXTERNAL_REASONING_SKIPPED"
  | "WORK_CONTEXT_CREATED"
  | "WORK_CONTEXT_HANDOFF"
  | "PROVIDER_UNAVAILABLE"
  | "CLIENT_DISCONNECTED"
  | "TOOL_DISCOVERED"
  | "ADAPTER_DISCOVERED"
  | "ADAPTER_REGISTERED"
  | "CAPABILITY_RUNTIME_VERIFIED"
  | "TOOL_ACTION_REQUESTED"
  | "TOOL_ACTION_ALLOWED"
  | "TOOL_ACTION_BLOCKED"
  | "TOOL_ACTION_STARTED"
  | "TOOL_ACTION_COMPLETED"
  | "DEVICE_DISCOVERED"
  | "DEVICE_CAPABILITY_VERIFIED"
  | "LOCAL_TOOL_CHAIN_STARTED"
  | "LOCAL_TOOL_CHAIN_COMPLETED"
  | "COMMAND_RECEIVED"
  | "COMMAND_VALIDATED"
  | "COMMAND_QUEUED"
  | "COMMAND_CONFLICT"
  | "COMMAND_STARTED"
  | "COMMAND_COMPLETED"
  | "COMMAND_BLOCKED"
  | "COMMAND_REJECTED"
  | "MACOS_EVENT_CORRELATED"
  | "MACOS_PERMISSION_OBSERVED"
  | "MACOS_DRIFT_DETECTED"
  | "ENDPOINT_SECURITY_PROBED"
  | "PRODUCTION_STATE_TRANSITION"
  | "PRODUCTION_CONVEYOR_ADVANCED"
  | "PRODUCTION_BLOCKED_INCOMPLETE"
  | "PRODUCTION_DEPLOYMENT"
  | "PRODUCTION_ROLLBACK"
  | "PRODUCED_CAPABILITY_REGISTERED"
  | "DEVELOPMENT_NOTIFICATION";

export type EverydayActionId =
  | "SEARCH" | "READ" | "CREATE" | "WRITE" | "COPY" | "MOVE" | "RENAME" | "DELETE"
  | "IMPORT" | "EXPORT" | "UPLOAD" | "DOWNLOAD" | "SHARE" | "ARCHIVE" | "UNARCHIVE"
  | "CONVERT" | "COMPARE" | "SUMMARIZE" | "EXTRACT" | "SYNC";
export type ServiceExtensionActionId =
  | "COMMIT" | "PUSH" | "PULL_REQUEST" | "ISSUE" | "CREATE_DRAFT" | "SEND" | "DOWNLOAD_ATTACHMENT" | "SCHEMA_READ";
export type BindableActionId = EverydayActionId | ServiceExtensionActionId;
export type InventoryLifecycle = "DISCOVERED" | "REGISTERED" | "CAPABILITY_VERIFIED" | "OWNER_ENABLED" | "UNAVAILABLE";
export type ApplicationCategory =
  | "FILE_MANAGER" | "TEXT_EDITOR" | "PDF_READER" | "IMAGE_VIEWER" | "BROWSER"
  | "TERMINAL" | "DEVELOPER_TOOL" | "DATABASE_CLIENT" | "OFFICE_DOCUMENT_APP"
  | "COMMUNICATION_APP" | "MEDIA_APP" | "OTHER";
export type CapabilityAtomState = {
  readonly DECLARED: boolean;
  readonly ADAPTER_PRESENT: boolean;
  readonly AUTHENTICATION_READY: boolean;
  readonly RUNTIME_VERIFIED: boolean;
  readonly OWNER_ENABLED: boolean;
};
export type RemoteBindingAvailability = "DISCOVERED" | "CONTRACT_ONLY" | "NOT_AVAILABLE" | "BOUND" | "UNAVAILABLE";
export type DataResourceClass = "FILE" | "FOLDER" | "DOCUMENT" | "PDF" | "IMAGE" | "TEXT" | "STRUCTURED_DATA" | "APPLICATION_STATE" | "REMOTE_OBJECT";
export type EverydaySideEffect = "NONE" | "CREATE" | "MODIFY" | "MOVE" | "DELETE" | "NETWORK";
export type Reversibility = "REVERSIBLE" | "DESTRUCTIVE" | "EXTERNAL";
export type HumanPermissionState = "READ_ONLY" | "CREATE" | "MODIFY" | "MOVE" | "DELETE" | "SHARE_EXTERNAL" | "PUBLISH_EXTERNAL";
export type ApplicationActionType = "READ_STATE" | "OPEN_RESOURCE" | "EXPORT_RESULT" | "RUN_REGISTERED_ACTION";

export interface EverydayActionDescriptor {
  readonly schema: typeof EVERYDAY_DATA_ACTIONS_SCHEMA;
  readonly action_id: EverydayActionId;
  readonly input_schema: Record<string, unknown>;
  readonly output_schema: Record<string, unknown>;
  readonly allowed_resource_types: readonly LocalResourceType[];
  readonly allowed_data_classes: readonly DataResourceClass[];
  readonly side_effect_class: EverydaySideEffect;
  readonly authority_required: AuthorityRequired;
  readonly owner_approval_requirement: "NONE" | "OWNER_APPROVAL_REQUIRED";
  readonly network_egress_class: NetworkEgressPolicy;
  readonly reversibility: Reversibility;
  readonly evidence_policy: EvidencePolicy;
  readonly human_permission: HumanPermissionState;
}

export interface TransferIntegrityRecord {
  readonly source_resource_id: string;
  readonly destination_resource_id: string;
  readonly source_logical: string;
  readonly destination_logical: string;
  readonly source_hash: string | null;
  readonly destination_hash: string | null;
  readonly bytes_transferred: number;
  readonly transfer_kind: "LOCAL" | "NETWORK";
  readonly verified: boolean;
  readonly side_effects: readonly string[];
}

export interface SummarizeByteEvidence {
  readonly SOURCE_BYTES: number;
  readonly LOCAL_BYTES_PROCESSED: number;
  readonly EXTERNAL_BYTES_SENT: number;
  readonly RESULT_BYTES_RETURNED: number;
}
export type AnomalyClass = "NORMAL" | "OBSERVE" | "OWNER_REVIEW_REQUIRED" | "BLOCKED";
export type ProcessSideEffectClass = "NONE" | "READ_OS";

export interface LocalResourceV1 {
  readonly schema: typeof LOCAL_RESOURCE_SCHEMA | typeof OS_RESOURCE_SCHEMA;
  readonly resource_id: string;
  readonly resource_type: LocalResourceType;
  readonly provider: string;
  readonly machine_scope: "THIS_MACHINE";
  readonly capabilities: readonly LocalCapabilityName[];
  readonly availability: Availability;
  readonly authority_required: AuthorityRequired;
  readonly data_classification: DataClassification;
  readonly locality: Locality;
  readonly network_egress_policy: NetworkEgressPolicy;
  readonly read_scope: readonly string[];
  readonly write_scope: readonly string[];
  readonly execute_scope: readonly string[];
  readonly workspace_required: boolean;
  readonly cost_class: CostClass;
  readonly evidence_policy: EvidencePolicy;
  readonly logical_root: string;
}

export interface LocalCapabilityDescriptor {
  readonly capability: LocalCapabilityName;
  readonly input_schema: Record<string, unknown>;
  readonly output_schema: Record<string, unknown>;
  readonly required_authority: AuthorityRequired;
  readonly allowed_resource_types: readonly LocalResourceType[];
  readonly execution_classification: ExecutionLocality;
  readonly possible_network_egress: NetworkEgressPolicy;
  readonly evidence_produced: "DNA_OS_LOCAL_EXECUTION";
  readonly access_class: AccessClass;
}

export interface LocalAccessGrant {
  readonly grant_id: string;
  readonly ai_identity: string;
  readonly session_id: string;
  readonly work_id: string | null;
  readonly capability: LocalCapabilityName | "*";
  readonly resource_id: string | "*";
  readonly data_scope: readonly string[];
  readonly access: readonly AccessClass[];
  readonly network_egress: NetworkEgressPolicy;
  readonly expires_at: string | null;
  readonly effect: AuthorityDecision;
  readonly issued_at: string;
  readonly issuer: "DNA_OS_OWNER_POLICY";
}

export interface AuthorityRequest {
  readonly ai_identity: string;
  readonly session_id: string;
  readonly work_id: string | null;
  readonly capability: LocalCapabilityName;
  readonly resource_id: string;
  readonly data_scope: readonly string[];
  readonly access: AccessClass;
  readonly network_egress: NetworkEgressPolicy;
}

export interface AuthorityResult {
  readonly decision: AuthorityDecision;
  readonly reason_code: string;
  readonly grant_id: string | null;
  readonly matched_resource_ids: readonly string[];
}

export interface DataEgressRecord {
  readonly schema: "DATA_EGRESS_POLICY_V1";
  readonly provider: string;
  readonly work_id: string;
  readonly source_resource: string;
  readonly data_classification: DataClassification;
  readonly bytes_proposed: number;
  readonly bytes_actually_sent: number;
  readonly reason: string;
  readonly authority_decision: AuthorityDecision;
  readonly policy_state: NetworkEgressPolicy;
  readonly redaction_applied: boolean;
  readonly minimization_applied: boolean;
  readonly timestamp: string;
}

export interface LocalExecutionEnvelope {
  readonly envelope: "DNA_OS_LOCAL_EXECUTION";
  readonly source: "DNA_OS_RUNTIME";
  readonly work_id: string;
  readonly execution_id: string;
  readonly ai_client_id: string;
  readonly capability: LocalCapabilityName;
  readonly resource_id: string;
  readonly authority_decision: AuthorityDecision;
  readonly execution_locality: ExecutionLocality;
  readonly files_read_count: number;
  readonly files_written_count: number;
  readonly network_egress_bytes: number;
  readonly external_ai_bytes_sent: number;
  readonly started_at: string;
  readonly completed_at: string;
  readonly result_status: "COMPLETED" | "DENIED" | "BLOCKED" | "OWNER_APPROVAL_REQUIRED";
}

export interface LocalObservabilityEvent {
  readonly event: LocalObservabilityEventType;
  readonly timestamp: string;
  readonly work_id: string | null;
  readonly session_id?: string;
  readonly resource_id?: string;
  readonly authority_decision?: AuthorityDecision;
  readonly locality?: ExecutionLocality;
  readonly execution_id?: string;
  readonly detail?: string;
  readonly action?: string;
  readonly bytes?: number;
  readonly result_status?: LocalExecutionEnvelope["result_status"];
}

export interface ApplicationActionV1 {
  readonly action_id: string;
  readonly action_type: ApplicationActionType;
  readonly capability: LocalCapabilityName;
  readonly input_schema: Record<string, unknown>;
  readonly authority_required: AuthorityRequired;
}

export interface ApplicationResourceV1 {
  readonly schema: typeof APPLICATION_RESOURCE_SCHEMA;
  readonly application_id: string;
  readonly bundle_id: string;
  readonly executable_identity: string;
  readonly version: string;
  readonly capabilities: readonly LocalCapabilityName[];
  readonly allowed_actions: readonly ApplicationActionV1[];
  readonly data_scope: readonly string[];
  readonly network_behavior: NetworkEgressPolicy;
  readonly authority_required: AuthorityRequired;
  readonly adapter: "control/local-resource-access/application-adapter.ts";
  readonly availability: Availability;
  readonly usage_authorized: boolean;
  readonly everyday_actions: readonly EverydayActionId[];
}

export interface LocalProcessJobV1 {
  readonly schema: typeof LOCAL_PROCESS_GATE_SCHEMA;
  readonly job_id: string;
  readonly executable_id: string;
  readonly argv: readonly string[];
  readonly cwd_policy: "REPO_ROOT";
  readonly environment_allowlist: readonly string[];
  readonly network_policy: "none";
  readonly timeout_ms: number;
  readonly resource_limits: { readonly max_runtime_ms: number };
  readonly side_effect_class: ProcessSideEffectClass;
  readonly authority_required: AuthorityRequired;
  readonly evidence_policy: EvidencePolicy;
}

export interface OwnerMachinePolicyV1 {
  readonly schema: typeof OWNER_MACHINE_POLICY_SCHEMA;
  readonly policy_id: string;
  readonly ai_identity: string;
  readonly session_id: string;
  readonly visible_resource_ids: readonly string[];
  readonly read_only_capabilities: readonly LocalCapabilityName[];
  readonly approval_required_capabilities: readonly LocalCapabilityName[];
  readonly local_only_resource_ids: readonly string[];
  readonly allowed_network_destinations: readonly string[];
  readonly enabled_application_actions: readonly string[];
  readonly expires_at: string | null;
  readonly effect: AuthorityDecision;
  readonly issued_at: string;
}

export interface AnomalyObservation {
  readonly class: AnomalyClass;
  readonly kind: string;
  readonly detail: string;
  readonly automatic_remediation: false;
}

export interface InvokeLocalCapabilityInput {
  readonly ai_client_id: string;
  readonly session_id: string;
  readonly work_id: string;
  readonly capability: LocalCapabilityName;
  readonly resource_id: string;
  readonly input: Record<string, unknown>;
}

export interface InvokeLocalCapabilityResult {
  readonly ok: boolean;
  readonly authority: AuthorityResult;
  readonly envelope: LocalExecutionEnvelope;
  readonly result: Record<string, unknown>;
  readonly egress: DataEgressRecord;
}

export interface MachineCapabilityInventoryV1 {
  readonly schema: typeof MACHINE_CAPABILITY_INVENTORY_SCHEMA;
  readonly machine_resource_id: string;
  readonly resource_type: LocalResourceType | "APPLICATION" | "REMOTE_SERVICE";
  readonly application_id: string | null;
  readonly bundle_id: string | null;
  readonly executable_identity: string | null;
  readonly version: string | null;
  readonly availability: Availability;
  readonly adapter_available: boolean;
  readonly connection_required: boolean;
  readonly credential_ref_present: boolean;
  readonly capabilities_declared: readonly BindableActionId[];
  readonly capabilities_verified: readonly BindableActionId[];
  readonly data_locations: readonly string[];
  readonly network_dependency: NetworkEgressPolicy;
  readonly locality: ExecutionLocality | "LOCAL" | "REMOTE";
  readonly owner_authority_state: AuthorityDecision;
  readonly lifecycle: InventoryLifecycle;
  readonly last_verified_at: string | null;
  readonly category: ApplicationCategory | "REMOTE" | "MACHINE";
}

export interface RemoteServiceCapabilityBindingV1 {
  readonly schema: typeof REMOTE_SERVICE_CAPABILITY_BINDING_SCHEMA;
  readonly service_id: string;
  readonly provider: string;
  readonly connection_id: string | null;
  readonly account_identity_non_secret: string | null;
  readonly credential_ref: string | null;
  readonly availability: RemoteBindingAvailability;
  readonly capabilities: readonly BindableActionId[];
  readonly canonical_action_mapping: readonly {
    readonly action: BindableActionId;
    readonly canonical: EverydayActionId | null;
    readonly states: CapabilityAtomState;
  }[];
  readonly data_classes: readonly DataResourceClass[];
  readonly network_destinations: readonly string[];
  readonly owner_authority_state: AuthorityDecision;
  readonly read_scope: readonly string[];
  readonly write_scope: readonly string[];
  readonly publish_scope: readonly string[];
  readonly evidence_policy: EvidencePolicy;
}

export interface OwnerCapabilityBindingPolicyV1 {
  readonly schema: typeof OWNER_CAPABILITY_BINDING_POLICY_SCHEMA;
  readonly policy_id: string;
  readonly ai_identity: string;
  readonly session_id: string;
  readonly enabled_binding_ids: readonly string[];
  readonly allowed_actions: readonly BindableActionId[];
  readonly visible_data_classes: readonly DataResourceClass[];
  readonly approval_required_actions: readonly BindableActionId[];
  readonly allowed_connection_ids: readonly string[];
  readonly read_scope: readonly string[];
  readonly write_scope: readonly string[];
  readonly publish_scope: readonly string[];
  readonly network_destinations: readonly string[];
  readonly expires_at: string | null;
  readonly effect: AuthorityDecision;
  readonly issued_at: string;
}
