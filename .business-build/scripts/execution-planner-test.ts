/**
 * Execution Planner Acceptance Suite (owner, 2026-08-10,
 * registry/TASK_QUEUE.json TASK-064). Proves, against the real, running
 * executionPlannerRuntime.ts and its real, comment-stripped source — never
 * mocked — every acceptance requirement named for this task:
 *
 *  1. The Owner's own worked example ("สร้างระบบเชื่อม Gemini Spark")
 *     real-decomposes into the exact 8 real, ordered steps named by the
 *     Owner (analyze, find capability, find registry, find dependency,
 *     create adapter, verify, update reality, report), with real
 *     dependency chaining — step N+1's real dependencies[0] is step N's
 *     real task_id, never a flat/unordered list.
 *  2. A STRUCTURAL test proving executionPlannerRuntime.ts's real code
 *     (comments stripped) never contains the literal strings
 *     "classifyCapability", "submitGateInput", "attemptDispatch",
 *     "WORKER_IDENTITIES", or "TEAM_ORGANIZATION" — the isolation scope
 *     limit is real, not just described in a comment.
 *  3. A positive-control import-scan proving the file really imports
 *     StructuredIntent from ./intentRuntime (never a competing local type).
 *  4. A test proving zero writeFileSync calls anywhere (pure compute, no
 *     side effects).
 *  5. Genuine-decomposition proof: a real, non-matching command produces a
 *     different, shorter GENERIC plan — proving this is not a hardcoded
 *     string match that ignores its real input.
 *  6. Real evidence-reality-check proof: fabricated evidence paths are
 *     really dropped, real, existing repo files are really kept.
 *
 * Run: npm run execution-planner:test
 */
import { readFileSync } from "fs";
import path from "path";
import { planExecution, type TaskPlan } from "../app/api/admin/ide/_lib/executionPlannerRuntime";
import type { StructuredIntent } from "../app/api/admin/ide/_lib/intentRuntime";
import { WORKSPACE_ROOT } from "../app/api/admin/ide/_lib/fsSecurity";

const ROOT = WORKSPACE_ROOT;

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
function test(name: string, fn: () => void) {
  try { fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

/** Same convention scripts/dead-end-sweep-test.ts / scripts/architecture-
 * summary-test.ts already use: strip comments before a structural "must
 * not construct X" check, so this file's own real, honest header-comment
 * prose (which necessarily names the very tokens it explains staying away
 * from) is never mistaken for the runtime file actually doing it. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
}

function makeBaseIntent(overrides: Partial<StructuredIntent> = {}): StructuredIntent {
  return {
    problem: "DNA OS ยังไม่มีการเชื่อมต่อกับ Gemini Spark จริง",
    desiredOutcome: "ระบบเชื่อมต่อกับ Gemini Spark ทำงานได้จริง มีหลักฐานตรวจสอบได้จริง",
    requestedChange: "สร้างระบบเชื่อม Gemini Spark",
    affectedArea: ["app/api/admin/ide/_lib"],
    constraints: ["ห้ามสมมติว่ามี public API ควบคุมเครื่อง Mac ของ Gemini Spark จริง"],
    nonGoals: ["ไม่ wire เข้ากับ classifyCapability ในงานนี้"],
    expectedEvidence: [
      "app/api/admin/ide/_lib/intentRuntime.ts",
      "app/api/admin/ide/_lib/switchBasedOrchestratorRuntime.ts",
    ],
    acceptanceCriteria: ["แผนงานมี 8 ขั้นตอนจริง พร้อม dependency chaining จริง"],
    ownerAuthority: "OWNER_CONFIRMED",
    riskTolerance: "MEDIUM",
    ...overrides,
  };
}

function assertRealChain(plan: TaskPlan, expectedLength: number) {
  assert(plan.steps.length === expectedLength, `expected ${expectedLength} real steps, got ${plan.steps.length}`);
  const ids = new Set(plan.steps.map((s) => s.task_id));
  assert(ids.size === plan.steps.length, `expected ${plan.steps.length} unique real task_id values, got ${ids.size} unique of ${plan.steps.length}`);
  assert(plan.steps[0].dependencies.length === 0, `expected step 1 to have zero real dependencies, got ${JSON.stringify(plan.steps[0].dependencies)}`);
  assert(plan.steps[0].state === "READY", `expected step 1 state=READY, got ${plan.steps[0].state}`);
  for (let i = 1; i < plan.steps.length; i++) {
    const prev = plan.steps[i - 1];
    const cur = plan.steps[i];
    assert(cur.dependencies.length === 1, `expected step ${i + 1} to have exactly 1 real dependency, got ${JSON.stringify(cur.dependencies)}`);
    assert(cur.dependencies[0] === prev.task_id, `expected step ${i + 1}'s real dependency to be step ${i}'s real task_id (${prev.task_id}), got ${cur.dependencies[0]}`);
    assert(cur.state === "BLOCKED", `expected step ${i + 1} state=BLOCKED (its real dependency is not really DONE), got ${cur.state}`);
    assert(cur.stepIndex === i + 1, `expected step ${i + 1}'s real stepIndex to be ${i + 1}, got ${cur.stepIndex}`);
  }
}

function main() {
  const runtimeSrc = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/executionPlannerRuntime.ts"), "utf-8");
  const codeOnly = stripComments(runtimeSrc);

  console.log("=== Execution Planner — real, live captured output ===");
  const ownerPlan = planExecution("สร้างระบบเชื่อม Gemini Spark", makeBaseIntent());
  console.log(`patternKind: ${ownerPlan.patternKind}`);
  console.log(`subject: ${ownerPlan.subject}`);
  console.log(`steps: ${ownerPlan.steps.map((s) => `${s.stepIndex}:${s.capability}`).join(" -> ")}`);

  // ============================================================
  // 1 — Owner's own worked example: 8 real, ordered steps, real chaining.
  // ============================================================
  test("Acceptance 1a — 'สร้างระบบเชื่อม Gemini Spark' real-classifies as BUILD_INTEGRATION and real-extracts subject 'Gemini Spark'", () => {
    assert(ownerPlan.patternKind === "BUILD_INTEGRATION", `expected patternKind=BUILD_INTEGRATION, got ${ownerPlan.patternKind}`);
    assert(ownerPlan.subject === "Gemini Spark", `expected subject="Gemini Spark", got "${ownerPlan.subject}"`);
  });

  test("Acceptance 1b — real-decomposes into exactly the Owner's named 8 ordered steps with real dependency chaining (step N+1 depends on step N's real task_id, not a flat/unordered list)", () => {
    assertRealChain(ownerPlan, 8);
  });

  test("Acceptance 1c — each of the 8 real steps' capability string matches the Owner's own named step, IN ORDER: analyze, find capability, find registry, find dependency, create adapter, verify, update reality, report", () => {
    const expectedKeywords = ["analy", "capability", "registry", "dependency", "adapter", "verif", "reality", "report"];
    expectedKeywords.forEach((kw, i) => {
      const step = ownerPlan.steps[i];
      assert(step.capability.toLowerCase().includes(kw), `expected step ${i + 1}'s real capability to mention "${kw}", got "${step.capability}"`);
      assert(step.capability.includes("Gemini Spark"), `expected step ${i + 1}'s real capability to reference the real, extracted subject "Gemini Spark", got "${step.capability}"`);
    });
  });

  test("Acceptance 1d — every real step carries a non-empty real lock_scope drawn from StructuredIntent.affectedArea, and non-empty input_evidence drawn from real, verified StructuredIntent.expectedEvidence entries", () => {
    for (const step of ownerPlan.steps) {
      assert(step.lock_scope.length > 0, `expected non-empty real lock_scope for step ${step.stepIndex}, got ${JSON.stringify(step.lock_scope)}`);
      assert(step.input_evidence.length > 0, `expected non-empty real input_evidence for step ${step.stepIndex} (2 real, existing files were supplied), got ${JSON.stringify(step.input_evidence)}`);
      assert(step.input_evidence.every((e) => e === "app/api/admin/ide/_lib/intentRuntime.ts" || e === "app/api/admin/ide/_lib/switchBasedOrchestratorRuntime.ts"), `expected only the 2 real, verified evidence paths, got ${JSON.stringify(step.input_evidence)}`);
    }
  });

  // ============================================================
  // 2 — STRUCTURAL: isolation scope limit is real, not just described.
  // ============================================================
  test("Structural 2 — executionPlannerRuntime.ts's real code (comments stripped) never contains the literal strings 'classifyCapability', 'submitGateInput', 'attemptDispatch', 'WORKER_IDENTITIES', or 'TEAM_ORGANIZATION'", () => {
    const banned = ["classifyCapability", "submitGateInput", "attemptDispatch", "WORKER_IDENTITIES", "TEAM_ORGANIZATION"];
    for (const token of banned) {
      assert(!codeOnly.includes(token), `VIOLATION: found banned token "${token}" in executionPlannerRuntime.ts's real, comment-stripped code — isolation scope limit broken`);
    }
    // test-integrity: prove the header comment DOES honestly name these
    // tokens (so we know stripComments() is really doing its job, not
    // just vacuously passing because the raw source never mentions them).
    for (const token of banned) {
      assert(runtimeSrc.includes(token), `test-integrity: expected the RAW (unstripped) source to mention "${token}" in its own disclosure comment`);
    }
  });

  // ============================================================
  // 3 — positive-control: real reuse of StructuredIntent, never a
  // competing parallel type.
  // ============================================================
  test("Structural 3 — executionPlannerRuntime.ts really IMPORTS StructuredIntent from ./intentRuntime (type-only) and defines ZERO competing local StructuredIntent type", () => {
    assert(/import\s+type\s*\{[^}]*StructuredIntent[^}]*\}\s*from\s*["']\.\/intentRuntime["']/.test(runtimeSrc), "expected a real `import type { StructuredIntent } from \"./intentRuntime\"`");
    assert(!/interface\s+StructuredIntent\b/.test(codeOnly), "expected NO local `interface StructuredIntent` redefinition in real code");
    assert(!/type\s+StructuredIntent\s*=/.test(codeOnly), "expected NO local `type StructuredIntent =` redefinition in real code");
  });

  test("Structural 3b — executionPlannerRuntime.ts really IMPORTS WorkItem/WorkItemState from ./switchBasedOrchestratorRuntime (type-only) and derives PlannedWorkItem via Pick<WorkItem, ...> rather than a hand-copied field list", () => {
    assert(/import\s+type\s*\{[^}]*WorkItem[^}]*\}\s*from\s*["']\.\/switchBasedOrchestratorRuntime["']/.test(runtimeSrc), "expected a real `import type { WorkItem, ... } from \"./switchBasedOrchestratorRuntime\"`");
    assert(/Pick<\s*WorkItem\s*,/.test(codeOnly), "expected PlannedWorkItem to be derived via Pick<WorkItem, ...>");
  });

  // ============================================================
  // 4 — zero writeFileSync calls anywhere (pure compute, no side effects).
  // ============================================================
  test("Structural 4 — executionPlannerRuntime.ts contains ZERO writeFileSync calls anywhere in its real code (comments stripped — this file's own header comment legitimately mentions the word 'writeFileSync' in prose while describing this very test)", () => {
    assert(!/writeFileSync/.test(codeOnly), "expected zero real writeFileSync calls in executionPlannerRuntime.ts's real, comment-stripped code");
  });

  // ============================================================
  // 5 — genuine decomposition: a real, non-matching command produces a
  // real, different, shorter GENERIC plan — never a hardcoded 8-step reply
  // regardless of input.
  // ============================================================
  test("Acceptance 5 — a real command that does NOT match the build+connect shape ('ตรวจสอบสถานะระบบทั้งหมด' — check the whole system's status) real-classifies as GENERIC and produces a real, different 3-step plan, proving the decomposition genuinely depends on real input rather than being a hardcoded string match", () => {
    const genericIntent = makeBaseIntent({
      requestedChange: "ตรวจสอบสถานะระบบทั้งหมด",
      desiredOutcome: "รู้สถานะจริงของระบบทั้งหมด",
    });
    const plan = planExecution("ตรวจสอบสถานะระบบทั้งหมด", genericIntent);
    assert(plan.patternKind === "GENERIC", `expected patternKind=GENERIC, got ${plan.patternKind}`);
    assert(plan.steps.length === 3, `expected 3 real steps for the GENERIC template, got ${plan.steps.length}`);
    assertRealChain(plan, 3);
    assert(plan.steps.length !== ownerPlan.steps.length, "test-integrity: GENERIC plan length must genuinely differ from the BUILD_INTEGRATION plan length");
  });

  // ============================================================
  // 6 — real evidence-reality-check discipline (same class of discipline
  // as switchBasedOrchestratorRuntime.ts#evidenceIsReal — see file header
  // for why this file reuses its 2 real constituent primitives directly
  // rather than importing the private function itself).
  // ============================================================
  test("Acceptance 6a — a fabricated, non-existent evidence path is real-dropped from every step's input_evidence, while a real, existing repo file is real-kept — never trusted on its word alone", () => {
    const intent = makeBaseIntent({
      expectedEvidence: [
        "app/api/admin/ide/_lib/intentRuntime.ts", // real, exists
        "this/path/genuinely/does/not/exist/on/disk.ts", // fabricated
      ],
    });
    const plan = planExecution("สร้างระบบเชื่อม Gemini Spark", intent);
    for (const step of plan.steps) {
      assert(step.input_evidence.includes("app/api/admin/ide/_lib/intentRuntime.ts"), `expected the real, existing evidence path kept for step ${step.stepIndex}`);
      assert(!step.input_evidence.includes("this/path/genuinely/does/not/exist/on/disk.ts"), `expected the fabricated evidence path dropped for step ${step.stepIndex}`);
    }
    assert(plan.disclosed_limitations.some((d) => d.includes("1/2")), `expected disclosed_limitations to honestly report 1/2 real evidence entries verified, got: ${JSON.stringify(plan.disclosed_limitations)}`);
  });

  test("Acceptance 6b — zero real evidence supplied (all fabricated) real-produces honestly EMPTY input_evidence on every step, plus an explicit disclosed_limitations entry naming the real NO_EVIDENCE-equivalent gap — never a fabricated pass", () => {
    const intent = makeBaseIntent({ expectedEvidence: ["fake/one.ts", "fake/two.ts"] });
    const plan = planExecution("สร้างระบบเชื่อม Gemini Spark", intent);
    for (const step of plan.steps) {
      assert(step.input_evidence.length === 0, `expected empty real input_evidence for step ${step.stepIndex}, got ${JSON.stringify(step.input_evidence)}`);
    }
    assert(plan.disclosed_limitations.some((d) => d.includes("Zero real, verified evidence")), "expected an honest disclosed_limitations entry naming the zero-real-evidence gap");
  });

  console.log("\n=== Execution Planner Acceptance Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}

main();
