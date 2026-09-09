/**
 * OWNER_RESPONSE_PROJECTION_V1 — the Owner screen renders only this
 * object. Parser snapshots, SSE stage labels, and human formatting cannot
 * replace a later verified fact resolution.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SemanticFinalityV1 } from "./semantic-finality";
import type { ConversationResult } from "./protocol";

export const OWNER_RESPONSE_PROJECTION = "OWNER_RESPONSE_PROJECTION_V1" as const;

export type SubjectState = "UNRESOLVED" | "RESOLVED";
export type FactState = "UNKNOWN" | "MISSING" | "VERIFIED";
export type AuthorityState = "NOT_REQUIRED" | "REQUIRED_MISSING" | "AUTHORIZED";
export type ExecutionState = "NOT_STARTED";
export type AnswerState =
  | "SEMANTIC_UNRESOLVED"
  | "FACT_NOT_AVAILABLE"
  | "ANSWERABLE_READ_ONLY"
  | "ACTION_REQUIRES_AUTHORITY"
  | "ACTION_BLOCKED"
  | "COMPLETED";

export type CurrentBlockReason =
  | "SEMANTIC_UNRESOLVED"
  | "FACT_NOT_AVAILABLE"
  | "REQUIRED_AUTHORITY_MISSING"
  | "POLICY_BLOCKED";

export interface OwnerResponseState {
  readonly schema: typeof OWNER_RESPONSE_PROJECTION;
  readonly request_id: string;
  readonly subject_state: SubjectState;
  readonly fact_state: FactState;
  readonly authority_state: AuthorityState;
  readonly execution_state: ExecutionState;
  readonly answer_state: AnswerState;
  readonly structured_answer: { readonly non_empty: boolean; readonly text: string | null; readonly facts: Record<string, unknown> };
  readonly evidence_refs: readonly string[];
  readonly block_reason: CurrentBlockReason | null;
  readonly response_version: number;
  readonly resolved_at: string;
  readonly facts_version: number;
  readonly presentation_version: number;
  readonly execution_requested: boolean;
  readonly facts_verified: boolean;
  readonly execution_started: false;
}

export interface OwnerScreenProjection {
  readonly schema: "OWNER_SCREEN_PROJECTION_V1";
  readonly request_id: string;
  readonly response_version: number;
  readonly resolved_at: string;
  readonly facts_version: number;
  readonly presentation_version: number;
  readonly answer_state: AnswerState;
  readonly fact_state: FactState;
  readonly visible_text: string;
  readonly localized_labels: Readonly<Record<string, string>>;
  readonly layout: "SUMMARY" | "DETAIL";
  readonly block_reason: CurrentBlockReason | null;
  readonly PRESENTATION_CAN_CHANGE_SEMANTIC_STATE: false;
}

export interface McpOwnerFactResult {
  readonly answer_state: AnswerState;
  readonly execution_started: false;
  readonly facts_verified: boolean;
  readonly answer: { readonly non_empty: boolean; readonly text: string | null; readonly facts: Record<string, unknown> };
  readonly evidence_refs: readonly string[];
  readonly isError: false;
}

const CURRENT_BLOCK = new Set<string>([
  "SEMANTIC_UNRESOLVED",
  "FACT_NOT_AVAILABLE",
  "REQUIRED_AUTHORITY_MISSING",
  "POLICY_BLOCKED",
]);

const store = new Map<string, OwnerResponseState>();
let latestRequestId: string | null = null;

function storePath(): string {
  return process.env.OWNER_RESPONSE_STORE
    ?? join(process.cwd(), "control/conversation-runtime/data/owner-response-store.json");
}

function hydrateFromDisk(): void {
  if (store.size > 0 || latestRequestId) return;
  const path = storePath();
  if (!existsSync(path)) return;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { latest_request_id?: string; by_id?: Record<string, OwnerResponseState> };
    if (raw.by_id) {
      for (const [id, row] of Object.entries(raw.by_id)) store.set(id, row);
    }
    latestRequestId = raw.latest_request_id ?? latestRequestId;
  } catch {
    /* unreadable store is treated as empty */
  }
}

function persistToDisk(): void {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  const by_id: Record<string, OwnerResponseState> = {};
  for (const [id, row] of store.entries()) by_id[id] = row;
  writeFileSync(path, `${JSON.stringify({ schema: OWNER_RESPONSE_PROJECTION, latest_request_id: latestRequestId, by_id }, null, 2)}\n`);
}

export function resetOwnerResponseStore(): void {
  store.clear();
  latestRequestId = null;
  const path = storePath();
  if (existsSync(path)) unlinkSync(path);
}

export function peekOwnerResponse(request_id: string): OwnerResponseState | null {
  hydrateFromDisk();
  return store.get(request_id) ?? null;
}

export function latestOwnerResponse(): OwnerResponseState | null {
  hydrateFromDisk();
  if (!latestRequestId) return null;
  return store.get(latestRequestId) ?? null;
}

export function structuredAnswerFromText(text: string | null, facts: Record<string, unknown> = {}): OwnerResponseState["structured_answer"] {
  const trimmed = typeof text === "string" ? text.trim() : "";
  const blockedCopy = trimmed.startsWith("ยังตีความข้อความนี้ไม่ได้") || trimmed.startsWith("ไม่สามารถตีความ") || trimmed.startsWith("ไม่ทราบ");
  const non_empty = trimmed.length > 0 && !blockedCopy;
  return { non_empty, text: trimmed.length > 0 ? text : null, facts };
}

export function ownerAnswerReadyAnswerState(input: {
  readonly assembly_completed: boolean;
  readonly structured_answer: OwnerResponseState["structured_answer"];
  readonly fact_state: FactState;
  readonly proposed: AnswerState;
}): AnswerState {
  if (input.assembly_completed && input.structured_answer.non_empty && input.fact_state === "VERIFIED") {
    if (input.proposed === "SEMANTIC_UNRESOLVED") return "ANSWERABLE_READ_ONLY";
  }
  return input.proposed;
}

export function buildOwnerResponseState(input: {
  readonly request_id: string;
  readonly finality: SemanticFinalityV1;
  readonly evidence_refs: readonly string[];
  readonly response_version: number;
  readonly facts_version: number;
  readonly presentation_version: number;
  readonly resolved_at?: string;
  readonly execution_requested?: boolean;
  readonly facts?: Record<string, unknown>;
}): OwnerResponseState {
  const execution_requested = input.execution_requested === true;
  const structured_answer = structuredAnswerFromText(input.finality.answer, input.facts ?? {});
  const subject_state: SubjectState = input.finality.resolution_phase === "UNRESOLVED" && input.finality.FINAL_SEMANTIC_STATE === "SEMANTIC_UNRESOLVED"
    ? "UNRESOLVED"
    : "RESOLVED";
  const fact_state: FactState = input.finality.FINAL_SEMANTIC_STATE === "ANSWERABLE_READ_ONLY" || (structured_answer.non_empty && input.finality.FINAL_SEMANTIC_STATE !== "FACT_NOT_AVAILABLE")
    ? "VERIFIED"
    : input.finality.FINAL_SEMANTIC_STATE === "FACT_NOT_AVAILABLE"
      ? "MISSING"
      : "UNKNOWN";
  const authority_state: AuthorityState = input.finality.FINAL_SEMANTIC_STATE === "ACTION_BLOCKED" || input.finality.FINAL_SEMANTIC_STATE === "ACTION_REQUIRES_AUTHORITY"
    ? "REQUIRED_MISSING"
    : "NOT_REQUIRED";

  let answer_state: AnswerState = input.finality.FINAL_SEMANTIC_STATE;
  let block_reason: CurrentBlockReason | null = null;

  if (subject_state === "RESOLVED" && fact_state === "VERIFIED" && structured_answer.non_empty && !execution_requested) {
    answer_state = "ANSWERABLE_READ_ONLY";
    block_reason = null;
  } else if (answer_state === "FACT_NOT_AVAILABLE") {
    block_reason = "FACT_NOT_AVAILABLE";
  } else if (answer_state === "ACTION_REQUIRES_AUTHORITY" || answer_state === "ACTION_BLOCKED") {
    block_reason = "REQUIRED_AUTHORITY_MISSING";
  } else if (answer_state === "SEMANTIC_UNRESOLVED") {
    block_reason = "SEMANTIC_UNRESOLVED";
  }

  answer_state = ownerAnswerReadyAnswerState({
    assembly_completed: structured_answer.non_empty,
    structured_answer,
    fact_state,
    proposed: answer_state,
  });
  if (answer_state === "ANSWERABLE_READ_ONLY") block_reason = null;

  return {
    schema: OWNER_RESPONSE_PROJECTION,
    request_id: input.request_id,
    subject_state,
    fact_state: answer_state === "ANSWERABLE_READ_ONLY" ? "VERIFIED" : fact_state,
    authority_state,
    execution_state: "NOT_STARTED",
    answer_state,
    structured_answer,
    evidence_refs: input.evidence_refs,
    block_reason,
    response_version: input.response_version,
    resolved_at: input.resolved_at ?? new Date().toISOString(),
    facts_version: input.facts_version,
    presentation_version: input.presentation_version,
    execution_requested,
    facts_verified: answer_state === "ANSWERABLE_READ_ONLY" || fact_state === "VERIFIED",
    execution_started: false,
  };
}

export function isStaleOwnerResponse(incoming: OwnerResponseState, current: OwnerResponseState): boolean {
  if (incoming.request_id !== current.request_id) return false;
  if (incoming.response_version < current.response_version) return true;
  if (incoming.response_version === current.response_version && incoming.facts_version < current.facts_version) return true;
  if (
    incoming.response_version === current.response_version
    && incoming.facts_version === current.facts_version
    && incoming.presentation_version < current.presentation_version
  ) return true;
  return false;
}

export function currentBlockMayOverride(state: OwnerResponseState): boolean {
  if (state.block_reason === null) return false;
  if (!CURRENT_BLOCK.has(state.block_reason)) return false;
  if (state.answer_state === "ANSWERABLE_READ_ONLY" && state.structured_answer.non_empty && state.fact_state === "VERIFIED") {
    return false;
  }
  return true;
}

export function commitOwnerResponse(incoming: OwnerResponseState): {
  readonly accepted: OwnerResponseState;
  readonly discarded: OwnerResponseState | null;
  readonly STALE_RESPONSE_OVERRIDE: false;
} {
  hydrateFromDisk();
  const current = store.get(incoming.request_id);
  if (current && isStaleOwnerResponse(incoming, current)) {
    return { accepted: current, discarded: incoming, STALE_RESPONSE_OVERRIDE: false };
  }
  store.set(incoming.request_id, incoming);
  latestRequestId = incoming.request_id;
  persistToDisk();
  return { accepted: incoming, discarded: null, STALE_RESPONSE_OVERRIDE: false };
}

export function presentOwnerResponse(state: OwnerResponseState, locale: "th" | "en" = "th"): OwnerScreenProjection {
  const labels = locale === "th"
    ? { answerable: "ตอบได้จากข้อเท็จจริงที่ยืนยันแล้ว", blocked: "ยังตอบไม่ได้", missing: "ยังไม่มีข้อเท็จจริง" }
    : { answerable: "Answerable from verified facts", blocked: "Not answerable", missing: "Fact not available" };
  const visible_text = state.structured_answer.non_empty
    ? (state.structured_answer.text ?? "")
    : (state.block_reason === "FACT_NOT_AVAILABLE" ? labels.missing : labels.blocked);
  return {
    schema: "OWNER_SCREEN_PROJECTION_V1",
    request_id: state.request_id,
    response_version: state.response_version,
    resolved_at: state.resolved_at,
    facts_version: state.facts_version,
    presentation_version: state.presentation_version,
    answer_state: state.answer_state,
    fact_state: state.fact_state,
    visible_text,
    localized_labels: labels,
    layout: "SUMMARY",
    block_reason: state.block_reason,
    PRESENTATION_CAN_CHANGE_SEMANTIC_STATE: false,
  };
}

export function mcpOwnerFactResult(state: OwnerResponseState): McpOwnerFactResult {
  return {
    answer_state: state.answer_state,
    execution_started: false,
    facts_verified: state.facts_verified,
    answer: state.structured_answer,
    evidence_refs: state.evidence_refs,
    isError: false,
  };
}

export function ownerWorkSurfaceResponseSlice(): {
  readonly schema: typeof OWNER_RESPONSE_PROJECTION;
  readonly owner_response_state: OwnerResponseState | null;
  readonly owner_screen: OwnerScreenProjection | null;
  readonly mcp_fact_result: McpOwnerFactResult | null;
  readonly render_from: "owner_response_state";
} {
  const state = latestOwnerResponse();
  return {
    schema: OWNER_RESPONSE_PROJECTION,
    owner_response_state: state,
    owner_screen: state ? presentOwnerResponse(state) : null,
    mcp_fact_result: state ? mcpOwnerFactResult(state) : null,
    render_from: "owner_response_state",
  };
}

export function composeFromConversation(result: ConversationResult, finality: SemanticFinalityV1): OwnerResponseState {
  const previous = peekOwnerResponse(result.request_id);
  const built = buildOwnerResponseState({
    request_id: result.request_id,
    finality,
    evidence_refs: result.evidence_refs,
    response_version: (previous?.response_version ?? 0) + 1,
    facts_version: (previous?.facts_version ?? 0) + (finality.FINAL_SEMANTIC_STATE === "ANSWERABLE_READ_ONLY" ? 1 : 0),
    presentation_version: (previous?.presentation_version ?? 0) + 1,
    execution_requested: false,
    facts: { intent: result.intent?.intent ?? null, conversation_status: finality.conversation_status },
  });
  return commitOwnerResponse(built).accepted;
}

export function illegalAnswerReadyBlocked(events: readonly { readonly stage?: string; readonly status?: string; readonly decision?: string | null }[], state: OwnerResponseState): boolean {
  const assembled = events.some((row) => row.stage === "ANSWER_ASSEMBLY_COMPLETED" && row.status === "COMPLETED");
  const ready = events.find((row) => row.stage === "OWNER_ANSWER_READY");
  if (!assembled || !ready) return false;
  if (state.structured_answer.non_empty && state.fact_state === "VERIFIED") {
    return ready.decision === "SEMANTIC_UNRESOLVED" || ready.decision === "BLOCKED" || state.answer_state === "SEMANTIC_UNRESOLVED";
  }
  return false;
}
