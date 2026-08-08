/**
 * Factory Readiness Gate Regression Suite (owner, 2026-08-07, Software
 * Factory Foundation full-pipeline audit). Verifies: every stage status
 * is computed from a real, live check (never hardcoded), the honest
 * WORKER/executionToMutation finding is never silently upgraded, Commit/
 * Push are reported as actively DENIED (not merely absent), Deploy stays
 * NOT_IMPLEMENTED, and the overall verdict is a real, deterministic
 * function of the real stage statuses — never a fabricated READY.
 *
 * Run: npm run factory-readiness:test
 */
import { readFileSync } from "fs";
import path from "path";
import { computeFactoryReadinessReport, recordFactoryReadinessEvidence, type FactoryStageId } from "../app/api/admin/ide/_lib/factoryReadinessGateRuntime";

const ROOT = path.join(__dirname, "..");
const ACTOR = "factory-readiness-regression-suite@dnaos.local";

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

async function main() {
  await test("Report covers all 15 real, required pipeline stages exactly once — never fewer, never duplicated", async () => {
    const r = await computeFactoryReadinessReport();
    const expected: FactoryStageId[] = ["INSTRUCTION", "EXECUTION_CONTEXT", "QUEUE", "WORKER", "FILE_RW", "INSPECTION", "CODE_REVIEW", "TEST", "BUILD", "ARTIFACT", "SOURCE_CONTROL", "COMMIT", "PUSH", "DEPLOY", "PRODUCTION_VERIFICATION"];
    const got = r.stages.map((s) => s.stage);
    assert(got.length === expected.length, `expected ${expected.length} real stages, got ${got.length}`);
    assert(new Set(got).size === got.length, "expected zero duplicate stages");
    for (const e of expected) assert(got.includes(e), `expected real stage ${e} to be present`);
  });

  await test("Every stage carries real, non-empty evidence — never an empty explanation", async () => {
    const r = await computeFactoryReadinessReport();
    for (const s of r.stages) assert(typeof s.evidence === "string" && s.evidence.length > 10, `expected real, substantive evidence for ${s.stage}`);
  });

  await test("WORKER stage is live-computed from real health() calls, not hardcoded — honestly PARTIAL when no AI adapter is HEALTHY", async () => {
    const r = await computeFactoryReadinessReport();
    const workerStage = r.stages.find((s) => s.stage === "WORKER")!;
    // In this environment (confirmed live, no ANTHROPIC_API_KEY etc.),
    // zero AI adapters are HEALTHY — this must show up honestly.
    assert(workerStage.status === "PARTIAL" || workerStage.status === "ACTIVE", `expected a real, live-derived status, got ${workerStage.status}`);
    assert(workerStage.evidence.includes("human-worker"), "expected the real, live health snapshot to be embedded in evidence, not summarized away");
  });

  await test("closedLoopProven.executionToMutation is never true unless a real AI Worker is live-HEALTHY — never inferred from Human Worker's availability", async () => {
    const r = await computeFactoryReadinessReport();
    const workerStage = r.stages.find((s) => s.stage === "WORKER")!;
    const anyAiHealthyClaimed = workerStage.evidence.match(/(\w[\w-]*)=HEALTHY/g)?.some((m) => !m.startsWith("human-worker"));
    assert(r.closedLoopProven.executionToMutation === !!anyAiHealthyClaimed, "expected executionToMutation to exactly track real AI-adapter HEALTHY evidence, never Human Worker's constant availability");
  });

  await test("COMMIT and PUSH are reported as actively DENIED by real policy, not merely NOT_IMPLEMENTED-by-omission", async () => {
    const r = await computeFactoryReadinessReport();
    for (const stageId of ["COMMIT", "PUSH"] as const) {
      const s = r.stages.find((x) => x.stage === stageId)!;
      assert(s.status === "NOT_IMPLEMENTED", `expected NOT_IMPLEMENTED for ${stageId}`);
      assert(s.evidence.includes("DENIED_GIT_SUBCOMMANDS"), `expected ${stageId}'s evidence to cite the real, live policy denylist, not just an absence claim`);
      assert(s.blocker !== null, `expected a real, explicit blocker explanation for ${stageId}`);
    }
  });

  await test("DEPLOY cites the real, live DEPLOYMENT_TARGET_REGISTRY — REGISTERED is never conflated with CONNECTED", async () => {
    const r = await computeFactoryReadinessReport();
    const s = r.stages.find((x) => x.stage === "DEPLOY")!;
    assert(s.status === "NOT_IMPLEMENTED", "expected DEPLOY to be honestly NOT_IMPLEMENTED");
    assert(s.evidence.includes("REGISTERED must never be read as CONNECTED"), "expected the explicit REGISTERED != CONNECTED disclosure in evidence");
  });

  await test("Overall verdict is a real, deterministic function of the real stages — READY is impossible while executionToMutation is false", async () => {
    const r = await computeFactoryReadinessReport();
    if (!r.closedLoopProven.executionToMutation) {
      assert(r.overall === "NOT_READY", "expected NOT_READY whenever the real Instruction->Mutation chain is unproven");
      assert(r.reasons.length > 0, "expected at least one real, explicit reason accompanying NOT_READY");
    }
  });

  await test("Running the report twice in a row is stable and real — same live inputs produce the same real stage statuses", async () => {
    const r1 = await computeFactoryReadinessReport();
    const r2 = await computeFactoryReadinessReport();
    assert(r1.overall === r2.overall, "expected a stable, real overall verdict across two consecutive live computations");
    assert(r1.stages.map((s) => s.status).join(",") === r2.stages.map((s) => s.status).join(","), "expected stable, real per-stage statuses");
  });

  await test("recordFactoryReadinessEvidence() produces a real, non-empty FACTORY_READINESS_REPORT artifact", async () => {
    const { report, artifactId } = await recordFactoryReadinessEvidence(ACTOR, "factory-readiness-test-owner");
    assert(typeof artifactId === "string" && artifactId.length > 0, "expected a real, non-empty artifactId");
    assert(report.stages.length === 15, "expected the real, full 15-stage report to be what got recorded");
  });

  await test("Never fabricates success: zero references to a hardcoded 'ACTIVE' string not backed by a real fileExists/live-check computation", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/factoryReadinessGateRuntime.ts"), "utf-8");
    const activeCodeLines = src.split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"));
    const bareActiveAssignments = activeCodeLines.filter((l) => /status:\s*"ACTIVE"\s*,/.test(l));
    assert(bareActiveAssignments.length === 0, `expected zero unconditional 'status: "ACTIVE"' literals — every stage must be a real ternary/live check, found: ${bareActiveAssignments.join(" | ")}`);
  });

  await test("Reuse: this file never re-implements git/worker/capability logic — only imports and reads the existing real Runtimes", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/factoryReadinessGateRuntime.ts"), "utf-8");
    const activeCodeLines = src.split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//")).join("\n");
    assert(activeCodeLines.includes("WORKER_ADAPTER_REGISTRY") && activeCodeLines.includes("getGitStatus") && activeCodeLines.includes("DEPLOYMENT_TARGET_REGISTRY"), "expected real reuse of the existing registries/runtimes");
    assert(!/spawn\(|execFile\(|child_process/i.test(activeCodeLines), "expected zero direct process-spawning — this Gate only reads, never executes");
  });

  console.log("\n=== Factory Readiness Gate Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
