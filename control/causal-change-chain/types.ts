/**
 * หน้าที่: type contracts for CONNECT_CAUSAL_CHANGE_CHAIN_V1 (Owner UNLOCK
 * 2026-09-06). Five narrow record shapes, each answering exactly one real
 * question the prior audit (CLASSIFY_DNA_OS_FLOW_KNOWLEDGE_MEMORY_AND_CHANGE_MEMORY)
 * proved was genuinely missing — no generic event-sourcing schema.
 *
 * REFERENCES ONLY. Every `*_id` field here points at a row that already
 * lives in its own real store (`relationship_id` → software/registry-database's
 * relationships.jsonl; `subject_id` → a machine-model node_id or capability
 * label). Nothing here copies a relationship's content — see
 * `../../software/registry-database/` for that, which this folder never
 * duplicates.
 *
 * UNKNOWN IS A VALUE. Every optional field is `null` when its producer
 * genuinely cannot know it — never filled in from a timestamp, a guess, or
 * git inference where git is not the declared authority for that field.
 *
 * Input: none (pure type definitions).
 * Output: the five record shapes + the two declared-dependency maps.
 * Dependency ที่อนุญาต: none — a leaf contract.
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่ม field ที่มาจากการเดา/อนุมานเวลา. ห้ามเก็บเนื้อหา
 * relationship เต็ม — เก็บได้แค่ id อ้างอิง.
 */

export type RelationshipChangeType = "RELATIONSHIP_CREATED" | "RELATIONSHIP_REMOVED" | "RELATIONSHIP_REPLACED";

/** PHASE 1 + 2: the change-cause contract, references only. */
export interface RelationshipChangeRecord {
  readonly change_id: string;
  readonly change_type: RelationshipChangeType;

  /** The node this change is about — a real machine-model node_id or capability label, never invented. */
  readonly subject_id: string;

  /** BEFORE/AFTER, by reference only — never a copied relationship row. */
  readonly before_relationship_id: string | null;
  readonly after_relationship_id: string | null;
  /** Set only for RELATIONSHIP_REPLACED. */
  readonly replaced_relationship_id: string | null;
  readonly relationship_kind: string | null;

  readonly caused_by_event_id: string | null;
  readonly caused_by_request_id: string | null;
  readonly caused_by_work_id: string | null;

  readonly reason_code: string | null;
  readonly reason_detail: string | null;

  readonly changed_at: string;

  readonly source_revision: string | null;
  readonly source_dirty: boolean | null;

  readonly evidence_refs: readonly string[];
}

/** PHASE 3: derived, never mutates relationship history — pure output of the impact evaluator. */
export interface DerivedImpactRecord {
  readonly change_id: string;
  readonly affected_subject_ids: readonly string[];
  readonly affected_relationship_ids: readonly string[];
  readonly computed_at: string;
  readonly evidence_refs: readonly string[];
}

/** PHASE 4: only written when a REAL expected-vs-observed difference was proven — never one per affected subject unconditionally. */
export interface CapabilityStateChangeRecord {
  readonly capability_state_change_id: string;
  readonly caused_by_change_id: string;
  readonly subject_id: string;
  readonly before_status: string | null;
  readonly after_status: string | null;
  readonly evidence_refs: readonly string[];
  readonly recorded_at: string;
}

export type MeasurementState = "STALE" | "RECOMPUTE_REQUIRED";

/** PHASE 5: invalidation only — never a recomputed value. The metric's own producer remains responsible for recomputation. */
export interface MetricInvalidationRecord {
  readonly invalidation_id: string;
  readonly metric_id: string;
  readonly measurement_state: MeasurementState;
  readonly caused_by_change_id: string;
  readonly recorded_at: string;
}

/** PHASE 6: invalidation only — never a rebuilt snapshot. The projection's own producer remains responsible for republishing. */
export interface ProjectionInvalidationRecord {
  readonly invalidation_id: string;
  readonly projection_id: string;
  readonly caused_by_change_id: string;
  readonly recorded_at: string;
}

/**
 * DECLARED dependencies only (PHASE 5/6's own requirement: "only metrics
 * with a DECLARED dependency... may be invalidated"). Each key is a real
 * `relationship_kind` string from `control/machine-model/dependency-index.ts#EDGE_SEMANTICS`;
 * each value names a real metric_id/projection_id this repo already
 * produces. Adding a new dependency here is a reviewable, one-line change
 * — never inferred at invalidation time.
 */
export const METRIC_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = {
  // governance/source-validation/folder-law-gate.ts's own CROSS_CAPABILITY_INTERNAL_IMPORT
  // rule row is checked directly against import relationships of this kind
  // (checked_per_rule: 280 real subjects, proven live 2026-09-06) — a real,
  // declared dependency, not assumed.
  CROSS_CAPABILITY_INTERNAL_IMPORT: ["CAPABILITY_FOLDER_LAW_COMPLIANCE"],
};

export const PROJECTION_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = {
  // control/conversation-read-model/publish-self-explanation-projection.ts
  // builds its dependencies/dependents/impact fields directly from
  // control/machine-model/dependency-index.ts's EDGE_SEMANTICS-classified
  // edges of exactly these four kinds — a real, declared dependency.
  MODULE_TO_CAPABILITY: ["self-explanation-projection"],
  OWNED_BY_CAPABILITY: ["self-explanation-projection"],
  ORCHESTRATES_CAPABILITY: ["self-explanation-projection"],
  CROSS_CAPABILITY_INTERNAL_IMPORT: ["self-explanation-projection"],
};
