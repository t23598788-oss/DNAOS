/**
 * DNA OS Communication Registry — TypeScript Contract
 * Unified schema interfaces for all communication channel registries
 */

export type HealthStatus = "READY" | "CONFIGURING" | "DISABLED" | "DEPRECATED" | "BROKEN" | "UNKNOWN";
export type LifecycleValue = "ACTIVE" | "DISABLED" | "NOT_CONFIGURED" | "UNKNOWN";
export type AuthoritySource = "source_of_truth" | "runtime_only" | "generated" | "editable";

export interface CommunicationCapability {
  enabled: boolean;
  status: LifecycleValue;
  note?: string;
}

export interface CommunicationCapabilities {
  receive_message?: CommunicationCapability;
  send_message?: CommunicationCapability;
  reply?: CommunicationCapability;
  broadcast?: CommunicationCapability;
  attachment?: CommunicationCapability;
  location?: CommunicationCapability;
  rich_menu?: CommunicationCapability;
  webhook?: CommunicationCapability;
  voice_call?: CommunicationCapability;
  video_call?: CommunicationCapability;
  payment?: CommunicationCapability;
  notification?: CommunicationCapability;
  [key: string]: CommunicationCapability | undefined;
}

export interface RuntimePolicy {
  allow_ai_reply: boolean;
  allow_auto_reply: boolean;
  allow_broadcast: boolean;
  allow_push: boolean;
  allow_schedule: boolean;
  allow_document: boolean;
  allow_payment: boolean;
}

export interface SecurityContract {
  required_env: string[];
  secret_keys: string[];
  verify_signature: boolean;
  permission_scope: string[];
  encryption: string | null;
  token_rotation: string | null;
}

export interface DependencyGraph {
  required_services: string[];
  required_env: string[];
  required_drivers: string[];
  required_modules: string[];
}

export interface MonitoringConfig {
  metrics: string[];
  logging: { level: string; table: string | null };
  trace: boolean;
  audit: boolean;
  last_check: string | null;
  last_error: string | null;
  health_score: number | null;
}

export interface TopologyNode {
  label: string;
  status: LifecycleValue;
  [key: string]: unknown;
}

export interface Topology {
  _description?: string;
  flow: string[];
  nodes: Record<string, TopologyNode>;
  zombie_receivers?: unknown[];
}

export interface CommunicationRegistry {
  version: number;
  schema_version: string;
  channel_type: string;
  last_updated: string;
  compatibility: string[];
  deprecated_since: string | null;
  migration_required: boolean;
  authority: {
    source: AuthoritySource;
    managed_by: string;
    owner: string;
    last_verified: string | null;
    policy_note?: string;
  };
  health: {
    status: HealthStatus;
    last_check: string | null;
    last_error: string | null;
    health_score: number | null;
  };
  depends_on: DependencyGraph;
  lifecycle: Record<string, string>;
  policy: RuntimePolicy;
  security: SecurityContract;
  capabilities: CommunicationCapabilities;
  topology: Topology;
  channel: Record<string, unknown>;
  pipeline: Record<string, unknown>;
  monitoring: MonitoringConfig;
  cleanup_required: unknown[];
  metadata: { use_cases: string[]; note: string };
  // optional channel-specific extensions
  apis?: Record<string, unknown>;
  notify?: Record<string, unknown>;
  oa_features?: Record<string, unknown>;
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  channel: string;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface CommunicationManifest {
  version: number;
  last_updated: string;
  channels: Record<string, { file: string; channel_type: string; status: string; priority: number }>;
  active_channels: string[];
  default_channel: string;
  primary_channel: string;
  enabled_channels: string[];
  disabled_channels: string[];
  channel_priority: string[];
  fallback_order: string[];
  routing_policy: { default_outbound: string; fallback: string | null; note: string };
}
