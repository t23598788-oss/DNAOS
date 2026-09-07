/**
 * หน้าที่: นิยาม package แรกของ DNA OS — ประกอบจากโมดูลที่มีชีวิตจริงเท่านั้น
 *
 * Owner, 2026-09-05: package ห้ามมีตรรกะเฉพาะผู้ให้บริการ มันประกาศแค่ว่า
 * ต้องการความสามารถอะไร ผูกกับ surface ชนิดไหน แล้วให้ตัวเลือกทรัพยากรกับ
 * ตัวเรนเดอร์กลางทำงานต่อ
 *
 * ทำไมไม่มีโมดูลเอกสารของ deadboard: ตรวจแล้ว 2026-09-05 ว่า capability สาม
 * ตัวนั้นเป็น RETIRED และไม่มี runtime ที่ยังมีชีวิต (local ไม่รัน · Vercel 402 ·
 * ไม่มีโปรเจกต์ใน Railway) จึงไม่ถูกเลือกเข้ามาใน package นี้ — ของมีอยู่แต่
 * เรียกใช้ไม่ได้ ต่างจาก "ไม่มี"
 *
 * Input: none (ประกาศล้วน)
 * Output: PackageDefinition, SURFACES
 * Dependency ที่อนุญาต: ../standard-surface/contract.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้ามใส่ตรรกะของ LINE หรือ expense ลงในไฟล์นี้
 * - ห้ามอ้าง capability ที่ไม่มีในทะเบียน
 * - ห้ามเพิ่มโมดูลที่ runtime ยังพิสูจน์ไม่ได้
 */

import type { SurfaceDefinition } from "../standard-surface/contract";

export interface ModuleBinding {
  readonly module_id: string;
  readonly required_capabilities: readonly string[];
  readonly surface_ids: readonly string[];
  readonly runtime_status: "LIVE" | "RUNTIME_UNAVAILABLE";
  readonly evidence: string;
}

export interface PackageDefinition {
  readonly package_id: string;
  readonly package_type: string;
  readonly business_blueprint: string;
  readonly modules: readonly ModuleBinding[];
  readonly surfaces: readonly SurfaceDefinition[];
  readonly deployment_target: string | null;
  readonly cost_policy: "ZERO_SPEND" | "METERED";
  readonly status: "DRAFT" | "ACTIVE";
}

const EXPENSE_ROW = ["expense_id","provider","source_subject","invoice_identity","billing_period",
  "charged_at","currency","amount","tax_amount","description","payment_state","ingested_at"];

/** surface ที่ package นี้ใช้ — เป็นนิยามล้วน ไม่มีข้อมูลอยู่ข้างใน */
export const SURFACES: readonly SurfaceDefinition[] = [
  {
    surface_id: "expense.document_list", surface_type: "DOCUMENT_LIST",
    title: "เอกสารค่าใช้จ่าย",
    data_contract: { capability: "expense-ingestion", row_shape: EXPENSE_ROW, row_id_field: "expense_id" },
    actions: [], permissions: ["owner"], filters: [],
    sort: { field: "charged_at", direction: "desc" },
    columns: [
      { key: "charged_at", label: "วันที่", kind: "datetime", primary: true },
      { key: "provider", label: "ผู้ให้บริการ", kind: "text" },
      { key: "source_subject", label: "เรื่อง", kind: "text" },
      { key: "amount", label: "จำนวนเงิน", kind: "money" },
      { key: "currency", label: "สกุล", kind: "text" },
    ],
    refresh_policy: { kind: "ON_DEMAND" },
    empty_state: "ยังไม่มีเอกสารค่าใช้จ่ายที่บันทึกไว้",
    error_state: "อ่านรายการเอกสารไม่ได้ — นี่เป็นสถานะการอ่าน ไม่ใช่การยืนยันว่าไม่มีข้อมูล",
  },
  {
    surface_id: "expense.table", surface_type: "TABLE",
    title: "ตารางเอกสารค่าใช้จ่าย",
    data_contract: { capability: "expense-ingestion", row_shape: EXPENSE_ROW, row_id_field: "expense_id" },
    actions: [], permissions: ["owner"], filters: [],
    sort: { field: "charged_at", direction: "desc" },
    columns: [
      { key: "charged_at", label: "วันที่", kind: "datetime", primary: true },
      { key: "provider", label: "ผู้ให้บริการ", kind: "text" },
      { key: "invoice_identity", label: "เลขที่เอกสาร", kind: "text" },
      { key: "billing_period", label: "รอบบิล", kind: "text" },
      { key: "amount", label: "จำนวนเงิน", kind: "money" },
      { key: "tax_amount", label: "ภาษี", kind: "money" },
      { key: "payment_state", label: "สถานะ", kind: "state" },
    ],
    refresh_policy: { kind: "ON_DEMAND" },
    empty_state: "ยังไม่มีแถวในตาราง",
    error_state: "อ่านตารางไม่ได้",
  },
  {
    surface_id: "line.inbox", surface_type: "INBOX",
    title: "ข้อความเข้า",
    data_contract: { capability: "line-messaging-ingress", row_shape: ["event_id","received_at","source","text"], row_id_field: "event_id" },
    actions: [], permissions: ["owner"], filters: [], sort: { field: "received_at", direction: "desc" },
    columns: [
      { key: "received_at", label: "เวลา", kind: "datetime", primary: true },
      { key: "source", label: "ผู้ส่ง", kind: "text" },
      { key: "text", label: "ข้อความ", kind: "text" },
    ],
    refresh_policy: { kind: "ON_DEMAND" },
    empty_state: "ยังไม่มีข้อความเข้า",
    error_state: "อ่านกล่องข้อความไม่ได้",
  },
];

export const BUSINESS_COMMUNICATION_AND_EXPENSE_INTAKE: PackageDefinition = {
  package_id: "BUSINESS_COMMUNICATION_AND_EXPENSE_INTAKE",
  package_type: "BUSINESS_APPLICATION",
  business_blueprint: "รับข้อความเข้าจากช่องทางสนทนา และเก็บเอกสารค่าใช้จ่ายที่เข้ามาให้อยู่ในรูปแบบเดียวกัน แล้วแสดงทั้งสองอย่างบนหน้าจอมาตรฐาน",
  modules: [
    { module_id: "LINE_COMMUNICATION", required_capabilities: ["line-messaging-ingress"],
      surface_ids: ["line.inbox"], runtime_status: "RUNTIME_UNAVAILABLE",
      evidence: "source + signature verification ยืนยันแล้ว (engine-prototypeไลน์/line-adapter.ts createHmac+timingSafeEqual บน raw bytes) แต่ไม่มีโปรเซสรันอยู่เมื่อ 2026-09-05" },
    { module_id: "EXPENSE_INGESTION", required_capabilities: ["expense-ingestion"],
      surface_ids: ["expense.document_list", "expense.table"], runtime_status: "LIVE",
      evidence: "connections/expense-ingestion/data/expenses.jsonl มี 67 แถวจริง อ่านได้ผ่าน readExpenses()" },
  ],
  surfaces: SURFACES,
  deployment_target: null,
  cost_policy: "ZERO_SPEND",
  status: "DRAFT",
};
