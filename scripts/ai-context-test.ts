/**
 * AI Context Runtime Regression Suite (owner, 2026-08-08, Software
 * Factory Step 13) — verifies the real
 * app/api/admin/ide/_lib/aiContextRuntime.ts's provider-neutral Context
 * Package builder against real, approved Context Plans. Proves
 * cross-session isolation is a real, code-level guarantee, not
 * documentation.
 *
 * Run: npm run ai-context:test
 */
import { readFileSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { buildAIContextPackage, recordAIContextResult, getAIContextPackage, listAIContextPackages, AIContextError } from "../app/api/admin/ide/_lib/aiContextRuntime";
import type { WorkerType } from "../app/api/admin/ide/_lib/workerRegistry";
import { buildContextPlan, approveContextPlan } from "../app/api/admin/ide/_lib/contextPlannerRuntime";
import { resolveCapabilities } from "../app/api/admin/ide/_lib/capabilityResolverRuntime";
import { listWorkers } from "../app/api/admin/ide/_lib/workerRegistry";
import type { StructuredIntent } from "../app/api/admin/ide/_lib/intentRuntime";

const ROOT = path.join(__dirname, "..");
const TEST_ACTOR = "ai-context-regression-suite@dnaos.local";
const OWNER_A = "ai-context-regression-owner-a";
const OWNER_B = "ai-context-regression-owner-b";

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

function intentFor(problem: string): StructuredIntent {
  return { problem, desiredOutcome: problem, requestedChange: problem, affectedArea: [], constraints: [], nonGoals: [], expectedEvidence: [], acceptanceCriteria: [], ownerAuthority: "OWNER_CONFIRMED", riskTolerance: "LOW" };
}
function approvedPlan(ownerId: string, workspaceSessionId = randomUUID()) {
  const resolution = resolveCapabilities(intentFor("auto create a job when material and quantity info is missing"));
  const plan = buildContextPlan(workspaceSessionId, ownerId, TEST_ACTOR, resolution, []);
  return approveContextPlan(plan.contextPlanId, ownerId, TEST_ACTOR);
}

async function main() {
  await test("Context not approved: building a package from an un-approved Context Plan is rejected, never silently allowed", () => {
    const resolution = resolveCapabilities(intentFor("auto create a job when material and quantity info is missing"));
    const plan = buildContextPlan(randomUUID(), OWNER_A, TEST_ACTOR, resolution, []);
    let threw = false;
    try { buildAIContextPackage(plan, "CODE_WORKER", OWNER_A, TEST_ACTOR); } catch (e) { threw = e instanceof AIContextError && e.code === "CONTEXT_NOT_APPROVED"; }
    assert(threw, "expected CONTEXT_NOT_APPROVED for an un-approved Context Plan");
  });

  await test("Provider-neutral package: a real AIContextPackage carries a real provider string sourced from workerRegistry.ts, never hardcoded inline", () => {
    const plan = approvedPlan(OWNER_A);
    const pkg = buildAIContextPackage(plan, "CODE_WORKER", OWNER_A, TEST_ACTOR);
    const workers = listWorkers();
    const codeWorker = workers.find((w) => w.id === "CODE_WORKER")!;
    assert(pkg.provider === codeWorker.provider, "expected the package's provider to be sourced live from workerRegistry.ts, matching exactly");
  });

  await test("No cross-workspace leakage: two different Workspace Sessions produce packages with distinct contextFingerprints even given identical file content", () => {
    const planA = approvedPlan(OWNER_A);
    const planB = approvedPlan(OWNER_A); // same owner, different session, same real capability resolution -> same files
    const pkgA = buildAIContextPackage(planA, "CODE_WORKER", OWNER_A, TEST_ACTOR);
    const pkgB = buildAIContextPackage(planB, "CODE_WORKER", OWNER_A, TEST_ACTOR);
    assert(pkgA.workspaceSessionId !== pkgB.workspaceSessionId, "expected distinct real workspaceSessionId values");
    assert(pkgA.contextFingerprint !== pkgB.contextFingerprint, "expected distinct real contextFingerprint values even with identical file content — proves fingerprint is keyed to session, not just file content");
    assert(pkgA.isolationCheck.isolated === true && pkgB.isolationCheck.isolated === true, "expected both packages to self-report real isolation");
  });

  await test("Allowed tools: a real AIContextPackage's allowedTools is sourced from the real Worker Registry definition, never invented ad hoc", () => {
    const plan = approvedPlan(OWNER_A);
    const pkg = buildAIContextPackage(plan, "CODE_WORKER", OWNER_A, TEST_ACTOR);
    const codeWorker = listWorkers().find((w) => w.id === "CODE_WORKER")!;
    assert(JSON.stringify(pkg.allowedTools) === JSON.stringify(codeWorker.permittedTools), "expected allowedTools to exactly mirror the real Worker Registry's permittedTools");
  });

  await test("Expected output schema: a real, worker-type-specific schema string is set, never a generic placeholder for every worker", () => {
    const plan = approvedPlan(OWNER_A);
    const codePkg = buildAIContextPackage(plan, "CODE_WORKER", OWNER_A, TEST_ACTOR);
    const reviewPkg = buildAIContextPackage(plan, "REVIEW_WORKER", OWNER_A, TEST_ACTOR);
    assert(codePkg.expectedOutputSchema !== reviewPkg.expectedOutputSchema, "expected different real output schemas for different real Worker types");
  });

  await test("Context lineage: readScope/writeScope on the package are taken directly from the real, approved ContextPlan, never expanded", () => {
    const plan = approvedPlan(OWNER_A);
    const pkg = buildAIContextPackage(plan, "CODE_WORKER", OWNER_A, TEST_ACTOR);
    assert(JSON.stringify(pkg.readScope) === JSON.stringify(plan.permittedReadScope), "expected readScope to exactly equal the real ContextPlan.permittedReadScope");
    assert(JSON.stringify(pkg.writeScope) === JSON.stringify(plan.permittedWriteScope), "expected writeScope to exactly equal the real ContextPlan.permittedWriteScope");
  });

  await test("Provider state is not persisted as system truth: recordAIContextResult() only records evidence, never mutates workspaceSessionId/contextFingerprint", () => {
    const plan = approvedPlan(OWNER_A);
    const pkg = buildAIContextPackage(plan, "CODE_WORKER", OWNER_A, TEST_ACTOR);
    const before = { wsId: pkg.workspaceSessionId, fp: pkg.contextFingerprint };
    const updated = recordAIContextResult(pkg.packageId, OWNER_A, "real, disposable test output summary", ["evidence-id-1"]);
    assert(updated.workspaceSessionId === before.wsId && updated.contextFingerprint === before.fp, "expected workspaceSessionId/contextFingerprint to remain the real, original values after recording a result");
    assert(updated.result.status === "RECORDED" && updated.result.outputSummary === "real, disposable test output summary", "expected the real result to be recorded honestly, not fabricated");
  });

  await test("Owner isolation: an AI Context Package created for Owner A is not gettable by Owner B", () => {
    const plan = approvedPlan(OWNER_A);
    const pkg = buildAIContextPackage(plan, "CODE_WORKER", OWNER_A, TEST_ACTOR);
    let threw = false;
    try { getAIContextPackage(pkg.packageId, OWNER_B); } catch (e) { threw = e instanceof AIContextError && e.code === "PACKAGE_NOT_OWNED"; }
    assert(threw, "expected PACKAGE_NOT_OWNED for a cross-owner lookup");
    assert(!listAIContextPackages(OWNER_B).some((p) => p.packageId === pkg.packageId), "expected Owner B's list to never include Owner A's real package");
  });

  await test("Worker unavailable: requesting a package for a NOT_IMPLEMENTED Worker type is honestly rejected, never silently substituted", () => {
    const plan = approvedPlan(OWNER_A);
    let threw = false;
    try { buildAIContextPackage(plan, "NOT_A_REAL_WORKER" as unknown as WorkerType, OWNER_A, TEST_ACTOR); } catch (e) { threw = e instanceof AIContextError && e.code === "WORKER_UNAVAILABLE"; }
    assert(threw, "expected WORKER_UNAVAILABLE for an unknown/unregistered worker type");
  });

  await test("Cost honesty: no real per-request cost is fabricated — cost.amount stays null unless a real provider cost is captured", () => {
    const plan = approvedPlan(OWNER_A);
    const pkg = buildAIContextPackage(plan, "CODE_WORKER", OWNER_A, TEST_ACTOR);
    assert(pkg.cost.amount === null, "expected cost.amount to stay honestly null — no real cost-tracking exists for CODE_WORKER");
    assert(typeof pkg.cost.note === "string" && pkg.cost.note.length > 0, "expected a real, non-empty cost note explaining why");
  });

  await test("No direct database access: aiContextRuntime.ts contains no Supabase import — AI Context building is pure, local computation", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/aiContextRuntime.ts"), "utf-8");
    assert(!src.includes("@supabase/"), "expected zero @supabase/* imports in aiContextRuntime.ts");
  });

  console.log("\n=== AI Context Runtime Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
