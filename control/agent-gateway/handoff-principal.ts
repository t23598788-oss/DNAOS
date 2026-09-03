/**
 * หน้าที่: จุดเดียวที่ตอบว่า "ผลของการรัน Agent ครั้งนี้ ถูกส่งมอบในนามของ
 * principal ที่เชื่อถือได้ตัวไหน" โดยถามจากผู้ให้ความเชื่อถือเพียงแหล่งเดียว
 *
 * TRUST_AUTHORITY = connections/agent-registry/
 * ไฟล์นี้ไม่ตั้ง principal เอง ไม่มีตาราง WorkerKind -> principal และจะไม่มี
 * WorkOrder, write-failure-bridge, scheduler และผลลัพธ์ของ Agent ก็ไม่มีสิทธิ์
 * ประกาศเช่นกัน — ทุกฝ่ายเป็นได้แค่ผู้รับค่าที่ resolve มาแล้ว
 *
 * WORKER_KIND ไม่ใช่ PRINCIPAL. `WorkerKind` คือ runtime ที่ถูก exec จริง
 * ส่วน principal คือตัวตนที่รับผิดชอบผล การผูกสองอย่างนี้เข้าด้วยกัน "ประกาศ
 * ไว้ที่ฝั่งทะเบียน" ผ่าน `AgentRegistration.execution_worker_kind` ซึ่ง
 * `registerAgent` ตรวจกับ executable จริงก่อนบันทึก — ไม่ใช่ตารางแปลงชื่อ
 *
 * แถวที่ไม่มี `execution_worker_kind` (ทุกแถวที่บันทึกก่อนฟิลด์นี้เกิด รวมถึง
 * registration ของ claude-code ที่หมายถึงโปรเซสที่กำลังคุมเครื่อง) จะไม่ถูก
 * นับเป็น execution principal เด็ดขาด ความหมายเดิมของมันไม่ถูกตีความใหม่
 *
 * กฎการเลือกไม่มีการตัดสินด้วยตัวอักษร: เจอ 0 = MISSING_MAPPING, เจอ 1 = ผูก,
 * เจอมากกว่า 1 = AMBIGUOUS_PRINCIPAL และทั้งสองกรณีที่ไม่ใช่ 1 แปลว่าปล่อยไม่ได้
 *
 * Input: `PrincipalQuery` — worker_kind + role/scope ที่ต้องการ (null = ไม่บังคับ)
 * Output: `resolveHandoffPrincipal`, `PrincipalResolution`
 * Dependency ที่อนุญาต: ../../connections/agent-registry/registry.ts
 * (listRegisteredAgents — อ่านอย่างเดียว), ../../connections/agent-registry/contract.ts (type)
 * สิ่งที่ห้ามแตะ: ห้ามใช้ "owner-console" เป็นค่าสำรอง ห้ามเพิ่ม LOCAL เข้า
 * allowlist ของ handoff และห้ามตัดสินผู้ชนะเมื่อเจอหลายรายการ
 */

import { listRegisteredAgents } from "../../connections/agent-registry/registry";
import type { AgentRegistration, AgentRole } from "../../connections/agent-registry/contract";

export interface PrincipalQuery {
  /** runtime ที่ scheduler เลือกไว้สำหรับการรันครั้งนี้ */
  readonly worker_kind: string;
  /** บทบาทที่งานนี้ต้องการ — `null` เมื่อไม่มีสัญญาใดกำหนดไว้ (ไม่กรอง) */
  readonly required_role: AgentRole | null;
  /** ขอบเขตที่ registration ต้องครอบให้ได้ — `null` เมื่อไม่บังคับ */
  readonly required_scope: string | null;
}

export interface PrincipalCandidate {
  readonly agent_id: string;
  readonly provider: string;
  readonly role: string;
  readonly workspace_scope: string;
  readonly permission_state: string;
  readonly execution_binding_evidence: string | null;
}

export type PrincipalResolution =
  | { readonly ok: true; readonly handoff_principal_id: string; readonly registration: PrincipalCandidate; readonly trusted_by: string; readonly evidence: readonly string[] }
  | { readonly ok: false; readonly reason_code: "MISSING_MAPPING" | "AMBIGUOUS_PRINCIPAL"; readonly detail: string; readonly candidates: readonly PrincipalCandidate[]; readonly evidence: readonly string[] };

function describe(a: AgentRegistration): PrincipalCandidate {
  return {
    agent_id: a.agent_id, provider: a.provider, role: a.role,
    workspace_scope: a.workspace_scope, permission_state: a.permission_state,
    execution_binding_evidence: a.execution_binding_evidence ?? null,
  };
}

/**
 * `handoff_principal_id` คือ `provider` ของ registration ไม่ใช่ id ใหม่ที่ตั้งขึ้น
 *
 * เหตุผลจากหลักฐานในโค้ด: `connections/agent-registry/session-registry.ts` จับคู่
 * handoff กับ agent ด้วย `h.agent_id.startsWith(agent.provider)` — namespace ของ
 * `HandoffRecord.agent_id` คือ provider อยู่แล้ว การตั้ง id ใหม่จะเป็นการสร้าง
 * ตัวตนที่สามซึ่งไม่มีใครรู้จัก
 */
function principalIdOf(a: AgentRegistration): string {
  return a.provider;
}

export function resolveHandoffPrincipal(query: PrincipalQuery): PrincipalResolution {
  const all = listRegisteredAgents();
  const evidence = [
    "connections/agent-registry/registry.ts#listRegisteredAgents",
    "connections/agent-registry/contract.ts#AgentRegistration.execution_worker_kind",
    `query.worker_kind=${query.worker_kind} required_role=${query.required_role ?? "(ไม่บังคับ)"} required_scope=${query.required_scope ?? "(ไม่บังคับ)"}`,
    `registrations_total=${all.length} execution_principals=${all.filter((a) => a.execution_worker_kind).length}`,
  ];

  const matches = all.filter((a) => {
    // ไม่มีการผูก runtime = ไม่ใช่ execution principal — ตัดออกก่อนเงื่อนไขอื่นเสมอ
    if (!a.execution_worker_kind) return false;
    if (a.execution_worker_kind !== query.worker_kind) return false;
    // สิทธิ์ที่ถูกปฏิเสธหรือยังไม่ถูกประเมิน ไม่ใช่ผู้รับผิดชอบผลได้
    if (a.permission_state !== "sandbox_only") return false;
    if (query.required_role && a.role !== query.required_role) return false;
    if (query.required_scope && !query.required_scope.startsWith(a.workspace_scope)) return false;
    return true;
  });

  if (matches.length === 0) {
    return {
      ok: false, reason_code: "MISSING_MAPPING",
      detail: `ไม่มี AgentRegistration ใดประกาศ execution_worker_kind="${query.worker_kind}" พร้อมสิทธิ์ที่ผ่านการประเมิน — ต้องลงทะเบียนผ่าน connections/agent-registry/#registerAgent ก่อน`,
      candidates: [], evidence,
    };
  }
  if (matches.length > 1) {
    // ไม่ตัดสินผู้ชนะ: การเลือกหนึ่งในหลายตัวตนที่เชื่อถือได้ไม่ใช่เรื่องที่โค้ดควรทำแทน
    return {
      ok: false, reason_code: "AMBIGUOUS_PRINCIPAL",
      detail: `พบ ${matches.length} registration ที่เข้าเงื่อนไขเดียวกัน — ไม่ตัดสินให้ ต้องให้ทะเบียนเหลือรายการเดียวที่รับผิดชอบ runtime นี้`,
      candidates: matches.map(describe), evidence,
    };
  }

  const chosen = matches[0];
  return {
    ok: true,
    handoff_principal_id: principalIdOf(chosen),
    registration: describe(chosen),
    trusted_by: "connections/agent-registry/ (role allowlist + sandbox scope + resolveWorker executable check)",
    evidence: [...evidence, `matched_agent_id=${chosen.agent_id}`, chosen.execution_binding_evidence ?? "(no binding evidence recorded)"],
  };
}
