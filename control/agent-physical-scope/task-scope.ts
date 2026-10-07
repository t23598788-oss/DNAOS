/**
 * Resolve canonical agent scope from registered reservation + repository.
 * Caller-supplied paths are never authority.
 */

import { canonicalizePath, realExistingPath } from "./host-runtime";
import type { CanonicalAgentScope, PhysicalScopeRegistry, ScopeDecision, ScopeResolutionInput } from "./types";

const ENGINEERING_ACTIONS = [
  "SOURCE_DISCOVERY",
  "SOURCE_READ",
  "PATCH_PROPOSAL",
  "SOURCE_MUTATION",
] as const;

export function resolveCanonicalTaskScope(
  input: ScopeResolutionInput,
  registry: PhysicalScopeRegistry,
): ScopeDecision {
  if (!input.task_id || !input.agent_execution_id) {
    return { ok: false, reason: "TASK_SCOPE_UNRESOLVED", detail: "task_id and agent_execution_id required" };
  }
  const reservation = registry.findReservationByWorkId(input.task_id);
  if (!reservation) {
    return { ok: false, reason: "TASK_SCOPE_UNRESOLVED", detail: "no registered workspace reservation for task" };
  }
  const repo = registry.getRepository(reservation.repository_id);
  if (!repo || repo.status !== "ACTIVE") {
    return { ok: false, reason: "TASK_SCOPE_UNRESOLVED", detail: "repository is not an active registered assignment" };
  }
  if (input.claimed_repository_id && input.claimed_repository_id !== reservation.repository_id) {
    return { ok: false, reason: "REPOSITORY_ID_SPOOFED", detail: "claimed repository_id does not match reservation" };
  }

  const snapshot = reservation.purpose === "RECOVERY_CHECKOUT" || reservation.purpose === "PUBLICATION_PROOF";
  const worktree = realExistingPath(reservation.worktree_path) ?? canonicalizePath(reservation.worktree_path, "/");
  const root = realExistingPath(repo.repository_root) ?? canonicalizePath(repo.repository_root, "/");

  const scope: CanonicalAgentScope = {
    task_id: input.task_id,
    agent_execution_id: input.agent_execution_id,
    repository_id: reservation.repository_id,
    repository_root: root,
    worktree_path: worktree,
    workspace_id: reservation.reservation_id,
    base_revision: reservation.base_commit_sha,
    allowed_paths: [worktree],
    write_allowed_paths: snapshot ? [] : [worktree],
    read_allowed_paths: [worktree, root],
    allowed_actions: snapshot ? ["SOURCE_DISCOVERY", "SOURCE_READ"] : [...ENGINEERING_ACTIONS],
    allowed_runtime_ids: snapshot ? [] : [`task-${input.task_id}-runtime`],
    allowed_ports: [],
    git_scope: {
      mode: snapshot ? "NONE" : "PATCH_BRANCH",
      remote_authority: repo.source_authority,
      allowed_branch: `agent-work/${input.task_id}`,
    },
    write_allowed: !snapshot,
    safe_for_current_execution: !snapshot,
    sibling_worktrees_denied: registry.siblingWorktreePaths(worktree),
  };
  return { ok: true, scope };
}

export function requireResolvedScope(decision: ScopeDecision): CanonicalAgentScope {
  if (!decision.ok) throw new Error(decision.reason);
  return decision.scope;
}

export function interpretAgentPath(scope: CanonicalAgentScope, requested: string): string {
  if (requested.startsWith("/")) return canonicalizePath(requested, "/");
  return canonicalizePath(requested, scope.worktree_path);
}
