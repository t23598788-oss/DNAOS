/**
 * หน้าที่: the in-memory current state of the joint-monitor dashboard —
 * a bounded ring buffer of recent `JointEvent`/`ViolationEvent` rows plus
 * a Node EventEmitter-shaped "change" signal for ./server.ts's SSE
 * handler to subscribe to. Pure state store: it does not know about
 * HTTP, durable persistence, or any real repo module beyond ./types.ts —
 * matches `../../dna-os-circuit/runtime/circuit-state.ts`'s own "pure
 * state container, unit-testable without touching any real module"
 * discipline exactly, including its hand-rolled single-event emitter
 * (this repo has no `@types/node`, so `node:events` is avoided the same
 * way circuit-state.ts avoids it).
 *
 * Input: `ReportJointInput`/`ReportViolationInput` (via `record*`).
 * Output: `JointMonitorSnapshot`, and a "change" event carrying the row
 * that changed, for ./server.ts's SSE handler.
 * Dependency ที่อนุญาต: ./types.ts.
 * สิ่งที่ห้ามแตะ: never import fs/http/crypto here — durability and id
 * generation are ./host-runtime.ts's and ./server.ts's job, not this
 * file's. Never let the ring buffer grow unbounded — a down/never-read
 * dashboard must never turn into a memory leak for the process that
 * hosts it.
 */

import type { JointEvent, JointMonitorSnapshot, JointReport, OccurrenceStamp, ViolationEvent, ViolationReport } from "./types";

const MAX_JOINTS_IN_MEMORY = 500;
const MAX_VIOLATIONS_IN_MEMORY = 200;

type ChangeListener = (event: { kind: "joint"; row: JointEvent } | { kind: "violation"; row: ViolationEvent }) => void;

/** Minimal single-event emitter — same reasoning as `../../dna-os-circuit/runtime/circuit-state.ts`'s `ChangeEmitter`. */
class ChangeEmitter {
  private listeners: Set<ChangeListener> = new Set();
  on(_event: "change", listener: ChangeListener): this {
    this.listeners.add(listener);
    return this;
  }
  off(_event: "change", listener: ChangeListener): this {
    this.listeners.delete(listener);
    return this;
  }
  protected emit(event: Parameters<ChangeListener>[0]): void {
    for (const listener of this.listeners) listener(event);
  }
}

/**
 * The one ordering rule, used by every consumer (this store's snapshot,
 * ./server.ts's viewer). Deterministic and total: no two distinct rows
 * can compare equal, because `event_id` is unique and breaks any
 * remaining tie, so the same set of rows always renders in the same
 * order no matter what sequence they arrived in.
 *
 * `received_at` is deliberately LAST and only as a tiebreak between rows
 * that no occurrence stamp can separate (rows from different reporter
 * processes claiming the same millisecond). It must never be promoted
 * above the occurrence fields — that is exactly the defect this
 * comparator exists to fix.
 */
export function compareByOccurrence(a: OccurrenceStamp & { received_at: string; event_id: string }, b: OccurrenceStamp & { received_at: string; event_id: string }): number {
  if (a.occurred_at !== b.occurred_at) return a.occurred_at < b.occurred_at ? -1 : 1;
  if (a.reporter_run_id !== b.reporter_run_id) return a.reporter_run_id < b.reporter_run_id ? -1 : 1;
  if (a.occurred_seq !== b.occurred_seq) return a.occurred_seq - b.occurred_seq;
  if (a.received_at !== b.received_at) return a.received_at < b.received_at ? -1 : 1;
  return a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0;
}

export class JointStore extends ChangeEmitter {
  private readonly joints: JointEvent[] = [];
  private readonly violations: ViolationEvent[] = [];

  /** `makeId`/`nowIso` are injected by the caller (./server.ts, via ./host-runtime.ts) — this file never touches `crypto`/`Date` ambiently, keeping it a pure, deterministic-under-test state container. */
  recordJoint(input: JointReport, makeId: () => string, nowIso: () => string): JointEvent {
    const receivedAt = nowIso();
    const row: JointEvent = { ...input, event_id: makeId(), received_at: receivedAt, at: receivedAt };
    this.joints.push(row);
    if (this.joints.length > MAX_JOINTS_IN_MEMORY) this.joints.shift();
    this.emit({ kind: "joint", row });
    return row;
  }

  recordViolation(input: ViolationReport, makeId: () => string, nowIso: () => string): ViolationEvent {
    const receivedAt = nowIso();
    const row: ViolationEvent = { ...input, event_id: makeId(), received_at: receivedAt, at: receivedAt };
    this.violations.push(row);
    if (this.violations.length > MAX_VIOLATIONS_IN_MEMORY) this.violations.shift();
    this.emit({ kind: "violation", row });
    return row;
  }

  /**
   * Rows in EVENT_OCCURRED_ORDER, never in arrival order (2026-08-26).
   * The arrays themselves stay in arrival order on purpose — the ring
   * buffer must evict what was received longest ago, and `received_at`
   * has to survive untouched to stay usable as the transport-latency
   * measurement — so the reordering happens here, on the way out.
   */
  snapshot(): JointMonitorSnapshot {
    return {
      recent_joints: [...this.joints].sort(compareByOccurrence),
      recent_violations: [...this.violations].sort(compareByOccurrence),
      updated_at: new Date().toISOString(),
    };
  }
}
