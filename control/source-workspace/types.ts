/**
 * หน้าที่: type contracts for real, LOCAL git worktree isolation —
 * closes the SOURCE WORKSPACE ISOLATION gap this repo genuinely lacked
 * (confirmed absent, 2026-08-21 discovery). Deliberately LOCAL-only:
 * remote GitHub branch/ref creation remains BLOCKED by two separate,
 * explicit, still-active Owner locks (`execution/run/contract.ts`'s hard
 * block on any `control/` import; `connections/github/host-runtime.ts`'s
 * permanent GET-only/PUT-only fetch restriction) — neither lifted here.
 * A local git worktree gives each Agent a real, separate working
 * directory + a real, separate local branch off the same repository,
 * without ever touching GitHub's remote API.
 *
 * Input: none (pure type definitions).
 * Output: `WorkspaceReservation`, `CreateWorkspaceInput`,
 * `CreateWorkspaceResult`, `RemoveWorkspaceResult`.
 * Dependency ที่อนุญาต: none — leaf contract.
 * สิ่งที่ห้ามแตะ: never add a field that lets a caller choose the
 * branch_ref or worktree_path directly — both are always derived
 * deterministically from `work_id` by ./resolver.ts, never agent-chosen.
 */

export interface WorkspaceReservation {
  work_id: string;
  repository_id: string;
  /** Real, derived, never agent-chosen — see ./resolver.ts's deriveBranchRef. */
  branch_ref: string;
  /** Real, absolute, local filesystem path to this Agent's own isolated git worktree. */
  worktree_path: string;
  /** The real base commit SHA this worktree's branch was created from — see governance/release-gate/'s own STALE_DEPENDENCY-style staleness discipline; a caller may re-check this against the branch's current tip before writing. */
  base_commit_sha: string;
  created_at: string;
}

export interface CreateWorkspaceInput {
  work_id: string;
  repository_id: string;
  /** The real local repository_root this worktree is created from — see software/repository-registry/'s own RepositoryRegistration.repository_root. */
  repository_root: string;
  base_branch: string;
}

export type CreateWorkspaceStatus = "CREATED" | "FAILED";

export interface CreateWorkspaceResult {
  status: CreateWorkspaceStatus;
  reason: string;
  reservation: WorkspaceReservation | null;
}

export type RemoveWorkspaceStatus = "REMOVED" | "FAILED";

export interface RemoveWorkspaceResult {
  status: RemoveWorkspaceStatus;
  reason: string;
}
