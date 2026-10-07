/**
 * หน้าที่: ตัดสินจากการรันจริงว่าความจริงหยุดเป็นเรื่องเดียวกันตรงไหน
 *
 * ── สองจุดที่ไม่ใช่จุดเดียวกัน ──
 * `first_bad_boundary` คือจุดแรกที่ระบบเห็นว่าพัง
 * `first_truth_divergence` คือจุดแรกที่ข้อมูลหยุดแทนความจริงเดิม
 * ต้นทางส่ง "500" ที่หมายถึงบาท ปลายทางรับสำเร็จแล้วอ่านเป็นจำนวนชิ้น —
 * ขอบเขตนั้นไม่พัง แต่ความจริงตายไปแล้ว ถ้ารายงานได้ค่าเดียวจะเห็นแค่อาการ
 * ที่โผล่ทีหลัง และไปแก้ผิดที่ทุกครั้ง
 *
 * ── ไม่มีใครมาชี้ว่าขั้นไหนดี ──
 * ทุก verdict มาจาก observation ที่อ่านจากคลังหลักฐาน ไม่มีพารามิเตอร์ใดให้คน
 * ป้อนคำว่า GOOD หรือ BAD เข้ามา
 *
 * Input: `RuntimeStepObservation[]` จาก runtime-binding
 * Output: `analyzeRun`, `RunAnalysis`, `BoundaryResult`
 * Dependency ที่อนุญาต: semantics, recovery-flow (อ่านอย่างเดียว)
 * สิ่งที่ห้ามแตะ: ห้ามเลื่อน candidate เป็น proven โดยไม่มีหลักฐานเชิงเหตุ
 *                ห้ามเขียนไฟล์ ห้าม dispatch
 */

import { RECOVERY_FLOW, RECOVERY_OUTCOME } from "./recovery-flow";
import { compareSemantics, classifyTransformation, UNKNOWN } from "./semantics";
import type { MismatchClass, SemanticComparison, TransformationRecord } from "./semantics";
import type { RuntimeStepObservation } from "./runtime-binding";

export interface BoundaryResult {
  readonly boundary_id: string;
  readonly from_step: string;
  readonly to_step: string;
  readonly comparison: SemanticComparison;
  readonly mismatch_class: MismatchClass;
  readonly technically_valid: boolean;
  readonly truth_preserved: boolean;
  readonly upstream_output_refs: readonly string[];
  readonly downstream_input_refs: readonly string[];
}

export type RunResponsibility =
  | "DOWNSTREAM_VICTIM_CANDIDATE"
  | "LOCAL_ROOT_CAUSE_CANDIDATE"
  | "TRANSFER_ROOT_CAUSE_CANDIDATE"
  | "HUMAN_OUTCOME_FAILURE"
  | "NO_FAILURE";

export interface HumanOutcomeResult {
  readonly outcome_id: string;
  readonly expected_human_outcome: string;
  readonly actual_human_outcome: string;
  readonly technical_status: "SUCCESS" | "FAILURE" | "NOT_OBSERVED";
  readonly human_outcome_met: boolean | null;
  readonly evidence_refs: readonly string[];
  readonly detail: string;
}

export interface RunAnalysis {
  readonly run_id: string;
  readonly outcome_id: string;
  readonly observed_steps: readonly string[];
  readonly unobserved_steps: readonly string[];
  readonly boundaries: readonly BoundaryResult[];
  readonly transformations: readonly TransformationRecord[];

  readonly last_proven_truth: string | null;
  readonly first_bad_boundary: string | null;
  readonly first_truth_divergence: string | null;

  readonly responsibility: RunResponsibility;
  readonly root_cause_candidate: string | null;
  /** ไม่มีทางเป็นค่าอื่นนอกจาก null ในไฟล์นี้ — ต้องมีหลักฐานเชิงเหตุจากภายนอก */
  readonly proven_root_cause: null;
  readonly human_outcome: HumanOutcomeResult;
  readonly unknown_semantics: readonly string[];
  readonly implementation_scope: readonly string[];
}

/**
 * เงื่อนไขความสำเร็จเชิงมนุษย์ที่วัดได้จริง
 *
 * คำตอบ 200 สถานะ COMPLETED และการมี task_id ไม่นับเป็นข้อพิสูจน์ ถ้าไม่มี
 * หลักฐานว่า Owner ได้รับผลของคำสั่งตัวเอง ให้ตอบ `null` = ยังพิสูจน์ไม่ได้
 * ไม่ใช่ `true`
 */
function judgeHumanOutcome(obs: readonly RuntimeStepObservation[]): HumanOutcomeResult {
  const s10 = obs.find((o) => o.step_id === "S10_OWNER_PRESENTATION");
  const refs = s10?.runtime_evidence_refs ?? [];
  if (s10 === undefined || !s10.observed) {
    return { outcome_id: RECOVERY_OUTCOME.outcome_id,
      expected_human_outcome: RECOVERY_OUTCOME.expected_human_outcome,
      actual_human_outcome: "NOT_OBSERVED", technical_status: "NOT_OBSERVED",
      human_outcome_met: null, evidence_refs: refs,
      detail: "ไม่มีหลักฐานว่าสิ่งใดถึงมือ Owner — ไม่ใช่ความล้มเหลว แต่พิสูจน์ความสำเร็จไม่ได้" };
  }
  if (s10.technical_status === "FAILURE") {
    return { outcome_id: RECOVERY_OUTCOME.outcome_id,
      expected_human_outcome: RECOVERY_OUTCOME.expected_human_outcome,
      actual_human_outcome: "FAILED_BEFORE_REACHING_OWNER", technical_status: "FAILURE",
      human_outcome_met: false, evidence_refs: refs, detail: "ขั้นสุดท้ายล้มเหลว Owner ไม่ได้ผลของคำสั่ง" };
  }
  // เทคนิคผ่าน แต่ความสำเร็จเชิงมนุษย์ต้องการหลักฐานของตัวเอง
  const proven = s10.output.state === "OWNER_RECEIVED_RESULT";
  return { outcome_id: RECOVERY_OUTCOME.outcome_id,
    expected_human_outcome: RECOVERY_OUTCOME.expected_human_outcome,
    actual_human_outcome: proven ? "OWNER_RECEIVED_RESULT" : "TECHNICAL_SUCCESS_ONLY",
    technical_status: "SUCCESS", human_outcome_met: proven ? true : null, evidence_refs: refs,
    detail: proven
      ? "มีหลักฐานว่าผลถึง Owner จริง"
      : "ผ่านทางเทคนิคเท่านั้น — 200/COMPLETED/task_id ไม่พิสูจน์ว่าคนได้สิ่งที่ต้องการ" };
}

/** วิเคราะห์หนึ่งการรันจาก observation ล้วน ๆ */
export function analyzeRun(runId: string, obs: readonly RuntimeStepObservation[]): RunAnalysis {
  const byStep = new Map(obs.map((o) => [o.step_id, o]));
  const observedSteps = obs.filter((o) => o.observed).map((o) => o.step_id);
  const unobserved = obs.filter((o) => !o.observed).map((o) => o.step_id);

  const boundaries: BoundaryResult[] = [];
  for (const step of RECOVERY_FLOW) {
    if (step.downstream_step === null) continue;
    const up = byStep.get(step.flow_step_id);
    const down = byStep.get(step.downstream_step);
    if (up === undefined || down === undefined || !up.observed || !down.observed) continue;
    const cmp = compareSemantics(up.output, down.input);
    boundaries.push({
      boundary_id: `${up.step_id}->${down.step_id}`,
      from_step: up.step_id, to_step: down.step_id,
      comparison: cmp, mismatch_class: cmp.mismatch_class,
      technically_valid: cmp.technically_valid, truth_preserved: cmp.truth_preserved,
      upstream_output_refs: up.output_evidence_refs,
      downstream_input_refs: down.input_evidence_refs,
    });
  }

  const transformations = obs
    .filter((o) => o.observed)
    .map((o) => classifyTransformation(o.step_id, o.input.meaning, o.output.meaning, o.transformation_id));

  // จุดแรกที่ระบบเห็นว่าพัง
  const failedStep = obs.find((o) => o.observed && o.technical_status === "FAILURE");
  const badBoundary = boundaries.find((b) => !b.technically_valid);
  const firstBad = badBoundary !== undefined && failedStep !== undefined
    ? (RECOVERY_FLOW.findIndex((s) => s.flow_step_id === badBoundary.from_step)
       <= RECOVERY_FLOW.findIndex((s) => s.flow_step_id === failedStep.step_id)
        ? `${badBoundary.boundary_id} transfer` : `${failedStep.step_id} output`)
    : badBoundary !== undefined ? `${badBoundary.boundary_id} transfer`
    : failedStep !== undefined ? `${failedStep.step_id} output`
    : null;

  // จุดแรกที่ความจริงเปลี่ยน — อาจอยู่ก่อนหน้าและอาจไม่พังทางเทคนิคเลย
  const divergentTransfer = boundaries.find((b) => !b.truth_preserved);
  const divergentStep = transformations.find((t) => t.verdict === "SEMANTIC_DIVERGENCE");
  const idx = (s: string): number => RECOVERY_FLOW.findIndex((f) => f.flow_step_id === s);
  const firstDivergence = divergentTransfer !== undefined && divergentStep !== undefined
    ? (idx(divergentTransfer.from_step) <= idx(divergentStep.step_id)
        ? `${divergentTransfer.boundary_id} transfer` : `${divergentStep.step_id} transformation`)
    : divergentTransfer !== undefined ? `${divergentTransfer.boundary_id} transfer`
    : divergentStep !== undefined ? `${divergentStep.step_id} transformation`
    : null;

  const firstProblem = firstDivergence ?? firstBad;
  const problemStep = firstProblem?.split(/->| /)[0] ?? null;
  const lastProven = problemStep !== null && idx(problemStep) > 0
    ? `${RECOVERY_FLOW[idx(problemStep) - 1].flow_step_id} output` : null;

  const human = judgeHumanOutcome(obs);

  let responsibility: RunResponsibility = "NO_FAILURE";
  let candidate: string | null = null;
  if (firstDivergence !== null && divergentTransfer !== undefined
      && (divergentStep === undefined || idx(divergentTransfer.from_step) <= idx(divergentStep.step_id))) {
    responsibility = "TRANSFER_ROOT_CAUSE_CANDIDATE";
    candidate = divergentTransfer.boundary_id;
  } else if (divergentStep !== undefined) {
    responsibility = "LOCAL_ROOT_CAUSE_CANDIDATE";
    candidate = divergentStep.step_id;
  } else if (badBoundary !== undefined && failedStep !== undefined
             && idx(badBoundary.from_step) < idx(failedStep.step_id)) {
    // อินพุตที่รับมาผิดสัญญาอยู่แล้ว — ขั้นที่ล้มเป็นผู้รับกรรม ไม่ใช่ต้นเหตุ
    responsibility = "DOWNSTREAM_VICTIM_CANDIDATE";
    candidate = badBoundary.boundary_id;
  } else if (badBoundary !== undefined) {
    responsibility = "TRANSFER_ROOT_CAUSE_CANDIDATE";
    candidate = badBoundary.boundary_id;
  } else if (failedStep !== undefined) {
    responsibility = "LOCAL_ROOT_CAUSE_CANDIDATE";
    candidate = failedStep.step_id;
  } else if (human.human_outcome_met === false) {
    responsibility = "HUMAN_OUTCOME_FAILURE";
    candidate = "S10_OWNER_PRESENTATION";
  }

  const unknownSemantics = obs
    .filter((o) => o.observed && (o.output.meaning === UNKNOWN || o.output.unit === UNKNOWN))
    .map((o) => o.step_id);

  // ขอบเขตการซ่อม = โค้ดของขั้นที่รับผิดชอบเท่านั้น ไม่ใช่ทุกขั้นที่มีอาการ
  const scopeSteps = candidate === null ? []
    : candidate.includes("->") ? [candidate.split("->")[0]] : [candidate];
  const implementation_scope = scopeSteps
    .map((s) => byStep.get(s)?.repo_relative_path)
    .filter((x): x is string => typeof x === "string" && x.length > 0);

  return {
    run_id: runId, outcome_id: RECOVERY_OUTCOME.outcome_id,
    observed_steps: observedSteps, unobserved_steps: unobserved,
    boundaries, transformations,
    last_proven_truth: lastProven, first_bad_boundary: firstBad, first_truth_divergence: firstDivergence,
    responsibility, root_cause_candidate: candidate, proven_root_cause: null,
    human_outcome: human, unknown_semantics: unknownSemantics, implementation_scope,
  };
}
