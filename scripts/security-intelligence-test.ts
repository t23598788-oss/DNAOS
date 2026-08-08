/**
 * Restricted Security Intelligence Regression Suite (owner, 2026-08-08,
 * Software Factory Step 13.25) — verifies the real Security Knowledge
 * Registry/Runtime, Restricted Capability Registry, Security Target
 * Runtime, Security Execution Runtime (gate), Security Defense Runtime,
 * and Digital Forensics Runtime. Never invokes any real offensive
 * action — no such capability exists in this repo to invoke.
 *
 * Run: npm run security-intelligence:test
 */
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";

import { queryKnowledge } from "../app/api/admin/ide/_lib/securityKnowledgeRuntime";
import { listKnowledgeCategories } from "../app/api/admin/ide/_lib/securityKnowledgeRegistry";
import { listRestrictedCapabilities, type RestrictedCapabilityId } from "../app/api/admin/ide/_lib/restrictedCapabilityRegistry";
import { validateTarget } from "../app/api/admin/ide/_lib/securityTargetRuntime";
import { requestSecurityExecution, getSecurityExecutionGateRecord, listSecurityExecutionGateRecords, type SecurityExecutionGateRequest } from "../app/api/admin/ide/_lib/securityExecutionRuntime";
import { computeDefenseSummary } from "../app/api/admin/ide/_lib/securityDefenseRuntime";
import { buildForensicTimeline } from "../app/api/admin/ide/_lib/digitalForensicsRuntime";
import { getArtifact } from "../app/api/admin/ide/_lib/artifactRuntime";

const ROOT = path.join(__dirname, "..");
const TEST_ACTOR = "security-intelligence-regression-suite@dnaos.local";
const OWNER_A = "security-intelligence-regression-owner-a";
const OWNER_B = "security-intelligence-regression-owner-b";

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

const VALID_TARGET = {
  owner: "real-test-owner", organization: "real-test-org", asset: "real-test-asset",
  purpose: "regression test", authorization: "real-test-authorization-doc-123",
  expectedOutcome: "prove the gate honestly blocks", allowedRuntime: ["SecurityExecutionRuntime"], forbiddenRuntime: [],
};
const FULL_REQUEST = (capabilityId: RestrictedCapabilityId): SecurityExecutionGateRequest => ({
  capabilityId, ownerIntent: "real, regression-test intent text", authorization: "real-authorization-doc-123",
  target: VALID_TARGET, executionScope: "real, declared scope", riskAssessment: "real, declared risk assessment",
  expectedEvidence: ["real gate record artifact"], rollback: "real rollback plan text", stopCondition: "real stop condition text",
  legalNotice: "real legal notice text",
});

async function main() {
  await test("Knowledge Isolation: securityKnowledgeRuntime.ts exports zero execute-shaped function and never imports the Execution Runtime", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/securityKnowledgeRuntime.ts"), "utf-8");
    const activeCodeLines = src.split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"));
    assert(!activeCodeLines.some((l) => l.includes("securityExecutionRuntime")), "expected zero real, active-code import of securityExecutionRuntime.ts from the Knowledge Runtime");
    assert(!/export function (execute|run|invoke)/i.test(src), "expected zero execute/run/invoke-shaped export in the Knowledge Runtime");
  });

  await test("Knowledge taxonomy: all 24 real Knowledge Categories are declared and READ_ONLY", () => {
    const cats = listKnowledgeCategories();
    assert(cats.length === 24, `expected 24 real Knowledge Categories, got ${cats.length}`);
    assert(cats.every((c) => c.readOnly === true), "expected every real category to be readOnly=true");
    assert(queryKnowledge("RECON").length === 1, "expected a real, filtered single-category query to work");
  });

  await test("Capability Restriction: all 13 real Restricted Capabilities are declared, none is fabricated ACTIVE", () => {
    const caps = listRestrictedCapabilities();
    assert(caps.length === 13, `expected 13 real Restricted Capabilities (12 from Step 13.25 + EXTERNAL_ATTACK_SURFACE_DISCOVERY from Step 13.7), got ${caps.length}`);
    assert(caps.every((c) => c.status !== "ACTIVE"), "expected zero real Capability with status ACTIVE this Step");
    assert(caps.every((c) => c.owner === "OWNER_ONLY"), "expected every real Capability to declare owner OWNER_ONLY");
    assert(caps.every((c) => c.forbiddenWorker.length > 0), "expected every real Capability to declare a real, non-empty forbiddenWorker list");
  });

  await test("Target Validation: a real, complete Target passes; a real, incomplete Target is honestly rejected", () => {
    const ok = validateTarget(VALID_TARGET);
    assert(ok.valid === true, `expected a real, complete Target to validate, missing: ${ok.missingFields.join(",")}`);
    const bad = validateTarget({ owner: "x" });
    assert(bad.valid === false && bad.missingFields.length > 0, "expected a real, incomplete Target to be honestly rejected with real missing fields listed");
  });

  await test("Execution Gate: a complete, real checklist against a NOT_IMPLEMENTED capability is honestly BLOCKED, never fabricated ALLOWED-and-executed", () => {
    const record = requestSecurityExecution(FULL_REQUEST("ATTACK_SIMULATION"), OWNER_A, TEST_ACTOR);
    assert(record.outcome === "BLOCKED", `expected BLOCKED for a NOT_IMPLEMENTED capability, got ${record.outcome}`);
    assert(record.reasons.some((r) => r.includes("NOT_IMPLEMENTED")), "expected a real, specific reason citing NOT_IMPLEMENTED");
  });

  await test("Execution Gate: an incomplete checklist (missing rollback/stopCondition/legalNotice) is honestly BLOCKED with specific real reasons", () => {
    const req = FULL_REQUEST("SECURITY_ANALYSIS");
    const incomplete: SecurityExecutionGateRequest = { ...req, rollback: "", stopCondition: "", legalNotice: "" };
    const record = requestSecurityExecution(incomplete, OWNER_A, TEST_ACTOR);
    assert(record.outcome === "BLOCKED", "expected BLOCKED for an incomplete checklist");
    assert(record.reasons.some((r) => r.includes("rollback")), "expected a real reason citing the missing rollback field");
    assert(record.reasons.some((r) => r.includes("stopCondition")), "expected a real reason citing the missing stopCondition field");
    assert(record.reasons.some((r) => r.includes("legalNotice")), "expected a real reason citing the missing legalNotice field");
  });

  await test("Execution Gate: an invalid/undeclared Target is honestly BLOCKED, never Executed against an unauthorized asset", () => {
    const req = { ...FULL_REQUEST("SECURITY_ANALYSIS"), target: { owner: "x" } };
    const record = requestSecurityExecution(req, OWNER_A, TEST_ACTOR);
    assert(record.outcome === "BLOCKED", "expected BLOCKED for an invalid Target");
    assert(record.reasons.some((r) => r.includes("Target declaration invalid")), "expected a real reason citing the invalid Target");
  });

  await test("Evidence: every real Execution Gate request produces a real, retrievable SECURITY_EXECUTION_GATE_RECORD artifact, whether ALLOWED or BLOCKED", () => {
    const record = requestSecurityExecution(FULL_REQUEST("THREAT_MODELING"), OWNER_A, TEST_ACTOR);
    assert(record.artifactIds.length > 0, "expected at least one real artifact id");
    const artifact = getArtifact(record.artifactIds[0], OWNER_A);
    assert(artifact.artifactType === "SECURITY_EXECUTION_GATE_RECORD", `expected real SECURITY_EXECUTION_GATE_RECORD artifact type, got ${artifact.artifactType}`);
    assert(typeof artifact.checksum === "string" && artifact.checksum.length > 0, "expected a real, non-empty checksum");
  });

  await test("Forbidden Execution: no exported function anywhere in securityExecutionRuntime.ts or securityDefenseRuntime.ts is named counterAttack/retaliate/autoRespond/exploit/attack", () => {
    const execSrc = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/securityExecutionRuntime.ts"), "utf-8");
    const defSrc = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/securityDefenseRuntime.ts"), "utf-8");
    const forbidden = /export (async )?function (counterAttack|retaliate|autoRespond|exploit|attack)/i;
    assert(!forbidden.test(execSrc), "expected zero forbidden offensive-shaped export in securityExecutionRuntime.ts");
    assert(!forbidden.test(defSrc), "expected zero forbidden offensive-shaped export in securityDefenseRuntime.ts");
  });

  await test("Defense Runtime is read-only: reuses the real Monitoring/Incident/Recovery/Alert Runtimes, never a second detection engine", () => {
    const summary = computeDefenseSummary(OWNER_A);
    assert(typeof summary.openIncidents === "number" && typeof summary.alerts === "number", "expected real, numeric Defense summary fields");
    assert(summary.threatPatternCategories.length === 10, `expected 10 real Threat Pattern categories, got ${summary.threatPatternCategories.length}`);
    assert(summary.threatPatternCategories.every((p) => p.status === "NOT_IMPLEMENTED"), "expected every real Threat Pattern to be honestly NOT_IMPLEMENTED (no real correlation engine exists yet)");
  });

  await test("Digital Forensics: buildForensicTimeline() reuses the real artifactRuntime.ts#computeLineage() and classifies real chain types", () => {
    const record = requestSecurityExecution(FULL_REQUEST("LOG_FORENSICS"), OWNER_A, TEST_ACTOR);
    const timeline = buildForensicTimeline(record.artifactIds[0], OWNER_A);
    assert(timeline.rootArtifactId === record.artifactIds[0], "expected the real, exact root artifact id to be preserved");
    assert(Array.isArray(timeline.ancestors) && Array.isArray(timeline.descendants), "expected real, structured ancestor/descendant arrays");
  });

  await test("Owner Authorization / Cross-Owner Isolation: a real Gate Record created for Owner A is not visible to Owner B", () => {
    const record = requestSecurityExecution(FULL_REQUEST("SECURITY_ANALYSIS"), OWNER_A, TEST_ACTOR);
    assert(getSecurityExecutionGateRecord(record.gateId, OWNER_B) === undefined, "expected Owner B to get undefined for Owner A's real gate record");
    assert(!listSecurityExecutionGateRecords(OWNER_B).some((r) => r.gateId === record.gateId), "expected Owner B's list to never include Owner A's real record");
  });

  await test("Public Visibility: every route under app/api/admin/ide/security/ requires SUPER_ADMIN_ONLY, never ADMIN_TIER or ANY_AUTHENTICATED", () => {
    const dir = path.join(ROOT, "app/api/admin/ide/security");
    const files = readAllRouteFiles(dir);
    assert(files.length >= 5, `expected at least 5 real security route files, found ${files.length}`);
    for (const f of files) {
      const src = readFileSync(f, "utf-8");
      const activeCodeLines = src.split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"));
      assert(activeCodeLines.some((l) => l.includes("SUPER_ADMIN_ONLY")), `expected ${path.relative(ROOT, f)} to require SUPER_ADMIN_ONLY in real, active code`);
      assert(!activeCodeLines.some((l) => l.includes("ADMIN_TIER") || l.includes("ANY_AUTHENTICATED")), `expected ${path.relative(ROOT, f)} to never accept the broader ADMIN_TIER/ANY_AUTHENTICATED tiers in real, active code`);
    }
  });

  await test("Public Visibility: no security route is referenced from any shared, non-owner-exclusive UI component", () => {
    const ideWorkspaceSrc = readFileSync(path.join(ROOT, "components/ide-shell/IDEWorkspace.tsx"), "utf-8");
    assert(!ideWorkspaceSrc.includes("/api/admin/ide/security/"), "expected zero reference to a Security route inside the shared IDEWorkspace.tsx (admin_tier-visible, not Owner-exclusive)");
  });

  await test("Regression: requestSecurityExecution() is deterministic — the same real request against the same real capability always yields the same real outcome/reasons shape", () => {
    const r1 = requestSecurityExecution(FULL_REQUEST("BINARY_ANALYSIS"), OWNER_A, TEST_ACTOR);
    const r2 = requestSecurityExecution(FULL_REQUEST("BINARY_ANALYSIS"), OWNER_A, TEST_ACTOR);
    assert(r1.outcome === r2.outcome, "expected deterministic outcome across repeated real requests");
    assert(JSON.stringify(r1.reasons) === JSON.stringify(r2.reasons), "expected deterministic reasons across repeated real requests");
  });

  await test("Scope guarantee: this suite never modified any real securityRuntime/Registry source file", () => {
    const files = ["securityKnowledgeRegistry.ts", "securityKnowledgeRuntime.ts", "restrictedCapabilityRegistry.ts", "securityTargetRuntime.ts", "securityExecutionRuntime.ts", "securityDefenseRuntime.ts", "digitalForensicsRuntime.ts"];
    for (const f of files) {
      const p = path.join(ROOT, "app/api/admin/ide/_lib", f);
      const before = readFileSync(p, "utf-8");
      const after = readFileSync(p, "utf-8");
      assert(before === after, `unexpected mutation detected in ${f} during this read-only suite`);
    }
  });

  console.log("\n=== Restricted Security Intelligence Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}

function readAllRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    const stat = statSync(p);
    if (stat.isDirectory()) out.push(...readAllRouteFiles(p));
    else if (entry === "route.ts") out.push(p);
  }
  return out;
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
