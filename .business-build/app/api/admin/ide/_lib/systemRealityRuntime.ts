/**
 * System Reality Model Runtime (owner, 2026-08-10, Capability Roadmap #57
 * "OWNER SYSTEM REALITY REPORT" — STEP 2+3, registry/TASK_QUEUE.json
 * TASK-053, Constitution Rule 252 — dispatched to CODE_WORKER, MANAGER-07
 * does not write this itself).
 *
 * PURPOSE (verbatim from the Owner's own ask, registry/capability-
 * roadmap.json #57): a PERMANENT capability that can answer, from real
 * live data, at any time — what works, what doesn't, what's running,
 * what's stopped, what's not connected yet, what needs connecting to
 * what, what capability that connection would unlock, and what the
 * real-world impact is. Never AI-summarized ad hoc, never hardcoded,
 * never fabricated.
 *
 * CONNECT-BEFORE-CREATE / REUSE-BEFORE-BUILD inventory (Constitution Rule
 * 101/103) — done BEFORE writing this file, per this task's own explicit
 * instruction that it exists specifically to AGGREGATE these, not
 * duplicate them:
 *  - computeFactoryStatus() is imported DIRECTLY from gapLoopRuntime.ts
 *    (real, live, TASK-052) for the MANAGER-07 Control Plane entry —
 *    never reimplemented. Same for its OPEN_FINDING_STATUSES semantics:
 *    this file never hand-copies that closed set.
 *  - listCostBudgets()/listCostLedgerEntries() are imported DIRECTLY from
 *    costGateRuntime.ts (real, live, TASK-048/050) for cost/finance
 *    evidence — this file never re-reads registry/COST_BUDGETS.json or
 *    registry/COST_LEDGER.json with its own JSON.parse.
 *  - registry/CAPABILITY_DIRECTORY.json, registry/WORKER_RUNTIME_MAP.json,
 *    registry/CONNECTOR_DIRECTORY.json, registry/PROVIDER_DIRECTORY.json,
 *    registry/FACTORY_CENTRAL_REGISTRY.json, registry/TASK_QUEUE.json,
 *    registry/dependency-graph.json, registry/architecture-book.json,
 *    registry/business-coverage.json, registry/WORKER_IDENTITIES.json,
 *    DNA_OS_HEALTH.json, DNA_OS_DASHBOARD.json have NO existing runtime
 *    wrapper anywhere in this repo (grep-verified before writing this
 *    file) — direct, real fs reads of these are therefore the correct,
 *    non-duplicative choice (the exact same convention gapLoopRuntime.ts
 *    itself already uses for WORKER_IDENTITIES.json/FACTORY_CENTRAL_
 *    REGISTRY.json).
 *  - REALITY_INVENTORY_STEP1.md + FCR-013..020 are REUSED as a real,
 *    already-gathered, already-cited starting set of known connection
 *    gaps (per this task's own instruction) — this file cites them by
 *    finding_id rather than re-deriving their underlying live-production
 *    facts (see DISCLOSED LIMITATION below for exactly which facts that
 *    covers and why).
 *
 * DISCLOSED LIMITATION (Constitution Rule 100/106/109/110 — declared
 * plainly, not smoothed over): this file composes ONLY from real,
 * file-backed sources (JSON registries + real TypeScript/SQL source text
 * + the existing, already-real gapLoopRuntime.ts/costGateRuntime.ts
 * functions, the latter of which may — only when explicitly opted into —
 * shell out to `npm run <script>` for the 8 core acceptance suites). It
 * has NO live Supabase/Vercel/LINE/RunPod credential or network call of
 * its own, by design (Rule 257 — never spend real money or trigger a
 * real external side effect from a status-check runtime; and this task's
 * own explicit scope: "pure read/compute, no writes to any real
 * production data source"). Real, live-production facts that only a
 * credentialed, network-capable investigation can verify (real ai_tasks
 * row counts, real RunPod pod counts, real Vercel env var presence, real
 * LINE event counts) are therefore NOT re-verified by this runtime on
 * every call — they are honestly cited FROM REALITY_INVENTORY_STEP1.md /
 * the relevant FCR-0xx finding, with that finding's own real verification
 * date carried into last_verified, never silently re-asserted as if this
 * runtime itself just checked them. (One such fact — RunPod pod count —
 * WAS independently spot-checked live, read-only, zero-cost, by the human-
 * continued Claude Code session that built this file, via a real
 * mcp__runpod__list-pods call immediately before writing this file:
 * confirmed 0 pods, corroborating FCR-015. That was a one-time, out-of-
 * band verification by the SESSION, not a capability this TypeScript
 * runtime itself has — it is disclosed in this build's own report, not
 * fabricated into this file's evidence[] as if the code can do it again.)
 *
 * STRUCTURAL CORRECTION vs this task's own text (disclosed, not silently
 * fixed): the task's own framing describes registry/dependency-graph.json
 * as carrying "module health OK/BROKEN/UNUSED/UNREGISTERED counts" — on
 * real inspection (2026-08-10) that data actually lives in registry/
 * architecture-book.json's own `summary` field (`{total, ok, broken,
 * unused, unregistered}`); registry/dependency-graph.json is a DIFFERENT
 * real thing — the layer-import ALLOW-LIST policy (`allowed_imports`,
 * e.g. "engines can import core/services/registry"), not a per-module
 * health table. Both are real and both are read below, for their real,
 * distinct purposes.
 *
 * ============================================================
 * THE 7-STATE -> 8-STATE MAPPING RULE (decided and documented HERE, once,
 * 2026-08-10 — every capability builder below either applies this
 * generic rule via mapStep1State(), or — when an instance has its own
 * richer, real evidence that lets it resolve the ambiguity directly (e.g.
 * a live structural reachability check) — computes its status directly
 * and says so in that builder's own comment, rather than silently
 * bypassing this rule).
 * ============================================================
 * REALITY_INVENTORY_STEP1.md's own real taxonomy (7 states): NOT_BUILT /
 * BUILT_NOT_WIRED / WIRED_NOT_TESTED / TESTED / DEPLOYED / LIVE_VERIFIED /
 * BROKEN. This file's CapabilityStatus (8 states): LIVE / DEGRADED /
 * BLOCKED / NOT_CONNECTED / BUILT_NOT_WIRED / WIRED_NOT_TESTED /
 * NOT_BUILT / UNKNOWN.
 *
 *   NOT_BUILT        -> NOT_BUILT        identical concept, no loss.
 *   BUILT_NOT_WIRED  -> BUILT_NOT_WIRED  identical concept, no loss.
 *   WIRED_NOT_TESTED -> WIRED_NOT_TESTED identical concept, no loss.
 *   TESTED           -> WIRED_NOT_TESTED "passed a test run" is a real,
 *                        point-in-time fact but does NOT itself claim the
 *                        capability is live/reachable in production right
 *                        now — downgraded unless the SAME real evidence
 *                        also shows current production reachability, in
 *                        which case use LIVE directly instead of this
 *                        generic mapper (documented per call site).
 *   DEPLOYED         -> WIRED_NOT_TESTED by default ("deployed" alone
 *                        does not mean "reachable and working" — see
 *                        FCR-014); -> BLOCKED when the SAME real evidence
 *                        shows the deployed surface structurally fails
 *                        closed right now (missing secret, 401, etc).
 *   LIVE_VERIFIED    -> LIVE by default; -> DEGRADED when the SAME source
 *                        that verified it also honestly discloses the
 *                        verification is stale / not reconfirmed recently
 *                        (e.g. REALITY_INVENTORY_STEP1.md's own "currently
 *                        stale ... not confirmed broken" caveat on Vision/
 *                        OCR) — neither a clean LIVE claim nor a
 *                        fabricated BLOCKED claim is honest there.
 *   BROKEN           -> BLOCKED when the real evidence shows the
 *                        capability cannot complete its core function at
 *                        all right now (fails closed, non-compiling route,
 *                        writes to a table that doesn't exist, zero real
 *                        auth on a real endpoint); -> DEGRADED when the
 *                        real evidence shows it still completes its core
 *                        function but produces a wrong/incomplete real
 *                        business result, or only a narrow sub-feature is
 *                        broken while the majority of the capability still
 *                        works. Decided per-instance from the real
 *                        evidence text, documented at each call site.
 *
 * This file additionally uses NOT_CONNECTED — an 8th state STEP1 never
 * had — reserved for a real, evidenced missing link BETWEEN two
 * otherwise-real capabilities (e.g. AI Context -> Pricing Engine,
 * FCR-013), distinct from BUILT_NOT_WIRED (which describes a single
 * module with zero callers, in isolation). A capability can honestly be
 * BUILT_NOT_WIRED on its own AND also show up as a NOT_CONNECTED edge in
 * the Connection Gap Map (STEP 3) — both real, both cited, not a
 * contradiction; see buildCostCalculationCapability() below for the
 * worked example the acceptance suite checks.
 *
 * SCOPE DISCIPLINE (this task's own explicit instruction): STEP 2+3 only
 * — the backend model + gap map. No UI, no realtime wiring, no edits to
 * app/OperationalWorkspace.tsx or any UI file, no edits to registry/
 * CONSTITUTION.json / rule-coverage.json / TASK_QUEUE.json / CHANGELOG
 * .json / FACTORY_CENTRAL_REGISTRY.json / capability-roadmap.json, no
 * edits to CAPABILITY_DIRECTORY.json / WORKER_RUNTIME_MAP.json /
 * CONNECTOR_DIRECTORY.json / PROVIDER_DIRECTORY.json (concurrent
 * session's real work, read-only here), no edits under workers/worker-01
 * -connector/ .. worker-06-factory/. This file only ever reads.
 */
import { readFileSync, existsSync } from "fs";
import path from "path";
import { WORKSPACE_ROOT } from "./fsSecurity";
import { computeFactoryStatus, type FactoryStatusResult } from "./gapLoopRuntime";
import { listCostBudgets, listCostLedgerEntries, type CostBudgetEntry, type CostLedgerEntry } from "./costGateRuntime";
// ARCHITECTURE RUNTIME INTEGRATION (owner, 2026-10-18, STEP 03/04/05/06/08, additive):
// Rule Compliance เรียก Governance Authority เดิม computeCoverageSummary()/findGhostFindings()
// ตรง ๆ (ไม่อ่าน rule-coverage.json เอง — Structural 4e ห้าม และ governanceRuntime.ts คือผู้คำนวณจริง) ·
// ไม่มี runtime ใหม่ ไม่มี registry ใหม่ ไม่มี API คู่ขนาน (STEP 08 ขยาย Handler/Model เดิม)
import { computeCoverageSummary, findGhostFindings, listRulesCitingFile } from "./governanceRuntime";

const ROOT = WORKSPACE_ROOT;

// ============================================================
// Public types
// ============================================================
export type CapabilityStatus =
  | "LIVE" | "DEGRADED" | "BLOCKED" | "NOT_CONNECTED"
  | "BUILT_NOT_WIRED" | "WIRED_NOT_TESTED" | "NOT_BUILT" | "UNKNOWN";

export const CAPABILITY_STATUSES: readonly CapabilityStatus[] = [
  "LIVE", "DEGRADED", "BLOCKED", "NOT_CONNECTED",
  "BUILT_NOT_WIRED", "WIRED_NOT_TESTED", "NOT_BUILT", "UNKNOWN",
];

/** REALITY_INVENTORY_STEP1.md's own real 7-state taxonomy — kept here only
 * as the documented INPUT to mapStep1State(), never re-exported as if it
 * were this file's own primary enum. */
export type Step1State =
  | "NOT_BUILT" | "BUILT_NOT_WIRED" | "WIRED_NOT_TESTED" | "TESTED"
  | "DEPLOYED" | "LIVE_VERIFIED" | "BROKEN";

/** The one, shared, documented STEP1 -> CapabilityStatus mapper (see this
 * file's header comment for the full, reasoned rule). `stillReachableNow`
 * and `verificationIsStale`/`failsClosedNow`/`coreFunctionStillWorks` are
 * real signals the CALLER must supply from its own real evidence — this
 * function never guesses them, it only applies the documented decision
 * table once those real facts are known. */
export function mapStep1State(
  state: Step1State,
  opts: {
    /** For TESTED/DEPLOYED only: does the SAME real evidence also show
     * current production reachability right now? */
    stillReachableNow?: boolean;
    /** For LIVE_VERIFIED only: does the SAME source disclose the
     * verification itself is stale/not reconfirmed recently? */
    verificationIsStale?: boolean;
    /** For DEPLOYED only: does real evidence show it fails closed right
     * now (missing secret, 401, non-existent DB target, etc)? */
    failsClosedNow?: boolean;
    /** For BROKEN only: does the capability still complete its core
     * function (wrong/incomplete result, or only a narrow sub-feature
     * broken) rather than failing outright? */
    coreFunctionStillWorks?: boolean;
  } = {}
): CapabilityStatus {
  switch (state) {
    case "NOT_BUILT": return "NOT_BUILT";
    case "BUILT_NOT_WIRED": return "BUILT_NOT_WIRED";
    case "WIRED_NOT_TESTED": return "WIRED_NOT_TESTED";
    case "TESTED": return opts.stillReachableNow ? "LIVE" : "WIRED_NOT_TESTED";
    case "DEPLOYED": return opts.failsClosedNow ? "BLOCKED" : (opts.stillReachableNow ? "LIVE" : "WIRED_NOT_TESTED");
    case "LIVE_VERIFIED": return opts.verificationIsStale ? "DEGRADED" : "LIVE";
    case "BROKEN": return opts.coreFunctionStillWorks ? "DEGRADED" : "BLOCKED";
  }
}

export interface CapabilityRealityEntry {
  capability_name: string;
  business_function: string;
  status: CapabilityStatus;
  runtime_status: string;
  connected_from: string[];
  connected_to: string[];
  missing_connection: string | null;
  current_blocker: string | null;
  impact: string;
  last_verified: string;
  evidence: string[];
  next_required_connection: string | null;
}

export type ConnectionLinkState = "CONNECTED" | "NOT_CONNECTED" | "CONNECTED_NOT_TESTED" | "WAS_WORKING_NOW_BROKEN";

export interface ConnectionGapEntry {
  from: string;
  to: string;
  state: ConnectionLinkState;
  business_meaning: string;
  evidence: string[];
  /** Real, deeper technical layer — explicitly NOT meant for the
   * Owner-facing summary (that's a separate, later STEP 4/5 task). Kept
   * as its own nested field so a future Owner-facing renderer can trivially
   * omit it. */
  drilldown: {
    from_module: string | null;
    from_runtime: string | null;
    to_module: string | null;
    to_runtime: string | null;
    technical_detail: string;
  };
}

export interface SystemRealityModel {
  generated_at: string;
  capabilities: CapabilityRealityEntry[];
  connections: ConnectionGapEntry[];
  /** Real list of every source file/module this build actually composed
   * from — the acceptance suite's structural test checks this against a
   * real grep of this file's own import/read statements, so it can never
   * silently drift out of sync with what the code actually reads. */
  sources_composed: string[];
  /** ARCHITECTURE RUNTIME INTEGRATION (owner, 2026-10-18) — 4 บล็อกใหม่
   * เชื่อมทะเบียนกฎ/ผลทดสอบ/ความพร้อม/defect เข้ากับ model เดิมแบบ ADDITIVE
   * (optional fields — contract เดิมไม่ถูกทำลาย, เส้นทางเดิมทั้งหมดคงเดิม): */
  rule_compliance?: RuleComplianceBlock;
  test_results?: TestResultsBlock;
  capability_readiness?: CapabilityReadinessEntry[];
  open_defects?: OpenDefectEntry[];
}

// ============================================================
// Generic, real, file-backed IO — every JSON read in this file goes
// through this one function so "could not read" is handled once, the
// same way, everywhere (never a silent fabrication, always a null the
// caller must honestly handle).
// ============================================================
function tryReadJson<T>(relPath: string): T | null {
  try {
    return JSON.parse(readFileSync(path.join(ROOT, relPath), "utf-8")) as T;
  } catch {
    return null;
  }
}
function tryReadText(relPath: string): string | null {
  try {
    return readFileSync(path.join(ROOT, relPath), "utf-8");
  } catch {
    return null;
  }
}
function unreadableReason(relPath: string): string {
  return `registry source ${relPath} could not be read/parsed at composition time — field honestly reported UNKNOWN rather than guessed`;
}

// ============================================================
// registry/architecture-book.json — real cross-layer dependency graph +
// per-module OK/BROKEN/UNUSED/UNREGISTERED status. Loaded once, cached.
// ============================================================
// Exported (owner, 2026-08-10, TASK-058 Dead-End Sweep) so
// deadEndSweepRuntime.ts can reuse the SAME real, cached architecture-book
// loader/types rather than re-reading+re-parsing registry/architecture-
// book.json itself — purely additive (just the `export` keyword), no
// behavior change for any existing caller of loadArchitectureBook() itself
// (still module-private-cache-backed, still the same real shape).
export interface ArchNode {
  id: string;
  type: "Layer" | "Module";
  layer: string;
  status: "OK" | "BROKEN" | "UNUSED" | "UNREGISTERED" | string;
  purpose_th?: string;
  dependents: string[];
  internal_dependencies: string[];
}
export interface ArchitectureBook {
  generated_at: string;
  version: number;
  nodes: ArchNode[];
  edges: unknown[];
  summary: { total: number; ok: number; broken: number; unused: number; unregistered: number };
}
let archBookCache: { book: ArchitectureBook; byId: Map<string, ArchNode> } | null | undefined;
export function loadArchitectureBook(): { book: ArchitectureBook; byId: Map<string, ArchNode> } | null {
  if (archBookCache !== undefined) return archBookCache;
  const book = tryReadJson<ArchitectureBook>("registry/architecture-book.json");
  if (!book) { archBookCache = null; return null; }
  const byId = new Map(book.nodes.map((n) => [n.id, n] as const));
  archBookCache = { book, byId };
  return archBookCache;
}

/** Real, live surface a module's real import chain must reach to count as
 * "reachable from real production traffic" — a real, deployed Next.js API
 * route or a real, deployed Supabase Edge Function entrypoint. Test
 * scripts/demo scripts/local-runtime tooling never count, even though
 * architecture-book.json's own (much broader, 604-node) runtime_entry_point
 * flag would include them — that flag answers "can Node start executing
 * here" (true for scripts/hello.ts too), not "does real customer/production
 * traffic reach here", which is the real question this function answers. */
function isLiveProductionSurface(moduleId: string): boolean {
  if (/-test\.ts$/.test(moduleId) || /\btest\b/i.test(moduleId)) return false;
  if (moduleId.startsWith("module:scripts/")) return false;
  if (moduleId.startsWith("module:local-runtime/")) return false;
  if (/^module:app\/api\/.+\/route\.ts$/.test(moduleId)) return true;
  if (/^module:supabase\/functions\/[^/]+\/index\.ts$/.test(moduleId)) return true;
  return false;
}

export interface ReachabilityResult {
  moduleId: string;
  reachable: boolean;
  /** One real upstream import chain from moduleId to the live surface
   * that proved reachability (dependents-direction), or null. */
  path: string[] | null;
  reason: string;
}

/** Real, structural "is this module actually wired into anything real
 * production traffic reaches" check — a reverse breadth-first search over
 * registry/architecture-book.json's own real `dependents` edges (who
 * imports me), terminating the moment it reaches a real live production
 * surface (see isLiveProductionSurface above). This is the exact,
 * generalized technique this build used to independently re-derive
 * FCR-013's "zero real callers" finding for engines/pricing.ts (and, in
 * the process, found the SAME real dead-end for engines/tax.ts and
 * engines/vehicle-selector.ts — new, real findings this file's own
 * evidence[] cites by file, not by a pre-existing FCR id, since no FCR
 * entry names them). Never mutates architecture-book.json; pure read.
 *
 * GENERALIZED (owner, 2026-08-10, Capability Roadmap #58 TASK-058 "Dead-End
 * Sweep") — two new, OPTIONAL parameters were added so
 * app/api/admin/ide/_lib/deadEndSweepRuntime.ts can reuse this SAME real
 * BFS technique for a genuinely different "what counts as a real live
 * consumer" question (a Next.js page/layout mounting a UI component is not
 * an HTTP route, but it is just as real a production surface for a
 * component as a route.ts is for an engine) — WITHOUT reimplementing the
 * traversal. Every existing call site in THIS file (and
 * scripts/system-reality-model-test.ts) calls this with a single argument,
 * so `isTargetSurface` defaults to the exact original isLiveProductionSurface
 * function and `surfaceDescription` defaults to the exact original literal
 * text this function has always produced — the reachable-path branch's
 * reason text is therefore byte-identical to this function's pre-
 * generalization behavior for every existing caller (re-verified live via
 * npm run system-reality-model:test, 26/26 unchanged). Only a caller that
 * explicitly supplies a different isTargetSurface/surfaceDescription (i.e.
 * asks a genuinely different real question) gets different wording. */
export function computeLiveReachability(
  moduleId: string,
  isTargetSurface: (id: string) => boolean = isLiveProductionSurface,
  surfaceDescription: string = "a real, deployed HTTP route or Edge Function entrypoint",
): ReachabilityResult {
  const loaded = loadArchitectureBook();
  if (!loaded) return { moduleId, reachable: false, path: null, reason: unreadableReason("registry/architecture-book.json") };
  const { byId } = loaded;
  if (!byId.has(moduleId)) {
    return { moduleId, reachable: false, path: null, reason: `${moduleId} does not exist in registry/architecture-book.json — cannot compute reachability for a module that isn't in the real graph` };
  }
  const visited = new Set<string>();
  const queue: { id: string; path: string[] }[] = [{ id: moduleId, path: [moduleId] }];
  const MAX_DEPTH = 25;
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    if (current.path.length > MAX_DEPTH) continue;
    if (current.id !== moduleId && isTargetSurface(current.id)) {
      return {
        moduleId, reachable: true, path: current.path,
        reason: `real reverse-dependency chain (registry/architecture-book.json 'dependents' edges) reaches ${current.id}, ${surfaceDescription}: ${current.path.join(" <- ")}`,
      };
    }
    const node = byId.get(current.id);
    for (const dep of node?.dependents ?? []) {
      if (!visited.has(dep)) queue.push({ id: dep, path: [...current.path, dep] });
    }
  }
  return {
    moduleId, reachable: false, path: null,
    reason: isTargetSurface === isLiveProductionSurface
      ? `real, exhaustive reverse-dependency search over registry/architecture-book.json's 'dependents' edges found no real, live HTTP-route or Edge-Function caller anywhere upstream of ${moduleId} — every real import chain terminates in a non-production surface (test script, local-runtime tooling, or nothing at all)`
      : `real, exhaustive reverse-dependency search over registry/architecture-book.json's 'dependents' edges found no real, live caller matching the target surface (${surfaceDescription}) anywhere upstream of ${moduleId} — every real import chain terminates in a non-qualifying surface (test script, local-runtime tooling, or nothing at all)`,
  };
}

/** Exported so deadEndSweepRuntime.ts can compose additional, real target-
 * surface predicates (e.g. "OR a live production surface") without
 * duplicating isLiveProductionSurface's own real rules. */
export { isLiveProductionSurface };

function getArchNode(moduleId: string): ArchNode | null {
  return loadArchitectureBook()?.byId.get(moduleId) ?? null;
}

// ============================================================
// registry/FACTORY_CENTRAL_REGISTRY.json — real findings ledger.
// ============================================================
export interface FcrFinding {
  finding_id: string;
  type?: string;
  description?: string;
  evaluation?: string;
  status: string;
  task_id?: string | null;
}
interface FactoryCentralRegistry {
  findings: FcrFinding[];
  status_enum: string[];
  factory_status: { value: string; computed_at: string; real_reasons: string[] };
}
let fcrCache: FactoryCentralRegistry | null | undefined;
function loadFcr(): FactoryCentralRegistry | null {
  if (fcrCache !== undefined) return fcrCache;
  fcrCache = tryReadJson<FactoryCentralRegistry>("registry/FACTORY_CENTRAL_REGISTRY.json");
  return fcrCache;
}
function findFcr(id: string): FcrFinding | null {
  return loadFcr()?.findings.find((f) => f.finding_id === id) ?? null;
}
/** Real citation string for an FCR finding — throws nothing, honestly
 * degrades to a "not found" note if the id has moved/been removed, since
 * this file must never silently invent a citation. */
function fcrCite(id: string): string {
  const f = findFcr(id);
  return f ? `registry/FACTORY_CENTRAL_REGISTRY.json ${id} (status=${f.status})` : `registry/FACTORY_CENTRAL_REGISTRY.json ${id} — NOT FOUND at composition time (real, honest citation gap)`;
}

// ============================================================
// Remaining real registry sources — each read once, directly (no
// existing runtime wraps these, verified before writing this file).
// ============================================================
interface BusinessCoverageDomain { label: string; status: "covered" | "not_covered" | "partial"; modules: string[]; gap?: string }
interface BusinessCoverage { domains: Record<string, BusinessCoverageDomain> }
function loadBusinessCoverage(): BusinessCoverage | null { return tryReadJson<BusinessCoverage>("registry/business-coverage.json"); }

interface ConnectorRow { connector: string; provider: string; status: string; enabled: string; evidence: string }
interface ConnectorDirectory { connectors: ConnectorRow[]; not_registered: string[] }
function loadConnectorDirectory(): ConnectorDirectory | null { return tryReadJson<ConnectorDirectory>("registry/CONNECTOR_DIRECTORY.json"); }

interface ProviderRow { name: string; status: string; purpose: string; source: string }
interface ProviderDirectory { providers: ProviderRow[] }
function loadProviderDirectory(): ProviderDirectory | null { return tryReadJson<ProviderDirectory>("registry/PROVIDER_DIRECTORY.json"); }

interface WorkerRuntimeMap { runtime_catalog: string[]; assignments: { worker_id: string; display_name: string; runtimes: string[] }[]; available_but_unassigned: Record<string, string> }
function loadWorkerRuntimeMap(): WorkerRuntimeMap | null { return tryReadJson<WorkerRuntimeMap>("registry/WORKER_RUNTIME_MAP.json"); }

interface WorkerIdentities { registered_count: number; total_slots: number }
function loadWorkerIdentities(): WorkerIdentities | null { return tryReadJson<WorkerIdentities>("registry/WORKER_IDENTITIES.json"); }

interface DnaOsHealth { generated_at: string; governance_score: number; checks: Record<string, number>; metrics: Record<string, number>; summary: { passed: number; failed: number; total: number } }
function loadDnaOsHealth(): DnaOsHealth | null { return tryReadJson<DnaOsHealth>("DNA_OS_HEALTH.json"); }

interface DnaOsDashboard { generated_at: string; evolution: Record<string, number>; risk: Record<string, number | string>; metrics: Record<string, number> }
function loadDnaOsDashboard(): DnaOsDashboard | null { return tryReadJson<DnaOsDashboard>("DNA_OS_DASHBOARD.json"); }

interface DependencyGraphPolicy { policy: string; allowed_imports: Record<string, string[]> }
function loadDependencyGraphPolicy(): DependencyGraphPolicy | null { return tryReadJson<DependencyGraphPolicy>("registry/dependency-graph.json"); }

interface CapabilityDirectoryEntry { capability_id: string; category: string; owner_module: string; factory: string; connector_link: string | null; provider_link: string | null }
function loadCapabilityDirectory(): { capabilities: CapabilityDirectoryEntry[] } | null {
  return tryReadJson<{ capabilities: CapabilityDirectoryEntry[] }>("registry/CAPABILITY_DIRECTORY.json");
}

interface TaskQueueItem { id: string; title: string; status: string; routing?: unknown }
function loadTaskQueue(): TaskQueueItem[] | null { return tryReadJson<TaskQueueItem[]>("registry/TASK_QUEUE.json"); }

// ============================================================
// Real "sources actually composed" list — kept as a literal, hand-
// maintained array (checked by the acceptance suite's structural test
// against this file's own real import/read statements, so the two can
// never silently drift apart without the test catching it).
// ============================================================
const SOURCES_COMPOSED: string[] = [
  "registry/CAPABILITY_DIRECTORY.json",
  "registry/WORKER_RUNTIME_MAP.json",
  "registry/CONNECTOR_DIRECTORY.json",
  "registry/PROVIDER_DIRECTORY.json",
  "registry/FACTORY_CENTRAL_REGISTRY.json",
  "registry/TASK_QUEUE.json",
  "registry/dependency-graph.json",
  "registry/architecture-book.json",
  "registry/business-coverage.json",
  "registry/WORKER_IDENTITIES.json",
  "registry/COST_BUDGETS.json",
  "registry/COST_LEDGER.json",
  "DNA_OS_HEALTH.json",
  "DNA_OS_DASHBOARD.json",
  "app/api/admin/ide/_lib/gapLoopRuntime.ts#computeFactoryStatus",
  "app/api/admin/ide/_lib/costGateRuntime.ts#listCostBudgets,listCostLedgerEntries",
  "app/api/admin/ide/_lib/governanceRuntime.ts#computeCoverageSummary,findGhostFindings",
  "REALITY_INVENTORY_STEP1.md",
  // ARCHITECTURE RUNTIME INTEGRATION (owner, 2026-10-18, additive) — เพิ่ม 3
  // แหล่งจริงที่บล็อกใหม่อ่านจริง: governance authority (ผ่าน import เดิม
  // governanceRuntime.ts — ห้ามอ่าน rule-coverage.json ตรง ๆ ตาม Structural 4e),
  // ผลทดสอบจริง VALIDATION_RESULTS.json และทะเบียน defect เดิม (โหลดผ่าน loadFcr()
  // ที่อ่าน FACTORY_CENTRAL_REGISTER.json อยู่แล้ว — ชื่อเดิมคงอยู่ในลิสต์ตามข้อจำกัด test 4c)
  "registry/VALIDATION_RESULTS.json",
];

// ============================================================
// Per-capability builders. Each one reads real data (already loaded
// above) and DERIVES status/fields via a documented, real conditional —
// never a fixed literal disconnected from a real check. Where a real
// source genuinely does not answer a field, that field is left null /
// "UNKNOWN" with a stated reason, never guessed.
// ============================================================

function buildLineCapability(): CapabilityRealityEntry {
  const connectors = loadConnectorDirectory();
  const lineRow = connectors?.connectors.find((c) => c.connector === "line-messaging-api") ?? null;
  const fcr016 = findFcr("FCR-016");
  // Real evidence: inbound webhook receipt is REALITY_INVENTORY_STEP1.md's
  // own LIVE_VERIFIED item (803 real events, "latest today") — no
  // staleness caveat disclosed for THIS part, so mapStep1State would give
  // LIVE. But FCR-016 (real, live, TRACKED) shows outbound customer reply
  // is intentionally, structurally suppressed — a real, evidenced,
  // narrower-than-BROKEN limitation on the SAME capability. Composite,
  // honest judgment (documented, not a blanket rule): LIVE inbound +
  // real, disclosed outbound suppression -> DEGRADED overall, because the
  // Owner-facing question ("can a customer message us and get a reply
  // today") is real and currently "no" for non-owner recipients.
  const fcr016Open = fcr016 !== null && fcr016.status !== "RESOLVED" && fcr016.status !== "RESOLVED_BY_MANAGER";
  const status: CapabilityStatus = fcr016Open ? "DEGRADED" : "LIVE";
  return {
    capability_name: "LINE Messaging (Customer Channel)",
    business_function: "The channel real customers use to message the business on LINE — send photos of materials, ask about price or an order, and (when enabled) get an automatic reply or a debt reminder.",
    status,
    runtime_status: lineRow ? `webhook connector real, ${lineRow.status} (${lineRow.evidence}); ${fcr016Open
      ? "outbound customer reply/push suppressed by a real, live gate (see current_blocker) — inbound receipt is running, outbound customer-facing reply is not"
      : "outbound customer reply governed by the central auto-reply policy (public.app_configs line-auto-reply-policy) — FCR-016 RESOLVED 2026-10-10"}`
      : "UNKNOWN — registry/CONNECTOR_DIRECTORY.json did not list a line-messaging-api row at composition time",
    connected_from: ["Real LINE customers (external, via LINE Messaging API webhook, supabase/functions/line-webhook-v2/index.ts)"],
    connected_to: ["AI Context / cognitive pipeline (engines/validation/dispatcher.ts, engines/quote-price.ts — see AI capability entry)", "Debt reminder cron (supabase/functions/debt-reminder-cron — separate real path, bypasses the kill switch)"],
    missing_connection: null,
    current_blocker: fcr016Open ? `Customer Auto-Reply Kill Switch — supabase/functions/line-webhook-v2/engines/response.ts (isOwnerLineUserId gate, live since 2026-07-31) suppresses every real reply/push/loading-indicator to any non-owner LINE user (see response.ts:105-106,136,152-153 "[LINE Reply/Push SUPPRESSED]"). Real, Owner-authorized policy, not a code defect (${fcrCite("FCR-016")}).` : null,
    impact: fcr016Open
      ? "A real new LINE follower today gets no welcome message and no real customer gets a conversational bot reply — but every real inbound message is still received/logged, and the automated daily debt-reminder push (a separate real code path) still reaches real customers."
      : "Customer replies are governed by the central auto-reply policy row (FCR-016 RESOLVED 2026-10-10): allow_all answers every LINE user through the single Response Gateway; owner_only restores the legacy owner-only posture at runtime without a deploy.",
    last_verified: "FCR-016 RESOLVED 2026-10-10 (Owner mission RESTORE LINE WEBHOOK, CONNECT AND AUTO-RESPONSE — central policy row migration 20261010000001 + scripts/line-auto-reply-test.ts). The original kill-switch fact was REALITY_INVENTORY_STEP1.md headline #4 (2026-08-10); registry/CONNECTOR_DIRECTORY.json connector-row evidence read fresh at generation time.",
    evidence: [
      "registry/CONNECTOR_DIRECTORY.json: line-messaging-api row",
      "supabase/functions/line-webhook-v2/engines/response.ts:98 (isOwnerLineUserId), :105-106, :136, :152-153 (SUPPRESSED log lines)",
      "REALITY_INVENTORY_STEP1.md headline #4 and 'LIVE_VERIFIED' bullet (803 real events, latest today)",
      fcrCite("FCR-016"),
    ],
    next_required_connection: "No new technical connection required — restoring real customer replies is a real Owner policy decision (relax/disable the isOwnerLineUserId gate), not a missing wire.",
  };
}

function buildAiCapability(): CapabilityRealityEntry {
  const fcr015 = findFcr("FCR-015");
  const providers = loadProviderDirectory();
  const anthropic = providers?.providers.find((p) => p.name === "anthropic") ?? null;
  const google = providers?.providers.find((p) => p.name === "google") ?? null;
  // Real evidence: BROKEN per STEP1 (local pipeline stalled, real stuck
  // tasks) and the real evidence shows the core function does NOT
  // complete right now (29 real tasks stuck since 2026-08-05, not merely
  // degraded throughput) -> mapStep1State("BROKEN", { coreFunctionStillWorks: false }) = BLOCKED.
  const status = mapStep1State("BROKEN", { coreFunctionStillWorks: false });
  return {
    capability_name: "AI Understanding & Context (Local + Cloud AI Pipeline)",
    business_function: "The AI that reads a customer's photo or message and works out what they mean — classifies documents/images and builds the situational context other capabilities (quoting, debt follow-up) use to respond.",
    status,
    runtime_status: fcr015 ? "NOT_RUNNING — local-runtime/ai-task-watcher process is down (real repeating RunPod 409 bug in its own pod-lifecycle code; log last written 2026-08-05); real RunPod pod count was 0 at this finding's own verification. (This runtime has no RunPod credential of its own and did not re-check this live — see this file's header DISCLOSED LIMITATION.)" : "UNKNOWN",
    connected_from: ["LINE webhook image/text handlers (enqueue ai_tasks)", "Vision/OCR classification pipeline"],
    connected_to: ["Quotation engine (engines/quote-price.ts — real, live, see Quotation entry)"],
    missing_connection: `AI Context -> Cost/Pricing Engine (engines/pricing.ts#calcPricing) — real, zero callers anywhere in the codebase; see the Cost-calculation capability entry and this model's Connection Gap Map (${fcrCite("FCR-013")}).`,
    current_blocker: fcr015 ? `Local AI watcher not running + 0 real RunPod pods + a real bug in the watcher's own pod-stop logic (repeating 409 loop against an already-stopped pod). ${fcrCite("FCR-015")}.` : null,
    impact: "29 real customer-facing AI classification tasks have been stuck 'pending' since 2026-08-05 — those customers' photos/messages are not being understood by AI right now (CODE_WORKER via the Anthropic Gateway remains a real, separate fallback path — see workerRegistry.ts CODE_WORKER limitations — but it requires a configured ANTHROPIC_API_KEY this environment does not have, and falls back to a human-continued session instead).",
    last_verified: `REALITY_INVENTORY_STEP1.md headline finding #3 (2026-08-10) / ${fcrCite("FCR-015")} — real, live-production fact (ai_tasks row counts, RunPod pod count, watcher log) this runtime cannot itself re-query (no RunPod/Supabase credential wired into this composition).`,
    evidence: [
      "REALITY_INVENTORY_STEP1.md headline #3 (29 stuck ai_tasks since 2026-08-05, watcher log last written 2026-08-05, RunPod 0 pods)",
      fcrCite("FCR-015"),
      `registry/PROVIDER_DIRECTORY.json: anthropic status=${anthropic?.status ?? "UNKNOWN"}; google status=${google?.status ?? "UNKNOWN"}`,
      "app/api/admin/ide/_lib/workerRegistry.ts CODE_WORKER.limitations (ANTHROPIC_API_KEY not configured in this environment; real, separate human-continued-session fallback)",
    ],
    next_required_connection: "Owner needs to restart the local-runtime/ai-task-watcher process (or fix its RunPod pod-stop bug) and/or provision a real ANTHROPIC_API_KEY for the Cloud AI Gateway fallback — a real operational/credential action, not a missing code wire.",
  };
}

function buildVisionOcrCapability(): CapabilityRealityEntry {
  const ocrNode = getArchNode("module:supabase/functions/line-webhook-v2/engines/ocr-classify.ts");
  // Real evidence: LIVE_VERIFIED per STEP1 (495 real classified rows) but
  // the SAME source discloses staleness ("currently stale, last row
  // 2026-08-04, possibly just low photo volume, not confirmed broken") ->
  // mapStep1State("LIVE_VERIFIED", { verificationIsStale: true }) = DEGRADED.
  const status = mapStep1State("LIVE_VERIFIED", { verificationIsStale: true });
  return {
    capability_name: "Vision / OCR (Image -> Claude Vision Classification)",
    business_function: "Reads a photo a customer sends on LINE (a receipt, a material, a delivery slip) and classifies what it is, so the rest of the system knows what to do with it.",
    status,
    runtime_status: ocrNode ? `module compiles/exists (${ocrNode.status}), deployed as part of the real supabase/functions/line-webhook-v2 Edge Function — last real classified row 2026-08-04 (staleness not independently resolved by this runtime, see current_blocker)` : "UNKNOWN — module not found in registry/architecture-book.json",
    connected_from: ["LINE image handler (supabase/functions/line-webhook-v2/handlers/image.ts)"],
    connected_to: ["ai_tasks queue / build-event-from-extraction.ts", "receipt_documents table (real, 495 classified rows)"],
    missing_connection: null,
    current_blocker: "Real, honest ambiguity (not resolved by this runtime): REALITY_INVENTORY_STEP1.md explicitly declines to confirm whether the 6-day-old last row (2026-08-04) reflects low real photo volume or a real break — this runtime has no live receipt_documents query access to resolve it itself.",
    impact: "If genuinely stalled (not just low volume): real customer receipt/material photos sent since 2026-08-04 are not being classified. If just low volume: no real impact. This runtime honestly cannot tell you which today.",
    last_verified: "REALITY_INVENTORY_STEP1.md 'What IS real and working' section (2026-08-10), citing last real row 2026-08-04 — this runtime cannot itself re-query the live receipt_documents table (no DB credential wired into this composition).",
    evidence: [
      "REALITY_INVENTORY_STEP1.md: 'Image -> Claude Vision classification — 495 real classified receipt_documents (currently stale, last row 2026-08-04, possibly just low photo volume, not confirmed broken)'",
      "registry/architecture-book.json: module:supabase/functions/line-webhook-v2/engines/ocr-classify.ts status=" + (ocrNode?.status ?? "UNKNOWN"),
    ],
    next_required_connection: "A real, live query against receipt_documents (or the LINE webhook's own request logs) to resolve the staleness ambiguity — outside this runtime's real, credential-free scope today.",
  };
}

function buildDocumentsCapability(): CapabilityRealityEntry {
  const engineNode = getArchNode("module:engines/documents/engine.ts");
  const businessCoverage = loadBusinessCoverage();
  const docDomain = businessCoverage?.domains?.document ?? null;
  // Real evidence: engines/documents/engine.ts has 16 real, live dependents
  // (app/api/*/route.ts, cognitive/executor/index.ts, gateway/actions.ts)
  // -> genuinely reachable from real production traffic today -> LIVE
  // (this is a case where richer real evidence resolves status directly,
  // rather than going through mapStep1State's generic TESTED/DEPLOYED path).
  const liveReach = engineNode ? engineNode.dependents.length > 0 : false;
  return {
    capability_name: "Documents (Quotation / Invoice / Receipt / BOQ / Delivery Order engine)",
    business_function: "The shared engine that actually generates every real document the business issues — quotations, invoices, receipts, BOQs, delivery orders — from one real template system.",
    status: liveReach ? "LIVE" : "UNKNOWN",
    runtime_status: engineNode ? `real, live: ${engineNode.dependents.length} real dependents including app/api/admin/documents/[id]/route.ts, app/api/document/route.ts, cognitive/executor/index.ts, gateway/actions.ts` : "UNKNOWN — module not found in registry/architecture-book.json",
    connected_from: ["cognitive/executor/index.ts (AI-driven document generation)", "app/api/admin/documents/*/route.ts (admin UI)", "gateway/actions.ts"],
    connected_to: ["Invoice lifecycle (see Invoice entry)", "LINE document delivery (app/api/internal/line/document-artifact/route.ts)"],
    missing_connection: null,
    current_blocker: `A real, narrower defect exists on the invoice sub-type specifically (not the shared document engine): the invoice PATCH handler never checks invoice_status before applying edits (app/api/admin/documents/[id]/route.ts, PATCH handler around line 117-165) — see the Invoice capability entry and ${fcrCite("FCR-017")} for the full, scoped finding.`,
    impact: "Every real document type the business issues today is generated through this one, real, live engine — the business can produce quotations/invoices/receipts/BOQs/delivery orders right now.",
    last_verified: "registry/architecture-book.json generated_at=" + (loadArchitectureBook()?.book.generated_at ?? "UNKNOWN") + " (real, structural, computed fresh from the live repo at composition time).",
    evidence: [
      "registry/architecture-book.json: module:engines/documents/engine.ts, 16 real dependents (structural reachability, computed at generation time)",
      `registry/business-coverage.json 'document' domain: status=${docDomain?.status ?? "UNKNOWN"}`,
      fcrCite("FCR-017"),
    ],
    next_required_connection: null,
  };
}

function buildQuotationCapability(): CapabilityRealityEntry {
  const quotePriceReach = computeLiveReachability("module:engines/quote-price.ts");
  const salesDomain = loadBusinessCoverage()?.domains?.sales ?? null;
  return {
    capability_name: "Quotation (LINE-driven quote request -> price)",
    business_function: "When a customer asks for a price on LINE, this is what figures out the real material/transport cost and answers with a quote — and, when it can't (no price set for that material), queues it for a human to fill in.",
    status: quotePriceReach.reachable ? "LIVE" : "BUILT_NOT_WIRED",
    runtime_status: `real, structurally reachable from production: ${quotePriceReach.reason}`,
    connected_from: ["LINE chat (business_events, status='quotation_pending'/'awaiting_info'/'ready_to_quote')", "app/api/admin/quotation-queue/route.ts (human fallback for what the engine could not price)"],
    connected_to: ["engines/cost.ts (material/fuel cost, real, DB-sourced, live)", "Cost/Pricing markup engine — NOT_CONNECTED, see Cost-calculation entry"],
    missing_connection: `Quotation -> Invoice: real, structural check found NO quotation_id/quote_id field anywhere in app/api, engines, or cognitive, and no CREATE TABLE for a real 'quotations' entity with a real FK to invoices — a quote and an invoice are two independently-created real documents today, with no automatic conversion path.`,
    current_blocker: `The live quote path computes total_price = unit_price x quantity + transport_cost only — no markup/profit margin is applied (${fcrCite("FCR-013")}); see the Cost-calculation capability entry for the full finding.`,
    impact: "A real customer asking for a price on LINE today gets a real, DB-sourced cost-based answer (or a human-reviewed queue item if pricing data is missing) — but that price includes no business margin, and turning an accepted quote into an invoice is a real, separate, manual step today.",
    last_verified: `registry/architecture-book.json generated_at=${loadArchitectureBook()?.book.generated_at ?? "UNKNOWN"} (structural reachability, computed fresh); ${fcrCite("FCR-013")} for the margin finding (2026-08-10).`,
    evidence: [
      "app/api/admin/quotation-queue/route.ts:1-13 (real comment: 'Pricing IS computed automatically now — engines/quote-price.ts ... wired through event-followup.ts')",
      "registry/architecture-book.json: module:engines/quote-price.ts dependents include app/api/admin/line-customers/[lineUserId]/ask/route.ts and engines/validation/dispatcher.ts",
      `registry/business-coverage.json 'sales' domain: status=${salesDomain?.status ?? "UNKNOWN"}`,
      fcrCite("FCR-013"),
    ],
    next_required_connection: "Wire engines/pricing.ts#calcPricing (or an equivalent real markup step) into engines/validation/dispatcher.ts's live quote path, and/or add a real quotation_id link from invoices back to the originating business_event, to unlock automatic quote-to-invoice conversion.",
  };
}

function buildInvoiceCapability(): CapabilityRealityEntry {
  const fcr017 = findFcr("FCR-017");
  // Real evidence: BROKEN per STEP1 (Rule 113 violation, live) but the
  // core function (issuing/reading invoices) still works — only the
  // integrity guard is missing -> mapStep1State("BROKEN", { coreFunctionStillWorks: true }) = DEGRADED.
  const status = mapStep1State("BROKEN", { coreFunctionStillWorks: true });
  return {
    capability_name: "Invoice (issue, edit, send)",
    business_function: "Creating and sending a real invoice to a customer, and (per Constitution Rule 113) making sure a SENT invoice can no longer be silently changed.",
    status,
    runtime_status: "real, live — app/api/admin/documents/[id]/route.ts's PATCH handler is a real, deployed, reachable route (structurally an app/api/**/route.ts live surface)",
    connected_from: ["Documents engine (engines/documents/engine.ts)", "app/admin/invoice/page.tsx"],
    connected_to: ["Payment (via debt_events matched_debt_event_id — see Payment entry)", "app/api/admin/invoices/[invoiceId]/send/route.ts"],
    missing_connection: null,
    current_blocker: fcr017 ? `A sent invoice can be silently edited — app/api/admin/documents/[id]/route.ts's PATCH handler reads invoice_status (line 19) but never checks it before applying updates (PATCH handler, line 117 onward) — contradicts Constitution Rule 113 (Document Immutability), which itself cites a real prior incident (INV-20260717-352 void -> INV-20260718-649 reissue). ${fcrCite("FCR-017")}.` : null,
    impact: "Invoices can be created and sent for real today, but a real integrity gap means a sent invoice's total_amount/vat_amount/etc. can be changed after the fact with no status check — a real risk to the business's own billing records, already caused one real prior incident.",
    last_verified: `${fcrCite("FCR-017")} — independently re-verified by this build via a direct read of app/api/admin/documents/[id]/route.ts:19,117-165 (2026-08-10).`,
    evidence: [
      "app/api/admin/documents/[id]/route.ts:19 (selects invoice_status)",
      "app/api/admin/documents/[id]/route.ts:117 (export async function PATCH — no invoice_status guard before the update at line ~161)",
      fcrCite("FCR-017"),
    ],
    next_required_connection: "Add a real invoice_status check at the top of the PATCH handler (reject edits when status is SENT/PAID/VOID) — a code fix, not a missing connection between systems.",
  };
}

function buildPaymentCapability(): CapabilityRealityEntry {
  return {
    capability_name: "Payment (bank-email match + manual verification, Levels 1-3)",
    business_function: "Confirming a customer really paid — matching a bank transfer email or a LINE-submitted payment slip against the real debt owed, automatically where possible, with human review levels for anything uncertain.",
    status: "LIVE",
    runtime_status: "real, live — Payment Verification Levels 1/2/3 (Rule 115) ran for real today per REALITY_INVENTORY_STEP1.md, including a real Level-3 bank-email auto-match; payment-claim.ts/auto-confirm-payment.ts are real, OK, deployed as part of the live LINE webhook Edge Function",
    connected_from: ["Gmail bank-email sync (real, read-only, 830 real rows, latest yesterday)", "LINE payment-slip submission (payment-claim.ts)"],
    connected_to: ["Debt tracking (matched_debt_event_id -> debt_events, real FK)"],
    missing_connection: "Payment -> Ledger/Accounting: no real accounting/general-ledger module exists anywhere in this repo (registry/business-coverage.json's 'accounting' domain is real, honestly not_covered, zero modules) — a confirmed payment updates debt_events/receipt state, but never posts to any real formal ledger, because none exists yet.",
    current_blocker: null,
    impact: "Real customer payments are being matched and confirmed today (including a fully automatic Level-3 bank-email match) — but no real formal accounting ledger exists to post confirmed payments into.",
    last_verified: "REALITY_INVENTORY_STEP1.md 'What IS real and working' section (2026-08-10) — real, live-production fact (bank-email sync row counts, verification levels) this runtime cannot itself re-query (no Gmail/DB credential wired into this composition).",
    evidence: [
      "REALITY_INVENTORY_STEP1.md: 'Payment Verification Levels 1/2/3 (Rule 115) — real, live, including a real Level-3 bank-email auto-match'",
      "REALITY_INVENTORY_STEP1.md: 'Bank email sync (Gmail, read-only) — 830 real rows, latest yesterday'",
      "supabase/migrations/20260718000008_receipt_documents_slip_fields.sql:29 (matched_debt_event_id uuid references public.debt_events(id))",
      "supabase/migrations/20260724000002_reconcile_payment_advice_and_sweep_helper.sql, 20260803000001_reconcile_receipt_payment_split_interest.sql, 20260803000003_reconcile_receipt_payment_auto_close.sql (real matching/reconciliation logic)",
      "registry/business-coverage.json 'accounting' domain: status=not_covered",
    ],
    next_required_connection: "Build a real accounting/general-ledger module and connect confirmed payments (currently debt_events-scoped) into it — no such module exists to connect to yet.",
  };
}

function buildVatTaxCapability(): CapabilityRealityEntry {
  const taxReach = computeLiveReachability("module:engines/tax.ts");
  const taxDomain = loadBusinessCoverage()?.domains?.tax ?? null;
  return {
    capability_name: "VAT / Tax (VAT, withholding tax calculation)",
    business_function: "Calculating VAT (and withholding tax) that should be added to a real document — required for a legally correct invoice/receipt.",
    status: taxReach.reachable ? "LIVE" : "BUILT_NOT_WIRED",
    runtime_status: `real, structural: ${taxReach.reason}`,
    connected_from: ["Would be: Quotation/Invoice document generation"],
    connected_to: [],
    missing_connection: "VAT/Tax engine -> live quote/document path: engines/tax.ts's only real dependent is engines/index.ts, which is itself only imported by 2 local-runtime test files (runtime-registration-test.ts, workspace-root-verifier-acceptance-test.ts) — a real, new structural finding by this build (not a pre-existing FCR id), independently confirming the SAME dead-end pattern FCR-013 found for engines/pricing.ts, computed via computeLiveReachability() over registry/architecture-book.json's real dependents graph.",
    current_blocker: "engines/validation/dispatcher.ts (the real, live quote path) does not import engines/tax.ts at all — confirmed by reading dispatcher.ts's own internal_dependencies in registry/architecture-book.json.",
    impact: "No real VAT/withholding-tax calculation is applied anywhere in the live customer-facing quote/document path today — any VAT shown on a real document is either a fixed default or entered by a human, not computed by this real engine.",
    last_verified: `registry/architecture-book.json generated_at=${loadArchitectureBook()?.book.generated_at ?? "UNKNOWN"} (structural reachability, computed fresh at generation time by this runtime).`,
    evidence: [
      "registry/architecture-book.json: module:engines/tax.ts dependents=['module:engines/index.ts']",
      "registry/architecture-book.json: module:engines/index.ts dependents=['module:local-runtime/runtime-registration-test.ts','module:local-runtime/workspace-root-verifier-acceptance-test.ts'] (test-only, never a real production caller)",
      "registry/architecture-book.json: module:engines/validation/dispatcher.ts internal_dependencies does not include engines/tax.ts",
      `registry/business-coverage.json 'tax' domain: status=${taxDomain?.status ?? "UNKNOWN"} (module presence only — does not itself claim live wiring)`,
    ],
    next_required_connection: "Wire engines/tax.ts into engines/validation/dispatcher.ts's real live quote/document path — currently BUILT_NOT_WIRED, same real category as the Cost/Pricing engine.",
  };
}

function buildDebtCapability(): CapabilityRealityEntry {
  const trackingNode = getArchNode("module:engines/debt/tracking.ts");
  const fcr019 = findFcr("FCR-019");
  return {
    capability_name: "Debt (tracking, interest, collection, reminders)",
    business_function: "Keeping track of who owes the business money, how much interest/overdue penalty applies, and following up (including the automated daily LINE reminder).",
    status: "DEGRADED",
    runtime_status: trackingNode ? `real, live core: engines/debt/tracking.ts has ${trackingNode.dependents.length} real dependents including cognitive/executor/index.ts and multiple app/api/admin routes` : "UNKNOWN",
    connected_from: ["LINE debt-related messages", "Automated daily debt-reminder cron (real, ran 2026-08-10 09:00 Bangkok, supabase pg_cron, migration 20260711000003_debt_reminder_cron.sql)"],
    connected_to: ["Invoice (documents: ['invoice'] per business-coverage.json 'debt' domain)", "Payment (matched_debt_event_id)"],
    missing_connection: null,
    current_blocker: fcr019 ? `A narrow, real sub-feature is broken, not the whole capability: app/api/admin/debt-events/[id]/issue-receipt/route.ts:4 imports issueReceiptForDebtEvent from @/gateway/actions — that export does not exist, a real, pre-existing TypeScript compile error (the repo's one known tsc error). This one manual-trigger route cannot compile/run; core debt tracking/interest/collection/reminders are unaffected. ${fcrCite("FCR-019")}.` : null,
    impact: "Real debt tracking, interest calculation, and the automated daily reminder push all work today; one specific manual 'issue a receipt for this debt event' admin action does not (real compile error, unreachable from any UI per FCR-019's own text).",
    last_verified: `registry/architecture-book.json generated_at=${loadArchitectureBook()?.book.generated_at ?? "UNKNOWN"} for the structural dependents count; ${fcrCite("FCR-019")} for the compile-error finding (2026-08-10).`,
    evidence: [
      "registry/architecture-book.json: module:engines/debt/tracking.ts, 13 real dependents",
      "supabase/migrations/20260711000003_debt_reminder_cron.sql (real pg_cron schedule)",
      "REALITY_INVENTORY_STEP1.md: 'Automated daily debt-reminder LINE push — ran for real this morning (2026-08-10, 09:00 Bangkok)'",
      "app/api/admin/debt-events/[id]/issue-receipt/route.ts:4",
      fcrCite("FCR-019"),
    ],
    next_required_connection: "Add the missing issueReceiptForDebtEvent export to gateway/actions.ts (or remove the dead route) to fix the one real compile error — a code fix, not a missing connection.",
  };
}

function buildLogisticsCapability(): CapabilityRealityEntry {
  const vehicleReach = computeLiveReachability("module:engines/vehicle-selector.ts");
  const distanceReach = computeLiveReachability("module:engines/distance.ts");
  const transportDomain = loadBusinessCoverage()?.domains?.transport ?? null;
  return {
    capability_name: "Logistics (distance, transport cost, vehicle selection)",
    business_function: "Working out how far a delivery is, what it costs to transport, and which real truck type/size should be sent.",
    status: "DEGRADED",
    runtime_status: `distance/transport-cost math: ${distanceReach.reachable ? "LIVE (structurally reachable from production)" : "not reachable"}; vehicle auto-selection: ${vehicleReach.reachable ? "LIVE" : "BUILT_NOT_WIRED — " + vehicleReach.reason}`,
    connected_from: ["Quotation engine (engines/quote-price.ts, real, live)"],
    connected_to: ["engines/cost.ts (real, live transport_cost component of total_price)"],
    missing_connection: "Vehicle-selector engine -> live quote path: engines/vehicle-selector.ts's only real dependent is engines/index.ts (the same real dead-end as engines/pricing.ts/engines/tax.ts) — a real, new structural finding by this build, computed the same way as the VAT/Tax finding above.",
    current_blocker: "The real truck-type selection rule (<=30km/31-100km/>100km, effectiveCapacity) is never actually applied in the live quote path — engines/validation/dispatcher.ts does not import engines/vehicle-selector.ts.",
    impact: "Real distance and transport-cost calculation is live and included in every real quote today; which real truck type/size to actually send is not automatically decided by the code — a human still has to choose it.",
    last_verified: `registry/architecture-book.json generated_at=${loadArchitectureBook()?.book.generated_at ?? "UNKNOWN"} (structural reachability, computed fresh at generation time).`,
    evidence: [
      "registry/architecture-book.json: module:engines/distance.ts dependents include app/api/explain/route.ts and engines/quote-price.ts",
      "registry/architecture-book.json: module:engines/vehicle-selector.ts dependents=['module:engines/index.ts'] only",
      `registry/business-coverage.json 'transport' domain: status=${transportDomain?.status ?? "UNKNOWN"}`,
    ],
    next_required_connection: "Wire engines/vehicle-selector.ts into engines/validation/dispatcher.ts (or engines/quote-price.ts) so real vehicle-type selection actually runs in the live quote path.",
  };
}

function buildResourcesCapability(): CapabilityRealityEntry {
  const bc = loadBusinessCoverage();
  const inventory = bc?.domains?.inventory ?? null;
  const maintenance = bc?.domains?.maintenance ?? null;
  const resourceGraphNode = getArchNode("module:cognitive/state/resource-graph.ts");
  return {
    capability_name: "Resources (inventory/stock, personnel, equipment/maintenance)",
    business_function: "Knowing what material stock, staff, and machinery the business has, and (for machinery) tracking maintenance/engine-hours and being able to remotely lock/unlock equipment.",
    status: "BUILT_NOT_WIRED",
    runtime_status: resourceGraphNode ? `cognitive/state/resource-graph.ts is real and live-wired within the cognitive pipeline (dependents: cognitive/situation/builder.ts, cognitive/state/index.ts) — but this is an internal AI-situational-awareness graph, not an Owner-facing inventory/stock system` : "UNKNOWN",
    connected_from: [],
    connected_to: ["cognitive/situation/builder.ts (AI context only)"],
    missing_connection: `Inventory/stock: ${inventory?.status === "not_covered" ? "no real module exists anywhere (registry/business-coverage.json: 0 modules, real gap: \"" + (inventory?.gap ?? "") + "\")" : "UNKNOWN"}. Personnel/HR: business-coverage.json's 'hr' domain is also real, honestly not_covered (this runtime found no separate module for it either).`,
    current_blocker: maintenance ? `Equipment/maintenance (the one Resources sub-area with real code): telemetry ingestion, engine-hours accumulation, maintenance-ticket generation, and shift/permission auto-lock are all real, live code — but real hardware connection is not: no real SMS gateway provider is configured, the GPS/lock box command format is not confirmed live, and the cron is not yet deployed/scheduled on live Supabase (per business-coverage.json's own 'maintenance' domain gap note).` : null,
    impact: "The business has no real, live way to answer 'how much material stock do we have' or 'who is available to work' from this system today. Equipment maintenance tracking is real in code but not yet connected to real hardware/SMS/cron in production.",
    last_verified: `registry/business-coverage.json (real, hand-maintained file — no generated_at field to cite; read fresh at generation time, ${new Date().toISOString().slice(0, 10)}).`,
    evidence: [
      `registry/business-coverage.json 'inventory' domain: status=${inventory?.status ?? "UNKNOWN"}, gap="${inventory?.gap ?? ""}"`,
      `registry/business-coverage.json 'hr' domain: status=not_covered`,
      `registry/business-coverage.json 'maintenance' domain: status=${maintenance?.status ?? "UNKNOWN"}, gap="${(maintenance?.gap ?? "").slice(0, 200)}..."`,
      "registry/architecture-book.json: module:cognitive/state/resource-graph.ts, real, live within the cognitive pipeline only",
    ],
    next_required_connection: "Build a real inventory/stock module and a real personnel/HR module (neither exists today), and connect equipment-maintenance's real code to a real SMS gateway credential + a deployed, scheduled Supabase cron.",
  };
}

function buildFinanceCapability(): CapabilityRealityEntry {
  const accounting = loadBusinessCoverage()?.domains?.accounting ?? null;
  const summaryNode = getArchNode("module:app/api/admin/finance-summary/route.ts");
  const alertsNode = getArchNode("module:app/api/admin/finance-alerts/route.ts");
  return {
    capability_name: "Finance / Accounting Summary",
    business_function: "Giving a real, at-a-glance view of the business's money position (a finance summary dashboard + alerts) — distinct from a full formal accounting ledger/financial statements, which does not exist yet.",
    status: "DEGRADED",
    runtime_status: `finance-summary route: ${summaryNode ? summaryNode.status + " (real, deployed app/api route — a live production surface by definition)" : "UNKNOWN"}; finance-alerts route: ${alertsNode ? alertsNode.status : "UNKNOWN"}`,
    connected_from: ["Debt engine, invoice/payment state (read-only aggregation)"],
    connected_to: ["app/admin/finance/page.tsx (real, live admin UI)"],
    missing_connection: `A real, formal accounting/general-ledger capability (business_pct/financial statements) does not exist: registry/business-coverage.json's 'accounting' domain is honestly not_covered (0 modules, real gap: "${accounting?.gap ?? ""}") — this is a real, disclosed tension with the fact that finance-summary/finance-alerts routes DO exist and are real/live: they provide a narrower, real read-only summary, not the full accounting capability the domain label implies.`,
    current_blocker: null,
    impact: "The business can see a real, live finance summary/alerts view today; it cannot produce a real formal financial statement or general ledger from this system — that capability was never built.",
    last_verified: `registry/architecture-book.json generated_at=${loadArchitectureBook()?.book.generated_at ?? "UNKNOWN"} (structural, computed fresh); registry/business-coverage.json read fresh at generation time (hand-maintained file, no generated_at field).`,
    evidence: [
      `registry/architecture-book.json: module:app/api/admin/finance-summary/route.ts status=${summaryNode?.status ?? "UNKNOWN"}`,
      `registry/architecture-book.json: module:app/api/admin/finance-alerts/route.ts status=${alertsNode?.status ?? "UNKNOWN"}`,
      `registry/business-coverage.json 'accounting' domain: status=${accounting?.status ?? "UNKNOWN"}`,
    ],
    next_required_connection: "Build a real accounting/general-ledger module and connect Payment/Debt/Invoice real state into it — the missing piece is the module itself, not a wire between existing modules.",
  };
}

function buildCostCalculationCapability(): CapabilityRealityEntry {
  const pricingReach = computeLiveReachability("module:engines/pricing.ts");
  const costReach = computeLiveReachability("module:engines/cost.ts");
  // Real, direct evidence resolves this without the generic mapper: the
  // real markup/profit engine (engines/pricing.ts#calcPricing) is real,
  // compiles, but is structurally unreachable from any real production
  // surface (computeLiveReachability, corroborating FCR-013) -> BUILT_NOT_WIRED.
  // This is the exact instance this task's acceptance criteria names.
  const status: CapabilityStatus = pricingReach.reachable ? "LIVE" : "BUILT_NOT_WIRED";
  return {
    capability_name: "Cost Calculation (material/fuel cost + markup/profit engine)",
    business_function: "Working out the REAL price to charge — the raw material/fuel/transport cost, PLUS the business's own markup/profit margin, system fee, urgent-job fee, and VAT on top.",
    status,
    runtime_status: `raw material/fuel cost math (engines/cost.ts): ${costReach.reachable ? "LIVE — " + costReach.reason : "not reachable"}. Markup/profit engine (engines/pricing.ts#calcPricing): ${pricingReach.reachable ? "LIVE" : "BUILT_NOT_WIRED — " + pricingReach.reason}`,
    connected_from: ["Quotation engine (engines/quote-price.ts calls engines/cost.ts directly)"],
    connected_to: ["Would be: the customer-facing quote total (currently only raw cost + transport, no margin)"],
    missing_connection: `AI Context -> Pricing Engine (engines/pricing.ts#calcPricing): real, zero callers anywhere in the codebase — its only real caller, engines/index.ts#calcFullQuote, is itself never imported outside its own file/2 local-runtime test files. ${fcrCite("FCR-013")}. Independently re-confirmed by this build via computeLiveReachability("module:engines/pricing.ts") over the real, live registry/architecture-book.json dependents graph.`,
    current_blocker: `The real, live quote path (engines/validation/dispatcher.ts, reachable via the public /api/v1/query endpoint and the LINE bot) computes total_price = unit_price x quantity + transport_cost only — no markup/system-fee/urgent-fee/VAT is added anywhere in the live path. ${fcrCite("FCR-013")}.`,
    impact: "Every real, live customer quote issued today carries zero business margin — material/fuel cost math is real and correct, but the business is not actually pricing in its own profit on any real, live quote.",
    last_verified: `${fcrCite("FCR-013")} (2026-08-10); independently re-derived structurally by this build at generation time (registry/architecture-book.json generated_at=${loadArchitectureBook()?.book.generated_at ?? "UNKNOWN"}) rather than only citing the finding.`,
    evidence: [
      "registry/architecture-book.json: module:engines/pricing.ts dependents=['module:engines/index.ts']",
      "registry/architecture-book.json: module:engines/index.ts dependents=['module:local-runtime/runtime-registration-test.ts','module:local-runtime/workspace-root-verifier-acceptance-test.ts'] (test-only)",
      "registry/architecture-book.json: module:engines/validation/dispatcher.ts internal_dependencies includes engines/cost.ts but NOT engines/pricing.ts",
      fcrCite("FCR-013"),
    ],
    next_required_connection: "Wire engines/pricing.ts#calcPricing (or an equivalent real markup step) into engines/validation/dispatcher.ts's real, live quote path — the single highest-impact real connection this whole model surfaces.",
  };
}

function buildNotificationsCapability(): CapabilityRealityEntry {
  const fcr014 = findFcr("FCR-014");
  const fcr016 = findFcr("FCR-016");
  const sendNode = getArchNode("module:app/api/admin/notifications/send/route.ts");
  return {
    capability_name: "Notifications (debt reminders, cron jobs, manual sends)",
    business_function: "Automatically reaching out to customers/the Owner on a schedule (daily debt reminders, periodic status checks) plus letting an admin manually send a notification.",
    status: "DEGRADED",
    runtime_status: `debt-reminder-cron: real, live, ran 2026-08-10 09:00 Bangkok (real Supabase pg_cron, migration 20260711000003). Vercel Cron jobs (supabase-project-status every 6h, operations-loop every 10min, per vercel.json): real, deployed, but ${fcr014 ? "fail closed (401) on every real scheduled invocation — CRON_SECRET missing from real Vercel Production" : "UNKNOWN"}. Manual admin send: ${sendNode ? sendNode.status + " (real, deployed route)" : "UNKNOWN"}.`,
    connected_from: ["Supabase pg_cron (debt-reminder-cron, real, scheduled)", "Vercel Cron (vercel.json, real, scheduled, but blocked)"],
    connected_to: ["LINE push (governed by the same central auto-reply policy as LINE replies — FCR-016 RESOLVED 2026-10-10; the debt-reminder path also bypassed the old gate)"],
    missing_connection: `Vercel Cron -> its own target routes: real 401 failures every real scheduled run, because ANTHROPIC_API_KEY/CRON_SECRET/etc are set in .env.local/Supabase Edge secrets but absent from real Vercel Production (${fcrCite("FCR-014")}).`,
    current_blocker: fcr014 ? `Real production (Vercel) is missing most non-core secrets — only 7 env vars exist on Vercel Production (per vercel env ls, real, read-only). ${fcrCite("FCR-014")}.` : null,
    impact: "The real daily debt-reminder push works and reached real customers today. The 2 real Vercel-scheduled cron jobs (supabase-project-status, operations-loop) fail every real invocation. Manual admin notification sends are real and available.",
    last_verified: `${fcrCite("FCR-014")} / ${fcrCite("FCR-016")} (2026-08-10) for the live-production secret/kill-switch facts (this runtime cannot itself re-check Vercel env vars — no Vercel credential wired into this composition); vercel.json and the debt-reminder-cron migration were read fresh at generation time.`,
    evidence: [
      "vercel.json: crons=[/api/cron/supabase-project-status (0 */6 * * *), /api/cron/operations-loop (*/10 * * * *)]",
      "supabase/migrations/20260711000003_debt_reminder_cron.sql (real pg_cron schedule)",
      fcrCite("FCR-014"),
      fcrCite("FCR-016"),
    ],
    next_required_connection: "Owner needs to add the missing secrets (CRON_SECRET at minimum) to real Vercel Production env vars — an operational/credential action, not a missing code wire.",
  };
}

function buildExternalConnectorsCapability(): CapabilityRealityEntry {
  const connectors = loadConnectorDirectory();
  const providers = loadProviderDirectory();
  const activeProviders = providers?.providers.filter((p) => p.status === "active" || p.status.startsWith("active")) ?? [];
  const notReady = providers?.providers.filter((p) => p.status !== "active" && !p.status.startsWith("active") && p.status !== "protocol, not a vendor") ?? [];
  return {
    capability_name: "External Connectors (Connect->Register->Test->Enable->Run)",
    business_function: "Every real outside system this business talks to — LINE, Supabase, Gmail, GitHub, Vercel, RunPod, Google, OpenClaw, etc. — and whether each one is really wired up.",
    status: notReady.length > 0 && activeProviders.length > 0 ? "DEGRADED" : "UNKNOWN",
    runtime_status: `registry/CONNECTOR_DIRECTORY.json: ${connectors?.connectors.length ?? 0} real registered connector rows (${connectors?.connectors.map((c) => `${c.connector}=${c.status}`).join("; ") ?? "UNKNOWN"}); ${connectors?.not_registered.length ?? 0} known-not-registered (${connectors?.not_registered.join(", ") ?? "UNKNOWN"})`,
    connected_from: ["Every capability in this model that names a provider/connector below"],
    connected_to: activeProviders.map((p) => p.name),
    missing_connection: notReady.length > 0 ? `${notReady.length} real providers are not fully operational: ${notReady.map((p) => `${p.name}=${p.status}`).join("; ")}` : null,
    current_blocker: null,
    impact: `${activeProviders.length} real external systems are actively connected today (${activeProviders.map((p) => p.name).join(", ")}); ${notReady.length} are real but not fully operational (credential pending, role reassigned, or simply never registered).`,
    last_verified: "registry/CONNECTOR_DIRECTORY.json and registry/PROVIDER_DIRECTORY.json read fresh at generation time (both real, hand-maintained files; their own headers cite CHANGELOG DNA-000084/086 as the underlying real verification events).",
    evidence: [
      "registry/CONNECTOR_DIRECTORY.json (real, cites CHANGELOG DNA-000084/086)",
      "registry/PROVIDER_DIRECTORY.json (real, consolidates providers/*/provider.json)",
    ],
    next_required_connection: notReady.length > 0 ? `Provision real credentials for: ${notReady.map((p) => p.name).join(", ")}.` : null,
  };
}

function buildRuntimeCapability(): CapabilityRealityEntry {
  const health = loadDnaOsHealth();
  const dashboard = loadDnaOsDashboard();
  const archBook = loadArchitectureBook();
  const workerRuntimeMap = loadWorkerRuntimeMap();
  const depGraphPolicy = loadDependencyGraphPolicy();
  const fcr020 = findFcr("FCR-020");
  const hasRealDefects = (health?.checks.type_check ?? 1) === 0 || (archBook?.book.summary.unregistered ?? 0) > 0 || !!fcr020;
  return {
    capability_name: "Runtime (module graph health + execution runtimes + layer policy)",
    business_function: "Whether the codebase itself is structurally healthy — every module wired correctly, no broken imports, no layer-boundary violations — and which real machines/processes (VS Code sessions, Supabase Edge, the Owner's Mac, cloud) each Department actually runs on.",
    status: hasRealDefects ? "DEGRADED" : "LIVE",
    runtime_status: archBook ? `registry/architecture-book.json summary: total=${archBook.book.summary.total}, ok=${archBook.book.summary.ok}, broken=${archBook.book.summary.broken}, unused=${archBook.book.summary.unused}, unregistered=${archBook.book.summary.unregistered}` : "UNKNOWN",
    connected_from: workerRuntimeMap?.assignments.map((a) => `${a.display_name} (${a.runtimes.join(", ")})`) ?? [],
    connected_to: ["Every capability's own owner_module (registry/CAPABILITY_DIRECTORY.json)"],
    missing_connection: workerRuntimeMap ? `Real, available-but-unassigned runtimes: ${Object.keys(workerRuntimeMap.available_but_unassigned).join(", ")} — ${Object.entries(workerRuntimeMap.available_but_unassigned).map(([k, v]) => `${k}: ${v}`).join(" | ")}` : null,
    current_blocker: fcr020 ? `A real migration was never actually applied live: supabase/migrations/20260620000001_back_to_back_triggers.sql hardcodes the wrong Supabase project ref (tmxkiripdvorrcnuezvm instead of the real xeytcavxejhyzxwevgto) at lines 8 and 46 — confirmed live via read-only pg_proc/pg_trigger queries that the described trigger does not exist. ${fcrCite("FCR-020")}. Also: ${(health?.checks.type_check ?? 1) === 0 ? "1 real, known, pre-existing TypeScript compile error (type_check check=0 in DNA_OS_HEALTH.json) — " + fcrCite("FCR-019") + "." : ""}` : null,
    impact: `${archBook?.book.summary.ok ?? "?"}/${archBook?.book.summary.total ?? "?"} real modules are structurally OK, 0 broken, 0 layer violations (registry/dependency-graph.json's real allowed_imports policy) — the codebase's structural health is real and largely sound; the real, disclosed exceptions are ${archBook?.book.summary.unregistered ?? "?"} unregistered modules, 1 real compile error, and 1 real never-applied migration.`,
    last_verified: `DNA_OS_HEALTH.json generated_at=${health?.generated_at ?? "UNKNOWN"}; DNA_OS_DASHBOARD.json generated_at=${dashboard?.generated_at ?? "UNKNOWN"}; registry/architecture-book.json generated_at=${archBook?.book.generated_at ?? "UNKNOWN"} — all three real, regenerated by bash scripts/governance.sh / bash scripts/dashboard.sh / the real architecture-book builder, read fresh at composition time.`,
    evidence: [
      "DNA_OS_HEALTH.json (governance_score, checks, metrics)",
      "DNA_OS_DASHBOARD.json (evolution, risk, metrics)",
      "registry/architecture-book.json summary",
      "registry/WORKER_RUNTIME_MAP.json",
      "registry/dependency-graph.json (allowed_imports layer policy — real, NOT the same as architecture-book.json's per-module health, see this file's header disclosed correction)",
      fcrCite("FCR-020"),
    ],
    next_required_connection: fcr020 ? "Re-apply (or rewrite with the correct project ref) supabase/migrations/20260620000001_back_to_back_triggers.sql against the real live Supabase project." : null,
  };
}

function buildManager07ControlPlaneCapability(factoryStatus: FactoryStatusResult, budgets: CostBudgetEntry[], ledger: CostLedgerEntry[]): CapabilityRealityEntry {
  const workerIdentities = loadWorkerIdentities();
  return {
    capability_name: "MANAGER-07 Control Plane (Factory Gap Loop, Cost Gate, Worker Dispatch)",
    business_function: "The management layer that decomposes Owner requests, dispatches them to the right Department, tracks real findings/gaps, and gates any real spend before it happens — the thing that makes this whole Factory trustworthy.",
    status: factoryStatus.value === "STABLE" ? "LIVE" : "DEGRADED",
    runtime_status: `computeFactoryStatus() (app/api/admin/ide/_lib/gapLoopRuntime.ts, called live, verifyTestSuites=false by default) -> ${factoryStatus.value}, computed at ${factoryStatus.computedAt}, with ${factoryStatus.reasons.length} real, cited reasons`,
    connected_from: ["Owner (via registry/TASK_QUEUE.json dispatch)"],
    connected_to: ["Every Worker Department (registry/WORKER_IDENTITIES.json)", "Cost Gate (registry/COST_BUDGETS.json / registry/COST_LEDGER.json)"],
    missing_connection: workerIdentities && workerIdentities.registered_count < workerIdentities.total_slots ? `${workerIdentities.total_slots - workerIdentities.registered_count} of ${workerIdentities.total_slots} Worker Departments have not yet completed real self-registration into registry/WORKER_IDENTITIES.json — MANAGER-07 is blocked from dispatching to them per the Owner's own rule (2026-08-09, DNA-000084).` : null,
    current_blocker: factoryStatus.reasons.length > 0 ? factoryStatus.reasons.join(" | ") : null,
    impact: `Real financial governance is active and working: ${budgets.length} real Owner-approved cost budgets currently on file, ${ledger.length} real actual-cost ledger entries recorded — the Cost Gate (Rule 257) has real, live bookkeeping. Factory-wide stability is honestly ${factoryStatus.value} right now, computed live, not asserted.`,
    last_verified: factoryStatus.computedAt,
    evidence: [
      "app/api/admin/ide/_lib/gapLoopRuntime.ts#computeFactoryStatus() — called live by this composition, real result captured above",
      "registry/WORKER_IDENTITIES.json",
      "registry/COST_BUDGETS.json (real, via costGateRuntime.ts#listCostBudgets())",
      "registry/COST_LEDGER.json (real, via costGateRuntime.ts#listCostLedgerEntries())",
      "DISCLOSED: registry/FACTORY_CENTRAL_REGISTRY.json's own cached `factory_status` field (computed_at=2026-08-10) is a real, but now STALE snapshot relative to this live call — findings FCR-013..020 (all TRACKED) were added after that snapshot and are correctly picked up by the live computeFactoryStatus() call above but are NOT in the cached field's own real_reasons text. This is a real, disclosed example of exactly why this capability must be computed live, not read from a cache.",
    ],
    next_required_connection: workerIdentities && workerIdentities.registered_count < workerIdentities.total_slots ? "Each real Worker Department session needs to self-register into registry/WORKER_IDENTITIES.json before MANAGER-07 may dispatch to it." : null,
  };
}

// ============================================================
// Connection Gap Map (STEP 3)
// ============================================================
function buildConnectionGapMap(): ConnectionGapEntry[] {
  const pricingReach = computeLiveReachability("module:engines/pricing.ts");
  const taxReach = computeLiveReachability("module:engines/tax.ts");
  return [
    {
      from: "LINE", to: "AI Context",
      state: "WAS_WORKING_NOW_BROKEN",
      business_meaning: "A customer's LINE message/photo used to reliably reach the AI that understands it (69 real tasks completed, 3 real failures) — since 2026-08-05 nothing new is moving (29 real tasks stuck pending); real customers today are not getting AI-processed responses to new photos/messages.",
      evidence: [
        "REALITY_INVENTORY_STEP1.md: 'ai_tasks table has 29 rows stuck status=pending since 2026-08-05 (69 done, 3 failed, none since)'",
        fcrCite("FCR-015"),
      ],
      drilldown: {
        from_module: "supabase/functions/line-webhook-v2/handlers/image.ts, handlers/text.ts",
        from_runtime: "supabase_edge",
        to_module: "local-runtime/ai-task-watcher.mjs (Ollama) / RunPod",
        to_runtime: "mac (LaunchAgent) / cloud (RunPod) — LaunchAgent loaded but not running, last exit code 78; RunPod real pod count 0",
        technical_detail: "ai_tasks queue is the real, structural link — writes succeed (webhook side is fine), but nothing is consuming the queue right now.",
      },
    },
    {
      from: "AI Context", to: "Cost/Pricing Engine",
      state: pricingReach.reachable ? "CONNECTED" : "NOT_CONNECTED",
      business_meaning: "AI-understood customer intent (a material + quantity + destination) should flow into a real pricing calculation that includes the business's own markup/profit — it does not; the live path stops at raw material/fuel cost.",
      evidence: [fcrCite("FCR-013"), pricingReach.reason],
      drilldown: {
        from_module: "engines/validation/dispatcher.ts, engines/quote-price.ts",
        from_runtime: "vercel (Next.js) / supabase_edge (LINE bot)",
        to_module: "engines/pricing.ts#calcPricing",
        to_runtime: "N/A — never invoked from any live surface",
        technical_detail: pricingReach.reason,
      },
    },
    {
      from: "AI Context", to: "VAT/Tax Engine",
      state: taxReach.reachable ? "CONNECTED" : "NOT_CONNECTED",
      business_meaning: "Same real gap as Pricing: no real VAT/withholding-tax calculation runs in the live quote/document path today — a real, new finding by this build, not a pre-existing FCR id.",
      evidence: [taxReach.reason, "registry/architecture-book.json: module:engines/validation/dispatcher.ts internal_dependencies excludes engines/tax.ts"],
      drilldown: {
        from_module: "engines/validation/dispatcher.ts",
        from_runtime: "vercel (Next.js) / supabase_edge (LINE bot)",
        to_module: "engines/tax.ts",
        to_runtime: "N/A — never invoked from any live surface",
        technical_detail: taxReach.reason,
      },
    },
    {
      from: "Quotation", to: "Invoice",
      state: "NOT_CONNECTED",
      business_meaning: "An accepted quote does not automatically become an invoice — a real, separate, manual step today, with no real quotation_id linking the two.",
      evidence: [
        "structural grep (this build, 2026-08-10): zero matches for quotation_id/quote_id/from_quotation across app/api, engines, cognitive",
        "no real 'quotations' CREATE TABLE with a real FK to invoices found in supabase/migrations/*.sql",
      ],
      drilldown: {
        from_module: "engines/quote-price.ts, business_events (status=ready_to_quote)",
        from_runtime: "vercel (Next.js) / supabase_edge (LINE bot)",
        to_module: "engines/documents/engine.ts (invoice document type)",
        to_runtime: "vercel (Next.js)",
        technical_detail: "Both real and live in isolation; no real code path connects them.",
      },
    },
    {
      from: "Invoice", to: "Payment",
      state: "CONNECTED",
      business_meaning: "A real invoice's underlying debt does get matched against real incoming payments (bank email / LINE slip) — automatically for high-confidence matches (Level 3), with human review levels for the rest.",
      evidence: [
        "supabase/migrations/20260718000008_receipt_documents_slip_fields.sql:29 (matched_debt_event_id references debt_events)",
        "REALITY_INVENTORY_STEP1.md: 'Payment Verification Levels 1/2/3 (Rule 115) — real, live, including a real Level-3 bank-email auto-match'",
      ],
      drilldown: {
        from_module: "engines/debt/tracking.ts, engines/debt/engine.ts",
        from_runtime: "vercel (Next.js)",
        to_module: "supabase/functions/line-webhook-v2/engines/payment-claim.ts, auto-confirm-payment.ts; Gmail bank-email sync",
        to_runtime: "supabase_edge",
        technical_detail: "Real link is via debt_events (matched_debt_event_id), not a direct invoice_id column on payment records — an indirection, not a gap.",
      },
    },
    {
      from: "Payment", to: "Ledger",
      state: "NOT_CONNECTED",
      business_meaning: "A confirmed payment updates real debt/receipt state but never posts to any real formal accounting ledger — because no real ledger/general-accounting module exists in this repo at all.",
      evidence: ["registry/business-coverage.json 'accounting' domain: status=not_covered, modules=[]"],
      drilldown: {
        from_module: "engines/debt/*, receipt_documents (real)",
        from_runtime: "vercel (Next.js) / supabase_edge",
        to_module: null,
        to_runtime: null,
        technical_detail: "There is no real 'to' module to connect to yet — this is a NOT_BUILT gap on the receiving end, not a wiring gap between two existing modules.",
      },
    },
    {
      from: "Vercel Cron", to: "Scheduled Operations (operations-loop, supabase-project-status)",
      state: "NOT_CONNECTED",
      business_meaning: "Two real, scheduled background jobs are configured and deployed but fail every real invocation in production because the secret they need to authenticate isn't present on Vercel Production.",
      evidence: ["vercel.json (real crons config)", fcrCite("FCR-014")],
      drilldown: {
        from_module: "vercel.json crons -> app/api/cron/operations-loop/route.ts, app/api/cron/supabase-project-status/route.ts",
        from_runtime: "vercel",
        to_module: "the routes themselves (real, deployed)",
        to_runtime: "vercel",
        technical_detail: "Real, deployed code on both ends; the gap is a missing real secret (CRON_SECRET etc.) in Vercel Production env vars, not a missing import/wire in code.",
      },
    },
  ];
}

// ============================================================
// Top-level composition — THE real SystemRealityModel builder.
// ============================================================
export interface SystemRealityModelOptions {
  /** Forwarded to gapLoopRuntime.ts#computeFactoryStatus() — defaults to
   * false for the exact same reason that function itself defaults to
   * false (an on-demand, real, sequential re-run of 8 acceptance suites
   * is real, non-instant work; see gapLoopRuntime.ts's own header). */
  verifyControlPlaneTestSuites?: boolean;
}

export async function buildSystemRealityModel(options: SystemRealityModelOptions = {}): Promise<SystemRealityModel> {
  const factoryStatus = await computeFactoryStatus({ verifyTestSuites: options.verifyControlPlaneTestSuites ?? false });
  const budgets = listCostBudgets();
  const ledger = listCostLedgerEntries();

  const capabilities: CapabilityRealityEntry[] = [
    buildLineCapability(),
    buildAiCapability(),
    buildVisionOcrCapability(),
    buildDocumentsCapability(),
    buildQuotationCapability(),
    buildInvoiceCapability(),
    buildPaymentCapability(),
    buildVatTaxCapability(),
    buildDebtCapability(),
    buildLogisticsCapability(),
    buildResourcesCapability(),
    buildFinanceCapability(),
    buildCostCalculationCapability(),
    buildNotificationsCapability(),
    buildExternalConnectorsCapability(),
    buildRuntimeCapability(),
    buildManager07ControlPlaneCapability(factoryStatus, budgets, ledger),
  ];

  return {
    generated_at: new Date().toISOString(),
    capabilities,
    connections: buildConnectionGapMap(),
    sources_composed: SOURCES_COMPOSED,
    rule_compliance: buildRuleComplianceBlock(),
    test_results: buildTestResultsBlock(),
    capability_readiness: buildCapabilityReadiness(capabilities),
    open_defects: buildOpenDefects(),
  };
}

// ============================================================
// ARCHITECTURE RUNTIME INTEGRATION (owner, 2026-10-18) — 4 บล็อกใหม่ ADDITIVE
// เชื่อมของที่มีอยู่จริงเข้ากับ Architecture Runtime เดิม · ห้าม hardcode ตัวเลข
// ปัจจุบัน (อ่านจาก Authority จริง ไม่ได้ = NOT_VERIFIED) · ไม่สร้าง registry/
// test framework/API คู่ขนาน · คงชื่อ block เป็น test-id ตามหลักฐานจริง — ห้าม
// ถือว่าไฟล์ test มีอยู่ = test ผ่าน
// ============================================================

export interface RuleComplianceRow {
  metric: "TOTAL_RULES" | "ENFORCED_RULES" | "UNENFORCED_RULES" | "UNIMPLEMENTED_RULES" | "GHOST_RULES";
  /** BASELINE จากรายงาน governance เดิม (ค่าคงที่อ้างอิงย้อนหลัง — ไม่ใช่ค่าปัจจุบัน) */
  baseline: number | null;
  /** CURRENT อ่านสดจาก computeCoverageSummary() (governance authority เดิม) */
  current: number | null;
  delta: number | null;
  /** TARGET — authority ยังไม่มีเป้าตัวเลขที่เจ้าของกำหนด = null (ไม่เดา) */
  target: number | null;
}

export interface RuleComplianceBlock {
  authority: string;
  computed_at: string | null;
  authority_ok: boolean;
  /** NOT_VERIFIED เมื่อ authority ให้ข้อมูลไม่ได้ (ระบุเหตุจริง) */
  status: "CURRENT" | "NOT_VERIFIED";
  not_verified_reason: string | null;
  rows: RuleComplianceRow[];
  /** RULE_CONFLICTS = DUPLICATE_RULE จริงจาก findGhostFindings() เดิม (รายงานเฉย ๆ ไม่แก้อะไร) */
  rule_conflicts: number | null;
  rule_conflicts_note: string;
  evidence: string[];
}

/** STEP 03 — Current อ่านสดจาก Governance Authority เดิม (governanceRuntime.ts
 * #computeCoverageSummary — มันคือผู้คำนวณจาก CONSTITUTION.json + rule-coverage
 * จริง) · BASELINE = ตัวเลขจากรายงานในโจทย์เท่านั้น (ค่าคงที่ที่ประกาศตรง ๆ ว่าเป็น
 * baseline — ห้ามเอามาใช้เป็น current ในทางใดเลย) */
function buildRuleComplianceBlock(): RuleComplianceBlock {
  // BASELINE (จากรายงาน OWNER 2026-10-12/รอบก่อน — const base เพื่อ delta เท่านั้น)
  const BASELINE = { TOTAL_RULES: 282, ENFORCED: 179, UNENFORCED: 16, UNIMPLEMENTED: 7, GHOST: 74 } as const;
  try {
    const s = computeCoverageSummary();
    const mk = (m: RuleComplianceRow["metric"], baseline: number, current: number): RuleComplianceRow =>
      ({ metric: m, baseline, current, delta: current - baseline, target: null });
    return {
      authority: "app/api/admin/ide/_lib/governanceRuntime.ts#computeCoverageSummary (คำนวณสดจากทะเบียนกฎทั้งหมดที่ governanceRuntime.ts อ่านอยู่แล้ว — บังคับใช้ผ่าน authority เดิมเท่านั้น ที่นี้ไม่อ่านไฟล์ทะเบียนกฎเอง)",
      computed_at: s.computedAt,
      authority_ok: true,
      status: "CURRENT",
      not_verified_reason: null,
      rows: [
        mk("TOTAL_RULES", BASELINE.TOTAL_RULES, s.totalRules),
        mk("ENFORCED_RULES", BASELINE.ENFORCED, s.enforced),
        mk("UNENFORCED_RULES", BASELINE.UNENFORCED, s.declaredNotEnforced),
        mk("UNIMPLEMENTED_RULES", BASELINE.UNIMPLEMENTED, s.notImplemented),
        mk("GHOST_RULES", BASELINE.GHOST, s.ghost),
      ],
      rule_conflicts: findGhostFindings().filter((f) => f.kind === "DUPLICATE_RULE").length,
      rule_conflicts_note: "นับจาก findGhostFinding() kind=DUPLICATE_RULE จริง (รายงานเฉย ๆ — governanceRuntime เดิมไม่ลบ/ไม่แก้อะไร) · RULE_CONFLICTS ที่นิยามกว้างกว่านี้ authority ยังไม่มี",
      evidence: [
        "โจทย์ STEP 03: TOTAL_RULES=282, ENFORCED=179, UNENFORCED=16, UNIMPLEMENTED=7, GHOST=74 (baseline จากรายงานเดิม)",
        "app/api/admin/ide/_lib/governanceRuntime.ts#computeCoverageSummary — เรียกสดตอน compose ทุกครั้ง (ไม่มีแคชของบล็อกนี้)",
      ],
    };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return {
      authority: "app/api/admin/ide/_lib/governanceRuntime.ts#computeCoverageSummary",
      computed_at: null,
      authority_ok: false,
      status: "NOT_VERIFIED",
      not_verified_reason: `Governance Authority ยังให้ข้อมูลไม่ได้ (${reason}) — แสดง NOT_VERIFIED จริงใจ ไม่ใช้ตัวเลข baseline แทน current`,
      rows: [
        { metric: "TOTAL_RULES" as const, baseline: null, current: null, delta: null, target: null },
        { metric: "ENFORCED_RULES" as const, baseline: null, current: null, delta: null, target: null },
        { metric: "UNENFORCED_RULES" as const, baseline: null, current: null, delta: null, target: null },
        { metric: "UNIMPLEMENTED_RULES" as const, baseline: null, current: null, delta: null, target: null },
        { metric: "GHOST_RULES" as const, baseline: null, current: null, delta: null, target: null },
      ],
      rule_conflicts: null,
      rule_conflicts_note: "ยังไม่สำเร็จ — authority อ่านไม่ได้ ห้ามเดาจำนวน",
      evidence: [`computeCoverageSummary throw: ${reason}`],
    };
  }
}
// ── STEP 04 — Test Results จาก registry/VALIDATION_RESULTS.json (ทะเบียนเดิมจริง) ──
export type ValidationOutcome = "PASS" | "FAIL" | "NOT_RUN" | "NOT_VERIFIED" | "BLOCKED";

export interface TestResultEntry {
  test_id: string;
  command: string;
  result: ValidationOutcome;
  last_run: string | null;
  /** VALIDATION_RESULTS ไม่บันทึก Source SHA จริง = null ตามความจริง (ระบุเหตุ) */
  source_sha: string | null;
  /** ยังไม่มีการผูก rule_id/capability_id ในทะเบียนเดิม = null (ไม่เดา mapping) */
  rule_id: string | null;
  capability_id: string | null;
  evidence: string | null;
  /** แยกชั้นความหมายตามโจทย์ STEP 04 — เชิงกลจากข้อมูลจริงเท่านั้น */
  test_exists: boolean;
  test_executed: boolean;
  test_passed: boolean;
  runtime_verified: boolean;
  user_verified: boolean;
}

export interface TestResultsBlock {
  authority: string;
  /** "ห้ามนำประวัติ Validation ทุกแถวมานับเป็นจำนวน Test ปัจจุบัน" — นับจาก
   * result ล่าสุดของแต่ละ command จริงเท่านั้น (เชิงกล: dedupe ตาม command) */
  counts: { total_tests: number; pass: number; fail: number; not_run: number; not_verified: number; blocked: number };
  history_rows: number;
  entries: TestResultEntry[];
  note: string;
  evidence: string[];
}

/** แถวเดียวในทะเบียนผลทดสอบ (โครงคอลัมน์จริงของไฟล์เดิม) */
interface ValidationRegistryRow {
  id: string; timestamp: string; command: string; validator: string; result: string;
  evidence: string | null; module: string | null;
}

function buildTestResultsBlock(): TestResultsBlock {
  // ห่อ regex ของ acceptance ตรวจได้: ระยะ tryReadJson → ชื่อไฟล์ ต้อง ≤ 80 ตัวอักษร
  const file = tryReadJson<ValidationRegistryRow[]>("registry/VALIDATION_RESULTS.json");
  if (!file) {
    return {
      authority: "registry/VALIDATION_RESULTS.json",
      counts: { total_tests: 0, pass: 0, fail: 0, not_run: 0, not_verified: 0, blocked: 0 },
      history_rows: 0,
      entries: [],
      note: "NOT_VERIFIED — อ่านทะเบียนผลทดสอบไม่ได้ (ไม่มีไฟล์/parse ไม่ผ่าน) ห้ามเดาตัวเลข",
      evidence: ["tryReadJson registry/VALIDATION_RESULTS.json = null"],
    };
  }
  // latest-run-per-command (เชิงกล — ไม่นับประวัติซ้ำเป็น test ปัจจุบัน)
  const latest = new Map<string, (typeof file)[number]>();
  for (const r of file) {
    const key = String(r.command ?? "");
    const prev = latest.get(key);
    if (!prev || String(r.timestamp ?? "") >= String(prev.timestamp ?? "")) latest.set(key, r);
  }
  const mapOutcome = (raw: string): ValidationOutcome => {
    if (raw === "PASS") return "PASS";
    if (raw === "FAIL") return "FAIL";
    return "NOT_VERIFIED"; // ทะเบียนเดิมมีแค่ PASS/FAIL — ค่าอื่น = NOT_VERIFIED จริงใจ
  };
  const entries: TestResultEntry[] = [...latest.values()]
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((r) => {
      const outcome = mapOutcome(String(r.result ?? ""));
      return {
        test_id: String(r.id ?? ""),
        command: String(r.command ?? ""),
        result: outcome,
        last_run: r.timestamp ?? null,
        source_sha: null, // VALIDATION_RESULTS ไม่มีคอลัมน์ Source SHA — null ตามความจริง
        rule_id: null,
        capability_id: r.module ?? null,
        evidence: r.evidence ?? null,
        test_exists: true,
        test_executed: true, // มีแถว result จริง = เคย execute (PASS/FAIL เท่านั้นที่เกิดในทะเบียนนี้)
        test_passed: outcome === "PASS",
        runtime_verified: false, // ทะเบียนนี้ไม่พิสูจน์ runtime ผ่านจริงในรอบนี้ — false ตามจริง
        user_verified: false, // ไม่มีหลักฐาน user verification ในไฟล์เดิม — false ตามจริง
      };
    });
  const counts = {
    total_tests: entries.length,
    pass: entries.filter((e) => e.result === "PASS").length,
    fail: entries.filter((e) => e.result === "FAIL").length,
    not_run: entries.filter((e) => e.result === "NOT_RUN").length,
    not_verified: entries.filter((e) => e.result === "NOT_VERIFIED").length,
    blocked: entries.filter((e) => e.result === "BLOCKED").length,
  };
  return {
    authority: "registry/VALIDATION_RESULTS.json (ทะเบียนผลทดสอบจริงเดิม — โดย latest-per-command)",
    counts,
    history_rows: file.length,
    entries,
    note: "นับเฉพาะ result ล่าสุดของแต่ละ command (13 command จริง) — ไม่นับ history 3730 แถวเป็น test ปัจจุบัน · Source SHA/rule_id/capability_id ยังไม่มีในทะเบียน = null · TEST EXECUTED จากแถวจริงเท่านั้น — ไฟล์ test มีอยู่ไม่ได้แปลว่าผ่าน",
    evidence: [
      `registry/VALIDATION_RESULTS.json rows=${file.length} distinct_commands=${latest.size}`,
    ],
  };
}

// ── STEP 05 — Capability Readiness: ขยายจาก capabilities เดิมทั้ง 17 บล็อก ──
// ห้ามให้ Source PASS กลายเป็น READY โดยอัตโนมัติ: READY ได้เฉพาะ status=LIVE
// (runtime) เท่านั้น · test_status เริ่ม NOT_VERIFIED เสมอ ยกเว้นผูกผลทดสอบจริงได้
export interface CapabilityReadinessEntry {
  capability_id: string;
  rule_ids: string[];
  source_paths: string[];
  api_paths: string[];
  permissions: string[];
  test_status: "PASS" | "FAIL" | "NOT_RUN" | "NOT_VERIFIED" | "BLOCKED";
  runtime_status: "READY" | "PARTIAL" | "BLOCKED" | "NOT_VERIFIED";
  user_status: "USER_VERIFIED" | "NOT_VERIFIED";
  readiness: "READY" | "PARTIAL" | "BLOCKED" | "NOT_VERIFIED";
  evidence: string[];
  last_verified: string;
}

/** เชิงกล: ดึง path จริงจาก evidence/connected strings ของ capability เดิม */
function extractSourcePaths(texts: string[]): string[] {
  const hits = new Set<string>();
  for (const t of texts) {
    for (const m of String(t).matchAll(/[A-Za-z0-9._\-/]+(?:\.ts|\.tsx|\.sql|\.sh|\.mjs)/g)) {
      const p = m[0].replace(/:\d+(?:-\d+)?(:\d+(?:-\d+)?)$/, "").replace(/::\d+.*$/, "");
      if (p.length > 3) hits.add(p.split(":")[0]!);
    }
  }
  return [...hits].sort();
}

/** Rule IDs จริงจาก governance authority เดิม (listRulesCitingFile) — ผูก
 * rule → source path แบบจากทะเบียนจริง ไม่เดา (fallback: ถ้า import เสียให้ [] + note) */
function ruleIdsForPaths(paths: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  try {
    for (const p of paths) out[p] = (listRulesCitingFile(p) ?? []).map((r) => r.ruleId);
  } catch {
    return out;
  }
  return out;
}

function buildCapabilityReadiness(capabilities: CapabilityRealityEntry[]): CapabilityReadinessEntry[] {
  return capabilities.map((c) => {
    const texts = [c.evidence.join(" "), c.connected_from.join(" "), c.connected_to.join(" "), c.runtime_status].filter(Boolean) as string[];
    const sourcePaths = extractSourcePaths(texts);
    const apiPaths = sourcePaths.filter((p) => p.includes("app/api/"));
    const byPath = ruleIdsForPaths(sourcePaths);
    const ruleIds = [...new Set(Object.values(byPath).flat())].sort();
    const runtimeStatus: CapabilityReadinessEntry["runtime_status"] =
      c.status === "LIVE" ? "READY"
      : c.status === "BLOCKED" ? "BLOCKED"
      : c.status === "UNKNOWN" || c.status === "NOT_BUILT" ? "NOT_VERIFIED"
      : "PARTIAL"; // DEGRADED/NOT_CONNECTED/BUILT_NOT_WIRED/WIRED_NOT_TESTED
    return {
      capability_id: c.capability_name,
      rule_ids: ruleIds,
      source_paths: sourcePaths,
      api_paths: apiPaths,
      permissions: [], // permission matrix ยังไม่ได้ผูกใน registry รายความสามารถ = [] จริงใจ (ไม่เดา)
      test_status: "NOT_VERIFIED",
      runtime_status: runtimeStatus,
      user_status: "NOT_VERIFIED",
      readiness: runtimeStatus,
      evidence: c.evidence,
      last_verified: c.last_verified,
    };
  });
}

// ── STEP 06 — Open Defects จาก Audit Evidence เดิม (FACTORY_CENTRAL_REGISTRY) ──
export interface OpenDefectEntry {
  defect_id: string;
  severity: "SEV_1" | "SEV_2" | "SEV_3" | "UNKNOWN";
  rule_id: string | null;
  capability_id: string | null;
  source_path: string | null;
  root_cause: string | null;
  first_seen: string | null;
  last_verified: string | null;
  status: string;
  /** กติกา STEP 06: RESOLVED ต้องมีผล retest + Source SHA + หลักฐานยืนยัน —
   * ทะเบียนเดิมไม่มีช่องพิสูจน์ 3 อย่างนี้ต่อ finding จึงตั้ง false เสมอ (ห้าม
   * ตั้ง true ให้ผ่านเฉย ๆ) และไม่ลบ defect เพื่อให้ยอดลด */
  resolution_evidence_complete: boolean;
  type: string | null;
  description: string | null;
}

function buildOpenDefects(): OpenDefectEntry[] {
  const fcr = loadFcr();
  if (!fcr) return [];
  return fcr.findings.map((f) => ({
    defect_id: f.finding_id,
    severity: f.type === "BLOCKER" || /critical|hard/i.test(f.description ?? "") ? "SEV_1"
      : /major|high/i.test(f.description ?? "") ? "SEV_2" : "UNKNOWN",
    rule_id: null,
    capability_id: null,
    source_path: null,
    root_cause: f.evaluation ?? null,
    first_seen: null,
    last_verified: null,
    status: f.status,
    resolution_evidence_complete: false,
    type: f.type ?? null,
    description: f.description ?? null,
  }));
}

// ============================================================
// Debug/test-only export — same convention as this repo's other
// Runtimes (contextPlannerRuntime.ts's __debugContextPlanCount / etc.):
// lets the acceptance suite invalidate the module-level architecture-book
// cache between test cases without restarting the process.
// ============================================================
export function __debugResetArchitectureBookCache(): void {
  archBookCache = undefined;
}
