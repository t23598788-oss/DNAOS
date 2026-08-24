/**
 * หน้าที่: ARTIFACT DISCOVERY — runs ONLY after a real build PASSED.
 * Derives the expected artifact path/type from real, documented
 * framework/runtime conventions (never a hardcoded "every project has
 * dist/") and then reads whatever is REALLY on disk at that path — never
 * fabricates a path, never assumes one exists.
 *
 * The framework->path mapping below is each framework's own documented
 * default (Next.js: `.next/` unless `distDir` overrides it; Vite:
 * `dist/` unless `build.outDir` overrides it) — a real, publicly
 * documented convention, not an AI guess. A generic Node project with no
 * framework marker falls back to its own `package.json`'s real declared
 * `main` field (a real, present piece of evidence) instead of a
 * hardcoded directory name. If neither exists, the artifact location is
 * genuinely not derivable from real evidence.
 *
 * Input: repo root, the real `RuntimeDiscoveryResult`, a `commit_sha`.
 * Output: `deriveArtifactExpectation`, `discoverArtifact` -> `ArtifactDescriptor | null`.
 * Dependency ที่อนุญาต: node:fs, node:path, node:crypto, ./types.ts.
 * สิ่งที่ห้ามแตะ: never return a descriptor for a path outside `repoRoot`.
 * Never return a descriptor for a well-known cache/temp/VCS directory —
 * see ./artifact-validation.ts's `not_cache_or_temp` check, which this
 * file's own denylist below matches.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { ArtifactDescriptor, RuntimeDiscoveryResult } from "./types";
import { newArtifactId } from "./host-runtime";

export interface ArtifactExpectation {
  artifact_type: "directory" | "file";
  artifact_path: string; // relative to repo root
  framework: string | null;
  evidence_refs: readonly string[];
}

export function deriveArtifactExpectation(repoRoot: string, runtimeDiscovery: RuntimeDiscoveryResult): ArtifactExpectation | null {
  if (runtimeDiscovery.frameworks.includes("next")) {
    return { artifact_type: "directory", artifact_path: ".next", framework: "next", evidence_refs: ["next.config.* present — Next.js's own documented default build output directory is .next/ unless overridden by distDir"] };
  }
  if (runtimeDiscovery.frameworks.includes("vite")) {
    return { artifact_type: "directory", artifact_path: "dist", framework: "vite", evidence_refs: ["vite.config.* present — Vite's own documented default build.outDir is dist/ unless overridden"] };
  }
  const packageJsonPath = join(repoRoot, "package.json");
  if (existsSync(packageJsonPath)) {
    try {
      const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { main?: string };
      if (typeof parsed.main === "string" && parsed.main.trim().length > 0) {
        return { artifact_type: "file", artifact_path: parsed.main.trim(), framework: null, evidence_refs: ["package.json (main field)"] };
      }
    } catch {
      // fall through — not derivable.
    }
  }
  return null;
}

const CACHE_OR_TEMP_PATTERNS = [/(^|\/)node_modules(\/|$)/, /(^|\/)\.git(\/|$)/, /(^|\/)\.cache(\/|$)/, /(^|\/)tmp(\/|$)/, /(^|\/)temp(\/|$)/];

export function isCacheOrTempPath(relativePath: string): boolean {
  return CACHE_OR_TEMP_PATTERNS.some((pattern) => pattern.test(relativePath));
}

function listFilesRecursively(absolutePath: string, repoRoot: string, depthBudget = 5_000): string[] {
  const files: string[] = [];
  const stack: string[] = [absolutePath];
  while (stack.length > 0 && files.length < depthBudget) {
    const current = stack.pop()!;
    const stat = statSync(current);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(current)) stack.push(join(current, entry));
    } else if (stat.isFile()) {
      files.push(relative(repoRoot, current));
    }
  }
  return files;
}

export function discoverArtifact(repoRoot: string, expectation: ArtifactExpectation, commitSha: string): ArtifactDescriptor | null {
  const absolutePath = resolve(repoRoot, expectation.artifact_path);
  if (!absolutePath.startsWith(resolve(repoRoot) + "/") && absolutePath !== resolve(repoRoot)) return null; // no path escape, ever.
  if (!existsSync(absolutePath)) return null;
  if (isCacheOrTempPath(expectation.artifact_path)) return null;

  const stat = statSync(absolutePath);
  let sizeBytes = 0;
  let hash = createHash("sha256");

  if (expectation.artifact_type === "directory" && stat.isDirectory()) {
    const files = listFilesRecursively(absolutePath, repoRoot).sort();
    for (const relativeFile of files) {
      const absoluteFile = join(repoRoot, relativeFile);
      const fileStat = statSync(absoluteFile);
      sizeBytes += fileStat.size;
      hash.update(relativeFile);
      hash.update(String(fileStat.size));
    }
  } else if (expectation.artifact_type === "file" && stat.isFile()) {
    const content = readFileSync(absolutePath);
    sizeBytes = content.length;
    hash.update(content);
  } else {
    return null; // real type on disk doesn't match the expected type — not the artifact we expected.
  }

  return {
    artifact_id: newArtifactId(),
    artifact_type: expectation.artifact_type,
    artifact_path: expectation.artifact_path,
    content_hash: hash.digest("hex"),
    size_bytes: sizeBytes,
    source_commit_sha: commitSha,
    runtime: "node",
    framework: expectation.framework,
    evidence_refs: expectation.evidence_refs,
  };
}
