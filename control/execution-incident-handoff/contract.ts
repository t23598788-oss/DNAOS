/**
 * หน้าที่: จุดส่งมอบจุดเดียวจาก "ขั้นตอนการทำงานที่ล้มหรือค้าง" เข้าสู่ท่อ
 * incident/remediation เดิม (Owner, CONNECT_EXECUTION_FAILURE_TO_EXISTING_REMEDIATION).
 *
 * ทำไมต้องมีจุดเดียว: ถ้ากระจาย `openRemediation` ไปตามโมดูลที่รันงาน ทุกโมดูลจะ
 * กลายเป็นเจ้าของนิยาม incident คนละแบบ และวันหนึ่งจะไม่มีใครตอบได้ว่า "อะไรนับว่า
 * ล้ม" ไฟล์นี้จึงเป็นที่เดียวที่แปลสถานะการรันเป็นเหตุ และเป็นที่เดียวที่เรียก
 * `openRemediation` จากฝั่ง execution
 *
 * ไฟล์นี้ไม่ตัดสินว่าอะไรค้าง — มันรับ "ข้อเท็จจริงที่ผู้สังเกตวัดได้แล้ว" เท่านั้น
 * การตัดสินว่าค้างต้องมาจากผู้สังเกตที่อยู่นอกโปรเซสที่ถูกเฝ้า เพราะโปรเซสที่ค้าง
 * ตัดสินเรื่องตัวเองไม่ได้ — `observed_by` จึงเป็นฟิลด์บังคับ และต้องไม่ใช่ตัวมันเอง
 *
 * ไม่มีการสร้าง incident store, remediation engine, watchdog หรือ repair loop ใหม่
 * ทั้งหมดใช้ของเดิมหลังจากจุดนี้
 *
 * Input: `ExecutionFailureFacts` ที่ผู้สังเกตวัดได้จริง.
 * Output: `reportExecutionFailure` -> `RemediationRecord` ของท่อเดิม.
 * Dependency ที่อนุญาต: ../incident-remediation/contract.ts,
 * ../../software/registry-database/adapters/persistent-file-store.
 * สิ่งที่ห้ามแตะ: ห้ามให้โมดูลอื่นเรียก openRemediation จากฝั่ง execution โดยตรง,
 * ห้ามเดาค่าที่ผู้สังเกตไม่ได้วัด, ห้ามให้ตัวที่ถูกเฝ้าเป็นผู้รายงานตัวเอง.
 */

import { escalateToOwner, openRemediation, type ExecutionFailureReport, type ExecutionFailureType } from "../incident-remediation/contract";
import { recordStageLink } from "../operational-lifecycle/contract";
import { createPersistentFileStore } from "../../software/registry-database/adapters/persistent-file-store";
import type { DeliveryRecord, RemediationRecord } from "../incident-remediation/contract";

/** ผลของการส่งมอบหนึ่งครั้ง — เหตุที่บันทึกแล้ว และผลการรายงานเจ้าของถ้าถูกเรียก */
export interface HandoffOutcome {
  record: RemediationRecord;
  /** null เมื่อสถานะนี้ไม่ต้องรายงานเจ้าของ หรือเมื่อสายรายงานล้ม (เหตุยังอยู่ครบ) */
  owner_delivery: DeliveryRecord | null;
  escalation_error: string | null;
}

export interface ExecutionFailureFacts {
  work_order_id: string;
  task_id?: string | null;
  plan_id?: string | null;
  step_id?: string | null;
  /** ขั้นของวงจรปฏิบัติการที่ล้ม — ผู้สังเกตต้องบันทึก ดู `MissingStageIdentityError` */
  lifecycle_stage_id?: string | null;
  failure_type: ExecutionFailureType;
  failure_stage: string;
  capability_id?: string | null;
  resource_id?: string | null;
  operation?: string | null;
  started_at: string;
  last_progress_at?: string | null;
  error?: string | null;
  exit_code?: number | null;
  timeout_ms?: number | null;
  source_location?: string | null;
  last_successful_evidence_id?: string | null;
  /** โมดูล/โปรเซสที่สังเกตเห็น — ต้องไม่ใช่ตัวที่กำลังค้าง */
  observed_by: string;
}

export class SelfReportedStallError extends Error {}

/**
 * ผู้สังเกตบันทึกขั้นไม่ครบ
 *
 * ข้อกำหนดของเจ้าของ: เมื่อพบว่าค้างหรือล้ม ผู้สังเกตต้องบันทึก `lifecycle_stage_id`
 * พร้อมกับอย่างน้อยหนึ่งใน capability_id / resource_id — เพราะการให้ตัวหาเป้าหมาย
 * มาเดาขั้นย้อนหลังจากข้อความอิสระคือการเอา AI กลับเข้าไปในสายการตัดสิน
 */
export class MissingStageIdentityError extends Error {}

/**
 * แปลข้อเท็จจริงของการรันเป็นเหตุ แล้วส่งเข้าท่อเดิม
 *
 * `detected_at` ถูกประทับที่นี่เพราะเป็นเวลาที่ระบบ "รู้" ไม่ใช่เวลาที่มัน "เกิด" —
 * สองอย่างนี้ต่างกันเสมอสำหรับงานที่ค้าง และการยุบเข้าด้วยกันจะทำให้วัดไม่ได้ว่า
 * ผู้สังเกตช้าไปแค่ไหน
 */
export async function reportExecutionFailure(facts: ExecutionFailureFacts): Promise<HandoffOutcome> {
  if (facts.observed_by.trim() === "") {
    throw new SelfReportedStallError("observed_by is required — a hung worker may not be the one that declares itself hung");
  }
  const failure: ExecutionFailureReport = {
    work_order_id: facts.work_order_id,
    task_id: facts.task_id ?? null,
    plan_id: facts.plan_id ?? null,
    step_id: facts.step_id ?? null,
    lifecycle_stage_id: facts.lifecycle_stage_id ?? null,
    failure_type: facts.failure_type,
    failure_stage: facts.failure_stage,
    capability_id: facts.capability_id ?? null,
    resource_id: facts.resource_id ?? null,
    operation: facts.operation ?? null,
    started_at: facts.started_at,
    last_progress_at: facts.last_progress_at ?? null,
    detected_at: new Date().toISOString(),
    error: facts.error ?? null,
    exit_code: facts.exit_code ?? null,
    timeout_ms: facts.timeout_ms ?? null,
    source_location: facts.source_location ?? null,
    last_successful_evidence_id: facts.last_successful_evidence_id ?? null,
    observed_by: facts.observed_by,
  };
  if (failure.lifecycle_stage_id !== null && failure.capability_id === null && failure.resource_id === null) {
    throw new MissingStageIdentityError(
      "ผู้สังเกตบันทึก lifecycle_stage_id แล้ว แต่ไม่มีทั้ง capability_id และ resource_id — ขั้นเดียวไม่พอระบุเป้าหมายการซ่อม");
  }
  const record = openRemediation({ source_kind: "INTERNAL_EXECUTION_FAILURE", failure }, createPersistentFileStore());

  /**
   * ผูกเหตุเข้ากับขั้น เพื่อให้ "ขั้น 4 ล้ม" ตอบได้ และเพื่อให้ค่าคงที่ ORPHANED
   * เห็นว่าขั้นนี้มีทางออกอยู่ ไม่ใช่ขั้นที่ค้างโดยไม่มีใครถือ
   */
  if (failure.lifecycle_stage_id !== null) {
    recordStageLink({
      stage_id: failure.lifecycle_stage_id, kind: "INCIDENT", ref: record.incident_id,
      state: "OPEN", recorded_by: failure.observed_by,
    });
  }

  /**
   * รายงานเจ้าของทันทีเมื่อเหตุจบที่สถานะที่ต้องให้เจ้าของรู้ — ไม่รอผลการซ่อม
   * ใช้ `escalateToOwner` ของเดิมทั้งดุ้น ไม่มีตัวรายงานตัวที่สอง
   *
   * การส่งไม่สำเร็จต้องไม่ทำให้เหตุหาย: เหตุถูกบันทึกไปแล้วก่อนถึงบรรทัดนี้
   * และ escalateToOwner เองก็บันทึก PENDING_DELIVERY ไว้ก่อนพยายามส่ง
   */
  if (!(OWNER_MUST_KNOW.has(record.terminal_state) || OWNER_MUST_KNOW.has(record.block_reason))) {
    return { record, owner_delivery: null, escalation_error: null };
  }
  try {
    return { record, owner_delivery: await escalateToOwner(record), escalation_error: null };
  } catch (error) {
    // สายรายงานล้มต้องไม่ลบเหตุทิ้ง — เหตุถูกบันทึกไปก่อนบรรทัดนี้แล้ว
    return { record, owner_delivery: null, escalation_error: error instanceof Error ? error.message : String(error) };
  }
}

/** สถานะที่เจ้าของต้องรู้ทันที ไม่ว่าการซ่อมจะไปต่อได้หรือไม่ */
const OWNER_MUST_KNOW = new Set<string>([
  "OWNER_DECISION_REQUIRED", "BLOCKED",
  "UNRESOLVED_ARCHITECTURE", "NO_ELIGIBLE_RESOURCE", "UNKNOWN_SERVICE_OR_PROVIDER",
]);
