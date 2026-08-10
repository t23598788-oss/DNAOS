/**
 * Switch-Based Orchestrator Acceptance Suite (owner, 2026-08-09). Proves,
 * against the real, running switchBasedOrchestratorRuntime.ts — never
 * mocked at the module level — every acceptance requirement the Owner
 * specified for the gate pipeline / state machine:
 *
 *  1. Invalid input -> DROP, never enters the Factory, real evidence.
 *  2. Duplicate input -> DROP at DEDUP, reusing the real dedup mechanism.
 *  3. No-evidence input -> DROP at the evidence check.
 *  4. A real unresolved dependency -> BLOCKED, Worker never dispatched
 *     while blocked.
 *  5. A ready, valid, deduped, dependency-clear item -> READY -> real
 *     capability-based Worker selection -> real dispatch attempt ->
 *     honestly reported as blocked/denied (0/6 Departments registered).
 *  6. The Context Slice given to a Worker really is minimal (reuses
 *     contextPlannerRuntime.ts's own real minimality proof).
 *  7. Structural proof: switchBasedOrchestratorRuntime.ts never itself
 *     performs Worker-role computation (Rule 252 boundary).
 *  8. A failing/REPAIR-path item loops without ever reaching the Owner,
 *     UNLESS it matches one of the 5 real escalation_criteria, in which
 *     case it correctly escalates via the real, already-tested Rule 251
 *     channel.
 *  Plus two direct proofs of Owner rules 5/6 (lock contention / real
 *  parallel-independent locking).
 *
 * Run: npm run switch-based-orchestrator:test
 */
import { readFileSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  submitGateInput, attemptDispatch, reportVerificationOutcome, getWorkItem,
  __debugForceRunning, __debugWorkItemCount, __debugReset, OrchestratorError,
} from "../app/api/admin/ide/_lib/switchBasedOrchestratorRuntime";
import { getContextPlan } from "../app/api/admin/ide/_lib/contextPlannerRuntime";
import { __debugQuestionCount, __debugResetManagerQuestionQueue } from "../app/api/admin/ide/_lib/managerQuestionRuntime";

const ROOT = path.join(__dirname, "..");
const RUNTIME_FILE = path.join(ROOT, "app/api/admin/ide/_lib/switchBasedOrchestratorRuntime.ts");
const ACTOR = "switch-based-orchestrator-suite@dnaos.local";

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
function test(name: string, fn: () => void) {
  try { fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }
function freshOwner(label: string): string { return `swbo-owner-${label}-${randomUUID()}`; }

function main() {
  // ============================================================
  // 1. INVALID input -> DROP, never enters the Factory.
  // ============================================================
  test("(1) PASS — invalid input (missing capability) DROPs at VALIDATE, never enters the Factory, real evidence recorded", () => {
    const owner = freshOwner("invalid");
    const before = __debugWorkItemCount(owner);
    const result = submitGateInput({ rawText: "Do something useful for the factory", capability: "", ownerId: owner, actor: ACTOR, inputEvidence: ["registry/CONSTITUTION.json"] });
    assert(result.accepted === false, "expected invalid input to be rejected");
    assert(result.workItem === null, "expected no real work item to be created for invalid input");
    assert(result.drop !== null && result.drop.reason === "INVALID", `expected drop reason INVALID, got ${result.drop?.reason}`);
    assert(result.drop!.stage === "VALIDATE", `expected drop stage VALIDATE, got ${result.drop!.stage}`);
    assert(__debugWorkItemCount(owner) === before, "expected work item count to stay unchanged — invalid input never enters the Factory");
  });

  // ============================================================
  // 3. NO-EVIDENCE input -> DROP at the evidence check.
  // ============================================================
  test("(3) PASS — empty input_evidence[] DROPs as NO_EVIDENCE, never enters the Factory", () => {
    const owner = freshOwner("noev-empty");
    const result = submitGateInput({ rawText: "Improve caching for the QA governance test runner", capability: "governance.test", ownerId: owner, actor: ACTOR, inputEvidence: [] });
    assert(result.accepted === false, "expected no-evidence input to be rejected");
    assert(result.drop?.reason === "NO_EVIDENCE", `expected NO_EVIDENCE, got ${result.drop?.reason}`);
    assert(__debugWorkItemCount(owner) === 0, "expected zero real work items for this owner");
  });

  test("(3) PASS — input_evidence entries that resolve to nothing real (fake path, fake artifactId) DROP as NO_EVIDENCE too — never trusted on their word alone", () => {
    const owner = freshOwner("noev-fake");
    const result = submitGateInput({
      rawText: "Improve caching for the QA governance test runner", capability: "governance.test", ownerId: owner, actor: ACTOR,
      inputEvidence: ["totally/fake/path/that/does/not/exist.ts", "00000000-0000-0000-0000-000000000000"],
    });
    assert(result.accepted === false, "expected fake-evidence input to be rejected");
    assert(result.drop?.reason === "NO_EVIDENCE", `expected NO_EVIDENCE, got ${result.drop?.reason}`);
    assert(result.drop!.detail.includes("NONE resolved to a real file"), `expected the real detail to explain why, got: ${result.drop!.detail}`);
  });

  test("(3) PASS (control) — real, existing repo-relative evidence IS accepted (proves the evidence check discriminates real from fake, not vacuous)", () => {
    const owner = freshOwner("noev-control");
    const result = submitGateInput({ rawText: "Improve caching for the QA governance test runner", capability: "governance.test", ownerId: owner, actor: ACTOR, inputEvidence: ["registry/rule-coverage.json"] });
    assert(result.accepted === true, `expected real evidence to be accepted, got drop: ${JSON.stringify(result.drop)}`);
  });

  // ============================================================
  // 2. DUPLICATE input -> DROP at DEDUP, reusing the real dedup mechanism.
  // ============================================================
  let dupOwner = "";
  let originalTaskId = "";
  test("(2) setup — a real, valid work item is accepted", () => {
    dupOwner = freshOwner("dedup");
    const r = submitGateInput({
      rawText: "Add rate limiting to the connector webhook endpoint for external partner traffic",
      capability: "gateway.connectors.createConnector", ownerId: dupOwner, actor: ACTOR, inputEvidence: ["registry/CONSTITUTION.json"],
    });
    assert(r.accepted === true, `expected the original item to be accepted, got drop: ${JSON.stringify(r.drop)}`);
    originalTaskId = r.workItem!.task_id;
  });

  test("(2) PASS — a differently-worded, same-underlying-request input DROPs at DEDUP, citing the real original task_id, reusing managerQuestionRuntime.ts's real overlap-coefficient formula", () => {
    const r = submitGateInput({
      rawText: "Please add a rate limit to the webhook endpoint used by external partner traffic on the connector",
      capability: "gateway.connectors.createConnector", ownerId: dupOwner, actor: ACTOR, inputEvidence: ["registry/CONSTITUTION.json"],
    });
    assert(r.accepted === false, "expected the reworded duplicate to be rejected");
    assert(r.drop?.reason === "DUPLICATE", `expected DUPLICATE, got ${r.drop?.reason}`);
    assert(r.drop!.stage === "DEDUP", `expected drop stage DEDUP, got ${r.drop!.stage}`);
    assert(r.drop!.duplicateOfTaskId === originalTaskId, `expected duplicateOfTaskId to cite the real original task_id ${originalTaskId}, got ${r.drop!.duplicateOfTaskId}`);
    assert(__debugWorkItemCount(dupOwner) === 1, "expected exactly 1 real work item for this owner — the duplicate never entered the Factory");
  });

  // ============================================================
  // 4. Real unresolved dependency -> BLOCKED; Worker never dispatched
  //    while blocked.
  // ============================================================
  let depOwner = "";
  let upstreamTaskId = "";
  let downstreamTaskId = "";
  test("(4) setup — an upstream item (no dependencies) is accepted READY", () => {
    depOwner = freshOwner("dep");
    const r = submitGateInput({
      rawText: "Draft the initial connector registration script outline", capability: "gateway.connectors.createConnector",
      ownerId: depOwner, actor: ACTOR, inputEvidence: ["registry/CONSTITUTION.json"],
    });
    assert(r.accepted === true, `expected upstream item accepted, got: ${JSON.stringify(r.drop)}`);
    assert(r.workItem!.state === "READY", `expected upstream item state READY (no deps), got ${r.workItem!.state}`);
    upstreamTaskId = r.workItem!.task_id;
  });

  test("(4) PASS — a downstream item depending on the still-not-DONE upstream item is real state=BLOCKED, never READY", () => {
    const r = submitGateInput({
      rawText: "Run the QA regression suite against the newly merged connector changes", capability: "governance.test",
      ownerId: depOwner, actor: ACTOR, inputEvidence: ["registry/rule-coverage.json"], dependencies: [upstreamTaskId],
    });
    assert(r.accepted === true, `expected downstream item accepted (BLOCKED is a real, valid accepted state), got: ${JSON.stringify(r.drop)}`);
    assert(r.workItem!.state === "BLOCKED", `expected downstream item state BLOCKED, got ${r.workItem!.state}`);
    downstreamTaskId = r.workItem!.task_id;
  });

  test("(4) PASS — attemptDispatch() on the BLOCKED item is real, honest NOT_READY — a Worker is never dispatched while blocked", () => {
    const outcome = attemptDispatch(downstreamTaskId, depOwner, ACTOR);
    assert(outcome.outcome === "NOT_READY", `expected NOT_READY for a BLOCKED item, got ${outcome.outcome}`);
    const item = getWorkItem(downstreamTaskId, depOwner);
    assert(item.state === "BLOCKED", `expected state to remain BLOCKED after a refused dispatch attempt, got ${item.state}`);
    assert(item.owner_worker === null, "expected owner_worker to remain unset — no real Worker was ever selected for a blocked item");
  });

  // ============================================================
  // 5. READY item -> real capability-based Worker selection -> real
  //    dispatch attempt -> honestly reported as blocked/denied (0/6
  //    Departments registered) — never faked as dispatched.
  // ============================================================
  let readyOwner = "";
  let readyTaskId = "";
  test("(5) setup — a ready, valid, deduped, dependency-clear item is accepted READY", () => {
    readyOwner = freshOwner("ready");
    const r = submitGateInput({
      rawText: "Run the full governance test suite before merging this branch", capability: "governance.test",
      ownerId: readyOwner, actor: ACTOR, inputEvidence: ["registry/rule-coverage.json"],
      lockScope: ["app/api/admin/ide/_lib/switchBasedOrchestratorRuntime.ts"],
    });
    assert(r.accepted === true, `expected item accepted, got: ${JSON.stringify(r.drop)}`);
    assert(r.workItem!.state === "READY", `expected state READY, got ${r.workItem!.state}`);
    readyTaskId = r.workItem!.task_id;
  });

  test('(5) PASS — real, capability-based Worker selection resolves "governance.test" to real Department Worker-02 (QA) / real WorkerType TOOL_WORKER, via workerRegistry.ts#selectWorker() + registry/WORKER_IDENTITIES.json', () => {
    const identitiesRaw = readFileSync(path.join(ROOT, "registry/WORKER_IDENTITIES.json"), "utf-8");
    const identities = JSON.parse(identitiesRaw) as { registered_count: number; total_slots: number; roster: { worker_id: string; status: string }[] };
    assert(identities.registered_count === 0, `precondition (real, current, honest state): expected registry/WORKER_IDENTITIES.json registered_count=0, got ${identities.registered_count} — if this changed, this specific assertion (not the mechanism) needs updating`);

    const outcome = attemptDispatch(readyTaskId, readyOwner, ACTOR);
    const item = getWorkItem(readyTaskId, readyOwner);
    assert(item.owner_worker === "Worker-02", `expected real capability-based routing to Worker-02 (QA Department), got ${item.owner_worker}`);
    assert(item.workerType === "TOOL_WORKER", `expected real WorkerType TOOL_WORKER, got ${item.workerType}`);
    assert(outcome.outcome === "DISPATCH_DENIED_UNREGISTERED", `expected the dispatch to be HONESTLY reported as DISPATCH_DENIED_UNREGISTERED (0/6 real Departments registered), got ${outcome.outcome} — a dispatch must never be faked as DISPATCHED when the real precondition isn't met`);
    assert(item.dispatchDenialReason !== null && item.dispatchDenialReason.includes("registered_count=0/6"), `expected a real, evidence-citing denial reason, got: ${item.dispatchDenialReason}`);
    assert(item.state === "LOCKED", `expected the item to hold its real lock (state=LOCKED) while denied, not silently drop or fake-advance, got ${item.state}`);
  });

  // ============================================================
  // 6. The Context Slice given to a Worker really is minimal — reuses
  //    contextPlannerRuntime.ts's own real minimality mechanism.
  // ============================================================
  test("(6) PASS — the real Context Slice built for the (5) work item contains ONLY its own declared input_evidence — never dependency-graph-expanded, never the whole repo", () => {
    const item = getWorkItem(readyTaskId, readyOwner);
    assert(item.contextPlanId !== null, "expected a real contextPlanId to have been recorded during ROUTE/WORKER");
    const plan = getContextPlan(item.contextPlanId!, readyOwner);
    assert(plan.includedFiles.length === item.input_evidence.length, `expected exactly ${item.input_evidence.length} included file(s) (== the work item's own input_evidence), got ${plan.includedFiles.length}: ${JSON.stringify(plan.includedFiles.map((f) => f.path))}`);
    for (const f of plan.includedFiles) {
      assert(item.input_evidence.includes(f.path), `expected included file ${f.path} to be one of the work item's own declared input_evidence — never an extra, dependency-graph-expanded file`);
      assert(f.reason.includes("never dependency-graph-expanded"), `expected contextPlannerRuntime.ts's own real, literal reason text, got: ${f.reason}`);
    }
    assert(plan.permittedReadScope.length === item.input_evidence.length, "expected permittedReadScope to be exactly the minimal set, not widened");
  });

  // ============================================================
  // Owner rules 5/6 — one Primary Worker per Capability at a time (lock
  // contention denied); independent, non-overlapping work may lock in
  // parallel.
  // ============================================================
  let lockOwner = "";
  let lockTaskA = "";
  test("(lock) setup — item A acquires a real lock over gateway/connectors.ts", () => {
    lockOwner = freshOwner("lock");
    const r = submitGateInput({ rawText: "Refactor gateway connector timeout handling logic", capability: "gateway.connectors.createConnector", ownerId: lockOwner, actor: ACTOR, inputEvidence: ["registry/CONSTITUTION.json"], lockScope: ["gateway/connectors.ts"] });
    assert(r.accepted === true, `expected item A accepted, got ${JSON.stringify(r.drop)}`);
    lockTaskA = r.workItem!.task_id;
    const outcome = attemptDispatch(lockTaskA, lockOwner, ACTOR);
    assert(outcome.outcome === "DISPATCH_DENIED_UNREGISTERED", `expected A's dispatch to reach the honest denial (proving LOCK really was acquired first), got ${outcome.outcome}`);
    assert(getWorkItem(lockTaskA, lockOwner).state === "LOCKED", "expected item A to real-hold state=LOCKED");
  });

  test("(lock) PASS — item B, declaring the SAME lock_scope while A still holds it, is denied at LOCK (DISPATCH_DENIED_LOCK_CONTENTION) — never two Workers editing the same scope concurrently", () => {
    const r = submitGateInput({ rawText: "Add audit logging to the connector webhook signature verification path", capability: "gateway.connectors.createConnector", ownerId: lockOwner, actor: ACTOR, inputEvidence: ["registry/CONSTITUTION.json"], lockScope: ["gateway/connectors.ts"] });
    assert(r.accepted === true, `expected item B accepted at intake, got ${JSON.stringify(r.drop)}`);
    const outcome = attemptDispatch(r.workItem!.task_id, lockOwner, ACTOR);
    assert(outcome.outcome === "DISPATCH_DENIED_LOCK_CONTENTION", `expected real lock contention denial, got ${outcome.outcome}`);
    assert(getWorkItem(r.workItem!.task_id, lockOwner).state === "READY", "expected item B to remain READY — it must never acquire a lock A already holds");
  });

  test("(lock) PASS — item C, with a genuinely independent (non-overlapping) lock_scope, locks successfully in parallel with A — Owner rule 6", () => {
    const r = submitGateInput({ rawText: "Write unit tests for the QA governance dashboard summary widget", capability: "governance.test", ownerId: lockOwner, actor: ACTOR, inputEvidence: ["registry/rule-coverage.json"], lockScope: ["some/other/independent/file.ts"] });
    assert(r.accepted === true, `expected item C accepted, got ${JSON.stringify(r.drop)}`);
    const outcome = attemptDispatch(r.workItem!.task_id, lockOwner, ACTOR);
    assert(outcome.outcome === "DISPATCH_DENIED_UNREGISTERED", `expected item C to reach the same honest registration denial (proving its LOCK stage succeeded despite A already holding an unrelated lock), got ${outcome.outcome}`);
    assert(getWorkItem(r.workItem!.task_id, lockOwner).state === "LOCKED", "expected item C to really hold its own, independent lock concurrently with A");
  });

  // ============================================================
  // 8. REPAIR loop — never reaches the Owner for a routine technical
  //    failure; escalates ONLY on a real match to one of the 5 real
  //    escalation_criteria (registry/FACTORY_CENTRAL_REGISTRY.json).
  // ============================================================
  test("(8a) PASS — a routine, repeated technical failure loops lock -> repair -> revalidate to REJECTED WITHOUT ever contacting the Owner", () => {
    const owner = freshOwner("repair-no-escalate");
    __debugResetManagerQuestionQueue(owner);
    const r = submitGateInput({ rawText: "Investigate the flaky pagination test in the QA suite", capability: "governance.test", ownerId: owner, actor: ACTOR, inputEvidence: ["registry/rule-coverage.json"], maxAttempts: 2 });
    assert(r.accepted === true, `expected item accepted, got ${JSON.stringify(r.drop)}`);
    const taskId = r.workItem!.task_id;

    // Disclosed, test-only: no real Worker can be dispatched in this
    // environment (0/6 registered, no live ANTHROPIC_API_KEY) — seed
    // RUNNING via the documented debug hook to exercise the real,
    // downstream VERIFY/REPAIR logic in isolation.
    __debugForceRunning(taskId, owner);
    const attempt1 = reportVerificationOutcome({ taskId, ownerId: owner, actor: ACTOR, passed: false, reason: "unit test assertion failed: expected 2 got 3" });
    assert(attempt1.state === "LOCKED", `expected attempt 1/2 to loop back to LOCKED (within retry limit), got ${attempt1.state}`);
    assert(attempt1.escalated === false, "expected attempt 1 to NOT escalate");
    assert(__debugQuestionCount(owner) === 0, "expected ZERO real Manager Questions after attempt 1 — a routine failure within the retry limit never contacts the Owner");

    __debugForceRunning(taskId, owner); // real repair-dispatch would re-reach RUNNING; seeded here for the same disclosed reason
    const attempt2 = reportVerificationOutcome({ taskId, ownerId: owner, actor: ACTOR, passed: false, reason: "unit test assertion failed: expected 2 got 3" });
    assert(attempt2.state === "REJECTED", `expected attempt 2/2 (retry limit exhausted, no escalation-criteria match) to end REJECTED, got ${attempt2.state}`);
    assert(attempt2.escalated === false, "expected NO escalation — a routine technical failure that matches none of the 5 real escalation_criteria must never reach the Owner");
    assert(attempt2.escalationOutcome === null, "expected no real Manager Question to have been created");
    assert(__debugQuestionCount(owner) === 0, "expected ZERO real Manager Questions for this owner across the entire repair loop — the Owner was never contacted");
  });

  test("(8b) PASS — a failure that genuinely matches one of Rule 255's 5 real escalation_criteria DOES correctly escalate, via the real, already-tested Rule 251 Owner Inquiry channel", () => {
    const owner = freshOwner("repair-escalate");
    __debugResetManagerQuestionQueue(owner);
    const criteria = JSON.parse(readFileSync(path.join(ROOT, "registry/FACTORY_CENTRAL_REGISTRY.json"), "utf-8")).escalation_criteria.criteria as string[];
    assert(criteria.includes("retry_limit_exhausted_no_deterministic_repair_path"), "precondition: expected the real, live FACTORY_CENTRAL_REGISTRY.json to name this criterion — reused AS-IS, never invented");

    const r = submitGateInput({ rawText: "Reconcile the schema mismatch found during the nightly migration check", capability: "governance.test", ownerId: owner, actor: ACTOR, inputEvidence: ["registry/rule-coverage.json"], maxAttempts: 1 });
    assert(r.accepted === true, `expected item accepted, got ${JSON.stringify(r.drop)}`);
    const taskId = r.workItem!.task_id;

    __debugForceRunning(taskId, owner); // disclosed test-only seed — see (8a)
    const before = __debugQuestionCount(owner);
    const outcome = reportVerificationOutcome({ taskId, ownerId: owner, actor: ACTOR, passed: false, reason: "retry limit exhausted with no deterministic repair path available for this schema mismatch" });
    assert(outcome.state === "REJECTED", `expected REJECTED after real escalation, got ${outcome.state}`);
    assert(outcome.escalated === true, "expected this genuine match to escalate");
    assert(outcome.escalationCriterion === "retry_limit_exhausted_no_deterministic_repair_path", `expected the real, matched criterion, got ${outcome.escalationCriterion}`);
    assert(outcome.escalationOutcome !== null && typeof outcome.escalationOutcome.questionId === "string" && outcome.escalationOutcome.questionId.length > 0, "expected a real questionId from the real Rule 251 channel");
    assert(__debugQuestionCount(owner) === before + 1, `expected exactly 1 new real Manager Question to have been created via the genuine escalation, count went from ${before} to ${__debugQuestionCount(owner)}`);
  });

  test("(9) PASS — only a real PASSED verification releases a work item forward; a second verification report on an already-PASSED item is a real, honest error, never silently re-processed", () => {
    const owner = freshOwner("passed");
    const r = submitGateInput({ rawText: "Confirm the release notes render correctly on the QA dashboard", capability: "governance.test", ownerId: owner, actor: ACTOR, inputEvidence: ["registry/rule-coverage.json"] });
    const taskId = r.workItem!.task_id;
    __debugForceRunning(taskId, owner);
    const outcome = reportVerificationOutcome({ taskId, ownerId: owner, actor: ACTOR, passed: true, reason: "all real, machine-checked criteria PASSED", outputEvidence: ["real TEST_REPORT artifact reference"] });
    assert(outcome.state === "PASSED", `expected state PASSED, got ${outcome.state}`);
    assert(getWorkItem(taskId, owner).output_evidence.includes("real TEST_REPORT artifact reference"), "expected real output_evidence to be recorded");
    let threw = false;
    try { reportVerificationOutcome({ taskId, ownerId: owner, actor: ACTOR, passed: true, reason: "re-report" }); }
    catch (e) { threw = e instanceof OrchestratorError && e.code === "INVALID_STATE_TRANSITION"; }
    assert(threw, "expected a real OrchestratorError(INVALID_STATE_TRANSITION) when re-reporting on an already-PASSED item");
  });

  // ============================================================
  // 7. Structural proof — switchBasedOrchestratorRuntime.ts never itself
  //    performs Worker-role computation (Rule 252 boundary), same
  //    import-graph-scan technique as Rule 251's own criterion (d).
  // ============================================================
  function importedNames(src: string, moduleSpecifier: string): string[] {
    const out: string[] = [];
    const re = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      if (m[2] !== moduleSpecifier && !m[2].endsWith(`/${moduleSpecifier}`)) continue;
      out.push(...m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, "").trim()).filter(Boolean));
    }
    return out;
  }

  test("(7) PASS — never imports fs's writeFileSync (structurally cannot write arbitrary file content itself)", () => {
    const src = readFileSync(RUNTIME_FILE, "utf-8");
    const fsNames = importedNames(src, "fs");
    assert(!fsNames.includes("writeFileSync"), `expected no writeFileSync import, got fs imports: ${JSON.stringify(fsNames)}`);
    assert(fsNames.includes("readFileSync") && fsNames.includes("existsSync"), `positive control failed — expected real readFileSync/existsSync imports (proves this scan detects real imports, not vacuous), got: ${JSON.stringify(fsNames)}`);
  });

  test("(7) PASS — never imports codeWorkerRuntime's content-generating functions, gitWriteOps, deploymentRuntime, or child_process — same Manager Non-Mutation boundary technique as Constitution Rule 252's own check", () => {
    const src = readFileSync(RUNTIME_FILE, "utf-8");
    for (const mod of ["./codeWorkerRuntime", "./gitWriteOps", "./deploymentRuntime", "child_process"]) {
      const escaped = mod.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
      const re = new RegExp(`from\\s*["']${escaped}["']`);
      assert(!re.test(src), `expected NO import from ${mod} (Worker-role content computation / repo mutation), but the source references it`);
    }
  });

  test("(7) PASS — never imports the two Owner-facing-only functions from managerQuestionRuntime.ts (getOwnerFacingQueue/answerAggregatedQuestion) — same technique as Rule 251's own criterion (d), reused here for the new file", () => {
    const src = readFileSync(RUNTIME_FILE, "utf-8");
    const names = importedNames(src, "./managerQuestionRuntime");
    assert(names.includes("submitWorkerQuestion"), `expected the real, Worker-facing submitWorkerQuestion import, got: ${JSON.stringify(names)}`);
    assert(!names.includes("getOwnerFacingQueue") && !names.includes("answerAggregatedQuestion"), `expected NEITHER Owner-facing function imported, got: ${JSON.stringify(names)}`);
  });

  test("(7) PASS (positive control) — DOES import real, legitimate control-plane functions (buildMinimalContextPlan, selectWorker) — proves the import-scan technique detects real imports, not vacuous", () => {
    const src = readFileSync(RUNTIME_FILE, "utf-8");
    assert(/import\s*\{[^}]*\bbuildMinimalContextPlan\b[^}]*\}\s*from\s*["'][^"']*contextPlannerRuntime["']/.test(src), "expected a real import of buildMinimalContextPlan");
    assert(/import\s*\{[^}]*\bselectWorker\b[^}]*\}\s*from\s*["'][^"']*workerRegistry["']/.test(src), "expected a real import of selectWorker");
  });

  console.log("\n=== Switch-Based Orchestrator Acceptance Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  __debugReset();
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}

main();
