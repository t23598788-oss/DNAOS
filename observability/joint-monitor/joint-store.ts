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

import type { JointEvent, JointMonitorSnapshot, ReportJointInput, ReportViolationInput, ViolationEvent } from "./types";

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

export class JointStore extends ChangeEmitter {
  private readonly joints: JointEvent[] = [];
  private readonly violations: ViolationEvent[] = [];

  /** `makeId`/`nowIso` are injected by the caller (./server.ts, via ./host-runtime.ts) — this file never touches `crypto`/`Date` ambiently, keeping it a pure, deterministic-under-test state container. */
  recordJoint(input: ReportJointInput, makeId: () => string, nowIso: () => string): JointEvent {
    const row: JointEvent = { ...input, event_id: makeId(), at: nowIso() };
    this.joints.push(row);
    if (this.joints.length > MAX_JOINTS_IN_MEMORY) this.joints.shift();
    this.emit({ kind: "joint", row });
    return row;
  }

  recordViolation(input: ReportViolationInput, makeId: () => string, nowIso: () => string): ViolationEvent {
    const row: ViolationEvent = { ...input, event_id: makeId(), at: nowIso() };
    this.violations.push(row);
    if (this.violations.length > MAX_VIOLATIONS_IN_MEMORY) this.violations.shift();
    this.emit({ kind: "violation", row });
    return row;
  }

  snapshot(): JointMonitorSnapshot {
    return {
      recent_joints: [...this.joints],
      recent_violations: [...this.violations],
      updated_at: new Date().toISOString(),
    };
  }
}
