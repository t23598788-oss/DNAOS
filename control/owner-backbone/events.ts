/**
 * หน้าที่: §5/§6 — emit every `SystemEvent` down ONE path, and read them
 * back for §13/§14 (state queries and reconnect replay).
 *
 * NO NEW EVENT BUS. Emission fans out to the two boundaries that already
 * exist and are already registered consumers:
 *   - `../output-routing/#resolveOutputConsumers` decides WHO may receive
 *     it (the canonical routing answer, unchanged).
 *   - `../../observability/joint-monitor/#reportJoint` delivers it to the
 *     live Owner surface, which ALREADY implements SSE with
 *     `Last-Event-ID`/`?since=` replay — so §14's reconnect requirement is
 *     satisfied by reuse, not by a new stream.
 * Durability reuses `../agent-gateway/#saveEvidence`, the same append-only
 * store `work-resolution` and `incident-remediation` already persist into.
 *
 * DELIVERY FAILURE NEVER LOSES THE EVENT: the event is persisted FIRST and
 * fan-out failures are recorded against it. A dead channel degrades
 * delivery, never the record.
 *
 * Input: a `SystemEvent`.
 * Output: `emitSystemEvent`, `eventsForWork`, `eventsForCommand`,
 * `eventsSince`, `latestEventForWork`.
 * Dependency ที่อนุญาต: ./types.ts, ../agent-gateway/contract.ts,
 * ../output-routing/contract.ts, ../../observability/joint-monitor/contract.ts.
 * สิ่งที่ห้ามแตะ: never emit an event that was not persisted first, and
 * never let a consumer failure throw out of `emitSystemEvent` — a broken
 * channel must not stop the work that produced the event.
 */

import { randomUUID } from "node:crypto";
import { saveEvidence, loadEvidenceForTask, loadAllEvidence } from "../agent-gateway/contract";
import { resolveOutputConsumers } from "../output-routing/contract";
import { reportJoint } from "../../observability/joint-monitor/contract";
import type { SystemEvent, SystemEventType } from "./types";

const SOURCE_MARKER = "control/owner-backbone/events.ts";

export interface EmitResult {
  readonly event: SystemEvent;
  readonly persisted: true;
  readonly routed_to: readonly string[];
  readonly delivered: boolean;
  readonly delivery_detail: string;
}

export function buildSystemEvent(input: Omit<SystemEvent, "event_id" | "observed_at">): SystemEvent {
  return { ...input, event_id: `evt-${Date.now()}-${randomUUID().slice(0, 8)}`, observed_at: new Date().toISOString() };
}

/**
 * Persist, then fan out. The persist happens first and unconditionally, so
 * an event survives even when every channel is down.
 */
export async function emitSystemEvent(input: Omit<SystemEvent, "event_id" | "observed_at">): Promise<EmitResult> {
  const event = buildSystemEvent(input);

  // 1. DURABILITY FIRST. Keyed by work_id when there is one, so
  //    `eventsForWork` is a direct read rather than a scan.
  saveEvidence({
    evidence_id: event.event_id,
    task_id: event.work_id ?? event.command_id ?? event.event_id,
    kind: "execution_output",
    source: SOURCE_MARKER,
    recorded_at: event.observed_at,
    payload: event,
  });

  // 2. ROUTING — decided by the existing boundary, not by this module.
  const routing = resolveOutputConsumers({
    lane: "SYSTEM_STATE",
    task_id: event.work_id ?? event.event_id,
    capability_id: "owner-backbone",
    status: event.state,
  } as never) as unknown as { status: string; consumers?: { consumer_id: string }[] };
  const routedTo = routing.consumers?.map((c) => c.consumer_id) ?? [];

  // 3. DELIVERY to the live Owner surface. A failure here is recorded, not
  //    thrown — the event is already durable.
  let delivered = false;
  let detail = "";
  try {
    // reportJoint now returns the REAL transport result (fixed 2026-08-26
    // in observability/joint-monitor/client.ts). Delivery is READ from it —
    // never inferred from "the call returned".
    // THE REAL `ReportJointInput` — `{ from_capability, to_capability,
    // task_id, status, summary, source }`. It previously sent
    // `{ caller, callee, detail, correlation_id }` behind an `as never`,
    // which the collector rejected with 400 on EVERY event; the void
    // return hid it. Same class of bug as the owner-escalation payload
    // (2026-08-26). The contract was right, the caller was wrong — never
    // cast a payload past a contract.
    const sent = await reportJoint({
      from_capability: "control/owner-backbone",
      to_capability: event.source,
      task_id: event.work_id ?? event.command_id,
      status: event.state,
      summary: `${event.event_type}: ${event.next_action}`,
      source: `${SOURCE_MARKER}#emitSystemEvent`,
    });
    delivered = sent.ok === true;
    detail = `routing=${routing.status}; transport ok=${String(sent.ok)}`;
  } catch (error) {
    delivered = false;
    detail = `delivery failed: ${error instanceof Error ? error.message : String(error)} — the event REMAINS persisted`;
  }

  notifyListeners(event);
  return { event, persisted: true, routed_to: routedTo, delivered, delivery_detail: detail };
}

/**
 * §14 live tail. NOT a new event bus: it is an in-process notification of
 * the ONE emit path above, so an already-open SSE response can be written
 * to without polling the evidence store. It carries no delivery guarantee —
 * durability is the `saveEvidence` call, and a client that missed events
 * recovers them through `eventsSince`, never through this.
 */
type SystemEventListener = (event: SystemEvent) => void;
const listeners = new Set<SystemEventListener>();

export function onSystemEvent(listener: SystemEventListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function notifyListeners(event: SystemEvent): void {
  for (const listener of listeners) {
    // A broken subscriber must never break the emit path.
    try { listener(event); } catch { /* recorded by the subscriber, not here */ }
  }
}

function rowsToEvents(rows: readonly { source: string; payload: unknown }[]): readonly SystemEvent[] {
  return rows.filter((r) => r.source === SOURCE_MARKER).map((r) => r.payload as SystemEvent);
}

export function eventsForWork(workId: string): readonly SystemEvent[] {
  return [...rowsToEvents(loadEvidenceForTask(workId))].sort((a: SystemEvent, b: SystemEvent) => a.event_id.localeCompare(b.event_id));
}

export function eventsForCommand(commandId: string): readonly SystemEvent[] {
  return rowsToEvents(loadAllEvidence()).filter((e) => e.command_id === commandId);
}

export function latestEventForWork(workId: string): SystemEvent | null {
  const events = eventsForWork(workId);
  return events.length > 0 ? events[events.length - 1] : null;
}

/**
 * §14 — replay from a reconnecting interface's `last_event_id`. Mirrors the
 * semantics joint-monitor's SSE already uses (`?since=` names the LAST
 * event the client saw; everything AFTER it is returned). An unknown id
 * returns everything, because a client that cannot be placed must not be
 * silently given a partial history.
 */
export function eventsSince(workId: string, lastEventId: string | null): readonly SystemEvent[] {
  const all = eventsForWork(workId);
  if (lastEventId === null) return all;
  const index = all.findIndex((e) => e.event_id === lastEventId);
  return index < 0 ? all : all.slice(index + 1);
}

export type { SystemEventType };
