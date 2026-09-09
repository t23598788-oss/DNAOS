/**
 * หน้าที่: BUILD-TIME ONLY script — stamps `./dist/build-manifest.json` right
 * after `npx tsc -p control/conversation-runtime/tsconfig.build.json`
 * finishes (Owner UNLOCK 2026-09-06, PROVE_CONVERSATION_RUNTIME_BUILD_IDENTITY).
 *
 * Runs on the DEVELOPER/DEPLOY MACHINE, never inside the isolated
 * conversation-runtime child process — this file is NOT part of
 * `./tsconfig.build.json`'s `include` and is never imported by `./main.ts`,
 * so it never enters that process's dependency closure. It may use `tsx`
 * freely (this UNLOCK's ban on tsx was for the PRODUCTION RUNTIME PATH, not
 * for build tooling).
 *
 * Every field is read from something real:
 * - BUILD_FROM_COMMIT / BUILD_FROM_COMMIT_DIRTY: `control/runtime-revision/contract.ts#readRuntimeRevision`
 *   — the same function the rest of the repo already uses to state which
 *   commit a process is running from. Never re-derived here.
 * - SOURCE_REPOSITORY: `git remote get-url origin`, real command output.
 * - BUILD_HASH: sha256 over every `.js` file actually emitted under
 *   `./dist/`, sorted by relative path, each prefixed with its own path —
 *   changes if and only if the compiled artifact changes.
 * - BUILD_TIME: `new Date().toISOString()`, this process's own wall clock.
 * - BUILD_ID: derived from BUILD_TIME + BUILD_HASH — never random, so the
 *   same commit + same artifact reproduces a recognizable id shape.
 *
 * Input: none (reads the filesystem, git, and the clock).
 * Output: writes `./dist/build-manifest.json`; the shape is `BuildManifest`
 * in `./read-build-manifest.ts` — kept as a separate file so the READ side
 * can be imported into the runtime's own dependency closure without pulling
 * in this writer (which touches `node:child_process` for git).
 * Dependency ที่อนุญาต: node:fs, node:path, node:crypto,
 * `../runtime-revision/contract.ts`, node:child_process (git remote only).
 * สิ่งที่ห้ามแตะ: ห้ามให้ค่า field ใดๆ มาจากการเดา/ค่าคงที่ที่ไม่ตรวจสอบได้ —
 * ทุก field ต้องมาจากคำสั่งจริงหรือไฟล์จริงที่อ่านตอนนี้เท่านั้น.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { readRuntimeRevision } from "../runtime-revision/contract";
import type { BuildManifest } from "./read-build-manifest";

const DIST_DIR = join(__dirname, "dist");
const MANIFEST_PATH = join(DIST_DIR, "build-manifest.json");

function listJsFilesSorted(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listJsFilesSorted(full));
    else if (entry.endsWith(".js")) out.push(full);
  }
  return out.sort();
}

function computeBuildHash(): string {
  const files = listJsFilesSorted(DIST_DIR);
  if (files.length === 0) throw new Error(`no .js files found under ${DIST_DIR} — run the tsc build before writing the manifest`);
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(relative(DIST_DIR, file));
    hash.update("\0");
    hash.update(readFileSync(file));
  }
  return hash.digest("hex");
}

function sourceRepository(): string {
  try {
    return execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf-8", timeout: 5_000, maxBuffer: 4096 }).trim();
  } catch (error) {
    return `UNKNOWN: git remote get-url origin failed (${error instanceof Error ? error.message : String(error)})`;
  }
}

/**
 * CONNECT_SOURCE_IDENTITY_AND_GITHUB_PROVENANCE_TO_SELF_KNOWLEDGE (Owner
 * UNLOCK 2026-09-07): every field below is a real, individually-fallible
 * `git` read at BUILD TIME — same authority this file already had for
 * `sourceRepository()`/`readRuntimeRevision()`, nothing new granted. Each
 * helper returns `null` on failure rather than throwing, so one missing
 * fact (e.g. no upstream configured) never blocks the others.
 */
function tryGit(args: readonly string[]): string | null {
  try {
    return execFileSync("git", args as string[], { encoding: "utf-8", timeout: 5_000, maxBuffer: 4096 }).trim();
  } catch {
    return null;
  }
}

function localWorktree(): string | null {
  return tryGit(["rev-parse", "--show-toplevel"]);
}

function currentBranch(): string | null {
  const branch = tryGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  return branch && branch !== "HEAD" ? branch : branch; // detached HEAD reports literally "HEAD" — passed through as-is, never guessed into a branch name
}

/** REPOSITORY_ID/REMOTE_PROVIDER: parsed ONLY from a literal `github.com` host in the real remote URL — never inferred from the repository name (PHASE 3's own rule). */
function githubProvenance(remoteUrl: string): { provider: string | null; repository_id: string | null } {
  const httpsMatch = remoteUrl.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/);
  const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?\/?$/);
  const match = httpsMatch ?? sshMatch;
  if (!match) return { provider: null, repository_id: null };
  return { provider: "github", repository_id: `${match[1]}/${match[2]}` };
}

/**
 * Sync state is judged against the LOCAL remote-tracking ref only — this
 * never fetches the network (PHASE 4's own rule). `LAST_FETCH_AT` (the
 * `.git/FETCH_HEAD` mtime) is carried alongside so a reader can see exactly
 * how stale that comparison might be, rather than presenting it as live.
 */
function remoteTrackingState(): {
  remote_tracking_ref: string | null;
  remote_tracking_head: string | null;
  ahead_count: number | null;
  behind_count: number | null;
  last_fetch_at: string | null;
} {
  const remoteTrackingRef = tryGit(["rev-parse", "--symbolic-full-name", "@{u}"]);
  const remoteTrackingHead = remoteTrackingRef ? tryGit(["rev-parse", "@{u}"]) : null;
  let aheadCount: number | null = null;
  let behindCount: number | null = null;
  if (remoteTrackingHead) {
    const counts = tryGit(["rev-list", "--left-right", "--count", "HEAD...@{u}"]);
    const parsed = counts?.split(/\s+/).map(Number);
    if (parsed && parsed.length === 2 && parsed.every((n) => Number.isFinite(n))) {
      [aheadCount, behindCount] = parsed;
    }
  }
  let lastFetchAt: string | null = null;
  const gitDir = tryGit(["rev-parse", "--git-dir"]);
  if (gitDir) {
    try {
      lastFetchAt = statSync(join(gitDir, "FETCH_HEAD")).mtime.toISOString();
    } catch { /* no fetch has ever happened in this working tree — stays null, not guessed */ }
  }
  return { remote_tracking_ref: remoteTrackingRef, remote_tracking_head: remoteTrackingHead, ahead_count: aheadCount, behind_count: behindCount, last_fetch_at: lastFetchAt };
}

export type SyncState = "IN_SYNC" | "LOCAL_AHEAD" | "REMOTE_AHEAD" | "DIVERGED" | "DIRTY_LOCAL" | "UNKNOWN";

function classifySyncState(dirty: boolean, ahead: number | null, behind: number | null): SyncState {
  if (dirty) return "DIRTY_LOCAL";
  if (ahead === null || behind === null) return "UNKNOWN";
  if (ahead === 0 && behind === 0) return "IN_SYNC";
  if (ahead > 0 && behind === 0) return "LOCAL_AHEAD";
  if (ahead === 0 && behind > 0) return "REMOTE_AHEAD";
  return "DIVERGED";
}

function writeManifest(): BuildManifest {
  const buildHash = computeBuildHash();
  const buildTime = new Date().toISOString();
  const revision = readRuntimeRevision();
  const repoUrl = sourceRepository();
  const provenance = githubProvenance(repoUrl);
  const tracking = remoteTrackingState();
  const syncState = classifySyncState(revision.dirty, tracking.ahead_count, tracking.behind_count);
  const manifest: BuildManifest = {
    PROGRAM_ID: "conversation-runtime",
    BUILD_ID: `${buildTime}_${buildHash.slice(0, 12)}`,
    BUILD_TIME: buildTime,
    BUILD_HASH: buildHash,
    BUILD_FROM_COMMIT: revision.revision,
    BUILD_FROM_COMMIT_SOURCE: revision.source,
    BUILD_FROM_COMMIT_DIRTY: revision.dirty,
    BUILD_FROM_COMMIT_REASON: revision.reason,
    SOURCE_REPOSITORY: repoUrl,
    SOURCE_PATH: "control/conversation-runtime/main.ts",
    // CONNECT_SOURCE_IDENTITY_AND_GITHUB_PROVENANCE_TO_SELF_KNOWLEDGE additions:
    LOCAL_WORKTREE: localWorktree(),
    BRANCH: currentBranch(),
    REMOTE_PROVIDER: provenance.provider,
    REPOSITORY_ID: provenance.repository_id,
    REMOTE_TRACKING_REF: tracking.remote_tracking_ref,
    REMOTE_TRACKING_HEAD: tracking.remote_tracking_head,
    AHEAD_COUNT: tracking.ahead_count,
    BEHIND_COUNT: tracking.behind_count,
    LAST_FETCH_AT: tracking.last_fetch_at,
    SYNC_STATE: syncState,
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  return manifest;
}

const written = writeManifest();
console.log(`build-manifest.json written: ${MANIFEST_PATH}`);
console.log(JSON.stringify(written, null, 2));
