/**
 * หน้าที่: let DNA OS say, in machine-readable form, which of four things a
 * piece of work is — something the core decides, something a tool must do,
 * something a language model may only rephrase, or something only the Owner may
 * decide (Owner, 2026-09-02).
 *
 * THE CONFUSION THIS EXISTS TO PREVENT. Four different failures wear the same
 * face when there is no vocabulary to separate them: the core not knowing, a
 * tool not having run, a model not having phrased it yet, and the Owner not
 * having decided. Steps 1–14 removed that confusion for one physical action.
 * This file states the same distinction for the system as a whole.
 *
 * THE RULE THAT MATTERS MOST. UNKNOWN is a knowledge state; OWNER_DECISION is
 * an authority requirement. They are not the same, and one must never become
 * the other by default. Step 14 ended with a fact nobody can currently observe,
 * and the correct routing was STOP_UNPROVEN — not "ask the Owner". Escalation
 * requires a named authority reason from a closed list, and
 * `classifyResponsibility` refuses to return OWNER_DECISION without one.
 *
 * WHAT A MODEL MAY DO HERE. Nothing. This file computes routing from typed
 * facts. A language transformer may rephrase an OwnerReport afterwards, and may
 * propose a structured candidate that deterministic code then validates — but
 * it cannot produce a responsibility, a next state, an authority, or a verdict.
 * `LANGUAGE_TRANSFORM` is a classification OF work, never a source of truth
 * about it.
 *
 * WHAT IS DELIBERATELY NOT HERE. No orchestrator, no scheduler, no second
 * brain. This is a vocabulary and three pure functions over it; every existing
 * owner keeps its own truth.
 *
 * Input: typed facts about one unit of work.
 * Output: the responsibility vocabulary, OwnerDecisionRequirement,
 *   EvidenceCeiling, ExecutionRouting, OwnerReport, classifyResponsibility,
 *   routeNextState, evidenceCeilingReached.
 * Dependency ที่อนุญาต: none — pure.
 * สิ่งที่ห้ามแตะ: ห้ามให้โมเดลกำหนดค่าใด ๆ ในไฟล์นี้, ห้ามแปลง UNKNOWN เป็น
 * OWNER_DECISION โดยไม่มีเหตุผลด้านอำนาจที่ระบุชื่อได้.
 */

/** The four kinds of thing a unit of work can be. Closed by design. */
export type ResponsibilityClass =
  /** DNA OS software can determine, route and verify this from contracts and facts. */
  | "DETERMINISTIC_CORE"
  /** A bounded tool, service or resource must perform the operation. */
  | "EXECUTION_CAPABILITY"
  /** A model may transform representation only — never truth. */
  | "LANGUAGE_TRANSFORM"
  /** A human authority, value or business decision is genuinely required. */
  | "OWNER_DECISION";

/**
 * The ONLY reasons that justify OWNER_DECISION. Each names an authority or a
 * value judgement, never an absence of knowledge. "We do not know yet" is not
 * on this list and cannot be added by a caller.
 */
export type OwnerAuthorityReason =
  | "NEW_AUTHORITY_GRANT_REQUIRED"
  | "SENSITIVE_ACTION_APPROVAL_REQUIRED"
  | "RECIPIENT_NOT_DETERMINED_BY_POLICY"
  | "BUSINESS_ALTERNATIVES_EQUALLY_LEGITIMATE"
  | "FINANCIAL_COMMITMENT_REQUIRED"
  | "INFORMATION_ONLY_OWNER_POSSESSES";

/**
 * Reasons that look like Owner questions and are not. Naming them makes the
 * mistake detectable instead of tempting; `classifyResponsibility` maps every
 * one of these to a system responsibility.
 */
export type SystemResponsibilityReason =
  | "INTERPRET_EVIDENCE"
  | "CHOOSE_TECHNICAL_ROUTE"
  | "DIAGNOSE_SOFTWARE"
  | "DECIDE_SEQUENCING"
  | "DETERMINE_EVIDENCE_SUFFICIENCY"
  | "SUMMARIZE_MACHINE_STATE";

export interface OwnerDecisionRequirement {
  why_owner_required: OwnerAuthorityReason;
  /** The decision itself, stated as a question the Owner can answer. */
  decision_required: string;
  /** The authority that only the Owner holds. */
  authority_required: string;
  /** What the Owner may choose between. Empty means the system found no options — itself a fact worth seeing. */
  available_options: readonly string[];
  evidence_references: readonly string[];
}

/** Whether every registered source for one fact has been exhausted. Not a verdict. */
export interface EvidenceCeiling {
  fact_required: string;
  current_state: "KNOWN" | "UNKNOWN" | "NOT_OBSERVED";
  last_proven_boundary: string | null;
  first_unproven_boundary: string | null;
  /** Procedures registered for this fact, and those not yet run. */
  available_procedures: readonly string[];
  remaining_procedures: readonly string[];
  /** True only when nothing registered remains to try. Says nothing about why. */
  evidence_ceiling_reached: boolean;
  /** Whether the missing fact actually prevents the required result. Often it does not. */
  blocks_required_result: boolean;
}

/** Deterministic next states. Every transition carries a finite reason. */
export type CoreNextState =
  | "CONTINUE_CORE"
  | "DISPATCH_CAPABILITY"
  | "LANGUAGE_TRANSFORM"
  | "WAIT_EXTERNAL"
  | "DIAGNOSE"
  | "REPAIR"
  | "RETRY_ALLOWED"
  | "STOP_UNPROVEN"
  | "OWNER_DECISION_REQUIRED"
  | "COMPLETE";

export type CoreNextStateReason =
  | "REQUIRED_RESULT_VERIFIED"
  | "CAPABILITY_AND_AUTHORITY_RESOLVED"
  | "REGISTERED_PROCEDURE_AVAILABLE"
  | "EVIDENCE_CEILING_REACHED_RESULT_NOT_BLOCKED"
  | "EVIDENCE_CEILING_REACHED_RESULT_BLOCKED"
  | "OWNER_AUTHORITY_REQUIRED"
  | "EXTERNAL_RESULT_PENDING"
  | "REGISTERED_REPAIR_AVAILABLE"
  | "REGISTERED_RETRY_POLICY_AVAILABLE"
  | "REPRESENTATION_REQUIRED"
  | "NO_REGISTERED_CONTINUATION";

/** An unresolved field is named, not filled in with generated text. */
export type Unresolved = "UNKNOWN" | "UNRESOLVED";

export interface ExecutionRouting {
  work_id: string;
  owner_intent_reference: string | null;
  required_result: string | Unresolved;
  scope: readonly string[];
  authority_context: string | Unresolved;
  capability_id: string | Unresolved;
  resource_id: string | Unresolved;
  execution_owner: string | Unresolved;
  operation: string | Unresolved;
  input_contract: string | Unresolved;
  expected_output_contract: string | Unresolved;
  expectation_reference: string | null;
  verification_method: string | Unresolved;
  evidence_destination: string | Unresolved;
  cost_accounting_reference: string | Unresolved;
  next_state_policy: CoreNextState | Unresolved;
}

/**
 * What the Owner is owed. Every field is derived from structured state; a
 * language transformer may render it, and may not alter it.
 */
export interface OwnerReport {
  request: string;
  current_result: string;
  verdict: "VERIFIED" | "FAILED" | "UNPROVEN" | "IN_PROGRESS";
  what_was_done: readonly string[];
  what_was_observed: readonly string[];
  what_is_known: Readonly<Record<string, string>>;
  what_is_unknown: readonly string[];
  /** Null when no cost was measured. Never an estimate. */
  cost: Readonly<Record<string, string>> | null;
  next_state: CoreNextState;
  owner_action_required: boolean;
  owner_decision: OwnerDecisionRequirement | null;
  evidence_references: readonly string[];
}

export interface ResponsibilityInput {
  /** Whether deterministic contracts already settle this. */
  determinable_from_contracts: boolean;
  /** A registered capability/tool that must perform it, if any. */
  execution_capability_id: string | null;
  /** True when the work is purely turning facts into human language. */
  representation_only: boolean;
  /** Present ONLY when a real authority or value decision is required. */
  owner_authority_reason: OwnerAuthorityReason | null;
  /** Set when the work merely looks like an Owner question. Forces a system class. */
  system_responsibility_reason?: SystemResponsibilityReason | null;
}

export interface ResponsibilityDecision {
  responsibility: ResponsibilityClass;
  reason: OwnerAuthorityReason | SystemResponsibilityReason | "CONTRACTS_DETERMINE" | "CAPABILITY_MUST_EXECUTE" | "REPRESENTATION_ONLY";
}

/**
 * Classifies one unit of work. Ordered so that the escalation path is the
 * hardest to reach, not the easiest: a named system reason wins outright, and
 * OWNER_DECISION requires an explicit authority reason from the closed list.
 * Absence of knowledge cannot produce it.
 */
export function classifyResponsibility(input: ResponsibilityInput): ResponsibilityDecision {
  // A reason that only LOOKS like an Owner question settles it immediately:
  // interpreting evidence, choosing a route, diagnosing, sequencing, judging
  // evidence sufficiency and summarising state are all system work.
  if (input.system_responsibility_reason) {
    return { responsibility: "DETERMINISTIC_CORE", reason: input.system_responsibility_reason };
  }
  if (input.owner_authority_reason) {
    return { responsibility: "OWNER_DECISION", reason: input.owner_authority_reason };
  }
  if (input.representation_only) {
    return { responsibility: "LANGUAGE_TRANSFORM", reason: "REPRESENTATION_ONLY" };
  }
  if (input.execution_capability_id) {
    return { responsibility: "EXECUTION_CAPABILITY", reason: "CAPABILITY_MUST_EXECUTE" };
  }
  // Everything else — including everything merely unknown — stays the core's.
  return { responsibility: "DETERMINISTIC_CORE", reason: "CONTRACTS_DETERMINE" };
}

/** True when no registered procedure remains for a required fact. A statement about coverage, not blame. */
export function evidenceCeilingReached(ceiling: Omit<EvidenceCeiling, "evidence_ceiling_reached">): EvidenceCeiling {
  return { ...ceiling, evidence_ceiling_reached: ceiling.remaining_procedures.length === 0 };
}

export interface RoutingInput {
  responsibility: ResponsibilityClass;
  result_verified: boolean;
  ceiling: EvidenceCeiling | null;
  /** Registered continuations, named. An empty list is why STOP_UNPROVEN exists. */
  registered_procedures_remaining: readonly string[];
  registered_repair_available: boolean;
  registered_retry_policy_available: boolean;
  external_result_pending: boolean;
  capability_and_authority_resolved: boolean;
}

/**
 * Chooses the next state by rule. Note what cannot happen: an evidence ceiling
 * does not escalate by itself, and a ceiling that does not block the required
 * result does not even stop the work.
 */
export function routeNextState(input: RoutingInput): { next_state: CoreNextState; reason: CoreNextStateReason } {
  if (input.responsibility === "OWNER_DECISION") return { next_state: "OWNER_DECISION_REQUIRED", reason: "OWNER_AUTHORITY_REQUIRED" };
  if (input.result_verified) return { next_state: "COMPLETE", reason: "REQUIRED_RESULT_VERIFIED" };
  if (input.external_result_pending) return { next_state: "WAIT_EXTERNAL", reason: "EXTERNAL_RESULT_PENDING" };
  if (input.responsibility === "LANGUAGE_TRANSFORM") return { next_state: "LANGUAGE_TRANSFORM", reason: "REPRESENTATION_REQUIRED" };
  if (input.registered_procedures_remaining.length > 0) return { next_state: "DIAGNOSE", reason: "REGISTERED_PROCEDURE_AVAILABLE" };
  if (input.registered_repair_available) return { next_state: "REPAIR", reason: "REGISTERED_REPAIR_AVAILABLE" };
  if (input.registered_retry_policy_available) return { next_state: "RETRY_ALLOWED", reason: "REGISTERED_RETRY_POLICY_AVAILABLE" };
  if (input.ceiling?.evidence_ceiling_reached) {
    // Reaching the ceiling is not a failure and not an Owner question. If the
    // missing fact does not block the required result, the work continues.
    return input.ceiling.blocks_required_result
      ? { next_state: "STOP_UNPROVEN", reason: "EVIDENCE_CEILING_REACHED_RESULT_BLOCKED" }
      : { next_state: "CONTINUE_CORE", reason: "EVIDENCE_CEILING_REACHED_RESULT_NOT_BLOCKED" };
  }
  if (input.responsibility === "EXECUTION_CAPABILITY" && input.capability_and_authority_resolved) {
    return { next_state: "DISPATCH_CAPABILITY", reason: "CAPABILITY_AND_AUTHORITY_RESOLVED" };
  }
  return { next_state: "STOP_UNPROVEN", reason: "NO_REGISTERED_CONTINUATION" };
}
