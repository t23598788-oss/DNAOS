/**
 * หน้าที่: สัญญาที่ซอฟต์แวร์ใช้ประกอบระบบเอง โดยไม่ต้องอ่านซอร์สและไม่ต้องใช้ AI
 *
 * Owner, 2026-09-05: catalog ต้องเลิกเป็น "เอกสารที่อ่านได้" แล้วกลายเป็น
 * "contract ที่ deterministic software ใช้ประกอบและเรียกกันเองได้"
 * ทุกชนิดในไฟล์นี้จึงต้องตรวจด้วยเครื่องได้ ไม่มีช่องไหนที่รับ prose เป็นสัญญาหลัก
 *
 * Dependency ที่อนุญาต: control/system-catalog/object-classifier.ts (ชนิด layer)
 * สิ่งที่ห้ามแตะ:
 * - ห้ามใส่ค่า UNKNOWN แทนการไม่รู้แล้วปล่อยให้ matcher ตีความว่าเข้ากันได้
 * - ห้ามให้ unit ที่ reusable ไม่มี entrypoint แล้วยังนับว่า ASSEMBLY_READY
 */

import type { DataLayer } from "../system-catalog/object-classifier";

export type Availability = "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" | "UNKNOWN";
export type PortStatus = "READY" | "PARTIAL" | "UNAVAILABLE" | "UNKNOWN";
export type SideEffectClass = "PURE" | "READ_ONLY" | "LOCAL_WRITE" | "EXTERNAL_WRITE" | "FINANCIAL" | "DEVICE_CONTROL";
export type Transport =
  | "FUNCTION" | "HTTP" | "EVENT" | "WEBHOOK" | "RPC" | "DATABASE"
  | "REALTIME" | "MCP" | "CLI" | "FILE" | "DEVICE";
export type Compatibility = "BACKWARD_COMPATIBLE" | "BREAKING" | "UNKNOWN";
export type SyncMode = "SYNC" | "ASYNC";

/** §26 บันไดความพร้อม ห้ามข้ามขั้น */
export type ReadinessState =
  | "NOT_DOCUMENTED" | "DOCUMENTED" | "CONTRACTED" | "LINKABLE" | "EXECUTABLE" | "RUNTIME_VERIFIED";

// ─── §3 DATA_CONTRACT_V1 ────────────────────────────────────────────────────

/** ใช้โครงแบบ JSON Schema เพื่อให้ validate ด้วยเครื่องได้จริง */
export interface JsonSchemaLike {
  readonly type: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  readonly properties?: Readonly<Record<string, JsonSchemaLike>>;
  readonly items?: JsonSchemaLike;
  readonly required?: readonly string[];
  readonly enum?: readonly (string | number)[];
  readonly format?: string;
  readonly minimum?: number;
  readonly description?: string;
}

export interface DataContractV1 {
  readonly schema: "DATA_CONTRACT_V1";
  readonly schema_id: string;
  readonly entity_type: string;
  readonly schema_version: string;
  readonly json_schema: JsonSchemaLike;
  /**
   * ENTITY = เป็นของชิ้นหนึ่งที่ต้องระบุตัวตนได้ ต้องมี identity_fields
   * VALUE_OBJECT = ค่าที่คำนวณได้ ไม่มีตัวตนของตัวเอง เช่น ระยะทางเป็นกิโลเมตร
   *
   * ต้องประกาศให้ชัด เพราะ matcher ต้องแยก "ไม่มีตัวตนโดยเจตนา" ออกจาก
   * "ยังไม่ได้ประกาศตัวตน" — อย่างหลังต้องตอบ UNKNOWN ไม่ใช่ปล่อยผ่าน
   */
  readonly identity_semantics: "ENTITY" | "VALUE_OBJECT";
  /** ฟิลด์ที่ระบุตัวตนของสิ่งนี้ — ใช้ตรวจว่า port สองด้านพูดถึงของชิ้นเดียวกัน */
  readonly identity_fields: readonly string[];
  /** ฟิลด์ที่ร้อยเรื่องเดียวกันข้าม component */
  readonly correlation_fields: readonly string[];
  readonly source_of_truth: string;
  readonly compatibility: Compatibility;
  readonly supersedes: string | null;
  readonly deprecated_by: string | null;
  readonly introduced_at: string;
}

// ─── §2 PORT_CONTRACT ───────────────────────────────────────────────────────

export interface PortContract {
  readonly port_id: string;
  readonly owner_unit: string;
  readonly direction: "IN" | "OUT";
  readonly transport: Transport;
  readonly operation: string;
  readonly input_schema_ref: string | null;
  readonly output_schema_ref: string | null;
  readonly error_schema_ref: string | null;
  readonly protocol: string;
  readonly authentication: string;
  readonly authority_class: string;
  readonly side_effect_class: SideEffectClass;
  readonly timeout_ms: number | null;
  readonly retry: "NONE" | "BOUNDED" | "UNKNOWN";
  readonly idempotency: "IDEMPOTENT" | "NOT_IDEMPOTENT" | "UNKNOWN";
  readonly ordering_required: boolean;
  readonly transaction_required: boolean;
  readonly sync_or_async: SyncMode;
  readonly availability_requirement: readonly string[];
  readonly verification: string | null;
  readonly contract_version: string;
  readonly status: PortStatus;
  readonly source_pointer: string;
}

// ─── §1 ASSEMBLY_UNIT_V2 ────────────────────────────────────────────────────

export interface AssemblyUnitV2 {
  readonly schema: "ASSEMBLY_UNIT_V2";
  readonly unit_id: string;
  readonly canonical_name: string;
  readonly business_domain: string;
  readonly provides_capabilities: readonly string[];
  readonly requires_capabilities: readonly string[];
  /**
   * capability ที่พึ่งพา -> schema ที่ unit นี้รับจากตัวนั้น
   *
   * จำเป็นเพราะ dependency ป้อน "ส่วนหนึ่ง" ของ input ไม่ใช่ทั้งก้อน เช่น
   * u.quote-price รับ dc.geo.distance_result.v1 จาก geo.distance.calculate
   * ไม่ใช่รับ dc.pricing.quote_request.v1 ทั้งอันจากตัวคำนวณระยะทาง
   * ถ้าไม่ประกาศ linker จะเทียบผิดคู่แล้วตัดสินว่าต่อไม่ได้ทั้งที่ต่อได้
   */
  readonly dependency_inputs?: Readonly<Record<string, string>>;
  readonly runtime_ref: string | null;
  readonly entrypoint_ref: string | null;
  readonly ports_in: readonly string[];
  readonly ports_out: readonly string[];
  readonly data_contracts: readonly string[];
  readonly state_contracts: readonly string[];
  readonly preconditions: readonly string[];
  readonly postconditions: readonly string[];
  readonly authority_requirements: readonly string[];
  readonly resource_requirements: readonly string[];
  readonly side_effects: readonly SideEffectClass[];
  readonly failure_modes: readonly string[];
  readonly verification_profile: string | null;
  readonly availability: Availability;
  readonly source_pointer: string;
  /** คำนวณโดย ./readiness.ts เท่านั้น ห้ามผู้เขียน unit กรอกเอง */
  readonly assembly_ready?: boolean;
}

// ─── §6 CONNECTION_MANIFEST_V1 ──────────────────────────────────────────────

export interface ConnectionManifestV1 {
  readonly schema: "CONNECTION_MANIFEST_V1";
  readonly connection_id: string;
  readonly producer_unit: string;
  readonly producer_port: string;
  readonly consumer_unit: string;
  readonly consumer_port: string;
  readonly schema_mapping: Readonly<Record<string, string>>;
  readonly identity_mapping: Readonly<Record<string, string>>;
  readonly data_transform: string | null;
  readonly authority_path: readonly string[];
  readonly resource_binding: readonly string[];
  readonly failure_behavior: string;
  readonly verification: string | null;
  readonly enabled_condition: string;
  readonly status: "ACTIVE" | "BLOCKED" | "ADAPTER_REQUIRED" | "UNKNOWN";
}

// ─── §7 STATE_MACHINE_V1 ────────────────────────────────────────────────────

export interface StateTransition {
  readonly from: string;
  readonly to: string;
  readonly trigger: string;
  readonly guard: string | null;
  readonly actor: string;
  readonly authority: string;
  readonly action: string | null;
  readonly data_effect: readonly string[];
  readonly financial_effect: string | null;
  readonly event_emitted: string | null;
  readonly failure_state: string | null;
  /** null = ไม่มีโค้ดใดรับผิดชอบ transition นี้ — ตัวชี้ DEAD_END_STATE */
  readonly implementation_owner: string | null;
}

export interface StateMachineV1 {
  readonly schema: "STATE_MACHINE_V1";
  readonly machine_id: string;
  readonly entity: string;
  readonly states: readonly string[];
  readonly initial_state: string;
  readonly terminal_states: readonly string[];
  readonly transitions: readonly StateTransition[];
  readonly source_pointer: string;
}

// ─── §8 EVENT_CONTRACT_V1 ───────────────────────────────────────────────────

export interface EventContractV1 {
  readonly schema: "EVENT_CONTRACT_V1";
  readonly event_id: string;
  readonly channel: string;
  readonly producer: string;
  readonly consumers: readonly string[];
  readonly trigger: string;
  readonly payload_schema_ref: string;
  readonly correlation_id: string;
  readonly business_id: string;
  readonly delivery: "AT_MOST_ONCE" | "AT_LEAST_ONCE" | "EXACTLY_ONCE_IF_PROVEN" | "UNKNOWN";
  readonly ordering: "ORDERED" | "UNORDERED" | "UNKNOWN";
  readonly dedup_key: string | null;
  readonly retry: "NONE" | "BOUNDED" | "UNKNOWN";
  readonly dead_letter_behavior: string;
  readonly authorization: string;
  readonly contract_version: string;
}

// ─── §11 COMMAND_SPEC ───────────────────────────────────────────────────────

export interface CommandSpec {
  readonly schema: "COMMAND_SPEC_V1";
  readonly command_id: string;
  readonly intent: string;
  readonly required_inputs: readonly string[];
  readonly optional_inputs: readonly string[];
  readonly required_capabilities: readonly string[];
  readonly expected_result: string;
  readonly expected_event: string | null;
  readonly allowed_roles: readonly string[];
  readonly side_effect_class: SideEffectClass;
  readonly verification: string | null;
  readonly input_schema_ref: string;
}

// ─── §13 DATA_OWNERSHIP ─────────────────────────────────────────────────────

export interface DataOwnership {
  readonly object: string;
  readonly layer: DataLayer;
  readonly owner_capability: string | null;
  readonly canonical_writer: string | null;
  readonly allowed_writers: readonly string[];
  readonly readers: readonly string[];
  readonly source_of_truth: string;
  readonly write_policy: "SINGLE_WRITER" | "INTENTIONAL_MULTI_WRITER" | "ARCHITECTURE_CONFLICT" | "READ_ONLY" | "UNKNOWN";
  readonly arbitration_rule: string | null;
  readonly consistency: "STRONG_SINGLE_ROW" | "EVENTUAL" | "APPEND_ONLY" | "UNKNOWN";
  readonly retention: string;
  readonly projection_policy: string;
}

// ─── §15 DERIVATION_CONTRACT ────────────────────────────────────────────────

export interface DerivationContract {
  readonly schema: "DERIVATION_CONTRACT_V1";
  readonly derived_object: string;
  readonly inputs: readonly string[];
  readonly implementation_ref: string;
  readonly recompute_trigger: string;
  readonly cache_policy: string;
  readonly stale_policy: string;
  readonly authority: string;
  readonly output_schema_ref: string | null;
}

// ─── §16 FINANCIAL_EFFECT_V1 ────────────────────────────────────────────────

export interface FinancialEffectV1 {
  readonly schema: "FINANCIAL_EFFECT_V1";
  readonly effect_id: string;
  readonly effect_type: "COST" | "REVENUE" | "RECEIVABLE" | "PAYABLE" | "PAYMENT_IN" | "PAYMENT_OUT" | "TAX" | "DEBT" | "SETTLEMENT";
  readonly source_transaction: string;
  readonly amount_source: string;
  readonly currency: string;
  readonly formula_ref: string;
  readonly ledger_object: readonly string[];
  readonly reversible: boolean;
  readonly idempotency_key: string | null;
  readonly verification: string | null;
}

// ─── §17 PROJECTION_V1 ──────────────────────────────────────────────────────

export interface ProjectionV1 {
  readonly schema: "PROJECTION_V1";
  readonly projection_id: string;
  readonly surface: string;
  readonly source_entities: readonly string[];
  readonly source_capability: string | null;
  readonly fields: readonly string[];
  readonly permission: string;
  readonly refresh_mode: "REQUEST" | "EVENT" | "REALTIME" | "POLL";
  readonly stale_behavior: string;
  readonly actions: readonly string[];
}

// ─── §25 TRACE ──────────────────────────────────────────────────────────────

/**
 * ชื่อ attribute ใช้แนว OpenTelemetry สำหรับส่วนที่มีมาตรฐานอยู่แล้ว และเติม
 * ส่วนที่เป็นความหมายทางธุรกิจของ DNA OS เองด้วย prefix dnaos.*
 */
export interface TraceContext {
  readonly trace_id: string;
  readonly flow_id: string;
  readonly work_id: string | null;
  readonly command_id: string | null;
  readonly business_entity_id: string | null;
  readonly parent_stage_id: string | null;
  readonly stage_id: string;
}

export const TRACE_ATTRIBUTE_NAMES = {
  http: ["http.request.method", "http.route", "http.response.status_code", "server.address"],
  db: ["db.system.name", "db.collection.name", "db.operation.name"],
  messaging: ["messaging.system", "messaging.destination.name", "messaging.operation.type"],
  rpc: ["rpc.system", "rpc.service", "rpc.method"],
  dnaos: [
    "dnaos.flow_id", "dnaos.stage_id", "dnaos.work_id", "dnaos.command_id",
    "dnaos.business_entity_id", "dnaos.capability", "dnaos.authority_class",
    "dnaos.side_effect_class", "dnaos.financial_effect",
  ],
} as const;
