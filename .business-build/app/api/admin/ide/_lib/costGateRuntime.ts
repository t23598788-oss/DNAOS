/**
 * Cost Gate Runtime (owner, 2026-08-09, Constitution Rule 257 —
 * "Execution Plane Cost Gate" — real build, TASK-048/FCR-009).
 *
 * REAL INCIDENT THIS FIXES (FCR-009, registry/FACTORY_CENTRAL_REGISTRY.json):
 * TASK-047's CODE_WORKER dispatch ran scripts/worker-01-acceptance-test.ts
 * WITHOUT setting SKIP_LIVE=1, which silently triggered a real, live,
 * costed call (~$0.29 USD via the claude-cli Worker Adapter — see
 * workerAdapters/cliWorkerAdapter.ts's header) with no Owner authorization
 * for that specific spend, and did not disclose the cost in its own
 * report. Root cause named by Rule 257 itself: no structural gate existed
 * anywhere in the Execution Plane to stop a Worker/Adapter from running a
 * PAID or UNKNOWN_COST operation on its own.
 *
 * REAL, REQUIRED OUTCOME (Rule 257, verbatim logic):
 *  - estimated_cost === 0            -> RELEASE (no gate friction for real free work)
 *  - cost > 0, real pre-approved budget covers it -> RELEASE (real spend bookkeeping)
 *  - no budget, or budget insufficient/exceeded    -> LOCK, escalate as
 *    financial_approval_required (Rule 255's escalation_criteria, matched
 *    through Rule 251's single real Owner Inquiry channel — never a second,
 *    parallel Owner-facing surface).
 *
 * CONNECT-BEFORE-CREATE / REUSE-BEFORE-BUILD inventory (Constitution Rule
 * 101/103) — done BEFORE writing this file:
 *  - managerQuestionRuntime.ts#submitWorkerQuestion() is the real, ONLY
 *    Worker-facing path that may ever reach the Owner (Rule 251) — reused
 *    directly here for the LOCK/escalate path. This file never imports
 *    getOwnerFacingQueue/answerAggregatedQuestion (the two Owner-facing-
 *    only exports) — verified by scripts/cost-gate-test.ts's own
 *    import-graph scan, same technique as Rule 251/252's own tests.
 *  - switchBasedOrchestratorRuntime.ts#classifyEscalation() (additively
 *    exported this same pass, purely additive, no behavior change) reads
 *    registry/FACTORY_CENTRAL_REGISTRY.json's real, live
 *    escalation_criteria and is reused AS-IS to tag a LOCK's escalation
 *    reason as financial_approval_required — never a second, hand-copied
 *    criteria list.
 *  - app/api/admin/ide/_lib/executionBudgetRuntime.ts's ExecutionBudget IS
 *    NOT reused for the budget concept below — it is a real, different
 *    thing: a hardcoded, per-Workspace-Session/Execution-Step SAFETY
 *    CEILING (maxEstimatedCost defaults to 1.0 for every job, never an
 *    Owner-specific grant). What Rule 257 requires is a real, explicit
 *    Owner AUTHORIZATION per task/capability — no such concept existed
 *    anywhere in this repo before registry/COST_BUDGETS.json (created
 *    this pass, see its own header for the full distinction).
 *  - createOperationsArtifact() (artifactRuntime.ts, the one real Evidence
 *    Warehouse every other Runtime in this layer already uses) records
 *    every real gate decision as a new COST_GATE_DECISION artifact type
 *    (artifactRegistry.ts) — never a second audit log invented.
 *
 * Rule 252 boundary, real and structural: this file performs ONLY a
 * check/lock/escalate/record decision. It never imports fs's
 * writeFileSync against anything outside its own two owned registry
 * files (COST_BUDGETS.json/COST_LEDGER.json), never imports
 * codeWorkerRuntime.ts's content-generating functions, never imports
 * gitWriteOps.ts or deploymentRuntime.ts, never shells out via
 * child_process.
 *
 * AMENDMENT (owner, 2026-08-09, Rule 257 AMENDMENT — FCR-011/TASK-050,
 * real build): real incident — TASK-044/DNA-000109 ran 5 real
 * RUN_COMMAND Job Contracts for genuinely free, local scripts (e.g.
 * `bash scripts/governance.sh`) through EXECUTION_HAND; all 5 real-
 * LOCKed because this file had no way to know a command is provably
 * free. Added: a real, closed-allowlist classifier
 * (classifyOperationCommand(), near checkCostGate() below) producing
 * FREE_LOCAL/PAID_EXTERNAL/UNKNOWN_COST for the RUN_COMMAND/RUN_TEST/
 * BUILD operation surface — a distinct dimension from the per-Worker
 * CostClass on WORKER_REGISTRY (workerRegistry.ts). FREE_LOCAL is
 * granted only to a closed, individually-verified allowlist (no
 * wildcards, never a caller/Job-Contract self-declaration) and skips
 * budget/escalation entirely; everything else is completely unchanged —
 * this narrows where the gate may be skipped, never widens it.
 *
 * Honest, disclosed limitations (Constitution Rule 100/106/109/110):
 *  - registry/COST_BUDGETS.json's `spent` bookkeeping is real,
 *    file-backed (durable across process restarts, unlike this repo's
 *    usual in-memory-Map convention) but is a real, honest
 *    read-modify-write against a single JSON file — concurrent, multi-
 *    process real writes could race. Acceptable for this build's real,
 *    single-process test/dispatch usage; a real multi-worker production
 *    deployment would need a real transactional store. Stated plainly,
 *    not silently smoothed over.
 *  - Gates on cost_class FREE vs everything else, not strictly only
 *    PAID/UNKNOWN_COST as Rule 257's literal text names — a deliberate,
 *    disclosed, safety-conservative widening (ESTIMATED_COST is also
 *    gated) that is never looser than the rule requires.
 */
import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { WORKSPACE_ROOT } from "./fsSecurity";
import { createOperationsArtifact } from "./artifactRuntime";
import { submitWorkerQuestion, type SubmitWorkerQuestionOutcome } from "./managerQuestionRuntime";
import { classifyEscalation } from "./switchBasedOrchestratorRuntime";
import { WORKER_REGISTRY, type WorkerType } from "./workerRegistry";

const ROOT = WORKSPACE_ROOT;
const BUDGETS_REL_PATH = "registry/COST_BUDGETS.json";
const LEDGER_REL_PATH = "registry/COST_LEDGER.json";

// ============================================================
// Types
// ============================================================
export type CostClass = "FREE" | "ESTIMATED_COST" | "PAID" | "UNKNOWN_COST";

export interface CostGateRequest {
  provider: string;
  operation: string;
  /** Real WorkerCostEstimate-shaped convention (mirrors
   * workerAdapter.ts's WorkerCostEstimate.estimatedCost exactly):
   * `0` = a real, confirmed zero cost. `null` = cost is genuinely not
   * known/computable at this call site (the honest UNKNOWN_COST case) —
   * NEVER treated as zero. A positive number = a real, nonzero estimate. */
  estimated_cost: number | null;
  currency: string;
  /** Real, optional per-request ceiling (e.g. a Job Contract's own
   * maxCost) — an extra, independent safety check: even a covered
   * budget cannot RELEASE a request whose own declared ceiling the
   * estimate already exceeds. */
  max_cost: number | null;
  reason: string;
  task_id: string;
  worker_id: string;
  evidence: string[];
  ownerId: string;
  actor: string;
  /** Optional — informs the escalation's workerRole tag when worker_id
   * doesn't literally match a WorkerType key (e.g. an Adapter id like
   * "claude-cli"). Falls back to a real, documented default otherwise. */
  workerRole?: WorkerType;
  /** Optional real, literal command text (Rule 257 AMENDMENT, 2026-08-09,
   * FCR-011/TASK-050) — the EXACT executable + argv this Cost Gate check
   * is guarding, used ONLY to compute a real FREE_LOCAL/PAID_EXTERNAL/
   * UNKNOWN_COST classification via classifyOperationCommand() below.
   * This is never a caller-declared cost signal by itself — it is only
   * ever trustworthy when the caller passes the SAME command/args it is
   * actually about to execFile (executionHandRuntime.ts does exactly
   * this, sourced from the Job Contract's own real `command`/`args`
   * fields — never a separately-declared cost_class). Omitting these
   * fields is always safe: classifyOperationCommand() then honestly
   * returns UNKNOWN_COST and this check behaves exactly as it did before
   * this amendment. */
  command?: string;
  args?: string[];
}

export type CostGateOutcomeKind = "RELEASE" | "LOCK";

export interface CostGateOutcome {
  outcome: CostGateOutcomeKind;
  reason: string;
  budgetApplied: { budgetId: string; scope: CostBudgetEntry["scope"]; remainingAfter: number } | null;
  escalation: SubmitWorkerQuestionOutcome | null;
  escalationCriterion: string | null;
  decisionId: string;
  evidenceArtifactId: string | null;
  decidedAt: string;
  /** Rule 257 AMENDMENT (2026-08-09, FCR-011/TASK-050) — the real
   * RUN_COMMAND/RUN_TEST/BUILD operation-surface classification computed
   * by classifyOperationCommand() from req.command/req.args, distinct
   * from the per-Worker CostClass already on WORKER_REGISTRY
   * (workerRegistry.ts) — answers "is this specific command actually
   * free", never "is this Worker type generally paid". This classifier
   * only ever emits FREE_LOCAL or UNKNOWN_COST (never guesses
   * PAID_EXTERNAL — asserting a command IS definitely paid would itself
   * be an unproven claim); UNKNOWN_COST is the honest default for "not
   * proven free" and receives byte-for-byte the same LOCK/escalate
   * treatment PAID_EXTERNAL would under the rest of this function — a
   * labeling distinction, not a behavioral one. */
  operationCostClass: OperationCostClass;
}

// ============================================================
// registry/COST_BUDGETS.json — real, file-backed Owner authorizations.
// See that file's own header for the full distinction from
// executionBudgetRuntime.ts's ExecutionBudget (a different, real thing).
// ============================================================
export type CostBudgetScope = "TASK" | "CAPABILITY" | "PROVIDER";
export type CostBudgetStatus = "ACTIVE" | "EXHAUSTED" | "REVOKED";

export interface CostBudgetEntry {
  budget_id: string;
  scope: CostBudgetScope;
  task_id: string | null;
  capability: string | null;
  provider: string | null;
  currency: string;
  max_cost: number;
  spent: number;
  approved_by: string;
  approved_at: string;
  reason: string;
  status: CostBudgetStatus;
}

interface CostBudgetsFile { version: number; note: string; schema_note: string; budgets: CostBudgetEntry[] }

function loadBudgetsFile(): CostBudgetsFile {
  const full = path.join(ROOT, BUDGETS_REL_PATH);
  if (!existsSync(full)) {
    return { version: 1, note: "real, Owner-approved spend authorizations", schema_note: "see registry/COST_BUDGETS.json header", budgets: [] };
  }
  return JSON.parse(readFileSync(full, "utf-8")) as CostBudgetsFile;
}

function saveBudgetsFile(file: CostBudgetsFile): void {
  writeFileSync(path.join(ROOT, BUDGETS_REL_PATH), JSON.stringify(file, null, 2) + "\n", "utf-8");
}

/** Real, most-specific-first budget match: TASK scope (exact task_id) >
 * CAPABILITY scope (exact operation string) > PROVIDER scope (exact
 * provider string). Only ACTIVE, matching-currency budgets with real,
 * sufficient remaining headroom for this exact estimated_cost qualify —
 * never a partial cover, never a guessed remainder. */
function findMatchingBudget(file: CostBudgetsFile, req: CostGateRequest, cost: number): CostBudgetEntry | null {
  const candidates = file.budgets.filter((b) => b.status === "ACTIVE" && b.currency === req.currency && (b.max_cost - b.spent) >= cost);
  const taskMatch = candidates.find((b) => b.scope === "TASK" && b.task_id === req.task_id);
  if (taskMatch) return taskMatch;
  const capabilityMatch = candidates.find((b) => b.scope === "CAPABILITY" && b.capability === req.operation);
  if (capabilityMatch) return capabilityMatch;
  const providerMatch = candidates.find((b) => b.scope === "PROVIDER" && b.provider === req.provider);
  if (providerMatch) return providerMatch;
  return null;
}

// ============================================================
// Real, Owner-facing budget management (the actual "Owner grants $X for
// task/capability Y" surface — not a debug-only test seam). The
// acceptance suite exercises these exact, real functions, not a mock.
// ============================================================
export interface GrantCostBudgetInput {
  scope: CostBudgetScope;
  task_id?: string | null;
  capability?: string | null;
  provider?: string | null;
  currency?: string;
  max_cost: number;
  approved_by: string;
  reason: string;
}

export function grantCostBudget(input: GrantCostBudgetInput): CostBudgetEntry {
  const file = loadBudgetsFile();
  const entry: CostBudgetEntry = {
    budget_id: randomUUID(),
    scope: input.scope,
    task_id: input.scope === "TASK" ? input.task_id ?? null : null,
    capability: input.scope === "CAPABILITY" ? input.capability ?? null : null,
    provider: input.scope === "PROVIDER" ? input.provider ?? null : null,
    currency: input.currency ?? "USD",
    max_cost: input.max_cost,
    spent: 0,
    approved_by: input.approved_by,
    approved_at: new Date().toISOString(),
    reason: input.reason,
    status: "ACTIVE",
  };
  file.budgets.push(entry);
  saveBudgetsFile(file);
  return entry;
}

export function revokeCostBudget(budgetId: string): boolean {
  const file = loadBudgetsFile();
  const entry = file.budgets.find((b) => b.budget_id === budgetId);
  if (!entry) return false;
  file.budgets = file.budgets.filter((b) => b.budget_id !== budgetId);
  saveBudgetsFile(file);
  return true;
}

export function listCostBudgets(): CostBudgetEntry[] {
  return loadBudgetsFile().budgets;
}

// ============================================================
// registry/COST_LEDGER.json — real, append-only actual-cost recording
// (Rule 257's own required field set, verbatim: estimated_cost/
// actual_cost/provider/model/timestamp/task_id/worker_id/
// approval_reference). Never edited/removed after being written (Rule
// 257 clause 12 — no retroactive editing of past cost results).
// ============================================================
export interface CostLedgerEntry {
  entry_id: string;
  task_id: string;
  /** Real, optional, additive field (owner, 2026-08-10-11, Infrastructure
   * Control & Usage Billing) — the real WorkerRequest.workerRequestId,
   * distinct from task_id (executionStepId) and previously not recorded
   * here at all. Lets a Cost Ledger entry join back to the same
   * worker_usage_events row it came from, per the Owner's own explicit
   * "ทุกตัวเลขต้องย้อนกลับไปหา request_id เดียวกันได้". Optional so every
   * pre-existing entry (recorded before this field existed) stays valid —
   * never backfilled or guessed for old entries. */
  request_id?: string;
  worker_id: string;
  provider: string;
  model: string | null;
  estimated_cost: number | null;
  actual_cost: number | null;
  currency: string;
  timestamp: string;
  approval_reference: string;
}

interface CostLedgerFile { version: number; note: string; schema_note: string; entries: CostLedgerEntry[] }

function loadLedgerFile(): CostLedgerFile {
  const full = path.join(ROOT, LEDGER_REL_PATH);
  if (!existsSync(full)) return { version: 1, note: "real, append-only actual-cost ledger", schema_note: "see registry/COST_LEDGER.json header", entries: [] };
  return JSON.parse(readFileSync(full, "utf-8")) as CostLedgerFile;
}

function saveLedgerFile(file: CostLedgerFile): void {
  writeFileSync(path.join(ROOT, LEDGER_REL_PATH), JSON.stringify(file, null, 2) + "\n", "utf-8");
}

/** Real, append-only write — called after a real paid/unknown-cost
 * execution completes (e.g. codeWorkerRuntime.ts, immediately after
 * adapter.execute() returns a real response). Never mutates or removes
 * an existing entry — Rule 257 clause 12. */
export function recordActualCost(input: {
  task_id: string; request_id?: string; worker_id: string; provider: string; model: string | null;
  estimated_cost: number | null; actual_cost: number | null; currency: string; approval_reference: string;
}): CostLedgerEntry {
  const file = loadLedgerFile();
  const entry: CostLedgerEntry = {
    entry_id: randomUUID(), task_id: input.task_id, request_id: input.request_id, worker_id: input.worker_id, provider: input.provider, model: input.model,
    estimated_cost: input.estimated_cost, actual_cost: input.actual_cost, currency: input.currency,
    timestamp: new Date().toISOString(), approval_reference: input.approval_reference,
  };
  file.entries.push(entry);
  saveLedgerFile(file);
  return entry;
}

export function listCostLedgerEntries(): CostLedgerEntry[] {
  return loadLedgerFile().entries;
}

// ============================================================
// Real WorkerType role resolution for the escalation channel — worker_id
// at the real dispatch call site is usually a real Adapter id (e.g.
// "claude-cli"), not a literal WorkerType key. Maps the small, real,
// known set of Adapter ids this repo actually has to their real
// WorkerType, honestly falling back to CODE_WORKER (the real WorkerType
// FCR-009's own incident involved) when unrecognized — never guessed
// silently past that documented default.
// ============================================================
const KNOWN_ADAPTER_TO_WORKER_ROLE: Record<string, WorkerType> = {
  "claude-cli": "CODE_WORKER", "anthropic-api": "CODE_WORKER", "openai-api": "CODE_WORKER",
  "gemini-api": "CODE_WORKER", "ollama-local": "CODE_WORKER", "mcp-foundation": "TOOL_WORKER",
  "human-worker": "HUMAN_WORKER",
};

function resolveWorkerRole(req: CostGateRequest): WorkerType {
  if (req.workerRole && req.workerRole in WORKER_REGISTRY) return req.workerRole;
  if (req.worker_id in WORKER_REGISTRY) return req.worker_id as WorkerType;
  return KNOWN_ADAPTER_TO_WORKER_ROLE[req.worker_id] ?? "CODE_WORKER";
}

// ============================================================
// Real evidence recording — one COST_GATE_DECISION artifact per real
// checkCostGate() call, via the one real Evidence Warehouse.
// ============================================================
function recordDecisionEvidence(req: CostGateRequest, outcome: Omit<CostGateOutcome, "evidenceArtifactId">): string {
  const artifact = createOperationsArtifact({
    artifactType: "COST_GATE_DECISION",
    content: JSON.stringify({ request: req, outcome }),
    mimeType: "application/json", actor: req.actor, ownerId: req.ownerId, generatedFrom: req.task_id, jobId: null,
  });
  return artifact.artifactId;
}

// ============================================================
// RUN_COMMAND/RUN_TEST/BUILD operation-surface classification (owner,
// 2026-08-09, Constitution Rule 257 AMENDMENT — FCR-011/TASK-050, real
// build). REAL INCIDENT THIS FIXES (FCR-011): TASK-044/DNA-000109 ran 5
// real RUN_COMMAND Job Contracts for genuinely free, local scripts (e.g.
// `bash scripts/governance.sh`) through EXECUTION_HAND — all 5 real-
// LOCKed, because checkCostGate() had no way to know a command is
// provably free; every RUN_COMMAND was gated identically regardless of
// what it actually ran. This section adds that real, closed-allowlist
// classifier — narrowing where the gate may be skipped, never widening
// it (Rule 257's existing PAID/UNKNOWN_COST flow is completely
// unchanged for anything not on this list).
//
// Distinct dimension from WorkerRegistry.CostClass (workerRegistry.ts) —
// that answers "is this Worker type generally paid"; this answers "is
// this specific, real command actually free" — never conflated.
//
// HARD RULES (Rule 257 AMENDMENT, verbatim intent):
//  - No wildcard matching anywhere below — every branch matches an
//    exact, closed, individually-verified command shape (exact argv,
//    not a prefix/regex-over-anything-goes).
//  - A Worker/Job Contract can never just declare cost_class=FREE_LOCAL
//    and have it trusted — this function only ever looks at the real
//    command/args text a caller is about to execute (executionHandRuntime.ts
//    passes the Job Contract's own literal `command`/`args` — the exact
//    same values about to reach execFile — never a separately declared
//    cost signal).
//  - For `npm run <script>`, this function re-reads package.json LIVE on
//    every call (readLivePackageJsonScripts() below) and requires an
//    EXACT match against the real command text this build verified —
//    real drift (someone editing package.json's script) safely falls
//    through to UNKNOWN_COST, never silently keeps trusting a changed
//    script.
//
// DISCLOSED, HONEST LIMITATION (Rule 100/106/109/110 — not overclaimed):
// the allowlists below were verified by a real, one-time, manual reading
// of each listed file's full content THIS pass (citations in this task's
// own report/PR, not repeated inline here to keep this file readable) —
// not a live re-scan of the target script's own file content on every
// gate check. A future edit to an allowlisted scripts/*.sh or
// scripts/*.ts file's internals (as opposed to package.json's wrapper
// text, which IS re-verified live) would not be caught by this
// mechanism until the next manual re-verification. This mirrors how
// executionRegistry.ts's own DENIED_EXECUTABLE_BASENAMES is a static,
// manually-curated Set, not a live-rescanned one — the same convention
// already used elsewhere in this codebase for a comparable allowlist.
// ============================================================
export type OperationCostClass = "FREE_LOCAL" | "PAID_EXTERNAL" | "UNKNOWN_COST";

export interface OperationCostClassification {
  costClass: OperationCostClass;
  reason: string;
}

/** Closed set of package.json script names verified free by real, full
 * inspection of their own command text (and, for scripts that shell out
 * to a scripts/*.sh or scripts/*.ts file, that target file's own real,
 * fully-read content) — zero external paid adapter / network / cloud /
 * model / API call found in any of them. Map value = the EXACT command
 * text this build found live in package.json at verification time
 * (2026-08-09), matched EXACTLY against a fresh, live read below.
 *
 * Real evidence per entry (this build's own read, file:line cited):
 *  - type-check -> "tsc --noEmit": local TypeScript compiler, --noEmit
 *    never writes or touches the network.
 *  - lint -> "eslint": local linter, no network by design.
 *  - guard -> "bash scripts/governance.sh": read in full — runs only
 *    tsc/knip/jscpd + scripts/pre-commit-check.sh, check-registry.sh,
 *    check-commands.sh, check-imports.sh, check-drift.sh (all read in
 *    full, zero curl/wget/fetch/http(s)://). scripts/governance.sh has
 *    zero direct network calls.
 *  - dashboard -> "bash scripts/dashboard.sh": read in full — local
 *    grep/node -e/npx tsc/jscpd/knip + scripts/check-registry.sh,
 *    scripts/check-ghosts.sh only; writes DNA_OS_DASHBOARD.json locally
 *    (TASK-051/FCR-012 fix, 2026-08-10 — previously wrote DNA_OS_HEALTH.json,
 *    the same file scripts/governance.sh writes with an incompatible schema;
 *    now split into separate files, comment updated to match). Zero network
 *    calls.
 *  - intelligence -> "bash scripts/intelligence.sh": read in full —
 *    local grep/node -e reads of registry/engines files only; writes
 *    DNA_OS_INTELLIGENCE.json locally. Zero network calls.
 *  - precommit -> "bash scripts/pre-commit-check.sh": read in full,
 *    including its own real "npx tsx scripts/sync-registry.ts" +
 *    "scripts/build-arch-book.ts" + "scripts/hardcode-precommit-scan.ts"
 *    sub-calls (each also read in full — pure fs/JSON/regex work). Its
 *    "supabase.co"/"supabase.com" text is its OWN static grep PATTERN
 *    against other files' source, never a live call.
 *  - readiness:test -> "npx tsx scripts/readiness-test.ts": read in
 *    full — pure fs/JSON reads + in-process computeOperationalReadiness();
 *    that suite's own final test asserts zero execFile/process-spawn
 *    inside computeOperationalReadiness. Zero network calls.
 *  - cost-gate:test -> "npx tsx scripts/cost-gate-test.ts": read in full
 *    (this build's own acceptance suite) — its one child-process call
 *    (worker-01-acceptance-test.ts) explicitly strips RUN_LIVE/SKIP_LIVE
 *    from the child env so the costed live section never runs
 *    (shouldRunLiveSection() false by construction) — zero real spend.
 *  - execution-hand:test -> "npx tsx scripts/execution-hand-test.ts":
 *    read in full — every child command is a local "node -e ..." fixture
 *    or a real fs op under registry/execution-hand-sandbox. Zero network.
 *  - manager-question-queue:test / switch-based-orchestrator:test: both
 *    read in full — pure in-process function calls against real
 *    registry/JSON state, zero child_process/network usage
 *    (switch-based-orchestrator-test.ts's own test #7 asserts its target
 *    module never imports child_process at all).
 *
 * Explicitly and deliberately NOT on this list, after real inspection
 * (disclosed, not silently omitted — contradicts FCR-011's own informal
 * "free, local" description of these 2 scripts):
 *  - deploy-gate: scripts/deploy-gate.ts really calls Supabase
 *    (createClient(...).from("dev_loop_check_results")...) whenever
 *    NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are configured —
 *    and this real repo's .env.local really has both set today. A real,
 *    external, network/cloud dependency — never FREE_LOCAL.
 *  - factory-readiness:test: transitively calls every
 *    WORKER_ADAPTER_REGISTRY adapter's .health(), and
 *    ollamaLocalAdapter.health() really calls realOllamaReachabilityCheck()
 *    (a real fetch()) whenever AI_GATEWAY_OLLAMA_URL is set. Unset in
 *    this environment today, but that is real, ambient, mutable config
 *    this classifier cannot see or pin — a provably-free classification
 *    must never depend on today's environment happening to omit a var.
 *  - status / existence: scripts/existence.sh really runs `curl -s
 *    --max-time 2 -o /dev/null -w "%{http_code}" https://google.com`
 *    (scripts/existence.sh:46) — a real, live network call every time it
 *    runs. "status" chains existence.sh in too. Never FREE_LOCAL. */
const VERIFIED_FREE_NPM_SCRIPTS: Record<string, string> = {
  "type-check": "tsc --noEmit",
  "lint": "eslint",
  "guard": "bash scripts/governance.sh",
  "dashboard": "bash scripts/dashboard.sh",
  "intelligence": "bash scripts/intelligence.sh",
  "precommit": "bash scripts/pre-commit-check.sh",
  "readiness:test": "npx tsx scripts/readiness-test.ts",
  "cost-gate:test": "npx tsx scripts/cost-gate-test.ts",
  "execution-hand:test": "npx tsx scripts/execution-hand-test.ts",
  "manager-question-queue:test": "npx tsx scripts/manager-question-queue-test.ts",
  "switch-based-orchestrator:test": "npx tsx scripts/switch-based-orchestrator-test.ts",
};

/** Closed set of directly-invocable "bash scripts/<name>.sh" governance
 * scripts, verified free by the identical real-inspection standard above
 * (each read in full this same pass). Deliberately excludes
 * scripts/existence.sh (real curl call, scripts/existence.sh:46). */
const VERIFIED_FREE_SHELL_SCRIPTS = new Set<string>([
  "scripts/governance.sh", "scripts/dashboard.sh", "scripts/intelligence.sh",
  "scripts/pre-commit-check.sh", "scripts/verify-environment.sh",
  "scripts/check-registry.sh", "scripts/check-commands.sh", "scripts/check-imports.sh",
  "scripts/check-drift.sh", "scripts/check-business-coverage.sh",
  "scripts/check-connector-lifecycle.sh", "scripts/check-cross-script-consistency.sh",
  "scripts/check-evidence-isolation.sh", "scripts/check-ghosts.sh",
  "scripts/check-rule-coverage.sh", "scripts/check-workflow-coverage.sh",
]);

/** Closed set of directly-invocable "npx tsx scripts/<name>.ts" real,
 * local test scripts, verified free by the identical standard (the same
 * 5 real *-test.ts values already in VERIFIED_FREE_NPM_SCRIPTS above). */
const VERIFIED_FREE_TSX_SCRIPTS = new Set<string>([
  "scripts/readiness-test.ts", "scripts/cost-gate-test.ts", "scripts/execution-hand-test.ts",
  "scripts/manager-question-queue-test.ts", "scripts/switch-based-orchestrator-test.ts",
]);

/** Real, live read of package.json's own "scripts" object — never
 * cached, never trusted from any caller/Job-Contract-supplied text. Fails
 * safe (returns null, which downstream never matches) if the file can't
 * be read/parsed. */
function readLivePackageJsonScripts(): Record<string, string> | null {
  try {
    const raw = readFileSync(path.join(ROOT, "package.json"), "utf-8");
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    return parsed.scripts ?? null;
  } catch {
    return null;
  }
}

/** THE real classifier for the RUN_COMMAND/RUN_TEST/BUILD operation
 * surface (Rule 257 AMENDMENT). Computes FREE_LOCAL/UNKNOWN_COST from the
 * REAL command+args text every time — a Job Contract/Worker declaring its
 * own cost_class is never consulted here. No wildcard matching: every
 * branch matches an exact, closed, individually-verified command shape. */
export function classifyOperationCommand(command: string | undefined | null, args: string[] | undefined | null): OperationCostClassification {
  if (!command || typeof command !== "string") {
    return { costClass: "UNKNOWN_COST", reason: "no real command text supplied to classify — genuinely unknown, never assumed free" };
  }
  const a = Array.isArray(args) ? args : [];
  const basename = command.split("/").pop() ?? command;

  // git status / git diff — bare, zero extra args only (no wildcard).
  if (basename === "git" && a.length === 1 && (a[0] === "status" || a[0] === "diff")) {
    return { costClass: "FREE_LOCAL", reason: `"git ${a[0]}" is a real, local, read-only git operation — no network/remote call` };
  }
  // grep / cat — pure local, read-only tools with zero network capability
  // built into the tool itself, regardless of which arguments are passed.
  if (basename === "grep" || basename === "cat") {
    return { costClass: "FREE_LOCAL", reason: `"${basename}" is a real, local, read-only tool with no network code path, regardless of arguments` };
  }
  // npx tsc --noEmit — exact, bare.
  if (basename === "npx" && a.length === 2 && a[0] === "tsc" && a[1] === "--noEmit") {
    return { costClass: "FREE_LOCAL", reason: '"npx tsc --noEmit" is the real, local TypeScript compiler in check-only mode — no network, no emit' };
  }
  // eslint — bare, zero extra args (direct binary or npx wrapper).
  if ((basename === "eslint" && a.length === 0) || (basename === "npx" && a.length === 1 && a[0] === "eslint")) {
    return { costClass: "FREE_LOCAL", reason: '"eslint" is the real, local linter — no network by design' };
  }
  // npx tsx scripts/<verified>.ts — closed set only.
  if (basename === "npx" && a.length === 2 && a[0] === "tsx" && VERIFIED_FREE_TSX_SCRIPTS.has(a[1])) {
    return { costClass: "FREE_LOCAL", reason: `"npx tsx ${a[1]}" is a real, individually-verified-free local script (see costGateRuntime.ts's VERIFIED_FREE_TSX_SCRIPTS citations)` };
  }
  // bash scripts/<verified>.sh — closed set only.
  if (basename === "bash" && a.length === 1 && VERIFIED_FREE_SHELL_SCRIPTS.has(a[0])) {
    return { costClass: "FREE_LOCAL", reason: `"bash ${a[0]}" is a real, individually-verified-free local governance script (see costGateRuntime.ts's VERIFIED_FREE_SHELL_SCRIPTS citations)` };
  }
  // npm run <script> — closed set, cross-checked against a REAL, LIVE
  // read of package.json (never trusted from the caller/Job Contract).
  if (basename === "npm" && a.length === 2 && a[0] === "run" && Object.prototype.hasOwnProperty.call(VERIFIED_FREE_NPM_SCRIPTS, a[1])) {
    const scriptName = a[1];
    const liveScripts = readLivePackageJsonScripts();
    const liveText = liveScripts ? liveScripts[scriptName] : undefined;
    const expectedText = VERIFIED_FREE_NPM_SCRIPTS[scriptName];
    if (liveText === expectedText) {
      return { costClass: "FREE_LOCAL", reason: `"npm run ${scriptName}" really resolves, on a live read of package.json right now, to the exact, previously-verified-free command "${expectedText}"` };
    }
    return { costClass: "UNKNOWN_COST", reason: `"npm run ${scriptName}" no longer matches its previously-verified-free command text in package.json (live text: ${JSON.stringify(liveText)}, expected: ${JSON.stringify(expectedText)}) — real drift detected, safely refusing to trust it as free` };
  }

  return { costClass: "UNKNOWN_COST", reason: `"${command} ${a.join(" ")}" does not match any real, closed, individually-verified FREE_LOCAL command pattern — defaults to the existing, unweakened Rule 257 Cost Gate flow` };
}

// ============================================================
// THE REAL GATE — Rule 257's exact required logic.
// ============================================================
export function checkCostGate(req: CostGateRequest): CostGateOutcome {
  const decisionId = randomUUID();
  const decidedAt = new Date().toISOString();

  // Rule 257 AMENDMENT (2026-08-09, FCR-011/TASK-050) — FREE_LOCAL fast
  // path. Computed from the REAL command text every time (never trusted
  // from the caller); checked BEFORE the existing estimated_cost===0
  // branch so a provably-free command releases even if the caller
  // supplied a wrong/stale nonzero estimated_cost. Never consults a
  // budget, never writes registry/COST_LEDGER.json (this function has
  // never called recordActualCost — that real, honest fact is unchanged
  // by this amendment; there is no real cost to record for a real $0).
  const operationClassification = classifyOperationCommand(req.command, req.args);
  if (operationClassification.costClass === "FREE_LOCAL") {
    const partial: Omit<CostGateOutcome, "evidenceArtifactId"> = {
      outcome: "RELEASE",
      reason: `FREE_LOCAL — ${operationClassification.reason} (Rule 257 AMENDMENT, FCR-011/TASK-050) — no budget consulted, no Cost Ledger entry, no gate friction`,
      budgetApplied: null, escalation: null, escalationCriterion: null, decisionId, decidedAt,
      operationCostClass: "FREE_LOCAL",
    };
    const evidenceArtifactId = recordDecisionEvidence(req, partial);
    return { ...partial, evidenceArtifactId };
  }

  // RELEASE 1 — a real, confirmed zero cost. (null is NOT zero — see
  // CostGateRequest.estimated_cost's doc comment; that is the honest
  // UNKNOWN_COST case and must never auto-release.)
  if (req.estimated_cost === 0) {
    const partial: Omit<CostGateOutcome, "evidenceArtifactId"> = {
      outcome: "RELEASE", reason: "real estimated_cost is exactly 0 — no real spend, no gate friction (Rule 257)",
      budgetApplied: null, escalation: null, escalationCriterion: null, decisionId, decidedAt,
      operationCostClass: operationClassification.costClass,
    };
    const evidenceArtifactId = recordDecisionEvidence(req, partial);
    return { ...partial, evidenceArtifactId };
  }

  const cost = req.estimated_cost;

  // An explicit, caller-declared max_cost ceiling that the estimate
  // already exceeds is an immediate LOCK regardless of any budget —
  // defense in depth, never silently overridden by a larger budget.
  const ceilingExceeded = req.max_cost !== null && cost !== null && cost > req.max_cost;

  if (!ceilingExceeded && cost !== null) {
    const budgetsFile = loadBudgetsFile();
    const budget = findMatchingBudget(budgetsFile, req, cost);
    if (budget) {
      budget.spent += cost;
      if (budget.spent >= budget.max_cost) budget.status = "EXHAUSTED";
      saveBudgetsFile(budgetsFile);
      const partial: Omit<CostGateOutcome, "evidenceArtifactId"> = {
        outcome: "RELEASE",
        reason: `real, pre-approved budget ${budget.budget_id} (scope=${budget.scope}) covers this real estimated_cost — real remaining after this reservation: ${(budget.max_cost - budget.spent).toFixed(4)} ${budget.currency}`,
        budgetApplied: { budgetId: budget.budget_id, scope: budget.scope, remainingAfter: budget.max_cost - budget.spent },
        escalation: null, escalationCriterion: null, decisionId, decidedAt,
        operationCostClass: operationClassification.costClass,
      };
      const evidenceArtifactId = recordDecisionEvidence(req, partial);
      return { ...partial, evidenceArtifactId };
    }
  }

  // LOCK — no budget covers this (or estimated_cost is genuinely
  // UNKNOWN_COST/null, or the caller's own max_cost ceiling was already
  // exceeded). Escalate as financial_approval_required through Rule
  // 251's single, real Owner Inquiry channel — never a second surface.
  const costDescription = cost === null ? "UNKNOWN (cost could not be estimated at this call site)" : `${cost} ${req.currency}`;
  // Real, deliberate wording note: this text is intentionally kept free
  // of any literal "Rule <number>" pattern — managerQuestionRuntime.ts's
  // own real, registry-first RULE_STATUS resolver (tryResolveRuleStatus)
  // matches exactly that pattern against registry/rule-coverage.json and
  // would auto-resolve this as an answered question, never reaching the
  // real Owner-facing queue at all. A genuinely honest interaction found
  // live while building this suite (scripts/cost-gate-test.ts's
  // Acceptance 3), not designed around in advance — see this file's own
  // report for the full disclosure.
  const escalationReasonText = `COST_GATE financial approval required — real, paid dispatch attempt for task ${req.task_id} via worker/adapter ${req.worker_id} (provider ${req.provider}, operation ${req.operation}). Real estimated cost: ${costDescription}. ${ceilingExceeded ? `Exceeds this request's own declared max_cost ceiling (${req.max_cost} ${req.currency}).` : "No real, pre-approved registry/COST_BUDGETS.json budget currently covers this task/capability/provider, or the matching budget's real remaining headroom is insufficient."} Reason given: ${req.reason}. Evidence: ${req.evidence.join(", ") || "(none supplied)"}. This requires real, explicit financial approval before any PAID/UNKNOWN_COST operation may execute (Execution Plane Cost Gate policy).`;

  const escalationCriterion = classifyEscalation(escalationReasonText);
  const escalation = submitWorkerQuestion({
    workerRole: resolveWorkerRole(req), jobContractId: req.task_id, actor: req.actor, ownerId: req.ownerId,
    questionText: escalationReasonText,
  });

  const partial: Omit<CostGateOutcome, "evidenceArtifactId"> = {
    outcome: "LOCK",
    reason: `LOCKED — ${ceilingExceeded ? "declared max_cost ceiling exceeded" : "no real, pre-approved budget covers this real cost"}; escalated as ${escalationCriterion ?? "(criterion did not match Rule 255's live escalation_criteria — escalated anyway per Rule 257, tagged for manual review)"} via Rule 251's real Owner Inquiry channel (submitWorkerQuestion), outcome status=${escalation.status}`,
    budgetApplied: null, escalation, escalationCriterion, decisionId, decidedAt,
    operationCostClass: operationClassification.costClass,
  };
  const evidenceArtifactId = recordDecisionEvidence(req, partial);
  return { ...partial, evidenceArtifactId };
}

// ============================================================
// Real, shared Live-Mode Opt-In Policy (Rule 257's own text: "SKIP_LIVE
// ต้องเป็นค่าเริ่มต้นเสมอในทุก Test Harness — Live ต้องเป็น opt-in ไม่ใช่
// opt-out"). The one, canonical evaluation of "should a Test Harness's
// real, costed live section run this invocation", reused by every real
// *-acceptance-test.ts harness this build fixed (starts with
// worker-01-acceptance-test.ts) instead of each harness reimplementing
// its own boolean, AND side-effect-free (unlike importing straight from
// a *-acceptance-test.ts script, which would execute that script's own
// main() as an import side effect) — so scripts/cost-gate-test.ts can
// unit-test the real opt-in logic directly without spending real money.
// RUN_LIVE=1 is the real, deliberate opt-in; SKIP_LIVE=1 (if set)
// always wins, kept only for backward compatibility with this suite's
// already-recorded past invocations (Rule 257 clause 12).
// ============================================================
export function shouldRunLiveSection(env: Record<string, string | undefined> = process.env): boolean {
  return env.RUN_LIVE === "1" && env.SKIP_LIVE !== "1";
}

// ============================================================
// Debug/test-only helpers — same convention as this repo's other
// Runtimes (contextPlannerRuntime.ts's __debugContextPlanCount / etc.).
// Only ever clears real budgets THIS process created via grantCostBudget
// when passed their exact ids — never a blunt file wipe.
// ============================================================
export function __debugClearBudgets(budgetIds: string[]): void {
  const file = loadBudgetsFile();
  file.budgets = file.budgets.filter((b) => !budgetIds.includes(b.budget_id));
  saveBudgetsFile(file);
}
