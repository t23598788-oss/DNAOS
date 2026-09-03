/**
 * หน้าที่: read the REAL state of a Computer Use target before and after an
 * action, and say honestly when it could not be read (Owner, 2026-09-02).
 *
 * WHAT THIS IS NOT. It is not a verdict and it never becomes one. An
 * observation says "at this moment, this is what the target looked like" and
 * nothing else — no comparison, no expectation, no PASS/FAIL. It is also not
 * dispatch evidence: `mouse_helper=OK`, `OK scroll 0,600`, `os_open=OK` are the
 * adapter reporting that it SENT an action, they live in
 * `ExecutionEvidence.outcome.dispatch_evidence`, and nothing here may promote
 * them.
 *
 * HOW THE STATE IS ACQUIRED. Through macOS Accessibility, exactly as
 * ./tools/physical-acceptance-runner.ts already does: ask System Events for the
 * window titles of one specific process id, and read the target's own published
 * state out of its window title. The page under test is what publishes that
 * state; this file only reads it. No model is involved at any point.
 *
 * THE LIMIT, STATED PLAINLY. Only a target that publishes a `DNAOS|k=v|…`
 * window title can be observed this way, and today that is
 * ./sandbox/acceptance-sandbox.html. Any other target returns `acquired:false`
 * with a reason. That is deliberate: a missing observation must read as
 * "nothing was observed", never as "observed, and everything was zero" — a
 * zeroed state would later look like real evidence that nothing changed.
 *
 * Input: an observation target (a process id).
 * Output: Observation, ObservationSource, observeWindowTitleState.
 * Dependency ที่อนุญาต: node:child_process.
 * สิ่งที่ห้ามแตะ: ห้ามคืนสถานะที่ไม่ได้อ่านมาจริง, ห้ามเติมค่า default แทนค่าที่
 * อ่านไม่ได้, และห้ามเพิ่มการเปรียบเทียบหรือคำตัดสินลงในไฟล์นี้.
 */
import { execFileSync } from "node:child_process";

export type ObservationSource =
  /** macOS Accessibility read of a specific process's window titles. */
  | "ACCESSIBILITY_WINDOW_TITLE"
  /** No observer applied to this execution. */
  | "NONE";

export interface Observation {
  /** False means nothing was read. `state` is then null and `unavailable_reason` says why. */
  acquired: boolean;
  observed_at: string | null;
  source: ObservationSource;
  /** Exactly the key/values the target published. Null whenever `acquired` is false. */
  state: Record<string, string> | null;
  unavailable_reason: string | null;
}

export interface ObservationTarget {
  /** The process whose windows are read. Observation is refused without one rather than guessing a frontmost app. */
  pid?: number;
}

const unavailable = (reason: string, source: ObservationSource = "ACCESSIBILITY_WINDOW_TITLE"): Observation =>
  ({ acquired: false, observed_at: null, source, state: null, unavailable_reason: reason });

/** The prefix a target uses to publish its own observable state in its window title. */
const STATE_TITLE_PREFIX = "DNAOS|";

/**
 * Reads one target's published state. Every failure path returns an explicit
 * unavailable reason; none of them invent a state.
 */
export function observeWindowTitleState(target: ObservationTarget, now: () => Date = () => new Date()): Observation {
  const pid = target.pid;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    return unavailable("NO_OBSERVATION_TARGET: no process id was supplied for this execution");
  }
  let titles: string;
  try {
    titles = String(execFileSync("/usr/bin/osascript", [
      "-e",
      `tell application "System Events" to tell (first process whose unix id is ${pid}) to get name of windows`,
    ], { encoding: "utf8", timeout: 4000 }));
  } catch (error) {
    return unavailable(`ACCESSIBILITY_READ_FAILED: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }

  const segment = titles.split(",").map((part) => part.trim()).find((part) => part.startsWith(STATE_TITLE_PREFIX));
  if (!segment) {
    return unavailable(`TARGET_PUBLISHES_NO_STATE: no window title beginning "${STATE_TITLE_PREFIX}" on pid ${pid}`);
  }

  const title = segment.replace(/ - Google Chrome$/, "");
  const state: Record<string, string> = {};
  for (const part of title.split("|")) {
    const eq = part.indexOf("=");
    if (eq > 0) state[part.slice(0, eq)] = part.slice(eq + 1);
  }
  if (Object.keys(state).length === 0) {
    return unavailable(`TARGET_STATE_UNPARSEABLE: title "${title.slice(0, 60)}" carried no key=value pairs`);
  }
  return { acquired: true, observed_at: now().toISOString(), source: "ACCESSIBILITY_WINDOW_TITLE", state, unavailable_reason: null };
}

/** Used when an execution has no observer wired at all — distinct from an observer that ran and could not read. */
export const NOT_OBSERVED: Observation = { acquired: false, observed_at: null, source: "NONE", state: null, unavailable_reason: "NO_OBSERVER_FOR_THIS_EXECUTION" };
