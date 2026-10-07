/**
 * SEMANTIC_RESOLUTION_FINALITY_V1 — the latest verified fact-resolution
 * state wins. An earlier parser ambiguity flag cannot overwrite it.
 *
 * The object that previously supplied the Owner-facing blocked reply was
 * `transport/owner-command-http/server.ts` using
 * `(result.semantic_outcome as {ok?: boolean})?.ok === true` to choose
 * TRANSLATION_BLOCKED ("ใช้คำตอบ blocked ตาม semantic result") even after
 * SUBJECT_RESOLVED → FACTS_READ → ANSWER_ASSEMBLY_COMPLETED.
 */

export const SEMANTIC_RESOLUTION_FINALITY = "SEMANTIC_RESOLUTION_FINALITY_V1" as const;

export const FINAL_SEMANTIC_STATES = [
  "SEMANTIC_UNRESOLVED",
  "FACT_NOT_AVAILABLE",
  "ANSWERABLE_READ_ONLY",
  "ACTION_REQUIRES_AUTHORITY",
  "ACTION_BLOCKED",
  "COMPLETED",
] as const;

export type FinalSemanticState = typeof FINAL_SEMANTIC_STATES[number];

export const RESOLUTION_PHASES = [
  "UNRESOLVED",
  "SUBJECT_RESOLVED",
  "FACT_SOURCE_RESOLVED",
  "FACTS_READ",
  "ANSWERABLE",
] as const;

export type ResolutionPhase = typeof RESOLUTION_PHASES[number];

export interface SemanticFinalityInput {
  readonly answer: string | null;
  readonly status: "ANSWERED" | "UNRESOLVED" | "DENIED";
  readonly evidence_refs: readonly string[];
  readonly semantic_outcome: unknown;
  readonly intent: string | null;
  readonly subject_resolved?: boolean;
  readonly fact_owner_selected?: boolean;
  readonly facts_nonempty?: boolean;
  readonly assembly_succeeded?: boolean;
  readonly parser_ok?: boolean | null;
  readonly action_request?: boolean;
  readonly execution_authorized?: boolean;
  readonly contradiction?: boolean;
}

export interface SemanticFinalityV1 {
  readonly schema: typeof SEMANTIC_RESOLUTION_FINALITY;
  readonly FINAL_SEMANTIC_STATE: FinalSemanticState;
  readonly resolution_phase: ResolutionPhase;
  readonly EXECUTION_STARTED: false;
  readonly STALE_SEMANTIC_STATE_OVERRIDE: false;
  readonly READ_ONLY_LANGUAGE_BLOCKED: boolean;
  readonly blocker_prerequisite: string | null;
  readonly answer: string | null;
  readonly conversation_status: "ANSWERED" | "UNRESOLVED" | "DENIED";
}

const ACTION_INTENTS = new Set([
  "UNSUPPORTED_CAPABILITY",
]);

function semanticParserOk(outcome: unknown): boolean | null {
  if (!outcome || typeof outcome !== "object") return null;
  const ok = (outcome as { ok?: unknown }).ok;
  if (typeof ok === "boolean") return ok;
  return null;
}

function projectionNonEmpty(outcome: unknown, answer: string | null, evidence: readonly string[]): boolean {
  if (typeof answer === "string" && answer.trim().length > 0 && !answer.startsWith("ไม่ทราบ") && !answer.startsWith("ไม่สามารถตีความ")) return true;
  if (evidence.length > 0 && typeof answer === "string" && answer.trim().length > 0) return true;
  if (!outcome || typeof outcome !== "object") return false;
  const row = outcome as Record<string, unknown>;
  if (row.self_knowledge || row.ledger || row.self_explanation || row.capability_folder_law || row.causal_explanation) return true;
  return false;
}

export function applySemanticFinality(input: SemanticFinalityInput): SemanticFinalityV1 {
  const parser_ok = input.parser_ok ?? semanticParserOk(input.semantic_outcome);
  const facts = input.facts_nonempty ?? projectionNonEmpty(input.semantic_outcome, input.answer, input.evidence_refs);
  const assembly = input.assembly_succeeded ?? (typeof input.answer === "string" && input.answer.trim().length > 0);
  const subject = input.subject_resolved ?? (facts || input.status === "ANSWERED" || parser_ok === true);
  const factOwner = input.fact_owner_selected ?? facts;
  const action = input.action_request ?? (typeof input.intent === "string" && ACTION_INTENTS.has(input.intent));

  if (input.contradiction) {
    return {
      schema: SEMANTIC_RESOLUTION_FINALITY,
      FINAL_SEMANTIC_STATE: "SEMANTIC_UNRESOLVED",
      resolution_phase: "UNRESOLVED",
      EXECUTION_STARTED: false,
      STALE_SEMANTIC_STATE_OVERRIDE: false,
      READ_ONLY_LANGUAGE_BLOCKED: true,
      blocker_prerequisite: "EXPLICIT_CONTRADICTION",
      answer: input.answer,
      conversation_status: "UNRESOLVED",
    };
  }

  if (action && input.execution_authorized === false) {
    return {
      schema: SEMANTIC_RESOLUTION_FINALITY,
      FINAL_SEMANTIC_STATE: input.status === "DENIED" ? "ACTION_BLOCKED" : "ACTION_REQUIRES_AUTHORITY",
      resolution_phase: subject ? "SUBJECT_RESOLVED" : "UNRESOLVED",
      EXECUTION_STARTED: false,
      STALE_SEMANTIC_STATE_OVERRIDE: false,
      READ_ONLY_LANGUAGE_BLOCKED: false,
      blocker_prerequisite: "EXECUTION_NOT_AUTHORIZED",
      answer: input.answer,
      conversation_status: "DENIED",
    };
  }

  if (subject && factOwner && facts && assembly) {
    return {
      schema: SEMANTIC_RESOLUTION_FINALITY,
      FINAL_SEMANTIC_STATE: "ANSWERABLE_READ_ONLY",
      resolution_phase: "ANSWERABLE",
      EXECUTION_STARTED: false,
      STALE_SEMANTIC_STATE_OVERRIDE: false,
      READ_ONLY_LANGUAGE_BLOCKED: false,
      blocker_prerequisite: null,
      answer: input.answer,
      conversation_status: "ANSWERED",
    };
  }

  if (subject && (!facts || !assembly)) {
    return {
      schema: SEMANTIC_RESOLUTION_FINALITY,
      FINAL_SEMANTIC_STATE: "FACT_NOT_AVAILABLE",
      resolution_phase: factOwner ? "FACTS_READ" : "FACT_SOURCE_RESOLVED",
      EXECUTION_STARTED: false,
      STALE_SEMANTIC_STATE_OVERRIDE: false,
      READ_ONLY_LANGUAGE_BLOCKED: false,
      blocker_prerequisite: facts ? "EMPTY_ASSEMBLED_ANSWER" : "MISSING_REQUIRED_FACT",
      answer: input.answer,
      conversation_status: "UNRESOLVED",
    };
  }

  if (input.status === "DENIED") {
    return {
      schema: SEMANTIC_RESOLUTION_FINALITY,
      FINAL_SEMANTIC_STATE: "ACTION_BLOCKED",
      resolution_phase: subject ? "SUBJECT_RESOLVED" : "UNRESOLVED",
      EXECUTION_STARTED: false,
      STALE_SEMANTIC_STATE_OVERRIDE: false,
      READ_ONLY_LANGUAGE_BLOCKED: false,
      blocker_prerequisite: "EXECUTION_NOT_AUTHORIZED",
      answer: input.answer,
      conversation_status: "DENIED",
    };
  }

  return {
    schema: SEMANTIC_RESOLUTION_FINALITY,
    FINAL_SEMANTIC_STATE: "SEMANTIC_UNRESOLVED",
    resolution_phase: "UNRESOLVED",
    EXECUTION_STARTED: false,
    STALE_SEMANTIC_STATE_OVERRIDE: false,
    READ_ONLY_LANGUAGE_BLOCKED: true,
    blocker_prerequisite: parser_ok === false ? "PARSER_UNRESOLVED_WITHOUT_FACTS" : "NO_SUBJECT",
    answer: input.answer ?? "ยังตีความข้อความนี้ไม่ได้ — ไม่พบ subject หรือข้อเท็จจริงที่ยืนยันได้",
    conversation_status: "UNRESOLVED",
  };
}

export function attachFinalityToConversation(result: {
  readonly request_id: string;
  readonly trace_id: string;
  readonly answer: string | null;
  readonly intent: { readonly intent: string } | null;
  readonly status: "ANSWERED" | "UNRESOLVED" | "DENIED";
  readonly evidence_refs: readonly string[];
  readonly semantic_outcome: unknown;
}, extras: Partial<SemanticFinalityInput> = {}): SemanticFinalityV1 {
  return applySemanticFinality({
    answer: result.answer,
    status: result.status,
    evidence_refs: result.evidence_refs,
    semantic_outcome: result.semantic_outcome,
    intent: result.intent?.intent ?? null,
    ...extras,
  });
}

export function ownerAskHttpStatus(finality: SemanticFinalityV1): "TRANSLATED" | "TRANSLATION_BLOCKED" {
  if (finality.FINAL_SEMANTIC_STATE === "ANSWERABLE_READ_ONLY" || finality.FINAL_SEMANTIC_STATE === "COMPLETED") {
    return "TRANSLATED";
  }
  if (finality.FINAL_SEMANTIC_STATE === "FACT_NOT_AVAILABLE") return "TRANSLATED";
  if (finality.FINAL_SEMANTIC_STATE === "ACTION_REQUIRES_AUTHORITY" || finality.FINAL_SEMANTIC_STATE === "ACTION_BLOCKED") {
    return "TRANSLATED";
  }
  return "TRANSLATION_BLOCKED";
}
