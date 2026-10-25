/**
 * BUSINESS JOB PROGRESS (IntegrPASS 4 / G8) — control plane, reuses the EXISTING state system.
 *
 * Owner rule: no new state system. Progress of a business job is appended to the same real
 * checkpoint chain every other job uses (app/api/admin/ide/_lib/executionContextRuntime.ts →
 * registry/EXECUTION_CONTEXT.json). This module only maps a business job's control record onto
 * that existing writer.
 *
 * It is explicitly NOT business truth: the business facts stay in the DB rows/versions/ledger
 * the canonical writer produced; a checkpoint is a control-plane timeline entry that points at
 * them. `dry_run` lets callers (and the verifier) prove the mapping without touching the chain.
 */
import { writeExecutionContextCheckpoint } from "./executionContextRuntime";

export interface BusinessJobProgressInput {
  job_id: string;
  capability: string;
  status: string;
  executor: { module: string; export: string };
  acceptance: Array<{ acceptance_id: string; verifier_id: string; pass: boolean; evidence_ref: string }>;
  document_id?: string | null;
  actor: string;
  dry_run?: boolean;
}

export interface BusinessJobProgressResult {
  recorded: boolean;
  dry_run: boolean;
  step: string;
  checkpoint_id: string | null;
  /** states where the authority for the business facts lives (never the checkpoint chain) */
  business_truth: string;
  note: string;
}

export async function recordBusinessJobProgress(input: BusinessJobProgressInput): Promise<BusinessJobProgressResult> {
  const step = `business.${input.capability}`;
  const dryRun = input.dry_run ?? process.env.DNAOS_JOB_PROGRESS_DRY_RUN === "1";
  const businessTruth = input.document_id ? `public.document_versions/doc=${input.document_id} (canonical writer output)` : "the canonical writer's own rows";
  const note = "control-plane checkpoint only — business truth stays in the database rows written by the canonical writer";

  if (dryRun) {
    return { recorded: false, dry_run: true, step, checkpoint_id: null, business_truth: businessTruth, note };
  }

  const checkpoint = await writeExecutionContextCheckpoint(
    {
      current_step: step,
      last_completed_step: step,
      step_status: { [step]: input.status as never },
      step_report: {
        [step]:
          `job ${input.job_id} · capability ${input.capability} · executor ${input.executor.module}#${input.executor.export}` +
          ` · acceptance ${input.acceptance.map((a) => `${a.acceptance_id}:${a.pass ? "PASS" : "FAIL"}`).join(", ") || "none"}`,
      },
      evidence_refs: [
        `job:${input.job_id}`,
        ...input.acceptance.map((a) => `${a.verifier_id} -> ${a.evidence_ref}`),
      ],
    },
    input.actor,
    input.actor,
    `business job ${input.job_id} (${input.capability}) reached ${input.status}`,
  );

  return { recorded: true, dry_run: false, step, checkpoint_id: checkpoint.checkpointId, business_truth: businessTruth, note };
}
