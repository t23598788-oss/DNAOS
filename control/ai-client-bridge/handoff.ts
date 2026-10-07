/**
 * AI_HANDOFF_V1 — move work between AI clients without copying transcripts.
 */

import { randomUUID } from "node:crypto";
import { emitLocalResourceEvent } from "../local-resource-access/contract";
import { nowIso, utf8Bytes } from "./host-runtime";
import { listPersistedHandoffs, persistHandoff } from "./persist";
import type { AiHandoffV1 } from "./types";

export function listAiHandoffs(): readonly AiHandoffV1[] {
  return listPersistedHandoffs<AiHandoffV1>();
}

export function createAiHandoff(input: {
  readonly from_client_id: string;
  readonly to_client_id: string;
  readonly work_id: string;
  readonly goal: string;
  readonly canonical_action: string;
  readonly resource_refs: readonly string[];
  readonly current_state: string;
  readonly structured_evidence_refs: readonly string[];
  readonly open_questions?: readonly string[];
  readonly approved_working_context: Record<string, unknown>;
  readonly transcript?: unknown;
}): AiHandoffV1 | { ok: false; reason_code: string } {
  if (input.transcript !== undefined) {
    return { ok: false, reason_code: "FULL_TRANSCRIPT_COPY_FORBIDDEN" };
  }
  const context = { ...input.approved_working_context };
  delete (context as { transcript?: unknown }).transcript;
  delete (context as { messages?: unknown }).messages;
  delete (context as { chat?: unknown }).chat;
  const handoff: AiHandoffV1 = {
    schema: "AI_HANDOFF_V1",
    handoff_id: `handoff-${randomUUID()}`,
    from_client_id: input.from_client_id,
    to_client_id: input.to_client_id,
    work_id: input.work_id,
    goal: input.goal,
    canonical_action: input.canonical_action,
    resource_refs: input.resource_refs,
    current_state: input.current_state,
    structured_evidence_refs: input.structured_evidence_refs,
    open_questions: input.open_questions ?? [],
    approved_working_context: context,
    byte_count: 0,
    transcript_included: false,
    created_at: nowIso(),
  };
  const stored: AiHandoffV1 = { ...handoff, byte_count: utf8Bytes(handoff) };
  persistHandoff(stored);
  emitLocalResourceEvent("AI_HANDOFF_CREATED", input.work_id, `${input.from_client_id}->${input.to_client_id}`, stored.handoff_id, {
    bytes: stored.byte_count, locality: "LOCAL", action: "HANDOFF",
  });
  return stored;
}
