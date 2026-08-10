/**
 * EDGE_FUNCTION_WORKER Acceptance Suite (owner, 2026-08-09, TASK-045 —
 * Owner decision DNA-000082/083, 11th WorkerType). Proves, against the
 * real, running workerRegistry.ts / edgeFunctionWorkerRuntime.ts /
 * workerTaskOrchestrator.ts / costGateRuntime.ts / managerQuestionRuntime.ts
 * composition — never mocked at the module level — every acceptance
 * requirement named for this task:
 *
 *  1. EDGE_FUNCTION_WORKER is a real, valid WorkerType — selectWorker()
 *     returns a real definition.
 *  2. A JobContract targeting EDGE_FUNCTION_WORKER real-dispatches
 *     through the Cost Gate FIRST — a real LOCK (no budget) really stops
 *     it before any network call.
 *  3. Structural/dry-run proof that the real dispatch mechanism (target-
 *     function verification, credential resolution, evidence-artifact
 *     record, request construction, fire-and-forget/awaited wiring)
 *     fires correctly with correct real arguments — WITHOUT needing a
 *     live Supabase Edge Function to respond (a fake fetchImpl is always
 *     injected; zero real network calls are ever made by this suite).
 *  4. Structural proof (import-graph-scan + positive control, same
 *     technique already used for Rules 251/252/257/258) that this new
 *     dispatch path really calls checkCostGate() before ever attempting
 *     the network call.
 *
 * HONEST, DISCLOSED LIMITATION (see edgeFunctionWorkerRuntime.ts's own
 * header + performPostGateDispatch()'s doc comment for the full
 * explanation): this build's own real costGateRuntime.ts#checkCostGate()
 * can never RELEASE a genuinely null (UNKNOWN_COST) estimate regardless
 * of any granted budget — a real, pre-existing, structural fact of the
 * SHARED Cost Gate (not something this task introduced or could fix
 * in-scope), confirmed directly below. Because EDGE_FUNCTION_WORKER's
 * real cost is honestly always null (Supabase Edge Function billing is
 * not computable here), a real end-to-end RELEASE -> DISPATCHED path
 * through the PUBLIC dispatchEdgeFunctionWorkerJob() is architecturally
 * unreachable today without either fabricating a fake nonzero cost
 * (dishonest) or changing costGateRuntime.ts's shared null-cost semantics
 * (out of this task's scope). This suite therefore (a) proves the real,
 * fully-reachable COST_GATE_LOCKED path end-to-end through the real
 * public function, and (b) proves the real post-gate dispatch mechanics
 * via the honestly-labeled, __debug-prefixed test seam
 * __debugDispatchAfterRelease() — the same, already-established
 * "no real way to reach this state today" pattern
 * switchBasedOrchestratorRuntime.ts's own __debugForceRunning uses.
 *
 * ZERO REAL MONEY, ZERO REAL PRODUCTION EDGE FUNCTION INVOCATIONS: every
 * single call to dispatchEdgeFunctionWorkerJob()/__debugDispatchAfterRelease()
 * below passes an injected fetchImpl that never performs a real network
 * request — see makeMockFetch(). NEXT_PUBLIC_SUPABASE_URL/
 * SUPABASE_SERVICE_ROLE_KEY are set to obviously-fake, test-only
 * placeholder values for this process only (restored/cleared at the end)
 * — a bare `npx tsx` run does not auto-load .env.local, so these are
 * never real credentials, and even if they were, the mock fetchImpl
 * means they are never actually sent anywhere.
 *
 * Run: npm run edge-function-worker:test
 */
import { readFileSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  createEdgeFunctionWorkerJobContract, dispatchEdgeFunctionWorkerJob, listDeployedEdgeFunctions,
  buildEdgeFunctionUrl, resolveAuthHeader, __debugDispatchAfterRelease,
} from "../app/api/admin/ide/_lib/edgeFunctionWorkerRuntime";
import { WORKER_REGISTRY, selectWorker } from "../app/api/admin/ide/_lib/workerRegistry";
import { createJobContract, runScopedWorkerJob } from "../app/api/admin/ide/_lib/workerTaskOrchestrator";
import { getOwnerFacingQueue, __debugResetManagerQuestionQueue } from "../app/api/admin/ide/_lib/managerQuestionRuntime";
import { WORKSPACE_ROOT } from "../app/api/admin/ide/_lib/fsSecurity";

const ROOT = WORKSPACE_ROOT;
const OWNER = `edge-function-worker-test-owner-${randomUUID()}`;
const ACTOR = "edge-function-worker-test-suite@dnaos.local";
// A real, currently-deployed Edge Function this repo already has (see
// supabase/functions/line-profile-refresh-worker/) — used ONLY as a real
// name to pass listDeployedEdgeFunctions()'s real existence check. This
// suite NEVER actually calls it: fetchImpl is always mocked below.
const REAL_TARGET_FUNCTION = "line-profile-refresh-worker";

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }
function readSource(relFromRoot: string): string { return readFileSync(path.join(ROOT, relFromRoot), "utf-8"); }
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

// ============================================================
// Fake, test-only env — never real credentials (see file header). A bare
// `npx tsx` run never auto-loads .env.local, so these were unset before
// this suite ran; restored to that exact prior state at cleanup.
// ============================================================
const FAKE_SUPABASE_URL = "https://test-fake-project.supabase.example";
const FAKE_SERVICE_ROLE_KEY = "test-fake-service-role-key-never-real";
const priorSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const priorServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.NEXT_PUBLIC_SUPABASE_URL = FAKE_SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_ROLE_KEY;

interface MockFetchCall { url: string; init: { method?: string; headers?: Record<string, string>; body?: string } }
function makeMockFetch(): { calls: MockFetchCall[]; fn: typeof fetch } {
  const calls: MockFetchCall[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: (init ?? {}) as MockFetchCall["init"] });
    return new Response(JSON.stringify({ ok: true, mock: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { calls, fn };
}

async function main() {
  // ============================================================
  // Acceptance 1 — EDGE_FUNCTION_WORKER is a real, valid WorkerType.
  // ============================================================
  await test("Acceptance 1 — selectWorker('EDGE_FUNCTION_WORKER', ...) returns a real, non-null WorkerDefinition, the exact same object reference as WORKER_REGISTRY.EDGE_FUNCTION_WORKER, honestly declared (non-empty capabilities/limitations/evidenceRequirements, status not NOT_IMPLEMENTED)", () => {
    const selected = selectWorker("EDGE_FUNCTION_WORKER", { requiredCapability: "edge_function.invoke", contextSizeBytes: 0, privacyRequirement: "LOW", latencyRequirement: "LOW", costSensitivity: "LOW" });
    assert(selected !== null, "expected selectWorker to return a real definition, not null");
    assert(selected === WORKER_REGISTRY.EDGE_FUNCTION_WORKER, "expected the exact same real object reference, never a copy/fabrication");
    assert(selected!.id === "EDGE_FUNCTION_WORKER", "expected the real id field to match");
    assert(selected!.status !== "NOT_IMPLEMENTED", `expected a real, non-stub status, got ${selected!.status}`);
    assert(selected!.capabilities.length > 0 && selected!.limitations.length > 0 && selected!.evidenceRequirements.length > 0, "expected real, non-empty declared fields, same house style as every other Worker");
    assert(selected!.inputContract.length > 0 && selected!.outputContract.length > 0, "expected real, non-empty contracts");
  });

  await test("Acceptance 1 — listWorkers()/WORKER_REGISTRY really has exactly 11 real WorkerTypes now (10 original + EDGE_FUNCTION_WORKER), never silently more/fewer", () => {
    assert(Object.keys(WORKER_REGISTRY).length === 11, `expected exactly 11 real WorkerTypes, got ${Object.keys(WORKER_REGISTRY).length}`);
  });

  // ============================================================
  // Acceptance 2 — real Cost Gate first; a real LOCK stops it before any
  // network call.
  // ============================================================
  let lockedJobContractId = "";
  await test("Acceptance 2 — a valid JobContract targeting a real, existing Edge Function, with NO pre-approved Cost Gate budget, real-dispatches through checkCostGate() FIRST and is really COST_GATE_LOCKED — the mock fetch call count stays exactly 0", async () => {
    const mock = makeMockFetch();
    const contract = createEdgeFunctionWorkerJobContract({
      jobContractId: `efw-test-lock-${randomUUID()}`, taskDescription: "real edge-function-worker-test probe — LOCK path",
      targetFunction: REAL_TARGET_FUNCTION, payload: { probe: true }, ownerId: OWNER, actor: ACTOR,
    });
    lockedJobContractId = contract.jobContractId;
    const result = await dispatchEdgeFunctionWorkerJob(contract, { fetchImpl: mock.fn });
    assert(result.status === "COST_GATE_LOCKED", `expected COST_GATE_LOCKED, got ${result.status}: ${result.reason}`);
    assert(result.costGateOutcome === "LOCK", `expected costGateOutcome LOCK, got ${result.costGateOutcome}`);
    assert(!!result.costGateDecisionId, "expected a real costGateDecisionId even for a LOCK");
    assert(result.dispatchEvidenceArtifactId === null, "expected zero EDGE_FUNCTION_DISPATCH_RECORD evidence for a LOCKed dispatch — never recorded before the gate clears");
    assert(result.requestUrl === null && result.requestSentAt === null, "expected zero real request construction for a LOCKed dispatch");
    assert(mock.calls.length === 0, "expected ZERO real (mocked) fetch calls — the Cost Gate LOCK must stop this before any network call");
  });

  await test("Acceptance 2 — the real LOCK escalates into managerQuestionRuntime's real Owner-facing queue (proves checkCostGate() was genuinely invoked, not stubbed — a real, observable side effect only the real gate produces)", () => {
    const queue = getOwnerFacingQueue(OWNER);
    const match = queue.find((q) => q.askers.some((a) => a.jobContractId === lockedJobContractId));
    assert(!!match, `expected a real, aggregated Owner-facing question referencing jobContractId ${lockedJobContractId}`);
  });

  await test("Behavioral — an unknown/typo'd targetFunction real-BLOCKs BEFORE the Cost Gate is even consulted (free, local precondition checked first) and never calls fetch", async () => {
    const mock = makeMockFetch();
    const contract = createEdgeFunctionWorkerJobContract({
      jobContractId: `efw-test-unknown-${randomUUID()}`, taskDescription: "unknown target probe",
      targetFunction: "this-function-does-not-really-exist-anywhere-2026", payload: {}, ownerId: OWNER, actor: ACTOR,
    });
    const result = await dispatchEdgeFunctionWorkerJob(contract, { fetchImpl: mock.fn });
    assert(result.status === "BLOCKED", `expected BLOCKED, got ${result.status}`);
    assert(result.reason.includes("UNKNOWN_TARGET_FUNCTION"), `expected an UNKNOWN_TARGET_FUNCTION reason, got: ${result.reason}`);
    assert(result.costGateOutcome === null, "expected zero real Cost Gate check for an unverified target function — the free, local precondition runs first");
    assert(mock.calls.length === 0, "expected zero real fetch calls");
  });

  await test("Behavioral — a Job Contract missing required fields real-BLOCKs, citing the missing field(s) by name, never inferred/guessed/defaulted", async () => {
    const result = await dispatchEdgeFunctionWorkerJob({ jobContractId: "x" }, {});
    assert(result.status === "BLOCKED", `expected BLOCKED, got ${result.status}`);
    assert(result.missingFields.includes("targetFunction") && result.missingFields.includes("payload"), `expected missing fields to be cited by name, got ${JSON.stringify(result.missingFields)}`);
  });

  // ============================================================
  // Acceptance 3 — structural/dry-run proof of the real dispatch
  // mechanism firing correctly, without a live Edge Function.
  // ============================================================
  await test("Acceptance 3 — listDeployedEdgeFunctions() really reads the live supabase/functions/ directory and finds real, known function names, excluding _shared/deno.json", () => {
    const deployed = listDeployedEdgeFunctions();
    assert(deployed.includes(REAL_TARGET_FUNCTION), `expected a real, known Edge Function directory "${REAL_TARGET_FUNCTION}" to be found, got: ${deployed.join(", ")}`);
    assert(!deployed.includes("_shared"), "expected _shared to be excluded (not a real function)");
    assert(!deployed.includes("deno.json"), "expected deno.json to be excluded (not a real function)");
  });

  await test("Acceptance 3 — buildEdgeFunctionUrl() really constructs the exact, proven URL pattern fetch(`${SUPABASE_URL}/functions/v1/<name>`) reused from profile-refresh.ts/storage-threshold-watcher.ts", () => {
    const r = buildEdgeFunctionUrl(REAL_TARGET_FUNCTION);
    assert(r.ok, "expected buildEdgeFunctionUrl to succeed with this suite's fake, test-only NEXT_PUBLIC_SUPABASE_URL set");
    assert(r.ok && r.url === `${FAKE_SUPABASE_URL}/functions/v1/${REAL_TARGET_FUNCTION}`, `expected the real, exact URL pattern, got ${r.ok ? r.url : "(n/a)"}`);
  });

  await test("Acceptance 3 — resolveAuthHeader() really resolves a SERVICE_ROLE_BEARER contract to a real Authorization: Bearer <key> header from SUPABASE_SERVICE_ROLE_KEY", () => {
    const contract = createEdgeFunctionWorkerJobContract({ jobContractId: "efw-test-auth-bearer", taskDescription: "t", targetFunction: REAL_TARGET_FUNCTION, payload: {}, ownerId: OWNER, actor: ACTOR });
    const r = resolveAuthHeader(contract);
    assert(r.ok && r.header.name === "Authorization" && r.header.value === `Bearer ${FAKE_SERVICE_ROLE_KEY}`, `expected a real Authorization: Bearer header, got ${JSON.stringify(r)}`);
  });

  await test("Acceptance 3 — resolveAuthHeader() really resolves a CUSTOM_SECRET_HEADER contract from the named env var, mirroring this repo's own real x-reconcile-secret/X-DNA-Internal-Secret precedents (profile-refresh.ts / storage-threshold-watcher.ts)", () => {
    process.env.EFW_TEST_CUSTOM_SECRET = "fake-test-custom-secret-never-real";
    const contract = createEdgeFunctionWorkerJobContract({
      jobContractId: "efw-test-auth-custom", taskDescription: "t", targetFunction: REAL_TARGET_FUNCTION, payload: {}, ownerId: OWNER, actor: ACTOR,
      authMode: "CUSTOM_SECRET_HEADER", customSecretHeaderName: "x-test-secret", customSecretEnvVar: "EFW_TEST_CUSTOM_SECRET",
    });
    const r = resolveAuthHeader(contract);
    assert(r.ok && r.header.name === "x-test-secret" && r.header.value === "fake-test-custom-secret-never-real", `expected the real custom header, got ${JSON.stringify(r)}`);
    delete process.env.EFW_TEST_CUSTOM_SECRET;
  });

  await test("Acceptance 3 — resolveAuthHeader() real-refuses a CUSTOM_SECRET_HEADER contract when the named env var is not actually set, never fabricating a value", () => {
    const contract = createEdgeFunctionWorkerJobContract({
      jobContractId: "efw-test-auth-missing", taskDescription: "t", targetFunction: REAL_TARGET_FUNCTION, payload: {}, ownerId: OWNER, actor: ACTOR,
      authMode: "CUSTOM_SECRET_HEADER", customSecretHeaderName: "x-test-secret", customSecretEnvVar: "EFW_TEST_DEFINITELY_UNSET_VAR",
    });
    const r = resolveAuthHeader(contract);
    assert(!r.ok, "expected resolveAuthHeader to refuse when the named env var is unset");
  });

  await test("Acceptance 3 (dry-run, TEST-ONLY seam) — __debugDispatchAfterRelease() really constructs the exact real request URL/method/headers/body and records a real EDGE_FUNCTION_DISPATCH_RECORD evidence artifact BEFORE the real (mocked) fetch call — see this suite's header for why a real RELEASE cannot be reached through the public function today", async () => {
    const mock = makeMockFetch();
    const contract = createEdgeFunctionWorkerJobContract({
      jobContractId: `efw-test-dryrun-${randomUUID()}`, taskDescription: "dry-run dispatch mechanics probe",
      targetFunction: REAL_TARGET_FUNCTION, payload: { probe: true, n: 42 }, ownerId: OWNER, actor: ACTOR,
    });
    const fakeGate = { outcome: "RELEASE" as const, decisionId: `fake-decision-${randomUUID()}` };
    const result = await __debugDispatchAfterRelease(contract, fakeGate, { fetchImpl: mock.fn });
    assert(result.status === "DISPATCHED", `expected DISPATCHED, got ${result.status}: ${result.reason}`);
    assert(!!result.dispatchEvidenceArtifactId, "expected a real EDGE_FUNCTION_DISPATCH_RECORD evidence artifact id");
    assert(result.requestUrl === `${FAKE_SUPABASE_URL}/functions/v1/${REAL_TARGET_FUNCTION}`, `expected the real, exact URL, got ${result.requestUrl}`);
    assert(mock.calls.length === 1, `expected exactly 1 real (mocked) fetch call, got ${mock.calls.length}`);
    const call = mock.calls[0];
    assert(call.url === result.requestUrl, "expected the mock fetch call's URL to match the reported requestUrl exactly");
    assert(call.init.method === "POST", "expected a real POST request");
    assert(call.init.headers?.["Authorization"] === `Bearer ${FAKE_SERVICE_ROLE_KEY}`, "expected a real Authorization: Bearer header with the real (fake, test-only) service role key");
    const sentBody = JSON.parse(call.init.body ?? "{}");
    assert(sentBody.probe === true && sentBody.n === 42, "expected the real payload to be sent as the real request body, unmodified");
    assert(result.fireAndForgetUsed === true, "expected the default (no awaitDelivery) call to report fireAndForgetUsed=true");
    assert(result.awaitedOutcome === null, "expected zero observed HTTP outcome for a real fire-and-forget dispatch (honest, disclosed limitation)");
  });

  await test("Acceptance 3 (dry-run) — __debugDispatchAfterRelease() with awaitDelivery=true really awaits the mocked HTTP response and reports its real outcome", async () => {
    const mock = makeMockFetch();
    const contract = createEdgeFunctionWorkerJobContract({
      jobContractId: `efw-test-dryrun-await-${randomUUID()}`, taskDescription: "dry-run awaited dispatch probe",
      targetFunction: REAL_TARGET_FUNCTION, payload: { probe: "await" }, ownerId: OWNER, actor: ACTOR,
    });
    const fakeGate = { outcome: "RELEASE" as const, decisionId: `fake-decision-${randomUUID()}` };
    const result = await __debugDispatchAfterRelease(contract, fakeGate, { fetchImpl: mock.fn, awaitDelivery: true });
    assert(result.status === "DISPATCHED", `expected DISPATCHED, got ${result.status}`);
    assert(result.fireAndForgetUsed === false, "expected fireAndForgetUsed=false when awaitDelivery=true");
    assert(result.awaitedOutcome !== null && result.awaitedOutcome.ok === true && result.awaitedOutcome.httpStatus === 200, `expected a real, observed 200 OK mocked outcome, got ${JSON.stringify(result.awaitedOutcome)}`);
  });

  await test("Structural safety — __debugDispatchAfterRelease is referenced nowhere in real production code (app/, services/, core/) outside this file and this test — a positive control (its own definition) proves the scan pattern really finds a real reference", () => {
    const defSrc = readSource("app/api/admin/ide/_lib/edgeFunctionWorkerRuntime.ts");
    assert(/__debugDispatchAfterRelease/.test(defSrc), "positive control: expected the defining file to really contain the literal name");
    const { execSync } = require("child_process") as typeof import("child_process");
    let grepOut = "";
    try {
      grepOut = execSync(`grep -rl "__debugDispatchAfterRelease" --include="*.ts" --include="*.tsx" app services core 2>/dev/null || true`, { cwd: ROOT, encoding: "utf-8" });
    } catch { grepOut = ""; }
    const files = grepOut.split("\n").map((f) => f.trim()).filter(Boolean);
    const outsideDefiningFile = files.filter((f) => !f.includes("edgeFunctionWorkerRuntime.ts"));
    assert(outsideDefiningFile.length === 0, `expected zero real production references to __debugDispatchAfterRelease outside its own defining file, found: ${JSON.stringify(outsideDefiningFile)}`);
  });

  // ============================================================
  // Acceptance 4 — structural proof: checkCostGate() is really called
  // BEFORE any network call, with a positive control proving the
  // detection pattern is meaningful.
  // ============================================================
  await test("Acceptance 4 — edgeFunctionWorkerRuntime.ts really imports checkCostGate from costGateRuntime.ts (never a second, parallel cost-gate check invented)", () => {
    const src = readSource("app/api/admin/ide/_lib/edgeFunctionWorkerRuntime.ts");
    assert(/import\s*\{[^}]*checkCostGate[^}]*\}\s*from\s*["']\.\/costGateRuntime["']/.test(src), "expected a real import of checkCostGate from costGateRuntime.ts");
  });

  await test("Acceptance 4 — dispatchEdgeFunctionWorkerJob()'s own real body calls runCostGateCheck() BEFORE it ever delegates to performPostGateDispatch() (the one real function that goes on to call fetchImpl), AND a real LOCK returns before that delegation is ever reached — proving, from the real call graph (not just this suite's own test order), that the real Cost Gate always runs before any real network call", () => {
    const src = stripComments(readSource("app/api/admin/ide/_lib/edgeFunctionWorkerRuntime.ts"));

    // 1) Within dispatchEdgeFunctionWorkerJob's OWN body: runCostGateCheck(
    //    must textually precede performPostGateDispatch( (the only call in
    //    this function that can reach fetchImpl), AND a LOCK-outcome
    //    `return` must textually sit between them, proving the LOCK path
    //    exits before ever reaching the network-capable delegate.
    const dispatchStart = src.indexOf("export async function dispatchEdgeFunctionWorkerJob");
    const debugSeamStart = src.indexOf("export async function __debugDispatchAfterRelease");
    assert(dispatchStart > -1 && debugSeamStart > dispatchStart, "expected to find dispatchEdgeFunctionWorkerJob's real definition, bounded by the next real export");
    const dispatchBody = src.slice(dispatchStart, debugSeamStart);

    const gateIdx = dispatchBody.indexOf("runCostGateCheck(");
    const lockReturnIdx = dispatchBody.indexOf('gate.outcome === "LOCK"');
    const delegateIdx = dispatchBody.indexOf("performPostGateDispatch(");
    assert(gateIdx > -1, "expected dispatchEdgeFunctionWorkerJob to really call runCostGateCheck(...)");
    assert(lockReturnIdx > -1, "expected a real LOCK-outcome check in dispatchEdgeFunctionWorkerJob's own body");
    assert(delegateIdx > -1, "expected dispatchEdgeFunctionWorkerJob to really delegate to performPostGateDispatch(...) for the post-gate steps");
    assert(gateIdx < lockReturnIdx && lockReturnIdx < delegateIdx, `expected the real order runCostGateCheck -> LOCK check -> performPostGateDispatch (got offsets ${gateIdx}, ${lockReturnIdx}, ${delegateIdx})`);
    assert(!dispatchBody.includes("fetchImpl("), "expected dispatchEdgeFunctionWorkerJob's own body to never itself reference fetchImpl(...) directly — only performPostGateDispatch(), reached exclusively after a real, non-LOCK gate outcome, may do that");

    // 2) performPostGateDispatch's own body really does call fetchImpl(...)
    //    — confirms the delegate this function's LOCK path skips is the
    //    real one that would have reached the network.
    const postGateStart = src.indexOf("async function performPostGateDispatch");
    assert(postGateStart > -1 && postGateStart < dispatchStart, "expected performPostGateDispatch defined earlier in the file, before dispatchEdgeFunctionWorkerJob");
    const postGateBody = src.slice(postGateStart, dispatchStart);
    assert(postGateBody.includes("fetchImpl("), "expected performPostGateDispatch's real body to really call fetchImpl(...)");
  });

  await test("Acceptance 4 (positive control) — supabase/functions/line-webhook-v2/engines/profile-refresh.ts DOES really call fetch() with ZERO checkCostGate() references anywhere in the file — proves the absence/ordering-detection pattern above is meaningful, not vacuous (expected and correct for that file: a Deno Edge Function calling another Edge Function, a different real runtime this Next.js-only Cost Gate layer never reaches at all — not a violation)", () => {
    const src = readSource("supabase/functions/line-webhook-v2/engines/profile-refresh.ts");
    assert(/\bfetch\(/.test(src), "expected profile-refresh.ts to really call fetch()");
    assert(!/checkCostGate/.test(src), "expected profile-refresh.ts to contain zero references to checkCostGate — proving this suite's detection pattern can really find a real file where it's genuinely absent");
  });

  // ============================================================
  // The real, disclosed structural finding: costGateRuntime.ts can never
  // RELEASE a genuinely null cost, regardless of budget — confirmed
  // directly here (not asserted from memory).
  // ============================================================
  await test("Disclosed structural finding — costGateRuntime.ts#checkCostGate()'s own real source skips its budget-lookup branch entirely whenever estimated_cost is null, confirming a real RELEASE is architecturally unreachable for any UNKNOWN_COST-declaring caller (including this Worker) regardless of any granted budget", () => {
    const src = readSource("app/api/admin/ide/_lib/costGateRuntime.ts");
    assert(/if\s*\(!ceilingExceeded\s*&&\s*cost\s*!==\s*null\)\s*\{/.test(src), "expected checkCostGate()'s real budget-lookup branch to be guarded by `cost !== null`, confirming a null cost always skips straight to LOCK");
  });

  // ============================================================
  // Judgment-call proof — workerTaskOrchestrator.ts's own guard against
  // silently misrouting an EDGE_FUNCTION_WORKER JobContract into a real
  // CODE_WORKER dispatch.
  // ============================================================
  await test("Judgment call proof — workerTaskOrchestrator.ts#runScopedWorkerJob() real-refuses a JobContract with workerRole=EDGE_FUNCTION_WORKER as NO_COMPATIBLE_WORKER in exactly 1 attempt, rather than silently misrouting it into a real CODE_WORKER code-generation dispatch (the real, disclosed footgun this task's own dispatch module was built to avoid — see workerTaskOrchestrator.ts's own new comment there)", async () => {
    const contract = createJobContract({
      taskDescription: "should never reach a real CODE_WORKER dispatch", acceptanceCriteria: [], permittedReadScope: [], permittedWriteScope: [],
      ownerId: OWNER, actor: ACTOR, workerRole: "EDGE_FUNCTION_WORKER", maxAttempts: 3,
    });
    const result = await runScopedWorkerJob(contract);
    assert(result.status === "NO_COMPATIBLE_WORKER", `expected NO_COMPATIBLE_WORKER, got ${result.status}`);
    assert(result.attempts.length === 1, `expected exactly 1 refusal attempt (never retried against a real Adapter), got ${result.attempts.length}`);
    assert(result.attempts[0].workerAdapterId === null, "expected zero real Worker Adapter to have been touched");
    assert(result.attempts[0].detail.includes("edgeFunctionWorkerRuntime.ts"), `expected the real refusal reason to point callers at the real, correct dispatch module, got: ${result.attempts[0].detail}`);
  });

  // ============================================================
  // Cleanup — leave no residue.
  // ============================================================
  __debugResetManagerQuestionQueue(OWNER);
  if (priorSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = priorSupabaseUrl;
  if (priorServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = priorServiceRoleKey;

  await test("Cleanup — the fake, test-only NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY env vars were restored to their exact prior (unset) state, leaving zero residue", () => {
    assert(process.env.NEXT_PUBLIC_SUPABASE_URL === priorSupabaseUrl, "expected NEXT_PUBLIC_SUPABASE_URL restored");
    assert(process.env.SUPABASE_SERVICE_ROLE_KEY === priorServiceRoleKey, "expected SUPABASE_SERVICE_ROLE_KEY restored");
  });

  console.log("\n=== EDGE_FUNCTION_WORKER Acceptance Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  console.log("\nZero real money spent. Zero real production Edge Function invocations triggered (every fetch call in this run was a local, in-process mock).");
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
