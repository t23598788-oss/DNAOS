/**
 * Owner System Reality Report — Polling Helper (owner, 2026-08-10,
 * Capability Roadmap #57 "OWNER SYSTEM REALITY REPORT" — STEP 6,
 * registry/TASK_QUEUE.json TASK-053/054 follow-on, Constitution Rule 252).
 *
 * ============================================================
 * REALTIME vs. POLLING — real, evidence-based judgment call (Owner's own
 * instruction: "ถ้า runtime รองรับ event/realtime ให้ใช้ event-driven
 * update ถ้าไม่รองรับ ให้ใช้ health polling ตามช่วงเวลาที่เหมาะสม").
 *
 * Investigated BEFORE writing this file, not assumed:
 *  - services/supabase/realtime.ts is this repo's one real, live Supabase
 *    Realtime wrapper (subscribePayments()) — it subscribes to
 *    postgres_changes on exactly one real table, "payments". Nothing in
 *    buildSystemRealityModel()'s own real data sources maps onto that
 *    table, or onto ANY Supabase table at all.
 *  - Every real data source systemRealityRuntime.ts's SOURCES_COMPOSED[]
 *    names (app/api/admin/ide/_lib/systemRealityRuntime.ts:465-483) is
 *    either a JSON file read directly off local disk (registry/*.json,
 *    DNA_OS_HEALTH.json, DNA_OS_DASHBOARD.json) or a function call into
 *    gapLoopRuntime.ts#computeFactoryStatus() / costGateRuntime.ts's
 *    listCostBudgets()/listCostLedgerEntries() — and those two, in turn,
 *    only ever read registry/WORKER_IDENTITIES.json, registry/
 *    FACTORY_CENTRAL_REGISTRY.json, registry/COST_BUDGETS.json, registry/
 *    COST_LEDGER.json (all real, local JSON files — confirmed by reading
 *    costGateRuntime.ts's own BUDGETS_REL_PATH/LEDGER_REL_PATH constants;
 *    zero `createClient`/Supabase usage anywhere in that file's real
 *    read path).
 *  - Conclusion, stated honestly: there is NO real, live Supabase-table-
 *    backed signal anywhere in this report's real computation. Wrapping a
 *    Supabase Realtime channel subscription around this report would be a
 *    FAKE "realtime" — a channel with no real table to actually change
 *    when the report's own underlying facts change (a registry file being
 *    hand/AI-edited, or a re-run of the 8 acceptance suites, neither of
 *    which is a Postgres row write). The honest choice, per the Owner's
 *    own stated fallback rule, is health polling at a reasonable
 *    interval — not a hollow realtime wrapper.
 *
 * INTERVAL CHOICE — reused, not invented (Constitution Rule 101/103):
 * app/admin/dashboard/page.tsx already established a real, working
 * "auto-refresh ทุก 2 นาที — ทำงานเงียบ ไม่กระพริบ" (auto-refresh every 2
 * minutes, silently, no flicker) convention for this exact class of
 * problem — a real Owner-facing operational dashboard whose underlying
 * facts change slowly. This file reuses that exact interval
 * (120_000ms/2min) rather than inventing a new number. It is deliberately
 * NOT more aggressive than that: buildSystemRealityModel() does a real
 * file read across ~15 registries (plus, when computeFactoryStatus() is
 * ever called with verifyTestSuites:true — not the default the real GET
 * route uses — a real sequential re-run of 8 acceptance suites), so a
 * short interval would be real, wasted local I/O for a report whose
 * underlying facts genuinely do not change second-to-second.
 */

/** Real, reused interval — see this file's header for the full reasoning
 * (matches app/admin/dashboard/page.tsx's own existing 120_000ms
 * "auto-refresh, silent, no flicker" convention). */
export const SYSTEM_REALITY_POLL_INTERVAL_MS = 120_000;

/**
 * Real, minimal, framework-free polling primitive — deliberately NOT tied
 * to React so it can be exercised by a real, direct Node timer-based test
 * (scripts/system-reality-gaploop-test.ts) without needing a DOM/React
 * renderer (this repo has no jsdom/@testing-library dependency — see that
 * test's own header for why a plain function, not a React hook file, was
 * chosen). The one real caller in the UI is
 * components/workspace/SystemRealityReportSection.tsx, which wraps this
 * in its own useEffect.
 *
 * Starts a REAL `setInterval` (never a mocked/fake timer) that invokes
 * `fetchFn` every `intervalMs`. Returns a real teardown function that
 * clears the interval — the caller's useEffect cleanup, or a test,  calls
 * this on unmount/teardown so no timer ever outlives its owner.
 */
export function startSystemRealityPolling(
  fetchFn: () => void | Promise<void>,
  intervalMs: number = SYSTEM_REALITY_POLL_INTERVAL_MS,
): () => void {
  const id = setInterval(() => {
    void fetchFn();
  }, intervalMs);
  return () => clearInterval(id);
}
