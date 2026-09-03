/**
 * หน้าที่: read-model สถานะของ Computer-Use backend — ให้ consumer (UI/agent อื่น)
 * "อ่าน" ได้ ไฟล์นี้ไม่สร้าง UI ไม่มี side effect เป็น contract/state อย่างเดียว
 *
 * consumer ที่รับผิดชอบ Settings/Docs เอาไปแสดงเอง — ไฟล์นี้แค่ประกาศ shape + คืนค่าจาก store
 *
 * Output: readComputerUseStatus(): ComputerUseStatus
 * Dependency ที่อนุญาต: ./store.ts, ../owner-authentication/authenticate (validate only),
 *   node:fs/path.
 * สิ่งที่ห้ามแตะ: ห้ามคืน secret; ห้ามสร้าง UI/consumer.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listLeases } from "./store";
import { levelOf, requiresExplicitHighRisk, isSecurityLevel, OPERATION_LEVEL } from "./levels";
import type { RiskLevel } from "./levels";
import type { ComputerUseOperation } from "./types";

export interface LeaseSummary {
  authority_id: string;
  owner: string;
  requester: string;
  executor: string;
  operations: readonly ComputerUseOperation[];
  max_level: number;
  target: string;
  scope: readonly string[];
  state: string;
  issued_at: string;
  expires_at: string;
  high_risk_explicit: boolean;
  external_commit_authorized: boolean;
}

/**
 * รายการ operation ที่ระบบรองรับ พร้อมระดับความเสี่ยง — **เชิงบรรยายเท่านั้น**
 *
 * ทุกค่าคำนวณจากนิยาม canonical ใน ./levels.ts ณ เวลาที่อ่าน ไม่มีตารางที่สอง:
 *   operation  = คีย์ของ OPERATION_LEVEL เอง
 *   level      = levelOf(op)
 *   high_risk  = requiresExplicitHighRisk(op)
 *   security   = isSecurityLevel(op)
 *
 * แคตตาล็อกนี้ **ไม่มอบอำนาจใด ๆ** การตัดสินสิทธิ์ยังอยู่ที่ ./lease.ts เท่านั้น
 * (validateAuthority) การอ่าน status ไม่ทำให้ operation ใดถูกอนุญาต
 */
export interface OperationCatalogEntry {
  operation: ComputerUseOperation;
  level: RiskLevel;
  /** LEVEL>=3 ต้องมี lease.high_risk_explicit — ไม่สืบทอดจาก lease ของ click/type */
  high_risk_explicit_required: boolean;
  /** LEVEL>=4 (login/credential/provider_authorization) ต้องมีอำนาจเฉพาะเสมอ */
  security_level: boolean;
}

export interface ComputerUseStatus {
  generated_at: string;
  /**
   * แคตตาล็อก operation ที่รองรับ — derive จาก OPERATION_LEVEL โดยตรง
   * ผู้บริโภค (เช่นหน้า Settings) ต้องอ่านรายการจากที่นี่ ห้ามทำสำเนาไว้ฝั่งตัวเอง
   */
  operation_catalog: readonly OperationCatalogEntry[];
  /**
   * external commit **ไม่ใช่คุณสมบัติของ operation** — มันเป็นธงที่ผู้เรียกประกาศ
   * ต่อคำขอ (`is_external_commit`) แล้ว lease ต้องมี `external_commit_authorized`
   * จึงจะผ่าน (./lease.ts) จึงไม่มี field `external_commit_required` รายตัว
   * เพราะการเดามันจากชื่อ operation คือการสร้างกฎสิทธิ์ชุดที่สอง
   */
  external_commit_policy: {
    declared_per_request: true;
    request_flag: "is_external_commit";
    lease_flag: "external_commit_authorized";
    denial_reason_code: "EXTERNAL_COMMIT_NOT_AUTHORIZED";
    inherits_from_ui_control: false;
  };
  executor: {
    identity: string;
    launch_agent_template: string;
    launch_agent_installed: boolean;   // ตรวจแบบ read-only ว่ามี plist ใน ~/Library/LaunchAgents
    execution_owner: string;
  };
  owner_authentication: {
    active_sessions: number;
    sessions: readonly { session_id: string; owner_identity: string; authenticated_via: string; state: string; expires_at: string }[];
  };
  active_leases: readonly LeaseSummary[];
  revoked_or_expired_leases: number;
  evidence: {
    lease_store: string;
    execution_evidence_store: string;
    owner_session_store: string;
  };
}

function readOwnerSessions(): ComputerUseStatus["owner_authentication"] {
  const file = join(process.cwd(), "control/owner-authentication/data/owner-sessions.jsonl");
  if (!existsSync(file)) return { active_sessions: 0, sessions: [] };
  const latest = new Map<string, { session_id: string; owner_identity: string; authenticated_via: string; state: string; expires_at: string; revoked_at: string | null }>();
  for (const l of readFileSync(file, "utf-8").split("\n")) if (l.trim()) { const r = JSON.parse(l); latest.set(r.session_id, r); }
  const now = Date.now();
  const rows = [...latest.values()].map((s) => ({
    session_id: s.session_id, owner_identity: s.owner_identity, authenticated_via: s.authenticated_via,
    state: s.revoked_at ? "REVOKED" : (now > new Date(s.expires_at).getTime() ? "EXPIRED" : s.state),
    expires_at: s.expires_at,
  }));
  return { active_sessions: rows.filter((r) => r.state === "ACTIVE").length, sessions: rows };
}

export function readComputerUseStatus(now: () => Date = () => new Date()): ComputerUseStatus {
  const nowMs = now().getTime();
  const leases = listLeases();
  // แคตตาล็อกสร้างจากคีย์ของ OPERATION_LEVEL เอง — operation ที่ไม่มีในนิยาม canonical
  // จึงไม่มีทางโผล่ที่นี่ และไม่ต้องมีรายการที่สองให้ดูแลให้ตรงกัน
  const operation_catalog = (Object.keys(OPERATION_LEVEL) as ComputerUseOperation[])
    .map((operation) => ({
      operation,
      level: levelOf(operation),
      high_risk_explicit_required: requiresExplicitHighRisk(operation),
      security_level: isSecurityLevel(operation),
    }))
    .sort((a, b) => (a.level - b.level) || a.operation.localeCompare(b.operation));
  const active: LeaseSummary[] = [];
  let inactive = 0;
  for (const l of leases) {
    const isActive = l.state === "GRANTED" && l.revoked_at === null && nowMs <= new Date(l.expires_at).getTime();
    if (!isActive) { inactive += 1; continue; }
    active.push({
      authority_id: l.authority_id, owner: l.owner, requester: l.requester, executor: l.executor,
      operations: l.operations, max_level: Math.max(0, ...l.operations.map(levelOf)),
      target: l.target, scope: l.scope, state: l.state, issued_at: l.issued_at, expires_at: l.expires_at,
      high_risk_explicit: l.high_risk_explicit, external_commit_authorized: l.external_commit_authorized,
    });
  }
  const laPath = `${process.env.HOME ?? ""}/Library/LaunchAgents/com.dnaos.computer-use-executor.plist`;
  return {
    operation_catalog,
    external_commit_policy: {
      declared_per_request: true,
      request_flag: "is_external_commit",
      lease_flag: "external_commit_authorized",
      denial_reason_code: "EXTERNAL_COMMIT_NOT_AUTHORIZED",
      inherits_from_ui_control: false,
    },
    generated_at: now().toISOString(),
    executor: {
      identity: "control/computer-use-executor",
      launch_agent_template: "control/computer-use-executor/com.dnaos.computer-use-executor.plist.template",
      launch_agent_installed: existsSync(laPath),
      execution_owner: "control/computer-use-executor",
    },
    owner_authentication: readOwnerSessions(),
    active_leases: active,
    revoked_or_expired_leases: inactive,
    evidence: {
      lease_store: "control/computer-use-authority/data/authority-leases.jsonl",
      execution_evidence_store: "control/computer-use-executor/data/execution-evidence.jsonl",
      owner_session_store: "control/owner-authentication/data/owner-sessions.jsonl",
    },
  };
}
