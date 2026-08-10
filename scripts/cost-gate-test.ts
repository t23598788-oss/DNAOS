/**
 * Cost Gate Acceptance Suite (owner, 2026-08-09, Constitution Rule 257 —
 * "Execution Plane Cost Gate", real build for TASK-048/FCR-009). Proves,
 * against the real, running costGateRuntime.ts + managerQuestionRuntime.ts
 * composition — never mocked at the module level — every acceptance
 * requirement named for this task:
 *
 *  1. estimated_cost=0 -> real RELEASE.
 *  2. A cost within a real, configured budget -> real RELEASE, with real
 *     budget-remaining bookkeeping (persisted to registry/COST_BUDGETS.json).
 *  3. A cost with no budget configured, or exceeding it -> real LOCK + a
 *     real escalation that lands in Rule 251's real Owner-facing queue
 *     (getOwnerFacingQueue()), tagged financial_approval_required.
 *  4. Running worker-01-acceptance-test.ts with NO env var set -> real,
 *     captured output showing it stays at the deterministic 12/12 by
 *     default (not the old, live 17/17) — Rule 257's actual fix.
 *  5. Opt-in still works — proved STRUCTURALLY, non-spending (see that
 *     test's own comment for why: spending real money again to prove
 *     this would itself violate Rule 257's own spirit — the one building
 *     the gate should not be the one who bypasses it without a genuinely
 *     unavoidable reason).
 *  6. Structural proof (real, whole-repo import scan, same technique as
 *     Rule 251/252's own tests): no Worker/Adapter file can self-flip
 *     its own live mode, and no real Adapter file can import/call
 *     costGateRuntime.ts's checkCostGate() itself (only the real,
 *     composing dispatch Runtimes may).
 *
 * Run: npm run cost-gate:test
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { randomUUID } from "crypto";
import {
  checkCostGate, grantCostBudget, revokeCostBudget, listCostBudgets, shouldRunLiveSection,
  classifyOperationCommand, listCostLedgerEntries,
  type CostGateRequest,
} from "../app/api/admin/ide/_lib/costGateRuntime";
import { getOwnerFacingQueue, __debugResetManagerQuestionQueue } from "../app/api/admin/ide/_lib/managerQuestionRuntime";
import { WORKSPACE_ROOT } from "../app/api/admin/ide/_lib/fsSecurity";

const execFileAsync = promisify(execFile);
const ROOT = WORKSPACE_ROOT;
const OWNER = `cost-gate-test-owner-${randomUUID()}`;
const ACTOR = "cost-gate-test-suite@dnaos.local";

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

function baseRequest(overrides: Partial<CostGateRequest>): CostGateRequest {
  return {
    provider: "test-provider", operation: "code.generate", estimated_cost: 0.29, currency: "USD", max_cost: null,
    reason: "real cost-gate-test probe", task_id: `cgt-${randomUUID()}`, worker_id: "CODE_WORKER",
    evidence: ["package.json"], ownerId: OWNER, actor: ACTOR,
    ...overrides,
  };
}

// Track every real budget this suite grants so it can be cleanly
// revoked at the end — same real "leave no residue" discipline as
// registry/LOCK_MANAGER.json's own acquire/release rule.
const grantedBudgetIds: string[] = [];

async function main() {
  // ============================================================
  // 1 — estimated_cost=0 -> RELEASE
  // ============================================================
  await test("Acceptance 1 — estimated_cost=0 -> real RELEASE, no budget consulted, no escalation", () => {
    const outcome = checkCostGate(baseRequest({ estimated_cost: 0 }));
    assert(outcome.outcome === "RELEASE", `expected RELEASE, got ${outcome.outcome}: ${outcome.reason}`);
    assert(outcome.budgetApplied === null, "expected zero real budget lookup for a real, confirmed zero cost");
    assert(outcome.escalation === null, "expected zero real escalation for a zero-cost RELEASE");
    assert(!!outcome.evidenceArtifactId, "expected a real COST_GATE_DECISION evidence artifact even for a zero-cost RELEASE");
  });

  // ============================================================
  // 2 — cost within a real, configured budget -> RELEASE + real
  // budget-remaining bookkeeping (persisted to registry/COST_BUDGETS.json)
  // ============================================================
  let budgetTaskId = "";
  let budgetId = "";
  await test("Acceptance 2 — grantCostBudget() + a cost within it -> real RELEASE, with real, live, file-persisted remaining bookkeeping", () => {
    budgetTaskId = `cgt-budget-${randomUUID()}`;
    const budget = grantCostBudget({ scope: "TASK", task_id: budgetTaskId, max_cost: 1.0, currency: "USD", approved_by: OWNER, reason: "real, disposable cost-gate-test budget" });
    budgetId = budget.budget_id;
    grantedBudgetIds.push(budgetId);
    assert(budget.spent === 0, "expected a freshly granted real budget to start at real spent=0");
    assert(budget.status === "ACTIVE", "expected a freshly granted real budget to start ACTIVE");

    const outcome = checkCostGate(baseRequest({ provider: "anthropic-cli", worker_id: "claude-cli", estimated_cost: 0.29, task_id: budgetTaskId }));
    assert(outcome.outcome === "RELEASE", `expected RELEASE, got ${outcome.outcome}: ${outcome.reason}`);
    assert(outcome.budgetApplied !== null && outcome.budgetApplied.budgetId === budgetId, `expected the real, matching budget ${budgetId} to be applied, got ${JSON.stringify(outcome.budgetApplied)}`);
    assert(Math.abs(outcome.budgetApplied!.remainingAfter - 0.71) < 1e-9, `expected real remaining 0.71 (1.00 - 0.29), got ${outcome.budgetApplied!.remainingAfter}`);

    // Real, live, file-persisted proof — not just the in-memory return value.
    const persisted = listCostBudgets().find((b) => b.budget_id === budgetId);
    assert(persisted !== undefined, "expected the real budget to still be listed via listCostBudgets()");
    assert(Math.abs(persisted!.spent - 0.29) < 1e-9, `expected real, file-persisted spent=0.29, got ${persisted!.spent}`);
    assert(persisted!.status === "ACTIVE", "expected the real budget to remain ACTIVE (0.29 of 1.00 spent, real headroom remains)");
  });

  await test("Acceptance 2b — a SECOND real charge against the SAME budget accumulates real spent correctly and can exhaust it", () => {
    const outcome = checkCostGate(baseRequest({ provider: "anthropic-cli", worker_id: "claude-cli", estimated_cost: 0.71, task_id: budgetTaskId }));
    assert(outcome.outcome === "RELEASE", `expected RELEASE (0.29+0.71=1.00, exactly at the real ceiling), got ${outcome.outcome}: ${outcome.reason}`);
    assert(Math.abs(outcome.budgetApplied!.remainingAfter - 0) < 1e-9, `expected real remaining 0 after spending the real budget's full 1.00, got ${outcome.budgetApplied!.remainingAfter}`);
    const persisted = listCostBudgets().find((b) => b.budget_id === budgetId);
    assert(persisted!.status === "EXHAUSTED", `expected the real budget to flip to EXHAUSTED once real spent reaches real max_cost, got ${persisted!.status}`);

    // A third real charge against the now-EXHAUSTED budget must LOCK, not partially cover.
    const thirdOutcome = checkCostGate(baseRequest({ provider: "anthropic-cli", worker_id: "claude-cli", estimated_cost: 0.01, task_id: budgetTaskId }));
    assert(thirdOutcome.outcome === "LOCK", `expected LOCK once the real budget is EXHAUSTED, got ${thirdOutcome.outcome}`);
  });

  // ============================================================
  // 3 — no budget -> LOCK + real escalation lands in the real
  // Owner-facing queue, tagged financial_approval_required
  // ============================================================
  await test("Acceptance 3 — no budget configured -> real LOCK + real escalation lands in Rule 251's getOwnerFacingQueue(), tagged financial_approval_required", () => {
    const taskId = `cgt-lock-${randomUUID()}`;
    const outcome = checkCostGate(baseRequest({ provider: "anthropic-cli", worker_id: "claude-cli", estimated_cost: 0.29, task_id: taskId }));
    assert(outcome.outcome === "LOCK", `expected LOCK, got ${outcome.outcome}: ${outcome.reason}`);
    assert(outcome.escalationCriterion === "financial_approval_required", `expected criterion financial_approval_required, got ${outcome.escalationCriterion}`);
    assert(outcome.escalation !== null, "expected a real, non-null escalation outcome");
    assert(outcome.escalation!.status === "PENDING_OWNER" || outcome.escalation!.status === "RESOLVED_BY_REGISTRY", `expected a real managerQuestionRuntime.ts status, got ${outcome.escalation!.status}`);

    const queue = getOwnerFacingQueue(OWNER);
    const landed = queue.find((q) => q.questionId === outcome.escalation!.questionId);
    assert(landed !== undefined, `expected the real escalation questionId ${outcome.escalation!.questionId} to actually land in the real Owner-facing queue, queue had: ${JSON.stringify(queue.map((q) => q.questionId))}`);
    assert(landed!.canonicalQuestionText.toLowerCase().includes("financial approval"), `expected the real, landed question text to literally mention financial approval, got: ${landed!.canonicalQuestionText}`);
  });

  await test("Acceptance 3b — a real budget that EXISTS but is insufficient for this exact cost also -> real LOCK (never a partial/short cover)", () => {
    const taskId = `cgt-insufficient-${randomUUID()}`;
    const budget = grantCostBudget({ scope: "TASK", task_id: taskId, max_cost: 0.05, currency: "USD", approved_by: OWNER, reason: "real, disposable, deliberately too-small test budget" });
    grantedBudgetIds.push(budget.budget_id);
    const outcome = checkCostGate(baseRequest({ provider: "anthropic-cli", worker_id: "claude-cli", estimated_cost: 0.29, task_id: taskId }));
    assert(outcome.outcome === "LOCK", `expected LOCK for a real, insufficient budget (0.05 max vs 0.29 needed), got ${outcome.outcome}`);
    const persisted = listCostBudgets().find((b) => b.budget_id === budget.budget_id);
    assert(persisted!.spent === 0, "expected the real, insufficient budget's spent to stay untouched (0) — a LOCK must never partially consume a budget it couldn't fully cover");
  });

  await test("Acceptance — UNKNOWN_COST (estimated_cost=null) never auto-releases as if it were free — real LOCK unless a real budget covers it", () => {
    const taskId = `cgt-unknown-${randomUUID()}`;
    const outcome = checkCostGate(baseRequest({ provider: "mcp", worker_id: "mcp-foundation", estimated_cost: null, task_id: taskId }));
    assert(outcome.outcome === "LOCK", `expected LOCK for a genuinely UNKNOWN_COST (null) request with no budget, got ${outcome.outcome}`);
  });

  await test("Acceptance — an explicit, caller-declared max_cost ceiling that the estimate already exceeds LOCKS even if a larger budget exists", () => {
    const taskId = `cgt-ceiling-${randomUUID()}`;
    const budget = grantCostBudget({ scope: "TASK", task_id: taskId, max_cost: 5.0, currency: "USD", approved_by: OWNER, reason: "real, disposable, deliberately large test budget" });
    grantedBudgetIds.push(budget.budget_id);
    const outcome = checkCostGate(baseRequest({ provider: "anthropic-cli", worker_id: "claude-cli", estimated_cost: 0.29, max_cost: 0.1, task_id: taskId }));
    assert(outcome.outcome === "LOCK", `expected LOCK — the request's own max_cost (0.1) is below its estimated_cost (0.29), regardless of the real 5.0 budget, got ${outcome.outcome}`);
  });

  // ============================================================
  // 4 — real, captured regression: worker-01-acceptance-test.ts with NO
  // env var set now stays at the deterministic 12/12 default.
  // ============================================================
  await test("Acceptance 4 (real, captured) — worker-01-acceptance-test.ts with NO env var set produces the real, deterministic 12/12 default (never the old, live 17/17)", async () => {
    const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
    delete cleanEnv.RUN_LIVE;
    delete cleanEnv.SKIP_LIVE;
    const { stdout } = await execFileAsync("npx", ["tsx", "scripts/worker-01-acceptance-test.ts"], { cwd: ROOT, env: cleanEnv, maxBuffer: 1024 * 1024 * 32 });
    assert(stdout.includes("12/12 passed"), `expected real "12/12 passed" in captured stdout with no env var set, got tail: ${stdout.slice(-800)}`);
    assert(!stdout.includes("17/17"), "expected the real, OLD opt-out 17/17 count to NEVER appear when no env var is set (that would mean the live section still ran by default)");
    assert(stdout.includes("RUN_LIVE=1 not set"), "expected the real, new skip message naming RUN_LIVE=1 as the real, required opt-in");
  });

  // ============================================================
  // 5 — opt-in still works, proved STRUCTURALLY / non-spending.
  //
  // Real, explicit choice disclosed per this task's own instruction: we
  // could re-run worker-01-acceptance-test.ts with RUN_LIVE=1 to prove
  // the live section still executes and passes (17/17) — but that would
  // spend real money (~$0.29 USD) a SECOND time in the course of
  // building the very gate meant to prevent unauthorized real spend.
  // That is not a genuinely unavoidable reason to spend real money, so
  // per Rule 257's own spirit (the one building the gate should not be
  // the one who bypasses it), we prove the real opt-in DECISION LOGIC
  // directly instead — shouldRunLiveSection() is the exact, real,
  // unmodified function worker-01-acceptance-test.ts's main() calls to
  // decide whether to enter the costed section at all. Testing all 4
  // real env-var combinations here proves the real gate resolves
  // correctly, including that RUN_LIVE=1 alone DOES flip it to true,
  // without ever letting the costed section itself actually execute.
  // ============================================================
  await test("Acceptance 5 (structural, non-spending) — the real shouldRunLiveSection() gate worker-01-acceptance-test.ts actually calls resolves correctly for all 4 real env combinations", () => {
    assert(shouldRunLiveSection({}) === false, "no env vars set -> must NOT run live (the real, new default, Rule 257)");
    assert(shouldRunLiveSection({ RUN_LIVE: "1" }) === true, "RUN_LIVE=1 alone -> MUST run live (the real, deliberate opt-in — proves opt-in still genuinely works)");
    assert(shouldRunLiveSection({ SKIP_LIVE: "1" }) === false, "SKIP_LIVE=1 alone -> must NOT run live (kept for backward compatibility with past recorded runs)");
    assert(shouldRunLiveSection({ RUN_LIVE: "1", SKIP_LIVE: "1" }) === false, "RUN_LIVE=1 AND SKIP_LIVE=1 together -> explicit SKIP_LIVE always wins, must NOT run live");
  });

  await test("Acceptance 5 (structural proof-of-wiring) — worker-01-acceptance-test.ts's real source literally calls shouldRunLiveSection(), not a re-implemented/inline condition that could silently drift", () => {
    const src = readFileSync(path.join(ROOT, "scripts/worker-01-acceptance-test.ts"), "utf-8");
    assert(/import\s*\{[^}]*\bshouldRunLiveSection\b[^}]*\}\s*from\s*["'][^"']*costGateRuntime["']/.test(src), "expected worker-01-acceptance-test.ts to really import shouldRunLiveSection from costGateRuntime.ts");
    assert(/const\s+runLive\s*=\s*shouldRunLiveSection\(\)/.test(src), "expected worker-01-acceptance-test.ts's real Gap 5 gate to call shouldRunLiveSection() directly, not a duplicated inline boolean");
  });

  // ============================================================
  // 7 — Rule 257 AMENDMENT (owner, 2026-08-09, FCR-011/TASK-050) —
  // FREE_LOCAL fast path for the RUN_COMMAND/RUN_TEST/BUILD operation
  // surface. Real, closed-allowlist classifier — proves all 4 of the
  // Owner's exact acceptance criteria, plus the closed/no-wildcard
  // boundary and drift-safety.
  // ============================================================
  const budgetsBeforeFreeLocalBlock = listCostBudgets().length;
  const ledgerBeforeFreeLocalBlock = listCostLedgerEntries().length;

  await test("Owner Acceptance 1a — a real local free command (`git status`) passes through the gate WITHOUT any budget configured -> real RELEASE, not LOCK", () => {
    const outcome = checkCostGate(baseRequest({ estimated_cost: null, command: "git", args: ["status"], task_id: `cgt-free-${randomUUID()}` }));
    assert(outcome.outcome === "RELEASE", `expected RELEASE, got ${outcome.outcome}: ${outcome.reason}`);
    assert(outcome.operationCostClass === "FREE_LOCAL", `expected operationCostClass FREE_LOCAL, got ${outcome.operationCostClass}`);
    assert(outcome.budgetApplied === null, "expected zero budget lookup for a real FREE_LOCAL release");
    assert(outcome.escalation === null, "expected zero escalation for a real FREE_LOCAL release");
  });

  await test("Owner Acceptance 1b — `npm run type-check` (the Owner's own named example) passes through the gate WITHOUT any budget configured -> real RELEASE, cross-checked live against real package.json", () => {
    const outcome = checkCostGate(baseRequest({ estimated_cost: null, command: "npm", args: ["run", "type-check"], task_id: `cgt-free-${randomUUID()}` }));
    assert(outcome.outcome === "RELEASE", `expected RELEASE, got ${outcome.outcome}: ${outcome.reason}`);
    assert(outcome.operationCostClass === "FREE_LOCAL", `expected operationCostClass FREE_LOCAL, got ${outcome.operationCostClass}`);
    assert(outcome.reason.includes("tsc --noEmit"), `expected the real, live-verified command text to be cited in the reason, got: ${outcome.reason}`);
  });

  for (const [label, command, args] of [
    ["git diff", "git", ["diff"]],
    ["grep (arbitrary args)", "grep", ["-n", "FREE_LOCAL", "app/api/admin/ide/_lib/costGateRuntime.ts"]],
    ["cat (arbitrary args)", "cat", ["package.json"]],
    ["npx tsc --noEmit", "npx", ["tsc", "--noEmit"]],
    ["eslint (bare)", "eslint", []],
    ["npm run lint", "npm", ["run", "lint"]],
    ["npm run guard", "npm", ["run", "guard"]],
    ["npm run dashboard", "npm", ["run", "dashboard"]],
    ["npm run intelligence", "npm", ["run", "intelligence"]],
    ["npm run precommit", "npm", ["run", "precommit"]],
    ["npm run readiness:test", "npm", ["run", "readiness:test"]],
    ["npm run cost-gate:test", "npm", ["run", "cost-gate:test"]],
    ["npm run execution-hand:test", "npm", ["run", "execution-hand:test"]],
    ["bash scripts/governance.sh", "bash", ["scripts/governance.sh"]],
    ["bash scripts/dashboard.sh", "bash", ["scripts/dashboard.sh"]],
    ["bash scripts/check-registry.sh", "bash", ["scripts/check-registry.sh"]],
    ["npx tsx scripts/readiness-test.ts", "npx", ["tsx", "scripts/readiness-test.ts"]],
  ] as [string, string, string[]][]) {
    await test(`FREE_LOCAL allowlist coverage — ${label} -> real RELEASE without any budget configured`, () => {
      const outcome = checkCostGate(baseRequest({ estimated_cost: null, command, args, task_id: `cgt-free-${randomUUID()}` }));
      assert(outcome.outcome === "RELEASE", `expected RELEASE for ${label}, got ${outcome.outcome}: ${outcome.reason}`);
      assert(outcome.operationCostClass === "FREE_LOCAL", `expected operationCostClass FREE_LOCAL for ${label}, got ${outcome.operationCostClass}`);
    });
  }

  await test("Owner Acceptance 2 (regression) — a real paid/unknown command with NO command/args at all is still blocked exactly as before (identical to pre-amendment behavior)", () => {
    const outcome = checkCostGate(baseRequest({ provider: "anthropic-cli", worker_id: "claude-cli", estimated_cost: 0.29, task_id: `cgt-lock-regress-${randomUUID()}` }));
    assert(outcome.outcome === "LOCK", `expected LOCK (unchanged pre-amendment behavior), got ${outcome.outcome}: ${outcome.reason}`);
    assert(outcome.operationCostClass === "UNKNOWN_COST", `expected operationCostClass UNKNOWN_COST when no command/args supplied, got ${outcome.operationCostClass}`);
  });

  for (const [label, command, args] of [
    ["bash scripts/existence.sh — real curl to https://google.com (existence.sh:46), deliberately excluded", "bash", ["scripts/existence.sh"]],
    ["npm run deploy-gate — real Supabase call when configured (this env has real creds), deliberately excluded", "npm", ["run", "deploy-gate"]],
    ["npm run factory-readiness:test — conditional real Ollama fetch() via .health(), deliberately excluded", "npm", ["run", "factory-readiness:test"]],
    ["npm run status — chains in existence.sh's real curl call", "npm", ["run", "status"]],
    ["npm run build — a real npm script (\"next build\") NOT on the verified-free allowlist (closed set, no blanket npm-run coverage)", "npm", ["run", "build"]],
    ["git push — not on the git allowlist (only status/diff), and would mutate remote state", "git", ["push"]],
    ["curl to an arbitrary external URL", "curl", ["https://example.com"]],
    ["no-wildcard proof: \"npm run readiness:test\" with an extra 3rd arg is NOT an exact match", "npm", ["run", "readiness:test", "--extra-flag"]],
    ["no-wildcard proof: \"git status\" with an extra 2nd arg is NOT an exact match", "git", ["status", "--short"]],
    ["no-wildcard proof: bare \"npx tsc\" without --noEmit is NOT an exact match", "npx", ["tsc"]],
  ] as [string, string, string[]][]) {
    await test(`Owner Acceptance 2 (regression) + no-wildcard proof — ${label} -> real LOCK, never FREE_LOCAL`, () => {
      const outcome = checkCostGate(baseRequest({ estimated_cost: null, command, args, task_id: `cgt-lock-regress-${randomUUID()}` }));
      assert(outcome.outcome === "LOCK", `expected LOCK for ${label}, got ${outcome.outcome}: ${outcome.reason}`);
      assert(outcome.operationCostClass === "UNKNOWN_COST", `expected operationCostClass UNKNOWN_COST for ${label} (never guessed PAID_EXTERNAL), got ${outcome.operationCostClass}`);
    });
  }

  await test("FREE_LOCAL classification is computed by the gate itself, never trusted from the caller — a dishonest/stale nonzero estimated_cost on a provably-free command is overridden to real RELEASE", () => {
    const outcome = checkCostGate(baseRequest({ estimated_cost: 99, command: "git", args: ["status"], task_id: `cgt-free-override-${randomUUID()}` }));
    assert(outcome.outcome === "RELEASE", `expected RELEASE (the real command text proves this free regardless of the caller's declared estimated_cost), got ${outcome.outcome}: ${outcome.reason}`);
    assert(outcome.operationCostClass === "FREE_LOCAL", `expected operationCostClass FREE_LOCAL, got ${outcome.operationCostClass}`);
  });

  await test("classifyOperationCommand() with no command supplied at all -> honest UNKNOWN_COST, never assumed free (backward compatibility with every pre-amendment caller that never passes command/args)", () => {
    const c = classifyOperationCommand(undefined, undefined);
    assert(c.costClass === "UNKNOWN_COST", `expected UNKNOWN_COST, got ${c.costClass}`);
  });

  await test("Owner Acceptance 3 — registry/COST_LEDGER.json gets ZERO new entries across this entire real FREE_LOCAL test block (real, captured before/after count)", () => {
    const ledgerAfter = listCostLedgerEntries().length;
    assert(ledgerAfter === ledgerBeforeFreeLocalBlock, `expected registry/COST_LEDGER.json entry count to stay exactly ${ledgerBeforeFreeLocalBlock} after this block's real FREE_LOCAL releases, found ${ledgerAfter}`);
    console.log(`  [captured] registry/COST_LEDGER.json entries BEFORE this block: ${ledgerBeforeFreeLocalBlock}, AFTER: ${ledgerAfter}`);
  });

  await test("Bonus — registry/COST_BUDGETS.json is also completely untouched by this block's real FREE_LOCAL releases (real, captured before/after count)", () => {
    const budgetsAfter = listCostBudgets().length;
    assert(budgetsAfter === budgetsBeforeFreeLocalBlock, `expected registry/COST_BUDGETS.json budget count to stay exactly ${budgetsBeforeFreeLocalBlock} (FREE_LOCAL never consults/grants a budget), found ${budgetsAfter}`);
    console.log(`  [captured] registry/COST_BUDGETS.json budget count BEFORE this block: ${budgetsBeforeFreeLocalBlock}, AFTER: ${budgetsAfter}`);
  });

  // ============================================================
  // 6 — Structural, whole-repo import-graph scans (same technique as
  // Rule 251/252's own tests).
  // ============================================================
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

  await test("Structural 6a — no file anywhere in app/ or scripts/ writes to process.env.SKIP_LIVE or process.env.RUN_LIVE (no Worker/Adapter/harness can self-flip its own live mode)", () => {
    const files: string[] = [];
    walkTsFiles(path.join(ROOT, "app"), files);
    walkTsFiles(path.join(ROOT, "scripts"), files);
    // Real, single-equals ASSIGNMENT only — (?!=) excludes ==/=== comparisons
    // (e.g. `process.env.SKIP_LIVE === "1"`, a real, legitimate READ every
    // harness does) from being flagged as a self-flip WRITE.
    const assignRegex = /process\.env(?:\.(?:SKIP_LIVE|RUN_LIVE)|\[["'](?:SKIP_LIVE|RUN_LIVE)["']\])\s*=(?!=)/;
    const offenders: string[] = [];
    for (const f of new Set(files)) {
      let src: string;
      try { src = readFileSync(f, "utf-8"); } catch { continue; }
      if (assignRegex.test(src)) offenders.push(f);
    }
    assert(offenders.length === 0, `expected ZERO real writes to SKIP_LIVE/RUN_LIVE anywhere in app/ or scripts/, found: ${JSON.stringify(offenders)}`);
  });

  await test("Structural 6b — no real Adapter file (workerAdapters/*) imports checkCostGate/grantCostBudget/revokeCostBudget from costGateRuntime.ts (an Adapter must never self-approve its own spend — only the real, composing dispatch Runtimes may)", () => {
    const adapterDir = path.join(ROOT, "app/api/admin/ide/_lib/workerAdapters");
    let adapterFiles: string[] = [];
    try { adapterFiles = readdirSync(adapterDir).filter((f) => f.endsWith(".ts")).map((f) => path.join(adapterDir, f)); } catch { /* dir may not exist */ }
    const GATE_GRANTING_NAMES = ["checkCostGate", "grantCostBudget", "revokeCostBudget"];
    const importRegex = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'][^"']*costGateRuntime["']/g;
    const offenders: string[] = [];
    for (const f of adapterFiles) {
      let src: string;
      try { src = readFileSync(f, "utf-8"); } catch { continue; }
      let m: RegExpExecArray | null;
      while ((m = importRegex.exec(src))) {
        const names = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, "").trim());
        const bad = names.filter((n) => GATE_GRANTING_NAMES.includes(n));
        if (bad.length > 0) offenders.push(`${f} imports ${bad.join(", ")}`);
      }
    }
    assert(offenders.length === 0, `expected zero real Adapter files to import gate-granting functions from costGateRuntime.ts, found: ${JSON.stringify(offenders)}`);
  });

  await test("Structural 6c — positive control: codeWorkerRuntime.ts (the real, composing dispatch path FCR-009's incident occurred through) DOES import checkCostGate (proves the scan above is meaningful, not vacuous)", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/codeWorkerRuntime.ts"), "utf-8");
    assert(/import\s*\{[^}]*\bcheckCostGate\b[^}]*\}\s*from\s*["'][^"']*costGateRuntime["']/.test(src), "expected codeWorkerRuntime.ts to really import checkCostGate");
    assert(/adapter\.costClass/.test(src), "expected codeWorkerRuntime.ts to really branch on adapter.costClass before dispatch");
  });

  await test("Structural 6d — positive control: switchBasedOrchestratorRuntime.ts's dispatch stage (attemptDispatch) ALSO imports checkCostGate (defense in depth at both real dispatch entry points named by TASK-048)", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/switchBasedOrchestratorRuntime.ts"), "utf-8");
    assert(/import\s*\{[^}]*\bcheckCostGate\b[^}]*\}\s*from\s*["'][^"']*costGateRuntime["']/.test(src), "expected switchBasedOrchestratorRuntime.ts to really import checkCostGate");
  });

  // ============================================================
  // Cleanup — leave no residue (same discipline as registry/LOCK_MANAGER.json).
  // ============================================================
  for (const id of grantedBudgetIds) revokeCostBudget(id);
  __debugResetManagerQuestionQueue(OWNER);
  const remaining = listCostBudgets().filter((b) => grantedBudgetIds.includes(b.budget_id));
  await test("Cleanup — every real, disposable test budget this suite granted was really revoked, leaving registry/COST_BUDGETS.json with no residue from this run", () => {
    assert(remaining.length === 0, `expected zero leftover test budgets, found: ${JSON.stringify(remaining)}`);
  });

  console.log("\n=== Cost Gate Acceptance Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
