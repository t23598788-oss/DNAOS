/**
 * หน้าที่: type contracts for SYSTEM-WIDE RESOURCE RECONCILIATION — the layer
 * that answers "what is this, why does it exist, who still uses it, and is
 * removing it reversible" BEFORE anything is ever proposed for removal.
 *
 * IT IS NOT A CLEANUP SYSTEM. Nothing in this folder deletes, moves, truncates
 * or resets anything. It reads existing read paths, reconciles what they say,
 * and produces verdicts. The only mutation boundary on this machine remains
 * ~/Desktop/dna-os-deadboard `engines/storage/adapters/trashAdapter.ts`, and
 * the only service-lifecycle authority remains `../runtime-control/`.
 *
 * UNKNOWN IS A VALUE, NOT A GAP TO FILL. Every field below may be UNKNOWN or
 * empty, and an UNKNOWN never resolves upward into a permission: see
 * `decide.ts`, where UNKNOWN can only produce REVIEW, BLOCK or UNRESOLVED.
 *
 * Input: none (pure type definitions).
 * Output: the lineage, finding, reset and verdict contracts.
 * Dependency ที่อนุญาต: none — a leaf contract.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเพิ่ม verdict ที่แปลว่า "ลบ" นอกจาก AUTO_TRASH ที่มีเงื่อนไขครบ.
 * - ห้ามเพิ่ม field ที่มาจากการเดา (ชื่อคล้ายกัน, เวลาใกล้กัน, cwd เดียวกัน).
 */

/** Where a fact came from. A lineage field with no source is not a fact. */
export interface Provenance {
  /** The exact read path that produced this, e.g. "software/live-census#observeCensus". */
  read_path: string;
  /** What that read path actually returned, quoted or summarised — never a paraphrase of a guess. */
  evidence: string;
}

export type ResourceState =
  | "ACTIVE"
  | "SUPERSEDED"
  | "ORPHAN_CANDIDATE"
  | "DUPLICATE_IMPLEMENTATION"
  | "GENERATED"
  | "TEST_RESIDUE"
  | "UNKNOWN";

/**
 * Everything the system can prove about one artifact. Every optional field is
 * `null`/empty when no read path answered — never a placeholder that reads like
 * an answer.
 */
export interface ResourceLineage {
  /** Derived path identity, and the registry's minted id when one covers this path. They are different kinds of identity and are kept apart. */
  path: string;
  repo_relative_path: string;
  resource_id: string | null;
  capability_id: string | null;
  capability_key: string | null;
  repository: string;
  system: "SOURCE" | "DATABASE" | "EXTERNAL" | "MACHINE_STATE";

  created_by_work_id: string | null;
  created_by_change_id: string | null;
  created_at: string | null;
  /** The process that currently holds it open, when machine observation proves one. */
  runtime_owner: string | null;

  consumers: readonly string[];
  dependencies: readonly string[];
  contracts: readonly string[];
  database_references: readonly string[];
  blueprint_references: readonly string[];

  replacement_resource: string | null;
  superseded_by: string | null;
  last_verified_use: string | null;

  current_state: ResourceState;
  evidence_refs: readonly string[];
  provenance: readonly Provenance[];
  /** Named honestly: which of the questions above no read path could answer. */
  unresolved: readonly string[];
}

export type FindingKind =
  | "ORPHANED_RESOURCE"
  | "SUPERSEDED_RESOURCE"
  | "DUPLICATE_IMPLEMENTATION"
  | "STALE_RUNTIME"
  | "STALE_CACHE"
  | "STALE_TEST_RESIDUE"
  | "STALE_MOCK"
  | "STALE_FIXTURE"
  | "UNREFERENCED_GENERATED_FILE"
  | "STALE_REGISTRY_REFERENCE"
  | "STALE_BLUEPRINT_REFERENCE"
  | "STALE_DATABASE_REFERENCE"
  | "BROKEN_RELATIONSHIP"
  | "UNKNOWN_OWNERSHIP";

export interface ReconciliationFinding {
  kind: FindingKind;
  subject: string;
  /** The other end, for relationship findings (superseded-by, duplicate-of, dangling reference target). */
  counterpart: string | null;
  detail: string;
  provenance: readonly Provenance[];
  /** Detection is not permission. This is always the finding's own verdict, computed by ./decide.ts. */
  verdict: ReconciliationVerdict;
}

/**
 * The only verdicts this system may reach. AUTO_TRASH is deliberately last and
 * deliberately hardest — see `decide.ts#decideVerdict` for the full condition
 * set it must satisfy, all of which must be independently true.
 */
export type ReconciliationVerdict =
  | "RETAIN"
  | "RESET"
  | "REBUILD"
  | "ARCHIVE"
  | "REVIEW"
  | "AUTO_TRASH"
  | "BLOCK"
  | "UNRESOLVED";

/** Every condition AUTO_TRASH requires, each answered independently and each recorded. */
export interface AutoTrashConditions {
  zero_active_consumers: boolean;
  zero_runtime_use: boolean;
  zero_protected_references: boolean;
  replacement_verified_where_applicable: boolean;
  recoverability_proven: boolean;
  retention_satisfied: boolean;
  source_of_truth_is_false: boolean;
  /** Which of the above could not be answered at all. A single entry forces UNRESOLVED. */
  unanswered: readonly string[];
}

export interface VerdictDecision {
  verdict: ReconciliationVerdict;
  reason: string;
  conditions: AutoTrashConditions;
  /** The rule that produced it, so no verdict is ever a bare assertion. */
  rule: string;
}

export type ResetScope =
  | "TASK_RESET"
  | "CAPABILITY_RESET"
  | "SERVICE_RESET"
  | "WORKSPACE_RESET"
  | "APPLICATION_CACHE_RESET"
  | "TEST_ENVIRONMENT_RESET";

/**
 * A reset PLAN. Producing one performs nothing: `disposable` names derived
 * state that may be rebuilt, `protected_from_reset` names what must survive,
 * and `actions` describes what an executor would do — through the existing
 * boundaries, never from this folder.
 */
export interface ResetPlan {
  scope: ResetScope;
  target: string;
  disposable: readonly string[];
  protected_from_reset: readonly string[];
  /** Services whose runtime must be reloaded afterwards, via ../service-reload/. */
  reload_services: readonly string[];
  rebuild_indexes: readonly string[];
  actions: readonly string[];
  blocked_reasons: readonly string[];
  verdict: ReconciliationVerdict;
}

/** The database gate. Its default is BLOCK, and every field is a proof obligation. */
export interface DatabaseSafetyDecision {
  object_reference: string;
  no_active_reader: boolean | null;
  no_active_writer: boolean | null;
  no_foreign_key_reference: boolean | null;
  no_edge_function_dependency: boolean | null;
  no_cron_dependency: boolean | null;
  no_webhook_dependency: boolean | null;
  no_financial_or_document_lineage: boolean | null;
  no_historical_or_audit_requirement: boolean | null;
  retention_permits_removal: boolean | null;
  backup_recovery_path_exists: boolean | null;
  verdict: ReconciliationVerdict;
  reason: string;
  unproven: readonly string[];
}

/** Before/after, measured. Never "cleaned" asserted from a byte count. */
export interface LightnessMetrics {
  measured_at: string;
  disk_bytes: number;
  artifact_count: number;
  orphan_count: number;
  duplicate_count: number;
  stale_runtime_count: number;
  test_residue_count: number;
  cache_temp_count: number;
  unresolved_ownership_count: number;
  broken_reference_count: number;
  registry_inconsistency_count: number;
  graph_inconsistency_count: number;
}

/** What a verified change implies for the resources around it. */
export type ImpactClass = "NEW" | "MODIFIED" | "SUPERSEDED" | "POSSIBLY_ORPHANED" | "UNCHANGED";

export interface ChangeImpactEntry {
  path: string;
  impact: ImpactClass;
  reason: string;
  /** Set only for SUPERSEDED/POSSIBLY_ORPHANED, which are the two that trigger reconciliation. */
  reconciliation: ReconciliationFinding | null;
}
