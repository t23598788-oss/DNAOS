/**
 * Architecture Summary Acceptance Suite (owner, 2026-08-10, Capability
 * Roadmap #58 "ARCHITECTURE GAP EXPLORER" Wave 1b, registry/TASK_QUEUE.json
 * TASK-059). Proves, against the real, running architectureSummaryRuntime.ts
 * composition and real, live repo data — never mocked — every acceptance
 * requirement named for this task:
 *
 *  1. getFileSummary() on a real file with a real, human-written purpose
 *     (costGateRuntime.ts — one of the 15 real files given a real purpose/
 *     purpose_th earlier today) produces a real, non-"not yet documented"
 *     AI Language layer, genuinely derived from that real, written text.
 *  2. getFileSummary() on a real file that still carries the literal
 *     auto-stub purpose (systemRealityRuntime.ts — real, tested, live
 *     dependents, but never given a real purpose) honestly returns
 *     "not yet documented" for AI Language — never invents content.
 *  3. Business Language: engines/pricing.ts (real evidence in both
 *     systemRealityRuntime.ts's Cost Calculation capability AND FCR-013)
 *     correctly surfaces both real cross-references; fsSecurity.ts (real,
 *     grep-confirmed zero mentions anywhere in the 3 real business
 *     sources) honestly reports none.
 *  4. Owner Language: zero banned technical terms in the top-level Thai
 *     text for 3 real files in different real documentation states, while
 *     real technical detail remains present in the Computer Language layer
 *     and in Owner Language's own drilldown.
 *  5. getFolderSummary() on app/api/admin/ide/_lib/ real-aggregates with a
 *     documented/undocumented count independently re-derived here (not
 *     trusted blindly) directly from registry/module-registry.json via
 *     Guard 13's own real condition.
 *  6. Structural proof this file reuses sanitizeOwnerText()/
 *     loadArchitectureBook()/buildSystemRealityModel()/loadModuleRegistry()
 *     rather than reimplementing any of them.
 *  7. Structural proof this is genuinely on-demand — no eager batch loop
 *     over all architecture-book.json nodes, no background/interval code.
 *
 * Run: npm run architecture-summary:test
 */
import { readFileSync } from "fs";
import path from "path";
import {
  getFileSummary, getFolderSummary,
} from "../app/api/admin/ide/_lib/architectureSummaryRuntime";
import { buildSystemRealityModel, __debugResetArchitectureBookCache } from "../app/api/admin/ide/_lib/systemRealityRuntime";
import { containsHardBannedTerm } from "../app/api/admin/system-reality/_lib/ownerLanguage";
import { loadModuleRegistry } from "../app/api/admin/ide/_lib/classification";
import { WORKSPACE_ROOT } from "../app/api/admin/ide/_lib/fsSecurity";

const ROOT = WORKSPACE_ROOT;

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

/** Same convention scripts/dead-end-sweep-test.ts / scripts/system-reality-
 * model-test.ts already use: strip comments before a structural "must not
 * construct X" check, so this file's own header prose (which necessarily
 * mentions the real function/registry names it's testing) is never
 * mistaken for the runtime file actually doing something. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
}

const AUTO_STUB_TH_PREFIX = "[ตรวจพบอัตโนมัติ]";

async function main() {
  __debugResetArchitectureBookCache();
  const runtimeSrc = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/architectureSummaryRuntime.ts"), "utf-8");
  const codeOnly = stripComments(runtimeSrc);

  // Pre-build ONE real model, reused by tests that need to cross-check
  // exact business_function text — never a second, independent
  // recomputation of the same real 17-capability model.
  const model = await buildSystemRealityModel();
  const registry = loadModuleRegistry();

  console.log("=== Architecture Summary — real, live captured output ===");

  // ============================================================
  // 1 — AI Language on a real, documented file.
  // ============================================================
  await test("Acceptance 1 — getFileSummary('app/api/admin/ide/_lib/costGateRuntime.ts') real-derives a non-stub AI Language layer from module-registry.json's real, human-written purpose", async () => {
    const regEntry = registry.modules["app/api/admin/ide/_lib/costGateRuntime.ts"];
    assert(!!regEntry, "test-integrity: expected costGateRuntime.ts to be a real, registered file");
    assert(!regEntry.purpose.startsWith("[Auto-detected]"), "test-integrity: expected costGateRuntime.ts to have a real, non-stub purpose (positive control)");

    const summary = await getFileSummary("app/api/admin/ide/_lib/costGateRuntime.ts", { model });
    assert(summary.ai_language.state === "documented", `expected state=documented, got ${summary.ai_language.state}`);
    assert(summary.ai_language.description !== null, "expected a real, non-null description");
    assert(summary.ai_language.description!.length > 0, "expected a real, non-empty description");
    assert(summary.ai_language.description!.trim() === regEntry.purpose.trim().replace(/\s+/g, " "), "expected description to be a light, mechanical reformat of the REAL registry purpose text — not a rewrite");
    assert(summary.ai_language.source === `registry/module-registry.json#modules["app/api/admin/ide/_lib/costGateRuntime.ts"].purpose`, `unexpected source citation: ${summary.ai_language.source}`);
    console.log(`  [captured] costGateRuntime.ts ai_language.state=${summary.ai_language.state}`);
    console.log(`  [captured] costGateRuntime.ts ai_language.description="${summary.ai_language.description!.slice(0, 120)}..."`);
  });

  // ============================================================
  // 2 — AI Language on a real, stub file.
  // ============================================================
  await test("Acceptance 2 — getFileSummary('app/api/admin/ide/_lib/systemRealityRuntime.ts') honestly returns not_yet_documented — real, tested, live-dependents file, but never given a real purpose", async () => {
    const regEntry = registry.modules["app/api/admin/ide/_lib/systemRealityRuntime.ts"];
    assert(!!regEntry, "test-integrity: expected systemRealityRuntime.ts to be a real, registered (stub) file");
    assert(regEntry.purpose.startsWith("[Auto-detected]"), "test-integrity: expected systemRealityRuntime.ts to still carry the real auto-stub purpose (positive control for this test case)");

    const summary = await getFileSummary("app/api/admin/ide/_lib/systemRealityRuntime.ts", { model });
    assert(summary.ai_language.state === "not_yet_documented", `expected state=not_yet_documented, got ${summary.ai_language.state}`);
    assert(summary.ai_language.description === null, `expected null description, got "${summary.ai_language.description}"`);
    assert(summary.ai_language.description_th === null, `expected null description_th, got "${summary.ai_language.description_th}"`);
    assert(summary.ai_language.reason.includes("not yet documented") || summary.ai_language.reason.toLowerCase().includes("stub"), `expected an honest reason string, got: ${summary.ai_language.reason}`);
    // Real, disclosed proof this is NOT conflated with functional status:
    // the same file has real, live dependents in the Computer Language
    // layer even though AI Language honestly says undocumented.
    assert(summary.computer_language.dependents_count > 0, "test-integrity: expected systemRealityRuntime.ts to have real, live dependents (proves undocumented != non-functional)");
    console.log(`  [captured] systemRealityRuntime.ts ai_language.state=${summary.ai_language.state}, computer_language.dependents_count=${summary.computer_language.dependents_count}`);
  });

  // ============================================================
  // 3 — Business Language cross-reference (positive + negative).
  // ============================================================
  await test("Acceptance 3a — getFileSummary('engines/pricing.ts') real-surfaces its known cross-reference in systemRealityRuntime.ts's Cost Calculation capability AND FACTORY_CENTRAL_REGISTRY.json FCR-013, business_text reused verbatim (not rewritten)", async () => {
    const summary = await getFileSummary("engines/pricing.ts", { model });
    assert(summary.business_language.referenced === true, `expected referenced=true, got false; reason=${summary.business_language.reason}`);
    const capCitation = summary.business_language.citations.find((c) => c.source === "systemRealityRuntime:capability");
    assert(!!capCitation, `expected a systemRealityRuntime:capability citation, got: ${JSON.stringify(summary.business_language.citations)}`);
    const realCap = model.capabilities.find((c) => c.capability_name === capCitation!.id);
    assert(!!realCap, "test-integrity: citation id should match a real capability_name in the model");
    assert(capCitation!.business_text === realCap!.business_function, "expected business_text to be the REAL capability's business_function, reused verbatim, not paraphrased");
    const fcrCitation = summary.business_language.citations.find((c) => c.source === "FACTORY_CENTRAL_REGISTRY:finding" && c.id === "FCR-013");
    assert(!!fcrCitation, `expected a real FCR-013 citation, got: ${JSON.stringify(summary.business_language.citations.map((c) => c.id))}`);
    console.log(`  [captured] engines/pricing.ts business_language: ${summary.business_language.citations.length} real citation(s): ${summary.business_language.citations.map((c) => `${c.source}:${c.id}`).join(", ")}`);
  });

  await test("Acceptance 3b — getFileSummary('app/api/admin/ide/_lib/fsSecurity.ts') honestly reports NO business cross-reference (real, grep-confirmed zero mentions across all 3 real business sources)", async () => {
    const fsSecuritySrc = readFileSync(path.join(ROOT, "registry/FACTORY_CENTRAL_REGISTRY.json"), "utf-8");
    const roadmapSrc = readFileSync(path.join(ROOT, "registry/capability-roadmap.json"), "utf-8");
    const sysRealitySrc = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/systemRealityRuntime.ts"), "utf-8");
    assert(!fsSecuritySrc.includes("fsSecurity.ts") && !roadmapSrc.includes("fsSecurity.ts") && !sysRealitySrc.includes("fsSecurity.ts"), "test-integrity: expected zero real mentions of fsSecurity.ts in any of the 3 real business sources (positive control for the negative test)");

    const summary = await getFileSummary("app/api/admin/ide/_lib/fsSecurity.ts", { model });
    assert(summary.business_language.referenced === false, `expected referenced=false, got true: ${JSON.stringify(summary.business_language.citations)}`);
    assert(summary.business_language.citations.length === 0, "expected zero citations");
    assert(summary.business_language.reason.includes("no known business capability references this file yet"), `expected the exact honest-absence phrase, got: ${summary.business_language.reason}`);
    console.log(`  [captured] fsSecurity.ts business_language.referenced=${summary.business_language.referenced}`);
  });

  // ============================================================
  // 4 — Owner Language: zero banned terms at top level, real detail
  // preserved elsewhere, across 3 real, differently-documented files.
  // ============================================================
  const ownerLanguageCases: Array<{ label: string; filePath: string }> = [
    { label: "well-documented", filePath: "app/api/admin/ide/_lib/costGateRuntime.ts" },
    { label: "undocumented-stub", filePath: "app/api/admin/ide/_lib/systemRealityRuntime.ts" },
    { label: "business-cross-referenced", filePath: "engines/pricing.ts" },
  ];
  for (const c of ownerLanguageCases) {
    await test(`Acceptance 4 — Owner Language for "${c.filePath}" (${c.label}): zero banned technical terms (TypeScript/Git/Commit/registry filename/.ts module path) in the top-level Thai summary_th, while real technical detail remains present in computer_language`, async () => {
      const summary = await getFileSummary(c.filePath, { model });
      const ol = summary.owner_language;
      assert(!containsHardBannedTerm(ol.summary_th), `VIOLATION: summary_th for ${c.filePath} still contains a banned technical term: "${ol.summary_th}"`);
      assert(!containsHardBannedTerm(ol.computer_summary_th), `VIOLATION: computer_summary_th for ${c.filePath} still contains a banned technical term: "${ol.computer_summary_th}"`);
      assert(!containsHardBannedTerm(ol.ai_summary_th), `VIOLATION: ai_summary_th for ${c.filePath} still contains a banned technical term: "${ol.ai_summary_th}"`);
      assert(!containsHardBannedTerm(ol.business_summary_th), `VIOLATION: business_summary_th for ${c.filePath} still contains a banned technical term: "${ol.business_summary_th}"`);
      // Real technical detail must still exist SOMEWHERE real — proves
      // sanitization moved detail rather than deleting it.
      const hasRealTechnicalDetail =
        summary.computer_language.module_id.startsWith("module:") ||
        summary.computer_language.exports.length > 0 ||
        summary.computer_language.dependents.length > 0 ||
        containsHardBannedTerm(ol.drilldown.ai_raw_th) ||
        containsHardBannedTerm(ol.drilldown.business_raw_th);
      assert(hasRealTechnicalDetail, `expected real technical detail to survive somewhere (computer_language or drilldown) for ${c.filePath}`);
      console.log(`  [captured] ${c.filePath} (${c.label}) summary_th="${ol.summary_th.slice(0, 100)}..."`);
    });
  }

  // ============================================================
  // 5 — getFolderSummary() real aggregation, independently re-verified.
  // ============================================================
  await test('Acceptance 5 — getFolderSummary("app/api/admin/ide/_lib/") real-aggregates with documented/undocumented counts matching an INDEPENDENT re-derivation straight from registry/module-registry.json via Guard 13\'s own real condition', () => {
    const prefix = "app/api/admin/ide/_lib";
    const independentFiles = Object.keys(registry.modules).filter((p) => p === prefix || p.startsWith(`${prefix}/`));
    const independentMissing = independentFiles.filter((p) => {
      const m = registry.modules[p];
      return m.status === "unregistered" || String(m.purpose_th ?? "").startsWith(AUTO_STUB_TH_PREFIX);
    });

    const folder = getFolderSummary(prefix);
    assert(folder.file_count === independentFiles.length, `expected file_count=${independentFiles.length}, got ${folder.file_count}`);
    assert(folder.undocumented_count === independentMissing.length, `expected undocumented_count=${independentMissing.length}, got ${folder.undocumented_count}`);
    assert(folder.documented_count === independentFiles.length - independentMissing.length, `expected documented_count=${independentFiles.length - independentMissing.length}, got ${folder.documented_count}`);
    assert(new Set(folder.missing_files).size === folder.missing_files.length, "expected missing_files to have no duplicates");
    assert(
      JSON.stringify([...folder.missing_files].sort()) === JSON.stringify([...independentMissing].sort()),
      `expected missing_files to exactly match the independent re-derivation`,
    );
    const healthSum = folder.health.ok + folder.health.broken + folder.health.unused + folder.health.unregistered + folder.health.not_in_architecture_book;
    assert(healthSum === folder.file_count, `expected health counts to sum to file_count (${folder.file_count}), got ${healthSum}`);
    console.log(`  [captured] getFolderSummary("${prefix}"): file_count=${folder.file_count}, documented=${folder.documented_count}, undocumented=${folder.undocumented_count}, health=${JSON.stringify(folder.health)}`);
  });

  await test("Acceptance 5b — getFolderSummary() purpose_examples[] only ever contains real, non-stub purposes (never a stub sneaking through)", () => {
    const folder = getFolderSummary("app/api/admin/ide/_lib");
    for (const ex of folder.purpose_examples) {
      assert(!ex.purpose.startsWith("[Auto-detected]"), `VIOLATION: purpose_examples contains a stub for ${ex.file_path}`);
      assert(!folder.missing_files.includes(ex.file_path), `VIOLATION: ${ex.file_path} appears in both purpose_examples and missing_files`);
    }
    assert(folder.purpose_examples.length > 0, "test-integrity: expected at least 1 real purpose example in this real, populated folder");
  });

  await test("Acceptance 5c — getFolderSummary() on a real, non-existent/empty prefix honestly returns zero real files, never a fabricated result", () => {
    const folder = getFolderSummary("this/path/genuinely/does/not/exist/in/module-registry");
    assert(folder.file_count === 0, `expected file_count=0, got ${folder.file_count}`);
    assert(folder.documented_count === 0 && folder.undocumented_count === 0, "expected zero counts for a genuinely empty prefix");
    assert(folder.disclosed_limitations.some((d) => d.includes("zero real entries")), "expected an honest disclosed_limitations entry for the empty result");
  });

  // ============================================================
  // 6 — Structural proof of reuse (never reimplemented).
  // ============================================================
  await test("Structural 6a — architectureSummaryRuntime.ts really IMPORTS sanitizeOwnerText from ownerLanguage.ts (never reimplements the Owner-language sanitizer)", () => {
    assert(/import\s*\{[^}]*sanitizeOwnerText[^}]*\}\s*from\s*["'][^"']*ownerLanguage["']/.test(runtimeSrc), "expected a real import of sanitizeOwnerText from .../ownerLanguage");
    assert(!/function\s+sanitizeOwnerText\s*\(/.test(runtimeSrc), "expected NO local re-definition of sanitizeOwnerText");
  });

  await test("Structural 6b — architectureSummaryRuntime.ts really IMPORTS loadArchitectureBook/buildSystemRealityModel from systemRealityRuntime.ts (never reimplements the architecture-book loader/model composer)", () => {
    assert(/import\s*\{[^}]*loadArchitectureBook[^}]*\}\s*from\s*["']\.\/systemRealityRuntime["']/.test(runtimeSrc), "expected a real import of loadArchitectureBook from ./systemRealityRuntime");
    assert(/import\s*\{[^}]*buildSystemRealityModel[^}]*\}\s*from\s*["']\.\/systemRealityRuntime["']/.test(runtimeSrc), "expected a real import of buildSystemRealityModel from ./systemRealityRuntime");
    assert(!/function\s+loadArchitectureBook\s*\(/.test(runtimeSrc), "expected NO local re-definition of loadArchitectureBook");
    assert(!/function\s+buildSystemRealityModel\s*\(/.test(runtimeSrc), "expected NO local re-definition of buildSystemRealityModel");
    assert(!/queue\.shift\(\)/.test(runtimeSrc), "expected no local BFS traversal (that logic belongs to computeLiveReachability alone, and this file never even needs it)");
  });

  await test("Structural 6c — architectureSummaryRuntime.ts really IMPORTS loadModuleRegistry from classification.ts (never re-parses registry/module-registry.json itself)", () => {
    assert(/import\s*\{[^}]*loadModuleRegistry[^}]*\}\s*from\s*["']\.\/classification["']/.test(runtimeSrc), "expected a real import of loadModuleRegistry from ./classification");
    // Comment-stripped: this file's own header prose legitimately quotes
    // classification.ts's real `export function loadModuleRegistry()`
    // signature while explaining the reuse decision — that must never be
    // mistaken for a local re-definition in real code.
    assert(!/function\s+loadModuleRegistry\s*\(/.test(codeOnly), "expected NO local re-definition of loadModuleRegistry in real code");
    // Precise check (same technique as dead-end-sweep-test.ts's Structural
    // 5d): no real read-call token within 80 real chars before the literal
    // "module-registry.json" string, on comment-stripped code only.
    let cursor = 0; let offender: string | null = null;
    while (true) {
      const i = codeOnly.indexOf("module-registry.json", cursor);
      if (i === -1) break;
      const before = codeOnly.slice(Math.max(0, i - 80), i);
      if (/(readFileSync|readFile\s*\(|tryReadJsonLocal|JSON\.parse|require\()/.test(before)) { offender = before; break; }
      cursor = i + 1;
    }
    assert(offender === null, `expected zero real read-call constructions of "module-registry.json" in architectureSummaryRuntime.ts's real code — it must only ever reach that file via loadModuleRegistry(); found one preceded by: ...${offender}`);
  });

  await test("Structural 6d — architectureSummaryRuntime.ts reads registry/FACTORY_CENTRAL_REGISTRY.json and registry/capability-roadmap.json directly (the one real, correct case for a direct read — no existing exported wrapper for either exists anywhere in this repo)", () => {
    assert(codeOnly.includes('"registry/FACTORY_CENTRAL_REGISTRY.json"'), "expected a real, direct read of registry/FACTORY_CENTRAL_REGISTRY.json (no existing wrapper to reuse)");
    assert(codeOnly.includes('"registry/capability-roadmap.json"'), "expected a real, direct read of registry/capability-roadmap.json (no existing wrapper to reuse)");
  });

  // ============================================================
  // 7 — Structural proof of genuine on-demand-ness (no eager batch loop).
  // ============================================================
  await test("Structural 7a — architectureSummaryRuntime.ts contains ZERO background-loop/eager-batch patterns (setInterval/cron/while(true)/for(;;)), and getFolderSummary() never internally calls getFileSummary() in a fan-out loop", () => {
    const offenders: string[] = [];
    const patterns: [RegExp, string][] = [
      [/\bsetInterval\s*\(/, "setInterval("], [/\bcron\.schedule\s*\(/, "cron.schedule("],
      [/while\s*\(\s*true\s*\)/, "while (true)"], [/for\s*\(\s*;\s*;\s*\)/, "for (;;)"],
    ];
    for (const [re, label] of patterns) if (re.test(runtimeSrc)) offenders.push(label);
    assert(offenders.length === 0, `expected zero background-loop patterns, found: ${JSON.stringify(offenders)}`);
    const folderFnMatch = codeOnly.match(/export function getFolderSummary[\s\S]*?\n}\n/);
    assert(!!folderFnMatch, "test-integrity: expected to locate getFolderSummary's real function body");
    assert(!folderFnMatch![0].includes("getFileSummary("), "expected getFolderSummary() to never internally call getFileSummary() in a fan-out loop — it aggregates directly from the registry, per this task's own on-demand discipline");
  });

  await test("Structural 7b — architectureSummaryRuntime.ts contains ZERO writeFileSync/appendFileSync calls anywhere (pure read/compute, zero real side effects) and ZERO LLM/AI-provider call patterns (fetch/anthropic/openai)", () => {
    assert(!/writeFileSync|appendFileSync/.test(runtimeSrc), "expected zero write calls");
    assert(!/anthropic|openai|\bfetch\s*\(/i.test(codeOnly), "expected zero LLM/AI-provider/network call patterns in real code — every layer here is mechanical composition of already-real data, never a live summarization call");
  });

  await test("Structural 7c — architectureSummaryRuntime.ts never touches the off-limits registries (CONSTITUTION.json, rule-coverage.json, TASK_QUEUE.json, CHANGELOG.json) outside its own header comment", () => {
    for (const off of ["CONSTITUTION.json", "rule-coverage.json", "TASK_QUEUE.json", "CHANGELOG.json"]) {
      assert(!codeOnly.includes(off), `expected zero live-code references to off-limits ${off}`);
    }
  });

  // ============================================================
  // 8 — sources_composed honesty (same convention as the other Control-
  // Plane suites' own sources_composed checks).
  // ============================================================
  await test("Acceptance 8 — both FileSummary and FolderSummary real-cite their own real sources in sources_composed[]", async () => {
    const fileSummary = await getFileSummary("app/api/admin/ide/_lib/costGateRuntime.ts", { model });
    assert(fileSummary.sources_composed.some((s) => s.includes("module-registry.json")), "expected module-registry.json cited");
    assert(fileSummary.sources_composed.some((s) => s.includes("architecture-book.json")), "expected architecture-book.json cited");
    assert(fileSummary.sources_composed.some((s) => s.includes("ownerLanguage.ts")), "expected ownerLanguage.ts cited");
    const folderSummary = getFolderSummary("app/api/admin/ide/_lib");
    assert(folderSummary.sources_composed.some((s) => s.includes("module-registry.json")), "expected module-registry.json cited in folder summary");
    assert(folderSummary.sources_composed.some((s) => s.includes("Guard 13")), "expected Guard 13 cited in folder summary");
  });

  console.log("\n=== Architecture Summary Acceptance Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}

main();
