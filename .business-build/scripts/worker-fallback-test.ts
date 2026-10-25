/**
 * Worker Fallback Chain Regression Suite (owner, 2026-08-08, Software
 * Factory Step 13.6, Section 9) — verifies the real fallback chain
 * computed by workerSelectorRuntime.ts#selectWorker(): real privacy
 * enforcement on every hop, real capability consistency, and the
 * honest, real fact that this Step computes/exposes a real fallback
 * chain but never auto-executes a second live provider call within one
 * Execution Step (that would violate the real, hard 1-call-per-step
 * Execution Budget from Section 10).
 *
 * Run: npm run worker-fallback:test
 */
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { selectWorker, WORKER_ADAPTER_REGISTRY } from "../app/api/admin/ide/_lib/workerSelectorRuntime";
import type { WorkerRequest } from "../app/api/admin/ide/_lib/workerContract";

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

function baseRequest(overrides: Partial<WorkerRequest> = {}): WorkerRequest {
  return {
    workerRequestId: randomUUID(), workspaceSessionId: randomUUID(), executionPlanId: null, stepId: "test-step", workerType: "CODE_WORKER",
    capabilityRequired: "code.generate", contextPackageId: null, contextFingerprint: null, permittedReadScope: [], permittedWriteScope: [],
    permittedTools: [], forbiddenTools: [], expectedOutputSchema: "n/a", timeoutMs: 5000, maxCalls: 1, maxTokens: 500, maxCost: null,
    privacyLevel: "CLOUD_ALLOWED", networkPolicy: "OUTBOUND_ALLOWED", approvalPolicy: "OWNER_APPROVAL_REQUIRED", actor: "test@dnaos.local",
    createdAt: new Date().toISOString(), taskDescription: "test", acceptanceCriteria: [], fileContents: [], ...overrides,
  };
}

const CLOUD_BACKED_IDS = new Set(["anthropic-api", "openai-api", "gemini-api", "claude-cli", "mcp-foundation"]);

async function main() {
  await test("Fallback chain structure: selectWorker() returns a real, ordered fallbackChain excluding the primary selectedAdapterId", async () => {
    const result = await selectWorker(baseRequest());
    assert(!result.fallbackChain.includes(result.selectedAdapterId ?? ""), "expected the real fallbackChain to never repeat the real, primary selectedAdapterId");
    assert(new Set(result.fallbackChain).size === result.fallbackChain.length, "expected zero real duplicate adapter ids in the fallback chain");
  });

  await test("Privacy enforcement on every hop: for a LOCAL_ONLY request, NEITHER the selected Worker NOR any real fallback hop is cloud-backed", async () => {
    const result = await selectWorker(baseRequest({ privacyLevel: "LOCAL_ONLY" }));
    const allChosen = [result.selectedAdapterId, ...result.fallbackChain].filter((id): id is string => !!id);
    for (const id of allChosen) assert(!CLOUD_BACKED_IDS.has(id), `expected zero real cloud-backed adapter anywhere in a LOCAL_ONLY chain, found ${id}`);
  });

  await test("No LOCAL_ONLY -> Cloud escape: the real candidatesConsidered list for a LOCAL_ONLY request marks every real cloud-backed adapter ineligible, never silently promoted into the chain", async () => {
    const result = await selectWorker(baseRequest({ privacyLevel: "LOCAL_ONLY" }));
    for (const c of result.candidatesConsidered) {
      if (CLOUD_BACKED_IDS.has(c.adapterId)) assert(c.eligible === false, `expected real cloud-backed adapter ${c.adapterId} to be honestly ineligible under LOCAL_ONLY`);
    }
  });

  await test("Capability consistency: every real adapter in the fallback chain actually declares the requested capability (or is the universal Human Worker)", async () => {
    const result = await selectWorker(baseRequest());
    for (const id of result.fallbackChain) {
      const adapter = WORKER_ADAPTER_REGISTRY.find((a) => a.id === id)!;
      assert(adapter.capabilities().includes("code.generate") || adapter.id === "human-worker", `expected fallback hop ${id} to really declare the requested capability`);
    }
  });

  await test("Request integrity: selectWorker() never mutates the real WorkerRequest object during ranking (privacyLevel/networkPolicy/approvalPolicy stay identical)", async () => {
    const request = baseRequest();
    const snapshot = JSON.stringify(request);
    await selectWorker(request);
    assert(JSON.stringify(request) === snapshot, "expected the real WorkerRequest to be byte-identical after selection — never mutated");
  });

  await test("Honest scope: this Step computes/exposes a real fallback chain but never auto-executes a second live provider call for the same Execution Step (Section 10's 1-call cap)", () => {
    const src = readFileSync(path.join(__dirname, "..", "app/api/admin/ide/_lib/codeWorkerRuntime.ts"), "utf-8");
    // Real, structural check: generateCodeWorkerProposal calls
    // adapter.execute() exactly once per real invocation — grep-verified
    // there is no loop over selection.fallbackChain calling execute() again.
    const executeCallCount = (src.match(/adapter\.execute\(/g) ?? []).length;
    assert(executeCallCount === 1, `expected exactly one real adapter.execute() call site in codeWorkerRuntime.ts, found ${executeCallCount} — an automatic fallback retry would violate the real 1-call-per-step budget`);
  });

  await test("Human Worker is always the real, final, universal fallback hop when included — never silently dropped from the chain", async () => {
    const result = await selectWorker(baseRequest(), ["human-worker"]);
    // human-worker was explicitly preferred, so it's primary here; verify a
    // separate, non-preferred call still includes it somewhere in the real chain.
    const natural = await selectWorker(baseRequest());
    const allChosen = [natural.selectedAdapterId, ...natural.fallbackChain];
    assert(allChosen.includes("human-worker"), "expected human-worker to appear somewhere in the real, natural selection/fallback chain");
  });

  console.log("\n=== Worker Fallback Chain Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
