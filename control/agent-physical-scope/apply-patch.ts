/**
 * Canonical mutation write: relative path + assigned scope only.
 * Reuses mcp-code-knowledge relative-path discipline; does not invent a
 * second source-write executor for Owner/canonical trees.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { recordDeniedMutation } from "./audit";
import { guardWritePath } from "./path-guard";
import type { CanonicalAgentScope } from "./types";

export interface ApplyScopedPatchInput {
  readonly task_id: string;
  readonly relative_path: string;
  readonly contents: string;
  readonly expected_base_sha?: string;
}

export type ApplyScopedPatchResult =
  | { readonly ok: true; readonly resolved_path: string; readonly bytes_written: number }
  | { readonly ok: false; readonly reason: string; readonly detail: string };

export function applyScopedPatch(
  scope: CanonicalAgentScope,
  input: ApplyScopedPatchInput,
): ApplyScopedPatchResult {
  if (input.task_id !== scope.task_id) {
    recordDeniedMutation({
      task_id: input.task_id,
      agent_execution_id: scope.agent_execution_id,
      requested_action: "SOURCE_MUTATION",
      resolved_repository: scope.repository_id,
      requested_resource: input.relative_path,
      denial_reason: "TASK_ID_SPOOFED",
      timestamp: new Date().toISOString(),
    });
    return { ok: false, reason: "TASK_ID_SPOOFED", detail: "patch task_id does not match resolved scope" };
  }
  if (input.expected_base_sha && input.expected_base_sha !== scope.base_revision) {
    recordDeniedMutation({
      task_id: scope.task_id,
      agent_execution_id: scope.agent_execution_id,
      requested_action: "SOURCE_MUTATION",
      resolved_repository: scope.repository_id,
      requested_resource: input.relative_path,
      denial_reason: "STALE_PATCH",
      timestamp: new Date().toISOString(),
    });
    return { ok: false, reason: "STALE_PATCH", detail: "expected_base_sha does not match assigned base_revision" };
  }
  const guarded = guardWritePath(scope, input.relative_path);
  if (!guarded.ok || !guarded.resolved_path) {
    recordDeniedMutation({
      task_id: scope.task_id,
      agent_execution_id: scope.agent_execution_id,
      requested_action: "SOURCE_MUTATION",
      resolved_repository: scope.repository_id,
      requested_resource: input.relative_path,
      denial_reason: guarded.reason ?? "PATH_SCOPE_DENIED",
      timestamp: new Date().toISOString(),
    });
    return { ok: false, reason: guarded.reason ?? "PATH_SCOPE_DENIED", detail: guarded.detail ?? "write denied" };
  }
  mkdirSync(dirname(guarded.resolved_path), { recursive: true });
  writeFileSync(guarded.resolved_path, input.contents, "utf8");
  return { ok: true, resolved_path: guarded.resolved_path, bytes_written: Buffer.byteLength(input.contents) };
}
