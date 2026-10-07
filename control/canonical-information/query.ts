import { getStore, nowIso } from "./store";
import { ensureSafeCanonicalIngest } from "./ingest-safe";
import type {
  CanonicalActivityV1,
  CanonicalBoundaryV1,
  CanonicalConsumerPayloadV1,
  CanonicalEntityV1,
  CanonicalEventV1,
  CanonicalFactV1,
  CanonicalRelationshipV1,
  CanonicalStateV1,
  DetailLevel,
  EntityType,
  OwnerInformationProjectionV1,
} from "./types";
import { bytesOf } from "./store";

function hit(bytes: number): void {
  const store = getStore();
  store.metrics.REGISTERED_FACT_CACHE_HITS += 1;
  store.metrics.CANONICAL_QUERY_BYTES += bytes;
}

export function queryEntityById(entity_id: string): CanonicalEntityV1 | null {
  ensureSafeCanonicalIngest();
  const row = getStore().entities.find((item) => item.entity_id === entity_id) ?? null;
  if (row) hit(bytesOf(row));
  else getStore().metrics.SOURCE_SEARCH_FALLBACKS += 1;
  return row;
}

export function queryEntityByCanonicalName(name: string): CanonicalEntityV1 | null {
  ensureSafeCanonicalIngest();
  const row = getStore().entities.find((item) => item.canonical_name === name) ?? null;
  if (row) hit(bytesOf(row));
  return row;
}

export function listEntitiesByType(type: EntityType): readonly CanonicalEntityV1[] {
  ensureSafeCanonicalIngest();
  const rows = getStore().entities.filter((item) => item.entity_type === type).sort((a, b) => a.entity_id.localeCompare(b.entity_id));
  hit(bytesOf(rows));
  return rows;
}

export function listEntitiesByStatus(status: string): readonly CanonicalEntityV1[] {
  ensureSafeCanonicalIngest();
  const rows = getStore().entities.filter((item) => item.status === status);
  hit(bytesOf(rows));
  return rows;
}

export function getFacts(entity_id?: string): readonly CanonicalFactV1[] {
  ensureSafeCanonicalIngest();
  const rows = getStore().facts.filter((item) => !entity_id || item.entity_id === entity_id);
  hit(bytesOf(rows));
  return rows;
}

export function getRelationships(entity_id?: string): readonly CanonicalRelationshipV1[] {
  ensureSafeCanonicalIngest();
  const rows = getStore().relationships.filter((item) => !entity_id || item.from_entity_id === entity_id || item.to_entity_id === entity_id);
  hit(bytesOf(rows));
  return rows;
}

export function getBoundaries(connection_id?: string): readonly CanonicalBoundaryV1[] {
  ensureSafeCanonicalIngest();
  const rows = getStore().boundaries.filter((item) => !connection_id || item.connection_id === connection_id);
  hit(bytesOf(rows));
  return rows;
}

export function queryBoundary(source: string, destination: string): CanonicalBoundaryV1 | null {
  ensureSafeCanonicalIngest();
  const needle = `${source} → ${destination}`;
  const row = getStore().boundaries.find((item) =>
    item.capability === needle
    || (item.source_entity_id.includes(source) && item.target_entity_id.includes(destination))
    || (item.source_entity_id === source && item.target_entity_id === destination)
  ) ?? null;
  if (row) hit(bytesOf(row));
  return row;
}

export function getCurrentState(entity_id: string): CanonicalStateV1 | null {
  ensureSafeCanonicalIngest();
  const rows = getStore().states.filter((item) => item.entity_id === entity_id).sort((a, b) => a.version - b.version);
  const row = rows[rows.length - 1] ?? null;
  if (row) hit(bytesOf(row));
  return row;
}

export function getRecentEvents(limit = 20): readonly CanonicalEventV1[] {
  ensureSafeCanonicalIngest();
  const rows = getStore().events.slice(-limit);
  hit(bytesOf(rows));
  return rows;
}

export function getActiveActivities(): readonly CanonicalActivityV1[] {
  ensureSafeCanonicalIngest();
  const rows = getStore().activities.filter((item) => item.completed_at === null);
  hit(bytesOf(rows));
  return rows;
}

export function getEvidenceRefs(entity_id?: string): readonly string[] {
  ensureSafeCanonicalIngest();
  const rows = getStore().evidence.filter((item) => !entity_id || item.entity_refs.includes(entity_id));
  hit(bytesOf(rows));
  return rows.map((item) => item.storage_ref);
}

export function projectOwnerInformation(entity_id: string, projection_type: string, level: DetailLevel = "STANDARD"): OwnerInformationProjectionV1 | null {
  const entity = queryEntityById(entity_id);
  if (!entity) return null;
  const facts = getFacts(entity_id);
  const rels = getRelationships(entity_id);
  const primary: Record<string, string | number | boolean | null> = {};
  for (const row of facts) {
    if (level === "SUMMARY" && Object.keys(primary).length >= 4) break;
    primary[row.key] = row.value;
  }
  const blocked = getBoundaries().filter((item) => item.status === "NOT_WIRED" || item.status === "BLOCKED").slice(0, level === "SUMMARY" ? 3 : 20);
  return {
    schema: "OWNER_INFORMATION_PROJECTION_V1",
    projection_id: `proj:${projection_type}:${entity_id}:${level}`,
    entity_id,
    projection_type,
    title: entity.display_name,
    summary: `${entity.entity_type} ${entity.canonical_name} status=${entity.status} verification=${entity.verification}`,
    status: entity.status,
    verification: entity.verification,
    primary_facts: primary,
    important_relationships: rels.map((row) => `${row.relationship_type}:${row.to_entity_id}`),
    warnings: entity.availability === "NOT_AVAILABLE" ? ["NOT_AVAILABLE"] : [],
    blocked_items: blocked.map((row) => `${row.capability}=${row.status}`),
    available_actions: entity.entity_type === "CAPABILITY" ? ["READ"] : ["READ"],
    evidence_refs: level === "EVIDENCE" ? entity.evidence_refs : entity.evidence_refs.slice(0, 3),
    updated_at: nowIso(),
    FRONTEND_CAN_REINTERPRET_STATE: false,
    FRONTEND_CAN_GRANT_AUTHORITY: false,
    FRONTEND_CAN_INVENT_ACTION: false,
    INFORMATION_ACCESS_GRANTS_AUTHORITY: false,
  };
}

export function consumerPayload(entity_id: string, projection_type: string): CanonicalConsumerPayloadV1 | null {
  const projection = projectOwnerInformation(entity_id, projection_type, "STANDARD");
  if (!projection) return null;
  const facts = getFacts(entity_id);
  const stale = facts.some((row) => row.freshness_state === "STALE");
  return {
    schema: "CANONICAL_CONSUMER_PAYLOAD_V1",
    schema_version: "1",
    projection_type,
    entity_refs: [entity_id],
    structured_data: {
      name: projection.title,
      status: projection.status,
      availability: queryEntityById(entity_id)?.availability ?? "UNKNOWN",
      authority_state: queryEntityById(entity_id)?.authority_state ?? "UNKNOWN",
      actions: projection.available_actions,
      facts: projection.primary_facts,
    },
    human_summary: projection.summary,
    allowed_actions: projection.available_actions,
    evidence_refs: projection.evidence_refs,
    freshness: stale ? "STALE" : "FRESH",
    generated_at: nowIso(),
  };
}

export function documentationProjection(): Record<string, unknown> {
  ensureSafeCanonicalIngest();
  hit(64);
  return {
    schema: "DOCUMENTATION_INFORMATION_PROJECTION_V1",
    system_description: queryEntityByCanonicalName("dna-os"),
    capabilities: listEntitiesByType("CAPABILITY").map((row) => row.canonical_name),
    interfaces: listEntitiesByType("CONNECTION").map((row) => row.canonical_name),
    dependencies: getRelationships().filter((row) => row.relationship_type === "DEPENDS_ON"),
    authority_boundaries: getBoundaries().filter((row) => row.authority_required),
    runtime_status: getCurrentState("entity:system:dna-os"),
    known_limitations: getBoundaries().filter((row) => row.status === "NOT_WIRED").map((row) => row.capability),
    evidence_source_refs: getEvidenceRefs(),
    SOURCE_SEARCH_REQUIRED: false,
  };
}

export function canonicalMetrics(): Record<string, number> {
  const store = getStore();
  return {
    CANONICAL_ENTITIES: store.entities.length,
    CANONICAL_FACTS: store.facts.length,
    CANONICAL_RELATIONSHIPS: store.relationships.length,
    CANONICAL_BOUNDARIES: store.boundaries.length,
    CANONICAL_EVENTS: store.events.length,
    ACTIVE_ACTIVITIES: store.activities.filter((row) => row.completed_at === null).length,
    EVIDENCE_INDEX_ENTRIES: store.evidence.length,
    ...store.metrics,
  };
}

export function frontendBoundary(): Record<string, boolean> {
  return {
    FRONTEND_CAN_REINTERPRET_STATE: false,
    FRONTEND_CAN_GRANT_AUTHORITY: false,
    FRONTEND_CAN_INVENT_ACTION: false,
    INFORMATION_ACCESS_GRANTS_AUTHORITY: false,
  };
}

export function invalidateEntity(entity_id: string, reason: string): void {
  const store = getStore();
  const current = getCurrentState(entity_id);
  store.facts = store.facts.map((row) => row.entity_id === entity_id
    ? { ...row, freshness_state: "STALE", version: row.version + 1, valid_until: nowIso() }
    : row);
  store.states.push({
    schema: "CANONICAL_STATE_V1",
    state_id: `state:${entity_id}:${(current?.version ?? 1) + 1}`,
    entity_id,
    state_type: current?.state_type ?? "availability",
    current_state: "STALE",
    previous_state: current?.current_state ?? null,
    verification: "UNVERIFIED",
    reason,
    source_event_id: `event:invalidate:${entity_id}`,
    evidence_refs: current?.evidence_refs ?? [],
    changed_at: nowIso(),
    version: (current?.version ?? 1) + 1,
  });
  store.events.push({
    schema: "CANONICAL_EVENT_V1",
    event_id: `event:invalidate:${entity_id}:${Date.now()}`,
    event_type: "STATE_CHANGED",
    entity_id,
    work_id: null,
    command_id: null,
    source_system: "CANONICAL_INFORMATION_INVALIDATION_V1",
    previous_state: current?.current_state ?? null,
    current_state: "STALE",
    severity: "WARN",
    owner_attention: true,
    action_required: false,
    grants_authority: false,
    evidence_refs: [],
    occurred_at: nowIso(),
    received_at: nowIso(),
    version: 1,
  });
}

export function liveVerifiedOverridesDocumentation(entity_id: string, key: string, liveValue: string | boolean | number): CanonicalFactV1 {
  const store = getStore();
  const t = nowIso();
  const next: CanonicalFactV1 = {
    schema: "CANONICAL_FACT_V1",
    fact_id: `fact:${entity_id}:${key}:live`,
    entity_id,
    fact_type: "LIVE",
    key,
    value: liveValue,
    value_type: typeof liveValue as "string" | "number" | "boolean",
    verification: "VERIFIED",
    source_ref: "LIVE_VERIFIED_RUNTIME_FACT",
    evidence_refs: ["LIVE_VERIFIED_RUNTIME_FACT"],
    observed_at: t,
    valid_from: t,
    valid_until: null,
    version: 2,
    freshness_state: "FRESH",
    ttl_ms: 30_000,
    stale_after: new Date(Date.now() + 30_000).toISOString(),
    source_precedence: "LIVE_VERIFIED_RUNTIME_FACT",
  };
  store.facts = store.facts.filter((row) => !(row.entity_id === entity_id && row.key === key && row.source_precedence !== "LIVE_VERIFIED_RUNTIME_FACT")).concat(next);
  return next;
}

export function resolveFact(entity_id: string, key: string): CanonicalFactV1 | null {
  const order = ["LIVE_VERIFIED_RUNTIME_FACT", "VERIFIED_CANONICAL_REGISTRY", "VERIFIED_EVIDENCE", "DECLARED_REGISTRY", "SOURCE_INSPECTION", "UNKNOWN"];
  const rows = getFacts(entity_id).filter((row) => row.key === key);
  rows.sort((a, b) => order.indexOf(a.source_precedence) - order.indexOf(b.source_precedence));
  return rows[0] ?? null;
}
