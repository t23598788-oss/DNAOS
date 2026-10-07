/**
 * หน้าที่: ส่ง `ObservationRecord` ที่เพิ่งผลิต เข้าทางเข้า event เดียวของระบบ
 * (`control/owner-backbone/contract.ts#intakeEvent`) — แปลงฟิลด์ตรง ๆ เท่านั้น
 *
 * ไม่มีการตัดสินใจในไฟล์นี้ ไม่มีการจำแนก ไม่มีตาราง route และไม่มีการเรียก
 * executor ใด ๆ — หน้าที่เดียวคือ "แปลงชื่อฟิลด์แล้วส่งต่อ" การจำแนกและการ
 * เลือกเส้นทางเป็นของ `event-intake.ts#classifyEvent/decideAction` ตามเดิม
 *
 * ผูกที่จุดผลิต ไม่ใช่การอ่านไฟล์: ใช้ `./observation-store.ts#onObservation`
 * ซึ่งยิงเฉพาะแถวที่โปรเซสนี้เพิ่งเขียน — ไม่มี poll ไม่มี replay ไม่แตะ UI
 *
 * ตัวตนที่ไม่มีจะเป็น `null` — ไม่มีการเติม "UNTRACKED" และไม่มีการสร้าง id ขึ้นเอง
 *
 * `work_id` ไม่ถูกแมปเป็น `work_order_id`: สองค่านี้อยู่คนละ namespace และไม่มี
 * สัญญาใดในระบบพิสูจน์ว่าเท่ากัน — `work_id` จึงเดินทางไปในฐานะหลักฐาน
 * (`evidence_refs`) แทนที่จะถูกอ้างว่าเป็นตัวตนของ work order
 *
 * Input: `ObservationRecord`
 * Output: `observationToEvent`, `startObservationEventBridge`
 * Dependency ที่อนุญาต: ./observation-store.ts (onObservation, type),
 * ../owner-backbone/contract.ts (intakeEvent + type)
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่มกฎการจำแนกที่นี่ ห้ามเรียก executor และห้ามอ่าน
 * observations.jsonl ย้อนหลัง
 */

import { onObservation } from "./observation-store";
import type { ObservationRecord } from "./observation-store";
import type { IntakeRecord, RawOperationalEvent } from "../owner-backbone/contract";

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

export const OBSERVATION_EVENT_SOURCE = "control/machine-observation/observation-store.ts#appendObservation";

/** แปลงตรง ๆ ฟิลด์ต่อฟิลด์ — ไม่มีการอนุมานค่าใดจากค่าอื่น */
export function observationToEvent(record: ObservationRecord): RawOperationalEvent {
  return {
    event_class: "MACHINE",
    source: OBSERVATION_EVENT_SOURCE,
    provider: "dna-os",
    // subject/body เป็นข้อความสำหรับคน — การจำแนกใช้ facts และฟิลด์ที่มีชนิด
    subject: `machine observation: ${record.path}`,
    body: `derived_by=${record.derived_by} process_evidence=${record.process_evidence.length} relationship_evidence=${record.relationship_evidence.length}`,
    occurred_at: record.observed_at,
    source_ref: record.event_id,

    event_id: record.event_id,
    resource_id: record.resource_id ?? null,
    capability_id: record.capability_id ?? null,
    task_id: record.task_id ?? null,
    workspace_id: record.workspace_id ?? null,
    agent_run_id: record.agent_run_id ?? null,
    // work_order_id ถูกเว้นไว้โดยเจตนา — ดู header
    work_order_id: null,
    evidence_refs: [
      `control/machine-observation/data/observations.jsonl#${record.event_id}`,
      ...(record.work_id ? [`work_id=${record.work_id}`] : []),
      ...(record.execution_id ? [`execution_id=${record.execution_id}`] : []),
    ],
    facts: {
      observed_path: record.path,
      derived_by: record.derived_by,
      ...(record.work_id ? { work_id: record.work_id } : {}),
      ...(record.execution_id ? { execution_id: record.execution_id } : {}),
    },
  };
}

export interface ObservationBridgeHandle {
  stop(): void;
  /** เหตุที่ส่งต่อไม่สำเร็จ — ไม่ปล่อยให้หายเงียบ */
  failures(): readonly string[];
  forwarded(): readonly IntakeRecord[];
  settled(): Promise<readonly IntakeRecord[]>;
}

/** เปิดสายจากผู้ผลิตเข้าทางเข้าเดียว — อายุเท่าโปรเซส */
export function startObservationEventBridge(ingest: IngestFn): ObservationBridgeHandle {
  const forwarded: IntakeRecord[] = [];
  const pending: Promise<void>[] = [];
  const failures: string[] = [];
  const unsubscribe = onObservation((record) => {
    pending.push(
      ingest(observationToEvent(record))
        .then((r) => { forwarded.push(r); })
        .catch((e) => { failures.push(e instanceof Error ? e.message : String(e)); }),
    );
  });
  return {
    stop: unsubscribe,
    forwarded: () => forwarded,
    failures: () => failures,
    settled: async () => { await Promise.all(pending); return forwarded; },
  };
}
