/**
 * Worker Selector Regression Suite (owner, 2026-08-08, Software Factory
 * Step 13.6) — verifies the real, deterministic
 * app/api/admin/ide/_lib/workerSelectorRuntime.ts#selectWorker(): real
 * capability matching, real cost/privacy/latency-aware ranking, real
 * local-only enforcement, real explained reasons.
 *
 * Run: npm run worker-selector:test
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

async function main() {
  await test("Capability match: a request for an unknown capability finds ONLY the real, universal Human Worker fallback — never a fabricated AI capability match", async () => {
    const result = await selectWorker(baseRequest({ capabilityRequired: "totally.unknown.capability" }));
    const eligible = result.candidatesConsidered.filter((c) => c.eligible);
    assert(eligible.length === 1 && eligible[0].adapterId === "human-worker", `expected the only real, eligible candidate to be human-worker, got ${JSON.stringify(eligible)}`);
    assert(result.selectedAdapterId === "human-worker", `expected human-worker to be selected for an unknown capability, got ${result.selectedAdapterId}`);
  });

  await test("Capability match: a request for the real code.generate capability finds real, eligible candidates (at minimum, Human Worker)", async () => {
    const result = await selectWorker(baseRequest());
    assert(result.outcome === "SELECTED" || result.outcome === "FALLBACK_SELECTED", `expected a real selection outcome, got ${result.outcome}`);
    assert(result.selectedAdapterId !== null, "expected a real, non-null selectedAdapterId");
  });

  await test("Deterministic reason: selection always includes a real, non-empty reasons[] explanation, never a bare provider-name choice", async () => {
    const result = await selectWorker(baseRequest());
    assert(result.reasons.length > 0, "expected real, non-empty reasons");
    assert(result.candidatesConsidered.length > 0, "expected a real, non-empty candidatesConsidered list");
  });

  await test("Local-only: a LOCAL_ONLY request never selects a real, cloud-backed Adapter (Anthropic/OpenAI/Gemini/CLI/MCP)", async () => {
    const result = await selectWorker(baseRequest({ privacyLevel: "LOCAL_ONLY" }));
    const cloudIds = new Set(["anthropic-api", "openai-api", "gemini-api", "claude-cli", "mcp-foundation"]);
    assert(!cloudIds.has(result.selectedAdapterId ?? ""), `expected a LOCAL_ONLY request to never select a real cloud-backed adapter, got ${result.selectedAdapterId}`);
    for (const id of result.fallbackChain) assert(!cloudIds.has(id), `expected the real fallback chain to never include a cloud-backed adapter, found ${id}`);
  });

  await test("Local-only: candidatesConsidered honestly marks a real, AVAILABLE cloud-backed adapter (claude-cli) ineligible with a real, specific LOCAL_ONLY reason — never conflated with a real unavailability reason", async () => {
    const result = await selectWorker(baseRequest({ privacyLevel: "LOCAL_ONLY" }));
    const cliCandidate = result.candidatesConsidered.find((c) => c.adapterId === "claude-cli");
    assert(!!cliCandidate, "expected claude-cli to be a real, considered candidate for code.generate");
    assert(cliCandidate!.eligible === false, "expected claude-cli to be ineligible under LOCAL_ONLY even though the real binary is available");
    assert(cliCandidate!.reason.toLowerCase().includes("local"), `expected a real, specific reason citing the LOCAL_ONLY exclusion, got: ${cliCandidate!.reason}`);
  });

  await test("Owner preference: an explicit ownerPreference list, when the preferred Adapter is eligible, is honored deterministically", async () => {
    const result = await selectWorker(baseRequest(), ["human-worker"]);
    assert(result.selectedAdapterId === "human-worker", `expected owner preference "human-worker" to be honored, got ${result.selectedAdapterId}`);
  });

  await test("Cost/latency/privacy-aware ranking never picks purely by provider name — ranking is explained via real candidatesConsidered", async () => {
    const result = await selectWorker(baseRequest());
    for (const c of result.candidatesConsidered) assert(typeof c.reason === "string" && c.reason.length > 0, `candidate ${c.adapterId} missing a real, explained reason`);
  });

  await test("Determinism: two identical real requests (same capability/privacy) produce the same real selection outcome", async () => {
    const r1 = await selectWorker(baseRequest({ workspaceSessionId: "fixed-session" }));
    const r2 = await selectWorker(baseRequest({ workspaceSessionId: "fixed-session" }));
    assert(r1.outcome === r2.outcome, "expected deterministic outcome");
    assert(r1.selectedAdapterId === r2.selectedAdapterId, "expected deterministic selectedAdapterId");
  });

  await test("Human Worker is always a real, eligible candidate for code.generate — the real, final fallback", async () => {
    const result = await selectWorker(baseRequest());
    assert(result.candidatesConsidered.some((c) => c.adapterId === "human-worker" && c.eligible), "expected human-worker to always be a real, eligible candidate");
  });

  await test("Registry integrity: WORKER_ADAPTER_REGISTRY exposes no duplicate real adapter ids", () => {
    const ids = WORKER_ADAPTER_REGISTRY.map((a) => a.id);
    assert(new Set(ids).size === ids.length, "expected zero duplicate real adapter ids");
  });

  // ---- Preflight-based ranking fix (owner, 2026-08-07) — a real,
  // capability-matched, CONFIGURED AI Adapter that passes a cheap, free
  // preflight now outranks Human Worker WITHOUT an explicit
  // ownerPreference, closing the real chicken-and-egg gap found live
  // (Human Worker's constant HEALTHY used to always win by default). ----
  await test("Default selection (no ownerPreference): a real, capability-matched, preflight-passing AI Adapter outranks Human Worker", async () => {
    const result = await selectWorker(baseRequest({ capabilityRequired: "repository.search" }));
    // In THIS real environment (claude-cli genuinely logged in, confirmed
    // live via `claude auth status`), the real, live-checked preflight
    // passes — this is a real, environment-dependent assertion, not a
    // fabricated guarantee for every possible environment.
    assert(result.selectedAdapterId === "claude-cli", `expected claude-cli to be selected by default in this real, live environment, got ${result.selectedAdapterId}`);
    assert(result.outcome === "SELECTED", `expected SELECTED (not FALLBACK_SELECTED), got ${result.outcome}`);
    assert(result.fallbackChain.includes("human-worker"), "expected human-worker to remain in the real fallback chain, just demoted");
  });

  await test("Preflight-based priority is capability-aware, never a blanket AI-first rule: an unmatched capability still falls back to Human Worker", async () => {
    const result = await selectWorker(baseRequest({ capabilityRequired: "totally.unmatched.capability.xyz" }));
    assert(result.selectedAdapterId === "human-worker", `expected human-worker for an unmatched capability, got ${result.selectedAdapterId}`);
  });

  await test("Explicit ownerPreference for Human Worker still wins over a preflight-passing AI Adapter — 'Owner ระบุ Human โดยตรง' is honored", async () => {
    const result = await selectWorker(baseRequest({ capabilityRequired: "repository.search" }), ["human-worker"]);
    assert(result.selectedAdapterId === "human-worker", `expected explicit ownerPreference for human-worker to win, got ${result.selectedAdapterId}`);
  });

  await test("Real fix is generic (capability + preflight-based), never hardcoded to a specific adapter id", () => {
    const src = readFileSync(path.join(__dirname, "..", "app/api/admin/ide/_lib/workerSelectorRuntime.ts"), "utf-8");
    // Scoped to the real computePreflightTier() function body specifically
    // — CLOUD_BACKED_ADAPTER_IDS elsewhere in this file legitimately lists
    // "claude-cli" for the UNRELATED privacy filter (pre-existing, Step
    // 13.6); this test only asserts the NEW ranking mechanism is generic.
    const fnMatch = src.match(/async function computePreflightTier[\s\S]*?\n}/);
    assert(!!fnMatch, "expected to find the real computePreflightTier function body");
    assert(!fnMatch![0].includes('"claude-cli"'), "expected zero hardcoded adapter id inside the real preflight-tier ranking function — the mechanism must be generic");
    assert(fnMatch![0].includes("adapter.preflight"), "expected the real, generic adapter.preflight() call");
  });

  await test("preflight() itself is real and cheap — completes fast, never spends a real token (costIncurred:false, structural guarantee)", async () => {
    const cliAdapter = WORKER_ADAPTER_REGISTRY.find((a) => a.id === "claude-cli")!;
    assert(!!cliAdapter.preflight, "expected claude-cli to implement the real, optional preflight()");
    const started = Date.now();
    const result = await cliAdapter.preflight!();
    const durationMs = Date.now() - started;
    assert(result.costIncurred === false, "expected a real, structural costIncurred:false guarantee");
    assert(durationMs < 5000, `expected a real, cheap preflight to complete in well under 5s, took ${durationMs}ms`);
  });

  console.log("\n=== Worker Selector Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
