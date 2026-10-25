/**
 * EXECUTION_HAND Acceptance Suite (owner, 2026-08-09, Constitution Rule 258
 * — real build for TASK-049). Proves, against the real, running
 * executionHandRuntime.ts (+ its real, reused costGateRuntime.ts /
 * managerQuestionRuntime.ts / fsOps.ts / fileWrite.ts / executionRegistry.ts
 * composition) — never mocked at the module level — every acceptance
 * requirement named for this task:
 *
 *  1. A Job Contract missing one of the 10 required fields -> real
 *     BLOCKED, citing the missing field(s) by name.
 *  2. A valid contract naming CREATE_FILE inside its own allowed_paths ->
 *     real EXECUTED, the real file really exists afterward with real
 *     evidence captured.
 *  3. A contract attempting a path in forbidden_paths (or simply outside
 *     allowed_paths) -> refused, never attempted, real evidence.
 *  4. A RUN_COMMAND/INSTALL_PACKAGE/BUILD contract -> real Cost Gate check
 *     happens first; a LOCK outcome (no budget configured) stops
 *     execution before anything runs.
 *  5. Lock acquired at start, released at end, STANDBY restored in
 *     workers/execution-hand/STATUS.json afterward — real, captured
 *     before/after content.
 *  6. All five structural/negative proofs from TASK-049, each with a
 *     positive control proving the scan methodology is real.
 *  7. A deliberately-failing operation -> real FAILED, never silently
 *     EXECUTED.
 *
 * Run: npm run execution-hand:test
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, rmSync, readdirSync, statSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  executeJobContract, runExecutionHandJobFromInbox, readExecutionHandStatusMirror,
  __debugClearOutboxAndEvidence,
  type ExecutionHandOperation, type ExecutionHandResult,
} from "../app/api/admin/ide/_lib/executionHandRuntime";
import { WORKSPACE_ROOT } from "../app/api/admin/ide/_lib/fsSecurity";
import { getOwnerFacingQueue, __debugResetManagerQuestionQueue } from "../app/api/admin/ide/_lib/managerQuestionRuntime";

const ROOT = WORKSPACE_ROOT;
const OWNER = `execution-hand-test-owner-${randomUUID()}`;
const ACTOR = "execution-hand-test-suite@dnaos.local";
const SANDBOX_REL = "registry/execution-hand-sandbox";
const SANDBOX_ABS = path.join(ROOT, SANDBOX_REL);

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }
function readSource(relFromRoot: string): string { return readFileSync(path.join(ROOT, relFromRoot), "utf-8"); }

/** Strips /* * / block comments and // line comments before a structural
 * scan runs — so a real, honest doc comment explaining what
 * executionHandRuntime.ts deliberately does NOT do (e.g. "never imports
 * getOwnerFacingQueue") is never itself mistaken for a real reference.
 * Mirrors manager-question-queue-test.ts's own precision goal
 * (distinguishing a real import from mere documentation prose) but
 * applied as a blunt, general pre-pass here since several checks below
 * scan for bare identifiers/literals rather than only import statements. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function baseContract(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    task_id: `eh-test-${randomUUID()}`,
    operation: "CREATE_FILE",
    scope: `eh-test-scope-${randomUUID()}`,
    allowed_paths: [], forbidden_paths: [], tools_allowed: ["CREATE_FILE"], dependencies: [],
    expected_output: "a real, disposable test artifact", acceptance_criteria: [], max_attempts: 1,
    ...overrides,
  };
}

// Every real .status value this suite ever observes across every real
// executeJobContract() call this run — powers Structural (e)(iii) below.
const observedStatuses = new Set<string>();
async function runContract(raw: unknown, options: { ownerId: string; actor?: string }): Promise<ExecutionHandResult> {
  const result = await executeJobContract(raw, options);
  observedStatuses.add(result.status);
  return result;
}

const createdFiles: string[] = [];
const createdDirs: string[] = [];

async function main() {
  mkdirSync(SANDBOX_ABS, { recursive: true });

  // ============================================================
  // Acceptance 1 — missing required field(s) -> real BLOCKED
  // ============================================================
  await test("Acceptance 1a — a Job Contract missing two required fields -> real BLOCKED, citing both missing fields by name", async () => {
    const raw = baseContract();
    delete (raw as Record<string, unknown>).forbidden_paths;
    delete (raw as Record<string, unknown>).max_attempts;
    const result = await runContract(raw, { ownerId: OWNER, actor: ACTOR });
    assert(result.status === "BLOCKED", `expected BLOCKED, got ${result.status}: ${result.reason}`);
    assert(result.missingFields.includes("forbidden_paths"), `expected missingFields to include forbidden_paths, got ${JSON.stringify(result.missingFields)}`);
    assert(result.missingFields.includes("max_attempts"), `expected missingFields to include max_attempts, got ${JSON.stringify(result.missingFields)}`);
    assert(result.reason.includes("forbidden_paths") && result.reason.includes("max_attempts"), "expected the real reason text to cite both missing fields by name");
    assert(result.evidence.length === 0, "expected zero evidence — a BLOCKED-on-shape job never even attempts a lock or an operation");
  });

  await test("Acceptance 1b — each of the 10 required fields, individually removed, is individually detected as missing (never inferred/guessed)", async () => {
    const fields = ["task_id", "operation", "scope", "allowed_paths", "forbidden_paths", "tools_allowed", "dependencies", "expected_output", "acceptance_criteria", "max_attempts"];
    for (const f of fields) {
      const raw = baseContract();
      delete (raw as Record<string, unknown>)[f];
      const result = await runContract(raw, { ownerId: OWNER, actor: ACTOR });
      assert(result.status === "BLOCKED", `removing "${f}" — expected BLOCKED, got ${result.status}`);
      assert(result.missingFields.includes(f), `removing "${f}" — expected missingFields to include it, got ${JSON.stringify(result.missingFields)}`);
    }
  });

  await test("Acceptance 1c — a totally shapeless input (null) -> real BLOCKED citing all 10 required fields", async () => {
    const result = await runContract(null, { ownerId: OWNER, actor: ACTOR });
    assert(result.status === "BLOCKED", `expected BLOCKED, got ${result.status}`);
    assert(result.missingFields.length === 10, `expected all 10 fields cited, got ${JSON.stringify(result.missingFields)}`);
  });

  // ============================================================
  // Acceptance 2 — valid CREATE_FILE inside allowed_paths -> real EXECUTED
  // ============================================================
  await test("Acceptance 2 — a valid Job Contract naming CREATE_FILE inside its own allowed_paths -> real EXECUTED, the real file really exists afterward with real evidence captured", async () => {
    const targetRel = `${SANDBOX_REL}/create-${randomUUID()}.txt`;
    createdFiles.push(targetRel);
    const raw = baseContract({
      operation: "CREATE_FILE", allowed_paths: [targetRel], tools_allowed: ["CREATE_FILE"],
      target_path: targetRel, content: "real EXECUTION_HAND acceptance content",
      acceptance_criteria: [`FILE_EXISTS::${targetRel}`, `FILE_CONTAINS::${targetRel}::real EXECUTION_HAND`],
    });
    const result = await runContract(raw, { ownerId: OWNER, actor: ACTOR });
    assert(result.status === "EXECUTED", `expected EXECUTED, got ${result.status}: ${result.reason}`);
    assert(existsSync(path.join(ROOT, targetRel)), "expected the real file to really exist on disk afterward");
    const onDisk = readFileSync(path.join(ROOT, targetRel), "utf-8");
    assert(onDisk === "real EXECUTION_HAND acceptance content", `expected real on-disk content to match, got: ${onDisk}`);
    assert(result.evidence.some((e) => e.kind === "FILE_DIFF" && e.path === targetRel && e.after === "real EXECUTION_HAND acceptance content"), "expected a real FILE_DIFF evidence item for this create");
    assert(result.evidence.some((e) => e.kind === "ACCEPTANCE_CHECK" && e.detail.includes("met") && !e.detail.includes("NOT MET")), "expected real ACCEPTANCE_CHECK evidence showing the criteria were met");
    assert(result.lockAcquired && result.lockReleased, "expected the real scope lock to have been acquired and released");
  });

  // ============================================================
  // Acceptance 3 — forbidden_paths / outside allowed_paths -> refused,
  // never attempted, real evidence.
  // ============================================================
  await test("Acceptance 3a — a contract targeting a path OUTSIDE allowed_paths is refused, never attempted, with real evidence of the refusal", async () => {
    const targetRel = `${SANDBOX_REL}/outside-${randomUUID()}.txt`;
    const raw = baseContract({
      operation: "CREATE_FILE", allowed_paths: ["some/other/unrelated/path.txt"], tools_allowed: ["CREATE_FILE"],
      target_path: targetRel, content: "should never be written",
    });
    const result = await runContract(raw, { ownerId: OWNER, actor: ACTOR });
    assert(result.status === "BLOCKED", `expected BLOCKED, got ${result.status}: ${result.reason}`);
    assert(!existsSync(path.join(ROOT, targetRel)), "expected the real file to NEVER have been created");
    assert(result.evidence.some((e) => e.kind === "REFUSAL" && e.detail.includes("outside allowed_paths")), "expected a real REFUSAL evidence item citing allowed_paths");
  });

  await test("Acceptance 3b — a contract targeting a path listed in forbidden_paths is refused, never attempted, even though allowed_paths nominally covers its parent", async () => {
    const targetRel = `${SANDBOX_REL}/forbidden-${randomUUID()}.txt`;
    const raw = baseContract({
      operation: "CREATE_FILE", allowed_paths: [SANDBOX_REL], forbidden_paths: [targetRel], tools_allowed: ["CREATE_FILE"],
      target_path: targetRel, content: "should never be written",
    });
    const result = await runContract(raw, { ownerId: OWNER, actor: ACTOR });
    assert(result.status === "BLOCKED", `expected BLOCKED, got ${result.status}: ${result.reason}`);
    assert(!existsSync(path.join(ROOT, targetRel)), "expected the real file to NEVER have been created");
    assert(result.evidence.some((e) => e.kind === "REFUSAL" && e.detail.includes("forbidden_paths")), "expected a real REFUSAL evidence item citing forbidden_paths");
  });

  // ============================================================
  // Acceptance 4 — RUN_COMMAND/INSTALL_PACKAGE/BUILD -> real Cost Gate
  // check first; a LOCK outcome (no budget configured) stops execution.
  // ============================================================
  await test("Acceptance 4a — RUN_COMMAND with no pre-approved budget -> real Cost Gate LOCK stops execution before any command runs; real BLOCKED, and the LOCK really escalates into the Owner-facing queue tagged financial approval", async () => {
    const raw = baseContract({
      operation: "RUN_COMMAND", allowed_paths: [], tools_allowed: ["echo"],
      command: "echo", args: ["this-should-never-actually-run"],
    });
    const result = await runContract(raw, { ownerId: OWNER, actor: ACTOR });
    assert(result.status === "BLOCKED", `expected BLOCKED (Cost Gate LOCK), got ${result.status}: ${result.reason}`);
    assert(result.costGateOutcome === "LOCK", `expected costGateOutcome LOCK, got ${result.costGateOutcome}`);
    assert(!result.evidence.some((e) => e.kind === "COMMAND_RESULT"), "expected ZERO real COMMAND_RESULT evidence — the command must never actually run when the Cost Gate LOCKs");
    const queue = getOwnerFacingQueue(OWNER);
    assert(queue.some((q) => q.canonicalQuestionText.toLowerCase().includes("financial approval")), "expected the real Cost Gate LOCK to really escalate into the Owner-facing queue, tagged financial approval");
  });

  for (const op of ["INSTALL_PACKAGE", "BUILD"] as ExecutionHandOperation[]) {
    await test(`Acceptance 4b/4c — ${op} with no pre-approved budget -> real Cost Gate LOCK stops execution before anything runs, real BLOCKED returned`, async () => {
      const raw = baseContract({ operation: op, allowed_paths: [], tools_allowed: [] });
      const result = await runContract(raw, { ownerId: OWNER, actor: ACTOR });
      assert(result.status === "BLOCKED", `expected BLOCKED for ${op}, got ${result.status}: ${result.reason}`);
      assert(result.costGateOutcome === "LOCK", `expected costGateOutcome LOCK for ${op}, got ${result.costGateOutcome}`);
      assert(!result.evidence.some((e) => e.kind === "COMMAND_RESULT"), `expected ZERO real COMMAND_RESULT evidence for ${op} — must never actually run when the Cost Gate LOCKs`);
    });
  }

  // ============================================================
  // Acceptance (Rule 257 AMENDMENT, owner, 2026-08-09, FCR-011/TASK-050)
  // — the real incident this fixes: TASK-044/DNA-000109 ran 5 real
  // RUN_COMMAND Job Contracts for genuinely free, local scripts through
  // this exact runtime; all 5 real-LOCKed because the Cost Gate had no
  // way to know a command is provably free. Proves the real, end-to-end
  // fix: a real Job Contract naming a closed-allowlist FREE_LOCAL command
  // now RELEASEs with NO pre-approved budget configured, and the command
  // really executes (never just a gate-level unit test in isolation).
  // ============================================================
  await test("Acceptance (Rule 257 AMENDMENT) — RUN_COMMAND with command \"git status\" (closed FREE_LOCAL allowlist) -> real Cost Gate RELEASE with NO pre-approved budget, and the command really executes -> real EXECUTED with real COMMAND_RESULT evidence", async () => {
    const raw = baseContract({
      operation: "RUN_COMMAND", allowed_paths: [], tools_allowed: ["git"],
      command: "git", args: ["status"],
    });
    const result = await runContract(raw, { ownerId: OWNER, actor: ACTOR });
    assert(result.costGateOutcome === "RELEASE", `expected costGateOutcome RELEASE (real FREE_LOCAL fast path, no budget needed), got ${result.costGateOutcome}: ${result.reason}`);
    assert(result.status === "EXECUTED", `expected EXECUTED, got ${result.status}: ${result.reason}`);
    assert(result.evidence.some((e) => e.kind === "COMMAND_RESULT" && e.exitCode === 0), "expected real COMMAND_RESULT evidence showing the command actually ran and exited 0");
    assert(result.evidence.some((e) => e.kind === "REFUSAL" && e.detail.includes("FREE_LOCAL")), "expected the real Cost Gate decision evidence to cite FREE_LOCAL");
  });

  // Real, disclosed finding: RUN_TEST is named in Rule 257 AMENDMENT's own
  // text as part of "the RUN_COMMAND/RUN_TEST/BUILD operation surface",
  // but executionHandRuntime.ts's own, pre-existing COST_GATED_OPERATIONS
  // set (established by Rule 258/TASK-049, before this task) only gates
  // RUN_COMMAND/INSTALL_PACKAGE/BUILD — RUN_TEST is not Cost-Gated at all
  // today (costGateOutcome stays null for it, confirmed live while
  // writing this suite). Deliberately NOT changed by this task: adding
  // RUN_TEST to that set would newly gate every existing RUN_TEST Job
  // Contract (including Acceptance 7a/7b's own "node -e ..." commands,
  // which are not on the FREE_LOCAL allowlist), breaking this exact
  // required-to-stay-unchanged suite. Using RUN_COMMAND here instead,
  // which IS really gated.
  await test("Acceptance (Rule 257 AMENDMENT) — RUN_COMMAND with command \"grep\" against a real, existing file (closed FREE_LOCAL allowlist, arbitrary args) -> real Cost Gate RELEASE with NO pre-approved budget, real EXECUTED with real stdout evidence", async () => {
    const raw = baseContract({
      operation: "RUN_COMMAND", allowed_paths: [], tools_allowed: ["grep"],
      command: "grep", args: ["-c", "EXECUTION_HAND", "workers/execution-hand/CONTRACT.md"],
    });
    const result = await runContract(raw, { ownerId: OWNER, actor: ACTOR });
    assert(result.costGateOutcome === "RELEASE", `expected costGateOutcome RELEASE, got ${result.costGateOutcome}: ${result.reason}`);
    assert(result.status === "EXECUTED", `expected EXECUTED, got ${result.status}: ${result.reason}`);
    assert(result.evidence.some((e) => e.kind === "COMMAND_RESULT" && e.exitCode === 0 && (e.stdout ?? "").trim().length > 0), "expected real, non-empty stdout evidence from a real grep match");
  });

  await test("Acceptance (Rule 257 AMENDMENT) no-wildcard proof, real end-to-end — RUN_COMMAND with command \"git\", args [\"status\",\"--short\"] (an extra arg vs. the exact-match allowlist entry) is NOT FREE_LOCAL -> real Cost Gate LOCK, same as before this amendment, command never actually runs", async () => {
    const raw = baseContract({
      operation: "RUN_COMMAND", allowed_paths: [], tools_allowed: ["git"],
      command: "git", args: ["status", "--short"],
    });
    const result = await runContract(raw, { ownerId: OWNER, actor: ACTOR });
    assert(result.status === "BLOCKED", `expected BLOCKED (Cost Gate LOCK), got ${result.status}: ${result.reason}`);
    assert(result.costGateOutcome === "LOCK", `expected costGateOutcome LOCK — an extra arg must never widen the exact-match FREE_LOCAL allowlist, got ${result.costGateOutcome}`);
    assert(!result.evidence.some((e) => e.kind === "COMMAND_RESULT"), "expected ZERO real COMMAND_RESULT evidence — the command must never actually run when the Cost Gate LOCKs");
  });

  // ============================================================
  // Acceptance 5 — lock lifecycle + STANDBY mirror, real before/after.
  // ============================================================
  await test("Acceptance 5 — scope lock acquired at start and released at end; STANDBY mirrored into STATUS.json with real captured before/after content", async () => {
    const before = readExecutionHandStatusMirror();
    const targetRel = `${SANDBOX_REL}/lock-lifecycle-${randomUUID()}.txt`;
    createdFiles.push(targetRel);
    const inboxFileName = `eh-test-inbox-${randomUUID()}.json`;
    const contractPayload = baseContract({
      operation: "CREATE_FILE", allowed_paths: [targetRel], tools_allowed: ["CREATE_FILE"],
      target_path: targetRel, content: "lock lifecycle probe",
    });
    writeFileSync(path.join(ROOT, "workers/execution-hand/INBOX", inboxFileName), `${JSON.stringify(contractPayload, null, 2)}\n`, "utf-8");

    const result = await runExecutionHandJobFromInbox(inboxFileName, { ownerId: OWNER, actor: ACTOR });
    observedStatuses.add(result.status);
    const after = readExecutionHandStatusMirror();

    assert(result.status === "EXECUTED", `expected EXECUTED, got ${result.status}: ${result.reason}`);
    assert(result.lockAcquired === true && result.lockReleased === true, "expected real lock acquired+released");
    assert(after.status === "STANDBY", `expected STATUS.json status STANDBY afterward, got ${after.status}`);
    assert(before.status !== after.status || before.note !== after.note, "expected STATUS.json to have really changed (proves this is a real write, not a no-op)");

    const lockFile = JSON.parse(readFileSync(path.join(ROOT, "registry/LOCK_MANAGER.json"), "utf-8")) as { locks: { file: string }[] };
    assert(!lockFile.locks.some((l) => l.file === contractPayload.scope), "expected zero residual lock entries for this job's scope after completion");

    assert(!existsSync(path.join(ROOT, "workers/execution-hand/WORK", inboxFileName)), "expected WORK/ to have really been cleared after the job completed");

    // Real cleanup of this sub-test's own INBOX/OUTBOX/EVIDENCE artifacts.
    unlinkSync(path.join(ROOT, "workers/execution-hand/INBOX", inboxFileName));
    const outboxFiles = readdirSync(path.join(ROOT, "workers/execution-hand/OUTBOX")).filter((f) => f.includes((contractPayload.task_id as string).replace(/[^a-zA-Z0-9_.-]/g, "_")));
    const evidenceFiles = readdirSync(path.join(ROOT, "workers/execution-hand/EVIDENCE")).filter((f) => f.includes((contractPayload.task_id as string).replace(/[^a-zA-Z0-9_.-]/g, "_")));
    __debugClearOutboxAndEvidence({ outbox: outboxFiles, evidence: evidenceFiles });

    console.log(`  [captured] STATUS.json BEFORE: ${JSON.stringify(before)}`);
    console.log(`  [captured] STATUS.json AFTER:  ${JSON.stringify(after)}`);
  });

  // ============================================================
  // Acceptance 7 — deliberately-failing operations -> real FAILED, never
  // silently EXECUTED.
  // ============================================================
  await test("Acceptance 7a — a deliberately-failing RUN_TEST command (real non-zero exit) -> real FAILED, never silently EXECUTED", async () => {
    const raw = baseContract({
      operation: "RUN_TEST", allowed_paths: [], tools_allowed: ["node"],
      command: "node", args: ["-e", "process.exit(7)"],
    });
    const result = await runContract(raw, { ownerId: OWNER, actor: ACTOR });
    assert(result.status === "FAILED", `expected FAILED, got ${result.status}: ${result.reason}`);
    assert(result.evidence.some((e) => e.kind === "COMMAND_RESULT" && e.exitCode === 7), "expected real evidence capturing the real exit code 7");
  });

  await test("Acceptance 7b — RUN_TEST successfully exiting 0 -> real EXECUTED with real stdout/exitCode evidence captured (proves the EXECUTED path is real, not just the FAILED path)", async () => {
    const raw = baseContract({
      operation: "RUN_TEST", allowed_paths: [], tools_allowed: ["node"],
      command: "node", args: ["-e", "console.log('execution-hand-real-run-test-probe')"],
    });
    const result = await runContract(raw, { ownerId: OWNER, actor: ACTOR });
    assert(result.status === "EXECUTED", `expected EXECUTED, got ${result.status}: ${result.reason}`);
    assert(result.evidence.some((e) => e.kind === "COMMAND_RESULT" && e.exitCode === 0 && (e.stdout ?? "").includes("execution-hand-real-run-test-probe")), "expected real captured stdout+exitCode 0 evidence");
  });

  await test("Acceptance 7c — a deliberately-unmet, machine-checkable acceptance criterion after an otherwise-successful CREATE_FILE -> real FAILED, never EXECUTED", async () => {
    const targetRel = `${SANDBOX_REL}/unmet-${randomUUID()}.txt`;
    createdFiles.push(targetRel);
    const raw = baseContract({
      operation: "CREATE_FILE", allowed_paths: [targetRel], tools_allowed: ["CREATE_FILE"],
      target_path: targetRel, content: "actual content",
      acceptance_criteria: [`FILE_CONTAINS::${targetRel}::this substring will never be there`],
    });
    const result = await runContract(raw, { ownerId: OWNER, actor: ACTOR });
    assert(result.status === "FAILED", `expected FAILED, got ${result.status}: ${result.reason}`);
    assert(existsSync(path.join(ROOT, targetRel)), "expected the real file to still have been created (the fs operation itself succeeded — only the acceptance criterion failed)");
    assert(result.evidence.some((e) => e.kind === "ACCEPTANCE_CHECK" && e.detail.includes("NOT MET")), "expected a real ACCEPTANCE_CHECK evidence item showing the unmet criterion");
  });

  await test("Acceptance — a contract whose tools_allowed does NOT include the concrete executable is refused (BLOCKED) before spawning anything", async () => {
    const raw = baseContract({
      operation: "RUN_TEST", allowed_paths: [], tools_allowed: ["some-other-tool"],
      command: "node", args: ["-e", "process.exit(0)"],
    });
    const result = await runContract(raw, { ownerId: OWNER, actor: ACTOR });
    assert(result.status === "BLOCKED", `expected BLOCKED, got ${result.status}`);
    assert(!result.evidence.some((e) => e.kind === "COMMAND_RESULT"), "expected zero real COMMAND_RESULT evidence — never spawned");
  });

  await test("Acceptance — a contract naming a Command-Policy-denylisted executable (e.g. \"rm\") is refused (BLOCKED) — real defense-in-depth reuse of executionRegistry.ts#isCommandDenied", async () => {
    const raw = baseContract({
      operation: "RUN_TEST", allowed_paths: [], tools_allowed: ["rm"],
      command: "rm", args: ["-rf", "/tmp/should-never-run"],
    });
    const result = await runContract(raw, { ownerId: OWNER, actor: ACTOR });
    assert(result.status === "BLOCKED", `expected BLOCKED, got ${result.status}`);
    assert(result.reason.toLowerCase().includes("denylist"), `expected the real refusal reason to cite the Command Policy denylist, got: ${result.reason}`);
  });

  // ============================================================
  // Operations coverage (real exercise of the remaining fs operations).
  // ============================================================
  await test("Operations coverage — EDIT_FILE really edits real, pre-existing content, capturing real before/after evidence", async () => {
    const targetRel = `${SANDBOX_REL}/edit-${randomUUID()}.txt`;
    writeFileSync(path.join(ROOT, targetRel), "original content", "utf-8");
    createdFiles.push(targetRel);
    const raw = baseContract({ operation: "EDIT_FILE", allowed_paths: [targetRel], tools_allowed: ["EDIT_FILE"], target_path: targetRel, content: "edited content" });
    const result = await runContract(raw, { ownerId: OWNER, actor: ACTOR });
    assert(result.status === "EXECUTED", `expected EXECUTED, got ${result.status}: ${result.reason}`);
    assert(readFileSync(path.join(ROOT, targetRel), "utf-8") === "edited content", "expected real on-disk content to reflect the edit");
    assert(result.evidence.some((e) => e.kind === "FILE_DIFF" && e.before === "original content" && e.after === "edited content"), "expected real before/after evidence");
  });

  await test("Operations coverage — CREATE_FOLDER really creates a real directory", async () => {
    const targetRel = `${SANDBOX_REL}/folder-${randomUUID()}`;
    createdDirs.push(targetRel);
    const raw = baseContract({ operation: "CREATE_FOLDER", allowed_paths: [targetRel], tools_allowed: ["CREATE_FOLDER"], target_path: targetRel });
    const result = await runContract(raw, { ownerId: OWNER, actor: ACTOR });
    assert(result.status === "EXECUTED", `expected EXECUTED, got ${result.status}: ${result.reason}`);
    assert(statSync(path.join(ROOT, targetRel)).isDirectory(), "expected a real directory to exist afterward");
  });

  await test("Operations coverage — MOVE_FILE really moves a real file from source to destination", async () => {
    const srcRel = `${SANDBOX_REL}/move-src-${randomUUID()}.txt`;
    const destRel = `${SANDBOX_REL}/move-dest-${randomUUID()}.txt`;
    writeFileSync(path.join(ROOT, srcRel), "move me", "utf-8");
    createdFiles.push(destRel);
    const raw = baseContract({ operation: "MOVE_FILE", allowed_paths: [srcRel, destRel], tools_allowed: ["MOVE_FILE"], target_path: srcRel, destination_path: destRel });
    const result = await runContract(raw, { ownerId: OWNER, actor: ACTOR });
    assert(result.status === "EXECUTED", `expected EXECUTED, got ${result.status}: ${result.reason}`);
    assert(!existsSync(path.join(ROOT, srcRel)) && existsSync(path.join(ROOT, destRel)), "expected the real file to have really moved");
  });

  await test("Operations coverage — UPDATE_IMPORT really replaces a real string in a real file, refuses when old_import is absent", async () => {
    const targetRel = `${SANDBOX_REL}/import-${randomUUID()}.ts`;
    writeFileSync(path.join(ROOT, targetRel), 'import { old } from "old-module";', "utf-8");
    createdFiles.push(targetRel);
    const raw = baseContract({ operation: "UPDATE_IMPORT", allowed_paths: [targetRel], tools_allowed: ["UPDATE_IMPORT"], target_path: targetRel, old_import: '"old-module"', new_import: '"new-module"' });
    const result = await runContract(raw, { ownerId: OWNER, actor: ACTOR });
    assert(result.status === "EXECUTED", `expected EXECUTED, got ${result.status}: ${result.reason}`);
    assert(readFileSync(path.join(ROOT, targetRel), "utf-8").includes('"new-module"'), "expected the real import string to have been replaced");

    const raw2 = baseContract({ operation: "UPDATE_IMPORT", allowed_paths: [targetRel], tools_allowed: ["UPDATE_IMPORT"], target_path: targetRel, old_import: '"a-string-that-is-not-in-the-file"', new_import: '"x"' });
    const result2 = await runContract(raw2, { ownerId: OWNER, actor: ACTOR });
    assert(result2.status === "FAILED", `expected FAILED when old_import is not found, got ${result2.status}`);
  });

  await test("Operations coverage — GENERATE_ARTIFACT really writes a real evidence-style file", async () => {
    const targetRel = `${SANDBOX_REL}/artifact-${randomUUID()}.json`;
    createdFiles.push(targetRel);
    const raw = baseContract({ operation: "GENERATE_ARTIFACT", allowed_paths: [targetRel], tools_allowed: ["GENERATE_ARTIFACT"], target_path: targetRel, content: JSON.stringify({ ok: true }) });
    const result = await runContract(raw, { ownerId: OWNER, actor: ACTOR });
    assert(result.status === "EXECUTED", `expected EXECUTED, got ${result.status}: ${result.reason}`);
    assert(existsSync(path.join(ROOT, targetRel)), "expected the real artifact file to exist afterward");
  });

  // ============================================================
  // Structural / negative-guarantee proofs (Rule 258's 5 hard
  // restrictions), each with a positive control.
  // ============================================================
  await test("Structural (a) — executionHandRuntime.ts never imports managerQuestionRuntime.ts's Owner-facing functions (getOwnerFacingQueue/answerAggregatedQuestion), and never imports managerQuestionRuntime.ts directly AT ALL — cannot ask the Owner directly", () => {
    // Real code only — comments stripped first, so this file's own honest
    // header prose (explaining exactly what it deliberately does NOT
    // import) is never itself mistaken for a real reference.
    const src = stripComments(readSource("app/api/admin/ide/_lib/executionHandRuntime.ts"));
    assert(!/from\s*["'][^"']*managerQuestionRuntime["']/.test(src), "expected executionHandRuntime.ts to not import managerQuestionRuntime.ts directly at all (its only path to the Worker-ask surface is transitive, through costGateRuntime.ts)");
    assert(!/\bgetOwnerFacingQueue\b/.test(src), "expected the literal name getOwnerFacingQueue to never appear in this file's real code");
    assert(!/\banswerAggregatedQuestion\b/.test(src), "expected the literal name answerAggregatedQuestion to never appear in this file's real code");
  });

  await test("Structural (a) positive control — scripts/cost-gate-test.ts DOES really import getOwnerFacingQueue (read-only verification) — proves the detection pattern above is meaningful, not vacuous", () => {
    const src = readSource("scripts/cost-gate-test.ts");
    const importRegex = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'][^"']*managerQuestionRuntime["']/;
    const m = importRegex.exec(src);
    assert(m !== null, "expected cost-gate-test.ts to import from managerQuestionRuntime.ts");
    const imported = (m as RegExpExecArray)[1].split(",").map((s) => s.trim());
    assert(imported.some((n) => n.includes("getOwnerFacingQueue")), `expected the positive control to really import getOwnerFacingQueue, got: ${JSON.stringify(imported)}`);
  });

  await test("Structural (b) — executionHandRuntime.ts never imports workerTaskOrchestrator.ts or switchBasedOrchestratorRuntime.ts at all, and the literal names runScopedWorkerJob/attemptDispatch never appear in its real code — cannot dispatch other Workers", () => {
    const src = stripComments(readSource("app/api/admin/ide/_lib/executionHandRuntime.ts"));
    assert(!/from\s*["'][^"']*workerTaskOrchestrator["']/.test(src), "expected zero import from workerTaskOrchestrator.ts");
    assert(!/from\s*["'][^"']*switchBasedOrchestratorRuntime["']/.test(src), "expected zero import from switchBasedOrchestratorRuntime.ts");
    assert(!/\brunScopedWorkerJob\b/.test(src), "expected the literal name runScopedWorkerJob to never appear in this file");
    assert(!/\battemptDispatch\b/.test(src), "expected the literal name attemptDispatch to never appear in this file");
  });

  await test("Structural (b) positive control — scripts/worker-01-acceptance-test.ts DOES reference runScopedWorkerJob, and scripts/switch-based-orchestrator-test.ts DOES reference attemptDispatch — proves the scan is meaningful, not vacuous", () => {
    const src1 = readSource("scripts/worker-01-acceptance-test.ts");
    assert(/\brunScopedWorkerJob\b/.test(src1), "expected worker-01-acceptance-test.ts to really reference runScopedWorkerJob");
    const src2 = readSource("scripts/switch-based-orchestrator-test.ts");
    assert(/\battemptDispatch\b/.test(src2), "expected switch-based-orchestrator-test.ts to really reference attemptDispatch");
  });

  await test("Structural (c)(i) — executionHandRuntime.ts never does a wildcard/glob read of registry/ (no readdirSync over a registry path), and the ONLY registry/*.json file it ever readFileSync's is LOCK_MANAGER.json", () => {
    const src = readSource("app/api/admin/ide/_lib/executionHandRuntime.ts");
    assert(!/readdirSync\([^)]*registry/i.test(src), "expected zero readdirSync calls over any registry path");
    assert(!/readFileSync\([^)]*(CONSTITUTION\.json|CURRENT_STATE\.json)/i.test(src), "expected zero readFileSync calls literally targeting CONSTITUTION.json/CURRENT_STATE.json");
    const readCalls = [...src.matchAll(/readFileSync\(([^)]*)\)/g)].map((m) => m[1]);
    const nonLockManagerRegistryReads = readCalls.filter((r) => /registry/i.test(r) && !/LOCK_MANAGER/i.test(r));
    assert(nonLockManagerRegistryReads.length === 0, `expected the ONLY registry/*.json readFileSync target to be LOCK_MANAGER.json, found others: ${JSON.stringify(nonLockManagerRegistryReads)}`);
  });

  await test("Structural (c)(ii) positive control — managerQuestionRuntime.ts DOES really readFileSync+JSON.parse registry/CONSTITUTION.json and registry/CURRENT_STATE.json wholesale, and scripts/compatibility-test.ts DOES really readdirSync the whole registry/ directory — proves the detection patterns above are meaningful, not vacuous", () => {
    const src1 = readSource("app/api/admin/ide/_lib/managerQuestionRuntime.ts");
    assert(src1.includes('"registry/CONSTITUTION.json"'), "expected managerQuestionRuntime.ts to really name registry/CONSTITUTION.json in its MANAGED_REGISTRY_FILES");
    assert(src1.includes('"registry/CURRENT_STATE.json"'), "expected managerQuestionRuntime.ts to really name registry/CURRENT_STATE.json in its MANAGED_REGISTRY_FILES");
    assert(/readFileSync\(path\.join\(ROOT,\s*relPath\)/.test(src1), "expected managerQuestionRuntime.ts's real searchRegistryFile() to really readFileSync each of those files wholesale");
    const src2 = readSource("scripts/compatibility-test.ts");
    assert(/readdirSync\([^)]*registry/i.test(src2), "expected scripts/compatibility-test.ts to really readdirSync the whole registry/ directory");
  });

  await test("Structural (c)(iii) behavioral proof — a real Job Contract targeting registry/CONSTITUTION.json (even when its OWN allowed_paths mistakenly names it) is really refused BEFORE any write, real evidence never carries its content, and the real file is provably untouched (mtime unchanged)", async () => {
    const constitutionAbs = path.join(ROOT, "registry/CONSTITUTION.json");
    const beforeMtime = statSync(constitutionAbs).mtimeMs;
    const raw = baseContract({
      operation: "EDIT_FILE", allowed_paths: ["registry/CONSTITUTION.json"], tools_allowed: ["EDIT_FILE"],
      target_path: "registry/CONSTITUTION.json", content: "SHOULD NEVER BE WRITTEN",
    });
    const result = await runContract(raw, { ownerId: OWNER, actor: ACTOR });
    assert(result.status === "BLOCKED", `expected BLOCKED, got ${result.status}: ${result.reason}`);
    assert(result.evidence.every((e) => e.before === null && e.after === null), "expected zero evidence items to carry any real file content from CONSTITUTION.json");
    assert(result.reason.toLowerCase().includes("registry"), `expected the real refusal reason to cite the registry-governance denylist, got: ${result.reason}`);
    const afterMtime = statSync(constitutionAbs).mtimeMs;
    assert(beforeMtime === afterMtime, "expected registry/CONSTITUTION.json's real mtime to be COMPLETELY unchanged — proves it was never actually written");
  });

  await test("Structural (d)(i) — executionHandRuntime.ts never calls randomUUID()/imports crypto to fabricate a task_id, and never hardcodes a default-operation assignment", () => {
    const src = stripComments(readSource("app/api/admin/ide/_lib/executionHandRuntime.ts"));
    assert(!/randomUUID/.test(src), "expected zero occurrences of randomUUID anywhere in this file's real code");
    assert(!/from\s*["']crypto["']/.test(src), "expected zero import from the crypto module at all");
    assert(!/operation:\s*"(CREATE_FILE|EDIT_FILE|MOVE_FILE|CREATE_FOLDER|INSTALL_PACKAGE|UPDATE_IMPORT|RUN_COMMAND|RUN_TEST|BUILD|GENERATE_ARTIFACT)"/.test(src), "expected zero hardcoded default-operation assignments anywhere in this file");
  });

  await test("Structural (d)(ii) positive control — costGateRuntime.ts DOES really call randomUUID() to generate its own decisionId — proves the detection pattern above is meaningful, not vacuous", () => {
    const src = readSource("app/api/admin/ide/_lib/costGateRuntime.ts");
    assert(/randomUUID/.test(src), "expected costGateRuntime.ts to really call randomUUID()");
  });

  await test("Structural (d)(iii) behavioral proof — a Job Contract with no task_id produces a real BLOCKED result whose own task_id field stays null, never a fabricated id", async () => {
    const raw = baseContract();
    delete (raw as Record<string, unknown>).task_id;
    const result = await runContract(raw, { ownerId: OWNER, actor: ACTOR });
    assert(result.status === "BLOCKED", `expected BLOCKED, got ${result.status}`);
    assert(result.task_id === null, `expected result.task_id to be null (never fabricated), got: ${JSON.stringify(result.task_id)}`);
    assert(result.missingFields.includes("task_id"), "expected missingFields to include task_id");
  });

  await test("Structural (e)(i) — the literal quoted string \"PASS\" never appears anywhere in executionHandRuntime.ts's real code (only in its own honest doc comments, explaining what it deliberately does NOT do), and ExecutionHandStatus is a closed 3-value TypeScript union", () => {
    const rawSrc = readSource("app/api/admin/ide/_lib/executionHandRuntime.ts");
    const src = stripComments(rawSrc);
    assert(!/["']PASS["']/.test(src), 'expected the literal quoted string "PASS" to never appear anywhere in this file\'s real code');
    assert(/export type ExecutionHandStatus = "EXECUTED" \| "FAILED" \| "BLOCKED";/.test(rawSrc), "expected the real, closed 3-value ExecutionHandStatus union to be exactly this");
  });

  await test("Structural (e)(ii) positive control — workerTaskOrchestrator.ts's real WorkerJobStatus type DOES include the literal \"PASS\" — proves the detection pattern above is meaningful, not vacuous", () => {
    const src = readSource("app/api/admin/ide/_lib/workerTaskOrchestrator.ts");
    assert(/export type WorkerJobStatus =[^;]*["']PASS["']/.test(src), "expected workerTaskOrchestrator.ts's real WorkerJobStatus union to really contain the literal \"PASS\"");
  });

  await test("Structural (e)(iii) behavioral proof — every real .status value observed across every real executeJobContract()/runExecutionHandJobFromInbox() call this entire run is EXECUTED, FAILED, or BLOCKED, never anything else", () => {
    assert(observedStatuses.size > 0, "expected at least one real observed status this run");
    for (const s of observedStatuses) assert(s === "EXECUTED" || s === "FAILED" || s === "BLOCKED", `observed an illegal status: ${s}`);
    console.log(`  [captured] real statuses observed this run: ${[...observedStatuses].join(", ")}`);
  });

  // ============================================================
  // Cleanup — leave no residue.
  // ============================================================
  for (const f of createdFiles) { const p = path.join(ROOT, f); if (existsSync(p)) unlinkSync(p); }
  for (const d of createdDirs) { const p = path.join(ROOT, d); if (existsSync(p)) rmSync(p, { recursive: true, force: true }); }
  try { rmSync(SANDBOX_ABS, { recursive: true, force: true }); } catch { /* already gone */ }
  __debugResetManagerQuestionQueue(OWNER);

  await test("Cleanup — the real sandbox directory and every real test-created file/dir were removed, leaving zero residue", () => {
    assert(!existsSync(SANDBOX_ABS), "expected the real sandbox directory to be fully removed");
  });

  console.log("\n=== EXECUTION_HAND Acceptance Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
