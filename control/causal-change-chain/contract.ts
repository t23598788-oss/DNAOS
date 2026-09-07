/**
 * หน้าที่: the ONLY module outside this folder is allowed to import from —
 * the public contract of `control/causal-change-chain/`
 * (CONNECT_CAUSAL_CHANGE_CHAIN_V1, Owner UNLOCK 2026-09-06). `./store.ts`
 * (append-only I/O) is private implementation.
 *
 * NOT A GENERIC EVENT-SOURCING PLATFORM: five narrow record types, each
 * answering exactly one question
 * CLASSIFY_DNA_OS_FLOW_KNOWLEDGE_MEMORY_AND_CHANGE_MEMORY proved missing.
 * Every producer function here is a thin wrapper around an EXISTING real
 * program — `control/machine-model/`'s dependency index and expected-state
 * diff, `control/runtime-revision/`'s real git read — never a
 * reimplementation of either.
 *
 * PHASE 3/4/5/6 ARE DERIVED, NEVER MUTATING: `deriveImpact`,
 * `evaluateCapabilityStateEffect`, `evaluateMetricInvalidation`, and
 * `evaluateProjectionInvalidation` never write to
 * `software/registry-database/`, never rebuild a projection, never
 * recompute a metric — they only append a narrow record saying "this needs
 * attention, here is why". The metric/projection's own producer remains
 * responsible for actually recomputing/republishing (PHASE 5/6's own
 * rule).
 *
 * Input: relationship-change facts a caller already knows (references
 * only — never a live registry object, never a full relationship row).
 * Output: `recordRelationshipChange`, `deriveImpact`,
 * `evaluateCapabilityStateEffect`, `evaluateMetricInvalidation`,
 * `evaluateProjectionInvalidation`, and four read-only causal queries.
 * Dependency ที่อนุญาต: ./store.ts, ./types.ts,
 * `../machine-model/contract.ts`, `../runtime-revision/contract.ts`,
 * node:crypto (randomUUID only).
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเขียนทะเบียน relationship/capability/metric/projection ใดๆ จาก
 *   ไฟล์นี้ — read + derive + append เท่านั้น
 * - ห้าม backfill หรือแก้ record เก่า — append เท่านั้น ไม่มี update/delete
 * - ห้าม invalidate metric/projection ที่ไม่มี declared dependency ใน
 *   ./types.ts#METRIC_DEPENDENCIES / PROJECTION_DEPENDENCIES
 * - ห้ามเดา before_status/source_revision เมื่อไม่รู้จริง — null เท่านั้น
 */

import { randomUUID } from "node:crypto";
import { appendRecord, readAllRecords } from "./store";
import { buildMachineModel, buildDependencyIndex, diffMachineState } from "../machine-model/contract";
import { readRuntimeRevision } from "../runtime-revision/contract";
import {
  METRIC_DEPENDENCIES,
  PROJECTION_DEPENDENCIES,
  type CapabilityStateChangeRecord,
  type DerivedImpactRecord,
  type MetricInvalidationRecord,
  type ProjectionInvalidationRecord,
  type RelationshipChangeRecord,
  type RelationshipChangeType,
} from "./types";

export type {
  CapabilityStateChangeRecord,
  DerivedImpactRecord,
  MeasurementState,
  MetricInvalidationRecord,
  ProjectionInvalidationRecord,
  RelationshipChangeRecord,
  RelationshipChangeType,
} from "./types";
export { METRIC_DEPENDENCIES, PROJECTION_DEPENDENCIES } from "./types";

// PHASE 7 query functions moved to ./query-only.ts (CONNECT_HUMAN_CAUSAL_EXPLANATION_READER,
// Owner UNLOCK 2026-09-06): that file has no machine-model import, so a
// consumer that only needs these four reads (e.g.
// `control/conversation-runtime/causal-explanation-reader.ts`) never drags
// in machine-model's much larger closure. Re-exported here, unchanged, so
// every existing caller of this contract keeps working.
export {
  whyDidThisRelationshipChange,
  whatChangedBecauseOf,
  whatCausedThisStateChange,
  whatNeedsRefreshBecauseOf,
  type CausalConsequences,
  type RefreshNeeded,
} from "./query-only";

const RELATIONSHIP_CHANGES_LOG = "relationship-changes.jsonl";
const IMPACT_LOG = "derived-impact.jsonl";
const CAPABILITY_STATE_CHANGES_LOG = "capability-state-changes.jsonl";
const METRIC_INVALIDATIONS_LOG = "metric-invalidations.jsonl";
const PROJECTION_INVALIDATIONS_LOG = "projection-invalidations.jsonl";

// ---------------------------------------------------------------------------
// PHASE 1 + 2 — the change-cause contract
// ---------------------------------------------------------------------------

export interface RecordRelationshipChangeInput {
  readonly change_type: RelationshipChangeType;
  readonly subject_id: string;
  readonly before_relationship_id?: string | null;
  readonly after_relationship_id?: string | null;
  readonly replaced_relationship_id?: string | null;
  readonly relationship_kind?: string | null;
  readonly caused_by_event_id?: string | null;
  readonly caused_by_request_id?: string | null;
  readonly caused_by_work_id?: string | null;
  readonly reason_code?: string | null;
  readonly reason_detail?: string | null;
  readonly evidence_refs?: readonly string[];
}

/**
 * The ONLY producer of `RelationshipChangeRecord`s. Appends, never
 * overwrites. `source_revision`/`source_dirty` come from
 * `readRuntimeRevision()` — the same real git read used throughout this
 * repo — never guessed from a timestamp.
 */
export function recordRelationshipChange(input: RecordRelationshipChangeInput): RelationshipChangeRecord {
  const revision = readRuntimeRevision();
  const record: RelationshipChangeRecord = {
    change_id: randomUUID(),
    change_type: input.change_type,
    subject_id: input.subject_id,
    before_relationship_id: input.before_relationship_id ?? null,
    after_relationship_id: input.after_relationship_id ?? null,
    replaced_relationship_id: input.replaced_relationship_id ?? null,
    relationship_kind: input.relationship_kind ?? null,
    caused_by_event_id: input.caused_by_event_id ?? null,
    caused_by_request_id: input.caused_by_request_id ?? null,
    caused_by_work_id: input.caused_by_work_id ?? null,
    reason_code: input.reason_code ?? null,
    reason_detail: input.reason_detail ?? null,
    changed_at: new Date().toISOString(),
    source_revision: revision.revision,
    source_dirty: revision.revision !== null ? revision.dirty : null,
    evidence_refs: input.evidence_refs ?? [],
  };
  appendRecord(RELATIONSHIP_CHANGES_LOG, record);
  return record;
}

// ---------------------------------------------------------------------------
// PHASE 3 — derived impact (never mutates relationship history)
// ---------------------------------------------------------------------------

/**
 * Calls the REAL, existing `control/machine-model/dependency-index.ts`
 * directly — `impactOf()` is not reimplemented here. Matches a change's
 * `subject_id` against the model's real node_id or label; if no real node
 * matches, returns an empty impact with the reason recorded as evidence
 * rather than guessing.
 */
export function deriveImpact(change: RelationshipChangeRecord): DerivedImpactRecord {
  const model = buildMachineModel({ census: false });
  const index = buildDependencyIndex(model);
  const node = model.nodes.find((n) => n.node_id === change.subject_id || n.label === change.subject_id);
  if (!node) {
    const record: DerivedImpactRecord = {
      change_id: change.change_id,
      affected_subject_ids: [],
      affected_relationship_ids: [],
      computed_at: new Date().toISOString(),
      evidence_refs: [`subject_id "${change.subject_id}" not found in control/machine-model — impact not computed, not guessed`],
    };
    appendRecord(IMPACT_LOG, record);
    return record;
  }
  const impact = index.impactOf(node.node_id);
  const record: DerivedImpactRecord = {
    change_id: change.change_id,
    affected_subject_ids: impact.map((p) => p.node_id),
    affected_relationship_ids: impact.flatMap((p) => p.via),
    computed_at: new Date().toISOString(),
    evidence_refs: ["control/machine-model/dependency-index.ts#impactOf"],
  };
  appendRecord(IMPACT_LOG, record);
  return record;
}

// ---------------------------------------------------------------------------
// PHASE 4 — capability state effect (only when PROVEN)
// ---------------------------------------------------------------------------

/**
 * Calls the REAL, existing `control/machine-model/expected-state.ts#diffMachineState`
 * directly. `before_status` is always `null` (UNKNOWN) — no historical
 * expected-state snapshot exists to compare against; only `after_status`
 * (the real, current `difference_class`) is ever stated. Emits NOTHING for
 * a subject with no declared expected state — that is not "no change", it
 * is "not applicable", and the absence of a record says so.
 */
export function evaluateCapabilityStateEffect(change: RelationshipChangeRecord, impact: DerivedImpactRecord): readonly CapabilityStateChangeRecord[] {
  const model = buildMachineModel({ census: false });
  const index = buildDependencyIndex(model);
  const report = diffMachineState(model, index);
  const candidateIds = new Set([change.subject_id, ...impact.affected_subject_ids]);

  const records: CapabilityStateChangeRecord[] = [];
  for (const diff of report.differences) {
    if (!candidateIds.has(diff.expectation.node_id)) continue;
    const record: CapabilityStateChangeRecord = {
      capability_state_change_id: randomUUID(),
      caused_by_change_id: change.change_id,
      subject_id: diff.expectation.node_id,
      before_status: null,
      after_status: diff.difference_class,
      evidence_refs: ["control/machine-model/expected-state.ts#diffMachineState", `control/machine-observation/data/runtime-targets.jsonl#${diff.expectation.canonical_name}`],
      recorded_at: new Date().toISOString(),
    };
    records.push(record);
    appendRecord(CAPABILITY_STATE_CHANGES_LOG, record);
  }
  return records;
}

// ---------------------------------------------------------------------------
// PHASE 5 — metric invalidation (declared dependency only, never auto-score)
// ---------------------------------------------------------------------------

export function evaluateMetricInvalidation(change: RelationshipChangeRecord): readonly MetricInvalidationRecord[] {
  if (!change.relationship_kind) return [];
  const metricIds = METRIC_DEPENDENCIES[change.relationship_kind] ?? [];
  const records = metricIds.map((metric_id): MetricInvalidationRecord => ({
    invalidation_id: randomUUID(),
    metric_id,
    measurement_state: "RECOMPUTE_REQUIRED",
    caused_by_change_id: change.change_id,
    recorded_at: new Date().toISOString(),
  }));
  for (const record of records) appendRecord(METRIC_INVALIDATIONS_LOG, record);
  return records;
}

// ---------------------------------------------------------------------------
// PHASE 6 — projection invalidation (declared dependency only, never rebuild)
// ---------------------------------------------------------------------------

export function evaluateProjectionInvalidation(change: RelationshipChangeRecord): readonly ProjectionInvalidationRecord[] {
  if (!change.relationship_kind) return [];
  const projectionIds = PROJECTION_DEPENDENCIES[change.relationship_kind] ?? [];
  const records = projectionIds.map((projection_id): ProjectionInvalidationRecord => ({
    invalidation_id: randomUUID(),
    projection_id,
    caused_by_change_id: change.change_id,
    recorded_at: new Date().toISOString(),
  }));
  for (const record of records) appendRecord(PROJECTION_INVALIDATIONS_LOG, record);
  return records;
}

// PHASE 7 causal queries live in ./query-only.ts (re-exported above) — not
// duplicated here.
