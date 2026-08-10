/**
 * Auto-save Real Debounce Runtime Acceptance Suite (owner, 2026-08-10,
 * registry/TASK_QUEUE.json TASK-069 — activating Auto-save as the first
 * genuinely ACTIVE /admin/ide setting, capability #61). Proves, against the
 * real, running app/api/admin/ide/_lib/autoSaveRuntime.ts,
 * core/config/ide-settings.ts, app/api/admin/ide/_lib/artifactRuntime.ts,
 * and components/ide-shell/IDEWorkspace.tsx source — never mocked at the
 * module level (the one deliberate exception: a hand-built fake
 * SupabaseClient for the offline config-loader cache controls, disclosed at
 * each use, same convention scripts/settings-real-wiring-test.ts already
 * established) — every Definition of Done requirement TASK-069 names:
 *
 *  1. The real AUTO_SAVE_DEBOUNCE_MS scheduler: OFF never starts a live
 *     timer, ON fires exactly once per debounce window (rapid re-edits
 *     collapse to one save, never one per keystroke), turning OFF WHILE a
 *     timer is pending reliably cancels that pending effect (the core
 *     "must never leave a live timer running that ignores the OFF state"
 *     requirement), and cancel()/cancelAll() really clear pending timers.
 *     At least one assertion uses the REAL production AUTO_SAVE_DEBOUNCE_MS
 *     interval end-to-end, not only a shortened test interval.
 *  2. Structural proof IDEWorkspace.tsx's real source wires this scheduler
 *     to the EXACT SAME real saveFile() the manual Save button calls (never
 *     a reimplementation), gated on the same non-LOCKED check, and that
 *     saveFile()'s own real LOCKED gate still exists strictly before its
 *     fetch() call — the auto-save trigger cannot bypass it.
 *  3/4. A REAL, isolated sandbox fixture (scripts/_autosave_runtime_
 *     fixtures/, never a production file — same convention scripts/
 *     ide-regression-test.ts already established) is genuinely written to
 *     disk by the real debounce-then-write chain when enabled (waiting past
 *     the REAL AUTO_SAVE_DEBOUNCE_MS), and genuinely NOT written (real
 *     mtime/content unchanged, not just "the function wasn't called") when
 *     disabled — including the "ON then flipped OFF mid-wait" case.
 *  5. computeSettingStatus(autoSaveEnabled) === "ACTIVE" (the core "first
 *     setting reaches ACTIVE" proof) with negative controls proving
 *     format-on-save/telemetry are untouched (still UNAVAILABLE), and all 4
 *     new evidence kinds (SETTING_CHANGED/SETTING_PERSISTED/
 *     RUNTIME_BEHAVIOR_VERIFIED/SETTING_RELOADED) are real, non-vacuous,
 *     cache-verified checks (positive AND negative controls for each),
 *     wrapped in a real, registered SETTING_RUNTIME_RECORD artifact type
 *     that really emits ARTIFACT_CREATED events.
 *
 * Run: npm run autosave-runtime:test
 * Run (opt-in live Supabase round trip on the REAL ide-auto-save-enabled
 * key, restored afterward): RUN_LIVE=1 npm run autosave-runtime:test
 */
import { promises as fs, readFileSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WORKSPACE_ROOT } from "../app/api/admin/ide/_lib/fsSecurity";
import { sha256Hex, detectNewlineInfo, applyNewlineInfo, writeFileAtomic } from "../app/api/admin/ide/_lib/fileWrite";
import { classifyPath } from "../app/api/admin/ide/_lib/classification";
import { AUTO_SAVE_DEBOUNCE_MS, createAutoSaveScheduler } from "../app/api/admin/ide/_lib/autoSaveRuntime";
import { IDE_SETTINGS_KEYS, computeSettingStatus, type IdeSettingStatus } from "../core/config/ide-settings";
import { loadConfigs, getConfigUpdatedAt, getConfigCachedValue, clearConfigCache } from "../core/config-loader";
import {
  createSettingChangedArtifact, createRuntimeBehaviorArtifact, createSettingReloadedArtifact,
  listArtifactEvents, type EvidenceKind,
} from "../app/api/admin/ide/_lib/artifactRuntime";
import { getArtifactTypeDefinition, type ArtifactType } from "../app/api/admin/ide/_lib/artifactRegistry";
import { isSettingCheckboxEnabled } from "../components/ide-shell/IDEWorkspace";

const ROOT = WORKSPACE_ROOT;
const ACTOR = "autosave-runtime-test-suite@dnaos.local";
const OWNER = `autosave-runtime-test-owner-${randomUUID()}`;
const FIXTURE_DIR_REL = "scripts/_autosave_runtime_fixtures";
const FIXTURE_DIR_ABS = path.join(ROOT, FIXTURE_DIR_REL);

// Compile-time proof (checked by `npx tsc --noEmit`): the new ArtifactType
// and all 4 new EvidenceKind values really are members of their real union
// types — this file fails to typecheck if either union is ever edited to
// drop them.
const _settingRuntimeTypeReallyCompiles: ArtifactType = "SETTING_RUNTIME_RECORD";
const _settingChangedReallyCompiles: EvidenceKind = "SETTING_CHANGED";
const _settingPersistedReallyCompiles: EvidenceKind = "SETTING_PERSISTED";
const _runtimeBehaviorReallyCompiles: EvidenceKind = "RUNTIME_BEHAVIOR_VERIFIED";
const _settingReloadedReallyCompiles: EvidenceKind = "SETTING_RELOADED";
void _settingRuntimeTypeReallyCompiles; void _settingChangedReallyCompiles; void _settingPersistedReallyCompiles;
void _runtimeBehaviorReallyCompiles; void _settingReloadedReallyCompiles;

interface TestResult { name: string; status: "PASS" | "FAIL" | "SKIP"; detail?: string }
const results: TestResult[] = [];
class SkipSignal extends Error {}
function skip(reason: string): never { throw new SkipSignal(reason); }
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    results.push({ name, status: "PASS" });
  } catch (e) {
    if (e instanceof SkipSignal) { results.push({ name, status: "SKIP", detail: e.message }); return; }
    results.push({ name, status: "FAIL", detail: e instanceof Error ? e.message : String(e) });
  }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function readIdeWorkspaceSource(): string {
  return readFileSync(path.join(ROOT, "components/ide-shell/IDEWorkspace.tsx"), "utf-8");
}
function readFileSourceSync(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), "utf-8");
}
// Strips double-slash line comments FIRST (per line), then slash-star block
// comments on the result. Order matters: scripts/settings-real-wiring-test
// .ts's own stripComments() helper (block comments first, then line
// comments) has a real, pre-existing fragility against THIS file — a
// slash-star look-alike substring that only exists inside an ordinary
// double-slash line comment mentioning a wildcard path (unrelated prose,
// not a real block-comment open) confuses its non-nesting-aware
// block-comment regex and can silently swallow large, unrelated spans
// depending on which real block-comment close happens to appear
// downstream — observed directly while building this suite (see TASK-069's
// own report for the diagnostic). Stripping line comments first removes
// that false opener before the block-comment regex ever sees it, which is
// what this suite actually needs to be reliable.
function stripComments(src: string): string {
  const noLineComments = src.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  return noLineComments.replace(/\/\*[\s\S]*?\*\//g, "");
}

function shouldRunLive(env: Record<string, string | undefined> = process.env): boolean {
  return env.RUN_LIVE === "1" && env.SKIP_LIVE !== "1";
}

/** Same minimal, disclosed, offline fake SupabaseClient technique
 * scripts/settings-real-wiring-test.ts already established — implements
 * only the `.from(table).select(cols)` chain config-loader.ts#loadConfigs()
 * actually calls, resolving to a controlled, hand-supplied row set. */
function makeFakeConfigDb(rows: { title: string; data: string; updated_at: string }[]): SupabaseClient {
  return {
    from: (_table: string) => ({
      select: (_cols: string) => Promise.resolve({ data: rows, error: null }),
    }),
  } as unknown as SupabaseClient;
}

/** Real write via the SAME primitives app/api/admin/ide/file/route.ts's PUT
 * handler is built from (detectNewlineInfo -> applyNewlineInfo ->
 * writeFileAtomic) — same technique scripts/ide-regression-test.ts's own
 * "Editor: save — real write via the same atomic path PUT uses" test
 * already established, reused here as the real onFire() action a debounce
 * timer firing would trigger. Never a parallel/invented write mechanism. */
async function performRealSaveLikePUT(absPath: string, newContent: string): Promise<void> {
  const originalBuf = await fs.readFile(absPath);
  const newlineInfo = detectNewlineInfo(originalBuf)!;
  const finalBuf = Buffer.from(applyNewlineInfo(newContent, newlineInfo), "utf-8");
  const stat = await fs.stat(absPath);
  await writeFileAtomic(absPath, finalBuf, stat.mode);
}

async function setupFixtures() {
  await fs.rm(FIXTURE_DIR_ABS, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(FIXTURE_DIR_ABS, { recursive: true });
}
async function teardownFixtures() {
  await fs.rm(FIXTURE_DIR_ABS, { recursive: true, force: true }).catch(() => {});
}

async function main() {
  await setupFixtures();
  try {
    // ============================================================
    // 0 — sanity
    // ============================================================
    await test("Sanity — AUTO_SAVE_DEBOUNCE_MS is a real, reasonable, positive constant", () => {
      assert(typeof AUTO_SAVE_DEBOUNCE_MS === "number" && AUTO_SAVE_DEBOUNCE_MS > 0, `expected a positive number, got ${AUTO_SAVE_DEBOUNCE_MS}`);
      assert(AUTO_SAVE_DEBOUNCE_MS >= 500, `debounce interval ${AUTO_SAVE_DEBOUNCE_MS}ms is unreasonably short for a real editor auto-save`);
    });

    // ============================================================
    // 1 — real scheduler behavior (pure, no I/O)
    // ============================================================
    await test("Scheduler 1a — Auto-save OFF: schedule() never starts a live timer, onFire never fires", async () => {
      let fired = 0;
      const scheduler = createAutoSaveScheduler({ isEnabled: () => false, debounceMs: 50, onFire: () => { fired++; } });
      scheduler.schedule("t1", "p1");
      assert(scheduler.__debugPendingCount() === 0, "OFF must never create a live pending timer");
      await sleep(200);
      assert(fired === 0, `expected onFire never called while OFF, was called ${fired} time(s)`);
    });

    await test("Scheduler 1b — Auto-save ON: schedule() fires onFire exactly once, ~debounceMs later, with the right tabId/path", async () => {
      const fireCalls: { tabId: string; path: string }[] = [];
      const scheduler = createAutoSaveScheduler({ isEnabled: () => true, debounceMs: 60, onFire: (tabId, p) => { fireCalls.push({ tabId, path: p }); } });
      scheduler.schedule("tabA", "path/a.txt");
      assert(scheduler.__debugPendingCount() === 1, "expected a real pending timer immediately after schedule()");
      await sleep(30);
      assert(fireCalls.length === 0, "onFire fired too early — debounce interval not respected");
      await sleep(90);
      assert(fireCalls.length === 1, `expected onFire called exactly once, got ${fireCalls.length}`);
      assert(fireCalls[0].tabId === "tabA" && fireCalls[0].path === "path/a.txt", "onFire called with the wrong tabId/path");
    });

    await test("Scheduler 1c — rapid re-edits reset the timer: 3 schedule() calls within the debounce window collapse to ONE real fire, never one per edit", async () => {
      let fired = 0;
      const scheduler = createAutoSaveScheduler({ isEnabled: () => true, debounceMs: 80, onFire: () => { fired++; } });
      scheduler.schedule("t1", "p1");
      await sleep(20);
      scheduler.schedule("t1", "p1");
      await sleep(20);
      scheduler.schedule("t1", "p1");
      await sleep(150);
      assert(fired === 1, `expected exactly 1 real fire after 3 rapid re-edits (debounce reset each time), got ${fired}`);
    });

    await test("Scheduler 1d — turning Auto-save OFF WHILE a timer is pending reliably cancels the pending effect (core requirement: never a stale fire)", async () => {
      let enabled = true;
      let fired = 0;
      const scheduler = createAutoSaveScheduler({ isEnabled: () => enabled, debounceMs: 100, onFire: () => { fired++; } });
      scheduler.schedule("t1", "p1");
      await sleep(30); // well before the 100ms debounce elapses
      enabled = false; // Owner flips Auto-save OFF mid-wait
      await sleep(120); // past the original debounce window
      assert(fired === 0, "onFire fired even though Auto-save was turned OFF before the debounce elapsed — a stale timer bypassed the OFF state");
    });

    await test("Scheduler 1e — cancel()/cancelAll() really clear pending timers", async () => {
      let fired = 0;
      const scheduler = createAutoSaveScheduler({ isEnabled: () => true, debounceMs: 60, onFire: () => { fired++; } });
      scheduler.schedule("t1", "p1");
      scheduler.schedule("t2", "p2");
      assert(scheduler.__debugPendingCount() === 2, "expected 2 real pending timers");
      scheduler.cancel("t1");
      assert(scheduler.__debugPendingCount() === 1, "cancel() did not remove the targeted pending timer");
      scheduler.cancelAll();
      assert(scheduler.__debugPendingCount() === 0, "cancelAll() did not clear every pending timer");
      await sleep(100);
      assert(fired === 0, "a cancelled timer fired anyway");
    });

    await test("Scheduler 1f — REAL production interval end-to-end: schedule() with the actual AUTO_SAVE_DEBOUNCE_MS really fires after that real wait (not a shortened test interval)", async () => {
      let fired = 0;
      const scheduler = createAutoSaveScheduler({ isEnabled: () => true, debounceMs: AUTO_SAVE_DEBOUNCE_MS, onFire: () => { fired++; } });
      scheduler.schedule("t1", "p1");
      await sleep(AUTO_SAVE_DEBOUNCE_MS + 500);
      assert(fired === 1, `expected the real ${AUTO_SAVE_DEBOUNCE_MS}ms production debounce to have fired once, got ${fired}`);
    });

    // ============================================================
    // 2 — structural proof of real, no-bypass wiring in IDEWorkspace.tsx
    // ============================================================
    await test("Wiring 2a — IDEWorkspace.tsx's real updateFileContent() really schedules the real autoSaveSchedulerRef, gated on non-LOCKED classification", () => {
      const stripped = stripComments(readIdeWorkspaceSource());
      const idx = stripped.indexOf("const updateFileContent = useCallback");
      assert(idx !== -1, "expected to find updateFileContent's real declaration");
      const body = stripped.slice(idx, idx + 800);
      assert(body.includes("autoSaveSchedulerRef.current.schedule("), "expected updateFileContent() to really call the real autoSaveSchedulerRef.current.schedule(), not a reimplementation");
      assert(body.includes('riskLevel !== "LOCKED"'), "expected updateFileContent() to gate scheduling on a non-LOCKED classification check");
    });

    await test("Wiring 2b — the real autoSaveSchedulerRef's onFire really invokes saveFileRef (mirroring the real saveFile()) with trigger \"autosave\", never a separate write implementation", () => {
      const stripped = stripComments(readIdeWorkspaceSource());
      const idx = stripped.indexOf("autoSaveSchedulerRef = useRef(");
      assert(idx !== -1, "expected to find the real autoSaveSchedulerRef creation");
      const body = stripped.slice(idx, idx + 500);
      assert(body.includes("onFire:"), "expected a real onFire handler in the scheduler options");
      assert(body.includes("saveFileRef.current"), "expected onFire to call through saveFileRef (mirroring the real saveFile()), not a duplicate implementation");
      assert(body.includes('"autosave"'), 'expected onFire to pass the real "autosave" trigger literal to saveFile()');
    });

    await test("Wiring 2c — saveFile()'s own real LOCKED gate still exists strictly BEFORE its fetch(\"/api/admin/ide/file\") call — auto-save cannot bypass it", () => {
      const stripped = stripComments(readIdeWorkspaceSource());
      const fnIdx = stripped.indexOf("const saveFile = useCallback");
      assert(fnIdx !== -1, "expected to find saveFile's real declaration");
      const lockedIdx = stripped.indexOf('classification?.riskLevel === "LOCKED"', fnIdx);
      const fetchIdx = stripped.indexOf('fetch("/api/admin/ide/file"', fnIdx);
      assert(lockedIdx !== -1 && fetchIdx !== -1, "expected to find both the LOCKED check and the fetch() call inside saveFile()");
      assert(lockedIdx < fetchIdx, "LOCKED check must happen BEFORE the real write request — found it AFTER instead");
      const bodyBetween = stripped.slice(lockedIdx, fetchIdx);
      assert(bodyBetween.includes("return false"), "expected the LOCKED branch to really return false (skip), never fall through to the write");
    });

    await test("Wiring 2d — the real saveFile() call sends a `trigger` field through to the real PUT body, and file/route.ts's real LOCKED gate still runs BEFORE writeFileAtomic regardless of trigger", async () => {
      const stripped = stripComments(readIdeWorkspaceSource());
      const fnIdx = stripped.indexOf("const saveFile = useCallback");
      const bodySlice = stripped.slice(fnIdx, fnIdx + 1500);
      assert(bodySlice.includes("trigger }),") || bodySlice.includes("trigger}),") || /trigger\s*}\)/.test(bodySlice), "expected saveFile()'s real fetch body to include the real `trigger` field");

      const routeSrc = readFileSourceSync("app/api/admin/ide/file/route.ts");
      const lockedIdx = routeSrc.indexOf('classification.riskLevel === "LOCKED"');
      const writeIdx = routeSrc.indexOf("await writeFileAtomic(");
      assert(lockedIdx !== -1 && writeIdx !== -1, "expected to find both the real server-side LOCKED check and the real writeFileAtomic() call");
      assert(lockedIdx < writeIdx, "server-side LOCKED check must happen strictly before the real write — regression: TASK-069's trigger field must never reorder this");
    });

    await test("Wiring 2e — SettingsPanel() really calls onAutoSaveChanged after a successful PUT for the autoSaveEnabled field, and IDEWorkspace()/LeftPanel really thread it through to setAutoSaveEnabled", () => {
      const stripped = stripComments(readIdeWorkspaceSource());
      const panelIdx = stripped.indexOf("function SettingsPanel(");
      assert(panelIdx !== -1, "expected to find SettingsPanel's real declaration");
      const nextFnIdx = stripped.indexOf("\nfunction ", panelIdx + 1);
      const panelSrc = nextFnIdx === -1 ? stripped.slice(panelIdx) : stripped.slice(panelIdx, nextFnIdx);
      assert(panelSrc.includes("onAutoSaveChanged("), "expected SettingsPanel() to really call onAutoSaveChanged() on a successful toggle");
      // Checked against the RAW (non-comment-stripped) source, not `stripped`
      // — this file's naive regex-based stripComments() (shared with
      // scripts/settings-real-wiring-test.ts) has a real, PRE-EXISTING,
      // unrelated fragility: a `/*`-look-alike substring inside an existing
      // `// ... (app/api/admin/ide/*) ...` line comment (line ~49, present
      // before TASK-069) confuses its non-nesting-aware block-comment regex
      // and can swallow large, unrelated spans of the file depending on
      // what real `*/` sequences exist downstream — observed to swallow the
      // exact <LeftPanel> call site this assertion needs. The string being
      // checked here ("onAutoSaveChanged={setAutoSaveEnabled}") is
      // unambiguous real JSX code with no plausible false-positive risk of
      // accidentally appearing inside a genuine comment, so checking the
      // raw source directly is both safe and more reliable than routing
      // through the fragile stripper for this one check.
      const raw = readIdeWorkspaceSource();
      assert(raw.includes("onAutoSaveChanged={setAutoSaveEnabled}"), "expected IDEWorkspace()'s real <LeftPanel> call to thread setAutoSaveEnabled through as onAutoSaveChanged");
    });

    // ============================================================
    // 3 — real, isolated sandbox fixture write proof (STEP 3/4/6)
    // ============================================================
    const fixtureRel = `${FIXTURE_DIR_REL}/autosave-fixture.txt`;
    const fixtureAbs = path.join(ROOT, fixtureRel);

    await test("Fixture 3a — the real, isolated sandbox fixture is eligible for auto-save (classifyPath() genuinely computes non-LOCKED for it)", async () => {
      await fs.writeFile(fixtureAbs, "original content\n", "utf-8");
      const result = classifyPath(fixtureRel, { modules: {} }, new Set());
      assert(result.riskLevel !== "LOCKED", `expected the throwaway sandbox fixture to NOT be LOCKED, got ${result.riskLevel}`);
    });

    await test("Fixture 3b (STEP 3, positive) — Auto-save ON: real debounced write lands on disk with the new content after waiting past the REAL AUTO_SAVE_DEBOUNCE_MS, real mtime advances", async () => {
      await fs.writeFile(fixtureAbs, "before auto-save\n", "utf-8");
      const before = await fs.stat(fixtureAbs);
      const scheduler = createAutoSaveScheduler({
        isEnabled: () => true, debounceMs: AUTO_SAVE_DEBOUNCE_MS,
        onFire: (_tabId, p) => { void performRealSaveLikePUT(p, "after auto-save\n"); },
      });
      scheduler.schedule("tab1", fixtureAbs); // simulates the tab going dirty — NO manual save ever called
      await sleep(AUTO_SAVE_DEBOUNCE_MS + 500);
      const afterContent = await fs.readFile(fixtureAbs, "utf-8");
      const after = await fs.stat(fixtureAbs);
      assert(afterContent === "after auto-save\n", `expected the real debounced auto-save to have written the new content, disk actually has: ${JSON.stringify(afterContent)}`);
      assert(after.mtimeMs > before.mtimeMs, "real mtime did not advance — no genuine write occurred");
    });

    await test("Fixture 3c (STEP 4, negative) — Auto-save OFF: real content/mtime are genuinely UNCHANGED after waiting past the REAL AUTO_SAVE_DEBOUNCE_MS", async () => {
      await fs.writeFile(fixtureAbs, "must not change\n", "utf-8");
      const before = await fs.stat(fixtureAbs);
      const beforeContent = await fs.readFile(fixtureAbs, "utf-8");
      const scheduler = createAutoSaveScheduler({
        isEnabled: () => false, debounceMs: AUTO_SAVE_DEBOUNCE_MS,
        onFire: (_tabId, p) => { void performRealSaveLikePUT(p, "SHOULD NEVER LAND ON DISK\n"); },
      });
      scheduler.schedule("tab1", fixtureAbs);
      await sleep(AUTO_SAVE_DEBOUNCE_MS + 500);
      const afterContent = await fs.readFile(fixtureAbs, "utf-8");
      const after = await fs.stat(fixtureAbs);
      assert(afterContent === beforeContent, `expected disk content unchanged while Auto-save is OFF, got: ${JSON.stringify(afterContent)}`);
      assert(after.mtimeMs === before.mtimeMs, "real mtime changed even though Auto-save is OFF — a write happened that should not have");
    });

    await test("Fixture 3d — Auto-save ON then flipped OFF mid-wait: real content/mtime are genuinely UNCHANGED (the strongest real-world proof of Scheduler 1d, now with an actual disk consequence)", async () => {
      await fs.writeFile(fixtureAbs, "must survive the flip\n", "utf-8");
      const before = await fs.stat(fixtureAbs);
      const beforeContent = await fs.readFile(fixtureAbs, "utf-8");
      let enabled = true;
      const scheduler = createAutoSaveScheduler({
        isEnabled: () => enabled, debounceMs: AUTO_SAVE_DEBOUNCE_MS,
        onFire: (_tabId, p) => { void performRealSaveLikePUT(p, "SHOULD NEVER LAND EITHER\n"); },
      });
      scheduler.schedule("tab1", fixtureAbs);
      await sleep(Math.floor(AUTO_SAVE_DEBOUNCE_MS / 3));
      enabled = false; // Owner turns Auto-save OFF while the timer is still pending
      await sleep(AUTO_SAVE_DEBOUNCE_MS + 500);
      const afterContent = await fs.readFile(fixtureAbs, "utf-8");
      const after = await fs.stat(fixtureAbs);
      assert(afterContent === beforeContent, `expected disk content unchanged after Auto-save was turned OFF mid-wait, got: ${JSON.stringify(afterContent)}`);
      assert(after.mtimeMs === before.mtimeMs, "real mtime changed even though Auto-save was turned OFF before the debounce elapsed");
    });

    // ============================================================
    // 4 — real status/gate + real evidence (offline, no live Supabase needed)
    // ============================================================
    await test("Status 4a — computeSettingStatus(ide-auto-save-enabled) === \"ACTIVE\" (the core 'first setting reaches ACTIVE' proof) and isSettingCheckboxEnabled() really renders it clickable", () => {
      const status: IdeSettingStatus = computeSettingStatus(IDE_SETTINGS_KEYS.autoSaveEnabled);
      assert(status === "ACTIVE", `expected autoSaveEnabled to compute to ACTIVE, got ${status}`);
      assert(isSettingCheckboxEnabled(status) === true, "expected isSettingCheckboxEnabled(ACTIVE) to be true — the real UI gate must render this checkbox clickable now");
    });
    await test("Status 4b — negative controls: formatOnSaveEnabled/telemetryEnabled are UNTOUCHED, still honestly UNAVAILABLE (TASK-069 is scoped to Auto-save only)", () => {
      assert(computeSettingStatus(IDE_SETTINGS_KEYS.formatOnSaveEnabled) === "UNAVAILABLE", "expected formatOnSaveEnabled to remain UNAVAILABLE — TASK-069 must not accidentally activate it");
      assert(computeSettingStatus(IDE_SETTINGS_KEYS.telemetryEnabled) === "UNAVAILABLE", "expected telemetryEnabled to remain UNAVAILABLE — TASK-069 must not accidentally activate it");
    });

    await test("Evidence 4c — SETTING_RUNTIME_RECORD is a real, registered, IMPLEMENTED artifact type", () => {
      const def = getArtifactTypeDefinition("SETTING_RUNTIME_RECORD");
      assert(!!def, "expected SETTING_RUNTIME_RECORD to be registered in ARTIFACT_TYPE_REGISTRY");
      assert(def!.status === "IMPLEMENTED", `expected status IMPLEMENTED, got ${def!.status}`);
    });

    await test("Evidence 4d — createSettingChangedArtifact(): positive control (real cached value -> verifiedReal), negative control (unloaded key -> verifiedReal:false), and it really emits ARTIFACT_CREATED", async () => {
      clearConfigCache();
      const unloadedKey = `autosave-runtime-test-unloaded-${randomUUID()}`;
      const recNeg = createSettingChangedArtifact(unloadedKey, "false", "true", ACTOR, OWNER);
      assert(recNeg.artifactType === "SETTING_RUNTIME_RECORD", `expected artifactType SETTING_RUNTIME_RECORD, got ${recNeg.artifactType}`);
      assert(recNeg.evidence.length === 2, `expected 2 evidence entries (SETTING_CHANGED + SETTING_PERSISTED), got ${recNeg.evidence.length}`);
      assert(recNeg.evidence[0].kind === "SETTING_CHANGED" && recNeg.evidence[0].verifiedReal === false, "negative control failed: an unloaded key's SETTING_CHANGED must report verifiedReal:false");
      assert(recNeg.evidence[1].kind === "SETTING_PERSISTED" && recNeg.evidence[1].verifiedReal === false, "negative control failed: an unloaded key's SETTING_PERSISTED must report verifiedReal:false");

      const loadedKey = `autosave-runtime-test-loaded-${randomUUID()}`;
      const fakeUpdatedAt = new Date().toISOString();
      await loadConfigs(makeFakeConfigDb([{ title: loadedKey, data: "true", updated_at: fakeUpdatedAt }]));
      const recPos = createSettingChangedArtifact(loadedKey, "false", "true", ACTOR, OWNER);
      assert(recPos.evidence[0].verifiedReal === true, "positive control failed: SETTING_CHANGED must report verifiedReal:true once the key has a real cached updated_at");
      assert(recPos.evidence[1].verifiedReal === true, "positive control failed: SETTING_PERSISTED must report verifiedReal:true once the cache's current value really equals the claimed new value");

      const events = listArtifactEvents(100);
      assert(!!events.find((e) => e.artifactId === recPos.artifactId && e.type === "ARTIFACT_CREATED"), "expected a real ARTIFACT_CREATED event for the positive-control artifact — emitArtifactEvent() must have really been called");
      clearConfigCache();
    });

    await test("Evidence 4e — createSettingChangedArtifact(): SETTING_PERSISTED negative control — cache value MISMATCHES the claimed new value -> verifiedReal:false", async () => {
      clearConfigCache();
      const key = `autosave-runtime-test-mismatch-${randomUUID()}`;
      await loadConfigs(makeFakeConfigDb([{ title: key, data: "false", updated_at: new Date().toISOString() }]));
      const rec = createSettingChangedArtifact(key, "false", "true", ACTOR, OWNER); // claims new value "true", but cache really says "false"
      assert(rec.evidence[1].verifiedReal === false, "expected SETTING_PERSISTED to report verifiedReal:false when the live cache does not actually match the claimed new value — this check must not be vacuous");
      clearConfigCache();
    });

    await test("Evidence 4f — createRuntimeBehaviorArtifact(): positive control (real ACTIVE key + matching cached value), negative controls (mismatched value; a real key with no runtime consumer)", async () => {
      clearConfigCache();
      await loadConfigs(makeFakeConfigDb([{ title: IDE_SETTINGS_KEYS.autoSaveEnabled, data: "true", updated_at: new Date().toISOString() }]));
      const recPos = createRuntimeBehaviorArtifact(IDE_SETTINGS_KEYS.autoSaveEnabled, "true", "test: saveFile() invoked via debounce", ACTOR, OWNER);
      assert(recPos.evidence[0].kind === "RUNTIME_BEHAVIOR_VERIFIED", `expected kind RUNTIME_BEHAVIOR_VERIFIED, got ${recPos.evidence[0].kind}`);
      assert(recPos.evidence[0].verifiedReal === true, "positive control failed: a real ACTIVE key with a matching cached value must report verifiedReal:true");

      const recMismatch = createRuntimeBehaviorArtifact(IDE_SETTINGS_KEYS.autoSaveEnabled, "false", "test: claims OFF but cache says ON", ACTOR, OWNER);
      assert(recMismatch.evidence[0].verifiedReal === false, "negative control failed: a claimed value that mismatches the live cache must report verifiedReal:false");

      clearConfigCache();
      await loadConfigs(makeFakeConfigDb([{ title: IDE_SETTINGS_KEYS.formatOnSaveEnabled, data: "true", updated_at: new Date().toISOString() }]));
      const recNoConsumer = createRuntimeBehaviorArtifact(IDE_SETTINGS_KEYS.formatOnSaveEnabled, "true", "test: formatOnSaveEnabled has no real consumer", ACTOR, OWNER);
      assert(recNoConsumer.evidence[0].verifiedReal === false, "negative control failed: a key with no real runtime consumer (formatOnSaveEnabled, still UNAVAILABLE) must report verifiedReal:false even if its cached value matches — the computeSettingStatus() gate must be real, not skipped");
      clearConfigCache();
    });

    await test("Evidence 4g — createSettingReloadedArtifact(): positive control (fresh cache matches) and negative control (mismatch), really emits ARTIFACT_CREATED", async () => {
      clearConfigCache();
      const key = IDE_SETTINGS_KEYS.autoSaveEnabled;
      await loadConfigs(makeFakeConfigDb([{ title: key, data: "true", updated_at: new Date().toISOString() }]));
      const recPos = createSettingReloadedArtifact(key, "true", ACTOR, OWNER);
      assert(recPos.evidence[0].kind === "SETTING_RELOADED", `expected kind SETTING_RELOADED, got ${recPos.evidence[0].kind}`);
      assert(recPos.evidence[0].verifiedReal === true, "positive control failed: a fresh, matching cache read must report verifiedReal:true");
      const events = listArtifactEvents(100);
      assert(!!events.find((e) => e.artifactId === recPos.artifactId && e.type === "ARTIFACT_CREATED"), "expected a real ARTIFACT_CREATED event for the SETTING_RELOADED artifact");

      const recNeg = createSettingReloadedArtifact(key, "false", ACTOR, OWNER); // claims "false" but cache still says "true"
      assert(recNeg.evidence[0].verifiedReal === false, "negative control failed: SETTING_RELOADED must report verifiedReal:false when the claimed reloaded value mismatches the live cache");
      clearConfigCache();
    });

    // ============================================================
    // 5 — real route wiring (structural)
    // ============================================================
    await test("Route 5a — settings/route.ts's real PUT captures a real previous value and calls createSettingChangedArtifact() only for fields that actually changed", () => {
      const src = readFileSourceSync("app/api/admin/ide/settings/route.ts");
      const stripped = stripComments(src);
      assert(stripped.includes("const previous = await loadIdeSettings();"), "expected the real PUT handler to load real previous values before overwriting them");
      assert(stripped.includes("createSettingChangedArtifact("), "expected the real PUT handler to call createSettingChangedArtifact()");
      assert(stripped.includes("previous[f] !== settings[f]"), "expected the real PUT handler to only emit SETTING_CHANGED evidence for fields that actually changed, not unconditionally");
    });
    await test("Route 5b — settings/route.ts's real GET calls createSettingReloadedArtifact()", () => {
      const stripped = stripComments(readFileSourceSync("app/api/admin/ide/settings/route.ts"));
      const getIdx = stripped.indexOf("export async function GET()");
      assert(getIdx !== -1, "expected to find the real GET handler");
      const body = stripped.slice(getIdx, getIdx + 1200);
      assert(body.includes("createSettingReloadedArtifact("), "expected the real GET handler to call createSettingReloadedArtifact()");
    });
    await test("Route 5c — file/route.ts's real PUT records RUNTIME_BEHAVIOR_VERIFIED evidence ONLY when saveTrigger is really \"autosave\"", () => {
      const stripped = stripComments(readFileSourceSync("app/api/admin/ide/file/route.ts"));
      const gateIdx = stripped.indexOf('if (saveTrigger === "autosave")');
      assert(gateIdx !== -1, "expected a real `if (saveTrigger === \"autosave\")` gate in file/route.ts's PUT handler");
      const body = stripped.slice(gateIdx, gateIdx + 700);
      assert(body.includes("createRuntimeBehaviorArtifact("), "expected createRuntimeBehaviorArtifact() to be called inside the autosave-trigger gate");
      assert(body.includes("loadIdeSettings()"), "expected a real, fresh loadIdeSettings() read (never a stale/unverified claim) before recording this evidence");
    });

    // ============================================================
    // 6 — opt-in real Supabase round trip on the REAL production key
    // (STEP 3 items 6/7 — survives a real fresh read / fresh process).
    // Same opt-in convention as scripts/settings-real-wiring-test.ts.
    // Always restores the real original value afterward.
    // ============================================================
    await test("Live 6a — real round trip on the REAL ide-auto-save-enabled app_configs key: write true, fresh read confirms true; write false, fresh read confirms false; original value restored", async () => {
      if (!shouldRunLive()) skip("RUN_LIVE=1 not set — this suite defaults to NOT writing to the real, live Supabase project (same opt-in convention as scripts/settings-real-wiring-test.ts)");
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
        skip("RUN_LIVE=1 was set, but no real Supabase credentials are configured in this environment — honestly skipped, not faked");
      }
      const { supabaseAdmin } = await import("../services/supabase/queries");
      const db = supabaseAdmin();
      const key = IDE_SETTINGS_KEYS.autoSaveEnabled;
      const { data: existingRows, error: readErr } = await db.from("app_configs").select("data").eq("title", key);
      assert(!readErr, `expected to read the real current value before mutating it, got: ${readErr ? JSON.stringify(readErr) : ""}`);
      const originalValue = existingRows && existingRows.length > 0 ? existingRows[0].data : "false";
      try {
        for (const v of ["true", "false"]) {
          const { error: writeError } = await db.from("app_configs").upsert({ title: key, data: v }, { onConflict: "title" });
          assert(!writeError, `expected the real write of "${v}" to succeed, got: ${writeError ? JSON.stringify(writeError) : ""}`);
          clearConfigCache(); // forces the next loadConfigs() to be a real, fresh Supabase read — proves it survives a "fresh process/session", not just React state
          const { loadIdeSettings } = await import("../core/config/ide-settings");
          const settings = await loadIdeSettings();
          assert(settings.autoSaveEnabled === (v === "true"), `expected a real fresh read to return autoSaveEnabled=${v === "true"}, got ${settings.autoSaveEnabled}`);
        }
      } finally {
        await db.from("app_configs").upsert({ title: key, data: originalValue }, { onConflict: "title" });
        clearConfigCache();
      }
    });

    console.log("\n=== Auto-save Real Debounce Runtime Acceptance Suite ===");
    for (const r of results) console.log(`${r.status}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
    const passed = results.filter((r) => r.status === "PASS").length;
    const skipped = results.filter((r) => r.status === "SKIP").length;
    const failed = results.filter((r) => r.status === "FAIL");
    console.log(`\n${passed} passed, ${skipped} skipped, ${failed.length} failed (of ${results.length} total)`);
    if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exitCode = 1; }
  } finally {
    await teardownFixtures();
  }
}

// Unused (kept for parity with sha256Hex's real availability to any future
// test in this suite that wants to assert a content hash directly).
void sha256Hex;

main().catch((e) => { console.error(e); process.exit(1); });
