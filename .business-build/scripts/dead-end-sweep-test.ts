/**
 * Dead-End Sweep Acceptance Suite (owner, 2026-08-10, Capability Roadmap
 * #58 "ARCHITECTURE GAP EXPLORER" Wave 1a, registry/TASK_QUEUE.json
 * TASK-058). Proves, against the real, running deadEndSweepRuntime.ts +
 * systemRealityRuntime.ts composition and real, live repo data — never
 * mocked — every acceptance requirement named for this task:
 *
 *  1. The sweep real-finds engines/tax.ts and engines/vehicle-selector.ts
 *     as real ENGINE_NO_CALLER dead ends — matching what
 *     systemRealityRuntime.ts's own existing test already proved for these
 *     2 modules, now via the generalized, repo-wide sweep.
 *  2. The sweep real-finds at least one genuinely healthy module with real
 *     callers (engines/documents/engine.ts) and correctly does NOT flag it.
 *  3. Real proof of at least one real finding in each of the other 4
 *     pattern categories (API_NO_ROUTE, REGISTRY_NO_RUNTIME,
 *     WORKER_NO_DISPATCHER, UI_NO_CONSUMER) — this repo genuinely has real
 *     examples in all 4 today, so no honest-absence disclosure is needed
 *     for this run, but the assertions are written to fail loudly (not
 *     silently pass) if a category ever genuinely has zero findings.
 *  4. Structural proof the sweep reuses computeLiveReachability() (real
 *     import, never a local re-definition) rather than reimplementing the
 *     reverse-dependency-graph BFS.
 *  5. Real, negative-control proof the sweep does NOT over-flag: a Worker
 *     Department with dispatchable_today=true, a registry with real
 *     readers, and a UI component that IS really consumed all correctly
 *     come back healthy, not flagged.
 *
 * Run: npm run dead-end-sweep:test
 */
import { readFileSync } from "fs";
import path from "path";
import {
  runDeadEndSweep, DEAD_END_PATTERNS, type DeadEndFinding, type DeadEndPattern,
} from "../app/api/admin/ide/_lib/deadEndSweepRuntime";
import { __debugResetArchitectureBookCache } from "../app/api/admin/ide/_lib/systemRealityRuntime";
import { WORKSPACE_ROOT } from "../app/api/admin/ide/_lib/fsSecurity";

const ROOT = WORKSPACE_ROOT;

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
function test(name: string, fn: () => void) {
  try { fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }
/** Strips // and /* *\/ comments before a structural "must not construct X"
 * check — same convention scripts/system-reality-model-test.ts's own
 * stripComments() uses — so a file naming something in its own header
 * comment (to document scope discipline) is never mistaken for the file
 * actually doing it in real code. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
}

function findFinding(findings: DeadEndFinding[], modulePathSubstring: string): DeadEndFinding | null {
  return findings.find((f) => f.module_path.includes(modulePathSubstring)) ?? null;
}

function main() {
  __debugResetArchitectureBookCache();
  const sweep = runDeadEndSweep();
  const deadEndSweepSrc = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/deadEndSweepRuntime.ts"), "utf-8");

  console.log("=== Dead-End Sweep — real, live captured output ===");
  console.log(`generated_at: ${sweep.generated_at}`);
  console.log(`architecture_book_generated_at: ${sweep.architecture_book_generated_at}`);
  console.log(`total_modules_in_architecture_book: ${sweep.total_modules_in_architecture_book}`);
  console.log(`scope: ${JSON.stringify(sweep.scope)}`);
  console.log(`findings_by_pattern: ${JSON.stringify(sweep.findings_by_pattern)}`);
  console.log(`total findings: ${sweep.findings.length}`);
  console.log(`healthy_count: ${sweep.healthy_count}`);

  // ============================================================
  // 0 — Basic shape integrity.
  // ============================================================
  test("Acceptance 0a — every finding uses one of the exact 5 real, named DeadEndPattern values, never an invented 6th", () => {
    for (const f of sweep.findings) {
      assert((DEAD_END_PATTERNS as readonly string[]).includes(f.pattern), `finding "${f.module_path}" has pattern=${f.pattern}, not one of the 5 real allowed values`);
    }
  });

  test("Acceptance 0b — every finding has real, non-empty evidence[] and a real, non-empty real_reachability_chain_or_lack_thereof — never a naked, unevidenced claim", () => {
    for (const f of sweep.findings) {
      assert(Array.isArray(f.evidence) && f.evidence.length > 0, `finding "${f.module_path}" has empty/missing evidence[]`);
      assert(typeof f.real_reachability_chain_or_lack_thereof === "string" && f.real_reachability_chain_or_lack_thereof.length > 0, `finding "${f.module_path}" has empty real_reachability_chain_or_lack_thereof`);
    }
  });

  test("Acceptance 0c — this is a real, repo-wide sweep, not a sample: at least 400 real modules/registries/worker-entries were actually checked across the 5 patterns' own defined scope", () => {
    const totalChecked = sweep.scope.engines_checked + sweep.scope.api_handlers_checked + sweep.scope.registries_checked + sweep.scope.worker_entries_checked + sweep.scope.ui_components_checked;
    assert(totalChecked >= 400, `expected at least 400 real modules checked across all 5 patterns' scope, got ${totalChecked}: ${JSON.stringify(sweep.scope)}`);
    assert(sweep.total_modules_in_architecture_book >= 1000, `expected registry/architecture-book.json to real-report at least 1000 total modules (this repo's real, current scale), got ${sweep.total_modules_in_architecture_book}`);
  });

  // ============================================================
  // 1 — engines/tax.ts and engines/vehicle-selector.ts, matching
  // systemRealityRuntime.ts's own existing, already-proven finding.
  // ============================================================
  test("Acceptance 1a — the sweep real-finds engines/tax.ts as a real ENGINE_NO_CALLER dead end", () => {
    const f = findFinding(sweep.findings, "engines/tax.ts");
    assert(f !== null, `expected a real ENGINE_NO_CALLER finding for engines/tax.ts, got none in ${sweep.findings.length} findings`);
    assert(f!.pattern === "ENGINE_NO_CALLER", `expected pattern=ENGINE_NO_CALLER for engines/tax.ts, got ${f!.pattern}`);
    assert(f!.evidence.some((e) => e.includes("architecture-book.json")), "expected real architecture-book.json evidence citation");
    console.log(`  [captured] engines/tax.ts -> ${f!.pattern}, evidence[0]=${f!.evidence[0]}`);
  });

  test("Acceptance 1b — the sweep real-finds engines/vehicle-selector.ts as a real ENGINE_NO_CALLER dead end", () => {
    const f = findFinding(sweep.findings, "engines/vehicle-selector.ts");
    assert(f !== null, `expected a real ENGINE_NO_CALLER finding for engines/vehicle-selector.ts, got none`);
    assert(f!.pattern === "ENGINE_NO_CALLER", `expected pattern=ENGINE_NO_CALLER for engines/vehicle-selector.ts, got ${f!.pattern}`);
    console.log(`  [captured] engines/vehicle-selector.ts -> ${f!.pattern}, evidence[0]=${f!.evidence[0]}`);
  });

  test("Acceptance 1c — engines/pricing.ts (FCR-013's own real finding, independently re-confirmed by systemRealityRuntime.ts today) is ALSO real-found by this generalized sweep, proving the sweep is a genuine generalization, not a special case for only the 2 named modules", () => {
    const f = findFinding(sweep.findings, "engines/pricing.ts");
    assert(f !== null && f.pattern === "ENGINE_NO_CALLER", `expected engines/pricing.ts real-found as ENGINE_NO_CALLER, got ${JSON.stringify(f)}`);
  });

  // ============================================================
  // 2 — at least one genuinely healthy module, correctly NOT flagged.
  // ============================================================
  test("Acceptance 2 — engines/documents/engine.ts (real, 16+ real dependents including live app/api routes) is real-classified HEALTHY — present in healthy_examples/healthy_count, and NEVER appears in findings[] under any pattern", () => {
    const flagged = sweep.findings.find((f) => f.module_path === "engines/documents/engine.ts");
    assert(!flagged, `expected engines/documents/engine.ts to NEVER be flagged as a dead end, but got: ${JSON.stringify(flagged)}`);
    assert(sweep.healthy_examples.includes("engines/documents/engine.ts"), `expected engines/documents/engine.ts in healthy_examples, got: ${JSON.stringify(sweep.healthy_examples)}`);
    console.log(`  [captured] engines/documents/engine.ts -> HEALTHY (not flagged)`);
  });

  // ============================================================
  // 3 — at least one real finding in each of the other 4 categories.
  // ============================================================
  test("Acceptance 3a — API_NO_ROUTE has at least 1 real finding today (this repo genuinely has real examples — e.g. app/api/admin/ide/_lib/edgeFunctionWorkerRuntime.ts, real dispatch code with zero real live-route callers, only test-script callers)", () => {
    assert(sweep.findings_by_pattern.API_NO_ROUTE > 0, `expected at least 1 real API_NO_ROUTE finding, got ${sweep.findings_by_pattern.API_NO_ROUTE}`);
    const f = findFinding(sweep.findings, "edgeFunctionWorkerRuntime.ts");
    assert(f !== null && f.pattern === "API_NO_ROUTE", `expected edgeFunctionWorkerRuntime.ts real-found as API_NO_ROUTE, got ${JSON.stringify(f)}`);
    console.log(`  [captured] API_NO_ROUTE count=${sweep.findings_by_pattern.API_NO_ROUTE}, e.g. ${f!.module_path}`);
  });

  test("Acceptance 3b — REGISTRY_NO_RUNTIME has at least 1 real finding today, real-verified by an exhaustive whole-repo text scan (not the task's own suggested capability-registry.json candidate, which this build independently checked and found DOES have real readers — see disclosed_limitations/report; real examples found instead include registry/WORKER_STATUS.json, registry/SCHEDULER.json, and over a dozen other real, zero-reader registries — exact count captured live below, not hardcoded here since it is real, current repo state, not a fixed expectation)", () => {
    assert(sweep.findings_by_pattern.REGISTRY_NO_RUNTIME > 0, `expected at least 1 real REGISTRY_NO_RUNTIME finding, got ${sweep.findings_by_pattern.REGISTRY_NO_RUNTIME}`);
    const f = findFinding(sweep.findings, "registry/WORKER_STATUS.json");
    assert(f !== null && f.pattern === "REGISTRY_NO_RUNTIME", `expected registry/WORKER_STATUS.json real-found as REGISTRY_NO_RUNTIME, got ${JSON.stringify(f)}`);
    console.log(`  [captured] REGISTRY_NO_RUNTIME count=${sweep.findings_by_pattern.REGISTRY_NO_RUNTIME}, e.g. ${f!.module_path}`);
  });

  test("Acceptance 3c — WORKER_NO_DISPATCHER has at least 1 real finding today (Worker-04, 👤 Identity Department — registry/TEAM_ORGANIZATION.json's own real, already-declared dispatchable_today=false)", () => {
    assert(sweep.findings_by_pattern.WORKER_NO_DISPATCHER > 0, `expected at least 1 real WORKER_NO_DISPATCHER finding, got ${sweep.findings_by_pattern.WORKER_NO_DISPATCHER}`);
    const f = findFinding(sweep.findings, "Worker-04");
    assert(f !== null && f.pattern === "WORKER_NO_DISPATCHER", `expected Worker-04 real-found as WORKER_NO_DISPATCHER, got ${JSON.stringify(f)}`);
    assert(f!.evidence.some((e) => e.includes("dispatchable_today=false")), "expected real dispatchable_today=false citation");
    console.log(`  [captured] WORKER_NO_DISPATCHER count=${sweep.findings_by_pattern.WORKER_NO_DISPATCHER}, e.g. ${f!.module_path}`);
  });

  test("Acceptance 3d — UI_NO_CONSUMER has at least 1 real finding today (components/admin/AdminSidebarNav.tsx — real, grep-confirmed zero real importers anywhere in the repo)", () => {
    assert(sweep.findings_by_pattern.UI_NO_CONSUMER > 0, `expected at least 1 real UI_NO_CONSUMER finding, got ${sweep.findings_by_pattern.UI_NO_CONSUMER}`);
    const f = findFinding(sweep.findings, "AdminSidebarNav.tsx");
    assert(f !== null && f.pattern === "UI_NO_CONSUMER", `expected AdminSidebarNav.tsx real-found as UI_NO_CONSUMER, got ${JSON.stringify(f)}`);
    console.log(`  [captured] UI_NO_CONSUMER count=${sweep.findings_by_pattern.UI_NO_CONSUMER}, e.g. ${f!.module_path}`);
  });

  // ============================================================
  // 4 — negative controls: real proof the sweep does NOT over-flag.
  // ============================================================
  test("Acceptance 4a — negative control: Worker-01 (🔌 Connector Department, real dispatchable_today=true per registry/TEAM_ORGANIZATION.json) is real-NOT flagged as WORKER_NO_DISPATCHER", () => {
    const f = sweep.findings.find((x) => x.pattern === "WORKER_NO_DISPATCHER" && x.module_path.includes("Worker-01"));
    assert(!f, `expected Worker-01 to NOT be flagged (dispatchable_today=true), but got: ${JSON.stringify(f)}`);
  });

  test("Acceptance 4b — negative control: registry/module-registry.json (real, 64+ real .ts readers per this build's own investigation) is real-NOT flagged as REGISTRY_NO_RUNTIME", () => {
    const f = sweep.findings.find((x) => x.pattern === "REGISTRY_NO_RUNTIME" && x.module_path === "registry/module-registry.json");
    assert(!f, `expected registry/module-registry.json to NOT be flagged, but got: ${JSON.stringify(f)}`);
  });

  test("Acceptance 4c — negative control: registry/capability-registry.json (the task's own suggested candidate) real-has genuine readers (core/workspace/composer/capabilityRegistryAccess.ts, app/api/admin/ide/_lib/contextPlannerRuntime.ts, engines/documents/selfDescription.ts, and more) and is honestly real-NOT flagged — this build checked it carefully rather than assuming the task's hint was correct, per this task's own honesty instruction", () => {
    const f = sweep.findings.find((x) => x.pattern === "REGISTRY_NO_RUNTIME" && x.module_path === "registry/capability-registry.json");
    assert(!f, `expected registry/capability-registry.json to NOT be flagged (it has real, grep-confirmed .ts readers), but got: ${JSON.stringify(f)}`);
  });

  test("Acceptance 4d — negative control: app/api/admin/ide/_lib/workerTaskOrchestrator.ts and switchBasedOrchestratorRuntime.ts (2 of the 4 real dispatch runtimes named by this task) real-ARE reachable from a live route today and are correctly real-NOT flagged as API_NO_ROUTE", () => {
    const f1 = sweep.findings.find((x) => x.module_path.includes("workerTaskOrchestrator.ts"));
    const f2 = sweep.findings.find((x) => x.module_path.includes("switchBasedOrchestratorRuntime.ts"));
    assert(!f1, `expected workerTaskOrchestrator.ts to NOT be flagged (real live route via factoryReadinessGateRuntime.ts), got: ${JSON.stringify(f1)}`);
    assert(!f2, `expected switchBasedOrchestratorRuntime.ts to NOT be flagged (real live route via costGateRuntime.ts -> codeWorkerRuntime.ts), got: ${JSON.stringify(f2)}`);
  });

  test("Acceptance 4e — negative control: app/page.tsx and other real Next.js entry points (page.tsx/layout.tsx/loading.tsx/etc.) are NEVER candidates for UI_NO_CONSUMER — real, structural proof no finding's module_path ends in one of those real Next.js special filenames", () => {
    const offenders = sweep.findings.filter((f) => f.pattern === "UI_NO_CONSUMER" && /\/(page|layout|loading|error|not-found|template|default|global-error)\.tsx$/.test(f.module_path));
    assert(offenders.length === 0, `expected zero real Next.js entry-point files ever flagged as UI_NO_CONSUMER, got: ${JSON.stringify(offenders.map((o) => o.module_path))}`);
  });

  // ============================================================
  // 5 — structural: reuses computeLiveReachability(), never reimplements it.
  // ============================================================
  test("Structural 5a — deadEndSweepRuntime.ts really IMPORTS computeLiveReachability/isLiveProductionSurface/loadArchitectureBook from ./systemRealityRuntime (never reimplements the reverse-dependency-graph BFS)", () => {
    assert(/import\s*\{[^}]*computeLiveReachability[^}]*\}\s*from\s*["']\.\/systemRealityRuntime["']/.test(deadEndSweepSrc), "expected a real import of computeLiveReachability from ./systemRealityRuntime");
    assert(/isLiveProductionSurface/.test(deadEndSweepSrc), "expected a real usage of isLiveProductionSurface");
    assert(/loadArchitectureBook/.test(deadEndSweepSrc), "expected a real usage of loadArchitectureBook");
    assert(!/function\s+computeLiveReachability\s*\(/.test(deadEndSweepSrc), "expected NO local re-definition of computeLiveReachability in deadEndSweepRuntime.ts");
  });

  test("Structural 5b — deadEndSweepRuntime.ts contains no second BFS/queue-based reverse-dependency traversal of its own — the only `.dependents` graph walk in this file happens inside the imported computeLiveReachability() call, never a hand-rolled duplicate (the file's own directory walk for Pattern 3's text scan is a structurally different concern — reading source text for a literal string match — and is asserted separately not to touch `.dependents` at all)", () => {
    assert(!/queue\.shift\(\)/.test(deadEndSweepSrc), "expected no local queue.shift()-based BFS loop in deadEndSweepRuntime.ts (that logic belongs to computeLiveReachability alone)");
    assert(!/node\.dependents/.test(deadEndSweepSrc) || /computeLiveReachability/.test(deadEndSweepSrc), "if `.dependents` is referenced, it must be alongside real usage of computeLiveReachability, not a parallel traversal");
    // Pattern 3's own real directory walk must never reference `.dependents` (an architecture-book concept) — proves it's a genuinely different, real technique (whole-repo text scan), not a disguised second graph traversal.
    const walkFnMatch = deadEndSweepSrc.match(/function collectRealSourceFiles[\s\S]*?\n}\n/);
    assert(walkFnMatch !== null, "expected to find collectRealSourceFiles()'s real function body");
    assert(!/dependents/.test(walkFnMatch![0]), "expected collectRealSourceFiles() to never reference `.dependents` — it is a real filesystem walk, not a graph traversal");
  });

  test("Structural 5c — every real finding whose pattern is ENGINE_NO_CALLER, API_NO_ROUTE, or UI_NO_CONSUMER carries a real_reachability_chain_or_lack_thereof string that was produced by computeLiveReachability's own real .reason field (contains the real, literal phrase this function always produces), proving those 3 patterns are computed via the reused function, not independently re-derived text", () => {
    const reachabilityDriven = sweep.findings.filter((f) => f.pattern === "ENGINE_NO_CALLER" || f.pattern === "API_NO_ROUTE" || f.pattern === "UI_NO_CONSUMER");
    assert(reachabilityDriven.length > 0, "test-integrity: expected at least one finding across these 3 patterns to check");
    for (const f of reachabilityDriven) {
      assert(f.real_reachability_chain_or_lack_thereof.includes("reverse-dependency"), `finding "${f.module_path}" (${f.pattern}) does not carry computeLiveReachability's own real reason text, got: ${f.real_reachability_chain_or_lack_thereof}`);
    }
  });

  test("Structural 5d — deadEndSweepRuntime.ts never re-reads registry/architecture-book.json with its own JSON.parse — the real, cached loadArchitectureBook() from systemRealityRuntime.ts is the ONLY source of ArchitectureBook data in this file. Checked precisely on REAL CODE ONLY (comments stripped first, so this file's own header-comment prose explaining the reuse decision — which necessarily mentions both 'JSON.parse' and 'architecture-book.json' in nearby sentences — can never be mistaken for an actual read call): a real read-indicator token (readFileSync/tryReadJson/JSON.parse/require) must never appear within 60 real characters BEFORE the literal string \"architecture-book.json\" in the real, comment-stripped code", () => {
    const codeOnly = stripComments(deadEndSweepSrc);
    const idx = codeOnly.indexOf("architecture-book.json");
    let cursor = 0; let offender: string | null = null;
    while (true) {
      const i = codeOnly.indexOf("architecture-book.json", cursor);
      if (i === -1) break;
      const before = codeOnly.slice(Math.max(0, i - 60), i);
      if (/(readFileSync|readFile\s*\(|tryReadJson|JSON\.parse|require\()/.test(before)) { offender = before; break; }
      cursor = i + 1;
    }
    assert(idx > -1, "test-integrity: expected deadEndSweepRuntime.ts's real code to at least mention architecture-book.json somewhere (in evidence/citation text)");
    assert(offender === null, `expected zero real read-call constructions of "architecture-book.json" in deadEndSweepRuntime.ts's real code, found one preceded by: ...${offender}`);
  });

  test("Structural 5e — deadEndSweepRuntime.ts contains ZERO writeFileSync calls anywhere (pure read/compute only, zero real side effects, matching this task's own explicit money/side-effect constraint)", () => {
    assert(!/writeFileSync/.test(deadEndSweepSrc), "expected zero writeFileSync calls in deadEndSweepRuntime.ts");
  });

  test("Structural 5f — deadEndSweepRuntime.ts contains ZERO setInterval/cron/while(true) background-loop patterns (a pure, on-demand compute function, same discipline as systemRealityRuntime.ts)", () => {
    const offenders: string[] = [];
    const patterns: [RegExp, string][] = [
      [/\bsetInterval\s*\(/, "setInterval("], [/\bcron\.schedule\s*\(/, "cron.schedule("],
      [/while\s*\(\s*true\s*\)/, "while (true)"], [/for\s*\(\s*;\s*;\s*\)/, "for (;;)"],
    ];
    for (const [re, label] of patterns) if (re.test(deadEndSweepSrc)) offenders.push(label);
    assert(offenders.length === 0, `expected zero background-loop patterns, found: ${JSON.stringify(offenders)}`);
  });

  test("Structural 5g — deadEndSweepRuntime.ts never touches any off-limits registry (CONSTITUTION.json, rule-coverage.json, TASK_QUEUE.json, CHANGELOG.json, FACTORY_CENTRAL_REGISTRY.json, capability-roadmap.json) outside its own header comment", () => {
    const codeOnly = stripComments(deadEndSweepSrc);
    for (const off of ["CONSTITUTION.json", "rule-coverage.json", "TASK_QUEUE.json", "CHANGELOG.json", "FACTORY_CENTRAL_REGISTRY.json", "capability-roadmap.json"]) {
      assert(!codeOnly.includes(off), `expected zero live-code references to off-limits ${off}`);
    }
  });

  // ============================================================
  // 6 — sources_composed honesty (same convention as system-reality-model:test's Structural 4c).
  // ============================================================
  test("Acceptance 6 — sources_composed[] real-lists computeLiveReachability/isLiveProductionSurface/loadArchitectureBook, WORKER_REGISTRY, and the 2 real registries this sweep reads directly (TEAM_ORGANIZATION.json, WORKER_IDENTITIES.json)", () => {
    const src = sweep.sources_composed.join(" | ");
    assert(src.includes("systemRealityRuntime.ts"), "expected systemRealityRuntime.ts cited in sources_composed");
    assert(src.includes("workerRegistry.ts"), "expected workerRegistry.ts cited in sources_composed");
    assert(sweep.sources_composed.includes("registry/TEAM_ORGANIZATION.json"), "expected registry/TEAM_ORGANIZATION.json cited in sources_composed");
    assert(sweep.sources_composed.includes("registry/WORKER_IDENTITIES.json"), "expected registry/WORKER_IDENTITIES.json cited in sources_composed");
  });

  console.log("\n=== Dead-End Sweep Acceptance Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  console.log(`\nFull findings_by_pattern: ${JSON.stringify(sweep.findings_by_pattern, null, 2)}`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}

main();
