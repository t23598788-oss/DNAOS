export const AI_CLIENT_BINDING_SCHEMA = "AI_CLIENT_BINDING_V1" as const;
export const AI_CLIENT_RESULT_SCHEMA = "AI_CLIENT_RESULT_V1" as const;
export const AI_HANDOFF_SCHEMA = "AI_HANDOFF_V1" as const;

export type AiClientProvider = "openai" | "google" | "other";
export type AiClientType = "CHATGPT" | "GEMINI" | "GOOGLE_CHROME" | "MCP" | "SITE_TOOL" | "OTHER";
export type AiConnectionType = "MCP" | "WEBMCP" | "SITE_TOOL" | "NONE";
export type AiClientBindingState =
  | "DISCOVERED"
  | "CONNECTED"
  | "TOOL_DISCOVERY_VERIFIED"
  | "OWNER_ENABLED"
  | "SESSION_ACTIVE"
  | "BLOCKED";
export type SearchClass = "LOCAL_SEARCH" | "REMOTE_WEB_SEARCH" | "REMOTE_SERVICE_SEARCH";

export interface AiClientBindingV1 {
  readonly schema: typeof AI_CLIENT_BINDING_SCHEMA;
  readonly ai_client_id: string;
  readonly provider: AiClientProvider;
  readonly client_type: AiClientType;
  readonly connection_type: AiConnectionType;
  readonly session_id: string;
  readonly capabilities_requested: readonly string[];
  readonly capabilities_exposed: readonly string[];
  readonly owner_authority_state: "ALLOW" | "DENY";
  readonly locality: "EXTERNAL_AI" | "LOCAL";
  readonly data_egress_policy: "LOCAL_ONLY" | "MINIMIZED_EXTERNAL" | "DENIED" | "OWNER_APPROVAL_REQUIRED";
  readonly last_seen_at: string;
  readonly verification_state: AiClientBindingState;
  readonly binding_state: AiClientBindingState;
  readonly grants_authority: false;
}

export interface AiClientResultV1 {
  readonly schema: typeof AI_CLIENT_RESULT_SCHEMA;
  readonly client_id: string;
  readonly work_id: string;
  readonly execution_id: string | null;
  readonly canonical_action: string;
  readonly result_type: string;
  readonly canonical_view_type: string | null;
  readonly resource_refs: readonly string[];
  readonly locality: string;
  readonly source_bytes: number;
  readonly local_bytes_processed: number;
  readonly external_bytes_sent: number;
  readonly result_bytes: number;
  readonly approval_state: string;
  readonly evidence_refs: readonly string[];
  readonly status: string;
  readonly content?: string;
}

export interface AiHandoffV1 {
  readonly schema: typeof AI_HANDOFF_SCHEMA;
  readonly handoff_id: string;
  readonly from_client_id: string;
  readonly to_client_id: string;
  readonly work_id: string;
  readonly goal: string;
  readonly canonical_action: string;
  readonly resource_refs: readonly string[];
  readonly current_state: string;
  readonly structured_evidence_refs: readonly string[];
  readonly open_questions: readonly string[];
  readonly approved_working_context: Record<string, unknown>;
  readonly byte_count: number;
  readonly transcript_included: false;
  readonly created_at: string;
}

export const SITE_TOOL_ALLOWLIST: readonly string[] = [
  "dna_os.get_machine_inventory",
  "dna_os.list_local_resources",
  "dna_os.get_local_capabilities",
  "dna_os.render_canonical_view",
  "dna_os.open_owner_review",
  "dna_os.get_activity_view",
  "dna_os.create_action_preview",
  "dna_os.invoke_local_capability",
];

export const SIDE_EFFECT_CAPABILITIES: readonly string[] = [
  "local.file.copy", "local.file.move", "local.file.create", "local.file.rename",
  "local.file.delete", "local.file.share_external", "local.file.publish_external",
  "local.folder.create",
];
