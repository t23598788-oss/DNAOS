import { createServerSupabase } from "@/services/supabase/server";
import { supabaseAdmin } from "@/services/supabase/queries";

// TASK-033 (registry/CHANGELOG.json DNA-000056 FAIL 1, fixed DNA-000067): thin
// Gateway wrapper so core/auth/session.ts (80 real callers) can resolve the
// live Supabase Auth session without importing services/ directly, which
// dependency-graph.json does not allow for the core layer. gateway is already
// allowed to import services (registry/dependency-graph.json allowed_imports.gateway)
// and is the architecturally sanctioned "one door" per CLAUDE.md — core -> gateway
// is the intended pattern, core -> services bypassing it is not. Read-only,
// no writes — this wrapper does not participate in the confirmed-write flow
// (gateway/actions.ts's preview -> token -> execute), it exists purely to keep
// the layer boundary honest for a read core already needed.
export async function getServerSupabaseClient() {
  return createServerSupabase();
}

// ── M031: Workspace screen lock (mobile-style PIN) ─────────────────────────
// One row per auth user — the PIN hash (scrypt), the failed-attempt counter
// and any temporary lockout live HERE, server-side only. The table has RLS on
// with NO policy, so an end-user token can never read/touch these rows via
// PostgREST: the screen-lock gate stays a server gate, not a browser screen.
// (Read failure = fail-open with a loud console error: the real session is
// still mandatory before any of these calls happen, middleware.ts sees to it.)
export interface WorkspaceScreenLockRow {
  pinHash: string;
  failedAttempts: number;
  lockedUntil: string | null;
}

export async function getWorkspaceScreenLock(userId: string): Promise<WorkspaceScreenLockRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("workspace_screen_locks")
    .select("pin_hash, failed_attempts, locked_until")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[M031] workspace_screen_locks read failed:", error.message);
    return null;
  }
  return data
    ? { pinHash: data.pin_hash, failedAttempts: data.failed_attempts ?? 0, lockedUntil: data.locked_until ?? null }
    : null;
}

export async function hasWorkspaceScreenLock(userId: string): Promise<boolean> {
  return (await getWorkspaceScreenLock(userId)) !== null;
}

export async function upsertWorkspaceScreenLock(userId: string, pinHash: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("workspace_screen_locks")
    .upsert({ user_id: userId, pin_hash: pinHash, failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() });
  if (error) throw new Error(`[M031] workspace_screen_locks upsert failed: ${error.message}`);
}

export async function recordScreenLockFailure(userId: string, failedAttempts: number, lockedUntil: string | null): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("workspace_screen_locks")
    .update({ failed_attempts: failedAttempts, locked_until: lockedUntil, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) throw new Error(`[M031] workspace_screen_locks failure-update failed: ${error.message}`);
}
