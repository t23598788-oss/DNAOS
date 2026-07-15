/**
 * DNA OS Shared Types — Single Source of Truth
 * ทุก Layer import จากที่นี่เท่านั้น ห้ามสร้าง type ซ้ำในไฟล์อื่น
 */

// ── Command Types (V1-Input + UI) ──

export interface Command {
  action: string;
  target?: string;
  payload?: Record<string, unknown>;
}

export interface CommandResult {
  ok: boolean;
  command: Command;
  data?: unknown;
  error?: string;
}

export type ViewMode = "json" | "table" | "text";

// ── Runtime Types (Runtime Engine) ──

export interface RuntimeCommand {
  version: number;
  command: string;
  args: Record<string, unknown>;
  traceId?: string;
}

export interface RuntimeResult {
  success: boolean;
  command: string;
  traceId: string;
  timestamp: string;
  source: string;
  data?: unknown;
  error?: string;
  events: RuntimeEvent[];
}

export interface RuntimeEvent {
  id: string;
  type: string;
  source: string;
  timestamp: string;
  traceId: string;
  data?: unknown;
}

// ── Workflow Types ──

export type AppStatus = "running" | "focused" | "background" | "closed";

export interface StepResult {
  ok: boolean;
  step: string;
  app: string;
  data?: unknown;
  error?: string;
  durationMs: number;
}

export interface WorkflowResult {
  ok: boolean;
  workflow: string;
  app: string;
  steps: { step: string; status: string; durationMs: number; data?: unknown; error?: string }[];
  totalMs: number;
  error?: string;
}

export interface AppDriver {
  appName: string;
  bundleId: string;
  launch(): Promise<StepResult>;
  focus(): Promise<StepResult>;
  close(): Promise<StepResult>;
  search(query: string): Promise<StepResult>;
  click(target: string): Promise<StepResult>;
  type(text: string): Promise<StepResult>;
  read(): Promise<StepResult>;
  status(): Promise<AppStatus>;
}

export interface CommandMatch {
  workflow: string;
  args: Record<string, string>;
}

export interface CommandEntry {
  patterns: string[];
  workflow: string;
  app?: string;
}

export interface WorkflowDef {
  steps: string[];
  confirm: boolean;
}

export interface AuditEntry {
  id: number;
  workflow: string;
  app: string;
  step: string;
  result: "success" | "failed";
  durationMs: number;
  timestamp: number;
  error?: string;
}

// ── Debt Types ──

export type DebtStatus =
  | "ACTIVE_CREDIT"
  | "WAIT_PAYMENT"
  | "OVERDUE"
  | "DEBT"
  | "COLLECTION"
  | "PARTIAL_PAYMENT"
  | "CLOSED";

// ── Partner Timeline Types ──

export type BusinessEventType =
  | "quotation_sent"
  | "po_received"
  | "delivery_made"
  | "invoice_issued"
  | "payment_received"
  | "credit_note_issued"
  | "line_chat"
  | "note";

export interface BusinessEvent {
  id: string;
  partner_id: string | null;
  transaction_id: string | null;
  event_type: BusinessEventType;
  event_date: string;
  title: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ── Transaction (ERP State Machine) ──

export type TxState =
  | "initiated" | "confirmed" | "started"
  | "delivered" | "invoiced" | "paid" | "receipted" | "closed";

export type TxType =
  | "sale" | "purchase" | "contract" | "service" | "rental" | "transport";

export interface Transaction {
  id: string;
  partner_id: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  title: string | null;
  tx_type: TxType;
  state: TxState;
  state_changed_at: string;
  net_amount: number | null;
  paid_amount: number | null;
  vat_amount: number | null;
  project_name: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type TimelineEntryKind = "document" | "business_event";

export interface PartnerTimelineEntry {
  date: string;
  kind: TimelineEntryKind;
  template_id: import("@/engines/presentation/template-resolver").PresentationTemplateId;
  template_key: string;
  event_type: string;
  title: string;
  subtitle: string | null;
  amount: number | null;
  status: string | null;
  document_id?: string;
  document_number?: string;
  business_event_id?: string;
  transaction_id?: string;
  artifacts?: {
    kind: "document";
    document_id: string;
    document_number: string;
    document_type: string;
    status: string | null;
    amount: number | null;
  }[];
}

export interface PartnerSummary {
  id: string;
  name: string;
  partner_type_label: string | null;
  phone: string | null;
  total_invoiced: number;
  total_received: number;
  outstanding: number;
  last_activity: string | null;
  document_count: number;
}

// ── Self Description Interface (SDRN-P1, registry/CHANGELOG.json DNA-000028) ──
// Every field must be computed from real registry/architecture-book data — no
// invented percentages or fabricated status. If a real signal isn't available,
// say so explicitly rather than guessing (matches this project's own ห้ามเดา rule).

export type SelfDescriptionStatus = "READY" | "NOT_READY" | "PARTIAL";
export type RuntimeConnectionState = "wired" | "not_wired" | "partial";

export interface SelfDescription {
  identity: string;                 // Who am I?
  responsibility: string;           // What is my responsibility?
  owner: string;                    // Who owns me?
  capabilities: string[];           // Which capability do I belong to? (real CapabilityIds)
  runtimeConnection: RuntimeConnectionState; // Which Runtime am I connected to?
  runtimeConnectionNote: string;
  calledBy: string[];               // Which modules can call me? (real, computed from the import graph)
  calls: string[];                  // Which modules do I call?
  resourcesNeeded: string[];        // What resources do I need? (empty array is a real, honest answer)
  missing: string[];                // What am I currently missing? (missing capability/wiring — see missingKnowledge for missing FACTS)
  status: SelfDescriptionStatus;    // What is my current status?
  healthSignals: Record<string, string | number | boolean>; // real, individually-labeled signals — no single fabricated score
  changedSince: string[];           // What changed since the last session? (from CHANGELOG.json, empty if none found)
  aiShouldKnow: string[];           // What should an AI know before touching me?
  // Constitution C-011 (owner, 2026-07-15, DNA-000059), amended into Rule 102 —
  // the 2 real fields the prior 9-field SelfDescription contract was missing.
  constraints: string[];            // real, structural limits on changing this module (e.g. an active architecture_freeze) — empty array is a real, honest answer, not omission
  missingKnowledge: string[];       // facts this module's description cannot answer (distinct from `missing`, which is missing CAPABILITY/wiring, not missing FACTS)
  verificationProcedure: string;    // how to confirm this module is actually working — real command(s)/registry checks, not a vague claim
  generatedAt: string;
  source: string;                   // which real files this description was computed from
}

// ── Runtime Self-Describing Contract (SDRN-P6, registry/CHANGELOG.json DNA-000060) ──
// Owner directive: "Architecture Directive: Runtime Self-Describing Contract" —
// scoped by explicit owner choice (AskUserQuestion, 2026-07-15) to type/protocol
// definition + 2 real implementations (Document Engine, LINE driver), NOT a
// repo-wide rollout — see registry/CURRENT_STATE.json plan_lock.exceptions_log
// SDRN-P6 and registry/GOVERNANCE_REGISTRY.json programs.SDRN.
//
// Built ON TOP of SelfDescription (does not replace it) — RuntimeContract is a
// superset: every SelfDescription field maps onto one of RuntimeContract's 19
// named fields, plus 7 new ones the directive named that SelfDescription never
// had (responsibilities as distinct from capabilities, knownProblems,
// missingCapabilities, missingDependencies as distinct from missingKnowledge,
// executionScope, forbiddenScope, successCriteria, confidence, lastValidation).
export type ConfidenceLevel = "high" | "medium" | "low";

export interface RuntimeContract {
  identity: string;                 // Who am I? (module path + one-line description)
  purpose: string;                  // Why do I exist?
  responsibilities: string[];       // What do I actually DO (concrete, real methods/actions) — distinct from capabilities (what I'm registered/known as)
  capabilities: string[];           // Which registered Capability/Driver/Command do I fulfill (real registry ids)
  dependencies: { calledBy: string[]; calls: string[] }; // real, computed from the import graph — never guessed
  constraints: string[];            // real structural limits on changing me (e.g. an active architecture_freeze) — empty array is a real, honest answer
  health: Record<string, string | number | boolean>; // real, individually-labeled signals — no single fabricated score
  currentState: string;             // real operational status, human-readable
  knownProblems: string[];          // real, already-documented issues (e.g. a known_mistakes cross-reference) — empty array if none found
  missingKnowledge: string[];       // facts I cannot answer about myself
  missingCapabilities: string[];    // required interface methods I do NOT implement (computed against a real contract, e.g. AppDriver) — empty array is a real, verified "nothing missing", not an unchecked guess
  missingDependencies: string[];    // real dependencies I need but don't have wired
  resourcesNeeded: string[];        // real external resources required to operate (e.g. "a running macOS host with LINE.app installed")
  requestedActions: string[];       // real, currently-open owner_requests/tasks naming me — empty array if none found
  executionScope: string[];         // real file paths an AI may modify when working on me
  forbiddenScope: string[];         // real file paths an AI must NOT modify without separate authorization (e.g. shared base classes, deprecated siblings under Rule 104)
  verificationProcedure: string;    // real command(s)/registry checks that confirm I work — must name what is NOT covered too, not just what is
  successCriteria: string[];        // real, checkable conditions that define "done" for a change to me
  confidence: ConfidenceLevel;      // honest confidence in this contract's own completeness — never claimed "high" for facts that weren't directly verified
  lastValidation: string;           // ISO timestamp + what was actually checked, not just "recently"
  generatedAt: string;
  source: string;                   // which real files this contract was computed from
}

// ── Runtime Negotiation Flow (SDRN-P6) ──
// The directive's BOOT -> Self Announcement -> Runtime Contract -> Knowledge Gap
// -> Work Request -> AI Execution -> Verification -> State Update -> Registry
// Commit sequence, as a real type + a pure function that computes which stage a
// module is REALLY in from its real RuntimeContract data — not a persistent
// state machine (no process stays running between requests in this serverless
// app, same constraint SDRN-P3/P5 already stated honestly).
export type NegotiationStage =
  | "boot"
  | "self_announcement"
  | "runtime_contract"
  | "knowledge_gap"
  | "work_request"
  | "ai_execution"
  | "verification"
  | "state_update"
  | "registry_commit";

export interface NegotiationFlowState {
  stage: NegotiationStage;
  reason: string;                   // why THIS stage, computed from real contract fields, not guessed
  contract: RuntimeContract;
}

/**
 * Computes the real current negotiation stage for a module from its own
 * RuntimeContract — pure, deterministic, no side effects. A module with real
 * missingKnowledge/missingCapabilities/missingDependencies is at "knowledge_gap";
 * one with real requestedActions and no gaps is at "work_request"; one with
 * neither is considered already past negotiation ("registry_commit" — its
 * contract is the current source of truth, nothing pending).
 */
export function computeNegotiationStage(contract: RuntimeContract): NegotiationFlowState {
  const hasGap =
    contract.missingKnowledge.length > 0 ||
    contract.missingCapabilities.length > 0 ||
    contract.missingDependencies.length > 0;
  const hasWorkRequest = contract.requestedActions.length > 0;

  if (hasGap) {
    return {
      stage: "knowledge_gap",
      reason: `Real gap(s) found: ${[...contract.missingKnowledge, ...contract.missingCapabilities, ...contract.missingDependencies].join("; ")}`,
      contract,
    };
  }
  if (hasWorkRequest) {
    return {
      stage: "work_request",
      reason: `Real requested action(s) pending: ${contract.requestedActions.join("; ")}`,
      contract,
    };
  }
  return {
    stage: "registry_commit",
    reason: "No real knowledge gap or requested action found — contract is current, nothing pending negotiation.",
    contract,
  };
}

// ── Platform-level Runtime Contract infrastructure (SDRN-P7, registry/CHANGELOG.json
// DNA-000061) ── Owner directive: "Architecture Upgrade Directive" (System-Wide Runtime
// Execution Platform), scoped by explicit owner instruction (custom AskUserQuestion
// answer, 2026-07-15 — see registry/CURRENT_STATE.json plan_lock.exceptions_log SDRN-P7)
// to: full type/schema infrastructure + real Contract Coverage metric + honest
// null-with-reason schema for the 6 metrics this repo cannot actually observe.
// RuntimeNegotiation is NOT re-declared here — it already exists as
// NegotiationFlowState/computeNegotiationStage() above (Rule 101/103, C-010: reuse,
// don't duplicate).
//
// All functions below are PURE (no fs/network I/O) so this file stays safely
// importable by client components, same constraint the existing SelfDescription/
// RuntimeContract types already respect. Anything that needs to scan the real
// filesystem (e.g. computing total Contract Coverage across the repo) lives in a
// separate script, not here — see scripts/hello.ts's --contract-coverage flag.

export interface ContextBudget {
  requiredContext: string[];        // real files this module's own understanding depends on (contract.dependencies.calls)
  optionalContext: string[];        // real files that call this module — useful but not required to understand it (contract.dependencies.calledBy)
  skipContext: string[];            // real files explicitly known NOT to read (contract.forbiddenScope)
  estimatedTokenBudget: number | null; // a rough, stated proxy (file count x an explicit constant) — NOT a measured token count, no tokenizer exists in this environment
  note: string;                     // discloses the estimation method honestly
}

/**
 * Pure projection from an existing RuntimeContract — no new data, no fs reads.
 */
export function computeContextBudget(contract: RuntimeContract): ContextBudget {
  const ESTIMATED_TOKENS_PER_FILE = 400; // a stated, round, admittedly-rough constant — see note
  const requiredContext = contract.dependencies.calls;
  const optionalContext = contract.dependencies.calledBy;
  return {
    requiredContext,
    optionalContext,
    skipContext: contract.forbiddenScope,
    estimatedTokenBudget: (requiredContext.length + optionalContext.length) * ESTIMATED_TOKENS_PER_FILE,
    note: `Rough proxy only: (${requiredContext.length} required + ${optionalContext.length} optional files) x ${ESTIMATED_TOKENS_PER_FILE} tokens/file (a stated constant, not measured). This is NOT a real token count — no tokenizer runs in this environment. Treat as an order-of-magnitude estimate, not a budget guarantee.`,
  };
}

export interface DeltaContext {
  contractVersion: string;          // real, deterministic hash of the contract's own content
  previouslyProcessed: boolean;     // true only if a previousVersionHash was supplied AND matches — false (not "unknown") if none was supplied
  changed: boolean;                 // real: true if a previousVersionHash was supplied and does NOT match
  note: string;
}

/**
 * Real, deterministic hash (no crypto import needed — a simple content hash is
 * sufficient for change detection, not security). Comparison against a prior
 * version requires the CALLER to have persisted that prior hash somewhere (this
 * repo has no session memory of its own) — stated honestly, not glossed over.
 */
function simpleContentHash(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return `h${(hash >>> 0).toString(16)}`;
}

export function computeDeltaContext(contract: RuntimeContract, previousVersionHash?: string): DeltaContext {
  // generatedAt/lastValidation are excluded from the hash — they change on every
  // call by design (real timestamps), which would make every call "changed" and
  // defeat the entire purpose of Delta Context.
  const { generatedAt: _g, lastValidation: _l, ...stableContent } = contract;
  const contractVersion = simpleContentHash(JSON.stringify(stableContent));
  const previouslyProcessed = previousVersionHash !== undefined && previousVersionHash === contractVersion;
  const changed = previousVersionHash !== undefined && previousVersionHash !== contractVersion;
  return {
    contractVersion,
    previouslyProcessed,
    changed,
    note: previousVersionHash === undefined
      ? "No previousVersionHash supplied — this repo has no persistent session memory of its own; the CALLER (an AI session, or a future real instrumentation layer) must track which contractVersion it has already seen."
      : changed
        ? "Content changed since the supplied previousVersionHash — full re-read recommended."
        : "Content unchanged since the supplied previousVersionHash — real, verified, safe to skip re-reading.",
  };
}

export interface WorkOrder {
  objective: string;
  scope: string[];
  allowedFiles: string[];
  protectedFiles: string[];
  verificationProcedure: string;
  successCriteria: string[];
}

/**
 * Pure projection — a Work Order is a task-scoped VIEW of fields that already
 * exist on RuntimeContract, not new data (Objective=purpose, Scope=responsibilities,
 * Allowed/Protected Files=executionScope/forbiddenScope, Verification/Success
 * already exist verbatim).
 */
export function deriveWorkOrder(contract: RuntimeContract): WorkOrder {
  return {
    objective: contract.purpose,
    scope: contract.responsibilities,
    allowedFiles: contract.executionScope,
    protectedFiles: contract.forbiddenScope,
    verificationProcedure: contract.verificationProcedure,
    successCriteria: contract.successCriteria,
  };
}

// ── Execution Planner (SDRN-P9, registry/CHANGELOG.json DNA-000063) ──
// A real, buildable subset of a larger 'Architecture Upgrade Directive' —
// scoped down via AskUserQuestion (2026-07-15) after most of that directive's
// items were found to be either already built (Broker/Contract/Delta Context),
// overlapping existing tools (a 'Context Optimizer' duplicating knip/jscpd), or
// not achievable in this repository (mechanically gating repository access,
// caching the AI's own reasoning — neither is data this codebase can observe
// or store). ExecutionPlan is WorkOrder plus one real addition: expectedOutput,
// derived from the contract's own responsibilities/capabilities, not fabricated.
export interface ExecutionPlan extends WorkOrder {
  expectedOutput: string;
}

export function deriveExecutionPlan(contract: RuntimeContract): ExecutionPlan {
  return {
    ...deriveWorkOrder(contract),
    expectedOutput: contract.capabilities.length > 0
      ? `Fulfillment of: ${contract.capabilities.join(", ")} — per this module's own declared responsibilities: ${contract.responsibilities.join("; ")}`
      : `No registered capability found — expected output limited to: ${contract.responsibilities.join("; ") || "not declared"}`,
  };
}

// ── AI Knowledge Packet completion (SDRN-P10, registry/CHANGELOG.json
// DNA-000064) ── Owner directive: "Transform RuntimePacket into a complete
// AI Knowledge Packet. AI SHALL execute directly from the packet without
// reconstructing architectural knowledge." Real gap found in the existing
// RuntimePacket (SDRN-P6..P9): an AI reading it still had to cross-reference
// 6 separate sub-objects to get one picture, and the module's LAYER +
// ALLOWED IMPORTS existed only as unstructured prose inside `constraints`,
// not a queryable field. Treated as a direct continuation of the same 2-module
// scope under Rule 105 (no new modules, no business logic, pure synthesis of
// already-real data, existing rules already cover it) — not a new Plan Lock
// exception, same reasoning as SDRN-P8.
export function computeBriefing(contract: RuntimeContract, readiness: ExecutionReadiness): string {
  const parts = [
    `${contract.identity}`,
    `State: ${contract.currentState} (confidence: ${contract.confidence}).`,
    readiness.ready
      ? "Ready to execute — no blocking gaps found."
      : `NOT ready — blocked by: ${readiness.blockers.join("; ")}`,
    contract.constraints.length > 0 ? `Constraints: ${contract.constraints.join(" ")}` : "No real constraints found.",
    contract.knownProblems.length > 0 ? `Known problems: ${contract.knownProblems.join(" ")}` : "No known problems found.",
  ];
  return parts.join(" ");
}

export interface ExecutionReadiness {
  ready: boolean;
  blockers: string[];               // real, empty if ready
  computedAt: string;
  note: string;                     // discloses that this is advisory, not a mechanical AI gate
}

/**
 * Real, computed readiness — but ADVISORY ONLY: nothing in this repository
 * intercepts an AI's tool calls to mechanically enforce this. An AI (or a
 * future real enforcement layer, if one is ever built outside this repo)
 * is expected to CONSULT this before proceeding, same honesty pattern already
 * disclosed for Rule 102's "no technical mechanism prevents an AI from acting
 * outside this role today."
 */
export function computeExecutionReadiness(contract: RuntimeContract): ExecutionReadiness {
  const blockers = [...contract.missingCapabilities, ...contract.missingDependencies];
  return {
    ready: blockers.length === 0,
    blockers,
    computedAt: new Date().toISOString(),
    note: "Advisory only — no mechanism in this repository blocks an AI from proceeding regardless of this value. See Rule 102's known_gaps for the same honestly-disclosed limitation.",
  };
}

export interface VerificationContract {
  verificationProcedure: string;
  successCriteria: string[];
}

export function deriveVerificationContract(contract: RuntimeContract): VerificationContract {
  return {
    verificationProcedure: contract.verificationProcedure,
    successCriteria: contract.successCriteria,
  };
}

export interface MeasurementReport {
  repositoryReadCount: number | null;
  contextSize: number | null;
  contextReuseRatio: number | null;
  deltaContextRatio: number | null;
  contractCoverage: number | null;      // the ONE real, computable metric — see computeContractCoverage()
  repositoryScanAvoidance: number | null;
  executionPreparationTimeMs: number | null;
  unmeasurableReason: Record<string, string>; // real disclosure for every null field — never silently null
  generatedAt: string;
}

/**
 * Real, computable: (# modules with a real RuntimeContract implementation) /
 * (total registered modules). The other 6 metrics require observing AI session
 * behavior (token usage, tool-call counts, timing) which this repository has no
 * access to — that data lives in the Claude Code harness, outside this repo.
 * Per the owner's own explicit instruction ("Do not claim a 60% reduction"),
 * those fields are returned as null with a stated reason, never fabricated.
 */
export function buildMeasurementReport(totalModules: number, modulesWithContract: number): MeasurementReport {
  const UNMEASURABLE = "Requires observing AI session behavior (token usage, tool-call counts, timing) — this data lives in the Claude Code harness/session infrastructure, not in this repository. No instrumentation source exists here to populate this honestly; returning null rather than fabricating a number.";
  return {
    repositoryReadCount: null,
    contextSize: null,
    contextReuseRatio: null,
    deltaContextRatio: null,
    contractCoverage: totalModules > 0 ? modulesWithContract / totalModules : null,
    repositoryScanAvoidance: null,
    executionPreparationTimeMs: null,
    unmeasurableReason: {
      repositoryReadCount: UNMEASURABLE,
      contextSize: UNMEASURABLE,
      contextReuseRatio: UNMEASURABLE,
      deltaContextRatio: UNMEASURABLE,
      repositoryScanAvoidance: UNMEASURABLE,
      executionPreparationTimeMs: UNMEASURABLE,
    },
    generatedAt: new Date().toISOString(),
  };
}

// ── Runtime Interface (SDRN-P5, registry/CHANGELOG.json DNA-000035) ──
// A standard set of callable methods every self-describing module could
// expose, built on top of SelfDescription rather than replacing it. All
// methods are synchronous and pull-based (caller invokes, gets current
// state back) — no event bus, no background heartbeat timer, no persistent
// process — because this is a serverless Next.js/Vercel app where nothing
// stays running between requests. Where no real underlying data exists for
// a method (Version, Compatibility), the implementation must say so
// explicitly rather than fabricate a value.

export interface RuntimeVersion {
  version: string;
  note: string;
}

export interface RuntimeCompatibility {
  allowedDependencyLayers: string[];
  source: string;
}

export interface RuntimeRejection {
  rejected: boolean;
  reason: string;
}

export interface RuntimeInterface {
  Describe(): SelfDescription;
  Health(): { status: SelfDescriptionStatus; signals: SelfDescription["healthSignals"] };
  Capability(): string[];
  Dependency(): { calledBy: string[]; calls: string[] };
  Need(): string[];
  Reject(candidatePath: string): RuntimeRejection;
  Recommend(): string[];
  Explain(topic?: string): string;
  Register(): { note: string };
  Heartbeat(): { alive: true; checkedAt: string };
  Status(): SelfDescriptionStatus;
  NextAction(): string;
  Owner(): string;
  Version(): RuntimeVersion;
  Compatibility(): RuntimeCompatibility;
}

// ── Audit Types ──

export interface AuditTrail {
  engine: string;
  inputs: Record<string, unknown>;
  rules_used: Record<string, unknown>;
  result: Record<string, unknown>;
  calculated_at: string;
}

// ── Utility ──

export function round(n: number): number {
  return Math.round(n * 100) / 100;
}
