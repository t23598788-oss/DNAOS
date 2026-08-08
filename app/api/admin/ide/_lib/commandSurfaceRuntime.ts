/**
 * Owner Command Surface Runtime (owner, 2026-08-07, /admin/ide Foundation
 * follow-up). Real, deterministic Intent Router for the Owner's typed
 * command box in /admin/ide — explicitly NOT a freeform chat UI and NOT
 * an AI/NLP interpreter (owner: "ช่องนี้ไม่ใช่ freeform chat UI ทั่วไป
 * มันคือ Owner Command Surface"). Recognizes a small, explicit, real set
 * of intent patterns and dispatches into EXISTING real capabilities only
 * — it never runs arbitrary text as a command, never writes files itself,
 * and never starts/advances a Software Factory Step on its own (that
 * always requires the real, separate Execution Context Gate + explicit
 * Owner approval — see executionContextRuntime.ts#evaluateStepGate()).
 *
 * Reuse investigation (before writing this file): the real "execute
 * something" primitive already exists — queueRuntime.ts#createRunCommandJob()
 * → executionRuntime.ts#startRun(), gated by executionRegistry.ts's
 * fixed, 16-entry COMMAND_REGISTRY (workspace.pwd, git.status, typecheck,
 * build, governance, architecture.check, governance.test, ide.test,
 * factory.test, artifact.test, ui-inspection.test, review.test,
 * registry.sync, lint, git.diff, workspace.list). This runtime dispatches
 * into that SAME function for every RUN_REGISTERED_COMMAND intent —
 * it never spawns a process itself.
 *
 * Every invocation is recorded as a real COMMAND_INVOCATION artifact
 * (evidence), and every invocation first hydrates the real, persisted
 * Execution Context (per owner mandate: "เมื่อ Owner ส่งคำสั่ง: 1.
 * hydrate execution context ล่าสุด").
 */
import { randomUUID } from "crypto";
import { getCurrentExecutionContext, evaluateStepGate, type StepGateResult } from "./executionContextRuntime";
import { createRunCommandJob, QueueError, startWorkerInvokeJob, finalizeWorkerInvokeJob, type Job } from "./queueRuntime";
import { ExecutionError, COMMAND_REGISTRY } from "./executionRegistry";
import { createOperationsArtifact } from "./artifactRuntime";
import { selectWorker, getWorkerAdapter } from "./workerSelectorRuntime";
import type { WorkerRequest } from "./workerContract";

export type CommandIntentType =
  | "STEP_GATE_CHECK"
  | "RUN_REGISTERED_COMMAND"
  | "CHECK_PROBLEMS"
  | "CHECK_ARCHITECTURE"
  | "MODIFY_MODULE_HINT"
  | "OPEN_FILE_HINT"
  | "SEARCH_REPOSITORY"
  | "UNRECOGNIZED";

export type CommandInvocationStatus = "RESOLVED" | "DISPATCHED" | "BLOCKED" | "OWNER_ACTION_REQUIRED" | "UNRECOGNIZED" | "FAILED";

export interface CommandInvocationResult {
  invocationId: string;
  rawText: string;
  intent: CommandIntentType;
  status: CommandInvocationStatus;
  detail: string;
  stepGate: StepGateResult | null;
  dispatchedJob: { jobId: string; type: string; status: string } | null;
  hintTargetPath: string | null;
  evidenceArtifactId: string | null;
  createdAt: string;
  /** Real, live Worker answer for a SEARCH_REPOSITORY intent — the
   * repository-derived text + real session/cost evidence. Null for every
   * other intent. */
  workerAnswer: { text: string; sessionId: string | null; adapterId: string | null; cost: { amount: number | null; currency: string | null; kind: string } } | null;
}

// ============================================================
// Real, explicit, deterministic pattern table — never inferred,
// never guessed, never delegated to an AI/NLP model. Each pattern
// is matched against the owner's real, literal input text.
// ============================================================
const STEP_PATTERN = /(?:ทำ|เริ่ม|start|do)\s*step\s*(\d+(?:\.\d+)?)/i;
const OPEN_FILE_PATTERN = /(?:เปิดไฟล์|เปิดไฟล|open file)\s+(.+)/i;
const PROBLEMS_PATTERN = /(?:ตรวจปัญหา|check problems?|show problems?)/i;
const ARCHITECTURE_PATTERN = /(?:ตรวจ\s*architecture|architecture\s*check|ตรวจสถาปัตยกรรม)/i;
const RUN_TEST_PATTERN = /(?:รันทดสอบ|run test|รัน\s*test)(?:\s+(.+))?/i;
const MODIFY_MODULE_PATTERN = /(?:แก้\s*module|แก้ไข\s*module|modify module|edit module)\s+(.+)/i;
// Real repository search/analysis trigger — matches the owner's own
// example commands ("หาเส้นทาง LINE webhook จนถึง AI ที่ตอบกลับ",
// "ตรวจว่าตัวไหนเรียก AI") without requiring the Owner to already know a
// file path. Checked AFTER ARCHITECTURE_PATTERN/PROBLEMS_PATTERN above so
// "ตรวจ architecture"/"ตรวจปัญหา" are never shadowed by this broader match.
const SEARCH_PATTERN = /^(?:หา|ค้นหา|search\b|find\b)|ตรวจว่า/i;

const TEST_NAME_TO_COMMAND_ID: Record<string, string> = {
  ide: "ide.test", factory: "factory.test", governance: "governance.test",
  artifact: "artifact.test", "ui-inspection": "ui-inspection.test", review: "review.test",
};

// createRunCommandJob() does NOT throw for a real OWNER_CONFIRMATION_REQUIRED
// rejection — it catches that ExecutionError internally and returns a real
// Job with status "REJECTED" and a real, human error string (confirmed via
// direct testing: a naive try/catch here would have silently reported
// "DISPATCHED" for a job that was actually rejected). This helper is the
// one place that correctly distinguishes a real dispatch from a real
// rejection, reused by every intent that dispatches a registered command.
function interpretDispatchedJob(job: Job, commandId: string): { status: CommandInvocationStatus; detail: string } {
  if (job.status === "REJECTED") {
    if (job.error?.startsWith("OWNER_CONFIRMATION_REQUIRED")) {
      return { status: "OWNER_ACTION_REQUIRED", detail: `"${commandId}" changes the workspace — real, explicit Owner confirmation is required before it runs (use the Execution tab to confirm and run it).` };
    }
    return { status: "FAILED", detail: job.error ?? `"${commandId}" was rejected for an unspecified real reason` };
  }
  return { status: "DISPATCHED", detail: `Dispatched real "${commandId}" via the existing Execution Runtime — see Execution/Queue tab for live output.` };
}

function resolveIntent(rawText: string): { intent: CommandIntentType; step?: string; filePath?: string; testName?: string; moduleHint?: string } {
  const text = rawText.trim();
  const stepMatch = text.match(STEP_PATTERN);
  if (stepMatch) return { intent: "STEP_GATE_CHECK", step: stepMatch[1] };

  if (ARCHITECTURE_PATTERN.test(text)) return { intent: "CHECK_ARCHITECTURE" };
  if (PROBLEMS_PATTERN.test(text)) return { intent: "CHECK_PROBLEMS" };

  const runTestMatch = text.match(RUN_TEST_PATTERN);
  if (runTestMatch) return { intent: "RUN_REGISTERED_COMMAND", testName: (runTestMatch[1] ?? "").trim().toLowerCase() };

  const openFileMatch = text.match(OPEN_FILE_PATTERN);
  if (openFileMatch) return { intent: "OPEN_FILE_HINT", filePath: openFileMatch[1].trim() };

  const modifyMatch = text.match(MODIFY_MODULE_PATTERN);
  if (modifyMatch) return { intent: "MODIFY_MODULE_HINT", moduleHint: modifyMatch[1].trim() };

  if (SEARCH_PATTERN.test(text)) return { intent: "SEARCH_REPOSITORY" };

  return { intent: "UNRECOGNIZED" };
}

export async function handleOwnerCommand(rawText: string, actor: string, ownerId: string, ownerPreference: string[] = []): Promise<CommandInvocationResult> {
  const invocationId = randomUUID();
  const createdAt = new Date().toISOString();

  // Step 1 (owner mandate): hydrate the real, persisted Execution
  // Context before resolving anything — never chat history.
  const context = getCurrentExecutionContext();

  const resolved = resolveIntent(rawText);
  let status: CommandInvocationStatus = "RESOLVED";
  let detail = "";
  let stepGate: StepGateResult | null = null;
  let dispatchedJob: CommandInvocationResult["dispatchedJob"] = null;
  let hintTargetPath: string | null = null;
  let workerAnswer: CommandInvocationResult["workerAnswer"] = null;

  switch (resolved.intent) {
    case "STEP_GATE_CHECK": {
      stepGate = evaluateStepGate(resolved.step!);
      status = stepGate.allowed ? "OWNER_ACTION_REQUIRED" : "BLOCKED";
      detail = stepGate.allowed
        ? `Step ${resolved.step} passes every real Foundation/Gate condition — starting it is still a separate, explicit Owner action, never automatic.`
        : `Step ${resolved.step} is blocked: ${stepGate.reasons.join("; ")}`;
      break;
    }
    case "CHECK_ARCHITECTURE": {
      // architecture.check is real, but registered WORKSPACE_WRITE
      // (it regenerates registry/system-control-graph.json) — this
      // Command Surface never supplies ownerConfirmation itself, so a
      // real, honest OWNER_CONFIRMATION_REQUIRED is the expected
      // outcome, not a generic failure.
      try {
        const job = createRunCommandJob("architecture.check", undefined, actor, ownerId, false);
        dispatchedJob = { jobId: job.jobId, type: job.type, status: job.status };
        ({ status, detail } = interpretDispatchedJob(job, "architecture.check"));
      } catch (e) {
        status = "FAILED";
        detail = e instanceof ExecutionError || e instanceof QueueError ? `${e.code}: ${e.message}` : "unexpected error dispatching architecture.check";
      }
      break;
    }
    case "CHECK_PROBLEMS": {
      status = "RESOLVED";
      detail = "Real Problems data lives in the Problems tab (aggregates Inspection + Artifact Integrity + Review + Test + Build + Release) — this Command Surface never duplicates that live view, switch to the Problems tab to see current findings.";
      break;
    }
    case "RUN_REGISTERED_COMMAND": {
      const commandId = resolved.testName ? TEST_NAME_TO_COMMAND_ID[resolved.testName] : undefined;
      if (!resolved.testName) {
        // Bare "รันทดสอบ" with no target — real, explicit registry
        // exposed to the Owner rather than a silent default guess.
        status = "OWNER_ACTION_REQUIRED";
        detail = `Which real test? Available: ${Object.keys(TEST_NAME_TO_COMMAND_ID).join(", ")} (e.g. "รันทดสอบ governance").`;
      } else if (!commandId || !COMMAND_REGISTRY[commandId]) {
        status = "UNRECOGNIZED";
        detail = `"${resolved.testName}" is not a real, registered test — available: ${Object.keys(TEST_NAME_TO_COMMAND_ID).join(", ")}.`;
      } else {
        try {
          // Always false: typing a command is never itself a valid real
          // Owner confirmation for a WORKSPACE_WRITE command — that must
          // be a separate, explicit UI action (Execution tab). A prior
          // draft of this function passed the command's OWN
          // requiresOwnerConfirmation flag as if it were the Owner's
          // real answer, which would have auto-confirmed every
          // WORKSPACE_WRITE command; caught before this ever shipped.
          const job = createRunCommandJob(commandId, undefined, actor, ownerId, false);
          dispatchedJob = { jobId: job.jobId, type: job.type, status: job.status };
          ({ status, detail } = interpretDispatchedJob(job, commandId));
        } catch (e) {
          status = "FAILED";
          detail = e instanceof ExecutionError || e instanceof QueueError ? `${e.code}: ${e.message}` : "unexpected error dispatching command";
        }
      }
      break;
    }
    case "OPEN_FILE_HINT": {
      hintTargetPath = resolved.filePath!;
      status = "OWNER_ACTION_REQUIRED";
      detail = `File open is a real Explorer/Editor action, not something this Command Surface performs directly — use Explorer to open "${resolved.filePath}" (real path validation happens there, via the existing fsSecurity gate).`;
      break;
    }
    case "SEARCH_REPOSITORY": {
      // Real path: Command Surface -> Worker Selector -> real Worker
      // Adapter (repository.search capability) -> real Read/Grep/Glob
      // exploration of the actual repository -> real answer. A real
      // WORKER_INVOKE Queue job wraps the call — never skipped.
      const request: WorkerRequest = {
        workerRequestId: randomUUID(), workspaceSessionId: `command-surface:${invocationId}`, executionPlanId: null, stepId: "command-surface-search",
        workerType: "CODE_WORKER", capabilityRequired: "repository.search", contextPackageId: null, contextFingerprint: null,
        permittedReadScope: [], permittedWriteScope: [], permittedTools: ["Read", "Grep", "Glob"], forbiddenTools: ["Write", "Edit", "Bash"],
        expectedOutputSchema: "text", timeoutMs: 180_000, maxCalls: 1, maxTokens: 8000,
        maxCost: 2.0, privacyLevel: "CLOUD_ALLOWED", networkPolicy: "OUTBOUND_ALLOWED", approvalPolicy: "AUTO_LOW_RISK",
        actor, createdAt: new Date().toISOString(), taskDescription: rawText, acceptanceCriteria: [], fileContents: [],
      };
      const selection = await selectWorker(request, ownerPreference);
      if (selection.outcome === "NO_COMPATIBLE_WORKER" || selection.outcome === "BLOCKED" || !selection.selectedAdapterId) {
        status = "BLOCKED";
        detail = `No real Worker is available for repository.search right now: ${selection.reasons.join("; ")}`;
        break;
      }
      const adapter = getWorkerAdapter(selection.selectedAdapterId)!;
      const invokeJob = startWorkerInvokeJob(actor, ownerId, `${adapter.id}:repository.search`);
      dispatchedJob = { jobId: invokeJob.jobId, type: invokeJob.type, status: invokeJob.status };
      const response = await adapter.execute(request);
      finalizeWorkerInvokeJob(invokeJob.jobId, ownerId, { ok: response.status === "SUCCEEDED", result: response.status, error: response.error });
      workerAnswer = { text: response.output ?? "", sessionId: response.evidence[0] ?? null, adapterId: adapter.id, cost: response.cost };
      if (response.status === "SUCCEEDED") {
        status = "RESOLVED";
        detail = `Real answer from Worker "${adapter.id}" (real repository search, ${response.durationMs}ms, cost ${response.cost.kind === "ACTUAL" ? `$${response.cost.amount}` : "UNKNOWN"}).`;
      } else if (response.status === "NOT_CONFIGURED") {
        status = "BLOCKED";
        detail = `Worker "${adapter.id}" is NOT_CONFIGURED: ${response.limitations.join("; ") || response.error}`;
      } else if (response.status === "TIMEOUT") {
        status = "FAILED";
        detail = `Worker "${adapter.id}" real call timed out.`;
      } else {
        status = "FAILED";
        detail = `Worker "${adapter.id}" real call failed: ${response.error ?? "unknown error"}`;
      }
      break;
    }
    case "MODIFY_MODULE_HINT": {
      // Deliberately still a real, honest pointer rather than an inline
      // dispatch — codeWorkerRuntime.ts#generateCodeWorkerProposal()
      // requires a real ContextPlan (permittedReadScope/writeScope, real
      // file scope decisions) that only the real Context Planner flow can
      // safely produce; building a second, simplified path here would
      // risk becoming exactly the "second execution engine" the owner
      // forbade. That real flow (Factory Workspace -> Context Plan ->
      // Worker Contract -> generateCodeWorkerProposal) IS now real,
      // Queue-wired (WORKER_INVOKE, fixed 2026-08-07) and reuses the same
      // Worker Selector/Adapter as SEARCH_REPOSITORY above.
      status = "OWNER_ACTION_REQUIRED";
      detail = `Modifying "${resolved.moduleHint}" must go through the real Factory Workspace → Context Plan → Worker Contract → Change Set → Owner Diff Approval flow (Step 13.6, now Queue-wired) — switch to the Factory Workspace tab to start that real, governed flow. This Command Surface never edits files directly.`;
      break;
    }
    case "UNRECOGNIZED":
    default: {
      status = "UNRECOGNIZED";
      detail = `Not a recognized command. Recognized patterns: "ทำ Step N", "เปิดไฟล์ X", "ตรวจปัญหาปัจจุบัน", "แก้ module X", "รันทดสอบ [name]", "ตรวจ architecture", "หา.../ค้นหา.../ตรวจว่า... (real repository search)".`;
      break;
    }
  }

  const record: Omit<CommandInvocationResult, "evidenceArtifactId"> = {
    invocationId, rawText, intent: resolved.intent, status, detail, stepGate, dispatchedJob, hintTargetPath, workerAnswer, createdAt,
  };
  const artifact = createOperationsArtifact({
    artifactType: "COMMAND_INVOCATION", content: JSON.stringify({ ...record, currentStepAtInvocation: context?.current_step ?? null }),
    mimeType: "application/json", actor, ownerId, generatedFrom: invocationId, jobId: dispatchedJob?.jobId ?? null,
  });

  return { ...record, evidenceArtifactId: artifact.artifactId };
}
