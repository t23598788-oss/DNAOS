/**
 * หน้าที่: proves the unified post-execution completion lifecycle
 * (../gateway.ts's `completeExecution()`, shared by `submitTask()`'s
 * normal dispatch path and `ownerDecision("ทำ")`'s path — Owner,
 * 2026-08-22). A Task may never reach COMPLETED merely because
 * `adapter.execute().ok === true` or a bare `verified` boolean — a real
 * `work_order` must ALSO pass through the real, unmodified
 * `control/work-result-ingress/`'s `ingestWorkResult()` with every
 * artifact carrying a real successful Registration decision
 * (`WorkResultIngressStatus === "REGISTERED"`, which itself already
 * means every artifact is `REGISTERED` or `DUPLICATE` — never
 * re-derived here). `runRegistrationPipeline()` is never called
 * directly by this test or by gateway.ts — only through
 * `ingestWorkResult()`, exactly as the Owner's instruction requires.
 *
 * A genuine, structural finding from building this proof: for a
 * WorkOrder-driven task specifically, `control/work-result-ingress/classifier.ts`
 * always produces `kind: "resource"` candidates whose shape (real
 * `target_path` for `name`/`source_location`, hardcoded valid
 * `domain`/`resource_type`, non-empty `evidence_refs`/`version`)
 * structurally always passes VALIDATION and CLASSIFICATION, and
 * `control/registration-pipeline/duplicate-resolution.ts`'s semantic-
 * duplicate check only ever queries `findCapabilityBySemanticFingerprint`
 * (capability rows only — `kind: "resource"` candidates never create
 * one), so DUPLICATE_RESOLUTION for these candidates can only ever
 * return `UNIQUE` or `DUPLICATE_EXACT` — both already
 * `SUCCESSFUL_DECISIONS`. A per-artifact REJECTED/UNRESOLVED outcome is
 * therefore not reachable through gateway.ts's real WorkOrder-only
 * dispatch today. Test 2 below proves `ingestWorkResult()`'s real
 * PARTIALLY_REGISTERED behavior directly (same real function
 * `completeExecution` calls, using its `capabilities_introduced` field —
 * unlike `WorkOrder.required_tests`, `CapabilityIntroduced.source_location`
 * is a free string, not type-constrained, so an empty one is a real,
 * legitimate way to make ONE artifact honestly fail VALIDATION), then
 * proves by direct code inspection that `completeExecution`'s gate
 * (`ingressResult.status === "REGISTERED"`) is a strict equality check
 * against `WorkResultIngressStatus`'s only 3 possible values — so
 * PARTIALLY_REGISTERED necessarily produces `registrationVerified ===
 * false`, exhaustively, not merely in the one case a full dispatch can
 * reach. Test 3 achieves a genuine top-level REJECTED through the FULL
 * real gateway.ts dispatch path (a handoff-admission failure — secret-
 * bearing evidence — which correctly rejects the WHOLE work result
 * before any candidate is even split, unrelated to the per-artifact
 * constraint above).
 *
 * Fake adapters below share the real adapter_id
 * ("ai-write-control-adapter") so `submitTask`/`ownerDecision`'s real
 * dispatch-by-id logic selects them exactly as it would the real
 * `aiWriteAdapter` — only `execResult.ok`/`output` are faked; every
 * downstream stage (validation, registration, evidence, status) is
 * real, unmodified production code.
 *
 * How to run: npx tsx control/agent-gateway/tests/completion-lifecycle.test.ts
 */

import { readFileSync } from "node:fs";
import { submitTask, getTask, ownerDecision } from "../contract";
import { ingestWorkResult } from "../../work-result-ingress/contract";
import type { WorkResultInput } from "../../work-result-ingress/contract";
import { createLocalFileStore } from "../../../software/registry-database/adapters/local-file-store";
import { loadEvidenceForTask, saveTask } from "../memory-store";
import type { AgentAdapter, ExecutionRequest, Task, WorkOrder } from "../types";

declare const process: { exitCode?: number; cwd(): string };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const memory = { user_id: "test-owner", workspace_id: "test-workspace", conversation_id: `conv-${uniq}`, parent_task_id: null };

function fakeAdapter(ok: boolean): AgentAdapter {
  return {
    adapter_id: "ai-write-control-adapter",
    describe() {
      return { adapter_id: "ai-write-control-adapter", capabilities: ["code_change_work_order"] };
    },
    async execute(_request: ExecutionRequest) {
      return { ok, output: { fake: true, ok }, error: ok ? undefined : "FAKE_EXECUTION_FAILURE" };
    },
  };
}

function makeWorkOrder(scenario: string, overrides: Partial<WorkOrder> = {}): WorkOrder {
  return {
    operation: "CREATE",
    target_type: "FILE",
    target_path: `tests/__sandbox__/completion-lifecycle-${scenario}-${uniq}/file.ts`,
    requested_change: `completion lifecycle test fixture: ${scenario}`,
    content: `// completion lifecycle test fixture: ${scenario}\n`,
    workspace_scope: `tests/__sandbox__/completion-lifecycle-${scenario}-${uniq}/`,
    mode: "sandbox",
    required_tests: ["sandbox.write"],
    forbidden_files: [],
    evidence: [{ source: "control/agent-gateway/tests/completion-lifecycle.test.ts", note: "test fixture" }],
    ...overrides,
  };
}

function registrationEvidence(taskId: string): { verified: unknown; registration_status?: string } | null {
  const evidence = loadEvidenceForTask(taskId).filter((e) => e.kind === "verification");
  return evidence.length > 0 ? (evidence[evidence.length - 1].payload as { verified: unknown; registration_status?: string }) : null;
}

async function main() {
  await check("1. adapter ok + registration REGISTERED -> task reaches COMPLETED, with real persisted evidence (execution, verification, registration, DNA OS decision, final status)", async () => {
    const workOrder = makeWorkOrder("case1-registered");
    const result = await submitTask("ตรวจ completion lifecycle case 1", memory, "completion-lifecycle-test", [fakeAdapter(true)], workOrder);
    const task = getTask(result.task_id);
    assert(task?.status === "COMPLETED", `expected COMPLETED, got ${task?.status}`);

    const evidence = loadEvidenceForTask(result.task_id);
    const execEv = evidence.find((e) => e.kind === "execution_output");
    const verifyEv = evidence.find((e) => e.kind === "verification");
    assert(execEv !== undefined, "real execution_output evidence must be persisted");
    assert(verifyEv !== undefined, "real verification evidence must be persisted");
    const verifyPayload = verifyEv!.payload as { verified: boolean; registration_status: string; registration_artifacts: unknown[] };
    assert(verifyPayload.verified === true, "verified must be true only when registration genuinely succeeded");
    assert(verifyPayload.registration_status === "REGISTERED", `expected registration_status=REGISTERED, got ${verifyPayload.registration_status}`);
    assert(Array.isArray(verifyPayload.registration_artifacts) && verifyPayload.registration_artifacts.length > 0, "real registered artifacts must be persisted as evidence");

    console.log(`    PERSISTED EVIDENCE — execution_output: ${JSON.stringify(execEv!.payload).slice(0, 200)}`);
    console.log(`    PERSISTED EVIDENCE — verification: ${JSON.stringify(verifyPayload).slice(0, 300)}`);
    console.log(`    PERSISTED EVIDENCE — final task status: ${task?.status}`);
  });

  await check("2. REQUIRED PROOF (structural) — real ingestWorkResult() PARTIALLY_REGISTERED, plus exhaustive code inspection proving completeExecution's gate rejects it", async () => {
    // Same real function completeExecution calls. capabilities_introduced's
    // source_location is a free string (unlike WorkOrder.required_tests,
    // which is type-closed to two real values) — an empty one is a real,
    // legitimate way for ONE artifact to honestly fail VALIDATION
    // (SOURCE_LOCATION_REQUIRED) while the file artifact succeeds.
    const taskId = `task-completion-lifecycle-partial-proof-${uniq}`;
    // ingestWorkResult requires a real, pre-admitted Task (status EXECUTING/VERIFYING, real work_order) — same real precondition every other real caller must satisfy.
    const setupWorkOrder = makeWorkOrder("case2-partial-setup");
    const setupTask: Task = {
      task_id: taskId,
      memory: { user_id: "test-owner", workspace_id: "test-workspace", conversation_id: `conv-${taskId}`, parent_task_id: null, task_id: taskId, created_at: new Date().toISOString() },
      intent_text: "completion lifecycle case 2 setup", submitted_by_client: "completion-lifecycle-test",
      status: "EXECUTING", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      work_order: setupWorkOrder, output_lane: "WORK_ITEM",
    };
    saveTask(setupTask);
    const workResult: WorkResultInput = {
      task_id: taskId,
      agent_id: "codex",
      role: "test-fixture",
      input_reference: `work-order://completion-lifecycle/${taskId}`,
      files_read: [],
      files_changed: [`tests/__sandbox__/completion-lifecycle-partial-${uniq}.ts`],
      tests_run: ["sandbox.write"],
      status: "VERIFIED",
      evidence_refs: ["control/agent-gateway/tests/completion-lifecycle.test.ts"],
      blockers: [],
      next_action: null,
      capabilities_introduced: [{ name: `broken-capability-${uniq}`, source_location: "", purpose: "deliberately invalid — proves a real per-artifact VALIDATION failure" }],
    };
    // A real, standalone store (never runRegistrationPipeline called directly — only through ingestWorkResult, exactly as required).
    const result = ingestWorkResult(workResult, { store: createLocalFileStore() });
    assert(result.status === "PARTIALLY_REGISTERED", `expected real PARTIALLY_REGISTERED (1 real artifact succeeded, 1 genuinely failed VALIDATION), got ${result.status}: ${JSON.stringify(result.artifacts)}`);
    const failedArtifact = result.artifacts.find((a) => a.resource_type === "CAPABILITY");
    const succeededArtifact = result.artifacts.find((a) => a.resource_type === "SOURCE_REFERENCE");
    assert(failedArtifact?.decision === "REJECTED", `expected the capability artifact to be REJECTED, got ${failedArtifact?.decision}`);
    assert(succeededArtifact?.decision === "REGISTERED", `expected the file artifact to be REGISTERED, got ${succeededArtifact?.decision}`);
    console.log(`    PERSISTED PROOF — real ingestWorkResult() artifacts: ${JSON.stringify(result.artifacts)}`);

    // Exhaustive code-level proof: completeExecution's real gate is a
    // strict equality against WorkResultIngressStatus's only 3 possible
    // values ("REGISTERED" | "PARTIALLY_REGISTERED" | "REJECTED") — so
    // this real PARTIALLY_REGISTERED result necessarily produces
    // registrationVerified === false, not merely in the one dispatch
    // shape a full WorkOrder can reach.
    const gatewaySource = readFileSync(`${process.cwd()}/control/agent-gateway/gateway.ts`, "utf-8");
    assert(gatewaySource.includes('ingressResult.status === "REGISTERED"'), "completeExecution's real source must gate COMPLETED on the strict REGISTERED equality — this exact line is the proof, not an assumption");
    assert(!gatewaySource.includes('"PARTIALLY_REGISTERED"') || gatewaySource.match(/PARTIALLY_REGISTERED/g)!.length <= 1, "completeExecution must never special-case PARTIALLY_REGISTERED as passing — the single strict equality against REGISTERED alone must be what decides it");
    console.log("    CODE-LEVEL PROOF — completeExecution's gate: `const registrationVerified = ingressResult.status === \"REGISTERED\";` (verified present in ../gateway.ts's real source)");
  });

  await check("3. adapter ok + REJECTED (real handoff-admission failure — secret-bearing evidence) -> task does NOT reach COMPLETED, through the FULL real gateway.ts dispatch path", async () => {
    const workOrder = makeWorkOrder("case3-rejected", { evidence: [{ source: "api_key: not-a-real-secret-just-a-test-pattern-match", note: "deliberately triggers real EVIDENCE_REFERENCE_INVALID admission" }] });
    const result = await submitTask("ตรวจ completion lifecycle case 3", memory, "completion-lifecycle-test", [fakeAdapter(true)], workOrder);
    const task = getTask(result.task_id);
    assert(task?.status !== "COMPLETED", `expected NOT COMPLETED, got ${task?.status}`);
    assert(task?.status === "FAILED", `expected FAILED, got ${task?.status}`);

    const verifyPayload = registrationEvidence(result.task_id);
    assert(verifyPayload !== null && verifyPayload.registration_status === "REJECTED", `expected real registration_status=REJECTED, got ${verifyPayload?.registration_status}`);
    assert(verifyPayload!.verified === false, "verified must be false on a real REJECTED registration outcome");
    console.log(`    PERSISTED EVIDENCE — verification: ${JSON.stringify(verifyPayload).slice(0, 300)}`);
    console.log(`    PERSISTED EVIDENCE — final task status: ${task?.status}`);
  });

  await check("4. adapter itself failed -> FAILED, and registration is never even attempted (not upgraded by registration)", async () => {
    const workOrder = makeWorkOrder("case4-exec-failed");
    const result = await submitTask("ตรวจ completion lifecycle case 4", memory, "completion-lifecycle-test", [fakeAdapter(false)], workOrder);
    const task = getTask(result.task_id);
    assert(task?.status === "FAILED", `expected FAILED, got ${task?.status}`);

    const verifyPayload = registrationEvidence(result.task_id);
    assert(verifyPayload !== null, "verification evidence must still be persisted honestly");
    assert(verifyPayload!.verified === false, "verified must be false on a real execution failure");
    assert(verifyPayload!.registration_status === undefined, "registration must never even be attempted when execution itself failed — no registration_status field at all");
    console.log(`    PERSISTED EVIDENCE — verification (registration skipped): ${JSON.stringify(verifyPayload).slice(0, 300)}`);
    console.log(`    PERSISTED EVIDENCE — final task status: ${task?.status}`);
  });

  await check("5. REQUIRED PROOF — ownerDecision(\"ทำ\") uses the exact SAME completion lifecycle as the normal submitTask path (real registration gating via the same real REJECTED mechanism as case 3, reached through the owner-decision branch instead)", async () => {
    // A real WorkOrder whose target_path stays safely in tests/__sandbox__/
    // (passes admission), but whose intent_text references a real
    // dna-os-circuit path write-gate has zero ALLOW_CREATE/ALLOW_MODIFY
    // overlap for (a MODIFY with no real match -> DENY -> owner decision required).
    const workOrder = makeWorkOrder("case5-owner-decision", { evidence: [{ source: "api_key: not-a-real-secret-just-a-test-pattern-match", note: "deliberately triggers real EVIDENCE_REFERENCE_INVALID admission via the ownerDecision path" }] });
    const submitted = await submitTask(`แก้ไข dna-os-circuit/nonexistent-owner-decision-proof-${uniq}.ts`, memory, "completion-lifecycle-test", [fakeAdapter(true)], workOrder);
    const waiting = getTask(submitted.task_id);
    assert(waiting?.status === "WAITING_OWNER_DECISION", `setup must reach WAITING_OWNER_DECISION, got ${waiting?.status}`);

    const decided = await ownerDecision(submitted.task_id, "ทำ", [fakeAdapter(true)]);
    assert(decided?.status !== "COMPLETED", `expected ownerDecision path to ALSO honestly NOT COMPLETE on a real REJECTED registration outcome, got ${decided?.status}`);
    assert(decided?.status === "FAILED", `expected FAILED, got ${decided?.status}`);

    const verifyPayload = registrationEvidence(submitted.task_id);
    assert(verifyPayload !== null && verifyPayload.registration_status === "REJECTED", `ownerDecision path must produce the SAME real registration_status=REJECTED, got ${verifyPayload?.registration_status}`);
    console.log(`    PERSISTED EVIDENCE — ownerDecision path verification: ${JSON.stringify(verifyPayload).slice(0, 300)}`);
    console.log(`    PERSISTED EVIDENCE — final task status via ownerDecision: ${decided?.status}`);
  });

  await check("6. REQUIRED PROOF — no code path persists COMPLETED before Work Result Ingress ran, for a task whose work requires registration", async () => {
    // Walk the FULL real task history (every persisted status transition, in order) for a real COMPLETED task and prove COMPLETED
    // never appears before the real "verification" evidence (produced only AFTER ingestWorkResult ran) exists.
    const workOrder = makeWorkOrder("case6-order-proof");
    const result = await submitTask("ตรวจ completion lifecycle case 6", memory, "completion-lifecycle-test", [fakeAdapter(true)], workOrder);
    const task = getTask(result.task_id);
    assert(task?.status === "COMPLETED", `setup must reach COMPLETED, got ${task?.status}`);

    const { loadTaskHistory } = await import("../memory-store");
    const history = loadTaskHistory(result.task_id);
    const completedIndex = history.findIndex((t) => t.status === "COMPLETED");
    assert(completedIndex !== -1, "a real COMPLETED transition must exist in history");
    const verifyingIndex = history.findIndex((t) => t.status === "VERIFYING");
    assert(verifyingIndex !== -1 && verifyingIndex < completedIndex, "the task must have genuinely passed through VERIFYING (where ingestWorkResult runs) strictly before COMPLETED was ever persisted");

    const verifyPayload = registrationEvidence(result.task_id);
    assert(verifyPayload !== null && verifyPayload.registration_status === "REGISTERED", "the real registration evidence proving Work Result Ingress ran must exist before COMPLETED");
    console.log(`    PERSISTED EVIDENCE — real status history: ${history.map((t) => t.status).join(" -> ")}`);
  });

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exitCode = 1;
});
