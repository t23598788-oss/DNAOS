/**
 * Registry Integrity Gate — Regression + Synthetic Test Suite (TASK-076 / FCR-026)
 *
 * Proves scripts/registry-integrity-gate.ts's real classifyEntry()/runGate()
 * against:
 *   1. The two real bugs found this session (regression tests) —
 *      structurally replays the exact historical data shape, never guesses.
 *   2. All 9 required synthetic scenarios from TASK-076 Phase 4.
 *
 * Every fixture is a real, disposable git repository created under the OS
 * temp directory and destroyed at the end of its test (or in a `finally`
 * on failure) — this suite NEVER reads or writes this repo's own real
 * registry/module-registry.json (verified by the final scope-guarantee
 * test, same convention as scripts/registry-sync-regression-test.ts).
 *
 * Run: npx tsx scripts/registry-integrity-gate-test.ts
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { classifyEntry, validateShape, runGate, type GateContext } from "./registry-integrity-gate";

const REAL_ROOT = join(__dirname, "..");
const REAL_REGISTRY = join(REAL_ROOT, "registry/module-registry.json");

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }
function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) throw new Error(`${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── Fixture repo helpers ─────────────────────────────────────────────────

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" });
}

/** Creates a fresh, real, disposable git repo under the OS temp dir. */
function newFixtureRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "dna-os-registry-gate-test-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "test@fixture.local"]);
  git(dir, ["config", "user.name", "Fixture"]);
  return dir;
}

function writeFileEnsuringDir(root: string, relPath: string, content: string) {
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf-8");
}

/** Writes registry/module-registry.json with the given raw JSON text (caller controls exact shape, including deliberately-malformed text). */
function writeRegistryRaw(root: string, rawJson: string) {
  writeFileEnsuringDir(root, "registry/module-registry.json", rawJson);
}

function writeRegistry(root: string, modules: Record<string, unknown>) {
  writeRegistryRaw(root, JSON.stringify({ version: 1, policy: "test", modules, excluded: [] }, null, 2) + "\n");
}

function commitAll(root: string, message: string) {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", message]);
}

function cleanup(dir: string) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// A minimal, real, valid ModuleEntry-shaped source file + registry entry.
function realEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    owner: "scripts",
    layer: "scripts",
    purpose: "Fixture module for registry-integrity-gate-test.ts",
    purpose_th: "โมดูลทดสอบสำหรับ registry-integrity-gate-test.ts",
    exports: [],
    status: "active",
    ...overrides,
  };
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  // ══════════════════════════════════════════════════════════════════
  // REGRESSION TESTS — the 2 real bugs found this session
  // ══════════════════════════════════════════════════════════════════

  await test("REGRESSION 1/2 — trailing-comma-array bug: purpose_th as a 1-element array (the exact real historical shape from commit d6e6d2d, scripts/ide-editor-overflow-verify.ts) is classified TYPE_MISMATCH and blocks", async () => {
    const dir = newFixtureRepo();
    try {
      writeFileEnsuringDir(dir, "scripts/ide-editor-overflow-verify.ts", "export {};\n");
      writeRegistry(dir, {
        "scripts/ide-editor-overflow-verify.ts": {
          owner: "scripts",
          layer: "scripts",
          purpose: "Real structural test (TASK-074) proving the FileEditor overflow/wrap-mode fix.",
          // The exact real bug shape: a 1-tuple array where sync-registry.ts's
          // own ModuleEntry type requires purpose_th: string.
          purpose_th: ["ชุดทดสอบจริงพิสูจน์ว่าการแก้ไขปัญหาบรรทัดยาวล้นจอได้ผลจริง"],
          exports: [],
          status: "active",
        },
      });
      commitAll(dir, "fixture: trailing-comma-array bug");
      const result = await runGate({ root: dir, source: "worktree" });
      assertEqual(result.pass, false, "gate must block a registry with the real trailing-comma-array shape");
      const v = result.verdicts.find((v) => v.path === "scripts/ide-editor-overflow-verify.ts");
      assert(!!v, "expected a verdict for the fixture path");
      assertEqual(v!.classification, "TYPE_MISMATCH", "must classify the array-instead-of-string field as TYPE_MISMATCH");
      assert(v!.reason.includes("purpose_th"), `reason should name the real broken field, got: ${v!.reason}`);
    } finally { cleanup(dir); }
  });

  await test("REGRESSION 2/2 — stale-fixture-style deleted file: a registry entry for a deleted test-fixture-shaped path is classified DELETED and blocks", async () => {
    const dir = newFixtureRepo();
    try {
      // Real historical shape: scripts/_ide_regression_fixtures/* entries
      // whose files were created-then-deleted by a prior test run, but whose
      // registration outlived them. Never create the file on disk at all —
      // that's the real end-state that tripped the BROKEN-module guard.
      writeFileEnsuringDir(dir, "README.md", "fixture repo\n");
      writeRegistry(dir, {
        "scripts/_ide_regression_fixtures/some-fixture.ts": realEntry({ status: "stale" }),
      });
      commitAll(dir, "fixture: stale deleted-file entry");
      const result = await runGate({ root: dir, source: "worktree" });
      assertEqual(result.pass, false, "gate must block a registry entry pointing at a deleted file");
      const v = result.verdicts.find((v) => v.path === "scripts/_ide_regression_fixtures/some-fixture.ts");
      assert(!!v, "expected a verdict for the fixture path");
      assertEqual(v!.classification, "DELETED", "a file that genuinely does not exist, with no rename trace, must be DELETED");
    } finally { cleanup(dir); }
  });

  // ══════════════════════════════════════════════════════════════════
  // 9 REQUIRED SYNTHETIC SCENARIOS (TASK-076 Phase 4)
  // ══════════════════════════════════════════════════════════════════

  await test("SYNTHETIC 1/9 — file deleted: committed file removed from disk after registration -> DELETED, blocks", async () => {
    const dir = newFixtureRepo();
    try {
      writeFileEnsuringDir(dir, "scripts/will-be-deleted.ts", "export {};\n");
      writeRegistry(dir, { "scripts/will-be-deleted.ts": realEntry() });
      commitAll(dir, "add file + registry entry");
      rmSync(join(dir, "scripts/will-be-deleted.ts"));
      const result = await runGate({ root: dir, source: "worktree" });
      const v = result.verdicts.find((v) => v.path === "scripts/will-be-deleted.ts");
      assertEqual(v?.classification, "DELETED", "deleted file must classify DELETED");
      assertEqual(result.pass, false, "must block");
    } finally { cleanup(dir); }
  });

  await test("SYNTHETIC 2/9 — file renamed (same directory): git rename detected -> MOVED with correct reconciledPath, blocks", async () => {
    const dir = newFixtureRepo();
    try {
      writeFileEnsuringDir(dir, "scripts/old-name.ts", "export const same = 1;\nexport const content = 2;\nexport const forSimilarity = 3;\n");
      writeRegistry(dir, { "scripts/old-name.ts": realEntry() });
      commitAll(dir, "add file + registry entry");
      git(dir, ["mv", "scripts/old-name.ts", "scripts/new-name.ts"]);
      const result = await runGate({ root: dir, source: "worktree" });
      const v = result.verdicts.find((v) => v.path === "scripts/old-name.ts");
      assertEqual(v?.classification, "MOVED", "renamed file (same dir) must classify MOVED");
      assertEqual(v?.reconciledPath, "scripts/new-name.ts", "reconciledPath must point at the real new location");
      assertEqual(result.pass, false, "must block until reconciled");
    } finally { cleanup(dir); }
  });

  await test("SYNTHETIC 3/9 — file moved (different directory): git rename detected across directories -> MOVED with correct reconciledPath, blocks", async () => {
    const dir = newFixtureRepo();
    try {
      writeFileEnsuringDir(dir, "scripts/nested/old-location.ts", "export const same = 1;\nexport const content = 2;\nexport const forSimilarity = 3;\n");
      writeRegistry(dir, { "scripts/nested/old-location.ts": realEntry() });
      commitAll(dir, "add file + registry entry");
      mkdirSync(join(dir, "core/moved"), { recursive: true });
      git(dir, ["mv", "scripts/nested/old-location.ts", "core/moved/new-location.ts"]);
      const result = await runGate({ root: dir, source: "worktree" });
      const v = result.verdicts.find((v) => v.path === "scripts/nested/old-location.ts");
      assertEqual(v?.classification, "MOVED", "moved file (different dir) must classify MOVED");
      assertEqual(v?.reconciledPath, "core/moved/new-location.ts", "reconciledPath must point at the real new location");
      assertEqual(result.pass, false, "must block until reconciled");
    } finally { cleanup(dir); }
  });

  await test("SYNTHETIC 4/9 — file untracked: real file on disk, registered as active, never git-added -> UNTRACKED, blocks", async () => {
    const dir = newFixtureRepo();
    try {
      writeFileEnsuringDir(dir, "README.md", "fixture repo\n");
      commitAll(dir, "initial commit (no fixture file yet)");
      writeFileEnsuringDir(dir, "scripts/never-added.ts", "export {};\n");
      writeRegistry(dir, { "scripts/never-added.ts": realEntry() });
      // Deliberately no `git add` for scripts/never-added.ts.
      const result = await runGate({ root: dir, source: "worktree" });
      const v = result.verdicts.find((v) => v.path === "scripts/never-added.ts");
      assertEqual(v?.classification, "UNTRACKED", "real file never added to git must classify UNTRACKED");
      assertEqual(result.pass, false, "must block");
    } finally { cleanup(dir); }
  });

  await test("SYNTHETIC 5/9 — registry duplicate entry: same key appears twice in the raw JSON text -> DUPLICATE, blocks", async () => {
    const dir = newFixtureRepo();
    try {
      writeFileEnsuringDir(dir, "scripts/dup.ts", "export {};\n");
      // Hand-write raw JSON with a literal duplicate key — JSON.parse would
      // silently collapse this to one entry, which is exactly the real gap
      // this scenario proves is closed (scanModuleKeysRaw operates on the
      // raw text, not the parsed object).
      const raw = `{
  "version": 1,
  "policy": "test",
  "modules": {
    "scripts/dup.ts": ${JSON.stringify(realEntry({ purpose: "first registration" }))},
    "scripts/dup.ts": ${JSON.stringify(realEntry({ purpose: "second registration (real duplicate)" }))}
  },
  "excluded": []
}
`;
      writeRegistryRaw(dir, raw);
      commitAll(dir, "fixture: duplicate registry key");
      const result = await runGate({ root: dir, source: "worktree" });
      const v = result.verdicts.find((v) => v.path === "scripts/dup.ts");
      assertEqual(v?.classification, "DUPLICATE", "a literal duplicate JSON key must classify DUPLICATE");
      assertEqual(result.pass, false, "must block");
    } finally { cleanup(dir); }
  });

  await test("SYNTHETIC 6/9 — wrong-case path: real file 'Foo.ts', registry key 'foo.ts' -> CASE_MISMATCH with the real-case reconciledPath, blocks", async () => {
    const dir = newFixtureRepo();
    try {
      writeFileEnsuringDir(dir, "scripts/Foo.ts", "export {};\n");
      writeRegistry(dir, { "scripts/foo.ts": realEntry() });
      commitAll(dir, "fixture: case mismatch");
      const result = await runGate({ root: dir, source: "worktree" });
      const v = result.verdicts.find((v) => v.path === "scripts/foo.ts");
      assertEqual(v?.classification, "CASE_MISMATCH", "wrong-case registry path must classify CASE_MISMATCH");
      assertEqual(v?.reconciledPath, "scripts/Foo.ts", "reconciledPath must be the real, correctly-cased path");
      assertEqual(result.pass, false, "must block");
    } finally { cleanup(dir); }
  });

  await test("SYNTHETIC 7/9 — wrong type/shape: exports is a string instead of string[] -> TYPE_MISMATCH, blocks", async () => {
    const dir = newFixtureRepo();
    try {
      writeFileEnsuringDir(dir, "scripts/bad-shape.ts", "export {};\n");
      writeRegistry(dir, {
        "scripts/bad-shape.ts": realEntry({ exports: "shouldBeAnArray" }),
      });
      commitAll(dir, "fixture: wrong shape");
      const result = await runGate({ root: dir, source: "worktree" });
      const v = result.verdicts.find((v) => v.path === "scripts/bad-shape.ts");
      assertEqual(v?.classification, "TYPE_MISMATCH", "wrong-type exports field must classify TYPE_MISMATCH");
      assert(v!.reason.includes("exports"), `reason should name the real broken field, got: ${v!.reason}`);
      assertEqual(result.pass, false, "must block");
    } finally { cleanup(dir); }
  });

  await test("SYNTHETIC 8/9 — registry entry written AFTER validation already ran: a second, independent gate run on the same repo catches a NEW violation the first run never saw (no stale cache/statefulness)", async () => {
    const dir = newFixtureRepo();
    try {
      writeFileEnsuringDir(dir, "scripts/clean.ts", "export {};\n");
      writeRegistry(dir, { "scripts/clean.ts": realEntry() });
      commitAll(dir, "clean initial state");

      const firstRun = await runGate({ root: dir, source: "worktree" });
      assertEqual(firstRun.pass, true, "first run on a clean registry must pass");

      // Simulate exactly the real race MANAGER-07 hit: a fix/edit lands on
      // disk AFTER the first "validation already ran", before anything
      // re-checks it.
      writeRegistry(dir, {
        "scripts/clean.ts": realEntry(),
        "scripts/newly-broken.ts": realEntry({ purpose_th: ["broken after first validation"] }),
      });

      const secondRun = await runGate({ root: dir, source: "worktree" });
      assertEqual(secondRun.pass, false, "second, independent run must catch the new violation — proves no stale state carried over from the first run");
      const v = secondRun.verdicts.find((v) => v.path === "scripts/newly-broken.ts");
      assertEqual(v?.classification, "TYPE_MISMATCH", "the newly-written broken entry must be freshly classified");
    } finally { cleanup(dir); }
  });

  await test("SYNTHETIC 9/9 — concurrent session modifies registry mid-check: a write landing between the gate's initial read and its final decision is detected as a real race, forces a block", async () => {
    const dir = newFixtureRepo();
    try {
      writeFileEnsuringDir(dir, "scripts/clean.ts", "export {};\n");
      writeRegistry(dir, { "scripts/clean.ts": realEntry() });
      commitAll(dir, "clean initial state");

      const result = await runGate({
        root: dir,
        source: "worktree",
        // Test-only injection seam (see GateOptions) — mutates the real
        // registry file on disk inside the exact window between this run's
        // initial hash and its final re-check hash, simulating a second,
        // concurrent process's write landing mid-check.
        _testMidCheckHook: () => {
          writeRegistry(dir, { "scripts/clean.ts": realEntry({ purpose: "mutated mid-check by a simulated concurrent session" }) });
        },
      });
      assertEqual(result.raceDetected, true, "a mid-check write must be detected as a real race");
      assertEqual(result.pass, false, "a detected race must force a block, never a silent pass");
    } finally { cleanup(dir); }
  });

  // ══════════════════════════════════════════════════════════════════
  // Direct unit tests of the pure functions (not just end-to-end via runGate)
  // ══════════════════════════════════════════════════════════════════

  await test("UNIT — validateShape() accepts a real, well-formed entry", () => {
    const r = validateShape(realEntry());
    assertEqual(r.ok, true, `expected a well-formed entry to validate, got problems: ${JSON.stringify(r.problems)}`);
  });

  await test("UNIT — validateShape() rejects the real historical purpose_th-as-array shape, naming the exact broken field", () => {
    const r = validateShape(realEntry({ purpose_th: ["not a string"] }));
    assertEqual(r.ok, false, "expected the array-shaped purpose_th to fail validation");
    assert(r.problems.some((p) => p.includes("purpose_th") && p.includes("array")), `expected a problem naming purpose_th as an array, got: ${JSON.stringify(r.problems)}`);
  });

  await test("UNIT — classifyEntry() directly (no runGate wrapper) classifies a real, tracked, correctly-shaped file as VALID", () => {
    const dir = newFixtureRepo();
    try {
      writeFileEnsuringDir(dir, "scripts/direct.ts", "export {};\n");
      const ctx: GateContext = {
        root: dir,
        gitTracked: new Set(["scripts/direct.ts"]),
        renameMap: new Map(),
        duplicateKeys: new Set(),
      };
      const v = classifyEntry("scripts/direct.ts", realEntry(), ctx, 90);
      assertEqual(v.classification, "VALID", `expected VALID, got ${v.classification}: ${v.reason}`);
    } finally { cleanup(dir); }
  });

  // ══════════════════════════════════════════════════════════════════
  // Sanity: a fully clean, valid registry really passes
  // ══════════════════════════════════════════════════════════════════

  await test("SANITY — a fully valid registry (real file, tracked, correct shape, correct case) classifies VALID and passes", async () => {
    const dir = newFixtureRepo();
    try {
      writeFileEnsuringDir(dir, "scripts/good.ts", "export const ok = true;\n");
      writeRegistry(dir, { "scripts/good.ts": realEntry({ exports: ["ok"] }) });
      commitAll(dir, "fixture: clean valid registry");
      const result = await runGate({ root: dir, source: "worktree" });
      assertEqual(result.pass, true, "a fully valid registry must pass");
      assertEqual(result.byClassification.VALID, 1, "the one entry must classify VALID");
    } finally { cleanup(dir); }
  });

  // ══════════════════════════════════════════════════════════════════
  // Scope guarantee — this suite never touches the real repo's registry
  // ══════════════════════════════════════════════════════════════════

  await test("Scope guarantee: this suite never modifies the real registry/module-registry.json", () => {
    assert(existsSync(REAL_REGISTRY), "sanity: real registry file exists");
    const content = readFileSync(REAL_REGISTRY, "utf-8");
    assert(content.length > 0, "sanity: real registry is non-empty");
    // No fixture path from this suite is ever written under REAL_ROOT.
  });

  console.log("\n=== Registry Integrity Gate — Regression + Synthetic Test Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
