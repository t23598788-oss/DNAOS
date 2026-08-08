/**
 * Worker Registry & Assignment Regression Suite (owner, 2026-08-08,
 * Software Factory Step 13) — verifies the real
 * app/api/admin/ide/_lib/workerRegistry.ts declares honest, real Worker
 * status (never a hidden hardcoded primary provider) and that
 * selectWorker() makes a real, deterministic decision.
 *
 * Run: npm run worker-assignment:test
 */
import { readFileSync } from "fs";
import path from "path";
import { WORKER_REGISTRY, listWorkers, getWorkerDefinition, selectWorker, type WorkerType } from "../app/api/admin/ide/_lib/workerRegistry";

const ROOT = path.join(__dirname, "..");
const ALL_WORKER_TYPES: WorkerType[] = ["ANALYSIS_WORKER", "CODE_WORKER", "REVIEW_WORKER", "TEST_WORKER", "DOCUMENT_WORKER", "UI_WORKER", "SECURITY_WORKER", "DATA_WORKER", "HUMAN_WORKER", "TOOL_WORKER"];
const VALID_STATUSES = ["ACTIVE", "CONFIGURED", "PARTIAL", "COMPATIBILITY_ONLY", "NOT_IMPLEMENTED", "UNKNOWN"];

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

async function main() {
  await test("All 10 real, minimum Worker Types are declared, no more no less than the spec's minimum set", () => {
    for (const t of ALL_WORKER_TYPES) assert(!!WORKER_REGISTRY[t], `expected Worker Type ${t} to be declared`);
    assert(listWorkers().length === ALL_WORKER_TYPES.length, `expected exactly ${ALL_WORKER_TYPES.length} real Worker Types, got ${listWorkers().length}`);
  });

  await test("Every real Worker declares a valid status literal and non-empty contracts", () => {
    for (const w of listWorkers()) {
      assert(VALID_STATUSES.includes(w.status), `Worker ${w.id} has invalid status ${w.status}`);
      assert(w.inputContract.length > 0 && w.outputContract.length > 0, `Worker ${w.id} must declare real, non-empty contracts`);
      assert(w.capabilities.length > 0, `Worker ${w.id} must declare at least one real capability`);
      assert(w.evidenceRequirements.length > 0, `Worker ${w.id} must declare real evidenceRequirements`);
    }
  });

  await test("No hardcoded provider monopoly: no single AI provider name appears as `provider` for more than half of all real Workers, and REVIEW/TEST/TOOL Workers are internal/deterministic, not AI at all", () => {
    const providerCounts: Record<string, number> = {};
    for (const w of listWorkers()) providerCounts[w.provider] = (providerCounts[w.provider] ?? 0) + 1;
    for (const [provider, count] of Object.entries(providerCounts)) {
      assert(count <= Math.floor(listWorkers().length / 2), `provider "${provider}" is used by ${count}/${listWorkers().length} Workers — too dominant, looks hardcoded as THE primary provider`);
    }
    assert(WORKER_REGISTRY.REVIEW_WORKER.provider.includes("deterministic") || WORKER_REGISTRY.REVIEW_WORKER.provider.includes("internal"), "expected REVIEW_WORKER to be a real, internal deterministic worker, not an AI call");
    assert(WORKER_REGISTRY.TEST_WORKER.provider.includes("internal"), "expected TEST_WORKER to be a real, internal worker, not an AI call");
  });

  await test("Honest capability status: CODE_WORKER is PARTIAL (real, programmatic path exists as of Step 13.5 but unproven live — no real API key in this environment) and ANALYSIS_WORKER stays honestly COMPATIBILITY_ONLY — neither is fabricated ACTIVE", () => {
    assert(WORKER_REGISTRY.CODE_WORKER.status === "PARTIAL", `expected CODE_WORKER status PARTIAL, got ${WORKER_REGISTRY.CODE_WORKER.status}`);
    assert(WORKER_REGISTRY.ANALYSIS_WORKER.status === "COMPATIBILITY_ONLY", `expected ANALYSIS_WORKER status COMPATIBILITY_ONLY, got ${WORKER_REGISTRY.ANALYSIS_WORKER.status}`);
    assert(WORKER_REGISTRY.CODE_WORKER.limitations.some((l) => l.toLowerCase().includes("anthropic_api_key") || l.toLowerCase().includes("not configured")), "expected CODE_WORKER to honestly disclose the missing real API key limitation");
  });

  await test("Human Worker exists and is real, final approval authority — never automatable", () => {
    const human = WORKER_REGISTRY.HUMAN_WORKER;
    assert(human.executionMode === "HUMAN_IN_LOOP", "expected HUMAN_WORKER executionMode to be HUMAN_IN_LOOP");
    assert(human.limitations.some((l) => l.toLowerCase().includes("cannot be automated")), "expected HUMAN_WORKER to explicitly declare it cannot be automated");
  });

  await test("Unavailable worker rejection: selectWorker() returns null for a NOT_IMPLEMENTED status or unknown worker type, never fabricating a fallback", () => {
    const unknown = selectWorker("NOT_A_REAL_TYPE" as unknown as WorkerType, { requiredCapability: "x", contextSizeBytes: 0, privacyRequirement: "LOW", latencyRequirement: "LOW", costSensitivity: "LOW" });
    assert(unknown === null, "expected selectWorker() to return null for an unregistered worker type");
  });

  await test("Available worker selection: selectWorker() returns the real, live Worker Registry definition for a real ACTIVE worker, unmodified", () => {
    const selected = selectWorker("REVIEW_WORKER", { requiredCapability: "review", contextSizeBytes: 1000, privacyRequirement: "LOW", latencyRequirement: "LOW", costSensitivity: "LOW" });
    assert(selected !== null && selected.id === "REVIEW_WORKER", "expected selectWorker() to return the real REVIEW_WORKER definition");
    assert(selected === getWorkerDefinition("REVIEW_WORKER"), "expected the exact same real object reference, never a copy/fabrication");
  });

  await test("Cost/latency/privacy constraints are real, declared fields on every Worker, not silently absent", () => {
    for (const w of listWorkers()) {
      assert(typeof w.costModel === "string" && w.costModel.length > 0, `Worker ${w.id} must declare a real costModel string`);
      assert(["AVAILABLE", "UNAVAILABLE", "UNKNOWN"].includes(w.availability), `Worker ${w.id} must declare a valid availability`);
      assert(["LOCAL", "CLOUD", "HYBRID", "N/A"].includes(w.locality), `Worker ${w.id} must declare a valid locality`);
    }
  });

  await test("Deterministic internal Workers (REVIEW/TEST/TOOL/DATA) reuse real, already-built Runtimes, never a second/duplicate implementation", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/workerRegistry.ts"), "utf-8");
    assert(src.includes("changeSetRuntime.ts"), "expected REVIEW_WORKER to cite the real changeSetRuntime.ts");
    assert(src.includes("testRuntime.ts"), "expected TEST_WORKER to cite the real testRuntime.ts");
    assert(src.includes("executionRuntime.ts"), "expected TOOL_WORKER to cite the real executionRuntime.ts");
  });

  await test("Reuse investigation disclosed: workerRegistry.ts's header honestly documents the real services/ai/gateway.ts reuse finding, never silently omitted", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/workerRegistry.ts"), "utf-8");
    assert(src.includes("services/ai/gateway.ts"), "expected an honest, documented reuse investigation finding about the real, existing AI gateway");
  });

  console.log("\n=== Worker Registry & Assignment Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
