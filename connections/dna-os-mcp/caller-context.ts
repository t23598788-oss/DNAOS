/**
 * หน้าที่: หาว่า "ใครกำลังเรียก" จากขอบเขต transport จริง — ไม่ใช่จากสิ่งที่
 * ผู้เรียกพูดถึงตัวเอง
 *
 * Owner, 2026-09-05 ข้อ 2: ห้ามเชื่อ caller string จาก tool arguments, ห้ามเชื่อ
 * owner_session_id ที่โมเดลส่งมา, ห้ามเชื่อชื่อ requester จาก prompt
 * และข้อ 7: "รันบนเครื่องเดียวกัน" หรือ "user = tam" ไม่ใช่การยืนยันตัวตนเจ้าของ
 *
 * สิ่งเดียวที่เชื่อได้คือ session id ที่ตรวจผ่าน validateOwnerSession ซึ่งบังคับ
 * ว่า authenticated_via ต้องขึ้นต้นด้วย "human-verification" อยู่แล้ว ค่าที่มากับ
 * header จึงไม่ใช่หลักฐาน — มันเป็นแค่ตัวชี้ไปยังสโตร์ที่เป็นผู้ตัดสิน
 * header ที่ถูกปลอมจะตกที่ validateOwnerSession เสมอ
 *
 * Input: HTTP request headers หรือไม่มีเลย (stdio)
 * Output: CallerContext ที่ ./export-policy.ts ใช้ตัดสิน
 * Dependency ที่อนุญาต: ./export-policy.ts, ../../control/owner-authentication/
 * สิ่งที่ห้ามแตะ:
 * - ห้ามถือว่า stdio เป็นช่องทางภายในโดยอัตโนมัติ
 * - ห้ามอ่าน caller identity จาก body หรือ arguments ของ tool
 * - ห้ามบันทึกค่า session id ลง log
 */

import { validateOwnerSession } from "../../control/owner-authentication/contract";
import type { CallerContext } from "./export-policy";
import { verifyInternalCredential, INTERNAL_CREDENTIAL_HEADER } from "./internal-identity";

/** header เดียวที่มีความหมาย — ค่าของมันเป็นตัวชี้ ไม่ใช่หลักฐาน */
export const OWNER_SESSION_HEADER = "x-dna-os-owner-session";

export interface IncomingHeaders { readonly [key: string]: string | string[] | undefined }

function verifiedSessionFrom(headers: IncomingHeaders | null): string | null {
  if (headers === null) return null;
  const raw = headers[OWNER_SESSION_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value === "") return null;
  const v = validateOwnerSession(value) as { ok: boolean };
  return v.ok ? value : null;
}

/**
 * ช่องทาง HTTP — ไม่มี session ที่ตรวจผ่าน = ผู้เรียกภายนอกที่ยังไม่ยืนยันตัวตน
 * ไม่ว่าจะมาจาก 127.0.0.1 หรือที่ไหนก็ตาม
 */
export function callerContextFromHttp(headers: IncomingHeaders): CallerContext {
  // สิทธิ์ของเจ้าของมาก่อนเสมอ — ถ้ามี session ที่ยืนยันแล้วก็ไม่ต้องดูกุญแจเครื่อง
  const session = verifiedSessionFrom(headers);
  if (session !== null) {
    return { caller: "OWNER_VERIFIED", caller_class: "OWNER_VERIFIED", owner_session_id: session, channel: "INTERNAL" };
  }
  /**
   * กุญแจของช่องทางภายใน — ให้ "ตัวตนของเครื่อง" เท่านั้น ไม่ใช่สิทธิ์ของเจ้าของ
   * ค่าที่ส่งมาไม่ถูกบันทึกที่ใด และการเทียบทำแบบเวลาคงที่ใน ./internal-identity.ts
   */
  const rawInternal = headers[INTERNAL_CREDENTIAL_HEADER];
  const presented = Array.isArray(rawInternal) ? rawInternal[0] : rawInternal;
  if (verifyInternalCredential(presented ?? null).ok) {
    return { caller: "INTERNAL_DNA_OS", caller_class: "INTERNAL_DNA_OS", owner_session_id: null, channel: "EXTERNAL" };
  }
  return { caller: "UNAUTHENTICATED", caller_class: "UNAUTHENTICATED", owner_session_id: null, channel: "EXTERNAL" };
}

/**
 * ช่องทาง stdio — พิสูจน์ที่มาของโปรเซสไม่ได้ด้วยกลไกที่มีอยู่ตอนนี้
 *
 * launchd ตั้ง environment ให้ได้ แต่สิ่งใดก็ตามที่รันด้วยสิทธิ์ของเจ้าของก็ตั้ง
 * ค่าเดียวกันได้ จึงไม่ใช่หลักฐาน ตามข้อ 7 ผลลัพธ์คือ UNAUTHENTICATED
 * ถ้าจะให้เป็น INTERNAL ต้องส่ง session ที่ยืนยันแล้วมาเหมือนกัน
 */
export function callerContextFromStdio(sessionId?: string | null): CallerContext {
  if (typeof sessionId === "string" && sessionId !== "") {
    const v = validateOwnerSession(sessionId) as { ok: boolean };
    if (v.ok) return { caller: "OWNER_VERIFIED", owner_session_id: sessionId, channel: "INTERNAL" };
  }
  return { caller: "UNAUTHENTICATED", owner_session_id: null, channel: "EXTERNAL" };
}

export const UNAUTHENTICATED_CONTEXT: CallerContext =
  { caller: "UNAUTHENTICATED", caller_class: "UNAUTHENTICATED", owner_session_id: null, channel: "EXTERNAL" };
