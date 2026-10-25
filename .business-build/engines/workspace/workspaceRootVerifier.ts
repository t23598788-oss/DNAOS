/**
 * Verifies a requested workspace before a worker is allowed to read or act.
 *
 * This is deliberately a capability, not a convention: callers receive
 * structured evidence and must fail closed when the supplied path is stale,
 * absent, or resolves to a different repository than the declared source.
 */
import { existsSync, realpathSync, statSync } from "fs";
import { execFileSync } from "child_process";
import { join, resolve } from "path";

export type WorkspaceRootCheck = {
  requested_path: string;
  resolved_path: string | null;
  repository_root: string | null;
  verified: boolean;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
  evidence: {
    package_json: boolean;
    git_repository: boolean;
    dna_os_markers: string[];
  };
};

export type VerifyWorkspaceRootInput = {
  workspacePath?: string;
  /** Optional declared source-of-truth path. A mismatch is always rejected. */
  expectedRepositoryRoot?: string;
};

function addCheck(
  checks: WorkspaceRootCheck["checks"],
  name: string,
  passed: boolean,
  detail: string,
) {
  checks.push({ name, passed, detail });
}

function gitRoot(directory: string): string | null {
  try {
    return realpathSync(execFileSync("git", ["-C", directory, "rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim());
  } catch {
    return null;
  }
}

/**
 * Read-only preflight for any worker, watcher, source reader, or runtime task.
 * It never falls back to another path: a failed check is explicit evidence.
 */
export function verifyWorkspaceRoot(input: VerifyWorkspaceRootInput = {}): WorkspaceRootCheck {
  const requested_path = input.workspacePath?.trim() || process.cwd();
  const checks: WorkspaceRootCheck["checks"] = [];
  const absentEvidence = { package_json: false, git_repository: false, dna_os_markers: [] as string[] };

  if (!existsSync(requested_path)) {
    addCheck(checks, "path_exists", false, "The requested workspace path does not exist.");
    return { requested_path, resolved_path: null, repository_root: null, verified: false, checks, evidence: absentEvidence };
  }

  if (!statSync(requested_path).isDirectory()) {
    addCheck(checks, "path_is_directory", false, "The requested workspace path is not a directory.");
    return { requested_path, resolved_path: null, repository_root: null, verified: false, checks, evidence: absentEvidence };
  }

  const resolved_path = realpathSync(resolve(requested_path));
  addCheck(checks, "path_exists", true, "The requested workspace directory exists.");
  addCheck(checks, "path_is_directory", true, "The requested workspace path is a directory.");

  const repository_root = gitRoot(resolved_path);
  const package_json = existsSync(join(resolved_path, "package.json"));
  const markers = ["registry", "core", "engines"].filter((marker) => existsSync(join(resolved_path, marker)));
  const evidence = { package_json, git_repository: Boolean(repository_root), dna_os_markers: markers };

  addCheck(checks, "git_repository", Boolean(repository_root), repository_root
    ? `Git repository root resolved to ${repository_root}.`
    : "The requested workspace is not inside a Git repository.");
  addCheck(checks, "package_manifest", package_json, package_json
    ? "package.json found at the requested workspace root."
    : "package.json is missing at the requested workspace root.");
  addCheck(checks, "dna_os_markers", markers.length === 3, markers.length === 3
    ? "DNA OS markers registry/, core/, and engines/ are present."
    : `Missing DNA OS markers: ${["registry", "core", "engines"].filter((m) => !markers.includes(m)).join(", ")}.`);

  if (input.expectedRepositoryRoot?.trim()) {
    const expected = existsSync(input.expectedRepositoryRoot)
      ? realpathSync(resolve(input.expectedRepositoryRoot))
      : resolve(input.expectedRepositoryRoot);
    const matches = repository_root === expected;
    addCheck(checks, "declared_source_matches", matches, matches
      ? "Resolved repository matches the declared source of truth."
      : `Resolved repository ${repository_root ?? "none"} does not match declared source ${expected}.`);
  }

  return {
    requested_path,
    resolved_path,
    repository_root,
    verified: checks.every((check) => check.passed),
    checks,
    evidence,
  };
}
