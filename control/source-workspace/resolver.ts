/**
 * หน้าที่: `createWorkspace()`/`removeWorkspace()` — real, LOCAL git
 * worktree isolation. Each call creates a genuinely separate working
 * directory + a genuinely separate local branch off the same real
 * repository, via real `git worktree add`, so two Agents writing files
 * concurrently on the SAME repository never touch the same checkout.
 * `branch_ref`/`worktree_path` are always derived deterministically from
 * `work_id` here — an Agent never chooses either.
 *
 * Input: `CreateWorkspaceInput` / a real `WorkspaceReservation`.
 * Output: `createWorkspace` -> `CreateWorkspaceResult`, `removeWorkspace`
 * -> `RemoveWorkspaceResult`.
 * Dependency ที่อนุญาต: ./types.ts, ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ: never let a caller supply `branch_ref`/`worktree_path`
 * directly — always derived here. Never call GitHub's remote API from
 * this file — local `git` only, matching the real, unblocked precedent
 * `connections/connection-registry/git-discovery.ts` already established.
 */

import { dirnameOf, joinPath, nowIso, resolvePath, runGit } from "./host-runtime";
import type { CreateWorkspaceInput, CreateWorkspaceResult, RemoveWorkspaceResult, WorkspaceReservation } from "./types";

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

function deriveBranchRef(workId: string): string {
  return `agent-work/${sanitize(workId)}`;
}

function deriveWorktreePath(repositoryRoot: string, repositoryId: string, workId: string): string {
  return joinPath(dirnameOf(repositoryRoot), ".dna-os-agent-worktrees", sanitize(repositoryId), sanitize(workId));
}

export async function createWorkspace(input: CreateWorkspaceInput): Promise<CreateWorkspaceResult> {
  // Absolute, always — a relative worktree_path argument would otherwise be
  // resolved by git's own subprocess relative to its cwd (repository_root),
  // not the caller's, silently landing the real worktree somewhere other
  // than the path this function returns (found and fixed via this folder's
  // own real test, see ./tests/source-workspace.test.ts test C).
  const repositoryRoot = resolvePath(input.repository_root);
  const branchRef = deriveBranchRef(input.work_id);
  const worktreePath = resolvePath(deriveWorktreePath(repositoryRoot, input.repository_id, input.work_id));

  // Capture the real base commit SHA atomically relative to branch creation — real, live-read, never guessed.
  const baseShaResult = await runGit(["rev-parse", input.base_branch], repositoryRoot);
  if (!baseShaResult.ok) {
    return { status: "FAILED", reason: `could not resolve real base_branch="${input.base_branch}": ${baseShaResult.reason}`, reservation: null };
  }
  const baseCommitSha = baseShaResult.stdout.trim();

  const createResult = await runGit(["worktree", "add", "-b", branchRef, worktreePath, baseCommitSha], repositoryRoot);
  if (!createResult.ok) {
    return { status: "FAILED", reason: `git worktree add failed: ${createResult.reason}`, reservation: null };
  }

  const reservation: WorkspaceReservation = {
    work_id: input.work_id,
    repository_id: input.repository_id,
    branch_ref: branchRef,
    worktree_path: worktreePath,
    base_commit_sha: baseCommitSha,
    created_at: nowIso(),
  };
  return { status: "CREATED", reason: "real git worktree created via git worktree add", reservation };
}

export async function removeWorkspace(reservation: Pick<WorkspaceReservation, "repository_id" | "worktree_path" | "branch_ref">, repositoryRoot: string): Promise<RemoveWorkspaceResult> {
  const absoluteRoot = resolvePath(repositoryRoot);
  const removeResult = await runGit(["worktree", "remove", reservation.worktree_path, "--force"], absoluteRoot);
  if (!removeResult.ok) {
    return { status: "FAILED", reason: `git worktree remove failed: ${removeResult.reason}` };
  }
  // Best-effort branch cleanup — the worktree removal above is the real isolation boundary; a leftover local branch ref is not itself a collision risk (branch_ref is always derived from a work_id no future real work_id will collide with).
  await runGit(["branch", "-D", reservation.branch_ref], absoluteRoot);
  return { status: "REMOVED", reason: "real git worktree removed via git worktree remove" };
}
