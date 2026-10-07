/**
 * หน้าที่: ให้ "ตัวตน" กับการตัดสินเส้นทางหนึ่งครั้ง — `route_decision_id`
 * และเก็บมันไว้เป็นหลักฐาน โดย **ไม่แตะตรรกะการให้คะแนนเลย**
 *
 * แยกสองเรื่องที่ต่างกันโดยสิ้นเชิงออกจากกัน:
 *   ผลของการตัดสิน   `./capability-router.ts#routeWork` — บริสุทธิ์ input
 *                     เดียวกันได้ provider/unit/score/reason เดียวกันเสมอ
 *   ตัวตนของครั้งนั้น  ไฟล์นี้ — มี id ที่ไม่ซ้ำและเวลาที่บันทึก
 *
 * ทำไมต้องแยก: ถ้าเอา `randomUUID()`/`Date.now()` ไปใส่ใน `routeWork` การพิสูจน์
 * ว่า "input เดิมให้ผลเดิม" จะทำไม่ได้อีกเลย เพราะผลจะต่างกันทุกครั้งด้วย id
 * การตัดสินซ้ำสองครั้งบน input ชุดเดิม **ต้อง** ได้ผลเหมือนกัน แต่ **ควร**
 * ได้ route_decision_id คนละตัว เพราะมันคือสองเหตุการณ์จริงคนละครั้ง
 *
 * scheduler เป็นเจ้าของ id นี้เพราะ scheduler คือผู้สร้างข้อเท็จจริงนั้น ผู้เรียก
 * (เช่น control/write-failure-bridge/) รับไปใช้อย่างเดียว ห้ามออก id เอง
 *
 * `routing_input_digest` เป็น sha256 ของ input ที่ใช้ตัดสินจริง (ไม่รวมเวลา) —
 * เป็นการอ้างอิงที่ตรวจสอบซ้ำได้ด้วยเครื่อง ไม่ใช่คำบรรยาย ใครก็ตามที่ถือ input
 * ชุดเดิมคำนวณค่านี้ได้เองและเทียบได้ว่าเป็นการตัดสินบนข้อมูลชุดเดียวกันหรือไม่
 *
 * Input: task_id + `RouteDecision` ที่ `routeWork` คืนมา + input ที่ใช้ตัดสิน
 * Output: `identifyRouteDecision`, `routingInputDigest`, `loadRouteDecision`,
 * `listRouteDecisions`, `RouteDecisionRecord`
 * Dependency ที่อนุญาต: ./capability-router.ts (type), ./provider-pool.ts (type),
 * ../work-graph/types.ts (type), node:fs, node:path, node:crypto
 * สิ่งที่ห้ามแตะ: ห้ามนำเข้าอะไรจากไฟล์นี้เข้าไปใน ./capability-router.ts และ
 * ห้ามลบแถวที่บันทึกแล้ว (append-only เหมือน provider-metrics.jsonl)
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type { RouteDecision } from "./capability-router";
import type { ProcessingUnit, ProviderKind, ProviderMetricRecord } from "./provider-pool";
import type { WorkItem } from "../work-graph/types";

const REPO_ROOT = join(__dirname, "..", "..");
function decisionLogPath(): string {
  return process.env.SCHEDULER_ROUTE_DECISION_LOG
    ?? join(REPO_ROOT, "control/scheduler/data/route-decisions.jsonl");
}

export interface RouteDecisionRecord {
  readonly route_decision_id: string;
  readonly task_id: string;
  readonly worker_kind: ProviderKind;
  readonly unit_id: string;
  readonly score: number;
  readonly reason: string;
  readonly candidates_considered: number;
  /** sha256 ของ input ที่ใช้ตัดสิน — คำนวณซ้ำได้ ไม่ใช่ข้อความบรรยาย */
  readonly routing_input_digest: string;
  readonly decided_at: string;
}

/**
 * ลายนิ้วมือของ input การตัดสิน — บริสุทธิ์และคำนวณซ้ำได้
 *
 * ไม่รวมเวลาใด ๆ โดยเจตนา: input ชุดเดียวกันที่อ่านคนละนาทีต้องได้ digest เดียวกัน
 * ไม่งั้นมันจะกลายเป็น id อีกตัวหนึ่งแทนที่จะเป็นการอ้างถึงข้อมูล
 */
export function routingInputDigest(
  item: WorkItem,
  pool: readonly ProcessingUnit[],
  inFlightByProvider: ReadonlyMap<ProviderKind, number>,
  metrics: readonly ProviderMetricRecord[],
): string {
  const canonical = {
    work_item: { work_id: item.work_id, kind: item.kind, worker_class: item.worker_class, target: item.target, write_scope: item.write_scope },
    // เรียงตาม unit_id เพื่อให้ลำดับของ array ไม่กลายเป็นส่วนหนึ่งของข้อมูล
    pool: [...pool].map((u) => ({ unit_id: u.unit_id, provider: u.provider, available: u.available })).sort((a, b) => (a.unit_id < b.unit_id ? -1 : 1)),
    in_flight: [...inFlightByProvider.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    metrics: metrics.map((m) => ({ provider: m.provider, work_kind: m.work_kind, outcome: m.outcome, duration_ms: m.duration_ms })),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export interface IdentifyRouteDecisionInput {
  readonly task_id: string;
  readonly decision: RouteDecision;
  readonly routing_input_digest: string;
}

export type IdentifyOutcome =
  | { readonly ok: true; readonly record: RouteDecisionRecord }
  /** การตัดสินที่ไม่พบผู้ทำงานไม่มีตัวตนให้บันทึก — ไม่มี unit ให้ผูก id เข้ากับอะไร */
  | { readonly ok: false; readonly reason: string };

/**
 * ให้ตัวตนกับการตัดสินหนึ่งครั้ง แล้วบันทึกลงหลักฐาน
 *
 * เรียกครั้งที่สองบน `RouteDecision` เดิมจะได้ id ใหม่ ซึ่งถูกต้อง — มันคือการ
 * บันทึกว่า "ตัดสินอีกครั้งหนึ่ง" ไม่ใช่การบอกว่าผลเปลี่ยน ผลเดิมหรือไม่ดูจาก
 * `routing_input_digest` + worker_kind/unit_id/score/reason ที่บันทึกไว้
 */
export function identifyRouteDecision(input: IdentifyRouteDecisionInput): IdentifyOutcome {
  if (!input.decision.ok) {
    return { ok: false, reason: `ROUTE_NOT_TAKEN: ${input.decision.reason}` };
  }
  const record: RouteDecisionRecord = {
    route_decision_id: `rd-${randomUUID()}`,
    task_id: input.task_id,
    worker_kind: input.decision.unit.provider,
    unit_id: input.decision.unit.unit_id,
    score: input.decision.score,
    reason: input.decision.reason,
    candidates_considered: input.decision.candidates_considered,
    routing_input_digest: input.routing_input_digest,
    decided_at: new Date().toISOString(),
  };
  const p = decisionLogPath();
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, `${JSON.stringify(record)}\n`, "utf8");
  return { ok: true, record };
}

export function listRouteDecisions(): readonly RouteDecisionRecord[] {
  const p = decisionLogPath();
  if (!existsSync(p)) return [];
  const rows: RouteDecisionRecord[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line) as RouteDecisionRecord); } catch { /* แถวเสียข้ามไป ไม่ลบ */ }
  }
  return rows;
}

export function loadRouteDecision(routeDecisionId: string): RouteDecisionRecord | null {
  return listRouteDecisions().find((r) => r.route_decision_id === routeDecisionId) ?? null;
}

export function routeDecisionsForTask(taskId: string): readonly RouteDecisionRecord[] {
  return listRouteDecisions().filter((r) => r.task_id === taskId);
}
