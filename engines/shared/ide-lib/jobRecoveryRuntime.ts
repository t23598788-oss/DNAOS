/**
 * JOB RECOVERY PREFLIGHT (IntegrPASS 5 / G4) — control plane, READ-ONLY.
 *
 * Gathers every prerequisite the owner requires BEFORE any retry/resume, using only existing
 * infrastructure: checkpoint (executionContextRuntime) · business truth re-read from the
 * canonical DB · acceptance/evidence (businessAcceptanceRuntime) · approval state
 * (approval-evidence, sources stay the authority) · cost already consumed (COST_LEDGER) ·
 * paid retry cost gate (checkCostGate) — then asks the pure domain resolver for the decision.
 * It never writes, never approves, never retries and never touches business truth.
 */
import { getCurrentExecutionContext } from "./executionContextRuntime";
import { checkCostGate, listCostLedgerEntries, type CostGateOutcome } from "./costGateRuntime";
import { runBusinessAcceptance } from "./businessAcceptanceRuntime";
import { getBusinessStopConditionRecovery } from "./recoveryRegistry";
import { resolveApprovalEvidence, hasVerifiedApproval } from "@/engines/jobs/approval-evidence";
import { resolveRecoveryDecision, type RecoveryContext, type RecoveryDecision } from "@/engines/jobs/job-recovery";
import { supabaseAdmin } from "@/services/supabase/queries";

const BUSINESS_REF_TABLES = ["document_versions", "invoices", "standalone_documents", "payment_allocations", "customer_orders"];

export interface RecoveryPreflightInput {
  job_id: string;
  capability: string;
  failure_code: string;
  attempt_count: number;
  business_refs?: Array<{ table: string; id: string }>;
  previous_executor_outcome?: string | null;
  acceptance_ids?: string[];
  paid_cost_estimate?: number;
  cost_authorization_ref?: string | null;
  provider?: string;
  worker_id?: string;
  owner_id?: string;
  actor?: string;
}

export interface RecoveryPreflightResult {
  job_id: string;
  failure_code: string;
  decision: RecoveryDecision;
  prerequisites: Array<{ description: string; met: boolean; evidence: string }>;
  cost_gate: CostGateOutcome | null;
  cost_already_consumed: number;
  business_truth: { written: boolean; refs_found: number; refs_missing: string[] };
  recovery_type: { id: string; status: string; mutation_level: string; owner_approval_required: boolean } | null;
  writes_performed: false;
}

export async function assessRecoveryPrerequisites(input: RecoveryPreflightInput): Promise<RecoveryPreflightResult> {
  const db = supabaseAdmin();
  const prerequisites: RecoveryPreflightResult["prerequisites"] = [];

  const checkpoint = getCurrentExecutionContext();
  prerequisites.push({ description: "latest checkpoint read", met: true, evidence: checkpoint ? `checkpoint ${checkpoint.checkpointId} step=${checkpoint.current_step}` : "no checkpoint yet" });

  const refs = input.business_refs ?? [];
  const refsMissing: string[] = [];
  for (const ref of refs) {
    if (!BUSINESS_REF_TABLES.includes(ref.table)) { refsMissing.push(`${ref.table}#${ref.id}`); continue; }
    const { data } = await db.from(ref.table).select("id").eq("id", ref.id).limit(1);
    if (!data?.length) refsMissing.push(`${ref.table}#${ref.id}`);
  }
  prerequisites.push({ description: "current business truth re-read from canonical DB", met: true, evidence: `${refs.length - refsMissing.length}/${refs.length} ref(s) present${refsMissing.length ? ", missing: " + refsMissing.join(",") : ""}` });

  let acceptanceEvidencePresent = true;
  if (input.acceptance_ids?.length) {
    const outcomes = await runBusinessAcceptance(input.acceptance_ids, { job_id: input.job_id });
    acceptanceEvidencePresent = outcomes.length > 0 && outcomes.every((o) => o.evidence_ref.length > 8);
    prerequisites.push({ description: "acceptance/evidence re-derived", met: acceptanceEvidencePresent, evidence: outcomes.map((o) => `${o.acceptance_id}:${o.evidence_ref}`).join(" | ") });
  } else {
    prerequisites.push({ description: "acceptance/evidence not re-run (not requested)", met: true, evidence: "caller supplied no acceptance ids" });
  }

  const approvals = await resolveApprovalEvidence({ capability: input.capability, job_id: input.job_id, limit: 5 });
  const approvalVerified = hasVerifiedApproval(approvals);
  prerequisites.push({ description: "approval state read from real sources", met: true, evidence: approvals.length ? `${approvals.length} record(s), verified=${approvalVerified}` : "no approval records" });

  const consumed = listCostLedgerEntries().reduce((sum, e) => sum + Number((e as { actualCostUsd?: number }).actualCostUsd ?? 0), 0);
  prerequisites.push({ description: "cost already consumed read from COST_LEDGER", met: true, evidence: `consumed=${consumed}` });

  let gate: CostGateOutcome | null = null;
  let paidGatePassed = true;
  if ((input.paid_cost_estimate ?? 0) > 0) {
    gate = checkCostGate({
      provider: input.provider ?? "unknown-provider",
      operation: input.capability,
      estimated_cost: input.paid_cost_estimate ?? null,
      currency: "USD",
      max_cost: null,
      reason: `bounded retry attempt ${input.attempt_count + 1} for business job ${input.job_id}`,
      task_id: `${input.job_id}#attempt${input.attempt_count + 1}`,
      worker_id: input.worker_id ?? "business-job-adapter",
      evidence: [`job:${input.job_id}`, `failure:${input.failure_code}`],
      ownerId: input.owner_id ?? "owner",
      actor: input.actor ?? "job-recovery-preflight",
    });
    paidGatePassed = (gate as { allowed?: boolean }).allowed === true;
    prerequisites.push({ description: "paid retry passed the cost gate", met: paidGatePassed, evidence: JSON.stringify(gate).slice(0, 200) });
  }

  const businessTruthWritten = refs.length > 0 ? refsMissing.length < refs.length : Boolean(input.previous_executor_outcome);
  const ctx: RecoveryContext = {
    attempt_count: input.attempt_count, checkpoint_read: true,
    latest_checkpoint_id: checkpoint?.checkpointId ?? null, previous_checkpoint_id: checkpoint?.previousCheckpointId ?? null,
    business_truth_read: true, business_truth_written: businessTruthWritten,
    business_refs: refs.map((r) => `${r.table}#${r.id}`),
    previous_executor_outcome: input.previous_executor_outcome ?? null,
    acceptance_evidence_present: acceptanceEvidencePresent, approval_verified: approvalVerified,
    cost_already_consumed: consumed, paid_retry_cost_gate_passed: paidGatePassed,
  };
  const decision = resolveRecoveryDecision(input.failure_code, ctx);
  const rt = getBusinessStopConditionRecovery(input.failure_code);

  return {
    job_id: input.job_id, failure_code: input.failure_code, decision, prerequisites,
    cost_gate: gate, cost_already_consumed: consumed,
    business_truth: { written: businessTruthWritten, refs_found: refs.length - refsMissing.length, refs_missing: refsMissing },
    recovery_type: rt ? { id: rt.id, status: rt.status, mutation_level: rt.mutationLevel, owner_approval_required: rt.ownerApprovalRequired } : null,
    writes_performed: false,
  };
}

