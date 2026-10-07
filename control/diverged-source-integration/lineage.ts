import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { IntegrationStrategy, LocalCommitAnalysis } from "./types";

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 30_000 }).trim();
}

function blob(cwd: string, rev: string, path: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", `${rev}:${path}`], {
      cwd,
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function worktreeBlob(cwd: string, path: string): string | null {
  const abs = join(cwd, path);
  if (!existsSync(abs)) return null;
  try {
    return git(cwd, ["hash-object", path]);
  } catch {
    return createHash("sha256").update(readFileSync(abs)).digest("hex");
  }
}

export function listCommits(cwd: string, range: string): readonly { readonly sha: string; readonly subject: string; readonly paths: readonly string[] }[] {
  const log = git(cwd, ["log", "--format=%H\t%s", range]);
  if (!log) return [];
  return log.split("\n").filter(Boolean).map((line) => {
    const [sha, subject] = line.split("\t");
    const paths = git(cwd, ["diff-tree", "--no-commit-id", "--name-only", "-r", sha!]).split("\n").filter(Boolean);
    return { sha: sha!, subject: subject ?? "", paths };
  });
}

export function analyzeLocalCommits(input: {
  readonly repository_root: string;
  readonly merge_base: string;
  readonly local_head: string;
  readonly remote_main: string;
}): readonly LocalCommitAnalysis[] {
  const remotePaths = new Set(git(input.repository_root, ["diff", "--name-only", input.merge_base, input.remote_main]).split("\n").filter(Boolean));
  const worktreeChanged = new Set([
    ...git(input.repository_root, ["diff", "--name-only", "HEAD"]).split("\n").filter(Boolean),
    ...git(input.repository_root, ["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean),
  ]);
  return listCommits(input.repository_root, `${input.merge_base}..${input.local_head}`).map((row) => {
    const conflicts_with_remote = row.paths.some((path) => remotePaths.has(path));
    const already_present_remote = row.paths.length > 0 && row.paths.every((path) => {
      const localBlob = blob(input.repository_root, row.sha, path);
      const remoteBlob = blob(input.repository_root, input.remote_main, path);
      return localBlob !== null && localBlob === remoteBlob;
    });
    const superseded_by_uncommitted_work = row.paths.some((path) => worktreeChanged.has(path) && worktreeBlob(input.repository_root, path) !== blob(input.repository_root, row.sha, path));
    return {
      commit_sha: row.sha,
      subject: row.subject,
      changed_paths: row.paths,
      still_relevant: !already_present_remote,
      already_present_remote,
      conflicts_with_remote,
      superseded_by_uncommitted_work,
      required_for_current_tree: row.paths.some((path) => worktreeChanged.has(path) || blob(input.repository_root, input.local_head, path) !== blob(input.repository_root, input.merge_base, path)),
    };
  });
}

export function remoteOnlyChangedPaths(input: {
  readonly repository_root: string;
  readonly merge_base: string;
  readonly remote_main: string;
}): readonly string[] {
  return git(input.repository_root, ["diff", "--name-only", input.merge_base, input.remote_main]).split("\n").filter(Boolean);
}

export function overlappingPaths(localPaths: readonly string[], remotePaths: readonly string[]): readonly string[] {
  const remote = new Set(remotePaths);
  return [...new Set(localPaths.filter((path) => remote.has(path)))].sort();
}

export function selectIntegrationStrategy(input: {
  readonly local_commit_count: number;
  readonly remote_commit_count: number;
  readonly overlapping_path_count: number;
}): { readonly strategy: IntegrationStrategy; readonly reason: string } {
  if (input.local_commit_count > 0 && input.remote_commit_count > 0) {
    return {
      strategy: "MIXED",
      reason: "Histories diverged: merge commit preserves both parent identities; tree reconstruction overlays eligible current worktree source and keeps remote-only fixture blobs. Rebase is rejected because it would rewrite local commit identities.",
    };
  }
  if (input.remote_commit_count === 0) {
    return { strategy: "TREE_RECONSTRUCTION", reason: "No remote-only commits; reconstruct tree on live remote base." };
  }
  return { strategy: "MERGE_LINEAGE", reason: "Both sides have unique commits; a merge commit is the truthful parent structure." };
}
