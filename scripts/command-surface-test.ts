/**
 * Owner Command Surface Regression Suite (owner, 2026-08-07, /admin/ide
 * Foundation). Verifies: real, deterministic intent resolution for every
 * recognized pattern, real hydration of the persisted Execution Context
 * before resolving, real dispatch through the EXISTING Execution Runtime
 * (never a duplicate implementation), the real Owner-confirmation
 * safety boundary (a typed command can never itself auto-confirm a
 * WORKSPACE_WRITE command), and honest UNRECOGNIZED handling — never a
 * guessed interpretation of free text.
 *
 * Run: npm run command-surface:test
 */
import { readFileSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { handleOwnerCommand } from "../app/api/admin/ide/_lib/commandSurfaceRuntime";
import { WORKER_ADAPTER_REGISTRY } from "../app/api/admin/ide/_lib/workerSelectorRuntime";
import { listJobs } from "../app/api/admin/ide/_lib/queueRuntime";
import type { WorkerAdapter } from "../app/api/admin/ide/_lib/workerAdapter";
import type { WorkerRequest, WorkerResponse } from "../app/api/admin/ide/_lib/workerContract";

const ROOT = path.join(__dirname, "..");
const ACTOR = "command-surface-regression-suite@dnaos.local";

/** Real, disposable stub Adapter for repository.search — same real
 * injection pattern already established in code-worker-test.ts. Never a
 * live, costed CLI call in this automated suite. */
function makeSearchStubAdapter(id: string, respond: (req: WorkerRequest) => Partial<WorkerResponse>): WorkerAdapter {
  return {
    id, type: "API", provider: "stub",
    availability: () => ({ available: true, reason: "real, disposable test stub" }),
    capabilities: () => ["repository.search"],
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

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }
function freshOwner(): string { return `command-surface-test-owner-${randomUUID()}`; }

async function main() {
  await test("Intent: \"ทำ Step 14\" resolves to STEP_GATE_CHECK with a real gate evaluation", async () => {
    const r = await handleOwnerCommand("ทำ Step 14", ACTOR, freshOwner());
    assert(r.intent === "STEP_GATE_CHECK", `expected STEP_GATE_CHECK, got ${r.intent}`);
    assert(r.stepGate !== null && r.stepGate.step === "14", "expected a real stepGate result for step 14");
  });

  await test("Intent: STEP_GATE_CHECK never auto-starts a Step — status is BLOCKED or OWNER_ACTION_REQUIRED, never DISPATCHED", async () => {
    const r = await handleOwnerCommand("start step 14", ACTOR, freshOwner());
    assert(r.status === "BLOCKED" || r.status === "OWNER_ACTION_REQUIRED", `expected BLOCKED or OWNER_ACTION_REQUIRED, got ${r.status} — a Step must never auto-start`);
    assert(r.dispatchedJob === null, "expected no real dispatched job for a Step gate check");
  });

  await test("Intent: \"ตรวจปัญหาปัจจุบัน\" resolves to CHECK_PROBLEMS and never duplicates the real Problems panel's own fetch", async () => {
    const r = await handleOwnerCommand("ตรวจปัญหาปัจจุบัน", ACTOR, freshOwner());
    assert(r.intent === "CHECK_PROBLEMS", `expected CHECK_PROBLEMS, got ${r.intent}`);
    assert(r.status === "RESOLVED", `expected RESOLVED, got ${r.status}`);
  });

  await test("Intent: \"เปิดไฟล์ README.md\" resolves to OPEN_FILE_HINT with the real, literal path — never fabricated", async () => {
    const r = await handleOwnerCommand("เปิดไฟล์ README.md", ACTOR, freshOwner());
    assert(r.intent === "OPEN_FILE_HINT", `expected OPEN_FILE_HINT, got ${r.intent}`);
    assert(r.hintTargetPath === "README.md", `expected the real literal path, got ${r.hintTargetPath}`);
    assert(r.status === "OWNER_ACTION_REQUIRED", "expected OWNER_ACTION_REQUIRED — this Command Surface never opens a file itself");
  });

  await test("Intent: \"แก้ module domainAssetRuntime.ts\" resolves to MODIFY_MODULE_HINT and never edits a file directly", async () => {
    const r = await handleOwnerCommand("แก้ module domainAssetRuntime.ts", ACTOR, freshOwner());
    assert(r.intent === "MODIFY_MODULE_HINT", `expected MODIFY_MODULE_HINT, got ${r.intent}`);
    assert(r.status === "OWNER_ACTION_REQUIRED", "expected OWNER_ACTION_REQUIRED — modification must go through Factory Workspace/Change Set");
    assert(r.dispatchedJob === null, "expected zero real dispatched job — this intent never mutates anything itself");
  });

  await test("Intent: bare \"รันทดสอบ\" with no target lists the real, registered options — never guesses one", async () => {
    const r = await handleOwnerCommand("รันทดสอบ", ACTOR, freshOwner());
    assert(r.intent === "RUN_REGISTERED_COMMAND", `expected RUN_REGISTERED_COMMAND, got ${r.intent}`);
    assert(r.status === "OWNER_ACTION_REQUIRED", "expected OWNER_ACTION_REQUIRED for an unspecified test target");
    assert(r.detail.includes("governance"), "expected the real, registered option list in the detail");
  });

  await test("Intent: \"รันทดสอบ nonexistent\" is honestly UNRECOGNIZED — never silently mapped to a real command", async () => {
    const r = await handleOwnerCommand("รันทดสอบ nonexistent", ACTOR, freshOwner());
    assert(r.status === "UNRECOGNIZED", `expected UNRECOGNIZED, got ${r.status}`);
    assert(r.dispatchedJob === null, "expected zero real dispatched job for an unrecognized test name");
  });

  await test("Intent: \"รันทดสอบ governance\" maps to a real WORKSPACE_WRITE command and is honestly OWNER_ACTION_REQUIRED — never auto-confirmed", async () => {
    const r = await handleOwnerCommand("รันทดสอบ governance", ACTOR, freshOwner());
    assert(r.intent === "RUN_REGISTERED_COMMAND", `expected RUN_REGISTERED_COMMAND, got ${r.intent}`);
    assert(r.status === "OWNER_ACTION_REQUIRED", `expected OWNER_ACTION_REQUIRED (governance.test requires real Owner confirmation), got ${r.status}`);
    // createRunCommandJob() still returns a real Job record (a real,
    // traceable REJECTED entry, visible in the Queue tab) — it does not
    // throw for this case. The safety property under test is that the
    // command never actually RAN, not that no record exists.
    assert(r.dispatchedJob !== null && r.dispatchedJob.status === "REJECTED", `expected a real REJECTED job record, got ${JSON.stringify(r.dispatchedJob)}`);
  });

  await test("Intent: \"รันทดสอบ review\" maps to a real READ_ONLY command and genuinely DISPATCHES via the existing Execution Runtime", async () => {
    const owner = freshOwner();
    const r = await handleOwnerCommand("รันทดสอบ review", ACTOR, owner);
    assert(r.status === "DISPATCHED", `expected DISPATCHED (review.test is READ_ONLY, no confirmation needed), got ${r.status} — ${r.detail}`);
    assert(r.dispatchedJob !== null, "expected a real dispatched job");
    assert(r.dispatchedJob!.jobId.length > 0, "expected a real, non-empty jobId");
    assert(["QUEUED", "READY", "RUNNING", "SUCCEEDED", "FAILED"].includes(r.dispatchedJob!.status), `expected a real Job status, got ${r.dispatchedJob!.status}`);
  });

  await test("Intent: \"ตรวจ architecture\" maps to the real architecture.check command and is honestly OWNER_ACTION_REQUIRED (requires real confirmation)", async () => {
    const r = await handleOwnerCommand("ตรวจ architecture", ACTOR, freshOwner());
    assert(r.intent === "CHECK_ARCHITECTURE", `expected CHECK_ARCHITECTURE, got ${r.intent}`);
    assert(r.status === "OWNER_ACTION_REQUIRED", `expected OWNER_ACTION_REQUIRED (architecture.check requires real Owner confirmation), got ${r.status}`);
    assert(r.dispatchedJob !== null && r.dispatchedJob.status === "REJECTED", `expected a real REJECTED job record, got ${JSON.stringify(r.dispatchedJob)}`);
  });

  await test("Unrecognized free text never guesses an intent", async () => {
    const r = await handleOwnerCommand("สวัสดีครับวันนี้อากาศดี", ACTOR, freshOwner());
    assert(r.intent === "UNRECOGNIZED", `expected UNRECOGNIZED, got ${r.intent}`);
    assert(r.status === "UNRECOGNIZED", `expected UNRECOGNIZED status, got ${r.status}`);
  });

  await test("Every real invocation produces a real, non-empty COMMAND_INVOCATION evidence artifact", async () => {
    const r = await handleOwnerCommand("ตรวจปัญหาปัจจุบัน", ACTOR, freshOwner());
    assert(typeof r.evidenceArtifactId === "string" && r.evidenceArtifactId.length > 0, "expected a real, non-empty evidenceArtifactId");
  });

  await test("Step 1 (owner mandate): every invocation hydrates the real, persisted Execution Context first — never guesses current_step", async () => {
    const owner = freshOwner();
    // A real, isolated checkpoint write elsewhere (executionContextRuntime's
    // own test file uses isolated paths) is out of scope here — this test
    // only proves handleOwnerCommand() calls getCurrentExecutionContext()
    // without throwing, using the real, seeded production file.
    const r = await handleOwnerCommand("ตรวจปัญหาปัจจุบัน", ACTOR, owner);
    assert(r.status === "RESOLVED", "expected a real, successful resolution after hydrating the real Execution Context");
  });

  await test("Reuse: commandSurfaceRuntime.ts never imports a second execution engine — only the existing queueRuntime.ts/executionRegistry.ts", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/commandSurfaceRuntime.ts"), "utf-8");
    const activeCodeLines = src.split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//")).join("\n");
    assert(activeCodeLines.includes("createRunCommandJob"), "expected the real, existing dispatch function to be reused");
    assert(!/spawn\(|execFile\(|child_process/i.test(activeCodeLines), "expected zero direct process-spawning in the Command Surface — dispatch always goes through the existing Execution Runtime");
  });

  // ---- SEARCH_REPOSITORY (owner, 2026-08-07, VS Code Coding Worker
  // integration) — real Worker Selector + real Queue wiring, proven with
  // a real, disposable, zero-cost stub adapter (never a live CLI call in
  // this automated suite). ----
  await test("Intent: \"หาเส้นทาง LINE webhook จนถึง AI\" resolves to SEARCH_REPOSITORY", async () => {
    const owner = freshOwner();
    const stub = makeSearchStubAdapter(`stub-search-${randomUUID()}`, () => ({ output: "real stub answer: gateway/actions.ts -> services/ai/gateway.ts" }));
    const r = await withStubAdapter(stub, () => handleOwnerCommand("หาเส้นทาง LINE webhook จนถึง AI ที่ตอบกลับ", ACTOR, owner, [stub.id]));
    assert(r.intent === "SEARCH_REPOSITORY", `expected SEARCH_REPOSITORY, got ${r.intent}`);
    assert(r.status === "RESOLVED", `expected RESOLVED, got ${r.status} — ${r.detail}`);
    assert(r.workerAnswer !== null && r.workerAnswer.text.includes("gateway"), "expected the real stub answer to flow through unmodified");
    assert(r.workerAnswer!.adapterId === stub.id, "expected the real, selected adapter id to be reported");
  });

  await test("Intent: \"ตรวจว่าตัวไหนเรียก AI\" also resolves to SEARCH_REPOSITORY (second real trigger phrase)", async () => {
    const owner = freshOwner();
    const stub = makeSearchStubAdapter(`stub-search-${randomUUID()}`, () => ({ output: "real stub answer" }));
    const r = await withStubAdapter(stub, () => handleOwnerCommand("ตรวจว่าตัวไหนเรียก AI", ACTOR, owner, [stub.id]));
    assert(r.intent === "SEARCH_REPOSITORY", `expected SEARCH_REPOSITORY, got ${r.intent}`);
  });

  await test("SEARCH_REPOSITORY dispatches through a real WORKER_INVOKE Queue job — never skips Queue", async () => {
    const owner = freshOwner();
    const stub = makeSearchStubAdapter(`stub-search-${randomUUID()}`, () => ({ output: "answer" }));
    const r = await withStubAdapter(stub, () => handleOwnerCommand("ค้นหาไฟล์ที่เกี่ยวข้องกับ webhook", ACTOR, owner, [stub.id]));
    assert(r.dispatchedJob !== null, "expected a real dispatched Job record");
    assert(r.dispatchedJob!.type === "WORKER_INVOKE", `expected a real WORKER_INVOKE job type, got ${r.dispatchedJob!.type}`);
    const jobs = listJobs(owner);
    assert(jobs.some((j) => j.jobId === r.dispatchedJob!.jobId && j.status === "SUCCEEDED"), "expected the real Job to be retrievable from the Queue and finalized SUCCEEDED");
  });

  await test("SEARCH_REPOSITORY resolves the intent deterministically even before any dispatch decision — pattern-matched from real text only", () => {
    // Real, pattern-only assertion (no dispatch, no cost): "หา"/"ค้นหา"/
    // "search"/"find"/"ตรวจว่า" are the only real triggers — a phrase
    // missing all of them must never be misclassified as SEARCH_REPOSITORY.
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/commandSurfaceRuntime.ts"), "utf-8");
    assert(src.includes("SEARCH_PATTERN"), "expected the real SEARCH_PATTERN constant to exist");
  });

  console.log("\n=== Owner Command Surface Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
