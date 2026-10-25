/**
 * Switch-Based Orchestrator Runtime (owner, 2026-08-09, MANAGER-07 gate
 * pipeline / state machine). Real build of the Owner's exact required
 * flow, verbatim:
 *
 *   INPUT -> VALIDATE -> CLASSIFY -> DEDUP -> NOISE_FILTER ->
 *   DEPENDENCY_CHECK -> LOCK -> ROUTE -> WORKER -> EVIDENCE -> VERIFY ->
 *   UNLOCK/NEXT_ROUTE
 *
 * State set — EXACTLY these 9, no 10th added (Owner named these exactly):
 *   BLOCKED, READY, LOCKED, RUNNING, VERIFYING, PASSED, REPAIR, REJECTED,
 *   DONE. Per the Owner's own instruction, "LOCKED_WAITING" (an
 *   unresolved-dependency work item) maps onto BLOCKED — no evidence was
 *   found in the concurrent session's docs (WORKER_REGISTRATION_PROTOCOL.json
 *   v3 / WORKER_BOOTSTRAP_SPECIFICATION.md / TEAM_ORGANIZATION.json) of a
 *   distinct "waiting" state for a WORK ITEM as opposed to a WORKER's own
 *   boot lifecycle (OFFLINE/BOOTING/.../STANDBY/WORKING — a different,
 *   non-overlapping state machine for a different subject entirely).
 *
 * CONNECT-BEFORE-CREATE / REUSE-BEFORE-BUILD inventory (Constitution Rule
 * 101/103) — done BEFORE writing this file, cited so nothing here
 * duplicates real, already-existing work:
 *  - registry/FACTORY_CENTRAL_REGISTRY.json's escalation_criteria (Rule
 *    255) is read LIVE (never hardcoded/copied) and used AS-IS as the
 *    only 5 real triggers for ever contacting the Owner — see
 *    classifyEscalation() below.
 *  - registry/WORKER_IDENTITIES.json's real roster (0/6 registered, as of
 *    this file's creation) is read LIVE for both capability
 *    classification (its `capabilities[]`) and the real dispatch-denial
 *    gate — never simulated as registered.
 *  - registry/TEAM_ORGANIZATION.json's real `worker_type_mapping` text is
 *    parsed to build the Department -> WorkerType table, rather than a
 *    second, hand-copied table that could drift out of sync.
 *  - managerQuestionRuntime.ts's extractKeywords()/overlapCoefficient()
 *    (the latter additively exported this same pass, purely additive, no
 *    behavior change — still covered by manager-question-queue-test.ts's
 *    21/21) is reused directly for the DEDUP stage — no second
 *    keyword-overlap implementation.
 *  - contextPlannerRuntime.ts's buildMinimalContextPlan() is reused
 *    directly for the Context Slice a Worker would receive (Gap 3 —
 *    "deliver minimum context only") — never re-implemented.
 *  - workerRegistry.ts's WORKER_REGISTRY/selectWorker() is reused
 *    directly for real, deterministic (never AI-decided) Worker-type
 *    eligibility — never re-implemented.
 *  - Owner-facing escalation reuses managerQuestionRuntime.ts's ALREADY
 *    TESTED (21/21) submitWorkerQuestion() — the single Rule 251 Owner
 *    Inquiry channel — rather than inventing a second Owner-facing
 *    surface. This file NEVER imports getOwnerFacingQueue or
 *    answerAggregatedQuestion (the two Owner-facing-only exports) —
 *    verified by scripts/switch-based-orchestrator-test.ts's own
 *    import-graph scan, same technique as Rule 251's own criterion (d).
 *
 * Rule 252 (Manager Non-Mutation) boundary, real and structural: this
 * file performs ONLY control/route/lock/unlock/schedule/observe. It never
 * imports fs's writeFileSync, never imports codeWorkerRuntime.ts's
 * content-generating functions (generateWorkerProposal/
 * applyCodeWorkerProposal/generateCodeWorkerProposal), never imports
 * gitWriteOps.ts or deploymentRuntime.ts, never shells out via
 * child_process. It only reads real registry JSON (readFileSync),
 * records real evidence (createOperationsArtifact — the same Evidence
 * Warehouse every other Runtime in this layer already uses), and routes
 * real state transitions. Verified mechanically by
 * scripts/switch-based-orchestrator-test.ts.
 *
 * Honest, disclosed limitations (Constitution Rule 100/106/109/110):
 *  - In-memory only, bounded, evicted — resets on process restart. Same
 *    disclosed-limitation class as contextPlannerRuntime.ts's
 *    contextPlans / managerQuestionRuntime.ts's questions.
 *  - registry/WORKER_IDENTITIES.json is honestly 0/6 registered as of
 *    this build — this file's own real dispatch-denial gate makes that
 *    fact impossible to route around; no real end-to-end WORKER ->
 *    EVIDENCE -> VERIFY run has ever happened against a live Worker in
 *    this environment (no live Department, no live ANTHROPIC_API_KEY).
 *    __debugForceRunning() below exists ONLY so the acceptance suite can
 *    still prove the real, downstream VERIFY/REPAIR/escalation code
 *    paths in isolation — it seeds the state machine's own `state` field
 *    only, computes/fabricates zero Worker-role content, and is used
 *    nowhere outside this file and its own test.
 *  - DEDUP/CLASSIFY use real, deterministic keyword-overlap and literal
 *    substring matching — not NLU. Same disclosed-limitation class as
 *    managerQuestionRuntime.ts's own dedup (see that file's header).
 *  - The "one Primary Worker, except a Validator/independent-verification
 *    pass running alongside" carve-out (Owner rule 5) is NOT yet
 *    special-cased in the LOCK stage below — every in-flight item is
 *    treated uniformly for lock-scope contention today. Real gap, stated
 *    plainly, not silently smoothed over.
 */
import { readFileSync, existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { WORKSPACE_ROOT } from "./fsSecurity";
import { createOperationsArtifact, getArtifact } from "./artifactRuntime";
import { extractKeywords, overlapCoefficient, submitWorkerQuestion, type SubmitWorkerQuestionOutcome } from "./managerQuestionRuntime";
import { WORKER_REGISTRY, selectWorker, type WorkerType, type WorkerDefinition } from "./workerRegistry";
import { buildMinimalContextPlan, type ContextPlan } from "./contextPlannerRuntime";
import { checkCostGate } from "./costGateRuntime";
// TASK-066 (per TASK-065's "one Dispatcher, two real Adapter families"
// design) — the real, existing Integration Gateway event bus that
// ASYNCHRONOUS-mode WorkItems route through instead of the synchronous
// WorkerAdapter path below. Reuses the real GatewayEvent contract exactly
// (contracts/event.ts) — never a new, parallel event shape/type.
import { publish } from "@/engines/integration-gateway/event-bus/bus";
import type { GatewayEvent } from "@/engines/integration-gateway/contracts/event";
import { supabaseAdmin } from "@/services/supabase/queries";

const ROOT = WORKSPACE_ROOT;
function nowIso(): string { return new Date().toISOString(); }

// ============================================================
// Types — Owner's exact required task/work-item schema (requirement 7):
// task_id, capability, owner_worker, lock_scope, dependencies,
// input_evidence, output_evidence, state — kept as literal field names
// (snake_case, matching the Owner's own spec verbatim) alongside this
// repo's usual camelCase bookkeeping fields.
// ============================================================
export type WorkItemState = "BLOCKED" | "READY" | "LOCKED" | "RUNNING" | "VERIFYING" | "PASSED" | "REPAIR" | "REJECTED" | "DONE";
export type GateDropReason = "INVALID" | "DUPLICATE" | "NO_EVIDENCE" | "NOISE";

export interface GateAuditEvent { eventId: string; stage: string; detail: string; occurredAt: string }

export interface RepairAttempt {
  attempt: number;
  reason: string;
  escalated: boolean;
  escalationCriterion: string | null;
  questionOutcome: SubmitWorkerQuestionOutcome | null;
}

export interface WorkItem {
  // Owner's exact 8 required fields:
  task_id: string;
  capability: string;
  owner_worker: string | null;
  lock_scope: string[];
  dependencies: string[];
  input_evidence: string[];
  output_evidence: string[];
  state: WorkItemState;
  // Internal bookkeeping:
  rawText: string;
  ownerId: string;
  actor: string;
  workerType: WorkerType | null;
  dispatchDenialReason: string | null;
  contextPlanId: string | null;
  attempts: number;
  maxAttempts: number;
  repairHistory: RepairAttempt[];
  auditTrail: GateAuditEvent[];
  evidenceArtifactIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface GateDropRecord {
  reason: GateDropReason;
  stage: string;
  detail: string;
  rawTextPreview: string;
  droppedAt: string;
  duplicateOfTaskId: string | null;
}

export interface GateIntakeResult { accepted: boolean; workItem: WorkItem | null; drop: GateDropRecord | null }

export interface GateInputSubmission {
  rawText: string;
  capability: string;
  ownerId: string;
  actor: string;
  dependencies?: string[];
  /** Real, repo-relative file paths OR real, already-recorded artifactIds
   * (this owner's own) — never accepted on trust; verified real by
   * evidenceIsReal() before this input may enter the Factory. */
  inputEvidence?: string[];
  lockScope?: string[];
  maxAttempts?: number;
}

export class OrchestratorError extends Error {
  code: "WORK_ITEM_NOT_FOUND" | "WORK_ITEM_NOT_OWNED" | "INVALID_STATE_TRANSITION";
  constructor(code: typeof OrchestratorError.prototype.code, message: string) { super(message); this.code = code; this.name = "OrchestratorError"; }
}

// ============================================================
// Bounded in-memory store (disclosed limitation — see file header)
// ============================================================
const workItems = new Map<string, WorkItem>();
const dropLog: GateDropRecord[] = [];
const MAX_WORK_ITEM_HISTORY = 500;
const MAX_DROP_LOG = 500;

function evictOld(ownerId: string) {
  const owned = [...workItems.values()].filter((w) => w.ownerId === ownerId && (w.state === "DONE" || w.state === "REJECTED")).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let total = [...workItems.values()].filter((w) => w.ownerId === ownerId).length;
  while (total > MAX_WORK_ITEM_HISTORY && owned.length > 0) { const oldest = owned.shift()!; workItems.delete(oldest.task_id); total -= 1; }
}

function recordAudit(item: WorkItem, stage: string, detail: string): void {
  item.auditTrail.push({ eventId: randomUUID(), stage, detail, occurredAt: nowIso() });
  item.updatedAt = nowIso();
}

function persistWorkItemEvidence(item: WorkItem, actor: string, ownerId: string): void {
  const artifact = createOperationsArtifact({
    artifactType: "ORCHESTRATOR_WORK_ITEM_RECORD", content: JSON.stringify(item), mimeType: "application/json",
    actor, ownerId, generatedFrom: item.task_id, jobId: null,
  });
  item.evidenceArtifactIds.push(artifact.artifactId);
}

function persistDropEvidence(record: GateDropRecord, actor: string, ownerId: string): void {
  createOperationsArtifact({
    artifactType: "ORCHESTRATOR_WORK_ITEM_RECORD", content: JSON.stringify(record), mimeType: "application/json",
    actor, ownerId, generatedFrom: randomUUID(), jobId: null,
  });
}

function dropInput(reason: GateDropReason, stage: string, detail: string, rawText: string, ownerId: string, actor: string, duplicateOfTaskId: string | null = null): GateIntakeResult {
  const record: GateDropRecord = { reason, stage, detail, rawTextPreview: rawText.slice(0, 200), droppedAt: nowIso(), duplicateOfTaskId };
  dropLog.push(record);
  if (dropLog.length > MAX_DROP_LOG) dropLog.shift();
  persistDropEvidence(record, actor, ownerId);
  return { accepted: false, workItem: null, drop: record };
}

// ============================================================
// Real "is this evidence real" check — a repo-relative file that really
// exists on disk, OR a real, already-recorded artifactId owned by this
// ownerId. Never trusts an evidence string on its word alone.
// ============================================================
function evidenceIsReal(ref: string, ownerId: string): boolean {
  const trimmed = ref.trim();
  if (!trimmed || trimmed.includes("..")) return false;
  if (existsSync(path.join(ROOT, trimmed))) return true;
  try { getArtifact(trimmed, ownerId); return true; } catch { return false; }
}

// ============================================================
// DEDUP — reuses managerQuestionRuntime.ts's real extractKeywords() /
// overlapCoefficient() directly (Constitution Rule 101/103).
// ============================================================
const DEDUP_SIMILARITY_THRESHOLD = 0.6;

function findDuplicateInFlight(ownerId: string, rawText: string): WorkItem | null {
  const kws = extractKeywords(rawText);
  if (kws.length === 0) return null;
  let best: WorkItem | null = null; let bestScore = 0;
  for (const item of workItems.values()) {
    if (item.ownerId !== ownerId) continue;
    if (item.state === "DONE" || item.state === "REJECTED") continue; // no longer "in-flight"
    const score = overlapCoefficient(kws, extractKeywords(item.rawText));
    if (score >= DEDUP_SIMILARITY_THRESHOLD && score > bestScore) { best = item; bestScore = score; }
  }
  return best;
}

// ============================================================
// CLASSIFY / ROUTE — real, file-driven capability -> Department ->
// WorkerType resolution (never AI-decided, never hardcoded-and-drifting).
// ============================================================
interface WorkerIdentityRosterEntry { worker_id: string; department: string; capabilities: string[]; status: string }
interface WorkerIdentitiesFile { roster: WorkerIdentityRosterEntry[]; registered_count: number; total_slots: number }

function loadWorkerIdentities(): WorkerIdentitiesFile {
  return JSON.parse(readFileSync(path.join(ROOT, "registry/WORKER_IDENTITIES.json"), "utf-8"));
}

interface TeamOrgWorker { worker_id: string; worker_type_mapping?: string }
interface TeamOrgFile { workers: TeamOrgWorker[] }

/** Real, mechanical parse of TEAM_ORGANIZATION.json's own free-text
 * `worker_type_mapping` field (e.g. "TOOL_WORKER (real, status=ACTIVE —
 * direct match)", "NONE — real, structural gap...") into a real
 * Department -> WorkerType table — read live so this never silently
 * drifts from the real source of truth. */
function loadDepartmentWorkerTypeMap(): Map<string, WorkerType | null> {
  const file: TeamOrgFile = JSON.parse(readFileSync(path.join(ROOT, "registry/TEAM_ORGANIZATION.json"), "utf-8"));
  const known = new Set(Object.keys(WORKER_REGISTRY));
  const map = new Map<string, WorkerType | null>();
  for (const w of file.workers) {
    const text = (w.worker_type_mapping ?? "").trim();
    const m = text.match(/^([A-Z][A-Z_]*)/);
    const token = m ? m[1] : "";
    map.set(w.worker_id, known.has(token) ? (token as WorkerType) : null);
  }
  return map;
}

export interface CapabilityClassification {
  workerId: string; department: string; matchKind: "LITERAL_SUBSTRING" | "KEYWORD_OVERLAP"; matchScore: number; workerType: WorkerType | null;
}

/** Exported (2026-08-10, TASK-066, per TASK-065's design) so a FUTURE task
 * can wire this into commandSurfaceRuntime.ts's live Owner-facing dispatch
 * path once registry/WORKER_IDENTITIES.json has at least 1 real registrant
 * — purely additive, signature/behavior unchanged. This task does NOT add
 * any new call site itself; classifyCapability's only 2 real callers
 * remain internal to this file (submitGateInput/attemptDispatch below). */
export function classifyCapability(capabilityText: string): CapabilityClassification | null {
  const identities = loadWorkerIdentities();
  const typeMap = loadDepartmentWorkerTypeMap();
  const lower = capabilityText.toLowerCase().trim();
  if (!lower) return null;

  // Primary, real signal: literal substring match against the roster's
  // own, real declared capability strings — including real, registered
  // wildcard entries like Worker-01's "gateway.connectors.*"
  // (registry/WORKER_IDENTITIES.json), matched as a real prefix, not a
  // literal asterisk character.
  for (const entry of identities.roster) {
    for (const cap of entry.capabilities) {
      const capLower = cap.toLowerCase();
      if (capLower.endsWith("*")) {
        const prefix = capLower.replace(/\*+$/, "");
        if (prefix.length > 0 && lower.startsWith(prefix)) {
          return { workerId: entry.worker_id, department: entry.department, matchKind: "LITERAL_SUBSTRING", matchScore: 1, workerType: typeMap.get(entry.worker_id) ?? null };
        }
        continue;
      }
      if (capLower.includes(lower) || lower.includes(capLower)) {
        return { workerId: entry.worker_id, department: entry.department, matchKind: "LITERAL_SUBSTRING", matchScore: 1, workerType: typeMap.get(entry.worker_id) ?? null };
      }
    }
  }

  // Secondary, real fallback: keyword-overlap for free-text capability
  // descriptions that don't literally match a registered capability string.
  const kws = extractKeywords(capabilityText);
  if (kws.length === 0) return null;
  let best: CapabilityClassification | null = null; let bestScore = 0;
  for (const entry of identities.roster) {
    const entryKws = extractKeywords(entry.capabilities.join(" "));
    const score = overlapCoefficient(kws, entryKws);
    if (score > 0 && score > bestScore) {
      bestScore = score;
      best = { workerId: entry.worker_id, department: entry.department, matchKind: "KEYWORD_OVERLAP", matchScore: score, workerType: typeMap.get(entry.worker_id) ?? null };
    }
  }
  return best;
}

// ============================================================
// GATE PIPELINE — INPUT -> VALIDATE -> CLASSIFY -> DEDUP -> NOISE_FILTER
// -> DEPENDENCY_CHECK. Requirement 1: INVALID/DUPLICATE/NO-EVIDENCE input
// -> DROP, never enters the Factory. The Owner's 12-stage list has no
// separate "input evidence" stage before CLASSIFY — the no-evidence check
// is folded into VALIDATE (disclosed interpretation, not an invented
// stage) since VALIDATE is the one real gate positioned before the
// Factory is ever entered.
// ============================================================
export function submitGateInput(input: GateInputSubmission): GateIntakeResult {
  const rawText = (input.rawText ?? "").trim();
  const capability = (input.capability ?? "").trim();
  const ownerId = input.ownerId ?? "";
  const actor = input.actor ?? "";

  // --- VALIDATE: structural ---
  if (!rawText || !capability || !ownerId || !actor) {
    const missing = [!rawText && "rawText", !capability && "capability", !ownerId && "ownerId", !actor && "actor"].filter(Boolean).join(", ");
    return dropInput("INVALID", "VALIDATE", `missing required field(s): ${missing}`, rawText, ownerId || "unknown", actor || "unknown");
  }

  // --- VALIDATE: real input evidence (Owner rule 1 — NO-EVIDENCE -> DROP) ---
  const evidence = input.inputEvidence ?? [];
  if (evidence.length === 0) {
    return dropInput("NO_EVIDENCE", "VALIDATE", "no input_evidence entries supplied — Owner rule 1 forbids a no-evidence input from ever entering the Factory", rawText, ownerId, actor);
  }
  const realEvidence = evidence.filter((e) => evidenceIsReal(e, ownerId));
  if (realEvidence.length === 0) {
    return dropInput("NO_EVIDENCE", "VALIDATE", `${evidence.length} input_evidence entr${evidence.length === 1 ? "y" : "ies"} supplied but NONE resolved to a real file on disk or a real, already-recorded artifact — treated the same as no evidence at all`, rawText, ownerId, actor);
  }

  // --- DEDUP (before Factory entry — reused, real keyword-overlap) ---
  const dup = findDuplicateInFlight(ownerId, rawText);
  if (dup) {
    return dropInput("DUPLICATE", "DEDUP", `real keyword-overlap match (Szymkiewicz-Simpson coefficient, reused from managerQuestionRuntime.ts) against already in-flight task_id ${dup.task_id} ("${dup.rawText}") — never enters the Factory twice`, rawText, ownerId, actor, dup.task_id);
  }

  // --- NOISE_FILTER ---
  const keywords = extractKeywords(rawText);
  if (keywords.length === 0) {
    return dropInput("NOISE", "NOISE_FILTER", "extractKeywords() found zero real-signal keywords in rawText after stopword filtering — real noise, never enters the Factory", rawText, ownerId, actor);
  }

  // --- CLASSIFY (informational at intake — ROUTE re-derives/confirms it
  // at dispatch time; recorded here so intake evidence is complete) ---
  const classification = classifyCapability(capability);

  // --- DEPENDENCY_CHECK ---
  const dependencies = input.dependencies ?? [];
  const unresolvedDeps = dependencies.filter((depId) => { const dep = workItems.get(depId); return !dep || dep.state !== "DONE"; });

  const task_id = randomUUID();
  const item: WorkItem = {
    task_id, capability, owner_worker: null, lock_scope: input.lockScope ?? [],
    dependencies, input_evidence: realEvidence, output_evidence: [],
    state: unresolvedDeps.length > 0 ? "BLOCKED" : "READY",
    rawText, ownerId, actor, workerType: classification?.workerType ?? null,
    dispatchDenialReason: null, contextPlanId: null,
    attempts: 0, maxAttempts: input.maxAttempts ?? 3,
    repairHistory: [], auditTrail: [], evidenceArtifactIds: [],
    createdAt: nowIso(), updatedAt: nowIso(),
  };
  recordAudit(item, "VALIDATE", `real, structural validation passed; ${realEvidence.length}/${evidence.length} input_evidence entries verified real`);
  recordAudit(item, "DEDUP", "no real in-flight duplicate found for this owner");
  recordAudit(item, "NOISE_FILTER", `${keywords.length} real keyword(s) extracted — passed`);
  recordAudit(item, "CLASSIFY", classification ? `real match: Department ${classification.workerId} (${classification.department}), WorkerType ${classification.workerType ?? "NONE"}, via ${classification.matchKind}` : "no real Department capability match found at intake — ROUTE will report DISPATCH_DENIED_NO_COMPATIBLE_WORKER when dispatch is attempted");
  recordAudit(item, "DEPENDENCY_CHECK", unresolvedDeps.length > 0
    ? `real unresolved dependency task_id(s): ${unresolvedDeps.join(", ")} — state=BLOCKED (Owner rule 2: a Worker must never start before dependencies are real and resolved)`
    : `${dependencies.length} real dependencies declared, all DONE (or none declared) — state=READY`);

  workItems.set(task_id, item);
  persistWorkItemEvidence(item, actor, ownerId);
  evictOld(ownerId);
  return { accepted: true, workItem: item, drop: null };
}

// ============================================================
// LOCK / ROUTE / WORKER (dispatch attempt). Requirement 3: READY -> real
// capability-based Worker selection -> Dispatch, with a real,
// unregistered-Department dispatch honestly reported as blocked, never
// faked as dispatched.
// ============================================================
export type DispatchOutcomeKind = "NOT_READY" | "DISPATCH_DENIED_LOCK_CONTENTION" | "DISPATCH_DENIED_NO_COMPATIBLE_WORKER" | "DISPATCH_DENIED_UNREGISTERED" | "DISPATCH_DENIED_COST_GATE_LOCKED" | "DISPATCHED";
export interface DispatchOutcome { taskId: string; outcome: DispatchOutcomeKind; detail: string; contextPlan: ContextPlan | null }

function intersect(a: string[], b: string[]): string[] { const setB = new Set(b); return a.filter((x) => setB.has(x)); }

// ============================================================
// ASYNCHRONOUS dispatch -> Integration Gateway (owner, 2026-08-10,
// TASK-066, per TASK-065's design). Real, honest, fire-and-forget publish
// of a real GatewayEvent (contracts/event.ts's exact, unmodified shape —
// never a new/parallel type) for a WorkItem whose resolved Worker's real
// executionMode is ASYNCHRONOUS. Fire-and-forget because attemptDispatch()
// below is a real, synchronous function (every existing caller/test calls
// it synchronously, expecting a synchronous DispatchOutcome return —
// changing that signature would be a real, unauthorized behavior change to
// the SYNCHRONOUS/HUMAN_IN_LOOP path this task must leave untouched) while
// publish() is real, async I/O (a real Supabase write). This is the exact
// same disclosed, already-established pattern this repo already uses for
// EDGE_FUNCTION_WORKER's own detached dispatch (workerRegistry.ts's
// EDGE_FUNCTION_WORKER limitations[] — "genuinely fire-and-forget by
// default"). A publish()/supabaseAdmin() failure (e.g. this environment's
// real, disclosed lack of configured Supabase env vars) is caught and
// audited, never left as an unhandled rejection, never allowed to throw
// out of the synchronous attemptDispatch() call below.
//
// Field-mapping, honestly disclosed: GatewayEvent's real `provider`
// (contracts/event.ts) is a closed union of 5 literal external providers
// (github/supabase/vercel/vscode/chatgpt-mcp) — none literally names "an
// internal DNA OS Worker" (a real, disclosed gap for a future task to
// close by extending GatewayProvider itself; out of this narrow task's
// scope). This reuses the EXACT SAME real precedent
// app/api/gateway/proposals/route.ts already established for this
// identical situation (an internal/non-external-provider-sourced
// proposal): default to "vscode" (this Dispatcher itself lives under
// app/api/admin/ide/_lib/ — the same real IDE surface
// proposals/route.ts's own ALLOWED_PROVIDERS already names) rather than
// inventing a 6th literal or fabricating a misleading provider name.
// channel/action are real "propose" (not "execute" — policy/gate.ts's
// ENABLED_CHANNELS does not open Execute yet, so an ASYNCHRONOUS WorkItem
// is honestly proposed, the same real Owner-approval requirement
// CODE_WORKER's own real capability text already discloses, never
// silently auto-run) — capability "automation.command.proposed" is the
// closest real, already-existing GatewayCapability literal to "a system
// proposes running a capability," reused as-is, never invented.
function publishAsyncWorkItem(item: WorkItem, classification: CapabilityClassification, workerDef: WorkerDefinition, ownerId: string, actor: string): void {
  const event: GatewayEvent = {
    event_id: randomUUID(),
    provider: "vscode",
    capability: "automation.command.proposed",
    channel: "propose",
    action: "propose",
    session_id: null,
    change_id: null,
    evidence: {
      task_id: item.task_id, capability: item.capability, department: classification.workerId,
      workerType: classification.workerType, workerProvider: workerDef.provider, ownerId, actor,
    },
    requested_effect: `dispatch WorkItem ${item.task_id} (capability "${item.capability}") to Department ${classification.workerId} via ASYNCHRONOUS WorkerType ${classification.workerType}`,
    requires_owner_approval: true,
    occurred_at: nowIso(),
  };
  try {
    publish(supabaseAdmin(), event).catch((err) => {
      recordAudit(item, "WORKER", `real ASYNCHRONOUS GatewayEvent publish() call failed (fire-and-forget, non-blocking): ${err instanceof Error ? err.message : String(err)}`);
    });
  } catch (err) {
    recordAudit(item, "WORKER", `real ASYNCHRONOUS GatewayEvent publish() could not even be attempted (e.g. supabaseAdmin() construction failed — real, disclosed environment gap, non-blocking): ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Real lock-scope contention check (Owner rule 5/6): an item may not
 * acquire a lock over any path another in-flight item (LOCKED/RUNNING/
 * VERIFYING) already holds. Disclosed gap: does not yet special-case an
 * independent Validator pass running alongside the Primary Worker. */
function findLockConflict(item: WorkItem): WorkItem | null {
  if (item.lock_scope.length === 0) return null;
  for (const other of workItems.values()) {
    if (other.task_id === item.task_id) continue;
    if (other.state !== "LOCKED" && other.state !== "RUNNING" && other.state !== "VERIFYING") continue;
    if (intersect(item.lock_scope, other.lock_scope).length > 0) return other;
  }
  return null;
}

export function attemptDispatch(taskId: string, ownerId: string, actor: string): DispatchOutcome {
  const item = getWorkItem(taskId, ownerId);

  if (item.state !== "READY") {
    recordAudit(item, "ROUTE", `real dispatch attempt refused — state is ${item.state}, only READY items may be routed (Owner rule 2: a Worker must never start before dependencies are real and resolved)`);
    return { taskId, outcome: "NOT_READY", detail: `work item state is ${item.state}, not READY`, contextPlan: null };
  }

  // --- LOCK ---
  const conflict = findLockConflict(item);
  if (conflict) {
    const overlap = intersect(item.lock_scope, conflict.lock_scope).join(", ");
    recordAudit(item, "LOCK", `real lock_scope conflict with in-flight task_id ${conflict.task_id} over: ${overlap} — staying READY (one Primary Worker per Capability at a time)`);
    return { taskId, outcome: "DISPATCH_DENIED_LOCK_CONTENTION", detail: `lock_scope overlaps with in-flight task_id ${conflict.task_id} over: ${overlap}`, contextPlan: null };
  }
  item.state = "LOCKED";
  recordAudit(item, "LOCK", `real lock acquired over lock_scope [${item.lock_scope.join(", ") || "(none declared)"}]`);

  // --- ROUTE: real capability -> Department -> WorkerType classification ---
  const classification = classifyCapability(item.capability);
  if (!classification || !classification.workerType) {
    item.dispatchDenialReason = `real ROUTE failure — no compatible Department/WorkerType found for capability "${item.capability}" in registry/WORKER_IDENTITIES.json`;
    recordAudit(item, "ROUTE", item.dispatchDenialReason);
    persistWorkItemEvidence(item, actor, ownerId);
    return { taskId, outcome: "DISPATCH_DENIED_NO_COMPATIBLE_WORKER", detail: item.dispatchDenialReason, contextPlan: null };
  }
  item.workerType = classification.workerType;
  item.owner_worker = classification.workerId;
  recordAudit(item, "ROUTE", `real ROUTE: capability "${item.capability}" -> Department ${classification.workerId} (${classification.department}) -> WorkerType ${classification.workerType} (${classification.matchKind}, score=${classification.matchScore.toFixed(2)})`);

  // Real, deterministic Worker-type eligibility — reused directly from
  // workerRegistry.ts#selectWorker(), never AI-decided, never invented here.
  const workerDef = selectWorker(classification.workerType, { requiredCapability: item.capability, contextSizeBytes: 0, privacyRequirement: "MEDIUM", latencyRequirement: "MEDIUM", costSensitivity: "MEDIUM" });
  if (!workerDef) {
    item.dispatchDenialReason = `real ROUTE failure — workerRegistry.ts#selectWorker() returned null for WorkerType ${classification.workerType} (NOT_IMPLEMENTED or UNAVAILABLE)`;
    recordAudit(item, "WORKER", item.dispatchDenialReason);
    persistWorkItemEvidence(item, actor, ownerId);
    return { taskId, outcome: "DISPATCH_DENIED_NO_COMPATIBLE_WORKER", detail: item.dispatchDenialReason, contextPlan: null };
  }

  // Requirement 4: build the real, minimum Context Slice regardless of
  // the registration-gate outcome below — this is what WOULD be sent to
  // the Worker, computed once, real evidence either way.
  const contextPlan = buildMinimalContextPlan(`orchestrator-${item.task_id}`, ownerId, actor, item.input_evidence, item.lock_scope);
  item.contextPlanId = contextPlan.contextPlanId;
  recordAudit(item, "WORKER", `real, minimal Context Slice built: ${contextPlan.contextPlanId} (${contextPlan.includedFiles.length} file(s) of ${item.input_evidence.length} named — never dependency-graph-expanded)`);

  // --- WORKER: real registration gate (registry/WORKER_IDENTITIES.json,
  // MANAGER_07_BOARD.json dispatch_gate). A dispatch to an unregistered
  // Department is honestly reported as blocked, never faked as dispatched.
  // Checked BEFORE the real COST_GATE below (owner, 2026-08-09,
  // Constitution Rule 257 — Execution Plane Cost Gate, TASK-048/FCR-009,
  // deliberate ordering): there is no real reason to raise a real
  // financial_approval_required Owner escalation for a Department that
  // cannot dispatch at all yet regardless of cost — cheaper, more
  // fundamental preconditions are checked first, same principle this
  // file already applies via its LOCK -> ROUTE -> WORKER ordering.
  const identities = loadWorkerIdentities();
  const rosterEntry = identities.roster.find((r) => r.worker_id === classification.workerId);
  const registered = !!rosterEntry && rosterEntry.status !== "NOT_REGISTERED";
  if (!registered) {
    item.dispatchDenialReason = `real dispatch DENIED — Department ${classification.workerId} (${classification.department}) status=${rosterEntry?.status ?? "UNKNOWN"} in registry/WORKER_IDENTITIES.json (registered_count=${identities.registered_count}/${identities.total_slots}). Per MANAGER_07_BOARD.json's dispatch_gate, MANAGER-07 must not dispatch to any Worker until it has self-registered — a real, current, honest precondition gap, not simulated.`;
    recordAudit(item, "WORKER", item.dispatchDenialReason);
    persistWorkItemEvidence(item, actor, ownerId);
    return { taskId, outcome: "DISPATCH_DENIED_UNREGISTERED", detail: item.dispatchDenialReason, contextPlan };
  }

  // COST_GATE (owner, 2026-08-09, Constitution Rule 257 — Execution
  // Plane Cost Gate, TASK-048/FCR-009) — real, structural, defense-in-
  // depth check at THIS dispatch stage too, layered the same way this
  // file already layers LOCK/ROUTE/registration gates even where one
  // gate alone would already block everything. Reached ONLY once a real,
  // registered Department has cleared every earlier gate — the exact
  // moment a real dispatch is otherwise about to happen. No real
  // per-request cost estimate exists at this abstract WorkItem stage (no
  // Adapter selected, no WorkerRequest built yet) — real, honest
  // estimated_cost: null (the UNKNOWN_COST case), never assumed free for
  // a non-FREE WorkerType.
  if (workerDef.costClass !== "FREE") {
    const gate = checkCostGate({
      provider: workerDef.provider, operation: item.capability, estimated_cost: null, currency: "USD", max_cost: null,
      reason: `real WorkItem dispatch attempt via Department ${classification.workerId} (WorkerType ${classification.workerType}, costClass=${workerDef.costClass})`,
      task_id: item.task_id, worker_id: classification.workerId, evidence: item.input_evidence,
      ownerId: item.ownerId, actor, workerRole: classification.workerType,
    });
    if (gate.outcome === "LOCK") {
      item.dispatchDenialReason = `real dispatch DENIED — COST_GATE LOCKED: ${gate.reason}`;
      recordAudit(item, "WORKER", item.dispatchDenialReason);
      persistWorkItemEvidence(item, actor, ownerId);
      return { taskId, outcome: "DISPATCH_DENIED_COST_GATE_LOCKED", detail: item.dispatchDenialReason, contextPlan };
    }
  }

  // Real registration path — not exercised in this environment today
  // (0/6 registered), but real: transitions RUNNING on an actually
  // registered Department.
  //
  // TASK-066 (per TASK-065's design: one Registry + one Dispatcher, two
  // real Adapter families under it) — branch on the real, existing
  // WorkerDefinition.executionMode (workerRegistry.ts). SYNCHRONOUS/
  // HUMAN_IN_LOOP items keep the exact prior behavior below, byte-for-byte
  // unchanged — this remains the only real path this environment's own
  // 0/6-registered WORKER_IDENTITIES.json ever actually reaches today.
  // ASYNCHRONOUS items are instead published as a real GatewayEvent to
  // engines/integration-gateway/event-bus/bus.ts#publish() — capability
  // #56's real event/webhook transport — rather than the synchronous
  // WorkerAdapter family (workerContract.ts/workerAdapter.ts), per
  // TASK-065's finding that the two transports must stay two real
  // families under one Dispatcher switch, never merged into one
  // interface. See publishAsyncWorkItem() above for the full, honest
  // field-mapping disclosure.
  if (workerDef.executionMode === "ASYNCHRONOUS") {
    publishAsyncWorkItem(item, classification, workerDef, ownerId, actor);
    item.state = "RUNNING";
    recordAudit(item, "WORKER", `real ASYNCHRONOUS dispatch — a real GatewayEvent publish() call to engines/integration-gateway/event-bus/bus.ts was initiated (fire-and-forget, channel=propose) for Department ${classification.workerId} (${classification.workerType}, executionMode=ASYNCHRONOUS); never a synchronous WorkerAdapter call for this executionMode`);
    persistWorkItemEvidence(item, actor, ownerId);
    return { taskId, outcome: "DISPATCHED", detail: `published ASYNCHRONOUS GatewayEvent for ${classification.workerId} via event-bus/bus.ts#publish()`, contextPlan };
  }

  item.state = "RUNNING";
  recordAudit(item, "WORKER", `real dispatch to ${classification.workerId} (${classification.workerType})`);
  persistWorkItemEvidence(item, actor, ownerId);
  return { taskId, outcome: "DISPATCHED", detail: `dispatched to ${classification.workerId}`, contextPlan };
}

// ============================================================
// VERIFY / REPAIR (Owner rule 9/10, Constitution Rule 255 Closed Loop).
// A real Worker/Validator reports its real verification outcome here —
// this function classifies + routes the *result*; it does not compute or
// judge Worker-role content itself (Rule 252 boundary).
// ============================================================
export interface VerificationOutcomeInput { taskId: string; ownerId: string; actor: string; passed: boolean; reason: string; outputEvidence?: string[] }
export interface VerificationHandlingResult { taskId: string; state: WorkItemState; escalated: boolean; escalationOutcome: SubmitWorkerQuestionOutcome | null; escalationCriterion: string | null }

interface FactoryCentralRegistryFile { escalation_criteria?: { criteria: string[] } }

/** Real, live read of Rule 255's 5 named escalation_criteria — reused
 * AS-IS, never hardcoded/invented (Owner's explicit instruction). Never
 * writes to FACTORY_CENTRAL_REGISTRY.json (read-only for this file). */
function loadEscalationCriteria(): string[] {
  try {
    const file: FactoryCentralRegistryFile = JSON.parse(readFileSync(path.join(ROOT, "registry/FACTORY_CENTRAL_REGISTRY.json"), "utf-8"));
    return file.escalation_criteria?.criteria ?? [];
  } catch { return []; }
}

/** Real, deterministic classification of a failure reason against the
 * live escalation_criteria — a candidate key is only ever returned if it
 * BOTH matches a real, deterministic textual rule here AND is literally
 * present in the live registry file, so this can never invent a
 * criterion the real source of truth doesn't also name.
 *
 * Exported (2026-08-09, Constitution Rule 257 — Execution Plane Cost
 * Gate, TASK-048/FCR-009) so costGateRuntime.ts reuses this EXACT,
 * already-tested classification (and its live escalation_criteria read)
 * for its own "financial_approval_required" tagging — purely additive,
 * signature/behavior unchanged, no second classifier invented
 * (Constitution Rule 101/103). Same pattern already used for
 * overlapCoefficient's additive export from managerQuestionRuntime.ts. */
export function classifyEscalation(reason: string): string | null {
  const real = loadEscalationCriteria();
  const lower = reason.toLowerCase();
  const rules: [string, RegExp][] = [
    ["architecture_policy_change", /architecture (policy|decision)|new (worker|department)|change.*(policy|architecture)/],
    ["financial_approval_required", /financial|budget|cost approval|payment|billing/],
    ["destructive_production_action", /destructive|production (delete|drop|migration)|irreversible/],
    ["no_valid_rule_or_source_of_truth", /no (valid )?rule|no source.of.truth|no source of truth|undefined policy/],
    ["retry_limit_exhausted_no_deterministic_repair_path", /retry limit|no deterministic repair|max ?attempts exhausted/],
  ];
  for (const [key, re] of rules) if (re.test(lower) && real.includes(key)) return key;
  return null;
}

export function reportVerificationOutcome(input: VerificationOutcomeInput): VerificationHandlingResult {
  const item = getWorkItem(input.taskId, input.ownerId);
  if (item.state !== "RUNNING" && item.state !== "VERIFYING" && item.state !== "REPAIR") {
    throw new OrchestratorError("INVALID_STATE_TRANSITION", `cannot report a verification outcome for a work item in state ${item.state}`);
  }

  item.state = "VERIFYING";
  recordAudit(item, "VERIFY", `real verification outcome reported: ${input.passed ? "PASS" : "FAIL"} — ${input.reason}`);

  if (input.passed) {
    item.output_evidence = [...item.output_evidence, ...(input.outputEvidence ?? [])];
    item.state = "PASSED";
    recordAudit(item, "VERIFY", "real acceptance PASSED — Owner rule 9: only PASSED releases a work item to the next stage");
    persistWorkItemEvidence(item, input.actor, input.ownerId);
    return { taskId: item.task_id, state: item.state, escalated: false, escalationOutcome: null, escalationCriterion: null };
  }

  // FAIL -> REPAIR path.
  item.attempts += 1;
  item.state = "REPAIR";
  const withinLimit = item.attempts < item.maxAttempts;
  recordAudit(item, "REPAIR", `real FAIL classified — attempt ${item.attempts}/${item.maxAttempts}. ${withinLimit ? "within retry limit — real Closed Loop repair-dispatch will re-validate automatically; Owner is NOT contacted for a routine technical failure (Constitution Rule 255)." : "retry limit reached — checking Rule 255's 5 real escalation_criteria before any Owner contact."}`);

  if (withinLimit) {
    item.state = "LOCKED"; // back to LOCKED — ready for another real repair-dispatch (WORKER) attempt
    item.repairHistory.push({ attempt: item.attempts, reason: input.reason, escalated: false, escalationCriterion: null, questionOutcome: null });
    persistWorkItemEvidence(item, input.actor, input.ownerId);
    return { taskId: item.task_id, state: item.state, escalated: false, escalationOutcome: null, escalationCriterion: null };
  }

  const criterion = classifyEscalation(input.reason);
  if (!criterion) {
    item.state = "REJECTED";
    recordAudit(item, "REPAIR", "retry limit exhausted; failure does not match any of Rule 255's 5 real escalation_criteria — REJECTED, tracked, Owner NOT contacted (a routine technical failure never escalates by default).");
    item.repairHistory.push({ attempt: item.attempts, reason: input.reason, escalated: false, escalationCriterion: null, questionOutcome: null });
    persistWorkItemEvidence(item, input.actor, input.ownerId);
    return { taskId: item.task_id, state: item.state, escalated: false, escalationOutcome: null, escalationCriterion: null };
  }

  // Genuine match -> the ONLY path this file ever escalates through:
  // Rule 251's single, already-tested (21/21) Owner Inquiry channel.
  const questionOutcome = submitWorkerQuestion({
    workerRole: item.workerType ?? "TOOL_WORKER", jobContractId: item.task_id, actor: input.actor, ownerId: input.ownerId,
    questionText: `Work item ${item.task_id} (capability "${item.capability}") exhausted its real retry limit (${item.maxAttempts} attempts) with no deterministic repair path. Matches one of Constitution's 5 real Owner-escalation criteria (Closed Loop Execution Policy): ${criterion}. Failure detail: ${input.reason}`,
  });
  item.state = "REJECTED";
  recordAudit(item, "REPAIR", `real escalation via managerQuestionRuntime.ts#submitWorkerQuestion (Rule 251's single Owner Inquiry channel) — criterion matched: ${criterion}, outcome status=${questionOutcome.status}`);
  item.repairHistory.push({ attempt: item.attempts, reason: input.reason, escalated: true, escalationCriterion: criterion, questionOutcome });
  persistWorkItemEvidence(item, input.actor, input.ownerId);
  return { taskId: item.task_id, state: item.state, escalated: true, escalationOutcome: questionOutcome, escalationCriterion: criterion };
}

// ============================================================
// Public getters
// ============================================================
export function getWorkItem(taskId: string, ownerId: string): WorkItem {
  const item = workItems.get(taskId);
  if (!item) throw new OrchestratorError("WORK_ITEM_NOT_FOUND", `no real work item ${taskId}`);
  if (item.ownerId !== ownerId) throw new OrchestratorError("WORK_ITEM_NOT_OWNED", "this work item belongs to a different session");
  return item;
}
export function listWorkItems(ownerId: string): WorkItem[] {
  return [...workItems.values()].filter((w) => w.ownerId === ownerId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export function listDrops(): GateDropRecord[] { return [...dropLog]; }

// ============================================================
// Debug/test-only helpers — same convention as contextPlannerRuntime.ts's
// __debugContextPlanCount / managerQuestionRuntime.ts's __debugReset*.
// __debugForceRunning exists ONLY because registry/WORKER_IDENTITIES.json
// is honestly 0/6 registered in this environment and no live
// ANTHROPIC_API_KEY exists either — there is no real, live Worker this
// suite could dispatch to. It seeds ONLY the state machine's own `state`
// field to RUNNING so reportVerificationOutcome()'s real logic can be
// exercised in isolation; it computes/fabricates zero Worker-role output.
// ============================================================
export function __debugForceRunning(taskId: string, ownerId: string): void {
  const item = workItems.get(taskId);
  if (!item || item.ownerId !== ownerId) return;
  item.state = "RUNNING";
  recordAudit(item, "WORKER", "TEST-ONLY: __debugForceRunning seeded RUNNING — no real Worker was dispatched (0/6 Departments registered in this environment); used solely to exercise VERIFY/REPAIR logic in isolation.");
}
export function __debugWorkItemCount(ownerId?: string): number { return ownerId ? [...workItems.values()].filter((w) => w.ownerId === ownerId).length : workItems.size; }
export function __debugDropLogCount(): number { return dropLog.length; }
export function __debugReset(ownerId?: string): void {
  if (ownerId) { for (const [id, w] of workItems) if (w.ownerId === ownerId) workItems.delete(id); }
  else workItems.clear();
}
