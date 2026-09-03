/**
 * หน้าที่: ส่ง `JointEvent`/`ViolationEvent` ที่เพิ่งผลิต เข้าทางเข้า event เดียว
 * ของระบบ (`control/owner-backbone/contract.ts#intakeEvent`) — แปลงฟิลด์เท่านั้น
 *
 * SSE ของ joint-monitor ยังเป็นทางออกเชิงสังเกตเหมือนเดิมและไม่ถูกใช้เป็นทาง
 * ควบคุม สายนี้เป็นคนละทาง ผูกที่จุดผลิตก่อนออกเน็ตเวิร์ก (`./client.ts#onJoint`
 * / `#onViolation`) จึงไม่ขึ้นกับ collector และไม่ใช่การอ่าน store กลับ
 *
 * ── LOOP GUARD (จำเป็น ไม่ใช่การกรองเชิงนโยบาย) ──
 * `control/owner-backbone/events.ts#emitSystemEvent` เรียก `reportJoint` เอง
 * ถ้าส่งทุก joint เข้า `intakeEvent` โดยไม่กัน จะได้วง:
 *   joint -> intakeEvent -> emitSystemEvent -> reportJoint -> joint -> ...
 * จึงข้าม joint ที่ผลิตโดย owner-backbone เอง นี่คือการกันวนกลับ ไม่ใช่การ
 * ตัดสินว่าเหตุการณ์ไหนสำคัญ — การตัดสินยังเป็นของ decideAction
 *
 * ── ส่งเฉพาะสถานะที่เป็นความล้มเหลว ──
 * `JointEvent.status` เป็นฟิลด์ที่มีอยู่แล้ว การส่งทุก transition (RECEIVED,
 * ROUTING, EXECUTING, ...) เข้าทางเข้าจะทำให้ทางเข้ารับภาระเท่ากับทุกการ
 * เปลี่ยนสถานะของทุกงานในระบบ โดยที่ decideAction ตอบ UNKNOWN ทั้งหมด
 * เกณฑ์ที่ใช้จึงเป็นค่าของฟิลด์เดิมตรง ๆ ไม่ใช่กฎใหม่ที่ตีความข้อความ
 *
 * `launch_id` ไม่ถูกแมปเป็น `task_id` — คนละ namespace และไม่มีสัญญาใดพิสูจน์
 * ว่าเท่ากัน มันเดินทางไปในฐานะหลักฐานแทน
 *
 * Input: `JointReport` / `ViolationReport`
 * Output: `jointToEvent`, `violationToEvent`, `startJointEventBridge`
 * Dependency ที่อนุญาต: ./client.ts (onJoint/onViolation), ./types.ts,
 * ../../control/owner-backbone/contract.ts (intakeEvent + type)
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่มกฎการจำแนกที่นี่ ห้ามเรียก executor ห้ามอ่าน
 * joints.jsonl/violations.jsonl ย้อนหลัง และห้ามใช้ SSE เป็นทางควบคุม
 */

import { onJoint, onViolation } from "./client";
import type { JointReport, ViolationReport } from "./types";
import type { IntakeRecord, RawOperationalEvent } from "../../control/owner-backbone/contract";

/**
 * นำเข้าแบบ lazy โดยเจตนา: `owner-backbone/contract.ts` ดึงกราฟ routing/output
 * ทั้งชุดมาด้วย การนำเข้าตอนโหลดโมดูลทำให้เกิดวงอ้างอิงย้อนกลับมาที่
 * `agent-gateway/contract.ts` ระหว่างที่มันยัง initialize ไม่เสร็จ
 * การเรียกตอนส่งจริงจึงเป็นทั้งการแก้วงและการทำให้ผู้ที่แค่ import สัญญานี้
 * ไม่ต้องแบกกราฟทั้งก้อน
 */
export type IngestFn = (event: RawOperationalEvent) => Promise<IntakeRecord>;

/**
 * ผู้เรียกทางเข้าถูกฉีดเข้ามา ไม่ได้ import เองที่นี่ (Owner, CONNECTION 2)
 *
 * เหตุผลที่ต้องเป็นแบบนี้: `owner-backbone/contract.ts` ดึงกราฟ routing/output
 * ทั้งชุด ซึ่งวนกลับมาที่ `agent-gateway/contract.ts` การ import ที่โมดูลนี้
 * — ทั้งแบบ static และแบบ dynamic — ทำให้โหลดไม่สำเร็จในโปรเซสจริง
 * (พิสูจน์แล้ว: MODULE_NOT_FOUND ตอนรันใน entrypoint) โปรเซสผู้ผลิตซึ่ง import
 * สัญญาของ owner-backbone อยู่แล้วเป็นผู้ส่ง `intakeEvent` เข้ามาแทน
 *
 * ขอบเขตยังคงเดิม: ผู้เรียกที่ถูกส่งเข้ามาต้องเป็น `intakeEvent` จากสัญญา
 * สาธารณะเท่านั้น โมดูลนี้ไม่รู้จักและไม่เรียกอะไรอย่างอื่น
 */

export const JOINT_EVENT_SOURCE = "observability/joint-monitor/client.ts#reportJoint";
export const VIOLATION_EVENT_SOURCE = "observability/joint-monitor/client.ts#reportViolation";

/** สถานะของ joint ที่แปลว่าล้มเหลว — ค่าจากฟิลด์ `status` เดิมตรง ๆ */
export const FAILURE_JOINT_STATUSES: readonly string[] = ["FAILED", "BLOCKED"];

/** ผู้ผลิตที่เป็นปลายทางของ intakeEvent เอง — ส่งกลับเข้าไปจะเป็นวง */
const SELF_EMITTING_SOURCES = ["control/owner-backbone/"];

export function isLoopingJoint(report: JointReport): boolean {
  return SELF_EMITTING_SOURCES.some((prefix) => report.source.startsWith(prefix));
}

export function jointToEvent(report: JointReport): RawOperationalEvent {
  return {
    event_class: "RUNTIME",
    source: JOINT_EVENT_SOURCE,
    provider: "dna-os",
    subject: `runtime joint ${report.status}: ${report.from_capability} -> ${report.to_capability}`,
    body: report.summary,
    occurred_at: report.occurred_at,
    source_ref: `${report.from_capability}->${report.to_capability}@${report.occurred_at}`,

    // ผู้ผลิตไม่ได้ออก event_id — collector เป็นผู้ออกและปลอมไม่ได้ ที่นี่จึงเว้นไว้
    // ให้ ingress ออกให้ แทนที่จะสร้าง id ปลอมขึ้นมาเอง
    task_id: report.task_id ?? null,
    capability_id: null,
    resource_id: null,
    evidence_refs: [
      `observability/joint-monitor/data/joints.jsonl#${report.occurred_at}`,
      `from_capability=${report.from_capability}`,
      `to_capability=${report.to_capability}`,
      ...(report.parent_event_id ? [`parent_event_id=${report.parent_event_id}`] : []),
    ],
    facts: {
      joint_status: report.status,
      from_capability: report.from_capability,
      to_capability: report.to_capability,
      reporter_source: report.source,
    },
  };
}

export function violationToEvent(report: ViolationReport): RawOperationalEvent {
  return {
    event_class: "SECURITY",
    source: VIOLATION_EVENT_SOURCE,
    provider: "dna-os",
    subject: `policy violation: ${report.reason}`,
    body: report.detail,
    occurred_at: report.occurred_at,
    source_ref: `${report.launch_id}@${report.occurred_at}`,

    // ViolationEvent ไม่มี task_id ในสัญญา — จึงคง null ไม่อนุมานจาก launch_id
    task_id: null,
    evidence_refs: [
      `observability/joint-monitor/data/violations.jsonl#${report.occurred_at}`,
      `launch_id=${report.launch_id}`,
    ],
    facts: {
      violation_reason: report.reason,
      enforced: String(report.enforced),
      launch_id: report.launch_id,
      reporter_source: report.source,
    },
  };
}

export interface JointBridgeHandle {
  stop(): void;
  /** เหตุที่ส่งต่อไม่สำเร็จ — ไม่ปล่อยให้หายเงียบ */
  failures(): readonly string[];
  forwarded(): readonly IntakeRecord[];
  skipped(): number;
  settled(): Promise<readonly IntakeRecord[]>;
}

export function startJointEventBridge(ingest: IngestFn): JointBridgeHandle {
  const forwarded: IntakeRecord[] = [];
  const pending: Promise<void>[] = [];
  const failures: string[] = [];
  let skipped = 0;
  const push = (event: RawOperationalEvent): void => {
    pending.push(
      ingest(event).then((r) => { forwarded.push(r); }).catch((e) => { failures.push(e instanceof Error ? e.message : String(e)); }),
    );
  };

  const offJoint = onJoint((report) => {
    if (isLoopingJoint(report) || !FAILURE_JOINT_STATUSES.includes(report.status)) { skipped += 1; return; }
    push(jointToEvent(report));
  });
  // ViolationEvent ทุกใบเดินทางต่อ — การละเมิดนโยบายไม่มีสถานะ "ปกติ" ให้กรอง
  const offViolation = onViolation((report) => { push(violationToEvent(report)); });

  return {
    stop: () => { offJoint(); offViolation(); },
    forwarded: () => forwarded,
    failures: () => failures,
    skipped: () => skipped,
    settled: async () => { await Promise.all(pending); return forwarded; },
  };
}
