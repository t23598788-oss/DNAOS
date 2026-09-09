/**
 * หน้าที่: DNA OS GitHub Publish Authority — the only source-publication
 * entry point for the registered GitHub repository. Pushes the DNA OS
 * commit object to the registered remote and branch. Never force-pushes,
 * never rewrites history, never uses a worker token.
 *
 * Input: DNA OS commit SHA + RegisteredGithubDestination + connection.
 * Output: GithubPublishResult.
 * Dependency ที่อนุญาต: node:child_process, ./types.ts,
 * ../../connections/github/credential-resolution.ts,
 * ../../connections/github/github-read-api.ts,
 * ../../connections/connection-registry/contract.ts.
 * สิ่งที่ห้ามแตะ: never log or return credential values. never --force.
 * never push a SHA that DNA OS did not create. never accept an arbitrary
 * remote or branch from the caller.
 */

import { execFileSync } from "node:child_process";
import { resolveGithubCredential } from "../../connections/github/credential-resolution";
import { getBranch, getRepository } from "../../connections/github/github-read-api";
import { lookupConnection } from "../../connections/connection-registry/contract";
import { corroborateAuthenticatedGithubRemote } from "./remote-corroboration";
import type { RegisteredGithubDestination } from "./github-destination";
import type { EngineeringGateReason, GithubPublishResult } from "./types";

export interface GithubPublishDeps {
  readonly resolveCredential?: typeof resolveGithubCredential;
  readonly lookupRepo?: typeof getRepository;
  readonly lookupBranch?: typeof getBranch;
  readonly gitPush?: (args: {
    readonly repository_root: string;
    readonly remote_url: string;
    readonly commit_sha: string;
    readonly branch: string;
    readonly token: string;
  }) => { readonly ok: true; readonly output: string } | { readonly ok: false; readonly detail: string };
}

function deny(reason_code: EngineeringGateReason, detail: string, extra: Partial<GithubPublishResult> = {}): GithubPublishResult {
  return {
    published: false,
    reason_code,
    detail,
    commit_sha: extra.commit_sha ?? null,
    pre_publish_remote_sha: extra.pre_publish_remote_sha ?? null,
    post_publish_remote_sha: extra.post_publish_remote_sha ?? extra.pre_publish_remote_sha ?? null,
    github_owner: extra.github_owner ?? null,
    github_repository: extra.github_repository ?? null,
    publish_branch: extra.publish_branch ?? null,
    force_push_attempted: false,
  };
}

function redact(text: string): string {
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/Basic\s+\S+/gi, "Basic [redacted]")
    .replace(/x-access-token:[^\s]+/gi, "x-access-token:[redacted]")
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, "[redacted]")
    .replace(/github_pat_\w+/g, "[redacted]");
}

/** GitHub git-over-HTTPS rejects REST-style Bearer tokens; it expects Basic x-access-token. Never put the token in the remote URL. */
export function githubGitHttpAuthorizationHeader(token: string): string {
  const basic = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  return `Authorization: Basic ${basic}`;
}

function defaultGitPush(args: {
  readonly repository_root: string;
  readonly remote_url: string;
  readonly commit_sha: string;
  readonly branch: string;
  readonly token: string;
}): { readonly ok: true; readonly output: string } | { readonly ok: false; readonly detail: string } {
  const refspec = `${args.commit_sha}:refs/heads/${args.branch}`;
  if (refspec.startsWith("+") || args.branch.includes(":")) {
    return { ok: false, detail: "refspec rejected as force or ambiguous" };
  }
  const argv = ["push", "--porcelain", "--", args.remote_url, refspec];
  if (argv.some((item) => item === "--force" || item === "--force-with-lease" || item.startsWith("+"))) {
    return { ok: false, detail: "force push is denied by GitHub Publish Authority" };
  }
  try {
    const output = execFileSync("git", argv, {
      cwd: args.repository_root,
      encoding: "utf8",
      timeout: 60_000,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "/usr/bin/false",
        GIT_CONFIG_COUNT: "2",
        GIT_CONFIG_KEY_0: "http.extraHeader",
        GIT_CONFIG_VALUE_0: githubGitHttpAuthorizationHeader(args.token),
        GIT_CONFIG_KEY_1: "credential.helper",
        GIT_CONFIG_VALUE_1: "",
      },
    });
    return { ok: true, output };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const extra = error && typeof error === "object" && "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "";
    return { ok: false, detail: redact(`${message} ${extra}`.trim()) };
  }
}

export function denyWorkerGithubWrite(detail: string): GithubPublishResult {
  return deny("WORKER_GITHUB_WRITE_DENIED", detail);
}

export async function publishDnaOsCommit(input: {
  readonly destination: RegisteredGithubDestination;
  readonly commit_sha: string;
  readonly expected_remote_sha: string;
  readonly deps?: GithubPublishDeps;
}): Promise<GithubPublishResult> {
  const dest = input.destination;
  const base = {
    commit_sha: input.commit_sha,
    github_owner: dest.owner,
    github_repository: dest.repository,
    publish_branch: dest.publish_branch,
  };
  if (dest.publish_branch !== dest.default_branch) {
    return deny("BRANCH_POLICY_DENIED", "publish branch is not the registered default branch", base);
  }

  const connection = lookupConnection({ connection_id: dest.connection_id });
  if (!connection) {
    return deny("UNREGISTERED_REMOTE", "GitHub connection_id is not registered", base);
  }
  const resolveCredential = input.deps?.resolveCredential ?? resolveGithubCredential;
  const credential = await resolveCredential(connection);
  if (!credential.ok) {
    return deny("CREDENTIAL_UNAVAILABLE", "GitHub credential reference could not be resolved — no worker/user/model fallback", base);
  }

  const injectedSeam = Boolean(input.deps?.resolveCredential || input.deps?.lookupRepo || input.deps?.lookupBranch || input.deps?.gitPush);
  if (!injectedSeam) {
    const corroborated = await corroborateAuthenticatedGithubRemote(dest);
    if (!corroborated.ok) {
      return deny(corroborated.reason_code, corroborated.detail, base);
    }
    if (corroborated.remote.owner !== dest.owner || corroborated.remote.repository !== dest.repository) {
      return deny("REMOTE_IDENTITY_MISMATCH", "authenticated GitHub identity does not match the registered destination", base);
    }
    if (corroborated.remote.remote_head_sha !== input.expected_remote_sha) {
      return deny("REMOTE_HEAD_MOVED", `remote ${dest.publish_branch} is ${corroborated.remote.remote_head_sha}, expected ${input.expected_remote_sha} — force push is denied`, {
        ...base,
        pre_publish_remote_sha: corroborated.remote.remote_head_sha,
      });
    }
  }

  const lookupRepo = input.deps?.lookupRepo ?? getRepository;
  const lookupBranch = input.deps?.lookupBranch ?? getBranch;
  const repo = await lookupRepo(credential.token, { owner: dest.owner, repo: dest.repository });
  if (repo.kind === "not_found_or_no_access") {
    return deny("REPOSITORY_NOT_ACCESSIBLE", "registered GitHub repository is inaccessible with the registered credential — DNA OS will not create another repository", base);
  }
  if (repo.kind !== "found") {
    return deny("GITHUB_PUBLISH_BLOCKED", "GitHub repository lookup failed", base);
  }

  const branch = await lookupBranch(credential.token, { owner: dest.owner, repo: dest.repository, branch: dest.publish_branch });
  if (branch.kind === "absent") {
    return deny("REMOTE_NOT_FOUND", `registered branch "${dest.publish_branch}" was not found`, base);
  }
  if (branch.kind !== "found" || !branch.head_commit_sha) {
    return deny("GITHUB_PUBLISH_BLOCKED", "could not read registered remote branch head before publication", base);
  }
  const pre = branch.head_commit_sha;
  if (pre !== input.expected_remote_sha) {
    return deny("REMOTE_HEAD_MOVED", `remote ${dest.publish_branch} is ${pre}, expected ${input.expected_remote_sha} — force push is denied`, {
      ...base,
      pre_publish_remote_sha: pre,
    });
  }

  const pusher = input.deps?.gitPush ?? defaultGitPush;
  const pushed = pusher({
    repository_root: dest.repository_root,
    remote_url: dest.remote_url,
    commit_sha: input.commit_sha,
    branch: dest.publish_branch,
    token: credential.token,
  });
  if (!pushed.ok) {
    return deny("GITHUB_PUBLISH_BLOCKED", `git push of DNA OS commit failed: ${pushed.detail}`, {
      ...base,
      pre_publish_remote_sha: pre,
    });
  }

  const after = await lookupBranch(credential.token, { owner: dest.owner, repo: dest.repository, branch: dest.publish_branch });
  const post = after.kind === "found" ? after.head_commit_sha : null;
  if (post !== input.commit_sha) {
    return deny("GITHUB_PUBLISH_BLOCKED", `post-publish remote SHA ${post ?? "unknown"} does not equal DNA OS commit ${input.commit_sha}`, {
      ...base,
      pre_publish_remote_sha: pre,
      post_publish_remote_sha: post,
    });
  }

  return {
    published: true,
    reason_code: "ADMITTED",
    detail: `published DNA OS commit ${input.commit_sha} to ${dest.owner}/${dest.repository}@${dest.publish_branch}`,
    commit_sha: input.commit_sha,
    pre_publish_remote_sha: pre,
    post_publish_remote_sha: post,
    github_owner: dest.owner,
    github_repository: dest.repository,
    publish_branch: dest.publish_branch,
    force_push_attempted: false,
  };
}

declare const process: { env: Record<string, string | undefined> };
