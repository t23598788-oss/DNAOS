/**
 * หน้าที่: turn the helper's explicit CGEvent instrumentation line into two
 * separate typed facts — was the event constructed, and was post() invoked —
 * and refuse to claim anything the API cannot report (Owner, 2026-09-02).
 *
 * WHAT THE SDK ACTUALLY PROVES, read from CGEvent.h rather than from names:
 *   CGEventCreateScrollWheelEvent2 returns `CGEventRef __nullable`
 *     → construction CAN fail, and failure is a null reference.
 *   CGEventPost returns `void`
 *     → no return value, no acceptance acknowledgement, no delivery signal.
 * So exactly two boundaries are observable here: CGEVENT_CONSTRUCTION and
 * CGEVENT_POST_INVOCATION. There is deliberately no CGEVENT_ACCEPTED and no
 * window-server state in this file — nothing in the API acknowledges either, and
 * a boundary named for an acknowledgement that does not exist would be the same
 * false evidence this whole track was built to remove.
 *
 * WHY THE OLD LINE COULD NEVER DO THIS. `OK scroll 0,600` was printed on the
 * line after `e?.post(...)`, unconditionally — a null event produced silence
 * from the poster and an OK from the printer. That string therefore proves the
 * helper process ran and reached that print, and this file never reads it.
 * `parseCgEventInstrumentation` looks only for the explicit `CGEVENT …` line; a
 * row carrying OK and nothing else comes back UNAVAILABLE, which is what every
 * execution written before this change will report, forever.
 *
 * PARTIAL RESULTS DO NOT ROUND UP. If a command ever creates more than one
 * event, one construction failure makes the operation-level construction FAILED
 * and post invocation NOT_REACHED. "Most of it worked" is not a state.
 *
 * Input: the dispatch evidence lines already preserved on an ExecutionEvidence row.
 * Output: CgEventInstrumentation, parseCgEventInstrumentation, NO_CGEVENT_INSTRUMENTATION.
 * Dependency ที่อนุญาต: none (pure string parsing over already-persisted data).
 * สิ่งที่ห้ามแตะ: ห้ามอ่านบรรทัด OK เป็นหลักฐาน CGEvent, ห้ามสรุปว่า WindowServer
 * รับ/ส่งต่อ, ห้ามยุบผลบางส่วนเป็นสำเร็จ, ห้าม backfill แถวเก่า.
 */

/** Per-boundary state. FAILED means a real negative report; UNAVAILABLE means nothing reported. */
export type CgEventBoundaryState = "REACHED" | "FAILED" | "NOT_REACHED" | "UNAVAILABLE";

export type CgEventInstrumentationSource = "MOUSE_HELPER_CGEVENT_INSTRUMENTATION" | "NONE";

/** Exactly the codes the helper can emit. Anything else is not instrumentation. */
export type CgEventResultCode = "CGEVENT_CONSTRUCTED" | "CGEVENT_POST_INVOKED" | "CGEVENT_CONSTRUCTION_FAILED";

/** Finite. No free-form explanation exists on this record. */
export type CgEventReasonCode =
  | "ALL_EVENTS_CONSTRUCTED_AND_POST_INVOKED"
  | "CONSTRUCTION_FAILED_FOR_AT_LEAST_ONE_EVENT"
  | "INSTRUMENTATION_ABSENT"
  | "INSTRUMENTATION_UNPARSEABLE"
  | "EVENT_COUNT_MISMATCH"
  | "UNKNOWN_RESULT_CODE";

export interface CgEventInstrumentation {
  source: CgEventInstrumentationSource;
  operation: string | null;
  /** How many events the helper said this command creates. Null when nothing was reported. */
  declared_event_count: number | null;
  /** One entry per event, in the helper's own order. Never summarised away. */
  event_results: readonly { index: number; result: CgEventResultCode }[];
  construction: CgEventBoundaryState;
  post_invocation: CgEventBoundaryState;
  reason_code: CgEventReasonCode;
}

/** What every execution written before this instrumentation existed reports. Not a failure — an absence. */
export const NO_CGEVENT_INSTRUMENTATION: CgEventInstrumentation = Object.freeze({
  source: "NONE",
  operation: null,
  declared_event_count: null,
  event_results: Object.freeze([]),
  construction: "UNAVAILABLE",
  post_invocation: "UNAVAILABLE",
  reason_code: "INSTRUMENTATION_ABSENT",
});

const RESULT_CODES: ReadonlySet<string> = new Set(["CGEVENT_CONSTRUCTED", "CGEVENT_POST_INVOKED", "CGEVENT_CONSTRUCTION_FAILED"]);

const unavailable = (reason: CgEventReasonCode, operation: string | null, count: number | null, results: { index: number; result: CgEventResultCode }[] = []): CgEventInstrumentation => ({
  source: "MOUSE_HELPER_CGEVENT_INSTRUMENTATION",
  operation, declared_event_count: count, event_results: Object.freeze(results),
  construction: "UNAVAILABLE", post_invocation: "UNAVAILABLE", reason_code: reason,
});

/**
 * Reads the helper's instrumentation out of the dispatch evidence lines.
 *
 * The expected line is `CGEVENT <operation> events=<n> event1=<CODE> …`. The
 * `OK …` line is deliberately not consulted: it is legacy dispatch evidence and
 * proves only that the helper reached its own print statement.
 */
export function parseCgEventInstrumentation(evidenceLines: readonly string[] | undefined): CgEventInstrumentation {
  // The os-ui adapter records the helper's ENTIRE trimmed stdout as a single
  // evidence element, so a multi-line helper output arrives as one string with
  // embedded newlines. Splitting first is what makes the instrumentation line
  // findable at all — searching elements alone silently found nothing.
  const line = (evidenceLines ?? [])
    .filter((l): l is string => typeof l === "string")
    .flatMap((l) => l.split("\n"))
    .map((l) => l.trim())
    .find((l) => l.startsWith("CGEVENT "));
  if (!line) return NO_CGEVENT_INSTRUMENTATION;

  const parts = line.trim().split(/\s+/);
  const operation = parts[1] ?? null;
  const countPart = parts.find((p) => p.startsWith("events="));
  const declared = countPart ? Number(countPart.slice("events=".length)) : NaN;
  if (!operation || !Number.isInteger(declared) || declared <= 0) return unavailable("INSTRUMENTATION_UNPARSEABLE", operation, null);

  const results: { index: number; result: CgEventResultCode }[] = [];
  for (const part of parts) {
    const m = /^event(\d+)=(.+)$/.exec(part);
    if (!m) continue;
    const index = Number(m[1]);
    const code = m[2]!;
    if (!Number.isInteger(index) || index <= 0) return unavailable("INSTRUMENTATION_UNPARSEABLE", operation, declared);
    if (!RESULT_CODES.has(code)) return unavailable("UNKNOWN_RESULT_CODE", operation, declared);
    results.push({ index, result: code as CgEventResultCode });
  }

  // Every declared event must have reported, or the set is not a whole answer.
  if (results.length !== declared) return unavailable("EVENT_COUNT_MISMATCH", operation, declared, results);

  const failed = results.some((r) => r.result === "CGEVENT_CONSTRUCTION_FAILED");
  const base = { source: "MOUSE_HELPER_CGEVENT_INSTRUMENTATION" as const, operation, declared_event_count: declared, event_results: Object.freeze(results) };
  if (failed) {
    // A construction failure means post() was never reached for that event, and
    // the operation as a whole does not get to claim otherwise.
    return { ...base, construction: "FAILED", post_invocation: "NOT_REACHED", reason_code: "CONSTRUCTION_FAILED_FOR_AT_LEAST_ONE_EVENT" };
  }
  // POST_INVOKED implies the event existed to be posted; CONSTRUCTED alone means
  // built but post not reported, so post stays UNAVAILABLE rather than assumed.
  const allPosted = results.every((r) => r.result === "CGEVENT_POST_INVOKED");
  return {
    ...base,
    construction: "REACHED",
    post_invocation: allPosted ? "REACHED" : "UNAVAILABLE",
    reason_code: allPosted ? "ALL_EVENTS_CONSTRUCTED_AND_POST_INVOKED" : "INSTRUMENTATION_UNPARSEABLE",
  };
}
