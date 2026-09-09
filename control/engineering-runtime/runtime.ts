/**
 * หน้าที่: ENGINEERING coding run — admit, isolate worktree, dispatch
 * LOCAL coding worker, apply only in-scope worktree writes. Does not
 * call continueRegisteredArtifact, commit, push, or PR.
 *
 * Input: command_id + payload + checkout root.
 * Output: EngineeringRunResult with lineage evidence.
 * Dependency ที่อนุญาต: ./gate.ts, ./apply-write.ts, ./types.ts,
 * ../agent-production-ingress/contract.ts, ../source-workspace/contract.ts,
 * ../agent-gateway/contract.ts, ../agent-host/contract.ts,
 * ../../software/registry-database/adapters/persistent-file-store.ts,
 * ../../software/repository-registry/contract.ts.
 * สิ่งที่ห้ามแตะ: never use repository_root as allowed_write_paths.
 * never launch a worker before admission.
 */

import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createPersistentFileStore } from "../../software/registry-database/adapters/persistent-file-store";
import { getRepository } from "../../software/repository-registry/contract";
import { submitAgentWork } from "../agent-production-ingress/contract";
import {
  createTaskWorkspace,
  linkSourceReservation,
  loadEvidenceForTask,
  runAgentWorkOrder,
  saveEvidence,
  transitionWorkspace,
} from "../agent-gateway/contract";
import type { WorkOrder } from "../agent-gateway/contract";
import { resolveWorker } from "../agent-host/contract";
import { applyScopedWorktreeWrite, evaluateScopedWrite } from "./apply-write";
import { admitEngineeringCoding } from "./gate";
import type { EngineeringAdmission, EngineeringLineage, EngineeringRunResult } from "./types";

function lineageOf(admission: EngineeringAdmission, extra: Partial<EngineeringLineage> = {}): EngineeringLineage {
  return {
    command_id: admission.command_id,
    work_id: admission.work_id,
    reservation_id: extra.reservation_id ?? null,
    branch_ref: extra.branch_ref ?? null,
    worktree_path: extra.worktree_path ?? null,
    base_commit_sha: extra.base_commit_sha ?? null,
    repository_id: admission.repository_id,
    changed_path: extra.changed_path ?? null,
  };
}

function sandboxTests(required: readonly string[]): readonly ("sandbox.write" | "sandbox.readback")[] {
  const tests: ("sandbox.write" | "sandbox.readback")[] = [];
  if (required.includes("sandbox.write")) tests.push("sandbox.write");
  if (required.includes("sandbox.readback")) tests.push("sandbox.readback");
  if (tests.length === 0) return ["sandbox.write", "sandbox.readback"];
  return tests;
}

function recordLineage(taskId: string, lineage: EngineeringLineage, note: string): void {
  saveEvidence({
    evidence_id: `ev-eng-${randomUUID()}`,
    task_id: taskId,
    correlation_id: lineage.command_id,
    work_order_id: lineage.work_id,
    kind: "execution_output",
    source: "control/engineering-runtime/runtime.ts#lineage",
    recorded_at: new Date().toISOString(),
    payload: { note, lineage },
  });
}

export async function runEngineeringCoding(input: {
  readonly command_id: string;
  readonly work_id?: string;
  readonly intent_text: string;
  readonly payload: unknown;
  readonly checkout_root: string;
  readonly selected_capability_id?: string | null;
  readonly proposed_write_path?: string;
  readonly proposed_content?: string;
  readonly proposed_writes?: readonly { readonly relative_path: string; readonly content: string }[];
}): Promise<EngineeringRunResult> {
  const workId = typeof input.work_id === "string" && input.work_id.startsWith("work-")
    ? input.work_id
    : `work-${randomUUID()}`;
  const admission = admitEngineeringCoding({
    command_id: input.command_id,
    work_id: workId,
    checkout_root: input.checkout_root,
    payload: input.payload,
    selected_capability_id: input.selected_capability_id,
  });
  if (!admission.admitted || !admission.repository_id || !admission.repository_root) {
    return {
      status: "BLOCKED",
      reason_code: admission.reason_code,
      detail: admission.detail,
      admission,
      lineage: lineageOf(admission),
      write_applied: false,
      rejected_write: null,
    };
  }

  const repository = getRepository(admission.repository_id);
  if (!repository || repository.status !== "ACTIVE") {
    return {
      status: "BLOCKED",
      reason_code: "REPOSITORY_IDENTITY_MISSING",
      detail: "admitted repository_id is not an ACTIVE registry row",
      admission,
      lineage: lineageOf(admission),
      write_applied: false,
      rejected_write: null,
    };
  }

  const workspace = createTaskWorkspace({
    work_order_id: workId,
    command_id: input.command_id,
    assigned_source: [admission.repository_root],
    workspace_root: "/tmp/dna-os-engineering-workspaces",
  });
  transitionWorkspace(workspace.workspace_id, "PREPARE_CONTEXT", "engineering-runtime: admitted coding scope");

  const ingress = await submitAgentWork({
    work_id: workId,
    holder_agent_id: "control/engineering-runtime/runtime.ts",
    requested_owner: repository.owner,
    requested_repository: repository.repository,
    candidate: {
      candidate_id: `engineering-coding-${input.command_id}`,
      name: `engineering-coding-${input.command_id}`,
      kind: "resource",
      source_location: admission.allowed_paths[0]!,
      owner: "control/engineering-runtime",
      input: [],
      output: [],
      side_effects: [],
      dependencies: [],
      behavior: input.intent_text,
      version: "1.0.0",
      evidence_refs: [`command:${input.command_id}`, `work_order:${workId}`],
      domain: "ENGINEERING_EVIDENCE",
      resource_type: "EXECUTION_EVIDENCE",
      data_classification: "INTERNAL",
      source_system: "dna-os-infrastructure",
      scope: "engineering-coding",
      requested_owner: repository.owner,
      requested_repository: repository.repository,
    },
    resource_scope: admission.allowed_paths,
    lease_ms: 120_000,
    correlation_id: input.command_id,
    isolation_checkout_root: admission.repository_root,
  }, () => createPersistentFileStore());

  if (!ingress.workspace) {
    return {
      status: "BLOCKED",
      reason_code: "ISOLATION_FAILED",
      detail: `source isolation failed: ${ingress.final_stage}:${ingress.final_status} ${ingress.reason}`,
      admission,
      lineage: lineageOf(admission, { repository_id: admission.repository_id }),
      write_applied: false,
      rejected_write: null,
    };
  }

  const link = linkSourceReservation(workspace.workspace_id, ingress.workspace.reservation_id, workId);
  const worktree = ingress.workspace.worktree_path;
  const codingWritePaths = admission.allowed_paths.map((rel) => join(worktree, rel));
  const forbiddenAbs = admission.forbidden_paths.map((rel) => join(worktree, rel));
  const targetRel = admission.allowed_paths[0]!;
  const targetAbs = join(worktree, targetRel);
  const defaultContent = input.proposed_content ?? `engineering-gate ${input.command_id}\n`;
  const writes = input.proposed_writes && input.proposed_writes.length > 0
    ? input.proposed_writes.map((row) => ({
      abs: row.relative_path.startsWith("/") || /^[a-zA-Z]:/.test(row.relative_path) ? row.relative_path : join(worktree, row.relative_path),
      content: row.content,
    }))
    : [{
      abs: input.proposed_write_path
        ? (input.proposed_write_path.startsWith("/") || /^[a-zA-Z]:/.test(input.proposed_write_path)
          ? input.proposed_write_path
          : join(worktree, input.proposed_write_path))
        : targetAbs,
      content: defaultContent,
    }];
  const proposed = writes[0]!.abs;
  const localWorker = resolveWorker("LOCAL");
  const instruction = localWorker.ok
    ? JSON.stringify({
      action: "request_authorized_write",
      target_path: proposed,
      content: writes[0]!.content,
    })
    : input.intent_text;

  const workOrder: WorkOrder = {
    operation: "MODIFY",
    target_type: "FILE",
    target_path: targetRel,
    requested_change: input.intent_text,
    content: writes[0]!.content,
    workspace_scope: worktree,
    mode: "sandbox",
    required_tests: sandboxTests(admission.required_tests),
    forbidden_files: forbiddenAbs,
    work_order_id: workId,
    evidence: [
      { source: "control/engineering-runtime/runtime.ts", note: admission.detail },
      { source: "command_id", note: input.command_id },
      { source: "work_id", note: workId },
      { source: "reservation_id", note: ingress.workspace.reservation_id },
    ],
    agent_run: {
      worker_kind: "LOCAL",
      instruction,
      workspace_id: workspace.workspace_id,
      assigned_source_paths: workspace.allowed_read_paths,
      dependency_read_paths: workspace.dependency_paths,
      workspace_path: worktree,
      timeout_ms: 60_000,
      expected_result_contract: "DNA_OS_AGENT_RESULT_V1",
      coding_write_paths: codingWritePaths,
    },
  };

  const workerResult = await runAgentWorkOrder(workOrder, { kind: "DIRECT", correlation_id: input.command_id, work_id: workId }, process.env);
  const appliedRels: string[] = [];
  for (const write of writes) {
    const decision = evaluateScopedWrite({
      admission,
      worktree_path: worktree,
      proposed_path: write.abs,
    });
    if (!decision.allowed) {
      recordLineage(workerResult.task_id, lineageOf(admission, {
        reservation_id: ingress.workspace.reservation_id,
        branch_ref: ingress.workspace.branch_ref,
        worktree_path: worktree,
        base_commit_sha: ingress.workspace.base_commit_sha,
      }), `write_rejected=${decision.reason_code}`);
      return {
        status: "BLOCKED",
        reason_code: decision.reason_code,
        detail: decision.detail,
        admission,
        lineage: lineageOf(admission, {
          reservation_id: ingress.workspace.reservation_id,
          branch_ref: ingress.workspace.branch_ref,
          worktree_path: worktree,
          base_commit_sha: ingress.workspace.base_commit_sha,
        }),
        write_applied: appliedRels.length > 0,
        rejected_write: decision.relative_path ?? write.abs,
      };
    }
    const applied = applyScopedWorktreeWrite(decision, write.content);
    if (applied.written && decision.relative_path) appliedRels.push(decision.relative_path);
  }

  const lineageBase = lineageOf(admission, {
    reservation_id: ingress.workspace.reservation_id,
    branch_ref: ingress.workspace.branch_ref,
    worktree_path: worktree,
    base_commit_sha: ingress.workspace.base_commit_sha,
  });
  recordLineage(workerResult.task_id, lineageBase, `link_ok=${link.ok} worker=${workerResult.status}`);

  const lineage = { ...lineageBase, changed_path: appliedRels[0] ?? null };
  recordLineage(workerResult.task_id, lineage, appliedRels.length > 0 ? "write_applied" : "write_not_applied");

  if (appliedRels.length === 0 || workerResult.status !== "PASS") {
    return {
      status: workerResult.status === "PASS" ? "FAILED" : "BLOCKED",
      reason_code: "WORKER_FAILED",
      detail: `worker status=${workerResult.status} write=${appliedRels.length > 0} ${workerResult.summary}`,
      admission,
      lineage,
      write_applied: appliedRels.length > 0,
      rejected_write: null,
    };
  }

  const recorded = loadEvidenceForTask(workerResult.task_id);
  return {
    status: "COMPLETED",
    reason_code: "ADMITTED",
    detail: `scoped coding write applied in worktree; evidence_rows=${recorded.length}`,
    admission,
    lineage,
    write_applied: true,
    rejected_write: null,
  };
}

export { evaluateScopedWrite } from "./apply-write";
