/**
 * หน้าที่: จัดชั้นและจัด layer ให้ data object ตามกฎที่ตรวจย้อนได้
 *
 * Owner, 2026-09-05 ข้อ 1: "ห้ามถือว่าทุก table เป็น canonical data"
 * ทุกการจัดชั้นต้องบอกได้ว่าใช้กฎข้อไหน ถ้าไม่มีกฎไหนตรง ต้องตอบ UNKNOWN
 * ไม่ใช่เดาให้เต็ม
 *
 * Input: ชื่อ object + สรุปการเข้าถึง + ว่ามีใน live schema หรือไม่
 * Output: ชั้น + layer + กฎที่ใช้ตัดสิน
 * Dependency ที่อนุญาต: ไม่มี
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเพิ่มกฎที่ตัดสินจาก "ความน่าจะเป็น" แทนรูปแบบที่วัดได้
 * - ห้ามให้ค่า default เป็น CANONICAL_SOURCE_OF_TRUTH
 */

export type DataClass =
  | "CANONICAL_SOURCE_OF_TRUTH" | "DERIVED_DATA" | "CACHE" | "QUEUE" | "EVENT_LOG"
  | "DOCUMENT_ARTIFACT" | "MEDIA_STORAGE" | "REFERENCE_DATA" | "CONFIGURATION"
  | "SESSION_STATE" | "TELEMETRY" | "STALE_SCHEMA" | "DUPLICATE_MODEL" | "UNKNOWN";

export type DataLayer =
  | "L0_EXTERNAL_INPUT" | "L1_INGESTION" | "L2_IDENTITY_CONTEXT" | "L3_BUSINESS_STATE"
  | "L4_CALCULATION" | "L5_TRANSACTION_STATE" | "L6_ARTIFACT" | "L7_PROJECTION"
  | "L8_EXTERNAL_ACTION" | "UNKNOWN_LAYER";

export interface ClassifierInput {
  readonly object: string;
  readonly kind: "TABLE" | "STORAGE_BUCKET";
  readonly existsLive: boolean;
  readonly readers: readonly string[];
  readonly writers: readonly string[];
}

export interface Classification {
  readonly object: string;
  readonly data_class: DataClass;
  readonly layer: DataLayer;
  readonly rule: string;
  readonly reader_count: number;
  readonly writer_count: number;
}

/** ชื่อที่ต้องตัดสินเป็นรายตัวเพราะรูปแบบชื่อบอกไม่ได้ — พร้อมเหตุผลจาก flow ที่พิสูจน์แล้ว */
const EXPLICIT: Record<string, { data_class: DataClass; layer: DataLayer; rule: string }> = {
  line_events: { data_class: "EVENT_LOG", layer: "L1_INGESTION", rule: "explicit:FLOW_A บันทึกทุกข้อความเข้าก่อนตัดสินใจ" },
  business_events: { data_class: "CANONICAL_SOURCE_OF_TRUTH", layer: "L3_BUSINESS_STATE", rule: "explicit:FLOW_E/FLOW_M เขียนผลทางธุรกิจลงที่นี่" },
  company_line_links: { data_class: "CANONICAL_SOURCE_OF_TRUTH", layer: "L2_IDENTITY_CONTEXT", rule: "explicit:FLOW_C ใช้เป็นฐานความเป็นเจ้าของ" },
  line_profiles: { data_class: "CACHE", layer: "L2_IDENTITY_CONTEXT", rule: "explicit:FLOW_B ProfileSource แยก LINE_API/CACHED/UNAVAILABLE — ต้นทางจริงคือ LINE" },
  customer_sites: { data_class: "CANONICAL_SOURCE_OF_TRUTH", layer: "L3_BUSINESS_STATE", rule: "explicit:FLOW_I สร้างหน้างานจากหมุด/ที่อยู่" },
  pit_profiles: { data_class: "REFERENCE_DATA", layer: "L3_BUSINESS_STATE", rule: "explicit:FLOW_E อ่านอย่างเดียวเพื่อคิดราคา" },
  pit_materials: { data_class: "REFERENCE_DATA", layer: "L3_BUSINESS_STATE", rule: "explicit:FLOW_E อ่านอย่างเดียวเพื่อคิดราคา" },
  debt_snapshots: { data_class: "DERIVED_DATA", layer: "L5_TRANSACTION_STATE", rule: "explicit:FLOW_H คำนวณจาก debt_events" },
  debt_events: { data_class: "CANONICAL_SOURCE_OF_TRUTH", layer: "L5_TRANSACTION_STATE", rule: "explicit:FLOW_H เหตุการณ์หนี้เป็นต้นทาง snapshot" },
  equipment_telemetry_pings: { data_class: "TELEMETRY", layer: "L1_INGESTION", rule: "explicit:FLOW_J เก็บ ping ดิบพร้อม raw_payload" },
  equipment_assets: { data_class: "CANONICAL_SOURCE_OF_TRUTH", layer: "L3_BUSINESS_STATE", rule: "explicit:FLOW_J/FLOW_K สถานะเครื่องจักร" },
  driver_equipment_permissions: { data_class: "CANONICAL_SOURCE_OF_TRUTH", layer: "L2_IDENTITY_CONTEXT", rule: "explicit:FLOW_K สิทธิ์รายคู่คน–เครื่องจักร" },
  pending_authorizations: { data_class: "CANONICAL_SOURCE_OF_TRUTH", layer: "L2_IDENTITY_CONTEXT", rule: "explicit:FLOW_C คำขออนุมัติสิทธิ์" },
  line_conversation_controls: { data_class: "SESSION_STATE", layer: "L2_IDENTITY_CONTEXT", rule: "explicit:FLOW_M โหมด ai / human_takeover" },
  bank_notifications: { data_class: "EVENT_LOG", layer: "L1_INGESTION", rule: "explicit:FLOW_L แจ้งเตือนจากธนาคารที่รอจับคู่" },
  fuel_price_log: { data_class: "REFERENCE_DATA", layer: "L4_CALCULATION", rule: "explicit:FLOW_E ราคาน้ำมันเป็นตัวแปรคำนวณค่าขนส่ง" },
  material_types: { data_class: "REFERENCE_DATA", layer: "L4_CALCULATION", rule: "explicit:FLOW_E ชนิดวัสดุและความหนาแน่น" },
  vehicle_types: { data_class: "REFERENCE_DATA", layer: "L4_CALCULATION", rule: "explicit:FLOW_E ชนิดรถและความจุ" },
  line_channels: { data_class: "CONFIGURATION", layer: "L2_IDENTITY_CONTEXT", rule: "explicit:FLOW_A index.ts:52 ระบุช่องทาง" },
  attachments: { data_class: "MEDIA_STORAGE", layer: "L1_INGESTION", rule: "explicit:storage bucket ไม่ใช่ตาราง" },
  customer_orders: { data_class: "CANONICAL_SOURCE_OF_TRUTH", layer: "L3_BUSINESS_STATE", rule: "explicit:FLOW_G อ่านเพื่อออกใบแจ้งหนี้" },
  maintenance_tickets: { data_class: "CANONICAL_SOURCE_OF_TRUTH", layer: "L3_BUSINESS_STATE", rule: "explicit:FLOW_K ใบแจ้งซ่อมจากชั่วโมงเครื่องยนต์" },
  partner_payable_requests: { data_class: "CANONICAL_SOURCE_OF_TRUTH", layer: "L5_TRANSACTION_STATE", rule: "explicit:FLOW_A postback.ts เขียนคำขอจ่ายเงินคู่ค้า" },
};

/** กฎรูปแบบชื่อ — เรียงตามลำดับที่ตรวจ อันแรกที่ตรงเป็นผู้ชนะ */
const PATTERNS: readonly [RegExp, DataClass, DataLayer, string][] = [
  [/_queue$|^ai_tasks$/, "QUEUE", "L1_INGESTION", "pattern:ชื่อลงท้าย _queue หรือเป็นคิวงาน"],
  [/^kv_cache$|_cache$/, "CACHE", "L1_INGESTION", "pattern:ชื่อบ่งบอกแคช"],
  [/_log$|_logs$|_events$|_history$|_audit_log$/, "EVENT_LOG", "L1_INGESTION", "pattern:ชื่อลงท้ายแบบบันทึกเหตุการณ์"],
  [/_pings$|telemetry/, "TELEMETRY", "L1_INGESTION", "pattern:ชื่อบ่งบอก telemetry"],
  [/document|invoice|receipt/, "DOCUMENT_ARTIFACT", "L6_ARTIFACT", "pattern:ชื่อบ่งบอกเอกสาร"],
  [/_settings$|_config$|_configs$/, "CONFIGURATION", "L2_IDENTITY_CONTEXT", "pattern:ชื่อบ่งบอกการตั้งค่า"],
  [/_sessions$|^identities$/, "SESSION_STATE", "L2_IDENTITY_CONTEXT", "pattern:ชื่อบ่งบอก session/ตัวตน"],
  [/_snapshots$/, "DERIVED_DATA", "L5_TRANSACTION_STATE", "pattern:snapshot คือผลคำนวณ ไม่ใช่ต้นทาง"],
  [/_types$/, "REFERENCE_DATA", "L4_CALCULATION", "pattern:ตารางชนิด/ประเภท"],
];

export function classifyObject(input: ClassifierInput): Classification {
  const base = { object: input.object, reader_count: input.readers.length, writer_count: input.writers.length };

  // โค้ดคาดหวัง object ที่ production ไม่มี — จัดชั้นนี้ก่อนเสมอ ไม่ว่าชื่อจะเป็นแบบใด
  if (!input.existsLive && input.kind === "TABLE") {
    return { ...base, data_class: "STALE_SCHEMA", layer: "UNKNOWN_LAYER",
      rule: "rule:โค้ดอ้างถึงแต่ไม่มีใน live schema" };
  }
  if (input.kind === "STORAGE_BUCKET") {
    return { ...base, data_class: "MEDIA_STORAGE", layer: "L1_INGESTION", rule: "rule:storage bucket" };
  }
  const explicit = EXPLICIT[input.object];
  if (explicit) return { ...base, ...explicit };

  for (const [re, data_class, layer, rule] of PATTERNS) {
    if (re.test(input.object)) return { ...base, data_class, layer, rule };
  }

  // ไม่มีกฎไหนตรง — ตอบ UNKNOWN ไม่ใช่เดาว่า canonical
  return { ...base, data_class: "UNKNOWN", layer: "UNKNOWN_LAYER",
    rule: "rule:ไม่มีกฎใดตรง และไม่มีหลักฐานจาก flow ที่พิสูจน์แล้ว" };
}
