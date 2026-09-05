/**
 * หน้าที่: ตัวตรวจ runtime flow — ตัดสินว่า VERIFIED หรือ PARTIAL จากฟิลด์บังคับ
 *
 * Owner, 2026-09-05 ข้อ 18: "Agent ห้ามประกาศ VERIFIED เอง" ไฟล์นี้จึงเป็น
 * ผู้ตัดสินเพียงผู้เดียว และตัดสินจากการมีอยู่ของข้อมูลที่ตรวจได้ ไม่ใช่จาก
 * ความมั่นใจของผู้เขียน
 *
 * Input: RuntimeFlow
 * Output: FlowVerdict พร้อมรายการฟิลด์ที่ขาด
 * Dependency ที่อนุญาต: ./flow-types.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้ามผ่อนเกณฑ์เพื่อให้ flow ผ่าน
 * - ห้ามถือว่า array ว่างเท่ากับ "ตรวจแล้วไม่มี" ถ้าเป็นฟิลด์บังคับ
 */

import type { RuntimeFlow, FlowStatus } from "./flow-types";

export interface FlowVerdict {
  readonly flow_id: string;
  readonly status: FlowStatus;
  readonly missing: readonly string[];
  /** ฟิลด์ที่ "มีค่า" แต่ค่านั้นแปลว่ายังไม่รู้ — กัน UNKNOWN ผ่านเป็น VERIFIED */
  readonly unresolved: readonly string[];
  readonly step_count: number;
  readonly steps_with_source: number;
  /** ตัดสินจาก dependency ที่จำเป็นเทียบ live schema */
  readonly schema_status: "VERIFIED" | "FAILED" | "UNKNOWN";
  /** object ที่จำเป็นและพิสูจน์แล้วว่าไม่มีใน live */
  readonly failed_required_objects: readonly string[];
  readonly runtime_eligibility: "ELIGIBLE" | "NOT_ELIGIBLE" | "UNKNOWN";
}

/**
 * ค่าที่นับว่า "ยังไม่รู้" — มีอยู่ในฟิลด์ก็จริง แต่ไม่ใช่คำตอบ
 *
 * Owner, 2026-09-05: verifier เดิมนับแค่ว่าฟิลด์มีค่าหรือไม่ ทำให้
 * `data_writes = ["UNKNOWN — ยังไม่ได้ไล่ครบทุก handler"]` ผ่านเป็น VERIFIED
 * ทั้งที่ยังไม่ได้ตรวจจริง — ตรวจ "มีข้อมูลไหม" ไม่เท่ากับ "ข้อมูลครบไหม"
 */
const UNRESOLVED_MARKERS = ["UNKNOWN", "UNRESOLVED", "PENDING", "NOT_CHECKED", "TBD"];
const UNRESOLVED_MARKERS_TH = ["ยังไม่ได้", "ยังไม่ทราบ"];

/**
 * marker ต้องเป็น "คำ" ไม่ใช่ substring ในชื่อ identifier
 *
 * 2026-09-05: เกณฑ์เดิมใช้ includes() ตรง ๆ ทำให้ตาราง `pending_authorizations`
 * ของ Flow C ถูกนับว่ายังไม่ resolve เพราะชื่อมี "pending" อยู่ข้างใน — เป็นการ
 * ตรวจผิด ไม่ใช่การตรวจเข้ม จึงบังคับให้ marker ภาษาอังกฤษต้องอยู่ที่ขอบคำ
 * (`UNKNOWN`, `UNKNOWN — เหตุผล`) แต่ไม่ใช่กลางคำ (`pending_authorizations`)
 * ส่วน marker ไทยไม่มีขอบคำ จึงยังใช้ substring ตามเดิม
 */
function hasMarker(value: string): boolean {
  const upper = value.toUpperCase();
  if (UNRESOLVED_MARKERS_TH.some((m) => value.includes(m))) return true;
  return UNRESOLVED_MARKERS.some((m) => new RegExp(`(^|[^A-Z0-9_])${m}([^A-Z0-9_]|$)`).test(upper));
}
function looksUnresolved(values: readonly string[]): boolean {
  if (values.length === 0) return true;
  return values.every(hasMarker);
}

export function verifyFlow(flow: RuntimeFlow): FlowVerdict {
  const missing: string[] = [];
  const unresolved: string[] = [];
  const need: [string, boolean][] = [
    ["trigger", flow.trigger.length > 0],
    ["entrypoint", flow.entrypoint.length > 0],
    ["ordered_steps", flow.steps.length > 0],
    ["component_identities", flow.components.length > 0],
    ["data_reads", flow.data_reads.length > 0],
    ["data_writes", flow.data_writes.length > 0],
    ["external_calls", flow.external_calls.length > 0],
    ["authority", flow.authority.length > 0],
    ["failure_paths", flow.failure_paths.length > 0],
    ["connector_ports", flow.ports.length > 0],
    ["evidence", flow.evidence.length > 0],
  ];
  for (const [name, ok] of need) if (!ok) missing.push(name);

  // ทุก step ต้องชี้ source ได้ ไม่งั้น catalog แทนการอ่าน source ไม่ได้จริง
  const withSource = flow.steps.filter((s) => s.source_pointer.length > 0).length;
  if (flow.steps.length > 0 && withSource !== flow.steps.length) missing.push("step.source_pointer");
  // ลำดับต้องเรียงจริง ไม่ใช่ชุดที่สลับกันได้
  const ordered = flow.steps.every((s, i) => s.order === i + 1);
  if (!ordered) missing.push("step.order_sequence");

  /**
   * ฟิลด์เชิงความหมายที่บังคับ — ถ้าค่าที่ใส่มาแปลว่า "ยังไม่รู้" ให้ถือว่ายังไม่ resolve
   * flow จะเป็น STRUCTURALLY_COMPLETE ได้ แต่ไม่ถึง VERIFIED
   */
  const semantic: [string, readonly string[]][] = [
    ["data_reads", flow.data_reads], ["data_writes", flow.data_writes],
    ["external_calls", flow.external_calls], ["authority", flow.authority],
    ["failure_paths", flow.failure_paths],
  ];
  for (const [name, values] of semantic) if (looksUnresolved(values)) unresolved.push(name);

  /**
   * บันไดสถานะ ห้ามข้ามขั้น (Owner, 2026-09-05 ข้อ 9)
   * STRUCTURALLY_COMPLETE → SEMANTICALLY_COMPLETE → SCHEMA_VERIFIED → RUNTIME_VERIFIED
   *
   * schema_verification = "MISMATCH" คือ "ตรวจแล้วและไม่ตรง" ซึ่งต่างจาก "PENDING"
   * ที่แปลว่ายังไม่ได้ตรวจ ทั้งสองกรณีไม่เลื่อนขั้น แต่ MISMATCH เป็นข้อบกพร่องที่
   * รู้ตัวแล้ว จึงต้องไม่ถูกกลบว่าเทียบเท่ากับยังไม่ได้ตรวจ
   */
  /**
   * ข้อ 8: dependency ที่จำเป็นตัวใดมี SCHEMA_STATUS = FAILED แล้ว flow นั้นขึ้น
   * SCHEMA_VERIFIED ไม่ได้ และไม่ eligible ให้รัน — ไม่ว่าฟิลด์อื่นจะครบแค่ไหน
   * ตัวที่ประกาศไว้ใน optional_data_objects เท่านั้นที่ยกเว้นได้
   */
  const optional = new Set(flow.optional_data_objects ?? []);
  const failedRequired = (flow.schema_missing_tables ?? []).filter((t) => !optional.has(t));
  const schemaFailed = failedRequired.length > 0 || flow.schema_status === "FAILED";

  const status: FlowStatus = missing.length > 0 ? "PARTIAL"
    : unresolved.length > 0 ? "STRUCTURALLY_COMPLETE"
    : schemaFailed ? "SEMANTICALLY_COMPLETE"
    : flow.schema_verification !== "VERIFIED" ? "SEMANTICALLY_COMPLETE"
    : flow.runtime_verification === "VERIFIED" ? "RUNTIME_VERIFIED"
    : "SCHEMA_VERIFIED";

  const schema_status: FlowVerdict["schema_status"] = schemaFailed ? "FAILED"
    : flow.schema_verification === "VERIFIED" ? "VERIFIED" : "UNKNOWN";
  const runtime_eligibility: FlowVerdict["runtime_eligibility"] = schemaFailed ? "NOT_ELIGIBLE"
    : schema_status === "VERIFIED" ? "ELIGIBLE" : "UNKNOWN";

  return { flow_id: flow.flow_id, status, missing, unresolved,
    step_count: flow.steps.length, steps_with_source: withSource,
    schema_status, failed_required_objects: failedRequired, runtime_eligibility };
}
