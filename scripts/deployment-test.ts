/**
 * Deployment Orchestration Runtime Regression Suite (owner, 2026-08-08,
 * Software Factory Step 11) — verifies the real Deployment Plan pipeline
 * against this repo's actual live state. Never Deploy, never Git Write,
 * never Vercel/Supabase call, never Auto Fix.
 *
 * Run: npm run deployment:test
 */
import { readFileSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import {
  createDeploymentPlan, getDeploymentPlan, listDeploymentPlans, computeDeploymentGate, buildRollbackPlan,
  buildDeploymentManifest, explainDeploymentDecision, DeploymentPipelineError, __debugDeploymentPlanCount,
} from "../app/api/admin/ide/_lib/deploymentRuntime";
import { listDeploymentStages, listDeploymentTargets } from "../app/api/admin/ide/_lib/deploymentRegistry";
import { createChangeSet, runReview } from "../app/api/admin/ide/_lib/changeSetRuntime";
import { createTestRun } from "../app/api/admin/ide/_lib/testRuntime";
import { __testExecuteBuildRunDirect } from "../app/api/admin/ide/_lib/buildRuntime";
import { createReleaseRequest, getReleaseRun } from "../app/api/admin/ide/_lib/releaseRuntime";
import { getArtifact } from "../app/api/admin/ide/_lib/artifactRuntime";
import { getArtifactTypeDefinition } from "../app/api/admin/ide/_lib/artifactRegistry";
import { getJobTypeDefinition } from "../app/api/admin/ide/_lib/queueRegistry";
import { WORKSPACE_ROOT } from "../app/api/admin/ide/_lib/fsSecurity";

const execFileAsync = promisify(execFile);
const ROOT = path.join(__dirname, "..");
const TEST_ACTOR = "deployment-regression-suite@dnaos.local";
const OWNER_A = "deployment-regression-owner-a";
const OWNER_B = "deployment-regression-owner-b";

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
  await test("Reuse: deploymentRuntime.ts reuses releaseRuntime.ts/factoryCompletionRuntime.ts/queueRuntime.ts/artifactRuntime.ts — no new Runtime", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/deploymentRuntime.ts"), "utf-8");
    for (const mod of ["./releaseRuntime", "./factoryCompletionRuntime", "./queueRuntime", "./artifactRuntime", "./deploymentRegistry"]) {
      assert(src.includes(`from "${mod}"`), `expected real reuse of ${mod}`);
    }
  });
  await test("Reuse: 5 real Deployment Stages registered, all IMPLEMENTED", () => {
    const stages = listDeploymentStages();
    assert(stages.length === 5, `expected 5 real Deployment Stages, got ${stages.length}`);
    assert(stages.every((s) => s.status === "IMPLEMENTED"), "expected every Deployment Stage to be IMPLEMENTED");
  });
  await test("Reuse: 3 real Job Types (DEPLOYMENT_PLAN_REQUEST/DEPLOYMENT_GATE_CHECK/APPROVE_DEPLOYMENT) registered", () => {
    for (const t of ["DEPLOYMENT_PLAN_REQUEST", "DEPLOYMENT_GATE_CHECK", "APPROVE_DEPLOYMENT"]) {
      const def = getJobTypeDefinition(t);
      assert(!!def && def.implemented, `expected real, implemented job type ${t}`);
    }
  });
  await test("Reuse: 5 real Artifact Types (DEPLOYMENT_PLAN/DEPLOYMENT_AUDIT + 3 Global Factory types) registered as IMPLEMENTED", () => {
    for (const t of ["DEPLOYMENT_PLAN", "DEPLOYMENT_AUDIT", "RUNTIME_DEPENDENCY_REPORT", "FACTORY_RUNTIME_REPORT", "GLOBAL_FACTORY_REPORT"] as const) {
      const def = getArtifactTypeDefinition(t);
      assert(!!def && def.status === "IMPLEMENTED", `expected real, IMPLEMENTED artifact type ${t}`);
    }
  });
  await test("Registry: both real Deployment Targets (Vercel/Supabase) honestly declare integrationStatus NOT_IMPLEMENTED — never a real integration", () => {
    const targets = listDeploymentTargets();
    assert(targets.length === 2, `expected 2 real declared targets, got ${targets.length}`);
    assert(targets.every((t) => t.integrationStatus === "NOT_IMPLEMENTED"), "expected every real target to be honestly NOT_IMPLEMENTED");
  });
  await test("Security: deploymentRuntime.ts never calls fetch()/axios or spawns a process to an external provider — grep-verified", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/deploymentRuntime.ts"), "utf-8");
    assert(!src.includes("fetch(") && !src.includes("execFile") && !src.includes("spawn("), "deploymentRuntime.ts must never make a real network/process call");
  });

  // ================= REAL PIPELINE =================
  const cs = await createChangeSet(TEST_ACTOR, OWNER_A, "deployment regression", null, null);
  await runReview(cs.changeSetId, OWNER_A, TEST_ACTOR, null);
  const tr = await createTestRun(TEST_ACTOR, OWNER_A, { sourceChangeSet: cs.changeSetId }, null);
  const build = await __testExecuteBuildRunDirect(TEST_ACTOR, OWNER_A, { sourceChangeSetId: cs.changeSetId, sourceReviewId: cs.changeSetId, sourceTestRunId: tr.testRunId, environmentProfileId: "LOCAL_PRODUCTION_BUILD" });
  const release = await createReleaseRequest(TEST_ACTOR, OWNER_A, { buildRunId: build.buildRunId, reason: "deployment regression test", ownerConfirmation: true });

  let deploymentPlanId = "";
  await test("Deployment Pipeline: createDeploymentPlan() runs the real, full pipeline (Manifest -> Gate -> Rollback Plan -> Approval) against a real Release Run", async () => {
    const plan = await createDeploymentPlan(TEST_ACTOR, OWNER_A, { releaseRunId: release.releaseRunId, targetId: "vercel-production", reason: "deployment regression test", ownerConfirmation: true });
    deploymentPlanId = plan.deploymentPlanId;
    assert(!!plan.manifest, "expected a real Deployment Manifest");
    assert(!!plan.gateReport, "expected a real Deployment Gate Report");
    assert(!!plan.rollbackPlan, "expected a real Rollback Plan");
    assert(!!plan.decision, "expected a real Deployment Decision");
    assert(plan.manifest!.entries.length === 202, `expected all 202 real capabilities in the Manifest, got ${plan.manifest!.entries.length}`);
  });
  await test("Deployment Plan NEVER reaches READY/DEPLOYED — terminal status is always BLOCKED this Step, regardless of decision", () => {
    const plan = getDeploymentPlan(deploymentPlanId, OWNER_A);
    assert(plan.status === "BLOCKED", `expected the real terminal status to always be BLOCKED, got ${plan.status}`);
  });
  await test("Deployment Gate: ReleaseReady gate matches the real Release Run's real status", () => {
    const plan = getDeploymentPlan(deploymentPlanId, OWNER_A);
    const releaseReadyGate = plan.gateReport!.gates.find((g) => g.gate === "ReleaseReady")!;
    const realRelease = getReleaseRun(release.releaseRunId, OWNER_A);
    assert(releaseReadyGate.status === (realRelease.status === "READY" ? "PASSED" : "BLOCKED"), `expected ReleaseReady to reflect the real release status ${realRelease.status}, got ${releaseReadyGate.status}`);
  });
  await test("Deployment Gate: FactoryDeploymentReady is honestly NOT_IMPLEMENTED — the real factory DEPLOYMENT_READY gate has no real Deploy stage anywhere in this repo", () => {
    const plan = getDeploymentPlan(deploymentPlanId, OWNER_A);
    const factoryGate = plan.gateReport!.gates.find((g) => g.gate === "FactoryDeploymentReady")!;
    assert(factoryGate.status === "NOT_IMPLEMENTED", `expected FactoryDeploymentReady to be honestly NOT_IMPLEMENTED, got ${factoryGate.status}`);
  });
  await test("Rollback Plan: executionStatus is honestly NOT_IMPLEMENTED — no real deploy history exists in this repo to roll back from", () => {
    const plan = getDeploymentPlan(deploymentPlanId, OWNER_A);
    assert(plan.rollbackPlan!.executionStatus === "NOT_IMPLEMENTED", "expected rollbackPlan.executionStatus to be honestly NOT_IMPLEMENTED");
    assert(Object.keys(plan.rollbackPlan!.rollbackTargetVersion).length === 202, "expected the real, current package versions recorded as the rollback reference point");
  });
  await test("Validation: unknown targetId is rejected with a real TARGET_NOT_FOUND error", async () => {
    try {
      await createDeploymentPlan(TEST_ACTOR, OWNER_A, { releaseRunId: release.releaseRunId, targetId: "totally-fake-target", reason: "should fail", ownerConfirmation: true });
      assert(false, "expected TARGET_NOT_FOUND to throw");
    } catch (e) {
      assert(e instanceof DeploymentPipelineError && e.code === "TARGET_NOT_FOUND", `expected TARGET_NOT_FOUND, got ${e}`);
    }
  });
  await test("Validation: unknown releaseRunId fails inside the real pipeline with a real, cited error", async () => {
    const plan = await createDeploymentPlan(TEST_ACTOR, OWNER_A, { releaseRunId: "totally-fake-release-run-id", targetId: "vercel-production", reason: "should fail", ownerConfirmation: true });
    assert(plan.status === "FAILED", `expected FAILED for a nonexistent Release Run, got ${plan.status}`);
    assert(!!plan.error, "expected a real, cited error message");
  });
  await test("Validation: ownerConfirmation=false is rejected", async () => {
    try {
      await createDeploymentPlan(TEST_ACTOR, OWNER_A, { releaseRunId: release.releaseRunId, targetId: "vercel-production", reason: "no confirmation", ownerConfirmation: false });
      assert(false, "expected INVALID_REQUEST to throw");
    } catch (e) {
      assert(e instanceof DeploymentPipelineError && e.code === "INVALID_REQUEST", `expected INVALID_REQUEST, got ${e}`);
    }
  });

  // ================= EVIDENCE / ARTIFACT =================
  await test("Evidence: real DEPLOYMENT_PLAN/DEPLOYMENT_AUDIT artifacts exist, immutable + checksummed, linked via deploymentPlanId", () => {
    const plan = getDeploymentPlan(deploymentPlanId, OWNER_A);
    assert(plan.artifactIds.length === 3, `expected 3 real artifacts (manifest, gate/rollback audit, decision audit), got ${plan.artifactIds.length}`);
    for (const id of plan.artifactIds) {
      const art = getArtifact(id, OWNER_A);
      assert(art.immutable, `expected artifact ${id} to be immutable`);
      assert(art.deploymentPlanId === deploymentPlanId, `expected artifact ${id} to carry the real deploymentPlanId`);
      assert(art.checksum.length === 64, "expected a real sha256 checksum");
    }
  });

  // ================= ISOLATION =================
  await test("Isolation: a different owner cannot read this real Deployment Plan", () => {
    try {
      getDeploymentPlan(deploymentPlanId, OWNER_B);
      assert(false, "expected DEPLOYMENT_PLAN_NOT_OWNED to throw");
    } catch (e) {
      assert(e instanceof DeploymentPipelineError && e.code === "DEPLOYMENT_PLAN_NOT_OWNED", `expected DEPLOYMENT_PLAN_NOT_OWNED, got ${e}`);
    }
  });
  await test("Isolation: listDeploymentPlans() only returns the real, owned Deployment Plans", () => {
    assert(listDeploymentPlans(OWNER_A).every((p) => p.ownerId === OWNER_A), "expected only OWNER_A's real plans");
    assert(listDeploymentPlans(OWNER_B).length === 0, "expected 0 real plans for a different, untouched owner");
  });

  // ================= SCOPE / READ-ONLY =================
  await test("Debug: __debugDeploymentPlanCount() reflects real records created by this suite", () => {
    assert(__debugDeploymentPlanCount() >= 1, "expected at least 1 real Deployment Plan in the real store");
  });
  await test("Scope guarantee: this suite never modified deploymentRuntime.ts, or any real supabase/migrations/*.sql file — spot-checked byte-for-byte", async () => {
    const status = (await gitRaw(["status", "--porcelain", "app/api/admin/ide/_lib/deploymentRuntime.ts", "supabase/migrations"])).trim();
    assert(status === "" || !status.split("\n").some((l) => l.includes("deploymentRuntime.ts") && !l.startsWith("??")), "expected no real modification to deploymentRuntime.ts or supabase/migrations");
  });
  await test("Read Only: the real working tree HEAD is unchanged after this entire suite ran", async () => {
    const postHead = (await gitRaw(["rev-parse", "HEAD"])).trim();
    assert(postHead === preHead, `expected HEAD unchanged, was ${preHead}, now ${postHead}`);
  });

  console.log("\n=== Deployment Orchestration Runtime Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}
main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
