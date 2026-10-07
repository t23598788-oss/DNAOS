export const DNA_OS_CANONICAL_INFORMATION_BACKEND = "DNA_OS_CANONICAL_INFORMATION_BACKEND_V1" as const;

export const ENTITY_TYPES = [
  "SYSTEM", "CAPABILITY", "APPLICATION", "LOCAL_TOOL", "DEVICE", "RESOURCE", "FILE", "DOCUMENT",
  "REPOSITORY", "MODULE", "SERVICE", "CONNECTION", "PROVIDER", "WORK", "WORK_ORDER", "ARTIFACT",
  "DEPLOYMENT_TARGET", "DEPLOYMENT", "RUNTIME", "CLIENT", "OWNER_SURFACE", "NOTIFICATION", "EVENT",
] as const;
export type EntityType = typeof ENTITY_TYPES[number];

export const CANONICAL_ENUMS = [
  "VERIFIED", "UNVERIFIED", "PARTIALLY_VERIFIED", "CONNECTED", "NOT_WIRED", "BLOCKED",
  "NOT_AVAILABLE", "AVAILABLE", "OWNER_ENABLED", "OWNER_DISABLED", "READY", "NOT_READY",
  "RUNNING", "COMPLETED", "FAILED", "UNKNOWN", "FRESH", "STALE",
] as const;
export type CanonicalEnum = typeof CANONICAL_ENUMS[number];

export const RELATIONSHIP_TYPES = [
  "USES", "PRODUCES", "DEPENDS_ON", "RUNS_ON", "DEPLOYED_TO", "CONNECTS_TO", "EXPOSES",
  "IMPLEMENTS", "REGISTERED_AS", "OWNED_BY", "AUTHORIZES", "READS", "WRITES", "PUBLISHES_TO",
  "VERIFIED_BY", "DERIVED_FROM", "BLOCKED_BY",
] as const;
export type RelationshipType = typeof RELATIONSHIP_TYPES[number];

export const DETAIL_LEVELS = ["SUMMARY", "STANDARD", "DETAILED", "EVIDENCE"] as const;
export type DetailLevel = typeof DETAIL_LEVELS[number];

export const SOURCE_PRECEDENCE = [
  "LIVE_VERIFIED_RUNTIME_FACT",
  "VERIFIED_CANONICAL_REGISTRY",
  "VERIFIED_EVIDENCE",
  "DECLARED_REGISTRY",
  "SOURCE_INSPECTION",
  "UNKNOWN",
] as const;
export type SourcePrecedence = typeof SOURCE_PRECEDENCE[number];

export interface CanonicalEntityV1 {
  readonly schema: "CANONICAL_INFORMATION_ENTITY_V1";
  readonly entity_id: string;
  readonly entity_type: EntityType;
  readonly canonical_name: string;
  readonly display_name: string;
  readonly domain: string;
  readonly status: CanonicalEnum;
  readonly verification: CanonicalEnum;
  readonly availability: CanonicalEnum;
  readonly authority_state: CanonicalEnum;
  readonly owner_enabled: boolean;
  readonly source_system: string;
  readonly source_ref: string;
  readonly relationships: readonly string[];
  readonly evidence_refs: readonly string[];
  readonly created_at: string;
  readonly updated_at: string;
  readonly version: number;
}

export interface CanonicalFactV1 {
  readonly schema: "CANONICAL_FACT_V1";
  readonly fact_id: string;
  readonly entity_id: string;
  readonly fact_type: string;
  readonly key: string;
  readonly value: string | number | boolean | null;
  readonly value_type: "string" | "number" | "boolean" | "null";
  readonly verification: CanonicalEnum;
  readonly source_ref: string;
  readonly evidence_refs: readonly string[];
  readonly observed_at: string;
  readonly valid_from: string;
  readonly valid_until: string | null;
  readonly version: number;
  readonly freshness_state: "FRESH" | "STALE" | "UNKNOWN";
  readonly ttl_ms: number;
  readonly stale_after: string;
  readonly source_precedence: SourcePrecedence;
}

export interface CanonicalRelationshipV1 {
  readonly schema: "CANONICAL_RELATIONSHIP_V1";
  readonly relationship_id: string;
  readonly from_entity_id: string;
  readonly relationship_type: RelationshipType;
  readonly to_entity_id: string;
  readonly status: CanonicalEnum;
  readonly verification: CanonicalEnum;
  readonly authority_boundary: boolean;
  readonly evidence_refs: readonly string[];
  readonly updated_at: string;
}

export interface CanonicalBoundaryV1 {
  readonly schema: "CANONICAL_BOUNDARY_V1";
  readonly boundary_id: string;
  readonly connection_id: string;
  readonly source_entity_id: string;
  readonly target_entity_id: string;
  readonly capability: string;
  readonly status: CanonicalEnum;
  readonly verification: CanonicalEnum;
  readonly authority_required: boolean;
  readonly blocking_reason: string | null;
  readonly next_missing_boundary: string | null;
  readonly evidence_refs: readonly string[];
}

export interface CanonicalStateV1 {
  readonly schema: "CANONICAL_STATE_V1";
  readonly state_id: string;
  readonly entity_id: string;
  readonly state_type: string;
  readonly current_state: CanonicalEnum | string;
  readonly previous_state: CanonicalEnum | string | null;
  readonly verification: CanonicalEnum;
  readonly reason: string | null;
  readonly source_event_id: string | null;
  readonly evidence_refs: readonly string[];
  readonly changed_at: string;
  readonly version: number;
}

export interface CanonicalEventV1 {
  readonly schema: "CANONICAL_EVENT_V1";
  readonly event_id: string;
  readonly event_type: string;
  readonly entity_id: string;
  readonly work_id: string | null;
  readonly command_id: string | null;
  readonly source_system: string;
  readonly previous_state: string | null;
  readonly current_state: string | null;
  readonly severity: "INFO" | "WARN" | "ERROR";
  readonly owner_attention: boolean;
  readonly action_required: boolean;
  readonly grants_authority: false;
  readonly evidence_refs: readonly string[];
  readonly occurred_at: string;
  readonly received_at: string;
  readonly version: number;
}

export interface CanonicalActivityV1 {
  readonly schema: "CANONICAL_ACTIVITY_V1";
  readonly activity_id: string;
  readonly work_id: string;
  readonly actor_type: string;
  readonly actor_id: string;
  readonly subject: string;
  readonly goal: string;
  readonly current_stage: string;
  readonly current_component: string;
  readonly status: CanonicalEnum | string;
  readonly started_at: string;
  readonly last_activity_at: string;
  readonly completed_at: string | null;
  readonly evidence_refs: readonly string[];
}

export interface CanonicalEvidenceIndexV1 {
  readonly schema: "CANONICAL_EVIDENCE_INDEX_V1";
  readonly evidence_id: string;
  readonly evidence_type: string;
  readonly source_system: string;
  readonly entity_refs: readonly string[];
  readonly work_id: string | null;
  readonly command_id: string | null;
  readonly resource_ref: string;
  readonly hash: string;
  readonly timestamp: string;
  readonly availability: CanonicalEnum;
  readonly storage_ref: string;
}

export interface OwnerInformationProjectionV1 {
  readonly schema: "OWNER_INFORMATION_PROJECTION_V1";
  readonly projection_id: string;
  readonly entity_id: string;
  readonly projection_type: string;
  readonly title: string;
  readonly summary: string;
  readonly status: CanonicalEnum | string;
  readonly verification: CanonicalEnum;
  readonly primary_facts: Readonly<Record<string, string | number | boolean | null>>;
  readonly important_relationships: readonly string[];
  readonly warnings: readonly string[];
  readonly blocked_items: readonly string[];
  readonly available_actions: readonly string[];
  readonly evidence_refs: readonly string[];
  readonly updated_at: string;
  readonly FRONTEND_CAN_REINTERPRET_STATE: false;
  readonly FRONTEND_CAN_GRANT_AUTHORITY: false;
  readonly FRONTEND_CAN_INVENT_ACTION: false;
  readonly INFORMATION_ACCESS_GRANTS_AUTHORITY: false;
}

export interface CanonicalConsumerPayloadV1 {
  readonly schema: "CANONICAL_CONSUMER_PAYLOAD_V1";
  readonly schema_version: "1";
  readonly projection_type: string;
  readonly entity_refs: readonly string[];
  readonly structured_data: Readonly<Record<string, unknown>>;
  readonly human_summary: string;
  readonly allowed_actions: readonly string[];
  readonly evidence_refs: readonly string[];
  readonly freshness: "FRESH" | "STALE" | "UNKNOWN";
  readonly generated_at: string;
}

export interface CanonicalStoreV1 {
  entities: CanonicalEntityV1[];
  facts: CanonicalFactV1[];
  relationships: CanonicalRelationshipV1[];
  boundaries: CanonicalBoundaryV1[];
  states: CanonicalStateV1[];
  events: CanonicalEventV1[];
  activities: CanonicalActivityV1[];
  evidence: CanonicalEvidenceIndexV1[];
  metrics: {
    REGISTERED_FACT_CACHE_HITS: number;
    SOURCE_SEARCH_FALLBACKS: number;
    SOURCE_SEARCH_BYTES_AVOIDED: number;
    CANONICAL_QUERY_BYTES: number;
  };
}
