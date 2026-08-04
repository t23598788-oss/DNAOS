/**
 * Dev Loop Session (owner, 2026-08-05) — one row per local watcher run.
 * Every evidence event / check result / registry proposal in the dev-loop
 * pipeline is tied to a session so the Deploy Gate and dashboard always know
 * who owns a change, what it was for, and whether it's still open.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchEvent } from "@/core/runtime/engine";

export interface DevLoopSession {
  id: string;
  owner: string | null;
  goal: string | null;
  file_scope: string[];
  status: "open" | "closed";
  started_at: string;
  closed_at: string | null;
}

export async function startSession(
  db: SupabaseClient,
  opts: { owner?: string; goal?: string; fileScope?: string[] } = {}
): Promise<DevLoopSession> {
  const id = `watch-${new Date().toISOString()}`;
  const { data, error } = await db
    .from("dev_loop_sessions")
    .insert({
      id,
      owner: opts.owner ?? null,
      goal: opts.goal ?? null,
      file_scope: opts.fileScope ?? [],
    })
    .select()
    .single();

  if (error || !data) throw Object.assign(new Error("failed to start dev-loop session"), { code: "SESSION_START_FAILED", context: { error } });

  dispatchEvent("DEV_LOOP_SESSION_STARTED", "engines/workspace/devLoopSession", { session: id, owner: opts.owner ?? null, goal: opts.goal ?? null });
  return data as DevLoopSession;
}

export async function closeSession(db: SupabaseClient, sessionId: string): Promise<void> {
  await db.from("dev_loop_sessions").update({ status: "closed", closed_at: new Date().toISOString() }).eq("id", sessionId);
  dispatchEvent("DEV_LOOP_SESSION_CLOSED", "engines/workspace/devLoopSession", { session: sessionId });
}
