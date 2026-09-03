/**
 * หน้าที่: แบบจำลอง "สิ่งที่ Owner ต้องการให้เกิด" เทียบกับ "สิ่งที่เกิดจริง"
 *
 * ── ทำไมไม่เริ่มจากไฟล์ ──
 * ไฟล์บอกได้แค่ว่าโค้ดอยู่ที่ไหน ไม่ได้บอกว่ามันควรทำให้อะไรเกิดขึ้นกับคน
 * การไล่หาสาเหตุจาก error location จึงเริ่มจากปลายทางเสมอ และมักลงเอยด้วยการ
 * แก้ที่ที่อาการโผล่ ไม่ใช่ที่ที่ความจริงเปลี่ยน แบบจำลองนี้จึงบังคับให้
 * **ความหมายมาก่อนซอร์ส**: OWNER_INTENT และ EXPECTED_HUMAN_OUTCOME ถูกประกาศ
 * และมีตัวตนของตัวเอง ก่อนที่ไฟล์ใดจะถูกผูกเข้ามา
 *
 * ── กฎที่ล็อกไว้ในชนิดข้อมูล ──
 *   FILE ≠ MEANING          `implementation` เป็น optional และแยกจาก `purpose`
 *   OBSERVED_AT ≠ CAUSED_BY `first_bad_boundary` ไม่ใช่ `proven_root_cause`
 *   DEPENDENCY ≠ CAUSATION  ต้องมี causal evidence จึงยกระดับได้
 *   HTTP_SUCCESS ≠ HUMAN_SUCCESS  `technical_outcome` กับ `human_outcome` แยกช่องกัน
 *
 * Input: none (สัญญาปลายทาง)
 * Output: ชนิดข้อมูลทั้งหมดของแบบจำลอง
 * Dependency ที่อนุญาต: none
 * สิ่งที่ห้ามแตะ: ห้ามรวม technical_outcome กับ human_outcome เป็นช่องเดียว
 * และห้ามให้ `implementation` เป็นสิ่งที่พิสูจน์ `purpose`
 */

/** ผลลัพธ์ระดับคน — ประกาศก่อนซอร์ส และมีตัวตนถาวรของตัวเอง */
export interface ExpectedHumanOutcome {
  readonly outcome_id: string;
  readonly owner_intent: string;
  readonly expected_human_outcome: string;
  /** อะไรจึงจะเรียกว่าคนได้สิ่งที่ต้องการจริง — ไม่ใช่ "ระบบตอบ 200" */
  readonly human_success_condition: string;
  readonly declared_at: string;
  /** ที่มาของความหมาย — ต้องไม่ใช่ชื่อไฟล์ */
  readonly meaning_source: string;
}

export type StepVerdict = "GOOD" | "BAD" | "UNKNOWN";

export interface FlowStep {
  readonly flow_step_id: string;
  readonly purpose: string;
  readonly required_input: string;
  readonly expected_output: string;
  readonly upstream_step: string | null;
  readonly downstream_step: string | null;
  readonly success_condition: string;
  readonly failure_condition: string;
  readonly evidence_required: readonly string[];
  /** ผูกทีหลังเท่านั้น — ขั้นนี้มีความหมายได้โดยยังไม่มีโค้ด */
  readonly implementation?: StepImplementation | null;
}

export interface StepImplementation {
  readonly capability_id: string | null;
  readonly resource_id: string | null;
  readonly repository_id: string | null;
  readonly repo_relative_path: string | null;
  readonly runtime_entrypoint: string | null;
  readonly ownership_status: "OWNED" | "MISSING_CAPABILITY_OWNERSHIP";
  readonly evidence: readonly string[];
}

/** สัญญาระหว่างสองขั้น — ชื่อไฟล์แทนสัญญาไม่ได้ */
export interface BoundaryContract {
  readonly from_step: string;
  readonly to_step: string;
  readonly contract: string;
  readonly expected_from_output: string;
  readonly expected_to_input: string;
  readonly actual_from_output?: string | null;
  readonly actual_to_input?: string | null;
  readonly input_evidence: readonly string[];
  readonly output_evidence: readonly string[];
}

/** สิ่งที่วัดได้จริงของหนึ่งขั้นในหนึ่งการรัน */
export interface StepObservation {
  readonly flow_step_id: string;
  readonly input_verdict: StepVerdict;
  readonly output_verdict: StepVerdict;
  readonly actual_input: string | null;
  readonly actual_output: string | null;
  readonly evidence: readonly string[];
}

export type ResponsibilityClass =
  | "DOWNSTREAM_VICTIM"
  | "ROOT_CAUSE_CANDIDATE"
  | "TRANSFER_DEFECT"
  | "HUMAN_OUTCOME_FAILURE"
  | "NO_FAILURE";

export interface FlowAnalysis {
  readonly outcome_id: string;
  readonly last_known_good_boundary: string | null;
  readonly first_bad_boundary: string | null;
  readonly responsibility: ResponsibilityClass;
  readonly responsible_step: string | null;
  /** ผู้ต้องสงสัย ยังไม่ใช่ข้อสรุป */
  readonly root_cause_candidate: string | null;
  /** ต้องมีหลักฐานเชิงเหตุเท่านั้น */
  readonly proven_root_cause: string | null;
  readonly causal_evidence: readonly string[];
  readonly technical_outcome: "SUCCESS" | "FAILURE" | "UNKNOWN";
  readonly human_outcome: "SUCCESS" | "FAILURE" | "UNKNOWN";
  readonly reasoning: readonly string[];
  /** ขอบเขตการค้นหาที่เหลือหลังจำกัดด้วยแบบจำลอง */
  readonly candidate_scope: readonly string[];
}
