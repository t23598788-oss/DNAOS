export const UNIVERSAL_CLIENT_SCHEMA = "UNIVERSAL_CLIENT_V1" as const;
export const OWNER_RESOURCE_ENVIRONMENT_SCHEMA = "OWNER_RESOURCE_ENVIRONMENT_V1" as const;
export const RESOURCE_HANDLE_SCHEMA = "RESOURCE_HANDLE_V1" as const;
export const OWNER_INTENT_REQUEST_SCHEMA = "OWNER_INTENT_REQUEST_V1" as const;
export const WORK_CONTEXT_SCHEMA = "WORK_CONTEXT_V1" as const;
export const OWNER_COMPUTE_FIRST_SCHEMA = "OWNER_COMPUTE_FIRST_V1" as const;

export type ClientFamily =
  | "AI_CHAT_CLIENT"
  | "AI_CODING_CLIENT"
  | "AI_LOCAL_ASSISTANT"
  | "WEB_SITE_TOOL_CLIENT"
  | "MCP_CLIENT"
  | "LOCAL_APPLICATION_CLIENT"
  | "REMOTE_MACHINE_CLIENT"
  | "HUMAN_UI_CLIENT"
  | "AUTOMATION_CLIENT";

export type EnvironmentType =
  | "LOCAL_MACHINE"
  | "OWNER_SERVER"
  | "OWNER_DATABASE"
  | "OWNER_STORAGE"
  | "OWNER_NETWORK"
  | "REMOTE_OWNER_MACHINE"
  | "CLOUD_RESOURCE_OWNED_BY_OWNER";

export interface UniversalClientV1 {
  readonly schema: typeof UNIVERSAL_CLIENT_SCHEMA;
  readonly client_id: string;
  readonly client_family: ClientFamily;
  readonly provider: string;
  readonly runtime_type: string;
  readonly device_identity: string;
  readonly connection_type: string;
  readonly protocol: string;
  readonly protocol_version: string;
  readonly authenticated_identity: string | null;
  readonly owner_binding: boolean;
  readonly capabilities_declared: readonly string[];
  readonly capabilities_verified: readonly string[];
  readonly session_work_scope: string;
  readonly data_access_scope: readonly string[];
  readonly action_scope: readonly string[];
  readonly egress_scope: readonly string[];
  readonly approval_scope: readonly string[];
  readonly availability: "AVAILABLE" | "PROVIDER_UNAVAILABLE" | "DISCONNECTED";
  readonly last_verified_at: string;
  readonly authenticated: boolean;
  readonly owner_authority_state: "ALLOW" | "DENY";
  readonly grants_authority: false;
}

export interface OwnerResourceEnvironmentV1 {
  readonly schema: typeof OWNER_RESOURCE_ENVIRONMENT_SCHEMA;
  readonly environment_id: string;
  readonly owner_id: "DNA_OS_OWNER";
  readonly environment_type: EnvironmentType;
  readonly machine_server_identity: string | null;
  readonly resource_bindings: readonly string[];
  readonly compute_capabilities: readonly string[];
  readonly storage_capabilities: readonly string[];
  readonly application_capabilities: readonly string[];
  readonly network_policy: string;
  readonly locality: string;
  readonly availability: "AVAILABLE" | "NOT_AVAILABLE";
  readonly authority_boundary: "OWNER";
  readonly ai_provider_infrastructure: false;
}

export interface ResourceHandleV1 {
  readonly schema: typeof RESOURCE_HANDLE_SCHEMA;
  readonly resource_handle: string;
  readonly resource_id: string;
  readonly environment_id: string;
  readonly data_class: string;
  readonly content_type: string;
  readonly size: number;
  readonly hash: string;
  readonly scope: readonly string[];
  readonly expiry: string | null;
  readonly allowed_operations: readonly string[];
  readonly owner_authority: "ALLOW" | "DENY";
  readonly evidence_ref: string | null;
  readonly raw_content_included: false;
}

export interface OwnerIntentRequestV1 {
  readonly schema: typeof OWNER_INTENT_REQUEST_SCHEMA;
  readonly request_id: string;
  readonly client_id: string;
  readonly goal: string;
  readonly canonical_action: string;
  readonly target_resource_refs: readonly string[];
  readonly destination_refs: readonly string[];
  readonly constraints: Record<string, unknown>;
  readonly requested_output: string;
  readonly approval_expectation: "NONE" | "OWNER_APPROVAL_REQUIRED";
  readonly is_authority: false;
}

export interface WorkContextV1 {
  readonly schema: typeof WORK_CONTEXT_SCHEMA;
  readonly work_id: string;
  readonly goal: string;
  readonly canonical_actions: readonly string[];
  readonly resource_handles: readonly string[];
  readonly completed_steps: readonly string[];
  readonly open_steps: readonly string[];
  readonly structured_results: Record<string, unknown>;
  readonly evidence_refs: readonly string[];
  readonly owner_decisions: readonly string[];
  readonly approved_ai_context: Record<string, unknown>;
  readonly byte_counts: {
    readonly source_bytes: number;
    readonly local_bytes_processed: number;
    readonly ai_context_bytes_sent: number;
    readonly ai_result_bytes: number;
  };
  readonly transcript_included: false;
}

export const MCP_PROTOCOL_COMPAT = {
  schema: "MCP_PROTOCOL_COMPAT_V1",
  target_spec: "2026-07-28",
  implemented: [
    "stateless_request_response",
    "self_describing_tools",
    "explicit_work_resource_handles",
    "deterministic_list_ordering",
    "cacheable_discovery_metadata",
    "method_tool_aware_routing",
  ] as const,
  oauth_issuer_validation: "NOT_USED",
  hidden_transport_session_for_authority: false,
  backward_compatible: true,
} as const;
