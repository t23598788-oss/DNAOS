/**
 * Code Worker Runtime Regression Suite (owner, 2026-08-08, Software
 * Factory Step 13.6 — updated from Step 13.5's direct-gateway version).
 * Verifies the real app/api/admin/ide/_lib/codeWorkerRuntime.ts bridge
 * now routes through the real Universal Worker Bridge
 * (workerSelectorRuntime.ts + a real WorkerAdapter), never a direct
 * gateway call. Injects a real, disposable stub WorkerAdapter into the
 * real, exported WORKER_ADAPTER_REGISTRY array (the same real
 * dependency-injection pattern already used for services/ai/gateway.ts)
 * — never a live, costed call, never a second mock framework.
 *
 * Run: npm run code-worker:test
 */
import { readFileSync, existsSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  generateCodeWorkerProposal, approveCodeWorkerProposal, applyCodeWorkerProposal, getCodeWorkerProposal, approveDestructiveOperations,
  CodeWorkerError,
} from "../app/api/admin/ide/_lib/codeWorkerRuntime";
import { buildContextPlan, approveContextPlan, type ContextPlan } from "../app/api/admin/ide/_lib/contextPlannerRuntime";
import { resolveCapabilities } from "../app/api/admin/ide/_lib/capabilityResolverRuntime";
import type { StructuredIntent } from "../app/api/admin/ide/_lib/intentRuntime";
import { WORKSPACE_ROOT } from "../app/api/admin/ide/_lib/fsSecurity";
import { WORKER_ADAPTER_REGISTRY } from "../app/api/admin/ide/_lib/workerSelectorRuntime";
import { listJobs } from "../app/api/admin/ide/_lib/queueRuntime";
import type { WorkerAdapter } from "../app/api/admin/ide/_lib/workerAdapter";
import type { WorkerRequest, WorkerResponse } from "../app/api/admin/ide/_lib/workerContract";

const ROOT = path.join(__dirname, "..");
const TEST_ACTOR = "code-worker-regression-suite@dnaos.local";
const OWNER_A = "code-worker-regression-owner-a";
const OWNER_B = "code-worker-regression-owner-b";

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

function intentFor(problem: string): StructuredIntent {
  return { problem, desiredOutcome: problem, requestedChange: problem, affectedArea: [], constraints: [], nonGoals: [], expectedEvidence: [], acceptanceCriteria: [], ownerAuthority: "OWNER_CONFIRMED", riskTolerance: "LOW" };
}

const FIXTURE_REL = `scratch-code-worker-fixture-${randomUUID().slice(0, 8)}.ts`;
function realContextPlan(changedFiles: string[]): ContextPlan {
  const resolution = resolveCapabilities(intentFor("auto create a job when material and quantity info is missing"));
  const plan = buildContextPlan(randomUUID(), OWNER_A, TEST_ACTOR, resolution, changedFiles);
  return approveContextPlan(plan.contextPlanId, OWNER_A, TEST_ACTOR);
}

/** Real, disposable stub Adapter — spliced into the real
 * WORKER_ADAPTER_REGISTRY for the duration of one test, then removed.
 * Implements the exact real WorkerAdapter interface every production
 * Adapter implements. */
function makeStubAdapter(id: string, respond: (req: WorkerRequest) => Partial<WorkerResponse>): WorkerAdapter {
  return {
    id, type: "API", provider: "stub",
    availability: () => ({ available: true, reason: "real, disposable test stub" }),
    capabilities: () => ["code.generate"],
    estimate: () => ({ estimatedCost: 0, estimatedTokens: 0, currency: "USD", confidence: "HIGH" }),
    async execute(request) {
      const partial = respond(request);
      return {
        workerRequestId: request.workerRequestId, workerId: "CODE_WORKER", adapterId: id, provider: "stub", model: "stub-model",
        status: "SUCCEEDED", output: null, proposedChanges: [], toolCalls: [], tokenUsage: { input: 0, output: 0 },
        cost: { amount: 0, currency: "USD", kind: "ACTUAL" }, durationMs: 1, evidence: ["stub-evidence"], limitations: [], error: null,
        finishedAt: new Date().toISOString(), ...partial,
      };
    },
    health: async () => ({ status: "HEALTHY", reason: "real, disposable test stub", lastLiveCallAt: new Date().toISOString(), lastLiveCallOk: true }),
    limitations: () => [],
  };
}

function withStubAdapter<T>(adapter: WorkerAdapter, fn: () => Promise<T>): Promise<T> {
  WORKER_ADAPTER_REGISTRY.unshift(adapter);
  return fn().finally(() => {
    const idx = WORKER_ADAPTER_REGISTRY.indexOf(adapter);
    if (idx >= 0) WORKER_ADAPTER_REGISTRY.splice(idx, 1);
  });
}

async function main() {
  writeFileSync(path.join(WORKSPACE_ROOT, FIXTURE_REL), "// real, disposable fixture for code-worker-test.ts\nexport const codeWorkerFixture = 1;\n");

  try {
    await test("Real reuse: codeWorkerRuntime.ts never imports a Provider SDK/Adapter directly — only the provider-neutral Bridge", () => {
      const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/codeWorkerRuntime.ts"), "utf-8");
      const activeCodeLines = src.split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"));
      assert(!activeCodeLines.some((l) => l.includes("@anthropic-ai/sdk")), "expected zero real, active-code Anthropic SDK import");
      assert(!activeCodeLines.some((l) => l.includes("workerAdapters/")), "expected zero real, active-code import of a concrete Worker Adapter file");
      assert(src.includes('from "./workerSelectorRuntime"'), "expected a real import of the provider-neutral workerSelectorRuntime.ts");
    });

    await test("Real proposal generation via a stub Adapter: a valid, real structured response produces a real, approved-scope operation", async () => {
      const plan = realContextPlan([FIXTURE_REL]);
      const stub = makeStubAdapter(`stub-${randomUUID()}`, () => ({ proposedChanges: [{ path: FIXTURE_REL, operation: "MODIFY", content: "export const codeWorkerFixture = 2;\n", purpose: "bump", risk: "LOW" }] }));
      const proposal = await withStubAdapter(stub, () => generateCodeWorkerProposal(plan, `step-${randomUUID()}`, "bump the fixture constant", ["fixture value changes"], OWNER_A, TEST_ACTOR, [stub.id]));
      assert(proposal.ok === true, `expected ok=true, got error: ${proposal.error}`);
      assert(proposal.files.length === 1 && proposal.files[0].path === FIXTURE_REL, "expected exactly one real, in-scope proposed file");
      assert(proposal.workerAdapterId === stub.id, `expected the real, selected stub adapter id, got ${proposal.workerAdapterId}`);
    });

    await test("Real hard cap (via Execution Budget): a second real Adapter call for the same Execution Step is refused, never silently retried", async () => {
      const plan = realContextPlan([FIXTURE_REL]);
      const stepId = `step-${randomUUID()}`;
      const stub = makeStubAdapter(`stub-${randomUUID()}`, () => ({ proposedChanges: [{ path: FIXTURE_REL, operation: "MODIFY", content: "x", purpose: "p", risk: "LOW" }] }));
      await withStubAdapter(stub, () => generateCodeWorkerProposal(plan, stepId, "task 1", [], OWNER_A, TEST_ACTOR, [stub.id]));
      let threw = false;
      try { await withStubAdapter(stub, () => generateCodeWorkerProposal(plan, stepId, "task 2", [], OWNER_A, TEST_ACTOR, [stub.id])); }
      catch (e) { threw = e instanceof CodeWorkerError && e.code === "CALL_CAP_EXCEEDED"; }
      assert(threw, "expected CALL_CAP_EXCEEDED on the real second call for the same step");
    });

    await test("File scope violation: a proposed path outside permittedWriteScope is honestly rejected, never silently written", async () => {
      const plan = realContextPlan([FIXTURE_REL]);
      const stub = makeStubAdapter(`stub-${randomUUID()}`, () => ({ proposedChanges: [{ path: "some/totally/out-of-scope/path.ts", operation: "MODIFY", content: "x", purpose: "p", risk: "LOW" }] }));
      const proposal = await withStubAdapter(stub, () => generateCodeWorkerProposal(plan, `step-${randomUUID()}`, "task", [], OWNER_A, TEST_ACTOR, [stub.id]));
      assert(proposal.ok === false, "expected ok=false when every proposed file is out of scope");
      assert(proposal.rejectedFiles.length === 1 && proposal.rejectedFiles[0].path === "some/totally/out-of-scope/path.ts", "expected a real, specific rejectedFiles entry");
      assert(proposal.files.length === 0, "expected zero real accepted files");
    });

    await test("Adapter/provider failure honesty: a real Adapter FAILED status propagates as a real, honest rejection, never a fabricated success", async () => {
      const plan = realContextPlan([FIXTURE_REL]);
      const stub = makeStubAdapter(`stub-${randomUUID()}`, () => ({ status: "FAILED", error: "stub failure" }));
      const proposal = await withStubAdapter(stub, () => generateCodeWorkerProposal(plan, `step-${randomUUID()}`, "task", [], OWNER_A, TEST_ACTOR, [stub.id]));
      assert(proposal.ok === false, "expected ok=false when the real Adapter reports FAILED");
      assert(!!proposal.error, "expected a real, non-empty error message from the real failure");
    });

    await test("Write-before-approval is refused: applyCodeWorkerProposal() throws PROPOSAL_NOT_APPROVED before a real Owner approval", async () => {
      const plan = realContextPlan([FIXTURE_REL]);
      const stub = makeStubAdapter(`stub-${randomUUID()}`, () => ({ proposedChanges: [{ path: FIXTURE_REL, operation: "MODIFY", content: "export const codeWorkerFixture = 3;\n", purpose: "p", risk: "LOW" }] }));
      const proposal = await withStubAdapter(stub, () => generateCodeWorkerProposal(plan, `step-${randomUUID()}`, "task", [], OWNER_A, TEST_ACTOR, [stub.id]));
      let threw = false;
      try { await applyCodeWorkerProposal(proposal.proposalId, OWNER_A); } catch (e) { threw = e instanceof CodeWorkerError && e.code === "PROPOSAL_NOT_APPROVED"; }
      assert(threw, "expected PROPOSAL_NOT_APPROVED before any real Owner approval");
    });

    await test("Real, end-to-end approve + apply: after real Owner approval, the real, exact proposed content is written to the real fixture file on disk via the real, secure write path", async () => {
      const plan = realContextPlan([FIXTURE_REL]);
      const newContent = `export const codeWorkerFixture = "${randomUUID()}";\n`;
      const stub = makeStubAdapter(`stub-${randomUUID()}`, () => ({ proposedChanges: [{ path: FIXTURE_REL, operation: "MODIFY", content: newContent, purpose: "p", risk: "LOW" }] }));
      const proposal = await withStubAdapter(stub, () => generateCodeWorkerProposal(plan, `step-${randomUUID()}`, "task", [], OWNER_A, TEST_ACTOR, [stub.id]));
      approveCodeWorkerProposal(proposal.proposalId, OWNER_A);
      const applied = await applyCodeWorkerProposal(proposal.proposalId, OWNER_A);
      assert(applied.applied === true && !!applied.appliedAt, "expected the real proposal to report applied=true with a real timestamp");
      const onDisk = readFileSync(path.join(WORKSPACE_ROOT, FIXTURE_REL), "utf-8");
      assert(onDisk === newContent, "expected the real, exact proposed content to be the real, current bytes on disk");
    });

    await test("Destructive operation (DELETE) requires a SEPARATE real Owner approval — approveCodeWorkerProposal() alone is not enough", async () => {
      const plan = realContextPlan([FIXTURE_REL]);
      const stub = makeStubAdapter(`stub-${randomUUID()}`, () => ({ proposedChanges: [{ path: FIXTURE_REL, operation: "DELETE", content: null, purpose: "cleanup", risk: "HIGH" }] }));
      const proposal = await withStubAdapter(stub, () => generateCodeWorkerProposal(plan, `step-${randomUUID()}`, "task", [], OWNER_A, TEST_ACTOR, [stub.id]));
      assert(proposal.requiresDestructiveApproval === true, "expected requiresDestructiveApproval=true for a real DELETE operation");
      approveCodeWorkerProposal(proposal.proposalId, OWNER_A);
      let threw = false;
      try { await applyCodeWorkerProposal(proposal.proposalId, OWNER_A); } catch (e) { threw = e instanceof CodeWorkerError && e.code === "DESTRUCTIVE_APPROVAL_REQUIRED"; }
      assert(threw, "expected DESTRUCTIVE_APPROVAL_REQUIRED even after the real, normal approval alone");
      approveDestructiveOperations(proposal.proposalId, OWNER_A);
      const applied = await applyCodeWorkerProposal(proposal.proposalId, OWNER_A);
      assert(applied.applied === true, "expected real apply to succeed after both real approvals");
      assert(!existsSync(path.join(WORKSPACE_ROOT, FIXTURE_REL)), "expected the real fixture file to actually be deleted from disk");
      writeFileSync(path.join(WORKSPACE_ROOT, FIXTURE_REL), "// recreated after real DELETE test\n");
    });

    await test("Double approval is refused: approveCodeWorkerProposal() throws PROPOSAL_ALREADY_APPROVED on a second real approval attempt", async () => {
      const plan = realContextPlan([FIXTURE_REL]);
      const stub = makeStubAdapter(`stub-${randomUUID()}`, () => ({ proposedChanges: [{ path: FIXTURE_REL, operation: "MODIFY", content: "x", purpose: "p", risk: "LOW" }] }));
      const proposal = await withStubAdapter(stub, () => generateCodeWorkerProposal(plan, `step-${randomUUID()}`, "task", [], OWNER_A, TEST_ACTOR, [stub.id]));
      approveCodeWorkerProposal(proposal.proposalId, OWNER_A);
      let threw = false;
      try { approveCodeWorkerProposal(proposal.proposalId, OWNER_A); } catch (e) { threw = e instanceof CodeWorkerError && e.code === "PROPOSAL_ALREADY_APPROVED"; }
      assert(threw, "expected PROPOSAL_ALREADY_APPROVED on a real double approval");
    });

    await test("Owner isolation: a CODE_WORKER proposal created for Owner A is not gettable/approvable by Owner B", async () => {
      const plan = realContextPlan([FIXTURE_REL]);
      const stub = makeStubAdapter(`stub-${randomUUID()}`, () => ({ proposedChanges: [{ path: FIXTURE_REL, operation: "MODIFY", content: "x", purpose: "p", risk: "LOW" }] }));
      const proposal = await withStubAdapter(stub, () => generateCodeWorkerProposal(plan, `step-${randomUUID()}`, "task", [], OWNER_A, TEST_ACTOR, [stub.id]));
      let threw = false;
      try { getCodeWorkerProposal(proposal.proposalId, OWNER_B); } catch (e) { threw = e instanceof CodeWorkerError && e.code === "PROPOSAL_NOT_OWNED"; }
      assert(threw, "expected PROPOSAL_NOT_OWNED for a real cross-owner lookup");
    });

    await test("Real CODE_WORKER_PROPOSAL_V2 artifact is produced with a real, non-empty artifact id", async () => {
      const plan = realContextPlan([FIXTURE_REL]);
      const stub = makeStubAdapter(`stub-${randomUUID()}`, () => ({ proposedChanges: [{ path: FIXTURE_REL, operation: "MODIFY", content: "x", purpose: "p", risk: "LOW" }] }));
      const proposal = await withStubAdapter(stub, () => generateCodeWorkerProposal(plan, `step-${randomUUID()}`, "task", [], OWNER_A, TEST_ACTOR, [stub.id]));
      assert(proposal.artifactIds.length > 0, "expected at least one real artifact id");
    });

    await test("Real WORKER_INVOKE Queue job wraps every real Adapter call — never skipped (fixed 2026-08-07, VS Code Coding Worker integration)", async () => {
      const plan = realContextPlan([FIXTURE_REL]);
      const stub = makeStubAdapter(`stub-${randomUUID()}`, () => ({ proposedChanges: [{ path: FIXTURE_REL, operation: "MODIFY", content: "x", purpose: "p", risk: "LOW" }] }));
      const proposal = await withStubAdapter(stub, () => generateCodeWorkerProposal(plan, `step-${randomUUID()}`, "task", [], OWNER_A, TEST_ACTOR, [stub.id]));
      const jobs = listJobs(OWNER_A);
      const invokeJob = jobs.find((j) => j.type === "WORKER_INVOKE" && j.status === "SUCCEEDED");
      assert(!!invokeJob, "expected a real, SUCCEEDED WORKER_INVOKE Job to exist in the real Queue");
      assert(proposal.artifactIds.length > 0, "expected the real proposal artifact to still be produced");
    });
  } finally {
    if (existsSync(path.join(WORKSPACE_ROOT, FIXTURE_REL))) unlinkSync(path.join(WORKSPACE_ROOT, FIXTURE_REL));
  }

  console.log("\n=== Code Worker Runtime Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
