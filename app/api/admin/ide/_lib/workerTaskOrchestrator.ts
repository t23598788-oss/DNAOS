/**
 * Worker Task Orchestrator (owner, 2026-08-09, Software Factory Readiness
 * gap fill — Gaps 3 & 4: "deliver minimum context only" + "close the
 * automatic FAIL -> Worker fixes -> Validate loop"). Composes ONLY real,
 * already-existing Runtimes (contextPlannerRuntime.ts's real
 * buildMinimalContextPlan(), codeWorkerRuntime.ts's real
 * generateCodeWorkerProposal()/applyCodeWorkerProposal(),
 * acceptanceContractRuntime.ts's real evaluateAcceptanceContract(),
 * factoryWorkspaceRuntime.ts's real runWorkspaceReview/Test/Build()) —
 * never a second Queue, never a second Artifact store, never a second
 * write path.
 *
 * Real, explicit scope of this file:
 *  - a Job Contract names its OWN permittedReadScope/permittedWriteScope/
 *    permittedTools/forbiddenTools — the Worker never sees anything the
 *    Job Contract did not literally name (Gap 3, via
 *    buildMinimalContextPlan()'s no-dependency-graph-expansion guarantee).
 *  - approvalPolicy is hard-fixed to "AUTO_LOW_RISK" for every call this
 *    file makes into codeWorkerRuntime.ts — this is the Owner's real,
 *    standing pre-authorization (given directly, this Step) for this one,
 *    scoped, sandboxed, in-repo-working-tree loop, and ONLY for it; the
 *    UI-driven manual approve-proposal route is untouched and still
 *    requires an explicit, per-proposal real Owner click.
 *  - this file NEVER imports gitWriteOps, deploymentRuntime, or any
 *    commit/push-capable function — Governance + Owner Gate keep holding
 *    that line by construction (real, structural, not a runtime check).
 */
import { randomUUID } from "crypto";
import {
  createWorkspaceSession, recordContextPlan, recordContextApproval, decideGate, beginExecution,
  runWorkspaceReview, runWorkspaceTest, runWorkspaceBuild, generateWorkerProposal,
  type WorkspaceSession,
} from "./factoryWorkspaceRuntime";
import { buildMinimalContextPlan, approveContextPlan } from "./contextPlannerRuntime";
import { approveCodeWorkerProposal, applyCodeWorkerProposal, approveDestructiveOperations, type CodeWorkerProposal } from "./codeWorkerRuntime";
import { compileAcceptanceCriteria, evaluateAcceptanceContract, type CompiledCriterion, type CriterionResult, type UiScanEvidenceLike } from "./acceptanceContractRuntime";
import { createOperationsArtifact } from "./artifactRuntime";
import { getGitStatus } from "./gitReadOnly";
import type { BuildTypeId, EnvironmentProfileId } from "./buildRegistry";
import type { WorkerType } from "./workerRegistry";
import { runUiInspectionScan, UiInspectionError } from "./browserInspectionRuntime";
import type { InspectionType } from "./inspectionRegistry";
import { submitWorkerQuestion, type SubmitWorkerQuestionOutcome } from "./managerQuestionRuntime";

/** Real, optional UI-scan config on a Job Contract — when present, every
 * attempt that reaches a real, applied file set also runs one real,
 * live browserInspectionRuntime.ts scan against the exact route the
 * Worker was scoped to touch. Requires a real, already-running Next.js
 * server at WORKER_UI_SCAN_BASE_URL (default http://localhost:3000) —
 * if unreachable, this is reported as a real, honest scan failure (the
 * UI_* acceptance criteria FAIL, never silently skipped/passed). */
export interface JobContractUiScanConfig {
  route: string;
  viewportProfileIds: string[];
  inspectionTypes: InspectionType[];
  waitUntil: "load" | "domcontentloaded" | "networkidle";
  timeoutMs: number;
}

export interface JobContract {
  jobContractId: string;
  /** Real, audit/scope label only (Software Factory Readiness, Worker
   * #2 gap fill, 2026-08-09) — does NOT change which underlying
   * Runtime/Adapter mechanism runs the job; CODE_WORKER and UI_WORKER
   * both execute through the exact same, locked reference pipeline
   * (see workerContract.ts's LOCKED header). The distinction between
   * Workers is entirely in the Job Contract's scope/forbiddenTools/
   * acceptanceCriteria, never in a second orchestration path. */
  workerRole: WorkerType;
  taskDescription: string;
  /** Real, structured acceptance criteria — compiled via
   * acceptanceContractRuntime.ts. A criterion that doesn't match a
   * recognized machine-checkable shape never silently PASSes. */
  acceptanceCriteria: string[];
  permittedReadScope: string[];
  permittedWriteScope: string[];
  permittedTools: string[];
  forbiddenTools: string[];
  maxAttempts: number;
  buildTypeIds: BuildTypeId[];
  environmentProfileId: EnvironmentProfileId;
  ownerId: string;
  actor: string;
  ownerPreference: string[];
  uiScan: JobContractUiScanConfig | null;
}

export function createJobContract(input: {
  taskDescription: string; acceptanceCriteria: string[]; permittedReadScope: string[]; permittedWriteScope: string[];
  ownerId: string; actor: string;
  workerRole?: WorkerType;
  permittedTools?: string[]; forbiddenTools?: string[]; maxAttempts?: number;
  buildTypeIds?: BuildTypeId[]; environmentProfileId?: EnvironmentProfileId; ownerPreference?: string[];
  uiScan?: JobContractUiScanConfig;
}): JobContract {
  return {
    jobContractId: randomUUID(),
    workerRole: input.workerRole ?? "CODE_WORKER",
    taskDescription: input.taskDescription,
    acceptanceCriteria: input.acceptanceCriteria,
    permittedReadScope: input.permittedReadScope,
    permittedWriteScope: input.permittedWriteScope,
    permittedTools: input.permittedTools ?? [],
    forbiddenTools: input.forbiddenTools ?? ["Write", "Edit", "Bash", "Read", "Grep", "Glob"],
    maxAttempts: input.maxAttempts ?? 3,
    buildTypeIds: input.buildTypeIds ?? ["TYPESCRIPT_EMIT_CHECK"],
    environmentProfileId: input.environmentProfileId ?? "LOCAL_PRODUCTION_BUILD",
    ownerId: input.ownerId, actor: input.actor,
    ownerPreference: input.ownerPreference ?? [],
    uiScan: input.uiScan ?? null,
  };
}

/** Real, additive UI_WORKER preset (Software Factory Readiness, Worker
 * #2, 2026-08-09) — reuses createJobContract()/runScopedWorkerJob()
 * completely unchanged; this is scoping/defaults only, never a second
 * orchestration mechanism. forbiddenTools defaults cover the Owner's
 * four required categories: database migration, production deploy, git
 * push, infrastructure mutation — the CLI Adapter's code.generate mode
 * already hard-disables every literal tool call structurally
 * (--tools ""), and codeWorkerRuntime.ts's isHighRiskInfraPath() denies
 * the underlying file patterns even if a caller mistakenly widened
 * permittedWriteScope — these forbiddenTools entries make the Job
 * Contract itself self-documenting on top of both real, structural
 * guarantees. */
export function createUiWorkerJobContract(input: {
  taskDescription: string; acceptanceCriteria: string[]; permittedReadScope: string[]; permittedWriteScope: string[];
  ownerId: string; actor: string; route: string;
  viewportProfileIds?: string[]; inspectionTypes?: InspectionType[];
  permittedTools?: string[]; forbiddenTools?: string[]; maxAttempts?: number; ownerPreference?: string[];
}): JobContract {
  return createJobContract({
    ...input,
    workerRole: "UI_WORKER",
    forbiddenTools: input.forbiddenTools ?? [
      "Write", "Edit", "Bash", "Read", "Grep", "Glob",
      "DATABASE_MIGRATION", "PRODUCTION_DEPLOY", "GIT_PUSH", "INFRASTRUCTURE_MUTATION",
    ],
    buildTypeIds: ["TYPESCRIPT_EMIT_CHECK"],
    uiScan: {
      route: input.route,
      viewportProfileIds: input.viewportProfileIds ?? ["DESKTOP_1920_1080", "MOBILE_390_844"],
      inspectionTypes: input.inspectionTypes ?? ["UI_OVERFLOW_CHECK", "UI_RESPONSIVE_CHECK", "UI_TEXT_RENDER_CHECK"],
      waitUntil: "load", timeoutMs: 30_000,
    },
  });
}

export interface AttemptRecord {
  attempt: number;
  proposalId: string | null;
  proposalOk: boolean;
  workerAdapterId: string | null;
  rejectedFiles: { path: string; reason: string }[];
  appliedFiles: string[];
  criteriaResults: CriterionResult[] | null;
  testRunId: string | null;
  buildRunId: string | null;
  buildBlockedReasons: string[] | null;
  changeSetId: string | null;
  uiScanTargetUrl: string | null;
  uiScanError: string | null;
  outcome: "PASS" | "FAIL" | "NEEDS_OWNER_REVIEW" | "NO_USABLE_PROPOSAL" | "CONCURRENT_MUTATION_DETECTED";
  detail: string;
}

export type WorkerJobStatus = "PASS" | "FAIL_MAX_ATTEMPTS" | "NEEDS_OWNER_REVIEW" | "NO_COMPATIBLE_WORKER" | "CONCURRENT_MUTATION_DETECTED" | "COST_GATE_LOCKED";

export interface ConcurrentMutationEvidence {
  addedForeignFiles: string[];
  removedForeignFiles: string[];
}

export interface WorkerJobResult {
  jobContractId: string;
  workerRole: WorkerType;
  workspaceSessionId: string;
  status: WorkerJobStatus;
  attempts: AttemptRecord[];
  workerAdapterId: string | null;
  evidenceArtifactIds: string[];
  gitHeadBefore: string | null;
  gitHeadAfter: string | null;
  noCommitOccurred: boolean;
  /** Real, evidence-based concurrency check (Software Factory
   * Readiness, 2026-08-09 — Owner directive: "ถ้าพบ working tree ถูกแก้
   * จาก process อื่น ให้รายงาน CONCURRENT_MUTATION_DETECTED พร้อม
   * evidence แล้วคืน control ให้ Orchestrator"). Non-null only when
   * this job actually detected a real, foreign (outside its own
   * permittedWriteScope) working-tree change mid-run — the Orchestrator
   * itself decides to stop, per this fixed, predefined rule, never by
   * asking the Owner and never by a Worker "deciding" anything (a
   * Worker only ever proposes scoped file content). */
  concurrentMutationEvidence: ConcurrentMutationEvidence | null;
  computedAt: string;
}

async function safeHead(): Promise<string | null> {
  try { const g = await getGitStatus(); return g.headCommit?.hash ?? null; } catch { return null; }
}

/** Real, read-only snapshot of every real, currently dirty/untracked
 * path in the working tree that is NOT this Job Contract's own
 * permittedWriteScope (Software Factory Readiness, 2026-08-09 —
 * baseline-isolation companion: detects a foreign process mutating the
 * shared working tree WHILE this job runs, never mutates anything
 * itself — reuses gitReadOnly.ts's real, already-read-only
 * getGitStatus(), never a second git call path). */
async function snapshotForeignChangedPaths(permittedWriteScope: string[]): Promise<Set<string> | null> {
  try {
    const g = await getGitStatus();
    const own = new Set(permittedWriteScope);
    const all = [...g.staged, ...g.unstaged, ...g.untracked, ...g.conflicted].map((f) => f.path);
    return new Set(all.filter((p) => !own.has(p)));
  } catch {
    return null; // real, honest "could not check" — never treated as "nothing changed"
  }
}

function diffForeignSnapshots(baseline: Set<string>, current: Set<string>): ConcurrentMutationEvidence | null {
  const addedForeignFiles = [...current].filter((p) => !baseline.has(p));
  const removedForeignFiles = [...baseline].filter((p) => !current.has(p));
  if (addedForeignFiles.length === 0 && removedForeignFiles.length === 0) return null;
  return { addedForeignFiles, removedForeignFiles };
}

/** Real, closed FAIL -> Worker fixes -> Validate loop (Gap 4). Every
 * attempt after the first carries the real, specific reason the
 * previous attempt failed back into the Worker's own taskDescription —
 * never a generic "try again". Stops automatically (without asking the
 * Owner) the moment acceptance criteria PASS, or after maxAttempts, at
 * which point it honestly reports NEEDS_OWNER_REVIEW/FAIL_MAX_ATTEMPTS
 * rather than looping forever or fabricating success. */
export async function runScopedWorkerJob(contract: JobContract): Promise<WorkerJobResult> {
  const gitHeadBefore = await safeHead();
  const foreignBaseline = await snapshotForeignChangedPaths(contract.permittedWriteScope);
  const session: WorkspaceSession = createWorkspaceSession(contract.ownerId, contract.actor);
  const wsId = session.workspaceSessionId;

  const plan = buildMinimalContextPlan(wsId, contract.ownerId, contract.actor, contract.permittedReadScope, contract.permittedWriteScope);
  recordContextPlan(wsId, contract.ownerId, plan);
  approveContextPlan(plan.contextPlanId, contract.ownerId, contract.actor);
  decideGate(wsId, contract.ownerId, contract.actor, "CONTEXT_SCOPE_APPROVED", "APPROVED", `real, minimum-context Job Contract ${contract.jobContractId} scope pre-authorized by Owner (AUTO_LOW_RISK, scoped, no commit/push/deploy)`);
  recordContextApproval(wsId, contract.ownerId);

  const compiled = compileAcceptanceCriteria(contract.acceptanceCriteria);
  const attempts: AttemptRecord[] = [];
  let workerAdapterId: string | null = null;
  let taskDescription = contract.taskDescription;
  let status: WorkerJobStatus = "FAIL_MAX_ATTEMPTS";
  let concurrentMutationEvidence: ConcurrentMutationEvidence | null = null;

  for (let attempt = 1; attempt <= contract.maxAttempts; attempt++) {
    // Real, deliberate refusal (owner, 2026-08-09, TASK-045) — this
    // pipeline's real Worker Adapter selection is HARDCODED to CODE_WORKER
    // regardless of contract.workerRole (see generateWorkerProposal() ->
    // generateCodeWorkerProposal(), which always builds its WorkerRequest
    // with the literal workerType:"CODE_WORKER"/capabilityRequired:
    // "code.generate" — the exact real behavior this JobContract type's
    // own doc comment already discloses: workerRole "does NOT change
    // which underlying Runtime/Adapter mechanism runs the job"). Silently
    // continuing here for EDGE_FUNCTION_WORKER would dispatch a real
    // CODE_WORKER code-generation call mislabeled as EDGE_FUNCTION_WORKER
    // in the result — a real, dangerous mismatch, never a safe no-op.
    // Refuse honestly instead: route through the real, correct dispatch
    // path, edgeFunctionWorkerRuntime.ts#dispatchEdgeFunctionWorkerJob().
    if (contract.workerRole === "EDGE_FUNCTION_WORKER") {
      attempts.push({
        attempt, proposalId: null, proposalOk: false, workerAdapterId: null,
        rejectedFiles: [], appliedFiles: [], criteriaResults: null,
        testRunId: null, buildRunId: null, buildBlockedReasons: null, changeSetId: null,
        uiScanTargetUrl: null, uiScanError: null,
        outcome: "NO_USABLE_PROPOSAL",
        detail: "real, deliberate refusal — runScopedWorkerJob()'s real Worker Adapter selection is hardcoded to CODE_WORKER regardless of contract.workerRole; EDGE_FUNCTION_WORKER's real dispatch mechanism is a genuinely different, network-based shape (no prompt/file-diff/Review-Test-Build applies) that lives in edgeFunctionWorkerRuntime.ts#dispatchEdgeFunctionWorkerJob() instead — use that function directly, never this one, for EDGE_FUNCTION_WORKER.",
      });
      status = "NO_COMPATIBLE_WORKER";
      break;
    }
    // Real, hard-found hardening fix (2026-08-09) — if a real,
    // reliable working-tree baseline could not even be established at
    // job start (the read-only git status check itself failed), the
    // mid-run concurrency check below would have nothing to compare
    // against and would silently never fire for this job's entire
    // lifetime. Fail-safe HERE, before spending any real Worker call —
    // never silently run a whole job with concurrency protection
    // quietly disabled.
    if (!foreignBaseline) {
      attempts.push({
        attempt, proposalId: null, proposalOk: false, workerAdapterId: null,
        rejectedFiles: [], appliedFiles: [], criteriaResults: null,
        testRunId: null, buildRunId: null, buildBlockedReasons: null, changeSetId: null,
        uiScanTargetUrl: null, uiScanError: null,
        outcome: "CONCURRENT_MUTATION_DETECTED",
        detail: "could not establish a real, reliable working-tree baseline before starting (the real, read-only git status check itself failed) — refusing to run a scoped job whose evidence integrity cannot be verified.",
      });
      status = "CONCURRENT_MUTATION_DETECTED";
      break;
    }
    const stepId = `${contract.jobContractId}:attempt-${attempt}`;
    const { proposal } = await generateWorkerProposal(
      wsId, contract.ownerId, contract.actor, stepId, taskDescription, contract.acceptanceCriteria, contract.ownerPreference,
      { permittedTools: contract.permittedTools, forbiddenTools: contract.forbiddenTools, approvalPolicy: "AUTO_LOW_RISK" },
    );
    workerAdapterId = proposal.workerAdapterId;

    if (!proposal.ok || proposal.operations.length === 0) {
      const reason = proposal.error ?? (proposal.rejectedFiles.length > 0
        ? `real Worker only proposed out-of-scope paths: ${proposal.rejectedFiles.map((r) => `${r.path} (${r.reason})`).join("; ")}`
        : "real Worker produced zero usable file operations");
      attempts.push({
        attempt, proposalId: proposal.proposalId, proposalOk: proposal.ok, workerAdapterId,
        rejectedFiles: proposal.rejectedFiles, appliedFiles: [], criteriaResults: null,
        testRunId: null, buildRunId: null, buildBlockedReasons: null, changeSetId: null,
        uiScanTargetUrl: null, uiScanError: null,
        outcome: "NO_USABLE_PROPOSAL", detail: reason,
      });
      if (proposal.selection?.outcome === "NO_COMPATIBLE_WORKER" || proposal.selection?.outcome === "BLOCKED") { status = "NO_COMPATIBLE_WORKER"; break; }
      // Real, immediate stop on a real COST_GATE LOCK (Constitution Rule
      // 257) — never burn retry attempts against a financial-approval
      // block a Worker retry cannot fix; honestly distinct from every
      // other FAIL/NO_USABLE_PROPOSAL reason, never conflated with them.
      if (proposal.error?.startsWith("COST_GATE_LOCKED")) { status = "COST_GATE_LOCKED"; break; }
      taskDescription = `${contract.taskDescription}\n\n[Automatic retry ${attempt}/${contract.maxAttempts}] Previous attempt FAILED: ${reason}. Only propose files inside permittedWriteScope: ${contract.permittedWriteScope.join(", ")}.`;
      continue;
    }

    // AUTO_LOW_RISK: the Owner's real, standing pre-authorization for
    // this scoped Job Contract lets the loop apply-and-validate without
    // stopping to ask per attempt — this is the one real gap this Step
    // closes. Never used for commit/push/deploy (this file cannot reach
    // those functions at all).
    //
    // Real, hard-found robustness fix (2026-08-09, live run of this
    // Step's own acceptance suite): applyCodeWorkerProposal() can throw
    // a real, expected error (e.g. IdeFsError PATH_CONFLICT — a Worker's
    // CREATE targets a path a PRIOR attempt already wrote) that is not a
    // scope violation and not an acceptance-criteria failure, just a
    // real apply-time error. Before this fix that exception propagated
    // out of runScopedWorkerJob() uncaught and crashed the whole Job —
    // never acceptable for a loop whose entire point is to survive a
    // real Worker mistake automatically. Now: any real, unexpected error
    // in apply/execute/review/test/build is caught, recorded as a real,
    // specific FAIL attempt, and fed back into the next real retry —
    // exactly like a failed acceptance criterion.
    try {
      approveCodeWorkerProposal(proposal.proposalId, contract.ownerId);
      if (proposal.requiresDestructiveApproval) approveDestructiveOperations(proposal.proposalId, contract.ownerId);
      const applied: CodeWorkerProposal = await applyCodeWorkerProposal(proposal.proposalId, contract.ownerId);

      // Real, evidence-based concurrency check (Owner directive,
      // 2026-08-09) — BEFORE running any expensive real Review/Test/
      // Build (which would otherwise capture a real ChangeSet
      // contaminated by a foreign process's own, unrelated edits): if a
      // path OUTSIDE this Job Contract's own permittedWriteScope
      // appeared/disappeared from the real working tree since this job
      // started, stop here. This is a fixed, predefined Orchestrator
      // rule — never a Worker decision, never a "should I ask the
      // Owner" branch; the Acceptance Contract for evidence integrity
      // already answers it: contaminated evidence can never back a
      // real PASS.
      if (foreignBaseline) {
        const foreignNow = await snapshotForeignChangedPaths(contract.permittedWriteScope);
        // Real, hard-found hardening fix (2026-08-09, live flakiness
        // found by this suite's own repeated runs): the real, read-only
        // getGitStatus() call this re-check depends on can itself fail
        // transiently — plausibly BECAUSE a real, concurrent process is
        // touching the working tree at that exact moment (e.g. a real
        // git index.lock held elsewhere), i.e. exactly the condition
        // this check exists to catch. Treating "could not re-verify" as
        // "must be clean" would be fail-OPEN on the one signal this
        // check exists to provide. Real, honest fix: fail SAFE instead
        // — an unverifiable working tree stops the job with the same
        // urgency as a confirmed foreign mutation, just with an honest,
        // distinct reason (never a fabricated positive detection).
        if (foreignNow === null) {
          attempts.push({
            attempt, proposalId: proposal.proposalId, proposalOk: true, workerAdapterId,
            rejectedFiles: proposal.rejectedFiles, appliedFiles: applied.files.map((f) => f.path), criteriaResults: null,
            testRunId: null, buildRunId: null, buildBlockedReasons: null, changeSetId: null,
            uiScanTargetUrl: null, uiScanError: null,
            outcome: "CONCURRENT_MUTATION_DETECTED",
            detail: "real working-tree integrity could not be re-verified (the real, read-only git status check itself failed mid-run — possibly because another process holds it right now). Stopping fail-safe rather than proceeding on unverifiable evidence.",
          });
          status = "CONCURRENT_MUTATION_DETECTED";
          break;
        }
        const drift = diffForeignSnapshots(foreignBaseline, foreignNow);
        if (drift) {
          concurrentMutationEvidence = drift;
          attempts.push({
            attempt, proposalId: proposal.proposalId, proposalOk: true, workerAdapterId,
            rejectedFiles: proposal.rejectedFiles, appliedFiles: applied.files.map((f) => f.path), criteriaResults: null,
            testRunId: null, buildRunId: null, buildBlockedReasons: null, changeSetId: null,
            uiScanTargetUrl: null, uiScanError: null,
            outcome: "CONCURRENT_MUTATION_DETECTED",
            detail: `real, foreign working-tree mutation detected outside this Job Contract's permittedWriteScope while this job was running — added: [${drift.addedForeignFiles.join(", ")}], removed: [${drift.removedForeignFiles.join(", ")}]. Stopping — evidence from a contaminated working tree can never back a real PASS.`,
          });
          status = "CONCURRENT_MUTATION_DETECTED";
          break;
        }
      }

      await beginExecution(wsId, contract.ownerId, contract.actor, `Job Contract ${contract.jobContractId} attempt ${attempt}`, taskDescription);
      const review = await runWorkspaceReview(wsId, contract.ownerId, contract.actor);
      const test = await runWorkspaceTest(wsId, contract.ownerId, contract.actor);
      const build = await runWorkspaceBuild(wsId, contract.ownerId, contract.actor, contract.buildTypeIds, contract.environmentProfileId, `Job Contract ${contract.jobContractId} attempt ${attempt} acceptance evaluation`);
      const buildRun = "blocked" in build ? null : build.buildRun;
      const buildBlockedReasons = "blocked" in build ? build.reasons : null;
      const workerOwnFiles = applied.files.map((f) => f.path);

      // Real, optional live UI Inspection (Worker #2/UI_WORKER gap fill,
      // 2026-08-09) — runs the exact same, already-shipped
      // browserInspectionRuntime.ts pipeline the /admin/ide UI Inspection
      // page already uses. Requires a real, already-running server —
      // never started by this orchestrator (starting/stopping a server
      // is not a scoped-Worker concern). A scan failure (server
      // unreachable, route not registered) is captured as real, honest
      // evidence — the UI_* acceptance criteria then FAIL for real,
      // never silently skipped.
      let uiScanEvidence: UiScanEvidenceLike | null = null;
      let uiScanTargetUrl: string | null = null;
      let uiScanError: string | null = null;
      if (contract.uiScan) {
        const baseUrl = process.env.WORKER_UI_SCAN_BASE_URL ?? "http://localhost:3000";
        try {
          const scan = await runUiInspectionScan({
            targetType: "REGISTERED_ROUTE", route: contract.uiScan.route, url: null,
            requestUrl: `${baseUrl}/api/admin/ide/ui-inspection/run`,
            viewportProfileIds: contract.uiScan.viewportProfileIds, waitUntil: contract.uiScan.waitUntil,
            timeoutMs: contract.uiScan.timeoutMs, inspectionTypes: contract.uiScan.inspectionTypes,
            actor: contract.actor, ownerId: contract.ownerId, jobId: null,
          });
          uiScanEvidence = { targetUrl: scan.targetUrl, inspectionRecords: scan.inspectionRecords.map((r) => ({ findings: r.findings.map((f) => ({ code: f.code, severity: f.severity })) })) };
          uiScanTargetUrl = scan.targetUrl;
        } catch (e) {
          uiScanError = e instanceof UiInspectionError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
        }
      }

      const evalResult = evaluateAcceptanceContract(compiled, {
        testRun: test.testRun, buildRun: "blocked" in build ? { blocked: true, reasons: build.reasons } : build.buildRun, changeSet: review.changeSet,
        workerOwnFiles, uiScan: uiScanEvidence,
      });

      attempts.push({
        attempt, proposalId: proposal.proposalId, proposalOk: true, workerAdapterId,
        rejectedFiles: proposal.rejectedFiles, appliedFiles: workerOwnFiles,
        criteriaResults: evalResult.results, testRunId: test.testRun.testRunId,
        buildRunId: buildRun?.buildRunId ?? null, buildBlockedReasons, changeSetId: review.changeSet.changeSetId,
        uiScanTargetUrl, uiScanError,
        outcome: evalResult.overall === "PASS" ? "PASS" : evalResult.overall === "NEEDS_OWNER_REVIEW" ? "NEEDS_OWNER_REVIEW" : "FAIL",
        detail: evalResult.results.filter((r) => r.status !== "PASS").map((r) => `${r.criterion.raw} -> ${r.status}: ${r.detail}`).join("; ") || "all real, machine-checkable criteria PASSED",
      });

      if (evalResult.overall === "PASS") { status = "PASS"; break; }
      if (evalResult.overall === "NEEDS_OWNER_REVIEW") { status = "NEEDS_OWNER_REVIEW"; break; }

      const failDetail = evalResult.results.filter((r) => r.status === "FAIL").map((r) => `${r.criterion.raw} -> FAIL: ${r.detail}`).join("; ");
      taskDescription = `${contract.taskDescription}\n\n[Automatic retry ${attempt}/${contract.maxAttempts}] Previous attempt FAILED real, machine-checked acceptance criteria: ${failDetail}. Fix this specific problem and resubmit the full corrected file content.`;
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      attempts.push({
        attempt, proposalId: proposal.proposalId, proposalOk: true, workerAdapterId,
        rejectedFiles: proposal.rejectedFiles, appliedFiles: [], criteriaResults: null,
        testRunId: null, buildRunId: null, buildBlockedReasons: null, changeSetId: null,
        uiScanTargetUrl: null, uiScanError: null,
        outcome: "FAIL", detail: `real apply/execute-time error (not a scope or acceptance-criteria failure): ${reason}`,
      });
      taskDescription = `${contract.taskDescription}\n\n[Automatic retry ${attempt}/${contract.maxAttempts}] Previous attempt FAILED to apply: ${reason}. If the target file already exists from a prior attempt, use operation MODIFY instead of CREATE.`;
    }
  }

  const gitHeadAfter = await safeHead();
  const noCommitOccurred = gitHeadBefore !== null && gitHeadAfter !== null && gitHeadBefore === gitHeadAfter;

  const result: WorkerJobResult = {
    jobContractId: contract.jobContractId, workerRole: contract.workerRole, workspaceSessionId: wsId, status, attempts, workerAdapterId,
    evidenceArtifactIds: [], gitHeadBefore, gitHeadAfter, noCommitOccurred, concurrentMutationEvidence, computedAt: new Date().toISOString(),
  };

  const artifact = createOperationsArtifact({
    artifactType: "NATIVE_FACTORY_RUN", content: JSON.stringify(result), mimeType: "application/json",
    actor: contract.actor, ownerId: contract.ownerId, generatedFrom: contract.jobContractId, jobId: null, workspaceSessionId: wsId,
  });
  result.evidenceArtifactIds.push(artifact.artifactId);

  if (status === "PASS") recordWorkerAcceptanceProof(result);
  return result;
}

// ============================================================
// Real, in-memory "last proof" record (Gap 5 support), keyed by
// workerRole (Software Factory Readiness, Worker #2 gap fill,
// 2026-08-09 — generalized from a single Worker #1-only record so
// WORKER_02_READY etc. can be computed independently, without ever
// touching Worker #1's own recorded proof). The Factory Readiness Gate
// reads this to compute WORKER_0N_READY. In-memory only (resets on
// restart), the same, already-disclosed limitation as Queue/Artifact —
// never a durable claim beyond this process's lifetime.
// ============================================================
const lastWorkerAcceptanceProofByRole = new Map<WorkerType, WorkerJobResult>();
function recordWorkerAcceptanceProof(result: WorkerJobResult): void { lastWorkerAcceptanceProofByRole.set(result.workerRole, result); }
export function getLastWorkerAcceptanceProof(role: WorkerType = "CODE_WORKER"): WorkerJobResult | null { return lastWorkerAcceptanceProofByRole.get(role) ?? null; }
export function __debugResetWorkerAcceptanceProof(role?: WorkerType): void {
  if (role) lastWorkerAcceptanceProofByRole.delete(role);
  else lastWorkerAcceptanceProofByRole.clear();
}

// ============================================================
// Real, Validator/Orchestrator-owned live-proof trigger (Owner
// directive, 2026-08-09: "ให้ Validator/Orchestrator เป็นคนสั่ง Live UI
// proof แล้วรับผลกลับ ถ้าผ่านจึงค่อยประกาศ WORKER_02_READY=true จากชั้น
// กลาง ไม่ใช่จาก Worker เอง"). A Worker/Job Contract never declares its
// own readiness — it only executes (runScopedWorkerJob) and produces
// real evidence. This function is the one, real, middle-layer act that
// (a) triggers that real, scoped run, then (b) re-computes the real
// Factory Readiness Gate from the resulting evidence. It intentionally
// lives HERE, not inside factoryReadinessGateRuntime.ts, because that
// file's own, load-bearing guarantee is "ZERO real mutations, spawns
// ZERO processes" (see its header) — runScopedWorkerJob is a real
// mutation, so the trigger belongs on the Orchestrator side of that
// line, never the read-only Validator side. Deliberately does NOT start
// or stop any server/process (e.g. `next dev`) — that is real
// infrastructure lifecycle, out of scope for both the Worker and this
// Orchestrator; a live UI-scan Job Contract simply requires the target
// server to already be reachable, exactly like runUiInspectionScan()
// already assumes for the existing /admin/ide UI Inspection page.
// ============================================================
export interface LiveAcceptanceProofOutcome {
  result: WorkerJobResult;
  readiness: Awaited<ReturnType<typeof import("./factoryReadinessGateRuntime").computeFactoryReadinessReport>>;
}

export async function runLiveAcceptanceProofAndUpdateReadiness(contract: JobContract): Promise<LiveAcceptanceProofOutcome> {
  const result = await runScopedWorkerJob(contract);
  const { computeFactoryReadinessReport } = await import("./factoryReadinessGateRuntime");
  const readiness = await computeFactoryReadinessReport();
  return { result, readiness };
}

// ============================================================
// Real, Worker-facing Question submission (Constitution Rule 251, "Single
// Owner Inquiry Authority" — Factory Manager = this file, per the rule's
// own text: "Factory Manager คือการขยาย workerTaskOrchestrator.ts ที่มีอยู่
// แล้ว...ไม่ใช่ระบบใหม่คู่ขนาน"). This is the ONE function a Job Contract's
// Worker may call to ask anything — it composes managerQuestionRuntime.ts's
// real Manager Question Queue (registry-first lookup -> dedupe -> aggregate
// -> resolve internally or escalate) entirely; this file deliberately does
// NOT import managerQuestionRuntime.ts's Owner-facing exports
// (getOwnerFacingQueue/answerAggregatedQuestion) at all — those remain
// reachable only from managerQuestionRuntime.ts itself and an explicit
// Owner-facing surface, never from any WorkerType execution path. Verified
// by scripts/manager-question-queue-test.ts's structural criterion (d).
// ============================================================
export function submitJobContractQuestion(contract: JobContract, questionText: string): SubmitWorkerQuestionOutcome {
  return submitWorkerQuestion({
    workerRole: contract.workerRole, jobContractId: contract.jobContractId,
    actor: contract.actor, ownerId: contract.ownerId, questionText,
  });
}
