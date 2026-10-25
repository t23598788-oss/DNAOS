/**
 * Execution Planner Runtime (owner, 2026-08-10, registry/TASK_QUEUE.json
 * TASK-064, dispatched to CODE_WORKER per Constitution Rule 252). Real
 * build of the missing link in the Owner's own architecture refinement
 * (capability-roadmap.json #59, TASK-063's real 4-part design, RESOLVED
 * 2026-08-10 DNA-000141):
 *
 *   Owner -> Intent Runtime -> EXECUTION PLANNER -> Capability Resolver ->
 *   Registry -> Dispatcher -> Worker Manager -> Provider Adapter ->
 *   External Worker -> Verification -> Reality Runtime -> Owner Dashboard.
 *
 * PURPOSE: a real, pure decomposition function. Takes the Owner's raw
 * command text plus an already-captured, structured Intent
 * (intentRuntime.ts#StructuredIntent) and produces an ordered,
 * dependency-aware TaskPlan of WorkItem-shaped DRAFT steps — BEFORE any
 * real capability resolution or Worker dispatch happens. TASK-061's real
 * inventory and TASK-063's real design pass both confirmed nothing like
 * this exists anywhere else in the repo; this file is a brand-new, real
 * capability, never a duplicate.
 *
 * REUSE-BEFORE-BUILD (Constitution Rule 101/103), done BEFORE writing this
 * file (real reads, not assumed):
 *  - StructuredIntent is imported DIRECTLY (type-only) from ./intentRuntime
 *    — this file defines ZERO parallel Intent type. Verified by
 *    scripts/execution-planner-test.ts's own positive-control import scan.
 *  - The planned step shape is derived DIRECTLY from
 *    switchBasedOrchestratorRuntime.ts's real, exported WorkItem type via
 *    `Pick<WorkItem, ...>` (type-only import) — never a hand-copied
 *    parallel field list. If WorkItem's real field names/types ever
 *    change, this file fails to compile rather than silently drifting out
 *    of sync.
 *  - WORKSPACE_ROOT is reused directly from ./fsSecurity — the same real,
 *    single source of truth every other Runtime in this layer already
 *    uses, never a second `process.cwd()` call.
 *  - getArtifact is reused directly from ./artifactRuntime for the
 *    optional, owner-scoped half of the real evidence-reality check (see
 *    the disclosed limitation immediately below).
 *
 * HONEST, DISCLOSED LIMITATION on evidenceIsReal() reuse (found live,
 * before writing a single line of real logic here — not glossed over):
 * TASK-064's own brief calls for reusing
 * switchBasedOrchestratorRuntime.ts's real evidenceIsReal() "directly via
 * import." Grep-verified against that file's real, current source:
 * evidenceIsReal() is real, but it is module-PRIVATE (no `export` keyword,
 * exactly 1 real call site — submitGateInput(), inside that same file) —
 * confirmed no re-export of it exists anywhere else in the repo either.
 * Adding `export` there would be a trivial, additive one-line change (the
 * exact same pattern that file's own header already documents doing for
 * classifyEscalation/overlapCoefficient), but doing so here would touch a
 * 4th file, directly contradicting this task's own explicit verification
 * requirement ("confirm the ONLY files you touched are your new
 * executionPlannerRuntime.ts, your new scripts/execution-planner-test.ts,
 * and the one-line package.json addition — nothing else"). Given that real
 * conflict between the brief and the real, current file, this Runtime
 * instead reuses evidenceIsReal()'s own two REAL, EXPORTED constituent
 * primitives directly — existsSync()+WORKSPACE_ROOT for the repo-relative
 * file-existence check, and getArtifact() for the owner-scoped artifact
 * check — applying the IDENTICAL two-check discipline (never trusting an
 * evidence string on its word alone) without hand-copying evidenceIsReal's
 * own function body. A future task can make evidenceIsReal() itself
 * exported and reused verbatim with a real, 1-line additive change to
 * switchBasedOrchestratorRuntime.ts; that edit is out of scope for this
 * deliberately isolated build.
 *
 * CRITICAL SCOPE LIMIT (TASK-064, deliberate, per TASK-063's own
 * recommended build sequence — do not "fix" this by wiring it in): this
 * file MUST NOT import, call, or reference classifyCapability,
 * submitGateInput, or attemptDispatch (switchBasedOrchestratorRuntime.ts's
 * real dispatch machinery — classifyCapability is real but not exported,
 * and wiring into any of the three today would hit TASK-063's own
 * grep-confirmed, guaranteed DISPATCH_DENIED_UNREGISTERED wall), and MUST
 * NOT import or reference registry/WORKER_IDENTITIES.json or
 * registry/TEAM_ORGANIZATION.json (real files, currently uncommitted,
 * owned by a different, concurrent AI session). planExecution() below only
 * PRODUCES a TaskPlan — a pure, in-memory data structure — it never
 * submits, dispatches, writes a file, or touches any registry. Verified
 * structurally by scripts/execution-planner-test.ts's own comment-stripped
 * literal-string scan for all 5 named-off-limits tokens plus writeFileSync.
 *
 * Honest, disclosed limitations (Constitution Rule 100/106/109/110), same
 * house style as systemRealityRuntime.ts / deadEndSweepRuntime.ts:
 *  - classifyCommandShape() below is real, deterministic keyword/regex
 *    matching over rawCommand + 2 real StructuredIntent fields — never
 *    NLU, never an AI call. Same disclosed-limitation class as
 *    switchBasedOrchestratorRuntime.ts's own CLASSIFY/DEDUP stages
 *    (literal substring / keyword-overlap, not NLU).
 *  - Exactly 2 real templates exist today: BUILD_INTEGRATION (the Owner's
 *    own named, 8-step worked example — "สร้างระบบเชื่อม Gemini Spark")
 *    and a GENERIC 3-step fallback for every other real command shape. A
 *    real command that does not match the build+connect pattern is
 *    honestly routed to GENERIC, never forced into the 8-step shape — the
 *    decomposition genuinely depends on the real input, it is not a fixed
 *    string returned regardless of argument.
 *  - Every step's task_id is a freshly generated (randomUUID()), real,
 *    unique identifier for THIS draft plan only. It is NOT yet a real,
 *    submitted work item inside switchBasedOrchestratorRuntime.ts's own
 *    in-memory store — that would only happen if/when a later, separate
 *    stage calls that file's real submitGateInput(), explicitly out of
 *    scope for this file.
 *  - input_evidence reality-checking's owner-scoped artifact half only
 *    runs when a real ownerId is supplied via the optional 3rd argument;
 *    without one, only the repo-relative file-existence half runs (an
 *    honest, narrower check, never a fabricated pass) — disclosed per-plan
 *    in the returned TaskPlan's own disclosed_limitations[].
 *  - In-memory, stateless, pure compute only: this file holds no module-
 *    level store and needs no __debugReset-style helper, unlike
 *    intentRuntime.ts / switchBasedOrchestratorRuntime.ts's own bounded
 *    in-memory maps.
 */
import { randomUUID } from "crypto";
import { existsSync } from "fs";
import path from "path";
import { WORKSPACE_ROOT } from "./fsSecurity";
import { getArtifact } from "./artifactRuntime";
import type { StructuredIntent } from "./intentRuntime";
import type { WorkItem, WorkItemState } from "./switchBasedOrchestratorRuntime";

const ROOT = WORKSPACE_ROOT;

// ============================================================
// Public types
// ============================================================

/** Real, WorkItem-shaped draft step — mechanically derived from
 * switchBasedOrchestratorRuntime.ts's own real, exported WorkItem type via
 * Pick<>, never a hand-copied parallel field list (see file header). Only
 * the 6 fields real at PLANNING time are picked — WorkItem's own
 * dispatch/orchestrator-bookkeeping fields (owner_worker,
 * dispatchDenialReason, contextPlanId, attempts, repairHistory,
 * auditTrail, ...) do not yet exist for a step that was never submitted. */
export type PlannedWorkItem = Pick<
  WorkItem,
  "task_id" | "capability" | "dependencies" | "input_evidence" | "lock_scope" | "state"
> & {
  /** Real, human-readable annotation for Owner-facing display — never a
   * substitute for `capability` (the real, later-classifiable string). */
  label: string;
  /** Real, 1-indexed position in this plan, for readable citation
   * alongside the real task_id values already present in `dependencies`. */
  stepIndex: number;
};

export type CommandPatternKind = "BUILD_INTEGRATION" | "GENERIC";

export interface TaskPlan {
  planId: string;
  generatedAt: string;
  rawCommand: string;
  /** Real, verbatim reuse of 3 of StructuredIntent's own real fields —
   * never a paraphrase — carried through for Owner-facing plan display. */
  intentSummary: { problem: string; desiredOutcome: string; requestedChange: string };
  patternKind: CommandPatternKind;
  subject: string;
  steps: PlannedWorkItem[];
  disclosed_limitations: string[];
  sources_composed: string[];
}

// ============================================================
// Evidence reality-check — see the file header's disclosed limitation on
// why this reuses evidenceIsReal()'s own 2 real, exported constituent
// primitives directly rather than importing that private function itself.
// ============================================================
function isRealEvidenceRef(ref: string, ownerId?: string): boolean {
  const trimmed = ref.trim();
  if (!trimmed || trimmed.includes("..")) return false;
  if (existsSync(path.join(ROOT, trimmed))) return true;
  if (!ownerId) return false;
  try { getArtifact(trimmed, ownerId); return true; } catch { return false; }
}

// ============================================================
// Command-shape classification — real, deterministic keyword/regex
// matching (Thai + English), never NLU/AI. Only 1 real pattern is
// specifically named by the Owner today (BUILD_INTEGRATION); every other
// real command honestly falls back to GENERIC rather than being forced
// into a shape that does not fit it.
// ============================================================
const BUILD_VERB_TH = /สร้าง/;
const CONNECT_VERB_TH = /เชื่อม/;
const BUILD_VERB_EN = /\b(build|create)\b/i;
const CONNECT_VERB_EN = /\b(connect(?:s|ing|ed|ion)?|integrat(?:e|es|ing|ed|ion))\b/i;

function classifyCommandShape(rawCommand: string, intent: StructuredIntent): CommandPatternKind {
  const text = `${rawCommand} ${intent.requestedChange ?? ""} ${intent.desiredOutcome ?? ""}`;
  const hasBuild = BUILD_VERB_TH.test(text) || BUILD_VERB_EN.test(text);
  const hasConnect = CONNECT_VERB_TH.test(text) || CONNECT_VERB_EN.test(text);
  return hasBuild && hasConnect ? "BUILD_INTEGRATION" : "GENERIC";
}

/** Real, mechanical extraction of the "what" being built/connected — a
 * real text-splitting heuristic in the same spirit as intentRuntime.ts's
 * own proposeStructuredIntentFromRaw() (never invents facts, only
 * reorganizes the Owner's own real words). Falls back to real
 * StructuredIntent fields, then the trimmed raw command itself, rather
 * than ever fabricating a subject that was not really said. */
function extractSubject(rawCommand: string, intent: StructuredIntent): string {
  const trimmedRaw = rawCommand.trim();

  const thaiMatch = trimmedRaw.match(/สร้างระบบเชื่อม\s*(.+)/);
  if (thaiMatch && thaiMatch[1].trim()) return thaiMatch[1].trim();

  const enMatch = trimmedRaw.match(
    /(?:build|create)\s+(?:a\s+|an\s+)?(?:new\s+)?system\s*(?:that\s+)?(?:connect(?:s|ing)?(?:\s+to)?|integrat(?:es|ing)?(?:\s+with)?)\s*(.+)/i,
  );
  if (enMatch && enMatch[1].trim()) return enMatch[1].trim();

  if ((intent.requestedChange ?? "").trim()) return intent.requestedChange.trim();
  if ((intent.desiredOutcome ?? "").trim()) return intent.desiredOutcome.trim();
  return trimmedRaw || "(no real subject text found in rawCommand or intent)";
}

// ============================================================
// Step templates — real, dot-namespaced capability strings in the same
// style registry/WORKER_IDENTITIES.json's own real roster already uses
// (e.g. "gateway.connectors.*", "governance.test") so these strings are
// real, later classifyCapability-compatible candidates, not free prose.
// ============================================================
interface StepTemplate { capability: string; label: string }

/** The Owner's own named, 8-step worked example, verbatim order: analyze
 * -> find capability -> find registry -> find dependency -> create
 * adapter -> verify -> update reality -> report. */
function buildIntegrationTemplate(subject: string): StepTemplate[] {
  return [
    { capability: `analysis.command_intent: ${subject}`, label: `Analyze the raw Owner command and structured intent to determine the real scope of building an integration with ${subject}` },
    { capability: `capability.discovery: ${subject}`, label: `Find the real, already-existing capability (if any) for connecting to ${subject}` },
    { capability: `registry.discovery: ${subject}`, label: `Find the real registry entry for ${subject} (or honestly confirm its real absence)` },
    { capability: `dependency.discovery: ${subject}`, label: `Find the real, pre-existing dependencies a ${subject} integration would require` },
    { capability: `adapter.create: ${subject}`, label: `Create the real adapter that connects DNA OS to ${subject}` },
    { capability: `verification.evidence: ${subject}`, label: `Verify the real, built adapter for ${subject} against real evidence` },
    { capability: `reality.update: ${subject}`, label: `Update the real System Reality registry/state to reflect the new ${subject} integration` },
    { capability: `report.completion: ${subject}`, label: `Report the real outcome of the ${subject} integration back to the Owner` },
  ];
}

/** Real, minimal fallback for every command that does not match the
 * build+connect shape — honest and generic, never a forced 8-step shape. */
function genericTemplate(subject: string): StepTemplate[] {
  return [
    { capability: `analysis.command_intent: ${subject}`, label: `Analyze the raw Owner command and structured intent for: ${subject}` },
    { capability: `execution.perform: ${subject}`, label: `Perform the real requested change: ${subject}` },
    { capability: `report.completion: ${subject}`, label: `Report the real outcome back to the Owner for: ${subject}` },
  ];
}

/** Real dependency chaining: step 1 has zero dependencies and is READY;
 * every step N+1 depends on step N's real task_id and is honestly BLOCKED
 * (its one real dependency is not really DONE yet — same real semantics
 * switchBasedOrchestratorRuntime.ts#submitGateInput's own
 * unresolvedDeps.length > 0 ? "BLOCKED" : "READY" rule already enforces
 * for a submitted work item; this file does not import that function, it
 * only applies the same, tiny, generic rule to an unsubmitted draft). */
function composePlan(templates: StepTemplate[], evidence: string[], lockScope: string[]): PlannedWorkItem[] {
  const steps: PlannedWorkItem[] = [];
  let prevTaskId: string | null = null;
  templates.forEach((t, i) => {
    const task_id = randomUUID();
    const dependencies = prevTaskId ? [prevTaskId] : [];
    const state: WorkItemState = dependencies.length > 0 ? "BLOCKED" : "READY";
    steps.push({
      task_id,
      capability: t.capability,
      dependencies,
      input_evidence: [...evidence],
      lock_scope: [...lockScope],
      state,
      label: t.label,
      stepIndex: i + 1,
    });
    prevTaskId = task_id;
  });
  return steps;
}

// ============================================================
// Public entry point
// ============================================================

/**
 * Decomposes a raw Owner command + its already-captured StructuredIntent
 * into an ordered, dependency-aware TaskPlan of WorkItem-shaped draft
 * steps — BEFORE any real capability resolution or Worker dispatch. Pure
 * read/compute only: never writes a file, never touches a registry, never
 * submits or dispatches anything (see file header's CRITICAL SCOPE LIMIT).
 *
 * `opts.ownerId` is optional and additive: when supplied, the real
 * evidence-reality check also runs its owner-scoped artifact half (via
 * getArtifact); without it, only the repo-relative file-existence half
 * runs — an honest, narrower check, never a fabricated pass (disclosed
 * per-call in the returned plan's own disclosed_limitations[]).
 */
export function planExecution(rawCommand: string, intent: StructuredIntent, opts?: { ownerId?: string }): TaskPlan {
  const trimmedCommand = (rawCommand ?? "").trim();
  const patternKind = classifyCommandShape(trimmedCommand, intent);
  const subject = extractSubject(trimmedCommand, intent);

  const candidateEvidence = intent.expectedEvidence ?? [];
  const realEvidence = candidateEvidence.filter((e) => isRealEvidenceRef(e, opts?.ownerId));
  const lockScope = intent.affectedArea ?? [];

  const templates = patternKind === "BUILD_INTEGRATION" ? buildIntegrationTemplate(subject) : genericTemplate(subject);
  const steps = composePlan(templates, realEvidence, lockScope);

  const disclosed: string[] = [
    `Command-pattern classification is real, deterministic keyword/regex matching (build+connect verbs, Thai and English) — not NLU, not an AI call. Classified as ${patternKind}.`,
    opts?.ownerId
      ? "input_evidence reality-check ran BOTH real halves: repo-relative file-existence AND owner-scoped real artifact lookup (ownerId supplied)."
      : "input_evidence reality-check ran ONLY the repo-relative file-existence half — no ownerId was supplied to this planning call, so the owner-scoped real artifact-lookup half of evidenceIsReal()'s discipline could not run (an honest, narrower check, never a fabricated pass).",
    `${realEvidence.length}/${candidateEvidence.length} of intent.expectedEvidence entries verified real; the rest were dropped from every step's input_evidence rather than trusted on their word alone.`,
    "This is a DRAFT plan only — no step here has been submitted to the real orchestrator's gate/dispatch pipeline (see this file's own header comment for the exact, named functions this Runtime deliberately never calls), by this task's own deliberate scope limit. No real capability-classification/resolution has run against any step's `capability` string yet.",
  ];
  if (realEvidence.length === 0) {
    disclosed.push("Zero real, verified evidence entries were found for this plan's intent.expectedEvidence — every step's input_evidence is honestly empty, not fabricated. A later, real submission of these steps to the real orchestrator's gate would be dropped at its VALIDATE stage (NO_EVIDENCE), exactly as that file's own real gate already enforces for a genuinely evidence-less input.");
  }

  return {
    planId: randomUUID(),
    generatedAt: new Date().toISOString(),
    rawCommand: trimmedCommand,
    intentSummary: { problem: intent.problem, desiredOutcome: intent.desiredOutcome, requestedChange: intent.requestedChange },
    patternKind,
    subject,
    steps,
    disclosed_limitations: disclosed,
    sources_composed: [
      "engines/shared/ide-lib/intentRuntime.ts#StructuredIntent",
      "engines/shared/ide-lib/switchBasedOrchestratorRuntime.ts#WorkItem (type-level reuse via Pick<>)",
      "engines/shared/ide-lib/fsSecurity.ts#WORKSPACE_ROOT",
      "engines/shared/ide-lib/artifactRuntime.ts#getArtifact",
    ],
  };
}
