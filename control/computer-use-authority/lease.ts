/**
 * หน้าที่: เจ้าของวงจร grant / validate / revoke ของ permission lease ควบคุมคอมพิวเตอร์
 *
 * ── กฎเหล็กที่บังคับตรงนี้ ──
 * 1. `executor` ต้องเป็น DNA OS component เท่านั้น — ปฏิเสธทันทีถ้าเป็น claude/codex/agent
 *    (authority การควบคุมเครื่องเป็นของ DNA OS ไม่ใช่โมเดล)
 * 2. FAIL CLOSED — ไม่มี lease / หมดอายุ / ถูกเพิกถอน / requester ไม่ตรง / executor ไม่ตรง /
 *    operation ไม่อยู่ในใบ / target ไม่ตรง / scope ไม่พอ → ปฏิเสธ ไม่มีทางผ่านแบบคลุมเครือ
 * 3. `target` ห้ามเป็น "*" (global) — ต้องผูกแคบ
 *
 * Input: GrantAuthorityInput, ValidateAuthorityInput, authority_id.
 * Output: grantAuthority, validateAuthority, revokeAuthority.
 * Dependency ที่อนุญาต: ./types.ts, ./store.ts.
 * สิ่งที่ห้ามแตะ: ห้ามให้ requester เป็น executor โดยปริยาย ห้ามออก global lease.
 */

import type {
  ComputerUseAuthorityLease,
  GrantAuthorityInput,
  GrantAuthorityResult,
  RevokeAuthorityResult,
  ValidateAuthorityInput,
  ValidateAuthorityResult,
} from "./types";
import { findLease as defaultFind, upsertLease as defaultUpsert } from "./store";
import { levelOf, requiresExplicitHighRisk } from "./levels";

/**
 * ผู้ที่ **ห้าม** เป็น executor — โมเดล/agent ทุกตัว authority เป็นของ DNA OS
 * ตรวจแบบ substring กันการเลี่ยงด้วยการเติมคำ
 */
const FORBIDDEN_EXECUTOR_SUBSTRINGS = ["claude", "codex", "agent", "gpt", "model", "llm", "anthropic", "openai"];

/** executor ที่ถูกต้องต้องประกาศตัวว่าเป็น DNA OS component */
function isDnaOsExecutor(executor: string): boolean {
  const e = executor.trim().toLowerCase();
  if (e.length === 0) return false;
  if (FORBIDDEN_EXECUTOR_SUBSTRINGS.some((s) => e.includes(s))) return false;
  // ต้องขึ้นต้นด้วย dna-os หรือชี้ไปโฟลเดอร์ capability จริงของ repo
  return e.startsWith("dna-os") || e.startsWith("control/") || e.startsWith("connections/") || e.startsWith("software/");
}

export interface LeaseDeps {
  findLease: typeof defaultFind;
  upsertLease: typeof defaultUpsert;
  now: () => Date;
  newId: () => string;
}

const defaultDeps: LeaseDeps = {
  findLease: defaultFind,
  upsertLease: defaultUpsert,
  now: () => new Date(),
  newId: () => `authority-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
};

export function grantAuthority(input: GrantAuthorityInput, deps: LeaseDeps = defaultDeps): GrantAuthorityResult {
  if (!isDnaOsExecutor(input.executor)) {
    return { ok: false, reason_code: "EXECUTOR_NOT_DNA_OS", detail: `executor "${input.executor}" ต้องเป็น DNA OS component — authority การควบคุมเครื่องมอบให้ Claude/Agent ไม่ได้` };
  }
  if (input.target.trim() === "*" || input.target.trim().length === 0) {
    return { ok: false, reason_code: "TARGET_TOO_BROAD", detail: "target ต้องผูกแคบ ห้ามเป็น global/ว่าง" };
  }
  if (input.operations.length === 0) {
    return { ok: false, reason_code: "NO_OPERATIONS", detail: "ต้องระบุ operation อย่างน้อยหนึ่งอย่าง" };
  }
  if (!Number.isFinite(input.ttl_seconds) || input.ttl_seconds <= 0 || input.ttl_seconds > 86_400) {
    return { ok: false, reason_code: "INVALID_TTL", detail: "ttl_seconds ต้องอยู่ใน (0, 86400]" };
  }
  // LEVEL>=3 (login/credential/…) ต้องตั้ง high_risk_explicit โดยชัดแจ้ง — กัน bundle ปนกับ click/type
  const highRiskOps = input.operations.filter((op) => requiresExplicitHighRisk(op));
  if (highRiskOps.length > 0 && input.high_risk_explicit !== true) {
    return { ok: false, reason_code: "HIGH_RISK_REQUIRES_EXPLICIT_AUTHORITY", detail: `operations ระดับสูง [${highRiskOps.join(",")}] (L${highRiskOps.map(levelOf).join(",")}) ต้องตั้ง high_risk_explicit=true` };
  }
  const issued = deps.now();
  const lease: ComputerUseAuthorityLease = {
    authority_id: deps.newId(),
    owner: input.owner,
    requester: input.requester,
    executor: input.executor,
    capability: input.capability,
    operations: [...input.operations],
    target: input.target,
    scope: [...input.scope],
    issued_at: issued.toISOString(),
    expires_at: new Date(issued.getTime() + input.ttl_seconds * 1000).toISOString(),
    state: "GRANTED",
    revoked_at: null,
    evidence_reference: input.evidence_reference ?? null,
    high_risk_explicit: input.high_risk_explicit === true,
    external_commit_authorized: input.external_commit_authorized === true,
  };
  deps.upsertLease(lease);
  return { ok: true, lease };
}

/** ตรวจสิทธิ์ก่อน execute — fail closed ทุกทาง */
export function validateAuthority(input: ValidateAuthorityInput, deps: LeaseDeps = defaultDeps): ValidateAuthorityResult {
  const lease = deps.findLease(input.authority_id);
  if (!lease) return { ok: false, reason_code: "AUTHORITY_NOT_FOUND", detail: input.authority_id };
  if (lease.state === "REVOKED" || lease.revoked_at !== null) return { ok: false, reason_code: "AUTHORITY_REVOKED", detail: lease.revoked_at ?? "revoked" };
  if (deps.now().getTime() > new Date(lease.expires_at).getTime()) return { ok: false, reason_code: "AUTHORITY_EXPIRED", detail: `expired_at ${lease.expires_at}` };
  if (!isDnaOsExecutor(input.executor)) return { ok: false, reason_code: "EXECUTOR_NOT_DNA_OS", detail: input.executor };
  if (lease.executor !== input.executor) return { ok: false, reason_code: "EXECUTOR_MISMATCH", detail: `lease.executor=${lease.executor} != ${input.executor}` };
  if (lease.requester !== input.requester) return { ok: false, reason_code: "REQUESTER_MISMATCH", detail: `lease.requester=${lease.requester} != ${input.requester}` };
  if (!lease.operations.includes(input.operation)) return { ok: false, reason_code: "OPERATION_OUT_OF_SCOPE", detail: `${input.operation} not in [${lease.operations.join(",")}]` };
  if (lease.target !== input.target) return { ok: false, reason_code: "TARGET_MISMATCH", detail: `lease.target=${lease.target} != ${input.target}` };
  const need = input.scope_needed ?? [];
  const missing = need.filter((s) => !lease.scope.includes(s));
  if (missing.length > 0) return { ok: false, reason_code: "SCOPE_INSUFFICIENT", detail: `missing scope: ${missing.join(",")}` };
  // LEVEL>=3 ต้องมี high_risk_explicit บน lease (ไม่สืบทอด)
  if (requiresExplicitHighRisk(input.operation) && lease.high_risk_explicit !== true) {
    return { ok: false, reason_code: "HIGH_RISK_NOT_EXPLICITLY_AUTHORIZED", detail: `${input.operation} (L${levelOf(input.operation)}) ต้องมี lease.high_risk_explicit` };
  }
  // external commit (submit/publish/…) ต้องมีอำนาจแยกโดยเฉพาะ — ไม่ได้จากสิทธิ์ UI
  if (input.is_external_commit === true && lease.external_commit_authorized !== true) {
    return { ok: false, reason_code: "EXTERNAL_COMMIT_NOT_AUTHORIZED", detail: "external commit (submit/publish/delete/payment) ต้องมี lease.external_commit_authorized — สร้าง authority request ใหม่" };
  }
  return { ok: true, lease };
}

export function revokeAuthority(authority_id: string, deps: LeaseDeps = defaultDeps): RevokeAuthorityResult {
  const lease = deps.findLease(authority_id);
  if (!lease) return { ok: false, reason_code: "AUTHORITY_NOT_FOUND" };
  const revoked: ComputerUseAuthorityLease = { ...lease, state: "REVOKED", revoked_at: deps.now().toISOString() };
  deps.upsertLease(revoked);
  return { ok: true, lease: revoked };
}

export { isDnaOsExecutor };
