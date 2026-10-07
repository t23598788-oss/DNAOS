/**
 * หน้าที่: record where the pointer was and which process was frontmost in the
 * instant before an input is dispatched — because a scroll wheel event carries
 * no coordinate and the window server routes it by exactly those two facts
 * (Owner, 2026-09-02).
 *
 * WHY IT CANNOT BE RECOVERED LATER. Reading the pointer now says where the
 * cursor is now. Nothing in the OS keeps a history of it, so routing context
 * for a past execution is not merely missing — it is unrecoverable. That is why
 * this is an execution-time capture and why no backfill function exists in this
 * file or anywhere downstream.
 *
 * THE NAME IS "IMMEDIATELY BEFORE", AND THAT IS DELIBERATE. The dispatch that
 * matters happens inside mouse-helper, several microseconds and one process
 * boundary away, and nothing there reports back. So the honest strongest claim
 * is that these two readings were taken with no observation, no await and no
 * other work between them and the adapter call — not that they were sampled at
 * the instant the CGEvent left. Calling this AT_DISPATCH would be a claim the
 * source cannot support.
 *
 * A PRODUCER THAT CANNOT SAY "I FAILED". `mouse-helper pos` computes
 * `CGEvent(source: nil)?.location ?? .zero` — if the read fails it prints
 * `POS 0 0`, which is also what a cursor genuinely parked at the top-left
 * corner prints. The producer cannot distinguish the two, so neither can this
 * file: an exact (0,0) is recorded as NOT acquired, with a reason naming the
 * ambiguity. Storing it as a position would manufacture the strongest kind of
 * false evidence — a fabricated coordinate that looks measured.
 *
 * THE THIRD FACT, AND WHY IT NEEDED AN IDENTITY. Routing also depends on where
 * the target window actually is. Asking for "the frontmost window's bounds"
 * would be a different fact wearing the target's name, so bounds are read only
 * for a window that belongs to the execution's own target pid AND publishes the
 * target's state title — the same identity Step 3's observer already uses. Zero
 * matches or more than one is a refusal, never a pick-the-first.
 *
 * THREE READS, NOT ONE INSTANT. The three facts come from three producers and
 * cannot be sampled atomically, so each carries its own timestamp and the record
 * never claims they were simultaneous. They are ordered slowest-and-most-stable
 * first: window bounds, then frontmost pid, then pointer position — the pointer
 * is the cheapest read and the most volatile, so it sits closest to the dispatch.
 *
 * FACTS ONLY. This file records a point, a pid and a rectangle. Whether the pointer was over
 * the target, whether that window could have received the event, whether
 * routing succeeded — none of those appear here in any form. They are
 * conclusions, and they belong to a later deterministic procedure operating on
 * this evidence.
 *
 * Input: the execution's observation target (a pid) — everything else is read
 *   live from the OS through three existing read-only producers.
 * Output: RoutingContext, captureRoutingContext, NOT_CAPTURED.
 * Dependency ที่อนุญาต: node:child_process, node:path.
 * สิ่งที่ห้ามแตะ: ห้ามคืนพิกัดที่ไม่ได้อ่านมาจริง, ห้ามเติม 0 แทนค่าที่อ่านไม่ได้,
 * ห้ามใส่ข้อสรุปเรื่อง routing ลงไฟล์นี้, ห้าม backfill ของเก่า.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * The only capture point this contract supports. Named for what the code can
 * prove: taken after the BEFORE observation, with nothing between it and the
 * adapter invocation.
 */
export type RoutingContextCapturePoint = "IMMEDIATELY_BEFORE_DISPATCH";

export type RoutingContextSource =
  | "MOUSE_HELPER_POS"
  | "SYSTEM_EVENTS_FRONTMOST"
  | "SYSTEM_EVENTS_WINDOW_BOUNDS"
  | "NONE";

/** How the one window among a process's windows was identified. */
export type WindowIdentitySource = "TARGET_PUBLISHED_STATE_TITLE" | "NONE";

export interface WindowBounds { x: number; y: number; width: number; height: number }

/** Finite. There is no free-form failure text on this record. */
export type RoutingContextFailureReason =
  | "NO_ROUTING_CONTEXT_CAPTURE_FOR_THIS_EXECUTION"
  | "POINTER_PRODUCER_FAILED"
  | "POINTER_OUTPUT_UNPARSEABLE"
  /** The producer prints POS 0 0 both for a real top-left cursor and for a failed read. */
  | "POINTER_VALUE_INDISTINGUISHABLE_FROM_READ_FAILURE"
  | "FRONTMOST_PRODUCER_FAILED"
  | "FRONTMOST_OUTPUT_UNPARSEABLE"
  | "NO_TARGET_PID"
  | "TARGET_PROCESS_NOT_FOUND"
  | "TARGET_WINDOW_NOT_FOUND"
  /** More than one window of the target pid carries the identity marker. Refused rather than picked. */
  | "TARGET_WINDOW_AMBIGUOUS"
  | "WINDOW_POSITION_READ_FAILED"
  | "WINDOW_SIZE_READ_FAILED"
  /** Read and parsed, but not a usable rectangle — width or height not positive. */
  | "WINDOW_BOUNDS_INVALID";

export interface RoutingContext {
  /** True only when ALL THREE facts were really read. Never a partial claim dressed as a whole one. */
  acquired: boolean;
  capture_point: RoutingContextCapturePoint;
  /** Null whenever it was not read. Never {x:0,y:0} as a stand-in. */
  pointer_position: { x: number; y: number } | null;
  pointer_source: RoutingContextSource;
  pointer_acquired_at: string | null;
  /** Null whenever it was not read. Never a guessed or remembered pid. */
  frontmost_pid: number | null;
  frontmost_source: RoutingContextSource;
  frontmost_acquired_at: string | null;
  /** The execution's own target — the pid the bounds must belong to. */
  target_pid: number | null;
  /**
   * The target window's real on-screen rectangle. Null whenever it was not
   * read; never a zeroed rectangle. x=0 or y=0 is a perfectly valid position
   * (a full-screen window sits at 0,0) and is kept; a non-positive width or
   * height is not a rectangle and is refused.
   */
  target_window_bounds: WindowBounds | null;
  bounds_source: RoutingContextSource;
  window_identity_source: WindowIdentitySource;
  bounds_acquired_at: string | null;
  /** Provenance metadata for the capture as a whole. It never decides anything. */
  acquired_at: string | null;
  failure_reason: RoutingContextFailureReason | null;
}

/** Recorded when an execution captured no routing context at all — distinct from a capture that failed. */
export const NOT_CAPTURED: RoutingContext = Object.freeze({
  acquired: false,
  capture_point: "IMMEDIATELY_BEFORE_DISPATCH",
  pointer_position: null,
  pointer_source: "NONE",
  pointer_acquired_at: null,
  frontmost_pid: null,
  frontmost_source: "NONE",
  frontmost_acquired_at: null,
  target_pid: null,
  target_window_bounds: null,
  bounds_source: "NONE",
  window_identity_source: "NONE",
  bounds_acquired_at: null,
  acquired_at: null,
  failure_reason: "NO_ROUTING_CONTEXT_CAPTURE_FOR_THIS_EXECUTION",
});

type PointerRead =
  | { ok: true; position: { x: number; y: number } }
  | { ok: false; reason: RoutingContextFailureReason };

function readPointer(): PointerRead {
  let out: string;
  try {
    out = String(execFileSync(join(process.cwd(), "connections/os-ui/bin/mouse-helper"), ["pos"], { encoding: "utf8", timeout: 4000 })).trim();
  } catch {
    return { ok: false, reason: "POINTER_PRODUCER_FAILED" };
  }
  const m = /^POS\s+(-?\d+)\s+(-?\d+)$/.exec(out);
  if (!m) return { ok: false, reason: "POINTER_OUTPUT_UNPARSEABLE" };
  const x = Number(m[1]), y = Number(m[2]);
  // See the header: the producer's `?? .zero` makes exactly (0,0) ambiguous
  // between a real corner cursor and a failed read. Refuse rather than guess.
  if (x === 0 && y === 0) return { ok: false, reason: "POINTER_VALUE_INDISTINGUISHABLE_FROM_READ_FAILURE" };
  return { ok: true, position: { x, y } };
}

type FrontmostRead = { ok: true; pid: number } | { ok: false; reason: RoutingContextFailureReason };

function readFrontmostPid(): FrontmostRead {
  let out: string;
  try {
    out = String(execFileSync("/usr/bin/osascript", [
      "-e", 'tell application "System Events" to get unix id of first process whose frontmost is true',
    ], { encoding: "utf8", timeout: 4000 })).trim();
  } catch {
    return { ok: false, reason: "FRONTMOST_PRODUCER_FAILED" };
  }
  const pid = Number(out);
  if (!Number.isInteger(pid) || pid <= 0) return { ok: false, reason: "FRONTMOST_OUTPUT_UNPARSEABLE" };
  return { ok: true, pid };
}

/**
 * Reads both facts back to back. Ordering is fixed — pointer first, then
 * frontmost — so the record's meaning does not vary between executions, and the
 * caller invokes the adapter on the next statement with nothing in between.
 *
 * A partial read is recorded as partial: the fact that WAS read is kept, the
 * one that was not stays null, and `acquired` is false with the first failure's
 * reason. Keeping a real reading is better than discarding it, and `acquired`
 * still refuses to call the pair complete.
 */
type BoundsRead =
  | { ok: true; bounds: WindowBounds }
  | { ok: false; reason: RoutingContextFailureReason };

/** The title prefix a target uses to publish its own state — the same identity marker ./observation.ts reads. */
const IDENTITY_TITLE_PREFIX = "DNAOS|";

/**
 * Reads the bounds of the ONE window of `pid` that carries the identity marker.
 *
 * The filter runs inside System Events, so only numbers cross the boundary and
 * no window title is ever parsed here — a title containing a comma cannot
 * misalign the result. Count comes back with the geometry in a single round
 * trip, which both keeps the read close to the dispatch and makes "how many
 * windows matched" a fact rather than an inference from list length.
 */
function readTargetWindowBounds(pid: number | undefined, titlePrefix: string): BoundsRead {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return { ok: false, reason: "NO_TARGET_PID" };
  let out: string;
  try {
    out = String(execFileSync("/usr/bin/osascript", [
      "-e",
      `tell application "System Events" to tell (first process whose unix id is ${pid}) to get {count of (every window whose name starts with "${titlePrefix}"), position of (every window whose name starts with "${titlePrefix}"), size of (every window whose name starts with "${titlePrefix}")}`,
    ], { encoding: "utf8", timeout: 4000 })).trim();
  } catch {
    // System Events raises the same error shape whether the process is gone or
    // unreachable, so this stays at the coarser, honest code.
    return { ok: false, reason: "TARGET_PROCESS_NOT_FOUND" };
  }

  const parts = out.split(",").map((v) => v.trim());
  const count = Number(parts[0]);
  if (!Number.isInteger(count)) return { ok: false, reason: "WINDOW_POSITION_READ_FAILED" };
  if (count === 0) return { ok: false, reason: "TARGET_WINDOW_NOT_FOUND" };
  // Two or more windows of this process publish the marker. Which one the event
  // would reach is exactly what is unknown, so picking one would invent the answer.
  if (count > 1) return { ok: false, reason: "TARGET_WINDOW_AMBIGUOUS" };

  const nums = parts.slice(1).map((v) => Number(v));
  if (nums.length < 2 || !Number.isFinite(nums[0]!) || !Number.isFinite(nums[1]!)) return { ok: false, reason: "WINDOW_POSITION_READ_FAILED" };
  if (nums.length < 4 || !Number.isFinite(nums[2]!) || !Number.isFinite(nums[3]!)) return { ok: false, reason: "WINDOW_SIZE_READ_FAILED" };
  const [x, y, width, height] = nums as [number, number, number, number];
  // x=0 / y=0 are real positions — a full-screen window sits at 0,0. A
  // non-positive width or height is not a rectangle at all.
  if (width <= 0 || height <= 0) return { ok: false, reason: "WINDOW_BOUNDS_INVALID" };
  return { ok: true, bounds: { x, y, width, height } };
}

export interface RoutingContextTarget {
  /** The execution's observation target — the process the bounds must belong to. */
  pid?: number;
}

/**
 * Reads the three facts back to back, each stamped with its own acquisition
 * time. Ordering is fixed so the record's meaning does not vary between
 * executions: window bounds first (the slowest read, and the most stable fact),
 * then the frontmost pid, then the pointer position last — the cheapest read and
 * the most volatile fact, so it sits closest to the dispatch that follows on the
 * caller's next statement.
 *
 * Partial reads are recorded as partial: each fact that WAS read is kept, each
 * that was not stays null, and `acquired` is false with the first failure's
 * reason. Keeping a real reading beats discarding it; `acquired` still refuses
 * to call the set complete.
 */
export function captureRoutingContext(
  target: RoutingContextTarget = {},
  now: () => Date = () => new Date(),
  titlePrefix: string = IDENTITY_TITLE_PREFIX,
): RoutingContext {
  const bounds = readTargetWindowBounds(target.pid, titlePrefix);
  const boundsAt = now().toISOString();
  const frontmost = readFrontmostPid();
  const frontmostAt = now().toISOString();
  const pointer = readPointer();
  const pointerAt = now().toISOString();

  const acquired = pointer.ok && frontmost.ok && bounds.ok;
  const firstFailure: RoutingContextFailureReason | null = acquired ? null
    : !bounds.ok ? bounds.reason
      : !frontmost.ok ? frontmost.reason
        : (pointer as { reason: RoutingContextFailureReason }).reason;

  return {
    acquired,
    capture_point: "IMMEDIATELY_BEFORE_DISPATCH",
    pointer_position: pointer.ok ? pointer.position : null,
    pointer_source: "MOUSE_HELPER_POS",
    pointer_acquired_at: pointerAt,
    frontmost_pid: frontmost.ok ? frontmost.pid : null,
    frontmost_source: "SYSTEM_EVENTS_FRONTMOST",
    frontmost_acquired_at: frontmostAt,
    target_pid: typeof target.pid === "number" ? target.pid : null,
    target_window_bounds: bounds.ok ? bounds.bounds : null,
    bounds_source: "SYSTEM_EVENTS_WINDOW_BOUNDS",
    window_identity_source: "TARGET_PUBLISHED_STATE_TITLE",
    bounds_acquired_at: boundsAt,
    acquired_at: pointerAt,
    failure_reason: firstFailure,
  };
}
