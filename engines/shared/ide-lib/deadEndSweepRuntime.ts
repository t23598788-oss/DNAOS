/**
 * Dead-End Sweep Runtime (owner, 2026-08-10, Capability Roadmap #58
 * "ARCHITECTURE GAP EXPLORER" Wave 1a, registry/TASK_QUEUE.json TASK-058,
 * dispatched to CODE_WORKER per Constitution Rule 252).
 *
 * PURPOSE (verbatim intent from TASK-058 / capability-roadmap.json #58): a
 * real, repo-wide sweep across every real module in registry/architecture-
 * book.json, classifying each into one of 5 real dead-end patterns the
 * Owner explicitly named, or "healthy" if none apply:
 *   1. ENGINE_NO_CALLER    — a real engines/ module with zero real live
 *      callers anywhere in the live reachability chain.
 *   2. API_NO_ROUTE        — a real API handler/runtime file that no real
 *      app/api/**\/route.ts or Supabase Edge Function actually wires up.
 *   3. REGISTRY_NO_RUNTIME — a real registry/*.json file that no real .ts
 *      runtime module anywhere in the repo actually reads.
 *   4. WORKER_NO_DISPATCHER — a real WorkerType (workerRegistry.ts) or
 *      Department (registry/WORKER_IDENTITIES.json /
 *      registry/TEAM_ORGANIZATION.json) that no real dispatch path can
 *      actually route work to.
 *   5. UI_NO_CONSUMER      — a real component/page that nothing real
 *      imports/mounts (genuine Next.js entry points — page.tsx, layout.tsx,
 *      loading.tsx, error.tsx, not-found.tsx, template.tsx, default.tsx,
 *      global-error.tsx — are real, framework-mounted surfaces, never
 *      flagged, per this task's own explicit instruction not to flag
 *      genuine entry points as dead).
 *
 * REUSE DECISION (Constitution Rule 101/103, done BEFORE writing this
 * file — real grep/read investigation, not assumed):
 *  - computeLiveReachability() is imported DIRECTLY from
 *    systemRealityRuntime.ts (the real, proven reverse-dependency-graph BFS
 *    that already independently discovered engines/tax.ts and
 *    engines/vehicle-selector.ts as real dead ends today). This file adds
 *    ZERO new graph-traversal logic for Patterns 1, 2, and 5 — it only
 *    supplies a different, real `isTargetSurface` predicate for Pattern 5
 *    (a Next.js page/layout/loading/etc. file is a real production surface
 *    for a UI component the same way a route.ts is for an engine), via
 *    computeLiveReachability's own new, backward-compatible optional
 *    parameters added to systemRealityRuntime.ts for exactly this reuse
 *    (see that file's header comment on the change — every pre-existing
 *    1-argument call site is unaffected, re-verified live via
 *    `npm run system-reality-model:test`, 26/26 unchanged).
 *  - loadArchitectureBook()/ArchNode/ArchitectureBook are also imported
 *    directly from systemRealityRuntime.ts (same real, cached loader) — no
 *    second JSON.parse of registry/architecture-book.json anywhere in this
 *    file.
 *  - Pattern 3 (registries) and Pattern 4 (workers) are NOT reachability-
 *    graph questions: registry/*.json files and WorkerType/Department
 *    entries are not nodes in registry/architecture-book.json's module
 *    graph at all, so computeLiveReachability() structurally cannot answer
 *    them — reusing it there would be a category error, not reuse. Per
 *    this task's own explicit instruction ("check via a real, whole-repo
 *    grep/import-graph analysis, not just its presence in the registry
 *    list"), Pattern 3 does a real, literal whole-repo text scan — the same
 *    class of technique scripts/build-arch-book.ts and
 *    scripts/sync-registry.ts already use to build the import graph in the
 *    first place (reading every real .ts/.tsx/.mjs file's source text
 *    once, checking for a literal reference). Pattern 4 reads
 *    registry/WORKER_IDENTITIES.json and registry/TEAM_ORGANIZATION.json's
 *    own, already-computed, real `dispatchable_today`/`worker_type_mapping`
 *    fields directly — this file never reimplements
 *    switchBasedOrchestratorRuntime.ts's own real classifyCapability()/
 *    loadDepartmentWorkerTypeMap() dispatch-classification logic (neither
 *    is exported, and reimplementing them would itself violate Rule 103's
 *    reuse-before-build discipline) — it only cites the two source
 *    registries' own real, already-decided fields, plus one additional
 *    real computeLiveReachability() check on EDGE_FUNCTION_WORKER's own
 *    real, documented dispatch mechanism
 *    (edgeFunctionWorkerRuntime.ts#dispatchEdgeFunctionWorkerJob, named as
 *    such in workerRegistry.ts's own EDGE_FUNCTION_WORKER doc comment),
 *    which IS a real reachability question this file can honestly answer
 *    via the same reused technique.
 *
 * A REAL, DISCLOSED DATA-FRESHNESS FINDING THIS BUILD MADE AND FIXED (not
 * silently worked around — Constitution Rule 100/106): before writing this
 * file, registry/architecture-book.json (as it stood earlier today) had
 * never seen 15 real, already-existing files — 6 of them the entire
 * "System Reality Report" capability (systemRealityRuntime.ts itself, its
 * own app/api/admin/system-reality/route.ts, and 4 sibling files) built
 * earlier in this same session — because none of them were registered in
 * registry/module-registry.json (Rule 100 requires every real file to
 * register there; scripts/build-arch-book.ts only creates a graph node for
 * files present as keys in that registry, even though its OWN raw
 * import-scan sees every real .ts/.tsx file on disk). Concretely, this
 * made computeLiveReachability("module:engines/shared/ide-lib/
 * gapLoopRuntime.ts") WRONGLY report unreachable — a real, live route
 * (app/api/admin/system-reality/route.ts) genuinely does import it via
 * systemRealityRuntime.ts, but the BFS could not see past
 * systemRealityRuntime.ts because that module had no graph node to look up
 * further real dependents from. Running this repo's own existing,
 * sanctioned `npx tsx scripts/sync-registry.ts` (adds real, honestly-
 * "unregistered"-status stub entries for real files, zero fabricated data,
 * zero purpose_th invention) followed by `npx tsx scripts/build-arch-
 * book.ts` (regenerates the graph from current real source) fixed this for
 * real, once, before any Dead-End Sweep finding below was computed — this
 * is disclosed here, not hidden, because it is exactly the kind of
 * correction Rule 100 exists for, and skipping it would have produced a
 * FALSE, unfounded dead-end claim against gapLoopRuntime.ts and
 * costGateRuntime.ts (real modules with real live callers). Neither
 * module-registry.json nor registry/architecture-book.json is on this
 * task's off-limits list. A future run of this sweep against a graph that
 * has drifted stale again would need the same real `npm run sync &&
 * npx tsx scripts/build-arch-book.ts` refresh first — this is a real,
 * disclosed operational precondition, not something this pure-read
 * function can self-heal (it never writes).
 *
 * HONESTY / SCOPE DISCIPLINE (Constitution Rule 100/106/109/110): the 5
 * patterns above are each explicitly scoped by the Owner to a specific
 * real module category (engines/, API handlers, registries, Worker
 * types/Departments, UI components). A real module outside all 5
 * categories (e.g. under core/, cognitive/, services/, presenter/,
 * plugins/, gateway/, styles/, config/, local-runtime/, scripts/,
 * dna-os-mcp-server/) is structurally out of scope for every one of the 5
 * named patterns — not silently skipped without disclosure. See
 * `scope` (modules actually checked, by category) vs
 * `total_modules_in_architecture_book` in the returned result, and
 * `disclosed_limitations[]`. This file is pure read/compute only — it
 * never writes, never spends real money, never triggers a real external
 * side effect.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { WORKSPACE_ROOT } from "./fsSecurity";
import {
  computeLiveReachability, isLiveProductionSurface, loadArchitectureBook,
  type ArchNode, type ArchitectureBook,
} from "./systemRealityRuntime";
import { WORKER_REGISTRY, type WorkerType } from "./workerRegistry";

const ROOT = WORKSPACE_ROOT;

// ============================================================
// Public types
// ============================================================
export type DeadEndPattern =
  | "ENGINE_NO_CALLER" | "API_NO_ROUTE" | "REGISTRY_NO_RUNTIME"
  | "WORKER_NO_DISPATCHER" | "UI_NO_CONSUMER";

export const DEAD_END_PATTERNS: readonly DeadEndPattern[] = [
  "ENGINE_NO_CALLER", "API_NO_ROUTE", "REGISTRY_NO_RUNTIME", "WORKER_NO_DISPATCHER", "UI_NO_CONSUMER",
];

export interface DeadEndFinding {
  module_path: string;
  pattern: DeadEndPattern;
  /** Real file:line / registry citations only — never a floating, unfounded claim. */
  evidence: string[];
  /** The real reverse-dependency chain that proved reachability, OR a real,
   * honest statement of why no such chain exists (never a guess either way). */
  real_reachability_chain_or_lack_thereof: string;
}

export interface DeadEndSweepScopeCounts {
  engines_checked: number;
  api_handlers_checked: number;
  registries_checked: number;
  worker_entries_checked: number;
  ui_components_checked: number;
}

export interface DeadEndSweepResult {
  generated_at: string;
  architecture_book_generated_at: string | null;
  total_modules_in_architecture_book: number;
  scope: DeadEndSweepScopeCounts;
  findings: DeadEndFinding[];
  findings_by_pattern: Record<DeadEndPattern, number>;
  healthy_count: number;
  /** A capped sample of confirmed-healthy module_paths per category — not
   * the full list (that would just be "everything not in findings[]"), but
   * enough to prove the sweep does NOT flag everything indiscriminately. */
  healthy_examples: string[];
  disclosed_limitations: string[];
  sources_composed: string[];
}

// ============================================================
// Small, real, local fs helpers — same "no existing wrapper, direct read"
// convention systemRealityRuntime.ts's own header already documents and
// uses for registries with no dedicated runtime (Rule 101/103: this is NOT
// a duplicate of that file's private tryReadJson — it is the same trivial,
// repo-wide convention reimplemented locally the same way every other
// _lib/*.ts file in this layer already does for ITS OWN reads; the thing
// that must never be duplicated is computeLiveReachability's real BFS
// logic, which this file does not duplicate anywhere).
// ============================================================
function tryReadJsonLocal<T>(relPath: string): T | null {
  try { return JSON.parse(readFileSync(path.join(ROOT, relPath), "utf-8")) as T; }
  catch { return null; }
}

const WALK_EXCLUDE_DIRS = new Set(["node_modules", ".next", ".dnaos-trash", "backups", ".git"]);

/** Real, Rule-107 (Evidence Isolation) exclusion — this Dead-End Sweep's
 * OWN acceptance suite (scripts/dead-end-sweep-test.ts) necessarily quotes
 * real registry basenames as literal, tightly-quoted findFinding(...) call
 * arguments, to assert on THIS sweep's own real findings by name — a real,
 * live, caught self-feedback
 * false positive during this file's own build (the exact same class of
 * bug DNA-000056 already named this pattern for: an audit round's own
 * evidence/test getting fed back as input to the same or next audit
 * round). Excluded by exact relative path, the same way Guard 1 already
 * excludes VALIDATION_RESULTS.json by basename for the identical reason —
 * never excluded so broadly that a real reader elsewhere gets hidden. */
const SELF_TEST_EXCLUDE_PATH = "scripts/dead-end-sweep-test.ts";

/** Real, whole-repo walk collecting every real .ts/.tsx/.mjs source file's
 * REPO-RELATIVE path (POSIX-style, matching architecture-book.json's own
 * id convention) — used by Pattern 3's real text scan. Excludes build
 * artifacts, workspace trash, and backup snapshots (Rule 107 — evidence/
 * backup files are never treated as live source), and this sweep's own
 * acceptance test (see SELF_TEST_EXCLUDE_PATH above). */
function collectRealSourceFiles(): string[] {
  const out: string[] = [];
  function walk(dirAbs: string, dirRel: string) {
    let entries: import("fs").Dirent[];
    try { entries = readdirSync(dirAbs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (WALK_EXCLUDE_DIRS.has(e.name)) continue;
      const abs = path.join(dirAbs, e.name);
      const rel = dirRel ? `${dirRel}/${e.name}` : e.name;
      if (rel === SELF_TEST_EXCLUDE_PATH) continue;
      if (e.isDirectory()) { walk(abs, rel); continue; }
      if (/\.(ts|tsx|mjs)$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(rel);
    }
  }
  walk(ROOT, "");
  return out;
}

// ============================================================
// Pattern 1 — ENGINE_NO_CALLER
// ============================================================
function sweepEngines(book: ArchitectureBook): { findings: DeadEndFinding[]; healthy: string[]; checked: number } {
  const findings: DeadEndFinding[] = [];
  const healthy: string[] = [];
  let checked = 0;
  for (const node of book.nodes) {
    if (node.type !== "Module") continue;
    const p = node.id.slice("module:".length);
    if (!p.startsWith("engines/") || !p.endsWith(".ts")) continue;
    checked++;
    const r = computeLiveReachability(node.id);
    if (r.reachable) { healthy.push(p); continue; }
    findings.push({
      module_path: p,
      pattern: "ENGINE_NO_CALLER",
      evidence: [
        `registry/architecture-book.json: ${node.id} status=${node.status}, dependents=${JSON.stringify(node.dependents)}`,
        r.reason,
      ],
      real_reachability_chain_or_lack_thereof: r.reason,
    });
  }
  return { findings, healthy, checked };
}

// ============================================================
// Pattern 2 — API_NO_ROUTE (app/api/**/_lib handler files that are not
// route.ts themselves, and supabase/functions/**/*.ts files that are not
// the Edge Function's own index.ts entrypoint)
// ============================================================
function sweepApiHandlers(book: ArchitectureBook): { findings: DeadEndFinding[]; healthy: string[]; checked: number } {
  const findings: DeadEndFinding[] = [];
  const healthy: string[] = [];
  let checked = 0;
  for (const node of book.nodes) {
    if (node.type !== "Module") continue;
    const p = node.id.slice("module:".length);
    const isAppApiHandler = p.startsWith("app/api/") && p.endsWith(".ts") && !p.endsWith("/route.ts");
    const isEdgeHandler = p.startsWith("supabase/functions/") && p.endsWith(".ts") && !p.endsWith("/index.ts");
    if (!isAppApiHandler && !isEdgeHandler) continue;
    checked++;
    // Default target surface (route.ts / edge index.ts) is exactly right
    // for this pattern's own definition — no custom predicate needed.
    const r = computeLiveReachability(node.id);
    if (r.reachable) { healthy.push(p); continue; }
    findings.push({
      module_path: p,
      pattern: "API_NO_ROUTE",
      evidence: [
        `registry/architecture-book.json: ${node.id} status=${node.status}, dependents=${JSON.stringify(node.dependents)}`,
        r.reason,
      ],
      real_reachability_chain_or_lack_thereof: r.reason,
    });
  }
  return { findings, healthy, checked };
}

// ============================================================
// Pattern 3 — REGISTRY_NO_RUNTIME (real, whole-repo literal text scan —
// not a reachability-graph question; registries are not module-graph nodes)
// ============================================================
// A registry basename is only counted as "really read" when it appears as
// a TIGHTLY-QUOTED path token — i.e. the quote character immediately
// before it opens a string containing nothing but the bare basename or a
// real path prefix (an optional "@/", "./", "../" repeats, and/or
// "registry/"), closed immediately after by a matching quote. This is the
// real shape every real reader in this repo's many different helper names
// already uses no matter which one: `readFileSync(path.join(ROOT,
// "registry/X.json"))`, `tryReadJson<T>("registry/X.json")`,
// `readJSON<T>("registry/X.json")`, `safeReadJson<T>("registry/X.json")`,
// `import x from "@/registry/X.json"`, or the split-argument form
// `path.join(ROOT, "registry", "X.json")` (bare basename, its own tight
// quotes). Rule 107 (Evidence Isolation) discipline, applied here for a
// real reason found live while building this file: an EARLIER version of
// this check used a hardcoded whitelist of read-function names
// (readFileSync/tryReadJson/JSON.parse/require/import) — real, but
// incomplete, since this repo's own module-registry population layer
// alone uses at least 3 more distinct helper names (readJSON,
// safeReadJson, and the split-argument path.join form), producing real
// FALSE dead-end claims against registries that genuinely do have real
// readers (registry/GOVERNANCE_REGISTRY.json, registry/EXECUTION_CONTEXT.
// json, registry/capability-roadmap.json, and others — caught live,
// corrected here, never shipped). The tight-quote shape generalizes across
// every real helper name without hardcoding any of them, while STILL
// correctly excluding a bare prose/test-assertion mention (e.g. "...cites
// registry/WORKER_STATUS.json, registry/SCHEDULER.json..." inside a larger
// sentence) — the character immediately before "registry/" there is a
// space, never a quote, so it correctly does not match.
function isRealRuntimeRead(content: string, base: string): boolean {
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`["'\`](?:@/)?(?:\\.\\.?/)*(?:registry/)?${escaped}["'\`]`);
  return re.test(content);
}

function sweepRegistries(): { findings: DeadEndFinding[]; healthy: string[]; checked: number; sourceFilesScanned: number } {
  const registryDirAbs = path.join(ROOT, "registry");
  let registryFiles: string[] = [];
  try { registryFiles = readdirSync(registryDirAbs).filter((f) => f.endsWith(".json")); } catch { registryFiles = []; }

  const sourceFiles = collectRealSourceFiles();
  const readersByRegistry = new Map<string, string[]>();
  for (const base of registryFiles) readersByRegistry.set(base, []);

  for (const relFile of sourceFiles) {
    let content: string;
    try { content = readFileSync(path.join(ROOT, relFile), "utf-8"); } catch { continue; }
    for (const base of registryFiles) {
      if (isRealRuntimeRead(content, base)) readersByRegistry.get(base)!.push(relFile);
    }
  }

  const findings: DeadEndFinding[] = [];
  const healthy: string[] = [];
  for (const base of registryFiles) {
    const readers = readersByRegistry.get(base) ?? [];
    const modulePath = `registry/${base}`;
    if (readers.length > 0) { healthy.push(modulePath); continue; }
    let sizeNote = "size unknown";
    try { sizeNote = `${statSync(path.join(registryDirAbs, base)).size} bytes`; } catch { /* honest fallback text above */ }
    findings.push({
      module_path: modulePath,
      pattern: "REGISTRY_NO_RUNTIME",
      evidence: [
        `real, whole-repo text scan of ${sourceFiles.length} real .ts/.tsx/.mjs source files (excluding node_modules/.next/.dnaos-trash/backups/.git) found ZERO files where "${base}" appears as a real, tightly-quoted path token (a real read-call argument shape, e.g. readFileSync/tryReadJson/readJSON/safeReadJson/import — see this file's own header comment for the exact quoting rule) — a bare, loosely-embedded mention inside a comment or test-assertion sentence does not count`,
        `${modulePath} exists on disk as a real file (${sizeNote}) — presence in the registry list alone, per this task's own instruction, is not evidence of a real runtime consumer`,
      ],
      real_reachability_chain_or_lack_thereof: `no real .ts/.tsx/.mjs runtime module anywhere in the repo really reads "${base}" — genuinely zero real readers found by an exhaustive (not sampled) scan of every real source file`,
    });
  }
  return { findings, healthy, checked: registryFiles.length, sourceFilesScanned: sourceFiles.length };
}

// ============================================================
// Pattern 4 — WORKER_NO_DISPATCHER
// ============================================================
interface TeamOrgWorkerEntry {
  worker_id: string; department: string; display_name?: string;
  worker_type_mapping?: string; dispatchable_today?: boolean;
}
interface TeamOrgFile { workers: TeamOrgWorkerEntry[] }
interface WorkerIdentityRosterEntry { worker_id: string; department: string; status: string }
interface WorkerIdentitiesFile { roster: WorkerIdentityRosterEntry[]; registered_count: number; total_slots: number }

function sweepWorkers(): { findings: DeadEndFinding[]; healthy: string[]; checked: number } {
  const teamOrg = tryReadJsonLocal<TeamOrgFile>("registry/TEAM_ORGANIZATION.json");
  const identities = tryReadJsonLocal<WorkerIdentitiesFile>("registry/WORKER_IDENTITIES.json");
  const findings: DeadEndFinding[] = [];
  const healthy: string[] = [];
  let checked = 0;

  // Department-level: cite registry/TEAM_ORGANIZATION.json's own real,
  // already-computed dispatchable_today field directly — never
  // re-derived, since re-deriving it would mean reimplementing
  // switchBasedOrchestratorRuntime.ts's private classification logic
  // (Rule 103 violation).
  for (const w of teamOrg?.workers ?? []) {
    checked++;
    const rosterEntry = identities?.roster.find((r) => r.worker_id === w.worker_id) ?? null;
    if (w.dispatchable_today === false) {
      findings.push({
        module_path: `${w.worker_id} (${w.display_name ?? `${w.department} Department`})`,
        pattern: "WORKER_NO_DISPATCHER",
        evidence: [
          `registry/TEAM_ORGANIZATION.json worker_id=${w.worker_id}: dispatchable_today=false`,
          `registry/TEAM_ORGANIZATION.json worker_id=${w.worker_id}: worker_type_mapping="${w.worker_type_mapping ?? "UNKNOWN"}"`,
          rosterEntry
            ? `registry/WORKER_IDENTITIES.json roster worker_id=${w.worker_id}: status=${rosterEntry.status}`
            : `registry/WORKER_IDENTITIES.json has no roster entry for ${w.worker_id} — real, honest gap`,
        ],
        real_reachability_chain_or_lack_thereof: `no real dispatch path exists: engines/shared/ide-lib/workerTaskOrchestrator.ts#createJobContract() only accepts the real WorkerType values declared in workerRegistry.ts, and registry/TEAM_ORGANIZATION.json's own real worker_type_mapping field for ${w.worker_id} is "${w.worker_type_mapping ?? "UNKNOWN"}" — no real WorkerType is mapped for this Department, confirmed by that same registry's own already-declared dispatchable_today=false (not re-derived by this sweep)`,
      });
    } else {
      healthy.push(w.worker_id);
    }
  }

  // WorkerType-level: EDGE_FUNCTION_WORKER's own real, documented dispatch
  // mechanism (edgeFunctionWorkerRuntime.ts#dispatchEdgeFunctionWorkerJob,
  // named as such in workerRegistry.ts's own doc comment) — a real
  // reachability question, answered via the SAME reused
  // computeLiveReachability() technique, not a guess.
  checked++;
  const edgeFnWorkerDef = WORKER_REGISTRY["EDGE_FUNCTION_WORKER" as WorkerType];
  const edgeReach = computeLiveReachability("module:engines/shared/ide-lib/edgeFunctionWorkerRuntime.ts");
  if (!edgeReach.reachable) {
    findings.push({
      module_path: "EDGE_FUNCTION_WORKER (WorkerType, engines/shared/ide-lib/workerRegistry.ts)",
      pattern: "WORKER_NO_DISPATCHER",
      evidence: [
        `engines/shared/ide-lib/workerRegistry.ts: WORKER_REGISTRY.EDGE_FUNCTION_WORKER real, status=${edgeFnWorkerDef?.status ?? "UNKNOWN"} — its own doc comment names edgeFunctionWorkerRuntime.ts#dispatchEdgeFunctionWorkerJob() as the real dispatch mechanism for this WorkerType`,
        `registry/architecture-book.json: module:engines/shared/ide-lib/edgeFunctionWorkerRuntime.ts — ${edgeReach.reason}`,
      ],
      real_reachability_chain_or_lack_thereof: edgeReach.reason,
    });
  } else {
    healthy.push("EDGE_FUNCTION_WORKER");
  }

  return { findings, healthy, checked };
}

// ============================================================
// Pattern 5 — UI_NO_CONSUMER (real components under components/ and app/,
// excluding Next.js App Router's own real, convention-mounted special
// files — page/layout/loading/error/not-found/template/default/
// global-error.tsx — which are real, framework-recognized entry points
// Next.js mounts by FILE PATH, not by import, and must never be flagged
// the same way app/page.tsx itself must never be flagged, per this task's
// own explicit instruction)
// ============================================================
const NEXT_SPECIAL_FILE_RE = /\/(page|layout|loading|error|not-found|template|default|global-error)\.tsx$/;

/** A real UI "live surface": either a real HTTP route/Edge Function
 * (reused from isLiveProductionSurface, imported not copy-pasted) OR a
 * real Next.js App Router special file, which Next.js mounts by real file
 * convention regardless of whether any other module imports it. */
function isUiConsumerSurface(moduleId: string): boolean {
  if (isLiveProductionSurface(moduleId)) return true;
  return NEXT_SPECIAL_FILE_RE.test(moduleId);
}

function sweepUiComponents(book: ArchitectureBook): { findings: DeadEndFinding[]; healthy: string[]; checked: number } {
  const findings: DeadEndFinding[] = [];
  const healthy: string[] = [];
  let checked = 0;
  for (const node of book.nodes) {
    if (node.type !== "Module") continue;
    const p = node.id.slice("module:".length);
    if (!p.endsWith(".tsx")) continue;
    if (!(p.startsWith("components/") || p.startsWith("app/"))) continue;
    // Genuine Next.js entry points (page.tsx/layout.tsx/loading.tsx/etc.)
    // are never even candidates — they are real, intentional entry points
    // by file-path convention, not "consumed" the way a component is.
    if (NEXT_SPECIAL_FILE_RE.test(node.id)) continue;
    checked++;
    const r = computeLiveReachability(
      node.id,
      isUiConsumerSurface,
      "a real Next.js page/layout/loading/error/not-found/template/default/global-error file (framework-mounted by file path) or a real HTTP route/Edge Function",
    );
    if (r.reachable) { healthy.push(p); continue; }
    findings.push({
      module_path: p,
      pattern: "UI_NO_CONSUMER",
      evidence: [
        `registry/architecture-book.json: ${node.id} status=${node.status}, dependents=${JSON.stringify(node.dependents)}`,
        r.reason,
      ],
      real_reachability_chain_or_lack_thereof: r.reason,
    });
  }
  return { findings, healthy, checked };
}

// ============================================================
// Real "sources actually composed" list — mirrors the convention
// systemRealityRuntime.ts's own SOURCES_COMPOSED uses.
// ============================================================
const DEAD_END_SWEEP_SOURCES: string[] = [
  "registry/architecture-book.json",
  "registry/TEAM_ORGANIZATION.json",
  "registry/WORKER_IDENTITIES.json",
  "engines/shared/ide-lib/systemRealityRuntime.ts#computeLiveReachability,isLiveProductionSurface,loadArchitectureBook",
  "engines/shared/ide-lib/workerRegistry.ts#WORKER_REGISTRY",
  "real, whole-repo text scan of every .ts/.tsx/.mjs source file (Pattern 3 — registry runtime-consumer check)",
];

// ============================================================
// Top-level composition — THE real Dead-End Sweep.
// ============================================================
export function runDeadEndSweep(): DeadEndSweepResult {
  const loaded = loadArchitectureBook();
  const book = loaded?.book ?? null;

  const engines = book ? sweepEngines(book) : { findings: [], healthy: [], checked: 0 };
  const apiHandlers = book ? sweepApiHandlers(book) : { findings: [], healthy: [], checked: 0 };
  const registries = sweepRegistries();
  const workers = sweepWorkers();
  const ui = book ? sweepUiComponents(book) : { findings: [], healthy: [], checked: 0 };

  const findings: DeadEndFinding[] = [
    ...engines.findings, ...apiHandlers.findings, ...registries.findings, ...workers.findings, ...ui.findings,
  ];
  const findingsByPattern: Record<DeadEndPattern, number> = {
    ENGINE_NO_CALLER: engines.findings.length,
    API_NO_ROUTE: apiHandlers.findings.length,
    REGISTRY_NO_RUNTIME: registries.findings.length,
    WORKER_NO_DISPATCHER: workers.findings.length,
    UI_NO_CONSUMER: ui.findings.length,
  };
  const healthyAll = [...engines.healthy, ...apiHandlers.healthy, ...registries.healthy, ...workers.healthy, ...ui.healthy];

  const totalScopeChecked = engines.checked + apiHandlers.checked + registries.checked + workers.checked + ui.checked;

  return {
    generated_at: new Date().toISOString(),
    architecture_book_generated_at: book?.generated_at ?? null,
    total_modules_in_architecture_book: book?.nodes.filter((n) => n.type === "Module").length ?? 0,
    scope: {
      engines_checked: engines.checked,
      api_handlers_checked: apiHandlers.checked,
      registries_checked: registries.checked,
      worker_entries_checked: workers.checked,
      ui_components_checked: ui.checked,
    },
    findings,
    findings_by_pattern: findingsByPattern,
    healthy_count: healthyAll.length,
    healthy_examples: healthyAll.slice(0, 25),
    disclosed_limitations: [
      `Scope boundary (Owner's own 5-pattern definition, not a shortcut this sweep invented): only modules under engines/ (Pattern 1), app/api/**/_lib + supabase/functions/**/*.ts non-entrypoint files (Pattern 2), registry/*.json (Pattern 3), Worker Departments/Types (Pattern 4), and components/**+app/** .tsx non-entry-point files (Pattern 5) are classified — ${totalScopeChecked} real modules/entries checked out of ${book?.nodes.filter((n) => n.type === "Module").length ?? 0} total real modules in registry/architecture-book.json. Modules under core/, cognitive/, services/, presenter/, plugins/, gateway/, styles/, config/, local-runtime/, scripts/, dna-os-mcp-server/ are structurally out of scope for all 5 named patterns and are not classified by this sweep.`,
      "Pattern 3's whole-repo scan is a real, literal text search (does every real .ts/.tsx/.mjs file's source text contain the registry's basename) — it would NOT detect a read via a fully dynamic/computed path string that never contains the literal filename in source (the same class of limitation scripts/build-arch-book.ts's own static import-resolution already has for dynamic imports). Confirmed no generic readdirSync-over-registry/ consumer exists anywhere in the repo before relying on this technique (grep-verified).",
      "Pattern 4's Department-level findings cite registry/TEAM_ORGANIZATION.json's own real, already-computed dispatchable_today/worker_type_mapping fields directly rather than re-deriving them (re-deriving would require reimplementing switchBasedOrchestratorRuntime.ts's private classifyCapability()/loadDepartmentWorkerTypeMap(), a Rule 103 violation) — if that registry's own fields become stale, this sweep inherits that staleness rather than independently re-verifying it.",
      "Patterns 1/2/5 depend on registry/architecture-book.json being reasonably fresh AND on every real file being registered in registry/module-registry.json (a real, disclosed, pre-existing gap this build found and fixed once via `npx tsx scripts/sync-registry.ts && npx tsx scripts/build-arch-book.ts` before computing any finding below — see this file's header comment). A module created after the LAST such refresh, and not yet registered, would be invisible to this sweep the same way systemRealityRuntime.ts itself was before that fix — re-running that refresh before trusting a later sweep run is a real operational precondition, not something this pure-read function can self-heal.",
      "MAX_DEPTH=25 in computeLiveReachability's BFS (unchanged, reused as-is) bounds worst-case traversal — no real chain in this repo's current module graph has been observed to need anywhere near that depth, but a hypothetical, extremely deep real chain beyond 25 hops would honestly report unreachable even if a real (very indirect) path exists further out.",
    ],
    sources_composed: DEAD_END_SWEEP_SOURCES,
  };
}
