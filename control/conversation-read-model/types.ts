/**
 * หน้าที่: projection shapes for `control/conversation-read-model/` — the
 * physical boundary between DNA OS Control/Execution and the Owner
 * Conversation Layer (Owner UNLOCK, 2026-09-06).
 *
 * Every type here is a deliberately narrower shape than any producer's own
 * internal type. A producer publishes exactly this shape — never its own
 * registry/task object — so a field the conversation layer was never meant
 * to see (an executable path, an adapter endpoint, a permission_requirement)
 * cannot reach this boundary even by accident.
 */

export interface CommandIdentityProjection {
  readonly command_id: string;
}

export interface CapabilitySummaryProjection {
  readonly capability_id: string;
  readonly repo_id: string;
  readonly match_keyword_sets: readonly (readonly string[])[];
  /** Command NAMES only (e.g. "connector.github.read_status") — never an endpoint/module reference. Added for BUILD_SELF_WORK_LEDGER_V1 so a read-only ledger can tell "capability id matched" apart from "a command exists for the requested action". */
  readonly supported_commands: readonly string[];
}

export interface TaskStatusProjection {
  readonly task_id: string;
  readonly status: string;
  readonly updated_at: string;
  readonly next_action: string | null;
}

export interface TaskEvidenceRowProjection {
  readonly kind: string;
  readonly source: string;
  readonly recorded_at: string;
}

export interface TaskEvidenceProjection {
  readonly task_id: string;
  readonly rows: readonly TaskEvidenceRowProjection[];
}

/**
 * PUBLISH_EXISTING_SELF_EXPLANATION_PROJECTIONS (Owner UNLOCK 2026-09-06).
 * Every field here is copied verbatim out of what
 * `control/machine-model/dependency-index.ts` and
 * `control/resource-reconciliation/` already compute and return — nothing
 * is re-derived, and nothing here is executable: no path meant to be run,
 * no argv, no credential, no live object, no write method. See
 * `control/conversation-read-model/publish-self-explanation-projection.ts`
 * (the producer, outside this folder's own boundary) for exactly which
 * real function produced each field.
 */
export interface SelfExplanationEdgeProjection {
  readonly node_id: string;
  readonly label: string | null;
  readonly kind: string;
  readonly evidence_ref: string;
}

export interface SelfExplanationImpactProjection {
  readonly node_id: string;
  readonly label: string | null;
  readonly depth: number;
}

export interface SelfExplanationLineageProjection {
  readonly created_by_work_id: string | null;
  readonly created_by_change_id: string | null;
  readonly runtime_owner: string | null;
  readonly consumers: readonly string[];
  readonly dependencies: readonly string[];
  readonly replacement_resource: string | null;
  readonly superseded_by: string | null;
  readonly current_state: string;
  readonly unresolved: readonly string[];
}

export interface SelfExplanationDuplicateFindingProjection {
  readonly old_path: string;
  readonly new_path: string;
  readonly basis: string;
  readonly evidence: readonly string[];
}

export interface SelfExplanationNodeProjection {
  readonly node_id: string;
  readonly node_type: string;
  readonly label: string | null;
  readonly purpose: string | null;
  readonly dependencies: readonly SelfExplanationEdgeProjection[];
  readonly dependents: readonly SelfExplanationEdgeProjection[];
  readonly impacted_by_removal: readonly SelfExplanationImpactProjection[];
  /** `null` only when lineage was not computed for this node this run — see the producer's scoping note. Never a placeholder standing in for a real lineage. */
  readonly lineage: SelfExplanationLineageProjection | null;
  readonly duplicate_findings: readonly SelfExplanationDuplicateFindingProjection[];
  readonly unresolved: readonly string[];
  readonly evidence_refs: readonly string[];
}

/**
 * PERSIST_FIRST_REAL_DNA_OS_MEASUREMENT (Owner UNLOCK 2026-09-06). ONE
 * metric, scoped exactly to Capability Folder Law compliance — see
 * `../../governance/source-validation/publish-capability-folder-law-measurement.ts`
 * (the producer, outside every folder this type is read from) for exactly
 * which real `runCapabilityFolderLawGate()` fields populate each one.
 *
 * `evidence_refs` here is a list of `${subject}#${rule_row}` identifiers for
 * every subject failing AT THIS MEASUREMENT — not the full violation
 * payload (verdict/measured/classification_reason/root_cause) — small
 * enough to store per-measurement, specific enough to let
 * `compareMeasurements()` name exactly which subjects changed without
 * inferring anything from the count delta alone.
 */
export interface CapabilityFolderLawMeasurement {
  readonly measurement_id: string;
  readonly metric_id: "CAPABILITY_FOLDER_LAW_COMPLIANCE";
  readonly subject_id: "DNA_OS_INFRASTRUCTURE_REPOSITORY";
  readonly measured_at: string;
  readonly source_revision: string | null;
  readonly source_dirty: boolean;
  readonly formula_id: "CAPABILITY_FOLDER_LAW_PASS_RATIO";
  /** sha256 of governance/source-validation/folder-law-gate.ts's own source at measurement time — changes only when the formula/rule logic itself changes. */
  readonly formula_version: string;
  readonly subject_count: number;
  readonly passed_count: number;
  readonly failed_count: number;
  readonly gate_status: string;
  readonly evidence_refs: readonly string[];
}

export interface SelfExplanationProjectionManifest {
  readonly generated_at: string;
  readonly source_revision: string | null;
  /** sha256 over the `nodes` array's own JSON — verified on read; see `readSelfExplanationProjection`. */
  readonly content_hash: string;
  readonly nodes: readonly SelfExplanationNodeProjection[];
}
