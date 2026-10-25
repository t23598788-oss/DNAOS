/**
 * CROSS-RUNTIME CANONICAL JOB TRANSPORT (IntegrPASS 6 / G2) — control plane, thin.
 *
 * The canonical side of the transport: Edge/Deno posts a transport envelope (fields declared
 * in registry/CANONICAL_JOB_CONTRACT.json#cross_runtime_transport) and this runtime
 *   1. validates the envelope against the declared business capabilities,
 *   2. performs the IDEMPOTENCY lookup against real business truth BEFORE anything runs,
 *   3. checks approval evidence through the existing normalizer when the capability needs it,
 *   4. runs the job through the SAME Business Job Adapter → SAME canonical writer,
 *   5. answers with the declared response contract (job_id/status/business_refs/acceptance/evidence/recovery).
 *
 * It adds no queue, no state store, no approval or cost system, and it never writes business
 * truth itself — the canonical writer remains the owner (the executor is injected).
 */
import { buildBusinessJob, executeBusinessJob } from "@/engines/jobs/business-job-adapter";
import { resolveApprovalEvidence, hasVerifiedApproval } from "@/engines/jobs/approval-evidence";
import { resolveRecoveryDecision, type RecoveryContext } from "@/engines/jobs/job-recovery";
import { createTransaction } from "@/engines/canonical/transaction-write";
import { supabaseAdmin } from "@/services/supabase/queries";

export interface CrossRuntimeEnvelope {
  job_id: string;
  kind: "BUSINESS";
  source_runtime: "SUPABASE_EDGE";
  source_channel: "LINE" | "EMAIL" | "BANK" | "UPLOAD" | "DRIVE";
  capability: string;
  executor: "SERVICE";
  intent: string;
  identity_refs: { line_user_id?: string; partner_id?: string | null; event_id?: string | null };
  scope: { data_write?: string[]; data_read?: string[]; spend?: { kind: "FREE" | "PAID" | "UNKNOWN_COST" } };
  plan_ref?: string | null;
  approval_refs?: string[];
  evidence_refs?: string[];
  correlation_id: string;
  idempotency_key: string;
  requested_at: string;
  source_event_id: string;
  exec_args: unknown;
}

export interface CrossRuntimeResponse {
  job_id: string;
  status: string;
  capability: string;
  business_refs: Array<{ table: string; id: string }>;
  acceptance: Array<{ acceptance_id: string; pass: boolean; verifier_id: string; evidence_ref: string }>;
  evidence_refs: string[];
  recovery: { action: string; terminal_state: string; reason: string } | null;
  idempotent_replay: boolean;
  wrote: boolean;
}

export type CrossRuntimeExecutors = Record<string, (env: CrossRuntimeEnvelope) => Promise<{ result: unknown; observed_writes: string[] }>>;

/** Real executor map — the canonical writers that exist today. */
export const CANONICAL_RUNTIME_EXECUTORS: CrossRuntimeExecutors = {
  "transaction.create": async (env) => {
    const args = env.exec_args as Parameters<typeof createTransaction>[0];
    const result = await createTransaction(args, env.identity_refs?.line_user_id ?? env.source_runtime);
    return { result, observed_writes: ["projects", "document_groups", "customer_orders", "customer_sites"] };
  },
};

/** Idempotency lookup against REAL business truth (never a control-plane copy). */
async function findExistingExecution(env: CrossRuntimeEnvelope): Promise<Array<{ table: string; id: string }>> {
  const db = supabaseAdmin();
  if (env.capability === "transaction.create" && env.identity_refs.event_id) {
    const { data } = await db.from("business_events").select("id, transaction_id").eq("id", env.identity_refs.event_id).limit(1);
    const row = data?.[0];
    if (row?.transaction_id) return [{ table: "customer_orders", id: String(row.transaction_id) }];
  }
  return [];
}

const REQUIRED = ["job_id", "kind", "source_runtime", "source_channel", "capability", "executor", "intent", "identity_refs", "scope", "correlation_id", "idempotency_key", "requested_at", "source_event_id"];

export interface HandleOptions {
  executors?: CrossRuntimeExecutors;
  /** test-only: skip the real DB idempotency lookup (never used by the route) */
  skipIdempotencyLookup?: boolean;
}

/**
 * Handles one cross-runtime job. Returns the declared response contract.
 * `wrote` is true ONLY when the canonical writer actually ran (idempotent replay ⇒ false).
 */
export async function handleCanonicalJobRequest(raw: unknown, options: HandleOptions = {}): Promise<CrossRuntimeResponse> {
  const env = raw as CrossRuntimeEnvelope;
  const missing = REQUIRED.filter((f) => env?.[f as keyof CrossRuntimeEnvelope] === undefined || env[f as keyof CrossRuntimeEnvelope] === null);
  const base: CrossRuntimeResponse = {
    job_id: String(env?.job_id ?? "unknown"), status: "BLOCKED_INVALID_ENVELOPE", capability: String(env?.capability ?? "unknown"),
    business_refs: [], acceptance: [], evidence_refs: [], recovery: null, idempotent_replay: false, wrote: false,
  };
  if (missing.length) return { ...base, evidence_refs: [`missing fields: ${missing.join(",")}`] };

  const executors = options.executors ?? CANONICAL_RUNTIME_EXECUTORS;
  const executor = executors[env.capability];
  if (!executor) return { ...base, status: "BLOCKED_UNKNOWN_CAPABILITY", evidence_refs: [`no canonical executor for ${env.capability}`] };

  // 1) idempotency — real business truth lookup BEFORE anything runs
  if (!options.skipIdempotencyLookup) {
    const existing = await findExistingExecution(env);
    if (existing.length) {
      return { ...base, status: "ALREADY_EXECUTED", business_refs: existing, evidence_refs: [`idempotency:${env.idempotency_key}`, `source_event:${env.source_event_id}`], idempotent_replay: true };
    }
  }

  // 2) approval — only when the capability declares it; sources stay the authority
  const built = buildBusinessJob({
    capability: env.capability,
    requested_by: { kind: "system", id: env.identity_refs?.line_user_id ?? env.source_runtime },
    idempotency_key: env.idempotency_key,
    exec_args: env.exec_args,
    data_write: env.scope?.data_write,
    approval_ref: env.approval_refs?.[0],
  });
  if (!built.envelope) return { ...base, status: "BLOCKED_UNKNOWN_CAPABILITY", evidence_refs: built.problems };
  if (built.envelope.approval?.required) {
    const refs = env.approval_refs ?? [];
    // no ref presented ⇒ the caller cannot approve its own job ⇒ WAIT_APPROVAL (never self-grant)
    const verified = refs.length
      ? (await Promise.all(refs.map((ref) => resolveApprovalEvidence({ capability: env.capability, approval_ref: ref, job_id: env.job_id, limit: 5 })))).flat()
      : [];
    if (!refs.length || !hasVerifiedApproval(verified, refs[0])) {
      const ctx: RecoveryContext = {
        attempt_count: 0, checkpoint_read: true, latest_checkpoint_id: null, previous_checkpoint_id: null,
        business_truth_read: true, business_truth_written: false, business_refs: [], previous_executor_outcome: "not executed",
        acceptance_evidence_present: true, approval_verified: false, cost_already_consumed: 0, paid_retry_cost_gate_passed: true,
      };
      const decision = resolveRecoveryDecision("APPROVAL_REQUIRED", ctx);
      return { ...base, status: "PENDING_APPROVAL", recovery: { action: decision.action, terminal_state: decision.terminal_state, reason: decision.reason } };
    }
  }

  // 3) run through the SAME adapter → SAME canonical executor
  const execution = await executeBusinessJob(built.envelope, async (envelope) => {
    const outcome = await executor({ ...env, exec_args: envelope.exec_args });
    return { result: outcome.result, observed_writes: outcome.observed_writes };
  });

  const result = execution.result as { order_id?: string; document_group_id?: string; project_id?: string; site_id?: string } | null;
  const businessRefs: Array<{ table: string; id: string }> = [];
  if (result?.order_id) businessRefs.push({ table: "customer_orders", id: result.order_id });
  if (result?.document_group_id) businessRefs.push({ table: "document_groups", id: result.document_group_id });
  if (result?.project_id) businessRefs.push({ table: "projects", id: result.project_id });
  if (result?.site_id) businessRefs.push({ table: "customer_sites", id: result.site_id });

  return {
    job_id: execution.job_id ?? env.job_id,
    status: execution.status,
    capability: env.capability,
    business_refs: businessRefs,
    acceptance: (execution.acceptance ?? []).map((a) => ({ acceptance_id: a.acceptance_id, pass: a.pass, verifier_id: a.verifier_id, evidence_ref: a.evidence_ref })),
    evidence_refs: [`source_event:${env.source_event_id}`, `correlation:${env.correlation_id}`, ...(env.evidence_refs ?? [])],
    recovery: execution.status === "EXECUTED_REQUIRES_REVIEW"
      ? { action: "REVIEW", terminal_state: "REVIEW", reason: "acceptance failed after the write — review, never re-fire" }
      : null,
    idempotent_replay: false,
    wrote: execution.result !== null,
  };
}

