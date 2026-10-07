/**
 * หน้าที่: the OUTPUT/decision contract — what 5177 (DNA Lab) hands back
 * to 8790 (Circuit) after measuring one real execution. Corrected
 * 2026-08-18 field-by-field against the Research & Evaluation Engine's
 * real `executions` table (research/storage/schema.py) — every field
 * below either matches a real column (renamed only), or is explicitly
 * marked as a field with no real counterpart yet. Nothing here was
 * re-guessed after the mapping check found the original shape didn't
 * match reality.
 *
 * Input: none (pure type definitions).
 * Output: `EvaluationResult`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never default a `null` numeric field to `0` — `0` and
 * "not measured" are different real facts. `cost_usd` MUST be `null`
 * whenever `cost_source === "NOT_MEASURED"` — enforcing this is a future
 * runtime concern, but the type comment states the rule now so it is
 * never silently violated later. Never map `provider_cost_usd` onto
 * `cost_usd` or vice versa — real schema keeps them as two distinct
 * columns (`provider_cost_usd` = what a remote API billed; `cost_usd` =
 * Lab's own blended total including local/rental costs) and this
 * contract must not re-conflate them.
 *
 * NOT_YET_BUILT: no real evaluator produces this shape yet.
 */

export interface EvaluationResult {
  /** Renamed from work_id — matches Research & Evaluation Engine's real `executions.execution_id` column exactly. */
  execution_id: string;

  evaluated_at: string;

  /** Renamed from duration_ms — matches real `executions.elapsed_ms` exactly. */
  elapsed_ms: number;

  /**
   * Renamed and re-typed from `cpu_percent_avg` (which had no real
   * counterpart — Lab does not compute an average percent). Matches
   * real `executions.local_cpu_time_ms`: total CPU TIME consumed, not a
   * percentage.
   */
  local_cpu_time_ms: number | null;

  /**
   * Renamed and re-typed from `ram_delta_bytes` (which had no real
   * counterpart — Lab tracks a peak, not a delta, and in MB not bytes).
   * Matches real `executions.ram_peak_mb` exactly.
   */
  ram_peak_mb: number | null;

  /**
   * Matches real `executions.cost_usd` — Lab's own computed BLENDED
   * total cost (may include local/rental costs beyond just a provider
   * bill). Rule: MUST be `null` when `cost_source === "NOT_MEASURED"`.
   */
  cost_usd: number | null;

  /** NEW field this round — matches real `executions.cost_source`, which this contract was missing entirely before the mapping check. `string` is kept in the union as an escape hatch for a real source string not yet enumerated here, matching the real column's TEXT type (not a fixed enum in the DB). */
  cost_source: "provider_billing_api" | "local_no_bill" | "NOT_MEASURED" | string;

  /** NEW, separate from cost_usd — matches real `executions.provider_cost_usd`: only what a remote billing API actually reported, never Lab's blended total. Populated from a real Claude Code SDK (or other provider) cost figure when one exists; null otherwise, never estimated. */
  provider_cost_usd: number | null;

  /** Renamed from rework_count — matches real `executions.retry_count` exactly; the original field already existed in the real schema, just under a different name. */
  retry_count: number;

  /**
   * NEW_CONTROL_FIELD — no real counterpart in `executions.status`
   * (RUNNING/COMPLETED/FAILED/TIMEOUT describes execution lifecycle, not
   * a pass/fail verdict). This is a genuinely new field the real schema
   * would need a migration to add if this contract is implemented as-is
   * — not silently pretended to already exist.
   */
  result: "PASSED" | "FAILED" | "PARTIAL";

  /**
   * Kept deliberately separate from `execution_id` — a Claude Code SDK
   * session id is a real, different id space from Lab's own
   * execution_id, and the two must never be conflated into one field.
   * NEW_SCHEMA_GAP: no column for this exists in `executions` today; a
   * later migration would be required if this field is retained.
   */
  provider_session_id: string | null;

  /** NEW_SCHEMA_GAP — no column for turn count exists in `executions` today. Do not imply this is already persisted anywhere. */
  provider_turn_count: number | null;

  /**
   * NEW_STRUCTURED_EVIDENCE_FIELD. Lab's real `executions` table only has
   * an unstructured `metadata_json TEXT` column today — there is no
   * structured, queryable evidence-list column this field could map to
   * without a later persistence-layer migration. Kept in this contract
   * as the intended shape, not as a claim that real storage for it
   * already exists.
   */
  evidence_source: readonly string[];
}
