/**
 * หน้าที่: Engineering completion lifecycle — observe, manifest, admit,
 * DNA OS integrate. Does not commit, push, PR, deploy, or call
 * continueRegisteredArtifact.
 *
 * Input: a successful isolated coding run, optional claimed manifest.
 * Output: EngineeringCompletionResult.
 * Dependency ที่อนุญาต: ./runtime.ts, ./observe.ts, ./manifest.ts,
 * ./completion-gate.ts, ./integrate.ts, ./persist.ts, ./types.ts,
 * ../agent-gateway/contract.ts.
 * สิ่งที่ห้ามแตะ: never let the worker copy into the registered checkout.
 */

import { randomUUID } from "node:crypto";
import { saveEvidence } from "../agent-gateway/contract";
import { admitEngineeringResult } from "./completion-gate";
import { integrateAdmittedEngineering } from "./integrate";
import { buildEngineeringManifest } from "./manifest";
import { observeChangedPaths, readRegisteredBaseRevision, runRequiredTests } from "./observe";
import { persistIntegration, persistManifest, persistResultAdmission } from "./persist";
import { runEngineeringCoding } from "./runtime";
import { getRepository } from "../../software/repository-registry/contract";
import type {
  EngineeringCompletionResult,
  EngineeringLineage,
  EngineeringResultAdmission,
  EngineeringRunResult,
  ProposedScopedWrite,
} from "./types";

function blocked(
  coding: EngineeringRunResult,
  admission: EngineeringResultAdmission,
  extra: Partial<EngineeringCompletionResult> = {},
): EngineeringCompletionResult {
  return {
    status: "BLOCKED",
    reason_code: admission.reason_code,
    detail: admission.detail,
    coding,
    manifest: extra.manifest ?? null,
    result_admission: admission,
    integration: extra.integration ?? null,
    lineage: extra.lineage ?? coding.lineage,
  };
}

function record(taskId: string, note: string, payload: unknown): string {
  const evidenceId = `ev-eng-complete-${randomUUID()}`;
  saveEvidence({
    evidence_id: evidenceId,
    task_id: taskId,
    kind: "execution_output",
    source: "control/engineering-runtime/complete.ts",
    recorded_at: new Date().toISOString(),
    payload: { note, ...((typeof payload === "object" && payload !== null) ? payload as Record<string, unknown> : { payload }) },
  });
  return evidenceId;
}

export async function finalizeEngineeringWork(input: {
  readonly coding: EngineeringRunResult;
  readonly checkout_root: string;
  readonly claimed_manifest?: unknown;
}): Promise<EngineeringCompletionResult> {
  const coding = input.coding;
  const taskId = `task-${coding.admission.command_id}-engineering-complete`;
  if (!coding.write_applied || !coding.lineage.worktree_path || !coding.lineage.base_commit_sha || !coding.lineage.reservation_id) {
    return blocked(coding, { decision: "DENY", reason_code: coding.write_applied ? "CODING_INCOMPLETE" : coding.reason_code, detail: coding.detail, manifest_id: null });
  }

  const observed = observeChangedPaths(coding.lineage.worktree_path, coding.lineage.base_commit_sha);
  const tests = runRequiredTests({
    required_tests: coding.admission.required_tests,
    worktree_path: coding.lineage.worktree_path,
    changed_paths: observed,
  });
  const observeEv = record(taskId, "observed_diff", { observed, tests });
  const built = buildEngineeringManifest({
    admission: coding.admission,
    lineage: coding.lineage,
    changed_paths: observed,
    tests,
    evidence_refs: [observeEv],
  });
  if ("ok" in built) {
    return blocked(coding, { decision: "DENY", reason_code: built.reason_code, detail: built.detail, manifest_id: null });
  }
  const derived = built;
  persistManifest(derived);
  const manifestEv = record(taskId, "engineering_result_manifest", { manifest: derived });

  const repository = coding.admission.repository_id ? getRepository(coding.admission.repository_id) : null;
  const registeredHead = coding.admission.repository_root && repository
    ? readRegisteredBaseRevision(coding.admission.repository_root, repository.default_branch)
    : null;
  const resultAdmission = admitEngineeringResult({
    admission: coding.admission,
    derived,
    claimed: input.claimed_manifest,
    observed_paths: observed,
    checkout_root: input.checkout_root,
    registered_head: registeredHead,
  });
  persistResultAdmission({ ...resultAdmission, command_id: coding.admission.command_id, work_id: coding.admission.work_id });
  record(taskId, "result_admission", { result_admission: resultAdmission });

  const lineage: EngineeringLineage = {
    ...coding.lineage,
    changed_path: derived.changed_paths[0] ?? coding.lineage.changed_path,
    manifest_id: derived.manifest_id,
    admission_decision: resultAdmission.decision,
    integration_status: null,
  };

  if (resultAdmission.decision !== "ALLOW") {
    return blocked(coding, resultAdmission, { manifest: derived, lineage: { ...lineage, admission_decision: "DENY" } });
  }

  const integration = integrateAdmittedEngineering({
    admission: coding.admission,
    manifest: derived,
    checkout_root: input.checkout_root,
  });
  persistIntegration({ ...integration, command_id: coding.admission.command_id, work_id: coding.admission.work_id, manifest_id: derived.manifest_id });
  record(taskId, "integration", { integration, evidence_ref: manifestEv });

  const integratedLineage: EngineeringLineage = {
    ...lineage,
    integration_status: integration.integrated ? "INTEGRATED" : integration.reason_code,
  };

  if (!integration.integrated) {
    return {
      status: "BLOCKED",
      reason_code: integration.reason_code,
      detail: integration.detail,
      coding,
      manifest: derived,
      result_admission: resultAdmission,
      integration,
      lineage: integratedLineage,
    };
  }

  return {
    status: "VERIFIED",
    reason_code: "ADMITTED",
    detail: `engineering completion VERIFIED; integrated=${integration.integrated_paths.join(",")}`,
    coding,
    manifest: derived,
    result_admission: resultAdmission,
    integration,
    lineage: integratedLineage,
  };
}

export async function completeEngineeringWork(input: {
  readonly command_id: string;
  readonly work_id?: string;
  readonly intent_text: string;
  readonly payload: unknown;
  readonly checkout_root: string;
  readonly selected_capability_id?: string | null;
  readonly proposed_write_path?: string;
  readonly proposed_content?: string;
  readonly proposed_writes?: readonly ProposedScopedWrite[];
  readonly claimed_manifest?: unknown;
}): Promise<EngineeringCompletionResult> {
  const coding = await runEngineeringCoding({
    command_id: input.command_id,
    work_id: input.work_id,
    intent_text: input.intent_text,
    payload: input.payload,
    checkout_root: input.checkout_root,
    selected_capability_id: input.selected_capability_id,
    proposed_write_path: input.proposed_write_path,
    proposed_content: input.proposed_content,
    proposed_writes: input.proposed_writes,
  });
  return finalizeEngineeringWork({
    coding,
    checkout_root: input.checkout_root,
    claimed_manifest: input.claimed_manifest,
  });
}
