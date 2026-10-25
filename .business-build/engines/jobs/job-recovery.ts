/**
 * JOB RECOVERY DECISION (IntegrPASS 5 / G4) — pure, DB-free, domain layer.
 *
 * Turns a business stop condition into a recovery decision using the policy table in the
 * APPROVED contract (registry/CANONICAL_JOB_CONTRACT.json#recovery_policies). No recovery
 * engine, no queue, no state: this file only decides, and refuses to retry when the caller
 * did not actually check the prerequisites (checkpoint / business truth / previous outcome /
 * acceptance evidence / cost gate / attempt count).
 *
 * RECOVERY != RETRY · RETRY EXECUTION != RESUME WORKFLOW
 * a job whose business truth was already written is never speculatively re-fired
 * destructive actions are never auto-retried · retry is bounded · paid retry needs a gate
 */
import contract from "@/registry/CANONICAL_JOB_CONTRACT.json";

export interface RecoveryPolicy {
  failure_code: string;
  retry_allowed: boolean;
  max_attempts: number;
  backoff: string;
  requires_owner: boolean;
  requires_reverify: boolean;
  resume_mode: string;
  cost_behavior: string;
  terminal_state: string;
}

export type RecoveryAction = "RETRY_EXECUTION" | "WAIT_APPROVAL" | "WAIT_BUDGET" | "REVIEW" | "OWNER_ONLY" | "SCOPED_REPAIR" | "ESCALATE_STOP";

export interface RecoveryContext {
  attempt_count: number;
  checkpoint_read: boolean;
  latest_checkpoint_id: string | null;
  previous_checkpoint_id: string | null;
  business_truth_read: boolean;
  business_truth_written: boolean;
  business_refs: string[];
  previous_executor_outcome: string | null;
  acceptance_evidence_present: boolean;
  approval_verified: boolean;
  cost_already_consumed: number;
  paid_retry_cost_gate_passed: boolean;
}

export interface RecoveryDecision {
  action: RecoveryAction;
  failure_code: string;
  policy: RecoveryPolicy | null;
  retry_allowed: boolean;
  attempt: number;
  max_attempts: number;
  backoff: string;
  requires_owner: boolean;
  requires_reverify: boolean;
  resume_mode: string;
  cost_behavior: string;
  terminal_state: string;
  blocked_by: string[];
  reason: string;
}

const POLICIES: RecoveryPolicy[] = (contract as { recovery_policies: { policies: RecoveryPolicy[] } }).recovery_policies.policies;

export function recoveryPolicies(): RecoveryPolicy[] {
  return POLICIES;
}

export function findRecoveryPolicy(failureCode: string): RecoveryPolicy | undefined {
  return POLICIES.find((p) => p.failure_code === failureCode);
}

/** Action implied by the policy + the observed context (before pre-check blocking). */
function actionFor(policy: RecoveryPolicy, ctx: RecoveryContext): RecoveryAction {
  if (!policy.retry_allowed) {
    switch (policy.terminal_state) {
      case "WAIT_APPROVAL": return "WAIT_APPROVAL";
      case "WAIT_BUDGET": return "WAIT_BUDGET";
      case "OWNER_ONLY": return "OWNER_ONLY";
      case "ESCALATED": return "ESCALATE_STOP";
      case "TERMINAL_REVIEW": return "SCOPED_REPAIR";
      default: return "REVIEW";
    }
  }
  if (ctx.business_truth_written) return "REVIEW";
  if (ctx.attempt_count >= policy.max_attempts) return "REVIEW";
  return "RETRY_EXECUTION";
}

/** Resolves the decision. Unknown failure codes are never guessed — they escalate. */
export function resolveRecoveryDecision(failureCode: string, ctx: RecoveryContext): RecoveryDecision {
  const policy = findRecoveryPolicy(failureCode);
  const base = {
    failure_code: failureCode, policy: policy ?? null, attempt: ctx.attempt_count,
    max_attempts: policy?.max_attempts ?? 0, backoff: policy?.backoff ?? "none",
    requires_owner: policy?.requires_owner ?? true, requires_reverify: policy?.requires_reverify ?? true,
    resume_mode: policy?.resume_mode ?? "STOP_AND_ESCALATE_CENTRAL", cost_behavior: policy?.cost_behavior ?? "NO_COST",
    terminal_state: policy?.terminal_state ?? "ESCALATED", retry_allowed: policy?.retry_allowed ?? false,
  };
  if (!policy) {
    return { ...base, action: "ESCALATE_STOP", blocked_by: [], reason: `unknown failure code "${failureCode}" — STOP and escalate; never guess a recovery` };
  }

  const blocked: string[] = [];
  if (policy.retry_allowed) {
    if (ctx.business_truth_written) blocked.push("business truth already written — never re-fire the writer speculatively");
    if (!ctx.checkpoint_read) blocked.push("latest checkpoint not read");
    if (!ctx.business_truth_read) blocked.push("current business truth not re-read from canonical DB");
    if (!ctx.acceptance_evidence_present) blocked.push("previous acceptance/evidence missing");
    if (ctx.previous_executor_outcome === null) blocked.push("previous executor outcome unknown");
    if (policy.cost_behavior === "GATE_EACH_ATTEMPT" && !ctx.paid_retry_cost_gate_passed) blocked.push("paid retry has not passed the cost gate");
  }
  if (policy.terminal_state === "OWNER_ONLY" && !ctx.approval_verified) blocked.push("owner-only action — approval can never be self-granted");

  const intended = actionFor(policy, ctx);
  const allowed = intended === "RETRY_EXECUTION" && blocked.length === 0;
  const action: RecoveryAction = allowed ? "RETRY_EXECUTION" : intended === "RETRY_EXECUTION" ? "REVIEW" : intended;
  return {
    ...base,
    action,
    blocked_by: blocked,
    reason: allowed
      ? `bounded retry ${ctx.attempt_count + 1}/${policy.max_attempts} (${policy.backoff}) — all pre-checks observed`
      : `${action === "REVIEW" ? "no retry — " : ""}${policy.resume_mode} (${policy.terminal_state})${blocked.length ? " — blocked: " + blocked.join("; ") : ""}`,
  };
}

/** A paid retry is only legitimate when it passed the cost gate as its own new attempt. */
export function isPaidRetryAllowed(decision: RecoveryDecision, ctx: RecoveryContext): boolean {
  if (decision.action !== "RETRY_EXECUTION") return false;
  if (decision.cost_behavior !== "GATE_EACH_ATTEMPT") return true;
  return ctx.paid_retry_cost_gate_passed;
}

/** RETRY EXECUTION and RESUME WORKFLOW are different things — this keeps them apart. */
export function describeRecoverySemantics(decision: RecoveryDecision): { is_retry: boolean; is_resume: boolean; re_runs_executor: boolean } {
  const isRetry = decision.action === "RETRY_EXECUTION";
  const isResume = decision.resume_mode.startsWith("WAIT_") || decision.resume_mode === "REVERIFY_OR_RESUME_FROM_CHECKPOINT";
  return { is_retry: isRetry, is_resume: isResume, re_runs_executor: isRetry };
}

