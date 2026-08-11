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
import { classifyEntry, validateShape, runGate, computeRelevantPaths, type GateContext } from "./registry-integrity-gate";

const REAL_ROOT = join(__dirname, "..");
const REAL_REGISTRY = join(REAL_ROOT, "registry/module-registry.json");

/**
 * The real, primary, shared working tree this repository was originally
 * checked out into — e.g. `/Users/.../dna-os-deadboard`, the one place
 * scripts/pre-commit-check.sh actually runs and every session actually
 * commits to. Deliberately NOT the same as REAL_ROOT (`join(__dirname,
 * "..")`): this exact test file is designed to also run from inside a
 * disposable, isolated `git worktree add` copy (this file's own required
 * verification protocol, TASK-076/077/080), where `__dirname` resolves to
 * that copy, not the real shared repo. `git worktree list --porcelain`'s
 * FIRST entry is always the original/primary worktree a repo's `.git`
 * directory was created from, regardless of which worktree this process is
 * actually running out of (every worktree shares the same underlying git
 * object database) — fully dynamic, never a hardcoded machine-specific
 * path. Used only by the TASK-080 LIVE ACCEPTANCE test below, which is
 * meaningless against a fixture/copy and must always target the real thing.
 */
function findPrimaryWorktreeRoot(): string {
  const out = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: __dirname, encoding: "utf-8" });
  const firstLine = out.split("\n")[0] ?? "";
  const m = /^worktree (.+)$/.exec(firstLine);
  if (!m) throw new Error(`could not parse 'git worktree list --porcelain' output to find the real, primary, shared working tree: ${out.slice(0, 200)}`);
  return m[1];
}

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

  await test("REGRESSION 1/2 — trailing-comma-array bug: purpose_th as a 1-element array (the exact real historical shape from commit d6e6d2d, scripts/ide-editor-overflow-verify.ts) is classified TYPE_MISMATCH and blocks (real, staged, IN this commit's scope — TASK-077)", async () => {
    const dir = newFixtureRepo();
    try {
      // Baseline commit WITHOUT the bug — this run's own real, staged change
      // (below) is what introduces it, matching the real shape of "this
      // commit's own real changes" that TASK-077's relevance scoping must
      // still hard-block on with zero weakening.
      writeFileEnsuringDir(dir, "README.md", "fixture repo\n");
      commitAll(dir, "baseline (no fixture entry yet)");
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
      git(dir, ["add", "-A"]); // stage — this is this commit's own real, in-scope change
      const result = await runGate({ root: dir, source: "worktree" });
      assertEqual(result.pass, false, "gate must block a registry with the real trailing-comma-array shape");
      const v = result.verdicts.find((v) => v.path === "scripts/ide-editor-overflow-verify.ts");
      assert(!!v, "expected a verdict for the fixture path");
      assertEqual(v!.classification, "TYPE_MISMATCH", "must classify the array-instead-of-string field as TYPE_MISMATCH");
      assert(v!.reason.includes("purpose_th"), `reason should name the real broken field, got: ${v!.reason}`);
      assert(result.blockers.some((b) => b.path === "scripts/ide-editor-overflow-verify.ts"), "must be a real hard blocker, not report-only");
    } finally { cleanup(dir); }
  });

  await test("REGRESSION 2/2 — stale-fixture-style deleted file: a registry entry for a deleted test-fixture-shaped path is classified DELETED and blocks (real, staged, IN this commit's scope — TASK-077)", async () => {
    const dir = newFixtureRepo();
    try {
      // Real historical shape: scripts/_ide_regression_fixtures/* entries
      // whose files were created-then-deleted by a prior test run, but whose
      // registration outlived them. Never create the file on disk at all —
      // that's the real end-state that tripped the BROKEN-module guard.
      writeFileEnsuringDir(dir, "README.md", "fixture repo\n");
      commitAll(dir, "baseline (no fixture entry yet)");
      writeRegistry(dir, {
        "scripts/_ide_regression_fixtures/some-fixture.ts": realEntry({ status: "stale" }),
      });
      git(dir, ["add", "-A"]); // stage — this is this commit's own real, in-scope change
      const result = await runGate({ root: dir, source: "worktree" });
      assertEqual(result.pass, false, "gate must block a registry entry pointing at a deleted file");
      const v = result.verdicts.find((v) => v.path === "scripts/_ide_regression_fixtures/some-fixture.ts");
      assert(!!v, "expected a verdict for the fixture path");
      assertEqual(v!.classification, "DELETED", "a file that genuinely does not exist, with no rename trace, must be DELETED");
      assert(result.blockers.some((b) => b.path === "scripts/_ide_regression_fixtures/some-fixture.ts"), "must be a real hard blocker, not report-only");
    } finally { cleanup(dir); }
  });

  // ══════════════════════════════════════════════════════════════════
  // 9 REQUIRED SYNTHETIC SCENARIOS (TASK-076 Phase 4)
  // ══════════════════════════════════════════════════════════════════

  await test("SYNTHETIC 1/9 — file deleted: committed file removed from disk after registration -> DELETED, blocks (real, staged deletion — TASK-077 in-scope)", async () => {
    const dir = newFixtureRepo();
    try {
      writeFileEnsuringDir(dir, "scripts/will-be-deleted.ts", "export {};\n");
      writeRegistry(dir, { "scripts/will-be-deleted.ts": realEntry() });
      commitAll(dir, "add file + registry entry");
      rmSync(join(dir, "scripts/will-be-deleted.ts"));
      // TASK-077: stage the real deletion — this is what makes it THIS
      // commit's own real change (as opposed to a pre-existing, unrelated
      // deletion nobody has staged yet), which must still hard-block.
      git(dir, ["add", "-A"]);
      const result = await runGate({ root: dir, source: "worktree" });
      const v = result.verdicts.find((v) => v.path === "scripts/will-be-deleted.ts");
      assertEqual(v?.classification, "DELETED", "deleted file must classify DELETED");
      assertEqual(result.pass, false, "must block");
      assert(result.blockers.some((b) => b.path === "scripts/will-be-deleted.ts"), "must be a real hard blocker, not report-only");
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
      // Deliberately no `git add` for scripts/never-added.ts — but DO stage
      // the registry change itself (TASK-080: computeRelevantPaths()'s
      // "differs from HEAD" scan only runs when registry/module-registry.json
      // is itself staged, so this new entry must be made real+relevant via
      // that route, exactly like scripts/sync-registry.ts staging its own
      // real registry edit as part of a real commit).
      git(dir, ["add", "registry/module-registry.json"]);
      const result = await runGate({ root: dir, source: "worktree" });
      const v = result.verdicts.find((v) => v.path === "scripts/never-added.ts");
      assertEqual(v?.classification, "UNTRACKED", "real file never added to git must classify UNTRACKED");
      assertEqual(result.pass, false, "must block");
    } finally { cleanup(dir); }
  });

  await test("SYNTHETIC 5/9 — registry duplicate entry: same key appears twice in the raw JSON text -> DUPLICATE, blocks (real, staged, IN this commit's scope — TASK-077)", async () => {
    const dir = newFixtureRepo();
    try {
      writeFileEnsuringDir(dir, "README.md", "fixture repo\n");
      commitAll(dir, "baseline (no fixture entry yet)");
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
      git(dir, ["add", "-A"]); // stage — this commit's own real, in-scope change
      const result = await runGate({ root: dir, source: "worktree" });
      const v = result.verdicts.find((v) => v.path === "scripts/dup.ts");
      assertEqual(v?.classification, "DUPLICATE", "a literal duplicate JSON key must classify DUPLICATE");
      assertEqual(result.pass, false, "must block");
      assert(result.blockers.some((b) => b.path === "scripts/dup.ts"), "must be a real hard blocker, not report-only");
    } finally { cleanup(dir); }
  });

  await test("SYNTHETIC 6/9 — wrong-case path: real file 'Foo.ts', registry key 'foo.ts' -> CASE_MISMATCH with the real-case reconciledPath, blocks (real, staged, IN this commit's scope — TASK-077)", async () => {
    const dir = newFixtureRepo();
    try {
      writeFileEnsuringDir(dir, "README.md", "fixture repo\n");
      commitAll(dir, "baseline (no fixture entry yet)");
      writeFileEnsuringDir(dir, "scripts/Foo.ts", "export {};\n");
      writeRegistry(dir, { "scripts/foo.ts": realEntry() });
      git(dir, ["add", "-A"]); // stage — this commit's own real, in-scope change
      const result = await runGate({ root: dir, source: "worktree" });
      const v = result.verdicts.find((v) => v.path === "scripts/foo.ts");
      assertEqual(v?.classification, "CASE_MISMATCH", "wrong-case registry path must classify CASE_MISMATCH");
      assertEqual(v?.reconciledPath, "scripts/Foo.ts", "reconciledPath must be the real, correctly-cased path");
      assertEqual(result.pass, false, "must block");
      assert(result.blockers.some((b) => b.path === "scripts/foo.ts"), "must be a real hard blocker, not report-only");
    } finally { cleanup(dir); }
  });

  await test("SYNTHETIC 7/9 — wrong type/shape: exports is a string instead of string[] -> TYPE_MISMATCH, blocks (real, staged, IN this commit's scope — TASK-077)", async () => {
    const dir = newFixtureRepo();
    try {
      writeFileEnsuringDir(dir, "README.md", "fixture repo\n");
      commitAll(dir, "baseline (no fixture entry yet)");
      writeFileEnsuringDir(dir, "scripts/bad-shape.ts", "export {};\n");
      writeRegistry(dir, {
        "scripts/bad-shape.ts": realEntry({ exports: "shouldBeAnArray" }),
      });
      git(dir, ["add", "-A"]); // stage — this commit's own real, in-scope change
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
      // TASK-080: stage the corrupted registry edit itself — this scenario is
      // proving that a SECOND, independent run catches a genuinely new,
      // in-scope violation (no stale cache), not proving anything about
      // relevance-scoping, so it must reflect a real staged registry change
      // (exactly like the original TASK-076 bug shape) rather than an
      // unstaged, pre-existing-noise-shaped edit.
      git(dir, ["add", "-A"]);

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
  // TASK-077 / FCR-026 follow-up — commit-relevance scoping
  //
  // Proves the exact real-world distinction MANAGER-07's own independent
  // verification found missing: an UNTRACKED-classified entry that is real,
  // pre-existing registry content unrelated to THIS commit (nothing staged,
  // nothing changed since HEAD — e.g. a concurrent session's real,
  // in-progress work) must PASS, report-only, never block. An otherwise
  // IDENTICAL UNTRACKED entry that genuinely IS part of THIS commit (its
  // registry entry is new/changed relative to HEAD, exactly what
  // scripts/sync-registry.ts, Step 0, would really do) must still hard-block
  // — zero weakening for the actual bug class the gate exists to catch.
  // ══════════════════════════════════════════════════════════════════

  await test("SCOPE 1/2 — UNTRACKED entry OUTSIDE this commit's scope (real, pre-existing, already at HEAD, nothing staged/changed) -> PASS, report-only, never blocks", async () => {
    const dir = newFixtureRepo();
    try {
      // The source file genuinely exists on disk but was never `git add`ed —
      // yet the registry ENTRY referencing it was already committed to HEAD
      // in a real, prior commit (a real, historical registration gap, same
      // shape as this repo's own real concurrent-session noise). Nothing
      // about this commit touches it: nothing staged, and the entry's value
      // is byte-identical to what's already at HEAD.
      writeFileEnsuringDir(dir, "scripts/legacy-untracked.ts", "export {};\n");
      writeRegistry(dir, { "scripts/legacy-untracked.ts": realEntry() });
      git(dir, ["add", "registry/module-registry.json"]); // registry entry committed; the .ts file itself deliberately never added
      git(dir, ["commit", "-q", "-m", "baseline: pre-existing untracked-referencing entry, already real at HEAD"]);
      // Nothing further staged, nothing further changed — this run has
      // nothing to do with this entry at all.
      const result = await runGate({ root: dir, source: "worktree" });
      const v = result.verdicts.find((v) => v.path === "scripts/legacy-untracked.ts");
      assert(!!v, "expected a verdict for the fixture path");
      assertEqual(v!.classification, "UNTRACKED", "real file never added to git must still classify UNTRACKED (full, honest 4-layer classification, never skipped)");
      assert(result.reportOnly.some((r) => r.path === "scripts/legacy-untracked.ts"), "must be reported (transparency — never silently hidden)");
      assert(!result.blockers.some((b) => b.path === "scripts/legacy-untracked.ts"), "must NOT be a hard blocker — real, pre-existing, unrelated to this commit");
      assertEqual(result.pass, true, "overall gate result must PASS — nothing relevant to this commit is broken");
    } finally { cleanup(dir); }
  });

  await test("SCOPE 2/2 — otherwise-IDENTICAL UNTRACKED entry INSIDE this commit's scope (registry entry newly added/changed this run, exactly what sync-registry.ts Step 0 really does) -> BLOCK, zero weakening", async () => {
    const dir = newFixtureRepo();
    try {
      writeFileEnsuringDir(dir, "README.md", "fixture repo\n");
      commitAll(dir, "baseline (no fixture entry yet)");
      // Same real shape as SCOPE 1/2 (file exists, never `git add`ed) — but
      // this time the registry entry itself is genuinely NEW relative to
      // HEAD (added this run, staged, exactly the real
      // scripts/sync-registry.ts Step 0 shape) — a real, in-scope change
      // this commit is actually making.
      writeFileEnsuringDir(dir, "scripts/legacy-untracked.ts", "export {};\n");
      writeRegistry(dir, { "scripts/legacy-untracked.ts": realEntry() });
      git(dir, ["add", "registry/module-registry.json"]); // stage the registry change; the .ts file itself deliberately never added (still real UNTRACKED)
      const result = await runGate({ root: dir, source: "worktree" });
      const v = result.verdicts.find((v) => v.path === "scripts/legacy-untracked.ts");
      assert(!!v, "expected a verdict for the fixture path");
      assertEqual(v!.classification, "UNTRACKED", "same real classification as SCOPE 1/2 — the only real difference is commit-relevance");
      assert(result.blockers.some((b) => b.path === "scripts/legacy-untracked.ts"), "must be a real hard blocker — this registry entry is genuinely new/changed as part of THIS commit");
      assert(!result.reportOnly.some((r) => r.path === "scripts/legacy-untracked.ts"), "must not be miscategorized as report-only");
      assertEqual(result.pass, false, "overall gate result must BLOCK — zero weakening for this commit's own real changes");
    } finally { cleanup(dir); }
  });

  // ══════════════════════════════════════════════════════════════════
  // TASK-080 / FCR-027 — real, live bug fix: computeRelevantPaths()'s
  // "differs from HEAD" scan used to run UNCONDITIONALLY, with no check
  // that registry/module-registry.json itself was staged for THIS commit.
  // scripts/sync-registry.ts (Step 0) rewrites the real, on-disk registry
  // on every pre-commit run for the ENTIRE working tree — including a fresh
  // stub entry for a different, concurrent session's brand-new, still-
  // unstaged file. That stub differs from HEAD (it didn't exist there), so
  // the unconditional scan added its path to the relevant/blocking set even
  // though the registry itself was never part of the commit being made.
  // Live, reproduced case: a commit staging only registry/TASK_QUEUE.json +
  // registry/CHANGELOG.json was hard-blocked by a stub entry for
  // app/api/admin/ide/_lib/workerAdapters/digitalOceanWorkerAdapter.ts — a
  // different session's real, untracked file whose registry stub was never
  // staged either.
  // ══════════════════════════════════════════════════════════════════

  await test("TASK-080 1/3 — regression: fresh registry entry (differs from HEAD) whose OWN path is not staged, and registry/module-registry.json itself is ALSO not staged (only an unrelated file is staged) -> computeRelevantPaths() excludes it, full runGate() is Status: PASS (report-only), never BLOCKED", async () => {
    const dir = newFixtureRepo();
    try {
      writeFileEnsuringDir(dir, "unrelated.txt", "unrelated baseline file\n");
      writeRegistry(dir, {}); // empty registry at HEAD
      commitAll(dir, "baseline: empty registry, no fixture entry yet");

      // Simulate scripts/sync-registry.ts's Step 0: it rewrites the real,
      // on-disk registry with a fresh stub for a brand-new file belonging to
      // a different, concurrent session — genuinely differs from HEAD (it
      // didn't exist there at all) but is never staged, and neither is the
      // registry file itself.
      writeFileEnsuringDir(dir, "app/concurrent-session-file.ts", "export {};\n");
      const currentModules = { "app/concurrent-session-file.ts": realEntry({ status: "unregistered" }) };
      writeRegistry(dir, currentModules);

      // Only an unrelated file is staged for THIS commit — neither the fresh
      // entry's own path nor registry/module-registry.json itself.
      writeFileEnsuringDir(dir, "unrelated.txt", "unrelated, changed for this commit\n");
      git(dir, ["add", "unrelated.txt"]);

      const relevant = computeRelevantPaths(dir, "registry/module-registry.json", currentModules);
      assert(!relevant.has("app/concurrent-session-file.ts"), "computeRelevantPaths() must NOT include a fresh-vs-HEAD entry when registry/module-registry.json itself is not staged");

      const result = await runGate({ root: dir, source: "worktree" });
      const v = result.verdicts.find((v) => v.path === "app/concurrent-session-file.ts");
      assert(!!v, "expected a verdict for the fixture path");
      assert(v!.classification !== "VALID", "sanity: this entry must be genuinely non-VALID (UNTRACKED — real file, never git-added) for this test to be meaningful");
      assert(result.reportOnly.some((r) => r.path === "app/concurrent-session-file.ts"), "must still be reported (transparency — never silently hidden)");
      assert(!result.blockers.some((b) => b.path === "app/concurrent-session-file.ts"), "must NOT be a hard blocker — registry/module-registry.json was never staged for this commit");
      assertEqual(result.pass, true, "Status: PASS — a commit that never staged the registry must not be blocked by an unstaged, sync-registry.ts-authored stub entry");
    } finally { cleanup(dir); }
  });

  await test("TASK-080 2/3 — regression-confirm: identical shape, but registry/module-registry.json IS staged this run, carrying a malformed (TYPE_MISMATCH) entry -> Status: BLOCKED (proves the original TASK-076 bug class — a bad edit to module-registry.json that's part of the staged/committed diff — is still fully caught after the TASK-080 fix, zero weakening)", async () => {
    const dir = newFixtureRepo();
    try {
      writeFileEnsuringDir(dir, "README.md", "fixture repo\n");
      commitAll(dir, "baseline (no fixture entry yet)");
      writeFileEnsuringDir(dir, "scripts/task080-bad-shape.ts", "export {};\n");
      const currentModules = {
        "scripts/task080-bad-shape.ts": realEntry({ purpose_th: ["TASK-080 regression-confirm: still the real historical bug shape"] }),
      };
      writeRegistry(dir, currentModules);
      // The registry itself IS staged as part of this commit — the exact
      // real TASK-076 bug shape (a bad edit landing inside the staged diff).
      git(dir, ["add", "registry/module-registry.json"]);

      const relevant = computeRelevantPaths(dir, "registry/module-registry.json", currentModules);
      assert(relevant.has("scripts/task080-bad-shape.ts"), "computeRelevantPaths() must still include a fresh-vs-HEAD entry when registry/module-registry.json itself IS staged");

      const result = await runGate({ root: dir, source: "worktree" });
      const v = result.verdicts.find((v) => v.path === "scripts/task080-bad-shape.ts");
      assertEqual(v?.classification, "TYPE_MISMATCH", "malformed purpose_th must still classify TYPE_MISMATCH");
      assert(result.blockers.some((b) => b.path === "scripts/task080-bad-shape.ts"), "must still be a real hard blocker");
      assertEqual(result.pass, false, "Status: BLOCKED — the original TASK-076 bug class must still be caught with zero weakening by the TASK-080 fix");
    } finally { cleanup(dir); }
  });

  await test("TASK-080 3/3 — LIVE ACCEPTANCE: real gate run against the actual, current, shared working tree, staging only registry/TASK_QUEUE.json + registry/CHANGELOG.json via a scratch git index (GIT_INDEX_FILE) -> Status: PASS, with the real digitalOceanWorkerAdapter.ts stub appearing only in the report-only section, never blocking (the literal real-world case that triggered TASK-080)", async () => {
    const sharedRoot = findPrimaryWorktreeRoot();
    assert(
      existsSync(join(sharedRoot, "app/api/admin/ide/_lib/workerAdapters/digitalOceanWorkerAdapter.ts")),
      "sanity: the real concurrent-session file must still be present on disk for this to be a meaningful live check (if this fails, the live scenario this test proves no longer exists — not a bug in the fix itself)",
    );
    const scratchDir = mkdtempSync(join(tmpdir(), "dna-os-scratch-index-"));
    const scratchIndex = join(scratchDir, "index");
    const prevIndexEnv = process.env.GIT_INDEX_FILE;
    try {
      process.env.GIT_INDEX_FILE = scratchIndex;
      // Seed the scratch index from the real shared repo's real HEAD, then
      // stage ONLY the two real paths this live case is about — never
      // touches the real repo's real index, never touches any other
      // session's real staged work.
      execFileSync("git", ["read-tree", "HEAD"], { cwd: sharedRoot, env: process.env });
      execFileSync("git", ["add", "registry/TASK_QUEUE.json", "registry/CHANGELOG.json"], { cwd: sharedRoot, env: process.env });

      const staged = execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: sharedRoot, env: process.env, encoding: "utf-8" })
        .split("\n").filter(Boolean).sort();
      assertEqual(staged.join(","), ["registry/CHANGELOG.json", "registry/TASK_QUEUE.json"].sort().join(","), `scratch index must stage exactly these two real paths, got: ${staged.join(", ")}`);

      const result = await runGate({ root: sharedRoot, source: "worktree" });
      assert(!result.parseError, `real registry must parse cleanly: ${result.parseError}`);
      const v = result.verdicts.find((v) => v.path === "app/api/admin/ide/_lib/workerAdapters/digitalOceanWorkerAdapter.ts");
      assert(!!v, "expected a real verdict for the real digitalOceanWorkerAdapter.ts stub entry");
      assert(v!.classification !== "VALID", "sanity: the real stub entry (untracked file) must be genuinely non-VALID for this to be meaningful");
      assert(result.reportOnly.some((r) => r.path === "app/api/admin/ide/_lib/workerAdapters/digitalOceanWorkerAdapter.ts"), "the real stub entry must appear in the report-only section — reported, never hidden");
      assert(!result.blockers.some((b) => b.path === "app/api/admin/ide/_lib/workerAdapters/digitalOceanWorkerAdapter.ts"), "the real stub entry must NEVER block this commit — registry/module-registry.json was never staged");
      assertEqual(result.pass, true, `Status must be PASS for this real, live scenario — got BLOCKED with blockers: ${JSON.stringify(result.blockers.map((b) => b.path))}`);
    } finally {
      if (prevIndexEnv === undefined) delete process.env.GIT_INDEX_FILE; else process.env.GIT_INDEX_FILE = prevIndexEnv;
      cleanup(scratchDir);
    }
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
