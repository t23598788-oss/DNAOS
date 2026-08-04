/**
 * Destructive Action Gate (owner, 2026-08-04) — built directly after a real
 * incident: `rm -f "app/admin/graph/page 2.tsx"` was run mid-session with no
 * preview, no snapshot, no ownership check, and the file was permanently
 * lost. Every rm/rm-f/rm-rf/unlink/trash/overwrite/rename-over/cleanup/dedup
 * action is meant to route through here — preview() always, execute() only
 * with a real confirmation token AND only after a real snapshot exists.
 *
 * Reuses, does not duplicate: engines/workspace/lockManager.ts (Rule 116)
 * for session-ownership checks, engines/storage/adapters/trashAdapter.ts for
 * the actual move-to-Trash (never a real rm), engines/workspace/
 * fileExistenceRegistry.ts for git/registration state.
 */
import { readFileSync, existsSync } from "fs";
import { randomUUID } from "crypto";
import { join } from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DestructiveAction, DestructiveActionPreview, DestructiveActionResult } from "@/core/shared/types";
import { getGitState, getRegistrationState, hashFile } from "./fileExistenceRegistry";
import { createSnapshot, snapshotExistsOnDisk } from "./snapshotStore";
import { moveToTrash } from "@/engines/storage/adapters/trashAdapter";
import { dispatchEvent } from "@/core/runtime/engine";

const ROOT = join(__dirname, "../..");

export async function previewDestructiveAction(
  db: SupabaseClient,
  relPath: string,
  action: DestructiveAction,
  actor: string,
  sessionId: string
): Promise<DestructiveActionPreview> {
  const absPath = join(ROOT, relPath);
  const exists = existsSync(absPath);
  const gitState = exists ? getGitState(relPath) : "UNKNOWN";
  const { state: registrationState } = exists ? getRegistrationState(relPath) : { state: "UNCLASSIFIED" as const };

  // Real session-ownership check — reuses Rule 116's lock table directly.
  const { data: activeLock } = await db.from("workspace_locks")
    .select("holder_actor, holder_session_id").eq("resource_path", relPath).is("released_at", null).maybeSingle();
  const heldByOtherActiveSession = !!activeLock && activeLock.holder_session_id !== sessionId;

  const contentHash = exists ? hashFile(absPath) : null;
  const hasSnapshot = contentHash ? snapshotExistsOnDisk(contentHash) : false;

  // Real "imported" / "route in use" check — reuses the dependency registry
  // built for Roadmap #46, never re-derives an import graph here.
  let imported = false;
  try {
    const { getDependents } = await import("@/engines/workspace/dependencyRegistry");
    imported = getDependents(relPath).length > 0;
  } catch {
    imported = false; // dependency registry unavailable — stays false, not a guess of true
  }

  // Real bug found live during this capability's own acceptance test
  // (2026-08-04): a scratch test file under .dna-os/ has git_state="ignored",
  // not "untracked" — the original check here only covered "untracked",
  // silently letting an unsnapshotted *ignored* file through with zero
  // blockers. Both states mean the same real thing: git provides no recovery
  // path, so a snapshot is the only safety net either way.
  const noGitRecovery = gitState === "untracked" || gitState === "ignored" || gitState === "UNKNOWN";

  const blockers: string[] = [];
  if (heldByOtherActiveSession) blockers.push(`resource is locked by another active session (${activeLock!.holder_session_id})`);
  if (noGitRecovery && !hasSnapshot) blockers.push(`${gitState} file with no snapshot yet — git provides no recovery path, must snapshot before any destructive action`);
  if (registrationState === "UNCLASSIFIED" || registrationState === undefined) blockers.push("purpose not yet known (registration_state=UNCLASSIFIED)");
  if (imported) blockers.push("file is imported by other real code — removing would break something real");
  if (!exists) blockers.push("target does not exist — nothing to act on");

  const riskLevel: DestructiveActionPreview["risk_level"] =
    heldByOtherActiveSession ? "critical" :
    (noGitRecovery && !hasSnapshot) ? "high" :
    imported ? "high" :
    gitState === "tracked" ? "low" : "medium";

  const preview: DestructiveActionPreview = {
    target_path: relPath,
    action,
    created_by: activeLock?.holder_actor ?? null,
    held_by_active_session: heldByOtherActiveSession,
    tracked: gitState === "tracked",
    registered: registrationState === "REGISTERED",
    imported,
    route_in_use: false, // route-usage detection not implemented yet — stated honestly, never guessed true
    has_snapshot: hasSnapshot,
    recovery_path: hasSnapshot ? `.dna-os/snapshots/${contentHash}/content` : (gitState === "tracked" ? "git" : null),
    canonical_replacement: null,
    risk_level: riskLevel,
    blockers,
  };

  dispatchEvent("FILE_DELETE_PREVIEWED", "engines/workspace/destructiveActionGate", {
    actor, session: sessionId, command: action, path: relPath, timestamp: new Date().toISOString(),
  });

  return preview;
}

export async function executeDestructiveAction(
  db: SupabaseClient,
  relPath: string,
  action: DestructiveAction,
  actor: string,
  sessionId: string,
  confirmationToken: string
): Promise<DestructiveActionResult> {
  const operationId = randomUUID();
  const preview = await previewDestructiveAction(db, relPath, action, actor, sessionId);

  const logBase = {
    operation_id: operationId, action, target_path: relPath, actor, session_id: sessionId,
    preview: preview as any,
  };

  if (!confirmationToken || confirmationToken.length < 8) {
    await db.from("destructive_action_log").insert({ ...logBase, blocked: true, block_reason: "missing or invalid confirmation_token" });
    dispatchEvent("FILE_DELETE_BLOCKED", "engines/workspace/destructiveActionGate", { actor, session: sessionId, command: action, path: relPath, timestamp: new Date().toISOString() });
    return { ok: false, blocked: true, block_reason: "missing or invalid confirmation_token", snapshot_hash: null, trash_path: null };
  }

  if (preview.blockers.length > 0) {
    await db.from("destructive_action_log").insert({ ...logBase, blocked: true, block_reason: preview.blockers.join("; "), confirmation_token: confirmationToken });
    dispatchEvent("FILE_DELETE_BLOCKED", "engines/workspace/destructiveActionGate", { actor, session: sessionId, command: action, path: relPath, timestamp: new Date().toISOString() });
    return { ok: false, blocked: true, block_reason: preview.blockers.join("; "), snapshot_hash: null, trash_path: null };
  }

  // Snapshot before mutation — always, even if one already exists (content may have changed).
  const absPath = join(ROOT, relPath);
  const content = readFileSync(absPath, "utf-8");
  const snapshot = await createSnapshot(db, relPath, content, {
    sessionId, command: action, reason: `pre-${action} snapshot`, registryReferences: [],
  });

  // The actual move — always to Trash via the existing adapter, never a real
  // rm/unlink, regardless of which destructive `action` was requested. This
  // is deliberate: Storage Intelligence's Trash Policy applies system-wide.
  const result = moveToTrash(absPath);

  await db.from("file_existence_registry").update({ recoverability: "SNAPSHOT_AVAILABLE", last_known_snapshot_hash: snapshot.content_hash, updated_at: new Date().toISOString() }).eq("path", relPath);
  await db.from("destructive_action_log").insert({
    ...logBase, blocked: false, executed: true, executed_at: new Date().toISOString(),
    confirmation_token: confirmationToken, snapshot_hash: snapshot.content_hash, trash_path: result.trash_path,
  });

  dispatchEvent("FILE_DELETED", "engines/workspace/destructiveActionGate", {
    actor, session: sessionId, command: action, path: relPath, hash: snapshot.content_hash, timestamp: result.moved_at,
  });

  return { ok: true, blocked: false, block_reason: null, snapshot_hash: snapshot.content_hash, trash_path: result.trash_path };
}
