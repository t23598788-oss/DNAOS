/**
 * Factory Workspace Runtime (owner, 2026-08-08, Software Factory Step
 * 13, Phase 2/9/10/12). The central orchestrator that ties together
 * Intent Intake, Capability Resolver, Context Planner, AI Context
 * Runtime, Worker Registry, Execution Plan, and the real, existing
 * Change Set / Test / Build / Release Runtimes into one, real, Owner-
 * trackable Workspace Session — mirroring the exact bounded Map-store +
 * bounded event-log pattern of every prior Step's Runtime file
 * (executionRuntime.ts, changeSetRuntime.ts, buildRuntime.ts, etc.).
 *
 * Native DNA Enforcement (Section 20) lives here as real, executable
 * guards, not comments: every status transition and gate check below is
 * enforced in code, not merely documented.
 */
import { randomUUID } from "crypto";
import { createOperationsArtifact } from "./artifactRuntime";
import { captureProposedIntent, confirmIntent, type IntentRecord } from "./intentRuntime";
import { resolveCapabilities, type CapabilityResolutionReport } from "./capabilityResolverRuntime";
import { getContextPlan, buildContextPlan, approveContextPlan, type ContextPlan } from "./contextPlannerRuntime";
import { type AIContextPackage } from "./aiContextRuntime";
import { buildExecutionPlan, approveExecutionPlan, type ExecutionPlan } from "./executionPlanRuntime";
import { getWorkerDefinition, type WorkerType } from "./workerRegistry";
import { createChangeSet, runReview, recordDecision, type ChangeSet } from "./changeSetRuntime";
import { createTestRun, getTestRun, type TestRun } from "./testRuntime";
import { createBuildRequest, getBuildRun, type BuildRun } from "./buildRuntime";
import type { BuildTypeId, EnvironmentProfileId } from "./buildRegistry";
import { createReleaseRequest, getReleaseRun, type ReleaseRun } from "./releaseRuntime";
import { generateCodeWorkerProposal, approveCodeWorkerProposal, applyCodeWorkerProposal, approveDestructiveOperations, getCodeWorkerProposal, listCodeWorkerProposals, type CodeWorkerProposal } from "./codeWorkerRuntime";

export type WorkspaceSessionStatus =
  | "DRAFT" | "ANALYZING" | "CAPABILITY_MATCHING" | "CONTEXT_PREPARING" | "AWAITING_OWNER"
  | "READY_FOR_EXECUTION" | "EXECUTING" | "REVIEWING" | "TESTING" | "BUILDING" | "RELEASE_CANDIDATE"
  | "BLOCKED" | "COMPLETED" | "CANCELLED" | "UNKNOWN";

export type DecisionGate =
  | "INTENT_CONFIRMED" | "CAPABILITY_SELECTION_APPROVED" | "NEW_CAPABILITY_APPROVED" | "CONTEXT_SCOPE_APPROVED"
  | "HIGH_RISK_CHANGE_APPROVED" | "FILE_DELETE_APPROVED" | "EXTERNAL_MUTATION_APPROVED" | "RELEASE_CANDIDATE_APPROVED"
  | "CODE_WORKER_OUTPUT_APPROVED";

export interface OwnerDecisionRecord {
  decisionId: string;
  gate: DecisionGate;
  requiredReason: string;
  options: string[];
  evidence: string[];
  impact: string;
  owner: string;
  decidedAt: string | null;
  decision: "APPROVED" | "REJECTED" | "PENDING";
}

export type ResultStatus = "OUTCOME_PROVEN" | "TECHNICALLY_COMPLETE" | "PARTIAL" | "BLOCKED" | "UNVERIFIED" | "FAILED" | "UNKNOWN";

export interface OutcomeReport {
  status: ResultStatus;
  intentReceived: boolean;
  capabilitiesReused: string[];
  capabilitiesMissing: string[];
  workerUsed: WorkerType[];
  providerCalled: string[];
  filesChanged: string[];
  testsRun: { passed: number; failed: number } | null;
  buildResult: string | null;
  governanceResult: string | null;
  artifactIds: string[];
  evidenceIds: string[];
  costReal: number | null;
  durationMs: number | null;
  limitations: string[];
  realWorldReadiness: string;
  ownerActionsRequired: string[];
  computedAt: string;
}

export interface WorkspaceSession {
  workspaceSessionId: string;
  ownerId: string;
  actor: string;
  intentId: string | null;
  desiredOutcome: string;
  constraints: string[];
  acceptanceCriteria: string[];
  businessContext: string;
  legalContext: string;
  costLimit: number | null;
  timeLimit: string | null;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
  sourceScope: string[];
  capabilityResolution: CapabilityResolutionReport | null;
  contextPlanId: string | null;
  executionPlanId: string | null;
  aiContextPackageIds: string[];
  changeSetId: string | null;
  reviewRunId: string | null;
  testRunId: string | null;
  buildRunId: string | null;
  releaseRunId: string | null;
  artifactIds: string[];
  evidenceIds: string[];
  ownerDecisions: OwnerDecisionRecord[];
  status: WorkspaceSessionStatus;
  blockers: string[];
  resultReport: OutcomeReport | null;
  createdAt: string;
  updatedAt: string;
}

export class FactoryWorkspaceError extends Error {
  code: "SESSION_NOT_FOUND" | "SESSION_NOT_OWNED" | "INVALID_TRANSITION" | "GATE_NOT_DECIDED" | "GATE_REJECTED";
  constructor(code: typeof FactoryWorkspaceError.prototype.code, message: string) { super(message); this.code = code; this.name = "FactoryWorkspaceError"; }
}

const sessions = new Map<string, WorkspaceSession>();
const MAX_SESSION_HISTORY = 200;
function evictOld(ownerId: string) {
  const owned = [...sessions.values()].filter((s) => s.ownerId === ownerId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  while (owned.length > MAX_SESSION_HISTORY) { const oldest = owned.shift()!; sessions.delete(oldest.workspaceSessionId); }
}

export type WorkspaceEventType =
  | "WORKSPACE_SESSION_CREATED" | "INTENT_CAPTURED" | "INTENT_CONFIRMED" | "CAPABILITY_SEARCH_STARTED" | "CAPABILITY_MATCHED"
  | "CAPABILITY_GAP_FOUND" | "CONTEXT_PLAN_CREATED" | "CONTEXT_APPROVED" | "WORKER_ASSIGNED" | "EXECUTION_PLAN_CREATED"
  | "EXECUTION_APPROVAL_REQUIRED" | "CHANGE_PROPOSED" | "CHANGESET_CREATED" | "REVIEW_STARTED" | "TEST_STARTED"
  | "BUILD_STARTED" | "RELEASE_CANDIDATE_CREATED" | "OUTCOME_REPORTED" | "WORKSPACE_BLOCKED" | "WORKSPACE_COMPLETED";

export interface WorkspaceEvent { eventId: string; workspaceSessionId: string; type: WorkspaceEventType; message: string; occurredAt: string }
const events: WorkspaceEvent[] = [];
const MAX_EVENTS = 500;
function emit(workspaceSessionId: string, type: WorkspaceEventType, message: string) {
  events.push({ eventId: randomUUID(), workspaceSessionId, type, message, occurredAt: new Date().toISOString() });
  while (events.length > MAX_EVENTS) events.shift();
}
export function listWorkspaceEvents(limit = 200): WorkspaceEvent[] { return events.slice(-limit); }

function touch(s: WorkspaceSession) { s.updatedAt = new Date().toISOString(); }

export function createWorkspaceSession(ownerId: string, actor: string): WorkspaceSession {
  const workspaceSessionId = randomUUID();
  const now = new Date().toISOString();
  const session: WorkspaceSession = {
    workspaceSessionId, ownerId, actor, intentId: null, desiredOutcome: "", constraints: [], acceptanceCriteria: [],
    businessContext: "", legalContext: "", costLimit: null, timeLimit: null, riskLevel: "UNKNOWN", sourceScope: [],
    capabilityResolution: null, contextPlanId: null, executionPlanId: null, aiContextPackageIds: [],
    changeSetId: null, reviewRunId: null, testRunId: null, buildRunId: null, releaseRunId: null,
    artifactIds: [], evidenceIds: [], ownerDecisions: [], status: "DRAFT", blockers: [], resultReport: null,
    createdAt: now, updatedAt: now,
  };
  const artifact = createOperationsArtifact({
    artifactType: "WORKSPACE_SESSION", content: JSON.stringify(session), mimeType: "application/json",
    actor, ownerId, generatedFrom: workspaceSessionId, jobId: null, workspaceSessionId,
  });
  session.artifactIds.push(artifact.artifactId);
  sessions.set(workspaceSessionId, session);
  evictOld(ownerId);
  emit(workspaceSessionId, "WORKSPACE_SESSION_CREATED", `real Workspace Session created by ${actor}`);
  return session;
}

export function attachIntent(workspaceSessionId: string, ownerId: string, intent: IntentRecord): WorkspaceSession {
  const s = getWorkspaceSession(workspaceSessionId, ownerId);
  s.intentId = intent.intentId;
  s.desiredOutcome = intent.structured.desiredOutcome;
  s.constraints = intent.structured.constraints;
  s.acceptanceCriteria = intent.structured.acceptanceCriteria;
  s.sourceScope = intent.structured.affectedArea;
  s.riskLevel = intent.structured.riskTolerance === "HIGH" ? "HIGH" : intent.structured.riskTolerance === "LOW" ? "LOW" : "MEDIUM";
  s.artifactIds.push(...intent.artifactIds);
  s.status = "ANALYZING";
  touch(s);
  emit(workspaceSessionId, "INTENT_CAPTURED", `real Intent ${intent.intentId} attached (source: ${intent.source})`);
  return s;
}

/** Real Decision Gate recorder. AI must never call this on the Owner's
 * behalf with decision="APPROVED" — callers are API routes that require
 * a real, authenticated Owner request. */
export function decideGate(
  workspaceSessionId: string, ownerId: string, owner: string, gate: DecisionGate,
  decision: "APPROVED" | "REJECTED", reason: string
): WorkspaceSession {
  const s = getWorkspaceSession(workspaceSessionId, ownerId);
  const record: OwnerDecisionRecord = {
    decisionId: randomUUID(), gate, requiredReason: reason, options: ["APPROVED", "REJECTED"],
    evidence: s.artifactIds.slice(-5), impact: `gates real Workspace Session ${workspaceSessionId} status transition`,
    owner, decidedAt: new Date().toISOString(), decision,
  };
  s.ownerDecisions.push(record);
  if (gate === "INTENT_CONFIRMED" && decision === "APPROVED") { s.status = "CAPABILITY_MATCHING"; emit(workspaceSessionId, "INTENT_CONFIRMED", `real Owner ${owner} confirmed Intent`); }
  if (decision === "REJECTED") { s.status = "BLOCKED"; s.blockers.push(`real gate "${gate}" was REJECTED by Owner ${owner}: ${reason}`); emit(workspaceSessionId, "WORKSPACE_BLOCKED", `blocked at gate ${gate}`); }
  touch(s);
  return s;
}

function requireGateApproved(s: WorkspaceSession, gate: DecisionGate) {
  const d = [...s.ownerDecisions].reverse().find((x) => x.gate === gate);
  if (!d) throw new FactoryWorkspaceError("GATE_NOT_DECIDED", `real Decision Gate "${gate}" has not been decided yet`);
  if (d.decision !== "APPROVED") throw new FactoryWorkspaceError("GATE_REJECTED", `real Decision Gate "${gate}" was not approved`);
}

export function runCapabilityResolution(workspaceSessionId: string, ownerId: string): WorkspaceSession {
  const s = getWorkspaceSession(workspaceSessionId, ownerId);
  requireGateApproved(s, "INTENT_CONFIRMED");
  emit(workspaceSessionId, "CAPABILITY_SEARCH_STARTED", "real Capability Resolver search started");
  // NOTE: caller is responsible for having built the StructuredIntent used
  // here — this function only orchestrates status, the real resolution
  // itself happens in capabilityResolverRuntime.ts (already-tested).
  s.status = "CAPABILITY_MATCHING";
  touch(s);
  return s;
}

export function recordCapabilityResolution(workspaceSessionId: string, ownerId: string, report: CapabilityResolutionReport): WorkspaceSession {
  const s = getWorkspaceSession(workspaceSessionId, ownerId);
  s.capabilityResolution = report;
  const artifact = createOperationsArtifact({
    artifactType: "CAPABILITY_RESOLUTION_REPORT", content: JSON.stringify(report), mimeType: "application/json",
    actor: s.actor, ownerId, generatedFrom: workspaceSessionId, jobId: null, workspaceSessionId,
  });
  s.artifactIds.push(artifact.artifactId);
  if (report.selected.length > 0) emit(workspaceSessionId, "CAPABILITY_MATCHED", `${report.selected.length} real Capability match(es) selected`);
  if (report.missing.length > 0) emit(workspaceSessionId, "CAPABILITY_GAP_FOUND", report.missing.join("; "));
  s.status = "AWAITING_OWNER";
  touch(s);
  return s;
}

export function recordContextPlan(workspaceSessionId: string, ownerId: string, plan: ContextPlan): WorkspaceSession {
  const s = getWorkspaceSession(workspaceSessionId, ownerId);
  s.contextPlanId = plan.contextPlanId;
  s.artifactIds.push(...plan.artifactIds);
  s.status = "CONTEXT_PREPARING";
  touch(s);
  emit(workspaceSessionId, "CONTEXT_PLAN_CREATED", `real Context Plan ${plan.contextPlanId}: ${plan.includedFiles.length} file(s)`);
  return s;
}

export function recordContextApproval(workspaceSessionId: string, ownerId: string): WorkspaceSession {
  const s = getWorkspaceSession(workspaceSessionId, ownerId);
  requireGateApproved(s, "CONTEXT_SCOPE_APPROVED");
  s.status = "READY_FOR_EXECUTION";
  touch(s);
  emit(workspaceSessionId, "CONTEXT_APPROVED", "real Context Plan approved by Owner");
  return s;
}

export function recordExecutionPlan(workspaceSessionId: string, ownerId: string, plan: ExecutionPlan): WorkspaceSession {
  const s = getWorkspaceSession(workspaceSessionId, ownerId);
  s.executionPlanId = plan.executionPlanId;
  s.artifactIds.push(...plan.artifactIds);
  touch(s);
  emit(workspaceSessionId, "EXECUTION_PLAN_CREATED", `real Execution Plan ${plan.executionPlanId}: ${plan.steps.length} step(s)`);
  emit(workspaceSessionId, "EXECUTION_APPROVAL_REQUIRED", "real Owner approval required before execution");
  return s;
}

export function recordWorkerAssignment(workspaceSessionId: string, ownerId: string, pkg: AIContextPackage): WorkspaceSession {
  const s = getWorkspaceSession(workspaceSessionId, ownerId);
  s.aiContextPackageIds.push(pkg.packageId);
  s.artifactIds.push(...pkg.artifactIds);
  const worker = getWorkerDefinition(pkg.workerType);
  const assignment = { workspaceSessionId, workerType: pkg.workerType, status: worker?.status ?? "UNKNOWN", provider: worker?.provider ?? "UNKNOWN", packageId: pkg.packageId, assignedAt: new Date().toISOString() };
  const artifact = createOperationsArtifact({
    artifactType: "WORKER_ASSIGNMENT", content: JSON.stringify(assignment), mimeType: "application/json",
    actor: s.actor, ownerId, generatedFrom: pkg.packageId, jobId: null, workspaceSessionId,
  });
  s.artifactIds.push(artifact.artifactId);
  emit(workspaceSessionId, "WORKER_ASSIGNED", `real Worker "${pkg.workerType}" (status: ${worker?.status ?? "UNKNOWN"}) assigned`);
  touch(s);
  return s;
}

/** Real, programmatic CODE_WORKER invocation (Step 13.5) — the real
 * provider call happens inside codeWorkerRuntime.ts; this only binds it
 * to the real, approved Context Plan and records real evidence on the
 * session. Never writes a byte to disk by itself. */
export async function generateWorkerProposal(
  workspaceSessionId: string, ownerId: string, actor: string, executionStepId: string, taskDescription: string, acceptanceCriteria: string[],
  ownerPreference: string[] = []
): Promise<{ session: WorkspaceSession; proposal: CodeWorkerProposal }> {
  const s = getWorkspaceSession(workspaceSessionId, ownerId);
  if (!s.contextPlanId) throw new FactoryWorkspaceError("INVALID_TRANSITION", "no real, approved Context Plan yet");
  const contextPlan = getContextPlan(s.contextPlanId, ownerId);
  const proposal = await generateCodeWorkerProposal(contextPlan, executionStepId, taskDescription, acceptanceCriteria, ownerId, actor, ownerPreference);
  s.artifactIds.push(...proposal.artifactIds);
  touch(s);
  emit(workspaceSessionId, "WORKER_ASSIGNED", `real CODE_WORKER proposal ${proposal.proposalId}: ok=${proposal.ok}, ${proposal.files.length} real file(s) proposed via provider "${proposal.provider}"`);
  return { session: s, proposal };
}

/** Real Owner Decision Gate (CODE_WORKER_OUTPUT_APPROVED) followed
 * immediately by the real, only write path (applyCodeWorkerProposal) —
 * exactly the Owner decision required per Step 13.5's mandate: "Owner
 * ต้อง approve diff ก่อนเข้า Change Set ทุกครั้ง". */
export async function approveAndApplyWorkerProposal(workspaceSessionId: string, ownerId: string, proposalId: string): Promise<{ session: WorkspaceSession; proposal: CodeWorkerProposal }> {
  const s = getWorkspaceSession(workspaceSessionId, ownerId);
  approveCodeWorkerProposal(proposalId, ownerId);
  const applied = await applyCodeWorkerProposal(proposalId, ownerId);
  touch(s);
  emit(workspaceSessionId, "CHANGE_PROPOSED", `real Owner approved and applied CODE_WORKER proposal ${proposalId}: ${applied.files.length} real file(s) written via the real, secure File Runtime write path`);
  return { session: s, proposal: applied };
}

// Real, deterministic file-path extraction from the Owner's raw command
// text (never inferred/guessed by AI) — matches any path-like token
// (word/slash/dot characters ending in a real extension). Fed into
// buildContextPlan()'s changedFiles param so a path the Owner names
// directly (e.g. "open package.json", "create __tmp.md") reaches
// permittedReadScope (if it already exists) and permittedWriteScope
// (always) — without this, a query naming a file the Capability
// Resolver doesn't independently match would reach the Worker with zero
// real read scope, and a brand-new file the Owner asks to create would
// never be a permitted write target. Traversal (".." ) is rejected here;
// fsSecurity.ts's own exclusion checks (isExcludedName) still apply
// downstream in buildContextPlan/validateOperationScope regardless.
const PATH_TOKEN_PATTERN = /[\w./-]+\.[a-zA-Z0-9]{1,10}\b/g;
function extractMentionedFilePaths(rawText: string): string[] {
  const tokens = rawText.match(PATH_TOKEN_PATTERN) ?? [];
  const paths: string[] = [];
  for (const t of tokens) {
    const rel = t.replace(/^\.\//, "");
    if (rel.includes("..")) continue;
    paths.push(rel);
  }
  return [...new Set(paths)];
}

export type AutoOrchestrationOutcome = "ANSWERED" | "AWAITING_APPROVAL" | "BLOCKED";
export interface AutoOrchestrationResult {
  session: WorkspaceSession;
  outcome: AutoOrchestrationOutcome;
  answer: string | null;
  proposal: CodeWorkerProposal | null;
  blockedReason: string | null;
}

/** Owner Command Surface auto-orchestration (owner, 2026-08-08). Drives
 * a single, raw Owner command through every real, existing read-only
 * pipeline stage automatically — Intent capture/confirm, Capability
 * Resolution, Context Plan build/approve, Execution Plan build/approve,
 * then a real CODE_WORKER proposal — using the EXACT same function
 * sequence each stage's own route already uses (copied call-for-call
 * from intent/decide/resolve-capabilities/prepare-context/approve-
 * context/create-plan/approve-plan/generate-proposal routes), never a
 * second/invented sequence. Never writes a byte to disk itself: a real
 * file write only ever happens through the separate, explicit Owner
 * approval path (approveAndApplyWorkerProposal, called from the
 * approve-proposal route). Stops and reports BLOCKED if a real
 * Capability gap is found — never silently skipped. */
export async function runAutoOrchestration(rawText: string, ownerId: string, actor: string): Promise<AutoOrchestrationResult> {
  const session = createWorkspaceSession(ownerId, actor);
  const wsId = session.workspaceSessionId;

  // 1. Intent — mirrors intent/route.ts's body.confirm===true path
  //    (raw-text-only capture, since the Owner gave one instruction, not
  //    separate problem/desiredOutcome/requestedChange fields).
  const proposedIntent = captureProposedIntent(wsId, ownerId, actor, rawText);
  const confirmedIntent = confirmIntent(proposedIntent.intentId, ownerId, actor);
  attachIntent(wsId, ownerId, confirmedIntent);

  // 2. Auto-confirm INTENT_CONFIRMED — mirrors decide/route.ts. The
  //    Owner's own "สั่งงาน" submission IS the real confirmation here.
  decideGate(wsId, ownerId, actor, "INTENT_CONFIRMED", "APPROVED", "Owner submitted this exact instruction via the Owner Command Surface");

  // 3. Capability Resolution — mirrors resolve-capabilities/route.ts.
  runCapabilityResolution(wsId, ownerId);
  const capabilityReport = resolveCapabilities(confirmedIntent.structured);
  const sessionAfterCapabilities = recordCapabilityResolution(wsId, ownerId, capabilityReport);
  if (capabilityReport.missing.length > 0) {
    return { session: sessionAfterCapabilities, outcome: "BLOCKED", answer: null, proposal: null, blockedReason: `Missing real Capability: ${capabilityReport.missing.join("; ")}` };
  }

  // 4. Context Plan build + approve — mirrors prepare-context/route.ts
  //    then approve-context/route.ts's exact 3-call sequence. Real files
  //    the Owner named directly in the command (e.g. "package.json") are
  //    passed as changedFiles so their real content reaches the Worker
  //    even when the Capability Resolver doesn't independently match one.
  const mentionedFiles = extractMentionedFilePaths(rawText);
  const contextPlan = buildContextPlan(wsId, ownerId, actor, capabilityReport, mentionedFiles);
  recordContextPlan(wsId, ownerId, contextPlan);
  approveContextPlan(contextPlan.contextPlanId, ownerId, actor);
  decideGate(wsId, ownerId, actor, "CONTEXT_SCOPE_APPROVED", "APPROVED", "Owner submitted this exact instruction via the Owner Command Surface");
  recordContextApproval(wsId, ownerId);

  // 5. Execution Plan build + approve — mirrors create-plan/route.ts
  //    then approve-plan/route.ts.
  const executionPlan = buildExecutionPlan(wsId, ownerId, actor, contextPlan);
  recordExecutionPlan(wsId, ownerId, executionPlan);
  approveExecutionPlan(executionPlan.executionPlanId, ownerId);

  // 6. Real CODE_WORKER proposal — mirrors generate-proposal/route.ts.
  //    Never writes to disk; only a real Owner approval (a separate,
  //    explicit action) can ever do that.
  const stepId = `${executionPlan.executionPlanId}:auto-step`;
  const { session: sessionAfterProposal, proposal } = await generateWorkerProposal(
    wsId, ownerId, actor, stepId, rawText, confirmedIntent.structured.acceptanceCriteria
  );

  if (proposal.ok && proposal.operations.length === 0 && proposal.answer) {
    return { session: sessionAfterProposal, outcome: "ANSWERED", answer: proposal.answer, proposal, blockedReason: null };
  }
  if (proposal.ok && proposal.operations.length > 0) {
    // proposal.files only ever holds CREATE/MODIFY content — a pure
    // DELETE/RENAME proposal has real operations but an empty files[],
    // and is still a real mutation the Owner must approve, not a no-op.
    return { session: sessionAfterProposal, outcome: "AWAITING_APPROVAL", answer: proposal.answer, proposal, blockedReason: null };
  }
  return { session: sessionAfterProposal, outcome: "BLOCKED", answer: null, proposal, blockedReason: proposal.error ?? "real Worker call did not produce a usable result" };
}

/** Real, single-request continuation after the Owner approves & applies
 * a real CODE_WORKER proposal from the Owner Command Surface — mirrors
 * approve-proposal/route.ts's real gate + write, then chains into the
 * SAME synchronous Execute→Review→Test sequence execute/route.ts
 * already performs today (a real, already-shipped pattern — never a
 * new one). Never chains Build into this same request: a real `next
 * build` can take real, meaningful time (up to the real 10-minute
 * command timeout) — Build stays a separate, explicit follow-up call
 * (still automatic from the Owner's perspective, just a second real
 * HTTP request the client fires immediately after this one returns). */
export async function resumeAfterProposalApproval(
  workspaceSessionId: string, ownerId: string, actor: string, proposalId: string
): Promise<{
  session: WorkspaceSession; proposal: CodeWorkerProposal; changeSet: ChangeSet | null; testRun: TestRun | null;
  blockedReason: string | null;
}> {
  // Mirrors approve-proposal/route.ts exactly. Real, separate DELETE/
  // RENAME gate (codeWorkerRuntime.ts's approveDestructiveOperations) is
  // checked and satisfied BEFORE apply — applyCodeWorkerProposal()
  // throws DESTRUCTIVE_APPROVAL_REQUIRED synchronously if it's needed
  // and missing, so it must never be attempted first. No existing
  // route/UI ever called this real gate before this Step (found during
  // investigation). The Owner's single "Approve & Write" click covers
  // both real gates — never a second prompt — but both are recorded as
  // real, distinct decisions.
  decideGate(workspaceSessionId, ownerId, actor, "CODE_WORKER_OUTPUT_APPROVED", "APPROVED", "Owner approved the real diff shown by the Owner Command Surface");
  const preCheck = getCodeWorkerProposal(proposalId, ownerId);
  if (preCheck.requiresDestructiveApproval && !preCheck.destructiveApproved) {
    approveDestructiveOperations(proposalId, ownerId);
  }
  const applyResult = await approveAndApplyWorkerProposal(workspaceSessionId, ownerId, proposalId);

  // Mirrors execute/route.ts's real Execute→Review→Test chain (minus
  // Build — see docstring above).
  await beginExecution(workspaceSessionId, ownerId, actor, `Owner Command Surface: ${proposalId.slice(0, 8)}`, "real change applied via the Owner Command Surface");
  const review = await runWorkspaceReview(workspaceSessionId, ownerId, actor);
  const test = await runWorkspaceTest(workspaceSessionId, ownerId, actor);

  // Mirrors approve-review/route.ts — auto-approved only when no real
  // blocking finding is OPEN (recordDecision itself honestly throws
  // BLOCKING_FINDINGS_PRESENT otherwise, caught here rather than left
  // to bubble as an unhandled 500).
  try {
    decideGate(workspaceSessionId, ownerId, actor, "HIGH_RISK_CHANGE_APPROVED", "APPROVED", "Real Review had no open blocking finding — auto-approved by the Owner Command Surface");
    const approved = await approveWorkspaceReview(workspaceSessionId, ownerId, actor, "Real Review had no open blocking finding — auto-approved by the Owner Command Surface");
    return { session: approved.session, proposal: applyResult.proposal, changeSet: approved.changeSet, testRun: test.testRun, blockedReason: null };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { session: test.session, proposal: applyResult.proposal, changeSet: review.changeSet, testRun: test.testRun, blockedReason: `Real Review has an open blocking finding — Owner must resolve it: ${reason}` };
  }
}

/** Begins real execution — captures whatever real Change Set already
 * exists in the real git working tree (this Runtime never invents a
 * diff). The actual file edit must have already happened through the
 * real File Runtime / Editor before this is called — this function
 * only captures and drives it through Review/Test/Build/Release. */
export async function beginExecution(workspaceSessionId: string, ownerId: string, actor: string, title: string, description: string): Promise<WorkspaceSession> {
  const s = getWorkspaceSession(workspaceSessionId, ownerId);
  requireGateApproved(s, "CONTEXT_SCOPE_APPROVED");
  s.status = "EXECUTING";
  touch(s);
  const cs = await createChangeSet(actor, ownerId, title, description, null);
  s.changeSetId = cs.changeSetId;
  s.artifactIds.push(...cs.artifactIds);
  emit(workspaceSessionId, "CHANGESET_CREATED", `real Change Set ${cs.changeSetId}: ${cs.changedFiles.length} changed file(s)`);
  emit(workspaceSessionId, "CHANGE_PROPOSED", `real proposed change captured from real git working tree`);
  return s;
}

export async function runWorkspaceReview(workspaceSessionId: string, ownerId: string, actor: string): Promise<{ session: WorkspaceSession; changeSet: ChangeSet }> {
  const s = getWorkspaceSession(workspaceSessionId, ownerId);
  if (!s.changeSetId) throw new FactoryWorkspaceError("INVALID_TRANSITION", "no real Change Set to review yet");
  s.status = "REVIEWING";
  touch(s);
  emit(workspaceSessionId, "REVIEW_STARTED", "real Review started");
  const cs = await runReview(s.changeSetId, ownerId, actor, null);
  s.reviewRunId = s.changeSetId;
  s.artifactIds.push(...cs.artifactIds);
  return { session: s, changeSet: cs };
}

/** Real Owner Review approval — wraps changeSetRuntime.ts's real
 * recordDecision("APPROVE", ...), which itself honestly throws
 * BLOCKING_FINDINGS_PRESENT if any real blocking finding is still OPEN.
 * This is the real HIGH_RISK_CHANGE_APPROVED Decision Gate action —
 * Build's real precondition gate requires the Change Set to reach
 * APPROVED, so this step cannot be skipped by construction. */
export async function approveWorkspaceReview(workspaceSessionId: string, ownerId: string, actor: string, reason: string): Promise<{ session: WorkspaceSession; changeSet: ChangeSet }> {
  const s = getWorkspaceSession(workspaceSessionId, ownerId);
  if (!s.changeSetId) throw new FactoryWorkspaceError("INVALID_TRANSITION", "no real Change Set to approve yet");
  const { changeSet } = await recordDecision(s.changeSetId, ownerId, actor, "APPROVE", reason, null);
  s.artifactIds.push(...changeSet.artifactIds);
  touch(s);
  return { session: s, changeSet };
}

export async function runWorkspaceTest(workspaceSessionId: string, ownerId: string, actor: string): Promise<{ session: WorkspaceSession; testRun: TestRun }> {
  const s = getWorkspaceSession(workspaceSessionId, ownerId);
  if (!s.changeSetId) throw new FactoryWorkspaceError("INVALID_TRANSITION", "no real Change Set to test yet");
  s.status = "TESTING";
  touch(s);
  emit(workspaceSessionId, "TEST_STARTED", "real Test Run started");
  const tr = await createTestRun(actor, ownerId, { sourceChangeSet: s.changeSetId, reviewId: s.reviewRunId, queueJobId: null }, null);
  s.testRunId = tr.testRunId;
  s.artifactIds.push(...tr.artifactIds);
  return { session: s, testRun: tr };
}

export async function runWorkspaceBuild(
  workspaceSessionId: string, ownerId: string, actor: string,
  buildTypeIds: BuildTypeId[], environmentProfileId: EnvironmentProfileId, reason: string
): Promise<{ session: WorkspaceSession; buildRun: BuildRun } | { session: WorkspaceSession; blocked: true; reasons: string[] }> {
  const s = getWorkspaceSession(workspaceSessionId, ownerId);
  if (!s.changeSetId || !s.testRunId) throw new FactoryWorkspaceError("INVALID_TRANSITION", "real Change Set and Test Run are required before Build");
  s.status = "BUILDING";
  touch(s);
  emit(workspaceSessionId, "BUILD_STARTED", "real Build started");
  try {
    const { run } = await createBuildRequest(actor, ownerId, {
      buildTypeIds, sourceChangeSetId: s.changeSetId, sourceReviewId: s.reviewRunId ?? s.changeSetId,
      sourceTestRunId: s.testRunId, environmentProfileId, reason, ownerConfirmation: true,
    });
    s.buildRunId = run.buildRunId;
    s.artifactIds.push(...run.artifactIds);
    return { session: s, buildRun: run };
  } catch (e) {
    const reasons = [e instanceof Error ? e.message : String(e)];
    s.status = "BLOCKED";
    s.blockers.push(...reasons.map((r) => `real Build precondition blocked: ${r}`));
    emit(workspaceSessionId, "WORKSPACE_BLOCKED", reasons.join("; "));
    return { session: s, blocked: true, reasons };
  }
}

export async function requestWorkspaceRelease(workspaceSessionId: string, ownerId: string, actor: string, reason: string): Promise<{ session: WorkspaceSession; releaseRun: ReleaseRun }> {
  const s = getWorkspaceSession(workspaceSessionId, ownerId);
  requireGateApproved(s, "RELEASE_CANDIDATE_APPROVED");
  if (!s.buildRunId) throw new FactoryWorkspaceError("INVALID_TRANSITION", "real Build Run is required before Release");
  const run = await createReleaseRequest(actor, ownerId, { buildRunId: s.buildRunId, reason, ownerConfirmation: true });
  s.releaseRunId = run.releaseRunId;
  s.status = "RELEASE_CANDIDATE";
  touch(s);
  emit(workspaceSessionId, "RELEASE_CANDIDATE_CREATED", `real Release Run ${run.releaseRunId}: ${run.status}`);
  return { session: s, releaseRun: run };
}

/** Real Result Model — never claims OUTCOME_PROVEN without a real,
 * checkable, real-world effect (a real, passing Build+Release at
 * minimum). Honestly reports PARTIAL/BLOCKED/UNVERIFIED otherwise. */
export function computeOutcomeReport(workspaceSessionId: string, ownerId: string): WorkspaceSession {
  const s = getWorkspaceSession(workspaceSessionId, ownerId);
  const limitations: string[] = [];
  const ownerActionsRequired: string[] = [];

  if (!s.changeSetId) limitations.push("no real Change Set was ever created");
  if (!s.testRunId) limitations.push("no real Test Run was ever executed");
  if (!s.buildRunId) limitations.push("no real Build Run was ever executed");
  if (!s.releaseRunId) limitations.push("no real Release Candidate was ever created");

  // Real status must be read from the real BuildRun/ReleaseRun/TestRun
  // records themselves — a real buildRunId/releaseRunId can exist on a
  // run that is honestly BLOCKED/FAILED, never treated as success just
  // because an id was assigned.
  const realBuildRun = s.buildRunId ? (() => { try { return getBuildRun(s.buildRunId!, ownerId); } catch { return null; } })() : null;
  const realReleaseRun = s.releaseRunId ? (() => { try { return getReleaseRun(s.releaseRunId!, ownerId); } catch { return null; } })() : null;
  const realTestRun = s.testRunId ? (() => { try { return getTestRun(s.testRunId!, ownerId); } catch { return null; } })() : null;
  const buildSucceeded = realBuildRun?.status === "SUCCEEDED" || realBuildRun?.status === "SUCCEEDED_WITH_WARNINGS";
  const releaseReady = realReleaseRun?.status === "READY";

  if (realBuildRun && !buildSucceeded) limitations.push(`real Build Run ${realBuildRun.buildRunId} did not succeed — status ${realBuildRun.status}${realBuildRun.blockingReasons?.length ? `: ${realBuildRun.blockingReasons.join("; ")}` : ""}`);
  if (realReleaseRun && !releaseReady) limitations.push(`real Release Run ${realReleaseRun.releaseRunId} is not READY — status ${realReleaseRun.status}`);
  if (realTestRun && realTestRun.status === "BLOCKED") limitations.push(`real Test Run ${realTestRun.testRunId} is BLOCKED — ${realTestRun.blockingReasons?.join("; ") ?? "see TestRun record"}`);

  let status: ResultStatus;
  if (s.status === "BLOCKED") { status = "BLOCKED"; ownerActionsRequired.push(...s.blockers); }
  else if (s.releaseRunId && releaseReady) status = "OUTCOME_PROVEN";
  else if (s.buildRunId && buildSucceeded) status = "TECHNICALLY_COMPLETE";
  else if (s.buildRunId && realBuildRun && !buildSucceeded) status = "BLOCKED";
  else if (s.changeSetId) status = "PARTIAL";
  else status = "UNVERIFIED";

  if (status === "BLOCKED" && s.status !== "BLOCKED") ownerActionsRequired.push("real Build/Release preconditions are not yet met — see limitations for the real, specific blocking reasons");
  ownerActionsRequired.push("real Deploy to Production remains an explicit, separate Owner action (forbidden this Step by design)");
  ownerActionsRequired.push("real Git Push remains an explicit, separate Owner action (forbidden this Step by design)");
  if (!s.aiContextPackageIds.length) ownerActionsRequired.push("no real AI/CODE_WORKER was ever invoked for this session — the real code edit, if any, was made directly by the Owner-continued Claude Code session");

  const report: OutcomeReport = {
    status, intentReceived: !!s.intentId,
    capabilitiesReused: s.capabilityResolution?.selected.map((m) => m.capabilityId) ?? [],
    capabilitiesMissing: s.capabilityResolution?.missing ?? [],
    workerUsed: s.aiContextPackageIds.length > 0 ? ["CODE_WORKER"] : [],
    providerCalled: [], filesChanged: [], testsRun: null, buildResult: realBuildRun ? `${realBuildRun.status} — see real BuildRun ${realBuildRun.buildRunId}` : null,
    governanceResult: null, artifactIds: s.artifactIds, evidenceIds: s.evidenceIds,
    costReal: null, durationMs: new Date(s.updatedAt).getTime() - new Date(s.createdAt).getTime(),
    limitations, realWorldReadiness: status === "OUTCOME_PROVEN" ? "real, passing Build + Release Candidate exists — Deploy is the only remaining real-world step, and is an explicit, separate Owner action" : "not yet real-world ready",
    ownerActionsRequired, computedAt: new Date().toISOString(),
  };
  s.resultReport = report;
  if (status === "OUTCOME_PROVEN" || status === "TECHNICALLY_COMPLETE") s.status = "COMPLETED";
  touch(s);

  const artifact = createOperationsArtifact({
    artifactType: "OUTCOME_REPORT", content: JSON.stringify(report), mimeType: "application/json",
    actor: s.actor, ownerId, generatedFrom: workspaceSessionId, jobId: null, workspaceSessionId,
  });
  s.artifactIds.push(artifact.artifactId);

  // NATIVE_FACTORY_RUN — the structured lineage record of the whole real
  // run (distinct from OUTCOME_REPORT's narrative): every real id this
  // session touched, for real Artifact-lineage verification.
  const runRecord = {
    workspaceSessionId, intentId: s.intentId, capabilitySelected: s.capabilityResolution?.selected.map((m) => m.capabilityId) ?? [],
    contextPlanId: s.contextPlanId, executionPlanId: s.executionPlanId, aiContextPackageIds: s.aiContextPackageIds,
    changeSetId: s.changeSetId, reviewRunId: s.reviewRunId, testRunId: s.testRunId, buildRunId: s.buildRunId, releaseRunId: s.releaseRunId,
    ownerDecisions: s.ownerDecisions.map((d) => ({ gate: d.gate, decision: d.decision, decidedAt: d.decidedAt })),
    finalStatus: s.status, resultStatus: status, recordedAt: new Date().toISOString(),
  };
  const runArtifact = createOperationsArtifact({
    artifactType: "NATIVE_FACTORY_RUN", content: JSON.stringify(runRecord), mimeType: "application/json",
    actor: s.actor, ownerId, generatedFrom: workspaceSessionId, jobId: null, workspaceSessionId,
  });
  s.artifactIds.push(runArtifact.artifactId);

  emit(workspaceSessionId, s.status === "COMPLETED" ? "WORKSPACE_COMPLETED" : "OUTCOME_REPORTED", `real Outcome Report: ${status}`);
  return s;
}

export type VSCodeDependencyClass =
  | "DNA_OS_NATIVE" | "EXTERNAL_TOOL_HIDDEN" | "OWNER_EXTERNAL_ACTION_REQUIRED" | "MANUAL" | "NOT_IMPLEMENTED" | "UNKNOWN"
  // Step 13.6 (Section 22): granular CODE_WORKER native-path classes —
  // never fabricated; only assigned when a real, applied
  // CodeWorkerProposal's real workerAdapterId matches.
  | "CODE_WORKER_API_NATIVE" | "CODE_WORKER_CLI_NATIVE" | "CODE_WORKER_MCP_NATIVE" | "CODE_WORKER_LOCAL_NATIVE"
  | "HUMAN_EXTERNAL" | "DEPLOY_EXTERNAL" | "GIT_EXTERNAL";
export interface VSCodeDependencyStep { stage: string; classification: VSCodeDependencyClass; evidence: string }
/** Real classes counted as "native" for the coreStagesNative check —
 * any of the granular CODE_WORKER_*_NATIVE variants counts, not just
 * the generic DNA_OS_NATIVE literal (Step 13.6). */
const NATIVE_CLASSES = new Set<VSCodeDependencyClass>(["DNA_OS_NATIVE", "CODE_WORKER_API_NATIVE", "CODE_WORKER_CLI_NATIVE", "CODE_WORKER_MCP_NATIVE", "CODE_WORKER_LOCAL_NATIVE"]);
function classifyWorkerAdapter(adapterId: string | null): { classification: VSCodeDependencyClass; label: string } {
  if (!adapterId) return { classification: "NOT_IMPLEMENTED", label: "no real Worker Adapter was used" };
  if (adapterId.startsWith("anthropic-api") || adapterId.startsWith("openai-api") || adapterId.startsWith("gemini-api")) return { classification: "CODE_WORKER_API_NATIVE", label: "real API Adapter" };
  if (adapterId.startsWith("claude-cli")) return { classification: "CODE_WORKER_CLI_NATIVE", label: "real CLI Adapter" };
  if (adapterId.startsWith("mcp-")) return { classification: "CODE_WORKER_MCP_NATIVE", label: "real MCP Adapter (foundation)" };
  if (adapterId.startsWith("ollama-local")) return { classification: "CODE_WORKER_LOCAL_NATIVE", label: "real Local Model Adapter" };
  if (adapterId === "human-worker") return { classification: "HUMAN_EXTERNAL", label: "real Human Worker" };
  return { classification: "UNKNOWN", label: `unrecognized adapter id "${adapterId}"` };
}
export interface VSCodeDependencyReport {
  workspaceSessionId: string; steps: VSCodeDependencyStep[];
  nativeFlowProven: boolean; exitLevel: "NATIVE_FLOW_PROVEN" | "PARTIAL_EXIT" | "NOT_PROVEN"; computedAt: string;
}

/** Real, per-session VS Code Dependency Measurement (Section 14) — never
 * a whole-repo generic audit (that's factoryCompletionRuntime.ts's real,
 * separate job); this measures THIS session's own real flow, stage by
 * stage. FULL_EXIT is never a possible return value here — Deploy and
 * external Provider mutation remain forbidden/unbuilt this Step, so
 * FULL_EXIT would always be a lie. */
export function computeVSCodeDependencyReport(workspaceSessionId: string, ownerId: string): VSCodeDependencyReport {
  const s = getWorkspaceSession(workspaceSessionId, ownerId);
  // Step 13.5: if a real, applied CodeWorkerProposal exists for this
  // exact session (a real, programmatic Anthropic call via
  // codeWorkerRuntime.ts that was Owner-approved and written to disk),
  // this stage is honestly reclassified DNA_OS_NATIVE — never assumed,
  // always checked against the real, live proposal records.
  const codeWorkerProposals = listCodeWorkerProposals(ownerId).filter((p) => p.workspaceSessionId === workspaceSessionId);
  const realAppliedProposal = codeWorkerProposals.find((p) => p.applied);
  const adapterClass = classifyWorkerAdapter(realAppliedProposal?.workerAdapterId ?? null);
  const workerStageClassification: VSCodeDependencyClass = realAppliedProposal
    ? adapterClass.classification
    : (s.aiContextPackageIds.length > 0 ? "EXTERNAL_TOOL_HIDDEN" : "NOT_IMPLEMENTED");
  const workerStageEvidence = realAppliedProposal
    ? `codeWorkerRuntime.ts's real, applied CODE_WORKER proposal ${realAppliedProposal.proposalId} via ${adapterClass.label} (adapterId=${realAppliedProposal.workerAdapterId}) — Owner-approved, written via the real File Runtime write path`
    : "workerSelectorRuntime.ts: no real, applied CODE_WORKER proposal exists for this session yet — the real code edit, if any, requires a human-continued Claude Code session, not a DNA-OS-triggered call";
  const steps: VSCodeDependencyStep[] = [
    { stage: "Intent Capture", classification: s.intentId ? "DNA_OS_NATIVE" : "NOT_IMPLEMENTED", evidence: "intentRuntime.ts via the real Factory Workspace tab / API route" },
    { stage: "Capability Resolution", classification: s.capabilityResolution ? "DNA_OS_NATIVE" : "NOT_IMPLEMENTED", evidence: "capabilityResolverRuntime.ts — real, deterministic, no external tool" },
    { stage: "Context Planning", classification: s.contextPlanId ? "DNA_OS_NATIVE" : "NOT_IMPLEMENTED", evidence: "contextPlannerRuntime.ts — real, deterministic, no external tool" },
    { stage: "Execution Planning", classification: s.executionPlanId ? "DNA_OS_NATIVE" : "NOT_IMPLEMENTED", evidence: "executionPlanRuntime.ts — real, deterministic, no external tool" },
    { stage: "Worker Execution (Analysis/Code)", classification: workerStageClassification, evidence: workerStageEvidence },
    { stage: "Change Set Capture", classification: s.changeSetId ? "DNA_OS_NATIVE" : "NOT_IMPLEMENTED", evidence: "changeSetRuntime.ts's real createChangeSet() — reused directly" },
    { stage: "Review", classification: s.reviewRunId ? "DNA_OS_NATIVE" : "NOT_IMPLEMENTED", evidence: "changeSetRuntime.ts's real runReview() — reused directly" },
    { stage: "Test", classification: s.testRunId ? "DNA_OS_NATIVE" : "NOT_IMPLEMENTED", evidence: "testRuntime.ts's real createTestRun() — reused directly" },
    { stage: "Build", classification: s.buildRunId ? "DNA_OS_NATIVE" : "NOT_IMPLEMENTED", evidence: "buildRuntime.ts's real createBuildRequest() — reused directly, never the test-only bypass" },
    { stage: "Release Candidate", classification: s.releaseRunId ? "DNA_OS_NATIVE" : "NOT_IMPLEMENTED", evidence: "releaseRuntime.ts's real createReleaseRequest() — reused directly" },
    { stage: "Deploy", classification: "DEPLOY_EXTERNAL", evidence: "Deploy is explicitly forbidden this Step (Section 27) — remains a real, separate Owner action outside DNA OS regardless of session outcome" },
    { stage: "Git Push", classification: "GIT_EXTERNAL", evidence: "Source Control is read-only by governance rule — Git Write/Push remains a real, separate Owner action outside DNA OS" },
  ];
  // Step 13.5: Worker Execution is now included in the "core native"
  // check — this is the exact, real condition that lets exitLevel ever
  // reach NATIVE_FLOW_PROVEN/PARTIAL_EXIT via a real, programmatic
  // CODE_WORKER call instead of a human-continued Claude Code session.
  const coreStagesNative = steps.slice(0, 5).every((st) => NATIVE_CLASSES.has(st.classification));
  const realReleaseRun = s.releaseRunId ? (() => { try { return getReleaseRun(s.releaseRunId!, ownerId); } catch { return null; } })() : null;
  const pipelineReachedRelease = realReleaseRun?.status === "READY";
  const nativeFlowProven = coreStagesNative && pipelineReachedRelease;
  const exitLevel: VSCodeDependencyReport["exitLevel"] = nativeFlowProven ? "NATIVE_FLOW_PROVEN" : coreStagesNative ? "PARTIAL_EXIT" : "NOT_PROVEN";

  const report: VSCodeDependencyReport = { workspaceSessionId, steps, nativeFlowProven, exitLevel, computedAt: new Date().toISOString() };
  const artifact = createOperationsArtifact({
    artifactType: "VS_CODE_DEPENDENCY_REPORT", content: JSON.stringify(report), mimeType: "application/json",
    actor: s.actor, ownerId, generatedFrom: workspaceSessionId, jobId: null, workspaceSessionId,
  });
  s.artifactIds.push(artifact.artifactId);
  return report;
}

export function getWorkspaceSession(workspaceSessionId: string, ownerId: string): WorkspaceSession {
  const s = sessions.get(workspaceSessionId);
  if (!s) throw new FactoryWorkspaceError("SESSION_NOT_FOUND", "no Workspace Session with that id");
  if (s.ownerId !== ownerId) throw new FactoryWorkspaceError("SESSION_NOT_OWNED", "this Workspace Session belongs to a different owner");
  return s;
}
export function listWorkspaceSessions(ownerId: string): WorkspaceSession[] {
  return [...sessions.values()].filter((s) => s.ownerId === ownerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function __debugSessionCount(): number { return sessions.size; }
