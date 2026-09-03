/**
 * หน้าที่: ส่งงานแก้ไขเข้า "ผู้ตัดสินเรื่องผู้ทำงาน" ที่มีอยู่แล้ว —
 * `control/scheduler#routeWork` — โดยสะพานนี้ **ไม่เลือก worker_kind เอง**
 *
 * ตามคำสั่งของ Owner:
 *   WORKER_SELECTION_OWNER       = control/scheduler#routeWork
 *   RESOURCE_AVAILABILITY_SOURCE = control/owner-backbone/#allResourceAvailability
 *
 * `allResourceAvailability()` ถูกใช้เป็น "หลักฐานประกอบ" ที่บันทึกไว้เท่านั้น
 * ไม่ได้ถูกใช้เลือกผู้ทำงาน — ตัวเลือกจริงมาจาก `routeWork` ซึ่งกรองด้วย
 * `ProcessingUnit.available` ของ `discoverPool` (การ resolve executable จริง
 * บนเครื่องนี้) การเอาผลของสองแหล่งมาซ้อนกันเองที่นี่จะกลายเป็นผู้ตัดสินคนที่สอง
 *
 * แยก snapshot ออกจากการตัดสินโดยเจตนา: `snapshotRouteInputs()` อ่านสถานะจริง
 * ครั้งเดียวแล้วแช่ไว้ `decideRoute()` เป็นฟังก์ชันเหนือ snapshot นั้น จึงพิสูจน์
 * ความ deterministic ได้โดยไม่ต้องหวังว่าเครื่องจะไม่เปลี่ยนระหว่างการรัน
 *
 * Input: corrective `WorkOrder` + `source_event_id`
 * Output: `snapshotRouteInputs`, `decideRoute`, `CORRECTIVE_WORK_KIND`
 * Dependency ที่อนุญาต: ../scheduler/contract.ts, ../work-graph/contract.ts,
 * ../owner-backbone/resource-availability.ts (allResourceAvailability — evidence เท่านั้น),
 * ../agent-gateway/types.ts (type)
 * สิ่งที่ห้ามแตะ: ห้ามใส่ตาราง WorkKind -> ProviderKind ที่นี่ ห้ามจัดลำดับ
 * ผู้ให้บริการเอง และห้ามให้ `allResourceAvailability()` มีผลต่อการเลือก
 */

import { discoverPool, loadMetrics, routeWork, routingInputDigest } from "../scheduler/contract";
import type { ProcessingUnit, ProviderKind, ProviderMetricRecord, RouteDecision } from "../scheduler/contract";
import { workerClassFor } from "../work-graph/contract";
import type { WorkItem } from "../work-graph/types";
// นำเข้าจากโมดูลตรง ๆ เพราะ ../owner-backbone/contract.ts ยังไม่ re-export ตัวนี้
import { allResourceAvailability } from "../owner-backbone/resource-availability";
import type { ResourceAvailability } from "../owner-backbone/resource-availability";
import type { WorkOrder } from "../agent-gateway/types";

/**
 * งานซ่อมแหล่งที่มาที่ล้มเหลวจริง = REPAIR ตามคำนิยามของ `WorkKind` เอง
 * ("the source itself needs a real fix, not a re-run") และอยู่ใน
 * `REASONING_WORK_KINDS` อยู่แล้ว ไม่ใช่ kind ที่ตั้งขึ้นใหม่
 */
export const CORRECTIVE_WORK_KIND = "REPAIR" as const;

/** ขนาด pool ต่อผู้ให้บริการ — ค่าคงที่ของสะพาน ไม่ใช่การจัดลำดับผู้ให้บริการ */
export const POOL_SIZE_PER_PROVIDER = 1;

export interface RouteInputsSnapshot {
  readonly work_item: WorkItem;
  readonly pool: readonly ProcessingUnit[];
  readonly in_flight: readonly [ProviderKind, number][];
  readonly metrics: readonly ProviderMetricRecord[];
  /** หลักฐานประกอบ ไม่ใช่ตัวเลือก */
  readonly availability_evidence: readonly { worker_kind: string; available: boolean; reason: string }[];
  readonly snapshot_at: string;
}

export function buildCorrectiveWorkItem(workOrder: WorkOrder, sourceEventId: string): WorkItem {
  return {
    work_id: `repair-${sourceEventId}`,
    kind: CORRECTIVE_WORK_KIND,
    worker_class: workerClassFor(CORRECTIVE_WORK_KIND),
    target: workOrder.target_path,
    write_scope: [workOrder.target_path],
    test_files: [],
    depends_on: [],
    state: "READY",
    blocked_by: [],
    reason: workOrder.requested_change,
    evidence_ref: null,
  };
}

/**
 * อ่านสถานะจริงครั้งเดียว
 *
 * `in_flight` ว่างเปล่าและนี่คือความจริง ไม่ใช่ค่าเริ่มต้นที่เดาไว้: สะพานยังไม่
 * ปล่อย Agent เลย (ดู AUTOMATIC_AGENT_DISPATCH_ENABLED) จึงไม่มีงานซ่อมตัวไหน
 * กำลังวิ่งอยู่ เมื่อใดที่เปิด dispatch ค่านี้ต้องมาจากผู้นับที่แท้จริง
 */
export function snapshotRouteInputs(workOrder: WorkOrder, sourceEventId: string): RouteInputsSnapshot {
  return {
    work_item: buildCorrectiveWorkItem(workOrder, sourceEventId),
    pool: discoverPool(POOL_SIZE_PER_PROVIDER),
    in_flight: [],
    metrics: loadMetrics(),
    availability_evidence: allResourceAvailability().map((r: ResourceAvailability) => ({ worker_kind: r.worker_kind, available: r.available, reason: r.reason })),
    snapshot_at: new Date().toISOString(),
  };
}

/**
 * ลายนิ้วมือของ input ชุดนี้ — คำนวณด้วยฟังก์ชันของ scheduler เอง สะพานไม่ได้
 * นิยามรูปแบบการอ้างอิงขึ้นมาเอง
 */
export function digestOf(snapshot: RouteInputsSnapshot): string {
  return routingInputDigest(snapshot.work_item, snapshot.pool, new Map(snapshot.in_flight), snapshot.metrics);
}

/** ฟังก์ชันบริสุทธิ์เหนือ snapshot — input เดียวกันได้ผลเดียวกันเสมอ */
export function decideRoute(snapshot: RouteInputsSnapshot): RouteDecision {
  return routeWork(snapshot.work_item, snapshot.pool, new Map(snapshot.in_flight), snapshot.metrics);
}
