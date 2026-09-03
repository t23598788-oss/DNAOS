/**
 * หน้าที่: ตัดสินว่า WriteAuditEvent หนึ่งแถวเป็น "งานที่อนุญาตแล้วล้มเหลว"
 * (ซ่อมได้) หรือเป็น "การป้องกันที่ทำงานถูกต้อง" (ห้ามส่ง Agent) — ด้วย
 * ฟังก์ชันบริสุทธิ์เหนือฟิลด์ที่มีอยู่แล้วเท่านั้น
 *
 * ทำไมตัดสินได้โดยไม่ต้องมี classifier ใหม่: `WriteAuditEvent` เป็นสัญญาเดียว
 * ใน repo นี้ที่บรรจุทั้ง "การอนุญาต" (`gate_decision_value`) และ "ผลจริง"
 * (`status`) ไว้ในแถวเดียวกัน สองข้อเท็จจริงนั้นคือทั้งหมดที่ต้องใช้ ไม่มี
 * การอ่านข้อความ ไม่มีการเดา ไม่มี AI และไม่มี taxonomy ใหม่
 *
 * ALLOW_* คือรายการปิด ไม่ใช่การเทียบ prefix: ค่าที่ระบบไม่รู้จักจะตกไปเป็น
 * "ไม่ใช่ ALLOW" เสมอ ซึ่งแปลว่าไม่ส่ง Agent — decision value ใหม่ที่ใครเพิ่ม
 * ในอนาคตจะไม่กลายเป็นช่องให้ผ่านไปเองโดยไม่มีใครตัดสินใจ
 *
 * Input: `WriteAuditEvent` (execution/file-write/contract.ts)
 * Output: `classifyWriteAudit`, `WriteFailureClass`, `ALLOW_DECISIONS`
 * Dependency ที่อนุญาต: type ของ execution/file-write/contract.ts เท่านั้น
 * สิ่งที่ห้ามแตะ: ห้ามอ่าน refusal_code เพื่อตัดสินสิทธิ์ — refusal_code บอกว่า
 * ล้มเหลวอย่างไร ไม่ได้บอกว่าถูกอนุญาตหรือไม่ และห้ามเพิ่มสถานะที่แปลว่า
 * "น่าจะซ่อมได้"
 */

import type { WriteAuditEvent } from "../../execution/file-write/contract";

/**
 * ค่าตัดสินของ Write Gate ที่แปลว่า "อนุญาตให้เขียน" — ตรงกับที่
 * `control/agent-gateway/agent-authority-router.ts` และ
 * `execution/file-write/executor.ts` ยอมรับเป๊ะ ไม่ใช่รายการที่ตั้งขึ้นใหม่
 */
export const ALLOW_DECISIONS: readonly string[] = ["ALLOW_CREATE", "ALLOW_MODIFY"];

export type WriteFailureClass =
  /** อนุญาตแล้วแต่ทำไม่สำเร็จ — นี่คือความล้มเหลวของระบบ ซ่อมได้ */
  | "AUTHORIZED_OPERATION_FAILED"
  /** ไม่อนุญาตและถูกหยุด — การป้องกันทำงานถูกต้อง ห้ามสั่งซ่อม */
  | "SECURITY_ENFORCEMENT_SUCCESS"
  /** ไม่อนุญาตแต่เขียนสำเร็จ — ห้ามซ่อมอัตโนมัติ ต้องให้คนดู */
  | "SECURITY_INCIDENT"
  /** อนุญาตและสำเร็จ — ไม่มีอะไรต้องทำ */
  | "NORMAL";

export interface EligibilityVerdict {
  readonly source_event_id: string;
  readonly classification: WriteFailureClass;
  /** มีเพียง AUTHORIZED_OPERATION_FAILED เท่านั้นที่เป็น true */
  readonly eligible_for_corrective_work: boolean;
  readonly gate_decision_value: string;
  readonly status: string;
  readonly refusal_code: string | null;
  /** ข้อเท็จจริงสองข้อที่ใช้ตัดสิน เขียนไว้ตรง ๆ เพื่อให้ตรวจย้อนได้ */
  readonly decided_from: readonly string[];
}

/**
 * ฟังก์ชันบริสุทธิ์: input เดียวกันได้ผลเดียวกันเสมอ ไม่อ่านดิสก์ ไม่เรียกเน็ต
 * ไม่ดูเวลา และไม่ดูแถวอื่น
 */
export function classifyWriteAudit(event: WriteAuditEvent): EligibilityVerdict {
  const allowed = ALLOW_DECISIONS.includes(event.gate_decision_value);
  const refused = event.status === "refused";
  const completed = event.status === "completed";

  const classification: WriteFailureClass = allowed
    ? (refused ? "AUTHORIZED_OPERATION_FAILED" : "NORMAL")
    : (completed ? "SECURITY_INCIDENT" : "SECURITY_ENFORCEMENT_SUCCESS");

  return {
    source_event_id: event.write_id,
    classification,
    eligible_for_corrective_work: classification === "AUTHORIZED_OPERATION_FAILED",
    gate_decision_value: event.gate_decision_value,
    status: event.status,
    refusal_code: event.refusal_code,
    decided_from: [
      `gate_decision_value=${event.gate_decision_value} (${allowed ? "in" : "not in"} ALLOW_DECISIONS)`,
      `status=${event.status}`,
    ],
  };
}
