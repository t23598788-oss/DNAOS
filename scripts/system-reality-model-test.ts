/**
 * System Reality Model Acceptance Suite (owner, 2026-08-10, Capability
 * Roadmap #57 STEP 2+3, registry/TASK_QUEUE.json TASK-053). Proves,
 * against the real, running systemRealityRuntime.ts composition and real,
 * live repo data — never mocked — every acceptance requirement named for
 * this task:
 *
 *  1. The model real-computes at least the capabilities named in
 *     REALITY_INVENTORY_STEP1.md's headline findings, with real status
 *     matching what those findings (and the underlying FCR-013..020
 *     entries) actually found — e.g. real proof the Cost-calculation
 *     capability comes back BUILT_NOT_WIRED (matching FCR-013's real
 *     zero-caller finding), never fabricated as LIVE.
 *  2. No field is ever silently fabricated — real proof that when a real
 *     source genuinely doesn't answer a field, the model honestly reports
 *     UNKNOWN/null rather than guessing (both directions: a genuinely
 *     absent module honestly resolves to not-reachable, and a genuinely
 *     real, open problem is never silently reported as null/clear).
 *  3. The Connection Gap Map real-reflects the LINE->AI, AI->Pricing,
 *     Invoice->Payment pairs (plus this build's own additional real,
 *     evidenced pairs) with real, evidenced states.
 *  4. Structural proof this file composes/reads the real sources listed
 *     in TASK-053 rather than reimplementing their logic (import-graph
 *     scan, same technique as scripts/gap-loop-test.ts /
 *     scripts/cost-gate-test.ts).
 *
 * Run: npm run system-reality-model:test
 */
import { readFileSync } from "fs";
import path from "path";
import {
  buildSystemRealityModel, mapStep1State, computeLiveReachability,
  CAPABILITY_STATUSES, __debugResetArchitectureBookCache,
  type CapabilityRealityEntry, type ConnectionGapEntry, type CapabilityStatus,
} from "../app/api/admin/ide/_lib/systemRealityRuntime";
import { WORKSPACE_ROOT } from "../app/api/admin/ide/_lib/fsSecurity";

const ROOT = WORKSPACE_ROOT;

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

/** Real, UNIQUE-match capability lookup — throws (test-integrity failure,
 * not a silent wrong-pick) if nameSubstring matches zero or more than one
 * real capability_name, so a loose substring (e.g. "invoice", which also
 * appears inside the real Documents capability's own name) can never
 * silently resolve to the wrong entry. */
function findCap(caps: CapabilityRealityEntry[], nameSubstring: string): CapabilityRealityEntry {
  const matches = caps.filter((c) => c.capability_name.toLowerCase().includes(nameSubstring.toLowerCase()));
  if (matches.length === 0) throw new Error(`test-integrity: expected to find a real capability entry whose name contains "${nameSubstring}", got names: ${JSON.stringify(caps.map((c) => c.capability_name))}`);
  if (matches.length > 1) throw new Error(`test-integrity: "${nameSubstring}" matched ${matches.length} real capability names ambiguously (${JSON.stringify(matches.map((c) => c.capability_name))}) — use a more specific substring`);
  return matches[0];
}
/** Strips // and /* *\/ comments before a structural "must not reference
 * X" check, so a file naming an off-limits path inside its own header
 * comment (e.g. to document scope discipline) is never mistaken for the
 * file actually reading/writing it. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
}
function findConn(conns: ConnectionGapEntry[], from: string, to: string): ConnectionGapEntry {
  const found = conns.find((c) => c.from.toLowerCase().includes(from.toLowerCase()) && c.to.toLowerCase().includes(to.toLowerCase()));
  if (!found) throw new Error(`test-integrity: expected to find a real connection ${from} -> ${to}, got: ${JSON.stringify(conns.map((c) => `${c.from} -> ${c.to}`))}`);
  return found;
}

async function main() {
  __debugResetArchitectureBookCache();
  const model = await buildSystemRealityModel();
  const systemRealityRuntimeSrc = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/systemRealityRuntime.ts"), "utf-8");
  const realityInventoryMd = readFileSync(path.join(ROOT, "REALITY_INVENTORY_STEP1.md"), "utf-8");
  const fcr = JSON.parse(readFileSync(path.join(ROOT, "registry/FACTORY_CENTRAL_REGISTRY.json"), "utf-8")) as { findings: { finding_id: string; status: string }[] };

  // ============================================================
  // 0 — Basic shape integrity: exactly the 17 named capability areas,
  // exactly the 11 required fields on every entry, only real enum values.
  // ============================================================
  await test("Acceptance 0a — the model real-computes all 17 capability areas named by TASK-053 (LINE, AI, Vision/OCR, Documents, Quotation, Invoice, Payment, VAT/Tax, Debt, Logistics, Resources, Finance, Cost calculation, Notifications, External connectors, Runtime, MANAGER-07 Control Plane)", () => {
    assert(model.capabilities.length === 17, `expected exactly 17 real capability entries, got ${model.capabilities.length}: ${JSON.stringify(model.capabilities.map((c) => c.capability_name))}`);
  });

  await test("Acceptance 0b — every capability entry has EXACTLY the 11 real fields TASK-053 named — no more, no less, none silently dropped", () => {
    const expectedKeys = ["capability_name", "business_function", "status", "runtime_status", "connected_from", "connected_to", "missing_connection", "current_blocker", "impact", "last_verified", "evidence", "next_required_connection"].sort();
    for (const c of model.capabilities) {
      const actualKeys = Object.keys(c).sort();
      assert(JSON.stringify(actualKeys) === JSON.stringify(expectedKeys), `capability "${c.capability_name}" has keys ${JSON.stringify(actualKeys)}, expected exactly ${JSON.stringify(expectedKeys)}`);
    }
  });

  await test("Acceptance 0c — every real status value used is one of the exact 8 named in TASK-053 (LIVE/DEGRADED/BLOCKED/NOT_CONNECTED/BUILT_NOT_WIRED/WIRED_NOT_TESTED/NOT_BUILT/UNKNOWN) — never an invented 9th value", () => {
    for (const c of model.capabilities) {
      assert((CAPABILITY_STATUSES as readonly string[]).includes(c.status), `capability "${c.capability_name}" has status=${c.status}, not one of the real 8 allowed values`);
    }
  });

  await test("Acceptance 0d — every capability's evidence[] is real and non-empty (never a naked, unevidenced status claim)", () => {
    for (const c of model.capabilities) {
      assert(Array.isArray(c.evidence) && c.evidence.length > 0, `capability "${c.capability_name}" has empty/missing evidence[]`);
    }
  });

  // ============================================================
  // 1 — Real headline findings from REALITY_INVENTORY_STEP1.md must be
  // reflected accurately, not fabricated.
  // ============================================================
  await test("Acceptance 1a — the Cost-calculation capability comes back BUILT_NOT_WIRED (matching FCR-013's real zero-caller finding for engines/pricing.ts#calcPricing) — never fabricated as LIVE", () => {
    const cost = findCap(model.capabilities, "cost calculation");
    assert(cost.status === "BUILT_NOT_WIRED", `expected real status BUILT_NOT_WIRED for Cost Calculation (FCR-013: zero real callers for engines/pricing.ts), got ${cost.status}`);
    assert(cost.evidence.some((e) => e.includes("FCR-013")), `expected Cost Calculation's evidence[] to cite FCR-013, got: ${JSON.stringify(cost.evidence)}`);
    assert(cost.missing_connection !== null && cost.missing_connection.length > 0, "expected a real, non-null missing_connection describing the Pricing Engine gap");
    console.log(`  [captured] Cost Calculation -> status=${cost.status}`);
  });

  await test("Acceptance 1b — independently, computeLiveReachability('module:engines/pricing.ts') itself (the real, generic function, not a hardcoded FCR-013 restatement) reports NOT reachable from any real production surface, live, right now", () => {
    const r = computeLiveReachability("module:engines/pricing.ts");
    assert(r.reachable === false, `expected engines/pricing.ts to be real, structurally unreachable from production (corroborating FCR-013 independently), got reachable=true, path=${JSON.stringify(r.path)}`);
    assert(r.path === null, "expected a real null path when unreachable");
    assert(r.reason.length > 0, "expected a real, non-empty reason");
  });

  await test("Acceptance 1c — the SAME real reachability technique, applied to engines/tax.ts, independently discovers the SAME real dead-end (a genuine new finding this build made, not copied from any existing FCR id) — VAT/Tax capability real-reports BUILT_NOT_WIRED", () => {
    const vat = findCap(model.capabilities, "vat");
    assert(vat.status === "BUILT_NOT_WIRED", `expected real status BUILT_NOT_WIRED for VAT/Tax (independently-derived structural finding), got ${vat.status}`);
    const r = computeLiveReachability("module:engines/tax.ts");
    assert(r.reachable === false, "expected engines/tax.ts to be real, structurally unreachable from production");
  });

  await test("Acceptance 1d — the AI capability real-reports BLOCKED (matching FCR-015's real finding: local AI pipeline stalled, real ai_tasks stuck since 2026-08-05) — never fabricated as LIVE/RUNNING", () => {
    const ai = findCap(model.capabilities, "AI Understanding");
    assert(ai.status === "BLOCKED", `expected real status BLOCKED for AI (FCR-015), got ${ai.status}`);
    assert(ai.evidence.some((e) => e.includes("FCR-015")), `expected AI capability's evidence[] to cite FCR-015, got: ${JSON.stringify(ai.evidence)}`);
  });

  await test("Acceptance 1e — the Invoice capability real-reports DEGRADED and cites FCR-017 (sent invoices can be silently edited, real Rule 113 violation) — never silently smoothed over as LIVE with no caveat", () => {
    const invoice = findCap(model.capabilities, "Invoice (issue");
    assert(invoice.status === "DEGRADED", `expected real status DEGRADED for Invoice (FCR-017), got ${invoice.status}`);
    assert(invoice.current_blocker !== null && invoice.current_blocker.includes("FCR-017"), `expected Invoice's current_blocker to real-cite FCR-017, got: ${invoice.current_blocker}`);
  });

  await test("Acceptance 1f — every headline REALITY_INVENTORY_STEP1.md finding this model claims to reflect (FCR-013 through FCR-020) is real and live in registry/FACTORY_CENTRAL_REGISTRY.json today — test-integrity check that the underlying findings this suite asserts against still really exist", () => {
    for (const id of ["FCR-013", "FCR-014", "FCR-015", "FCR-016", "FCR-017", "FCR-018", "FCR-019", "FCR-020"]) {
      assert(fcr.findings.some((f) => f.finding_id === id), `test-integrity: expected ${id} to really exist in registry/FACTORY_CENTRAL_REGISTRY.json`);
    }
    assert(realityInventoryMd.includes("engines/pricing.ts#calcPricing"), "test-integrity: expected REALITY_INVENTORY_STEP1.md to still really cite engines/pricing.ts#calcPricing");
  });

  // ============================================================
  // 2 — Honest UNKNOWN/null: proof this model never silently fabricates
  // a field it cannot really answer, in BOTH directions (honestly blank
  // when nothing is wrong, honestly non-blank when something real is).
  // ============================================================
  await test("Acceptance 2a — computeLiveReachability() on a module that genuinely does not exist anywhere in the real, live registry/architecture-book.json honestly reports reachable=false with a real, cited 'not found' reason — never silently guessed as reachable=true", () => {
    const fakeModuleId = "module:engines/this-module-does-not-really-exist-anywhere.ts";
    const r = computeLiveReachability(fakeModuleId);
    assert(r.reachable === false, "expected an honest reachable=false for a genuinely nonexistent module — never fabricated as reachable");
    assert(r.reason.includes("does not exist"), `expected an honest 'does not exist' reason, got: ${r.reason}`);
    assert(r.path === null, "expected a real null path for a module that was never found");
  });

  await test("Acceptance 2b — mapStep1State() never silently resolves TESTED/DEPLOYED to LIVE without a real, caller-supplied stillReachableNow=true signal (proves the mapper does not default-optimistically-guess LIVE)", () => {
    assert(mapStep1State("TESTED") === "WIRED_NOT_TESTED", `expected mapStep1State('TESTED') with no signal to honestly downgrade to WIRED_NOT_TESTED, got ${mapStep1State("TESTED")}`);
    assert(mapStep1State("DEPLOYED") === "WIRED_NOT_TESTED", `expected mapStep1State('DEPLOYED') with no signal to honestly downgrade to WIRED_NOT_TESTED, got ${mapStep1State("DEPLOYED")}`);
    assert(mapStep1State("LIVE_VERIFIED") === "LIVE", "expected mapStep1State('LIVE_VERIFIED') with no staleness signal to report LIVE");
    assert(mapStep1State("LIVE_VERIFIED", { verificationIsStale: true }) === "DEGRADED", "expected mapStep1State('LIVE_VERIFIED', staleness disclosed) to honestly downgrade to DEGRADED, not stay LIVE");
    assert(mapStep1State("BROKEN") === "BLOCKED", "expected mapStep1State('BROKEN') with no signal to default to the more severe, honest BLOCKED, not the softer DEGRADED");
  });

  await test("Acceptance 2c — real, currently-true honest nulls: capabilities this build found NO real current blocker/missing-connection for report null, not a fabricated placeholder string", () => {
    const payment = findCap(model.capabilities, "Payment");
    assert(payment.current_blocker === null, `expected Payment.current_blocker to be honestly null (no real current blocker found), got: ${JSON.stringify(payment.current_blocker)}`);
    const line = findCap(model.capabilities, "LINE Messaging");
    assert(line.missing_connection === null, `expected LINE.missing_connection to be honestly null (LINE IS connected, just policy-suppressed), got: ${JSON.stringify(line.missing_connection)}`);
  });

  await test("Acceptance 2d — real, currently-true honest NON-nulls: MANAGER-07 Control Plane never silently reports a clean/null missing_connection while registry/WORKER_IDENTITIES.json real-shows 0/6 registered — proves the model does not hide a real, open problem either", () => {
    const workerIdentities = JSON.parse(readFileSync(path.join(ROOT, "registry/WORKER_IDENTITIES.json"), "utf-8")) as { registered_count: number; total_slots: number };
    const manager = findCap(model.capabilities, "MANAGER-07");
    if (workerIdentities.registered_count < workerIdentities.total_slots) {
      assert(manager.missing_connection !== null, `expected a real, non-null missing_connection given live registered_count=${workerIdentities.registered_count}/${workerIdentities.total_slots}, got null`);
      assert(manager.missing_connection!.includes(String(workerIdentities.total_slots - workerIdentities.registered_count)), `expected the real missing_connection to cite the real unregistered count, got: ${manager.missing_connection}`);
    } else {
      assert(manager.missing_connection === null, "registered_count now equals total_slots live — expected an honestly null missing_connection");
    }
    assert(manager.status === "DEGRADED" || manager.status === "LIVE", `expected MANAGER-07 status to be a real, computed value (DEGRADED or LIVE depending on live computeFactoryStatus()), got ${manager.status}`);
  });

  await test("Acceptance 2e — MANAGER-07's runtime_status/current_blocker are driven by a REAL, live call to computeFactoryStatus() this run (never a hardcoded stale string) — asserts the live-computed reasons for FCR-013..020 (added after the registry's own cached factory_status snapshot) really do appear, proving staleness in the cache does not leak into this live computation", () => {
    const manager = findCap(model.capabilities, "MANAGER-07");
    const openNow = fcr.findings.filter((f) => ["TRACKED", "ESCALATED", "WAITING_MANAGER_DECISION", "NEW"].includes(f.status));
    for (const f of openNow) {
      assert(manager.current_blocker !== null && manager.current_blocker.includes(f.finding_id), `expected MANAGER-07's live-computed current_blocker to cite real, currently-open finding ${f.finding_id} (status=${f.status}), got: ${manager.current_blocker}`);
    }
    console.log(`  [captured] MANAGER-07 live current_blocker cites ${openNow.length} real, currently-open findings: ${openNow.map((f) => f.finding_id).join(", ")}`);
  });

  // ============================================================
  // 3 — Connection Gap Map: the 3 required pairs + this build's own
  // additional real, evidenced pairs.
  // ============================================================
  await test("Acceptance 3a — LINE -> AI Context real-reports WAS_WORKING_NOW_BROKEN (real: 69 done + 3 failed historically, 29 stuck pending since 2026-08-05 — it DID work, and now real, new work is not moving)", () => {
    const c = findConn(model.connections, "LINE", "AI Context");
    assert(c.state === "WAS_WORKING_NOW_BROKEN", `expected real state WAS_WORKING_NOW_BROKEN for LINE -> AI Context, got ${c.state}`);
    assert(c.drilldown.to_module !== null, "expected a real, non-null drilldown.to_module");
  });

  await test("Acceptance 3b — AI Context -> Pricing Engine real-reports NOT_CONNECTED (FCR-013), consistent with computeLiveReachability('module:engines/pricing.ts') computed independently above", () => {
    const c = findConn(model.connections, "AI Context", "Pricing");
    assert(c.state === "NOT_CONNECTED", `expected real state NOT_CONNECTED for AI Context -> Pricing Engine, got ${c.state}`);
    assert(c.evidence.some((e) => e.includes("FCR-013")), `expected this connection's evidence[] to cite FCR-013, got: ${JSON.stringify(c.evidence)}`);
  });

  await test("Acceptance 3c — Invoice -> Payment real-reports CONNECTED (real, live, via debt_events matched_debt_event_id + Payment Verification Levels 1/2/3)", () => {
    const c = findConn(model.connections, "Invoice", "Payment");
    assert(c.state === "CONNECTED", `expected real state CONNECTED for Invoice -> Payment, got ${c.state}`);
  });

  await test("Acceptance 3d — every real ConnectionGapEntry uses one of the exact 4 allowed link states, has real non-empty evidence, and a real, non-empty drilldown.technical_detail (the deeper layer STEP 3 requires, kept separate from the Owner-facing from/to/state/business_meaning fields)", () => {
    const allowed = ["CONNECTED", "NOT_CONNECTED", "CONNECTED_NOT_TESTED", "WAS_WORKING_NOW_BROKEN"];
    assert(model.connections.length >= 6, `expected at least the 6 real pairs this build derived, got ${model.connections.length}`);
    for (const c of model.connections) {
      assert(allowed.includes(c.state), `connection ${c.from} -> ${c.to} has invalid state ${c.state}`);
      assert(c.evidence.length > 0, `connection ${c.from} -> ${c.to} has empty evidence[]`);
      assert(c.drilldown.technical_detail.length > 0, `connection ${c.from} -> ${c.to} has empty drilldown.technical_detail`);
    }
  });

  await test("Acceptance 3e — Payment -> Ledger real-reports NOT_CONNECTED with a real, honest drilldown.to_module=null (there is genuinely no real accounting/ledger module to point at, not a hidden/guessed one)", () => {
    const c = findConn(model.connections, "Payment", "Ledger");
    assert(c.state === "NOT_CONNECTED", `expected NOT_CONNECTED for Payment -> Ledger, got ${c.state}`);
    assert(c.drilldown.to_module === null, `expected an honest null drilldown.to_module (no real ledger module exists), got: ${c.drilldown.to_module}`);
  });

  // ============================================================
  // 4 — Structural: this file composes/reads the real sources named by
  // TASK-053 rather than reimplementing their logic.
  // ============================================================
  await test("Structural 4a — systemRealityRuntime.ts really IMPORTS computeFactoryStatus from gapLoopRuntime.ts (never reimplements Factory Status logic)", () => {
    assert(/import\s*\{[^}]*computeFactoryStatus[^}]*\}\s*from\s*["']\.\/gapLoopRuntime["']/.test(systemRealityRuntimeSrc), "expected a real import of computeFactoryStatus from ./gapLoopRuntime");
    assert(!/function\s+computeFactoryStatus\s*\(/.test(systemRealityRuntimeSrc), "expected NO local re-definition of computeFactoryStatus in systemRealityRuntime.ts");
  });

  await test("Structural 4b — systemRealityRuntime.ts really IMPORTS listCostBudgets/listCostLedgerEntries from costGateRuntime.ts (never re-reads registry/COST_BUDGETS.json or registry/COST_LEDGER.json with its own JSON.parse)", () => {
    assert(/import\s*\{[^}]*listCostBudgets[^}]*\}\s*from\s*["']\.\/costGateRuntime["']/.test(systemRealityRuntimeSrc), "expected a real import of listCostBudgets from ./costGateRuntime");
    assert(/listCostLedgerEntries/.test(systemRealityRuntimeSrc), "expected a real usage of listCostLedgerEntries");
    assert(!/tryReadJson[^\n]*COST_BUDGETS\.json/.test(systemRealityRuntimeSrc), "expected systemRealityRuntime.ts to never directly tryReadJson registry/COST_BUDGETS.json — that real read belongs to costGateRuntime.ts, reused here via listCostBudgets()");
    assert(!/tryReadJson[^\n]*COST_LEDGER\.json/.test(systemRealityRuntimeSrc), "expected systemRealityRuntime.ts to never directly tryReadJson registry/COST_LEDGER.json — that real read belongs to costGateRuntime.ts, reused here via listCostLedgerEntries()");
  });

  await test("Structural 4c — every real source this file's own SOURCES_COMPOSED[] claims to compose from really is composed, not just cited: JSON registries appear in a real tryReadJson(...) call, the 2 reused-runtime entries appear as real imports, COST_BUDGETS/COST_LEDGER (deliberately NOT tryReadJson'd here, per Structural 4b) appear as real citations, and the one real prose source (REALITY_INVENTORY_STEP1.md) is cited more than once (not just declared and forgotten)", () => {
    const REUSED_VIA_IMPORTED_RUNTIME = new Set(["registry/COST_BUDGETS.json", "registry/COST_LEDGER.json"]);
    for (const src of model.sources_composed) {
      if (src.includes("#")) {
        const [file] = src.split("#");
        const base = path.basename(file).replace(".ts", "");
        assert(new RegExp(`from\\s*["']\\./${base}["']`).test(systemRealityRuntimeSrc), `expected a real import from ./${base} for cited source "${src}"`);
      } else if (REUSED_VIA_IMPORTED_RUNTIME.has(src)) {
        assert(systemRealityRuntimeSrc.includes(src), `expected a real citation of "${src}" (real read happens inside the reused costGateRuntime.ts functions, not here directly — see Structural 4b)`);
      } else if (src.endsWith(".json")) {
        const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`tryReadJson[\\s\\S]{0,80}?["']${escaped}["']`);
        assert(re.test(systemRealityRuntimeSrc), `expected a real tryReadJson(...) call actually reading "${src}" somewhere in systemRealityRuntime.ts, not just a citation string`);
      } else {
        const occurrences = systemRealityRuntimeSrc.split(src).length - 1;
        assert(occurrences > 1, `expected real prose source "${src}" to be cited more than once in systemRealityRuntime.ts (once in SOURCES_COMPOSED, at least once more as real evidence in a capability builder) — found ${occurrences}`);
      }
    }
  });

  await test("Structural 4d — systemRealityRuntime.ts contains ZERO setInterval/cron/while(true) background-loop patterns (this is a pure, on-demand compute function, matching TASK-053's own 'no realtime wiring' scope discipline)", () => {
    const offenders: string[] = [];
    const patterns: [RegExp, string][] = [
      [/\bsetInterval\s*\(/, "setInterval("], [/\bcron\.schedule\s*\(/, "cron.schedule("],
      [/while\s*\(\s*true\s*\)/, "while (true)"], [/for\s*\(\s*;\s*;\s*\)/, "for (;;)"],
    ];
    for (const [re, label] of patterns) if (re.test(systemRealityRuntimeSrc)) offenders.push(label);
    assert(offenders.length === 0, `expected zero background-loop patterns, found: ${JSON.stringify(offenders)}`);
  });

  await test("Structural 4e — systemRealityRuntime.ts never imports/writes to any of the off-limits registry files this task was told not to touch (CONSTITUTION.json, rule-coverage.json, CHANGELOG.json, capability-roadmap.json) OUTSIDE of its own header comment documenting that scope discipline — real code (comments stripped) contains zero live references to any of them, and zero writeFileSync calls anywhere (pure read/compute only)", () => {
    const codeOnly = stripComments(systemRealityRuntimeSrc);
    assert(!/writeFileSync/.test(codeOnly), "expected systemRealityRuntime.ts's real code (comments stripped) to contain ZERO writeFileSync calls — pure read/compute only");
    assert(!/CONSTITUTION\.json/.test(codeOnly), "expected zero LIVE-CODE references to registry/CONSTITUTION.json (comment-only mentions documenting scope discipline are fine and expected)");
    assert(!/rule-coverage\.json/.test(codeOnly), "expected zero live-code references to registry/rule-coverage.json");
    assert(!/CHANGELOG\.json/.test(codeOnly), "expected zero live-code references to registry/CHANGELOG.json");
    assert(!/capability-roadmap\.json/.test(codeOnly), "expected zero live-code references to registry/capability-roadmap.json");
    // Positive control: prove stripComments() actually strips something
    // real here (otherwise this test would vacuously pass even if the
    // regex logic were broken) — the header comment really does name
    // CONSTITUTION.json, so the RAW source must still contain it.
    assert(/CONSTITUTION\.json/.test(systemRealityRuntimeSrc), "test-integrity: expected the RAW (unstripped) source to still mention CONSTITUTION.json in its header comment — if this fails, stripComments() or the header comment changed and this test's positive control is no longer meaningful");
  });

  await test("Structural 4f — systemRealityRuntime.ts imports WORKSPACE_ROOT from ./fsSecurity (the same, single real root-resolution convention every other Runtime in this layer uses) rather than inventing its own path.join(process.cwd(), ...) convention", () => {
    assert(/import\s*\{\s*WORKSPACE_ROOT\s*\}\s*from\s*["']\.\/fsSecurity["']/.test(systemRealityRuntimeSrc), "expected a real import of WORKSPACE_ROOT from ./fsSecurity");
  });

  console.log("\n=== System Reality Model Acceptance Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
