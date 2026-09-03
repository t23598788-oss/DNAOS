/**
 * หน้าที่: ทำให้ "ท่อ incident ท่อเดียว" รับเหตุได้จากหลายแหล่ง โดยที่คอมไพเลอร์
 * เป็นคนกันไม่ให้แหล่งหนึ่งแกล้งเป็นอีกแหล่ง
 * (Owner, EXTEND_EXISTING_INCIDENT_INPUT_CONTRACT).
 *
 * แหล่งใหม่ ≠ ระบบใหม่ — นี่คือหลักการทั้งหมดของไฟล์นี้ หลังผ่านจุด normalize
 * ทุกอย่างเดินท่อเดิมทุกประการ: persistence, owner escalation, root cause,
 * gap scan, repair planning, resource resolution, verification, resume
 *
 * ทำไมเป็น discriminated union ไม่ใช่ "ทำทุกฟิลด์ให้ optional": ถ้าอีเมลกับ
 * เหตุภายในใช้ชนิดเดียวกันที่ฟิลด์ว่างได้หมด สองอย่างจะกลายเป็นสิ่งเดียวกันในสายตา
 * ของคอมไพเลอร์ แล้วไม่มีอะไรกันเหตุภายในจากการอ้างว่ามีหลักฐานอีเมล และไม่มีอะไร
 * บังคับให้อีเมลจริงต้องมีหลักฐานครบอีกต่อไป — ความเข้มงวดของฝั่งอีเมลจะหายไปเงียบ ๆ
 *
 * `ExecutionFailureReport` จึงไม่มีฟิลด์ sender/message_id/thread_id/provider/
 * email_evidence เลยแม้แต่ช่องเดียว การจะปลอมมันขึ้นมาต้องแก้ไฟล์นี้ ซึ่งเห็นใน diff
 *
 * Input: OwnerIncidentReport (อีเมล) หรือ ExecutionFailureReport (การรันจริง).
 * Output: `IncidentSource`, `ExecutionFailureReport`, `normalizeIncidentSource`.
 * Dependency ที่อนุญาต: ../alert-correlation/contract.ts, ../work-resolution/contract.ts.
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่มฟิลด์อีเมลลงใน ExecutionFailureReport, ห้ามทำให้
 * ฟิลด์บังคับของฝั่งอีเมลกลายเป็น optional, ห้ามเดาค่าที่การรันไม่ได้ให้มา.
 */

import { UNKNOWN } from "../work-resolution/contract";
import type { OwnerIncidentReport } from "../alert-correlation/contract";

/** ค่าที่แปลว่า "ฟิลด์นี้ไม่เกี่ยวกับแหล่งนี้" — คนละความหมายกับ UNKNOWN */
export const NOT_APPLICABLE = "NOT_APPLICABLE";

export type ExecutionFailureType =
  | "FAILED" | "STALLED" | "TIMEOUT" | "PROCESS_EXITED"
  | "AUTH_FAILED" | "RESOURCE_UNAVAILABLE" | "CONNECTION_FAILED" | "VERIFICATION_FAILED";

/**
 * เหตุที่เกิดจากการทำงานของระบบเอง — ทุกฟิลด์มาจากสถานะการรันจริง
 *
 * ไม่มีช่องสำหรับ sender/message_id/thread_id/provider/email_evidence โดยเจตนา
 * ค่าที่การรันไม่ได้ให้มาต้องเป็น null ไม่ใช่สตริงที่แต่งขึ้น
 */
export interface ExecutionFailureReport {
  readonly work_order_id: string;
  readonly task_id: string | null;
  readonly plan_id: string | null;
  readonly step_id: string | null;
  /**
   * ขั้นของวงจรปฏิบัติการที่งานนี้อยู่ตอนที่ล้ม — บันทึกโดยผู้สังเกต ไม่ใช่เดาย้อนหลัง
   * ถ้าไม่มีค่านี้ เหตุจะบอกได้แค่ "ทรัพยากร X ล้ม" แต่บอกไม่ได้ว่า "ขั้น 4 ล้ม"
   * และการทำงานต่อหลังซ่อมจะไม่รู้ว่าต้องกลับไปที่ขั้นไหน
   */
  readonly lifecycle_stage_id: string | null;

  readonly failure_type: ExecutionFailureType;
  /** ขั้นของ lifecycle ที่มันหยุด เช่น "RESOURCE_INVOCATION" */
  readonly failure_stage: string;

  readonly capability_id: string | null;
  readonly resource_id: string | null;
  readonly operation: string | null;

  readonly started_at: string;
  /** ครั้งสุดท้ายที่มีความคืบหน้าจริง — null เมื่อไม่เคยมีเลย */
  readonly last_progress_at: string | null;
  readonly detected_at: string;

  readonly error: string | null;
  readonly exit_code: number | null;
  readonly timeout_ms: number | null;

  readonly source_location: string | null;
  readonly last_successful_evidence_id: string | null;
  /** ใครเป็นคนสังเกตเห็น — ต้องไม่ใช่ตัวที่ค้างเอง */
  readonly observed_by: string;
}

/**
 * แหล่งที่มาของเหตุ — คอมไพเลอร์บังคับว่าเลือกได้ทางเดียว
 * เพิ่ม source kind ใหม่ในอนาคตทำได้โดยไม่แตะท่อหลัง normalize
 */
export type IncidentSource =
  | { readonly source_kind: "EXTERNAL_PROVIDER_EMAIL"; readonly report: OwnerIncidentReport }
  | { readonly source_kind: "INTERNAL_EXECUTION_FAILURE"; readonly failure: ExecutionFailureReport };

/**
 * รูปกลางที่ท่อ remediation ใช้จริง — ทั้งสองแหล่งถูกแปลงมาลงรูปนี้
 * แล้วจากจุดนี้ไปไม่มีโค้ดใดรู้อีกว่าเหตุมาจากไหน
 */
export interface NormalizedIncident {
  readonly source_kind: IncidentSource["source_kind"];
  readonly service_id: string;
  /** ผู้ให้บริการภายนอก — NOT_APPLICABLE สำหรับเหตุภายใน ไม่ใช่ UNKNOWN */
  readonly provider: string;
  readonly incident_label: string;
  readonly current_real_state: string;
  readonly recommended_next_software_action: string;
  readonly affected_resource: string;
  readonly decision_required: "OWNER" | "NONE";
  readonly is_financial: boolean;
  /** true เมื่อเป้าหมายระบุไม่ได้ — ฝั่งอีเมลมาจาก provider domain, ฝั่งภายในมาจากตัวตนการรัน */
  readonly unresolved: boolean;
  readonly unresolved_reason: string;
  /** ตัวตนของการรัน มีเฉพาะเหตุภายใน — ฝั่งอีเมลเป็น null ทั้งก้อน */
  readonly execution_identity: ExecutionFailureReport | null;
}

const FINANCIAL_ALERT_TYPES = new Set(["BILLING_FAILURE"]);

/**
 * แปลงแหล่งใดก็ได้ให้เป็นรูปกลาง
 *
 * การระบุเป้าหมายของสองแหล่งใช้คนละหลักฐานโดยเจตนา: ฝั่งอีเมลใช้ provider domain
 * ที่ลงทะเบียนไว้ ส่วนฝั่งภายในใช้ตัวตนของการรันเอง (work order / resource /
 * source_location) — การบังคับให้เหตุภายในต้องมี provider domain คือสาเหตุที่
 * ท่อนี้เคยรับมันไม่ได้ตั้งแต่แรก
 */
export function normalizeIncidentSource(source: IncidentSource): NormalizedIncident {
  if (source.source_kind === "EXTERNAL_PROVIDER_EMAIL") {
    const report = source.report;
    const alert = report.assessment.alert;
    return {
      source_kind: "EXTERNAL_PROVIDER_EMAIL",
      service_id: report.service,
      provider: alert.provider,
      incident_label: alert.alert_type,
      current_real_state: report.current_real_state,
      recommended_next_software_action: report.recommended_next_software_action,
      affected_resource: report.affected_resource,
      decision_required: report.decision_required,
      is_financial: FINANCIAL_ALERT_TYPES.has(alert.alert_type) || report.decision_required === "OWNER",
      unresolved: report.assessment.incident_state === "UNRESOLVED_ALERT",
      unresolved_reason: `UNRESOLVED_ALERT from ${alert.sender}: ${report.assessment.target.reason}`,
      execution_identity: null,
    };
  }

  const f = source.failure;
  // เป้าหมายของเหตุภายในระบุได้เมื่อรู้ว่ามันเกิดกับทรัพยากรหรือซอร์สตัวใด
  // capability_id นับเป็นตัวตนด้วย: ทะเบียนผูกมันกลับไปหาทรัพยากรและซอร์สได้
  // (ดู ./internal-target-resolution.ts ขั้นที่ 2) การไม่นับมันทำให้เหตุที่ระบุได้จริง
  // ถูกตีว่า "ระบุไม่ได้" แล้วไปจบที่ UNKNOWN_SERVICE_OR_PROVIDER โดยไม่จำเป็น
  const identified = f.resource_id !== null || f.source_location !== null || f.capability_id !== null;
  return {
    source_kind: "INTERNAL_EXECUTION_FAILURE",
    service_id: f.source_location ?? f.resource_id ?? f.work_order_id,
    provider: NOT_APPLICABLE,
    incident_label: f.failure_type,
    current_real_state: `${f.failure_type} ที่ขั้น ${f.failure_stage}`
      + (f.exit_code !== null ? ` (exit ${String(f.exit_code)})` : "")
      + (f.last_progress_at !== null ? ` — ความคืบหน้าล่าสุด ${f.last_progress_at}` : " — ไม่เคยมีความคืบหน้า"),
    recommended_next_software_action: f.capability_id !== null
      ? `ตรวจและซ่อมความสามารถ ${f.capability_id} ที่ ${f.source_location ?? UNKNOWN}`
      : `ตรวจสาเหตุที่ ${f.failure_stage} ของ ${f.work_order_id}`,
    affected_resource: f.resource_id ?? UNKNOWN,
    // เหตุภายในไม่เคยเป็นเรื่องเงิน จึงไม่ต้องให้เจ้าของตัดสินด้วยเหตุผลนั้น
    decision_required: "NONE",
    is_financial: false,
    unresolved: !identified,
    unresolved_reason: identified
      ? ""
      : `เหตุภายในที่ ${f.work_order_id} ระบุเป้าหมายไม่ได้ — ไม่มีทั้ง capability_id, resource_id และ source_location`,
    execution_identity: f,
  };
}

/** ผู้เรียกเดิมส่ง OwnerIncidentReport มาตรง ๆ ได้เหมือนเดิม — ห่อให้อัตโนมัติ */
export function asIncidentSource(input: OwnerIncidentReport | IncidentSource): IncidentSource {
  return "source_kind" in input ? input : { source_kind: "EXTERNAL_PROVIDER_EMAIL", report: input };
}
