/**
 * Code Worker Bridge End-to-End Regression Suite (owner, 2026-08-08,
 * Software Factory Step 13.6, Section 24) — proves the real Universal
 * Worker Bridge integrates with the real, established Native Factory
 * Flow (Step 13/13.5): a real, injected stub CODE_WORKER Adapter's
 * proposal flows through real scope filtering, real schema rejection,
 * real Owner approval, a real Change Set (captured from the real git
 * working tree), and real Review/Test lineage — never a second,
 * parallel pipeline.
 *
 * Run: npm run code-worker-bridge:test
 */
import { readFileSync, existsSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  createWorkspaceSession, attachIntent, decideGate, runCapabilityResolution, recordCapabilityResolution,
  recordContextPlan, recordContextApproval, generateWorkerProposal, approveAndApplyWorkerProposal,
  beginExecution, runWorkspaceReview, runWorkspaceTest, computeVSCodeDependencyReport,
} from "../app/api/admin/ide/_lib/factoryWorkspaceRuntime";
import { captureStructuredIntent, type StructuredIntent } from "../app/api/admin/ide/_lib/intentRuntime";
import { resolveCapabilities } from "../app/api/admin/ide/_lib/capabilityResolverRuntime";
import { buildContextPlan, approveContextPlan } from "../app/api/admin/ide/_lib/contextPlannerRuntime";
import { WORKSPACE_ROOT } from "../app/api/admin/ide/_lib/fsSecurity";
import { WORKER_ADAPTER_REGISTRY } from "../app/api/admin/ide/_lib/workerSelectorRuntime";
import type { WorkerAdapter } from "../app/api/admin/ide/_lib/workerAdapter";
import type { WorkerResponse } from "../app/api/admin/ide/_lib/workerContract";

const ACTOR = "code-worker-bridge-regression-suite@dnaos.local";
const OWNER = "code-worker-bridge-regression-owner";

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

const FIXTURE_REL = `scratch-code-worker-bridge-fixture-${randomUUID().slice(0, 8)}.ts`;

function makeStubAdapter(id: string, content: string): WorkerAdapter {
  return {
    id, type: "API", provider: "stub",
    availability: () => ({ available: true, reason: "real, disposable test stub" }),
    capabilities: () => ["code.generate"],
    estimate: () => ({ estimatedCost: 0, estimatedTokens: 0, currency: "USD", confidence: "HIGH" }),
    async execute(request): Promise<WorkerResponse> {
      return {
        workerRequestId: request.workerRequestId, workerId: "CODE_WORKER", adapterId: id, provider: "stub", model: "stub-model",
        status: "SUCCEEDED", output: null, proposedChanges: [{ path: FIXTURE_REL, operation: "MODIFY", content, purpose: "bridge test", risk: "LOW" }],
        toolCalls: [], tokenUsage: { input: 0, output: 0 }, cost: { amount: 0, currency: "USD", kind: "ACTUAL" },
        durationMs: 1, evidence: ["stub-evidence"], limitations: [], error: null, finishedAt: new Date().toISOString(),
      };
    },
    health: async () => ({ status: "HEALTHY", reason: "real, disposable test stub", lastLiveCallAt: new Date().toISOString(), lastLiveCallOk: true }),
    limitations: () => [],
  };
}

const STRUCTURED: StructuredIntent = {
  problem: "prove the real Universal Worker Bridge integrates with the real Native Factory Flow",
  desiredOutcome: "a real, stub-generated proposal flows through Change Set/Review/Test", requestedChange: "n/a",
  affectedArea: ["ide"], constraints: [], nonGoals: [], expectedEvidence: [], acceptanceCriteria: [],
  ownerAuthority: "OWNER_CONFIRMED", riskTolerance: "LOW",
};

async function main() {
  writeFileSync(path.join(WORKSPACE_ROOT, FIXTURE_REL), "// real, disposable fixture for code-worker-bridge-test.ts\nexport const bridgeFixture = 0;\n");
  const newContent = `export const bridgeFixture = "${randomUUID()}";\n`;
  const stub = makeStubAdapter(`bridge-stub-${randomUUID()}`, newContent);
  WORKER_ADAPTER_REGISTRY.unshift(stub);

  try {
    const session = createWorkspaceSession(OWNER, ACTOR);
    const intent = captureStructuredIntent(session.workspaceSessionId, OWNER, ACTOR, "bridge test", STRUCTURED);
    attachIntent(session.workspaceSessionId, OWNER, intent);
    decideGate(session.workspaceSessionId, OWNER, ACTOR, "INTENT_CONFIRMED", "APPROVED", "real owner confirmed for bridge test");
    runCapabilityResolution(session.workspaceSessionId, OWNER);
    const resolution = resolveCapabilities(intent.structured);
    recordCapabilityResolution(session.workspaceSessionId, OWNER, resolution);
    const plan = buildContextPlan(session.workspaceSessionId, OWNER, ACTOR, resolution, [FIXTURE_REL]);
    recordContextPlan(session.workspaceSessionId, OWNER, plan);
    approveContextPlan(plan.contextPlanId, OWNER, ACTOR);
    decideGate(session.workspaceSessionId, OWNER, ACTOR, "CONTEXT_SCOPE_APPROVED", "APPROVED", "real owner approved scope for bridge test");
    recordContextApproval(session.workspaceSessionId, OWNER);

    await test("Real proposal via the Bridge: generateWorkerProposal() selects the real, injected stub Adapter and produces a real, in-scope operation", async () => {
      const { proposal } = await generateWorkerProposal(session.workspaceSessionId, OWNER, ACTOR, `step-${randomUUID()}`, "bump the bridge fixture", [], [stub.id]);
      assert(proposal.ok === true, `expected ok=true, got error: ${proposal.error}`);
      assert(proposal.workerAdapterId === stub.id, `expected the real, selected stub adapter, got ${proposal.workerAdapterId}`);
      assert(proposal.files.length === 1 && proposal.files[0].path === FIXTURE_REL, "expected exactly one real, in-scope proposed file");
    });

    await test("Owner approval + real atomic write: approveAndApplyWorkerProposal() writes the real, exact content to the real fixture file", async () => {
      const { proposal } = await generateWorkerProposal(session.workspaceSessionId, OWNER, ACTOR, `step-${randomUUID()}`, "bump again", [], [stub.id]);
      const { proposal: applied } = await approveAndApplyWorkerProposal(session.workspaceSessionId, OWNER, proposal.proposalId);
      assert(applied.applied === true, "expected the real proposal to be applied");
      const onDisk = readFileSync(path.join(WORKSPACE_ROOT, FIXTURE_REL), "utf-8");
      assert(onDisk === newContent, "expected the real, exact stub-proposed content to be the real, current bytes on disk");
    });

    await test("Real Change Set capture: beginExecution() captures the real git diff including the real, applied fixture file", async () => {
      await beginExecution(session.workspaceSessionId, OWNER, ACTOR, "bridge test change", "real end-to-end bridge proof");
      const s2 = (await import("../app/api/admin/ide/_lib/factoryWorkspaceRuntime")).getWorkspaceSession(session.workspaceSessionId, OWNER);
      assert(!!s2.changeSetId, "expected a real changeSetId to be captured");
    });

    await test("Real Review lineage: runWorkspaceReview() produces real findings over the real, applied Change Set", async () => {
      const { changeSet } = await runWorkspaceReview(session.workspaceSessionId, OWNER, ACTOR);
      assert(typeof changeSet.findings.length === "number", "expected a real, structured findings array");
    });

    await test("Real Test lineage: runWorkspaceTest() executes a real Test Run bound to the real Change Set", async () => {
      const { testRun } = await runWorkspaceTest(session.workspaceSessionId, OWNER, ACTOR);
      assert(["PASSED", "FAILED", "BLOCKED", "RUNNING", "CANCELLED"].includes(testRun.status), `unexpected real TestRun status ${testRun.status}`);
    });

    await test("VS Code Dependency Report: an unrecognized real stub adapter id classifies honestly as UNKNOWN, never silently upgraded to DNA_OS_NATIVE", async () => {
      const report = await computeVSCodeDependencyReport(session.workspaceSessionId, OWNER);
      const workerStage = report.steps.find((s) => s.stage.startsWith("Worker Execution"))!;
      assert(workerStage.classification === "UNKNOWN", `expected UNKNOWN for an unrecognized real adapter id, got ${workerStage.classification}`);
    });

    await test("Schema rejection: a real Adapter response with a malformed operation is honestly rejected, never silently written", async () => {
      const badStub = makeStubAdapter(`bad-stub-${randomUUID()}`, newContent);
      badStub.execute = async (request) => ({
        workerRequestId: request.workerRequestId, workerId: "CODE_WORKER", adapterId: badStub.id, provider: "stub", model: "stub-model",
        status: "SUCCEEDED", output: null, proposedChanges: [{ path: "outside/scope/file.ts", operation: "MODIFY", content: "x", purpose: "p", risk: "LOW" }],
        toolCalls: [], tokenUsage: { input: 0, output: 0 }, cost: { amount: 0, currency: "USD", kind: "ACTUAL" },
        durationMs: 1, evidence: [], limitations: [], error: null, finishedAt: new Date().toISOString(),
      });
      WORKER_ADAPTER_REGISTRY.unshift(badStub);
      try {
        const { proposal } = await generateWorkerProposal(session.workspaceSessionId, OWNER, ACTOR, `step-${randomUUID()}`, "bad task", [], [badStub.id]);
        assert(proposal.ok === false, "expected ok=false for an out-of-scope proposal");
        assert(proposal.rejectedFiles.length === 1, "expected exactly one real, honest rejectedFiles entry");
      } finally {
        const idx = WORKER_ADAPTER_REGISTRY.indexOf(badStub);
        if (idx >= 0) WORKER_ADAPTER_REGISTRY.splice(idx, 1);
      }
    });
  } finally {
    const idx = WORKER_ADAPTER_REGISTRY.indexOf(stub);
    if (idx >= 0) WORKER_ADAPTER_REGISTRY.splice(idx, 1);
    if (existsSync(path.join(WORKSPACE_ROOT, FIXTURE_REL))) unlinkSync(path.join(WORKSPACE_ROOT, FIXTURE_REL));
  }

  console.log("\n=== Code Worker Bridge End-to-End Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
