/**
 * Storage Intelligence — Git adapter. Read-only: status, remote, commit.
 * A resource inside a dirty repo (uncommitted changes) or with untracked
 * files must never be classified as safe to trash — this is the evidence
 * source the classifier uses to enforce that.
 */
import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

function sh(cwd: string, cmd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
}

export interface GitInfo {
  is_git_repo: boolean;
  is_clean: boolean;
  uncommitted_changes: string[];
  remote_url: string | null;
  branch: string | null;
  latest_commit: string | null;
}

export function inspectGitRepo(dirPath: string): GitInfo {
  const isRepo = existsSync(join(dirPath, ".git"));
  if (!isRepo) {
    return {
      is_git_repo: false,
      is_clean: false,
      uncommitted_changes: [],
      remote_url: null,
      branch: null,
      latest_commit: null,
    };
  }
  const status = sh(dirPath, "git status --short");
  const changes = status ? status.split("\n").filter(Boolean) : [];
  return {
    is_git_repo: true,
    is_clean: changes.length === 0,
    uncommitted_changes: changes,
    remote_url: sh(dirPath, "git remote get-url origin") || null,
    branch: sh(dirPath, "git rev-parse --abbrev-ref HEAD") || null,
    latest_commit: sh(dirPath, "git rev-parse HEAD") || null,
  };
}

/** True if the given file is tracked or ignored by an enclosing repo — used
 * to keep the classifier from ever treating tracked source as a stray file. */
export function isTrackedOrIgnored(repoDir: string, filePath: string): boolean {
  const tracked = sh(repoDir, `git ls-files --error-unmatch "${filePath}"`);
  if (tracked) return true;
  const ignored = sh(repoDir, `git check-ignore "${filePath}"`);
  return !!ignored;
}
