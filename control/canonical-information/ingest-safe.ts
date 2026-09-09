/**
 * Safe ingest for conversation-runtime: connection index + capability summaries + surfaces.
 * No production pipeline, no command-router, no child_process.
 */

import { readCapabilitySummaries } from "../conversation-read-model/contract";
import { loadConnectionSummaries, queryConnectionBoundary } from "../conversation-runtime/connection-summary";
import { bytesOf, getStore, hashRef, nowIso, replaceStore } from "./store";
import type {
  CanonicalActivityV1,
  CanonicalBoundaryV1,
  CanonicalEntityV1,
  CanonicalEventV1,
  CanonicalEvidenceIndexV1,
  CanonicalFactV1,
  CanonicalRelationshipV1,
  CanonicalStateV1,
  CanonicalEnum,
} from "./types";

function entity(partial: Omit<CanonicalEntityV1, "schema" | "created_at" | "updated_at" | "version" | "relationships"> & { relationships?: readonly string[] }): CanonicalEntityV1 {
  const t = nowIso();
  return {
    schema: "CANONICAL_INFORMATION_ENTITY_V1",
    relationships: partial.relationships ?? [],
    created_at: t,
    updated_at: t,
    version: 1,
    ...partial,
  };
}

function fact(entity_id: string, key: string, value: string | number | boolean | null, source_ref: string, verification: CanonicalEnum = "VERIFIED"): CanonicalFactV1 {
  const t = nowIso();
  return {
    schema: "CANONICAL_FACT_V1",
    fact_id: `fact:${entity_id}:${key}`,
    entity_id,
    fact_type: "REGISTERED",
    key,
    value,
    value_type: value === null ? "null" : typeof value as "string" | "number" | "boolean",
    verification,
    source_ref,
    evidence_refs: [source_ref],
    observed_at: t,
    valid_from: t,
    valid_until: null,
    version: 1,
    freshness_state: "FRESH",
    ttl_ms: 300_000,
    stale_after: new Date(Date.now() + 300_000).toISOString(),
    source_precedence: "VERIFIED_CANONICAL_REGISTRY",
  };
}

function evidence(id: string, storage_ref: string, entity_refs: readonly string[]): CanonicalEvidenceIndexV1 {
  return {
    schema: "CANONICAL_EVIDENCE_INDEX_V1",
    evidence_id: id,
    evidence_type: "SOURCE_REF",
    source_system: "DNA_OS",
    entity_refs,
    work_id: null,
    command_id: null,
    resource_ref: storage_ref,
    hash: hashRef(storage_ref),
    timestamp: nowIso(),
    availability: "AVAILABLE",
    storage_ref,
  };
}

function mapStatus(value: string): CanonicalEnum {
  if (value === "VERIFIED" || value === "CONNECTED") return value;
  if (value === "BLOCKED" || value === "NOT_WIRED") return value;
  if (value === "NOT_VERIFIED") return "UNVERIFIED";
  return "UNKNOWN";
}

export function ingestSafeCanonicalSources(): void {
  const store = getStore();
  const { summaries, source } = loadConnectionSummaries();
  const caps = readCapabilitySummaries();
  const entities: CanonicalEntityV1[] = [...store.entities];
  const facts: CanonicalFactV1[] = [...store.facts];
  const relationships: CanonicalRelationshipV1[] = [...store.relationships];
  const boundaries: CanonicalBoundaryV1[] = [...store.boundaries];
  const states: CanonicalStateV1[] = [...store.states];
  const events: CanonicalEventV1[] = [...store.events];
  const activities: CanonicalActivityV1[] = [...store.activities];
  const evidenceRows: CanonicalEvidenceIndexV1[] = [...store.evidence];

  const systemId = "entity:system:dna-os";
  if (!entities.some((row) => row.entity_id === systemId)) {
    entities.push(entity({
      entity_id: systemId,
      entity_type: "SYSTEM",
      canonical_name: "dna-os",
      display_name: "DNA OS",
      domain: "SYSTEM",
      status: "AVAILABLE",
      verification: "VERIFIED",
      availability: "AVAILABLE",
      authority_state: "OWNER_ENABLED",
      owner_enabled: true,
      source_system: "DNA_OS",
      source_ref: "control/canonical-information",
      evidence_refs: [source],
    }));
    facts.push(fact(systemId, "name", "DNA OS", source));
    evidenceRows.push(evidence("ev:system", source, [systemId]));
    events.push({
      schema: "CANONICAL_EVENT_V1",
      event_id: "event:system:discovered",
      event_type: "DISCOVERED",
      entity_id: systemId,
      work_id: null,
      command_id: null,
      source_system: "CANONICAL_INFORMATION",
      previous_state: null,
      current_state: "AVAILABLE",
      severity: "INFO",
      owner_attention: false,
      action_required: false,
      grants_authority: false,
      evidence_refs: [source],
      occurred_at: nowIso(),
      received_at: nowIso(),
      version: 1,
    });
  }

  for (const surface of ["OPERATIONAL_OWNER_SURFACE", "DEVELOPMENT_CONTROL_SURFACE"] as const) {
    const id = `entity:surface:${surface}`;
    if (entities.some((row) => row.entity_id === id)) continue;
    entities.push(entity({
      entity_id: id,
      entity_type: "OWNER_SURFACE",
      canonical_name: surface,
      display_name: surface,
      domain: surface.startsWith("DEVELOP") ? "DEVELOPMENT" : "OPERATIONAL",
      status: "AVAILABLE",
      verification: "VERIFIED",
      availability: "AVAILABLE",
      authority_state: surface.startsWith("DEVELOP") ? "OWNER_DISABLED" : "OWNER_ENABLED",
      owner_enabled: false,
      source_system: "owner-surface-separation",
      source_ref: "control/owner-surface-separation/contract.ts",
      evidence_refs: ["control/owner-surface-separation/contract.ts"],
    }));
  }

  for (const cap of caps) {
    const id = `entity:capability:${cap.capability_id}`;
    if (entities.some((row) => row.entity_id === id)) continue;
    entities.push(entity({
      entity_id: id,
      entity_type: "CAPABILITY",
      canonical_name: cap.capability_id,
      display_name: cap.capability_id,
      domain: "CAPABILITY",
      status: "AVAILABLE",
      verification: "VERIFIED",
      availability: "AVAILABLE",
      authority_state: "OWNER_DISABLED",
      owner_enabled: false,
      source_system: "conversation-read-model",
      source_ref: "control/conversation-read-model/data/capability-summaries.json",
      evidence_refs: ["control/conversation-read-model/data/capability-summaries.json"],
    }));
    facts.push(fact(id, "capability_id", cap.capability_id, "control/conversation-read-model/data/capability-summaries.json"));
    facts.push(fact(id, "runtime_verified", false, "control/conversation-read-model/data/capability-summaries.json", "UNVERIFIED"));
    facts.push(fact(id, "owner_enabled", false, "control/conversation-read-model/data/capability-summaries.json"));
    facts.push(fact(id, "implementation_ref", cap.repo_id, "control/conversation-read-model/data/capability-summaries.json"));
    relationships.push({
      schema: "CANONICAL_RELATIONSHIP_V1",
      relationship_id: `rel:${systemId}:EXPOSES:${id}`,
      from_entity_id: systemId,
      relationship_type: "EXPOSES",
      to_entity_id: id,
      status: "VERIFIED",
      verification: "VERIFIED",
      authority_boundary: false,
      evidence_refs: ["control/conversation-read-model/data/capability-summaries.json"],
      updated_at: nowIso(),
    });
    evidenceRows.push(evidence(`ev:${id}`, "control/conversation-read-model/data/capability-summaries.json", [id]));
    states.push({
      schema: "CANONICAL_STATE_V1",
      state_id: `state:${id}:1`,
      entity_id: id,
      state_type: "availability",
      current_state: "AVAILABLE",
      previous_state: null,
      verification: "VERIFIED",
      reason: "published capability summary",
      source_event_id: null,
      evidence_refs: ["control/conversation-read-model/data/capability-summaries.json"],
      changed_at: nowIso(),
      version: 1,
    });
  }

  for (const row of summaries) {
    const id = `entity:connection:${row.connection_id}`;
    if (!entities.some((item) => item.entity_id === id)) {
      entities.push(entity({
        entity_id: id,
        entity_type: "CONNECTION",
        canonical_name: row.connection_id,
        display_name: row.system,
        domain: "CONNECTION",
        status: mapStatus(row.status),
        verification: mapStatus(String(row.verification === "VERIFIED" || row.verification === "CONNECTED" ? row.verification : "PARTIALLY_VERIFIED")),
        availability: row.status === "BLOCKED" ? "NOT_AVAILABLE" : "AVAILABLE",
        authority_state: "OWNER_DISABLED",
        owner_enabled: false,
        source_system: "connection-index",
        source_ref: row.evidence_ref,
        evidence_refs: [row.evidence_ref, source],
      }));
      facts.push(fact(id, "status", row.status, row.evidence_ref, mapStatus(row.status)));
      relationships.push({
        schema: "CANONICAL_RELATIONSHIP_V1",
        relationship_id: `rel:${systemId}:CONNECTS_TO:${id}`,
        from_entity_id: systemId,
        relationship_type: "CONNECTS_TO",
        to_entity_id: id,
        status: mapStatus(row.status),
        verification: "VERIFIED",
        authority_boundary: true,
        evidence_refs: [row.evidence_ref],
        updated_at: nowIso(),
      });
      evidenceRows.push(evidence(`ev:${id}`, row.evidence_ref, [id]));
    }
    const labels = [...row.verified_boundaries, ...row.blocked_boundaries, ...row.not_wired_boundaries];
    for (const label of labels) {
      const parts = label.split(" → ");
      const src = parts[0] ?? label;
      const dst = parts[1] ?? "unknown";
      const bid = `boundary:${row.connection_id}:${src}:${dst}`;
      if (boundaries.some((item) => item.boundary_id === bid)) continue;
      const status: CanonicalEnum = row.not_wired_boundaries.includes(label)
        ? "NOT_WIRED"
        : row.blocked_boundaries.includes(label)
          ? "BLOCKED"
          : "VERIFIED";
      boundaries.push({
        schema: "CANONICAL_BOUNDARY_V1",
        boundary_id: bid,
        connection_id: row.connection_id,
        source_entity_id: src,
        target_entity_id: dst,
        capability: label,
        status,
        verification: status === "VERIFIED" ? "VERIFIED" : "UNVERIFIED",
        authority_required: /AUTHORITY|publish|mutation|deploy/i.test(label),
        blocking_reason: status === "NOT_WIRED" ? "NOT_WIRED" : status === "BLOCKED" ? "BLOCKED" : null,
        next_missing_boundary: row.next_missing_boundary,
        evidence_refs: [row.evidence_ref],
      });
    }
  }

  const github = queryConnectionBoundary(summaries, "GITHUB_PUBLISH", "DEPLOYMENT_AUTHORITY");
  facts.push(fact(systemId, "deployment_mutation", false, source, "VERIFIED"));
  facts.push(fact(systemId, "github_publish_to_deployment_authority", github === "NOT_FOUND" ? "NOT_WIRED" : github, source, "VERIFIED"));

  const avoided = bytesOf(summaries) + bytesOf(caps);
  replaceStore({
    entities,
    facts,
    relationships,
    boundaries,
    states,
    events,
    activities,
    evidence: evidenceRows,
    metrics: {
      ...store.metrics,
      SOURCE_SEARCH_BYTES_AVOIDED: store.metrics.SOURCE_SEARCH_BYTES_AVOIDED + avoided,
    },
  });
}

export function ensureSafeCanonicalIngest(): void {
  if (getStore().entities.length === 0) ingestSafeCanonicalSources();
}
