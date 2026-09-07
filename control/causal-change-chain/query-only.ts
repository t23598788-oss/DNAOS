/**
 * หน้าที่: the LEAF, machine-model-free half of `control/causal-change-chain/`'s
 * public surface — PHASE 7's four read-only causal queries, moved out of
 * `./contract.ts` into their own file for exactly one reason: `./contract.ts`
 * also imports `../machine-model/contract` (for `deriveImpact`/
 * `evaluateCapabilityStateEffect`), and machine-model's own closure reaches
 * `control/command-router/router.ts` → `control/agent-host`,
 * `connections/digitalocean`, `connections/github`, and more — proven by a
 * real `tsc` build (513 emitted files instead of the isolated ~26)
 * (CONNECT_HUMAN_CAUSAL_EXPLANATION_READER, Owner UNLOCK 2026-09-06). A
 * conversation-runtime consumer that only ever needs
 * `whyDidThisRelationshipChange`/`whatChangedBecauseOf`/
 * `whatCausedThisStateChange`/`whatNeedsRefreshBecauseOf` must not drag that
 * whole tree in through a single module-level import.
 *
 * SAME LOGIC, NOT NEW LOGIC: every function body here is byte-identical to
 * the one already proven in `./contract.ts` — this file only changes WHERE
 * the code lives, never WHAT it does. `./contract.ts` re-exports these same
 * four functions from here, so every existing caller keeps working
 * unchanged.
 *
 * Input: relationship_id / change_id / state_change_id references.
 * Output: `whyDidThisRelationshipChange`, `whatChangedBecauseOf`,
 * `whatCausedThisStateChange`, `whatNeedsRefreshBecauseOf`.
 * Dependency ที่อนุญาต: ./store.ts, ./types.ts (leaf — no machine-model, no
 * runtime-revision, no node:child_process).
 * สิ่งที่ห้ามแตะ: ห้าม import ./contract.ts จากที่นี่ (จะวนกลับเข้า
 * machine-model) และห้าม import machine-model/runtime-revision เข้าไฟล์นี้
 * ไม่ว่ากรณีใด — นั่นคือเหตุผลทั้งหมดที่ไฟล์นี้มีอยู่.
 */

import { readAllRecords } from "./store";
import type {
  CapabilityStateChangeRecord,
  DerivedImpactRecord,
  MetricInvalidationRecord,
  ProjectionInvalidationRecord,
  RelationshipChangeRecord,
} from "./types";

const RELATIONSHIP_CHANGES_LOG = "relationship-changes.jsonl";
const IMPACT_LOG = "derived-impact.jsonl";
const CAPABILITY_STATE_CHANGES_LOG = "capability-state-changes.jsonl";
const METRIC_INVALIDATIONS_LOG = "metric-invalidations.jsonl";
const PROJECTION_INVALIDATIONS_LOG = "projection-invalidations.jsonl";

export function whyDidThisRelationshipChange(relationshipId: string): RelationshipChangeRecord | null {
  const all = readAllRecords<RelationshipChangeRecord>(RELATIONSHIP_CHANGES_LOG);
  return [...all].reverse().find((c) => c.before_relationship_id === relationshipId || c.after_relationship_id === relationshipId || c.replaced_relationship_id === relationshipId) ?? null;
}

export interface CausalConsequences {
  readonly impact: DerivedImpactRecord | null;
  readonly capability_state_changes: readonly CapabilityStateChangeRecord[];
  readonly metric_invalidations: readonly MetricInvalidationRecord[];
  readonly projection_invalidations: readonly ProjectionInvalidationRecord[];
}

export function whatChangedBecauseOf(changeId: string): CausalConsequences {
  return {
    impact: readAllRecords<DerivedImpactRecord>(IMPACT_LOG).find((r) => r.change_id === changeId) ?? null,
    capability_state_changes: readAllRecords<CapabilityStateChangeRecord>(CAPABILITY_STATE_CHANGES_LOG).filter((r) => r.caused_by_change_id === changeId),
    metric_invalidations: readAllRecords<MetricInvalidationRecord>(METRIC_INVALIDATIONS_LOG).filter((r) => r.caused_by_change_id === changeId),
    projection_invalidations: readAllRecords<ProjectionInvalidationRecord>(PROJECTION_INVALIDATIONS_LOG).filter((r) => r.caused_by_change_id === changeId),
  };
}

export function whatCausedThisStateChange(stateChangeId: string): RelationshipChangeRecord | null {
  const stateChange = readAllRecords<CapabilityStateChangeRecord>(CAPABILITY_STATE_CHANGES_LOG).find((r) => r.capability_state_change_id === stateChangeId);
  if (!stateChange) return null;
  return readAllRecords<RelationshipChangeRecord>(RELATIONSHIP_CHANGES_LOG).find((c) => c.change_id === stateChange.caused_by_change_id) ?? null;
}

export interface RefreshNeeded {
  readonly metrics: readonly MetricInvalidationRecord[];
  readonly projections: readonly ProjectionInvalidationRecord[];
}

export function whatNeedsRefreshBecauseOf(changeId: string): RefreshNeeded {
  return {
    metrics: readAllRecords<MetricInvalidationRecord>(METRIC_INVALIDATIONS_LOG).filter((r) => r.caused_by_change_id === changeId),
    projections: readAllRecords<ProjectionInvalidationRecord>(PROJECTION_INVALIDATIONS_LOG).filter((r) => r.caused_by_change_id === changeId),
  };
}
