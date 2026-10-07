export const LOCAL_TOOL_ADAPTER_FABRIC_SCHEMA = "LOCAL_TOOL_ADAPTER_FABRIC_V1" as const;
export const LOCAL_APP_CAPABILITY_REGISTRY_SCHEMA = "LOCAL_APP_CAPABILITY_REGISTRY_V1" as const;
export const DEVICE_RESOURCE_SCHEMA = "DEVICE_RESOURCE_V1" as const;
export const NATIVE_INTERFACE_FIRST_SCHEMA = "NATIVE_INTERFACE_FIRST_V1" as const;
export const LOCAL_TOOL_CHAIN_SCHEMA = "LOCAL_TOOL_CHAIN_V1" as const;
export const TOOL_CAPABILITY_HEALTH_SCHEMA = "TOOL_CAPABILITY_HEALTH_V1" as const;

export type AdapterType =
  | "MCP" | "WEBMCP" | "APP_INTENT" | "SHORTCUT" | "OFFICIAL_API" | "OFFICIAL_CLI"
  | "LOCAL_HTTP" | "LOCAL_SOCKET" | "URL_SCHEME" | "FILE_INTERFACE" | "DATABASE_INTERFACE"
  | "PROCESS_GATE" | "OS_SERVICE" | "DEVICE_INTERFACE" | "ACCESSIBILITY_FALLBACK";

export type AdapterLifecycle =
  | "DISCOVERED" | "INTERFACE_FOUND" | "ADAPTER_REGISTERED" | "CAPABILITY_VERIFIED"
  | "OWNER_ENABLED" | "UNAVAILABLE" | "UNSUPPORTED";

export type DeviceType =
  | "DISPLAY" | "AUDIO_INPUT" | "AUDIO_OUTPUT" | "CAMERA" | "PRINTER"
  | "SCANNER" | "STORAGE_DEVICE" | "NETWORK_INTERFACE";

export interface LocalToolAdapterV1 {
  readonly schema: typeof LOCAL_TOOL_ADAPTER_FABRIC_SCHEMA;
  readonly adapter_id: string;
  readonly adapter_type: AdapterType;
  readonly resource_id: string | null;
  readonly application_id: string | null;
  readonly service_id: string | null;
  readonly device_id: string | null;
  readonly discovery_source: string;
  readonly transport: string;
  readonly executable_or_endpoint_identity: string | null;
  readonly capabilities_declared: readonly string[];
  readonly capabilities_verified: readonly string[];
  readonly canonical_action_mapping: readonly { readonly native: string; readonly canonical: string }[];
  readonly input_schema: Record<string, unknown>;
  readonly output_schema: Record<string, unknown>;
  readonly accepted_input_types: readonly string[];
  readonly returned_output_types: readonly string[];
  readonly resource_handles_accepted: readonly string[];
  readonly resource_handles_returned: readonly string[];
  readonly read_scope: readonly string[];
  readonly write_scope: readonly string[];
  readonly execute_scope: readonly string[];
  readonly network_scope: readonly string[];
  readonly authority_required: "OWNER_GRANT" | "OWNER_APPROVAL_REQUIRED";
  readonly side_effect_class: string;
  readonly availability: AdapterLifecycle;
  readonly runtime_verified: boolean;
  readonly owner_enabled: boolean;
  readonly evidence_policy: "LOCAL_EXECUTION_ENVELOPE";
  readonly grants_authority: false;
  readonly gateway_capability: string | null;
}

export interface DeviceResourceV1 {
  readonly schema: typeof DEVICE_RESOURCE_SCHEMA;
  readonly device_id: string;
  readonly device_type: DeviceType;
  readonly hardware_identity_non_secret: string;
  readonly connection_type: string;
  readonly availability: "AVAILABLE" | "UNAVAILABLE" | "DISCOVERED";
  readonly capabilities: readonly string[];
  readonly input_classes: readonly string[];
  readonly output_classes: readonly string[];
  readonly locality: "THIS_MACHINE";
  readonly authority_required: "OWNER_GRANT";
  readonly owner_enabled: boolean;
  readonly evidence_policy: "LOCAL_EXECUTION_ENVELOPE";
  readonly grants_authority: false;
  readonly resource_id: string | null;
}

export interface LocalAppCapabilityRegistryV1 {
  readonly schema: typeof LOCAL_APP_CAPABILITY_REGISTRY_SCHEMA;
  readonly application_id: string;
  readonly display_name: string;
  readonly bundle_executable_identity: string;
  readonly installed_version: string | null;
  readonly available_adapter_types: readonly AdapterType[];
  readonly verified_capabilities: readonly string[];
  readonly canonical_actions: readonly string[];
  readonly classification: "READ" | "WRITE" | "EXECUTE" | "NONE";
  readonly network_behavior: string;
  readonly owner_authority_state: "ALLOW" | "DENY";
  readonly runtime_availability: string;
  readonly category_does_not_imply_capability: true;
}

export interface ToolCapabilityHealthV1 {
  readonly schema: typeof TOOL_CAPABILITY_HEALTH_SCHEMA;
  readonly tool_id: string;
  readonly installed: boolean;
  readonly reachable: boolean;
  readonly version: string | null;
  readonly adapter_healthy: boolean;
  readonly authentication_required: boolean;
  readonly runtime_verified: boolean;
  readonly last_successful_invocation: string | null;
  readonly last_error: string | null;
  readonly owner_enabled: boolean;
  readonly APPLICATION_INSTALLED: boolean;
  readonly ADAPTER_AVAILABLE: boolean;
  readonly CAPABILITY_VERIFIED: boolean;
  readonly AUTHORIZED: boolean;
}

export const NATIVE_INTERFACE_ORDER = [
  "OWNER_POLICY",
  "VERIFIED_CAPABILITY",
  "STRUCTURED_NATIVE_INTERFACE",
  "OFFICIAL_API_CLI",
  "LOCAL_SERVICE",
  "PROCESS_GATE",
  "ACCESSIBILITY_FALLBACK",
] as const;

export const ADAPTER_PREFERENCE: Readonly<Record<AdapterType, number>> = {
  FILE_INTERFACE: 1,
  APP_INTENT: 1,
  MCP: 1,
  WEBMCP: 1,
  OFFICIAL_API: 2,
  OFFICIAL_CLI: 2,
  LOCAL_HTTP: 3,
  LOCAL_SOCKET: 3,
  OS_SERVICE: 3,
  DATABASE_INTERFACE: 3,
  DEVICE_INTERFACE: 3,
  URL_SCHEME: 3,
  SHORTCUT: 4,
  PROCESS_GATE: 4,
  ACCESSIBILITY_FALLBACK: 5,
};
