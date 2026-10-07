/**
 * หน้าที่: เทียบ "สิ่งที่ควรเกิด" กับ "สิ่งที่เกิดจริง" ตามเส้นทาง แล้วชี้ขอบเขต
 * แรกที่ความจริงเปลี่ยน — ไม่ใช่ที่ที่อาการโผล่
 *
 * ── ทำไมต้องดู input ก่อน output ──
 * ขั้นที่ได้อินพุตเสียมาแล้วผลิตเอาต์พุตเสีย ไม่ได้ผิด มันเป็นเหยื่อ การชี้ไปที่
 * นั่นคือการซ่อมปลายทางขณะที่ต้นทางยังส่งของเสียอยู่ — พังซ้ำทันที ตัววิเคราะห์
 * จึงไล่ขึ้นไปหาขอบเขตแรกที่ **อินพุตดีแต่เอาต์พุตเสีย** หรือที่ **การส่งต่อ
 * ระหว่างขั้นเสีย** และเรียกที่นั่นว่าผู้ต้องสงสัย
 *
 * ── ผู้ต้องสงสัย ≠ ต้นเหตุที่พิสูจน์แล้ว ──
 * `proven_root_cause` ตั้งได้ก็ต่อเมื่อมี causal evidence เท่านั้น
 *
 * ── 200 ไม่ใช่ความสำเร็จของคน ──
 * ขั้นสุดท้ายถูกตัดสินด้วย `human_success_condition` ที่ประกาศไว้ล่วงหน้า
 * เส้นทางที่ทุกขั้นเทคนิคผ่านหมดแต่คนไม่ได้ผล = HUMAN_OUTCOME_FAILURE
 *
 * Input: `FlowStep[]`, `BoundaryContract[]`, `StepObservation[]`
 * Output: `analyzeFlow`
 * Dependency ที่อนุญาต: ./types.ts
 * สิ่งที่ห้ามแตะ: ห้ามตั้ง proven_root_cause โดยไม่มีหลักฐาน และห้ามใช้ชื่อไฟล์
 * หรือความคล้ายของชื่อมาจำกัดขอบเขตการค้นหา
 */

import type { BoundaryContract, ExpectedHumanOutcome, FlowAnalysis, FlowStep, ResponsibilityClass, StepObservation } from "./types";

export interface AnalyzeInput {
  readonly outcome: ExpectedHumanOutcome;
  readonly steps: readonly FlowStep[];
  readonly contracts: readonly BoundaryContract[];
  readonly observations: readonly StepObservation[];
  /** ผลระดับคน — ประเมินจากเงื่อนไขที่ประกาศไว้ ไม่ใช่จากรหัสสถานะ */
  readonly human_outcome_met?: boolean;
  readonly causal_evidence?: readonly string[];
}

/**
 * ชี้ขอบเขตสุดท้ายที่ยังดี และขอบเขตแรกที่เสีย
 *
 * ลำดับการตัดสินสำคัญ: การส่งต่อที่เสีย (เอาต์พุตต้นทางดี แต่อินพุตปลายทางเสีย)
 * ถูกจับก่อน เพราะขั้นปลายทางที่รับของเสียมาไม่ควรถูกกล่าวหา
 */
export function analyzeFlow(input: AnalyzeInput): FlowAnalysis {
  const obs = new Map(input.observations.map((o) => [o.flow_step_id, o]));
  const reasoning: string[] = [];
  let lastGood: string | null = null;
  let firstBad: string | null = null;
  let responsibility: ResponsibilityClass = "NO_FAILURE";
  let responsible: string | null = null;

  for (const step of input.steps) {
    const o = obs.get(step.flow_step_id);
    if (o === undefined) { reasoning.push(`${step.flow_step_id}: ไม่มีการสังเกต — ข้าม`); continue; }

    if (o.input_verdict === "BAD") {
      // อินพุตเสียมาแล้ว: ขั้นนี้เป็นเหยื่อ ต้นเหตุอยู่ที่การส่งต่อหรือขั้นก่อนหน้า
      const upstream = step.upstream_step;
      const contract = input.contracts.find((c) => c.to_step === step.flow_step_id);
      const upstreamOut = upstream ? obs.get(upstream)?.output_verdict : undefined;
      if (upstreamOut === "GOOD" && contract !== undefined) {
        firstBad = `${contract.from_step}->${contract.to_step} transfer`;
        responsibility = "TRANSFER_DEFECT";
        responsible = contract.from_step;
        reasoning.push(`${step.flow_step_id}: อินพุตเสีย แต่เอาต์พุตของ ${upstream} ดี -> ความเสียหายเกิดที่การส่งต่อ`);
      } else {
        firstBad = `${upstream ?? step.flow_step_id} output`;
        responsibility = "DOWNSTREAM_VICTIM";
        responsible = upstream;
        reasoning.push(`${step.flow_step_id}: อินพุตเสีย -> เป็นเหยื่อปลายทาง ไม่ใช่ผู้ก่อ`);
      }
      break;
    }

    if (o.output_verdict === "BAD") {
      // อินพุตดีแต่เอาต์พุตเสีย: ความจริงเปลี่ยนภายในขั้นนี้
      firstBad = `${step.flow_step_id} output`;
      responsibility = "ROOT_CAUSE_CANDIDATE";
      responsible = step.flow_step_id;
      reasoning.push(`${step.flow_step_id}: อินพุตดี เอาต์พุตเสีย -> ความจริงเปลี่ยนภายในขั้นนี้`);
      break;
    }

    if (o.input_verdict === "GOOD" && o.output_verdict === "GOOD") {
      lastGood = `${step.flow_step_id} output`;
    }
  }

  const technical: FlowAnalysis["technical_outcome"] =
    firstBad === null ? (input.observations.length > 0 ? "SUCCESS" : "UNKNOWN") : "FAILURE";

  let human: FlowAnalysis["human_outcome"] = "UNKNOWN";
  if (input.human_outcome_met !== undefined) {
    human = input.human_outcome_met ? "SUCCESS" : "FAILURE";
  }

  // 200 ทุกขั้น แต่คนไม่ได้ผล = ความล้มเหลวระดับคน และขอบเขตแรกที่เสียคือขั้นสุดท้าย
  if (technical === "SUCCESS" && human === "FAILURE") {
    const last = input.steps[input.steps.length - 1];
    firstBad = `${last.flow_step_id} human outcome`;
    responsibility = "HUMAN_OUTCOME_FAILURE";
    responsible = last.flow_step_id;
    reasoning.push(`ทุกขั้นผ่านทางเทคนิค แต่ไม่ตรง human_success_condition ที่ประกาศไว้: ${input.outcome.human_success_condition.slice(0, 60)}…`);
  }

  const causal = input.causal_evidence ?? [];
  const provenRoot = causal.length > 0 && responsible !== null ? responsible : null;
  if (causal.length === 0 && responsible !== null) {
    reasoning.push("ยังไม่มีหลักฐานเชิงเหตุ -> เป็นผู้ต้องสงสัย ไม่ใช่ต้นเหตุที่พิสูจน์แล้ว");
  }

  // ขอบเขตการค้นหามาจากความเป็นเจ้าของของขอบเขตที่เสียเท่านั้น
  const scope = responsible === null ? [] : (() => {
    const impl = input.steps.find((s) => s.flow_step_id === responsible)?.implementation;
    if (!impl || impl.repo_relative_path === null) return [];
    return [`${impl.repository_id ?? "repo:unknown"}:${impl.repo_relative_path}`];
  })();

  return {
    outcome_id: input.outcome.outcome_id,
    last_known_good_boundary: lastGood,
    first_bad_boundary: firstBad,
    responsibility,
    responsible_step: responsible,
    root_cause_candidate: responsibility === "ROOT_CAUSE_CANDIDATE" ? responsible : null,
    proven_root_cause: provenRoot,
    causal_evidence: causal,
    technical_outcome: technical,
    human_outcome: human,
    reasoning,
    candidate_scope: scope,
  };
}
