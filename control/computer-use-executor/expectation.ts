/**
 * หน้าที่: state, before an action runs, what observable state change that
 * action is supposed to produce — as a typed, finite, machine-checkable record
 * (Owner, 2026-09-02).
 *
 * THE GAP THIS CLOSES. Evidence could already say BEFORE=X, ACTION=Y, AFTER=Z.
 * It could not say what was SUPPOSED to happen, so AFTER could only ever be
 * judged by someone inferring the intent afterwards — which is exactly the
 * inversion the architecture forbids.
 *
 * WHERE THE RULES COME FROM — NOT FROM ME. Every condition below is a
 * transcription of a rule that already exists in
 * ./tools/acceptance-verifier.ts (`conditionMet` / `verifyPrimitive`), which is
 * deterministic, pure and already relied upon. Nothing here is a new semantic:
 * `scroll` expects scrollY to change because that verifier already says so;
 * `double_click` carries TWO conditions because that verifier already requires
 * both. The rules were previously expressed only as a comparison that needs
 * `after` in hand — expectation and verdict fused in one function. This file
 * separates the half that can be known in advance, and takes only that half.
 *
 * WHY THIS FILE CANNOT SEE AN OBSERVATION. `buildExpectation` takes an
 * operation and the caller's own pre-execution declaration. There is no
 * parameter of type `Observation`, and this module does not import one, so
 * "expectation derived from AFTER" is not a mistake that can be made here — it
 * is a type error. Temporal order is therefore proven by shape, not only by
 * timestamps.
 *
 * NO FREE-FORM CRITERION. `relation` is a closed union and `expected_pattern`
 * names a pattern from a fixed registry rather than carrying a regex or a
 * sentence. Nothing in an expectation is text that would later need
 * interpreting, so no model is ever needed to read one back.
 *
 * WHAT IS DELIBERATELY ABSENT. No comparison, no verdict, no PASS/FAIL. An
 * expectation says what to look at and what relation to look for; whether the
 * observations satisfy it is a later step and is not decided anywhere in this
 * file.
 *
 * Input: an operation plus the request's own declarations.
 * Output: ExpectationRecord, buildExpectation, validateExpectation.
 * Dependency ที่อนุญาต: ../computer-use-authority/types (operation vocabulary only).
 * สิ่งที่ห้ามแตะ: ห้ามรับ observation เข้ามาในไฟล์นี้, ห้ามเพิ่ม relation แบบ
 * free-form, ห้ามใส่การเปรียบเทียบหรือคำตัดสินลงที่นี่.
 */
import type { ComputerUseOperation } from "../computer-use-authority/types";

/** Closed set of relations. A relation the software has no rule for cannot be expressed. */
export type ExpectedRelation =
  /** after > before */
  | "INCREASE"
  /** after !== before */
  | "CHANGES"
  /** after === expected_value */
  | "EQUALS"
  /** before !== expected_value AND after === expected_value */
  | "BECOMES"
  /** after matches a named pattern from PATTERNS */
  | "MATCHES";

/**
 * Named patterns, so a MATCHES condition carries a key and never a regex or a
 * sentence. Both are transcribed from acceptance-verifier.ts.
 */
export type ObservablePattern = "DOUBLECLICK_STATE" | "KEY_STATE";
export const PATTERNS: Readonly<Record<ObservablePattern, RegExp>> = Object.freeze({
  DOUBLECLICK_STATE: /DOUBLECLICK/i,
  KEY_STATE: /KEY:/i,
});

/** Every expected effect must say where it came from. Inference is not in this union. */
export type ExpectationOrigin =
  /** The typed per-operation rule that already exists in software. */
  | "OPERATION_CONTRACT"
  /** A value the caller declared in the request, before execution. */
  | "REQUEST_DECLARATION";

/**
 * The observable vocabulary is `EffectState`'s field names — the names the
 * deterministic verifier already uses — paired with the key the current
 * observation source publishes each one under. That pairing is a fact about the
 * source (see ./observation.ts and ./tools/physical-acceptance-runner.ts
 * readState), not a judgement.
 */
export const OBSERVABLE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  clicks: "clicks", dbls: "dbls", state: "st", input: "in", scrollY: "sy",
  dragLeft: "dl", activeElement: "af", maxScrollY: "mx",
  wheelCount: "wc", wheelDeltaY: "wdy", wheelMode: "wdm", wheelTarget: "wt",
});

export interface ExpectedCondition {
  /** Canonical observable name, from the existing verifier vocabulary. */
  observable: string;
  /** The key this observable appears under in an Observation's state. */
  observed_as: string;
  relation: ExpectedRelation;
  /** Required by EQUALS and BECOMES; null otherwise. */
  expected_value: string | null;
  /** Required by MATCHES; null otherwise. Always a registry key, never a pattern literal. */
  expected_pattern: ObservablePattern | null;
  origin: ExpectationOrigin;
}

export interface ExpectationAvailable {
  available: true;
  operation: string;
  /** Stamped when the expectation was built — before the action, by construction. */
  created_at: string;
  conditions: readonly ExpectedCondition[];
}

export interface ExpectationUnavailable {
  available: false;
  operation: string;
  created_at: string;
  /** Why software cannot say what this action should observably do. Never a guess in its place. */
  unavailable_reason: string;
}

export type ExpectationRecord = ExpectationAvailable | ExpectationUnavailable;

/**
 * What a caller may declare about its own intent, before execution. A closed
 * enum, so "intent" can never arrive as free text.
 */
export type DeclaredIntent = "activate" | "focus";

export interface IntentDeclaration {
  /** Stable target identity such as "clickband" or "testinput" — never a coordinate. */
  target?: string;
  intent?: DeclaredIntent;
}

/**
 * Deliberately narrow: an operation, the request's own ui fields, and the
 * caller's declaration. No observation of any kind can be passed in.
 */
export interface ExpectationInput {
  operation: ComputerUseOperation | string;
  /** Only the pre-execution request fields the existing rules already read. */
  ui?: { text?: string };
  intent_declaration?: IntentDeclaration;
}

const cond = (
  observable: string, relation: ExpectedRelation, origin: ExpectationOrigin,
  expected_value: string | null = null, expected_pattern: ObservablePattern | null = null,
): ExpectedCondition => Object.freeze({
  observable, observed_as: OBSERVABLE_KEYS[observable] as string, relation, expected_value, expected_pattern, origin,
});

const unavailable = (operation: string, created_at: string, reason: string): ExpectationUnavailable =>
  Object.freeze({ available: false, operation, created_at, unavailable_reason: reason });

/**
 * Builds the expectation for one operation. Every branch is a transcription of
 * an existing rule; an operation with no such rule returns explicitly
 * unavailable rather than an invented condition.
 */
export function buildExpectation(input: ExpectationInput, now: () => Date = () => new Date()): ExpectationRecord {
  const created_at = now().toISOString();
  const op = String(input.operation);
  const declared = input.intent_declaration ?? {};

  switch (op) {
    case "click": {
      // conditionMet: intent=focus proves focus directly via activeElement, and
      // requires that the target was NOT already focused — that is BECOMES.
      if (declared.intent === "focus") {
        if (!declared.target) return unavailable(op, created_at, "INTENT_FOCUS_WITHOUT_TARGET: the existing rule needs a target identity to state an expectation");
        return Object.freeze({ available: true, operation: op, created_at,
          conditions: Object.freeze([cond("activeElement", "BECOMES", "REQUEST_DECLARATION", declared.target)]) });
      }
      return Object.freeze({ available: true, operation: op, created_at,
        conditions: Object.freeze([cond("clicks", "INCREASE", "OPERATION_CONTRACT")]) });
    }
    case "double_click":
      // Both halves of the existing rule, not just the counter.
      return Object.freeze({ available: true, operation: op, created_at,
        conditions: Object.freeze([
          cond("dbls", "INCREASE", "OPERATION_CONTRACT"),
          cond("state", "MATCHES", "OPERATION_CONTRACT", null, "DOUBLECLICK_STATE"),
        ]) });
    case "scroll":
      return Object.freeze({ available: true, operation: op, created_at,
        conditions: Object.freeze([cond("scrollY", "CHANGES", "OPERATION_CONTRACT")]) });
    case "drag":
      return Object.freeze({ available: true, operation: op, created_at,
        conditions: Object.freeze([cond("dragLeft", "CHANGES", "OPERATION_CONTRACT")]) });
    case "type": {
      // The existing rule has no expectation at all without a declared value.
      const text = input.ui?.text;
      if (typeof text !== "string" || text.length === 0) {
        return unavailable(op, created_at, "NO_DECLARED_TEXT: the existing rule compares the field against a declared value, and none was declared");
      }
      return Object.freeze({ available: true, operation: op, created_at,
        conditions: Object.freeze([cond("input", "EQUALS", "REQUEST_DECLARATION", text)]) });
    }
    case "key":
      return Object.freeze({ available: true, operation: op, created_at,
        conditions: Object.freeze([
          cond("state", "MATCHES", "OPERATION_CONTRACT", null, "KEY_STATE"),
          cond("state", "CHANGES", "OPERATION_CONTRACT"),
        ]) });
    default:
      // pointer_move, focus, screenshot, read_screen, browser_navigate, … The
      // existing verifier returns NOT_PROVEN for these because no observable
      // rule exists. Absence is recorded as absence.
      return unavailable(op, created_at, `NO_DETERMINISTIC_RULE: no typed observable effect contract exists for operation "${op}"`);
  }
}

const RELATIONS = new Set<string>(["INCREASE", "CHANGES", "EQUALS", "BECOMES", "MATCHES"]);

/**
 * Rejects anything that is not a well-formed expectation — including the shapes
 * a free-form or model-authored criterion would take.
 */
export function validateExpectation(value: unknown): { ok: true } | { ok: false; reason: string } {
  if (value === null || typeof value !== "object") return { ok: false, reason: "NOT_AN_OBJECT" };
  // Not `Partial<Available & Unavailable>` — `available: true & false` collapses
  // to never. This is an unknown shape being checked, so it is typed as one.
  const e = value as {
    available?: unknown; operation?: unknown; created_at?: unknown;
    conditions?: unknown; unavailable_reason?: unknown;
  };
  if (typeof e.operation !== "string" || e.operation.length === 0) return { ok: false, reason: "MISSING_OPERATION" };
  if (typeof e.created_at !== "string" || Number.isNaN(Date.parse(e.created_at))) return { ok: false, reason: "MISSING_CREATED_AT" };
  if (e.available === false) {
    return typeof e.unavailable_reason === "string" && e.unavailable_reason.length > 0
      ? { ok: true } : { ok: false, reason: "UNAVAILABLE_WITHOUT_REASON" };
  }
  if (e.available !== true) return { ok: false, reason: "MISSING_AVAILABLE_FLAG" };
  if (!Array.isArray(e.conditions) || e.conditions.length === 0) return { ok: false, reason: "NO_CONDITIONS" };
  for (const c of e.conditions as ExpectedCondition[]) {
    if (c === null || typeof c !== "object") return { ok: false, reason: "CONDITION_NOT_AN_OBJECT" };
    if (typeof c.observable !== "string" || !(c.observable in OBSERVABLE_KEYS)) return { ok: false, reason: `UNKNOWN_OBSERVABLE: ${String(c.observable)}` };
    if (c.observed_as !== OBSERVABLE_KEYS[c.observable]) return { ok: false, reason: `OBSERVED_KEY_MISMATCH: ${String(c.observed_as)}` };
    if (typeof c.relation !== "string" || !RELATIONS.has(c.relation)) return { ok: false, reason: `UNKNOWN_RELATION: ${String(c.relation)}` };
    if (c.relation === "EQUALS" || c.relation === "BECOMES") {
      if (typeof c.expected_value !== "string" || c.expected_value.length === 0) return { ok: false, reason: `${c.relation}_WITHOUT_VALUE` };
    } else if (c.expected_value !== null) return { ok: false, reason: `${c.relation}_MUST_NOT_CARRY_A_VALUE` };
    if (c.relation === "MATCHES") {
      if (typeof c.expected_pattern !== "string" || !(c.expected_pattern in PATTERNS)) return { ok: false, reason: `UNREGISTERED_PATTERN: ${String(c.expected_pattern)}` };
    } else if (c.expected_pattern !== null) return { ok: false, reason: `${c.relation}_MUST_NOT_CARRY_A_PATTERN` };
    if (c.origin !== "OPERATION_CONTRACT" && c.origin !== "REQUEST_DECLARATION") return { ok: false, reason: `DISALLOWED_ORIGIN: ${String(c.origin)}` };
  }
  return { ok: true };
}

/** Recorded when an execution builds no expectation at all — distinct from an operation that has no rule. */
export const NO_EXPECTATION_ATTEMPTED: ExpectationUnavailable = Object.freeze({
  available: false, operation: "", created_at: "",
  unavailable_reason: "NO_EXPECTATION_CONSTRUCTED_FOR_THIS_EXECUTION",
});
