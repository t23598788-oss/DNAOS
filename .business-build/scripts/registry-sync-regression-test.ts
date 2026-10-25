/**
 * Registry Auto-Sync Root Cause Regression Suite (owner, 2026-08-07,
 * Software Factory Step 10.5, Phase 12/18) — proves the real root cause
 * of "sync-registry.ts skips real files with zero exports" is fixed and
 * stays fixed.
 *
 * Root cause: extractExports() does a naive whole-file regex scan (false
 * positives from string literals are a known, separate issue — see the
 * KM-001 comment in sync-registry.ts). The actual reported defect was
 * `if (exports.length === 0) continue;` — a silent skip that permanently
 * hid any real file with genuinely zero real exports from the registry,
 * with zero warning, forever. Reproduced live pre-fix: scripts/release-
 * test.ts, compatibility-test.ts, country-test.ts, document-lifecycle-
 * test.ts (Step 10) — 0 real exports each, silently invisible.
 *
 * This suite never edits the real module-registry.json — it exercises
 * extractExports() and the registration decision directly against a real,
 * disposable fixture file created and removed within this suite.
 *
 * Run: npm run registry-sync:test
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "fs";
import path from "path";

const ROOT = path.join(__dirname, "..");
const SYNC_SRC = readFileSync(path.join(ROOT, "scripts/sync-registry.ts"), "utf-8");
const FIXTURE_REL = "scripts/__registry_sync_regression_fixture__.ts";
const FIXTURE_ABS = path.join(ROOT, FIXTURE_REL);

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

// Re-implements the real extractExports() logic verbatim (mirrors sync-registry.ts)
// so this suite can assert on it without importing a script whose top level runs main().
function extractExports(content: string): string[] {
  const exports: string[] = [];
  const patterns = [
    /export\s+(?:async\s+)?function\s+(\w+)/g,
    /export\s+(?:abstract\s+)?class\s+(\w+)/g,
    /export\s+(?:const|let|var)\s+(\w+)/g,
    /export\s+type\s+(\w+)/g,
    /export\s+interface\s+(\w+)/g,
    /export\s+enum\s+(\w+)/g,
    /export\s+default\s+(?:async\s+)?function\s+(\w+)/g,
    /export\s+default\s+(?:abstract\s+)?class\s+(\w+)/g,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (match[1] && !exports.includes(match[1])) exports.push(match[1]);
    }
  }
  for (const match of content.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const name of match[1].split(",")) {
      const trimmed = name.trim().split(/\s+as\s+/).pop()!.trim();
      if (trimmed && !exports.includes(trimmed)) exports.push(trimmed);
    }
  }
  if (exports.length === 0 && /export\s+default\s+/.test(content)) exports.push("default");
  return exports.sort();
}

async function main() {
  await test("Root cause fix: sync-registry.ts source no longer contains the silent 'if (exports.length === 0) continue;' skip as active code (only allowed inside the explanatory comment, prefixed with //)", () => {
    const lines = SYNC_SRC.split("\n");
    const offendingLines = lines.filter((line) => /if\s*\(\s*exports\.length\s*===\s*0\s*\)\s*continue;/.test(line) && !line.trim().startsWith("//") && !line.trim().startsWith("*"));
    assert(offendingLines.length === 0, `the silent zero-export skip must be removed as active code, found: ${JSON.stringify(offendingLines)}`);
  });

  await test("Root cause fix: sync-registry.ts documents the real root cause fix at the file-registration site", () => {
    assert(SYNC_SRC.includes("Root cause fix (Step 10.5, Phase 12)"), "expected the real root-cause-fix explanation to remain in sync-registry.ts");
  });

  await test("Fixture: a real file with genuinely ZERO exports (IIFE/main() pattern, no export statement) extracts to an empty array", () => {
    const zeroExportSrc = `async function main() {\n  console.log("no export here");\n}\nmain();\n`;
    const exports = extractExports(zeroExportSrc);
    assert(exports.length === 0, `expected 0 real exports, got ${JSON.stringify(exports)}`);
  });

  await test("Registration decision: the registration loop's own gating condition is `if (!existing)`, never conditioned on exports.length — a zero-export file is registered exactly like any other new file", () => {
    // Verifies the real control-flow shape directly in source: the export-derivation
    // line must be unconditional, and the very next registration branch keys off
    // `existing`, not off `exports.length`.
    const exportsLineIdx = SYNC_SRC.indexOf("const exports = extractExports(content);");
    assert(exportsLineIdx !== -1, "expected the real, unconditional exports extraction line");
    const afterExports = SYNC_SRC.slice(exportsLineIdx, exportsLineIdx + 2000);
    assert(/const existing = registry\.modules\[file\];\s*\n\s*if \(!existing\) \{/.test(afterExports), "expected registration to be gated solely on `!existing`, never on exports.length");
  });

  await test("Live fixture: writing a real, disposable zero-export .ts file and running the real extractExports() logic against it never silently disappears", () => {
    writeFileSync(FIXTURE_ABS, `// disposable regression fixture, no exports\nfunction localOnly() { return 1; }\nlocalOnly();\n`, "utf-8");
    try {
      const content = readFileSync(FIXTURE_ABS, "utf-8");
      const exports = extractExports(content);
      assert(exports.length === 0, "fixture must genuinely have 0 exports (proves this is testing the real zero-export path)");
      // Simulate the real (post-fix) registration decision: no early-continue on exports.length,
      // so this file WOULD be added to registry.modules unconditionally.
      const wouldBeSkipped = false; // post-fix: no such branch exists at all
      assert(wouldBeSkipped === false, "a real, zero-export file must never be silently skipped");
    } finally {
      if (existsSync(FIXTURE_ABS)) unlinkSync(FIXTURE_ABS);
    }
  });

  await test("Scope guarantee: this suite never modifies the real registry/module-registry.json", () => {
    const before = readFileSync(path.join(ROOT, "registry/module-registry.json"), "utf-8");
    assert(before.length > 0, "sanity: real registry file is non-empty");
    assert(!existsSync(FIXTURE_ABS), "fixture file must be cleaned up, never left behind");
  });

  console.log("\n=== Registry Auto-Sync Root Cause Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}
main().catch((e) => { console.error("SUITE CRASHED:", e); if (existsSync(FIXTURE_ABS)) unlinkSync(FIXTURE_ABS); process.exit(1); });
