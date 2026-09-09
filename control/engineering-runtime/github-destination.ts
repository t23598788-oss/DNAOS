/**
 * หน้าที่: resolve the GitHub publication destination from registered
 * repository identity only. The model, worker, caller, free text, and
 * process.cwd() cannot choose or override owner/repository/branch.
 *
 * Input: repository_id + registered checkout root (+ optional requested
 * override that is only accepted when it equals registration).
 * Output: RegisteredGithubDestination or a fail-closed reason.
 * Dependency ที่อนุญาต: node:child_process, ./repository.ts, ./types.ts,
 * ../../software/repository-registry/contract.ts,
 * ../../connections/connection-registry/contract.ts.
 * สิ่งที่ห้ามแตะ: never invent a remote. never create a GitHub repository.
 * never use the currently checked-out branch as the publish branch.
 */

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { getRepository } from "../../software/repository-registry/contract";
import { lookupConnection } from "../../connections/connection-registry/contract";
import { gitCommonDir, gitOriginUrl, resolveCodingRepository } from "./repository";
import type { EngineeringGateReason } from "./types";

export interface RegisteredGithubDestination {
  readonly repository_id: string;
  readonly repository_root: string;
  readonly owner: string;
  readonly repository: string;
  readonly remote_url: string;
  readonly default_branch: string;
  readonly publish_branch: string;
  readonly connection_id: string;
  readonly credential_ref: string;
  readonly local_default_branch_sha: string;
  readonly local_head_sha: string;
}

export type DestinationResolution =
  | { readonly ok: true; readonly destination: RegisteredGithubDestination }
  | { readonly ok: false; readonly reason_code: EngineeringGateReason; readonly detail: string };

function normalizeGithubUrl(url: string): string {
  return url.replace(/\/+$/, "").replace(/\.git$/i, "").toLowerCase();
}

function parseGithubOwnerRepo(remoteUrl: string): { owner: string; repository: string } | null {
  const httpsMatch = remoteUrl.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/i);
  if (httpsMatch) return { owner: httpsMatch[1]!, repository: httpsMatch[2]! };
  const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?\/?$/i);
  if (sshMatch) return { owner: sshMatch[1]!, repository: sshMatch[2]! };
  return null;
}

function gitText(cwd: string, args: readonly string[]): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 10_000 }).trim() || null;
  } catch {
    return null;
  }
}

export function resolveGithubDestination(input: {
  readonly repository_id: string;
  readonly checkout_root: string;
  readonly requested?: { readonly owner?: string; readonly repository?: string; readonly branch?: string };
}): DestinationResolution {
  const registered = getRepository(input.repository_id);
  if (!registered || registered.status !== "ACTIVE") {
    return { ok: false, reason_code: "REPOSITORY_IDENTITY_MISSING", detail: `repository_id "${input.repository_id}" is not an ACTIVE registry row` };
  }
  const local = resolveCodingRepository(input.checkout_root);
  if (!local.ok) return { ok: false, reason_code: local.reason_code, detail: local.detail };
  if (local.repository.repository_id !== registered.repository_id) {
    return {
      ok: false,
      reason_code: "REPOSITORY_IDENTITY_MISMATCH",
      detail: `checkout corroborates ${local.repository.repository_id} but publication asked for ${registered.repository_id}`,
    };
  }
  const checkoutCommon = gitCommonDir(input.checkout_root);
  const registeredCommon = gitCommonDir(registered.repository_root);
  if (!checkoutCommon || !registeredCommon || checkoutCommon !== registeredCommon) {
    return {
      ok: false,
      reason_code: "REPOSITORY_IDENTITY_MISMATCH",
      detail: "checkout git common-dir is not the registered repository git common-dir",
    };
  }
  const checkoutOrigin = gitOriginUrl(input.checkout_root);
  if (!checkoutOrigin || normalizeGithubUrl(checkoutOrigin) !== normalizeGithubUrl(registered.source_authority)) {
    return {
      ok: false,
      reason_code: "REMOTE_IDENTITY_MISMATCH",
      detail: "checkout origin URL identity does not match registered source_authority",
    };
  }
  if (!registered.connection_id) {
    return { ok: false, reason_code: "UNREGISTERED_REMOTE", detail: "repository registration has no connection_id — GitHub destination is not registered" };
  }
  const connection = lookupConnection({ connection_id: registered.connection_id });
  if (!connection || connection.adapter !== "github") {
    return { ok: false, reason_code: "UNREGISTERED_REMOTE", detail: `connection_id "${registered.connection_id}" is not a registered github adapter connection` };
  }
  if (!connection.target) {
    return { ok: false, reason_code: "UNREGISTERED_REMOTE", detail: "GitHub connection has no registered target" };
  }
  if (connection.target.owner !== registered.owner || connection.target.repository !== registered.repository) {
    return {
      ok: false,
      reason_code: "REMOTE_IDENTITY_MISMATCH",
      detail: "connection target owner/repository does not match repository-registry",
    };
  }
  if (connection.target.branch !== registered.default_branch) {
    return {
      ok: false,
      reason_code: "BRANCH_POLICY_DENIED",
      detail: `connection branch "${connection.target.branch}" is not the registered default_branch "${registered.default_branch}"`,
    };
  }

  const remotes = gitText(input.checkout_root, ["remote"]);
  if (remotes === null) {
    return { ok: false, reason_code: "UNREGISTERED_REMOTE", detail: "git remote failed in the registered checkout" };
  }
  const remoteNames = remotes.split("\n").map((line) => line.trim()).filter((name) => name.length > 0);
  if (!remoteNames.includes("origin")) {
    return { ok: false, reason_code: "UNREGISTERED_REMOTE", detail: "registered checkout has no origin remote" };
  }
  const originUrl = gitText(input.checkout_root, ["remote", "get-url", "origin"]);
  if (!originUrl) {
    return { ok: false, reason_code: "UNREGISTERED_REMOTE", detail: "origin remote URL could not be read" };
  }
  const parsed = parseGithubOwnerRepo(originUrl);
  if (!parsed) {
    return { ok: false, reason_code: "REMOTE_IDENTITY_MISMATCH", detail: "origin remote is not a github.com URL" };
  }
  if (parsed.owner !== registered.owner || parsed.repository !== registered.repository) {
    return {
      ok: false,
      reason_code: "REMOTE_IDENTITY_MISMATCH",
      detail: `origin ${parsed.owner}/${parsed.repository} does not match registered ${registered.owner}/${registered.repository}`,
    };
  }
  if (normalizeGithubUrl(originUrl) !== normalizeGithubUrl(registered.source_authority)) {
    return {
      ok: false,
      reason_code: "REMOTE_IDENTITY_MISMATCH",
      detail: "origin URL identity does not match registered source_authority",
    };
  }

  const requested = input.requested;
  if (requested?.owner && requested.owner !== registered.owner) {
    return { ok: false, reason_code: "REMOTE_IDENTITY_MISMATCH", detail: "caller-supplied GitHub owner is not the registered destination" };
  }
  if (requested?.repository && requested.repository !== registered.repository) {
    return { ok: false, reason_code: "REMOTE_IDENTITY_MISMATCH", detail: "caller-supplied GitHub repository is not the registered destination" };
  }
  if (requested?.branch && requested.branch !== registered.default_branch) {
    return { ok: false, reason_code: "BRANCH_POLICY_DENIED", detail: `branch "${requested.branch}" is outside registered branch policy (${registered.default_branch})` };
  }

  let credential_ref: string;
  if (connection.credential_ref.kind === "keychain_ref") credential_ref = connection.credential_ref.ref;
  else if (connection.credential_ref.kind === "env_var") credential_ref = `env:${connection.credential_ref.name}`;
  else {
    return { ok: false, reason_code: "CREDENTIAL_UNAVAILABLE", detail: "registered GitHub connection has no real credential_ref" };
  }

  const local_head_sha = gitText(input.checkout_root, ["rev-parse", "HEAD"]);
  const branch_tip_sha = gitText(input.checkout_root, ["rev-parse", "--verify", registered.default_branch]);
  const detached = gitText(input.checkout_root, ["symbolic-ref", "-q", "HEAD"]) === null;
  const local_default_branch_sha = detached ? local_head_sha : branch_tip_sha;
  if (!local_default_branch_sha || !local_head_sha) {
    return { ok: false, reason_code: "REPOSITORY_IDENTITY_MISSING", detail: "could not read local default-branch or HEAD commit" };
  }

  return {
    ok: true,
    destination: {
      repository_id: registered.repository_id,
      repository_root: resolve(input.checkout_root),
      owner: registered.owner,
      repository: registered.repository,
      remote_url: registered.source_authority,
      default_branch: registered.default_branch,
      publish_branch: registered.default_branch,
      connection_id: registered.connection_id,
      credential_ref,
      local_default_branch_sha,
      local_head_sha,
    },
  };
}
