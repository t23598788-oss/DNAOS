/**
 * หน้าที่: decide, without any model, whether the observable effect that was
 * declared BEFORE an action actually occurred according to the target's own
 * BEFORE/AFTER readings (Owner, 2026-09-02).
 *
 * THE THREE STATES ARE NOT TWO. VERIFIED and FAILED both require that every
 * observation the expectation needs was really acquired and really carried the
 * observable. Anything less is UNPROVEN. Collapsing "the condition was false"
 * into "we could not look" would let a broken observer read as a broken target,
 * and a missing reading read as a real absence of effect — so evaluability is
 * decided for ALL conditions first, and only then are they evaluated.
 *
 * DISPATCH IS NOT EFFECT, STILL. `result_status: COMPLETED`, `mouse_helper=OK`,
 * `OK scroll 0,600`, `os_open=OK` do not appear in this file and are not
 * reachable from it: `evaluateEffect` takes an expectation and two observations
 * and nothing else, so a dispatch line cannot satisfy a condition even by
 * accident. That is the false positive the acceptance verifier was built to
 * refuse, kept refused here.
 *
 * ONE SEMANTIC OWNER. `relationHolds` below is the single implementation of
 * what INCREASE / CHANGES / EQUALS / BECOMES / MATCHES mean.
 * ./tools/acceptance-verifier.ts `conditionMet` now calls it rather than
 * carrying a second copy, so the runtime verdict and the acceptance suite
 * cannot drift apart. The locked primitive rules themselves are unchanged —
 * ./tests/verifier-equivalence.test.ts checks the delegation against the
 * original logic across every operation and state combination.
 *
 * WHAT THIS FILE MAY NOT SAY. It answers one question — did the declared
 * observable effect occur — and stops. Why it did not, which component is at
 * fault, what to repair, and what should happen next are all beyond this
 * boundary and appear nowhere below.
 *
 * Input: an ExpectationRecord and the BEFORE/AFTER Observations for one execution.
 * Output: EffectVerdict, evaluateEffect, relationHolds, observationValue.
 * Dependency ที่อนุญาต: ./expectation, ./observation (types only).
 * สิ่งที่ห้ามแตะ: ห้ามให้ไฟล์นี้เห็น dispatch evidence หรือ outcome, ห้ามใช้
 * clock/random/model ในการตัดสิน, ห้ามยุบ UNPROVEN เข้ากับ FAILED.
 */
import { PATTERNS, type ExpectationRecord, type ExpectedCondition, type ExpectedRelation } from "./expectation";
import type { Observation } from "./observation";

export type EffectVerdictStatus =
  /** Expectation existed, every required reading was acquired, and the comparison holds. */
  | "VERIFIED"
  /** Expectation existed, every required reading was acquired, and the comparison does not hold. */
  | "FAILED"
  /** Not enough deterministic information to decide either way. */
  | "UNPROVEN";

/** Finite and machine-readable. There is no free-form diagnosis field anywhere in this contract. */
export type VerdictReasonCode =
  | "EXPECTATION_MET"
  | "EXPECTATION_NOT_MET"
  | "EXPECTATION_UNAVAILABLE"
  | "BEFORE_OBSERVATION_UNAVAILABLE"
  | "AFTER_OBSERVATION_UNAVAILABLE"
  | "REQUIRED_OBSERVABLE_MISSING"
  /** The observable is present but not comparable under the relation (e.g. a non-numeric value where the locked rule compares numbers). */
  | "OBSERVABLE_NOT_COMPARABLE"
  | "UNSUPPORTED_EXPECTATION";

export interface EffectVerdict {
  status: EffectVerdictStatus;
  reason_code: VerdictReasonCode;
  evaluated_at: string;
  /** Which observable settled it — the first unevaluable one, or the first that did not hold. Null when every condition held. */
  deciding_observable: string | null;
  deciding_relation: ExpectedRelation | null;
  /** The two values actually read for the deciding observable. Null when they were not available to read. */
  observed_before_value: string | null;
  observed_after_value: string | null;
  /** References back to the three inputs on this same evidence row. */
  expectation_operation: string | null;
  expectation_created_at: string | null;
  observation_before_at: string | null;
  observation_after_at: string | null;
}

/** The observables the locked rules compare as numbers; everything else is compared as text. */
const NUMERIC_OBSERVABLES: ReadonlySet<string> = new Set([
  "clicks", "dbls", "scrollY", "dragLeft", "maxScrollY", "wheelCount", "wheelDeltaY", "wheelMode",
]);

/** Reads one observable out of an observation. Null means it was not there to read. */
export function observationValue(observation: Observation | undefined, observedAs: string): string | null {
  if (!observation || observation.acquired !== true || observation.state === null) return null;
  const value = observation.state[observedAs];
  return typeof value === "string" ? value : null;
}

/** Which relations need a BEFORE reading at all. EQUALS and MATCHES look only at AFTER. */
export function relationNeedsBefore(relation: ExpectedRelation): boolean {
  return relation === "INCREASE" || relation === "CHANGES" || relation === "BECOMES";
}

/**
 * THE single definition of what each relation means. Pure: same inputs, same
 * answer, no clock, no randomness, no I/O. `null` = not decidable from these
 * values, which the caller turns into UNPROVEN and never into FAILED.
 */
export function relationHolds(
  relation: ExpectedRelation, observable: string,
  before: string | null, after: string | null,
  expectedValue: string | null, expectedPattern: string | null,
): boolean | null {
  const numeric = NUMERIC_OBSERVABLES.has(observable);
  const num = (v: string | null): number | null => {
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  switch (relation) {
    case "INCREASE": {
      const b = num(before), a = num(after);
      if (b === null || a === null) return null;
      return a > b;
    }
    case "CHANGES": {
      if (before === null || after === null) return null;
      if (numeric) {
        const b = num(before), a = num(after);
        if (b === null || a === null) return null;
        return a !== b;
      }
      return after !== before;
    }
    case "EQUALS":
      if (after === null || expectedValue === null) return null;
      return after === expectedValue;
    case "BECOMES":
      if (before === null || after === null || expectedValue === null) return null;
      return before !== expectedValue && after === expectedValue;
    case "MATCHES": {
      if (after === null || expectedPattern === null) return null;
      const pattern = (PATTERNS as Record<string, RegExp>)[expectedPattern];
      if (!pattern) return null;
      return pattern.test(after);
    }
    default:
      return null;
  }
}

const verdict = (
  status: EffectVerdictStatus, reason_code: VerdictReasonCode, evaluated_at: string,
  expectation: ExpectationRecord | undefined, before: Observation | undefined, after: Observation | undefined,
  condition: ExpectedCondition | null, beforeValue: string | null, afterValue: string | null,
): EffectVerdict => ({
  status, reason_code, evaluated_at,
  deciding_observable: condition?.observable ?? null,
  deciding_relation: condition?.relation ?? null,
  observed_before_value: beforeValue,
  observed_after_value: afterValue,
  expectation_operation: expectation?.operation ?? null,
  expectation_created_at: expectation?.created_at ?? null,
  observation_before_at: before?.observed_at ?? null,
  observation_after_at: after?.observed_at ?? null,
});

/**
 * Evaluates one execution's declared expectation against its two readings.
 *
 * Two passes on purpose. The first asks only "can every condition be
 * evaluated?" — any answer of no ends in UNPROVEN, whatever the other
 * conditions would have said. Only when all of them are answerable does the
 * second pass decide VERIFIED or FAILED. A definitively false condition next to
 * an unreadable one is still UNPROVEN, because the evidence to call it FAILED
 * was never acquired.
 */
export function evaluateEffect(
  expectation: ExpectationRecord | undefined,
  observationBefore: Observation | undefined,
  observationAfter: Observation | undefined,
  now: () => Date = () => new Date(),
): EffectVerdict {
  const at = now().toISOString();
  const mk = (s: EffectVerdictStatus, r: VerdictReasonCode, c: ExpectedCondition | null = null, bv: string | null = null, av: string | null = null) =>
    verdict(s, r, at, expectation, observationBefore, observationAfter, c, bv, av);

  if (!expectation || expectation.available !== true) return mk("UNPROVEN", "EXPECTATION_UNAVAILABLE");
  if (!Array.isArray(expectation.conditions) || expectation.conditions.length === 0) return mk("UNPROVEN", "UNSUPPORTED_EXPECTATION");

  // ---- pass 1: is every condition evaluable at all? ----
  const evaluated: Array<{ condition: ExpectedCondition; held: boolean; before: string | null; after: string | null }> = [];
  for (const condition of expectation.conditions) {
    const needsBefore = relationNeedsBefore(condition.relation);
    if (needsBefore && (!observationBefore || observationBefore.acquired !== true)) {
      return mk("UNPROVEN", "BEFORE_OBSERVATION_UNAVAILABLE", condition);
    }
    if (!observationAfter || observationAfter.acquired !== true) {
      return mk("UNPROVEN", "AFTER_OBSERVATION_UNAVAILABLE", condition);
    }
    const beforeValue = needsBefore ? observationValue(observationBefore, condition.observed_as) : null;
    const afterValue = observationValue(observationAfter, condition.observed_as);
    if (afterValue === null || (needsBefore && beforeValue === null)) {
      return mk("UNPROVEN", "REQUIRED_OBSERVABLE_MISSING", condition, beforeValue, afterValue);
    }
    const held = relationHolds(condition.relation, condition.observable, beforeValue, afterValue, condition.expected_value, condition.expected_pattern);
    if (held === null) return mk("UNPROVEN", "OBSERVABLE_NOT_COMPARABLE", condition, beforeValue, afterValue);
    evaluated.push({ condition, held, before: beforeValue, after: afterValue });
  }

  // ---- pass 2: every condition was answerable, so the answer is VERIFIED or FAILED ----
  const notHeld = evaluated.find((e) => !e.held);
  if (notHeld) return mk("FAILED", "EXPECTATION_NOT_MET", notHeld.condition, notHeld.before, notHeld.after);
  return mk("VERIFIED", "EXPECTATION_MET", null, null, null);
}
