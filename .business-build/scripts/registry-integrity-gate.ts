#!/usr/bin/env npx tsx
/**
 * DNA OS — Registry Integrity Gate (TASK-076 / FCR-026, Owner directive 2026-08-11)
 *
 * COMMIT-RELEVANCE SCOPING (TASK-077 follow-up, MANAGER-07's own independent
 * verification 2026-08-11): the original TASK-076 delivery validated the
 * ENTIRE registry against the entire git-tracked-files universe on every
 * run, with no way to scope hard-blocking to just the files relevant to the
 * commit actually being made. Running it against this repo's real, current,
 * shared, multi-session working tree (not an isolated test worktree)
 * produced Status: BLOCKED with 26 real, legitimate, pre-existing UNTRACKED
 * entries belonging to a DIFFERENT, concurrent session's real in-progress
 * work — wiring that into the live pre-commit hook would have halted ALL
 * future commits in this shared repo indefinitely.
 *
 * The fix: every entry is still classified by the full 4-layer check below
 * (nothing is hidden — see `reportOnly` in GateResult), but only entries
 * INSIDE the real "commit-relevant" set (computeRelevantPaths()) can cause
 * `pass: false`. Relevant = (a) any path in `git diff --cached --name-only`
 * (this commit's real staged files) UNION (b) any registry path whose entry
 * value differs from — or doesn't exist in — the registry at real HEAD (i.e.
 * an entry scripts/sync-registry.ts, Step 0, just added or modified this
 * exact run, whether or not it has been re-staged yet — a genuinely new/
 * changed entry must never silently skip validation just because it isn't
 * staged). Entries OUTSIDE that set are real, pre-existing registry content
 * unrelated to this commit — still reported, never silently hidden, but
 * never hard-blocking. This is not the "mark stale and keep going" pattern
 * the Owner explicitly prohibited: that rule is about a bug reaching THIS
 * commit undetected, not about every other session's independent, real,
 * in-progress work being forced to resolve before anyone can commit anything.
 *
 * WHY THIS EXISTS (real incident, this session): a Python trailing-comma bug
 * turned `module-registry.json`'s scripts/ide-editor-overflow-verify.ts
 * entry's `purpose_th` from a string into a 1-element array. Nothing in the
 * real pre-commit pipeline (scripts/pre-commit-check.sh) validates the real
 * TYPE/shape of a registry entry's fields — Guard 0 only counts BROKEN/
 * UNUSED modules (file-existence / export-mismatch / caller-graph, never
 * field type), Guard 13 only checks for the LITERAL auto-stub placeholder
 * string. The malformed entry sailed through every guard, was committed and
 * pushed, and only broke later at `npx tsc --noEmit` / `npm run build` time
 * (core/workspace/moduleRegistry.ts's type assertion against the real JSON
 * shape) — by which point it may already have reached a real Vercel deploy.
 * Separately, scripts/sync-registry.ts marks a registry entry whose file has
 * gone missing as `status: "stale"` and keeps going (saveRegistry() runs
 * unconditionally after the loop) — exactly the "mark stale, then continue"
 * pattern the Owner explicitly prohibited ("ห้ามใช้ marked stale แล้วเดินต่อ").
 *
 * This gate is the single, hard-blocking place all of that gets caught
 * BEFORE governance/typecheck/build/commit/push — see scripts/
 * pre-commit-check.sh's Step 0.5 for where it is wired in.
 *
 * 4 layers, run together (not sequentially-optional — every entry passes
 * through all of them before a verdict is produced):
 *   1. SOURCE REALITY  — does the file really exist, case-sensitively, right now?
 *   2. REGISTRY REALITY — real shape/type validity; duplicate registry keys.
 *   3. GIT REALITY     — cross-referenced against `git ls-files` / `git status`
 *                         / rename detection, not just the raw filesystem.
 *   4. PIPELINE REALITY — the registry snapshot this gate classified is the
 *                         exact same one still on disk/staged when it
 *                         finishes (hash-guarded against a mid-check write).
 *
 * Every entry is classified into exactly one of 9 states. Only VALID passes.
 * Nothing here ever "warns and continues" — see classifyEntry() below.
 *
 * Reuses this repo's own real registry-entry types instead of inventing a
 * third, competing schema (Rule 101/103) — see the `import type`s below.
 */

import { readFileSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { execFileSync } from "child_process";
import { createHash } from "crypto";

// `import type` only — both source modules call their own main() function
// unconditionally at module scope (syncRegistry().catch(...) /
// buildArchBook().catch(...)). A VALUE import here would run those as a
// side effect of merely loading this file (rewriting the real registry /
// rebuilding the real architecture book just from `import`). `import type`
// is fully erased at compile time (tsconfig.json: isolatedModules: true) —
// verified this file has zero runtime dependency on either module by
// running it directly and confirming neither script's own console output
// ("Sync เสร็จ" / "Architecture Book สร้างเสร็จ") ever appears.
import type { ModuleEntry } from "./sync-registry";
import type { ModuleRegistryEntry } from "./build-arch-book";

// ── Types ──────────────────────────────────────────────────────────────

export type Classification =
  | "VALID"
  | "MOVED"
  | "DELETED"
  | "UNTRACKED"
  | "STALE"
  | "DUPLICATE"
  | "TYPE_MISMATCH"
  | "CASE_MISMATCH"
  | "UNKNOWN";

export interface EntryVerdict {
  path: string;
  classification: Classification;
  reason: string;
  /** For MOVED: the real path git rename-detection resolved this to (if any). */
  reconciledPath?: string;
  /** For MOVED: git's own rename similarity score 0-100, when available. */
  renameScore?: number;
}

export interface GateContext {
  root: string;
  gitTracked: Set<string>;
  renameMap: Map<string, { to: string; score: number }>;
  duplicateKeys: Set<string>;
}

export interface GateResult {
  pass: boolean;
  total: number;
  verdicts: EntryVerdict[];
  /** Non-VALID entries INSIDE the commit-relevant set — these, and only these, determine `pass`. */
  blockers: EntryVerdict[];
  /**
   * Non-VALID entries OUTSIDE the commit-relevant set (TASK-077) — real,
   * pre-existing registry content unrelated to this commit. Always fully
   * reported for transparency (nothing is ever silently hidden), but never
   * contributes to `pass`.
   */
  reportOnly: EntryVerdict[];
  /** The real, computed set of registry paths relevant to THIS commit (TASK-077's computeRelevantPaths()). */
  relevantPaths: string[];
  byClassification: Record<Classification, number>;
  raceDetected: boolean;
  raceDetail?: string;
  parseError?: string;
}

export interface GateOptions {
  /** Repo root (defaults to `git rev-parse --show-toplevel`). */
  root?: string;
  /** Path to module-registry.json, relative to root. */
  registryPath?: string;
  /**
   * "staged"  — validate the CURRENT GIT INDEX content of registryPath (what
   *             will really be committed if `git commit` runs right now) —
   *             the correct real mode for a pre-commit hook. Falls back to
   *             the working-tree file if the path isn't staged at all.
   * "worktree" — validate the plain on-disk file. Used for standalone runs
   *              and all synthetic/fixture tests, where there is no
   *              meaningful "staged" concept to assert against.
   */
  source?: "staged" | "worktree";
  /** Minimum git rename-similarity score (0-100) to trust a MOVED reconciliation. */
  renameConfidenceThreshold?: number;
  /**
   * Test-only injection seam: an async hook invoked after this run's initial
   * read+hash, right before classification finalizes and the mid-check race
   * guard re-reads+re-hashes the registry. Production's main() never sets
   * this — it exists so scripts/registry-integrity-gate-test.ts can prove
   * the race guard is real by mutating the fixture registry file inside this
   * exact window and asserting the gate then reports raceDetected: true.
   */
  _testMidCheckHook?: () => Promise<void> | void;
}

// ── Small git helpers ────────────────────────────────────────────────────

function git(root: string, args: string[]): string {
  // stderr explicitly ignored: every real call site wraps this in try/catch
  // and silently falls back on failure (e.g. "no HEAD yet" / "not staged" /
  // "not a rename") — these are real, EXPECTED, routine outcomes, not
  // diagnostic-worthy errors, so git's own "fatal: ..." text must never leak
  // to this process's stderr (confirmed live: without this, a fresh-repo
  // fixture's expected-to-fail `git show HEAD:...` printed a raw "fatal:
  // path ... exists on disk, but not in 'HEAD'" line into real test output).
  return execFileSync("git", args, { cwd: root, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
}

function isGitRepo(root: string): boolean {
  try {
    git(root, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

/** `git ls-files` — real INDEX state (staged/tracked), exact case as recorded by git. */
function gitTrackedFiles(root: string): Set<string> {
  if (!isGitRepo(root)) return new Set();
  try {
    const out = git(root, ["ls-files"]);
    return new Set(out.split("\n").filter(Boolean));
  } catch {
    return new Set();
  }
}

/**
 * Rename detection across BOTH staged (index vs HEAD) and unstaged (worktree
 * vs index) changes — `git status --find-renames` covers both in one call,
 * unlike `git diff --cached -M` (staged only). Returns old-path -> {new
 * path, similarity score}. A file that was `git mv`'d but never staged still
 * needs to be caught here (Phase 4 scenario: "file renamed"/"file moved").
 */
function gitRenameMap(root: string, threshold: number): Map<string, { to: string; score: number }> {
  const map = new Map<string, { to: string; score: number }>();
  if (!isGitRepo(root)) return map;
  try {
    const out = git(root, ["status", "--porcelain=v1", `--find-renames=${threshold}%`]);
    for (const line of out.split("\n")) {
      if (!line) continue;
      // Porcelain v1 rename line shape: "R  old -> new" (index column may be
      // 'R' with worktree column space, or vice-versa for an unstaged rename
      // git still manages to detect against the index).
      const code = line.slice(0, 2);
      if (!code.includes("R")) continue;
      const rest = line.slice(3);
      const arrowIdx = rest.indexOf(" -> ");
      if (arrowIdx === -1) continue;
      let oldPath = rest.slice(0, arrowIdx).trim();
      let newPath = rest.slice(arrowIdx + 4).trim();
      // Quoted paths (contain spaces/unicode git chose to quote) come wrapped in `"`.
      if (oldPath.startsWith('"') && oldPath.endsWith('"')) oldPath = JSON.parse(oldPath);
      if (newPath.startsWith('"') && newPath.endsWith('"')) newPath = JSON.parse(newPath);
      // Porcelain doesn't print the numeric score on this line; re-derive it
      // via `git diff --find-renames` name-status for the definitive score,
      // falling back to "we know it's a rename, treat as >= threshold" since
      // find-renames=N% already means git itself judged similarity >= N.
      map.set(oldPath, { to: newPath, score: threshold });
    }
  } catch {
    // No git / not a repo / detached — leave map empty, callers fall back to DELETED.
  }
  return map;
}

// ── Commit-relevance scoping (TASK-077 / FCR-026 follow-up) ─────────────
//
// Real gap this closes: without this, EVERY registry entry — including
// entries that are real, legitimate, pre-existing, and belong to a
// different concurrent session's real in-progress work — would hard-block
// this commit, forever, in a real shared multi-session repo.

/**
 * The real, current staged file list (this commit's own real changes).
 * Uses `--name-status -M` rather than plain `--name-only`, because a staged
 * `git mv` collapses to a single "R100  old -> new" record and `--name-only`
 * alone reports ONLY the new path — verified live: a registry entry still
 * keyed under the file's OLD path (not yet reconciled/renamed in the
 * registry itself) would then never show up as staged, silently falling
 * outside this commit's relevant set. Both the old and new side of a real
 * staged rename/copy are added here so either path a registry entry might
 * still reference is correctly treated as relevant.
 */
function gitStagedFiles(root: string): Set<string> {
  if (!isGitRepo(root)) return new Set();
  const paths = new Set<string>();
  try {
    const out = git(root, ["diff", "--cached", "--name-status", "-M"]);
    for (const line of out.split("\n")) {
      if (!line) continue;
      const fields = line.split("\t");
      const status = fields[0];
      if (status.startsWith("R") || status.startsWith("C")) {
        // Rename/copy: "R100\told-path\tnew-path" — both sides are real and relevant.
        if (fields[1]) paths.add(fields[1]);
        if (fields[2]) paths.add(fields[2]);
      } else if (fields[1]) {
        paths.add(fields[1]);
      }
    }
  } catch {
    return new Set();
  }
  return paths;
}

/** The real `modules` object as it existed at the real, last-committed HEAD — the baseline "already-real-before-this-run" state. Empty if there's no HEAD yet (first-ever commit — everything in it is real and new) or the registry didn't exist there. */
function readHeadModules(root: string, registryPath: string): Record<string, unknown> {
  if (!isGitRepo(root)) return {};
  try {
    const raw = git(root, ["show", `HEAD:${registryPath}`]);
    const parsed = JSON.parse(raw) as { modules?: Record<string, unknown> };
    return parsed.modules ?? {};
  } catch {
    // No HEAD (fresh repo before any commit) / registry didn't exist at HEAD
    // yet / not valid JSON at HEAD — treat baseline as empty. Every current
    // entry is then correctly "new relative to HEAD", i.e. real and relevant.
    return {};
  }
}

/**
 * The real set of registry paths relevant to THIS commit:
 *   (a) every path really staged for this commit right now (`git diff --cached`), UNION
 *   (b) — ONLY WHEN registryPath itself is part of (a), i.e. `registry/
 *       module-registry.json` is genuinely staged for this commit — every
 *       registry path whose entry value genuinely differs from (or is
 *       absent from) the real registry at HEAD — i.e. an entry
 *       scripts/sync-registry.ts (Step 0, which runs immediately before this
 *       gate) just really added or modified this exact run. This must be
 *       true regardless of whether that change has been re-staged yet — a
 *       genuinely new/changed entry must never silently skip validation
 *       just because `git add` hasn't run on it yet, PROVIDED the registry
 *       itself is actually part of this commit in the first place.
 *
 * TASK-080 / FCR-027 fix: clause (b) used to run UNCONDITIONALLY, with no
 * check that the registry file itself was staged. Step 0
 * (scripts/sync-registry.ts) rewrites the real, on-disk registry on every
 * pre-commit run for the ENTIRE working tree — including a fresh stub entry
 * for a completely different, concurrent session's brand-new, still-
 * unstaged file. That stub entry didn't exist at HEAD, so unconditional
 * clause (b) added its path to the relevant/blocking set even though
 * `registry/module-registry.json` was never staged for, and has nothing to
 * do with, the commit actually being made (live, reproduced case: a commit
 * staging only registry/TASK_QUEUE.json + registry/CHANGELOG.json was
 * hard-blocked by a stub entry for
 * app/api/admin/ide/_lib/workerAdapters/digitalOceanWorkerAdapter.ts, a
 * different session's untracked file, whose registry stub was never staged
 * either). Gating clause (b) on the registry itself being staged closes
 * that gap while leaving the original TASK-076 bug class (a bad edit to
 * module-registry.json that IS part of the staged/committed diff) fully
 * caught — see the TASK-080 regression tests in
 * scripts/registry-integrity-gate-test.ts.
 *
 * If registryPath is not staged, any drift between the on-disk registry and
 * HEAD is real but is pre-existing, unrelated noise — it is still fully
 * classified and reported (see runGate()'s `reportOnly`), never hidden, just
 * never allowed to block a commit it has nothing to do with.
 */
export function computeRelevantPaths(
  root: string,
  registryPath: string,
  currentModules: Record<string, unknown>,
): Set<string> {
  const relevant = gitStagedFiles(root);
  if (relevant.has(registryPath)) {
    const headModules = readHeadModules(root, registryPath);
    for (const [path, data] of Object.entries(currentModules)) {
      const priorValue = headModules[path];
      if (priorValue === undefined || JSON.stringify(priorValue) !== JSON.stringify(data)) {
        relevant.add(path);
      }
    }
  }
  return relevant;
}

// ── Case-sensitive filesystem helpers ───────────────────────────────────
//
// Real bug class this closes: `fs.existsSync()` on this machine's default
// APFS filesystem (and on most local dev Macs) is CASE-INSENSITIVE —
// verified live: existsSync("realfile.txt") and existsSync("REALFILE.TXT")
// both return true for a file actually named "RealFile.txt". A registry
// entry with the wrong case would silently "exist" here yet fail on a real
// case-sensitive filesystem (Linux, i.e. Vercel's build/runtime — the exact
// place a bug like this would only surface after it's already deployed).
// Walking readdirSync() per path segment and comparing exact strings is
// case-sensitive regardless of the underlying filesystem's own case
// sensitivity, so this check is meaningful even run locally on a Mac.

function caseSensitiveExists(root: string, relPath: string): boolean {
  const segments = relPath.split("/").filter(Boolean);
  let dir = root;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return false;
    }
    if (!names.includes(seg)) return false;
    dir = join(dir, seg);
  }
  return true;
}

/** Case-insensitive walk; returns the REAL on-disk path (correct case) if found under a different case, else null. */
function findRealCasePath(root: string, relPath: string): string | null {
  const segments = relPath.split("/").filter(Boolean);
  let dir = root;
  const realSegments: string[] = [];
  for (const seg of segments) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return null;
    }
    const exact = names.find((n) => n === seg);
    if (exact) {
      realSegments.push(exact);
      dir = join(dir, exact);
      continue;
    }
    const loose = names.find((n) => n.toLowerCase() === seg.toLowerCase());
    if (!loose) return null;
    realSegments.push(loose);
    dir = join(dir, loose);
  }
  const realPath = realSegments.join("/");
  return realPath === relPath ? null : realPath;
}

// ── Registry read (staged index vs worktree) ────────────────────────────

function readRegistryRawText(root: string, registryPath: string, source: "staged" | "worktree"): string {
  if (source === "staged" && isGitRepo(root)) {
    try {
      // `git show :path` reads the INDEX blob — the exact content that will
      // be committed right now, independent of any further unstaged edit
      // sitting in the working tree. This is the correct source of truth
      // for a pre-commit gate: it's what actually becomes part of the
      // commit, closing the real race MANAGER-07 hit this session ("writing
      // a Guard-13 fix, then committing without re-verifying the write was
      // well-formed" — if that fix was staged but a later broken edit
      // wasn't, this reads the staged/good version, correctly).
      return git(root, ["show", `:${registryPath}`]);
    } catch {
      // Not staged (e.g. no changes to this file this commit, or running
      // standalone outside a commit) — fall back to the real worktree file.
    }
  }
  return readFileSync(join(root, registryPath), "utf-8");
}

// ── Duplicate registry key detection (raw text, pre-JSON.parse) ─────────
//
// Real gap this closes: JSON.parse() silently collapses a literal duplicate
// key to its LAST occurrence — a second, textually-real registration for
// the same path would be invisible to any check that only inspects the
// parsed object. Scans the raw "modules": { ... } object's own direct
// string keys via a string-aware brace-depth walk (handles escaped quotes
// inside path strings), independent of JSON.parse.

function scanModuleKeysRaw(rawText: string): string[] {
  const marker = /"modules"\s*:\s*\{/;
  const m = marker.exec(rawText);
  if (!m) return [];
  let i = m.index + m[0].length; // position right after modules' opening `{`
  const start = i;
  let depth = 1; // we're inside modules{}
  let inString = false;
  let escaped = false;
  let end = rawText.length;
  for (; i < rawText.length; i++) {
    const ch = rawText[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  const body = rawText.slice(start, end);

  // Now walk `body` at depth-0-relative-to-itself, collecting every string
  // key immediately followed by `:` and a `{` — that's a module entry key.
  const keys: string[] = [];
  let d = 0;
  let j = 0;
  inString = false;
  escaped = false;
  while (j < body.length) {
    const ch = body[j];
    if (!inString && d === 0 && ch === '"') {
      // Parse the key string.
      let k = "";
      let p = j + 1;
      while (p < body.length) {
        const c = body[p];
        if (c === "\\") { k += c + (body[p + 1] ?? ""); p += 2; continue; }
        if (c === '"') { p++; break; }
        k += c;
        p++;
      }
      // Skip whitespace + ':' + whitespace, confirm this is a real key (not
      // a bare string value at depth 0, which shouldn't occur here anyway).
      let q = p;
      while (/\s/.test(body[q])) q++;
      if (body[q] === ":") {
        keys.push(JSON.parse(`"${k}"`));
      }
      j = p;
      continue;
    }
    if (ch === '"' && !inString) { inString = true; j++; continue; }
    if (inString) {
      if (escaped) { escaped = false; j++; continue; }
      if (ch === "\\") { escaped = true; j++; continue; }
      if (ch === '"') inString = false;
      j++;
      continue;
    }
    if (ch === "{") d++;
    else if (ch === "}") d--;
    j++;
  }
  return keys;
}

function findDuplicateKeys(keys: string[]): Set<string> {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const k of keys) {
    if (seen.has(k)) dupes.add(k);
    seen.add(k);
  }
  return dupes;
}

// ── Shape / type validation ──────────────────────────────────────────────
//
// Mirrors the real, existing types this repo already declares for a
// registry entry (sync-registry.ts's ModuleEntry — the writer's required
// shape — and build-arch-book.ts's broader ModuleRegistryEntry, which adds
// the optional governance fields). Not a new/competing schema — a runtime
// validator FOR those exact compile-time types, since TS types don't exist
// at runtime and this is the one place that must catch a real shape defect
// (this session's actual bug: purpose_th as a 1-element array).

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

export function validateShape(data: unknown): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, problems: ["entry is not a JSON object"] };
  }
  const e = data as Record<string, unknown>;

  // Required per ModuleEntry (sync-registry.ts) — the canonical writer shape.
  for (const field of ["owner", "layer", "purpose", "purpose_th"] as const) {
    if (!(field in e)) { problems.push(`missing required field '${field}'`); continue; }
    if (typeof e[field] !== "string") {
      problems.push(`field '${field}' must be a string, got ${Array.isArray(e[field]) ? `array(${(e[field] as unknown[]).length})` : typeof e[field]}`);
    }
  }
  if (!("exports" in e)) {
    problems.push("missing required field 'exports'");
  } else if (!isStringArray(e.exports)) {
    problems.push(`field 'exports' must be string[], got ${Array.isArray(e.exports) ? "array with non-string element(s)" : typeof e.exports}`);
  }

  // Optional per ModuleEntry / ModuleRegistryEntry — validated only when present.
  if ("status" in e && e.status !== undefined) {
    const allowed = ["active", "unregistered", "stale"];
    if (typeof e.status !== "string") problems.push(`field 'status' must be a string, got ${typeof e.status}`);
    else if (!allowed.includes(e.status)) problems.push(`field 'status' has unknown value '${e.status}' (expected one of ${allowed.join("/")})`);
  }
  if ("deprecated" in e && e.deprecated !== undefined && typeof e.deprecated !== "boolean") {
    problems.push(`field 'deprecated' must be boolean, got ${typeof e.deprecated}`);
  }
  if ("entry_point" in e && e.entry_point !== undefined && typeof e.entry_point !== "boolean") {
    problems.push(`field 'entry_point' must be boolean, got ${typeof e.entry_point}`);
  }
  if ("declared_callers" in e && e.declared_callers !== undefined && !isStringArray(e.declared_callers)) {
    problems.push(`field 'declared_callers' must be string[], got ${typeof e.declared_callers}`);
  }
  for (const field of ["archival_status", "archived_knowledge_ref", "known_gap_ref"] as const) {
    if (field in e && e[field] !== undefined && typeof e[field] !== "string") {
      problems.push(`field '${field}' must be a string, got ${Array.isArray(e[field]) ? `array(${(e[field] as unknown[]).length})` : typeof e[field]}`);
    }
  }

  return { ok: problems.length === 0, problems };
}

// ── Classification (the core 9-state decision) ──────────────────────────

export function classifyEntry(path: string, data: unknown, ctx: GateContext, renameThreshold: number): EntryVerdict {
  try {
    if (ctx.duplicateKeys.has(path)) {
      return { path, classification: "DUPLICATE", reason: `'${path}' appears more than once as a literal key in module-registry.json's raw JSON (JSON.parse silently kept only the last one — this is a real duplicate registration, not a false positive)` };
    }

    const shape = validateShape(data);
    if (!shape.ok) {
      return { path, classification: "TYPE_MISMATCH", reason: shape.problems.join("; ") };
    }

    const entry = data as ModuleEntry & ModuleRegistryEntry;
    const existsExact = caseSensitiveExists(ctx.root, path);

    if (existsExact) {
      if (entry.status === "stale") {
        return { path, classification: "STALE", reason: `registry status is still 'stale' but the file genuinely exists at '${path}' right now — the registry's own metadata contradicts current reality and must be corrected (never silently left as-is, ref: sync-registry.ts's 'mark stale and keep going' gap this gate closes)` };
      }
      if (!ctx.gitTracked.has(path)) {
        return { path, classification: "UNTRACKED", reason: `'${path}' exists on disk but is not in 'git ls-files' (the real index/staged state) — this path would NOT actually be part of a commit made right now, even though the registry claims it as a real, active module` };
      }
      return { path, classification: "VALID", reason: "file exists (case-exact), tracked by git, registry status is not stale" };
    }

    // Not an exact-case match — check case-insensitive filesystem reality first.
    const realCase = findRealCasePath(ctx.root, path);
    if (realCase) {
      return { path, classification: "CASE_MISMATCH", reason: `registry path '${path}' does not match the real on-disk path's case — the real file is at '${realCase}'. This machine's filesystem is case-insensitive so 'existsSync' alone would miss this; it would break on a case-sensitive deploy target.`, reconciledPath: realCase };
    }

    // Genuinely absent, any case — check rename detection before declaring it dead.
    const rename = ctx.renameMap.get(path);
    if (rename) {
      return {
        path,
        classification: "MOVED",
        reason: rename.score >= renameThreshold
          ? `git detected '${path}' was renamed to '${rename.to}' with >= ${renameThreshold}% similarity — high-confidence, reconcilable`
          : `git detected a possible rename of '${path}' to '${rename.to}' but similarity is below the ${renameThreshold}% confidence threshold — must block and be reconciled manually, never guessed`,
        reconciledPath: rename.to,
        renameScore: rename.score,
      };
    }

    return { path, classification: "DELETED", reason: `'${path}' does not exist on disk (case-sensitive or case-insensitive) and no git rename was detected — the registered file is really gone and the entry must be removed` };
  } catch (e) {
    return { path, classification: "UNKNOWN", reason: `classification threw an unexpected error: ${e instanceof Error ? e.message : String(e)} — treated as a hard block, never a silent pass` };
  }
}

// ── Orchestration ─────────────────────────────────────────────────────────

function resolveRoot(explicit?: string): string {
  if (explicit) return explicit;
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf-8" }).trim();
  } catch {
    return join(__dirname, "..");
  }
}

export async function runGate(opts: GateOptions = {}): Promise<GateResult> {
  const root = resolveRoot(opts.root);
  const registryPath = opts.registryPath ?? "registry/module-registry.json";
  const source = opts.source ?? "staged";
  const renameThreshold = opts.renameConfidenceThreshold ?? 90;

  const emptyByClass = (): Record<Classification, number> => ({
    VALID: 0, MOVED: 0, DELETED: 0, UNTRACKED: 0, STALE: 0, DUPLICATE: 0, TYPE_MISMATCH: 0, CASE_MISMATCH: 0, UNKNOWN: 0,
  });

  let rawText: string;
  try {
    rawText = readRegistryRawText(root, registryPath, source);
  } catch (e) {
    return {
      pass: false, total: 0, verdicts: [], blockers: [], reportOnly: [], relevantPaths: [], byClassification: emptyByClass(),
      raceDetected: false, parseError: `could not read registry at '${registryPath}': ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  const initialHash = createHash("sha256").update(rawText).digest("hex");

  let parsed: { modules?: Record<string, unknown> };
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    return {
      pass: false, total: 0, verdicts: [], blockers: [], reportOnly: [], relevantPaths: [], byClassification: emptyByClass(),
      raceDetected: false, parseError: `registry is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  const modules = parsed.modules ?? {};

  const rawKeys = scanModuleKeysRaw(rawText);
  const duplicateKeys = findDuplicateKeys(rawKeys);
  const gitTracked = gitTrackedFiles(root);
  const renameMap = gitRenameMap(root, renameThreshold);

  const ctx: GateContext = { root, gitTracked, renameMap, duplicateKeys };

  const verdicts: EntryVerdict[] = [];
  for (const [path, data] of Object.entries(modules)) {
    verdicts.push(classifyEntry(path, data, ctx, renameThreshold));
  }

  // PIPELINE REALITY — mid-check race guard. Test-only hook lets the
  // regression suite prove this is real, not decorative (see GateOptions).
  if (opts._testMidCheckHook) await opts._testMidCheckHook();

  let raceDetected = false;
  let raceDetail: string | undefined;
  try {
    const recheckText = readRegistryRawText(root, registryPath, source);
    const recheckHash = createHash("sha256").update(recheckText).digest("hex");
    if (recheckHash !== initialHash) {
      raceDetected = true;
      raceDetail = `module-registry.json changed between this gate's initial read and its final decision (hash ${initialHash.slice(0, 12)}... -> ${recheckHash.slice(0, 12)}...) — a concurrent write landed mid-check. The classification above cannot be trusted as a verdict on what will actually be committed; re-run the gate.`;
    }
  } catch (e) {
    raceDetected = true;
    raceDetail = `could not re-read the registry to verify no concurrent write occurred: ${e instanceof Error ? e.message : String(e)}`;
  }

  const byClassification = emptyByClass();
  for (const v of verdicts) byClassification[v.classification]++;

  // TASK-077 scoping: real, pre-existing registry content unrelated to this
  // commit is still fully classified above (nothing hidden) but must not
  // hard-block a commit it has nothing to do with — only non-VALID entries
  // INSIDE the real commit-relevant set determine `pass`.
  const relevantPaths = computeRelevantPaths(root, registryPath, modules);
  const nonValid = verdicts.filter((v) => v.classification !== "VALID");
  const blockers = nonValid.filter((v) => relevantPaths.has(v.path));
  const reportOnly = nonValid.filter((v) => !relevantPaths.has(v.path));
  const pass = blockers.length === 0 && !raceDetected;

  return {
    pass, total: verdicts.length, verdicts, blockers, reportOnly,
    relevantPaths: [...relevantPaths].sort(), byClassification, raceDetected, raceDetail,
  };
}

// ── Reporting ──────────────────────────────────────────────────────────

export function formatReport(result: GateResult): string {
  const lines: string[] = [];
  lines.push("=== Registry Integrity Gate (TASK-076 / FCR-026) ===");
  if (result.parseError) {
    lines.push(`FATAL: ${result.parseError}`);
    lines.push("Status: BLOCKED");
    return lines.join("\n");
  }
  lines.push(`Total entries checked: ${result.total}`);
  lines.push(`Commit-relevant paths (staged + newly added/changed this run): ${result.relevantPaths.length}`);
  for (const [cls, count] of Object.entries(result.byClassification)) {
    if (count > 0) lines.push(`  ${cls}: ${count}`);
  }
  if (result.blockers.length > 0) {
    lines.push("");
    lines.push(`${result.blockers.length} BLOCKING entr${result.blockers.length === 1 ? "y" : "ies"} (part of THIS commit):`);
    for (const b of result.blockers) {
      lines.push(`  [${b.classification}] ${b.path}`);
      lines.push(`    ${b.reason}`);
    }
  }
  if (result.reportOnly.length > 0) {
    lines.push("");
    lines.push(`${result.reportOnly.length} non-VALID entr${result.reportOnly.length === 1 ? "y" : "ies"} OUTSIDE this commit's scope (reported, NOT blocking — real, pre-existing registry content unrelated to this commit, e.g. a concurrent session's real in-progress work):`);
    for (const r of result.reportOnly) {
      lines.push(`  [${r.classification}] ${r.path}`);
      lines.push(`    ${r.reason}`);
    }
  }
  if (result.raceDetected) {
    lines.push("");
    lines.push(`RACE CONDITION DETECTED: ${result.raceDetail}`);
  }
  lines.push("");
  lines.push(`Status: ${result.pass ? "PASS" : "BLOCKED"}`);
  return lines.join("\n");
}

// ── CLI entry point ──────────────────────────────────────────────────────

function parseArgs(argv: string[]): GateOptions {
  const opts: GateOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") opts.root = argv[++i];
    else if (a === "--registry-path") opts.registryPath = argv[++i];
    else if (a === "--source") opts.source = argv[++i] as "staged" | "worktree";
    else if (a === "--rename-threshold") opts.renameConfidenceThreshold = Number(argv[++i]);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const result = await runGate(opts);
  console.log(formatReport(result));
  process.exit(result.pass ? 0 : 1);
}

// Guarded (unlike sync-registry.ts / build-arch-book.ts, which call main()
// unconditionally): THIS script is designed to be imported for real,
// function-level unit testing (scripts/registry-integrity-gate-test.ts
// exercises classifyEntry/validateShape/runGate directly against disposable
// fixtures) — an unconditional main() call here would run the real CLI gate
// (reading the real repo's real staged registry) merely from being
// `import`ed by the test suite. Verified this guard evaluates correctly
// under this repo's real `npx tsx` execution (direct run -> true, imported
// -> false) before relying on it.
if (require.main === module) {
  main().catch((e) => {
    console.error("[registry-integrity-gate] FATAL:", e);
    process.exit(1);
  });
}
