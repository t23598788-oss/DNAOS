/**
 * หน้าที่: the deterministic core — build the reverse dependency index, and
 * decide whether an arriving event makes a waiting work item resume-eligible.
 *
 * PURE. No I/O, no clock, no filesystem, no network. Everything it needs is
 * passed in, so `./tests/work-continuation.test.ts` can prove every branch —
 * including the loop-safety and stale-resolution branches — without staging a
 * repository. That purity is also what makes the Owner's invariant
 * `AI_DECISION_IN_RESUME_PATH=NO` structural: there is nowhere in this file for
 * a model to be consulted.
 *
 * Input: `WaitingWork[]`, a `DependencyEvent`, the set of already-satisfied keys.
 * Output: `buildIndex`, `affectedWorkIds`, `evaluate`, `digestOf`.
 * Dependency ที่อนุญาต: ./types.ts, node:crypto (hashing only).
 * สิ่งที่ห้ามแตะ: never let `evaluate` return RESUME_ELIGIBLE for an
 * OWNER_DECISION item — no event, and no number of events, may ever stand in for
 * the Owner. Never widen the loop-safety check into "resume anyway if it has
 * been a while": time is not evidence.
 */

import { createHash } from "node:crypto";
import type { DependencyEvent, DependencyIndex, DependencyKey, Evaluation, WaitingWork } from "./types";

/** Bounded retry. A waiting item may be woken at most this many times before it needs a human or a changed result. */
export const MAX_RESUME_ATTEMPTS = 5;

/** Stable digest of whatever a caller wants pinned. Used for loop safety, never for identity. */
export function digestOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex").slice(0, 16);
}

/**
 * REVERSE INDEX. key -> work_ids waiting on it. Built by reducing the persisted
 * waiting rows; there is no separate list to keep in sync, so it cannot drift
 * from the rows it describes.
 *
 * Only non-terminal rows are indexed. A RESUMED/RETIRED row must never be woken
 * again by a replayed event — that is the first half of duplicate-wake defence,
 * the second half being the digest check in `evaluate`.
 */
export function buildIndex(rows: readonly WaitingWork[], builtAt: string): DependencyIndex {
  const waiting = new Map<DependencyKey, string[]>();
  let indexed = 0;
  for (const row of rows) {
    if (row.status === "RESUMED" || row.status === "RETIRED") continue;
    indexed += 1;
    for (const key of row.blocked_on) {
      const list = waiting.get(key) ?? [];
      if (!list.includes(row.work_id)) list.push(row.work_id);
      waiting.set(key, list);
    }
  }
  return { waiting, indexed_work: indexed, built_at: builtAt };
}

/**
 * Which work ids an event touches. THIS is the "do not scan all work" guarantee:
 * a single map lookup, no iteration over the work population, no repository read.
 */
export function affectedWorkIds(index: DependencyIndex, event: DependencyEvent): readonly string[] {
  return index.waiting.get(event.key) ?? [];
}

/**
 * Evaluate ONE waiting item against ONE event, given every key already known to
 * be satisfied. Order of the checks is deliberate and is the whole safety
 * argument:
 *
 *   1. terminal status      — a resumed/retired item is never re-woken
 *   2. OWNER_DECISION       — refused before any key arithmetic can suggest otherwise
 *   3. loop safety          — identical trigger + unchanged result = refuse
 *   4. retry budget         — bounded, so a flapping dependency cannot spin forever
 *   5. stale resolution     — reported BEFORE eligibility, so nothing resumes against a moved world
 *   6. resume condition     — the only place a RESUME_ELIGIBLE can be produced
 */
export function evaluate(
  row: WaitingWork,
  event: DependencyEvent,
  satisfiedKeys: ReadonlySet<DependencyKey>,
  currentResolutionDigest: string | null,
  /**
   * The work's CURRENT result digest, read by the caller from the existing
   * work-session-state journal. Required, not optional: the loop-safety rule is
   * "same trigger AND unchanged result", and an earlier draft of this function
   * compared `row.last_result_digest` against itself — a tautology that silently
   * disabled the whole check. Passing the real current value is what makes the
   * rule mean anything.
   */
  currentResultDigest: string | null,
): Evaluation {
  const inputDigest = digestOf({ key: event.key, value: event.value, evidence_ref: event.evidence_ref });
  const satisfied = row.blocked_on.filter((k) => satisfiedKeys.has(k) || k === event.key);
  const missing = row.blocked_on.filter((k) => !satisfied.includes(k));
  const base = { work_id: row.work_id, satisfied, missing, input_digest: inputDigest };

  if (row.status === "RESUMED" || row.status === "RETIRED") {
    return { ...base, verdict: "STILL_BLOCKED", reason: `work is ${row.status}; a terminal row is never re-woken` };
  }

  if (row.resume_condition === "OWNER_DECISION") {
    return { ...base, verdict: "OWNER_DECISION_REQUIRED", reason: "resume_condition is OWNER_DECISION — no event may stand in for the Owner" };
  }

  // LOOP SAFETY: the same trigger, with the work's result unchanged since that
  // trigger, cannot produce a second execution. Replay is therefore inert.
  if (row.resume_attempt_count > 0 && row.last_input_digest === inputDigest && row.last_result_digest === currentResultDigest) {
    return { ...base, verdict: "STILL_BLOCKED", reason: `identical trigger digest ${inputDigest} already produced attempt #${row.resume_attempt_count} and the result digest is unchanged (${String(currentResultDigest)}) — replay is inert` };
  }

  if (row.resume_attempt_count >= MAX_RESUME_ATTEMPTS) {
    return { ...base, verdict: "OWNER_DECISION_REQUIRED", reason: `retry budget exhausted (${row.resume_attempt_count}/${MAX_RESUME_ATTEMPTS}) — a human decides whether this keeps trying` };
  }

  // STALE RESOLUTION: the world moved while this waited. Reported before
  // eligibility so nothing is ever dispatched against a resolution that no
  // longer describes the repository.
  if (row.last_verified_revision !== null && currentResolutionDigest !== null && row.last_verified_revision !== currentResolutionDigest) {
    return {
      ...base,
      verdict: "STALE_RESOLUTION",
      reason: `resolution digest moved ${row.last_verified_revision} -> ${currentResolutionDigest} while waiting; DNA OS must re-resolve before this runs`,
    };
  }

  if (row.resume_condition === "EXACT_STATE") {
    const want = row.exact_state;
    if (!want) return { ...base, verdict: "STILL_BLOCKED", reason: "resume_condition is EXACT_STATE but no exact_state was recorded" };
    const hit = event.key === want.key && event.value === want.equals;
    return hit
      ? { ...base, verdict: "RESUME_ELIGIBLE", reason: `EXACT_STATE satisfied: ${want.key} == ${want.equals}` }
      : { ...base, verdict: "STILL_BLOCKED", reason: `EXACT_STATE wants ${want.key} == ${want.equals}; event carried ${event.key} == ${String(event.value)}` };
  }

  if (row.resume_condition === "ANY_AVAILABLE") {
    return satisfied.length > 0
      ? { ...base, verdict: "RESUME_ELIGIBLE", reason: `ANY_AVAILABLE satisfied by ${satisfied[0]}` }
      : { ...base, verdict: "STILL_BLOCKED", reason: "ANY_AVAILABLE: no dependency key satisfied yet" };
  }

  // ALL_AVAILABLE
  return missing.length === 0
    ? { ...base, verdict: "RESUME_ELIGIBLE", reason: `ALL_AVAILABLE satisfied: ${satisfied.length}/${row.blocked_on.length} keys` }
    : { ...base, verdict: "STILL_BLOCKED", reason: `ALL_AVAILABLE: still missing ${missing.length} key(s): ${missing.slice(0, 3).join(", ")}` };
}
