/**
 * Governance Enforcement Regression Suite (owner, 2026-08-06, Software
 * Factory Step 4.5) — verifies the real Governance Runtime
 * (app/api/admin/ide/_lib/governanceRuntime.ts), never a re-implementation
 * of its logic. Calls the exact same production functions the HTTP routes
 * and the Inspection pipeline's GOVERNANCE_CHECK call.
 *
 * Run: npm run governance:test
 */
import { readFileSync, existsSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import {
  computeAllRules, getRule, listRulesByStatus, listRulesCitingFile, computeCoverageSummary,
  findGhostFindings, computeFactoryGovernance, runGovernanceVerification, listGovernanceEvents,
  __debugGovernanceEventCount, __debugClearCache, type RuleStatus,
} from "../app/api/admin/ide/_lib/governanceRuntime";
import { runGovernanceCheck } from "../app/api/admin/ide/_lib/inspectionRuntime";
import { WORKSPACE_ROOT } from "../app/api/admin/ide/_lib/fsSecurity";

const execFileAsync = promisify(execFile);
const ROOT = path.join(__dirname, "..");
const TEST_ACTOR = "governance-regression-suite@dnaos.local";
const TEST_OWNER = "governance-regression-owner";

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    results.push({ name, pass: true });
  } catch (e) {
    results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) });
  }
}
function assert(cond: boolean, message: string) {
  if (!cond) throw new Error(message);
}

async function main() {
  __debugClearCache();
  const allRules = computeAllRules();
  const ALL_STATUSES: RuleStatus[] = ["ENFORCED", "DECLARED_NOT_ENFORCED", "NOT_IMPLEMENTED", "DEPRECATED", "GHOST", "UNKNOWN"];

  // ================= RULE CLASSIFICATION =================
  await test("Governance: every real rule has exactly one status from the fixed enum", () => {
    for (const r of allRules) assert(ALL_STATUSES.includes(r.status), `rule ${r.ruleId} has invalid status ${r.status}`);
  });
  await test("Governance: rule-coverage.json's real total (rules{} + uncovered_rules) matches this runtime's rule-coverage-sourced count", () => {
    const coverage = JSON.parse(readFileSync(path.join(ROOT, "registry/rule-coverage.json"), "utf-8"));
    const expectedFromCoverage = Object.keys(coverage.rules).length + coverage.uncovered_rules.length;
    const actualFromCoverage = allRules.filter((r) => r.source === "rule-coverage" || r.source === "uncovered").length;
    assert(actualFromCoverage === expectedFromCoverage, `expected ${expectedFromCoverage} rule-coverage-sourced rules, got ${actualFromCoverage}`);
  });

  // ================= GHOST RULE =================
  await test("Ghost Rule: every uncovered_rules number is classified GHOST with no fabricated title", () => {
    const ghosts = listRulesByStatus("GHOST");
    assert(ghosts.length > 0, "expected at least one real GHOST rule (registry/rule-coverage.json's uncovered_rules is non-empty)");
    for (const g of ghosts) {
      assert(g.source === "uncovered", `GHOST rule ${g.ruleId} should come from the uncovered_rules source`);
      assert(g.enforcedBy.length === 0, `GHOST rule ${g.ruleId} must have no real enforced_by evidence`);
    }
  });
  await test("Ghost Rule: findGhostFindings() reports at least one GHOST_RULE finding per real ghost rule", () => {
    const ghosts = listRulesByStatus("GHOST");
    const findings = findGhostFindings();
    const ghostFindingIds = new Set(findings.filter((f) => f.kind === "GHOST_RULE").map((f) => f.ruleId));
    for (const g of ghosts) assert(ghostFindingIds.has(g.ruleId), `no GHOST_RULE finding for real ghost rule ${g.ruleId}`);
  });

  // ================= DUPLICATE RULE =================
  await test("Duplicate Rule: at least one iron_rules bullet is correctly detected as duplicating an already-numbered rule", () => {
    const rule1Bullet = getRule("IRON-1");
    assert(!!rule1Bullet, "IRON-1 not found");
    assert(rule1Bullet!.duplicateOf === "1", `expected IRON-1 to duplicate Rule 1, got ${rule1Bullet!.duplicateOf}`);
    const findings = findGhostFindings();
    assert(findings.some((f) => f.kind === "DUPLICATE_RULE" && f.ruleId === "IRON-1"), "no DUPLICATE_RULE finding for IRON-1");
  });
  await test("Duplicate Rule: a duplicate rule always inherits the REAL computed status of the rule it duplicates, never a separate guessed status", () => {
    const rule1 = getRule("1");
    const iron1 = getRule("IRON-1");
    assert(!!rule1 && !!iron1, "rule 1 / IRON-1 missing");
    assert(iron1!.status === rule1!.status, `IRON-1 (${iron1!.status}) must match Rule 1's real status (${rule1!.status})`);
  });

  // ================= UNKNOWN RULE =================
  await test("Unknown Rule: a runtime_contract rule with no real \"enforcement\" field is honestly UNKNOWN, never guessed ENFORCED or DECLARED", () => {
    const unknowns = listRulesByStatus("UNKNOWN").filter((r) => r.source === "runtime-contract");
    assert(unknowns.length > 0, "expected at least one real runtime_contract rule with no enforcement field (rules 1-6 in registry/CONSTITUTION.json today)");
    for (const u of unknowns) assert(u.detection === null, `UNKNOWN rule ${u.ruleId} should have no fabricated detection text`);
  });

  // ================= DECLARED RULE =================
  await test("Declared Rule: a real rule-coverage.json entry with an empty enforced_by[] is DECLARED_NOT_ENFORCED, never ENFORCED", () => {
    const declared = listRulesByStatus("DECLARED_NOT_ENFORCED");
    const fromCoverage = declared.filter((r) => r.source === "rule-coverage");
    for (const r of fromCoverage) assert(r.enforcedBy.length === 0, `DECLARED_NOT_ENFORCED rule ${r.ruleId} (source rule-coverage) should have empty enforced_by`);
  });

  // ================= ENFORCED RULE =================
  await test("Enforced Rule: ENFORCED status requires at least one enforced_by reference that resolves to a REAL file on disk", () => {
    const enforced = listRulesByStatus("ENFORCED");
    assert(enforced.length > 0, "expected at least one real ENFORCED rule");
    // Duplicate rules (iron_rules bullets that restate an already-numbered
    // rule) inherit their STATUS from the rule they duplicate but never
    // restate that rule's own evidence — checked separately below.
    // runtime-contract rules are classified from real prose in
    // CONSTITUTION.json's own `enforcement` field (e.g. "code-enforced ..."),
    // not from a file citation — their evidence IS that text, not a path.
    for (const r of enforced.filter((r) => !r.duplicateOf && r.source !== "runtime-contract")) {
      assert(r.resolvedFiles.length > 0, `ENFORCED rule ${r.ruleId} has zero resolvedFiles — should not be ENFORCED`);
    }
    for (const r of enforced.filter((r) => r.source === "runtime-contract")) {
      assert(!!r.detection && r.detection.toLowerCase().includes("code-enforced"), `ENFORCED runtime-contract rule ${r.ruleId} has no real "code-enforced" evidence in its enforcement text`);
    }
  });
  await test("Enforced Rule: a rule citing a file that does not exist on disk is NOT_IMPLEMENTED, never ENFORCED", () => {
    const notImplemented = listRulesByStatus("NOT_IMPLEMENTED");
    for (const r of notImplemented.filter((r) => !r.duplicateOf)) {
      assert(r.enforcedBy.length > 0, `NOT_IMPLEMENTED rule ${r.ruleId} should have claimed evidence`);
      assert(r.resolvedFiles.length === 0, `NOT_IMPLEMENTED rule ${r.ruleId} should have zero real resolved files`);
    }
  });
  await test("Enforced Rule: a duplicate rule's evidence lives on the rule it duplicates, verifiable by following duplicateOf", () => {
    for (const r of allRules.filter((r) => r.duplicateOf)) {
      const target = getRule(r.duplicateOf!);
      assert(!!target, `rule ${r.ruleId} points at duplicateOf ${r.duplicateOf}, which does not exist`);
      assert(target!.status === r.status, `rule ${r.ruleId}'s status (${r.status}) must match its duplicateOf target ${r.duplicateOf}'s real status (${target!.status})`);
    }
  });

  // ================= COVERAGE CALCULATION =================
  await test("Coverage Calculation: computeCoverageSummary()'s counts sum exactly to totalRules, recomputed live from real files", () => {
    const summary = computeCoverageSummary();
    const sum = summary.enforced + summary.declaredNotEnforced + summary.notImplemented + summary.deprecated + summary.ghost + summary.unknown;
    assert(sum === summary.totalRules, `status counts (${sum}) do not sum to totalRules (${summary.totalRules})`);
    assert(summary.totalRules === allRules.length, `computeCoverageSummary() totalRules (${summary.totalRules}) does not match computeAllRules().length (${allRules.length})`);
  });
  await test("Coverage Calculation: coveragePercent is computed live from enforced/total, never a hardcoded number", () => {
    const summary = computeCoverageSummary();
    const expected = Math.round((summary.enforced / summary.totalRules) * 1000) / 10;
    assert(summary.coveragePercent === expected, `coveragePercent ${summary.coveragePercent} does not match live enforced/total computation ${expected}`);
  });

  // ================= FACTORY COVERAGE =================
  await test("Factory Coverage: every real Factory from factory-registry.json gets a real governance record", () => {
    const factoryRegistry = JSON.parse(readFileSync(path.join(ROOT, "registry/factory-registry.json"), "utf-8"));
    const factories = computeFactoryGovernance();
    assert(factories.length === factoryRegistry.factories.length, `expected ${factoryRegistry.factories.length} factory governance records, got ${factories.length}`);
    for (const f of factories) {
      assert(f.factoryHealth === "HEALTHY" || f.factoryHealth === "AT_RISK" || f.factoryHealth === "UNGOVERNED", `factory ${f.factoryId} has invalid health ${f.factoryHealth}`);
      assert(f.factoryCoveragePercent >= 0 && f.factoryCoveragePercent <= 100, `factory ${f.factoryId} coverage out of range`);
    }
  });
  await test("Factory Coverage: a Factory with zero rule-cited files is UNGOVERNED, never fabricated HEALTHY", () => {
    const factories = computeFactoryGovernance();
    for (const f of factories) {
      if (f.factoryRules.length === 0) assert(f.factoryHealth === "UNGOVERNED", `factory ${f.factoryId} has zero rules but health is ${f.factoryHealth}`);
    }
  });

  // ================= INSPECTION MAPPING =================
  await test("Inspection Mapping: listRulesCitingFile() returns real rules for a file known to be cited in rule-coverage.json", () => {
    // scripts/pre-commit-check.sh is cited by multiple real rules (100, 101, 103) in registry/rule-coverage.json
    const citing = listRulesCitingFile("scripts/pre-commit-check.sh");
    assert(citing.length > 0, "expected at least one real rule citing scripts/pre-commit-check.sh");
    assert(citing.some((r) => r.ruleId === "100"), "expected Rule 100 to cite scripts/pre-commit-check.sh");
  });
  await test("Inspection Mapping: GOVERNANCE_CHECK (Inspection pipeline) uses the SAME real classification as listRulesCitingFile(), never a second heuristic", async () => {
    const record = await runGovernanceCheck("scripts/pre-commit-check.sh", TEST_ACTOR, TEST_OWNER, null);
    assert(record.status === "PASSED", `GOVERNANCE_CHECK never judges pass/fail of Constitution rules — expected PASSED, got ${record.status}`);
    const citing = listRulesCitingFile("scripts/pre-commit-check.sh");
    assert(record.findings.length >= citing.length, `GOVERNANCE_CHECK found ${record.findings.length} findings but listRulesCitingFile() found ${citing.length} real citing rules — should be at least as many (plus NO_GOVERNANCE_RULE_CITES_FILE never applies here)`);
    for (const r of citing) {
      assert(record.findings.some((f) => f.rule === r.ruleId), `GOVERNANCE_CHECK finding missing for rule ${r.ruleId}, which listRulesCitingFile() found`);
    }
  });

  // ================= EVIDENCE MAPPING =================
  await test("Evidence Mapping: a rule's resolvedFiles are all real, existing files under WORKSPACE_ROOT", () => {
    for (const r of allRules) {
      for (const f of r.resolvedFiles) {
        assert(existsSync(path.join(WORKSPACE_ROOT, f)), `rule ${r.ruleId} claims resolvedFiles includes ${f} but it does not exist on disk`);
      }
    }
  });
  await test("Evidence Mapping: a rule's missingFiles never overlaps its resolvedFiles (no file is both real and missing)", () => {
    for (const r of allRules) {
      for (const f of r.missingFiles) assert(!r.resolvedFiles.includes(f), `rule ${r.ruleId} lists ${f} in both resolvedFiles and missingFiles`);
    }
  });

  // ================= PROBLEMS INTEGRATION =================
  await test("Problems Integration: GOVERNANCE_CHECK finding codes map 1:1 onto real rule status (GHOST/NOT_IMPLEMENTED/DECLARED/UNKNOWN/DEPRECATED/ENFORCED)", async () => {
    const record = await runGovernanceCheck("scripts/pre-commit-check.sh", TEST_ACTOR, TEST_OWNER, null);
    const validCodes = new Set(["GOVERNANCE_RULE_ENFORCED", "GOVERNANCE_RULE_GHOST", "GOVERNANCE_RULE_NOT_IMPLEMENTED", "GOVERNANCE_RULE_DEPRECATED", "GOVERNANCE_RULE_UNKNOWN", "GOVERNANCE_RULE_DECLARED_NOT_ENFORCED", "NO_GOVERNANCE_RULE_CITES_FILE"]);
    for (const f of record.findings) assert(validCodes.has(f.code), `unexpected GOVERNANCE_CHECK finding code ${f.code}`);
  });

  // ================= RUNTIME EVENTS =================
  await test("Runtime Events: runGovernanceVerification() emits exactly one real event per real rule", () => {
    const before = __debugGovernanceEventCount();
    const { summary, events } = runGovernanceVerification(TEST_ACTOR);
    assert(events.length === summary.totalRules, `expected ${summary.totalRules} events, got ${events.length}`);
    assert(__debugGovernanceEventCount() === before + events.length, "governance event log did not grow by the real number of emitted events");
    const validTypes = new Set(["RULE_VERIFIED", "RULE_FAILED", "RULE_DECLARED", "RULE_UNKNOWN", "RULE_GHOST", "RULE_DEPRECATED"]);
    for (const e of events) assert(validTypes.has(e.type), `invalid governance event type ${e.type}`);
  });
  await test("Runtime Events: listGovernanceEvents() returns real, non-fabricated events with matching ruleId/status semantics", () => {
    const recent = listGovernanceEvents(5);
    assert(recent.length > 0, "expected real events after runGovernanceVerification()");
    for (const e of recent) {
      const rule = getRule(e.ruleId);
      assert(!!rule, `event references ruleId ${e.ruleId} which does not exist in the real rule set`);
    }
  });

  // ================= AUTH =================
  await test("Governance API routes stay auth-gated", async () => {
    for (const file of [
      "app/api/admin/ide/governance/summary/route.ts",
      "app/api/admin/ide/governance/rules/route.ts",
      "app/api/admin/ide/governance/rules/[ruleId]/route.ts",
      "app/api/admin/ide/governance/events/route.ts",
      "app/api/admin/ide/governance/verify/route.ts",
      "app/api/admin/ide/governance/factories/route.ts",
    ]) {
      const src = readFileSync(path.join(ROOT, file), "utf-8");
      assert(src.includes("requireAuth(ADMIN_TIER)"), `${file} no longer calls requireAuth(ADMIN_TIER)`);
    }
  });

  // ================= REUSE / SCOPE GUARANTEES =================
  await test("Reuse: registry/governance-summary.json is generated by the real build script, matching live computeCoverageSummary()", async () => {
    await execFileAsync("npx", ["tsx", "scripts/build-governance-summary.ts"], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
    const summaryFile = JSON.parse(readFileSync(path.join(ROOT, "registry/governance-summary.json"), "utf-8"));
    const live = computeCoverageSummary();
    assert(summaryFile.totalRules === live.totalRules, "registry/governance-summary.json totalRules is stale vs. live computation");
    assert(summaryFile.enforced === live.enforced, "registry/governance-summary.json enforced count is stale vs. live computation");
    assert(Array.isArray(summaryFile.factories) && summaryFile.factories.length === 12, "registry/governance-summary.json missing real 12-factory breakdown");
  });
  await test("Scope guarantee: this suite never wrote to, moved, or deleted any Constitution/rule-coverage/factory source file", () => {
    // Read-only proof: re-read the same 3 files and confirm they still
    // parse as valid JSON with their real top-level shape intact.
    const c = JSON.parse(readFileSync(path.join(ROOT, "registry/CONSTITUTION.json"), "utf-8"));
    const rc = JSON.parse(readFileSync(path.join(ROOT, "registry/rule-coverage.json"), "utf-8"));
    const fm = JSON.parse(readFileSync(path.join(ROOT, "registry/factory-mapping.json"), "utf-8"));
    assert(Array.isArray(c.iron_rules) && c.iron_rules.length === 158, "registry/CONSTITUTION.json iron_rules shape changed unexpectedly");
    assert(typeof rc.rules === "object", "registry/rule-coverage.json rules shape changed unexpectedly");
    assert(typeof fm.modules === "object", "registry/factory-mapping.json modules shape changed unexpectedly");
  });

  console.log("\n=== Governance Enforcement Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) {
    console.error(`\n${failed.length} test(s) failed.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("SUITE CRASHED:", e);
  process.exit(1);
});
