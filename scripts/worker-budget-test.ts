/**
 * Execution Budget Regression Suite (owner, 2026-08-08, Software
 * Factory Step 13.6) — verifies the real
 * app/api/admin/ide/_lib/executionBudgetRuntime.ts real PRECHECK/
 * RESERVE/RECORD/ENFORCE/STOP behavior: token cap, call cap, cost cap,
 * file count, and that a limit STOPS the call before/at the boundary,
 * never discovered only after the fact.
 *
 * Run: npm run worker-budget:test
 */
import { randomUUID } from "crypto";
import { initBudget, precheckBudget, reserveBudget, recordActualUsage, enforceBudget, getBudgetRecord, DEFAULT_EXECUTION_BUDGET } from "../app/api/admin/ide/_lib/executionBudgetRuntime";

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

async function main() {
  await test("Call cap: precheckBudget() refuses a second real call once maxProviderCalls is reached", () => {
    const wsId = randomUUID(), stepId = "step-1";
    initBudget(wsId, stepId, { maxProviderCalls: 1 });
    const first = reserveBudget(wsId, stepId, { providerCalls: 1 });
    assert(first.ok, "expected the real first call to be allowed");
    const second = precheckBudget(wsId, stepId, { providerCalls: 1 });
    assert(second.ok === false, "expected the real second call to be refused");
    assert(second.reasons.some((r) => r.includes("maxProviderCalls")), "expected a real, specific maxProviderCalls reason");
  });

  await test("Token cap: precheckBudget() refuses a real call whose estimated tokens would exceed maxTokens", () => {
    const wsId = randomUUID(), stepId = "step-1";
    initBudget(wsId, stepId, { maxTokens: 100, maxProviderCalls: 5 });
    const check = precheckBudget(wsId, stepId, { tokens: 200 });
    assert(check.ok === false, "expected a real refusal when prospective tokens exceed maxTokens");
  });

  await test("Cost cap: precheckBudget() refuses a real call whose estimated cost would exceed maxEstimatedCost", () => {
    const wsId = randomUUID(), stepId = "step-1";
    initBudget(wsId, stepId, { maxEstimatedCost: 0.5, maxProviderCalls: 5 });
    const check = precheckBudget(wsId, stepId, { estimatedCost: 1.0 });
    assert(check.ok === false, "expected a real refusal when prospective cost exceeds maxEstimatedCost");
  });

  await test("STOP enforcement: enforceBudget() marks the real budget STOPPED once maxActualCost is exceeded, and PRECHECK honors it afterward", () => {
    const wsId = randomUUID(), stepId = "step-1";
    initBudget(wsId, stepId, { maxActualCost: 0.1, maxProviderCalls: 5 });
    recordActualUsage(wsId, stepId, { actualCost: 0.5 });
    const enforceResult = enforceBudget(wsId, stepId);
    assert(enforceResult.ok === false, "expected real ENFORCE to report exceeded");
    const record = getBudgetRecord(wsId, stepId);
    assert(record.stopped === true, "expected the real budget record to be marked stopped");
    const nextPrecheck = precheckBudget(wsId, stepId, { providerCalls: 1 });
    assert(nextPrecheck.ok === false, "expected PRECHECK to honor the real, already-STOPPED state on any subsequent call");
  });

  await test("File count cap: enforceBudget() reports exceeded once real filesChanged surpasses maxFilesChanged", () => {
    const wsId = randomUUID(), stepId = "step-1";
    initBudget(wsId, stepId, { maxFilesChanged: 2 });
    recordActualUsage(wsId, stepId, { filesChanged: 3 });
    const result = enforceBudget(wsId, stepId);
    assert(result.ok === false, "expected real ENFORCE to report exceeded for filesChanged");
    assert(result.reasons.some((r) => r.includes("maxFilesChanged")), "expected a real, specific maxFilesChanged reason");
  });

  await test("Timeout/duration cap: enforceBudget() reports exceeded once real durationMs surpasses maxDurationMs", () => {
    const wsId = randomUUID(), stepId = "step-1";
    initBudget(wsId, stepId, { maxDurationMs: 1000 });
    recordActualUsage(wsId, stepId, { durationMs: 5000 });
    const result = enforceBudget(wsId, stepId);
    assert(result.ok === false, "expected real ENFORCE to report exceeded for durationMs");
  });

  await test("PRECHECK before RESERVE: reserveBudget() never increments real usage counters when the real check fails", () => {
    const wsId = randomUUID(), stepId = "step-1";
    initBudget(wsId, stepId, { maxProviderCalls: 1 });
    reserveBudget(wsId, stepId, { providerCalls: 1 });
    const before = getBudgetRecord(wsId, stepId).usage.providerCalls;
    reserveBudget(wsId, stepId, { providerCalls: 1 }); // should be refused, not double-counted
    const after = getBudgetRecord(wsId, stepId).usage.providerCalls;
    assert(before === after, "expected a real, refused reservation to never increment real usage counters");
  });

  await test("Cost kind honesty: DEFAULT_EXECUTION_BUDGET declares real, sane numeric limits — never null/undefined for the required caps", () => {
    assert(DEFAULT_EXECUTION_BUDGET.maxProviderCalls > 0, "expected a real, positive default maxProviderCalls");
    assert(DEFAULT_EXECUTION_BUDGET.maxTokens > 0, "expected a real, positive default maxTokens");
    assert(DEFAULT_EXECUTION_BUDGET.maxFilesChanged > 0, "expected a real, positive default maxFilesChanged");
  });

  await test("Per-session/step isolation: two different (workspaceSessionId, stepId) keys never share real budget state", () => {
    const wsId = randomUUID();
    initBudget(wsId, "step-a", { maxProviderCalls: 1 });
    initBudget(wsId, "step-b", { maxProviderCalls: 1 });
    reserveBudget(wsId, "step-a", { providerCalls: 1 });
    const stepBUsage = getBudgetRecord(wsId, "step-b").usage.providerCalls;
    assert(stepBUsage === 0, "expected step-b's real usage to remain untouched by step-a's real reservation");
  });

  console.log("\n=== Execution Budget Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
