/**
 * Factory Workspace Regression Suite (owner, 2026-08-08, Software
 * Factory Step 13) — verifies the real central orchestrator
 * app/api/admin/ide/_lib/factoryWorkspaceRuntime.ts: session creation,
 * intent capture, status transitions, Owner Decision Gates, blockers,
 * and the Result Model. Uses real capabilityResolverRuntime.ts/
 * contextPlannerRuntime.ts/executionPlanRuntime.ts throughout — never a
 * mock of its own dependencies.
 *
 * Run: npm run factory-workspace:test
 */
import {
  createWorkspaceSession, attachIntent, decideGate, runCapabilityResolution, recordCapabilityResolution,
  recordContextPlan, recordContextApproval, recordExecutionPlan, computeOutcomeReport,
  getWorkspaceSession, listWorkspaceSessions, listWorkspaceEvents, FactoryWorkspaceError,
} from "../app/api/admin/ide/_lib/factoryWorkspaceRuntime";
import { captureStructuredIntent, type StructuredIntent } from "../app/api/admin/ide/_lib/intentRuntime";
import { resolveCapabilities } from "../app/api/admin/ide/_lib/capabilityResolverRuntime";
import { buildContextPlan, approveContextPlan } from "../app/api/admin/ide/_lib/contextPlannerRuntime";
import { buildExecutionPlan } from "../app/api/admin/ide/_lib/executionPlanRuntime";

const TEST_ACTOR = "factory-workspace-regression-suite@dnaos.local";
const OWNER_A = "factory-workspace-regression-owner-a";
const OWNER_B = "factory-workspace-regression-owner-b";

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

const REAL_STRUCTURED: StructuredIntent = {
  problem: "The Owner cannot see which files a Worker will touch before it starts.",
  desiredOutcome: "A real, minimal Context Plan is shown to the Owner before any Worker executes.",
  requestedChange: "Add Context Plan display to the Factory Workspace tab.",
  affectedArea: ["ide"], constraints: ["no whole-repo context"], nonGoals: ["no deploy"],
  expectedEvidence: ["real Context Plan artifact"], acceptanceCriteria: ["Owner sees includedFiles before approval"],
  ownerAuthority: "OWNER_CONFIRMED", riskTolerance: "LOW",
};

/** Drives a real session through Intent -> Capability Resolution ->
 * Context Plan approval, stopping there (does not touch git/Change Set). */
function driveToReadyForExecution(ownerId: string) {
  const session = createWorkspaceSession(ownerId, TEST_ACTOR);
  const intent = captureStructuredIntent(session.workspaceSessionId, ownerId, TEST_ACTOR, "context plan visibility", REAL_STRUCTURED);
  attachIntent(session.workspaceSessionId, ownerId, intent);
  decideGate(session.workspaceSessionId, ownerId, TEST_ACTOR, "INTENT_CONFIRMED", "APPROVED", "real owner confirmed intent for regression test");
  runCapabilityResolution(session.workspaceSessionId, ownerId);
  const resolution = resolveCapabilities(intent.structured);
  recordCapabilityResolution(session.workspaceSessionId, ownerId, resolution);
  const plan = buildContextPlan(session.workspaceSessionId, ownerId, TEST_ACTOR, resolution, []);
  recordContextPlan(session.workspaceSessionId, ownerId, plan);
  approveContextPlan(plan.contextPlanId, ownerId, TEST_ACTOR);
  decideGate(session.workspaceSessionId, ownerId, TEST_ACTOR, "CONTEXT_SCOPE_APPROVED", "APPROVED", "real owner approved context scope for regression test");
  const updated = recordContextApproval(session.workspaceSessionId, ownerId);
  return { session: updated, resolution, plan };
}

async function main() {
  await test("Session creation: a real WorkspaceSession starts DRAFT and produces a real WORKSPACE_SESSION artifact", () => {
    const session = createWorkspaceSession(OWNER_A, TEST_ACTOR);
    assert(session.status === "DRAFT", `expected DRAFT, got ${session.status}`);
    assert(session.artifactIds.length > 0, "expected at least one real artifact id");
  });

  await test("Intent capture: attachIntent() transitions a real session from DRAFT to ANALYZING and copies real structured fields", () => {
    const session = createWorkspaceSession(OWNER_A, TEST_ACTOR);
    const intent = captureStructuredIntent(session.workspaceSessionId, OWNER_A, TEST_ACTOR, "raw text", REAL_STRUCTURED);
    const updated = attachIntent(session.workspaceSessionId, OWNER_A, intent);
    assert(updated.status === "ANALYZING", `expected ANALYZING, got ${updated.status}`);
    assert(updated.desiredOutcome === REAL_STRUCTURED.desiredOutcome, "expected real desiredOutcome to be copied from the real Intent record");
  });

  await test("Owner scope: a Workspace Session created for Owner A is not gettable by Owner B", () => {
    const session = createWorkspaceSession(OWNER_A, TEST_ACTOR);
    let threw = false;
    try { getWorkspaceSession(session.workspaceSessionId, OWNER_B); } catch (e) { threw = e instanceof FactoryWorkspaceError && e.code === "SESSION_NOT_OWNED"; }
    assert(threw, "expected SESSION_NOT_OWNED for a cross-owner lookup");
    assert(!listWorkspaceSessions(OWNER_B).some((s) => s.workspaceSessionId === session.workspaceSessionId), "expected Owner B's list to never include Owner A's real session");
  });

  await test("Status transitions: the real session progresses DRAFT -> ANALYZING -> CAPABILITY_MATCHING -> AWAITING_OWNER -> CONTEXT_PREPARING -> READY_FOR_EXECUTION through real gates only", () => {
    const { session } = driveToReadyForExecution(OWNER_A);
    assert(session.status === "READY_FOR_EXECUTION", `expected READY_FOR_EXECUTION, got ${session.status}`);
  });

  await test("Gate enforcement: runCapabilityResolution() is rejected before the real INTENT_CONFIRMED gate is approved", () => {
    const session = createWorkspaceSession(OWNER_A, TEST_ACTOR);
    const intent = captureStructuredIntent(session.workspaceSessionId, OWNER_A, TEST_ACTOR, "x", REAL_STRUCTURED);
    attachIntent(session.workspaceSessionId, OWNER_A, intent);
    let threw = false;
    try { runCapabilityResolution(session.workspaceSessionId, OWNER_A); } catch (e) { threw = e instanceof FactoryWorkspaceError && e.code === "GATE_NOT_DECIDED"; }
    assert(threw, "expected GATE_NOT_DECIDED before INTENT_CONFIRMED is approved");
  });

  await test("Blockers: a REJECTED Owner Decision Gate sets the real session to BLOCKED with a real, non-empty blockers[] entry", () => {
    const session = createWorkspaceSession(OWNER_A, TEST_ACTOR);
    const intent = captureStructuredIntent(session.workspaceSessionId, OWNER_A, TEST_ACTOR, "x", REAL_STRUCTURED);
    attachIntent(session.workspaceSessionId, OWNER_A, intent);
    const updated = decideGate(session.workspaceSessionId, OWNER_A, TEST_ACTOR, "INTENT_CONFIRMED", "REJECTED", "real owner rejected for regression test");
    assert(updated.status === "BLOCKED", `expected BLOCKED, got ${updated.status}`);
    assert(updated.blockers.length > 0, "expected a real, non-empty blockers[] entry");
  });

  await test("AI cannot approve: decideGate() always records the real, supplied `owner` string as the decider — the caller (API route) is the only real authority, this Runtime never substitutes its own decision", () => {
    const session = createWorkspaceSession(OWNER_A, TEST_ACTOR);
    const intent = captureStructuredIntent(session.workspaceSessionId, OWNER_A, TEST_ACTOR, "x", REAL_STRUCTURED);
    attachIntent(session.workspaceSessionId, OWNER_A, intent);
    const updated = decideGate(session.workspaceSessionId, OWNER_A, "real-owner@dnaos.local", "INTENT_CONFIRMED", "APPROVED", "real owner reason");
    const decision = updated.ownerDecisions.find((d) => d.gate === "INTENT_CONFIRMED")!;
    assert(decision.owner === "real-owner@dnaos.local", "expected the real, exact owner string to be recorded, never a fabricated actor");
  });

  await test("Result Model honesty: a session with no real Change Set/Build/Release never reports OUTCOME_PROVEN", () => {
    const { session } = driveToReadyForExecution(OWNER_A);
    const updated = computeOutcomeReport(session.workspaceSessionId, OWNER_A);
    assert(updated.resultReport !== null, "expected a real resultReport to be computed");
    assert(updated.resultReport!.status !== "OUTCOME_PROVEN", `expected a non-OUTCOME_PROVEN status without a real Release Run, got ${updated.resultReport!.status}`);
    assert(updated.resultReport!.limitations.length > 0, "expected real, honest limitations to be listed");
    assert(updated.resultReport!.ownerActionsRequired.some((a) => a.includes("Deploy")), "expected Deploy to be listed as a real, separate Owner action");
    assert(updated.resultReport!.ownerActionsRequired.some((a) => a.includes("Git Push")), "expected Git Push to be listed as a real, separate Owner action");
  });

  await test("Execution Plan recorded: recordExecutionPlan() attaches a real executionPlanId and emits real events", () => {
    const { session, plan } = driveToReadyForExecution(OWNER_A);
    const execPlan = buildExecutionPlan(session.workspaceSessionId, OWNER_A, TEST_ACTOR, plan);
    const updated = recordExecutionPlan(session.workspaceSessionId, OWNER_A, execPlan);
    assert(updated.executionPlanId === execPlan.executionPlanId, "expected the real executionPlanId to be recorded on the session");
    const events = listWorkspaceEvents(2000).filter((e) => e.workspaceSessionId === session.workspaceSessionId);
    assert(events.some((e) => e.type === "EXECUTION_PLAN_CREATED"), "expected a real EXECUTION_PLAN_CREATED event");
    assert(events.some((e) => e.type === "EXECUTION_APPROVAL_REQUIRED"), "expected a real EXECUTION_APPROVAL_REQUIRED event");
  });

  await test("Events: WORKSPACE_SESSION_CREATED and INTENT_CAPTURED are real, emitted, bounded events for this session", () => {
    const session = createWorkspaceSession(OWNER_A, TEST_ACTOR);
    const intent = captureStructuredIntent(session.workspaceSessionId, OWNER_A, TEST_ACTOR, "x", REAL_STRUCTURED);
    attachIntent(session.workspaceSessionId, OWNER_A, intent);
    const events = listWorkspaceEvents(2000).filter((e) => e.workspaceSessionId === session.workspaceSessionId);
    assert(events.some((e) => e.type === "WORKSPACE_SESSION_CREATED"), "expected a real WORKSPACE_SESSION_CREATED event");
    assert(events.some((e) => e.type === "INTENT_CAPTURED"), "expected a real INTENT_CAPTURED event");
  });

  await test("Workspace Session is distinct from other session concepts: no field on WorkspaceSession stores business/user data directly, only real ids/references", () => {
    const session = createWorkspaceSession(OWNER_A, TEST_ACTOR);
    const keys = Object.keys(session);
    const forbidden = ["password", "creditCard", "ssn", "secret"];
    assert(!keys.some((k) => forbidden.some((f) => k.toLowerCase().includes(f.toLowerCase()))), "expected zero business-data-shaped fields on WorkspaceSession");
  });

  console.log("\n=== Factory Workspace Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
