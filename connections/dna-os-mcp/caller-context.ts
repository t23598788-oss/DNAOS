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
 * Dependency ที่อนุญาต: ./export-policy.ts, ../../control/owner-authentication/,
 * ../../control/agent-physical-scope/types.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้ามถือว่า stdio เป็นช่องทางภายในโดยอัตโนมัติ
 * - ห้ามอ่าน caller identity จาก body หรือ arguments ของ tool
 * - ห้ามบันทึกค่า session id ลง log
 */

import { validateOwnerSession } from "../../control/owner-authentication/contract";
import type { CallerContext } from "./export-policy";
import { verifyInternalCredential, INTERNAL_CREDENTIAL_HEADER } from "./internal-identity";
import { AGENT_EXECUTION_ID_ENV, AGENT_TASK_ID_ENV } from "../../control/agent-physical-scope/types";

/** header เดียวที่มีความหมาย — ค่าของมันเป็นตัวชี้ ไม่ใช่หลักฐาน */
export const OWNER_SESSION_HEADER = "x-dna-os-owner-session";
export const AGENT_TASK_HEADER = "x-dna-os-agent-task-id";
export const AGENT_EXECUTION_HEADER = "x-dna-os-agent-execution-id";

export interface IncomingHeaders { readonly [key: string]: string | string[] | undefined }

function headerValue(headers: IncomingHeaders, name: string): string | null {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function withAgentIdentity(base: CallerContext, taskId: string | null, executionId: string | null): CallerContext {
  return {
    ...base,
    work_id: taskId ?? base.work_id,
    agent_execution_id: executionId ?? base.agent_execution_id,
  };
}

function verifiedSessionFrom(headers: IncomingHeaders | null): string | null {
  if (headers === null) return null;
  const value = headerValue(headers, OWNER_SESSION_HEADER);
  if (value === null) return null;
  const v = validateOwnerSession(value) as { ok: boolean };
  return v.ok ? value : null;
}

/**
 * ช่องทาง HTTP — ไม่มี session ที่ตรวจผ่าน = ผู้เรียกภายนอกที่ยังไม่ยืนยันตัวตน
 * ไม่ว่าจะมาจาก 127.0.0.1 หรือที่ไหนก็ตาม
 */
export function callerContextFromHttp(headers: IncomingHeaders): CallerContext {
  const taskId = headerValue(headers, AGENT_TASK_HEADER);
  const executionId = headerValue(headers, AGENT_EXECUTION_HEADER);
  const session = verifiedSessionFrom(headers);
  if (session !== null) {
    return withAgentIdentity(
      { caller: "OWNER_VERIFIED", caller_class: "OWNER_VERIFIED", owner_session_id: session, channel: "INTERNAL" },
      taskId,
      executionId,
    );
  }
  const presented = headerValue(headers, INTERNAL_CREDENTIAL_HEADER);
  if (verifyInternalCredential(presented).ok) {
    return withAgentIdentity(
      { caller: "INTERNAL_DNA_OS", caller_class: "INTERNAL_DNA_OS", owner_session_id: null, channel: "EXTERNAL" },
      taskId,
      executionId,
    );
  }
  return withAgentIdentity(
    { caller: "UNAUTHENTICATED", caller_class: "UNAUTHENTICATED", owner_session_id: null, channel: "EXTERNAL" },
    taskId,
    executionId,
  );
}

/**
 * ช่องทาง stdio — พิสูจน์ที่มาของโปรเซสไม่ได้ด้วยกลไกที่มีอยู่ตอนนี้
 *
 * launchd ตั้ง environment ให้ได้ แต่สิ่งใดก็ตามที่รันด้วยสิทธิ์ของเจ้าของก็ตั้ง
 * ค่าเดียวกันได้ จึงไม่ใช่หลักฐาน ตามข้อ 7 ผลลัพธ์คือ UNAUTHENTICATED
 * ถ้าจะให้เป็น INTERNAL ต้องส่ง session ที่ยืนยันแล้วมาเหมือนกัน
 *
 * DNA_OS_AGENT_* จาก process.env ของ child ที่ launchAgent stamp ไว้ถูกคัดลอก
 * เข้า CallerContext ที่นี่ ครั้งเดียว — canInvoke ต้องไม่อ่าน daemon env เอง
 */
export function callerContextFromStdio(sessionId?: string | null, env: Readonly<Record<string, string | undefined>> = process.env): CallerContext {
  const taskId = env[AGENT_TASK_ID_ENV]?.trim() || null;
  const executionId = env[AGENT_EXECUTION_ID_ENV]?.trim() || null;
  if (typeof sessionId === "string" && sessionId !== "") {
    const v = validateOwnerSession(sessionId) as { ok: boolean };
    if (v.ok) {
      return withAgentIdentity(
        { caller: "OWNER_VERIFIED", owner_session_id: sessionId, channel: "INTERNAL" },
        taskId,
        executionId,
      );
    }
  }
  return withAgentIdentity(
    { caller: "UNAUTHENTICATED", owner_session_id: null, channel: "EXTERNAL" },
    taskId,
    executionId,
  );
}

export const UNAUTHENTICATED_CONTEXT: CallerContext =
  { caller: "UNAUTHENTICATED", caller_class: "UNAUTHENTICATED", owner_session_id: null, channel: "EXTERNAL" };
