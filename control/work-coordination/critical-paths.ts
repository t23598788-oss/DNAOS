/**
 * หน้าที่: บังคับให้ต้องจอง write scope **เฉพาะ path ที่การเขียนพร้อมกันแล้ว
 * กู้คืนไม่ได้** — ไม่ใช่ทั้งเรโป และไม่ใช่การพึ่งมารยาทของ session
 *
 * เกณฑ์เดียวที่ใช้ตัดสิน และเครื่องนำไปใช้ซ้ำได้:
 *   **path หนึ่งเป็น CRITICAL เมื่อการเขียนพร้อมกันสร้างผลที่ repository นี้
 *   ย้อนกลับไม่ได้ด้วยการ revert ตัวเอง**
 *
 * เกณฑ์นี้ตัด "โฟลเดอร์ที่มีคน import เยอะ" ออกโดยตั้งใจ — จำนวนผู้ใช้ไม่ใช่
 * ความกู้ไม่ได้ `control/agent-gateway` มีผู้ import 32 รายแต่การแก้ไฟล์ผิดใน
 * นั้น revert ได้ จึงไม่ critical ส่วน `control/runtime-control` มีผู้ import 7
 * รายแต่มันสั่ง `launchctl` จริง การ revert ไฟล์ไม่ทำให้ service ที่ถูก restart
 * กลับไปไม่ถูก restart
 *
 * **ไม่ได้สร้างระบบล็อกใหม่** ทุกอย่างข้างล่างเรียก `./write-scope.ts` ตัวเดิม
 * ที่พิสูจน์แล้ว 18/18 รวมการแย่งกันจริงของ 12 OS process
 *
 * Input: repo-relative path ที่กำลังจะถูกเขียน
 * Output: `CRITICAL_SHARED_PATHS`, `classifyPath`, `requireWriteClaim`,
 * `releaseWriteClaim`, `criticalPathReport`
 * Dependency ที่อนุญาต: ./write-scope.ts, ./types.ts เท่านั้น
 * สิ่งที่ห้ามแตะ:
 * - ห้ามขยายรายการนี้เพราะ "น่าจะสำคัญ" — ทุกแถวต้องมี evidence ที่ชี้ไปยัง
 *   บรรทัดจริงที่ทำให้มันกู้ไม่ได้
 * - ห้ามให้ผู้เรียกข้ามการจองได้ — ไม่มีพารามิเตอร์ `force` และจะไม่มี
 * - ห้ามถือ claim ที่ไม่ได้ใช้ — ปล่อยเมื่อ mutation จบและ checkpoint ลงแล้ว
 * - ห้ามล็อกทั้งเรโป — `classifyPath` ตอบ ORDINARY เป็นค่าปกติ และนั่นถูกแล้ว
 */
import { claimWriteScope, listWriteLocks, normalizeScopePath, releaseWriteScope, scopesOverlap } from "./write-scope";
import type { ClaimWriteScopeResult } from "./types";

/** ทำไม path หนึ่งถึงกู้ไม่ได้ — ปิดชุด ห้ามมี "OTHER" */
export type CriticalReason =
  /** สั่งเปลี่ยนสถานะ OS นอก repository (launchctl, process launch) */
  | "HOST_MUTATION"
  /** ออก id ที่ store อื่นเอาไปอ้างต่อ — id ที่ออกไปแล้วเรียกคืนไม่ได้ */
  | "IDENTITY_ISSUANCE"
  /** ตัวมันเองคือความจริง — เขียนพร้อมกันทำให้ "แถวไหนคือปัจจุบัน" กำกวม และห้ามแก้ประวัติเพื่อซ่อม */
  | "APPEND_ONLY_AUTHORITY";

export interface CriticalSharedPath {
  path: string;
  reason: CriticalReason;
  /** บรรทัดจริงที่ทำให้มันเข้าเกณฑ์ ตรวจซ้ำได้ */
  evidence: string;
  /** ผู้บริโภคจริงใน production ที่นับได้ ไม่ใช่ประมาณ */
  consumers: number;
  /** ถ้าชนกันแล้วต้องเสียอะไรไปกู้ */
  recovery_cost: string;
  authority_owner: string;
}

/**
 * รายการที่ประกาศไว้ ทุกแถวมี evidence
 *
 * ที่ **ไม่ได้** อยู่ในนี้และเหตุผล:
 *   `control/agent-gateway` (32 ผู้ใช้)      — เขียนไฟล์ใน repo ทั้งหมด revert ได้
 *   `control/event-pipeline` (18 ผู้ใช้)     — pure classification ไม่มี durable write
 *   `permissions/execution-policy` (10 ผู้ใช้) — ไม่มี appendFileSync/writeFileSync เลย
 *   จำนวนผู้ใช้ไม่ใช่เกณฑ์ ความกู้ไม่ได้ต่างหาก
 */
export const CRITICAL_SHARED_PATHS: readonly CriticalSharedPath[] = [
  {
    path: "control/runtime-control",
    reason: "HOST_MUTATION",
    evidence: "control/runtime-control/host-runtime.ts:117 launchctlBootstrap — a real launchctl mutation of macOS service state",
    consumers: 7,
    recovery_cost: "reverting the file does not un-restart a service; a wrongly bootstrapped or booted-out LaunchAgent must be repaired by hand against the live host",
    authority_owner: "control/runtime-control",
  },
  {
    path: "control/agent-host",
    reason: "HOST_MUTATION",
    evidence: "control/agent-host — launches real agent processes under sandbox-exec",
    consumers: 10,
    recovery_cost: "a launched agent process keeps running and may write; killing it does not undo what it already did",
    authority_owner: "control/agent-host",
  },
  {
    path: "execution/run",
    reason: "HOST_MUTATION",
    evidence: "execution/run — sandbox-exec + execFileSync process execution",
    consumers: 11,
    recovery_cost: "same as agent-host: a started process's side effects outlive the file that started it",
    authority_owner: "execution/run",
  },
  {
    path: "control/runtime-adapter",
    reason: "HOST_MUTATION",
    evidence: "control/runtime-adapter — writes the SBPL sandbox profile that every launch is confined by",
    consumers: 3,
    recovery_cost: "a wrong profile widens the confinement of everything launched while it was in place; the launches cannot be re-confined retroactively",
    authority_owner: "control/runtime-adapter",
  },
  {
    path: "software/registry-database",
    reason: "IDENTITY_ISSUANCE",
    evidence: "software/registry-database/registry-writer.ts:120 mints `resource-${randomUUID()}` / `capability-${randomUUID()}`",
    consumers: 28,
    recovery_cost: "an id that other durable stores have already referenced cannot be withdrawn; a duplicate identity for one real thing is permanent ambiguity",
    authority_owner: "software/registry-database",
  },
  {
    path: "software/capability-registrar",
    reason: "IDENTITY_ISSUANCE",
    evidence: "software/capability-registrar — the registration path that turns a candidate into a canonical capability",
    consumers: 6,
    recovery_cost: "same as registry-database: registration is referenced downstream before anyone notices it was wrong",
    authority_owner: "software/capability-registrar",
  },
  {
    path: "control/work-session-state",
    reason: "APPEND_ONLY_AUTHORITY",
    evidence: "control/work-session-state/store.ts#appendCheckpoint — the current state of a work_id IS the last row, and the journal must never be rewritten",
    consumers: 12,
    recovery_cost: "two writers appending for one work_id make 'which row is current' ambiguous, and the fix may not be to edit history",
    authority_owner: "control/work-session-state",
  },
  {
    path: "control/work-coordination",
    reason: "APPEND_ONLY_AUTHORITY",
    evidence: "control/work-coordination/coordination.ts — owns work-item status and the lock directory that this very enforcement depends on",
    consumers: 6,
    recovery_cost: "corrupting the store that arbitrates writes removes the arbiter itself",
    authority_owner: "control/work-coordination",
  },
  {
    path: "credentials/registry",
    reason: "APPEND_ONLY_AUTHORITY",
    evidence: "credentials/registry/database-credential-registry.ts:96 appendFileSync of credential reference entries",
    consumers: 3,
    recovery_cost: "a wrong credential reference points real execution at the wrong account before anyone reads the file back",
    authority_owner: "credentials/registry",
  },
];

export type PathClass =
  | { kind: "CRITICAL"; declaration: CriticalSharedPath; normalized: string }
  | { kind: "ORDINARY"; normalized: string }
  | { kind: "UNCLASSIFIABLE"; reason: string };

/**
 * จำแนก path หนึ่ง
 *
 * ใช้ `scopesOverlap` ตัวเดิม จึงรู้ขอบเขต segment: `control/runtime-control-legacy`
 * **ไม่ใช่** ของ `control/runtime-control` และไม่ถูกบังคับตาม
 */
export function classifyPath(rawPath: string): PathClass {
  const normalized = normalizeScopePath(rawPath);
  if (normalized === null) return { kind: "UNCLASSIFIABLE", reason: `"${rawPath}" is not a normalizable repo-relative path` };
  for (const declaration of CRITICAL_SHARED_PATHS) {
    if (scopesOverlap(normalized, declaration.path)) return { kind: "CRITICAL", declaration, normalized };
  }
  return { kind: "ORDINARY", normalized };
}

export type WriteClaimResult =
  /** ไม่ต้องจอง — path นี้ไม่ critical เขียนได้เลย นี่คือกรณีปกติ */
  | { status: "NOT_REQUIRED"; paths: readonly string[]; detail: string }
  /** จองได้แล้ว ต้องปล่อยด้วย `releaseWriteClaim` เมื่อเสร็จ */
  | { status: "CLAIMED"; work_id: string; scopes: readonly string[]; lease_expires_at: string; lock_keys: readonly string[]; detail: string }
  /** มีคนอื่นถืออยู่ — ห้ามเขียน */
  | { status: "WRITE_BLOCKED_SCOPE_HELD"; blocked_by: string; scopes: readonly string[]; detail: string }
  | { status: "REFUSED"; detail: string };

/**
 * ประตูบังคับ: เรียกก่อนแตะ filesystem เสมอ
 *
 * ไม่มีพารามิเตอร์ `force` และจะไม่มี — ถ้ามี Agent ก็จะเลือกข้ามได้ ซึ่งทำให้
 * ทั้งเรื่องกลับไปเป็นมารยาทอีกครั้ง
 *
 * path ที่ไม่ critical คืน `NOT_REQUIRED` ทันทีโดยไม่แตะ lock directory เลย —
 * นั่นคือเหตุผลที่นโยบายนี้เลือกเฉพาะจุด: งานส่วนใหญ่ไม่จ่ายอะไรเลย
 */
export function requireWriteClaim(input: {
  work_id: string;
  holder_agent_id: string;
  repository_id: string;
  intended_write_paths: readonly string[];
  lease_ms: number;
  evidence_ref?: string | null;
}): WriteClaimResult {
  const critical: string[] = [];
  for (const raw of input.intended_write_paths) {
    const classified = classifyPath(raw);
    if (classified.kind === "UNCLASSIFIABLE") return { status: "REFUSED", detail: classified.reason };
    if (classified.kind === "CRITICAL") critical.push(classified.declaration.path);
  }
  const scopes = Array.from(new Set(critical));
  if (scopes.length === 0) {
    return { status: "NOT_REQUIRED", paths: input.intended_write_paths, detail: "no intended write touches a declared critical shared path — a claim would block others without protecting anything" };
  }

  const result: ClaimWriteScopeResult = claimWriteScope({
    work_id: input.work_id,
    holder_agent_id: input.holder_agent_id,
    repository_id: input.repository_id,
    write_scope: scopes,
    lease_ms: input.lease_ms,
    evidence_ref: input.evidence_ref ?? null,
  });
  if (result.ok === false) {
    const holder = listWriteLocks().find((lock) => scopes.some((s) => scopesOverlap(s, lock.scope_path)));
    return {
      status: "WRITE_BLOCKED_SCOPE_HELD",
      blocked_by: holder ? `${holder.holder_id} until ${holder.lease_expires_at}` : result.reason,
      scopes,
      detail: result.reason,
    };
  }
  return {
    status: "CLAIMED", work_id: input.work_id, scopes,
    lease_expires_at: result.claim.lease_expires_at,
    // The lock keys are carried back so `releaseWriteClaim` releases exactly
    // what was taken — recomputing them at release time would be a second
    // derivation of the same fact and could drift from the first.
    lock_keys: result.claim.scope_lock_keys,
    detail: `${scopes.length} critical scope(s) claimed`,
  };
}

/**
 * ปล่อยการจอง เรียกเมื่อ mutation จบ **และ** verification จบหรืองานเข้าสถานะ
 * blocked ที่ถาวรแล้ว **และ** checkpoint ลงดิสก์แล้ว
 *
 * การถือ claim ที่ไม่ได้ใช้คือการขวางคนอื่นโดยไม่ได้ปกป้องอะไร — วัดได้จริง
 * เมื่อ 2026-08-26: lock เดียวในเรโปทั้งใบถูกถือไว้บนงานที่ commit เสร็จแล้ว
 */
export function releaseWriteClaim(claim: { holder_agent_id: string; lock_keys: readonly string[] }): { ok: boolean; not_released: readonly string[] } {
  const result = releaseWriteScope({ holder_agent_id: claim.holder_agent_id, scope_lock_keys: claim.lock_keys });
  return result.ok === true ? { ok: true, not_released: [] } : { ok: false, not_released: result.not_released };
}

/** สรุปสถานะการบังคับใช้ ณ ตอนนี้ — ใช้โดย proof และโดยใครก็ตามที่ถามว่า "ตอนนี้ใครถืออะไร" */
export function criticalPathReport(): { declared: number; held: number; unclaimed_critical_writes: readonly string[]; rows: readonly { path: string; reason: CriticalReason; held_by: string | null }[] } {
  const locks = listWriteLocks();
  const rows = CRITICAL_SHARED_PATHS.map((declaration) => {
    const lock = locks.find((l) => scopesOverlap(declaration.path, l.scope_path));
    return { path: declaration.path, reason: declaration.reason, held_by: lock ? lock.holder_id : null };
  });
  return {
    declared: CRITICAL_SHARED_PATHS.length,
    held: rows.filter((r) => r.held_by !== null).length,
    unclaimed_critical_writes: rows.filter((r) => r.held_by === null).map((r) => r.path),
    rows,
  };
}
