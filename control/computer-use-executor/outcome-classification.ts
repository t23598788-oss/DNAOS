/**
 * หน้าที่: turn one execution's evidence into a machine-readable statement of
 * what is known, what is not known, where the failure is (and is not)
 * localized, and which class of action may come next — without guessing a cause
 * (Owner, 2026-09-02).
 *
 * THE LINE THIS FILE MUST NOT CROSS. A FAILED effect is not a known cause.
 * From `dispatch=COMPLETED, expected scrollY CHANGES, before 0, after 0` the
 * only supported statement is "the expected observable effect did not occur".
 * "The scroll primitive is broken", "the browser ignored the wheel", "focus was
 * wrong" each require evidence about a boundary that nothing here observed. So
 * the failure boundary for that shape is UNLOCALIZED_BETWEEN_DISPATCH_AND_TARGET_EFFECT
 * — uncertainty represented explicitly, as a value, rather than resolved by
 * plausibility. UNKNOWN is first-class state here, never a placeholder waiting
 * to be filled in with a guess.
 *
 * WHAT WAS REUSED RATHER THAN REINVENTED. Root cause classes come from
 * ../repair-loop/types.ts `RootCauseClass` — `UNDETERMINED` already means
 * "cause unknown" and `MISSING_EVIDENCE` already means "not enough evidence",
 * so this file maps onto them instead of minting synonyms. Owner escalation
 * uses the repo's existing literal `OWNER_DECISION_REQUIRED` (already in
 * repair-loop `StopCondition`, work-continuation `ResumeVerdict`, and
 * incident-remediation `RemediationTerminalState`) rather than a new
 * WAIT_OWNER. `RootCauseClass` has no member meaning "no defect indicated" —
 * its nearest, EXPECTED_BY_DESIGN, asserts something stronger — so
 * DefectStatus keeps that one case of its own and the mapping is null there.
 *
 * NO GENERIC RETRY. There is no FAILED → RETRY fallback. Repeating an action
 * with no new information is not diagnosis, so RETRY_ALLOWED is reachable only
 * through a registered policy, and REPAIR_ALLOWED only through a registered
 * procedure for a confirmed defect. Neither is reachable from a bare FAILED.
 *
 * OWNER IS NOT THE DEFAULT DIAGNOSTIC ENGINE. `OWNER_DECISION_REQUIRED` is
 * chosen only where a real policy in this repo says the Owner alone can lift
 * the block — the two lease flags that only an Owner grant can set. An unknown
 * cause on its own never escalates.
 *
 * Input: one persisted ExecutionEvidence row + the registered diagnostic procedures.
 * Output: OutcomeClassification, classifyOutcome, and the typed vocabularies.
 * Dependency ที่อนุญาต: ./executor (types), ./effect-verdict (types), ../repair-loop/types (types).
 * สิ่งที่ห้ามแตะ: ห้ามเดา root cause, ห้ามแปลง UNKNOWN เป็นการวินิจฉัย, ห้าม
 * สร้าง diagnostic procedure ขึ้นเองในไฟล์นี้, ห้ามแก้ evidence เดิม.
 */
import type { ExecutionEvidence } from "./executor";
import type { EffectVerdictStatus, VerdictReasonCode } from "./effect-verdict";
import type { RootCauseClass } from "../repair-loop/types";
import { selectProcedures, type DiagnosticProcedure, type ProcedureOrigination } from "./diagnostic-procedure";
import type { DiagnosticFinding } from "./diagnostic-wheel-receipt";
import type { RoutingContextDiagnosticFinding } from "./diagnostic-routing-context";

/** Any procedure's finding. Consumers dispatch on `resolved_unknown_key`, never on which module produced it. */
export type ConsumableFinding = DiagnosticFinding | RoutingContextDiagnosticFinding;

/** The narrowest boundary evidence can localize a failure to. */
export type FailureBoundary =
  | "NONE"
  | "REQUEST"
  | "IDENTITY"
  | "AUTHORITY"
  | "EXPECTATION"
  | "BEFORE_OBSERVATION"
  | "DISPATCH"
  | "AFTER_OBSERVATION"
  | "VERIFICATION"
  /**
   * Dispatch completed and the target effect was not observed, and NOTHING
   * observed delivery, target receipt, or the target's own handling. The
   * failure is somewhere in that span; naming any one of them would be
   * invention, so the span itself is the value.
   */
  | "UNLOCALIZED_BETWEEN_DISPATCH_AND_TARGET_EFFECT"
  /**
   * A registered procedure read the target's own counter and the target was
   * NOT OBSERVED to receive the input. Deliberately not "DELIVERY_FAILED":
   * absence of observed receipt does not name which upstream component failed,
   * and nothing has looked at any of them.
   */
  | "TARGET_RECEIPT_NOT_OBSERVED"
  /** Receipt was proven reached, so what remains unexplained is downstream of it. */
  | "TARGET_EFFECT"
  | "UNLOCALIZED";

export type DefectStatus =
  | "NO_DEFECT_INDICATED"
  | "DEFECT_CONFIRMED"
  | "CAUSE_UNKNOWN"
  | "INSUFFICIENT_EVIDENCE";

/**
 * Where this file's defect vocabulary meets the repair-loop's existing one.
 * Null where repair-loop has no member with that meaning — better an explicit
 * gap than a nearly-right synonym that would mislead a repair consumer.
 */
export const ROOT_CAUSE_CLASS_BY_DEFECT_STATUS: Readonly<Record<DefectStatus, RootCauseClass | null>> = Object.freeze({
  NO_DEFECT_INDICATED: null,
  DEFECT_CONFIRMED: null,
  CAUSE_UNKNOWN: "UNDETERMINED",
  INSUFFICIENT_EVIDENCE: "MISSING_EVIDENCE",
});

/** The classes of action allowed next. Finite; every value is chosen by rule, never by preference. */
export type NextState =
  /** The declared effect was observed. Nothing further is owed for this execution. */
  | "EFFECT_COMPLETE"
  /** A registered deterministic diagnostic procedure exists for this boundary and may run. */
  | "DIAGNOSE"
  /** A registered retry policy explicitly permits repeating this action. */
  | "RETRY_ALLOWED"
  /** A defect is confirmed and a registered repair procedure exists for it. */
  | "REPAIR_ALLOWED"
  /** Only the Owner can lift this block — existing repo literal. */
  | "OWNER_DECISION_REQUIRED"
  /** The system cannot proceed and no registered procedure or policy covers this. */
  | "BLOCKED"
  /** Not enough deterministic evidence to state anything further about the effect. */
  | "STOP_UNPROVEN";

/** Machine-readable, finite. There is no free-form diagnosis field on this record. */
export type NextStateReason =
  | "EFFECT_OBSERVED"
  | "NO_REGISTERED_DIAGNOSTIC_PROCEDURE"
  | "REGISTERED_DIAGNOSTIC_PROCEDURE_AVAILABLE"
  | "REGISTERED_RETRY_POLICY_AVAILABLE"
  | "REGISTERED_REPAIR_PROCEDURE_AVAILABLE"
  | "OWNER_ONLY_AUTHORITY_REQUIRED"
  | "EVIDENCE_GAP_NO_REGISTERED_ACQUISITION_PATH";

/** The facts the evidence actually carries. Finite keys, so a reader never has to parse prose. */
export type KnownFactKey =
  | "capability_id" | "operation" | "expectation" | "before_observation_acquired"
  | "dispatch_status" | "after_observation_acquired" | "effect_verdict" | "verdict_reason";

/**
 * Facts nothing in this evidence establishes. These stay listed, and stay
 * unknown, until something separately evidences them.
 */
export type UnknownFactKey =
  | "root_cause"
  | "defective_component"
  | "input_reached_target_application"
  | "target_default_action_occurred"
  | "focus_state_caused_outcome"
  | "timing_caused_outcome"
  /**
   * Whether the routing context captured immediately before dispatch was
   * consistent with the target being eligible to receive a coordinate-less
   * input. Deliberately narrower than "did routing happen" — nothing observes
   * the window server itself.
   */
  | "routing_context_compatible_with_target"
  | "repair_required";

/** Everything a bare FAILED effect leaves open. Listed as data, never narrowed by inference. */
const UNKNOWN_ON_FAILED: readonly UnknownFactKey[] = Object.freeze([
  "root_cause", "defective_component", "input_reached_target_application",
  "target_default_action_occurred", "focus_state_caused_outcome", "timing_caused_outcome",
  "routing_context_compatible_with_target", "repair_required",
]);

export interface OutcomeClassification {
  classified_at: string;
  /** Back-references to the evidence this is a consequence of. The evidence itself is never modified. */
  evidence_id: string;
  work_order_id: string;
  capability_id: string | null;

  known_facts: Readonly<Record<string, string>>;
  unknown_facts: readonly UnknownFactKey[];

  failure_boundary: FailureBoundary;
  defect_status: DefectStatus;
  /** Deliberately null unless deterministic evidence proves a cause. Nothing in Step 6 can set it. */
  root_cause: string | null;
  root_cause_class: RootCauseClass | null;

  diagnostic_procedure: string | null;
  diagnostic_procedure_source: string | null;

  next_state: NextState;
  next_state_reason: NextStateReason;
  owner_required: boolean;
}

/**
 * Denial reasons that a real policy in this repo says only the Owner can lift:
 * both name a lease flag that is set at grant time by an Owner-authenticated
 * grant. Every other denial is a caller-side error inside system authority and
 * must NOT escalate — an unknown cause is not an Owner question.
 */
const OWNER_ONLY_DENIAL_REASONS: ReadonlySet<string> = new Set([
  "HIGH_RISK_NOT_EXPLICITLY_AUTHORIZED",
  "EXTERNAL_COMMIT_NOT_AUTHORIZED",
]);

/** Where an UNPROVEN verdict localizes, by the reason the evaluator gave. */
const BOUNDARY_BY_UNPROVEN_REASON: Readonly<Record<VerdictReasonCode, FailureBoundary>> = Object.freeze({
  EXPECTATION_MET: "NONE",
  EXPECTATION_NOT_MET: "UNLOCALIZED_BETWEEN_DISPATCH_AND_TARGET_EFFECT",
  EXPECTATION_UNAVAILABLE: "EXPECTATION",
  BEFORE_OBSERVATION_UNAVAILABLE: "BEFORE_OBSERVATION",
  AFTER_OBSERVATION_UNAVAILABLE: "AFTER_OBSERVATION",
  REQUIRED_OBSERVABLE_MISSING: "VERIFICATION",
  OBSERVABLE_NOT_COMPARABLE: "VERIFICATION",
  UNSUPPORTED_EXPECTATION: "EXPECTATION",
});

function knownFacts(evidence: ExecutionEvidence): Record<string, string> {
  const facts: Record<string, string> = {};
  const put = (key: KnownFactKey, value: string | null | undefined) => {
    if (value !== null && value !== undefined) facts[key] = value;
  };
  put("capability_id", evidence.capability_id ?? null);
  put("operation", evidence.operation);
  put("expectation", evidence.expectation
    ? (evidence.expectation.available
      ? evidence.expectation.conditions.map((c) => `${c.observable} ${c.relation}${c.expected_value ? ` "${c.expected_value}"` : ""}${c.expected_pattern ? ` ${c.expected_pattern}` : ""}`).join(" AND ")
      : `UNAVAILABLE:${evidence.expectation.unavailable_reason}`)
    : null);
  put("before_observation_acquired", evidence.observation_before ? String(evidence.observation_before.acquired) : null);
  put("dispatch_status", evidence.result_status);
  put("after_observation_acquired", evidence.observation_after ? String(evidence.observation_after.acquired) : null);
  put("effect_verdict", evidence.effect_verdict?.status ?? null);
  put("verdict_reason", evidence.effect_verdict?.reason_code ?? null);
  return facts;
}

/**
 * Classifies one execution. Pure and total: same evidence plus same registry
 * always yields the same record, and every path returns a typed value rather
 * than throwing.
 */
export function classifyOutcome(
  evidence: ExecutionEvidence,
  procedures: readonly DiagnosticProcedure[] = [],
  now: () => Date = () => new Date(),
  findings: readonly ConsumableFinding[] = [],
  permittedOrigination: ProcedureOrigination = "SYSTEM",
): OutcomeClassification {
  // Only findings drawn from THIS execution may narrow anything. A finding
  // about another run is another run's fact, however similar it looks.
  const own = findings.filter((f) => f.source_execution_evidence_id === evidence.evidence_id);
  const facts = knownFacts(evidence);
  const base = {
    classified_at: now().toISOString(),
    evidence_id: evidence.evidence_id,
    work_order_id: evidence.work_order_id,
    capability_id: evidence.capability_id ?? null,
    root_cause: null as string | null,
  };
  const settle = (
    failure_boundary: FailureBoundary, defect_status: DefectStatus,
    unknown_facts: readonly UnknownFactKey[], next_state: NextState,
    next_state_reason: NextStateReason, owner_required: boolean,
    procedure: DiagnosticProcedure | null = null,
    extraFacts: Record<string, string> = {},
  ): OutcomeClassification => ({
    ...base,
    known_facts: Object.freeze({ ...facts, ...extraFacts }),
    unknown_facts: Object.freeze([...unknown_facts]),
    failure_boundary, defect_status,
    root_cause_class: ROOT_CAUSE_CLASS_BY_DEFECT_STATUS[defect_status],
    diagnostic_procedure: procedure?.procedure_id ?? null,
    diagnostic_procedure_source: procedure?.registered_by ?? null,
    next_state, next_state_reason, owner_required,
  });
  /** Picks the next procedure from whatever is STILL unknown — never from the operation's name. */
  const pick = (remaining: readonly UnknownFactKey[]) =>
    selectProcedures(procedures, remaining, evidence, permittedOrigination).selected;

  // ---- identity / authority refusals: the boundary IS the refusal ----
  if (evidence.authorized === false) {
    const reason = (evidence.authorization_reason ?? "").split(":")[0]!.trim();
    const identity = reason === "CAPABILITY_ID_MALFORMED" || reason === "CAPABILITY_ROUTE_MISMATCH";
    const ownerOnly = OWNER_ONLY_DENIAL_REASONS.has(reason);
    return settle(
      identity ? "IDENTITY" : "AUTHORITY", "NO_DEFECT_INDICATED", ["root_cause"],
      ownerOnly ? "OWNER_DECISION_REQUIRED" : "BLOCKED",
      ownerOnly ? "OWNER_ONLY_AUTHORITY_REQUIRED" : "NO_REGISTERED_DIAGNOSTIC_PROCEDURE",
      ownerOnly,
    );
  }

  // ---- rows written before Step 5, or any row with no verdict ----
  const v = evidence.effect_verdict;
  if (!v) {
    return settle("UNLOCALIZED", "INSUFFICIENT_EVIDENCE", UNKNOWN_ON_FAILED, "STOP_UNPROVEN",
      "EVIDENCE_GAP_NO_REGISTERED_ACQUISITION_PATH", false);
  }

  const status: EffectVerdictStatus = v.status;

  // ---- the effect was observed ----
  if (status === "VERIFIED") {
    return settle("NONE", "NO_DEFECT_INDICATED", [], "EFFECT_COMPLETE", "EFFECT_OBSERVED", false);
  }

  // ---- the system could not look: an evidence gap, never a defect ----
  if (status === "UNPROVEN") {
    const boundary = BOUNDARY_BY_UNPROVEN_REASON[v.reason_code] ?? "UNLOCALIZED";
    const procedure = pick(UNKNOWN_ON_FAILED);
    return procedure
      ? settle(boundary, "INSUFFICIENT_EVIDENCE", UNKNOWN_ON_FAILED, "DIAGNOSE", "REGISTERED_DIAGNOSTIC_PROCEDURE_AVAILABLE", false, procedure)
      : settle(boundary, "INSUFFICIENT_EVIDENCE", UNKNOWN_ON_FAILED, "STOP_UNPROVEN", "EVIDENCE_GAP_NO_REGISTERED_ACQUISITION_PATH", false);
  }

  // ---- FAILED: the declared effect did not occur ----
  // Dispatch reporting COMPLETED does not narrow this by itself: nothing in the
  // execution observed delivery, receipt, or the target's handling.
  let boundary: FailureBoundary = evidence.result_status === "COMPLETED"
    ? "UNLOCALIZED_BETWEEN_DISPATCH_AND_TARGET_EFFECT"
    : "DISPATCH";
  let remaining: UnknownFactKey[] = [...UNKNOWN_ON_FAILED];
  const extraFacts: Record<string, string> = {};

  // ---- apply diagnostic findings: the ONLY thing that may narrow a boundary ----
  // The finding states a fact; this table states what that fact narrows. A
  // procedure never chooses the boundary itself, and UNPROVEN narrows nothing.
  for (const finding of own) {
    // A routing-context finding resolves ONLY its own narrow fact. Compatible
    // context does not make WINDOW_SERVER_ROUTING reached and does not touch
    // CGEVENT_POST: nothing observed either. So it is recorded as a known fact
    // and removes its unknown, and the boundary is deliberately left alone.
    if (finding.resolved_unknown_key === "routing_context_compatible_with_target") {
      if (finding.finding === "UNPROVEN") continue;
      extraFacts["routing_context"] = finding.finding;
      extraFacts["routing_context_procedure"] = finding.procedure_id;
      remaining = remaining.filter((k) => k !== finding.resolved_unknown_key);
      continue;
    }
    if (finding.resolved_unknown_key !== "input_reached_target_application") continue;
    if (finding.finding === "UNPROVEN") continue;
    extraFacts["target_receipt"] = finding.finding;
    extraFacts["target_receipt_procedure"] = finding.procedure_id;
    remaining = remaining.filter((k) => k !== finding.resolved_unknown_key);
    if (boundary === "UNLOCALIZED_BETWEEN_DISPATCH_AND_TARGET_EFFECT") {
      // OBSERVED: receipt is proven reached, so what is unexplained lies downstream.
      // NOT_OBSERVED: receipt was not observed — and that is the whole claim. It
      // is NOT "delivery failed": no component upstream of the target was looked at.
      boundary = finding.finding === "OBSERVED" ? "TARGET_EFFECT" : "TARGET_RECEIPT_NOT_OBSERVED";
    }
  }

  const procedure = pick(remaining);
  return procedure
    ? settle(boundary, "CAUSE_UNKNOWN", remaining, "DIAGNOSE", "REGISTERED_DIAGNOSTIC_PROCEDURE_AVAILABLE", false, procedure, extraFacts)
    : settle(boundary, "CAUSE_UNKNOWN", remaining, "BLOCKED", "NO_REGISTERED_DIAGNOSTIC_PROCEDURE", false, null, extraFacts);
}
