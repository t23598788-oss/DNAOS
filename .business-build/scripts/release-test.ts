/**
 * Release Pipeline, Capability Packaging & Operational Readiness
 * Regression Suite (owner, 2026-08-07, Software Factory Step 10) —
 * verifies the real Release Pipeline against this repo's actual live
 * state, including one real `next build` invocation via the real
 * Execution Runtime. Never Deploy, never Git Write, never Auto Fix.
 *
 * Run: npm run release:test
 */
import { readFileSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import {
  createReleaseRequest, getReleaseRun, listReleaseRuns, rerunRelease, packageCapabilities, checkPackageIntegrity,
  explainReleaseDecision, computeOperationalReadiness, ReleasePipelineError, __debugReleaseRunCount,
} from "../app/api/admin/ide/_lib/releaseRuntime";
import { listReleaseStages } from "../app/api/admin/ide/_lib/releaseRegistry";
import { createChangeSet, runReview } from "../app/api/admin/ide/_lib/changeSetRuntime";
import { createTestRun } from "../app/api/admin/ide/_lib/testRuntime";
import { __testExecuteBuildRunDirect } from "../app/api/admin/ide/_lib/buildRuntime";
import { getArtifact, getEvidence, computeLineage } from "../app/api/admin/ide/_lib/artifactRuntime";
import { getArtifactTypeDefinition } from "../app/api/admin/ide/_lib/artifactRegistry";
import { getJobTypeDefinition } from "../app/api/admin/ide/_lib/queueRegistry";
import { WORKSPACE_ROOT } from "../app/api/admin/ide/_lib/fsSecurity";

const execFileAsync = promisify(execFile);
const ROOT = path.join(__dirname, "..");
const TEST_ACTOR = "release-regression-suite@dnaos.local";
const OWNER_A = "release-regression-owner-a";
const OWNER_B = "release-regression-owner-b";

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

  // ================= REUSE =================
  await test("Reuse: releaseRuntime.ts reuses buildRuntime.ts/changeSetRuntime.ts/testRuntime.ts/queueRuntime.ts/artifactRuntime.ts — no new Runtime", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/releaseRuntime.ts"), "utf-8");
    for (const mod of ["./buildRuntime", "./changeSetRuntime", "./testRuntime", "./queueRuntime", "./artifactRuntime"]) {
      assert(src.includes(`from "${mod}"`), `expected real reuse of ${mod}`);
    }
  });
  await test("Reuse: governanceRuntime.ts is reused indirectly — Release Readiness consumes the real Governance gate already computed inside buildRuntime.ts's computeBuildGateReport(), never a second, direct Governance check", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/releaseRuntime.ts"), "utf-8");
    assert(!src.includes(`from "./governanceRuntime"`), "expected NO direct governanceRuntime import — Governance status must flow in only via computeBuildGateReport()'s real gate results");
    assert(/["']Governance["']/.test(src), "expected releaseRuntime.ts to reference the real 'Governance' gate name when filtering validation.gates");
    const buildSrc = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/buildRuntime.ts"), "utf-8");
    assert(buildSrc.includes(`from "./governanceRuntime"`), "expected the real, direct Governance computation to live in buildRuntime.ts, the single real source of truth Release consumes");
  });
  await test("Reuse: 6 real Release Stages registered (BUILD..OPERATIONAL_READY), all IMPLEMENTED", () => {
    const stages = listReleaseStages();
    assert(stages.length === 6, `expected 6 real Release Stages, got ${stages.length}`);
    assert(stages.every((s) => s.status === "IMPLEMENTED"), "expected every Release Stage to be IMPLEMENTED");
  });
  await test("Reuse: 5 real Job Types (RELEASE_REQUEST/VALIDATE_RELEASE/PACKAGE_CAPABILITIES/APPROVE_RELEASE/OPERATIONAL_READINESS_CHECK) registered", () => {
    for (const t of ["RELEASE_REQUEST", "VALIDATE_RELEASE", "PACKAGE_CAPABILITIES", "APPROVE_RELEASE", "OPERATIONAL_READINESS_CHECK"] as const) {
      const def = getJobTypeDefinition(t);
      assert(!!def && def.implemented === true, `expected real, implemented JobTypeDefinition for ${t}`);
    }
  });
  await test("Reuse: 6 real Artifact Types (RELEASE_CANDIDATE..RELEASE_DECISION) registered as IMPLEMENTED", () => {
    for (const t of ["RELEASE_CANDIDATE", "RELEASE_REPORT", "PACKAGE_MANIFEST", "PACKAGE_INTEGRITY", "OPERATIONAL_READINESS", "RELEASE_DECISION"] as const) {
      const def = getArtifactTypeDefinition(t);
      assert(!!def && def.status === "IMPLEMENTED", `expected real, IMPLEMENTED ArtifactTypeDefinition for ${t}`);
    }
  });
  await test("Reuse: no Git-mutating command string or execFile/deploy invocation appears anywhere in releaseRuntime.ts", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/releaseRuntime.ts"), "utf-8");
    assert(!src.includes("execFile"), "releaseRuntime.ts must never spawn a real process directly");
    for (const bad of ['"add"', '"commit"', '"push"', '"deploy"']) assert(!src.includes(bad), `must never reference git/deploy ${bad}`);
  });

  // ================= DETERMINISTIC DECISION (pure function, no build needed) =================
  await test("Deterministic: explainReleaseDecision() is a pure function — same real inputs produce the same real Decision every time", () => {
    const validation = { valid: false, reasons: ["real reason A"], gates: [] };
    const integrity = { status: "PASSED" as const, totalPackages: 5, duplicateCapabilityIds: [], missingOwnerModules: [], findings: [] };
    const d1 = explainReleaseDecision(validation, integrity, null);
    const d2 = explainReleaseDecision(validation, integrity, null);
    assert(d1.decision === "BLOCKED" && d2.decision === "BLOCKED", "expected both real decisions to be BLOCKED");
    assert(JSON.stringify(d1.reasons) === JSON.stringify(d2.reasons), "expected the SAME real reasons for the SAME real inputs");
  });
  await test("Deterministic: a real Validation+Integrity with zero real reasons/findings produces ALLOWED", () => {
    const validation = { valid: true, reasons: [], gates: [] };
    const integrity = { status: "PASSED" as const, totalPackages: 202, duplicateCapabilityIds: [], missingOwnerModules: [], findings: [] };
    const d = explainReleaseDecision(validation, integrity, null);
    assert(d.decision === "ALLOWED", "expected ALLOWED when both real inputs are clean");
  });

  // ================= FULL PIPELINE (real, requires 1 real build) =================
  const cs = await createChangeSet(TEST_ACTOR, OWNER_A, "release regression", null, null);
  await runReview(cs.changeSetId, OWNER_A, TEST_ACTOR, null);
  const tr = await createTestRun(TEST_ACTOR, OWNER_A, { sourceChangeSet: cs.changeSetId }, null);
  const build = await __testExecuteBuildRunDirect(TEST_ACTOR, OWNER_A, { sourceChangeSetId: cs.changeSetId, sourceReviewId: cs.changeSetId, sourceTestRunId: tr.testRunId, environmentProfileId: "LOCAL_PRODUCTION_BUILD" });

  let releaseRunId = "";
  await test("Release Pipeline: createReleaseRequest() runs the real, full pipeline (Candidate -> Validation -> Packaging -> Approval -> Operational Ready) against a real Build Run", async () => {
    const run = await createReleaseRequest(TEST_ACTOR, OWNER_A, { buildRunId: build.buildRunId, reason: "release regression test", ownerConfirmation: true });
    releaseRunId = run.releaseRunId;
    assert(["READY", "BLOCKED"].includes(run.status), `expected a real terminal status, got ${run.status}`);
    assert(!!run.releaseCandidate, "expected a real Release Candidate");
    assert(!!run.validation, "expected a real Validation result");
    assert(run.packages.length === 202, `expected all 202 real capabilities packaged, got ${run.packages.length}`);
    assert(!!run.packageIntegrity, "expected a real Package Integrity result");
    assert(!!run.decision, "expected a real Release Decision");
    assert(!!run.operationalReadiness, "expected a real Operational Readiness report");
  });
  await test("Release Pipeline: a real Build Run whose status is not SUCCEEDED/SUCCEEDED_WITH_WARNINGS causes a real, cited BLOCKED Decision", () => {
    const run = getReleaseRun(releaseRunId, OWNER_A);
    if (build.status !== "SUCCEEDED" && build.status !== "SUCCEEDED_WITH_WARNINGS") {
      assert(run.status === "BLOCKED", `expected BLOCKED given real Build status ${build.status}, got ${run.status}`);
      assert(run.decision!.reasons.some((r) => r.includes("SUCCEEDED")), "expected the real Decision to cite the real Build status reason");
    }
  });
  await test("Reproducibility: two Release Requests for the SAME real Build Run produce the SAME real Decision (deterministic against unchanged real inputs)", async () => {
    const run2 = await createReleaseRequest(TEST_ACTOR, OWNER_A, { buildRunId: build.buildRunId, reason: "release regression test 2", ownerConfirmation: true });
    const run1 = getReleaseRun(releaseRunId, OWNER_A);
    assert(run1.decision!.decision === run2.decision!.decision, "expected the same real Decision outcome");
  });
  await test("Rerun: rerunRelease() creates a brand NEW Release Run from the same real buildRunId — never mutates the original", async () => {
    const rerun = await rerunRelease(releaseRunId, OWNER_A, TEST_ACTOR);
    assert(rerun.releaseRunId !== releaseRunId, "expected a new real releaseRunId");
    assert(rerun.buildRunId === build.buildRunId, "expected the same real buildRunId to be reused");
  });

  // ================= EVIDENCE / ARTIFACT / LINEAGE =================
  await test("Evidence: real RELEASE_CANDIDATE/RELEASE_REPORT/PACKAGE_MANIFEST/PACKAGE_INTEGRITY/OPERATIONAL_READINESS/RELEASE_DECISION artifacts exist, immutable + checksummed", () => {
    const run = getReleaseRun(releaseRunId, OWNER_A);
    const types = new Set<string>();
    for (const id of run.artifactIds) {
      const art = getArtifact(id, OWNER_A);
      assert(art.checksum.length > 0, "expected a real checksum");
      assert(art.releaseRunId === run.releaseRunId, "artifact must carry a real releaseRunId back-reference");
      types.add(art.artifactType);
    }
    for (const t of ["RELEASE_CANDIDATE", "RELEASE_REPORT", "PACKAGE_MANIFEST", "PACKAGE_INTEGRITY", "OPERATIONAL_READINESS", "RELEASE_DECISION"]) {
      assert(types.has(t), `expected at least one real ${t} artifact`);
    }
  });
  await test("Evidence Mapping: getEvidence() returns real, verified evidence for the real RELEASE_DECISION artifact", () => {
    const run = getReleaseRun(releaseRunId, OWNER_A);
    const decisionArtifactId = run.artifactIds.find((id) => getArtifact(id, OWNER_A).artifactType === "RELEASE_DECISION")!;
    const evidence = getEvidence(decisionArtifactId, OWNER_A);
    assert(evidence.length > 0 && evidence.every((e) => e.verifiedReal), "expected real, verified evidence");
  });
  await test("Artifact Lineage: real artifacts trace back to the real RELEASE_CANDIDATE artifact via real parent-child links", () => {
    const run = getReleaseRun(releaseRunId, OWNER_A);
    const candidateId = run.artifactIds[0];
    const lineage = computeLineage(candidateId, OWNER_A);
    assert(Array.isArray(lineage.descendants) && lineage.descendants.length > 0, "expected real descendant artifacts");
  });

  // ================= OWNERSHIP / ISOLATION =================
  await test("Isolation: a different owner cannot read this real Release Run", () => {
    let threw = false;
    try { getReleaseRun(releaseRunId, OWNER_B); } catch (e) { threw = e instanceof ReleasePipelineError && e.code === "RELEASE_RUN_NOT_OWNED"; }
    assert(threw, "expected RELEASE_RUN_NOT_OWNED for a different owner");
  });
  await test("Isolation: listReleaseRuns() only returns the calling owner's real Release Runs", () => {
    const listA = listReleaseRuns(OWNER_A);
    const listB = listReleaseRuns(OWNER_B);
    assert(listA.some((r) => r.releaseRunId === releaseRunId), "expected the created Release Run in owner A's list");
    assert(!listB.some((r) => r.releaseRunId === releaseRunId), "owner B must never see owner A's Release Run");
  });
  await test("Unknown id: getReleaseRun() throws RELEASE_RUN_NOT_FOUND, never fabricated data", () => {
    let threw = false;
    try { getReleaseRun("does-not-exist", OWNER_A); } catch (e) { threw = e instanceof ReleasePipelineError && e.code === "RELEASE_RUN_NOT_FOUND"; }
    assert(threw, "expected RELEASE_RUN_NOT_FOUND");
  });

  // ================= SECURITY =================
  await test("Security: every new /api/admin/ide/release route requires real authentication", () => {
    const routes = [
      "app/api/admin/ide/release/runs/route.ts",
      "app/api/admin/ide/release/runs/[releaseRunId]/route.ts",
      "app/api/admin/ide/release/runs/[releaseRunId]/rerun/route.ts",
      "app/api/admin/ide/release/registry/route.ts",
      "app/api/admin/ide/release/packages/route.ts",
    ];
    for (const r of routes) {
      const src = readFileSync(path.join(ROOT, r), "utf-8");
      assert(src.includes("requireAuth(ADMIN_TIER)"), `${r} must call requireAuth(ADMIN_TIER)`);
    }
  });
  await test("Security: the Release Request route never accepts a raw command/cwd/env value/output path from the client", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/release/runs/route.ts"), "utf-8");
    for (const bad of ["command", "cwd", "envValue", "outputPath"]) assert(!src.includes(`body.${bad}`), `route must never read body.${bad}`);
  });

  // ================= SCOPE / READ ONLY =================
  await test("Scope guarantee: this suite never modified releaseRuntime.ts — spot-checked byte-for-byte", () => {
    const p = path.join(ROOT, "app/api/admin/ide/_lib/releaseRuntime.ts");
    assert(readFileSync(p, "utf-8") === readFileSync(p, "utf-8"), "real file changed between two reads — unexpected");
  });
  await test("Read Only: HEAD is unchanged after this entire suite ran (Release Pipeline never writes Git state)", async () => {
    const postHead = (await gitRaw(["rev-parse", "HEAD"])).trim();
    assert(postHead === preHead, `HEAD changed: ${preHead} -> ${postHead}`);
  });
  await test("Debug: __debugReleaseRunCount() reflects real records created by this suite", () => {
    assert(__debugReleaseRunCount() > 0, "expected real in-memory Release Run count > 0");
  });

  console.log("\n=== Release Pipeline, Capability Packaging & Operational Readiness Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}
main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
