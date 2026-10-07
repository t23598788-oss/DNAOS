/**
 * หน้าที่: นิยามชนิดของ "ขั้นปฏิบัติการที่มีลำดับ" (Owner,
 * BUILD_ORDERED_OPERATIONAL_LIFECYCLE_AND_CONTINUATION_CONTROL).
 *
 * ปัญหาที่ชั้นนี้แก้ วัดได้จริง: เอกสาร lifecycle 14 ฉบับถูกส่งให้ Owner Surface
 * ด้วย `readdir(...).sort()` — ลำดับที่เจ้าของเห็นคือลำดับตัวอักษร ไม่ใช่ลำดับของงาน
 * ระบบจึงไม่มีที่ใดตอบได้ว่า "ตอนนี้อยู่ขั้นไหน" และไม่มีอะไรกันการข้ามขั้น
 *
 * ทำไมไม่สร้าง workflow engine ใหม่: การตัดสินว่า "ขั้นถัดไปทำได้หรือยัง" คือ
 * ปัญหาเดียวกับ `control/work-continuation/` แก้ไว้แล้ว — คีย์ที่ยังไม่พอ = ยังไปต่อไม่ได้
 * ชั้นนี้จึงแปลงขั้นเป็น `WaitingWork` + `DependencyKey` แล้วให้ `evaluate()` ตัวเดิม
 * เป็นผู้ตัดสิน ไม่มีตัวตัดสินตัวที่สองในระบบ
 *
 * ทำไมสถานะไม่ใช่ข้อความอิสระ: ถ้าสถานะเป็นข้อความ เครื่องจะต้องตีความ และการ
 * ตีความคือช่องที่ทำให้ "เขียนว่าเสร็จ" กลายเป็น "เสร็จ" — สถานะจึงเป็นชนิดปิด
 * และถูก *อนุมาน* จากหลักฐานเสมอ ไม่มี setter
 *
 * Input: none (นิยามล้วน).
 * Output: ชนิดข้างล่าง.
 * Dependency ที่อนุญาต: ../work-continuation/contract.ts (ชนิดคีย์เท่านั้น).
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่มฟังก์ชันตั้งสถานะโดยตรง, ห้ามให้ UI เป็นผู้กำหนดลำดับ,
 * ห้ามให้ "ไฟล์มีอยู่" นับเป็นเงื่อนไขจบ.
 */

import type { DependencyKey } from "../work-continuation/contract";

/**
 * คำศัพท์สถานะ — ปิดตาย เครื่องอ่านได้ทั้งหมด
 *
 * ระบบเดิมไม่มีคำศัพท์ชุดนี้ (ตรวจแล้ว: ไม่มี NOT_STARTED ที่ใดใน control/ software/)
 * จึงประกาศที่นี่เป็นที่เดียว และแมปเข้ากับ `ResumeVerdict` ของ work-continuation
 * แทนการตั้งกติกาการเลื่อนขั้นชุดที่สอง
 */
export type StageStatus =
  | "NOT_STARTED"
  | "READY"
  | "ACTIVE"
  | "BLOCKED"
  | "WAITING_OWNER"
  | "COMPLETE"
  | "FAILED";

/** ขั้นที่ไม่มีทางออกใด — ไม่มีขั้นถัดไป ไม่มีงาน ไม่มีตัวขวาง ไม่มีเหตุ ไม่มีการตัดสินของเจ้าของ */
export const ORPHANED = "ORPHANED";

/**
 * ชนิดของขั้น — บอกว่าอะไรนับว่า "จบ" สำหรับขั้นนั้น
 * `REFERENCE` คือเอกสารดัชนีที่ไม่ใช่ขั้นของงาน มันปลายทางเสมอและไม่กันขั้นอื่น
 */
export type StageKind = "GOVERNING_LAW" | "DISCOVERY" | "DESIGN" | "REFERENCE";

/**
 * ผลของการตรวจหลักฐานหนึ่งข้อ — เป็นการวัด ไม่ใช่การประกาศ
 * `measured` คือค่าจริงที่อ่านได้ เพื่อให้ผู้อ่านเห็นว่าห่างจากเงื่อนไขแค่ไหน
 */
export interface ConditionResult {
  readonly condition_id: string;
  readonly satisfied: boolean;
  readonly measured: string;
  readonly evidence_ref: string;
}

/**
 * การประกาศหนึ่งขั้น — ส่วนที่มนุษย์เขียน และเป็นส่วนเดียวที่มนุษย์เขียนได้
 * สถานะไม่อยู่ในนี้โดยเจตนา สถานะเป็นผลของการวัด
 */
export interface LifecycleStageDeclaration {
  readonly stage_id: string;
  /** ลำดับตามสารบัญ ไม่ใช่ตามตัวอักษรและไม่ใช่ตามตำแหน่งบนหน้าจอ */
  readonly sequence: number;
  readonly title: string;
  readonly stage_kind: StageKind;
  /** เอกสารต้นฉบับที่มีอยู่แล้ว — ชั้นนี้ไม่สร้างเอกสารซ้ำ */
  readonly document_id: string;
  readonly source_location: string;

  readonly depends_on_stage_ids: readonly string[];
  /** ประกาศชัดว่าขั้นใดขนานกันได้ — ไม่มีการขนานโดยปริยาย */
  readonly parallel_group: string | null;

  readonly entry_condition: string;
  /** เงื่อนไขจบ อ้างถึงตัวตรวจจริงใน ./conditions.ts เท่านั้น */
  readonly completion_condition_ids: readonly string[];
  /** หลักฐานที่ต้องมี นอกเหนือจากเงื่อนไขจบ — ไม่มีหลักฐาน = ไม่จบ */
  readonly verification_requirement: string;
}

/** สถานะของขั้นหนึ่ง ณ เวลาหนึ่ง — คำนวณทุกครั้ง ไม่เก็บเป็นความจริง */
export interface LifecycleStageState {
  readonly stage_id: string;
  readonly sequence: number;
  readonly title: string;
  readonly stage_kind: StageKind;
  readonly document_id: string;
  readonly source_location: string;
  readonly depends_on_stage_ids: readonly string[];
  readonly parallel_group: string | null;

  readonly status: StageStatus;
  readonly entry_condition: string;
  readonly completion_conditions: readonly ConditionResult[];
  readonly verification_requirement: string;
  readonly verification_satisfied: boolean;

  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly evidence_refs: readonly string[];
  readonly blocker: string | null;
  readonly next_stage_id: string | null;

  /** คีย์ที่ขั้นนี้รออยู่ ในรูปแบบเดียวกับ work-continuation */
  readonly blocked_on: readonly DependencyKey[];
  /** ขั้นก่อนหน้าที่ยังไม่จบ — เหตุผลที่ยังเป็น NOT_STARTED ไม่ใช่ READY */
  readonly blocked_by_stage_ids: readonly string[];
  readonly why_this_status: string;

  readonly active_work_id: string | null;
  readonly incident_id: string | null;
  readonly owner_decision_id: string | null;
  /** true เมื่อขั้นที่ยังไม่จบไม่มีทางออกใดเลย — ตรวจโดยหลังบ้าน ไม่ใช่ heuristic ของหน้าจอ */
  readonly orphaned: boolean;
}

/** คำตอบเดียวของ "ตอนนี้อยู่ขั้นไหน ต่อไปทำอะไร" */
export interface ContinuationDecision {
  readonly current_stage: string | null;
  readonly last_completed_stage: string | null;
  readonly next_eligible_stage: string | null;
  readonly why_this_stage: string;
  readonly blocked_by: readonly string[];
  readonly required_capabilities: readonly DependencyKey[];
  readonly required_evidence: readonly DependencyKey[];
  /** ขั้นที่ไม่มีทางออก — ต้องมีการตัดสินของเจ้าของ ไม่ปล่อยเงียบ */
  readonly orphaned_stage_ids: readonly string[];
  readonly owner_decision_required: boolean;
  /**
   * เหตุผลที่เลือกขั้นถัดไปไม่ได้ — null เมื่อเลือกได้
   * ห้ามเป็น null พร้อมกับ next_eligible_stage เป็น null ขณะที่ยังมีขั้นค้างอยู่
   * เพราะนั่นคือการเงียบ ซึ่งเป็นอาการที่ชั้นนี้มีไว้เพื่อกำจัด
   */
  readonly next_blocked_reason: string | null;
}

/** คีย์ของขั้น ใช้ namespace เดียวกับระบบคีย์เดิม ไม่ตั้งระบบคีย์ใหม่ */
export function stageKey(stageId: string): DependencyKey {
  return `lifecycle:stage:${stageId}`;
}
