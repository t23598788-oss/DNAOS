/**
 * หน้าที่: บริบท "ใครสั่ง" ของหนึ่ง runtime operation — ไม่ใช่ตัวตนแบบใหม่
 *
 * ── ทำไมไม่มีชนิดตัวตนใหม่ ──
 * DNA OS มีสัญญาตัวตนอยู่แล้วคือ `contracts/identity#EnvelopeIdentity` ไฟล์นี้
 * จึง **หยิบชุดย่อยของมัน** (`identity_id` + `kind`) มาใช้ ไม่ประกาศ union ใหม่
 * ไม่ตั้งชื่อ role ใหม่ และไม่คัดลอกความหมายของ kind มาเขียนซ้ำ เหตุที่เป็นชุด
 * ย่อยไม่ใช่ทั้งก้อน เพราะจุดเรียกจริงบนสาย Owner ถือแค่
 * `{identity_id, kind:"human"}` (control/owner-backbone/gateway.ts) การบังคับให้
 * มี `acting_as_account_id` / `acting_as_tenant_id` / `software_id` จะทำให้ต้อง
 * กรอกค่าที่ไม่มีจริง — นั่นคือการปลอมตัวตน ไม่ใช่การบันทึกตัวตน
 *
 * ── ไม่มีผู้ขอ ไม่ใช่ผู้ขอชื่อ UNKNOWN ──
 * เมื่อผู้เรียกไม่ส่งบริบทมา ฟิลด์จะ **ไม่ปรากฏในแถวหลักฐานเลย** ไม่ใช่
 * `"UNKNOWN"` ไม่ใช่ `"SYSTEM"` และไม่ใช่ `"control/runtime-control"` เพราะ
 * ตัวตนที่แต่งขึ้นอ่านย้อนหลังแล้วแยกไม่ออกจากตัวตนที่วัดได้จริง แถวเก่าทั้งหมด
 * ที่ไม่มีฟิลด์นี้จึงอ่านได้ว่า NOT_MEASURED เสมอ
 *
 * ── ผู้ขอ ไม่ใช่ ผู้ลงมือ และไม่ใช่ ผู้มีอำนาจกำหนดสถานะที่พึงเป็น ──
 * `executed_by` มีค่าเดียวที่เป็นไปได้คือ `"control/runtime-control"` ผู้เรียก
 * ส่งค่านี้ไม่ได้ ทับไม่ได้ และการมี `requested_by` **ไม่ให้สิทธิ์อะไรทั้งสิ้น**
 * ไฟล์นี้ไม่มีคำว่า desired state ไม่มีคำตัดสินอนุญาต/ปฏิเสธ และไม่มีการอนุมาน
 * เจตนาจากการกระทำ
 *
 * Input: `RuntimeOperationRequest`
 * Output: `RuntimeRequesterIdentity`, `RuntimeRequestLineage`,
 * `RuntimeOperationRequest`, `RuntimeExecutor`, `RUNTIME_CONTROL_EXECUTOR`,
 * `buildRequesterProvenance`, `buildRequesterFields`, `readRequester`
 * Dependency ที่อนุญาต: type-only จาก contracts/identity
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่มค่าอื่นให้ `RuntimeExecutor` ห้ามใส่ค่าแทนตัวตนที่ขาด
 * และห้ามเพิ่มฟิลด์ใดที่แปลว่า "อนุมัติแล้ว" หรือ "สถานะที่พึงเป็น"
 */

import type { EnvelopeIdentity } from "../../contracts/identity/envelope-identity";

/**
 * ชุดย่อยของสัญญาตัวตนเดิม — `Pick` ไม่ใช่การประกาศใหม่ ถ้า `EnvelopeIdentity`
 * เปลี่ยนความหมายของสองช่องนี้ ที่นี่จะเปลี่ยนตาม ไม่แยกร่าง
 */
export type RuntimeRequesterIdentity = Pick<EnvelopeIdentity, "identity_id" | "kind">;

/**
 * ตัวชี้กลับต้นทาง — ทุกช่อง optional เพราะแต่ละสายมีของไม่เหมือนกันจริง ๆ
 * สาย Owner มี command_id/correlation_id/owner_intent_id สายกู้คืนมี
 * condition_id/action_id ทั้งสองสายมี work_id ช่องที่ไม่มีคือ "ไม่มีจริง"
 * ไม่ใช่ "ยังไม่ได้กรอก" — จึงต้องหายไปจากแถว ไม่ใช่เป็น null
 */
export interface RuntimeRequestLineage {
  readonly work_id?: string;
  readonly command_id?: string;
  readonly correlation_id?: string;
  readonly owner_intent_id?: string;
  readonly condition_id?: string;
  readonly action_id?: string;
}

export interface RuntimeOperationRequest {
  readonly requested_by: RuntimeRequesterIdentity;
  readonly lineage?: RuntimeRequestLineage;
}

/** ค่าเดียวที่เป็นไปได้ ผู้ลงมือคือ runtime-control เสมอ ไม่ว่าใครจะเป็นผู้ขอ */
export type RuntimeExecutor = "control/runtime-control";
export const RUNTIME_CONTROL_EXECUTOR: RuntimeExecutor = "control/runtime-control";

export interface RuntimeOperationRequesterProvenance {
  readonly requested_by?: RuntimeRequesterIdentity;
  readonly requester_lineage?: RuntimeRequestLineage;
  readonly executed_by?: RuntimeExecutor;
}

const LINEAGE_KEYS = ["work_id", "command_id", "correlation_id", "owner_intent_id", "condition_id", "action_id"] as const;

/** เก็บเฉพาะช่องที่มีค่าจริง — สตริงว่างคือไม่มี ไม่ใช่ค่า */
function compactLineage(lineage: RuntimeRequestLineage | undefined): RuntimeRequestLineage | undefined {
  if (lineage === undefined) return undefined;
  const out: Record<string, string> = {};
  for (const key of LINEAGE_KEYS) {
    const value = lineage[key];
    if (typeof value === "string" && value.length > 0) out[key] = value;
  }
  return Object.keys(out).length > 0 ? (out as RuntimeRequestLineage) : undefined;
}

/**
 * แปลงบริบทผู้ขอเป็นชิ้นส่วนของแถวหลักฐาน
 *
 * ไม่มีบริบท -> คืนอ็อบเจกต์ว่าง แถวที่ได้จะไม่มีฟิลด์เหล่านี้เลย
 * มีบริบทแต่ `identity_id` ว่าง -> ถือว่าไม่มีผู้ขอ ไม่ใช่ผู้ขอไร้ชื่อ
 * `executed_by` ถูกกำหนดที่นี่เท่านั้น ค่าที่ผู้เรียกส่งมาไปไม่ถึงฟิลด์นี้
 */
export function buildRequesterProvenance(request?: RuntimeOperationRequest): RuntimeOperationRequesterProvenance {
  const requester = buildRequesterFields(request);
  if (requester.requested_by === undefined) return {};
  return { ...requester, executed_by: RUNTIME_CONTROL_EXECUTOR };
}

/**
 * ผู้ขอ **โดยไม่ประกาศผู้ลงมือ** — สำหรับเส้นทางที่ไม่ได้ลงมือผ่าน runOperation
 *
 * ทำไมต้องแยก: `boot-orchestrator` เรียก launchctl เอง การใส่
 * `executed_by = "control/runtime-control"` ให้มันเพียงเพราะสัญญาหลักฐานเป็นของ
 * runtime-control คือการบันทึกผู้ลงมือผิดตัว ผู้ลงมือที่ยังไม่มีตัวตนที่พิสูจน์แล้ว
 * ต้องเป็นช่องที่หายไป (NOT_MEASURED) ไม่ใช่ช่องที่กรอกด้วยชื่อที่ฟังดูเข้าท่า
 */
export function buildRequesterFields(request?: RuntimeOperationRequest): Omit<RuntimeOperationRequesterProvenance, "executed_by"> {
  const identityId = request?.requested_by?.identity_id;
  if (typeof identityId !== "string" || identityId.length === 0) return {};
  const lineage = compactLineage(request?.lineage);
  return {
    requested_by: { identity_id: identityId, kind: request!.requested_by.kind },
    ...(lineage ? { requester_lineage: lineage } : {}),
  };
}

export type RequesterReading =
  | { readonly measured: true; readonly identity: RuntimeRequesterIdentity; readonly lineage: RuntimeRequestLineage }
  | { readonly measured: false; readonly reason_code: "NOT_MEASURED"; readonly detail: string };

/**
 * อ่านผู้ขอจากแถวหลักฐานหนึ่งแถว รวมถึงแถวเก่าที่ไม่มีฟิลด์นี้
 *
 * แถวเก่า = NOT_MEASURED เสมอ ห้ามเดาว่าเป็น OWNER/SYSTEM/RECOVERY จาก action
 * จากชื่อบริการ หรือจากเวลา — งานสืบต้นทางของแถวเก่าพิสูจน์แล้วว่าทำไม่ได้
 * (34% ของ state-changing ops เดิมไม่มีการอ้างกลับใด ๆ)
 */
export function readRequester(row: RuntimeOperationRequesterProvenance | Record<string, unknown>): RequesterReading {
  const raw = (row as RuntimeOperationRequesterProvenance).requested_by;
  if (raw === undefined || raw === null || typeof raw.identity_id !== "string" || raw.identity_id.length === 0) {
    return { measured: false, reason_code: "NOT_MEASURED", detail: "แถวนี้ไม่มีตัวตนผู้ขอ — ไม่ได้แปลว่าเป็น OWNER, SYSTEM, RECOVERY หรือ UNKNOWN" };
  }
  return {
    measured: true,
    identity: { identity_id: raw.identity_id, kind: raw.kind },
    lineage: (row as RuntimeOperationRequesterProvenance).requester_lineage ?? {},
  };
}
