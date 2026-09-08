/**
 * Replacement-machine execution workspace reconstruction from registered
 * remote source already present in the local git object store / fetch.
 * Does not invent a second repository.
 */

import { createWorkspace } from "./resolver";
import { registerReservationWorkspace } from "./local-registry";
import { runGit } from "./host-runtime";

export async function recreateWorkspaceFromRegisteredSource(input: {
  readonly work_id: string;
  readonly repository_id: string;
  readonly repository_root: string;
  readonly commit_sha: string;
  readonly base_branch: string;
}): Promise<
  | { readonly ok: true; readonly workspace_id: string; readonly worktree_path: string; readonly commit_sha: string }
  | { readonly ok: false; readonly detail: string }
> {
  if (!/^[0-9a-f]{40}$/i.test(input.commit_sha)) {
    return { ok: false, detail: "commit_sha must be a 40-character git object" };
  }
  const present = await runGit(["cat-file", "-e", `${input.commit_sha}^{commit}`], input.repository_root);
  if (!present.ok) {
    return { ok: false, detail: `registered repository does not contain commit ${input.commit_sha}` };
  }
  const created = await createWorkspace({
    work_id: input.work_id,
    repository_id: input.repository_id,
    repository_root: input.repository_root,
    base_branch: input.base_branch,
    purpose: "RECOVERY_CHECKOUT",
  });
  if (created.status !== "CREATED" || !created.reservation) {
    return { ok: false, detail: created.reason };
  }
  const checkout = await runGit(["checkout", "--detach", input.commit_sha], created.reservation.worktree_path);
  if (!checkout.ok) {
    return { ok: false, detail: `could not checkout registered remote SHA: ${checkout.reason}` };
  }
  const row = registerReservationWorkspace({
    reservation: created.reservation,
    repository_root: input.repository_root,
    purpose: "RECOVERY_CHECKOUT",
  });
  return {
    ok: true,
    workspace_id: row.workspace_id,
    worktree_path: created.reservation.worktree_path,
    commit_sha: input.commit_sha.toLowerCase(),
  };
}
