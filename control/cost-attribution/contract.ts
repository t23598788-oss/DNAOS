/**
 * หน้าที่: decide, deterministically, whether a measured resource usage or a
 * real monetary event can be attached to a specific execution — and when it
 * cannot, name the exact relationship that is missing (Owner, 2026-09-02).
 *
 * THREE QUESTIONS THAT LOOK LIKE ONE. "How much resource did this execution
 * use?", "what did that resource cost?" and "what did this work cost?" are
 * three different facts, and a system that lets them substitute for one another
 * will report a duration as a price. They are three separate fields here, each
 * with its own state, and `answerThreeQuestions` fills them independently: a
 * known `duration_ms` sets the usage answer and leaves both money answers
 * untouched.
 *
 * WHY THE BASIS VOCABULARY IS THE WHOLE DESIGN. Attribution is easy if you
 * allow yourself to guess: two things happened near each other, the names look
 * alike, split the invoice evenly. Every one of those is a way of inventing a
 * number that will later be read as measured. So `AttributionBasis` is a closed
 * union of identity-equality relations only, and `REJECTED_BASES` names the
 * tempting non-answers explicitly — `isAdmissibleBasis` rejects them, so a
 * future caller cannot smuggle one in as a string.
 *
 * ZERO IS NOT A SMALL NUMBER, IT IS A LIE. An unattributable or unmeasured cost
 * carries `amount_minor: null`. There is no default, no rounding to zero, and
 * no currency invented to accompany an absent amount.
 *
 * OBSERVED MONEY IS NOT EXECUTION COST. A provider invoice is a real fact about
 * a provider account. Turning it into the cost of a specific execution requires
 * an identity chain that reaches that execution; where the chain breaks, this
 * file reports the break rather than closing it.
 *
 * Input: one execution identity + candidate monetary events + registered relationships.
 * Output: the attribution contract, attributeCost, answerThreeQuestions, missing-edge types.
 * Dependency ที่อนุญาต: none — pure.
 * สิ่งที่ห้ามแตะ: ห้ามเติม 0 แทนค่าที่ไม่ทราบ, ห้ามใช้เวลา/ชื่อ/การหารเฉลี่ยเป็น
 * basis, ห้ามให้โมเดลกำหนด attribution, ห้ามสร้างราคาขึ้นเอง.
 */

/** Finite. Each state is a different reason, never a different amount of confidence. */
export type AttributionState =
  /** The monetary or usage event itself carries the execution/work identity. */
  | "DIRECT"
  /** An explicit registered relationship chain reaches the execution. */
  | "DERIVABLE"
  /** The money or usage exists, and no deterministic identity chain reaches the work. */
  | "UNATTRIBUTABLE"
  /** The required usage or cost fact does not exist at all. */
  | "NOT_MEASURED";

/**
 * The only admissible reasons. Every member is an identity equality or a
 * registered edge — nothing here is a resemblance.
 */
export type AttributionBasis =
  | "SAME_EXECUTION_ID"
  | "SAME_WORK_ORDER_ID"
  | "SAME_PROVIDER_REQUEST_ID"
  | "SAME_RESOURCE_ID"
  | "SAME_BILLING_ITEM_ID"
  | "EXPLICIT_REGISTERED_RELATIONSHIP";

/**
 * Named so they can be refused by name. These are the ways a cost gets invented,
 * and each has been used somewhere by someone to make a number appear.
 */
export const REJECTED_BASES = Object.freeze([
  "TIMESTAMP_PROXIMITY", "NAME_SIMILARITY", "MODEL_GUESS",
  "TEXT_SIMILARITY", "EVEN_SPLIT", "ASSUMED_USAGE",
] as const);
export type RejectedBasis = (typeof REJECTED_BASES)[number];

/** A basis is admissible only if it is in the closed union. Strings do not qualify by resembling one. */
export function isAdmissibleBasis(value: unknown): value is AttributionBasis {
  const allowed: readonly string[] = ["SAME_EXECUTION_ID", "SAME_WORK_ORDER_ID", "SAME_PROVIDER_REQUEST_ID", "SAME_RESOURCE_ID", "SAME_BILLING_ITEM_ID", "EXPLICIT_REGISTERED_RELATIONSHIP"];
  return typeof value === "string" && allowed.includes(value);
}

/** Why an attribution could not be made. Finite, so a failure is queryable. */
export type UnattributableReason =
  | "NO_MONETARY_EVENT_FOR_THIS_METHOD"
  | "NO_SHARED_IDENTITY_WITH_ANY_MONETARY_EVENT"
  | "NO_REGISTERED_RELATIONSHIP_TO_PROVIDER_ACCOUNT"
  | "USAGE_DIMENSION_NOT_MEASURED"
  | "NO_PRICE_CONTRACT_FOR_MEASURED_USAGE";

/** The execution side of the join — only fields that really exist on persisted rows. */
export interface ExecutionIdentity {
  execution_id: string | null;
  work_id: string | null;
  correlation_id: string | null;
  capability_id: string | null;
  method_id: string;
  resource_id: string | null;
  /** DNA OS's own account namespace, which is NOT a provider account. */
  account_id: string | null;
  provider: string | null;
  provider_request_id: string | null;
  /** Dimensions actually recorded on this execution's row. */
  measured_usage: Readonly<Record<string, number>>;
  evidence_ref: string;
}

/** The money side — only fields present on real billing/expense rows. */
export interface MonetaryEvent {
  money_event_id: string;
  provider: string;
  service: string | null;
  resource: string | null;
  /** The PROVIDER's account/team id. A different namespace from ExecutionIdentity.account_id. */
  account_or_project_ref: string | null;
  period_start: string | null;
  period_end: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price_minor: number | null;
  amount_minor: number | null;
  currency: string | null;
  /** Execution/work identity carried by the money event itself, if any. Usually null. */
  execution_id: string | null;
  work_id: string | null;
  provider_request_id: string | null;
  billing_item_id: string | null;
  evidence_ref: string;
}

/** A registered edge. Only explicit relationships count; none are inferred. */
export interface RegisteredRelationship {
  from_identity: string;
  to_identity: string;
  relationship_kind: string;
}

export interface CostAttribution {
  attribution_id: string;
  work_id: string | null;
  execution_id: string | null;
  capability_id: string | null;
  method_id: string;
  resource_id: string | null;
  provider: string | null;
  provider_resource_id: string | null;
  account_or_project_ref: string | null;
  usage_measurement_refs: readonly string[];
  monetary_event_refs: readonly string[];
  attribution_state: AttributionState;
  /** Null unless the state is DIRECT or DERIVABLE. */
  attribution_basis: AttributionBasis | null;
  /** Why not, when not. Empty when attributed. */
  unattributable_reasons: readonly UnattributableReason[];
  /** Null whenever the state is not DIRECT or DERIVABLE. Never zero. */
  amount_minor: number | null;
  currency: string | null;
  evidence_refs: readonly string[];
}

/**
 * Attributes one execution. Pure and total.
 *
 * The order is deliberate: DIRECT first, because an event that carries the
 * execution's own id needs no chain; then DERIVABLE, which requires a REGISTERED
 * edge between two identities — not a resemblance between them. Everything else
 * falls through to a named refusal. There is no final branch that picks a
 * plausible candidate.
 */
export function attributeCost(
  execution: ExecutionIdentity,
  monetaryEvents: readonly MonetaryEvent[],
  relationships: readonly RegisteredRelationship[],
  attributionId: string,
): CostAttribution {
  const base = {
    attribution_id: attributionId,
    work_id: execution.work_id,
    execution_id: execution.execution_id,
    capability_id: execution.capability_id,
    method_id: execution.method_id,
    resource_id: execution.resource_id,
    provider: execution.provider,
    usage_measurement_refs: Object.keys(execution.measured_usage).length > 0 ? [execution.evidence_ref] : [],
    evidence_refs: [execution.evidence_ref] as readonly string[],
  };

  // ---- DIRECT: the money event names this execution or work order ----
  const direct = monetaryEvents.find((m) =>
    (execution.execution_id !== null && m.execution_id === execution.execution_id)
    || (execution.work_id !== null && m.work_id === execution.work_id)
    || (execution.provider_request_id !== null && m.provider_request_id === execution.provider_request_id));
  if (direct) {
    const basis: AttributionBasis = direct.execution_id === execution.execution_id ? "SAME_EXECUTION_ID"
      : direct.work_id === execution.work_id ? "SAME_WORK_ORDER_ID" : "SAME_PROVIDER_REQUEST_ID";
    return {
      ...base, provider: direct.provider, provider_resource_id: direct.resource,
      account_or_project_ref: direct.account_or_project_ref,
      monetary_event_refs: [direct.money_event_id],
      attribution_state: "DIRECT", attribution_basis: basis, unattributable_reasons: [],
      amount_minor: direct.amount_minor, currency: direct.currency,
      evidence_refs: [execution.evidence_ref, direct.evidence_ref],
    };
  }

  // ---- DERIVABLE: a REGISTERED edge joins this execution's identity to the
  // money event's provider account. Not "the names match" — a real edge. ----
  const executionIdentities = [execution.resource_id, execution.capability_id, execution.account_id].filter((v): v is string => typeof v === "string");
  for (const m of monetaryEvents) {
    const target = m.account_or_project_ref;
    if (!target) continue;
    const edge = relationships.find((r) =>
      (executionIdentities.includes(r.from_identity) && r.to_identity === target)
      || (executionIdentities.includes(r.to_identity) && r.from_identity === target));
    if (edge) {
      return {
        ...base, provider: m.provider, provider_resource_id: m.resource,
        account_or_project_ref: target, monetary_event_refs: [m.money_event_id],
        attribution_state: "DERIVABLE", attribution_basis: "EXPLICIT_REGISTERED_RELATIONSHIP",
        unattributable_reasons: [], amount_minor: m.amount_minor, currency: m.currency,
        evidence_refs: [execution.evidence_ref, m.evidence_ref],
      };
    }
  }

  // ---- No chain. Say which link is missing, and carry no amount. ----
  const reasons: UnattributableReason[] = [];
  const sameProvider = monetaryEvents.filter((m) => execution.provider !== null && m.provider === execution.provider);
  if (monetaryEvents.length === 0) reasons.push("NO_MONETARY_EVENT_FOR_THIS_METHOD");
  else if (sameProvider.length === 0) reasons.push("NO_SHARED_IDENTITY_WITH_ANY_MONETARY_EVENT");
  else reasons.push("NO_REGISTERED_RELATIONSHIP_TO_PROVIDER_ACCOUNT");
  if (Object.keys(execution.measured_usage).length === 0) reasons.push("USAGE_DIMENSION_NOT_MEASURED");

  const state: AttributionState = Object.keys(execution.measured_usage).length === 0 && monetaryEvents.length === 0
    ? "NOT_MEASURED" : "UNATTRIBUTABLE";
  return {
    ...base, provider: execution.provider, provider_resource_id: null, account_or_project_ref: null,
    monetary_event_refs: [], attribution_state: state, attribution_basis: null,
    unattributable_reasons: reasons,
    // The whole point: no amount, no currency, no zero.
    amount_minor: null, currency: null,
  };
}

/** The three questions, kept apart so one can never answer another. */
export interface ThreeQuestionAnswer {
  /** 1. How much resource did this execution use? */
  usage_known: Readonly<Record<string, number>>;
  usage_state: "MEASURED" | "NOT_MEASURED";
  /** 2. What did that resource cost? Requires a price contract, which does not exist. */
  resource_cost_state: "KNOWN" | "NO_PRICE_CONTRACT";
  resource_cost_minor: number | null;
  /** 3. What did this work cost? Requires an attribution chain. */
  work_cost_state: AttributionState;
  work_cost_minor: number | null;
  currency: string | null;
}

/**
 * Answers all three independently. A measured duration fills only the first —
 * it cannot reach the second or third, because no price contract maps a
 * dimension to money and no chain maps money to work.
 */
export function answerThreeQuestions(
  execution: ExecutionIdentity,
  attribution: CostAttribution,
  priceContractExists = false,
): ThreeQuestionAnswer {
  const measured = execution.measured_usage;
  return {
    usage_known: measured,
    usage_state: Object.keys(measured).length > 0 ? "MEASURED" : "NOT_MEASURED",
    resource_cost_state: priceContractExists ? "KNOWN" : "NO_PRICE_CONTRACT",
    resource_cost_minor: null,
    work_cost_state: attribution.attribution_state,
    work_cost_minor: attribution.amount_minor,
    currency: attribution.currency,
  };
}

/** One break in the chain, stated as data so it can be worked on rather than remembered. */
export interface MissingEdge {
  from_identity: string;
  to_identity: string;
  missing_relationship: string;
  current_source: string;
  required_producer: string;
  verification_method: string;
}
