/**
 * หน้าที่: ตัวตัดสิน authorization ของ Computer Use ตาม V2 — โหมด ON/OFF, task-scoped,
 * แยก high-risk/login/external commit ออกจาก pre-authorization, และ **requester-neutral**
 *
 * ── การตัดสินขึ้นกับ (ไม่ใช่ยี่ห้อ Agent) ──
 * operation level · target · scope · policy(ON/OFF) · task authority ที่มี
 * requester เก็บไว้เพื่อ audit/binding/accountability เท่านั้น
 *
 * ── invariant ที่บังคับ ──
 * - high-risk (L>=3) / login/credential (L4) / external commit → pre-auth ไม่ครอบ ต้อง task auth เฉพาะ
 * - ON: normal op (L<=2) auto-grant lease ที่ bounded ด้วย ttl (ON ≠ unrestricted)
 * - OFF + ไม่มี task auth → OWNER_APPROVAL_REQUIRED (ไม่ใช่ DISABLED)
 * - JOB_COMPLETED → revoke ทันทีแม้ ttl เหลือ
 *
 * Dependency ที่อนุญาต: ../computer-use-authority/contract.ts, ./policy.ts,
 *   ../computer-use-executor/executor.ts (EXECUTOR_IDENTITY).
 */

import { grantAuthority, validateAuthority, revokeAuthority, levelOf, isSecurityLevel, requiresExplicitHighRisk } from "../computer-use-authority/contract";
import type { ComputerUseOperation } from "../computer-use-authority/contract";
import { readPreauthorization } from "./policy";
import { EXECUTOR_IDENTITY } from "../computer-use-executor/executor";

export type ResolveMode = "PREAUTHORIZED" | "TASK_SCOPED" | "OWNER_APPROVAL_REQUIRED" | "SEPARATE_AUTH_REQUIRED" | "DENY";

export interface ResolveRequest {
  work_order_id: string;
  requester: string;               // ยี่ห้อ Agent — ไม่ใช้ตัดสิน ใช้ audit/binding
  operation: ComputerUseOperation;
  target: string;
  scope: readonly string[];
  ttl_seconds: number;
  is_external_commit?: boolean;
  /** ถ้า Owner grant task authorization ไว้แล้ว (โหมด OFF หรือ high-risk) */
  task_authority_id?: string;
}

export type ResolveResult =
  | { ok: true; mode: ResolveMode; authority_id: string }
  | { ok: false; mode: ResolveMode; reason_code: string; detail: string };

export interface ResolveDeps {
  readPreauthorization: typeof readPreauthorization;
  grantAuthority: typeof grantAuthority;
  validateAuthority: typeof validateAuthority;
}
const defaultDeps: ResolveDeps = { readPreauthorization, grantAuthority, validateAuthority };

export function resolveComputerUseAuthorization(req: ResolveRequest, deps: ResolveDeps = defaultDeps): ResolveResult {
  const level = levelOf(req.operation);
  const isHighRiskOrLogin = requiresExplicitHighRisk(req.operation) || isSecurityLevel(req.operation) || req.is_external_commit === true;

  // 1) high-risk / login / external commit — pre-authorization ไม่ครอบ ต้อง task auth เฉพาะเสมอ
  if (isHighRiskOrLogin) {
    if (!req.task_authority_id) return { ok: false, mode: "SEPARATE_AUTH_REQUIRED", reason_code: "HIGH_RISK_REQUIRES_SEPARATE_AUTHORIZATION", detail: `${req.operation} (L${level})${req.is_external_commit ? " + external_commit" : ""} ต้องมี task authorization เฉพาะ — Computer Use ON ไม่ครอบ` };
    const v = deps.validateAuthority({ authority_id: req.task_authority_id, requester: req.requester, executor: EXECUTOR_IDENTITY, operation: req.operation, target: req.target, scope_needed: req.scope, is_external_commit: req.is_external_commit });
    return v.ok ? { ok: true, mode: "TASK_SCOPED", authority_id: req.task_authority_id } : { ok: false, mode: "DENY", reason_code: v.reason_code, detail: v.detail };
  }

  // 2) normal op (L<=2): ถ้ามี task auth ให้ใช้ (ได้ทั้งโหมด ON/OFF)
  if (req.task_authority_id) {
    const v = deps.validateAuthority({ authority_id: req.task_authority_id, requester: req.requester, executor: EXECUTOR_IDENTITY, operation: req.operation, target: req.target, scope_needed: req.scope });
    return v.ok ? { ok: true, mode: "TASK_SCOPED", authority_id: req.task_authority_id } : { ok: false, mode: "DENY", reason_code: v.reason_code, detail: v.detail };
  }

  // 3) ไม่มี task auth → ดู pre-authorization
  const policy = deps.readPreauthorization();
  if (policy.preauthorized && level <= policy.preauth_max_level) {
    // auto-grant lease ใต้ standing pre-authorization — ยัง bounded ด้วย ttl (ON ≠ unrestricted)
    const g = deps.grantAuthority({ owner: `preauth:${policy.set_by_owner_session}:${policy.owner_identity}`, requester: req.requester, executor: EXECUTOR_IDENTITY, capability: "connections/os-ui", operations: [req.operation], target: req.target, scope: [...req.scope], ttl_seconds: req.ttl_seconds });
    return g.ok ? { ok: true, mode: "PREAUTHORIZED", authority_id: g.lease.authority_id } : { ok: false, mode: "DENY", reason_code: g.reason_code, detail: g.detail };
  }

  // 4) OFF และไม่มี task auth → ต้องขอ Owner (capability ยังใช้ได้ ไม่ใช่ disabled)
  return { ok: false, mode: "OWNER_APPROVAL_REQUIRED", reason_code: "TASK_AUTHORIZATION_REQUIRED", detail: "COMPUTER_USE_PREAUTHORIZED=OFF และไม่มี task authorization — ต้องขอ Owner approval (capability ยัง callable)" };
}

/** JOB_COMPLETED / JOB_CANCELLED → revoke ทันที แม้ ttl ยังเหลือ */
export function completeJob(authority_id: string, revoke: typeof revokeAuthority = revokeAuthority): { revoked: boolean } {
  const r = revoke(authority_id);
  return { revoked: r.ok };
}
