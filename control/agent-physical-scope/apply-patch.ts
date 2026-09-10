/**
 * Canonical mutation write: relative path + assigned scope only.
 * Physical-scope is the assignment check; it does not replace write-gate
 * for DNA OS main-source promotion.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { recordDeniedMutation } from "./audit";
import { guardWritePath } from "./path-guard";
import type { CanonicalAgentScope } from "./types";

export interface ApplyScopedPatchInput {
  readonly task_id: string;
  readonly relative_path: string;
  readonly contents: string;
  readonly expected_base_sha: string;
}

export type ApplyScopedPatchResult =
  | { readonly ok: true; readonly resolved_path: string; readonly bytes_written: number }
  | { readonly ok: false; readonly reason: string; readonly detail: string };

function liveWorktreeSha(worktree_path: string): string | null {
  try {
    const out = execFileSync("git", ["-C", worktree_path, "rev-parse", "HEAD"], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

function deny(
  scope: CanonicalAgentScope,
  input: ApplyScopedPatchInput,
  reason: string,
  detail: string,
): ApplyScopedPatchResult {
  recordDeniedMutation({
    task_id: input.task_id,
    agent_execution_id: scope.agent_execution_id,
    requested_action: "SOURCE_MUTATION",
    resolved_repository: scope.repository_id,
    requested_resource: input.relative_path,
    denial_reason: reason === "TASK_ID_SPOOFED" || reason === "STALE_PATCH" || reason === "PATH_SCOPE_DENIED" || reason === "SNAPSHOT_MUTATION_DENIED" || reason === "TASK_SCOPE_UNRESOLVED"
      ? reason
      : "PATH_SCOPE_DENIED",
    timestamp: new Date().toISOString(),
  });
  return { ok: false, reason, detail };
}

export function applyScopedPatch(
  scope: CanonicalAgentScope,
  input: ApplyScopedPatchInput,
): ApplyScopedPatchResult {
  if (input.task_id !== scope.task_id) {
    return deny(scope, input, "TASK_ID_SPOOFED", "patch task_id does not match resolved scope");
  }
  if (!existsSync(scope.worktree_path)) {
    return deny(scope, input, "TASK_SCOPE_UNRESOLVED", "assigned worktree is not present");
  }
  if (!input.expected_base_sha) {
    return deny(scope, input, "STALE_PATCH", "expected_base_sha is required");
  }
  if (input.expected_base_sha !== scope.base_revision) {
    return deny(scope, input, "STALE_PATCH", "expected_base_sha does not match assigned base_revision");
  }
  const live = liveWorktreeSha(scope.worktree_path);
  if (live && live !== input.expected_base_sha) {
    return deny(scope, input, "STALE_PATCH", "worktree HEAD does not match expected_base_sha");
  }
  const guarded = guardWritePath(scope, input.relative_path);
  if (!guarded.ok || !guarded.resolved_path) {
    return deny(scope, input, guarded.reason ?? "PATH_SCOPE_DENIED", guarded.detail ?? "write denied");
  }
  mkdirSync(dirname(guarded.resolved_path), { recursive: true });
  writeFileSync(guarded.resolved_path, input.contents, "utf8");
  return { ok: true, resolved_path: guarded.resolved_path, bytes_written: Buffer.byteLength(input.contents) };
}
