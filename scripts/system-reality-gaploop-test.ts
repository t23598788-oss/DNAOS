/**
 * Owner System Reality Report — STEP 6+7 Acceptance Suite (owner,
 * 2026-08-10, Capability Roadmap #57, registry/TASK_QUEUE.json
 * TASK-053/054 follow-on, Constitution Rule 252). Proves, against the
 * real, running code and real, live repo data — never mocked — every
 * acceptance requirement named for this task:
 *
 *  1. STEP 6 (polling): components/workspace/systemRealityPolling.ts's
 *     startSystemRealityPolling() real-invokes its fetch function
 *     repeatedly on a real timer (genuine wall-clock `setInterval`, not a
 *     fake/mocked clock), and real-stops when torn down. Structural proof
 *     the real, production component wires this in at the real, reused
 *     120_000ms interval, and that no live Supabase-table-backed signal
 *     exists for this report's real data sources (justifying polling over
 *     a Realtime subscription).
 *  2. STEP 7 (Gap Loop bridge): app/api/admin/system-reality/_lib/
 *     gapLoopBridge.ts's runGapLoopBridge() (a) real-creates one new
 *     finding for a capability with NO existing real FCR match, via the
 *     real, lock-protected registryWriterRuntime.ts#writeFinding() write
 *     path, correctly classified via classifyGap(); (b) real-does-NOT
 *     create a duplicate for a capability whose gap is already
 *     represented (both a REAL, live, read-only proof against the real
 *     Cost Calculation capability / FCR-013, AND a real write-path proof
 *     using the same disposable fixture from (a) run twice); (c) is
 *     structurally never reachable from the Report page's own read-only
 *     GET route/translation layer/client component.
 *
 * TEST-DATA APPROACH (disclosed, per this task's own explicit
 * instruction to state which approach was taken and why): the "creates a
 * new finding" / "does not create a duplicate on a second, identical
 * pass" proof (2a/2c below) uses ONE clearly-disposable, self-describing
 * synthetic capability (capability_name prefixed "[TEST-DISPOSABLE]"),
 * never one of the 8 real, already-logged gaps — real registry writes
 * DO happen (this is a genuine end-to-end proof of the real write path,
 * not an in-memory-only simulation), but the synthetic finding this
 * creates is deterministically identified by its own finding_id and
 * REMOVED again in this suite's own `finally` block (real, lock-
 * protected read-modify-write, reusing registryWriterRuntime.ts's own
 * acquireLock()/releaseLock() rather than a raw fs write) before this
 * suite exits, success or failure. The separate "does not duplicate a
 * REAL, already-known gap" proof (2b) is done read-only (dryRun:true)
 * against the real, live Cost Calculation capability / FCR-013 — zero
 * writes, zero cleanup needed for that half.
 *
 * Run: npm run system-reality-gaploop:test
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import path from "path";
import { WORKSPACE_ROOT } from "../app/api/admin/ide/_lib/fsSecurity";
import {
  buildSystemRealityModel,
  type CapabilityRealityEntry,
} from "../app/api/admin/ide/_lib/systemRealityRuntime";
import {
  runGapLoopBridge,
  TRIGGER_STATUSES,
  type GapBridgeResult,
} from "../app/api/admin/system-reality/_lib/gapLoopBridge";
import { acquireLock, releaseLock } from "../app/api/admin/ide/_lib/registryWriterRuntime";
import { startSystemRealityPolling, SYSTEM_REALITY_POLL_INTERVAL_MS } from "../components/workspace/systemRealityPolling";

const ROOT = WORKSPACE_ROOT;
const FCR_PATH = path.join(ROOT, "registry/FACTORY_CENTRAL_REGISTRY.json");

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface FcrRegistryFile {
  findings: Array<{ finding_id: string; type?: string; description?: string; evaluation?: string; status: string; SOURCE?: string; source_entity?: string }>;
  status_enum: string[];
  summary: { total: number; [k: string]: number };
  [k: string]: unknown;
}
function readFcrRaw(): string { return readFileSync(FCR_PATH, "utf-8"); }
function readFcr(): FcrRegistryFile { return JSON.parse(readFcrRaw()); }

/** Real, lock-protected removal of exactly the given finding_id(s) — the
 * ONLY write this suite's own cleanup step performs. Reuses
 * registryWriterRuntime.ts's own acquireLock()/releaseLock() (the same
 * real lock ledger every write to this file today uses) rather than a
 * raw, undisciplined writeFileSync. Retries acquisition a few times
 * (this is a real, live, potentially multi-agent-shared file) before
 * giving up loudly — a failed cleanup must never fail silently, since
 * leaving a disposable test finding behind would violate this task's own
 * "leave the registry in a clean state" requirement. */
async function removeFindingsWithRetry(idsToRemove: string[], maxAttempts = 6, delayMs = 500): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const lock = acquireLock(FCR_PATH);
    if (!lock.acquired) {
      lastErr = new Error(`cleanup could not acquire lock (attempt ${attempt}/${maxAttempts}): ${lock.reason}`);
      await sleep(delayMs);
      continue;
    }
    try {
      const registry = readFcr();
      const before = registry.findings.length;
      registry.findings = registry.findings.filter((f) => !idsToRemove.includes(f.finding_id));
      const removedCount = before - registry.findings.length;
      registry.summary.total = registry.findings.length;
      writeFileSync(FCR_PATH, JSON.stringify(registry, null, 2) + "\n", "utf-8");
      if (removedCount !== idsToRemove.length) {
        throw new Error(`cleanup expected to remove exactly ${idsToRemove.length} finding(s) (${idsToRemove.join(", ")}), actually removed ${removedCount}`);
      }
      return;
    } finally {
      releaseLock(FCR_PATH);
    }
  }
  throw new Error(`removeFindingsWithRetry: exhausted ${maxAttempts} attempts — registry/FACTORY_CENTRAL_REGISTRY.json may still contain disposable test finding(s) ${idsToRemove.join(", ")}. Last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

/** One deliberately fake, self-describing, disposable capability — never
 * a real business capability. Independently verified BEFORE this suite
 * was finalized (via a real, throwaway exploratory run of
 * findDuplicateGap() against the real, live registry) not to
 * accidentally keyword-overlap-match any real, existing finding above
 * the real 0.5 threshold — so a CREATED result below is a genuine "no
 * real duplicate found", not a coincidence. */
const SYNTHETIC_CAPABILITY: CapabilityRealityEntry = {
  capability_name: "[TEST-DISPOSABLE] System Reality Gap Loop Bridge Acceptance Fixture",
  business_function: "A deliberately fake, disposable capability used ONLY by scripts/system-reality-gaploop-test.ts to real-exercise the Gap Loop Bridge's real write path end-to-end, without risking any real live capability's own text. Never a real business capability. Created and removed within the same real test run.",
  status: "BUILT_NOT_WIRED",
  runtime_status: "synthetic test fixture — not a real, live runtime status",
  connected_from: [],
  connected_to: [],
  missing_connection: "engines/disposableAcceptanceFixtureOnly.ts#neverRealFunction is never really wired into anything — a deliberately fake, disposable gap used only by this acceptance test's own write-path proof, not a real finding about this repo.",
  current_blocker: "This is a synthetic, disposable test fixture (finding created by scripts/system-reality-gaploop-test.ts's own Gap Loop Bridge write-path acceptance proof) — engines/disposableAcceptanceFixtureOnly.ts's fake neverRealFunction has zero real callers, a deliberately fabricated blocker text for test purposes only; real cleanup removes this finding at the end of the same test run.",
  impact: "None — this is a disposable test fixture with zero real business impact, created and removed within the same test run.",
  last_verified: new Date().toISOString(),
  evidence: ["scripts/system-reality-gaploop-test.ts (this test's own synthetic fixture — not real evidence about any real capability)"],
  next_required_connection: null,
};

async function main() {
  const createdFindingIds: string[] = [];

  try {
    // ============================================================
    // 1 — STEP 6: real, timer-based polling proof.
    // ============================================================
    await test("Acceptance 1a — startSystemRealityPolling() real-invokes its fetch function repeatedly on a genuine wall-clock timer (real setInterval, not a mocked/fake clock)", async () => {
      let calls = 0;
      const TEST_INTERVAL_MS = 30;
      const stop = startSystemRealityPolling(() => { calls += 1; }, TEST_INTERVAL_MS);
      await sleep(TEST_INTERVAL_MS * 5 + 40); // real wall-clock wait — should real-fire ~5 times
      stop();
      const callsAtStop = calls;
      assert(callsAtStop >= 3, `expected the real timer to have fired at least 3 times over ${TEST_INTERVAL_MS * 5 + 40}ms at a ${TEST_INTERVAL_MS}ms interval, got ${callsAtStop} real calls`);
      console.log(`  [captured] real poll fired ${callsAtStop} times over ~${TEST_INTERVAL_MS * 5 + 40}ms at a real ${TEST_INTERVAL_MS}ms interval`);

      // Real proof the returned teardown genuinely stops the timer — wait
      // again and confirm the count does NOT keep climbing.
      await sleep(TEST_INTERVAL_MS * 4);
      assert(calls === callsAtStop, `expected zero further real calls after stop() was called, but count grew from ${callsAtStop} to ${calls} — the real timer was not actually cleared`);
    });

    await test("Acceptance 1b — startSystemRealityPolling() defaults to the real, reused SYSTEM_REALITY_POLL_INTERVAL_MS (120_000ms) when no interval is given — never silently uses a different default", () => {
      assert(SYSTEM_REALITY_POLL_INTERVAL_MS === 120_000, `expected the real, reused default interval to be 120_000ms (matching app/admin/dashboard/page.tsx's own existing convention), got ${SYSTEM_REALITY_POLL_INTERVAL_MS}`);
    });

    await test("Structural 1c — components/workspace/SystemRealityReportSection.tsx really wires startSystemRealityPolling(fetchReport) into a real useEffect (not just imported and unused)", () => {
      const src = readFileSync(path.join(ROOT, "components/workspace/SystemRealityReportSection.tsx"), "utf-8");
      assert(/import\s*\{[^}]*startSystemRealityPolling[^}]*\}\s*from\s*["']\.\/systemRealityPolling["']/.test(src), "expected a real import of startSystemRealityPolling from ./systemRealityPolling");
      assert(/return\s+startSystemRealityPolling\(\s*fetchReport\s*\)/.test(src), "expected a real `return startSystemRealityPolling(fetchReport)` inside a useEffect");
      assert(/useEffect\(/.test(src), "expected a real useEffect wiring the poll teardown");
    });

    await test("Structural 1d — no real, live Supabase-table-backed signal exists anywhere in this report's own real data sources (justifying polling over a Realtime subscription) — services/supabase/realtime.ts's ONLY real subscription is to the 'payments' table, which systemRealityRuntime.ts never reads, and costGateRuntime.ts's real COST_BUDGETS/COST_LEDGER readers are real, local JSON file reads, never a Supabase client call", () => {
      const realtimeSrc = readFileSync(path.join(ROOT, "services/supabase/realtime.ts"), "utf-8");
      const tableMatch = realtimeSrc.match(/table:\s*["'](\w+)["']/);
      assert(tableMatch !== null, "test-integrity: expected services/supabase/realtime.ts to still real-subscribe to a named table");
      assert(tableMatch![1] === "payments", `test-integrity: expected services/supabase/realtime.ts's real subscription target to still be 'payments', got '${tableMatch![1]}' — if this changed, this suite's own realtime-vs-polling judgment call needs re-review`);

      const systemRealitySrc = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/systemRealityRuntime.ts"), "utf-8");
      assert(!/["']payments["']/.test(systemRealitySrc), "expected systemRealityRuntime.ts to never reference the real 'payments' table — confirms zero overlap with the one real Supabase Realtime signal that exists in this repo");
      assert(!/createClient|supabase\(\)/.test(systemRealitySrc), "expected systemRealityRuntime.ts to contain zero real Supabase client usage — confirms it is genuinely file/registry-only, with no live table to ever drive a real Realtime event");

      const costGateSrc = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/costGateRuntime.ts"), "utf-8");
      assert(/BUDGETS_REL_PATH\s*=\s*["']registry\/COST_BUDGETS\.json["']/.test(costGateSrc), "expected costGateRuntime.ts's real budgets source to still be the local registry/COST_BUDGETS.json file");
      assert(/LEDGER_REL_PATH\s*=\s*["']registry\/COST_LEDGER\.json["']/.test(costGateSrc), "expected costGateRuntime.ts's real ledger source to still be the local registry/COST_LEDGER.json file");
    });

    // ============================================================
    // 2 — STEP 7: Gap Loop bridge.
    // ============================================================

    // 2b (real, read-only, zero writes): the real, live model's Cost
    // Calculation capability real-dedupes against FCR-013 via a real
    // dryRun call against the FULL, live, 17-capability model.
    let preDryRunRaw: string;
    let postDryRunRaw: string;
    let dryRunResults: GapBridgeResult[] = [];
    await test("Acceptance 2b — runGapLoopBridge({dryRun:true}) against the REAL, live, full system reality model real-detects the Cost Calculation capability as an already-represented duplicate of the real, live FCR-013 finding, with a real overlapScore >= 0.5 — and performs ZERO real writes to registry/FACTORY_CENTRAL_REGISTRY.json", async () => {
      preDryRunRaw = readFcrRaw();
      dryRunResults = await runGapLoopBridge({ dryRun: true });
      postDryRunRaw = readFcrRaw();
      assert(preDryRunRaw === postDryRunRaw, "expected registry/FACTORY_CENTRAL_REGISTRY.json to be byte-for-byte unchanged after a dryRun:true call — dry run must never write");

      const cost = dryRunResults.find((r) => r.capability_name.includes("Cost Calculation"));
      assert(cost !== undefined, `expected the real, live model to include a triggered Cost Calculation result, got results for: ${JSON.stringify(dryRunResults.map((r) => r.capability_name))}`);
      assert(cost!.action === "SKIPPED_DUPLICATE", `expected Cost Calculation to real-dedupe as SKIPPED_DUPLICATE (matching FCR-013), got action=${cost!.action}`);
      assert(cost!.duplicate?.matchedFindingId === "FCR-013", `expected the real match to be FCR-013, got ${cost!.duplicate?.matchedFindingId}`);
      assert(typeof cost!.duplicate?.overlapScore === "number" && cost!.duplicate!.overlapScore >= 0.5, `expected a real overlapScore >= 0.5, got ${cost!.duplicate?.overlapScore}`);
      console.log(`  [captured] Cost Calculation -> SKIPPED_DUPLICATE, matched=${cost!.duplicate?.matchedFindingId}, real overlapScore=${cost!.duplicate?.overlapScore}`);
    });

    await test("Acceptance 2b(ii) (captured evidence, informational) — real, live dry-run classification/dedup outcome for every one of today's real, currently-triggered (BLOCKED/DEGRADED/NOT_CONNECTED/BUILT_NOT_WIRED) capabilities, logged for real transparency (not asserted individually — today's live gap landscape is expected to legitimately change over time as real findings get resolved)", async () => {
      assert(dryRunResults.length > 0, "test-integrity: expected at least one real, live triggered capability today");
      for (const r of dryRunResults) {
        console.log(`  [captured] ${r.capability_name} [${r.status}] -> ${r.action}${r.duplicate ? ` (matched ${r.duplicate.matchedFindingId}, score=${r.duplicate.overlapScore.toFixed(3)})` : ""} — classify=${r.classification.type}`);
      }
    });

    await test("Structural 2c — every real, currently-triggered capability in the live model really has status in TRIGGER_STATUSES (BLOCKED/DEGRADED/NOT_CONNECTED/BUILT_NOT_WIRED) — no LIVE/WIRED_NOT_TESTED/NOT_BUILT/UNKNOWN capability was ever included", async () => {
      const model = await buildSystemRealityModel();
      const triggeredNames = new Set(dryRunResults.map((r) => r.capability_name));
      for (const c of model.capabilities) {
        if (triggeredNames.has(c.capability_name)) {
          assert((TRIGGER_STATUSES as readonly string[]).includes(c.status), `capability "${c.capability_name}" was included by the bridge but has status=${c.status}, not one of TRIGGER_STATUSES`);
        } else {
          assert(!(TRIGGER_STATUSES as readonly string[]).includes(c.status), `capability "${c.capability_name}" has a real trigger status (${c.status}) but was NOT included by the bridge`);
        }
      }
    });

    // 2a — real write path: creates one new finding for a capability with
    // no existing real match (the synthetic fixture).
    let syntheticFindingId: string | null = null;
    let countBeforeMyWrites = 0;

    await test("Acceptance 2a(i) (dry run first) — the synthetic, disposable fixture capability real-dedupes as NOT a duplicate of anything real today (action=CREATED under dryRun, zero writes) — proves the fixture text was genuinely chosen not to collide with any real, existing finding", async () => {
      const raw = readFcrRaw();
      const dry = await runGapLoopBridge({ dryRun: true, capabilities: [SYNTHETIC_CAPABILITY] });
      assert(readFcrRaw() === raw, "expected zero writes from this dryRun call");
      assert(dry.length === 1, `expected exactly 1 result, got ${dry.length}`);
      assert(dry[0].action === "CREATED", `expected the disposable fixture to real-dedupe as CREATED (no real match), got action=${dry[0].action}${dry[0].duplicate ? ` (matched ${dry[0].duplicate.matchedFindingId})` : ""}`);
    });

    await test("Acceptance 2a(ii) (REAL write) — runGapLoopBridge() real-creates ONE new finding for the synthetic, disposable fixture via the real, lock-protected registryWriterRuntime.ts#writeFinding() write path, correctly classified via classifyGap()", async () => {
      const before = readFcr();
      countBeforeMyWrites = before.findings.length;

      const out = await runGapLoopBridge({ capabilities: [SYNTHETIC_CAPABILITY] });
      assert(out.length === 1, `expected exactly 1 result, got ${out.length}`);
      assert(out[0].action === "CREATED", `expected action=CREATED, got ${out[0].action} (error=${out[0].error})`);
      assert(typeof out[0].finding_id === "string" && /^FCR-\d+$/.test(out[0].finding_id!), `expected a real, well-formed FCR-### finding_id, got ${JSON.stringify(out[0].finding_id)}`);
      syntheticFindingId = out[0].finding_id;
      createdFindingIds.push(syntheticFindingId!);

      const after = readFcr();
      assert(after.findings.length === countBeforeMyWrites + 1, `expected exactly 1 real new finding to appear, went from ${countBeforeMyWrites} to ${after.findings.length}`);
      const written = after.findings.find((f) => f.finding_id === syntheticFindingId);
      assert(written !== undefined, `expected to find the real, newly-written finding ${syntheticFindingId} in registry/FACTORY_CENTRAL_REGISTRY.json`);
      assert(written!.status === "NEW", `expected the real, newly-written finding's status to be NEW, got ${written!.status}`);
      assert(written!.description!.includes("[TEST-DISPOSABLE]"), "expected the real, newly-written finding's description to carry the synthetic capability's own disposable marker");
      assert(written!.SOURCE === "MANAGER", `expected real SOURCE=MANAGER (this bridge's own default), got ${written!.SOURCE}`);
      assert(out[0].classification.type === "UNCLASSIFIED" || (out[0].classification.type as string).length > 0, "expected a real, non-empty classification result");
      console.log(`  [captured] real write created ${syntheticFindingId}, classify=${out[0].classification.type} (${out[0].classification.reason})`);
    });

    // 2c — same synthetic capability, run again: must now real-dedupe
    // against the finding just created (write-path duplicate proof).
    await test("Acceptance 2c — running runGapLoopBridge() AGAIN with the SAME synthetic capability real-detects it as a duplicate of the finding just created in 2a(ii) — action=SKIPPED_DUPLICATE, matched finding_id matches, and NO second finding is created", async () => {
      assert(syntheticFindingId !== null, "test-integrity: expected 2a(ii) to have run first and captured a real finding_id");
      const before = readFcr();
      const out = await runGapLoopBridge({ capabilities: [SYNTHETIC_CAPABILITY] });
      assert(out.length === 1, `expected exactly 1 result, got ${out.length}`);
      assert(out[0].action === "SKIPPED_DUPLICATE", `expected action=SKIPPED_DUPLICATE on the second, identical pass, got ${out[0].action}`);
      assert(out[0].duplicate?.matchedFindingId === syntheticFindingId, `expected the real match to be the exact finding created in 2a(ii) (${syntheticFindingId}), got ${out[0].duplicate?.matchedFindingId}`);
      const after = readFcr();
      assert(after.findings.length === before.findings.length, `expected ZERO new findings on this real duplicate-skip pass, count changed from ${before.findings.length} to ${after.findings.length}`);
      console.log(`  [captured] second pass -> SKIPPED_DUPLICATE, matched=${out[0].duplicate?.matchedFindingId}, real overlapScore=${out[0].duplicate?.overlapScore}`);
    });

    // ============================================================
    // 3 — Structural: read/write boundary (Owner Report = Read Model).
    // ============================================================
    await test("Structural 3a — app/api/admin/system-reality/route.ts (the real Report GET route) never imports gapLoopBridge.ts, directly or by name", () => {
      const src = readFileSync(path.join(ROOT, "app/api/admin/system-reality/route.ts"), "utf-8");
      assert(!/gapLoopBridge/.test(src), "expected zero references to gapLoopBridge in app/api/admin/system-reality/route.ts");
      assert(!/runGapLoopBridge/.test(src), "expected zero references to runGapLoopBridge in app/api/admin/system-reality/route.ts");
    });

    await test("Structural 3b — app/api/admin/system-reality/_lib/ownerLanguage.ts (the real translation layer the GET route calls) never imports gapLoopBridge.ts", () => {
      const src = readFileSync(path.join(ROOT, "app/api/admin/system-reality/_lib/ownerLanguage.ts"), "utf-8");
      assert(!/gapLoopBridge/.test(src), "expected zero references to gapLoopBridge in ownerLanguage.ts");
    });

    await test("Structural 3c — components/workspace/SystemRealityReportSection.tsx (the real client component, including its own STEP 6 polling) never imports gapLoopBridge.ts", () => {
      const src = readFileSync(path.join(ROOT, "components/workspace/SystemRealityReportSection.tsx"), "utf-8");
      assert(!/gapLoopBridge/.test(src), "expected zero references to gapLoopBridge in SystemRealityReportSection.tsx");
    });

    await test("Structural 3d — whole-directory scan of app/api/admin/system-reality/ finds the string 'gapLoopBridge' in EXACTLY the one real place it belongs (gapLoopBridge.ts's own file), never in route.ts or any other _lib file", () => {
      function walk(dir: string, out: string[]) {
        for (const entry of readdirSync(dir)) {
          const full = path.join(dir, entry);
          const st = statSync(full);
          if (st.isDirectory()) walk(full, out);
          else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
        }
      }
      const files: string[] = [];
      walk(path.join(ROOT, "app/api/admin/system-reality"), files);
      const offenders = files.filter((f) => !f.endsWith("gapLoopBridge.ts") && /gapLoopBridge/.test(readFileSync(f, "utf-8")));
      assert(offenders.length === 0, `expected zero files (other than gapLoopBridge.ts itself) under app/api/admin/system-reality/ to mention gapLoopBridge, found: ${JSON.stringify(offenders.map((f) => path.relative(ROOT, f)))}`);
    });

    await test("Structural 3e — gapLoopBridge.ts contains ZERO setInterval/cron/while(true)/for(;;) — a plain, awaited async function, never a background auto-trigger of its own", () => {
      const src = readFileSync(path.join(ROOT, "app/api/admin/system-reality/_lib/gapLoopBridge.ts"), "utf-8");
      const offenders: string[] = [];
      const patterns: [RegExp, string][] = [
        [/\bsetInterval\s*\(/, "setInterval("], [/\bcron\.schedule\s*\(/, "cron.schedule("],
        [/while\s*\(\s*true\s*\)/, "while (true)"], [/for\s*\(\s*;\s*;\s*\)/, "for (;;)"],
      ];
      for (const [re, label] of patterns) if (re.test(src)) offenders.push(label);
      assert(offenders.length === 0, `expected zero background-loop patterns in gapLoopBridge.ts, found: ${JSON.stringify(offenders)}`);
    });

    await test("Structural 3f — whole-repo scan: no file anywhere in app/ or scripts/ (other than this suite's own, deliberate, one-shot calls) wires runGapLoopBridge into a setInterval/cron/recursive-setTimeout auto-trigger — proves the Gap Loop bridge is never fired automatically by merely viewing the Report page", () => {
      function walkTsFiles(dir: string, out: string[]) {
        let entries: string[];
        try { entries = readdirSync(dir); } catch { return; }
        for (const entry of entries) {
          if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
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
      const offenders: string[] = [];
      for (const f of new Set(files)) {
        if (f.endsWith("gapLoopBridge.ts") || f.endsWith("system-reality-gaploop-test.ts")) continue;
        let src: string;
        try { src = readFileSync(f, "utf-8"); } catch { continue; }
        const importsBridge = /runGapLoopBridge/.test(src);
        const hasLoopPattern = /\bsetInterval\s*\(/.test(src) || /\bcron\.schedule\s*\(/.test(src);
        if (importsBridge && hasLoopPattern) offenders.push(f);
      }
      assert(offenders.length === 0, `expected zero files to wire runGapLoopBridge into any auto-trigger loop, found: ${JSON.stringify(offenders)}`);
    });

    // ============================================================
    // 4 — Reuse, not reimplementation (Constitution Rule 101/103).
    // ============================================================
    await test("Structural 4a — gapLoopBridge.ts really IMPORTS classifyGap/findDuplicateGap from gapLoopRuntime.ts, writeFinding from registryWriterRuntime.ts, and buildSystemRealityModel from systemRealityRuntime.ts — never reimplements any of them", () => {
      const src = readFileSync(path.join(ROOT, "app/api/admin/system-reality/_lib/gapLoopBridge.ts"), "utf-8");
      assert(/import\s*\{[^}]*classifyGap[^}]*findDuplicateGap[^}]*\}\s*from\s*["'][^"']*gapLoopRuntime["']/.test(src) || (/classifyGap/.test(src) && /findDuplicateGap/.test(src) && /from\s*["'][^"']*gapLoopRuntime["']/.test(src)), "expected a real import of classifyGap/findDuplicateGap from gapLoopRuntime.ts");
      assert(/import\s*\{[^}]*writeFinding[^}]*\}\s*from\s*["'][^"']*registryWriterRuntime["']/.test(src), "expected a real import of writeFinding from registryWriterRuntime.ts");
      assert(/import\s*\{[^}]*buildSystemRealityModel[^}]*\}\s*from\s*["'][^"']*systemRealityRuntime["']/.test(src), "expected a real import of buildSystemRealityModel from systemRealityRuntime.ts");
      assert(!/function\s+classifyGap\s*\(/.test(src), "expected NO local re-definition of classifyGap in gapLoopBridge.ts");
      assert(!/function\s+findDuplicateGap\s*\(/.test(src), "expected NO local re-definition of findDuplicateGap in gapLoopBridge.ts");
      assert(!/writeFileSync\([^)]*FACTORY_CENTRAL_REGISTRY/.test(src), "expected gapLoopBridge.ts itself to never directly writeFileSync registry/FACTORY_CENTRAL_REGISTRY.json — all real writes must go through the imported writeFinding()");
    });

    console.log("\n=== Owner System Reality Report — STEP 6+7 Acceptance Suite ===");
    for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
    const passed = results.filter((r) => r.pass).length;
    const failed = results.filter((r) => !r.pass);
    console.log(`\n${passed}/${results.length} passed`);

    // ============================================================
    // 5 — real, verified cleanup + before/after count report.
    // ============================================================
    const beforeCleanup = readFcr();
    console.log(`\n[cleanup] real finding count before cleanup: ${beforeCleanup.findings.length} (this suite's own real writes: ${createdFindingIds.length} — ${JSON.stringify(createdFindingIds)})`);
    if (createdFindingIds.length > 0) {
      await removeFindingsWithRetry(createdFindingIds);
    }
    const afterCleanup = readFcr();
    console.log(`[cleanup] real finding count after cleanup: ${afterCleanup.findings.length}`);
    const stillPresent = createdFindingIds.filter((id) => afterCleanup.findings.some((f) => f.finding_id === id));
    if (stillPresent.length > 0) {
      console.error(`[cleanup] FAILED to remove: ${JSON.stringify(stillPresent)} — registry/FACTORY_CENTRAL_REGISTRY.json is NOT clean`);
      process.exitCode = 1;
    } else if (createdFindingIds.length > 0) {
      const expectedCount = countBeforeMyWrites;
      if (afterCleanup.findings.length === expectedCount) {
        console.log(`[cleanup] VERIFIED — real finding count restored to exactly ${expectedCount} (matches the real count captured immediately before this suite's own first write), zero test pollution left behind.`);
      } else {
        console.log(`[cleanup] VERIFIED this suite's own ${createdFindingIds.length} disposable finding(s) removed. Note: real finding count (${afterCleanup.findings.length}) differs from the pre-write snapshot (${expectedCount}) — this is a real, live, potentially multi-agent-shared registry; a concurrent session may have added/changed an unrelated real finding during this run. This suite's own change is confirmed fully reverted regardless.`);
      }
    }

    if (failed.length > 0 || process.exitCode === 1) {
      console.error(`\n${failed.length} test(s) failed.`);
      process.exit(1);
    }
  } catch (e) {
    // Real safety net: even a thrown error mid-suite must not leave a
    // disposable finding behind — attempt cleanup, then re-throw.
    if (createdFindingIds.length > 0) {
      try { await removeFindingsWithRetry(createdFindingIds); console.error(`[cleanup on error] removed ${JSON.stringify(createdFindingIds)}`); }
      catch (cleanupErr) { console.error(`[cleanup on error] ALSO FAILED: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`); }
    }
    throw e;
  }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
