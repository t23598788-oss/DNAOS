/**
 * COMMAND AUTHORIZATION ORCHESTRATION (Phase 6) — closes the 4 connection
 * points. Uses ONLY the existing pieces:
 *
 *   business-job-adapter (envelope → PENDING_APPROVAL / EXECUTED)
 *   authorization-resume (pending_authorizations + scoped_grants + RPC)
 *   response gateway (deliverBusinessResult) — returned by the caller
 *
 * One command = one commandId (stable job reference) → one request → one grant
 * → one execution. A resume never re-executes a command that already ran.
 */
import { randomUUID } from "node:crypto";
import {
  executeBusinessJob,
  type BusinessJobEnvelope,
  type BusinessExecutor,
} from "./business-job-adapter";
import {
  requestCapabilityAuthorization,
  resumeCapabilityJob,
  type AuthorizationResumeDeps,
} from "./authorization-resume";

export type CommandAuthorizationStatus =
  | "EXECUTED"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "RESUME_AUTHORIZED"
  | "EXECUTION_COMPLETED"
  | "EXECUTION_FAILED"
  | "DENIED"
  | "EXPIRED"
  | "BLOCKED";

export interface CommandAuthorizationResult<ExecResult = unknown> {
  status: CommandAuthorizationStatus;
  commandId: string;
  requestId?: string;
  grantId?: string | null;
  result?: ExecResult | null;
  violations?: string[];
}

/** Persistent idempotency (Phase 8) — atomic claim on the grant before execute. */
export interface CommandAuthorizationDeps extends AuthorizationResumeDeps {
  claimGrant?: (grantId: string, commandId: string) => Promise<{ claimed: boolean; error?: string }>;
  recordExecution?: (grantId: string, result: unknown, error?: string | null) => Promise<void>;
  /** offline fallback (tests only) — production uses claimGrant + recordExecution */
  executionGuard?: {
    hasExecuted(commandId: string): boolean;
    markExecuted(commandId: string): void;
  };
}

/** Derive the subject type from the envelope requester (never trust a client body). */
function subjectTypeFor(envelope: BusinessJobEnvelope): "account" | "device" | "tool" {
  return envelope.requested_by.kind === "agent" ? "tool" : "account";
}

/** The resource this command targets (first declared write, else the capability). */
function resourceFor(envelope: BusinessJobEnvelope): string {
  const w = envelope.scope?.data_write ?? [];
  return w[0] ?? envelope.capability;
}

export async function runCommandWithAuthorization<ExecResult>(
  deps: AuthorizationResumeDeps,
  envelope: BusinessJobEnvelope,
  executor: BusinessExecutor<ExecResult>,
): Promise<CommandAuthorizationResult<ExecResult>> {
  const commandId = randomUUID();
  const outcome = await executeBusinessJob(envelope, executor);

  if (outcome.status !== "PENDING_APPROVAL") {
    const ok = outcome.status === "EXECUTED" || outcome.status === "VERIFIED";
    return {
      status: ok ? "EXECUTED" : "BLOCKED",
      commandId,
      result: ok ? outcome.result : null,
      violations: outcome.violations,
    };
  }

  const req = await requestCapabilityAuthorization(deps, {
    capability: envelope.capability,
    resource: resourceFor(envelope),
    subjectType: subjectTypeFor(envelope),
    subjectId: envelope.requested_by.id,
    scope: { idempotency_key: envelope.idempotency_key, exec_args: envelope.exec_args },
    jobId: commandId,
    expiresAt: null,
    requestDescription: `approval required (${envelope.approval?.kind ?? "owner"}) for ${envelope.capability}`,
    claimantDescription: envelope.requested_by.id,
  });

  return {
    status: "PENDING_APPROVAL",
    commandId,
    requestId: req.ok ? req.requestId : undefined,
    violations: req.ok ? [] : [req.error ?? "request_failed"],
  };
}

export async function resumeCommandWithAuthorization<ExecResult>(
  deps: CommandAuthorizationDeps,
  input: { requestId: string; commandId: string; envelope: BusinessJobEnvelope },
  executor: BusinessExecutor<ExecResult>,
): Promise<CommandAuthorizationResult<ExecResult>> {
  // Idempotency: the PERSISTENT claim (production) takes precedence over the
  // in-memory guard (offline fallback used only when no claimGrant is wired).
  if (!deps.claimGrant && deps.executionGuard?.hasExecuted(input.commandId)) {
    return { status: "EXECUTION_COMPLETED", commandId: input.commandId, requestId: input.requestId, violations: ["already_executed"] };
  }

  const resume = await resumeCapabilityJob(deps, { requestId: input.requestId, jobId: input.commandId });

  if (!resume.ok) {
    const status: CommandAuthorizationStatus =
      resume.code === "GRANT_EXPIRED" ? "EXPIRED" : resume.code === "NOT_APPROVED" ? "DENIED" : "DENIED";
    return { status, commandId: input.commandId, requestId: input.requestId, violations: [resume.reason] };
  }

  // Persistent atomic claim BEFORE execute (Phase 8). A concurrent/duplicate
  // resume cannot re-execute: the second claim fails because the grant is
  // already consumed. This is crash-safe — the claim lives in Postgres.
  if (deps.claimGrant) {
    const claim = await deps.claimGrant(resume.grantId ?? "", input.commandId);
    if (!claim.claimed) {
      return { status: "DENIED", commandId: input.commandId, requestId: input.requestId, grantId: resume.grantId ?? null, violations: [claim.error ?? "already_claimed"] };
    }
  }

  const envelopeWithRef: BusinessJobEnvelope = {
    ...input.envelope,
    approval: { ...(input.envelope.approval ?? { required: true, kind: "owner" }), required: true, ref: resume.grantId ?? undefined },
  };
  const outcome = await executeBusinessJob(envelopeWithRef, executor);

  if (outcome.status === "EXECUTED" || outcome.status === "VERIFIED") {
    deps.executionGuard?.markExecuted(input.commandId);
    await deps.recordExecution?.(resume.grantId ?? "", outcome.result ?? null, null);
    return {
      status: "EXECUTION_COMPLETED",
      commandId: input.commandId,
      requestId: input.requestId,
      grantId: resume.grantId ?? null,
      result: outcome.result,
    };
  }
  await deps.recordExecution?.(resume.grantId ?? "", null, outcome.violations.join("; "));
  return {
    status: "EXECUTION_FAILED",
    commandId: input.commandId,
    requestId: input.requestId,
    grantId: resume.grantId ?? null,
    violations: outcome.violations,
  };
}
