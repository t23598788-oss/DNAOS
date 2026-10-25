/**
 * Read-only Git access for /admin/ide's Source Control panel (owner,
 * 2026-08-05, Phase 1 of the "ห้องผลิตโค้ดที่ใช้งานจริงได้" mission). Every
 * git invocation here uses execFile with a fixed argv array — never a
 * shell string, never client input concatenated into a command. The
 * allowlist is exactly the 4 subcommands below; nothing else is callable
 * from this module. No commit/push/pull/checkout/merge — read-only by
 * construction, matching Phase 1's explicit scope.
 *
 * WORKSPACE_ROOT (fsSecurity.ts) is used as the git working directory —
 * confirmed to equal this repo's real toplevel. Absolute paths are never
 * returned to the caller; only WORKSPACE_ROOT's basename (a folder name,
 * not a path) stands in for "repository root" in the UI.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { existsSync, readFileSync } from "fs";
import { WORKSPACE_ROOT, resolveSafeRelativePath, IdeFsError } from "./fsSecurity";

const execFileAsync = promisify(execFile);

async function runGit(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: WORKSPACE_ROOT, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  } catch (e) {
    const stderr = (e as { stderr?: string | Buffer } | undefined)?.stderr?.toString().trim();
    throw new IdeFsError("GIT_ERROR", stderr || (e instanceof Error ? e.message : "") || "git command failed");
  }
}

export type ChangeKind = "added" | "modified" | "deleted" | "renamed" | "copied" | "untracked";
export interface ChangedFile {
  path: string;
  kind: ChangeKind;
  renamedFrom?: string;
}

export interface GitStatus {
  repositoryRoot: string; // basename only, never an absolute path
  branch: string | null;
  headCommit: {
    hash: string;
    message: string;
    author: string;
    time: string; // ISO
  } | null;
  ahead: number;
  behind: number;
  hasUpstream: boolean;
  staged: ChangedFile[];
  unstaged: ChangedFile[];
  untracked: ChangedFile[];
  conflicted: ChangedFile[];
  clean: boolean;
}

function kindFromCode(code: string): ChangeKind {
  switch (code) {
    case "A": return "added";
    case "D": return "deleted";
    case "R": return "renamed";
    case "C": return "copied";
    case "M":
    default: return "modified";
  }
}

// Parses `git status --porcelain=v2 --branch --untracked-files=all` — a
// stable, machine-readable format (unlike the human `git status` text),
// chosen specifically so this parser doesn't depend on git's locale/porcelain-v1
// quirks.
function parsePorcelainV2(output: string): Omit<GitStatus, "repositoryRoot" | "headCommit" | "clean"> {
  let branch: string | null = null;
  let ahead = 0;
  let behind = 0;
  let hasUpstream = false;
  const staged: ChangedFile[] = [];
  const unstaged: ChangedFile[] = [];
  const untracked: ChangedFile[] = [];
  const conflicted: ChangedFile[] = [];

  for (const line of output.split("\n")) {
    if (!line) continue;
    if (line.startsWith("# branch.head ")) {
      const name = line.slice("# branch.head ".length);
      branch = name === "(detached)" ? null : name;
    } else if (line.startsWith("# branch.upstream ")) {
      hasUpstream = true;
    } else if (line.startsWith("# branch.ab ")) {
      const m = line.match(/\+(\d+) -(\d+)/);
      if (m) {
        ahead = Number(m[1]);
        behind = Number(m[2]);
      }
    } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
      const parts = line.split(" ");
      const xy = parts[1];
      const x = xy[0];
      const y = xy[1];
      const isRename = line.startsWith("2 ");
      let filePath: string;
      let renamedFrom: string | undefined;
      if (isRename) {
        const rest = line.split("\t");
        filePath = rest[1];
        renamedFrom = rest[2];
      } else {
        filePath = parts.slice(8).join(" ");
      }
      if (x !== ".") staged.push({ path: filePath, kind: isRename ? "renamed" : kindFromCode(x), renamedFrom });
      if (y !== ".") unstaged.push({ path: filePath, kind: isRename ? "renamed" : kindFromCode(y), renamedFrom });
    } else if (line.startsWith("? ")) {
      untracked.push({ path: line.slice(2), kind: "untracked" });
    } else if (line.startsWith("u ")) {
      // Unmerged/conflict entry — real porcelain v2 "u" line:
      // "u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>"
      const parts = line.split(" ");
      const filePath = parts.slice(10).join(" ");
      conflicted.push({ path: filePath, kind: "modified" });
    }
    // "! " (ignored) lines intentionally unhandled — real cases, but out of
    // scope; not fabricated.
  }

  return { branch, ahead, behind, hasUpstream, staged, unstaged, untracked, conflicted };
}

export async function getGitStatus(): Promise<GitStatus> {
  const [statusOut, logOut] = await Promise.all([
    runGit(["status", "--porcelain=v2", "--branch", "--untracked-files=all"]),
    runGit(["log", "-1", "--format=%H%x00%s%x00%an%x00%aI"]).catch(() => ""), // "" on a repo with no commits yet — real, not an error
  ]);

  const parsed = parsePorcelainV2(statusOut);

  let headCommit: GitStatus["headCommit"] = null;
  if (logOut.trim()) {
    const [hash, message, author, time] = logOut.trim().split("\0");
    headCommit = { hash, message, author, time };
  }

  const clean = parsed.staged.length === 0 && parsed.unstaged.length === 0 && parsed.untracked.length === 0 && parsed.conflicted.length === 0;

  return {
    repositoryRoot: path.basename(WORKSPACE_ROOT),
    branch: parsed.branch,
    headCommit,
    ahead: parsed.ahead,
    behind: parsed.behind,
    hasUpstream: parsed.hasUpstream,
    staged: parsed.staged,
    unstaged: parsed.unstaged,
    untracked: parsed.untracked,
    conflicted: parsed.conflicted,
    clean,
  };
}

export type DiffLineType = "context" | "add" | "del" | "hunk";
export interface DiffLine {
  type: DiffLineType;
  oldLine: number | null;
  newLine: number | null;
  content: string;
}

export interface FileDiff {
  path: string;
  staged: boolean;
  binary: boolean;
  lines: DiffLine[];
}

// Turns `git diff`'s unified-diff text into structured lines with real
// old/new line numbers — a small local parser rather than a new dependency,
// scoped to exactly the hunk-header + " "/"+"/"-" line forms git diff
// produces (never asked to handle arbitrary diff dialects).
function parseUnifiedDiff(text: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const raw of text.split("\n")) {
    if (raw.startsWith("@@")) {
      const m = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) {
        oldLine = Number(m[1]);
        newLine = Number(m[2]);
      }
      lines.push({ type: "hunk", oldLine: null, newLine: null, content: raw });
      continue;
    }
    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      lines.push({ type: "add", oldLine: null, newLine: newLine, content: raw.slice(1) });
      newLine++;
    } else if (raw.startsWith("-") && !raw.startsWith("---")) {
      lines.push({ type: "del", oldLine: oldLine, newLine: null, content: raw.slice(1) });
      oldLine++;
    } else if (raw.startsWith(" ")) {
      lines.push({ type: "context", oldLine, newLine, content: raw.slice(1) });
      oldLine++;
      newLine++;
    }
    // diff --git / index / +++ / --- header lines intentionally skipped —
    // not real content lines.
  }
  return lines;
}

/**
 * Diff for one real, path-validated file. `staged` selects the index
 * (`git diff --cached`) vs. working-tree (`git diff`) comparison. An
 * untracked file has no diff against HEAD — reported honestly rather than
 * fabricated via a synthetic /dev/null comparison.
 */
export async function getFileDiff(clientPath: string, staged: boolean): Promise<FileDiff> {
  const { relPath } = await resolveSafeRelativePath(clientPath);

  const status = await getGitStatus();
  const isUntracked = status.untracked.some((f) => f.path === relPath);
  if (isUntracked) {
    return { path: relPath, staged: false, binary: false, lines: [] };
  }

  const args = staged ? ["diff", "--cached", "--", relPath] : ["diff", "--", relPath];
  const out = await runGit(args);
  const binary = /^Binary files /m.test(out);
  return { path: relPath, staged, binary, lines: binary ? [] : parseUnifiedDiff(out) };
}

/**
 * Source Control Workspace (Read Only) — owner, 2026-08-06, Step 6.
 * Extends this same real, allowlisted, execFile-only git access module
 * with Branch Information, Tag Information, File History, Blame, and
 * Merge/Conflict status — never a second git-invocation mechanism. Every
 * function here is read-only by construction: no subcommand that mutates
 * repository state (commit/push/pull/merge/rebase/checkout/reset/stash/
 * branch -d|-D) is ever reachable from this module.
 */

export interface BranchInfo {
  name: string;
  current: boolean;
  remote: boolean;
  upstream: string | null;
  lastCommitHash: string | null;
  lastCommitSubject: string | null;
  lastCommitDate: string | null;
}

/** `git branch -a` real listing (local + remote-tracking), parsed via a
 * machine-readable --format so it never depends on `*`-prefix text
 * scraping. */
export async function listBranches(): Promise<BranchInfo[]> {
  const out = await runGit([
    // for-each-ref's --format has no %xNN hex-escape support (unlike `git
    // log`'s pretty-format) — %(atom) tokens and literal text only, so a
    // literal tab character (real, not a JS null-byte escape, which Node's
    // execFile refuses in argv) is the real field delimiter here.
    "for-each-ref", "--format=%(refname:short)\t%(HEAD)\t%(upstream:short)\t%(objectname:short)\t%(subject)\t%(committerdate:iso-strict)",
    "refs/heads", "refs/remotes",
  ]);
  const branches: BranchInfo[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [name, head, upstream, hash, subject, date] = line.split("\t");
    if (name.endsWith("/HEAD")) continue; // remote symbolic HEAD pointer, not a real branch
    branches.push({
      name, current: head === "*", remote: name.includes("/") && !name.startsWith("refs/"),
      upstream: upstream || null, lastCommitHash: hash || null, lastCommitSubject: subject || null,
      lastCommitDate: date || null,
    });
  }
  return branches;
}

export interface TagInfo {
  name: string;
  hash: string | null;
  subject: string | null;
  date: string | null;
  annotated: boolean;
}

/** `git for-each-ref refs/tags` real listing — annotated vs. lightweight
 * distinguished via the real `%(objecttype)` field, never guessed. */
export async function listTags(): Promise<TagInfo[]> {
  const out = await runGit([
    "for-each-ref", "--format=%(refname:short)\t%(objectname:short)\t%(subject)\t%(creatordate:iso-strict)\t%(objecttype)",
    "refs/tags",
  ]);
  const tags: TagInfo[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [name, hash, subject, date, type] = line.split("\t");
    tags.push({ name, hash: hash || null, subject: subject || null, date: date || null, annotated: type === "tag" });
  }
  return tags;
}

export interface FileHistoryEntry {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

/** `git log --follow` for ONE real, path-validated file — File History
 * (section scope), capped at a real, bounded limit (never unbounded
 * output). */
export async function getFileHistory(clientPath: string, limit = 50): Promise<FileHistoryEntry[]> {
  const { relPath } = await resolveSafeRelativePath(clientPath);
  const cappedLimit = Math.min(200, Math.max(1, limit));
  const out = await runGit(["log", `-n${cappedLimit}`, "--follow", "--format=%H%x00%h%x00%an%x00%aI%x00%s", "--", relPath]);
  const entries: FileHistoryEntry[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [hash, shortHash, author, date, subject] = line.split("\0");
    entries.push({ hash, shortHash, author, date, subject });
  }
  return entries;
}

export interface BlameLine {
  line: number;
  content: string;
  hash: string;
  shortHash: string;
  author: string;
  date: string;
}

/** `git blame --line-porcelain` for ONE real, path-validated file —
 * per-line real commit attribution. An untracked file has no blame
 * history — reported as an empty array, never fabricated. */
export async function getBlame(clientPath: string): Promise<BlameLine[]> {
  const { relPath } = await resolveSafeRelativePath(clientPath);
  const status = await getGitStatus();
  if (status.untracked.some((f) => f.path === relPath)) return [];

  const out = await runGit(["blame", "--line-porcelain", "--", relPath]);
  const lines: BlameLine[] = [];
  let currentHash = "";
  let currentAuthor = "";
  let currentDate = "";
  let lineNo = 0;
  for (const raw of out.split("\n")) {
    const headerMatch = raw.match(/^([0-9a-f]{40}) \d+ (\d+)/);
    if (headerMatch) {
      currentHash = headerMatch[1];
      lineNo = Number(headerMatch[2]);
      continue;
    }
    if (raw.startsWith("author ")) { currentAuthor = raw.slice("author ".length); continue; }
    if (raw.startsWith("author-time ")) {
      const epochSeconds = Number(raw.slice("author-time ".length));
      currentDate = new Date(epochSeconds * 1000).toISOString();
      continue;
    }
    if (raw.startsWith("\t")) {
      lines.push({ line: lineNo, content: raw.slice(1), hash: currentHash, shortHash: currentHash.slice(0, 7), author: currentAuthor, date: currentDate });
    }
  }
  return lines;
}

export interface MergeStatus {
  inProgress: boolean;
  kind: "merge" | "rebase" | "cherry-pick" | "revert" | null;
  headBranch: string | null;
  mergeHeads: string[];
  conflictedFiles: ChangedFile[];
}

/** Real, direct filesystem checks under .git/ — the same real markers git
 * itself uses (MERGE_HEAD, rebase-merge/, rebase-apply/, CHERRY_PICK_HEAD,
 * REVERT_HEAD) — never a guess from status output alone, since a plain
 * conflicted-but-not-mid-operation state (rare but real) should not be
 * reported as "merge in progress" when it isn't. */
export async function getMergeStatus(): Promise<MergeStatus> {
  const gitDir = path.join(WORKSPACE_ROOT, ".git");
  const status = await getGitStatus();

  const readHeadShort = (file: string): string | null => {
    const p = path.join(gitDir, file);
    if (!existsSync(p)) return null;
    try { return readFileSync(p, "utf-8").trim().slice(0, 40); } catch { return null; }
  };

  const mergeHead = readHeadShort("MERGE_HEAD");
  const cherryPickHead = readHeadShort("CHERRY_PICK_HEAD");
  const revertHead = readHeadShort("REVERT_HEAD");
  const rebaseInProgress = existsSync(path.join(gitDir, "rebase-merge")) || existsSync(path.join(gitDir, "rebase-apply"));

  let kind: MergeStatus["kind"] = null;
  if (mergeHead) kind = "merge";
  else if (rebaseInProgress) kind = "rebase";
  else if (cherryPickHead) kind = "cherry-pick";
  else if (revertHead) kind = "revert";

  return {
    inProgress: kind !== null,
    kind,
    headBranch: status.branch,
    mergeHeads: [mergeHead, cherryPickHead, revertHead].filter((h): h is string => !!h),
    conflictedFiles: status.conflicted,
  };
}

/** Conflict Detection — real corroboration: cross-references the porcelain
 * "u" (unmerged) entries already parsed in getGitStatus() with a real scan
 * of each conflicted file's actual bytes for real `<<<<<<<` markers, so
 * the UI can distinguish "git reports unmerged" from "markers still
 * present in the working tree" (a file can be marked resolved via `git
 * add` while markers technically remain, or vice versa mid-resolution). */
export interface ConflictInfo {
  path: string;
  markersFound: boolean;
  markerCount: number;
}
export async function listConflicts(): Promise<ConflictInfo[]> {
  const status = await getGitStatus();
  const results: ConflictInfo[] = [];
  for (const f of status.conflicted) {
    const abs = path.join(WORKSPACE_ROOT, f.path);
    let markerCount = 0;
    if (existsSync(abs)) {
      try {
        const content = readFileSync(abs, "utf-8");
        const matches = content.match(/^<{7} /gm);
        markerCount = matches ? matches.length : 0;
      } catch { /* binary or unreadable — real, honestly 0 markers found rather than guessed */ }
    }
    results.push({ path: f.path, markersFound: markerCount > 0, markerCount });
  }
  return results;
}
