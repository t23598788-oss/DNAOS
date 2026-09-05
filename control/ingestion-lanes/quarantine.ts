/**
 * หน้าที่: จำแนกแถวเก่าที่ตีความผิด โดยไม่ลบและไม่เล่นซ้ำ
 *
 * Owner, 2026-09-05 ข้อ 10-12: ห้ามลบข้อมูลเก่า ห้าม replay อัตโนมัติ
 * แต่การคำนวณสถานะธุรกิจต้องกันแถวที่ยังพิสูจน์ความหมายไม่ได้ออกไปได้
 *
 * ฟังก์ชันจำแนกในไฟล์นี้เป็นฟังก์ชันบริสุทธิ์ — รับแถวเข้ามาแล้วตอบว่าเป็นอะไร
 * ไม่ต่อฐานข้อมูลเอง เพื่อให้เรียกได้ทั้งตอนทดสอบและตอนมีสิทธิ์อ่านของจริง
 *
 * Dependency ที่อนุญาต: ./types.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเพิ่มโค้ดที่ลบหรือแก้แถวเดิม
 * - ห้ามเล่นซ้ำอัตโนมัติไม่ว่ากรณีใด
 */

import type { BusinessDomain } from "./types";

export type LegacyClass =
  | "TRUE_SALES_EVENT" | "TRUE_DOMAIN_EVENT" | "RAW_OBSERVATION_WRITTEN_AS_EVENT"
  | "CLASSIFICATION_RESULT_WRITTEN_AS_EVENT" | "CLAIM_WRITTEN_AS_FACT"
  | "MISROUTED_EVENT" | "UNKNOWN";

export type RepairAction = "IGNORE" | "RECLASSIFY" | "REPLAY_REQUIRED" | "MANUAL_REVIEW" | "KEEP_AS_HISTORY";

export interface LegacyEventRow {
  readonly id?: string;
  readonly event_code?: string;
  readonly event_type: string | null;
  readonly status?: string | null;
  readonly material_text?: string | null;
  readonly quantity?: number | null;
  readonly destination?: string | null;
  readonly confidence?: number | null;
}

export interface MisroutedLegacyEvent {
  readonly schema: "MISROUTED_LEGACY_EVENT_V1";
  readonly record_ref: string;
  readonly original_event_type: string | null;
  readonly original_domain: "SALES";
  readonly classification: LegacyClass;
  readonly detected_problem: string | null;
  readonly expected_domain: readonly BusinessDomain[];
  readonly confidence: number | null;
  readonly evidence: readonly string[];
  readonly current_state_effect: string;
  readonly financial_effect_if_any: string | null;
  readonly repair_action: RepairAction;
  /** เป็น false เสมอ — ไม่มีการเล่นซ้ำอัตโนมัติในระบบนี้ */
  readonly automatic_replay: false;
}

/**
 * คำศัพท์สองชุดที่ไม่เคยตรงกัน
 *
 * ชุดภาษาอังกฤษคือของที่ "ออกแบบไว้" — อยู่ใน migration comment และ
 * engines/transactions/document-link.ts
 * ชุดภาษาไทยคือของที่ "อยู่จริงใน production" — โมเดลเขียนเป็นข้อความอิสระ
 * ลงคอลัมน์ที่ระบบอื่นอ่านเหมือนเป็น enum ปิด
 *
 * สแกนจริง 2026-09-05 พบ 172 แถว 10 ค่า และไม่มีค่าอังกฤษที่ออกแบบไว้เลยสักค่า
 */
const SALES_TYPES = new Set(["quotation_sent", "po_received", "ขอราคา", "สั่งซื้อ", "inquiry"]);
const DOCUMENT_TYPES = new Set(["invoice_issued", "receipt_received", "ส่งเอกสาร"]);
const FINANCE_TYPES = new Set(["payment_received", "debt_closed", "debt_started", "interest_penalty_received"]);
const LOGISTICS_TYPES = new Set(["delivery_made", "work_started"]);
/** การแจ้งว่าจ่ายแล้วเป็นคำกล่าวอ้าง ไม่ใช่ข้อเท็จจริงที่จับคู่แล้ว */
const CLAIM_TYPES = new Set(["promise_to_pay", "แจ้งชำระเงิน", "แจ้งข้อมูลการชำระเงิน"]);
const LOCATION_TYPES = new Set(["ส่งพิกัด"]);
const GENERAL_TYPES = new Set(["สอบถามทั่วไป", "line_chat", "อื่นๆ"]);

/** แถวที่คำนวณสถานะธุรกิจไม่ควรนับ */
const EXCLUDED_FROM_BUSINESS_STATE: ReadonlySet<LegacyClass> = new Set([
  "MISROUTED_EVENT", "UNKNOWN", "RAW_OBSERVATION_WRITTEN_AS_EVENT",
  "CLASSIFICATION_RESULT_WRITTEN_AS_EVENT", "CLAIM_WRITTEN_AS_FACT",
]);

export function classifyLegacyRow(row: LegacyEventRow): MisroutedLegacyEvent {
  const type = (row.event_type ?? "").trim();
  const ref = row.event_code ?? row.id ?? "(ไม่มีตัวชี้)";
  const hasSalesSubstance = (row.material_text ?? "") !== "" || row.quantity !== null && row.quantity !== undefined
    || (row.destination ?? "") !== "";

  let classification: LegacyClass = "UNKNOWN";
  let expected: BusinessDomain[] = [];
  let problem: string | null = null;
  let repair: RepairAction = "MANUAL_REVIEW";
  let financial: string | null = null;

  if (SALES_TYPES.has(type)) {
    classification = "TRUE_SALES_EVENT"; expected = ["SALES"]; repair = "KEEP_AS_HISTORY";
  } else if (DOCUMENT_TYPES.has(type)) {
    classification = "TRUE_DOMAIN_EVENT"; expected = ["DOCUMENT"]; repair = "RECLASSIFY";
    problem = "เป็นเหตุการณ์ฝั่งเอกสารแต่ถูกเก็บรวมในตารางที่ถูกอ่านเป็นงานขาย";
  } else if (FINANCE_TYPES.has(type)) {
    classification = "TRUE_DOMAIN_EVENT"; expected = ["FINANCE"]; repair = "RECLASSIFY";
    problem = "เป็นเหตุการณ์ฝั่งการเงินแต่ถูกเก็บรวมในตารางที่ถูกอ่านเป็นงานขาย";
    financial = "กระทบยอดหนี้หรือการรับเงิน ต้องตรวจก่อนนับรวม";
  } else if (LOGISTICS_TYPES.has(type)) {
    classification = "TRUE_DOMAIN_EVENT"; expected = ["LOGISTICS"]; repair = "RECLASSIFY";
  } else if (CLAIM_TYPES.has(type)) {
    classification = "CLAIM_WRITTEN_AS_FACT"; expected = ["FINANCE"]; repair = "MANUAL_REVIEW";
    problem = "คำกล่าวอ้างว่าจะจ่าย ถูกบันทึกเป็นข้อเท็จจริงที่เกิดแล้ว";
    financial = "ห้ามนับเป็นการชำระจนกว่าตัวจับคู่ยืนยัน";
  } else if (LOCATION_TYPES.has(type)) {
    classification = "MISROUTED_EVENT"; expected = ["LOCATION"]; repair = "RECLASSIFY";
    problem = "การแชร์พิกัดถูกเขียนเป็นเหตุการณ์ธุรกิจในตารางฝั่งขาย";
  } else if (GENERAL_TYPES.has(type)) {
    classification = hasSalesSubstance ? "MISROUTED_EVENT" : "RAW_OBSERVATION_WRITTEN_AS_EVENT";
    expected = ["GENERAL_CONVERSATION"]; repair = "RECLASSIFY";
    problem = hasSalesSubstance
      ? `event_type="${type}" ที่มีข้อความวัสดุ ถูกปล่อยผ่านเป็นเหตุการณ์ธุรกิจ (build-event-from-extraction.ts:29 เดิม)`
      : "ข้อสังเกตดิบถูกเขียนเป็นเหตุการณ์";
  } else if (type === "") {
    classification = "UNKNOWN"; expected = []; repair = "MANUAL_REVIEW";
    problem = "ไม่มี event_type";
  } else {
    classification = "MISROUTED_EVENT"; expected = ["GENERAL_CONVERSATION"]; repair = "MANUAL_REVIEW";
    problem = `event_type="${type}" ไม่อยู่ในรายการที่รู้จัก`;
  }

  if (typeof row.confidence === "number" && row.confidence < 0.7 && classification === "TRUE_SALES_EVENT") {
    classification = "CLASSIFICATION_RESULT_WRITTEN_AS_EVENT";
    problem = `ความมั่นใจ ${row.confidence} ต่ำ แต่ถูกบันทึกเป็นเหตุการณ์จริง`;
    repair = "MANUAL_REVIEW";
  }

  return {
    schema: "MISROUTED_LEGACY_EVENT_V1",
    record_ref: ref, original_event_type: row.event_type, original_domain: "SALES",
    classification, detected_problem: problem, expected_domain: expected,
    confidence: row.confidence ?? null,
    evidence: [`event_type=${type || "(ว่าง)"}`, `status=${row.status ?? "(ไม่มี)"}`],
    current_state_effect: EXCLUDED_FROM_BUSINESS_STATE.has(classification)
      ? "ต้องกันออกจากการคำนวณสถานะธุรกิจ"
      : "นับรวมได้ตามปกติ",
    financial_effect_if_any: financial,
    repair_action: repair,
    automatic_replay: false,
  };
}

/** §12 ตัวกรองที่ผู้คำนวณสถานะธุรกิจต้องใช้ — เก็บแถวไว้ แต่ไม่นับรวม */
export function includeInBusinessState(classified: MisroutedLegacyEvent): boolean {
  return !EXCLUDED_FROM_BUSINESS_STATE.has(classified.classification);
}
