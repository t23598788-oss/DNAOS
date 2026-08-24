/**
 * หน้าที่: type contracts for `execution/process-lock/` — a real,
 * cross-process-safe named mutex. Closes a proven, real gap: neither
 * `execution/run/executor.ts`'s `activeLockKeys` (an in-memory `Set`,
 * single-process only) nor `control/work-coordination/coordination.ts`'s
 * `load()`/mutate/`save()` (unlocked full-file read-modify-write) protect
 * against two separate OS processes racing the same resource.
 *
 * Input: none (pure type definitions).
 * Output: `LockClaim`, `AcquireLockInput`, `AcquireLockResult`,
 * `ReleaseLockResult`.
 * Dependency ที่อนุญาต: none — a leaf contract.
 * สิ่งที่ห้ามแตะ: never add a field with no real caller — `lock_key`,
 * `holder_id`, `lease_expires_at` are the only three anything downstream
 * (work-coordination, duplicate-reservation, release-gate) actually
 * reads or writes, per G-ARCH-002.
 */

export interface LockClaim {
  lock_key: string;
  holder_id: string;
  acquired_at: string;
  lease_expires_at: string;
}

export interface AcquireLockInput {
  lock_key: string;
  holder_id: string;
  lease_ms: number;
}

export type AcquireLockStatus = "ACQUIRED" | "CONFLICT";

export interface AcquireLockResult {
  status: AcquireLockStatus;
  claim: LockClaim | null;
  /** Only set on CONFLICT — the real, currently-recorded holder, for the caller to report honestly rather than guess. */
  held_by: LockClaim | null;
}

export type ReleaseLockStatus = "RELEASED" | "NOT_HOLDER" | "NOT_FOUND";

export interface ReleaseLockResult {
  status: ReleaseLockStatus;
  lock_key: string;
}
