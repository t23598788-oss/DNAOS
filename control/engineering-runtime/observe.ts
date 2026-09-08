/**
 * หน้าที่: DNA OS observes worktree facts. Worker self-report is not
 * the source of changed paths, hashes, or test evidence.
 *
 * Input: worktree + base revision + admitted scope.
 * Output: observed paths, hashes, symbols, test results.
 * Dependency ที่อนุญาต: node:child_process, node:crypto, node:fs, node:path.
 * สิ่งที่ห้ามแตะ: never take changed_paths from the worker. never git
 * push / commit / PR.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EngineeringAdmission, EngineeringTestResult } from "./types";

function toPosix(path: string): string {
  return path.replaceAll("\\", "/");
}

function gitLines(worktree: string, args: readonly string[]): readonly string[] {
  try {
    const out = execFileSync("git", args, { cwd: worktree, encoding: "utf8", timeout: 20_000 }).trim();
    return out.length === 0 ? [] : out.split("\n").map((line) => toPosix(line.trim())).filter(Boolean);
  } catch {
    return [];
  }
}

export function readRegisteredHead(repositoryRoot: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8", timeout: 10_000 }).trim() || null;
  } catch {
    return null;
  }
}

/** Tip of the registered default branch, or HEAD when this checkout is detached at a publication proof commit. */
export function readRegisteredBaseRevision(repositoryRoot: string, baseBranch: string): string | null {
  try {
    try {
      execFileSync("git", ["symbolic-ref", "-q", "HEAD"], { cwd: repositoryRoot, encoding: "utf8", timeout: 10_000 });
    } catch {
      return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8", timeout: 10_000 }).trim() || null;
    }
    return execFileSync("git", ["rev-parse", "--verify", baseBranch], { cwd: repositoryRoot, encoding: "utf8", timeout: 10_000 }).trim() || null;
  } catch {
    return null;
  }
}

export function observeChangedPaths(worktreePath: string, baseCommitSha: string): readonly string[] {
  const diff = gitLines(worktreePath, ["diff", "--name-only", baseCommitSha]);
  const untracked = gitLines(worktreePath, ["ls-files", "--others", "--exclude-standard"]);
  const merged = [...diff, ...untracked].filter((path) => path.length > 0 && !path.startsWith(".git/"));
  return [...new Set(merged)].sort();
}

export function sha256File(absPath: string): string | null {
  if (!existsSync(absPath)) return null;
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

export function extractSymbols(content: string): readonly string[] {
  const found = new Set<string>();
  for (const match of content.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)/g)) found.add(match[1]!);
  for (const match of content.matchAll(/export\s+const\s+([A-Za-z_][A-Za-z0-9_]*)/g)) found.add(match[1]!);
  return [...found].sort();
}

export function classifyPath(path: string): "human_documentation" | "machine_contract" | "registry_record" | "code" {
  const posix = toPosix(path).toLowerCase();
  if (posix.endsWith(".md")) return "human_documentation";
  if (posix.includes("registry-record") || posix.includes("/registry/") || posix.endsWith("registry.json")) return "registry_record";
  if (posix.endsWith(".json") || posix.includes("contract")) return "machine_contract";
  return "code";
}

export function hashChangedArtifacts(worktreePath: string, changedPaths: readonly string[]): readonly { readonly path: string; readonly sha256: string }[] {
  const out: { path: string; sha256: string }[] = [];
  for (const rel of changedPaths) {
    const digest = sha256File(join(worktreePath, rel));
    if (digest) out.push({ path: rel, sha256: digest });
  }
  return out;
}

export function changedSymbolsIn(worktreePath: string, changedPaths: readonly string[]): readonly string[] {
  const symbols = new Set<string>();
  for (const rel of changedPaths) {
    const abs = join(worktreePath, rel);
    if (!existsSync(abs) || !/\.(ts|tsx|js|mjs)$/.test(rel)) continue;
    for (const name of extractSymbols(readFileSync(abs, "utf8"))) symbols.add(name);
  }
  return [...symbols].sort();
}

export function runRequiredTests(input: {
  readonly required_tests: readonly string[];
  readonly worktree_path: string;
  readonly changed_paths: readonly string[];
}): readonly EngineeringTestResult[] {
  return input.required_tests.map((name) => {
    if (name === "sandbox.write") {
      const passed = input.changed_paths.length > 0;
      return { name, passed, evidence: passed ? `dna-os observed ${input.changed_paths.length} changed path(s)` : "no changed paths observed" };
    }
    if (name === "sandbox.readback") {
      const missing = input.changed_paths.filter((rel) => !existsSync(join(input.worktree_path, rel)));
      return { name, passed: missing.length === 0 && input.changed_paths.length > 0, evidence: missing.length === 0 ? `readback ok for ${input.changed_paths.join(",")}` : `missing ${missing.join(",")}` };
    }
    return { name, passed: false, evidence: `no DNA OS test evidence producer for "${name}"` };
  });
}

export function inScope(relativePath: string, scopes: readonly string[]): boolean {
  return scopes.some((scope) => relativePath === scope || relativePath.startsWith(`${scope}/`));
}

export function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedRight = [...right].sort();
  return [...left].sort().every((value, index) => value === sortedRight[index]);
}

export function definitionOfDone(input: {
  readonly admission: EngineeringAdmission;
  readonly changed_paths: readonly string[];
  readonly tests: readonly EngineeringTestResult[];
  readonly evidence_refs: readonly string[];
}): { readonly done: boolean; readonly flags: { readonly code: boolean; readonly tests: boolean; readonly machine_readable_contract: boolean; readonly human_documentation: boolean; readonly registry_connection_update: boolean; readonly evidence: boolean } } {
  const classes = new Set(input.changed_paths.map(classifyPath));
  const flags = {
    code: classes.has("code"),
    tests: input.tests.length > 0 && input.tests.every((row) => row.passed),
    machine_readable_contract: classes.has("machine_contract"),
    human_documentation: classes.has("human_documentation"),
    registry_connection_update: classes.has("registry_record"),
    evidence: input.evidence_refs.length > 0,
  };
  return { done: flags.code && flags.tests && flags.machine_readable_contract && flags.human_documentation && flags.registry_connection_update && flags.evidence, flags };
}
