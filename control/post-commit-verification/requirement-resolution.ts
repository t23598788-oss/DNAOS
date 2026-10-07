/**
 * หน้าที่: REQUIREMENT RESOLUTION — the ONE place that decides which
 * build/test checks this repo actually requires. Deterministic,
 * name-matched against this repo's own real `package.json` `scripts` —
 * never a guess, never a fuzzy/semantic match against an arbitrarily
 * named script. A `CheckType` is only ever declared required when
 * `package.json.scripts` has the EXACT literal key this file's own fixed
 * candidate map names for it.
 *
 * If none of the candidate keys exist at all, this repo has declared no
 * verification requirement `resolver.ts` can act on — the caller must
 * report UNRESOLVED/VERIFICATION_REQUIREMENT_NOT_FOUND, never default to
 * VERIFIED.
 *
 * Input: none (reads the real `package.json` at the repo root).
 * Output: `resolveRequiredChecks` -> `ResolvedCheckRequirement[]`.
 * Dependency ที่อนุญาต: node:fs, node:path, ./types.ts.
 * สิ่งที่ห้ามแตะ: never add a candidate npm-script key that isn't the
 * literal, real name of a script this repo's own `package.json` already
 * declares. Never invent a `unit_test`/`build` requirement when no script
 * literally named for it exists — NOT_REQUIRED is the honest answer, not
 * a semantic guess at which existing script "counts".
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckType } from "./types";

export interface ResolvedCheckRequirement {
  check_type: CheckType;
  npm_script: string;
  /** The execution/run/ command_id this npm_script maps to — set only when execution/run/registry.ts actually has a matching entry (see resolver.ts's own check before ever calling execution/run). */
  command_id: string;
}

/** Fixed, real script-name candidates — one literal key per CheckType, never a pattern/heuristic. */
const CANDIDATE_SCRIPTS: ReadonlyArray<{ check_type: CheckType; npm_script: string; command_id: string }> = [
  { check_type: "typecheck", npm_script: "typecheck", command_id: "npm.typecheck" },
  { check_type: "unit_test", npm_script: "test:unit", command_id: "npm.test_unit" },
  { check_type: "integration_test", npm_script: "test:integration", command_id: "npm.test_integration" },
  { check_type: "build", npm_script: "build", command_id: "npm.build" },
];

export function resolveRequiredChecks(repoRoot: string = process.cwd()): readonly ResolvedCheckRequirement[] {
  let scripts: Record<string, unknown>;
  try {
    const raw = readFileSync(join(repoRoot, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };
    scripts = parsed.scripts ?? {};
  } catch {
    return [];
  }
  return CANDIDATE_SCRIPTS.filter((candidate) => typeof scripts[candidate.npm_script] === "string");
}
