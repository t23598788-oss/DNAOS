/**
 * หน้าที่: ARTIFACT VALIDATION — the one owner of "is this real,
 * on-disk thing actually a valid deployable artifact for this commit".
 * Structural checks only — never re-runs a security scan, never re-runs
 * tests, never re-typechecks (those each have their own owner elsewhere:
 * `control/post-commit-verification/`).
 *
 * Input: an `ArtifactDescriptor`, the repo root, the expected commit_sha,
 * the `ArtifactExpectation` it was discovered against.
 * Output: `validateArtifact` -> `ArtifactValidationResult`.
 * Dependency ที่อนุญาต: node:fs, node:path, ./artifact-discovery.ts (type
 * + `isCacheOrTempPath` only), ./types.ts.
 * สิ่งที่ห้ามแตะ: never call a scanner/linter/test runner here.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { isCacheOrTempPath } from "./artifact-discovery";
import type { ArtifactExpectation } from "./artifact-discovery";
import type { ArtifactDescriptor, ArtifactValidationResult } from "./types";

/** Each framework's own real, documented "this build actually completed" marker — not a re-run of anything, just a structural presence check. */
const REQUIRED_MARKER_FILES: Readonly<Record<string, string>> = {
  next: ".next/BUILD_ID",
};

export function validateArtifact(descriptor: ArtifactDescriptor, repoRoot: string, commitSha: string, expectation: ArtifactExpectation): ArtifactValidationResult {
  const reasonCodes: string[] = [];

  const absolutePath = resolve(repoRoot, descriptor.artifact_path);
  const exists = existsSync(absolutePath);
  if (!exists) reasonCodes.push("ARTIFACT_PATH_NOT_FOUND");

  const nonEmpty = descriptor.size_bytes > 0;
  if (!nonEmpty) reasonCodes.push("ARTIFACT_EMPTY");

  const matchesCommit = descriptor.source_commit_sha === commitSha;
  if (!matchesCommit) reasonCodes.push("COMMIT_MISMATCH");

  const typeMatchesRuntime = descriptor.artifact_type === expectation.artifact_type && descriptor.framework === expectation.framework;
  if (!typeMatchesRuntime) reasonCodes.push("TYPE_MISMATCH");

  const requiredMarker = descriptor.framework ? REQUIRED_MARKER_FILES[descriptor.framework] : undefined;
  const requiredFilesComplete = requiredMarker === undefined ? true : existsSync(resolve(repoRoot, requiredMarker));
  if (!requiredFilesComplete) reasonCodes.push("REQUIRED_FILES_INCOMPLETE");

  const repoRootResolved = resolve(repoRoot);
  const noPathEscape = absolutePath === repoRootResolved || absolutePath.startsWith(repoRootResolved + "/");
  if (!noPathEscape) reasonCodes.push("PATH_ESCAPE");

  const notCacheOrTemp = !isCacheOrTempPath(descriptor.artifact_path);
  if (!notCacheOrTemp) reasonCodes.push("CACHE_OR_TEMP_PATH");

  const ok = exists && nonEmpty && matchesCommit && typeMatchesRuntime && requiredFilesComplete && noPathEscape && notCacheOrTemp;

  return { exists, non_empty: nonEmpty, matches_commit: matchesCommit, type_matches_runtime: typeMatchesRuntime, required_files_complete: requiredFilesComplete, no_path_escape: noPathEscape, not_cache_or_temp: notCacheOrTemp, ok, reason_codes: reasonCodes };
}
