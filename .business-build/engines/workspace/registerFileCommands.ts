/**
 * Registers file.* commands as real Runtime-callable commands (same
 * mechanism as engines/workspace/registerCommands.ts / engines/business.ts —
 * registerCommand() side effect on import). Implements the achievable subset
 * for this pass: inspect/snapshot/delete.preview/delete.execute/restore/
 * find_duplicates. file.reconstruct/file.compare/file.find_owner are
 * declared in registry/command-registry.json as NOT YET IMPLEMENTED — see
 * roadmap, not silently omitted.
 */
import { registerCommand } from "@/core/runtime/engine";
import { supabaseAdmin } from "@/services/supabase/queries";
import { registerFile, findCanonicalSibling, classifyDuplicate, getGitState, getRegistrationState, hashFile } from "./fileExistenceRegistry";
import { createSnapshot, restoreSnapshot } from "./snapshotStore";
import { previewDestructiveAction, executeDestructiveAction } from "./destructiveActionGate";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "../..");

function actorFrom(args: Record<string, unknown>): string {
  return String(args.actor ?? "runtime");
}
function sessionFrom(args: Record<string, unknown>): string {
  return String(args.sessionId ?? "unknown-session");
}

registerCommand("file.inspect", async (args) => {
  const relPath = String(args.path ?? "");
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) return { exists: false, path: relPath };
  const gitState = getGitState(relPath);
  const { state, owningModule } = getRegistrationState(relPath);
  const sibling = findCanonicalSibling(relPath);
  const dup = state === "REGISTERED" ? "ACTIVE" : classifyDuplicate(relPath, sibling);
  return { exists: true, path: relPath, git_state: gitState, registration_state: state, owning_module: owningModule, canonical_sibling: sibling, duplicate_class: dup, content_hash: hashFile(abs) };
});

registerCommand("file.snapshot", async (args) => {
  const relPath = String(args.path ?? "");
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) throw Object.assign(new Error("file not found"), { code: "FILE_NOT_FOUND" });
  const content = readFileSync(abs, "utf-8");
  const snapshot = await createSnapshot(supabaseAdmin(), relPath, content, { sessionId: sessionFrom(args), command: "file.snapshot", reason: String(args.reason ?? "manual snapshot") });
  await registerFile(supabaseAdmin(), relPath, { owningSession: sessionFrom(args) }).catch(() => {});
  return snapshot;
});

registerCommand("file.delete.preview", async (args) =>
  previewDestructiveAction(supabaseAdmin(), String(args.path ?? ""), (args.action as any) ?? "trash", actorFrom(args), sessionFrom(args)));

registerCommand("file.delete.execute", async (args) =>
  executeDestructiveAction(supabaseAdmin(), String(args.path ?? ""), (args.action as any) ?? "trash", actorFrom(args), sessionFrom(args), String(args.confirmationToken ?? "")));

registerCommand("file.restore", async (args) => restoreSnapshot(supabaseAdmin(), String(args.contentHash ?? "")));

registerCommand("file.find_duplicates", async (args) => {
  const relPath = String(args.path ?? "");
  const sibling = findCanonicalSibling(relPath);
  if (!sibling) return { path: relPath, sibling: null, classification: "UNKNOWN" };
  return { path: relPath, sibling, classification: classifyDuplicate(relPath, sibling) };
});

export const FILE_COMMANDS_REGISTERED = true;
