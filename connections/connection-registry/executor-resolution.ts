/**
 * หน้าที่: read model ของ `executor_capability_id` — **resolve ตอนอ่าน
 * ไม่ใช่คัดลอกตอนเขียน**
 *
 * ที่มา: 2026-09-01 พบว่า GitHub มีสอง record ที่ขัดกัน
 *   ConnectionRegistration.executor_capability_id = capability-b4a67fea
 *   ConnectionDeclaration.executor_capability_id  = null
 *
 * `connections/provider-authorization/lifecycle.ts` ประกาศตัวเองเป็น
 * "the ONE owner of external-provider authorization lifecycle" และเป็นผู้เรียก
 * registerConnection/updateConnectionStatus/attachCredential เพียงรายเดียว
 * ค่านี้จึงมีเจ้าของอยู่แล้วคือ ConnectionRegistration
 *
 * ไฟล์นี้ไม่เขียนอะไรเลย และไม่แก้ record ใด — มันแค่ตอบว่า "ค่าที่ใช้จริง
 * คืออะไร และมาจากไหน" ทำให้ declaration ไม่ต้องเก็บสำเนาที่จะค้างเป็นค่าเก่า
 *
 * Dependency ที่อนุญาต: ../../contracts/connector/* (types), ./registry.ts (lookup)
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่มฟังก์ชันที่เขียนค่ากลับลง declaration เพื่อ "ให้ตรงกัน"
 * นั่นคือการสร้างสำเนาชุดที่สองซึ่งเป็นต้นตอของปัญหานี้ตั้งแต่แรก
 */

import type { ConnectionDeclaration } from "../../contracts/connector/connection-declaration";
import type { ConnectionRegistration } from "../../contracts/connector/connection";
import { lookupConnection } from "./registry";

export type ExecutorSource =
  | "ConnectionRegistration"           // เจ้าของค่าให้มา — น่าเชื่อถือที่สุด
  | "ConnectionDeclaration"            // declaration ประกาศเอง ไม่มี registration อ้างถึง
  | "NONE";                            // ไม่มีทั้งสองทาง

export interface ResolvedExecutor {
  readonly effective_executor_capability_id: string | null;
  readonly executor_source: ExecutorSource;
  /** true เมื่อ declaration ไม่ได้อ้าง registration ทั้งที่ควรอ้าง — รายงาน ไม่ใช่แก้ */
  readonly historical_declaration_incomplete: boolean;
  readonly reason: string;
}

/**
 * ฟังก์ชันบริสุทธิ์ — รับ lookup เข้ามาได้เพื่อให้ทดสอบกับข้อมูลจริงได้
 * โดยไม่ต้องเขียนอะไรลงทะเบียน
 */
export function resolveDeclarationExecutor(
  declaration: ConnectionDeclaration,
  lookup: (connection_id: string) => ConnectionRegistration | null =
    (id) => lookupConnection({ connection_id: id }),
): ResolvedExecutor {
  const ref = declaration.authorized_by_connection_id ?? null;

  if (ref) {
    const registration = lookup(ref);
    if (!registration) {
      return {
        effective_executor_capability_id: declaration.executor_capability_id ?? null,
        executor_source: declaration.executor_capability_id ? "ConnectionDeclaration" : "NONE",
        historical_declaration_incomplete: false,
        reason: `authorized_by_connection_id "${ref}" ไม่พบใน ConnectionRegistration`,
      };
    }
    const owned = registration.executor_capability_id ?? null;
    if (owned) {
      return {
        effective_executor_capability_id: owned,
        executor_source: "ConnectionRegistration",
        historical_declaration_incomplete: false,
        reason: "เจ้าของวงจรอนุมัติเป็นผู้ให้ค่านี้",
      };
    }
    return {
      effective_executor_capability_id: declaration.executor_capability_id ?? null,
      executor_source: declaration.executor_capability_id ? "ConnectionDeclaration" : "NONE",
      historical_declaration_incomplete: false,
      reason: "registration ที่อ้างถึงไม่มี executor_capability_id",
    };
  }

  // ไม่มีการอ้างอิง — declaration ยืนด้วยค่าของตัวเอง
  if (declaration.executor_capability_id) {
    return {
      effective_executor_capability_id: declaration.executor_capability_id,
      executor_source: "ConnectionDeclaration",
      historical_declaration_incomplete: false,
      reason: "declaration ประกาศค่าเอง และไม่ได้อ้าง registration ใด",
    };
  }

  // ทั้งสองทางว่าง — อาจถูกต้อง (MCP local) หรืออาจเป็น declaration ที่ลงไว้ไม่ครบ
  const outboundProvider = declaration.direction === "OUTBOUND" && declaration.credential_ref !== null;
  return {
    effective_executor_capability_id: null,
    executor_source: "NONE",
    historical_declaration_incomplete: outboundProvider,
    reason: outboundProvider
      ? "HISTORICAL_DECLARATION_INCOMPLETE — ช่องทางขาออกที่ใช้ credential แต่ไม่มีทั้ง executor และ authorization reference"
      : "ไม่ต้องมี executor ตาม semantics ของช่องทางนี้",
  };
}
