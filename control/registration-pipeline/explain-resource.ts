/**
 * หน้าที่: UNRESOLVED HANDOFF — when Classification or Duplicate Resolution
 * genuinely cannot conclude, this file creates the one thing DNA OS is
 * allowed to do about it: a real `action=EXPLAIN_RESOURCE` Work Item for
 * an Agent. Never a guess, never a fallback classification, never a
 * capability created to paper over the gap.
 *
 * The Agent's ONLY job on this task (see ./README.md): read the
 * artifact/source this task cites, explain what it does, cite
 * evidence/references. It may NOT choose a database/table/destination,
 * may NOT write the registry directly, and may NOT set a final
 * classification — it sends its explanation back through the existing
 * DNA OS MCP (`connections/dna-os-mcp/`) as ordinary new evidence, by
 * calling `submit_registration_candidate` again with a proposed
 * resource_type/domain — the SAME deterministic Classification stage
 * (`../event-pipeline/contract.ts`'s `classifyCandidate`) is what decides
 * whether that proposal is accepted, exactly as it would for any other
 * candidate. The Agent supplies information; the system decides.
 *
 * Input: `PipelineUnresolvedResult` (the full known_facts/
 * missing_information/evidence_refs/correlation_id already computed by
 * ./pipeline.ts).
 * Output: `createExplainResourceWorkItem` -> a real, persisted `Task`
 * (`output_lane: "WORK_ITEM"`) plus one `Evidence` row
 * (`kind: "explain_resource_request"`) carrying the full structured
 * payload, both through `../agent-gateway/contract.ts`'s already-existing
 * disk-backed store — no new store, no new registry.
 * Dependency ที่อนุญาต: ../agent-gateway/contract.ts (saveTask, saveEvidence,
 * Task/Evidence types only), ./types.ts, ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ: never set a task's status to a value implying it already
 * executed anything. Never write a resource_id/capability_id into the
 * registry from here — this file only asks a question, it never answers
 * one.
 */

import { saveEvidence, saveTask } from "../agent-gateway/contract";
import type { Task } from "../agent-gateway/contract";
import { newEvidenceId, newTaskId, nowIso } from "./host-runtime";
import type { PipelineUnresolvedResult } from "./types";

export function createExplainResourceWorkItem(unresolved: Omit<PipelineUnresolvedResult, "work_item_task_id">): Task {
  const taskId = newTaskId();
  const now = nowIso();
  const task: Task = {
    task_id: taskId,
    memory: { user_id: "dna-os-system", workspace_id: "registration-pipeline", conversation_id: `conv-${taskId}`, parent_task_id: null, task_id: taskId, created_at: now },
    intent_text: `EXPLAIN_RESOURCE: candidate=${unresolved.candidate_id} reason_code=${unresolved.reason_code} — read the cited source_location/evidence_refs, explain what this resource is, then resubmit via submit_registration_candidate with a proposed resource_type/domain and your evidence. You decide nothing — the deterministic Classification stage does.`,
    submitted_by_client: "control/registration-pipeline",
    status: "EXECUTING",
    created_at: now,
    updated_at: now,
    output_lane: "WORK_ITEM",
  };
  saveTask(task);

  saveEvidence({
    evidence_id: newEvidenceId(),
    task_id: taskId,
    kind: "explain_resource_request",
    source: "control/registration-pipeline/explain-resource.ts",
    recorded_at: now,
    payload: { action: "EXPLAIN_RESOURCE", ...unresolved },
  });

  return task;
}
