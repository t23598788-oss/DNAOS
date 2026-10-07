/**
 * หน้าที่: รับความผิดพลาดที่ระบบสังเกตเห็น แล้วทำให้มันเป็นงานที่ตามรอยได้
 * บนหน้าจอเดียวกับคำสั่งของ Owner
 *
 * ── ใช้ระบบตัวตนเดิมทั้งหมด ──
 * `claimSourceEvent` (กันซ้ำข้ามโปรเซสด้วย O_CREAT|O_EXCL) ของ
 * write-failure-bridge · `submitTask` ของ agent-gateway (ตัวสร้าง task ตัวจริง
 * ตัวเดียว) · `recordCommandLineage` ของ owner-command ที่เพิ่งปิดช่องว่าง
 * task->work ไป ไม่มีระบบคำสั่ง ระบบงาน หรือสโตร์ใหม่เกิดขึ้นในไฟล์นี้
 *
 * ── ตัวตนของความผิดพลาดมาจากเนื้อหา ไม่ใช่จากเวลา ──
 * `evt-<digest>` คำนวณจากชนิด + ข้อความดิบ + หลักฐาน โดยตัดเวลาทิ้ง ความล้มเหลว
 * เดิมที่ยังไม่เปลี่ยนจึงได้ id เดิมทุกครั้ง และถูกกันซ้ำโดยไม่ต้องพึ่ง "รอบก่อน
 * เคยเห็นแล้วหรือยัง" — นี่คือสิ่งที่กันไม่ให้เกิดวงวนสร้างงานซ่อมไม่รู้จบ
 *
 * ── งานเดิมไม่เคยถูกเขียนทับ ──
 * ความล้มเหลวของงาน A สร้างงาน B ที่ชี้กลับไปหา A ด้วย `parent_work_id`
 * A ยังคงเป็น A พร้อมประวัติเดิมทั้งหมด
 *
 * ── การมีสิทธิ์ถูกส่ง ≠ ถูกส่งแล้ว ──
 * ไฟล์นี้ตัดสินว่าความผิดพลาดนี้ให้ AI ซ่อมเองได้ไหม และประกอบพัสดุงานที่มี
 * ความผิดพลาดจริงอยู่ข้างใน แต่ `dispatched` เป็น true ก็ต่อเมื่อมีการส่งจริง
 * เท่านั้น สองอย่างนี้ห้ามรวมกัน
 *
 * Input: `SystemErrorObservation`
 * Output: `admitSystemError`, `buildAiWorkPackage`, `decideAutoDispatch`
 * Dependency ที่อนุญาต: ../write-failure-bridge/contract.ts,
 * ../agent-gateway/contract.ts, ../owner-command/contract.ts, node:crypto
 * สิ่งที่ห้ามแตะ: ห้ามให้ชนิดใน OWNER_ATTENTION_REQUIRED ถูกส่งอัตโนมัติ
 * ห้ามเขียนทับงานแม่ และห้ามให้ AI เติมค่าหลักฐานที่ไม่ได้วัด
 */

import { createHash, randomUUID } from "node:crypto";
import { claimSourceEvent, bindCorrectiveTask, findClaim, CLAIM_PURPOSE_CORRECTIVE_WORK } from "../write-failure-bridge/contract";
import { submitTask, saveEvidence, loadEvidenceForTask } from "../agent-gateway/contract";
import { recordCommandLineage } from "../owner-command/contract";
import {
  AUTO_DISPATCH_ELIGIBLE, OWNER_ATTENTION_REQUIRED, MAX_REPAIR_DEPTH,
} from "./types";
import type {
  AdmitOutcome, AutoDispatchDecision, DevelopmentAuthorityMode,
  OwnerConsoleItem, SystemErrorObservation,
} from "./types";

const SOURCE_EVENT_TYPE = "SYSTEM_ERROR";
const HOLDER_ID = "control/owner-error-lane";
/** คีย์ของใบคอนโซลเต็มใบในสโตร์หลักฐานเดิม */
export const CONSOLE_ITEM_TASK_ID = "dna-os/owner-console-items";

/** อ่านใบเต็มที่รับเข้ามาแล้ว — ผู้เตรียมการซ่อมใช้ตัวนี้ ไม่ใช่ฟีดหน้าจอ */
export function loadAdmittedConsoleItems(): readonly OwnerConsoleItem[] {
  const latest = new Map<string, OwnerConsoleItem>();
  for (const e of loadEvidenceForTask(CONSOLE_ITEM_TASK_ID)) {
    if (e.source !== HOLDER_ID) continue;
    const it = e.payload as OwnerConsoleItem;
    if (it?.command_id) latest.set(it.command_id, it);
  }
  return [...latest.values()];
}

/** JSON ที่คีย์เรียงทุกระดับ — ลำดับคีย์ต้องไม่เปลี่ยนตัวตนของความผิดพลาด */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

/**
 * ตัวตนของความล้มเหลวหนึ่งครั้ง — ตัด `observed_at` ออกโดยตั้งใจ
 *
 * ความล้มเหลวเดิมที่ถูกสังเกตซ้ำในรอบถัดไปคือความล้มเหลวเดิม ไม่ใช่ของใหม่
 * ถ้ารวมเวลาเข้าไป ทุกรอบการตรวจจะสร้างงานซ่อมใหม่หนึ่งงาน
 */
export function errorEventIdOf(observation: SystemErrorObservation): string {
  const digest = createHash("sha256").update(canonical({
    error_kind: observation.error_kind,
    raw_error_text: observation.raw_error_text,
    evidence: observation.evidence,
    parent_work_id: observation.parent_work_id ?? null,
  })).digest("hex");
  return `evt-${digest.slice(0, 32)}`;
}

/**
 * ตัดสินว่าความผิดพลาดนี้ให้ AI ซ่อมเองได้ไหม
 *
 * ลำดับการตรวจสำคัญ: ชนิดที่ต้องให้ Owner ตัดสินถูกปฏิเสธ **ก่อน** ที่จะถามว่า
 * อยู่ในโหมด bootstrap ไหม — โหมดการพัฒนาไม่ใช่เหตุผลที่จะซ่อม credential
 * หรือการลบ production ให้เอง
 */
export function decideAutoDispatch(
  observation: SystemErrorObservation,
  mode: DevelopmentAuthorityMode,
  armed: boolean,
): AutoDispatchDecision {
  if (OWNER_ATTENTION_REQUIRED.includes(observation.error_kind)) {
    return { code: "OWNER_ATTENTION_REQUIRED", dispatched: false, worker_kind: null,
      detail: `${observation.error_kind} ต้องให้ Owner ตัดสิน — ไม่ซ่อมอัตโนมัติไม่ว่าโหมดใด` };
  }
  if (!AUTO_DISPATCH_ELIGIBLE.includes(observation.error_kind)) {
    return { code: "OWNER_ATTENTION_REQUIRED", dispatched: false, worker_kind: null,
      detail: `${observation.error_kind} ไม่อยู่ในชุดที่ประกาศว่าให้ซ่อมอัตโนมัติได้` };
  }
  if ((observation.repair_depth ?? 0) >= MAX_REPAIR_DEPTH) {
    return { code: "REPAIR_DEPTH_EXCEEDED", dispatched: false, worker_kind: null,
      detail: `โซ่การซ่อมลึก ${observation.repair_depth} ถึงขอบเขต ${MAX_REPAIR_DEPTH} แล้ว` };
  }
  if (mode !== "BOOTSTRAP_OWNER_BUILD") {
    return { code: "NOT_BOOTSTRAP_MODE", dispatched: false, worker_kind: null,
      detail: `DEVELOPMENT_AUTHORITY_MODE=${mode} — การซ่อมอัตโนมัติเปิดเฉพาะ BOOTSTRAP_OWNER_BUILD` };
  }
  if (!armed) {
    return { code: "DISPATCH_DISARMED", dispatched: false, worker_kind: null,
      detail: "มีสิทธิ์ถูกส่ง แต่การส่งจริงยังไม่ถูกติดอาวุธในสไลซ์นี้ — พัสดุงานถูกประกอบและเก็บไว้แล้ว" };
  }
  return { code: "ELIGIBLE", dispatched: false, worker_kind: null, detail: "รอผู้เลือก worker ของ control/scheduler" };
}

export interface AiWorkPackageV1 {
  readonly corrective_work_id: string;
  readonly parent_work_id: string | null;
  readonly parent_command_id: string | null;
  readonly parent_task_id: string | null;
  readonly source_event_id: string;
  readonly error_kind: string;
  readonly raw_error: string;
  readonly evidence: SystemErrorObservation["evidence"];
  readonly repository_id: string | null;
  readonly workspace_id: string | null;
  readonly development_authority_mode: DevelopmentAuthorityMode;
  readonly verification_requirement: string;
  readonly repair_depth: number;
}

/**
 * พัสดุงานที่ส่งให้ worker — ความผิดพลาดจริง ไม่ใช่คำถามกว้าง ๆ
 *
 * ไม่มีประโยคแบบ "ช่วยตรวจระบบให้หน่อย" อยู่ในนี้ worker เริ่มจากความล้มเหลว
 * ที่สังเกตได้จริงพร้อม stdout/stderr/exit code ที่มีอยู่
 */
export function buildAiWorkPackage(
  observation: SystemErrorObservation, correctiveWorkId: string, sourceEventId: string,
  mode: DevelopmentAuthorityMode,
): AiWorkPackageV1 {
  return {
    corrective_work_id: correctiveWorkId,
    parent_work_id: observation.parent_work_id ?? null,
    parent_command_id: observation.parent_command_id ?? null,
    parent_task_id: observation.parent_task_id ?? null,
    source_event_id: sourceEventId,
    error_kind: observation.error_kind,
    raw_error: observation.raw_error_text,
    evidence: observation.evidence,
    repository_id: observation.evidence.repository_id ?? null,
    workspace_id: observation.evidence.workspace_id ?? null,
    development_authority_mode: mode,
    verification_requirement: "การซ่อมต้องพิสูจน์ด้วยการรันซ้ำของสิ่งที่ล้ม ไม่ใช่คำประกาศว่าแก้แล้ว",
    repair_depth: observation.repair_depth ?? 0,
  };
}

export interface AdmitOptions {
  readonly mode?: DevelopmentAuthorityMode;
  /** การส่งจริงถูกติดอาวุธหรือยัง — แยกจากการมีสิทธิ์เสมอ */
  readonly dispatchArmed?: boolean;
}

/**
 * รับความผิดพลาดหนึ่งครั้งเข้าสู่คอนโซลของ Owner
 *
 * ลำดับ: ตัวตนจากเนื้อหา -> อ้างสิทธิ์กันซ้ำ -> command -> task -> work ->
 * บันทึกสายเลือด -> ตัดสินการส่ง ไม่มีขั้นใดถูกข้ามเมื่อผลลัพธ์เป็น BLOCKED
 */
export async function admitSystemError(
  observation: SystemErrorObservation, options: AdmitOptions = {},
): Promise<AdmitOutcome> {
  const mode = options.mode ?? "BOOTSTRAP_OWNER_BUILD";
  const armed = options.dispatchArmed ?? false;

  if ((observation.repair_depth ?? 0) > MAX_REPAIR_DEPTH) {
    return { status: "REFUSED", reason_code: "REPAIR_DEPTH_EXCEEDED",
      detail: `repair_depth=${observation.repair_depth} เกินขอบเขต ${MAX_REPAIR_DEPTH}` };
  }

  const eventId = observation.source_event_id ?? errorEventIdOf(observation);

  // กันซ้ำข้ามโปรเซสด้วยกลไกเดิมที่พิสูจน์แล้ว — ความล้มเหลวเดิมอ้างสิทธิ์ได้ครั้งเดียว
  const claim = claimSourceEvent({
    source_event_type: SOURCE_EVENT_TYPE, source_event_id: eventId,
    purpose: CLAIM_PURPOSE_CORRECTIVE_WORK, holder_id: HOLDER_ID,
  });
  if (claim.status !== "CLAIMED") {
    const existing = findClaim(SOURCE_EVENT_TYPE, eventId, CLAIM_PURPOSE_CORRECTIVE_WORK);
    return existing !== null
      ? { status: "DUPLICATE_SUPPRESSED", existing_event_id: eventId,
          detail: `ความล้มเหลวเดิมนี้ถูกรับไว้แล้ว (${existing.state}) — ไม่สร้างงานซ่อมซ้ำ` }
      : { status: "REFUSED", reason_code: "CLAIM_CONFLICT", detail: `อ้างสิทธิ์ไม่สำเร็จ: ${claim.status}` };
  }

  const commandId = `cmd_${randomUUID()}`;
  const workId = `work-${randomUUID()}`;
  const rawCommandText = `${observation.error_kind}: ${observation.raw_error_text}`;

  recordCommandLineage({
    command_id: commandId, work_id: workId, task_id: null, stage: "command_received",
    detail: `control/owner-error-lane origin=SYSTEM_ERROR_COMMAND event=${eventId} parent_work=${observation.parent_work_id ?? "none"}`,
  });

  // ตัวสร้าง task ตัวจริงตัวเดียวของระบบ — ไม่มี adapter เพราะไฟล์นี้ไม่ส่งงานเอง
  const task = await submitTask(
    rawCommandText,
    { user_id: HOLDER_ID, workspace_id: observation.evidence.workspace_id ?? "unresolved", conversation_id: commandId, parent_task_id: observation.parent_task_id ?? null },
    HOLDER_ID, [], undefined,
    { source_event_type: SOURCE_EVENT_TYPE, source_event_id: eventId } as never,
  );

  bindCorrectiveTask(claim.claim, task.task_id);
  recordCommandLineage({
    command_id: commandId, work_id: workId, task_id: task.task_id, stage: "blocked",
    detail: `error_kind=${observation.error_kind} status=${task.status}`,
  });

  const decision = decideAutoDispatch(observation, mode, armed);
  const item: OwnerConsoleItem = {
    origin_kind: "SYSTEM_ERROR_COMMAND", owner_visible: true, origin_event_id: eventId,
    command_id: commandId, task_id: task.task_id, work_id: workId,
    parent_work_id: observation.parent_work_id ?? null,
    error_kind: observation.error_kind, raw_command_text: rawCommandText,
    status: task.status, current_action: decision.detail,
    evidence: observation.evidence, auto_dispatch: decision,
    recorded_at: observation.observed_at,
  };

  // ── เก็บใบเต็มไว้ในสโตร์หลักฐานเดิม (ไม่ใช่สโตร์ใหม่) ──
  // ฟีดคอนโซลเก็บเฉพาะสิ่งที่หน้าจอต้องแสดง (stage/detail) ซึ่งไม่มีข้อความ
  // ผิดพลาดดิบและไม่มี evidence — ผู้เตรียมการซ่อมที่อ่านจากฟีดจึงได้ข้อมูลที่
  // ด้อยลงจนวิเคราะห์สาเหตุไม่ได้ (พบจริงตอน M3 รับ backlog: 25 รายการถูกข้าม
  // เพราะไม่มีสัญญาณให้วิเคราะห์) ใบเต็มจึงถูกเก็บแยกไว้ให้ผู้เตรียมอ่าน
  saveEvidence({
    evidence_id: `console-item-${eventId}`,
    task_id: CONSOLE_ITEM_TASK_ID, kind: "recovery", source: HOLDER_ID,
    recorded_at: item.recorded_at, payload: item,
  });

  return { status: "ADMITTED", item };
}
