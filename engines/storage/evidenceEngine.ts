/**
 * Storage Intelligence — Evidence Engine. Gathers every real signal available
 * for one path. Never decides anything itself (that's classifier.ts +
 * decisionEngine.ts) — this module only observes and reports.
 */
import { statSync } from "fs";
import type { StorageEvidenceItem } from "@/core/shared/types";
import { sha256File, daysOld, fileExt } from "./adapters/fsAdapter";
import { inspectGitRepo } from "./adapters/gitAdapter";

export interface GatheredEvidence {
  path: string;
  size_bytes: number;
  modified_at: string;
  sha256: string | null;
  ext: string;
  git: ReturnType<typeof inspectGitRepo>;
  is_inside_repo: boolean;
  age_days: number;
  evidence: StorageEvidenceItem[];
}

const CACHE_PATTERNS = [/\/\.npm(\/|$)/, /\/\.cache(\/|$)/, /\/Caches\//, /\/node_modules\/\.cache\//];
const LOG_EXTS = [".log"];
const BUILD_ARTIFACT_PATTERNS = [/\/\.next\//, /\/dist\//, /\/build\//, /\/\.turbo\//];
const GENERATED_PATTERNS = [/\/node_modules\//];
// (\/|$) — real bug found live 2026-08-04: /\.ollama\// alone never matches
// the bare root path itself (~/.ollama with nothing after it), only its
// children — same fix shape as CACHE_PATTERNS above already used.
const AI_MODEL_PATTERNS = [/\/\.ollama(\/|$)/, /\.gguf$/, /\.safetensors$/];
const DOCKER_PATTERNS = [/com\.docker\.docker/, /com\.docker\.install/];

export async function gatherEvidence(path: string, opts: { hash?: boolean; repoRootHint?: string } = {}): Promise<GatheredEvidence> {
  const st = statSync(path);
  const modified_at = st.mtime.toISOString();
  const size_bytes = st.size;
  const ext = fileExt(path);
  const git = inspectGitRepo(opts.repoRootHint ?? path);
  const sha256 = opts.hash && !st.isDirectory() ? await sha256File(path).catch(() => null) : null;

  const evidence: StorageEvidenceItem[] = [
    { kind: "filesystem", detail: "path/size/mtime observed", value: size_bytes },
    { kind: "age", detail: `${Math.floor(daysOld(modified_at))} days since last modified`, value: Math.floor(daysOld(modified_at)) },
  ];
  if (sha256) evidence.push({ kind: "checksum", detail: "sha256 computed", value: sha256 });
  if (git.is_git_repo) {
    evidence.push({ kind: "git_status", detail: git.is_clean ? "clean, 0 uncommitted changes" : `${git.uncommitted_changes.length} uncommitted changes`, value: git.is_clean });
    evidence.push({ kind: "git_remote", detail: git.remote_url ?? "no remote", value: git.remote_url });
    if (git.latest_commit) evidence.push({ kind: "git_commit", detail: git.latest_commit, value: git.latest_commit });
  }

  return {
    path,
    size_bytes,
    modified_at,
    sha256,
    ext,
    git,
    is_inside_repo: git.is_git_repo,
    age_days: daysOld(modified_at),
    evidence,
  };
}

export function matchesAny(path: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(path));
}

export const PATTERNS = {
  CACHE: CACHE_PATTERNS,
  LOG_EXTS,
  BUILD_ARTIFACT: BUILD_ARTIFACT_PATTERNS,
  GENERATED: GENERATED_PATTERNS,
  AI_MODEL: AI_MODEL_PATTERNS,
  DOCKER: DOCKER_PATTERNS,
};
