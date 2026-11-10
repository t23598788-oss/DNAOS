/**
 * Rules engine — condition matching.
 *
 * Pure: no DB, no network. Given one stored rule and one business event it
 * answers only "does this rule apply?". Everything else (resolving roles,
 * sending LINE, logging) happens in dispatch.ts.
 *
 * Condition vocabulary (documented on public.event_rules in the migration):
 *   {}                                  → any event of this type
 *   { "total": 50000 }                  → equality (number/string/boolean)
 *   { "total": { "gte": 50000 } }       → numeric compare (gte/lte/gt/lt)
 *   { "material": { "in": ["ทราย"] } }  → membership
 *   { "material": { "equals": "ทราย", "caseInsensitive": true } }
 *
 * Dotted keys ("customer.province") walk nested payload objects; a missing key
 * simply does not match (never throws).
 */
import type { BusinessEvent, EventRule } from "./types";

/** Read `a.b.c` out of a payload without throwing on missing/holes. */
export function readPath(payload: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  let cursor: unknown = payload;
  for (const part of parts) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function looseEquals(actual: unknown, expected: unknown, caseInsensitive: boolean): boolean {
  if (typeof actual === "string" && typeof expected === "string" && caseInsensitive) {
    return actual.trim().toLowerCase() === expected.trim().toLowerCase();
  }
  return actual === expected;
}

/** Does one condition value match the payload value? */
function matchesValue(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== "object") {
    // Scalars compare numerically when both sides are numeric ("50000" vs 50000).
    const a = asNumber(actual);
    const e = asNumber(expected);
    if (a !== null && e !== null) return a === e;
    return looseEquals(actual, expected, false);
  }

  const spec = expected as Record<string, unknown>;

  if ("equals" in spec) {
    return looseEquals(actual, spec.equals, spec.caseInsensitive === true);
  }
  if (Array.isArray(spec.in)) {
    const list = spec.in;
    const caseInsensitive = spec.caseInsensitive === true;
    return list.some((candidate) => looseEquals(actual, candidate, caseInsensitive));
  }

  const actualNumber = asNumber(actual);
  const compares = ["gte", "lte", "gt", "lt"] as const;
  const used = compares.filter((op) => op in spec);
  if (used.length === 0) return false;
  if (actualNumber === null) return false;

  return used.every((op) => {
    const bound = asNumber(spec[op]);
    if (bound === null) return false;
    if (op === "gte") return actualNumber >= bound;
    if (op === "lte") return actualNumber <= bound;
    if (op === "gt") return actualNumber > bound;
    return actualNumber < bound;
  });
}

/** Human-readable reason for the run log (why a rule did/didn't fire). */
export function explainMatch(rule: EventRule, event: BusinessEvent): { matched: boolean; reason: string } {
  if (!rule.active) return { matched: false, reason: "rule is inactive" };

  // "*" lets a rule observe every event type (used for the exception monitor).
  if (rule.event_type !== "*" && rule.event_type !== event.type) {
    return { matched: false, reason: `event type ${event.type} ≠ rule event type ${rule.event_type}` };
  }

  const conditions = rule.conditions ?? {};
  for (const [path, expected] of Object.entries(conditions)) {
    const actual = readPath(event.payload, path);
    if (!matchesValue(actual, expected)) {
      return { matched: false, reason: `condition ${path} not satisfied` };
    }
  }

  return { matched: true, reason: "event type and all conditions matched" };
}

/** Convenience wrapper used by dispatch and by the UI preview. */
export function matchesEvent(rule: EventRule, event: BusinessEvent): boolean {
  return explainMatch(rule, event).matched;
}
