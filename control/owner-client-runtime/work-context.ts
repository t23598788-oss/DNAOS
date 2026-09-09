/**
 * WORK_CONTEXT_V1 — cross-client continuity without transcripts.
 */

import { createAiHandoff } from "../ai-client-bridge/contract";
import { emitLocalResourceEvent } from "../local-resource-access/contract";
import { listPersistedWork, persistWork } from "./persist";
import type { WorkContextV1 } from "./types";

export function listWorkContexts(): readonly WorkContextV1[] {
  return listPersistedWork<WorkContextV1>();
}

export function getWorkContext(work_id: string): WorkContextV1 | null {
  const rows = listWorkContexts().filter((row) => row.work_id === work_id);
  return rows[rows.length - 1] ?? null;
}

export function upsertWorkContext(row: WorkContextV1): WorkContextV1 {
  persistWork(row);
  emitLocalResourceEvent("WORK_CONTEXT_CREATED", row.work_id, row.goal, undefined, { locality: "LOCAL", action: row.canonical_actions[0] });
  return row;
}

export function handoffWorkContext(input: {
  readonly work_id: string;
  readonly from_client_id: string;
  readonly to_client_id: string;
}): WorkContextV1 | { ok: false; reason_code: string } {
  const ctx = getWorkContext(input.work_id);
  if (!ctx) return { ok: false, reason_code: "UNKNOWN_WORK_CONTEXT" };
  const handed = createAiHandoff({
    from_client_id: input.from_client_id,
    to_client_id: input.to_client_id,
    work_id: input.work_id,
    goal: ctx.goal,
    canonical_action: ctx.canonical_actions[0] ?? "SEARCH",
    resource_refs: ctx.resource_handles,
    current_state: ctx.open_steps[0] ?? "CONTINUE",
    structured_evidence_refs: ctx.evidence_refs,
    approved_working_context: ctx.approved_ai_context,
  });
  if ("ok" in handed && handed.ok === false) return handed;
  emitLocalResourceEvent("WORK_CONTEXT_HANDOFF", input.work_id, `${input.from_client_id}->${input.to_client_id}`, undefined, {
    locality: "LOCAL", action: "HANDOFF",
  });
  return ctx;
}
