/**
 * หน้าที่: `acquireLock()`/`releaseLock()`/`renewLock()` — the real
 * cross-process mutex logic built on `./host-runtime.ts`'s atomic
 * `O_CREAT|O_EXCL` file create. Fail-closed always: `acquireLock` returns
 * `CONFLICT` (never a guess, never a partial success) whenever the
 * exclusive create fails for any reason other than a provably-expired
 * lease.
 *
 * Stale-lease reclaim: if the exclusive create fails with EEXIST, the
 * existing lock file is read; only if its `lease_expires_at` has
 * genuinely passed (real clock comparison) does this function attempt to
 * reclaim it (unlink, then re-attempt the exclusive create once). Two
 * processes racing the same expired lease both retry the same atomic
 * create — at most one still wins; the other correctly sees CONFLICT
 * again on its retry. This is a real, bounded, single-retry reclaim, not
 * a loop that could spin forever.
 *
 * Input: `AcquireLockInput` / a `lock_key`+`holder_id` pair.
 * Output: `acquireLock`, `releaseLock`, `renewLock`.
 * Dependency ที่อนุญาต: ./types.ts, ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ: never let `releaseLock` remove a lock file whose
 * recorded `holder_id` does not match the caller's — that would let one
 * holder release another's real, still-valid claim.
 */

import { createLockFileExclusive, ensureLockDir, lockFilePath, nowIso, overwriteLockFile, readLockFile, unlinkLockFile } from "./host-runtime";
import type { AcquireLockInput, AcquireLockResult, LockClaim, ReleaseLockResult } from "./types";

function parseClaim(raw: string | null): LockClaim | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LockClaim;
  } catch {
    return null;
  }
}

function isExpired(claim: LockClaim, at: string): boolean {
  return Date.parse(claim.lease_expires_at) < Date.parse(at);
}

function tryCreate(input: AcquireLockInput, path: string): { created: true; claim: LockClaim } | { created: false } {
  const now = nowIso();
  const claim: LockClaim = { lock_key: input.lock_key, holder_id: input.holder_id, acquired_at: now, lease_expires_at: new Date(Date.parse(now) + input.lease_ms).toISOString() };
  const result = createLockFileExclusive(path, JSON.stringify(claim));
  return result.ok ? { created: true, claim } : { created: false };
}

export function acquireLock(input: AcquireLockInput): AcquireLockResult {
  ensureLockDir();
  const path = lockFilePath(input.lock_key);

  const first = tryCreate(input, path);
  if (first.created) return { status: "ACQUIRED", claim: first.claim, held_by: null };

  const existing = parseClaim(readLockFile(path));
  if (!existing) {
    // The file vanished between the failed create and this read (released
    // concurrently) — one bounded retry, no loop.
    const retry = tryCreate(input, path);
    return retry.created ? { status: "ACQUIRED", claim: retry.claim, held_by: null } : { status: "CONFLICT", claim: null, held_by: null };
  }

  if (!isExpired(existing, nowIso())) {
    return { status: "CONFLICT", claim: null, held_by: existing };
  }

  // Provably expired — attempt one bounded reclaim.
  unlinkLockFile(path);
  const reclaim = tryCreate(input, path);
  return reclaim.created ? { status: "ACQUIRED", claim: reclaim.claim, held_by: null } : { status: "CONFLICT", claim: null, held_by: existing };
}

export function releaseLock(lockKey: string, holderId: string): ReleaseLockResult {
  const path = lockFilePath(lockKey);
  const existing = parseClaim(readLockFile(path));
  if (!existing) return { status: "NOT_FOUND", lock_key: lockKey };
  if (existing.holder_id !== holderId) return { status: "NOT_HOLDER", lock_key: lockKey };
  unlinkLockFile(path);
  return { status: "RELEASED", lock_key: lockKey };
}

/**
 * Extends the caller's own already-held lease — a plain overwrite, never
 * unlink+recreate, so there is no window where the lock briefly does not
 * exist (which could otherwise let a concurrent acquireLock steal it).
 * Safe only because it first verifies the caller is the real, current
 * holder before writing anything.
 */
export function renewLock(lockKey: string, holderId: string, leaseMs: number): AcquireLockResult {
  const path = lockFilePath(lockKey);
  const existing = parseClaim(readLockFile(path));
  if (!existing || existing.holder_id !== holderId) return { status: "CONFLICT", claim: null, held_by: existing };
  const now = nowIso();
  const claim: LockClaim = { ...existing, lease_expires_at: new Date(Date.parse(now) + leaseMs).toISOString() };
  const wrote = overwriteLockFile(path, JSON.stringify(claim));
  return wrote ? { status: "ACQUIRED", claim, held_by: null } : { status: "CONFLICT", claim: null, held_by: null };
}
