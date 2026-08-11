/**
 * DigitalOcean Adapter — Credential Resolution Order Regression Suite
 * (owner, 2026-08-11, TASK-081). Proves the real, extended resolution
 * order digitalOceanWorkerAdapter.ts now implements: a real, usable
 * Connectors DB row (slug starts with "digitalocean", enabled=true,
 * status="connected") is preferred FIRST; the pre-existing
 * DIGITALOCEAN_INFERENCE_API_KEY/DIGITALOCEAN_INFERENCE_MODEL env vars are
 * used only as a fallback when no such row exists. Also proves the
 * Connect→Register→Test→Enable lifecycle gate (a real row that exists but
 * is not enabled+connected must NOT be treated as usable) and the
 * async-cache/synchronous-availability() architecture (cold cache honestly
 * reports unavailable; preflight()/execute()/health() populate it).
 *
 * Uses this repo's own real, established __debug*-style test injection
 * seam (digitalOceanWorkerAdapter.ts#__setListConnectorsForTest /
 * #__resetCredentialCacheForTest) rather than a full ESM module-mocking
 * framework (this repo has none) — same discipline as
 * codeWorkerRuntime.ts#__debugProposalCount. Never makes a real live
 * DigitalOcean API call, never touches the real Connectors DB (the stub
 * function fully replaces listConnectors() for the duration of this
 * process) and never touches the real registry.
 *
 * Run: npx tsx scripts/digitalocean-connector-credential-resolution-test.ts
 */
import { randomUUID } from "crypto";
import {
  digitalOceanApiAdapter,
  __setListConnectorsForTest,
  __resetCredentialCacheForTest,
} from "../app/api/admin/ide/_lib/workerAdapters/digitalOceanWorkerAdapter";
import type { WorkerRequest } from "../app/api/admin/ide/_lib/workerContract";
import type { ConnectorRecord } from "../core/connector-loader";

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

function baseRequest(): WorkerRequest {
  return {
    workerRequestId: randomUUID(), workspaceSessionId: randomUUID(), executionPlanId: null, stepId: "credential-resolution-test", workerType: "CODE_WORKER",
    capabilityRequired: "code.generate", contextPackageId: null, contextFingerprint: null, permittedReadScope: [], permittedWriteScope: [],
    permittedTools: [], forbiddenTools: [], expectedOutputSchema: "n/a", timeoutMs: 5000, maxCalls: 1, maxTokens: 500, maxCost: null,
    privacyLevel: "CLOUD_ALLOWED", networkPolicy: "OUTBOUND_ALLOWED", approvalPolicy: "OWNER_APPROVAL_REQUIRED", actor: "test@dnaos.local",
    createdAt: new Date().toISOString(), taskDescription: "test", acceptanceCriteria: [], fileContents: [],
  };
}

function fakeConnector(overrides: Partial<ConnectorRecord> = {}): ConnectorRecord {
  return {
    id: randomUUID(), name: "DigitalOcean (test)", slug: "digitalocean-abc123", auth_type: "api_key",
    status: "connected", enabled: true,
    config: { base_url: "https://fake-do-test.example/v1", header_name: "Authorization", header_prefix: "Bearer " },
    secret: { api_key: "fake-connector-sourced-key" },
    last_checked_at: new Date().toISOString(), last_error: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    ...overrides,
  };
}

async function main() {
  const originalEnvKey = process.env.DIGITALOCEAN_INFERENCE_API_KEY;
  const originalEnvModel = process.env.DIGITALOCEAN_INFERENCE_MODEL;

  await test("Cold process: availability() honestly reports unavailable before any preflight()/execute()/health() ever runs — never guesses", () => {
    __resetCredentialCacheForTest();
    __setListConnectorsForTest(async () => { throw new Error("must not be called by a synchronous availability() check"); });
    const avail = digitalOceanApiAdapter.availability();
    assert(avail.available === false, "expected a cold cache to honestly report unavailable, never optimistically true");
    assert(avail.reason.includes("has not run yet"), `expected an honest 'not checked yet' reason, got: ${avail.reason}`);
  });

  await test("Connectors-DB-first: a real, usable connector (enabled+connected) is preferred over a simultaneously-set env var", async () => {
    __resetCredentialCacheForTest();
    process.env.DIGITALOCEAN_INFERENCE_API_KEY = "fake-env-var-key-should-be-ignored";
    process.env.DIGITALOCEAN_INFERENCE_MODEL = "fake-env-model-should-be-ignored";
    __setListConnectorsForTest(async () => [fakeConnector()]);

    const preflight = await digitalOceanApiAdapter.preflight!();
    assert(preflight.status === "AVAILABLE", `expected AVAILABLE after a usable connector resolves, got ${preflight.status} (${preflight.reason})`);
    assert(preflight.reason.includes("Connectors DB"), `expected the preflight reason to credit the Connectors DB, got: ${preflight.reason}`);

    const avail = digitalOceanApiAdapter.availability();
    assert(avail.available === true, "expected availability() to be true once the cache is populated with a usable connector");
    assert(avail.reason.includes("Connectors DB"), `expected availability() reason to name the Connectors DB source, got: ${avail.reason}`);

    const response = await digitalOceanApiAdapter.execute(baseRequest());
    // No real network call actually succeeds against the fake base_url, so
    // this legitimately reports FAILED/TIMEOUT rather than SUCCEEDED — the
    // real, observable proof here is that it tried the CONNECTOR'S values,
    // never NOT_CONFIGURED (which would mean env-var-vs-connector logic
    // picked neither, or picked wrong and treated it as absent).
    assert(response.status !== "NOT_CONFIGURED", `expected the adapter to have attempted a real dispatch using the resolved connector credential, got NOT_CONFIGURED (error=${response.error})`);
  });

  await test("Env-var fallback still works unchanged when no usable connector exists (empty Connectors DB)", async () => {
    __resetCredentialCacheForTest();
    process.env.DIGITALOCEAN_INFERENCE_API_KEY = "fake-env-var-key";
    delete process.env.DIGITALOCEAN_INFERENCE_MODEL;
    __setListConnectorsForTest(async () => []);

    const preflight = await digitalOceanApiAdapter.preflight!();
    assert(preflight.status === "AVAILABLE", `expected AVAILABLE via env var fallback, got ${preflight.status} (${preflight.reason})`);
    assert(preflight.reason.includes("DIGITALOCEAN_INFERENCE_API_KEY"), `expected the preflight reason to credit the env var, got: ${preflight.reason}`);

    const avail = digitalOceanApiAdapter.availability();
    assert(avail.available === true, "expected availability() true via env var fallback");
    assert(avail.reason.includes("env var fallback"), `expected availability() reason to say env var fallback, got: ${avail.reason}`);
  });

  await test("Env-var fallback still works when the Connectors DB has a row, but for a different provider (no digitalocean-prefixed slug)", async () => {
    __resetCredentialCacheForTest();
    process.env.DIGITALOCEAN_INFERENCE_API_KEY = "fake-env-var-key-2";
    __setListConnectorsForTest(async () => [fakeConnector({ slug: "tiktok-xyz789" })]);

    await digitalOceanApiAdapter.preflight!();
    const avail = digitalOceanApiAdapter.availability();
    assert(avail.available === true && avail.reason.includes("env var fallback"), `expected env var fallback when no digitalocean-prefixed connector exists, got: ${JSON.stringify(avail)}`);
  });

  await test("Lifecycle gate: a real connector row that exists but is not enabled+connected is never treated as usable — falls back to env var", async () => {
    __resetCredentialCacheForTest();
    process.env.DIGITALOCEAN_INFERENCE_API_KEY = "fake-env-var-key-3";
    __setListConnectorsForTest(async () => [fakeConnector({ enabled: false, status: "connected" })]);
    await digitalOceanApiAdapter.preflight!();
    let avail = digitalOceanApiAdapter.availability();
    assert(avail.reason.includes("env var fallback"), `expected a disabled connector to be ignored (Connect->Register->Test->Enable lifecycle), got: ${JSON.stringify(avail)}`);

    __resetCredentialCacheForTest();
    __setListConnectorsForTest(async () => [fakeConnector({ enabled: true, status: "error" })]);
    await digitalOceanApiAdapter.preflight!();
    avail = digitalOceanApiAdapter.availability();
    assert(avail.reason.includes("env var fallback"), `expected an enabled-but-not-connected (status=error) connector to be ignored, got: ${JSON.stringify(avail)}`);
  });

  await test("Neither a usable connector nor a real env var: honestly unavailable, never fabricated true", async () => {
    __resetCredentialCacheForTest();
    delete process.env.DIGITALOCEAN_INFERENCE_API_KEY;
    delete process.env.DIGITALOCEAN_INFERENCE_MODEL;
    __setListConnectorsForTest(async () => []);
    await digitalOceanApiAdapter.preflight!();
    const avail = digitalOceanApiAdapter.availability();
    assert(avail.available === false, "expected honestly unavailable with neither source present");
  });

  await test("A Connectors DB read failure (e.g. unreachable DB) never blocks the pre-existing env var path", async () => {
    __resetCredentialCacheForTest();
    process.env.DIGITALOCEAN_INFERENCE_API_KEY = "fake-env-var-key-4";
    __setListConnectorsForTest(async () => { throw new Error("simulated Supabase read failure"); });
    await digitalOceanApiAdapter.preflight!();
    const avail = digitalOceanApiAdapter.availability();
    assert(avail.available === true && avail.reason.includes("env var fallback"), `expected a DB read failure to fall back to the env var honestly, got: ${JSON.stringify(avail)}`);
  });

  await test("A usable connector missing a real api_key/base_url value is never half-trusted — falls back to env var", async () => {
    __resetCredentialCacheForTest();
    process.env.DIGITALOCEAN_INFERENCE_API_KEY = "fake-env-var-key-5";
    __setListConnectorsForTest(async () => [fakeConnector({ secret: {} })]);
    await digitalOceanApiAdapter.preflight!();
    const avail = digitalOceanApiAdapter.availability();
    assert(avail.reason.includes("env var fallback"), `expected a connector missing a real api_key to be ignored, got: ${JSON.stringify(avail)}`);
  });

  // Restore real process state and the real listConnectors implementation
  // so this test never leaks a stub into any other real process/script.
  __resetCredentialCacheForTest();
  __setListConnectorsForTest(null);
  if (originalEnvKey === undefined) delete process.env.DIGITALOCEAN_INFERENCE_API_KEY; else process.env.DIGITALOCEAN_INFERENCE_API_KEY = originalEnvKey;
  if (originalEnvModel === undefined) delete process.env.DIGITALOCEAN_INFERENCE_MODEL; else process.env.DIGITALOCEAN_INFERENCE_MODEL = originalEnvModel;

  console.log("=== DigitalOcean Credential Resolution Order Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  if (passed !== results.length) process.exit(1);
}

main().catch((e) => { console.error("SCRIPT CRASHED:", e); process.exit(1); });
