/**
 * Persistent Execution Context Regression Suite (owner, 2026-08-07,
 * /admin/ide Foundation). Verifies: real file-backed persistence
 * (survives a simulated restart), append-only checkpoint history,
 * the real Step Gate, owner-approval separation, and that the real
 * seeded Step 13.7 fact (EXTERNAL_ATTACK_SURFACE_DISCOVERY = PARTIAL)
 * is never silently upgraded.
 *
 * Every test uses an isolated, disposable file path — never the real
 * registry/EXECUTION_CONTEXT.json.
 *
 * Run: npm run execution-context:test
 */
import { readFileSync, rmSync, existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  readExecutionContextFile, getCurrentExecutionContext, writeExecutionContextCheckpoint,
  evaluateStepGate, recordOwnerApproval, listExecutionContextHistory, ExecutionContextError,
} from "../app/api/admin/ide/_lib/executionContextRuntime";

const ROOT = path.join(__dirname, "..");
const TMP_DIR = path.join(ROOT, "scripts", "_execution_context_test_tmp");
function tmpFile(): string { return path.join(TMP_DIR, `ctx-${randomUUID()}.json`); }

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

async function main() {
  await test("Cold start: a non-existent file honestly returns an empty ExecutionContextFile, never fabricated data", () => {
    const f = tmpFile();
    const file = readExecutionContextFile(f);
    assert(file.checkpoints.length === 0, "expected a real, empty checkpoints array for a file that doesn't exist yet");
    assert(getCurrentExecutionContext(f) === null, "expected a real null current context before any checkpoint exists");
  });

  await test("First checkpoint is real, self-consistent, and contextVersion starts at 1", async () => {
    const f = tmpFile();
    const cp = await writeExecutionContextCheckpoint({ current_step: "TEST-A" }, "test@dnaos.local", "owner-test", "first checkpoint", f);
    assert(cp.contextVersion === 1, `expected contextVersion 1, got ${cp.contextVersion}`);
    assert(cp.previousCheckpointId === null, "expected a real null previousCheckpointId for the first checkpoint");
    assert(cp.current_step === "TEST-A", "expected the real patch to be applied");
  });

  await test("Checkpoints are real, append-only: prior entries are never mutated, contextVersion increments monotonically", async () => {
    const f = tmpFile();
    const cp1 = await writeExecutionContextCheckpoint({ current_step: "A" }, "test@dnaos.local", "owner-test", "step A", f);
    const cp2 = await writeExecutionContextCheckpoint({ current_step: "B" }, "test@dnaos.local", "owner-test", "step B", f);
    const file = readExecutionContextFile(f);
    assert(file.checkpoints.length === 2, `expected 2 real checkpoints, got ${file.checkpoints.length}`);
    assert(file.checkpoints[0].checkpointId === cp1.checkpointId && file.checkpoints[0].current_step === "A", "expected the first real checkpoint to remain byte-identical");
    assert(cp2.contextVersion === 2 && cp2.previousCheckpointId === cp1.checkpointId, "expected real, monotonic version chaining");
  });

  await test("Restart survival: a brand-new read (simulating a fresh process) sees the real, persisted checkpoint from disk", async () => {
    const f = tmpFile();
    await writeExecutionContextCheckpoint({ current_step: "RESTART-TEST" }, "test@dnaos.local", "owner-test", "restart test", f);
    // Simulate "restart" by reading the raw file bytes directly, bypassing any in-memory reference.
    const raw = JSON.parse(readFileSync(f, "utf-8"));
    assert(raw.checkpoints.length === 1 && raw.checkpoints[0].current_step === "RESTART-TEST", "expected the real checkpoint to be readable from a fresh, independent file read");
  });

  await test("Live snapshot fields are real, not fabricated: git_head is a real, non-empty hash", async () => {
    const f = tmpFile();
    const cp = await writeExecutionContextCheckpoint({}, "test@dnaos.local", "owner-test", "live snapshot check", f);
    assert(typeof cp.git_head === "string" && cp.git_head!.length === 40, `expected a real 40-char git hash, got ${cp.git_head}`);
    assert(cp.worker_state.length === 7, `expected 7 real registered Worker Adapters, got ${cp.worker_state.length}`);
  });

  await test("Live snapshot fields read the real registry files with the real field names — never silently null from a key-name mismatch", async () => {
    const f = tmpFile();
    const cp = await writeExecutionContextCheckpoint({}, "test@dnaos.local", "owner-test", "field-name check", f);
    assert(typeof cp.architecture_state.totalModules === "number" && cp.architecture_state.totalModules > 0, `expected a real, non-null totalModules, got ${cp.architecture_state.totalModules}`);
    assert(typeof cp.governance_state.totalRules === "number" && cp.governance_state.totalRules > 0, `expected a real, non-null governance totalRules — a null here means the real field name in registry/governance-summary.json doesn't match what this Runtime reads, got ${cp.governance_state.totalRules}`);
    assert(typeof cp.governance_state.enforced === "number", `expected a real, non-null governance enforced count, got ${cp.governance_state.enforced}`);
    assert(typeof cp.governance_state.coveragePercent === "number", `expected a real, non-null governance coveragePercent, got ${cp.governance_state.coveragePercent}`);
  });

  await test("Step Gate: BLOCKED when no checkpoint exists yet", () => {
    const f = tmpFile();
    const result = evaluateStepGate("14", f);
    assert(!result.allowed, "expected a real BLOCKED result before any checkpoint exists");
    assert(result.currentContext === null, "expected a real null currentContext");
  });

  await test("Step Gate: BLOCKED when last_completed_step doesn't match the real prerequisite", async () => {
    const f = tmpFile();
    await writeExecutionContextCheckpoint({ current_step: "13.6", last_completed_step: "13.6", step_status: { "13.6": "DONE_VERIFIED" } }, "test@dnaos.local", "owner-test", "seed", f);
    const result = evaluateStepGate("14", f);
    assert(!result.allowed, "expected BLOCKED — last_completed_step is 13.6, not the real prerequisite 13.7");
    assert(result.reasons.some((r) => r.includes("13.7")), "expected a real reason citing the missing prerequisite Step 13.7");
  });

  await test("Step Gate: BLOCKED by a real BLOCKING blocker even when the step ladder is otherwise satisfied", async () => {
    const f = tmpFile();
    await writeExecutionContextCheckpoint({
      current_step: "13.7", last_completed_step: "13.7", step_status: { "13.7": "DONE_VERIFIED" },
      blockers: [{ id: "B1", severity: "BLOCKING", relatedStep: "14", description: "real test blocker", createdAt: new Date().toISOString() }],
    }, "test@dnaos.local", "owner-test", "seed", f);
    const result = evaluateStepGate("14", f);
    assert(!result.allowed, "expected BLOCKED due to a real BLOCKING-severity blocker");
    assert(result.reasons.some((r) => r.includes("real test blocker")), "expected the real blocker description in reasons");
  });

  await test("Step Gate: BLOCKED without explicit Owner approval, even when every other real condition is satisfied", async () => {
    const f = tmpFile();
    await writeExecutionContextCheckpoint({ current_step: "13.7", last_completed_step: "13.7", step_status: { "13.7": "DONE_VERIFIED" }, blockers: [] }, "test@dnaos.local", "owner-test", "seed", f);
    const result = evaluateStepGate("14", f);
    assert(!result.allowed, "expected BLOCKED — no Step may start without explicit, separate Owner approval");
  });

  await test("Step Gate: ALLOWED only after a real, separate recordOwnerApproval() call", async () => {
    const f = tmpFile();
    await writeExecutionContextCheckpoint({ current_step: "13.7", last_completed_step: "13.7", step_status: { "13.7": "DONE_VERIFIED" }, blockers: [] }, "test@dnaos.local", "owner-test", "seed", f);
    await recordOwnerApproval("14", true, "owner@dnaos.local", "owner-test", f);
    const result = evaluateStepGate("14", f);
    assert(result.allowed, `expected ALLOWED after a real Owner approval, got reasons: ${result.reasons.join("; ")}`);
  });

  await test("recordOwnerApproval throws NO_CONTEXT_YET when no checkpoint exists — never silently creates one", async () => {
    const f = tmpFile();
    let threw = false;
    try { await recordOwnerApproval("14", true, "owner@dnaos.local", "owner-test", f); }
    catch (e) { threw = e instanceof ExecutionContextError && e.code === "NO_CONTEXT_YET"; }
    assert(threw, "expected a real NO_CONTEXT_YET error");
  });

  await test("EXTERNAL_ATTACK_SURFACE_DISCOVERY = PARTIAL is captured honestly in a real checkpoint's capability_state — never silently upgraded to ACTIVE", async () => {
    const f = tmpFile();
    const cp = await writeExecutionContextCheckpoint({}, "test@dnaos.local", "owner-test", "capability snapshot check", f);
    const cap = cp.capability_state.find((c) => c.id === "EXTERNAL_ATTACK_SURFACE_DISCOVERY");
    assert(!!cap, "expected the real capability to appear in the live snapshot");
    assert(cap!.status === "PARTIAL", `expected real PARTIAL, got ${cap!.status}`);
  });

  await test("History listing is real and newest-first, bounded by the real requested limit", async () => {
    const f = tmpFile();
    await writeExecutionContextCheckpoint({ current_step: "1" }, "test@dnaos.local", "owner-test", "a", f);
    await writeExecutionContextCheckpoint({ current_step: "2" }, "test@dnaos.local", "owner-test", "b", f);
    await writeExecutionContextCheckpoint({ current_step: "3" }, "test@dnaos.local", "owner-test", "c", f);
    const history = listExecutionContextHistory(2, f);
    assert(history.length === 2, `expected 2 real entries, got ${history.length}`);
    assert(history[0].current_step === "3", "expected newest-first ordering");
  });

  await test("A corrupt/unreadable file is treated as 'no context yet', never a guessed reconstruction", () => {
    const f = tmpFile();
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, "{not real json", "utf-8");
    const file = readExecutionContextFile(f);
    assert(file.checkpoints.length === 0, "expected a real, honest empty result for corrupt JSON");
  });

  await test("Scope guarantee: this suite never wrote to the real registry/EXECUTION_CONTEXT.json", () => {
    const realFile = path.join(ROOT, "registry", "EXECUTION_CONTEXT.json");
    assert(existsSync(realFile), "expected the real, seeded file to still exist");
    const raw = JSON.parse(readFileSync(realFile, "utf-8")) as { checkpoints: { current_step: unknown }[] };
    assert(raw.checkpoints.every((c) => typeof c.current_step === "string" && !c.current_step.startsWith("TEST") && c.current_step !== "RESTART-TEST" && c.current_step !== "1" && c.current_step !== "2" && c.current_step !== "3"), "expected zero real test pollution in the real seeded file");
  });

  console.log("\n=== Persistent Execution Context Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  rmSync(TMP_DIR, { recursive: true, force: true });
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); rmSync(TMP_DIR, { recursive: true, force: true }); process.exit(1); });
