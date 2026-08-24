/**
 * หน้าที่: the two real operations this capability performs today —
 * (1) `checkRepoAccess`: does this connection's credential actually reach
 * this repository? and (2) `readRepositoryStatus`: what is the current
 * state of this repository/branch, and of the specific paths the caller
 * asked about? Both are pure reads. Both always produce a full result
 * object describing what happened, including on failure — there is no
 * "returns nothing and logs an error" path here.
 *
 * Why a repo-access check is separate from "the token is valid": a token
 * can be perfectly valid for its user and still have zero access to one
 * specific repository (exactly what TASK-172 hit live on 2026-08-14 —
 * valid token, HTTP 404 on the target repo). "Can authenticate" and "can
 * reach this repo" are two different facts, so they are two different
 * checks, and this adapter only ever claims the one it actually verified.
 *
 * Input: a resolved token + env var name (from ./credential-resolution.ts)
 * and a validated payload (from ./payload-validation.ts).
 * Output: `GithubAccessCheckResult`, `GithubRepoStatusResult`.
 * Dependency ที่อนุญาต: `./adapter-contract`, `./github-read-api`.
 * สิ่งที่ห้ามแตะ: ห้ามเขียนไฟล์ลงดิสก์ของเครื่อง ห้ามเขียนอะไรกลับไปที่
 * GitHub และห้ามคืนเนื้อหาไฟล์ — รอบนี้เป็น read-status เท่านั้น.
 * ห้ามใส่ token ลงในผลลัพธ์ มีได้แค่ credential source แบบ `env:<NAME>`
 * (`credential_source`)
 */

import type { GithubAccessCheckResult, GithubPathStatus, GithubReadStatusPayload, GithubRepoStatusResult, GithubRepoTarget } from "./adapter-contract";
import { getBranch, getPathStatus, getRepository } from "./github-read-api";

export async function checkRepoAccess(token: string, credentialSource: string, target: GithubRepoTarget): Promise<GithubAccessCheckResult> {
  const repository = await getRepository(token, target);

  if (repository.kind === "found") {
    return {
      owner: target.owner,
      repo: target.repo,
      reachable: true,
      http_status: repository.http_status,
      default_branch: repository.default_branch,
      visibility: repository.visibility,
      reason: null,
      credential_source: credentialSource,
    };
  }

  return {
    owner: target.owner,
    repo: target.repo,
    reachable: false,
    http_status: repository.http_status,
    default_branch: null,
    visibility: null,
    reason: repository.reason,
    credential_source: credentialSource,
  };
}

export async function readRepositoryStatus(token: string, credentialSource: string, payload: GithubReadStatusPayload): Promise<GithubRepoStatusResult> {
  const target = payload.target;

  const base: GithubRepoStatusResult = {
    owner: target.owner,
    repo: target.repo,
    branch: target.branch,
    reachable: false,
    http_status: null,
    default_branch: null,
    visibility: null,
    branch_found: false,
    head_commit_sha: null,
    head_commit_at: null,
    branch_protected: null,
    paths: [],
    reason: null,
    credential_source: credentialSource,
  };

  const repository = await getRepository(token, target);
  if (repository.kind !== "found") {
    // The repo could not be reached at all — the branch and the paths are unknown, and are reported as unknown rather than guessed.
    return { ...base, http_status: repository.http_status, reason: repository.reason };
  }

  const withRepo: GithubRepoStatusResult = {
    ...base,
    reachable: true,
    http_status: repository.http_status,
    default_branch: repository.default_branch,
    visibility: repository.visibility,
  };

  const branch = await getBranch(token, target);
  if (branch.kind === "failed") {
    return { ...withRepo, reason: `repository reachable, but reading branch "${target.branch}" failed: ${branch.reason}` };
  }
  if (branch.kind === "absent") {
    return { ...withRepo, reason: branch.reason };
  }

  const withBranch: GithubRepoStatusResult = {
    ...withRepo,
    branch_found: true,
    head_commit_sha: branch.head_commit_sha,
    head_commit_at: branch.head_commit_at,
    branch_protected: branch.branch_protected,
  };

  const requestedPaths = payload.paths ?? [];
  const pathStatuses: GithubPathStatus[] = [];

  // Sequential on purpose: a burst of parallel requests is how a connector
  // earns a rate limit, and MAX_STATUS_PATHS_PER_COMMAND keeps this bounded.
  for (const path of requestedPaths) {
    const lookup = await getPathStatus(token, target, path);
    if (lookup.kind === "file") {
      pathStatuses.push({ path, kind: "file", blob_sha: lookup.blob_sha, size_bytes: lookup.size_bytes });
    } else if (lookup.kind === "directory") {
      pathStatuses.push({ path, kind: "directory", entry_count: lookup.entries.length, entries: lookup.entries });
    } else if (lookup.kind === "absent") {
      pathStatuses.push({ path, kind: "absent" });
    } else {
      pathStatuses.push({ path, kind: "error", http_status: lookup.http_status, reason: lookup.reason });
    }
  }

  const failedPaths = pathStatuses.filter((status) => status.kind === "error").length;

  return {
    ...withBranch,
    paths: pathStatuses,
    reason: failedPaths > 0 ? `${failedPaths} of ${pathStatuses.length} requested path(s) could not be read — see paths[].reason` : null,
  };
}
