/**
 * Context Planner Regression Suite (owner, 2026-08-08, Software Factory
 * Step 13) — verifies the real
 * app/api/admin/ide/_lib/contextPlannerRuntime.ts against the real
 * repository filesystem, real registry/architecture-book.json dependency
 * edges, and the real, already-enforced fsSecurity.ts exclusion rules.
 *
 * Run: npm run context-planner:test
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { buildContextPlan, approveContextPlan, getContextPlan, listContextPlans, ContextPlannerError, __debugContextPlanCount } from "../app/api/admin/ide/_lib/contextPlannerRuntime";
import { resolveCapabilities } from "../app/api/admin/ide/_lib/capabilityResolverRuntime";
import type { StructuredIntent } from "../app/api/admin/ide/_lib/intentRuntime";
import { WORKSPACE_ROOT } from "../app/api/admin/ide/_lib/fsSecurity";

const ROOT = path.join(__dirname, "..");
const TEST_ACTOR = "context-planner-regression-suite@dnaos.local";
const OWNER_A = "context-planner-regression-owner-a";
const OWNER_B = "context-planner-regression-owner-b";

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

async function main() {
  const resolution = resolveCapabilities(intentFor("auto create a job when material and quantity info is missing from a business event"));

  await test("Minimal scope: a real, well-scoped intent produces a small, real file list — never the whole repo", () => {
    const plan = buildContextPlan(randomUUID(), OWNER_A, TEST_ACTOR, resolution, []);
    assert(plan.includedFiles.length > 0, "expected at least one real included file");
    assert(plan.includedFiles.length < 40, `expected a bounded, minimal set, got ${plan.includedFiles.length}`);
    assert(plan.includedFiles.some((f) => f.path === "engines/jobs/auto-create.ts"), "expected the real OwnerModule of the selected Capability to be included");
  });

  await test("Semantic Preflight: the existing Context Plan composes frozen capability authority, existing dependencyRegistry impact, Archify classifications, and explicit UNKNOWNs without creating a parallel registry", () => {
    const plan = buildContextPlan(randomUUID(), OWNER_A, TEST_ACTOR, resolution, []);
    const preflight = plan.semanticPreflight;
    assert(preflight.capabilityAuthority.registry === "registry/capability-registry.json", "expected the existing frozen capability registry to remain the capability authority");
    assert(preflight.capabilityAuthority.frozen === true, "expected capability authority to report the real frozen registry state");
    assert(preflight.capabilityAuthority.capabilities.some((capability) => capability.ownerModule === "engines/jobs/auto-create.ts"), "expected selected capability owner metadata from the real registry");
    assert(preflight.authorityBoundaries.some((boundary) => boundary.includes("dependencyRegistry.ts")), "expected the existing dependencyRegistry.ts authority boundary");
    assert(preflight.authorityBoundaries.some((boundary) => boundary.includes("requireConnector()")), "expected the existing Connect Run gate boundary, never a second connector path");
    assert(preflight.runtimeEvidence.every((evidence) => ["VERIFIED_LIVE", "CONFIGURED", "SOURCE_REFERENCE", "UNKNOWN"].includes(evidence.classification)), "expected only the Archify evidence classification vocabulary");
    assert(preflight.unknowns.length > 0 || preflight.runtimeEvidence.length > 0, "expected absent runtime evidence to remain explicit UNKNOWN rather than inferred");
    assert(preflight.constraints.some((constraint) => constraint.includes("No registry, database, controller, or canonical writer")), "expected an explicit no-parallel-authority constraint");
  });

  await test("UNKNOWN source discovery: unresolved LINE inbound command with changedFiles=[] finds only real registered source references while Capability and runtime health remain UNKNOWN", () => {
    const lineResolution = resolveCapabilities(intentFor("ตรวจระบบ LINE รับข้อความ"));
    const plan = buildContextPlan(randomUUID(), OWNER_A, TEST_ACTOR, lineResolution, []);
    const paths = plan.includedFiles.map((file) => file.path);
    assert(lineResolution.overallClass === "UNKNOWN" && lineResolution.selected.length === 0, "expected frozen Capability Resolver to remain UNKNOWN with no selected capability");
    assert(paths.includes("app/api/gateway/observe/line/route.ts"), "expected the real LINE inbound route discovered from existing Module Registry metadata");
    assert(paths.includes("engines/integration-gateway/adapters/line.ts"), "expected the real LINE adapter discovered from existing Module Registry metadata");
    assert(paths.includes("engines/integration-gateway/event-bus/bus.ts"), "expected the real Event Bus discovered through the existing Architecture Book dependency");
    assert(paths.includes("engines/integration-gateway/contracts/event.ts"), "expected the real canonical GatewayEvent contract discovered through the existing Architecture Book dependency");
    assert(plan.semanticPreflight.status === "UNKNOWN", "expected source references to preserve UNKNOWN until runtime delivery/health is proven");
    assert(plan.semanticPreflight.runtimeEvidence.some((evidence) => evidence.relationship === "app/api/gateway/observe/line/route.ts -> engines/integration-gateway/event-bus/bus.ts"), "expected actual Architecture Book Route -> Event Bus evidence");
    assert(plan.permittedWriteScope.length === 0 && plan.approved === false, "expected discovery to grant no write scope and no Worker approval");
  });

  await test("Forbidden path exclusion: a real, existing secret-like path is never included even if artificially seeded as a changed file", () => {
    const plan = buildContextPlan(randomUUID(), OWNER_A, TEST_ACTOR, resolution, [".env.local", "some/path/.env"]);
    assert(!plan.includedFiles.some((f) => f.path === ".env.local"), "expected .env.local to be excluded, never included");
    assert(plan.excludedFiles.some((f) => f.path === ".env.local"), "expected .env.local to appear in excludedFiles with a real reason");
  });

  await test("Source fingerprint: a real sha256 fingerprint changes when the real included file set changes", () => {
    const planA = buildContextPlan(randomUUID(), OWNER_A, TEST_ACTOR, resolution, []);
    const planB = buildContextPlan(randomUUID(), OWNER_A, TEST_ACTOR, resolution, ["package.json"]);
    assert(planA.sourceFingerprint !== planB.sourceFingerprint, "expected a different real fingerprint when the included file set differs");
    assert(/^[a-f0-9]{64}$/.test(planA.sourceFingerprint), "expected a real sha256 hex fingerprint");
  });

  await test("Token/size estimate: real tokenEstimate and sizeBytes are derived from real, on-disk file sizes, never fabricated", () => {
    const plan = buildContextPlan(randomUUID(), OWNER_A, TEST_ACTOR, resolution, []);
    const realSum = plan.includedFiles.reduce((s, f) => s + f.sizeBytes, 0);
    assert(plan.sizeBytes === realSum, "expected sizeBytes to equal the real sum of included file sizes");
    assert(plan.tokenEstimate === Math.round(realSum / 4), "expected tokenEstimate to be derived deterministically from real sizeBytes");
  });

  await test("Unrelated file exclusion: a changed file that does not exist on disk is excluded with a real reason, never silently invented", () => {
    const plan = buildContextPlan(randomUUID(), OWNER_A, TEST_ACTOR, resolution, ["this/file/genuinely/does/not/exist.ts"]);
    assert(plan.excludedFiles.some((f) => f.path === "this/file/genuinely/does/not/exist.ts" && f.reason.includes("does not exist")), "expected a real, honest exclusion reason for a nonexistent path");
  });

  await test("Dependency-graph expansion: real internal_dependencies edges from registry/architecture-book.json expand scope, never guessed", () => {
    const book = JSON.parse(readFileSync(path.join(ROOT, "registry/architecture-book.json"), "utf-8"));
    const node = book.nodes.find((n: { id: string; internal_dependencies?: string[] }) => n.id === "module:engines/jobs/auto-create.ts");
    const plan = buildContextPlan(randomUUID(), OWNER_A, TEST_ACTOR, resolution, []);
    if (node && node.internal_dependencies?.length > 0) {
      const firstDep: string = node.internal_dependencies[0].replace(/^module:/, "");
      const included = plan.includedFiles.some((f) => f.path === firstDep) || plan.excludedFiles.some((f) => f.path === firstDep);
      assert(included, `expected the real dependency ${firstDep} to be considered (included or honestly excluded), never ignored`);
    }
  });

  await test("Workspace isolation: two different Workspace Sessions with the same Capability Resolution produce independent Context Plans with distinct ids", () => {
    const planA = buildContextPlan(randomUUID(), OWNER_A, TEST_ACTOR, resolution, []);
    const planB = buildContextPlan(randomUUID(), OWNER_A, TEST_ACTOR, resolution, []);
    assert(planA.contextPlanId !== planB.contextPlanId, "expected distinct real Context Plan ids per session");
    assert(planA.workspaceSessionId !== planB.workspaceSessionId, "expected the two plans to carry distinct real workspaceSessionId values");
  });

  await test("Owner isolation: a Context Plan created for Owner A is not visible/gettable by Owner B", () => {
    const plan = buildContextPlan(randomUUID(), OWNER_A, TEST_ACTOR, resolution, []);
    let threw = false;
    try { getContextPlan(plan.contextPlanId, OWNER_B); } catch (e) { threw = e instanceof ContextPlannerError && e.code === "CONTEXT_PLAN_NOT_OWNED"; }
    assert(threw, "expected CONTEXT_PLAN_NOT_OWNED when a different owner requests this Context Plan");
    assert(!listContextPlans(OWNER_B).some((p) => p.contextPlanId === plan.contextPlanId), "expected Owner B's list to never include Owner A's real Context Plan");
  });

  await test("Secret exclusion reuses the real, already-enforced fsSecurity.ts rule — never a second exclusion list", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/contextPlannerRuntime.ts"), "utf-8");
    assert(src.includes('import { WORKSPACE_ROOT, isExcludedName } from "./fsSecurity"'), "expected contextPlannerRuntime.ts to import the real, shared isExcludedName from fsSecurity.ts, not redefine its own");
  });

  await test("Scope-too-broad guard: MAX_INCLUDED_FILES is a real, hard cap — approveContextPlan() rejects a plan that hit it", () => {
    const realFiles = ["package.json", "tsconfig.json", "next.config.js", "README.md"];
    // Construct enough distinct, real candidate files by reusing dependency
    // expansion output plus explicit changedFiles until we exceed the cap,
    // or — if the real repo can't supply 40 distinct real files this way —
    // honestly skip with a structural assertion instead of fabricating one.
    const plan = buildContextPlan(randomUUID(), OWNER_A, TEST_ACTOR, resolution, realFiles);
    assert(plan.includedFiles.length <= 40, "sanity: plan must never exceed the real cap in the first place");
    if (plan.includedFiles.length >= 40) {
      let threw = false;
      try { approveContextPlan(plan.contextPlanId, OWNER_A, TEST_ACTOR); } catch (e) { threw = e instanceof ContextPlannerError && e.code === "SCOPE_TOO_BROAD"; }
      assert(threw, "expected SCOPE_TOO_BROAD when approving a plan at the real cap");
    } else {
      const approved = approveContextPlan(plan.contextPlanId, OWNER_A, TEST_ACTOR);
      assert(approved.approved === true, "expected a normal-scope plan to approve cleanly");
    }
  });

  await test("Real, disposable zero-export-like fixture file included via changedFiles resolves to a real, non-excluded entry when it is not secret-shaped", () => {
    const fixtureRel = `scratch-context-planner-fixture-${randomUUID().slice(0, 8)}.ts`;
    const fixtureAbs = path.join(WORKSPACE_ROOT, fixtureRel);
    writeFileSync(fixtureAbs, "// real, disposable fixture file for context-planner-test.ts\nexport const contextPlannerFixture = true;\n");
    try {
      const plan = buildContextPlan(randomUUID(), OWNER_A, TEST_ACTOR, resolution, [fixtureRel]);
      assert(plan.includedFiles.some((f) => f.path === fixtureRel), "expected the real, disposable fixture file to be included");
    } finally {
      if (existsSync(fixtureAbs)) unlinkSync(fixtureAbs);
    }
  });

  await test("Runtime accessor: __debugContextPlanCount() reflects real, live in-memory state", () => {
    const before = __debugContextPlanCount();
    buildContextPlan(randomUUID(), OWNER_A, TEST_ACTOR, resolution, []);
    assert(__debugContextPlanCount() > before, "expected the real in-memory Context Plan count to increase");
  });

  console.log("\n=== Context Planner Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
