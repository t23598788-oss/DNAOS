/**
 * หน้าที่: live proof for ../contract.ts's checkImportBoundaries() —
 * against REAL, already-existing files in this checkout, not synthetic
 * fixtures: one file already known (from
 * ../../../reports/SYSTEM_JOINT_AND_SEARCH_WASTE_AUDIT_2026-08-22.md's
 * own measured joint table) to import another capability's internal file
 * directly, and one already known to import correctly through a
 * `contract.ts`. Also proves the whole-repo scan mode (no filePaths)
 * finds real violations at scale, matching the prior audit's own
 * ballpark (91 raw bypass call sites) without asserting a fragile exact
 * count that would break the moment anyone fixes one.
 *
 * How to run: npx tsx governance/source-validation/tests/boundary-checker-proof.test.ts
 */

import { checkImportBoundaries } from "../contract";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function run(): void {
  console.log("=== governance/source-validation/tests/boundary-checker-proof.test.ts ===");

  // 1. A real, already-known violation: connections/agent-registry/claude-assignment-adapter.ts:3
  // imports control/agent-gateway/types.ts directly (not a contract.ts).
  {
    const violations = checkImportBoundaries(["connections/agent-registry/claude-assignment-adapter.ts"]);
    const found = violations.find((v) => v.to_file === "control/agent-gateway/types.ts");
    assert(found !== undefined, `expected a real violation for control/agent-gateway/types.ts, got: ${JSON.stringify(violations)}`);
    assert(found!.from_capability === "connections/agent-registry", `expected from_capability=connections/agent-registry, got ${found!.from_capability}`);
    assert(found!.to_capability === "control/agent-gateway", `expected to_capability=control/agent-gateway, got ${found!.to_capability}`);
    console.log(`PASS: real known violation detected — ${found!.from_file} -> ${found!.to_file}`);
  }

  // 2. A real, already-known COMPLIANT import: control/owner-command/owner-command.ts
  // imports control/command-router/contract.ts (a real contract.ts) — must NOT be flagged.
  {
    const violations = checkImportBoundaries(["control/owner-command/owner-command.ts"]);
    const falseFlag = violations.find((v) => v.to_capability === "control/command-router");
    assert(falseFlag === undefined, `a real contract.ts import must never be flagged, got: ${JSON.stringify(falseFlag)}`);
    console.log("PASS: a real, compliant contract.ts import is never falsely flagged");
  }

  // 3. A file with no cross-capability imports at all -> zero violations, not a crash.
  {
    const violations = checkImportBoundaries(["governance/source-validation/types.ts"]);
    assert(violations.length === 0, `a pure-types file with no imports should report zero violations, got ${violations.length}`);
    console.log("PASS: a file with no cross-capability imports reports zero violations");
  }

  // 4. A file that no longer exists is reported with zero violations, never thrown.
  {
    const violations = checkImportBoundaries(["control/does-not-exist/nowhere.ts"]);
    assert(violations.length === 0, "a nonexistent file path never throws, reports zero violations");
    console.log("PASS: a nonexistent scoped file path is handled gracefully, never throws");
  }

  // 5. Whole-repo scan mode (no filePaths) finds real violations at scale.
  {
    const violations = checkImportBoundaries();
    assert(violations.length > 30, `expected real violations at repo scale (prior audit found 91 raw bypass call sites), got ${violations.length}`);
    console.log(`PASS: whole-repo scan (no filePaths) found ${violations.length} real violations — matches audit-scale expectations`);
  }

  console.log("=== ALL boundary-checker-proof.test.ts CASES PASSED ===");
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
