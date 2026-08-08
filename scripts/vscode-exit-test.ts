/**
 * VS Code Exit Regression Suite (owner, 2026-08-08, Software Factory
 * Step 13, Section 14) — verifies the real, per-session VS Code
 * Dependency Measurement (factoryWorkspaceRuntime.ts's
 * computeVSCodeDependencyReport) and the whole-repo audit
 * (factoryCompletionRuntime.ts's computeVSCodeDependencyAudit) agree on
 * one real fact: FULL_EXIT is never claimed while CODE_WORKER is not
 * real, live-proven ACTIVE (as of Step 13.5, honestly PARTIAL).
 *
 * Run: npm run vscode-exit:test
 */
import { readFileSync } from "fs";
import path from "path";
import {
  createWorkspaceSession, attachIntent, decideGate, runCapabilityResolution, recordCapabilityResolution,
  recordContextPlan, recordContextApproval, computeVSCodeDependencyReport, type VSCodeDependencyClass,
} from "../app/api/admin/ide/_lib/factoryWorkspaceRuntime";
import { captureStructuredIntent, type StructuredIntent } from "../app/api/admin/ide/_lib/intentRuntime";
import { resolveCapabilities } from "../app/api/admin/ide/_lib/capabilityResolverRuntime";
import { buildContextPlan, approveContextPlan } from "../app/api/admin/ide/_lib/contextPlannerRuntime";
import { computeVSCodeDependencyAudit, computeCompletionGates, computeFactoryCompletion } from "../app/api/admin/ide/_lib/factoryCompletionRuntime";
import { WORKER_REGISTRY } from "../app/api/admin/ide/_lib/workerRegistry";

const ROOT = path.join(__dirname, "..");
const ACTOR = "vscode-exit-regression-suite@dnaos.local";
const OWNER = "vscode-exit-regression-owner";
const VALID_CLASSES: VSCodeDependencyClass[] = ["DNA_OS_NATIVE", "EXTERNAL_TOOL_HIDDEN", "OWNER_EXTERNAL_ACTION_REQUIRED", "MANUAL", "NOT_IMPLEMENTED", "UNKNOWN", "CODE_WORKER_API_NATIVE", "CODE_WORKER_CLI_NATIVE", "CODE_WORKER_MCP_NATIVE", "CODE_WORKER_LOCAL_NATIVE", "HUMAN_EXTERNAL", "DEPLOY_EXTERNAL", "GIT_EXTERNAL"];

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

const STRUCTURED: StructuredIntent = {
  problem: "vscode-exit probe", desiredOutcome: "measure real per-session native-flow dependency", requestedChange: "n/a",
  affectedArea: ["ide"], constraints: [], nonGoals: [], expectedEvidence: [], acceptanceCriteria: [],
  ownerAuthority: "OWNER_CONFIRMED", riskTolerance: "LOW",
};

function driveToReadyForExecution() {
  const session = createWorkspaceSession(OWNER, ACTOR);
  const intent = captureStructuredIntent(session.workspaceSessionId, OWNER, ACTOR, "x", STRUCTURED);
  attachIntent(session.workspaceSessionId, OWNER, intent);
  decideGate(session.workspaceSessionId, OWNER, ACTOR, "INTENT_CONFIRMED", "APPROVED", "probe");
  runCapabilityResolution(session.workspaceSessionId, OWNER);
  const resolution = resolveCapabilities(intent.structured);
  recordCapabilityResolution(session.workspaceSessionId, OWNER, resolution);
  const plan = buildContextPlan(session.workspaceSessionId, OWNER, ACTOR, resolution, []);
  recordContextPlan(session.workspaceSessionId, OWNER, plan);
  approveContextPlan(plan.contextPlanId, OWNER, ACTOR);
  decideGate(session.workspaceSessionId, OWNER, ACTOR, "CONTEXT_SCOPE_APPROVED", "APPROVED", "probe");
  return recordContextApproval(session.workspaceSessionId, OWNER);
}

async function main() {
  await test("A fresh session with no real flow progress reports NOT_PROVEN, never a fabricated NATIVE_FLOW_PROVEN", () => {
    const session = createWorkspaceSession(OWNER, ACTOR);
    const report = computeVSCodeDependencyReport(session.workspaceSessionId, OWNER);
    assert(report.exitLevel === "NOT_PROVEN", `expected NOT_PROVEN for a fresh session, got ${report.exitLevel}`);
    assert(report.nativeFlowProven === false, "expected nativeFlowProven=false for a fresh session");
  });

  await test("Every real per-session dependency step uses only the real, spec-defined VSCodeDependencyClass enum", () => {
    const session = driveToReadyForExecution();
    const report = computeVSCodeDependencyReport(session.workspaceSessionId, OWNER);
    for (const step of report.steps) assert(VALID_CLASSES.includes(step.classification), `step "${step.stage}" has invalid classification ${step.classification}`);
  });

  await test("Core native stages (Intent/Capability/Context) are honestly DNA_OS_NATIVE once real progress is made — never MANUAL, never fabricated", () => {
    const session = driveToReadyForExecution();
    const report = computeVSCodeDependencyReport(session.workspaceSessionId, OWNER);
    const intentStage = report.steps.find((s) => s.stage === "Intent Capture")!;
    const capStage = report.steps.find((s) => s.stage === "Capability Resolution")!;
    const ctxStage = report.steps.find((s) => s.stage === "Context Planning")!;
    assert(intentStage.classification === "DNA_OS_NATIVE", `expected Intent Capture DNA_OS_NATIVE, got ${intentStage.classification}`);
    assert(capStage.classification === "DNA_OS_NATIVE", `expected Capability Resolution DNA_OS_NATIVE, got ${capStage.classification}`);
    assert(ctxStage.classification === "DNA_OS_NATIVE", `expected Context Planning DNA_OS_NATIVE, got ${ctxStage.classification}`);
  });

  await test("Remaining VS Code dependency is honestly disclosed: Deploy is DEPLOY_EXTERNAL and Git Push is GIT_EXTERNAL, regardless of session progress (Step 13.6, Section 22)", () => {
    const session = driveToReadyForExecution();
    const report = computeVSCodeDependencyReport(session.workspaceSessionId, OWNER);
    const deploy = report.steps.find((s) => s.stage === "Deploy")!;
    const gitPush = report.steps.find((s) => s.stage === "Git Push")!;
    assert(deploy.classification === "DEPLOY_EXTERNAL", `expected Deploy DEPLOY_EXTERNAL, got ${deploy.classification}`);
    assert(gitPush.classification === "GIT_EXTERNAL", `expected Git Push GIT_EXTERNAL, got ${gitPush.classification}`);
  });

  await test("No fake FULL_EXIT: FULL_EXIT is not even a member of the real exitLevel enum this Runtime can return", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/factoryWorkspaceRuntime.ts"), "utf-8");
    const exitLevelLine = src.split("\n").find((l) => l.includes('exitLevel: "NATIVE_FLOW_PROVEN"'))!;
    assert(!!exitLevelLine, "expected to find the real exitLevel type declaration");
    assert(!exitLevelLine.includes("FULL_EXIT"), "expected FULL_EXIT to never be a possible real return value");
  });

  await test("Factory Completion's whole-repo VS_CODE_EXIT_READY gate stays BLOCKED while CODE_WORKER is honestly PARTIAL (real path, unproven live) — this Step's real infrastructure does not flip it to PASSED", () => {
    assert(WORKER_REGISTRY.CODE_WORKER.status === "PARTIAL", "expected CODE_WORKER to be honestly PARTIAL as of Step 13.5");
    assert(WORKER_REGISTRY.CODE_WORKER.status !== "ACTIVE", "expected CODE_WORKER to never be fabricated ACTIVE without a real, live-proven call");
    const gates = computeCompletionGates();
    const gate = gates.find((g) => g.id === "VS_CODE_EXIT_READY")!;
    assert(gate.status === "BLOCKED", `expected VS_CODE_EXIT_READY to stay BLOCKED, got ${gate.status}`);
  });

  await test("VS Code dependency audit never claims blockingOwnerMigration=false for Claude Code/VS Code without a real, code-checkable reason", () => {
    const audit = computeVSCodeDependencyAudit();
    const claudeCode = audit.find((v) => v.tool.includes("Claude Code"))!;
    assert(claudeCode.blockingOwnerMigration === true, "expected Claude Code/VS Code to remain honestly blocking");
    assert(claudeCode.evidence.includes("PARTIAL"), "expected the real, checkable PARTIAL status evidence to be cited, not a vague claim");
  });

  await test("Factory Workspace system itself is real (not NOT_IMPLEMENTED) even though VS Code exit remains blocked — the two facts coexist honestly", () => {
    const systems = computeFactoryCompletion();
    const fw = systems.find((s) => s.id === "FACTORY_WORKSPACE")!;
    assert(fw.status !== "NOT_IMPLEMENTED", `expected FACTORY_WORKSPACE to be real and built, got ${fw.status}`);
  });

  await test("A real VS_CODE_DEPENDENCY_REPORT artifact is produced per session, never shared/cached across sessions", () => {
    const sessionA = driveToReadyForExecution();
    const sessionB = driveToReadyForExecution();
    const reportA = computeVSCodeDependencyReport(sessionA.workspaceSessionId, OWNER);
    const reportB = computeVSCodeDependencyReport(sessionB.workspaceSessionId, OWNER);
    assert(reportA.workspaceSessionId !== reportB.workspaceSessionId, "expected distinct real workspaceSessionId per report");
  });

  console.log("\n=== VS Code Exit Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
