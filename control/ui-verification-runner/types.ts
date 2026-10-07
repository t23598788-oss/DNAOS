/**
 * หน้าที่: สัญญาชนิดข้อมูลของ control/ui-verification-runner/ — ตัวรัน
 * ตรวจหน้าจอแบบกำหนดผลได้ (deterministic) ที่ DNA OS เรียกเอง
 *
 * ไม่มี AI ตัดสินอะไรในไฟล์นี้และในโมดูลนี้ ทุกค่าใน `observed_machine_value`
 * มาจากค่าที่เบราว์เซอร์คืนกลับมาตรง ๆ (bounding box, computed style, จำนวน
 * node, console entry, network status) ไม่ใช่การอ่านภาพหรือการตีความข้อความ
 *
 * Owner, 2026-09-05: "Do NOT use one AI Agent to verify another AI Agent" และ
 * "AGENT_TEXT = PASS ... เป็น non-authoritative" ชนิดข้อมูลที่นี่จึงไม่มีฟิลด์
 * ใดที่โมเดลเขียน verdict ได้ — `status` คำนวณจากการเทียบ expected กับ
 * observed เท่านั้น
 *
 * Input: none (นิยามชนิดล้วน)
 * Output: VerificationRequest, VerificationResult, Check, CheckType
 * Dependency ที่อนุญาต: none
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเพิ่มฟิลด์ที่ให้ Agent หรือโมเดลเขียน status
 * - ห้ามรวม BLOCKED เข้ากับ FAIL — ตรวจไม่ได้ ไม่เท่ากับ ตรวจแล้วตก
 * - ห้ามให้ screenshot เป็นที่มาของ status (เป็น evidence เท่านั้น)
 */

export type CheckStatus = "PASS" | "FAIL" | "BLOCKED";

export type CheckType =
  | "ROUTE_LOAD"
  | "DOM_STRUCTURE"
  | "ACCESSIBILITY"
  | "CONSOLE_ERRORS"
  | "NETWORK_ERRORS"
  | "DUPLICATED_HEADING"
  | "OVERLAP_GEOMETRY"
  | "CLIPPING"
  | "STALE_ROUTE_CONTENT"
  | "TOP_DIVIDER_PRESENT"
  | "COLLAPSED_NAV_GEOMETRY"
  | "NAV_REVEAL_INTERACTION"
  | "TEXT_READABILITY_RULES";

export interface Check {
  readonly check_id: string;
  readonly check_type: CheckType;
  readonly route: string;
  /** สิ่งที่ต้องเป็น เขียนเป็นข้อความที่อ่านออก แต่การเทียบใช้ค่าเครื่องด้านล่าง */
  readonly expected: string;
  /** ค่าที่เบราว์เซอร์คืนมาจริง — ตัวเลข/พิกัด/รายการ ไม่ใช่คำบรรยาย */
  readonly observed_machine_value: unknown;
  readonly status: CheckStatus;
  /** ทำไมถึงได้ status นี้ — ประโยคเดียวที่อธิบายการเทียบ ไม่ใช่ความเห็น */
  readonly reason: string;
  readonly evidence_pointer: string | null;
}

export interface VerificationRequest {
  readonly verification_request_id: string;
  readonly work_id: string | null;
  readonly task_id: string | null;
  readonly change_id: string;
  readonly changed_files: readonly string[];
  readonly affected_routes: readonly string[];
  /** ชื่อชุดตรวจที่ลงทะเบียนไว้ ไม่ใช่รายการ check ที่ผู้เรียกแต่งเองได้ */
  readonly verification_profile: string;
  readonly base_url: string;
}

export interface VerificationResult {
  readonly verification_id: string;
  readonly verification_request_id: string;
  readonly work_id: string | null;
  readonly task_id: string | null;
  readonly change_id: string;
  readonly profile: string;
  readonly status: CheckStatus;
  readonly checks: readonly Check[];
  readonly evidence: readonly string[];
  readonly started_at: string;
  readonly finished_at: string;
  /** ผู้ออกผล — ตั้งชื่อไว้ให้ไม่ต้องเดาว่ามีโมเดลเกี่ยวข้องไหม */
  readonly decided_by: string;
}
