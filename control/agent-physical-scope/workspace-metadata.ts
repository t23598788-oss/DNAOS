/**
 * Workspace metadata for hook defense-in-depth. Not primary authority.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CanonicalAgentScope } from "./types";

export interface WorkspaceScopeMetadata {
  readonly task_id: string;
  readonly repository_id: string;
  readonly workspace_id: string;
  readonly base_sha: string;
}

export function metadataPath(worktree_path: string): string {
  return join(worktree_path, ".dna-os-agent-scope.json");
}

export function writeWorkspaceMetadata(scope: CanonicalAgentScope): void {
  const payload: WorkspaceScopeMetadata = {
    task_id: scope.task_id,
    repository_id: scope.repository_id,
    workspace_id: scope.workspace_id,
    base_sha: scope.base_revision,
  };
  writeFileSync(metadataPath(scope.worktree_path), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function readWorkspaceMetadata(worktree_path: string): WorkspaceScopeMetadata | null {
  const file = metadataPath(worktree_path);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as WorkspaceScopeMetadata;
  } catch {
    return null;
  }
}

export function verifyHookContext(scope: CanonicalAgentScope, git_root: string, remote: string | null): { ok: true } | { ok: false; reason: string } {
  const meta = readWorkspaceMetadata(git_root);
  if (!meta) return { ok: false, reason: "TASK_SCOPE_UNRESOLVED" };
  if (meta.task_id !== scope.task_id) return { ok: false, reason: "TASK_ID_SPOOFED" };
  if (meta.repository_id !== scope.repository_id) return { ok: false, reason: "REPOSITORY_ID_SPOOFED" };
  if (meta.base_sha !== scope.base_revision) return { ok: false, reason: "STALE_PATCH" };
  if (remote && scope.git_scope.remote_authority && remote !== scope.git_scope.remote_authority) {
    return { ok: false, reason: "GIT_SCOPE_DENIED" };
  }
  return { ok: true };
}
