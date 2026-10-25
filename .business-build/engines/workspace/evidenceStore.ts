/**
 * Dev Loop Evidence Store (owner, 2026-08-05) — logs every file add/change/
 * unlink the watcher sees: path, content hash, and a real `git diff --stat`
 * summary (never fabricated — empty string if git has nothing to compare,
 * e.g. a brand new untracked file).
 */
import { execSync } from "child_process";
import { join } from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchEvent } from "@/core/runtime/engine";
import { hashFile } from "./fileExistenceRegistry";

const ROOT = join(__dirname, "../..");

export function diffSummary(relPath: string): string {
  try {
    return execSync(`git diff --stat -- "${relPath}"`, { cwd: ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
}

export async function logEvidenceEvent(
  db: SupabaseClient,
  sessionId: string,
  relPath: string,
  eventType: "add" | "change" | "unlink"
): Promise<{ id: string; content_hash: string | null }> {
  const absPath = join(ROOT, relPath);
  let contentHash: string | null = null;
  if (eventType !== "unlink") {
    try {
      contentHash = hashFile(absPath);
    } catch {
      contentHash = null; // file vanished between the watcher event and this read — real, not fabricated
    }
  }

  const row = {
    session_id: sessionId,
    path: relPath,
    event_type: eventType,
    content_hash: contentHash,
    diff_summary: eventType === "unlink" ? "" : diffSummary(relPath),
  };

  const { data, error } = await db.from("dev_loop_evidence_events").insert(row).select("id, content_hash").single();
  if (error || !data) throw Object.assign(new Error("failed to log evidence event"), { code: "EVIDENCE_LOG_FAILED", context: { error } });

  dispatchEvent("DEV_LOOP_EVIDENCE_LOGGED", "engines/workspace/evidenceStore", { session: sessionId, path: relPath, eventType, hash: contentHash });
  return data as { id: string; content_hash: string | null };
}
