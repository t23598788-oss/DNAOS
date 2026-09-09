import { listPipelines } from "../work-production-pipeline/persist";
import { ingestSafeCanonicalSources } from "./ingest-safe";
import { getStore, nowIso } from "./store";
import type { CanonicalActivityV1, CanonicalEntityV1, CanonicalEventV1, CanonicalFactV1, CanonicalRelationshipV1 } from "./types";

export function ingestProductionCanonical(): void {
  ingestSafeCanonicalSources();
  const store = getStore();
  const rows = listPipelines();
  for (const row of rows) {
    const workId = `entity:work:${row.work_id}`;
    if (!store.entities.some((item) => item.entity_id === workId)) {
      const entity: CanonicalEntityV1 = {
        schema: "CANONICAL_INFORMATION_ENTITY_V1",
        entity_id: workId,
        entity_type: "WORK",
        canonical_name: row.work_id,
        display_name: row.intent.owner_goal,
        domain: row.lane,
        status: row.state === "FAILED" ? "FAILED" : row.state === "ACTIVE" ? "COMPLETED" : "RUNNING",
        verification: "VERIFIED",
        availability: "AVAILABLE",
        authority_state: "OWNER_DISABLED",
        owner_enabled: row.owner_enabled,
        source_system: "work-production-pipeline",
        source_ref: `pipeline:${row.work_id}`,
        relationships: [],
        evidence_refs: [`pipeline:${row.work_id}`],
        created_at: nowIso(),
        updated_at: nowIso(),
        version: 1,
      };
      store.entities.push(entity);
      const wo: CanonicalEntityV1 = {
        ...entity,
        entity_id: `entity:work-order:${row.work_order.work_order_id}`,
        entity_type: "WORK_ORDER",
        canonical_name: row.work_order.work_order_id,
        display_name: row.work_order.goal,
      };
      store.entities.push(wo);
      store.relationships.push({
        schema: "CANONICAL_RELATIONSHIP_V1",
        relationship_id: `rel:${workId}:PRODUCES:${wo.entity_id}`,
        from_entity_id: workId,
        relationship_type: "PRODUCES",
        to_entity_id: wo.entity_id,
        status: "VERIFIED",
        verification: "VERIFIED",
        authority_boundary: false,
        evidence_refs: [`pipeline:${row.work_id}`],
        updated_at: nowIso(),
      } satisfies CanonicalRelationshipV1);
      if (row.artifact_id) {
        store.relationships.push({
          schema: "CANONICAL_RELATIONSHIP_V1",
          relationship_id: `rel:${workId}:PRODUCES:artifact:${row.artifact_id}`,
          from_entity_id: workId,
          relationship_type: "PRODUCES",
          to_entity_id: `entity:artifact:${row.artifact_id}`,
          status: "VERIFIED",
          verification: "VERIFIED",
          authority_boundary: false,
          evidence_refs: [`pipeline:${row.work_id}`],
          updated_at: nowIso(),
        });
      }
    }
    const fact: CanonicalFactV1 = {
      schema: "CANONICAL_FACT_V1",
      fact_id: `fact:${workId}:state:${row.state}`,
      entity_id: workId,
      fact_type: "PIPELINE_STATE",
      key: "current_state",
      value: row.state,
      value_type: "string",
      verification: "VERIFIED",
      source_ref: `pipeline:${row.work_id}`,
      evidence_refs: [`pipeline:${row.work_id}`],
      observed_at: nowIso(),
      valid_from: nowIso(),
      valid_until: null,
      version: 1,
      freshness_state: "FRESH",
      ttl_ms: 60_000,
      stale_after: new Date(Date.now() + 60_000).toISOString(),
      source_precedence: "LIVE_VERIFIED_RUNTIME_FACT",
    };
    store.facts.push(fact);
    const activity: CanonicalActivityV1 = {
      schema: "CANONICAL_ACTIVITY_V1",
      activity_id: `activity:${row.work_id}`,
      work_id: row.work_id,
      actor_type: "DNA_OS",
      actor_id: "work-production-pipeline",
      subject: row.intent.owner_goal,
      goal: row.work_order.goal,
      current_stage: row.state,
      current_component: row.lane,
      status: row.state,
      started_at: row.created_at ?? nowIso(),
      last_activity_at: row.updated_at ?? nowIso(),
      completed_at: row.state === "ACTIVE" || row.state === "FAILED" || row.state === "RETIRED" ? nowIso() : null,
      evidence_refs: [`pipeline:${row.work_id}`],
    };
    const idx = store.activities.findIndex((item) => item.activity_id === activity.activity_id);
    if (idx >= 0) store.activities[idx] = activity;
    else store.activities.push(activity);
    store.events.push({
      schema: "CANONICAL_EVENT_V1",
      event_id: `event:work:${row.work_id}:${row.state}`,
      event_type: row.state === "REQUESTED" ? "WORK_STARTED" : "STATE_CHANGED",
      entity_id: workId,
      work_id: row.work_id,
      command_id: null,
      source_system: "work-production-pipeline",
      previous_state: null,
      current_state: row.state,
      severity: row.state === "FAILED" ? "ERROR" : "INFO",
      owner_attention: row.state === "OWNER_REVIEW_REQUIRED",
      action_required: row.state === "OWNER_REVIEW_REQUIRED",
      grants_authority: false,
      evidence_refs: [`pipeline:${row.work_id}`],
      occurred_at: nowIso(),
      received_at: nowIso(),
      version: 1,
    } satisfies CanonicalEventV1);
  }
}

export function ingestExistingRemoteProduction(input: {
  readonly resources: readonly {
    readonly canonical_resource_id: string;
    readonly name: string;
    readonly provider: string;
    readonly resource_type: string;
    readonly evidence_refs: readonly string[];
  }[];
  readonly targets: readonly { readonly target_id: string; readonly provider: string }[];
  readonly lineage: {
    readonly REAL_CANONICAL_REVISION: string;
    readonly REAL_REMOTE_REVISION: string;
    readonly REAL_LINEAGE_STATUS: string;
  };
}): void {
  ingestSafeCanonicalSources();
  const store = getStore();
  const t = nowIso();
  for (const resource of input.resources) {
    const entity_id = `entity:resource:${resource.canonical_resource_id}`;
    const existing = store.entities.find((row) => row.entity_id === entity_id);
    const entity: CanonicalEntityV1 = {
      schema: "CANONICAL_INFORMATION_ENTITY_V1",
      entity_id,
      entity_type: resource.resource_type === "repository" ? "REPOSITORY" : resource.resource_type === "project_database" ? "RESOURCE" : "SERVICE",
      canonical_name: resource.canonical_resource_id,
      display_name: resource.name,
      domain: resource.provider,
      status: "CONNECTED",
      verification: "PARTIALLY_VERIFIED",
      availability: "AVAILABLE",
      authority_state: "OWNER_DISABLED",
      owner_enabled: false,
      source_system: "remote-production-discovery",
      source_ref: resource.canonical_resource_id,
      relationships: [],
      evidence_refs: [...resource.evidence_refs],
      created_at: existing?.created_at ?? t,
      updated_at: t,
      version: (existing?.version ?? 0) + 1,
    };
    if (existing) {
      const idx = store.entities.indexOf(existing);
      store.entities[idx] = entity;
    } else store.entities.push(entity);
    store.facts.push({
      schema: "CANONICAL_FACT_V1",
      fact_id: `fact:${entity_id}:provider`,
      entity_id,
      fact_type: "REMOTE_RESOURCE",
      key: "provider",
      value: resource.provider,
      value_type: "string",
      verification: "VERIFIED",
      source_ref: resource.canonical_resource_id,
      evidence_refs: [...resource.evidence_refs],
      observed_at: t,
      valid_from: t,
      valid_until: null,
      version: 1,
      freshness_state: "FRESH",
      ttl_ms: 60_000,
      stale_after: new Date(Date.now() + 60_000).toISOString(),
      source_precedence: "VERIFIED_EVIDENCE",
    });
  }
  for (const target of input.targets) {
    const entity_id = `entity:deployment-target:${target.target_id}`;
    if (store.entities.some((row) => row.entity_id === entity_id)) continue;
    store.entities.push({
      schema: "CANONICAL_INFORMATION_ENTITY_V1",
      entity_id,
      entity_type: "DEPLOYMENT_TARGET",
      canonical_name: target.target_id,
      display_name: target.target_id,
      domain: target.provider,
      status: "CONNECTED",
      verification: "PARTIALLY_VERIFIED",
      availability: "AVAILABLE",
      authority_state: "OWNER_DISABLED",
      owner_enabled: false,
      source_system: "remote-production-discovery",
      source_ref: target.target_id,
      relationships: [],
      evidence_refs: [`target:${target.target_id}`],
      created_at: t,
      updated_at: t,
      version: 1,
    });
    store.relationships.push({
      schema: "CANONICAL_RELATIONSHIP_V1",
      relationship_id: `rel:${target.target_id}:runs-on`,
      from_entity_id: entity_id,
      relationship_type: "RUNS_ON",
      to_entity_id: "entity:resource:resource://railway/project/dna-os-infrastructure",
      status: "CONNECTED",
      verification: "PARTIALLY_VERIFIED",
      authority_boundary: true,
      evidence_refs: [`target:${target.target_id}`],
      updated_at: t,
    });
  }
  store.facts.push({
    schema: "CANONICAL_FACT_V1",
    fact_id: "fact:real-production-lineage:status",
    entity_id: "entity:system:dna-os",
    fact_type: "REAL_PRODUCTION_LINEAGE",
    key: "REAL_LINEAGE_STATUS",
    value: input.lineage.REAL_LINEAGE_STATUS,
    value_type: "string",
    verification: "PARTIALLY_VERIFIED",
    source_ref: "REAL_PRODUCTION_LINEAGE_V1",
    evidence_refs: [
      `canonical:${input.lineage.REAL_CANONICAL_REVISION}`,
      `remote:${input.lineage.REAL_REMOTE_REVISION}`,
    ],
    observed_at: t,
    valid_from: t,
    valid_until: null,
    version: 1,
    freshness_state: "FRESH",
    ttl_ms: 60_000,
    stale_after: new Date(Date.now() + 60_000).toISOString(),
    source_precedence: "VERIFIED_EVIDENCE",
  });
}
