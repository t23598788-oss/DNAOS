/**
 * Workspace Lock Manager — real atomic locking via a Postgres partial unique
 * index (workspace_locks_active_resource_idx: unique on resource_path WHERE
 * released_at IS NULL). This is what registry/LOCK_MANAGER.json's JSON
 * ledger could never provide: two concurrent acquireLock() calls for the
 * same path race at the database, not in application code — only one INSERT
 * can win, guaranteed by Postgres itself.
 *
 * Built after a real incident (2026-08-04): a concurrent AI session
 * overwrote core/shared/types.ts and 4 registry files mid-session with zero
 * conflict detection. engines/workspace/registryWriter.ts is the intended
 * caller for any registry/*.json or core/shared/types.ts edit going forward.
 */
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkspaceLock, WorkspaceResourceType, LockAcquireResult } from "@/core/shared/types";

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes — long enough for a real edit, short enough that a crashed session doesn't deadlock the resource forever

export async function acquireLock(
  db: SupabaseClient,
  resourceType: WorkspaceResourceType,
  resourcePath: string,
  actor: string,
  sessionId: string,
  ttlMs: number = DEFAULT_TTL_MS,
  _internalRetriesLeft = 3
): Promise<LockAcquireResult> {
  // Expire stale locks first — a crashed/forgotten session must not hold a
  // resource hostage forever. This is a real cleanup step, not a bypass:
  // only locks past their own declared expires_at are touched.
  await db.from("workspace_locks")
    .update({ released_at: new Date().toISOString() })
    .lt("expires_at", new Date().toISOString())
    .is("released_at", null);

  const operationId = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  const { data, error } = await db.from("workspace_locks").insert({
    resource_type: resourceType,
    resource_path: resourcePath,
    holder_actor: actor,
    holder_session_id: sessionId,
    operation_id: operationId,
    expires_at: expiresAt.toISOString(),
  }).select().single();

  if (!error && data) {
    return { acquired: true, lock: rowToLock(data), conflict: null };
  }

  // Unique-violation (Postgres code 23505) means someone else holds it right now.
  const { data: existing } = await db.from("workspace_locks")
    .select("*").eq("resource_path", resourcePath).is("released_at", null).maybeSingle();

  if (existing) {
    await db.from("workspace_lock_conflicts").insert({
      resource_path: resourcePath,
      requested_by_actor: actor,
      requested_by_session_id: sessionId,
      held_by_actor: existing.holder_actor,
      held_by_session_id: existing.holder_session_id,
      resolution: "rejected",
    });
    return {
      acquired: false,
      lock: null,
      conflict: { held_by_actor: existing.holder_actor, held_by_session_id: existing.holder_session_id, expires_at: existing.expires_at },
    };
  }

  // Real race, confirmed live during HCG Phase 2.5 stabilization testing
  // (5-way concurrent acquireLock on one resource: 2 of 5 calls hit this
  // branch and previously threw, silently losing the caller's operation
  // instead of retrying — counter test expected 5, got 3). The INSERT lost
  // the unique-violation race against a holder that released the lock
  // BEFORE this follow-up SELECT ran, so "no existing holder found" here
  // does not mean an unknown error — it means the resource is free again
  // right now. Retry the insert immediately (bounded, not unbounded) rather
  // than surfacing a spurious failure for a resource that is actually free.
  if (_internalRetriesLeft > 0) {
    return acquireLock(db, resourceType, resourcePath, actor, sessionId, ttlMs, _internalRetriesLeft - 1);
  }

  throw Object.assign(new Error("lock acquisition failed with no existing holder found after internal retries"), { code: "WORKSPACE_LOCK_UNKNOWN_ERROR", context: { error } });
}

export async function releaseLock(db: SupabaseClient, lockId: string): Promise<void> {
  await db.from("workspace_locks").update({ released_at: new Date().toISOString() }).eq("id", lockId).is("released_at", null);
}

/** Retry with backoff — real queue behavior, not a busy-loop. */
export async function acquireLockWithRetry(
  db: SupabaseClient,
  resourceType: WorkspaceResourceType,
  resourcePath: string,
  actor: string,
  sessionId: string,
  opts: { maxAttempts?: number; backoffMs?: number; ttlMs?: number } = {}
): Promise<LockAcquireResult> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const backoffMs = opts.backoffMs ?? 500;
  let last: LockAcquireResult | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    last = await acquireLock(db, resourceType, resourcePath, actor, sessionId, opts.ttlMs);
    if (last.acquired) return last;
    await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)));
  }
  return last!;
}

/** Runs fn only while holding the lock; always releases, even on throw. */
export async function withLock<T>(
  db: SupabaseClient,
  resourceType: WorkspaceResourceType,
  resourcePath: string,
  actor: string,
  sessionId: string,
  fn: () => Promise<T>
): Promise<T> {
  const result = await acquireLockWithRetry(db, resourceType, resourcePath, actor, sessionId);
  if (!result.acquired || !result.lock) {
    throw Object.assign(new Error(`resource locked by ${result.conflict?.held_by_actor} (session ${result.conflict?.held_by_session_id})`), {
      code: "WORKSPACE_LOCK_CONFLICT",
      context: { resourcePath, conflict: result.conflict },
    });
  }
  try {
    return await fn();
  } finally {
    await releaseLock(db, result.lock.id);
  }
}

function rowToLock(row: any): WorkspaceLock {
  return {
    id: row.id,
    resource_type: row.resource_type,
    resource_path: row.resource_path,
    holder_actor: row.holder_actor,
    holder_session_id: row.holder_session_id,
    operation_id: row.operation_id,
    acquired_at: row.acquired_at,
    expires_at: row.expires_at,
    released_at: row.released_at,
  };
}
