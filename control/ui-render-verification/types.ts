/**
 * หน้าที่: type contracts for `control/ui-render-verification/` — the stage
 * that makes "did the screen actually render" part of the lifecycle instead of
 * something an agent is trusted to remember (Owner, 2026-08-26).
 *
 * NO MODEL DECIDES ANYTHING HERE. `UiImpact` comes from path rules over the
 * changed files; `RenderVerdict` comes from whether required strings were
 * present in the DOM the real browser produced. Neither type has a field a
 * model could write, and the gate below reads only these.
 *
 * `UNPROVEN` IS NOT `FAILED`, AND NEITHER IS `VERIFIED`. A run that could not
 * start the runtime, could not open the route, or produced no screenshot is
 * UNPROVEN — the completion gate denies on both, but the reason a change was
 * blocked stays readable afterwards.
 *
 * Input: none (pure type definitions).
 * Output: `UiImpact`, `UiImpactAssessment`, `RenderVerdict`, `RenderEvidence`,
 * `CompletionDecision`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเพิ่มฟิลด์ที่ให้ AI เขียน verdict.
 * - ห้ามรวม UNPROVEN เข้ากับ FAILED — คนละสาเหตุ.
 * - ห้ามให้ evidence ไม่มี lineage (execution/change/resource/digest/route).
 */

export type UiImpact = "YES" | "NO" | "UNRESOLVED";

export interface UiImpactAssessment {
  impact: UiImpact;
  /** Every changed path considered, and which rule decided it. */
  decided_by: readonly { path: string; rule: string; impact: UiImpact }[];
  /** The routes those paths are served on, when ownership could be resolved. */
  routes: readonly string[];
  reason: string;
}

export type RenderVerdict = "VERIFIED" | "FAILED" | "UNPROVEN";

/** The evidence a render produced. Every field is required so a screenshot can never be a file with no lineage. */
export interface RenderEvidence {
  execution_id: string;
  change_id: string;
  resource_id: readonly string[];
  capability_id: readonly string[];
  route: string;
  runtime_url: string;
  /** Digest of the sources this render was proving, so evidence cannot be reused across a later change. */
  source_digest: string;
  /** Which real data the page was reading — never a fixture. */
  data_source: string;
  screenshot_path: string;
  evidence_reference: string;
  observed_at: string;
  expected_elements: readonly string[];
  found_elements: readonly string[];
  missing_elements: readonly string[];
  /** Whether previously-required elements are still present — a change that renders itself while breaking the rest is not verified. */
  visual_regression: "NONE" | "DETECTED" | "NOT_CHECKED";
  verdict: RenderVerdict;
  reason: string;
}

export type CompletionStatus = "COMPLETE_ALLOWED" | "COMPLETE_DENIED";

export interface CompletionDecision {
  status: CompletionStatus;
  ui_impact: UiImpact;
  render_verdict: RenderVerdict | null;
  /** The evidence file the decision rests on, or null when there was none — which is itself a denial reason. */
  evidence_reference: string | null;
  reason: string;
  decided_at: string;
  /** Named so nobody has to guess whether a model was involved. */
  decided_by: string;
}
