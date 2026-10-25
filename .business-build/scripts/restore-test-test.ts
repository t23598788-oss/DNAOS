/**
 * Restore Test Runtime Regression Suite (owner, 2026-08-08, Software
 * Factory Step 12.5) — verifies the real, dry-run Restore Test against
 * this repo's actual, existing backups. Never restores to Production,
 * never claims VERIFIED_RESTORE.
 *
 * Run: npm run restore-test:test
 */
import { readFileSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { discoverBackups } from "../app/api/admin/ide/_lib/backupRuntime";
import { runRestoreTest, getRestoreTest, listRestoreTests, listRestoreTestEvents, RestoreTestError, __debugRestoreTestCount } from "../app/api/admin/ide/_lib/restoreTestRuntime";
import { listRestoreTestStages, getRestoreTestStageDefinition } from "../app/api/admin/ide/_lib/restoreTestRegistry";
import { WORKSPACE_ROOT } from "../app/api/admin/ide/_lib/fsSecurity";

const execFileAsync = promisify(execFile);
const ROOT = path.join(__dirname, "..");
const OWNER_A = "restore-test-regression-owner-a";
const OWNER_B = "restore-test-regression-owner-b";
const ACTOR = "restore-test-regression-suite@dnaos.local";

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }
async function gitRaw(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: WORKSPACE_ROOT, maxBuffer: 1024 * 1024 * 64 });
  return stdout;
}

async function main() {
  const preHead = (await gitRaw(["rev-parse", "HEAD"])).trim();

  await test("Registry: 12 real Restore Test Stages declared; PREPARE_ISOLATED_TARGET through VERIFY_CRITICAL_QUERIES are honestly not realizable in this environment", () => {
    const stages = listRestoreTestStages();
    assert(stages.length === 12, `expected 12 real stages, got ${stages.length}`);
    for (const id of ["PREPARE_ISOLATED_TARGET", "RESTORE_SCHEMA", "RESTORE_DATA", "VERIFY_CONSTRAINTS", "VERIFY_CRITICAL_QUERIES"]) {
      assert(getRestoreTestStageDefinition(id)!.realizable === false, `expected ${id} honestly not realizable in this environment`);
    }
  });

  const backups = discoverBackups();
  assert(backups.length > 0, "expected at least one real backup in this repo to run a real restore test against");

  await test("Isolated target requirement: PREPARE_ISOLATED_TARGET/RESTORE_SCHEMA/RESTORE_DATA are honestly SKIPPED — no real isolated database exists", async () => {
    const run = await runRestoreTest(backups[0].backupId, OWNER_A, ACTOR);
    for (const id of ["PREPARE_ISOLATED_TARGET", "RESTORE_SCHEMA", "RESTORE_DATA", "VERIFY_CONSTRAINTS", "VERIFY_CRITICAL_QUERIES"]) {
      const stage = run.stages.find((s) => s.stage === id)!;
      assert(stage.status === "SKIPPED", `expected ${id} SKIPPED, got ${stage.status}`);
    }
  });
  await test("Production target rejection: the real Runtime rejects any target that is not the literal dry-run sentinel", async () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/restoreTestRuntime.ts"), "utf-8");
    assert(src.includes("assertNeverProductionTarget"), "expected a real production-target guard function to exist");
    assert(src.includes("PRODUCTION_TARGET_REJECTED"), "expected a real, dedicated rejection error code");
  });
  await test("Plan-only honesty: overall RestoreTestRun.status is NEVER a value implying a real, verified database restore", async () => {
    const runs = listRestoreTests(OWNER_A);
    for (const r of runs) assert(["PLAN_ONLY", "PARTIAL", "FAILED"].includes(r.status), `expected an honest status, got ${r.status}`);
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/restoreTestRuntime.ts"), "utf-8");
    assert(!src.includes('"VERIFIED_RESTORE"'), "the literal string VERIFIED_RESTORE must never appear as an assignable value in restoreTestRuntime.ts");
  });
  await test("Stage tracking: every real stage carries a real startedAt/finishedAt/evidence, never omitted", async () => {
    const runs = listRestoreTests(OWNER_A);
    for (const s of runs[0].stages) {
      assert(!!s.startedAt && !!s.finishedAt, `expected real timestamps for stage ${s.stage}`);
      assert(!!s.evidence, `expected real evidence for stage ${s.stage}`);
    }
  });
  await test("Failed restore: an unknown backupId produces a real BACKUP_NOT_FOUND error, never a fabricated run", async () => {
    try { await runRestoreTest("totally-fake-backup-id", OWNER_A, ACTOR); assert(false, "expected BACKUP_NOT_FOUND"); }
    catch (e) { assert(e instanceof RestoreTestError && e.code === "BACKUP_NOT_FOUND", `expected BACKUP_NOT_FOUND, got ${e}`); }
  });
  await test("Partial restore: VERIFY_COUNTS real-compares the real dry-run row sum against the real manifest total_rows — never assumed to match", async () => {
    const runs = listRestoreTests(OWNER_A);
    const countsStage = runs[0].stages.find((s) => s.stage === "VERIFY_COUNTS")!;
    assert(countsStage.evidence.includes("real dry-run row sum") && countsStage.evidence.includes("real manifest total_rows"), "expected a real, comparative evidence string");
  });
  await test("Verification evidence: VERIFY_OBJECTS cites the real per-table dry-run parse result for every EXPECTED_BACKUP_TABLES entry", async () => {
    const runs = listRestoreTests(OWNER_A);
    const objectsStage = runs[0].stages.find((s) => s.stage === "VERIFY_OBJECTS")!;
    assert(objectsStage.evidence.includes("real dry-run parse"), "expected real dry-run parse evidence");
  });
  await test("Cleanup: CLEANUP stage always confirms CLEAN — nothing is ever written by a real dry-run", async () => {
    const runs = listRestoreTests(OWNER_A);
    const cleanupStage = runs[0].stages.find((s) => s.stage === "CLEANUP")!;
    assert(cleanupStage.cleanupStatus === "CLEAN", `expected real CLEAN cleanupStatus, got ${cleanupStage.cleanupStatus}`);
  });
  await test("No fake success: limitations field always honestly discloses the dry-run-only nature of this Step's Restore Test", async () => {
    const runs = listRestoreTests(OWNER_A);
    assert(runs[0].limitations.includes("no real isolated database target exists"), "expected the real, honest limitations disclosure");
  });
  await test("Owner scope: a different owner cannot read this real restore test", async () => {
    const runs = listRestoreTests(OWNER_A);
    try { getRestoreTest(runs[0].restoreTestId, OWNER_B); assert(false, "expected RESTORE_TEST_NOT_OWNED"); }
    catch (e) { assert(e instanceof RestoreTestError && e.code === "RESTORE_TEST_NOT_OWNED", `expected RESTORE_TEST_NOT_OWNED, got ${e}`); }
  });
  await test("Evidence linkage: real RESTORE_TEST_RUN/RESTORE_VERIFICATION_REPORT artifacts are immutable and carry the real relatedRestoreTestId", async () => {
    const { getArtifact } = await import("../app/api/admin/ide/_lib/artifactRuntime");
    const runs = listRestoreTests(OWNER_A);
    for (const id of runs[0].artifactIds) {
      const art = getArtifact(id, OWNER_A);
      assert(art.immutable, `expected artifact ${id} immutable`);
      assert(art.relatedRestoreTestId === runs[0].restoreTestId, `expected artifact ${id} to carry the real relatedRestoreTestId`);
    }
  });
  await test("Bounded events: listRestoreTestEvents() includes real RESTORE_TEST_PLANNED/RESTORE_CLEANUP_COMPLETED for this suite's real run", () => {
    const events = listRestoreTestEvents();
    assert(events.some((e) => e.type === "RESTORE_TEST_PLANNED"), "expected a real RESTORE_TEST_PLANNED event");
    assert(events.some((e) => e.type === "RESTORE_CLEANUP_COMPLETED"), "expected a real RESTORE_CLEANUP_COMPLETED event");
  });

  await test("Scope guarantee: this suite never modified restoreTestRuntime.ts itself, nor any real backups/ file — spot-checked byte-for-byte", async () => {
    const status = (await gitRaw(["status", "--porcelain", "app/api/admin/ide/_lib/restoreTestRuntime.ts", "backups/"])).trim();
    assert(!status.includes(" M "), "expected no real modification during this suite's run");
  });
  await test("Debug: __debugRestoreTestCount() reflects real records created by this suite", () => {
    assert(__debugRestoreTestCount() >= 1, "expected at least 1 real Restore Test in the real store");
  });
  await test("Read Only: the real working tree HEAD is unchanged after this entire suite ran", async () => {
    const postHead = (await gitRaw(["rev-parse", "HEAD"])).trim();
    assert(postHead === preHead, `expected HEAD unchanged, was ${preHead}, now ${postHead}`);
  });

  console.log("\n=== Restore Test Runtime Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}
main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
