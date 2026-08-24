/**
 * หน้าที่: BUILD REQUIREMENT RESOLUTION — the ONE place that decides
 * whether a build step is REQUIRED, NOT_REQUIRED (proven), or UNRESOLVED.
 * Deterministic, evidence-only — never a guess from "Agent habit".
 *
 * Order of real evidence checked (first match wins):
 *   1. package.json scripts.build exists -> REQUIRED, command = "npm run build".
 *   2. no build script, but `./runtime-discovery.ts`'s
 *      `provesNodeTypescriptBuildNotRequired()` real proof holds ->
 *      NOT_REQUIRED (proven, not assumed).
 *   3. a Dockerfile or a Makefile with a real "build:" target exists (no
 *      package.json build script) -> REQUIRED, but this round has no
 *      registered, safe `execution/run/` command for docker/make, so the
 *      caller (./resolver.ts) reports it UNRESOLVED_BUILD_REQUIREMENT
 *      rather than fabricating an executor.
 *   4. none of the above -> UNRESOLVED_BUILD_REQUIREMENT — genuinely not
 *      enough evidence to decide either way.
 *
 * Input: a repo root path, the real `RuntimeDiscoveryResult`.
 * Output: `resolveBuildRequirement` -> `BuildRequirement`.
 * Dependency ที่อนุญาต: node:fs, node:path, ./runtime-discovery.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never add a candidate npm-script key other than the
 * literal "build" — never guess a differently-named script "counts".
 * Never mark a command REQUIRED/executable without a real
 * `execution/run/registry.ts` entry existing for it (checked by the
 * caller, ./run-build.ts).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { provesNodeTypescriptBuildNotRequired } from "./runtime-discovery";
import type { BuildRequirement, RuntimeDiscoveryResult } from "./types";

function hasNpmBuildScript(repoRoot: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { scripts?: Record<string, unknown> };
    return typeof parsed.scripts?.build === "string";
  } catch {
    return false;
  }
}

function hasMakefileBuildTarget(repoRoot: string): boolean {
  const path = join(repoRoot, "Makefile");
  if (!existsSync(path)) return false;
  try {
    return /^build\s*:/m.test(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
}

export function resolveBuildRequirement(repoRoot: string, runtimeDiscovery: RuntimeDiscoveryResult): BuildRequirement {
  if (hasNpmBuildScript(repoRoot)) {
    return {
      status: "REQUIRED", reason_code: "BUILD_COMMAND_RESOLVED",
      command_id: "npm.build", command_reference: "npm run build", command_source: "package.json scripts.build",
      evidence_refs: ["package.json (scripts.build)"],
    };
  }

  if (runtimeDiscovery.runtimes.includes("node") && runtimeDiscovery.languages.includes("typescript")) {
    const proof = provesNodeTypescriptBuildNotRequired(repoRoot);
    if (proof.proven) {
      return { status: "NOT_REQUIRED", reason_code: "BUILD_NOT_REQUIRED_PROVEN", command_id: null, command_reference: null, command_source: null, evidence_refs: proof.evidence_refs };
    }
  }

  if (existsSync(join(repoRoot, "Dockerfile"))) {
    return { status: "UNRESOLVED", reason_code: "UNRESOLVED_BUILD_REQUIREMENT", command_id: null, command_reference: null, command_source: null, evidence_refs: ["Dockerfile (present, but no registered execution/run/ docker-build command exists this round)"] };
  }
  if (hasMakefileBuildTarget(repoRoot)) {
    return { status: "UNRESOLVED", reason_code: "UNRESOLVED_BUILD_REQUIREMENT", command_id: null, command_reference: null, command_source: null, evidence_refs: ["Makefile (real \"build:\" target present, but no registered execution/run/ make command exists this round)"] };
  }

  return { status: "UNRESOLVED", reason_code: "UNRESOLVED_BUILD_REQUIREMENT", command_id: null, command_reference: null, command_source: null, evidence_refs: [] };
}
