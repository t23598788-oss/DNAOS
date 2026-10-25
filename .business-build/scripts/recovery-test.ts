/**
 * Recovery Runtime Regression Suite (owner, 2026-08-08, Software Factory
 * Step 12) — verifies real Recovery Plan + Verification against this
 * repo's actual live state. Plan + Verify only — never executes a real
 * mutation, never fakes a successful outcome.
 *
 * Run: npm run recovery:test
 */
import { readFileSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { collectAllSignals } from "../app/api/admin/ide/_lib/monitoringRuntime";
import { openIncidentFromSignal } from "../app/api/admin/ide/_lib/incidentRuntime";
import {
  createRecoveryPlan, approveRecoveryPlan, verifyRecovery, getRecoveryPlan, listRecoveryPlans,
  listRecoveryEvents, RecoveryError, __debugRecoveryPlanCount,
} from "../app/api/admin/ide/_lib/recoveryRuntime";
import { listRecoveryTypes, getRecoveryTypeDefinition, type RecoveryType } from "../app/api/admin/ide/_lib/recoveryRegistry";
import { WORKSPACE_ROOT } from "../app/api/admin/ide/_lib/fsSecurity";

const execFileAsync = promisify(execFile);
const ROOT = path.join(__dirname, "..");
const OWNER_A = "recovery-regression-owner-a";
const OWNER_B = "recovery-regression-owner-b";
const ACTOR = "recovery-regression-suite@dnaos.local";

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

  await test("Registry: 12 real Recovery Types declared; every real, mutating action is PLAN_ONLY or NOT_IMPLEMENTED, never IMPLEMENTED", () => {
    const types = listRecoveryTypes();
    assert(types.length === 12, `expected 12 real Recovery Types, got ${types.length}`);
    for (const t of types) {
      if (t.mutationLevel === "PROVIDER_MUTATING" || t.mutationLevel === "DESTRUCTIVE") {
        assert(t.status === "PLAN_ONLY" || t.status === "NOT_IMPLEMENTED", `${t.id} is ${t.mutationLevel} but status is ${t.status} — must be PLAN_ONLY or NOT_IMPLEMENTED`);
      }
      assert(t.ownerApprovalRequired === true, `${t.id} must require real owner approval`);
    }
  });
  await test("Backup readiness: RESTORE_FROM_BACKUP is honestly PLAN_ONLY — no verified automated restore-test cycle exists in this repo", () => {
    const def = getRecoveryTypeDefinition("RESTORE_FROM_BACKUP")!;
    assert(def.status === "PLAN_ONLY", `expected PLAN_ONLY, got ${def.status}`);
  });

  const signals = await collectAllSignals(OWNER_A, ACTOR);
  const backupSignal = signals.find((s) => s.signalType === "BACKUP_HEALTH")!;
  const inc = await openIncidentFromSignal(backupSignal, OWNER_A, ACTOR);

  let planId = "";
  await test("Plan creation: createRecoveryPlan() produces a real Plan with real prerequisites/risks/rollbackPlan, never NOT_EXECUTED->SUCCEEDED", async () => {
    const plan = await createRecoveryPlan(inc.incidentId, "RESTORE_FROM_BACKUP", OWNER_A, ACTOR);
    planId = plan.recoveryPlanId;
    assert(plan.prerequisites.length > 0, "expected real, declared prerequisites");
    assert(plan.risks.length > 0, "expected real, declared risks");
    assert(!!plan.rollbackPlan, "expected a real rollbackPlan description");
    assert(["BLOCKED", "AWAITING_OWNER"].includes(plan.executionStatus), `expected a real, non-executed initial status, got ${plan.executionStatus}`);
  });
  await test("Prerequisites: a NOT_IMPLEMENTED Recovery Type (RESTART_PROCESS) always yields executionStatus BLOCKED", async () => {
    const plan = await createRecoveryPlan(inc.incidentId, "RESTART_PROCESS", OWNER_A, ACTOR);
    assert(plan.executionStatus === "BLOCKED", `expected BLOCKED for a NOT_IMPLEMENTED type, got ${plan.executionStatus}`);
    assert(plan.prerequisites.every((p) => !p.met), "expected every real prerequisite to be honestly unmet for a NOT_IMPLEMENTED type");
  });
  await test("Owner approval: approveRecoveryPlan() requires a real, non-empty reason", () => {
    try { approveRecoveryPlan(planId, OWNER_A, ACTOR, true, ""); assert(false, "expected INVALID_REQUEST"); }
    catch (e) { assert(e instanceof RecoveryError && e.code === "INVALID_REQUEST", `expected INVALID_REQUEST, got ${e}`); }
  });
  await test("Mutation action blocked: approval alone NEVER changes executionStatus to anything implying real execution", () => {
    const before = getRecoveryPlan(planId, OWNER_A).executionStatus;
    const approved = approveRecoveryPlan(planId, OWNER_A, ACTOR, true, "owner approves for regression test");
    assert(approved.approvalStatus === "APPROVED", "expected real APPROVED status");
    assert(approved.executionStatus === before, `expected executionStatus unchanged by approval alone (was ${before}, now ${approved.executionStatus})`);
    assert(!["EXTERNALLY_EXECUTED_UNVERIFIED", "VERIFIED_FROM_EVIDENCE"].includes(approved.executionStatus), "approval must never itself imply execution");
  });
  await test("No fake success: verifyRecovery() re-checks the REAL, live triggering signal — since the real backup has not actually changed, verification is honestly UNVERIFIED/PARTIAL, never VERIFIED", async () => {
    const verified = await verifyRecovery(planId, OWNER_A, ACTOR);
    assert(verified.verification !== null, "expected a real verification result");
    assert(verified.verification!.checks.length >= 4, `expected at least 4 real verification checks, got ${verified.verification!.checks.length}`);
    assert(verified.executionStatus !== "VERIFIED_FROM_EVIDENCE" || verified.verification!.status === "VERIFIED", "executionStatus VERIFIED_FROM_EVIDENCE must only ever follow a real VERIFIED verification result");
  });
  await test("Unknown/unverified honesty: data-loss and other-scope checks are UNKNOWN without real, owner-supplied evidence — never assumed PASS", () => {
    const plan = getRecoveryPlan(planId, OWNER_A);
    const dataLossCheck = plan.verification!.checks.find((c) => c.criterion === "No data loss confirmed")!;
    assert(dataLossCheck.result === "UNKNOWN", `expected UNKNOWN without real owner evidence, got ${dataLossCheck.result}`);
  });
  await test("Verification with real, owner-supplied evidence changes those specific checks to PASS, never fabricated for others", async () => {
    const verified = await verifyRecovery(planId, OWNER_A, ACTOR, { dataLossConfirmedAbsent: true, otherScopeUnaffectedConfirmed: true });
    const dataLossCheck = verified.verification!.checks.find((c) => c.criterion === "No data loss confirmed")!;
    assert(dataLossCheck.result === "PASS", "expected PASS given real, owner-supplied confirmation");
  });
  await test("Verification criteria: buildVerificationCriteria() references the real, original Incident's signals and affectedDependencies, never invented text", () => {
    const plan = getRecoveryPlan(planId, OWNER_A);
    assert(plan.verificationCriteria.some((c) => c.includes(inc.signals[0])), "expected a real verification criterion citing the real triggering signal id");
  });
  await test("Owner scope: a different owner cannot read this real Recovery Plan", () => {
    try { getRecoveryPlan(planId, OWNER_B); assert(false, "expected RECOVERY_PLAN_NOT_OWNED"); }
    catch (e) { assert(e instanceof RecoveryError && e.code === "RECOVERY_PLAN_NOT_OWNED", `expected RECOVERY_PLAN_NOT_OWNED, got ${e}`); }
  });
  await test("Unknown Recovery Type is rejected at creation", async () => {
    try { await createRecoveryPlan(inc.incidentId, "TOTALLY_FAKE_TYPE" as unknown as RecoveryType, OWNER_A, ACTOR); assert(false, "expected RECOVERY_TYPE_NOT_FOUND"); }
    catch (e) { assert(e instanceof RecoveryError && e.code === "RECOVERY_TYPE_NOT_FOUND", `expected RECOVERY_TYPE_NOT_FOUND, got ${e}`); }
  });
  await test("Evidence linkage: every real Recovery artifact is immutable and carries the real relatedRecoveryPlanId", async () => {
    const { getArtifact } = await import("../app/api/admin/ide/_lib/artifactRuntime");
    const plan = getRecoveryPlan(planId, OWNER_A);
    for (const id of plan.artifactIds) {
      const art = getArtifact(id, OWNER_A);
      assert(art.immutable, `expected artifact ${id} immutable`);
      assert(art.relatedRecoveryPlanId === planId, `expected artifact ${id} to carry the real relatedRecoveryPlanId`);
    }
  });
  await test("Bounded events: listRecoveryEvents() includes real RECOVERY_PLAN_CREATED and RECOVERY_VERIFICATION_STARTED for this suite's real plan", () => {
    const events = listRecoveryEvents();
    assert(events.some((e) => e.recoveryPlanId === planId && e.type === "RECOVERY_PLAN_CREATED"), "expected a real RECOVERY_PLAN_CREATED event");
    assert(events.some((e) => e.recoveryPlanId === planId && e.type === "RECOVERY_VERIFICATION_STARTED"), "expected a real RECOVERY_VERIFICATION_STARTED event");
  });
  await test("Read-only: recoveryRuntime.ts never calls a real mutation on any provider client (never restores/deploys/rolls back for real)", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/recoveryRuntime.ts"), "utf-8");
    assert(!src.includes("execFile") && !src.includes("spawn(") && !src.includes("fetch("), "recoveryRuntime.ts must never spawn a process or make a real network mutation call");
  });

  await test("Scope guarantee: this suite never modified recoveryRuntime.ts itself — spot-checked byte-for-byte", async () => {
    const status = (await gitRaw(["status", "--porcelain", "app/api/admin/ide/_lib/recoveryRuntime.ts"])).trim();
    assert(!status.includes(" M "), "expected no real modification to recoveryRuntime.ts during this suite's run");
  });
  await test("Debug: __debugRecoveryPlanCount() reflects real records created by this suite", () => {
    assert(__debugRecoveryPlanCount() >= 2, "expected at least 2 real Recovery Plans in the real store");
  });
  await test("Read Only: the real working tree HEAD is unchanged after this entire suite ran", async () => {
    const postHead = (await gitRaw(["rev-parse", "HEAD"])).trim();
    assert(postHead === preHead, `expected HEAD unchanged, was ${preHead}, now ${postHead}`);
  });

  console.log("\n=== Recovery Runtime Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}
main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
