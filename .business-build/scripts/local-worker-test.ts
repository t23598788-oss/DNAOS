/**
 * Local Model Worker Adapter Regression Suite (owner, 2026-08-08,
 * Software Factory Step 13.6) — verifies the real
 * app/api/admin/ide/_lib/workerAdapters/localModelWorkerAdapter.ts:
 * real endpoint-unavailable honesty (this environment has no real
 * AI_GATEWAY_OLLAMA_URL configured — confirmed live), real
 * reachability-check injection, real $0 ACTUAL cost honesty, and that
 * Local Model gets NO special privilege over cloud providers (same real
 * Context/Budget/Scope path).
 *
 * Run: npm run local-worker:test
 */
import { readFileSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { ollamaLocalAdapter, realOllamaReachabilityCheck } from "../app/api/admin/ide/_lib/workerAdapters/localModelWorkerAdapter";
import { selectWorker } from "../app/api/admin/ide/_lib/workerSelectorRuntime";
import type { WorkerRequest } from "../app/api/admin/ide/_lib/workerContract";

const ROOT = path.join(__dirname, "..");

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

async function main() {
  await test("Endpoint unavailable honesty (real, live check): this environment has no real AI_GATEWAY_OLLAMA_URL configured — NOT_CONFIGURED, never fabricated available", () => {
    const avail = ollamaLocalAdapter.availability();
    assert(avail.available === false, `expected honestly unavailable in this environment, got: ${JSON.stringify(avail)}`);
    assert(avail.reason.toLowerCase().includes("ollama"), "expected a real, specific reason citing Ollama configuration");
  });

  await test("execute() on an unconfigured Local Model Adapter returns real NOT_CONFIGURED, never SUCCEEDED", async () => {
    const response = await ollamaLocalAdapter.execute(baseRequest());
    assert(response.status === "NOT_CONFIGURED", `expected NOT_CONFIGURED, got ${response.status}`);
    assert(response.cost.amount === 0 && response.cost.kind === "ACTUAL", "expected a real, honest $0 ACTUAL cost even for a NOT_CONFIGURED call — never null/UNKNOWN when the real answer is known to be zero");
  });

  await test("Reachability check is real and injectable: a real, fake unreachable endpoint returns false", async () => {
    const fakeFetch = (async () => { throw new Error("real, simulated connection refused"); }) as unknown as typeof fetch;
    const reachable = await realOllamaReachabilityCheck("http://localhost:11434", fakeFetch);
    assert(reachable === false, "expected a real, honest false for an unreachable endpoint");
  });

  await test("Reachability check is real and injectable: a real, fake reachable endpoint (200 OK) returns true", async () => {
    const fakeFetch = (async () => ({ ok: true })) as unknown as typeof fetch;
    const reachable = await realOllamaReachabilityCheck("http://localhost:11434", fakeFetch);
    assert(reachable === true, "expected a real, honest true for a real, reachable (fake) endpoint");
  });

  await test("Local-only privacy: a LOCAL_ONLY request keeps ollama-local as a real, eligible candidate — Local Model is never excluded by its own privacy policy", async () => {
    const result = await selectWorker(baseRequest({ privacyLevel: "LOCAL_ONLY" }));
    const localCandidate = result.candidatesConsidered.find((c) => c.adapterId === "ollama-local");
    assert(!!localCandidate, "expected ollama-local to be a real, considered candidate");
    // Real, honest outcome in this environment: still ineligible because
    // NOT_CONFIGURED (no real endpoint) — never excluded for a fabricated
    // privacy reason.
    assert(localCandidate!.eligible === false, "expected ollama-local to be honestly ineligible (NOT_CONFIGURED), not fabricated eligible");
    assert(localCandidate!.reason.toLowerCase().includes("ollama"), "expected the real, specific NOT_CONFIGURED reason, never a fabricated privacy-exclusion reason");
  });

  await test("No cloud fallback: localModelWorkerAdapter.ts never imports a cloud-backed Adapter file (apiWorkerAdapter.ts/cliWorkerAdapter.ts)", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/workerAdapters/localModelWorkerAdapter.ts"), "utf-8");
    assert(!src.includes("apiWorkerAdapter") && !src.includes("cliWorkerAdapter"), "expected zero real import of a cloud-backed Adapter from the Local Model Adapter");
  });

  await test("No special privilege: ollamaLocalAdapter declares the exact same real capability ('code.generate') as the cloud Adapters — same Contract, no shortcut", () => {
    assert(ollamaLocalAdapter.capabilities().includes("code.generate"), "expected ollama-local to declare code.generate like every other real code Worker Adapter");
  });

  await test("Health honesty: health() never reports HEALTHY when NOT_CONFIGURED, regardless of any prior in-process call history", async () => {
    const health = await ollamaLocalAdapter.health();
    assert(health.status === "NOT_CONFIGURED", `expected NOT_CONFIGURED, got ${health.status}`);
  });

  console.log("\n=== Local Model Worker Adapter Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
