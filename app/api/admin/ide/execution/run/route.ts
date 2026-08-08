/**
 * POST /api/admin/ide/execution/run — { commandId, args?, ownerConfirmation? }
 * — starts a governed real process run via the Execution Runtime (owner,
 * 2026-08-05, Phase 4; extended 2026-08-06 for Real Terminal Execution and
 * Step 3's Production Queue). The client can only ever send a commandId +
 * typed dynamic args — executable/argv/cwd/env are decided entirely
 * server-side by executionRegistry.ts. Ownership is taken from the real
 * auth session (auth.id/auth.email), never trusted from the request body.
 *
 * Step 3: this route now goes through queueRuntime.ts's
 * createRunCommandJob() instead of calling startRun() directly — that
 * function calls the exact same real startRun() (nothing about command
 * execution changed), and additionally creates a real RUN_COMMAND/
 * TYPE_CHECK Job that mirrors the run's status. Editor → Save → Job →
 * Queue → Execution Runtime → Result → History, for the Terminal side of
 * that pipeline.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { ExecutionError, type ExecutionErrorCode } from "../../_lib/executionRegistry";
import { getRun, subscribeToRunEvents } from "../../_lib/executionRuntime";
import { createRunCommandJob, QueueError } from "../../_lib/queueRuntime";
import { attachInspectionToRun, inspectionTypeForCommand, getInspection } from "../../_lib/inspectionRuntime";
import { createQueueJobArtifact, createExecutionResultArtifact, createInspectionResultArtifact } from "../../_lib/artifactRuntime";

type CombinedErrorCode = ExecutionErrorCode | QueueError["code"];

function errorResponse(code: CombinedErrorCode, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: CombinedErrorCode): number {
  if (code === "INVALID_COMMAND" || code === "INVALID_ARGUMENT") return 400;
  if (code === "COMMAND_NOT_ALLOWED" || code === "COMMAND_DENIED") return 403;
  if (code === "WORKSPACE_NOT_AVAILABLE") return 503;
  if (code === "CONCURRENCY_LIMIT" || code === "COMMAND_BUSY" || code === "DUPLICATE_JOB") return 429;
  if (code === "OWNER_CONFIRMATION_REQUIRED") return 428; // Precondition Required
  return 500;
}

export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  let body: { commandId?: unknown; args?: unknown; ownerConfirmation?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse("INVALID_COMMAND", "invalid JSON body", 400);
  }
  const { commandId, args, ownerConfirmation } = body;
  if (typeof commandId !== "string" || commandId.length === 0) {
    return errorResponse("INVALID_COMMAND", "commandId is required", 400);
  }
  if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) {
    return errorResponse("INVALID_ARGUMENT", "args must be an object", 400);
  }
  if (ownerConfirmation !== undefined && typeof ownerConfirmation !== "boolean") {
    return errorResponse("INVALID_ARGUMENT", "ownerConfirmation must be a boolean", 400);
  }

  try {
    const job = createRunCommandJob(commandId, args as Record<string, unknown> | undefined, auth.email, auth.id, ownerConfirmation === true);
    // job.executionId is set the moment startRun() succeeds inside
    // createRunCommandJob — REJECTED jobs (e.g. spawn failure) have none,
    // in which case there's no real RunRecord to report run-shaped fields
    // from; the job's own status/error already carries that outcome.
    const run = job.executionId ? getRun(job.executionId, auth.id) : null;

    // Real Inspection Pipeline (Step 4) — if this command is a recognized
    // inspection-relevant one (typecheck/governance/architecture.check),
    // attach an Inspection Record to the SAME real executionId/jobId that
    // just started above. No second process is spawned — attachInspectionToRun
    // only subscribes to the run already created by createRunCommandJob().
    let attachedInspectionId: string | null = null;
    if (job.executionId && inspectionTypeForCommand(commandId) !== null) {
      const attached = attachInspectionToRun(commandId, job.executionId, auth.email, auth.id, job.jobId);
      attachedInspectionId = attached?.inspectionId ?? null;
    }

    // Real Artifact Pipeline (Step 5) — every RUN_COMMAND Job becomes a
    // real QUEUE_JOB artifact immediately (a real snapshot at start time),
    // and once the real underlying run actually finishes, a real
    // EXECUTION_RESULT artifact chained as its child. If an Inspection was
    // attached to this same run (no duplicate process), its own real
    // INSPECTION_RESULT artifact is chained as a child of the
    // EXECUTION_RESULT once IT finishes too — never fabricated ahead of
    // the real terminal events.
    try {
      const jobArtifact = createQueueJobArtifact(job, auth.email, auth.id);
      if (job.executionId) {
        const executionId = job.executionId;
        let settled = false;
        const terminalTypes = ["run.completed", "run.failed", "run.cancelled", "run.timeout", "run.output_limited"];
        const onTerminal = (eventType: string) => {
          if (settled || !terminalTypes.includes(eventType)) return;
          settled = true;
          try {
            const finishedRun = getRun(executionId, auth.id);
            const execArtifact = createExecutionResultArtifact(finishedRun, auth.email, auth.id, [jobArtifact.artifactId]);
            if (attachedInspectionId) {
              try {
                const finishedInspection = getInspection(attachedInspectionId, auth.id);
                if (finishedInspection.status !== "QUEUED" && finishedInspection.status !== "RUNNING") {
                  createInspectionResultArtifact(finishedInspection, auth.email, auth.id, [execArtifact.artifactId]);
                }
              } catch { /* inspection artifact wrapping never blocks execution artifact creation */ }
            }
          } catch { /* artifact wrapping never blocks or reverses the real run */ }
        };
        const sub = subscribeToRunEvents(executionId, (event) => onTerminal(event.type));
        // The run may already be fully terminal by the time we subscribed
        // (a race, same one Step 4's inspection runtime already handles) —
        // its terminal event only lives in `replay`, never delivered live,
        // so check replay through the same handler rather than missing it.
        if (sub) for (const event of sub.replay) onTerminal(event.type);
      }
    } catch { /* artifact wrapping never blocks or reverses the real run/job */ }

    return NextResponse.json({
      ok: true, jobId: job.jobId, runId: job.executionId,
      commandId: job.command, status: run?.status ?? "failed",
      startedAt: run?.startedAt ?? job.startedAt ?? job.createdAt,
      workingDirectory: run?.workingDirectory ?? null, mode: run?.mode ?? null, actor: job.actor,
    });
  } catch (e) {
    const code: CombinedErrorCode = e instanceof ExecutionError ? e.code : e instanceof QueueError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof Error ? e.message : "unexpected error";
    return errorResponse(code, message, statusFor(code));
  }
}
