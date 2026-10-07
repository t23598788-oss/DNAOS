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
 * After persist, the producer-side Display Queue is enqueued — still not a
 * fourth durable rail; Owner Projection reads that queue, never raw
 * evidence JSON.
 *
 * DELIVERY FAILURE NEVER LOSES THE EVENT: the event is persisted FIRST and
 * fan-out failures are recorded against it. A dead channel degrades
 * delivery, never the record.
 *
 * Input: a `SystemEvent`.
 * Output: `emitSystemEvent`, `eventsForWork`, `eventsForCommand`,
 * `eventsForCorrelation`, `eventsSince`, `latestEventForWork`.
 * Dependency ที่อนุญาต: ./types.ts, ./display-queue.ts, ../agent-gateway/contract.ts,
 * ../output-routing/contract.ts, ../../observability/joint-monitor/contract.ts.
 * สิ่งที่ห้ามแตะ: never emit an event that was not persisted first, and
 * never let a consumer failure throw out of `emitSystemEvent` — a broken
 * channel must not stop the work that produced the event.
 */

import { randomUUID } from "node:crypto";
import { saveEvidence, loadEvidenceForTask, loadAllEvidence } from "../agent-gateway/memory-store";
import { resolveOutputConsumers } from "../output-routing/contract";
import { reportJoint } from "../../observability/joint-monitor/contract";
import { enqueueOwnerDisplay } from "./display-queue";
import type { SystemEvent, SystemEventType, SystemEventDraft } from "./types";

const SOURCE_MARKER = "control/owner-backbone/events.ts";

export interface EmitResult {
  readonly event: SystemEvent;
  readonly persisted: true;
  readonly routed_to: readonly string[];
  readonly delivered: boolean;
  readonly delivery_detail: string;
}

function normalizeEvent(row: SystemEvent): SystemEvent {
  return {
    ...row,
    correlation_id: row.correlation_id ?? row.command_id ?? row.work_id ?? row.event_id,
    work_order_id: row.work_order_id ?? row.work_id ?? null,
    actor_icon_ref: row.actor_icon_ref ?? null,
    verification_authority: row.verification_authority ?? null,
    parent_event_id: row.parent_event_id ?? null,
    remote_sha: row.remote_sha ?? null,
    sha_match: row.sha_match ?? null,
    processing_group_id: row.processing_group_id ?? null,
    step_id: row.step_id ?? null,
  };
}

export function buildSystemEvent(input: SystemEventDraft): SystemEvent {
  const event_id = `evt-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const correlation_id = input.correlation_id ?? input.command_id ?? input.work_id ?? event_id;
  return {
    command_id: input.command_id,
    work_id: input.work_id,
    incident_id: input.incident_id,
    event_type: input.event_type,
    state: input.state,
    source: input.source,
    resource_ids: input.resource_ids,
    capability_ids: input.capability_ids,
    evidence_refs: input.evidence_refs,
    next_action: input.next_action,
    event_id,
    observed_at: new Date().toISOString(),
    correlation_id,
    work_order_id: input.work_order_id ?? input.work_id ?? null,
    actor_icon_ref: input.actor_icon_ref ?? null,
    verification_authority: input.verification_authority ?? null,
    parent_event_id: input.parent_event_id ?? null,
    remote_sha: input.remote_sha ?? null,
    sha_match: input.sha_match ?? null,
    processing_group_id: input.processing_group_id ?? null,
    step_id: input.step_id ?? null,
  };
}

function persistSystemEvent(event: SystemEvent): void {
  saveEvidence({
    evidence_id: event.event_id,
    task_id: event.work_id ?? event.command_id ?? event.event_id,
    correlation_id: event.correlation_id,
    work_order_id: event.work_order_id ?? undefined,
    kind: event.event_type === "GITHUB_COMMIT_ACCEPTED" || event.event_type === "VERIFICATION_PASSED" ? "verification" : "execution_output",
    source: SOURCE_MARKER,
    recorded_at: event.observed_at,
    payload: event,
  });
  enqueueOwnerDisplay(event);
}

/**
 * Persist, then Display Queue, then fan out. The persist happens first and
 * unconditionally, so an event survives even when every channel is down.
 */
export async function emitSystemEvent(input: SystemEventDraft): Promise<EmitResult> {
  if (input.event_type === "GITHUB_COMMIT_ACCEPTED") {
    const confirmed = input.sha_match === true
      && input.verification_authority === "GITHUB"
      && typeof input.remote_sha === "string"
      && input.remote_sha.length > 0
      && input.source.includes("github");
    if (!confirmed) {
      throw new Error("GITHUB_REMOTE_VERIFICATION: GITHUB_COMMIT_ACCEPTED requires confirmed remote SHA match from GitHub");
    }
  }
  const event = buildSystemEvent(input);

  persistSystemEvent(event);

  const routing = resolveOutputConsumers({
    lane: "SYSTEM_STATE",
    task_id: event.work_id ?? event.event_id,
    capability_id: "owner-backbone",
    status: event.state,
  } as never) as unknown as { status: string; consumers?: { consumer_id: string }[] };
  const routedTo = routing.consumers?.map((c) => c.consumer_id) ?? [];

  let delivered = false;
  let detail = "";
  try {
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

type SystemEventListener = (event: SystemEvent) => void;
const listeners = new Set<SystemEventListener>();

export function onSystemEvent(listener: SystemEventListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function notifyListeners(event: SystemEvent): void {
  for (const listener of listeners) {
    try { listener(event); } catch { /* recorded by the subscriber, not here */ }
  }
}

function rowsToEvents(rows: readonly { source: string; payload: unknown }[]): readonly SystemEvent[] {
  return rows.filter((r) => r.source === SOURCE_MARKER).map((r) => normalizeEvent(r.payload as SystemEvent));
}

function matchesLineage(event: SystemEvent, id: string): boolean {
  return event.work_id === id
    || event.work_order_id === id
    || event.correlation_id === id
    || event.command_id === id;
}

export function eventsForWork(workId: string): readonly SystemEvent[] {
  const keyed = rowsToEvents(loadEvidenceForTask(workId));
  const scanned = rowsToEvents(loadAllEvidence()).filter((event) => matchesLineage(event, workId));
  const byId = new Map<string, SystemEvent>();
  for (const event of [...keyed, ...scanned]) byId.set(event.event_id, event);
  return [...byId.values()].sort((a, b) => a.event_id.localeCompare(b.event_id));
}

export function eventsForCommand(commandId: string): readonly SystemEvent[] {
  return rowsToEvents(loadAllEvidence()).filter((e) => e.command_id === commandId || e.correlation_id === commandId);
}

export function eventsForCorrelation(correlationId: string): readonly SystemEvent[] {
  return rowsToEvents(loadAllEvidence()).filter((e) => matchesLineage(e, correlationId));
}

export function latestEventForWork(workId: string): SystemEvent | null {
  const events = eventsForWork(workId);
  return events.length > 0 ? events[events.length - 1] : null;
}

export function eventsSince(workId: string, lastEventId: string | null): readonly SystemEvent[] {
  const all = eventsForWork(workId);
  if (lastEventId === null) return all;
  const index = all.findIndex((e) => e.event_id === lastEventId);
  return index < 0 ? all : all.slice(index + 1);
}

export type { SystemEventType };
