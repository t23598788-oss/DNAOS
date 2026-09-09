import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createPublicationProofCheckout, type PublicationProofCheckout } from "../engineering-runtime/contract";
import { classifiedRow } from "./classify";
import type { ConflictRecord } from "./types";

export const REMOTE_ONLY_FEATURE_PATHS = [
  "control/engineering-runtime/fixtures/completion/HUMAN.md",
  "control/engineering-runtime/fixtures/completion/code-target.txt",
  "control/engineering-runtime/fixtures/completion/contract.json",
  "control/engineering-runtime/fixtures/completion/registry-record.json",
] as const;

function git(cwd: string, args: readonly string[], env?: Record<string, string | undefined>): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 60_000, maxBuffer: 32 * 1024 * 1024, env: env ?? process.env }).trim();
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

function toPosix(path: string): string {
  return path.replaceAll("\\", "/");
}

export function listWorktreePaths(repositoryRoot: string): readonly string[] {
  const raw = execFileSync("git", ["status", "--porcelain", "-uall"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const paths: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.length < 4) continue;
    let body = line.slice(3);
    if (body.includes(" -> ")) body = body.split(" -> ")[1]!;
    const path = toPosix(body.trim());
    if (!path) continue;
    try {
      if (statSync(join(repositoryRoot, path)).isDirectory()) continue;
    } catch {
      continue;
    }
    paths.push(path);
  }
  return [...new Set(paths)];
}

/** Tracked and untracked files that differ from a revision, not only vs HEAD. */
export function listPathsDifferingFromRevision(repositoryRoot: string, revision: string): readonly string[] {
  const tracked = git(repositoryRoot, ["diff", "--name-only", revision]).split("\n").map(toPosix).filter(Boolean);
  const untracked = git(repositoryRoot, ["ls-files", "--others", "--exclude-standard"]).split("\n").map(toPosix).filter(Boolean);
  const files: string[] = [];
  for (const path of [...new Set([...tracked, ...untracked])]) {
    try {
      if (statSync(join(repositoryRoot, path)).isDirectory()) continue;
    } catch {
      continue;
    }
    files.push(path);
  }
  return files;
}

export function restoreIsolatedOverlay(input: {
  readonly source_root: string;
  readonly dest_root: string;
  readonly against_revision: string;
}): void {
  const modules = join(input.dest_root, "node_modules");
  if (existsSync(modules)) rmSync(modules, { recursive: true, force: true });
  for (const path of listWorktreePaths(input.dest_root)) {
    if (classifiedRow(path).admitted) continue;
    try {
      git(input.dest_root, ["checkout", "--", path]);
    } catch {
      rmSync(join(input.dest_root, path), { force: true });
    }
  }
  copyEligibleSource({
    source_root: input.source_root,
    dest_root: input.dest_root,
    against_revision: input.against_revision,
  });
}

export function copyEligibleSource(input: {
  readonly source_root: string;
  readonly dest_root: string;
  readonly against_revision?: string;
}): {
  readonly copied: readonly string[];
  readonly excluded_runtime: readonly string[];
  readonly excluded_credential: readonly string[];
  readonly excluded_other: readonly string[];
} {
  const copied: string[] = [];
  const excluded_runtime: string[] = [];
  const excluded_credential: string[] = [];
  const excluded_other: string[] = [];
  const protectedSet = new Set<string>(REMOTE_ONLY_FEATURE_PATHS);
  const paths = input.against_revision
    ? listPathsDifferingFromRevision(input.source_root, input.against_revision)
    : listWorktreePaths(input.source_root);
  for (const path of paths) {
    const row = classifiedRow(path);
    if (protectedSet.has(path)) {
      excluded_other.push(path);
      continue;
    }
    if (!row.admitted) {
      if (row.classification === "RUNTIME_DATA" || row.classification === "AUDIT_DATA") excluded_runtime.push(path);
      else if (row.classification === "CREDENTIAL_OR_SECRET_STATE") excluded_credential.push(path);
      else excluded_other.push(path);
      continue;
    }
    const from = join(input.source_root, path);
    const to = join(input.dest_root, path);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    copied.push(path);
  }
  return { copied, excluded_runtime, excluded_credential, excluded_other };
}

export function fixtureConflicts(input: {
  readonly repository_root: string;
  readonly merge_base: string;
  readonly remote_main: string;
  readonly local_head: string;
}): readonly ConflictRecord[] {
  return REMOTE_ONLY_FEATURE_PATHS.map((path) => {
    const remote_hash = blob(input.repository_root, input.remote_main, path);
    const local_committed_hash = blob(input.repository_root, input.local_head, path);
    let local_worktree_hash: string | null = null;
    if (existsSync(join(input.repository_root, path))) {
      local_worktree_hash = git(input.repository_root, ["hash-object", path]);
    }
    return {
      path,
      base_hash: blob(input.repository_root, input.merge_base, path),
      remote_hash,
      local_committed_hash,
      local_worktree_hash,
      conflict_type: "ADD_ADD" as const,
      resolution_basis: "REMOTE_ONLY_COMMITS mutate only these fixture paths; keeping remote blobs preserves live GitHub main engineering-loop evidence. Local/worktree placeholders are reconstruction fixtures, not remote-only behavior.",
      chosen_side: "REMOTE" as const,
      evidence_refs: [
        `remote:${input.remote_main}:${path}`,
        `local:${input.local_head}:${path}`,
        "lineage:e6ddf03..c57ad8ae-fixture-only",
      ],
    };
  });
}

export function remoteFeaturesPreserved(destRoot: string, remoteMain: string): boolean {
  return REMOTE_ONLY_FEATURE_PATHS.every((path) => blob(destRoot, "HEAD", path) === blob(destRoot, remoteMain, path) && git(destRoot, ["hash-object", path]) === blob(destRoot, remoteMain, path));
}

export function candidateTreeHash(destRoot: string, parentSha: string, admitted: readonly string[]): string {
  const indexDir = mkdtempSync(join(tmpdir(), "dna-os-candidate-"));
  const indexFile = join(indexDir, "index");
  const env = { ...process.env, GIT_INDEX_FILE: indexFile };
  try {
    git(destRoot, ["read-tree", parentSha], env);
    if (admitted.length > 0) {
      for (let i = 0; i < admitted.length; i += 80) {
        git(destRoot, ["add", "--", ...admitted.slice(i, i + 80)], env);
      }
    }
    return git(destRoot, ["write-tree"], env);
  } finally {
    rmSync(indexDir, { recursive: true, force: true });
  }
}

export function createIsolatedIntegrationWorkspace(input: {
  readonly repository_id: string;
  readonly authoritative_root: string;
  readonly live_remote_main: string;
}): { readonly ok: true; readonly checkout: PublicationProofCheckout } | { readonly ok: false; readonly detail: string } {
  const created = createPublicationProofCheckout({
    repository_id: input.repository_id,
    authoritative_root: input.authoritative_root,
    at_commit_sha: input.live_remote_main,
    work_id: "work-diverged-source-integration",
  });
  if (!created.ok) return { ok: false, detail: created.detail };
  return { ok: true, checkout: created.checkout };
}

declare const process: { env: Record<string, string | undefined> };
