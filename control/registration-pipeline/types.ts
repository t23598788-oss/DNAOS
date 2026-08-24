/**
 * หน้าที่: the type contracts for the Registration Pipeline — one
 * capability = one owner per stage:
 *
 *   INPUT -> VALIDATION -> CLASSIFICATION -> DUPLICATE RESOLUTION
 *   -> REGISTRATION DECISION -> REGISTRY WRITER -> [ destination/target/
 *   policy — existing, untouched capabilities, never re-classifying ]
 *
 * See ./README.md for the full stage-ownership table this STEP built.
 *
 * Input: none (pure type definitions).
 * Output: `PipelineStage`, `DuplicateResolutionStatus`,
 * `DuplicateResolutionResult`, `PipelineResult` (and its four variants),
 * `UnresolvedResult`.
 * Dependency ที่อนุญาต: none — leaf contract.
 * สิ่งที่ห้ามแตะ: never add a field that lets a caller pre-supply a
 * `status`/`decision` — every field here is only ever produced by
 * ./pipeline.ts running the real stages.
 */

export type PipelineStage = "VALIDATION" | "CLASSIFICATION" | "DUPLICATE_RESOLUTION" | "REGISTRATION_DECISION" | "REPOSITORY_RESOLUTION" | "REGISTRY_WRITER";

/** Duplicate Resolution's own closed vocabulary — MINIMUM RULE from the STEP that built this folder: exactly these four, nothing else. */
export type DuplicateResolutionStatus = "UNIQUE" | "DUPLICATE_EXACT" | "DUPLICATE_SEMANTIC" | "UNRESOLVED_DUPLICATE";

export interface DuplicateOf {
  resource_id: string | null;
  capability_id: string | null;
}

export interface DuplicateResolutionResult {
  status: DuplicateResolutionStatus;
  matched: DuplicateOf | null;
  reason_code: string | null;
}

export interface PipelineApprovedResult {
  status: "REGISTERED";
  resource_id: string;
  capability_id: string | null;
  candidate_id: string;
  evidence_refs: readonly string[];
  /** The real, resolved repository_id (see ./repository-resolution.ts) — null only when the candidate made no repository claim at all (NOT_APPLICABLE), never a silently-dropped claim. */
  repository_id: string | null;
}

export interface PipelineDuplicateResult {
  status: "DUPLICATE";
  reason_code: string;
  duplicate_of: DuplicateOf;
  candidate_id: string;
}

export interface PipelineRejectedResult {
  status: "REJECTED";
  failed_stage: PipelineStage;
  reason_code: string;
  candidate_id: string;
}

/**
 * The exact shape required by the STEP "Refactor Registration Pipeline to
 * Single-Owner Sequential Stages" — every field named there, no more, no
 * fewer. `work_item_task_id` is the real EXPLAIN_RESOURCE Task this
 * result caused to be created — see ./explain-resource.ts.
 */
export interface PipelineUnresolvedResult {
  status: "UNRESOLVED";
  failed_stage: PipelineStage;
  reason_code: string;
  resource_id: string | null;
  candidate_id: string;
  known_facts: Readonly<Record<string, unknown>>;
  missing_information: readonly string[];
  evidence_refs: readonly string[];
  correlation_id: string;
  work_item_task_id: string | null;
}

export type PipelineResult = PipelineApprovedResult | PipelineDuplicateResult | PipelineRejectedResult | PipelineUnresolvedResult;
