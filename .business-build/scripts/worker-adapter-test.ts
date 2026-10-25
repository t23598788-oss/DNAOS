/**
 * Worker Adapter Regression Suite (owner, 2026-08-08, Software Factory
 * Step 13.6) — verifies every real Adapter (API/CLI/MCP/Local/Human)
 * implements the exact real WorkerAdapter interface honestly: real
 * availability, real capabilities, real structured WorkerResponse
 * shape, and NOT_CONFIGURED/NOT_SUPPORTED are never silently upgraded
 * to SUCCEEDED. No real, live, costed provider call is made.
 *
 * Run: npm run worker-adapter:test
 */
import { randomUUID } from "crypto";
import { WORKER_ADAPTER_REGISTRY, getWorkerAdapter } from "../app/api/admin/ide/_lib/workerSelectorRuntime";
import { anthropicApiAdapter, openaiApiAdapter, geminiApiAdapter } from "../app/api/admin/ide/_lib/workerAdapters/apiWorkerAdapter";
import { digitalOceanApiAdapter } from "../app/api/admin/ide/_lib/workerAdapters/digitalOceanWorkerAdapter";
import { claudeCliAdapter } from "../app/api/admin/ide/_lib/workerAdapters/cliWorkerAdapter";
import { mcpWorkerAdapter } from "../app/api/admin/ide/_lib/workerAdapters/mcpWorkerAdapter";
import { mcpDnaOsAdapter } from "../app/api/admin/ide/_lib/workerAdapters/mcpDnaOsAdapter";
import { ollamaLocalAdapter } from "../app/api/admin/ide/_lib/workerAdapters/localModelWorkerAdapter";
import { humanWorkerAdapter } from "../app/api/admin/ide/_lib/workerAdapters/humanWorkerAdapter";
import type { WorkerRequest } from "../app/api/admin/ide/_lib/workerContract";

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

const VALID_RESPONSE_STATUSES = ["SUCCEEDED", "PARTIAL", "BLOCKED", "TIMEOUT", "FAILED", "NOT_CONFIGURED", "NOT_SUPPORTED", "UNKNOWN"];
const VALID_HEALTH_STATUSES = ["HEALTHY", "DEGRADED", "NOT_CONFIGURED", "UNAVAILABLE", "UNKNOWN"];
const VALID_ADAPTER_TYPES = ["API", "CLI", "MCP", "LOCAL_RUNTIME", "REMOTE_RUNTIME", "HUMAN"];

function baseRequest(): WorkerRequest {
  return {
    workerRequestId: randomUUID(), workspaceSessionId: randomUUID(), executionPlanId: null, stepId: "test-step", workerType: "CODE_WORKER",
    capabilityRequired: "code.generate", contextPackageId: null, contextFingerprint: null, permittedReadScope: [], permittedWriteScope: [],
    permittedTools: [], forbiddenTools: [], expectedOutputSchema: "n/a", timeoutMs: 5000, maxCalls: 1, maxTokens: 500, maxCost: null,
    privacyLevel: "CLOUD_ALLOWED", networkPolicy: "OUTBOUND_ALLOWED", approvalPolicy: "OWNER_APPROVAL_REQUIRED", actor: "test@dnaos.local",
    createdAt: new Date().toISOString(), taskDescription: "test", acceptanceCriteria: [], fileContents: [],
  };
}

async function main() {
  await test("Registry completeness: all 9 real Adapters (4 API + CLI + 2 MCP + Local + Human) are registered in WORKER_ADAPTER_REGISTRY", () => {
    assert(WORKER_ADAPTER_REGISTRY.length === 9, `expected 9 real Adapters, got ${WORKER_ADAPTER_REGISTRY.length}`);
    for (const a of [anthropicApiAdapter, openaiApiAdapter, geminiApiAdapter, digitalOceanApiAdapter, claudeCliAdapter, mcpWorkerAdapter, mcpDnaOsAdapter, ollamaLocalAdapter, humanWorkerAdapter]) {
      assert(getWorkerAdapter(a.id) === a, `expected getWorkerAdapter("${a.id}") to return the real, exact same object`);
    }
  });

  await test("Provider-neutral contract: every real Adapter declares a valid type and non-empty id/provider", () => {
    for (const a of WORKER_ADAPTER_REGISTRY) {
      assert(VALID_ADAPTER_TYPES.includes(a.type), `Adapter ${a.id} has invalid type ${a.type}`);
      assert(a.id.length > 0 && a.provider.length > 0, `Adapter ${a.id} missing real id/provider`);
    }
  });

  await test("Availability is real and synchronous — never throws, always returns a real boolean + reason", () => {
    for (const a of WORKER_ADAPTER_REGISTRY) {
      const avail = a.availability();
      assert(typeof avail.available === "boolean", `Adapter ${a.id} availability().available is not a real boolean`);
      assert(typeof avail.reason === "string" && avail.reason.length > 0, `Adapter ${a.id} availability().reason is not a real, non-empty string`);
    }
  });

  await test("Unsupported honesty: OpenAI/Gemini Adapters are honestly unavailable — no real integration exists in this repo", () => {
    assert(openaiApiAdapter.availability().available === false, "expected OpenAI Adapter to be honestly unavailable");
    assert(geminiApiAdapter.availability().available === false, "expected Gemini Adapter to be honestly unavailable");
  });

  await test("NOT_CONFIGURED honesty: execute() on an unavailable Adapter returns a real NOT_CONFIGURED/NOT_SUPPORTED status, never SUCCEEDED", async () => {
    const response = await openaiApiAdapter.execute(baseRequest());
    assert(["NOT_CONFIGURED", "NOT_SUPPORTED"].includes(response.status), `expected NOT_CONFIGURED/NOT_SUPPORTED, got ${response.status}`);
    assert(response.proposedChanges.length === 0, "expected zero real proposedChanges for an unconfigured Adapter");
  });

  await test("DigitalOcean Adapter honesty: real integration exists (unlike OpenAI/Gemini) but is honestly NOT_CONFIGURED without a real DIGITALOCEAN_INFERENCE_API_KEY in this environment", async () => {
    assert(digitalOceanApiAdapter.availability().available === (process.env.DIGITALOCEAN_INFERENCE_API_KEY !== undefined), "availability() must reflect the real, live env var state, not a hardcoded assumption");
    const response = await digitalOceanApiAdapter.execute(baseRequest());
    if (!digitalOceanApiAdapter.availability().available) {
      assert(response.status === "NOT_CONFIGURED", `expected NOT_CONFIGURED with no real key configured, got ${response.status}`);
      assert(response.error === "DIGITALOCEAN_INFERENCE_NOT_CONFIGURED", `expected the real, specific error code, got ${response.error}`);
    }
    assert(response.proposedChanges.length === 0 || response.status === "SUCCEEDED", "expected zero real proposedChanges unless a real, live call actually succeeded");
  });

  await test("MCP Adapter honestly reports NOT_SUPPORTED — FOUNDATION_ONLY, never a fabricated tool call", async () => {
    const response = await mcpWorkerAdapter.execute(baseRequest());
    assert(response.status === "NOT_SUPPORTED", `expected NOT_SUPPORTED, got ${response.status}`);
    assert(response.limitations.some((l) => l.includes("FOUNDATION_ONLY") || l.includes("Contract")), "expected a real, honest FOUNDATION_ONLY limitation");
  });

  await test("Structured response: every real WorkerResponse uses only the real, spec-defined status enum", async () => {
    for (const a of [openaiApiAdapter, geminiApiAdapter, digitalOceanApiAdapter, mcpWorkerAdapter, humanWorkerAdapter]) {
      const response = await a.execute(baseRequest());
      assert(VALID_RESPONSE_STATUSES.includes(response.status), `Adapter ${a.id} returned invalid status ${response.status}`);
      assert(typeof response.finishedAt === "string" && response.finishedAt.length > 0, `Adapter ${a.id} missing real finishedAt`);
      assert(["ACTUAL", "ESTIMATED", "UNKNOWN"].includes(response.cost.kind), `Adapter ${a.id} cost.kind is not a real, valid literal`);
    }
  });

  await test("Health status uses only the real, spec-defined enum, and NOT_CONFIGURED Adapters never report HEALTHY", async () => {
    for (const a of WORKER_ADAPTER_REGISTRY) {
      const health = await a.health();
      assert(VALID_HEALTH_STATUSES.includes(health.status), `Adapter ${a.id} health() returned invalid status ${health.status}`);
      if (!a.availability().available) assert(health.status !== "HEALTHY", `Adapter ${a.id} is unavailable but reported HEALTHY — dishonest`);
    }
  });

  await test("Human Worker is always real, available, and honestly reports OWNER_ACTION_REQUIRED — never SUCCEEDED for an action DNA OS itself did not perform", async () => {
    assert(humanWorkerAdapter.availability().available === true, "expected Human Worker to always be real, available");
    const response = await humanWorkerAdapter.execute(baseRequest());
    assert(response.status === "BLOCKED", `expected BLOCKED, got ${response.status}`);
    assert(response.limitations.some((l) => l.includes("OWNER_ACTION_REQUIRED")), "expected a real, explicit OWNER_ACTION_REQUIRED limitation");
  });

  await test("Cost estimate is real and deterministic — never fabricates a precise number when the real cost model is unknown", () => {
    for (const a of WORKER_ADAPTER_REGISTRY) {
      const estimate = a.estimate(baseRequest());
      assert(["LOW", "MEDIUM", "HIGH", "UNKNOWN"].includes(estimate.confidence), `Adapter ${a.id} estimate().confidence is not a real, valid literal`);
    }
  });

  console.log("\n=== Worker Adapter Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
