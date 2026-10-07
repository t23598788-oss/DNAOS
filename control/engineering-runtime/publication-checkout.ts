/**
 * หน้าที่: DNA OS-controlled clean publication checkout. Creates a git
 * worktree at the registered default-branch tip so commit/publish can
 * run without reading or discarding unrelated files in the authoritative
 * working tree.
 *
 * Input: repository_id of the registered source.
 * Output: proof checkout path + base SHA, or a fail-closed reason.
 * Dependency ที่อนุญาต: node:child_process, node:crypto, node:fs, node:path,
 * ./repository.ts, ../../software/repository-registry/contract.ts,
 * ../agent-gateway/contract.ts.
 * สิ่งที่ห้ามแตะ: never stash/reset/clean the authoritative checkout.
 * never create a second GitHub repository. never change registry
 * repository_root.
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { saveEvidence } from "../agent-gateway/contract";
import { getRepository } from "../../software/repository-registry/contract";
import { registerPublicationCheckoutWorkspace, listLocalWorkspaces, transitionLocalWorkspace } from "../source-workspace/contract";
import { gitCommonDir, resolveCodingRepository } from "./repository";
import { resolveGithubDestination } from "./github-destination";
import { corroborateAuthenticatedGithubRemote } from "./remote-corroboration";
import type { EngineeringGateReason } from "./types";

export interface PublicationProofCheckout {
  readonly repository_id: string;
  readonly authoritative_root: string;
  readonly proof_root: string;
  readonly base_commit_sha: string;
  readonly default_branch: string;
  readonly evidence_id: string;
}

export type PublicationCheckoutResult =
  | { readonly ok: true; readonly checkout: PublicationProofCheckout }
  | { readonly ok: false; readonly reason_code: EngineeringGateReason; readonly detail: string };

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 30_000 }).trim();
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

export function createPublicationProofCheckout(input: {
  readonly repository_id: string;
  readonly authoritative_root: string;
  readonly at_commit_sha?: string;
  readonly work_id?: string;
}): PublicationCheckoutResult {
  const identity = resolveCodingRepository(input.authoritative_root);
  if (!identity.ok) return { ok: false, reason_code: identity.reason_code, detail: identity.detail };
  if (identity.repository.repository_id !== input.repository_id) {
    return { ok: false, reason_code: "REPOSITORY_IDENTITY_MISMATCH", detail: "proof checkout must be derived from the registered repository_id" };
  }
  const registered = getRepository(input.repository_id);
  if (!registered || registered.status !== "ACTIVE") {
    return { ok: false, reason_code: "REPOSITORY_IDENTITY_MISSING", detail: "repository_id is not an ACTIVE registry row" };
  }
  const common = gitCommonDir(input.authoritative_root);
  const registeredCommon = gitCommonDir(registered.repository_root);
  if (!common || !registeredCommon || common !== registeredCommon) {
    return { ok: false, reason_code: "REPOSITORY_IDENTITY_MISMATCH", detail: "authoritative checkout is not the registered git common directory" };
  }

  let base: string;
  try {
    if (input.at_commit_sha && /^[0-9a-f]{40}$/i.test(input.at_commit_sha)) {
      git(registered.repository_root, ["cat-file", "-e", `${input.at_commit_sha}^{commit}`]);
      base = input.at_commit_sha.toLowerCase();
    } else {
      base = git(registered.repository_root, ["rev-parse", "--verify", registered.default_branch]);
    }
  } catch (error) {
    return { ok: false, reason_code: "BASE_REVISION_MISMATCH", detail: `could not read publication base revision: ${error instanceof Error ? error.message : String(error)}` };
  }

  const proofRoot = resolve(
    join(dirname(registered.repository_root), ".dna-os-publication-checkouts", sanitize(registered.repository_id), `proof-${randomUUID()}`),
  );
  mkdirSync(dirname(proofRoot), { recursive: true });
  try {
    git(registered.repository_root, ["worktree", "add", "--detach", proofRoot, base]);
  } catch (error) {
    return { ok: false, reason_code: "ISOLATION_FAILED", detail: `git worktree add for publication proof failed: ${error instanceof Error ? error.message : String(error)}` };
  }

  const proofIdentity = resolveCodingRepository(proofRoot);
  if (!proofIdentity.ok || proofIdentity.repository.repository_id !== input.repository_id) {
    try {
      git(registered.repository_root, ["worktree", "remove", "--force", proofRoot]);
    } catch {
      // Removal is best-effort after identity failure.
    }
    return { ok: false, reason_code: "REPOSITORY_IDENTITY_MISMATCH", detail: "proof worktree did not corroborate the registered repository_id" };
  }

  const evidence_id = `ev-eng-pub-checkout-${randomUUID()}`;
  saveEvidence({
    evidence_id,
    task_id: `task-publication-proof-checkout`,
    kind: "execution_output",
    source: "control/engineering-runtime/publication-checkout.ts",
    recorded_at: new Date().toISOString(),
    payload: {
      note: "publication_proof_checkout_created",
      repository_id: input.repository_id,
      authoritative_root: resolve(input.authoritative_root),
      proof_root: proofRoot,
      base_commit_sha: base,
      default_branch: registered.default_branch,
      preserved_authoritative_working_tree: true,
    },
  });

  registerPublicationCheckoutWorkspace({
    work_id: input.work_id ?? "work-publication-proof",
    reservation_id: evidence_id,
    repository_id: input.repository_id,
    repository_root: resolve(registered.repository_root),
    proof_root: proofRoot,
  });

  return {
    ok: true,
    checkout: {
      repository_id: input.repository_id,
      authoritative_root: resolve(registered.repository_root),
      proof_root: proofRoot,
      base_commit_sha: base,
      default_branch: registered.default_branch,
      evidence_id,
    },
  };
}

export function removePublicationProofCheckout(checkout: PublicationProofCheckout): void {
  try {
    git(checkout.authoritative_root, ["worktree", "remove", checkout.proof_root]);
  } catch {
    try {
      git(checkout.authoritative_root, ["worktree", "remove", "--force", checkout.proof_root]);
    } catch {
      // Proof checkout is disposable; a leftover worktree is recorded as evidence only.
    }
  }
  const registered = listLocalWorkspaces().find((row) => row.path_reference === resolve(checkout.proof_root));
  if (registered && registered.current_state !== "CLEANED") {
    transitionLocalWorkspace(registered.workspace_id, "CLEANED", "publication_proof_checkout_removed");
  }
  saveEvidence({
    evidence_id: `ev-eng-pub-checkout-remove-${randomUUID()}`,
    task_id: "task-publication-proof-checkout",
    kind: "execution_output",
    source: "control/engineering-runtime/publication-checkout.ts",
    recorded_at: new Date().toISOString(),
    payload: { note: "publication_proof_checkout_removed", proof_root: checkout.proof_root, repository_id: checkout.repository_id },
  });
}

export type IsolatedEngineeringCheckout =
  | { readonly ok: true; readonly checkout_root: string; readonly isolated: boolean; readonly proof: PublicationProofCheckout | null }
  | { readonly ok: false; readonly reason_code: EngineeringGateReason; readonly detail: string };

export function authoritativeWorkingTreeDirty(root: string): boolean {
  try {
    return git(root, ["status", "--porcelain"]).trim().length > 0;
  } catch {
    return true;
  }
}

/**
 * When the authoritative checkout is dirty, do not commit/publish from it.
 * Use the existing publication proof worktree (clean, same repository_id).
 * Prefer the authenticated remote HEAD so publication can fast-forward;
 * if that object is missing locally, fall back to the registered default branch.
 * Never stash/reset the Owner's working tree.
 */
export async function resolveIsolatedEngineeringCheckout(authoritativeRoot: string, workId?: string): Promise<IsolatedEngineeringCheckout> {
  const identity = resolveCodingRepository(authoritativeRoot);
  if (!identity.ok) return { ok: false, reason_code: identity.reason_code, detail: identity.detail };
  if (!authoritativeWorkingTreeDirty(authoritativeRoot)) {
    return { ok: true, checkout_root: resolve(authoritativeRoot), isolated: false, proof: null };
  }
  let atCommitSha: string | undefined;
  const dest = resolveGithubDestination({
    repository_id: identity.repository.repository_id,
    checkout_root: authoritativeRoot,
  });
  if (dest.ok) {
    const remote = await corroborateAuthenticatedGithubRemote(dest.destination);
    if (remote.ok) atCommitSha = remote.remote.remote_head_sha;
  }
  const proof = createPublicationProofCheckout({
    repository_id: identity.repository.repository_id,
    authoritative_root: authoritativeRoot,
    at_commit_sha: atCommitSha,
    work_id: workId,
  });
  if (!proof.ok && atCommitSha) {
    const localProof = createPublicationProofCheckout({
      repository_id: identity.repository.repository_id,
      authoritative_root: authoritativeRoot,
      work_id: workId,
    });
    if (!localProof.ok) return { ok: false, reason_code: localProof.reason_code, detail: localProof.detail };
    return { ok: true, checkout_root: localProof.checkout.proof_root, isolated: true, proof: localProof.checkout };
  }
  if (!proof.ok) return { ok: false, reason_code: proof.reason_code, detail: proof.detail };
  return { ok: true, checkout_root: proof.checkout.proof_root, isolated: true, proof: proof.checkout };
}
