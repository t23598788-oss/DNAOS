/**
 * หน้าที่: โครงสร้าง DATA_FLOW_V1 — เส้นทางข้อมูลจากต้นทางถึงปลายทาง
 *
 * Owner, 2026-09-05 ข้อ 13/15: ต้องอ่านด้วยเครื่องได้ และต้องรองรับให้ runtime
 * evidence มาเติมทีหลังโดยไม่ต้องแก้โครงสร้าง — ตอนนี้ยังไม่ instrument production
 * ช่องของ trace จึงมีไว้ว่าง ๆ ก่อน ไม่ใช่เติมค่าปลอม
 *
 * Dependency ที่อนุญาต: ./object-classifier.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเติม trace record ด้วยข้อมูลที่ไม่ได้มาจากการรันจริง
 * - ห้ามให้ stage หนึ่งมีทั้ง decision และ external action ในตัวเดียว
 */

import type { DataLayer } from "./object-classifier";

/** ข้อ 10: แยกให้ขาดว่าอันไหนแค่สังเกต อันไหนตัดสิน อันไหนลงมือทำกับโลกภายนอก */
export type StageNature = "OBSERVATION" | "DECISION" | "EXTERNAL_ACTION";

export type StageOperation =
  | "INGEST" | "NORMALIZE" | "RESOLVE_IDENTITY" | "BUSINESS_STATE"
  | "CALCULATION" | "TRANSACTION" | "ARTIFACT" | "PROJECTION" | "ACTION";

export type FlowHealth =
  | "COMPLETE" | "PARTIAL" | "DEAD_END" | "BROKEN_SCHEMA"
  | "BROKEN_RUNTIME" | "STALE_CODE" | "UNKNOWN";

export type FinancialEffect =
  | "COST_CREATED" | "REVENUE_CREATED" | "RECEIVABLE_CREATED" | "PAYABLE_CREATED"
  | "PAYMENT_RECEIVED" | "PAYMENT_SENT" | "TAX_CREATED" | "DEBT_CREATED" | "SETTLED";

export type RefreshMechanism = "REQUEST" | "REALTIME" | "POLL" | "EVENT" | "NONE";

export interface DataFlowStage {
  readonly stage_id: string;
  readonly layer: DataLayer;
  readonly nature: StageNature;
  readonly operation: StageOperation;
  readonly component: string;
  readonly input: string;
  readonly output: string;
  readonly data_object: readonly string[];
  readonly authority: string;
  readonly side_effect: string | null;
  readonly next_stage: string | null;
  readonly failure_path: string;
  readonly source_pointer: string;
}

export interface ProjectionBinding {
  readonly surface: string;
  readonly canonical_source: readonly string[];
  readonly projection_object: readonly string[];
  readonly refresh: RefreshMechanism;
  /** จริงเมื่อหน้าจออ่านข้อมูลดิบชั้น ingestion ตรง ๆ — ต้องมีเหตุผลกำกับ */
  readonly reads_raw_ingestion: boolean;
  readonly reason: string;
}

export interface MoneyMovement {
  readonly effect: FinancialEffect;
  readonly data_object: readonly string[];
  /** ต้องชี้ไปที่การคำนวณที่กำหนดผลแน่นอนได้ ไม่ใช่โมเดลภาษา */
  readonly deterministic_calculation: string;
}

export interface DataFlowV1 {
  readonly schema: "DATA_FLOW_V1";
  readonly flow_id: string;
  readonly business_flow: string;
  readonly source: string;
  readonly sink: string;
  readonly stages: readonly DataFlowStage[];
  readonly terminal_state: string;
  readonly financial_effect: readonly MoneyMovement[];
  readonly projection: readonly ProjectionBinding[];
  readonly external_action: readonly string[];
  readonly health: FlowHealth;
  readonly last_confirmed_stage: string | null;
  readonly expected_next_stage: string | null;
  readonly blocker: string | null;
  /** ข้อ 15: ที่ว่างสำหรับหลักฐานการรันจริง ยังไม่มีตอนนี้ */
  readonly runtime_trace: readonly RuntimeTraceRecord[];
}

/**
 * รูปแบบที่ runtime evidence จะมาเติมภายหลัง — ยังไม่ instrument production
 * ทุกฟิลด์ ref เก็บเป็นตัวชี้ ไม่ใช่เนื้อข้อมูล เพื่อไม่ให้ข้อมูลธุรกิจหลุดมาอยู่ใน catalog
 */
export interface RuntimeTraceRecord {
  readonly trace_id: string;
  readonly flow_id: string;
  readonly stage_id: string;
  readonly parent_stage: string | null;
  readonly timestamp: string;
  readonly status: "STARTED" | "COMPLETED" | "FAILED" | "SKIPPED";
  readonly input_ref: string | null;
  readonly output_ref: string | null;
  readonly error_ref: string | null;
}
