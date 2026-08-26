/**
 * หน้าที่: the completion decision for a change — the point where "the screen
 * was never looked at" stops being able to reach COMPLETE (Owner, 2026-08-26).
 *
 * IT EXTENDS THE EXISTING GATE, IT DOES NOT REPLACE IT.
 * `../runtime-verification/` already answers the same shape of question for
 * runtime probes: is there a real evidence FILE, and is it fresher than the
 * work it claims to prove. This calls it with the render evidence file, so a
 * screenshot from before the change cannot be reused to pass a later one — the
 * freshness rule that folder already enforces is the one that applies here.
 *
 * NO MODEL CAN CHANGE A VERDICT. This function reads the impact assessment
 * (path rules) and the render evidence (real DOM), and returns a decision. It
 * has no input a model writes and no branch a model influences; `decided_by`
 * says so explicitly on every decision it returns.
 *
 * Input: the change's paths, execution id, and deploy/complete timing.
 * Output: `CompletionDecision`.
 * Dependency ที่อนุญาต: ./types.ts, ./impact.ts, ./render-verify.ts,
 * ../runtime-verification/contract.ts.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามอนุญาต COMPLETE เมื่อ UI_IMPACT=YES แต่ไม่มี render evidence.
 * - ห้ามถือว่า UNRESOLVED เท่ากับ NO.
 * - ห้ามให้ AI แก้ verdict.
 */

import type { CompletionDecision } from "./types";
import { assessUiImpact } from "./impact";
import { renderEvidenceFor, RENDER_EVIDENCE_FILE } from "./render-verify";
import { verifyRuntime } from "../runtime-verification/contract";

const DECIDED_BY = "control/ui-render-verification/gate.ts#decideCompletion (deterministic; no model on this path)";

export function decideCompletion(input: {
  execution_id: string;
  changed_paths: readonly string[];
  capability_id: string;
  /** When the change finished being applied — render evidence older than this proves an earlier state. */
  applied_at: string;
  correlation_id: string;
}): CompletionDecision {
  const at = new Date().toISOString();
  const assessment = assessUiImpact(input.changed_paths);

  if (assessment.impact === "NO") {
    return { status: "COMPLETE_ALLOWED", ui_impact: "NO", render_verdict: null, evidence_reference: null, reason: `no UI impact — ${assessment.reason}; the existing verification lifecycle applies unchanged`, decided_at: at, decided_by: DECIDED_BY };
  }

  if (assessment.impact === "UNRESOLVED") {
    return { status: "COMPLETE_DENIED", ui_impact: "UNRESOLVED", render_verdict: null, evidence_reference: null, reason: `UI impact could not be decided — ${assessment.reason}; an undecided change goes to verification, never to COMPLETE`, decided_at: at, decided_by: DECIDED_BY };
  }

  const evidence = renderEvidenceFor(input.execution_id);
  if (!evidence) {
    return { status: "COMPLETE_DENIED", ui_impact: "YES", render_verdict: null, evidence_reference: null, reason: "UI impact YES and no render evidence exists for this execution", decided_at: at, decided_by: DECIDED_BY };
  }

  // The existing gate decides whether that evidence file is real and fresh.
  const freshness = verifyRuntime({
    capability_id: input.capability_id,
    deploy_install_completed_at: input.applied_at,
    runtime_evidence_ref: RENDER_EVIDENCE_FILE,
    correlation_id: input.correlation_id,
  } as never);

  if (freshness.status !== "RUNTIME_VERIFIED") {
    return { status: "COMPLETE_DENIED", ui_impact: "YES", render_verdict: evidence.verdict, evidence_reference: evidence.evidence_reference, reason: `render evidence exists but ../runtime-verification/ refused it: ${freshness.status} — ${freshness.reason}`, decided_at: at, decided_by: DECIDED_BY };
  }

  if (evidence.verdict === "VERIFIED") {
    return { status: "COMPLETE_ALLOWED", ui_impact: "YES", render_verdict: "VERIFIED", evidence_reference: evidence.evidence_reference, reason: `render verified on ${evidence.route}: ${evidence.reason}`, decided_at: at, decided_by: DECIDED_BY };
  }

  return { status: "COMPLETE_DENIED", ui_impact: "YES", render_verdict: evidence.verdict, evidence_reference: evidence.evidence_reference, reason: `render ${evidence.verdict} on ${evidence.route}: ${evidence.reason}`, decided_at: at, decided_by: DECIDED_BY };
}
