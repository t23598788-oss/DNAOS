#!/usr/bin/env npx tsx
/**
 * HELLO DNA OS — the System Introduction Protocol (SDRN-P1).
 * registry/CHANGELOG.json DNA-000028, registry/CURRENT_STATE.json
 * plan_lock.exceptions_log -> SDRN.
 *
 * Intended as the FIRST command an AI session runs — before reading source
 * code — matching registry/README.md's own existing Execution Order (which
 * already told AIs to read README -> CONSTITUTION -> CURRENT_STATE -> ... in
 * that sequence; this script reads the same real files and presents them as
 * one combined answer instead of requiring 6 separate reads).
 *
 * Every section below is read from a real, existing file. Nothing here is
 * computed by guessing — if a section has nothing to report, it says so.
 *
 * Scope note (do not expand without a new authorization): this phase (SDRN-P1)
 * wires ONE real subsystem's Self Description Interface — the Document Engine
 * (engines/documents/selfDescription.ts). The other 463 registered modules do
 * NOT have one yet. This script's per-module section reflects that honestly.
 */
import { readFileSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
import { describeDocumentEngine, getDocumentEngineRuntimeContract, getDocumentEngineContextBudget, getDocumentEngineWorkOrder, getDocumentEngineExecutionReadiness, getDocumentEngineDeltaContext } from "@/engines/documents/selfDescription";
import { describeStorageIntelligence } from "@/engines/storage/selfDescription";
import { describeWorkspaceLockManager, describeFileExistenceIntelligence, describeArchitectureDriftDetector } from "@/engines/workspace/selfDescription";
import { getLineDriverRuntimeContract, getLineDriverContextBudget, getLineDriverWorkOrder, getLineDriverExecutionReadiness, getLineDriverDeltaContext } from "@/plugins/drivers/line.selfDescription";
import { getChromeDriverRuntimeContract, getChromeDriverContextBudget, getChromeDriverWorkOrder, getChromeDriverExecutionReadiness, getChromeDriverDeltaContext } from "@/plugins/drivers/chrome.selfDescription";
import { getVscodeDriverRuntimeContract, getVscodeDriverContextBudget, getVscodeDriverWorkOrder, getVscodeDriverExecutionReadiness, getVscodeDriverDeltaContext } from "@/plugins/drivers/vscode.selfDescription";
import { getFinderDriverRuntimeContract, getFinderDriverContextBudget, getFinderDriverWorkOrder, getFinderDriverExecutionReadiness, getFinderDriverDeltaContext } from "@/plugins/drivers/finder.selfDescription";
import { getTerminalDriverRuntimeContract, getTerminalDriverContextBudget, getTerminalDriverWorkOrder, getTerminalDriverExecutionReadiness, getTerminalDriverDeltaContext } from "@/plugins/drivers/terminal.selfDescription";
import { getMapsDriverRuntimeContract, getMapsDriverContextBudget, getMapsDriverWorkOrder, getMapsDriverExecutionReadiness, getMapsDriverDeltaContext } from "@/plugins/drivers/maps.selfDescription";
import { getEarthDriverRuntimeContract, getEarthDriverContextBudget, getEarthDriverWorkOrder, getEarthDriverExecutionReadiness, getEarthDriverDeltaContext } from "@/plugins/drivers/earth.selfDescription";
import { getMailDriverRuntimeContract, getMailDriverContextBudget, getMailDriverWorkOrder, getMailDriverExecutionReadiness, getMailDriverDeltaContext } from "@/plugins/drivers/mail.selfDescription";
import { getCalendarDriverRuntimeContract, getCalendarDriverContextBudget, getCalendarDriverWorkOrder, getCalendarDriverExecutionReadiness, getCalendarDriverDeltaContext } from "@/plugins/drivers/calendar.selfDescription";
import { getPdfDriverRuntimeContract, getPdfDriverContextBudget, getPdfDriverWorkOrder, getPdfDriverExecutionReadiness, getPdfDriverDeltaContext } from "@/plugins/drivers/pdf.selfDescription";
import { getGithubDriverRuntimeContract, getGithubDriverContextBudget, getGithubDriverWorkOrder, getGithubDriverExecutionReadiness, getGithubDriverDeltaContext } from "@/plugins/drivers/github.selfDescription";
import { getDistanceEngineRuntimeContract, getDistanceEngineContextBudget, getDistanceEngineWorkOrder, getDistanceEngineExecutionReadiness, getDistanceEngineDeltaContext } from "@/engines/distance.selfDescription";
import { buildMeasurementReport, type RuntimeContract, type ContextBudget, type WorkOrder, type ExecutionReadiness, type DeltaContext } from "@/core/shared/types";
import { registerProvider, getRuntimePacket, measureCurrentWindow, resetBroker, readCounter } from "@/core/runtime/contextBroker";

const ROOT = join(__dirname, "..");
function readJSON<T>(relPath: string): T {
  return JSON.parse(readFileSync(join(ROOT, relPath), "utf-8"));
}

function section(title: string) {
  console.log(`\n${"═".repeat(60)}\n  ${title}\n${"═".repeat(60)}`);
}

/**
 * Runtime Knowledge Assimilation (MISSION, registry/CHANGELOG.json DNA-000046).
 * Was: search over registry/existence.json#archived_knowledge only (Rule 104,
 * DNA-000038). Real gap found and fixed here: DNA-000045's full 20-point
 * root-cause analysis (known_mistakes.confirmed_duplicate_pairs.KM-002-line's
 * root_cause_analysis object) was invisible to this exact search — tested
 * directly, confirmed 0 matches for a query that should have found it. Per
 * the mission's own 'ห้ามสร้างระบบคู่ขนาน' (no parallel systems), this is
 * the SAME search extended to cover the whole real Runtime Knowledge surface
 * in registry/existence.json — archived_knowledge, known_mistakes (including
 * nested confirmed_duplicate_pairs and any root_cause_analysis), and
 * owner_requests — not a second search tool.
 *
 * Deep/recursive text search: known_mistakes entries carry nested objects
 * (e.g. KM-002-line's root_cause_analysis), so a shallow Object.values scan
 * (the old implementation) would miss them exactly the way it just did.
 */
function deepContainsText(value: unknown, query: string): boolean {
  if (typeof value === "string") return value.toLowerCase().includes(query);
  if (Array.isArray(value)) return value.some((v) => deepContainsText(v, query));
  if (value && typeof value === "object") return Object.values(value).some((v) => deepContainsText(v, query));
  return false;
}

interface KnowledgeMatch {
  source: string;
  id: string;
  label: string;
  summary: string[];
}

// Real, minimal shapes of the registry/existence.json sections this file
// actually reads — mirrors core/runtime/existence-intelligence.ts's own
// modeling of the same file, kept local since that file's interfaces
// aren't exported.
interface ArchivedKnowledgeEntry { id: string; file: string; lifecycle_state: string; replacement_successor?: string; failure_reason?: string; lessons_learned?: string }
interface KnownMistakeEntry { id: string; what_happened?: string; root_cause?: string; lesson?: string; detection?: string; date?: string }
interface DuplicatePairEntry { id: string; keep: string; deprecated: string; reason?: string; [key: string]: unknown }
interface OwnerRequestEntry { id: string; category: string; status: string; priority?: string; owner_approval_required?: boolean; reason?: string; impact?: string; suggested_resolution?: string }
interface ExistenceFile {
  archived_knowledge?: { entries?: ArchivedKnowledgeEntry[] };
  known_mistakes?: { entries?: KnownMistakeEntry[]; confirmed_duplicate_pairs?: { pairs?: DuplicatePairEntry[] } };
  owner_requests?: { requests?: OwnerRequestEntry[] };
}

function searchRuntimeKnowledge(query: string) {
  const existence = readJSON<ExistenceFile>("registry/existence.json");
  const q = query.toLowerCase();
  const matches: KnowledgeMatch[] = [];

  for (const e of existence.archived_knowledge?.entries ?? []) {
    if (deepContainsText(e, q)) {
      matches.push({
        source: "archived_knowledge", id: e.id, label: `${e.file} (${e.lifecycle_state})`,
        summary: [`Replacement/successor: ${e.replacement_successor}`, `Failure reason: ${e.failure_reason}`, `Lessons learned: ${e.lessons_learned}`],
      });
    }
  }

  for (const e of existence.known_mistakes?.entries ?? []) {
    if (deepContainsText(e, q)) {
      matches.push({
        source: "known_mistakes", id: e.id, label: e.what_happened?.slice(0, 100) ?? "(no summary)",
        summary: [`Root cause: ${e.root_cause}`, `Lesson: ${e.lesson}`, `Detection: ${e.detection}`],
      });
    }
  }

  for (const p of existence.known_mistakes?.confirmed_duplicate_pairs?.pairs ?? []) {
    if (deepContainsText(p, q)) {
      const summary = [`Keep: ${p.keep}`, `Deprecated: ${p.deprecated}`, `Reason: ${p.reason}`];
      const rca = Object.entries(p).find(([k]) => k.startsWith("root_cause_analysis"))?.[1] as { "20_final_report"?: { decision?: string; root_cause?: string; confidence?: string | number } } | undefined;
      if (rca?.["20_final_report"]) {
        const r = rca["20_final_report"];
        summary.push(`Root cause analysis on file — Decision: ${r.decision}. Root cause: ${r.root_cause}. Confidence: ${r.confidence}`);
      }
      matches.push({ source: "confirmed_duplicate_pairs", id: p.id, label: `${p.keep} vs ${p.deprecated}`, summary });
    }
  }

  for (const r of existence.owner_requests?.requests ?? []) {
    if (deepContainsText(r, q)) {
      matches.push({
        source: "owner_requests", id: r.id, label: `${r.category} (${r.status})`,
        summary: [`Reason: ${r.reason}`, `Impact: ${r.impact}`, `Suggested: ${r.suggested_resolution}`],
      });
    }
  }

  console.log(`\nRuntime Knowledge search: "${query}"`);
  console.log(`${matches.length} match(es) across archived_knowledge, known_mistakes, confirmed_duplicate_pairs, owner_requests.\n`);
  matches.forEach((m) => {
    console.log(`[${m.source}:${m.id}] ${m.label}`);
    m.summary.forEach((s) => console.log(`  ${s}`));
    console.log("");
  });
  if (matches.length === 0) {
    console.log(`No Runtime Knowledge matches "${query}".`);
  }
}

/**
 * Runtime Evidence Engine (MISSION, registry/CHANGELOG.json DNA-000049).
 * Extends the Evidence Definition from DNA-000048 (registry/EXECUTION_CONTRACT.json
 * Evidence-First Rule Creation Policy) into a real, reusable Capability instead of
 * a one-off manual investigation: when an item is UNKNOWN/UNRECOVERABLE, walk the
 * 12 Runtime layers the owner named, IN ORDER, against their real backing files —
 * never stop at git, never answer with a bare "Evidence not found".
 *
 * Per Rule 101/103 (Reuse Before Build): does not duplicate searchRuntimeKnowledge()
 * above (which text-searches 4 sub-collections inside registry/existence.json only)
 * — this walks the WHOLE registry surface across 12 named layers, reuses the same
 * deepContainsText() primitive rather than reimplementing search twice.
 *
 * Layer -> real file map (checked directly against this repo, not assumed):
 *   1  Runtime Registry     -> module-registry.json, drivers.json, services.json,
 *                              schemas.json, interfaces.json, modules.json
 *   2  Dependency Graph     -> dependency-graph.json
 *   3  Execution Graph      -> execution/pipeline.registry.json, stages.registry.json,
 *                              engines.registry.json, trace.registry.json
 *   4  Event Timeline       -> events.json (static event-TYPE schema only — the real
 *                              historical event stream lives in Supabase business_events,
 *                              which this offline script cannot query; flagged honestly)
 *   5  Task Queue           -> TASK_QUEUE.json
 *   6  Owner Request        -> existence.json#owner_requests
 *   7  CHANGELOG            -> CHANGELOG.json
 *   8  Architecture Graph   -> architecture.json, architecture-book.json
 *   9  Module Relationship  -> architecture-book.json's real import/importedBy graph
 *   10 Runtime Health       -> DNA_OS_HEALTH.json (transient, regenerated by
 *                              `npm run guard`; may not exist at check time)
 *   11 Runtime Trace        -> trace/trace.registry.json, trace/metrics.registry.json
 *   12 Validation Result    -> NO persisted result log exists anywhere in this repo —
 *                              only on-demand validator functions (registry/*_validator.ts,
 *                              engines/validation/). This is a REAL, confirmed capability
 *                              gap, not a search failure — flagged every time, not guessed.
 */
interface EvidenceLayerResult {
  order: number;
  layer: string;
  sources: string[];
  status: "found" | "checked_no_match" | "no_data" | "needs_capability";
  detail: string;
}

function safeReadJSON<T>(relPath: string): T | null {
  try {
    return readJSON<T>(relPath);
  } catch {
    return null;
  }
}

function checkEvidenceLayers(query: string) {
  const q = query.toLowerCase();
  const results: EvidenceLayerResult[] = [];

  function checkFiles(order: number, layer: string, files: string[]): EvidenceLayerResult {
    const loaded = files.map((f) => ({ f, data: safeReadJSON<unknown>(f) }));
    const present = loaded.filter((l) => l.data !== null);
    if (present.length === 0) {
      return { order, layer, sources: files, status: "no_data", detail: "None of this layer's real files exist/are readable in this repo." };
    }
    const hit = present.some((l) => deepContainsText(l.data, q));
    return {
      order, layer, sources: present.map((l) => l.f),
      status: hit ? "found" : "checked_no_match",
      detail: hit ? "Match found in this layer's real data." : "Layer checked against real data — no match for this query.",
    };
  }

  results.push(checkFiles(1, "Runtime Registry", [
    "registry/module-registry.json", "registry/drivers.json", "registry/services.json",
    "registry/schemas.json", "registry/interfaces.json", "registry/modules.json",
  ]));
  results.push(checkFiles(2, "Dependency Graph", ["registry/dependency-graph.json"]));
  results.push(checkFiles(3, "Execution Graph", [
    "registry/execution/pipeline.registry.json", "registry/execution/stages.registry.json",
    "registry/execution/engines.registry.json", "registry/execution/trace.registry.json",
  ]));
  {
    const r = checkFiles(4, "Event Timeline", ["registry/events.json"]);
    r.detail += " Note: this is a static event-TYPE schema, not a historical event log — the real runtime event stream lives in Supabase (business_events table), which this offline check cannot query.";
    results.push(r);
  }
  results.push(checkFiles(5, "Task Queue", ["registry/TASK_QUEUE.json"]));
  results.push(checkFiles(6, "Owner Request", ["registry/existence.json"]));
  results.push(checkFiles(7, "CHANGELOG", ["registry/CHANGELOG.json"]));
  results.push(checkFiles(8, "Architecture Graph", ["registry/architecture.json", "registry/architecture-book.json"]));
  results.push(checkFiles(9, "Module Relationship", ["registry/architecture-book.json"]));
  {
    const r = checkFiles(10, "Runtime Health", ["DNA_OS_HEALTH.json"]);
    if (r.status === "no_data") r.detail = "DNA_OS_HEALTH.json not present at check time — it is transient/regenerated by `npm run guard`, not committed history. Not a structural gap, but no historical health snapshots are kept anywhere.";
    results.push(r);
  }
  results.push(checkFiles(11, "Runtime Trace", ["registry/trace/trace.registry.json", "registry/trace/metrics.registry.json"]));
  results.push({
    order: 12, layer: "Validation Result",
    sources: ["registry/*/_validator.ts (on-demand functions)", "engines/validation/ (on-demand functions)"],
    status: "needs_capability",
    detail: "Confirmed real gap: validator functions exist and run on demand (e.g. validateRegistry() in registry/index.ts), but no persisted Validation Result log is ever written anywhere in this repo. There is nothing to search here for ANY query — this layer needs a new Capability (a Validation Result ledger, written every time a validator runs) before it can ever answer a historical question.",
  });

  const found = results.filter((r) => r.status === "found");
  const checkedNoMatch = results.filter((r) => r.status === "checked_no_match");
  const noData = results.filter((r) => r.status === "no_data");
  const needsCapability = results.filter((r) => r.status === "needs_capability");

  console.log(`\nRuntime Evidence Engine: "${query}"`);
  console.log(`Walked all 12 Runtime layers in order (owner MISSION, DNA-000049).\n`);

  results.forEach((r) => {
    const marker = r.status === "found" ? "MATCH" : r.status === "checked_no_match" ? "checked" : r.status === "no_data" ? "no data" : "NEEDS CAPABILITY";
    console.log(`  ${r.order}. ${r.layer} [${marker}]`);
    console.log(`     sources: ${r.sources.join(", ")}`);
    console.log(`     ${r.detail}`);
  });

  console.log("");
  if (found.length > 0) {
    console.log(`Evidence found in ${found.length} layer(s): ${found.map((r) => r.layer).join(", ")}.`);
    return;
  }

  console.log("Missing Evidence Layer");
  console.log(`  Checked (real data present, no match): ${checkedNoMatch.map((r) => r.layer).join(", ") || "(none)"}`);
  console.log(`  No data (layer's real files absent/unreadable): ${noData.map((r) => r.layer).join(", ") || "(none)"}`);
  console.log(`  Needs new Capability (no queryable data source exists at all): ${needsCapability.map((r) => r.layer).join(", ") || "(none)"}`);
  console.log("");
  console.log("Proposed Runtime Capability so this answers itself next time:");
  if (needsCapability.length > 0) {
    needsCapability.forEach((r) => console.log(`  - ${r.layer}: ${r.detail}`));
  }
  if (noData.length > 0) {
    console.log(`  - For layers with no data: confirm whether that is structural (predates the layer's own tracking start, e.g. CHANGELOG/TASK_QUEUE/AI_SESSIONS all start well after this repo's early history) before treating it as a gap — a structural absence needs no new capability, only an honest note; a genuine absence of an intended data source does.`);
  }
  console.log(`  - This report itself (npm run hello -- --evidence "<query>") is the reusable Capability that replaces manual, one-off git-only investigation (the failure mode DNA-000045/048 corrected) — every future UNKNOWN should run through this before being declared unanswerable.`);
}

/**
 * Real Contract Coverage scan (SDRN-P7, registry/CHANGELOG.json DNA-000061).
 * Reuses the exact grep pattern verified live during that pass (both real
 * RuntimeContract implementations matched, nothing else did) — not a new,
 * separately-maintained file list that could drift out of sync.
 */
function scanContractCoverage() {
  const moduleRegistry = readJSON<{ modules: Record<string, unknown> }>("registry/module-registry.json");
  const totalModules = Object.keys(moduleRegistry.modules).length;

  let contractFiles: string[] = [];
  try {
    const out = execSync(
      `grep -rl "export function get.*RuntimeContract" --include="*.ts" . 2>/dev/null | grep -v node_modules`,
      { cwd: ROOT, encoding: "utf-8" }
    );
    // Self-scan false positive (Rule 107, found live running this exact command):
    // this file's own scan command CONTAINS the pattern string it searches for,
    // so it always matches itself — excluded by basename, not a real implementation.
    contractFiles = out.split("\n").map((l) => l.trim()).filter((l) => l && !l.endsWith("scripts/hello.ts"));
  } catch {
    // grep exits non-zero when it finds nothing — real, honest empty result, not an error.
    contractFiles = [];
  }

  const report = buildMeasurementReport(totalModules, contractFiles.length);

  console.log(`\nContract Coverage scan (SDRN-P7)`);
  console.log(`  Total registered modules: ${totalModules}`);
  console.log(`  Modules with a real RuntimeContract: ${contractFiles.length}`);
  contractFiles.forEach((f) => console.log(`    - ${f}`));
  console.log(`  Contract Coverage: ${report.contractCoverage !== null ? (report.contractCoverage * 100).toFixed(2) + "%" : "N/A"}`);
  console.log(`\n  Other metrics (Repository Read Count, Context Size, Context Reuse Ratio,`);
  console.log(`  Delta Context Ratio, Repository Scan Avoidance, Execution Preparation Time):`);
  console.log(`  all null — ${report.unmeasurableReason.repositoryReadCount}`);
}

/**
 * Real before/after measurement (SDRN-P8, registry/CHANGELOG.json DNA-000062).
 * "Do not estimate. Compute from Runtime data." — BEFORE simulates the pattern
 * SDRN-P6/P7's separate helper functions actually had (each derived view calls
 * get*RuntimeContract() independently, recomputing the full contract every
 * time); AFTER uses the real Runtime Context Broker (compute once, cache,
 * derive all views from the same instance). Both counts are real — driven by
 * readCounter, which is incremented inside the real readJSON() of both
 * self-description files, not simulated after the fact.
 */
// Real modules wired into the broker (SDRN-P6..P12, TASK-037). Data-driven
// rather than 12 hand-copied blocks — per Rule 101/103 and DNA-000065's own
// "duplicate workflow" gap, repeating the same registration/measurement code
// per module would itself be the anti-pattern this session has repeatedly
// flagged and fixed elsewhere.
const WIRED_MODULES: Array<{ id: string; getContract: () => RuntimeContract; getBudget: () => ContextBudget; getWorkOrder: () => WorkOrder; getReadiness: () => ExecutionReadiness; getDelta: (h?: string) => DeltaContext }> = [
  { id: "document-engine", getContract: getDocumentEngineRuntimeContract, getBudget: getDocumentEngineContextBudget, getWorkOrder: getDocumentEngineWorkOrder, getReadiness: getDocumentEngineExecutionReadiness, getDelta: getDocumentEngineDeltaContext },
  { id: "line-driver", getContract: getLineDriverRuntimeContract, getBudget: getLineDriverContextBudget, getWorkOrder: getLineDriverWorkOrder, getReadiness: getLineDriverExecutionReadiness, getDelta: getLineDriverDeltaContext },
  { id: "chrome-driver", getContract: getChromeDriverRuntimeContract, getBudget: getChromeDriverContextBudget, getWorkOrder: getChromeDriverWorkOrder, getReadiness: getChromeDriverExecutionReadiness, getDelta: getChromeDriverDeltaContext },
  { id: "vscode-driver", getContract: getVscodeDriverRuntimeContract, getBudget: getVscodeDriverContextBudget, getWorkOrder: getVscodeDriverWorkOrder, getReadiness: getVscodeDriverExecutionReadiness, getDelta: getVscodeDriverDeltaContext },
  { id: "finder-driver", getContract: getFinderDriverRuntimeContract, getBudget: getFinderDriverContextBudget, getWorkOrder: getFinderDriverWorkOrder, getReadiness: getFinderDriverExecutionReadiness, getDelta: getFinderDriverDeltaContext },
  { id: "terminal-driver", getContract: getTerminalDriverRuntimeContract, getBudget: getTerminalDriverContextBudget, getWorkOrder: getTerminalDriverWorkOrder, getReadiness: getTerminalDriverExecutionReadiness, getDelta: getTerminalDriverDeltaContext },
  { id: "maps-driver", getContract: getMapsDriverRuntimeContract, getBudget: getMapsDriverContextBudget, getWorkOrder: getMapsDriverWorkOrder, getReadiness: getMapsDriverExecutionReadiness, getDelta: getMapsDriverDeltaContext },
  { id: "earth-driver", getContract: getEarthDriverRuntimeContract, getBudget: getEarthDriverContextBudget, getWorkOrder: getEarthDriverWorkOrder, getReadiness: getEarthDriverExecutionReadiness, getDelta: getEarthDriverDeltaContext },
  { id: "mail-driver", getContract: getMailDriverRuntimeContract, getBudget: getMailDriverContextBudget, getWorkOrder: getMailDriverWorkOrder, getReadiness: getMailDriverExecutionReadiness, getDelta: getMailDriverDeltaContext },
  { id: "calendar-driver", getContract: getCalendarDriverRuntimeContract, getBudget: getCalendarDriverContextBudget, getWorkOrder: getCalendarDriverWorkOrder, getReadiness: getCalendarDriverExecutionReadiness, getDelta: getCalendarDriverDeltaContext },
  { id: "pdf-driver", getContract: getPdfDriverRuntimeContract, getBudget: getPdfDriverContextBudget, getWorkOrder: getPdfDriverWorkOrder, getReadiness: getPdfDriverExecutionReadiness, getDelta: getPdfDriverDeltaContext },
  { id: "github-driver", getContract: getGithubDriverRuntimeContract, getBudget: getGithubDriverContextBudget, getWorkOrder: getGithubDriverWorkOrder, getReadiness: getGithubDriverExecutionReadiness, getDelta: getGithubDriverDeltaContext },
  { id: "distance-engine", getContract: getDistanceEngineRuntimeContract, getBudget: getDistanceEngineContextBudget, getWorkOrder: getDistanceEngineWorkOrder, getReadiness: getDistanceEngineExecutionReadiness, getDelta: getDistanceEngineDeltaContext },
];

function runBrokerReport() {
  WIRED_MODULES.forEach((m) => registerProvider(m.id, m.getContract));

  // ── BEFORE: the real old pattern (5 independent calls per module) ──
  resetBroker();
  const beforeStart = Date.now();
  WIRED_MODULES.forEach((m) => {
    m.getContract();
    m.getBudget();
    m.getWorkOrder();
    m.getReadiness();
    m.getDelta();
  });
  const beforeReads = readCounter.count;
  const beforeMs = Date.now() - beforeStart;

  // ── AFTER: the real broker (1 computation per module, cached, reused) ──
  resetBroker();
  const afterStart = Date.now();
  const packets = WIRED_MODULES.map((m) => getRuntimePacket(m.id));
  // Simulate a second real access to the same modules within this session —
  // this is exactly where caching should avoid real recomputation.
  WIRED_MODULES.forEach((m) => getRuntimePacket(m.id));
  const afterMeasurement = measureCurrentWindow(packets);
  const afterMs = Date.now() - afterStart;

  const readReduction = beforeReads > 0 ? ((beforeReads - afterMeasurement.repositoryReads) / beforeReads) * 100 : 0;

  console.log(`\nRuntime Context Broker — real before/after report (SDRN-P8)\n`);
  console.log(`BEFORE (independent recomputation per derived view, the real SDRN-P6/P7 pattern):`);
  console.log(`  Real repository reads: ${beforeReads}`);
  console.log(`  Wall time: ${beforeMs}ms`);
  console.log(`\nAFTER (Runtime Context Broker — compute once, cache, reuse):`);
  console.log(`  Real repository reads: ${afterMeasurement.repositoryReads}`);
  console.log(`  Wall time: ${afterMs}ms`);
  console.log(`  Real cache hit ratio (Context Reuse Ratio / Delta Context Ratio): ${(afterMeasurement.contextReuseRatio * 100).toFixed(1)}%`);
  console.log(`  Real duplicate computations avoided: ${afterMeasurement.duplicateComputationAvoided}`);
  console.log(`  Real context size: ${afterMeasurement.contextSizeBytes} bytes`);
  console.log(`  Estimate only (no real tokenizer): ~${afterMeasurement.estimatedPromptContext} prompt-context units, ~${afterMeasurement.estimatedTokenBudget} token budget`);
  console.log(`\nReal repository-read reduction (broker vs independent recomputation): ${readReduction.toFixed(1)}%`);
  console.log(`\n${afterMeasurement.note}`);
  console.log(`\nScope note: this measures the broker's OWN real behavior for ${WIRED_MODULES.length} modules under a repeated-access pattern within one process. It does NOT measure and does NOT claim anything about an AI session's overall token usage or repository reads outside this broker — that remains outside this repository's observability (Rule 102 known_gaps).`);
}

// Real, minimal shapes of the remaining registry files main() reads.
interface CurrentStateFile {
  change_id?: string; status?: string; current_task?: string;
  plan_lock?: { gate_tasks_in_order?: string[] };
  architecture_freeze?: { scope?: string; declared_by?: string; declared_at?: string };
}
interface TaskEntry { id: string; status: string; title?: string; task?: string }
// registry/TASK_QUEUE.json is a flat array today (confirmed live) but this
// script has always defensively tolerated a future/legacy { tasks: [...] }
// wrapper too — kept as a real union rather than assuming one shape.
type TaskQueueFile = TaskEntry[] | { tasks: TaskEntry[] };
function getTaskEntries(tq: TaskQueueFile): TaskEntry[] {
  return Array.isArray(tq) ? tq : (tq.tasks ?? []);
}
interface ConstitutionFile { version?: string | number; iron_rules?: unknown[] }
interface ArchBookMainFile { summary: { total: number; ok: number; broken: number; unused: number; unregistered: number } }
interface HealthFile {
  evolution: { constitution_pct: number; workflow_pct: number; business_pct: number; governance_pct: number };
  risk: { overall: string; duplicate_logic: number; ghost_rules: number; dead_code_files: number };
  metrics: { rules_total: number; rules_enforced: number };
}
interface ChangelogEntry { change_id: string; status?: string }
interface GovernanceFile { programs: Record<string, { status: string; current_phase?: string; name?: string }> }
interface RuleCoverageFile { rules: Record<string, unknown> }

function main() {
  if (process.argv.includes("--contract-coverage")) {
    scanContractCoverage();
    return;
  }

  if (process.argv.includes("--broker-report")) {
    runBrokerReport();
    return;
  }

  // --archive kept as the real, existing flag name (backward compatible with
  // DNA-000038) — same underlying store, now searching all of it, not a new flag.
  const searchFlagIndex = process.argv.indexOf("--archive");
  if (searchFlagIndex !== -1) {
    const query = process.argv[searchFlagIndex + 1] ?? "";
    if (!query) {
      console.log('Usage: npm run hello -- --archive "<search term>"');
      return;
    }
    searchRuntimeKnowledge(query);
    return;
  }

  const evidenceFlagIndex = process.argv.indexOf("--evidence");
  if (evidenceFlagIndex !== -1) {
    const query = process.argv[evidenceFlagIndex + 1] ?? "";
    if (!query) {
      console.log('Usage: npm run hello -- --evidence "<question or term>"');
      return;
    }
    checkEvidenceLayers(query);
    return;
  }

  const existence = readJSON<ExistenceFile>("registry/existence.json");
  const currentState = readJSON<CurrentStateFile>("registry/CURRENT_STATE.json");
  const taskQueue = readJSON<TaskQueueFile>("registry/TASK_QUEUE.json");
  const constitution = readJSON<ConstitutionFile>("registry/CONSTITUTION.json");
  const archBook = readJSON<ArchBookMainFile>("registry/architecture-book.json");
  const health = readJSON<HealthFile>("DNA_OS_HEALTH.json");
  const changelog = readJSON<ChangelogEntry[]>("registry/CHANGELOG.json");
  const governance = readJSON<GovernanceFile>("registry/GOVERNANCE_REGISTRY.json");
  const taskEntries = getTaskEntries(taskQueue);

  console.log("\n  ╔════════════════════════════════════════════════════════╗");
  console.log("  ║                    HELLO DNA OS                          ║");
  console.log("  ╚════════════════════════════════════════════════════════╝");

  section("IDENTITY");
  console.log(`  DNA OS v${constitution.version ?? "?"} — self-governing multi-agent operating system`);
  console.log(`  Constitution: ${constitution.iron_rules?.length ?? 0} iron rules, ${Object.keys(readJSON<RuleCoverageFile>("registry/rule-coverage.json").rules).length} enforced with real code`);

  section("CURRENT STATE");
  console.log(`  change_id: ${currentState.change_id}  |  status: ${currentState.status}`);
  console.log(`  ${currentState.current_task}`);

  section("CURRENT PHASE");
  const activePrograms = Object.entries(governance.programs).filter(([, p]) => p.status === "in_progress");
  if (activePrograms.length === 0) console.log("  No program currently marked in_progress in registry/GOVERNANCE_REGISTRY.json.");
  activePrograms.forEach(([id, p]) => console.log(`  ${id}: ${p.current_phase} — ${p.name}`));

  section("ARCHITECTURE");
  console.log(`  ${archBook.summary.total} modules  |  OK: ${archBook.summary.ok}  BROKEN: ${archBook.summary.broken}  UNUSED: ${archBook.summary.unused}  UNREGISTERED: ${archBook.summary.unregistered}`);

  section("HEALTH");
  console.log(`  Constitution ${health.evolution.constitution_pct}%  Workflow ${health.evolution.workflow_pct}%  Business ${health.evolution.business_pct}%  Governance ${health.evolution.governance_pct}%`);
  console.log(`  Risk: ${health.risk.overall}  (duplicate_logic ${health.risk.duplicate_logic}, ghost_rules ${health.risk.ghost_rules}, dead_code_files ${health.risk.dead_code_files})`);

  section("PRIORITY");
  const gateTasks = currentState.plan_lock?.gate_tasks_in_order ?? [];
  const gateTaskDetail = gateTasks.map((id: string) => taskEntries.find((t) => t.id === id));
  console.log(`  Plan Lock gate tasks (must be DONE before any new Module/Page/Feature): ${gateTasks.join(", ")}`);
  gateTaskDetail.filter((t): t is TaskEntry => !!t).forEach((t) => console.log(`    ${t.id}: ${t.status} — ${(t.title ?? t.task ?? "").slice(0, 90)}`));

  section("OWNER REQUESTS");
  const ownerRequests = existence.owner_requests?.requests ?? [];
  if (ownerRequests.length === 0) console.log("  None declared.");
  ownerRequests
    .filter((r) => r.status === "open")
    .forEach((r) => {
      console.log(`  [${r.id}] ${r.category} (priority: ${r.priority}, owner approval required: ${r.owner_approval_required})`);
      console.log(`    Reason: ${r.reason}`);
      console.log(`    Impact: ${r.impact}`);
      console.log(`    Suggested: ${r.suggested_resolution}`);
    });

  section("KNOWN PROBLEMS");
  console.log(`  ${health.risk.duplicate_logic} duplicate-logic instances (jscpd), ${health.risk.ghost_rules} ghost rules/workflows, ${health.risk.dead_code_files} dead-code files, ${health.metrics.rules_total - health.metrics.rules_enforced} of ${health.metrics.rules_total} Constitution rules not yet enforced by code.`);

  section("BLOCKED AREAS");
  console.log(`  ${currentState.architecture_freeze?.scope ?? "(no active architecture_freeze found)"}`);
  console.log(`  Frozen by: ${currentState.architecture_freeze?.declared_by} on ${currentState.architecture_freeze?.declared_at}`);

  section("AVAILABLE WORK");
  const pending = taskEntries.filter((t) => t.status === "pending");
  pending.slice(0, 5).forEach((t) => console.log(`  ${t.id}: ${(t.title ?? t.task ?? "").slice(0, 90)}`));
  if (pending.length > 5) console.log(`  ...and ${pending.length - 5} more pending tasks in registry/TASK_QUEUE.json`);

  section("RECOMMENDED TASK");
  const firstOpenGate = gateTaskDetail.find((t) => t && t.status !== "done" && t.status !== "DONE");
  console.log(firstOpenGate
    ? `  ${firstOpenGate.id} (Plan Lock gate, status: ${firstOpenGate.status}) — everything else waits on this per Constitution iron_rules.`
    : "  All Plan Lock gate tasks show DONE — re-verify against registry/CONSTITUTION.json before treating the lock as lifted.");

  section("WARNINGS");
  (existence.known_mistakes?.entries ?? []).forEach((km) => console.log(`  [${km.id}] ${km.lesson}`));
  if (currentState.architecture_freeze) console.log(`  Active freeze in effect — see BLOCKED AREAS above.`);

  section("RECENTLY CHANGED");
  changelog.slice(-3).forEach((c) => console.log(`  ${c.change_id}: ${(c.status ?? "").slice(0, 90)}`));

  section("LEARNING UPDATES");
  (existence.known_mistakes?.entries ?? []).forEach((km) => console.log(`  ${km.id} (${km.date}): detection=${km.detection}`));

  // Real, computed count — this exact number was stale before (hardcoded
  // "1 of 464") despite 13 modules already having a real RuntimeContract.
  // Fixed live 2026-08-04 per owner instruction ("ขยาย SDRN-P1... ไม่ต้อง
  // hardcode รายชื่อ") — WIRED_MODULES.length + the SelfDescription-shaped
  // modules below, read from the real arrays, not typed as a literal.
  const fullDescriptions = [describeDocumentEngine(), describeStorageIntelligence(), describeWorkspaceLockManager(), describeFileExistenceIntelligence(), describeArchitectureDriftDetector()];
  const totalWired = WIRED_MODULES.length + (fullDescriptions.length - 1); // document-engine counted once, already in WIRED_MODULES
  const totalRegistered = archBook.summary?.total ?? "UNKNOWN";
  section(`SELF-DESCRIBING MODULES (SDRN-P1 — ${totalWired} of ${totalRegistered} wired so far)`);

  for (const doc of fullDescriptions) {
    console.log(`  ${doc.identity}`);
    console.log(`  Status: ${doc.status}  |  Owner: ${doc.owner}`);
    console.log(`  Capabilities: ${doc.capabilities.join(", ")}`);
    console.log(`  Runtime connection: ${doc.runtimeConnection} — ${doc.runtimeConnectionNote}`);
    console.log(`  Called by (${doc.calledBy.length}): ${doc.calledBy.join(", ") || "(none found in architecture-book.json)"}`);
    if (doc.missing.length > 0) console.log(`  Missing: ${doc.missing.join(" | ")}`);
    doc.aiShouldKnow.forEach((note) => console.log(`  AI should know: ${note}`));
    console.log("");
  }

  console.log(`  Also wired (RuntimeContract only, not full SelfDescription — see each module's own .selfDescription.ts):`);
  for (const m of WIRED_MODULES) {
    if (m.id === "document-engine") continue; // already shown in full above
    const c = m.getContract();
    console.log(`    ${m.id}: ${c.currentState} — ${(c.capabilities ?? []).length} capabilities`);
  }

  console.log(`\n  (The other ${Number(totalRegistered) - totalWired} registered modules do not yet have a Self Description Interface.)`);

  console.log(`\n  Generated: ${new Date().toISOString()}`);
  console.log(`  Source: registry/*.json, DNA_OS_HEALTH.json — no source code read to produce this report.\n`);
}

main();
