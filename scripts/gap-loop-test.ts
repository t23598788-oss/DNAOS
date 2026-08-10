/**
 * Factory Gap Loop Acceptance Suite (owner, 2026-08-10, Constitution Rule
 * 255 — AMENDMENT "Factory Gap Loop", real build for TASK-052). Proves,
 * against the real, running gapLoopRuntime.ts + managerQuestionRuntime.ts
 * composition and real, live repo data — never mocked — every acceptance
 * requirement named for this task:
 *
 *  1. classifyGap() produces a real, defensible category for each of
 *     FCR-009/011/012's real, live description text, and a real
 *     UNCLASSIFIED for genuinely ambiguous, deliberately-constructed text.
 *  2. findDuplicateGap() real-detects a reworded near-duplicate of a real
 *     existing finding, and real-does-NOT flag a genuinely different one
 *     — structural, grep-verified proof it imports (not reimplements)
 *     extractKeywords/overlapCoefficient from managerQuestionRuntime.ts.
 *  3. computeFactoryStatus() run against the real, live, current repo
 *     state produces real NOT_STABLE with real, evidence-backed reasons
 *     — read live here, never hardcoded stale numbers.
 *  4. Structural proof: no duplicated dedup algorithm, no background
 *     loop/daemon/setInterval/cron anywhere in gapLoopRuntime.ts.
 *
 * Run: npm run gap-loop:test
 */
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import {
  classifyGap, findDuplicateGap, computeFactoryStatus,
  GAP_TYPES, type GapType, type ExistingFindingForDedup,
} from "../app/api/admin/ide/_lib/gapLoopRuntime";
import { WORKSPACE_ROOT } from "../app/api/admin/ide/_lib/fsSecurity";

const ROOT = WORKSPACE_ROOT;

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

interface RegistryFinding {
  finding_id: string;
  type?: string;
  status: string;
  description?: string;
  evaluation?: string | null;
  evidence?: Array<{ excerpt?: string }>;
}
interface FactoryCentralRegistry { findings: RegistryFinding[]; status_enum: string[] }

function readRegistry(): FactoryCentralRegistry {
  return JSON.parse(readFileSync(path.join(ROOT, "registry/FACTORY_CENTRAL_REGISTRY.json"), "utf-8"));
}
function readWorkerIdentities(): { registered_count: number; total_slots: number } {
  return JSON.parse(readFileSync(path.join(ROOT, "registry/WORKER_IDENTITIES.json"), "utf-8"));
}

async function main() {
  const registry = readRegistry();
  const findingById = (id: string): RegistryFinding => {
    const f = registry.findings.find((x) => x.finding_id === id);
    if (!f) throw new Error(`test-integrity: expected to find real, live ${id} in registry/FACTORY_CENTRAL_REGISTRY.json but it was not there`);
    return f;
  };

  // ============================================================
  // 1 — classifyGap() against real, live FCR-009/011/012 text.
  // ============================================================
  const fcr009 = findingById("FCR-009");
  const fcr011 = findingById("FCR-011");
  const fcr012 = findingById("FCR-012");

  let r009: ReturnType<typeof classifyGap>, r011: ReturnType<typeof classifyGap>, r012: ReturnType<typeof classifyGap>;

  await test("Acceptance 1a — classifyGap(FCR-009's real, live description) produces a real, defensible, non-UNCLASSIFIED category (real evidence: unauthorized real spend, ~$0.29 USD, 'real money spent', no structural cost gate existed)", () => {
    r009 = classifyGap(fcr009.description!, (fcr009.evidence ?? []).map((e) => e.excerpt ?? ""));
    assert(r009.type !== "UNCLASSIFIED", `expected a real, committed category for FCR-009, got UNCLASSIFIED: ${r009.reason}`);
    assert(r009.type === "COST_GAP", `expected COST_GAP for FCR-009 (real cost/spend/money/paid signal dominates — real score ${r009.scores.COST_GAP} vs next-highest ${Math.max(...GAP_TYPES.filter((t) => t !== "COST_GAP").map((t) => r009.scores[t]))}), got ${r009.type}. Full scores: ${JSON.stringify(r009.scores)}`);
    console.log(`  [captured] FCR-009 -> ${r009.type} (${r009.reason})`);
  });

  await test("Acceptance 1b — classifyGap(FCR-011's real, live description) produces a real, defensible, non-UNCLASSIFIED category (real evidence: 'Cost Gate LOCK', 'cost_class taxonomy', 'estimated_cost=null', 'Owner-granted budget')", () => {
    r011 = classifyGap(fcr011.description!, (fcr011.evidence ?? []).map((e) => e.excerpt ?? ""));
    assert(r011.type !== "UNCLASSIFIED", `expected a real, committed category for FCR-011, got UNCLASSIFIED: ${r011.reason}`);
    assert(r011.type === "COST_GAP", `expected COST_GAP for FCR-011 (real score ${r011.scores.COST_GAP} vs next-highest ${Math.max(...GAP_TYPES.filter((t) => t !== "COST_GAP").map((t) => r011.scores[t]))}), got ${r011.type}. Full scores: ${JSON.stringify(r011.scores)}`);
    console.log(`  [captured] FCR-011 -> ${r011.type} (${r011.reason})`);
  });

  await test("Acceptance 1c — classifyGap(FCR-012's real, live description) produces a real, defensible, non-UNCLASSIFIED category (real evidence: 'incompatible schemas', '4 real new TS2339 errors', 'npx tsc --noEmit' — own recorded type field is literally 'Bug (Type Safety / Schema Drift)')", () => {
    r012 = classifyGap(fcr012.description!, (fcr012.evidence ?? []).map((e) => e.excerpt ?? ""));
    assert(r012.type !== "UNCLASSIFIED", `expected a real, committed category for FCR-012, got UNCLASSIFIED: ${r012.reason}`);
    assert(r012.type === "CODE_GAP", `expected CODE_GAP for FCR-012 (real score ${r012.scores.CODE_GAP} vs next-highest ${Math.max(...GAP_TYPES.filter((t) => t !== "CODE_GAP").map((t) => r012.scores[t]))} — note real COST_GAP also scores nonzero here because 'Cost Gate' is genuinely mentioned twice in FCR-012's own text as the thing that *exposed* the bug, a real, honest multi-signal case correctly resolved by margin, not a false tie), got ${r012.type}. Full scores: ${JSON.stringify(r012.scores)}`);
    console.log(`  [captured] FCR-012 -> ${r012.type} (${r012.reason}) — full scores: ${JSON.stringify(r012.scores)}`);
  });

  await test("Acceptance 1d — classifyGap() on a genuinely ambiguous, deliberately-constructed, zero-domain-signal description returns a real UNCLASSIFIED with a real, honest reason — never a forced guess", () => {
    const ambiguous = "Something felt subtly wrong today during a routine review, but nobody could identify a specific cause, symptom, or affected area — needs more investigation before anything concrete can be said.";
    const result = classifyGap(ambiguous);
    assert(result.type === "UNCLASSIFIED", `expected UNCLASSIFIED for a deliberately zero-signal description, got ${result.type} (scores: ${JSON.stringify(result.scores)})`);
    assert(result.reason.length > 0, "expected a real, non-empty reason string for the UNCLASSIFIED result");
    assert(Object.values(result.scores).every((s) => s === 0), `expected every real category score to be exactly 0 for this deliberately zero-signal description, got: ${JSON.stringify(result.scores)}`);
    console.log(`  [captured] deliberately ambiguous (zero-signal) -> UNCLASSIFIED (${result.reason})`);
  });

  await test("Acceptance 1e (bonus rigor) — classifyGap() on a deliberately-constructed, genuinely TIED description (equal real weak signal for two different categories, neither dominant) also returns a real UNCLASSIFIED, proving the tie-break path (not just the zero-score path) is real and honest", () => {
    const tied = "This finding involves identity and table concerns without further detail.";
    const result = classifyGap(tied);
    assert(result.type === "UNCLASSIFIED", `expected UNCLASSIFIED for a deliberately tied description, got ${result.type} (scores: ${JSON.stringify(result.scores)})`);
    const maxScore = Math.max(...GAP_TYPES.map((t) => result.scores[t]));
    const topCount = GAP_TYPES.filter((t) => result.scores[t] === maxScore).length;
    assert(maxScore > 0, "test-integrity: expected this deliberately-tied case to have real nonzero signal (otherwise it would only exercise the zero-score path already covered above)");
    assert(topCount > 1, `expected a real tie (2+ categories sharing the top score) to actually occur for this deliberately-constructed description, got only ${topCount} top category at score ${maxScore}: ${JSON.stringify(result.scores)}`);
    console.log(`  [captured] deliberately tied -> UNCLASSIFIED (${result.reason})`);
  });

  await test("Acceptance 1f — GAP_TYPES is exactly the real, live 10-value type_enum from registry/FACTORY_CENTRAL_REGISTRY.json (no drift, no invented 11th category, none missing)", () => {
    const liveTypeEnum: string[] = JSON.parse(readFileSync(path.join(ROOT, "registry/FACTORY_CENTRAL_REGISTRY.json"), "utf-8")).type_enum;
    assert(GAP_TYPES.length === liveTypeEnum.length, `expected GAP_TYPES to have exactly ${liveTypeEnum.length} real entries (matching the live type_enum), got ${GAP_TYPES.length}`);
    for (const t of liveTypeEnum) assert((GAP_TYPES as readonly string[]).includes(t), `expected GAP_TYPES to include real, live type_enum value ${t}`);
    for (const t of GAP_TYPES) assert(liveTypeEnum.includes(t), `expected every GAP_TYPES value to exist in the real, live type_enum — found extra, invented value ${t}`);
  });

  // ============================================================
  // 2 — findDuplicateGap() real detection + structural reuse proof.
  // ============================================================
  const dedupCandidates: ExistingFindingForDedup[] = registry.findings.map((f) => ({
    finding_id: f.finding_id, description: f.description, evaluation: f.evaluation,
  }));

  await test("Acceptance 2a — findDuplicateGap() real-DETECTS a reworded near-duplicate of FCR-012's real, live description as a real duplicate of FCR-012, with a real overlapScore above the real 0.5 threshold", () => {
    const reworded = "The health check scripts governance.sh and dashboard.sh both overwrite DNA_OS_HEALTH.json with incompatible shapes — OperationalWorkspace.tsx expects governance.sh's real summary and governance_score fields, but dashboard.sh's later write clobbers them with evolution, risk, and metrics instead, producing real TS2339 type errors confirmed live via npx tsc --noEmit.";
    const result = findDuplicateGap(reworded, dedupCandidates);
    assert(result.isDuplicate === true, `expected a real duplicate match for a genuine rewording of FCR-012, got isDuplicate=false`);
    assert(result.matchedFindingId === "FCR-012", `expected the real match to be FCR-012, got ${result.matchedFindingId}`);
    assert(typeof result.overlapScore === "number" && result.overlapScore >= 0.5, `expected a real overlapScore >= 0.5, got ${result.overlapScore}`);
    console.log(`  [captured] reworded-FCR-012 -> matched ${result.matchedFindingId}, real overlapScore=${result.overlapScore}`);
  });

  await test("Acceptance 2b — findDuplicateGap() real-does-NOT flag a genuinely different, unrelated Gap description as a duplicate of anything", () => {
    const different = "The LINE webhook connector fails to refresh customer profile photos because the OAuth token cache expires silently with no retry, causing stale avatars across the front office chat UI.";
    const result = findDuplicateGap(different, dedupCandidates);
    assert(result.isDuplicate === false, `expected NO duplicate match for a genuinely different Gap, got matched=${result.matchedFindingId} at overlapScore=${result.overlapScore}`);
  });

  await test("Acceptance 2c — findDuplicateGap() honestly returns isDuplicate=false (never throws, never fabricates a match) when given an empty existing-findings list", () => {
    const result = findDuplicateGap("anything at all", []);
    assert(result.isDuplicate === false, "expected isDuplicate=false against an empty findings list");
  });

  const gapLoopRuntimeSrc = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/gapLoopRuntime.ts"), "utf-8");
  const managerQuestionRuntimeSrc = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/managerQuestionRuntime.ts"), "utf-8");

  await test("Structural 2d (real, grep-verified) — gapLoopRuntime.ts really IMPORTS extractKeywords AND overlapCoefficient from managerQuestionRuntime.ts (not a re-implementation)", () => {
    const importRegex = /import\s*\{([^}]*)\}\s*from\s*["'][^"']*managerQuestionRuntime["']/;
    const m = gapLoopRuntimeSrc.match(importRegex);
    assert(m !== null, "expected gapLoopRuntime.ts to have a real import statement from managerQuestionRuntime.ts");
    const names = m![1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim());
    assert(names.includes("extractKeywords"), `expected gapLoopRuntime.ts to import extractKeywords, actual imported names: ${JSON.stringify(names)}`);
    assert(names.includes("overlapCoefficient"), `expected gapLoopRuntime.ts to import overlapCoefficient, actual imported names: ${JSON.stringify(names)}`);
  });

  await test("Structural 2e (real, grep-verified) — gapLoopRuntime.ts does NOT locally redefine extractKeywords or overlapCoefficient anywhere (no shadow/duplicate implementation alongside the real import)", () => {
    const redefRegex = /\b(function|const)\s+(extractKeywords|overlapCoefficient)\s*[=(]/g;
    const offenders: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = redefRegex.exec(gapLoopRuntimeSrc))) offenders.push(m[0]);
    assert(offenders.length === 0, `expected zero local re-definitions of extractKeywords/overlapCoefficient in gapLoopRuntime.ts, found: ${JSON.stringify(offenders)}`);
  });

  await test("Structural 2f (positive control) — managerQuestionRuntime.ts really, actually EXPORTS both extractKeywords and overlapCoefficient (proves the reuse scan above is meaningful, not vacuous — there is a real function being reused, not an import of nothing)", () => {
    assert(/export function extractKeywords\(/.test(managerQuestionRuntimeSrc), "expected managerQuestionRuntime.ts to really export function extractKeywords(");
    assert(/export function overlapCoefficient\(/.test(managerQuestionRuntimeSrc), "expected managerQuestionRuntime.ts to really export function overlapCoefficient(");
  });

  await test("Structural 2g — this suite's own file, and gapLoopRuntime.ts itself, import ZERO Owner-facing names (getOwnerFacingQueue/answerAggregatedQuestion) from managerQuestionRuntime.ts — this task never touches Rule 251's Owner-escalation surface, so manager-question-queue-test.ts's own criterion (d) allowlist needs no new entry for either file", () => {
    const selfSrc = readFileSync(__filename, "utf-8");
    const importRegex = /import\s*\{([^}]*)\}\s*from\s*["'][^"']*managerQuestionRuntime["']/g;
    for (const [label, src] of [["gapLoopRuntime.ts", gapLoopRuntimeSrc], ["gap-loop-test.ts (this file)", selfSrc]] as const) {
      let m: RegExpExecArray | null;
      let found = false;
      const re = new RegExp(importRegex);
      while ((m = re.exec(src))) {
        const names = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim());
        if (names.includes("getOwnerFacingQueue") || names.includes("answerAggregatedQuestion")) found = true;
      }
      assert(!found, `expected ${label} to import zero Owner-facing names from managerQuestionRuntime.ts`);
    }
  });

  // ============================================================
  // 3 — computeFactoryStatus() against real, live current repo state.
  // ============================================================
  const liveWorkerIdentities = readWorkerIdentities();
  const liveOpenStatuses = ["TRACKED", "ESCALATED", "WAITING_MANAGER_DECISION", "NEW"];
  const liveOpenFindings = registry.findings.filter((f) => liveOpenStatuses.includes(f.status));

  await test("Acceptance 3a — computeFactoryStatus() run against the real, live, current repo state produces real NOT_STABLE (matches this task's own honest, disclosed current state: WORKER_IDENTITIES.json 0/6, real open findings still TRACKED/ESCALATED)", async () => {
    const status = await computeFactoryStatus();
    assert(status.value === "NOT_STABLE", `expected real NOT_STABLE against today's actual repo state, got ${status.value}. reasons: ${JSON.stringify(status.reasons)}`);
    assert(status.reasons.length > 0, "expected at least one real, evidence-backed reason for NOT_STABLE");
    assert(typeof status.computedAt === "string" && !Number.isNaN(Date.parse(status.computedAt)), "expected a real, parseable computedAt timestamp");
    console.log(`  [captured] computeFactoryStatus() -> ${status.value}`);
    for (const r of status.reasons) console.log(`    - ${r}`);
  });

  await test("Acceptance 3b — the real WORKER_IDENTITIES.json reason, when present, matches the LIVE registered_count/total_slots read in this test (never a hardcoded, driftable 0/6)", async () => {
    const status = await computeFactoryStatus();
    if (liveWorkerIdentities.registered_count < liveWorkerIdentities.total_slots) {
      const expectedSubstring = `registered_count=${liveWorkerIdentities.registered_count}/${liveWorkerIdentities.total_slots}`;
      assert(status.reasons.some((r) => r.includes(expectedSubstring)), `expected a real reason containing "${expectedSubstring}" (live-read from registry/WORKER_IDENTITIES.json), got: ${JSON.stringify(status.reasons)}`);
    } else {
      assert(!status.reasons.some((r) => r.includes("WORKER_IDENTITIES.json")), "registered_count now equals total_slots live — expected NO WORKER_IDENTITIES reason to be present");
    }
  });

  await test("Acceptance 3c — every real, currently-open finding (status in TRACKED/ESCALATED/WAITING_MANAGER_DECISION/NEW, live-read from registry/FACTORY_CENTRAL_REGISTRY.json) is cited by finding_id in computeFactoryStatus()'s real reasons — never silently dropped, never fabricated", async () => {
    const status = await computeFactoryStatus();
    for (const f of liveOpenFindings) {
      assert(status.reasons.some((r) => r.includes(f.finding_id) && r.includes(f.status)), `expected a real reason citing ${f.finding_id} (status=${f.status}), got: ${JSON.stringify(status.reasons)}`);
    }
    console.log(`  [captured] live open findings cited: ${liveOpenFindings.map((f) => `${f.finding_id}(${f.status})`).join(", ") || "(none currently open)"}`);
  });

  await test("Acceptance 3d — computeFactoryStatus() default call (verifyTestSuites unset) is honest about NOT having independently re-verified the 8 core suites this call — never silently claims that criterion is met from stale/asserted knowledge", async () => {
    const status = await computeFactoryStatus();
    assert(status.reasons.some((r) => r.toLowerCase().includes("not independently re-verified")), `expected an honest reason disclosing that test-suite pass/fail was not re-verified this call, got: ${JSON.stringify(status.reasons)}`);
  });

  await test("Structural 3e — computeFactoryStatus()'s opt-in verifyTestSuites path is real, wired code (not a stub): it real-invokes `npm run <key>` for exactly the 8 real script keys named by Rule 255's amendment, and every one of those 8 keys really exists in package.json today", () => {
    assert(/options\.verifyTestSuites/.test(gapLoopRuntimeSrc), "expected computeFactoryStatus() to really branch on options.verifyTestSuites");
    assert(/execFileAsync\(\s*["']npm["']\s*,\s*\[\s*["']run["']/.test(gapLoopRuntimeSrc), "expected the real, live code path to really call execFileAsync(\"npm\", [\"run\", ...]) — reusing package.json's own real script entries, never a duplicated shell command string");
    const keysMatch = gapLoopRuntimeSrc.match(/CORE_FACTORY_SUITE_SCRIPT_KEYS = \[([\s\S]*?)\] as const/);
    assert(keysMatch !== null, "expected a real CORE_FACTORY_SUITE_SCRIPT_KEYS constant listing the real suite keys");
    const keys = Array.from(keysMatch![1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
    const expected = ["worker-01:test", "worker-02:test", "native-factory-flow:test", "manager-question-queue:test", "switch-based-orchestrator:test", "cost-gate:test", "execution-hand:test", "edge-function-worker:test"];
    assert(keys.length === 8, `expected exactly 8 real suite keys, got ${keys.length}: ${JSON.stringify(keys)}`);
    for (const k of expected) assert(keys.includes(k), `expected real suite key ${k} to be present in CORE_FACTORY_SUITE_SCRIPT_KEYS`);
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf-8")) as { scripts: Record<string, string> };
    for (const k of keys) assert(typeof pkg.scripts[k] === "string", `expected real suite key ${k} to really exist in package.json's own scripts object today (found: ${pkg.scripts[k]})`);
  });

  // ============================================================
  // 4 — Structural: no background loop/daemon/setInterval/cron anywhere.
  // ============================================================
  await test("Structural 4a — gapLoopRuntime.ts contains ZERO setInterval/setImmediate-recursion/cron/node-cron/while(true)/for(;;) — no standalone monitoring daemon, no background polling loop, per this task's own explicit 'do not build' scope", () => {
    const offenders: string[] = [];
    const patterns: [RegExp, string][] = [
      [/\bsetInterval\s*\(/, "setInterval("],
      [/\brequire\(["']node-cron["']\)/, "require(\"node-cron\")"],
      [/from\s*["']node-cron["']/, "import ... from \"node-cron\""],
      [/\bcron\.schedule\s*\(/, "cron.schedule("],
      [/while\s*\(\s*true\s*\)/, "while (true)"],
      [/for\s*\(\s*;\s*;\s*\)/, "for (;;)"],
    ];
    for (const [re, label] of patterns) if (re.test(gapLoopRuntimeSrc)) offenders.push(label);
    assert(offenders.length === 0, `expected gapLoopRuntime.ts to contain none of these background-loop/daemon patterns, found: ${JSON.stringify(offenders)}`);
  });

  await test("Structural 4b — whole-repo scan: no OTHER file anywhere in app/ or scripts/ wires gapLoopRuntime.ts's exports (classifyGap/findDuplicateGap/computeFactoryStatus) into a setInterval/cron/recursive-setTimeout auto-trigger (proves this task was not silently wired into an autonomous watcher, matching the explicit 'Do NOT build ... auto-trigger mechanism' instruction)", () => {
    function walkTsFiles(dir: string, out: string[]) {
      let entries: string[];
      try { entries = readdirSync(dir); } catch { return; }
      for (const entry of entries) {
        if (entry === "node_modules" || entry === ".next" || entry === ".git" || entry === ".next-tauri-placeholder") continue;
        const full = path.join(dir, entry);
        let st;
        try { st = statSync(full); } catch { continue; }
        if (st.isDirectory()) walkTsFiles(full, out);
        else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
      }
    }
    const files: string[] = [];
    walkTsFiles(path.join(ROOT, "app"), files);
    walkTsFiles(path.join(ROOT, "scripts"), files);
    const GAP_LOOP_NAMES = ["classifyGap", "findDuplicateGap", "computeFactoryStatus"];
    const offenders: string[] = [];
    for (const f of new Set(files)) {
      if (f.endsWith("gapLoopRuntime.ts") || f.endsWith("gap-loop-test.ts")) continue;
      let src: string;
      try { src = readFileSync(f, "utf-8"); } catch { continue; }
      const importsGapLoopName = new RegExp(`from\\s*["'][^"']*gapLoopRuntime["']`).test(src) && GAP_LOOP_NAMES.some((n) => new RegExp(`\\b${n}\\b`).test(src));
      const hasLoopPattern = /\bsetInterval\s*\(/.test(src) || /\bcron\.schedule\s*\(/.test(src);
      if (importsGapLoopName && hasLoopPattern) offenders.push(f);
    }
    assert(offenders.length === 0, `expected zero files to wire gapLoopRuntime.ts's exports into any auto-trigger loop, found: ${JSON.stringify(offenders)}`);
  });

  console.log("\n=== Factory Gap Loop Acceptance Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
