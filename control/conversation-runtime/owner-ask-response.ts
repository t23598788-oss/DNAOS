/**
 * Owner-ask HTTP body from OWNER_RESPONSE_PROJECTION_V1.
 * The Owner screen must render `owner_response_state`, not `semantic.ok`.
 */

import { attachFinalityToConversation, ownerAskHttpStatus, type SemanticFinalityV1 } from "./semantic-finality";
import {
  composeFromConversation,
  mcpOwnerFactResult,
  presentOwnerResponse,
  type OwnerResponseState,
} from "./owner-response-projection";
import type { ConversationResult } from "./protocol";

export function finalizeConversationResult(result: ConversationResult, extras?: Parameters<typeof attachFinalityToConversation>[1]): ConversationResult {
  const finality = attachFinalityToConversation(result, extras);
  return {
    ...result,
    answer: finality.answer,
    status: finality.conversation_status,
    final_semantic_state: finality.FINAL_SEMANTIC_STATE,
    resolution_phase: finality.resolution_phase,
    execution_started: false,
    read_only_language_blocked: finality.READ_ONLY_LANGUAGE_BLOCKED,
  };
}

export function composeOwnerAskHttpBody(result: ConversationResult, layer: "READ_ONLY_LANGUAGE" | "RAW_CHAT_INTAKE"): Record<string, unknown> {
  const answer = result.answer;
  const looksLikeFacts = typeof answer === "string" && answer.trim().length > 0
    && !answer.startsWith("ไม่ทราบ")
    && !answer.startsWith("ไม่สามารถตีความ")
    && !answer.startsWith("ยังตีความข้อความนี้ไม่ได้");
  const finality: SemanticFinalityV1 = attachFinalityToConversation(result, {
    subject_resolved: result.final_semantic_state === "ANSWERABLE_READ_ONLY" || result.status === "ANSWERED" || looksLikeFacts,
    fact_owner_selected: result.status === "ANSWERED" || (result.evidence_refs?.length ?? 0) > 0 || looksLikeFacts,
    facts_nonempty: looksLikeFacts,
    assembly_succeeded: looksLikeFacts,
  });
  const owner_response_state: OwnerResponseState = composeFromConversation(result, finality);
  const owner_screen = presentOwnerResponse(owner_response_state);
  const mcp_fact_result = mcpOwnerFactResult(owner_response_state);
  const httpStatus = owner_response_state.answer_state === "SEMANTIC_UNRESOLVED" && !owner_response_state.structured_answer.non_empty
    ? "TRANSLATION_BLOCKED"
    : ownerAskHttpStatus(finality);
  const blocked = layer === "READ_ONLY_LANGUAGE"
    && httpStatus === "TRANSLATION_BLOCKED"
    && owner_response_state.answer_state === "SEMANTIC_UNRESOLVED"
    && owner_response_state.block_reason === "SEMANTIC_UNRESOLVED";
  return {
    request_id: result.request_id,
    trace_id: result.trace_id,
    schema: "OWNER_RESPONSE_PROJECTION_V1",
    render_from: "owner_response_state",
    owner_response_state,
    owner_screen,
    mcp_fact_result,
    status: httpStatus,
    layer,
    READ_ONLY_LANGUAGE_BLOCKED: blocked,
    FINAL_SEMANTIC_STATE: owner_response_state.answer_state,
    FINAL_RESPONSE_STATE: owner_response_state.answer_state,
    FACTS_VERIFIED: owner_response_state.facts_verified,
    EXECUTION_STARTED: false,
    BLOCK_REASON: owner_response_state.block_reason,
    STALE_SEMANTIC_STATE_OVERRIDE: false,
    STALE_RESPONSE_OVERRIDE: false,
    answer: owner_screen.visible_text,
    intent: result.intent,
    conversation_status: owner_response_state.answer_state === "ANSWERABLE_READ_ONLY" ? "ANSWERED" : finality.conversation_status,
    evidence_refs: owner_response_state.evidence_refs,
    parser_snapshot: result.semantic_outcome,
    semantic: result.semantic_outcome,
    semantic_finality: finality,
    execution_started: false,
    work_order_created: false,
    task_created: false,
    agent_dispatched: false,
  };
}
