/**
 * หน้าที่: the ONLY file in `software/live-census/` allowed to touch a real host
 * ambient — filesystem, clock, git, process table. Every observation the census
 * derives enters through here, so `./derive.ts` stays a pure function of
 * observed facts and can be tested against synthetic input.
 *
 * Input: none.
 * Output: filesystem walk, source digest, git facts, launchd/process facts,
 * registry rows, verification ledger read/append.
 * Dependency ที่อนุญาต: node builtins only.
 * สิ่งที่ห้ามแตะ: never let a failed observation become a confident answer. Every
 * function here returns null/empty on failure so the caller records UNKNOWN
 * rather than inventing a value.
 */

import { existsSync, readFileSync, readdirSync, statSync, appendFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, relative, dirname } from "node:path";
import type { VerificationRecord } from "./types";

export const REPO_ROOT = process.cwd();
const LEDGER_PATH = join(REPO_ROOT, "software/live-census/data/verification-ledger.jsonl");

/** Directories that are never capabilities. Derived boundaries, not a curated allowlist. */
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".claude", ".npm-cache", "tests", "__sandbox__",
  "data", "candidates", "migrations", "sources", "evidence", "definition",
  "live-check", "adapters", "app-host", "test-workspace", "launchagents",
  "process-locks", "coordination", "reports", "test-fixtures", "scratchpad",
]);

export function nowIso(): string {
  return new Date().toISOString();
}

/** Every capability-shaped folder: a directory two levels deep holding at least one .ts/.mjs, plus the known deeper ones. */
export function discoverCapabilityFolders(): string[] {
  const found: string[] = [];
  const topLevel = safeReaddir(REPO_ROOT).filter((e) => {
    if (e.startsWith(".") || SKIP_DIRS.has(e)) return false;
    return isDir(join(REPO_ROOT, e));
  });
  for (const top of topLevel) {
    for (const second of safeReaddir(join(REPO_ROOT, top))) {
      const abs = join(REPO_ROOT, top, second);
      if (!isDir(abs) || SKIP_DIRS.has(second) || second.startsWith(".")) continue;
      found.push(`${top}/${second}`);
      // one level deeper, for providers/_shared/* and dna-os-circuit/ui/* shapes
      for (const third of safeReaddir(abs)) {
        const deep = join(abs, third);
        if (!isDir(deep) || SKIP_DIRS.has(third) || third.startsWith(".")) continue;
        if (codeFilesIn(deep).length > 0) found.push(`${top}/${second}/${third}`);
      }
    }
  }
  return [...new Set(found)].sort();
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Non-test code files directly in a folder (not recursive — a capability's own surface). */
export function codeFilesIn(absDir: string): string[] {
  return safeReaddir(absDir)
    .filter((f) => (f.endsWith(".ts") || f.endsWith(".mjs")) && !f.endsWith(".test.ts"))
    .sort();
}

export function testFilesFor(relPath: string): string[] {
  const out: string[] = [];
  const abs = join(REPO_ROOT, relPath);
  for (const f of safeReaddir(abs)) if (f.endsWith(".test.ts")) out.push(`${relPath}/${f}`);
  const testsDir = join(abs, "tests");
  if (isDir(testsDir)) for (const f of safeReaddir(testsDir)) if (f.endsWith(".test.ts")) out.push(`${relPath}/tests/${f}`);
  return out.sort();
}

/**
 * Digest over the capability's non-test source: sorted filename + content. This
 * is what makes staleness detectable — change any implementation byte and the
 * digest moves, so a verification pinned to the old digest no longer applies.
 * Tests are excluded on purpose: editing a test must not silently invalidate
 * the implementation's verification, and TEST_CHANGED is tracked separately.
 */
export function sourceDigest(relPath: string): string {
  const abs = join(REPO_ROOT, relPath);
  const files = codeFilesIn(abs);
  if (files.length === 0) return "NO_SOURCE";
  const hash = createHash("sha256");
  for (const f of files) {
    hash.update(f);
    try {
      hash.update(readFileSync(join(abs, f)));
    } catch {
      hash.update("UNREADABLE");
    }
  }
  return hash.digest("hex").slice(0, 16);
}

export function testDigest(relPath: string): string {
  const files = testFilesFor(relPath);
  if (files.length === 0) return "NO_TESTS";
  const hash = createHash("sha256");
  for (const f of files) {
    hash.update(f);
    try {
      hash.update(readFileSync(join(REPO_ROOT, f)));
    } catch {
      hash.update("UNREADABLE");
    }
  }
  return hash.digest("hex").slice(0, 16);
}

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export function headCommit(): string | null {
  return git(["rev-parse", "--short", "HEAD"]);
}

/** Last commit touching a path, or null when the path is entirely uncommitted. */
export function lastCommitFor(relPath: string): { sha: string; date: string } | null {
  const out = git(["log", "-1", "--format=%h|%cI", "--", relPath]);
  if (!out || !out.includes("|")) return null;
  const [sha, date] = out.split("|");
  return { sha, date };
}

export function isDirty(relPath: string): boolean {
  const out = git(["status", "--porcelain", "--", relPath]);
  return out !== null && out.length > 0;
}

/** Newest mtime under a path — used when nothing is committed yet. */
export function newestMtime(relPath: string): string | null {
  const abs = join(REPO_ROOT, relPath);
  let newest = 0;
  const walk = (d: string, depth: number): void => {
    if (depth > 2) return;
    for (const e of safeReaddir(d)) {
      const p = join(d, e);
      try {
        const st = statSync(p);
        if (st.isDirectory()) walk(p, depth + 1);
        else if (st.mtimeMs > newest) newest = st.mtimeMs;
      } catch { /* unreadable entry is not an observation */ }
    }
  };
  walk(abs, 0);
  return newest === 0 ? null : new Date(newest).toISOString();
}

/** Grep the repo for importers of a capability folder. Returns repo-relative importer paths. */
export function importersOf(relPath: string): string[] {
  const segment = relPath.split("/").pop()!;
  const out = git(["grep", "-l", "-E", `from ["'][^"']*${segment}(/[a-z-]+)?["']`, "--", "*.ts", "*.mjs"]);
  const tracked = out ? out.split("\n").filter(Boolean) : [];
  // git grep only sees tracked files; this repo has ~200 uncommitted paths, so
  // fall back to a filesystem grep too and merge. Missing an importer would
  // wrongly report a live capability as UNWIRED.
  let untracked: string[] = [];
  try {
    const raw = execFileSync(
      "grep",
      ["-rlE", `from ["'][^"']*${segment}(/[a-z-]+)?["']`, "--include=*.ts", "--include=*.mjs", "."],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    untracked = raw.split("\n").filter(Boolean).map((p) => relative(REPO_ROOT, join(REPO_ROOT, p)));
  } catch { /* no matches is a valid answer */ }
  return [...new Set([...tracked, ...untracked])]
    .filter((p) => !p.includes("node_modules"))
    .filter((p) => !p.startsWith(relPath + "/") && dirname(p) !== relPath)
    .sort();
}

/** Import specifiers a capability's own source declares — its real dependencies. */
export function declaredDependencies(relPath: string): string[] {
  const abs = join(REPO_ROOT, relPath);
  const deps = new Set<string>();
  for (const f of codeFilesIn(abs)) {
    let text: string;
    try {
      text = readFileSync(join(abs, f), "utf8");
    } catch {
      continue;
    }
    for (const m of text.matchAll(/from ["'](\.\.[^"']*)["']/g)) {
      // RESOLVE the specifier against the importing capability's own directory.
      // A naive `split("/")` + slice loses the top-level dir for sibling imports:
      // `../agent-gateway/contract` from control/command-router would yield
      // "agent-gateway/contract" instead of "control/agent-gateway", which then
      // reports as a BROKEN edge to a capability that plainly exists.
      const resolved = relative(REPO_ROOT, join(abs, m[1])).split("/");
      if (resolved.length >= 2 && resolved[0] !== "..") deps.add(resolved.slice(0, 2).join("/"));
    }
  }
  return [...deps].sort();
}

/** Live launchd jobs and whether they have a real pid. Observed, not assumed. */
export function launchdJobs(): { label: string; pid: string | null }[] {
  try {
    const raw = execFileSync("launchctl", ["list"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return raw
      .split("\n")
      .filter((l) => l.includes("com.dnaos."))
      .map((l) => {
        const cols = l.split(/\s+/);
        return { label: cols[2] ?? "unknown", pid: cols[0] === "-" ? null : cols[0] };
      });
  } catch {
    return [];
  }
}

/** Full command line of every live process that references this repo — the real runtime attribution. */
export function liveRepoProcesses(): string[] {
  try {
    const raw = execFileSync("ps", ["-Ao", "pid=,command="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return raw.split("\n").filter((l) => l.includes("DNA-OS-INFRASTRUCTURE") && !l.includes("ps -Ao"));
  } catch {
    return [];
  }
}

/** Registry rows from the file store, keyed by canonical_name. The live backend — postgres has zero tables. */
export function registryByName(): Map<string, string[]> {
  const path = join(REPO_ROOT, "software/registry-database/data/canonical/capabilities.jsonl");
  const map = new Map<string, string[]>();
  if (!existsSync(path)) return map;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return map;
  }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as { canonical_name?: string; capability_id?: string; verified_at?: string | null };
      if (!row.canonical_name || !row.capability_id) continue;
      const list = map.get(row.canonical_name) ?? [];
      list.push(`${row.capability_id}${row.verified_at ? `@${row.verified_at}` : "@unverified"}`);
      map.set(row.canonical_name, list);
    } catch { /* a malformed row is not a registration */ }
  }
  return map;
}

export function readVerificationLedger(): VerificationRecord[] {
  if (!existsSync(LEDGER_PATH)) return [];
  const out: VerificationRecord[] = [];
  try {
    for (const line of readFileSync(LEDGER_PATH, "utf8").split("\n")) {
      if (!line.trim()) continue;
      out.push(JSON.parse(line) as VerificationRecord);
    }
  } catch { /* partial ledger is still usable up to the bad line */ }
  return out;
}

/** Append-only: verification history is lineage and must never be rewritten. */
export function appendVerification(record: VerificationRecord): void {
  mkdirSync(dirname(LEDGER_PATH), { recursive: true });
  appendFileSync(LEDGER_PATH, `${JSON.stringify(record)}\n`, "utf8");
}

export function readFileIfExists(relPath: string): string | null {
  const abs = join(REPO_ROOT, relPath);
  if (!existsSync(abs)) return null;
  try {
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}
