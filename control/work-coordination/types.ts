/**
 * หน้าที่: type contracts for `control/work-coordination/`'s WRITE SCOPE layer
 * (`./write-scope.ts`). Kept separate from the interfaces declared inline in
 * `./coordination.ts` on purpose — those describe the pre-existing work queue
 * and its atomic work claim, which are unchanged and still exported as-is. This
 * file adds only what path-containment-aware boundary locking needs.
 *
 * Input: none (pure type definitions).
 * Output: `WriteScopeClaim`, `ClaimWriteScopeInput`, `ClaimWriteScopeResult`,
 * `ReleaseWriteScopeResult`, `HeldWriteLock`.
 * Dependency ที่อนุญาต: none — a leaf contract.
 * สิ่งที่ห้ามแตะ: never add a field with no real reader (G-ARCH-002). Every
 * field below is read by `./write-scope.ts` or by the WRITE_LOCK_MAP view.
 */

/** One currently-held write boundary, as DERIVED from the lock directory — never from a maintained index. */
export interface HeldWriteLock {
  lock_key: string;
  holder_id: string;
  repository_id: string;
  /** Repo-relative, POSIX-separated, normalized. */
  scope_path: string;
  acquired_at: string;
  lease_expires_at: string;
}

export interface ClaimWriteScopeInput {
  work_id: string;
  holder_agent_id: string;
  repository_id: string;
  /** The real files/folders this work order will WRITE. Declaring a folder claims everything beneath it. */
  write_scope: readonly string[];
  lease_ms: number;
  /** Optional pointer to where this work order's evidence will land, so a held lock is traceable to its proof. */
  evidence_ref?: string | null;
}

export interface WriteScopeClaim {
  work_id: string;
  holder_agent_id: string;
  repository_id: string;
  write_scope: readonly string[];
  scope_lock_keys: readonly string[];
  claimed_at: string;
  lease_expires_at: string;
  evidence_ref: string | null;
}

export type ClaimWriteScopeResult =
  | { ok: true; claim: WriteScopeClaim }
  /** Real, specific reason — `SCOPE_HELD:`, `OVERLAPPING_SCOPE_HELD:`, `SELF_OVERLAPPING_SCOPE:`, `INVALID_SCOPE_PATH:`, `EMPTY_WRITE_SCOPE`. Never a guess. */
  | { ok: false; reason: string };

export type ReleaseWriteScopeResult = { ok: true } | { ok: false; not_released: readonly string[] };
