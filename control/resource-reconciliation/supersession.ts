/**
 * หน้าที่: detect SUPERSEDED_BY — when a new implementation has replaced an old
 * one — using evidence that is a record, not an impression.
 *
 * WHAT COUNTS AS EVIDENCE HERE, and nothing else does:
 *
 *  1. GIT RENAME. `git log --diff-filter=R -M --name-status` reports a rename
 *     when git's own similarity index says the new file IS the old file moved.
 *     That is the version-control system's finding, computed from content, not
 *     an inference of ours.
 *
 *  2. IDENTICAL CONTENT. Two tracked paths whose git blob hash is the same
 *     object. Not "similar", not "looks like a copy" — the same object, by the
 *     content-addressed identity git already computed when it stored them.
 *
 *  3. REGISTRY DUPLICATE. Two registered capabilities sharing a canonical name,
 *     as `software/live-census` already reports in `duplicates`. The registry
 *     said they are the same thing; we did not decide that.
 *
 * WHAT IS EXPLICITLY REJECTED: similar filenames ("foo.ts" vs "foo-v2.ts"),
 * adjacent timestamps, the same directory, a "2" suffix, and a commit message
 * that says "replaces". Every one of those is how a live implementation gets
 * mistaken for a dead one.
 *
 * DETECTION IS NOT PERMISSION. A supersession says the old path was replaced.
 * It says nothing about whether anything still uses it — that is `reconcile.ts`
 * and `decide.ts`, and a superseded resource with a live consumer is RETAIN.
 *
 * Input: an optional git ref to bound the history walk.
 * Output: `detectSupersessions`, `supersessionFor`.
 * Dependency ที่อนุญาต: ./types.ts, ./lineage.ts, git.
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่มกฎที่อาศัยชื่อไฟล์คล้ายกันหรือเวลาใกล้กัน.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { censusIndex, REPO_ROOT } from "./lineage";
import type { Provenance } from "./types";

export interface Supersession {
  old_path: string;
  new_path: string;
  /** Which evidence kind produced this. */
  basis: "GIT_RENAME" | "REGISTRY_DUPLICATE" | "IDENTICAL_CONTENT";
  commit: string | null;
  /** True when the old path is gone from disk — then it is history, not a live duplicate. */
  old_path_removed: boolean;
  provenance: readonly Provenance[];
}

const TAB = String.fromCharCode(9);

function git(args: string[], repoRoot: string = REPO_ROOT): string {
  try {
    return execFileSync("/usr/bin/git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
  } catch {
    return "";
  }
}

/**
 * Renames git itself recorded, most recent first. `-M` asks git for its own
 * similarity finding; we read the answer rather than computing one.
 */
export function detectRenameSupersessions(sinceRef: string | null = null, repoRoot: string = REPO_ROOT): Supersession[] {
  const range = sinceRef ? [`${sinceRef}..HEAD`] : ["-500"];
  const out = git(["log", "-M", "--diff-filter=R", "--name-status", "--format=%H", ...range], repoRoot);
  const renameLine = new RegExp(`^R(\\d+)${TAB}(.+?)${TAB}(.+)$`);
  const results: Supersession[] = [];
  let commit: string | null = null;
  for (const line of out.split("\n")) {
    if (/^[0-9a-f]{40}$/.test(line.trim())) { commit = line.trim(); continue; }
    const m = line.match(renameLine);
    if (!m) continue;
    const [, similarity, oldPath, newPath] = m;
    results.push({
      old_path: oldPath,
      new_path: newPath,
      basis: "GIT_RENAME",
      commit,
      old_path_removed: !existsSync(join(repoRoot, oldPath)),
      provenance: [{
        read_path: "git log -M --diff-filter=R --name-status",
        evidence: `git recorded a rename at ${similarity}% similarity in ${commit?.slice(0, 12) ?? "unknown commit"}: ${oldPath} -> ${newPath}`,
      }],
    });
  }
  return results;
}

/**
 * The registry's own duplicate finding, already computed by the census. Both
 * paths are usually alive here, so such a pair is a DUPLICATE_IMPLEMENTATION
 * until an owner says which one wins — never an automatic removal of "the old
 * one", because nothing in a duplicate pair identifies which one that is.
 */
export function detectRegistryDuplicateSupersessions(): Supersession[] {
  const results: Supersession[] = [];
  for (const cap of censusIndex()) {
    for (const dup of cap.duplicates) {
      if (dup === cap.path) continue;
      // Emitted once per unordered pair, ordered by path, so the same pair is
      // never reported twice with the roles swapped.
      if (cap.path > dup) continue;
      results.push({
        old_path: dup,
        new_path: cap.path,
        basis: "REGISTRY_DUPLICATE",
        commit: null,
        old_path_removed: !existsSync(join(REPO_ROOT, dup)),
        provenance: [{
          read_path: "software/live-census#observeCensus (duplicates)",
          evidence: `the registry holds more than one row for canonical name "${cap.canonical_name}": ${cap.path} and ${dup}`,
        }],
      });
    }
  }
  return results;
}

/**
 * Paths that ARE the same git object. `git ls-files -s` prints the blob hash it
 * already stored for every tracked file; two paths sharing one are byte-identical
 * by content-addressed identity, with no similarity threshold involved.
 *
 * Which of the pair is "old" is NOT decidable from this evidence, so the pair is
 * ordered by path for stability and the decision layer treats it as a duplicate
 * needing an owner — never as a licence to remove "the second one".
 */
export function detectIdenticalContentSupersessions(repoRoot: string = REPO_ROOT): Supersession[] {
  const out = git(["ls-files", "-s"], repoRoot);
  const byBlob = new Map<string, string[]>();
  for (const line of out.split("\n")) {
    const m = line.match(/^\d+ ([0-9a-f]{40}) \d+\t(.+)$/);
    if (!m) continue;
    const [, blob, path] = m;
    byBlob.set(blob, [...(byBlob.get(blob) ?? []), path]);
  }
  const results: Supersession[] = [];
  for (const [blob, paths] of byBlob) {
    if (paths.length < 2) continue;
    const sorted = [...paths].sort();
    for (let i = 1; i < sorted.length; i += 1) {
      results.push({
        old_path: sorted[i],
        new_path: sorted[0],
        basis: "IDENTICAL_CONTENT",
        commit: null,
        old_path_removed: !existsSync(join(repoRoot, sorted[i])),
        provenance: [{
          read_path: "git ls-files -s",
          evidence: `both paths are git blob ${blob.slice(0, 12)} — the same object, not a similar one: ${sorted[0]} and ${sorted[i]}`,
        }],
      });
    }
  }
  return results;
}

/**
 * Everything above, deduplicated by (old, new). A pair found by both bases
 * keeps the stronger one: a git rename is a record of the replacement actually
 * happening; a registry duplicate is only a record of two rows existing.
 */
export function detectSupersessions(sinceRef: string | null = null, repoRoot: string = REPO_ROOT): Supersession[] {
  const byPair = new Map<string, Supersession>();
  // The registry basis is available only for the repository the census covers;
  // for any other repo the git bases still apply and the registry one is simply
  // absent, which is stated rather than silently treated as "no duplicates".
  const registryBasis = repoRoot === REPO_ROOT ? detectRegistryDuplicateSupersessions() : [];
  for (const s of [...detectRenameSupersessions(sinceRef, repoRoot), ...detectIdenticalContentSupersessions(repoRoot), ...registryBasis]) {
    const key = `${s.old_path} ${s.new_path}`;
    const existing = byPair.get(key);
    if (existing === undefined) { byPair.set(key, s); continue; }
    if (existing.basis === "REGISTRY_DUPLICATE" && s.basis === "GIT_RENAME") {
      byPair.set(key, { ...s, provenance: [...s.provenance, ...existing.provenance] });
    } else {
      byPair.set(key, { ...existing, provenance: [...existing.provenance, ...s.provenance] });
    }
  }
  return [...byPair.values()];
}

/** What superseded this path, if anything did. `null` is the honest answer, and does not mean "nothing replaced it". */
export function supersessionFor(repoRelativePath: string, all: readonly Supersession[] = detectSupersessions()): Supersession | null {
  return all.find((s) => s.old_path === repoRelativePath) ?? null;
}
