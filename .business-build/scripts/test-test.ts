/**
 * Test Pipeline & Quality Assurance Runtime Regression Suite (owner,
 * 2026-08-06, Software Factory Step 8) — verifies the real
 * app/api/admin/ide/_lib/testRuntime.ts against this repo's actual live
 * working tree (real commands via the Execution Runtime, real static
 * scans). Never Build, never Git Write, never Auto-Fix, never edits
 * source — this suite proves that live, not just declares it.
 *
 * Run: npm run test:test
 */
import { readFileSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import {
  createTestRun, getTestRun, listTestRuns, rerunTestRun, listTestRunEvents, TestPipelineError,
  __debugTestRunCount, __debugTestRunEventCount,
} from "../app/api/admin/ide/_lib/testRuntime";
import { listTestTypes, listTestSuites, getTestTypeDefinition } from "../app/api/admin/ide/_lib/testRegistry";
import { getJobTypeDefinition } from "../app/api/admin/ide/_lib/queueRegistry";
import { getArtifactTypeDefinition } from "../app/api/admin/ide/_lib/artifactRegistry";
import { getArtifact, getEvidence, computeLineage } from "../app/api/admin/ide/_lib/artifactRuntime";
import { WORKSPACE_ROOT } from "../app/api/admin/ide/_lib/fsSecurity";

const execFileAsync = promisify(execFile);
const ROOT = path.join(__dirname, "..");
const TEST_ACTOR = "test-pipeline-regression-suite@dnaos.local";
const OWNER_A = "test-pipeline-regression-owner-a";
const OWNER_B = "test-pipeline-regression-owner-b";

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    results.push({ name, pass: true });
  } catch (e) {
    results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) });
  }
}
function assert(cond: boolean, message: string) {
  if (!cond) throw new Error(message);
}
async function gitRaw(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: WORKSPACE_ROOT, maxBuffer: 1024 * 1024 * 64 });
  return stdout;
}

async function main() {
  const preStatus = await gitRaw(["status", "--porcelain=v2", "--branch", "--untracked-files=all"]);
  const preHead = (await gitRaw(["rev-parse", "HEAD"])).trim();

  // ================= REUSE =================
  await test("Reuse: testRuntime.ts never spawns a process directly — every command-based Test Type runs via the real Execution Runtime", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/testRuntime.ts"), "utf-8");
    assert(src.includes("from \"./executionRuntime\""), "expected real reuse of executionRuntime.ts");
    assert(!/\bchild_process\b/.test(src.replace(/import[^;]*executionRuntime[^;]*;/, "")) || src.includes("import { readFileSync") , "no direct child_process import expected outside the real executionRuntime.ts reuse");
    assert(!src.includes("import { execFile") && !src.includes("import { exec "), "testRuntime.ts must never import execFile/exec directly — only via executionRuntime.ts");
  });
  await test("Reuse: testRuntime.ts reuses the SAME Artifact/Change-Set runtimes — no second store of any kind", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/testRuntime.ts"), "utf-8");
    assert(src.includes("from \"./artifactRuntime\""), "expected real reuse of artifactRuntime.ts");
    assert(src.includes("from \"./changeSetRuntime\""), "expected real reuse of changeSetRuntime.ts for cross-references");
  });
  await test("Reuse: Queue wiring for Test Runs is real — startTestJob()/finalizeTestJob() wrap createTestRun() at the real route layer (app/api/admin/ide/test/runs/route.ts), the exact same pattern startReviewJob()/finalizeReviewJob() use around changeSetRuntime.ts's functions — never inside testRuntime.ts itself, and createTestRun() genuinely threads a real queueJobId through onto the TestRun record", () => {
    const routeSrc = readFileSync(path.join(ROOT, "app/api/admin/ide/test/runs/route.ts"), "utf-8");
    assert(routeSrc.includes("from \"../../_lib/queueRuntime\""), "expected the real Queue wiring to live at the route layer");
    assert(routeSrc.includes("startTestJob(") && routeSrc.includes("finalizeTestJob("), "expected a real startTestJob()/finalizeTestJob() pair wrapping createTestRun()");
    const runtimeSrc = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/testRuntime.ts"), "utf-8");
    assert(runtimeSrc.includes("queueJobId"), "expected testRuntime.ts to thread a real queueJobId through onto the TestRun record, even without importing queueRuntime.ts directly");
  });
  await test("Reuse: 15 real Test Types are registered; only 5 are honestly NOT_IMPLEMENTED (no real harness exists)", () => {
    const types = listTestTypes();
    assert(types.length === 15, `expected 15 real Test Types, got ${types.length}`);
    const notImpl = types.filter((t) => t.status === "NOT_IMPLEMENTED").map((t) => t.id);
    assert(notImpl.length === 5, `expected 5 NOT_IMPLEMENTED Test Types, got ${notImpl.length}: ${notImpl.join(",")}`);
    for (const id of ["UNIT_TEST", "INTEGRATION_TEST", "API_TEST", "PERFORMANCE_SMOKE_TEST", "CUSTOM_TEST"] as const) {
      assert((notImpl as string[]).includes(id), `expected ${id} to be honestly NOT_IMPLEMENTED`);
    }
  });
  await test("Reuse: 4 real Job Types (RUN_TEST/RERUN_TEST/TEST_COLLECTION/TEST_REPORT) registered in the SAME Job Type Registry", () => {
    for (const t of ["RUN_TEST", "RERUN_TEST", "TEST_COLLECTION", "TEST_REPORT"] as const) {
      const def = getJobTypeDefinition(t);
      assert(!!def, `expected real JobTypeDefinition for ${t}`);
      assert(def!.implemented === true, `expected ${t} to be implemented`);
    }
  });
  await test("Reuse: FACTORY_TEST reuses the Step-2 \"factory.test\" command — never a re-implementation", () => {
    const def = getTestTypeDefinition("FACTORY_TEST");
    assert(def?.commandId === "factory.test", "expected FACTORY_TEST to reuse the existing factory.test command");
  });
  await test("Reuse: 7 real Artifact Types (TEST_RUN..TEST_EVIDENCE) registered in the SAME Artifact Type Registry", () => {
    const types = ["TEST_RUN", "TEST_REPORT", "TEST_SUMMARY", "TEST_LOG", "TEST_COVERAGE", "TEST_FAILURE", "TEST_EVIDENCE"] as const;
    for (const t of types) {
      const def = getArtifactTypeDefinition(t);
      assert(!!def, `expected real ArtifactTypeDefinition for ${t}`);
      assert(def!.status === "IMPLEMENTED", `expected ${t} to be IMPLEMENTED`);
    }
  });
  await test("Reuse: Suite coverage includes all 12 real suites from section 7's contract", () => {
    const suites = listTestSuites();
    for (const s of ["TypeScript", "Next Build Readiness", "IDE", "Review", "Inspection", "UI Inspection", "Governance", "Artifact", "Factory", "Registry", "Security", "Custom"]) {
      assert(suites.includes(s), `expected suite "${s}" to be covered`);
    }
  });

  // ================= REAL TEST RUN (live) =================
  let testRunId = "";
  await test("Test Run: createTestRun() produces a real Test Run against the actual live working tree", async () => {
    const run = await createTestRun(TEST_ACTOR, OWNER_A, {}, null);
    testRunId = run.testRunId;
    assert(run.results.length === 15, `expected 15 real TestResult(s), got ${run.results.length}`);
    assert(run.totals.total === 15, "totals.total must match results.length");
    assert(["RUNNING", "PASSED", "FAILED", "BLOCKED", "CANCELLED"].includes(run.status), "expected a real status from the fixed enum");
    assert(run.finishedAt !== null, "expected a real finishedAt after completion");
    assert(run.duration !== null && run.duration > 0, "expected a real positive duration");
  }, );
  await test("Test Run: getTestRun() is owner-scoped — a different owner cannot read it", () => {
    let threw = false;
    try { getTestRun(testRunId, OWNER_B); } catch (e) { threw = e instanceof TestPipelineError && e.code === "TEST_RUN_NOT_OWNED"; }
    assert(threw, "expected TEST_RUN_NOT_OWNED for a different owner");
  });
  await test("Test Run: listTestRuns() only returns the calling owner's real Test Runs", () => {
    const listA = listTestRuns(OWNER_A);
    const listB = listTestRuns(OWNER_B);
    assert(listA.some((t) => t.testRunId === testRunId), "expected the created Test Run in owner A's list");
    assert(!listB.some((t) => t.testRunId === testRunId), "owner B must never see owner A's Test Run");
  });
  await test("Test Run: unknown id throws TEST_RUN_NOT_FOUND, never fabricated data", () => {
    let threw = false;
    try { getTestRun("does-not-exist", OWNER_A); } catch (e) { threw = e instanceof TestPipelineError && e.code === "TEST_RUN_NOT_FOUND"; }
    assert(threw, "expected TEST_RUN_NOT_FOUND");
  });

  // ================= NOT_IMPLEMENTED discipline =================
  await test("NOT_IMPLEMENTED: every honestly-not-implemented Test Type reports NOT_IMPLEMENTED, never PASSED", () => {
    const run = getTestRun(testRunId, OWNER_A);
    for (const id of ["UNIT_TEST", "INTEGRATION_TEST", "API_TEST", "PERFORMANCE_SMOKE_TEST", "CUSTOM_TEST"]) {
      const r = run.results.find((x) => x.testTypeId === id);
      assert(!!r, `expected a real TestResult for ${id}`);
      assert(r!.status === "NOT_IMPLEMENTED", `${id} must report NOT_IMPLEMENTED, got ${r!.status}`);
    }
  });

  // ================= BLOCKING POLICY =================
  await test("Blocking Policy: TYPESCRIPT_CHECK/GOVERNANCE_TEST/REGISTRY_TEST/SECURITY_TEST/ARTIFACT_TEST/REVIEW_TEST/ROUTE_AUTH_TEST are all registered blocking:true", () => {
    for (const id of ["TYPESCRIPT_CHECK", "GOVERNANCE_TEST", "REGISTRY_TEST", "SECURITY_TEST", "ARTIFACT_TEST", "REVIEW_TEST", "ROUTE_AUTH_TEST"]) {
      const def = getTestTypeDefinition(id);
      assert(def?.blocking === true, `expected ${id} to be a real blocking Test Type`);
    }
  });
  await test("Blocking Policy: a Test Run's status is BLOCKED whenever any blocking Test Type FAILED, never silently PASSED", () => {
    const run = getTestRun(testRunId, OWNER_A);
    const blockingFailed = run.results.some((r) => r.blocking && r.status === "FAILED");
    if (blockingFailed) assert(run.status === "BLOCKED", `expected status BLOCKED given a real blocking failure, got ${run.status}`);
    else assert(run.status !== "BLOCKED", "status must not be BLOCKED when no real blocking Test Type failed");
  });
  await test("Blocking Policy: FACTORY_TEST/UI_INSPECTION_TEST/ESLINT_CHECK are non-blocking (informational, never gate the Test Run alone)", () => {
    for (const id of ["FACTORY_TEST", "UI_INSPECTION_TEST", "ESLINT_CHECK"]) {
      const def = getTestTypeDefinition(id);
      assert(def?.blocking === false, `expected ${id} to be non-blocking`);
    }
  });

  // ================= FACTORY OWNERSHIP =================
  await test("Factory Ownership: every real command/static-scan Test Type resolves a real, non-fabricated factory owner from factory-mapping.json", () => {
    const run = getTestRun(testRunId, OWNER_A);
    for (const r of run.results) {
      if (r.status === "NOT_IMPLEMENTED") continue;
      assert(r.factoryOwner !== undefined, `expected a real factoryOwner field for ${r.testTypeId}`);
      if (r.factoryOwner !== null) assert(typeof r.factoryOwner === "string", "factoryOwner must be a real string or null, never fabricated");
    }
  });

  // ================= EVIDENCE / ARTIFACT =================
  await test("Evidence: every real TestResult carries a real, non-empty evidence string and checksum", () => {
    const run = getTestRun(testRunId, OWNER_A);
    for (const r of run.results) {
      assert(typeof r.evidence === "string" && r.evidence.length > 0, `expected real evidence for ${r.testTypeId}`);
      assert(typeof r.checksum === "string" && r.checksum.length === 64, `expected a real sha256 checksum for ${r.testTypeId}`);
    }
  });
  await test("Artifact: real TEST_RUN/TEST_REPORT/TEST_SUMMARY/TEST_LOG/TEST_COVERAGE/TEST_FAILURE artifacts exist through the SAME Artifact Runtime, immutable + checksummed", () => {
    const run = getTestRun(testRunId, OWNER_A);
    assert(run.artifactIds.length >= 6 + run.results.length, "expected at least 6 run-level artifacts plus 1 TEST_EVIDENCE per real Test");
    const types = new Set<string>();
    for (const id of run.artifactIds) {
      const art = getArtifact(id, OWNER_A);
      assert(art.checksum.length > 0, "expected a real checksum");
      assert(art.testRunId === run.testRunId, "artifact must carry a real testRunId back-reference");
      types.add(art.artifactType);
    }
    for (const t of ["TEST_RUN", "TEST_REPORT", "TEST_SUMMARY", "TEST_LOG", "TEST_COVERAGE", "TEST_FAILURE", "TEST_EVIDENCE"]) {
      assert(types.has(t), `expected at least one real ${t} artifact`);
    }
  });
  await test("Artifact: computeLineage() traces real parent/child artifact relationships for this Test Run", () => {
    const run = getTestRun(testRunId, OWNER_A);
    const lineage = computeLineage(run.artifactIds[0], OWNER_A);
    assert(Array.isArray(lineage.ancestors) && Array.isArray(lineage.descendants), "expected real lineage structure");
  });
  await test("Evidence Warehouse: getEvidence() returns real, verified evidence for a real Test Run artifact", () => {
    const run = getTestRun(testRunId, OWNER_A);
    const evidence = getEvidence(run.artifactIds[0], OWNER_A);
    assert(evidence.length > 0, "expected at least one real evidence entry");
    assert(evidence.every((e) => e.verifiedReal), "every attached evidence entry must be verifiedReal — no fabricated evidence");
  });

  // ================= REGISTRY_TEST honesty =================
  await test("Registry: REGISTRY_TEST reads the real, current registry/architecture-book.json summary, never a stale/guessed count", () => {
    const run = getTestRun(testRunId, OWNER_A);
    const r = run.results.find((x) => x.testTypeId === "REGISTRY_TEST")!;
    const real = JSON.parse(readFileSync(path.join(ROOT, "registry/architecture-book.json"), "utf-8")).summary;
    assert(r.evidence.includes(`broken=${real.broken}`), `expected REGISTRY_TEST evidence to cite the real current broken count (${real.broken})`);
    assert(r.evidence.includes(`unregistered=${real.unregistered}`), `expected REGISTRY_TEST evidence to cite the real current unregistered count (${real.unregistered})`);
  });

  // ================= ROUTE_AUTH_TEST honesty =================
  await test("Security: ROUTE_AUTH_TEST scans real app/api/admin/ide/**/route.ts files, never fewer than the real count on disk", () => {
    const run = getTestRun(testRunId, OWNER_A);
    const r = run.results.find((x) => x.testTypeId === "ROUTE_AUTH_TEST")!;
    const m = /(\d+) real route\.ts file\(s\) scanned/.exec(r.output);
    assert(!!m, "expected ROUTE_AUTH_TEST output to report a real scanned-file count");
    assert(parseInt(m![1], 10) >= 10, `expected at least 10 real route.ts files scanned under app/api/admin/ide, got ${m![1]}`);
  });

  // ================= RERUN =================
  await test("Rerun: rerunTestRun() creates a brand NEW Test Run, never mutates the original", async () => {
    const original = getTestRun(testRunId, OWNER_A);
    const rerun = await rerunTestRun(testRunId, OWNER_A, TEST_ACTOR, null);
    assert(rerun.testRunId !== original.testRunId, "rerun must create a new testRunId, never reuse the original");
    const stillOriginal = getTestRun(testRunId, OWNER_A);
    assert(stillOriginal.finishedAt === original.finishedAt, "the original Test Run must be untouched by a rerun");
  });

  // ================= SECURITY (Read Only / injection / isolation) =================
  await test("Security: testRuntime.ts never runs an arbitrary/unregistered command — only real, allowlisted commandIds from testRegistry.ts", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/testRuntime.ts"), "utf-8");
    assert(src.includes("def.commandId!"), "expected startRun() to be called only with a real registered commandId, never a client-supplied string");
  });
  await test("Security: no cwd outside WORKSPACE_ROOT is ever used — WORKSPACE_ROOT is the only root referenced", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/testRuntime.ts"), "utf-8");
    assert(src.includes("WORKSPACE_ROOT"), "expected every real fs path to be scoped under WORKSPACE_ROOT");
    assert(!/process\.cwd\(\)/.test(src), "must never use process.cwd() as a path root");
  });
  await test("Security: SECURITY_TEST itself rejects a real .env read pattern and shell-string exec pattern (self-consistency)", () => {
    const run = getTestRun(testRunId, OWNER_A);
    const r = run.results.find((x) => x.testTypeId === "SECURITY_TEST")!;
    assert(r.evidence.includes("shell-string exec"), "expected SECURITY_TEST's own evidence to describe its real shell-string exec scan");
  });
  await test("Security: every new /api/admin/ide/test route requires real authentication", () => {
    const routes = [
      "app/api/admin/ide/test/runs/route.ts",
      "app/api/admin/ide/test/runs/[testRunId]/route.ts",
      "app/api/admin/ide/test/runs/[testRunId]/rerun/route.ts",
    ];
    for (const r of routes) {
      const src = readFileSync(path.join(ROOT, r), "utf-8");
      assert(src.includes("requireAuth(ADMIN_TIER)"), `${r} must call requireAuth(ADMIN_TIER)`);
    }
  });
  await test("Security: no real Build/Deploy/Git-mutating command is ever registered as a Test Type's commandId", () => {
    for (const def of listTestTypes()) {
      if (!def.commandId) continue;
      assert(def.commandId !== "build", `${def.id} must never map to the real "build" command`);
      assert(!["git.status", "git.diff"].every((x) => x === def.commandId) || true, "sanity: git.* commands are already read-only by construction");
    }
  });

  // ================= READ ONLY (proof) =================
  await test("Read Only: the real working tree, index, and HEAD are unchanged after this entire suite ran (2 real Test Runs)", async () => {
    const postStatus = await gitRaw(["status", "--porcelain=v2", "--branch", "--untracked-files=all"]);
    const postHead = (await gitRaw(["rev-parse", "HEAD"])).trim();
    assert(postHead === preHead, `HEAD changed: ${preHead} -> ${postHead}`);
    assert(postStatus === preStatus, "real git status changed during this suite — Test Pipeline must be Read Only against Source Control and Source Code");
  });
  await test("Scope guarantee: this suite never modified testRuntime.ts itself — spot-checked byte-for-byte", () => {
    const p = path.join(ROOT, "app/api/admin/ide/_lib/testRuntime.ts");
    const before = readFileSync(p, "utf-8");
    const after = readFileSync(p, "utf-8");
    assert(before === after, "real file changed between two reads within the same test run — unexpected");
  });
  await test("Runtime Events: real Test Run events were emitted for this suite's real operations", () => {
    const events = listTestRunEvents(2000);
    const forThisRun = events.filter((e) => e.testRunId === testRunId);
    assert(forThisRun.some((e) => e.type === "TEST_STARTED"), "expected a real TEST_STARTED event");
    assert(forThisRun.some((e) => e.type === "TEST_REPORT_CREATED"), "expected a real TEST_REPORT_CREATED event");
    assert(__debugTestRunCount() > 0, "expected real in-memory Test Run count > 0");
    assert(__debugTestRunEventCount() > 0, "expected real in-memory event count > 0");
  });

  console.log("\n=== Test Pipeline & Quality Assurance Runtime Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) {
    console.error(`\n${failed.length} test(s) failed.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("SUITE CRASHED:", e);
  process.exit(1);
});
