/**
 * Dev Loop Session (owner, 2026-08-05) — one row per local watcher run.
 * Every evidence event / check result / registry proposal in the dev-loop
 * pipeline is tied to a session so the Deploy Gate and dashboard always know
 * who owns a change, what it was for, and whether it's still open.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchEvent } from "@/core/runtime/engine";
import { withRegistryLock } from "@/engines/workspace/registryWriter";

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

/**
 * Core chain wiring (P6): an owner-verified approval is a release event, so it
 * must land in the release ledger (registry/CHANGELOG.json) through the existing
 * safe writer (registryWriter.withRegistryLock, Rule 116) — the same lock path
 * every other registry mutation uses. change_id is continued from the ledger's
 * own highest DNA-nnnnnn value; nothing is renumbered or guessed. Failures are
 * returned, never thrown, so an approval that already executed is not re-run.
 */
export async function recordApprovedProposal(
  db: SupabaseClient,
  opts: {
    ownerIdentity: string;
    summary: string;
    files?: string[];
    sessionId?: string | null;
    proposalId?: string | null;
    command?: string | null;
  }
): Promise<{ ok: true; change_id: string } | { ok: false; error: string }> {
  try {
    const written = await withRegistryLock<Record<string, unknown>[]>(
      db,
      "registry/CHANGELOG.json",
      opts.ownerIdentity,
      opts.sessionId ?? "owner-approval",
      (current) => {
        const entries = Array.isArray(current) ? (current as Record<string, unknown>[]) : [];
        const highest = entries.reduce((max, entry) => {
          const match = /^DNA-(\d+)$/.exec(String(entry.change_id ?? ""));
          return match ? Math.max(max, Number(match[1])) : max;
        }, 0);
        entries.push({
          change_id: `DNA-${String(highest + 1).padStart(6, "0")}`,
          agent: "owner-verification",
          session_id: opts.sessionId ?? null,
          proposal_id: opts.proposalId ?? null,
          command: opts.command ?? null,
          date: new Date().toISOString().slice(0, 10),
          owner_identity: opts.ownerIdentity,
          files: opts.files ?? [],
          summary: opts.summary,
        });
        return entries;
      }
    );
    const last = written[written.length - 1];
    const changeId = String(last?.change_id ?? "");
    dispatchEvent("DEV_LOOP_CHANGE_RECORDED", "engines/workspace/devLoopSession", {
      change_id: changeId,
      proposal_id: opts.proposalId ?? null,
      owner_identity: opts.ownerIdentity,
    });
    return { ok: true, change_id: changeId };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
