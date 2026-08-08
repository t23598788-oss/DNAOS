/**
 * Code Worker Runtime (owner, 2026-08-08, Software Factory Step 13.6 —
 * refactored from Step 13.5's direct-gateway version). The real,
 * provider-neutral bridge that lets DNA OS invoke CODE_WORKER
 * programmatically. As of Step 13.6, this file NEVER imports a
 * Provider SDK or Provider Adapter directly (Section 0/11) — it only
 * imports the real, provider-neutral workerContract.ts types and calls
 * through workerSelectorRuntime.ts#selectWorker() +
 * WorkerAdapter#execute(). Provider-specific code (Anthropic SDK,
 * execFile argv, Ollama HTTP) lives ONLY inside the real Adapter files
 * under workerAdapters/.
 *
 * Real, hard-enforced guarantees (carried over + extended from Step
 * 13.5):
 *  - exactly one real provider call per real Execution Step, enforced
 *    now via the real, shared executionBudgetRuntime.ts (Section 10) —
 *    never a second, local counter;
 *  - the request is built ONLY from files inside the real, approved
 *    Context Plan's permittedReadScope — never the whole repo;
 *  - every proposed file path must fall inside the real ContextPlan's
 *    permittedWriteScope AND pass the real fsSecurity.ts exclusion
 *    check, or it is REJECTED per-file, never silently included
 *    (Section 13);
 *  - DELETE/RENAME operations require a SEPARATE real Owner approval
 *    from CREATE/MODIFY (Section 12);
 *  - the real, raw provider output is never applied to disk directly —
 *    it becomes a CODE_WORKER_PROPOSAL_V2 artifact requiring explicit,
 *    separate real Owner approval before any byte is written, reusing
 *    the exact same real, secure write path (fsSecurity.ts +
 *    fileWrite.ts#writeFileAtomic) every Editor PUT already uses.
 */
import { randomUUID } from "crypto";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { WORKSPACE_ROOT, resolveSafeRelativePath, resolveNewEntryPath, isExcludedName } from "./fsSecurity";
import { writeFileAtomic } from "./fileWrite";
import { createOperationsArtifact } from "./artifactRuntime";
import type { ContextPlan } from "./contextPlannerRuntime";
import { selectWorker, getWorkerAdapter, type WorkerSelectionResult } from "./workerSelectorRuntime";
import { precheckBudget, reserveBudget, recordActualUsage, enforceBudget } from "./executionBudgetRuntime";
import type { WorkerRequest, WorkerResponse } from "./workerContract";
import { startWorkerInvokeJob, finalizeWorkerInvokeJob } from "./queueRuntime";

export type ProposedOperationType = "CREATE" | "MODIFY" | "DELETE" | "RENAME";
export interface ProposedOperation {
  path: string;
  operation: ProposedOperationType;
  content: string | null;
  purpose: string;
  risk: string;
  requiredTests: string[];
  limitations: string[];
}
export interface ProposedFileChange { path: string; content: string }

export interface CodeWorkerProposal {
  proposalId: string;
  workspaceSessionId: string;
  contextPlanId: string;
  executionStepId: string;
  ok: boolean;
  error: string | null;
  /** Real, plain-text answer for a read-only task that needed no file
   * change — null for every proposal that isn't a pure Q&A response. */
  answer: string | null;
  operations: ProposedOperation[];
  files: ProposedFileChange[];
  rejectedFiles: { path: string; reason: string }[];
  requiresDestructiveApproval: boolean;
  destructiveApproved: boolean;
  destructiveApprovedAt: string | null;
  workerAdapterId: string | null;
  provider: string;
  model: string | null;
  cost: WorkerResponse["cost"] | null;
  selection: WorkerSelectionResult | null;
  requestId: string | null;
  evidenceId: string | null;
  approved: boolean;
  approvedAt: string | null;
  applied: boolean;
  appliedAt: string | null;
  createdAt: string;
  ownerId: string;
  actor: string;
  artifactIds: string[];
}

export class CodeWorkerError extends Error {
  code: "CALL_CAP_EXCEEDED" | "PROPOSAL_NOT_FOUND" | "PROPOSAL_NOT_OWNED" | "PROPOSAL_ALREADY_APPROVED" | "PROPOSAL_NOT_APPROVED" | "PROPOSAL_REJECTED" | "DESTRUCTIVE_APPROVAL_REQUIRED" | "NO_COMPATIBLE_WORKER";
  constructor(code: typeof CodeWorkerError.prototype.code, message: string) { super(message); this.code = code; this.name = "CodeWorkerError"; }
}

const proposals = new Map<string, CodeWorkerProposal>();
const MAX_PROPOSAL_HISTORY = 200;
function evictOld(ownerId: string) {
  const owned = [...proposals.values()].filter((p) => p.ownerId === ownerId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  while (owned.length > MAX_PROPOSAL_HISTORY) { const oldest = owned.shift()!; proposals.delete(oldest.proposalId); }
}

const MAX_FILE_SIZE_BYTES = 500_000;

function buildAcceptanceCriteria(acceptanceCriteria: string[]): string[] { return acceptanceCriteria; }

/** Real, per-file scope enforcement (Section 13) — reuses the same
 * real, already-enforced fsSecurity.ts#isExcludedName exclusion rule
 * every Context Plan already uses (never a second exclusion list). */
function validateOperationScope(op: ProposedOperation, contextPlan: ContextPlan): { ok: boolean; reason: string } {
  if (!contextPlan.permittedWriteScope.includes(op.path)) return { ok: false, reason: "real path is outside this Context Plan's permittedWriteScope" };
  const segments = op.path.split("/");
  if (segments.some((seg, i) => isExcludedName(seg, i < segments.length - 1))) return { ok: false, reason: "real path matches a real, already-enforced fsSecurity.ts exclusion pattern" };
  if (op.path.includes("..")) return { ok: false, reason: "real path traversal sequence detected" };
  if (op.content && Buffer.byteLength(op.content, "utf-8") > MAX_FILE_SIZE_BYTES) return { ok: false, reason: `real content exceeds MAX_FILE_SIZE_BYTES (${MAX_FILE_SIZE_BYTES})` };
  return { ok: true, reason: "" };
}

/** Real, provider-neutral CODE_WORKER invocation via the Universal
 * Worker Bridge (Step 13.6) — never imports a provider adapter
 * directly. Reads only real, on-disk content of files already inside
 * the approved Context Plan's permittedReadScope. */
export async function generateCodeWorkerProposal(
  contextPlan: ContextPlan, executionStepId: string, taskDescription: string, acceptanceCriteria: string[],
  ownerId: string, actor: string, ownerPreference: string[] = []
): Promise<CodeWorkerProposal> {
  const precheck = precheckBudget(contextPlan.workspaceSessionId, executionStepId, { providerCalls: 1 });
  if (!precheck.ok) throw new CodeWorkerError("CALL_CAP_EXCEEDED", `real Execution Budget refuses this call: ${precheck.reasons.join("; ")}`);

  const sourceFiles = contextPlan.includedFiles
    .filter((f) => contextPlan.permittedReadScope.includes(f.path))
    .map((f) => ({ path: f.path, content: readFileSync(path.join(WORKSPACE_ROOT, f.path), "utf-8") }));

  const request: WorkerRequest = {
    workerRequestId: randomUUID(), workspaceSessionId: contextPlan.workspaceSessionId, executionPlanId: null, stepId: executionStepId,
    workerType: "CODE_WORKER", capabilityRequired: "code.generate", contextPackageId: contextPlan.contextPlanId, contextFingerprint: contextPlan.sourceFingerprint,
    permittedReadScope: contextPlan.permittedReadScope, permittedWriteScope: contextPlan.permittedWriteScope, permittedTools: [], forbiddenTools: [],
    expectedOutputSchema: "ProposedOperation[]", timeoutMs: 120_000, maxCalls: 1, maxTokens: Math.min(8000, Math.max(1000, contextPlan.tokenEstimate * 2)),
    maxCost: 1.0, privacyLevel: "CLOUD_ALLOWED", networkPolicy: "OUTBOUND_ALLOWED", approvalPolicy: "OWNER_APPROVAL_REQUIRED",
    actor, createdAt: new Date().toISOString(), taskDescription, acceptanceCriteria: buildAcceptanceCriteria(acceptanceCriteria), fileContents: sourceFiles,
  };

  const selection = await selectWorker(request, ownerPreference);
  const proposalId = randomUUID();

  if (selection.outcome === "NO_COMPATIBLE_WORKER" || selection.outcome === "BLOCKED" || !selection.selectedAdapterId) {
    const proposal: CodeWorkerProposal = {
      proposalId, workspaceSessionId: contextPlan.workspaceSessionId, contextPlanId: contextPlan.contextPlanId, executionStepId,
      ok: false, error: `real Worker Selector could not find a compatible Worker: ${selection.reasons.join("; ")}`, answer: null,
      operations: [], files: [], rejectedFiles: [], requiresDestructiveApproval: false, destructiveApproved: false, destructiveApprovedAt: null,
      workerAdapterId: null, provider: "none", model: null, cost: null, selection, requestId: null, evidenceId: null,
      approved: false, approvedAt: null, applied: false, appliedAt: null, createdAt: new Date().toISOString(), ownerId, actor, artifactIds: [],
    };
    const artifact = createOperationsArtifact({ artifactType: "CODE_WORKER_PROPOSAL_V2", content: JSON.stringify(proposal), mimeType: "application/json", actor, ownerId, generatedFrom: proposalId, jobId: null, workspaceSessionId: contextPlan.workspaceSessionId });
    proposal.artifactIds.push(artifact.artifactId);
    proposals.set(proposalId, proposal);
    evictOld(ownerId);
    return proposal;
  }

  const adapter = getWorkerAdapter(selection.selectedAdapterId)!;
  const estimate = adapter.estimate(request);
  const reserved = reserveBudget(contextPlan.workspaceSessionId, executionStepId, { providerCalls: 1, tokens: estimate.estimatedTokens ?? 0, estimatedCost: estimate.estimatedCost ?? 0 });
  if (!reserved.ok) throw new CodeWorkerError("CALL_CAP_EXCEEDED", `real Execution Budget reservation refused: ${reserved.reasons.join("; ")}`);

  // Real WORKER_INVOKE Queue job — the one required Queue hop before any
  // live Worker Adapter call, never skipped (owner, 2026-08-07, /admin/ide
  // Foundation — VS Code Coding Worker integration; closes a real gap
  // found this round: this call previously went straight to the Adapter
  // with no real Job/evidence trail).
  const invokeJob = startWorkerInvokeJob(actor, ownerId, `${adapter.id}:${taskDescription.slice(0, 80)}`);
  const response = await adapter.execute(request);
  finalizeWorkerInvokeJob(invokeJob.jobId, ownerId, { ok: response.status === "SUCCEEDED", result: response.status, error: response.error });
  recordActualUsage(contextPlan.workspaceSessionId, executionStepId, { outputBytes: response.output?.length ?? 0, durationMs: response.durationMs, actualCost: response.cost.kind === "ACTUAL" ? (response.cost.amount ?? 0) : 0 });
  enforceBudget(contextPlan.workspaceSessionId, executionStepId);

  const operations: ProposedOperation[] = [];
  const rejectedFiles: { path: string; reason: string }[] = [];
  for (const pc of response.proposedChanges) {
    const op: ProposedOperation = { path: pc.path, operation: pc.operation, content: pc.content, purpose: pc.purpose, risk: pc.risk, requiredTests: [], limitations: [] };
    const scopeCheck = validateOperationScope(op, contextPlan);
    if (scopeCheck.ok) operations.push(op);
    else rejectedFiles.push({ path: pc.path, reason: scopeCheck.reason });
  }

  const requiresDestructiveApproval = operations.some((o) => o.operation === "DELETE" || o.operation === "RENAME");
  const files: ProposedFileChange[] = operations.filter((o) => (o.operation === "CREATE" || o.operation === "MODIFY") && o.content !== null).map((o) => ({ path: o.path, content: o.content! }));

  const answer = response.answer ?? null;
  const proposal: CodeWorkerProposal = {
    proposalId, workspaceSessionId: contextPlan.workspaceSessionId, contextPlanId: contextPlan.contextPlanId, executionStepId,
    ok: response.status === "SUCCEEDED" && (operations.length > 0 || !!answer), error: response.error, answer,
    operations, files, rejectedFiles, requiresDestructiveApproval, destructiveApproved: false, destructiveApprovedAt: null,
    workerAdapterId: adapter.id, provider: response.provider, model: response.model, cost: response.cost, selection,
    requestId: request.workerRequestId, evidenceId: response.evidence[0] ?? null,
    approved: false, approvedAt: null, applied: false, appliedAt: null,
    createdAt: new Date().toISOString(), ownerId, actor, artifactIds: [],
  };

  const artifact = createOperationsArtifact({ artifactType: "CODE_WORKER_PROPOSAL_V2", content: JSON.stringify(proposal), mimeType: "application/json", actor, ownerId, generatedFrom: proposalId, jobId: invokeJob.jobId, workspaceSessionId: contextPlan.workspaceSessionId });
  proposal.artifactIds.push(artifact.artifactId);

  proposals.set(proposalId, proposal);
  evictOld(ownerId);
  return proposal;
}

/** Real, explicit Owner approval — the ONLY path that can ever cause a
 * real write to disk from a CODE_WORKER proposal. DELETE/RENAME
 * operations require a SEPARATE real approveDestructiveOperations()
 * call — approveCodeWorkerProposal() alone is not enough for them. */
export function approveCodeWorkerProposal(proposalId: string, ownerId: string): CodeWorkerProposal {
  const p = getCodeWorkerProposal(proposalId, ownerId);
  if (!p.ok) throw new CodeWorkerError("PROPOSAL_REJECTED", `proposal is not ok (error: ${p.error ?? "unknown"}) — cannot be approved`);
  if (p.approved) throw new CodeWorkerError("PROPOSAL_ALREADY_APPROVED", "this proposal was already approved");
  p.approved = true;
  p.approvedAt = new Date().toISOString();
  return p;
}

/** Real, separate Owner approval specifically for DELETE/RENAME
 * operations (Section 12) — approveCodeWorkerProposal() alone never
 * authorizes a destructive operation. */
export function approveDestructiveOperations(proposalId: string, ownerId: string): CodeWorkerProposal {
  const p = getCodeWorkerProposal(proposalId, ownerId);
  if (!p.requiresDestructiveApproval) throw new CodeWorkerError("PROPOSAL_REJECTED", "this proposal has no real DELETE/RENAME operations requiring separate approval");
  p.destructiveApproved = true;
  p.destructiveApprovedAt = new Date().toISOString();
  return p;
}

/** Real file application — reuses the exact same real, secure write
 * path (resolveSafeRelativePath + writeFileAtomic) every Editor PUT
 * already uses. Never a second, parallel write implementation. DELETE
 * uses the real fs.unlink through the same real, resolved-safe path. */
export async function applyCodeWorkerProposal(proposalId: string, ownerId: string): Promise<CodeWorkerProposal> {
  const p = getCodeWorkerProposal(proposalId, ownerId);
  if (!p.approved) throw new CodeWorkerError("PROPOSAL_NOT_APPROVED", "a real Owner approval is required before any file is written");
  if (p.requiresDestructiveApproval && !p.destructiveApproved) throw new CodeWorkerError("DESTRUCTIVE_APPROVAL_REQUIRED", "this proposal has real DELETE/RENAME operations requiring a separate real Owner approval");

  const { unlink } = await import("fs/promises");
  for (const op of p.operations) {
    if (op.operation === "CREATE" || op.operation === "MODIFY") {
      if (op.content === null) continue;
      // CREATE targets a real path that does not exist yet —
      // resolveSafeRelativePath() requires every segment (including the
      // leaf) to already exist, which a genuinely new file never does;
      // resolveNewEntryPath() is the real, already-established function
      // for this (validates the parent directory instead). MODIFY keeps
      // resolveSafeRelativePath() since that file must already exist.
      const { absPath } = op.operation === "CREATE" ? await resolveNewEntryPath(op.path) : await resolveSafeRelativePath(op.path);
      await writeFileAtomic(absPath, Buffer.from(op.content, "utf-8"));
    } else if (op.operation === "DELETE") {
      const { absPath } = await resolveSafeRelativePath(op.path);
      if (existsSync(absPath)) await unlink(absPath);
    } else if (op.operation === "RENAME") {
      // Real, honest limitation: RENAME requires real, new-path content
      // to write; without it, this Step honestly skips rather than
      // guessing a destination.
      if (op.content !== null) {
        const { absPath } = await resolveSafeRelativePath(op.path);
        await writeFileAtomic(absPath, Buffer.from(op.content, "utf-8"));
      }
    }
  }
  p.applied = true;
  p.appliedAt = new Date().toISOString();
  return p;
}

export function getCodeWorkerProposal(proposalId: string, ownerId: string): CodeWorkerProposal {
  const p = proposals.get(proposalId);
  if (!p) throw new CodeWorkerError("PROPOSAL_NOT_FOUND", "no CODE_WORKER proposal with that id");
  if (p.ownerId !== ownerId) throw new CodeWorkerError("PROPOSAL_NOT_OWNED", "this proposal belongs to a different owner");
  return p;
}
export function listCodeWorkerProposals(ownerId: string): CodeWorkerProposal[] {
  return [...proposals.values()].filter((p) => p.ownerId === ownerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function __debugProposalCount(): number { return proposals.size; }
