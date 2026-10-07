/**
 * หน้าที่: path-containment-aware WRITE SCOPE locking — the missing half of
 * multi-session write coordination. `./coordination.ts`'s `claimWork` already
 * gives a real cross-process claim per declared resource, but its
 * `SOURCE:<repo>:<resource>` keys are matched as EXACT STRINGS by
 * `../../execution/process-lock/`. That leaves a proven hole: agent A holding
 * the folder `control/command-router` and agent B holding the file
 * `control/command-router/router.ts` BOTH succeed, because the two key strings
 * differ. Verified by real probe before this file existed — two overlapping
 * write boundaries held simultaneously.
 *
 * This file closes that hole WITHOUT replacing anything: every actual
 * exclusivity guarantee still comes from `../../execution/process-lock/`'s
 * `O_CREAT|O_EXCL` create. All this adds is (a) normalization, (b) ancestor/
 * descendant overlap detection across currently-held scopes, and (c) a real
 * WRITE_LOCK_MAP view derived from the lock directory rather than a
 * hand-maintained list.
 *
 * THE GUARANTEE, stated precisely (do not overstate it):
 *   - Two holders can NEVER simultaneously hold overlapping scopes.
 *   - Acquire-then-verify is what makes that true: a lock file exists from the
 *     moment of acquire, BEFORE its holder verifies, so any later claimant
 *     always sees an earlier claimant's lock and rolls itself back.
 *   - A symmetric race (both acquire before either verifies) causes BOTH to
 *     roll back and report conflict. That is a false rejection, never a double
 *     hold. Callers retry. This is honest and bounded — never a spin loop.
 *
 * Input: `ClaimWriteScopeInput` / a held `WriteScopeClaim`.
 * Output: `claimWriteScope`, `releaseWriteScope`, `renewWriteScope`,
 * `listWriteLocks`, `normalizeScopePath`, `scopesOverlap`.
 * Dependency ที่อนุญาต: ../../execution/process-lock/contract.ts,
 * ./types.ts (own folder). Never imports a sibling capability's internals.
 * สิ่งที่ห้ามแตะ: never resolve a conflict by taking the lock anyway. Never
 * release a lock whose recorded holder_id is not the caller's — the underlying
 * `releaseLock` already refuses, and this file must not work around it.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { acquireLock, releaseLock, renewLock } from "../../execution/process-lock/contract";
import type {
  ClaimWriteScopeInput,
  ClaimWriteScopeResult,
  HeldWriteLock,
  ReleaseWriteScopeResult,
  WriteScopeClaim,
} from "./types";

const WSCOPE_PREFIX = "WSCOPE";

/** Same default the lock primitive uses. Derived, never configured in two places. */
function lockDir(): string {
  return join(process.cwd(), "local-runtime/process-locks");
}

/**
 * Repo-relative, POSIX-separated, no leading/trailing slash, no "." or ".."
 * segments. Returns null for anything that would escape the repository — a
 * caller must never be able to lock its way outside the boundary it declared.
 */
export function normalizeScopePath(raw: string): string | null {
  const trimmed = raw.trim().replace(/\\/g, "/");
  if (trimmed === "" || trimmed === "/") return null;
  const segments = trimmed.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.length === 0) return null;
  if (segments.some((s) => s === "..")) return null;
  return segments.join("/");
}

/**
 * True when two normalized scopes are the same path, or one contains the other.
 * Segment-boundary aware on purpose: `control/command-router` must NOT be
 * treated as containing `control/command-router-legacy`, which a naive
 * `startsWith` would get wrong.
 */
export function scopesOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  return a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function scopeLockKey(repositoryId: string, scopePath: string): string {
  return `${WSCOPE_PREFIX}:${repositoryId}:${scopePath}`;
}

/** Parses `WSCOPE:<repo>:<path>`. The path may itself contain ":" — only the first two separators are structural. */
function parseScopeLockKey(lockKey: string): { repository_id: string; scope_path: string } | null {
  if (!lockKey.startsWith(`${WSCOPE_PREFIX}:`)) return null;
  const rest = lockKey.slice(WSCOPE_PREFIX.length + 1);
  const split = rest.indexOf(":");
  if (split <= 0) return null;
  return { repository_id: rest.slice(0, split), scope_path: rest.slice(split + 1) };
}

/**
 * The real WRITE_LOCK_MAP: derived by reading the lock directory, never from a
 * maintained index. Expired leases are excluded — a lease nobody renewed is not
 * a held boundary, and reporting it as one would block recovery forever.
 */
export function listWriteLocks(): HeldWriteLock[] {
  const dir = lockDir();
  if (!existsSync(dir)) return [];
  const now = Date.now();
  const held: HeldWriteLock[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".lock.json")) continue;
    let parsed: { lock_key?: string; holder_id?: string; acquired_at?: string; lease_expires_at?: string };
    try {
      parsed = JSON.parse(readFileSync(join(dir, entry), "utf8"));
    } catch {
      continue; // a half-written or corrupt lock file is not a held boundary
    }
    if (!parsed.lock_key || !parsed.holder_id || !parsed.lease_expires_at) continue;
    const key = parseScopeLockKey(parsed.lock_key);
    if (!key) continue;
    if (Date.parse(parsed.lease_expires_at) < now) continue;
    held.push({
      lock_key: parsed.lock_key,
      holder_id: parsed.holder_id,
      repository_id: key.repository_id,
      scope_path: key.scope_path,
      acquired_at: parsed.acquired_at ?? "unknown",
      lease_expires_at: parsed.lease_expires_at,
    });
  }
  return held.sort((x, y) => x.scope_path.localeCompare(y.scope_path));
}

/**
 * Claims every declared write scope, or nothing at all. Order of operations
 * matters and is deliberate:
 *   1. normalize + reject self-overlapping requests (a caller asking for both
 *      `a` and `a/b` is a caller bug — say so instead of silently collapsing)
 *   2. acquire the exact-key lock for each scope (kernel exclusivity)
 *   3. ONLY THEN verify no other holder's held scope overlaps ours
 *   4. any failure at any step rolls back everything acquired in this call
 */
export function claimWriteScope(input: ClaimWriteScopeInput): ClaimWriteScopeResult {
  const normalized: string[] = [];
  for (const raw of input.write_scope) {
    const norm = normalizeScopePath(raw);
    if (!norm) return { ok: false, reason: `INVALID_SCOPE_PATH:${raw}` };
    normalized.push(norm);
  }
  if (normalized.length === 0) return { ok: false, reason: "EMPTY_WRITE_SCOPE" };

  const unique = [...new Set(normalized)].sort();
  for (let i = 0; i < unique.length; i += 1) {
    for (let j = i + 1; j < unique.length; j += 1) {
      if (scopesOverlap(unique[i], unique[j])) {
        return { ok: false, reason: `SELF_OVERLAPPING_SCOPE:${unique[i]}+${unique[j]}` };
      }
    }
  }

  const acquired: string[] = [];
  const rollback = (): void => {
    for (const key of acquired) releaseLock(key, input.holder_agent_id);
  };

  for (const scopePath of unique) {
    const key = scopeLockKey(input.repository_id, scopePath);
    const result = acquireLock({ lock_key: key, holder_id: input.holder_agent_id, lease_ms: input.lease_ms });
    if (result.status !== "ACQUIRED") {
      rollback();
      return { ok: false, reason: `SCOPE_HELD:${scopePath}:${result.held_by?.holder_id ?? "unknown"}` };
    }
    acquired.push(key);
  }

  // Acquire-then-verify. See the guarantee in this file's header.
  for (const other of listWriteLocks()) {
    if (other.holder_id === input.holder_agent_id) continue;
    if (other.repository_id !== input.repository_id) continue;
    for (const mine of unique) {
      if (scopesOverlap(mine, other.scope_path)) {
        rollback();
        return { ok: false, reason: `OVERLAPPING_SCOPE_HELD:${other.scope_path}:${other.holder_id}` };
      }
    }
  }

  const claim: WriteScopeClaim = {
    work_id: input.work_id,
    holder_agent_id: input.holder_agent_id,
    repository_id: input.repository_id,
    write_scope: unique,
    scope_lock_keys: acquired,
    claimed_at: new Date().toISOString(),
    lease_expires_at: new Date(Date.now() + input.lease_ms).toISOString(),
    evidence_ref: input.evidence_ref ?? null,
  };
  return { ok: true, claim };
}

/** Releases every scope lock this claim holds. Reports partial failure honestly rather than claiming a clean release. */
export function releaseWriteScope(claim: Pick<WriteScopeClaim, "holder_agent_id" | "scope_lock_keys">): ReleaseWriteScopeResult {
  const notReleased: string[] = [];
  for (const key of claim.scope_lock_keys) {
    const result = releaseLock(key, claim.holder_agent_id);
    if (result.status !== "RELEASED") notReleased.push(`${key}:${result.status}`);
  }
  return notReleased.length === 0 ? { ok: true } : { ok: false, not_released: notReleased };
}

/** Extends the caller's own held scopes. Fails closed if ANY scope is no longer the caller's — a partially-renewed claim is not a claim. */
export function renewWriteScope(claim: WriteScopeClaim, leaseMs: number): ClaimWriteScopeResult {
  for (const key of claim.scope_lock_keys) {
    const renewed = renewLock(key, claim.holder_agent_id, leaseMs);
    if (renewed.status !== "ACQUIRED") return { ok: false, reason: `NOT_HOLDER_OR_EXPIRED:${key}` };
  }
  return {
    ok: true,
    claim: { ...claim, lease_expires_at: new Date(Date.now() + leaseMs).toISOString() },
  };
}
