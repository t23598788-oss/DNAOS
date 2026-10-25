/**
 * Duplicate File Scanner (owner, 2026-08-06) — REPORT ONLY, never deletes
 * anything. Finds real files matching the "<name> N.<ext>" pattern (the
 * classic cloud-sync conflict-copy naming, e.g. "page 2.tsx"), and for each
 * one reports: the real original counterpart (if it exists), whether the
 * duplicate is git-tracked, whether anything else in the real source tree
 * references its filename, its real last-modified time, and a conservative
 * safeToRemove SUGGESTION (never an action) — true only when the duplicate
 * is untracked, unreferenced, AND a real original exists to fall back to.
 * ownerConfirmation is always null here; a human decides, this script never
 * deletes or auto-confirms anything (per owner instruction: "ห้ามลบอัตโนมัติ").
 *
 * Run: npx tsx scripts/scan-duplicate-files.ts
 * Writes: registry/duplicate-scan-report.json
 */
import { promises as fs } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);
const ROOT = path.join(__dirname, "..");

const EXCLUDED_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", ".dnaos-trash"]);
const DUPLICATE_NAME_RE = /^(.*) (\d+)(\.[^.]+)$/; // "name 2.ext" -> ["name 2.ext", "name", "2", ".ext"]

interface DuplicateReportEntry {
  duplicate: string;
  original: string | null;
  originalExists: boolean;
  gitTracked: boolean;
  referencedElsewhere: boolean;
  lastModified: string;
  safeToRemove: boolean;
  ownerConfirmation: null;
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(abs);
    } else if (entry.isFile()) {
      yield abs;
    }
  }
}

async function loadGitTrackedSet(): Promise<Set<string>> {
  try {
    const { stdout } = await execFileAsync("git", ["ls-files"], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
    return new Set(stdout.split("\n").filter(Boolean));
  } catch {
    return new Set(); // not a git repo / git unavailable — real absence, not guessed
  }
}

async function isReferencedElsewhere(basename: string, ownAbsPath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["grep", "-l", "-F", "--", basename],
      { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 }
    );
    const hits = stdout.split("\n").filter(Boolean).map((p) => path.join(ROOT, p));
    return hits.some((p) => p !== ownAbsPath);
  } catch {
    // git grep exits non-zero when there are zero matches — that's a real
    // "not referenced", not a failure to report as unknown.
    return false;
  }
}

async function main() {
  const gitTracked = await loadGitTrackedSet();
  const entries: DuplicateReportEntry[] = [];

  for await (const absPath of walk(ROOT)) {
    const relPath = path.relative(ROOT, absPath);
    const base = path.basename(relPath);
    const match = base.match(DUPLICATE_NAME_RE);
    if (!match) continue;

    const dir = path.dirname(relPath);
    const originalBase = `${match[1]}${match[3]}`;
    const originalRel = dir === "." ? originalBase : `${dir}/${originalBase}`;
    const originalAbs = path.join(ROOT, originalRel);
    const originalExists = await fs.stat(originalAbs).then(() => true).catch(() => false);

    const stat = await fs.stat(absPath);
    const tracked = gitTracked.has(relPath.split(path.sep).join("/"));
    const referenced = await isReferencedElsewhere(base, absPath);

    entries.push({
      duplicate: relPath,
      original: originalExists ? originalRel : null,
      originalExists,
      gitTracked: tracked,
      referencedElsewhere: referenced,
      lastModified: stat.mtime.toISOString(),
      safeToRemove: !tracked && !referenced && originalExists,
      ownerConfirmation: null,
    });
  }

  entries.sort((a, b) => a.duplicate.localeCompare(b.duplicate));

  const report = {
    generated_at: new Date().toISOString(),
    policy: "Report only — this script NEVER deletes or moves anything. safeToRemove is a conservative suggestion (untracked + unreferenced + a real original exists), not an action. A human must set ownerConfirmation before any removal happens, and removal itself is a separate, manual step not performed by this script.",
    total_found: entries.length,
    suggested_safe_count: entries.filter((e) => e.safeToRemove).length,
    entries,
  };

  await fs.writeFile(path.join(ROOT, "registry/duplicate-scan-report.json"), JSON.stringify(report, null, 2) + "\n", "utf-8");
  console.log(`Duplicate File Scan: ${entries.length} candidate(s) found, ${report.suggested_safe_count} suggested safe-to-remove (owner confirmation still required).`);
  console.log("Report: registry/duplicate-scan-report.json");
}

main().catch((e) => {
  console.error("[scan-duplicate-files] Error:", e);
  process.exit(1);
});
