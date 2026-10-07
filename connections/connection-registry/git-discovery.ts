/**
 * หน้าที่: `discoverGitRemote()` — reads the REAL local git repository
 * (`git remote -v`, `git branch --show-current`, `git rev-parse
 * --show-toplevel`) and derives owner/repository/branch from it. Never a
 * default, never a guess — every field in the result comes from a real
 * command's real stdout, or the function fails honestly.
 *
 * Input: an optional working directory (default: `process.cwd()`).
 * Output: `discoverGitRemote` -> `GitRemoteDiscovery` or a typed failure.
 * Dependency ที่อนุญาต: node:child_process, node:util, ./types.ts.
 * สิ่งที่ห้ามแตะ: never hardcode an owner/repo/branch value anywhere in
 * this file. Never invent a default when a git command fails or a remote
 * is not a GitHub URL — report the real failure instead.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitRemoteDiscovery } from "./types";

const run = promisify(execFile);
const GIT = "git";

export type GitDiscoveryFailureReason = "NOT_A_GIT_REPOSITORY" | "NO_REMOTE_FOUND" | "REMOTE_NOT_GITHUB" | "NO_CURRENT_BRANCH" | "GIT_COMMAND_FAILED";

export type GitDiscoveryOutcome = { ok: true; value: GitRemoteDiscovery } | { ok: false; reason: GitDiscoveryFailureReason; detail: string };

/** Accepts both HTTPS (`https://github.com/owner/repo.git`) and SSH (`git@github.com:owner/repo.git`) remote URL shapes — the only two real forms `git remote -v` ever prints for GitHub. */
function parseGithubOwnerRepo(remoteUrl: string): { owner: string; repository: string } | null {
  const httpsMatch = remoteUrl.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/);
  if (httpsMatch) return { owner: httpsMatch[1]!, repository: httpsMatch[2]! };
  const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?\/?$/);
  if (sshMatch) return { owner: sshMatch[1]!, repository: sshMatch[2]! };
  return null;
}

export async function discoverGitRemote(cwd: string = process.cwd()): Promise<GitDiscoveryOutcome> {
  let toplevelResult: { stdout: string };
  try {
    toplevelResult = await run(GIT, ["rev-parse", "--show-toplevel"], { cwd, maxBuffer: 16 * 1024 });
  } catch (error) {
    return { ok: false, reason: "NOT_A_GIT_REPOSITORY", detail: error instanceof Error ? error.message : String(error) };
  }
  const repository_root = toplevelResult.stdout.trim();
  if (!repository_root) return { ok: false, reason: "NOT_A_GIT_REPOSITORY", detail: "git rev-parse --show-toplevel returned an empty path" };

  let remoteResult: { stdout: string };
  try {
    remoteResult = await run(GIT, ["remote", "-v"], { cwd, maxBuffer: 16 * 1024 });
  } catch (error) {
    return { ok: false, reason: "GIT_COMMAND_FAILED", detail: `git remote -v failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  const remoteLines = remoteResult.stdout.split("\n").filter((line) => line.trim().length > 0);
  const originFetchLine = remoteLines.find((line) => line.startsWith("origin\t") && line.includes("(fetch)"));
  if (!originFetchLine) return { ok: false, reason: "NO_REMOTE_FOUND", detail: `no "origin" remote with a (fetch) URL found — real output was: ${JSON.stringify(remoteLines)}` };
  const remoteUrlMatch = originFetchLine.match(/^origin\t(\S+)\s+\(fetch\)$/);
  if (!remoteUrlMatch) return { ok: false, reason: "NO_REMOTE_FOUND", detail: `could not parse the origin remote line: ${JSON.stringify(originFetchLine)}` };
  const remote_url = remoteUrlMatch[1]!;

  const parsed = parseGithubOwnerRepo(remote_url);
  if (!parsed) return { ok: false, reason: "REMOTE_NOT_GITHUB", detail: `origin remote "${remote_url}" is not a recognized github.com HTTPS or SSH URL` };

  let branchResult: { stdout: string };
  try {
    branchResult = await run(GIT, ["branch", "--show-current"], { cwd, maxBuffer: 16 * 1024 });
  } catch (error) {
    return { ok: false, reason: "GIT_COMMAND_FAILED", detail: `git branch --show-current failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  const branch = branchResult.stdout.trim();
  if (!branch) return { ok: false, reason: "NO_CURRENT_BRANCH", detail: "git branch --show-current returned empty — HEAD is likely detached" };

  return { ok: true, value: { owner: parsed.owner, repository: parsed.repository, branch, repository_root, remote_url } };
}
