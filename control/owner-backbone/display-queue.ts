/**
 * Producer-side Display Queue. Runs after a SystemEvent is persisted and
 * before Owner Projection. This is not the execution/coordination queue
 * and not a second event log — SystemEvent in evidence remains the
 * durable record.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { projectOwnerDisplayPayload, type DisplayPayload } from "../owner-projection/display-payload";
import type { SystemEvent } from "./types";

export type DisplayStatus = "REQUESTED" | "ACCEPTED" | "RUNNING" | "BLOCKED" | "FAILED" | "DENIED" | "VERIFIED";

export interface DisplayQueueItem {
  readonly display_queue_id: string;
  readonly event_id: string;
  readonly correlation_id: string;
  readonly work_order_id: string;
  readonly processing_group_id: string;
  readonly step_id: string;
  readonly actor_icon_ref: string;
  readonly status: DisplayStatus;
  readonly human_readable: string;
  readonly details_reference: string;
  readonly priority: number;
  readonly enqueued_at: string;
  readonly projection: DisplayPayload;
}

const ROOT = join(process.cwd(), "control/event-pipeline/data");
const DISPLAY_QUEUE = join(ROOT, "display-queue.jsonl");

function ensure(): void {
  mkdirSync(ROOT, { recursive: true });
  if (!existsSync(DISPLAY_QUEUE)) appendFileSync(DISPLAY_QUEUE, "");
}

function looksLikeRawJson(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.includes("\n  \"");
}

export function displayTextForEvent(event: SystemEvent): string {
  if (event.event_type === "SOURCE_PUBLISH_REQUESTED") return "DNA OS requested GitHub publish";
  if (event.event_type === "GITHUB_REMOTE_OBSERVED") return "GitHub remote branch read back";
  if (event.event_type === "GITHUB_COMMIT_ACCEPTED") return "Commit accepted";
  if (event.event_type === "AGENT_MESSAGE") return "Agent replied";
  if (event.event_type === "WORK_BLOCKED" && (event.verification_authority === "DNA_OS" || event.source.includes("github") || event.source.includes("publish"))) {
    return "GitHub publish not verified from remote SHA";
  }
  if (!looksLikeRawJson(event.next_action)) return event.next_action;
  return event.event_type.replaceAll("_", " ").toLowerCase();
}

function displayStatusFor(event: SystemEvent): DisplayStatus {
  if (event.event_type === "GITHUB_COMMIT_ACCEPTED" && event.sha_match === true && event.verification_authority === "GITHUB" && Boolean(event.remote_sha)) {
    return "VERIFIED";
  }
  if (event.event_type === "SOURCE_PUBLISH_REQUESTED") return "REQUESTED";
  if (event.event_type === "GITHUB_REMOTE_OBSERVED" || event.event_type === "AGENT_MESSAGE") return "ACCEPTED";
  if (event.event_type === "WORK_BLOCKED") return "BLOCKED";
  if (event.event_type === "VERIFICATION_FAILED" || event.event_type === "AGENT_FAILED") return "FAILED";
  if (event.state === "DENIED") return "DENIED";
  if (event.event_type === "WORK_STARTED" || event.event_type === "COMMAND_RECEIVED") return "REQUESTED";
  return "ACCEPTED";
}

function processingGroupId(event: SystemEvent): string {
  if (event.processing_group_id) return event.processing_group_id;
  const correlation = event.correlation_id;
  if (event.event_type === "AGENT_MESSAGE") return `pg-agent-${correlation}`;
  if (
    event.event_type === "SOURCE_PUBLISH_REQUESTED"
    || event.event_type === "GITHUB_REMOTE_OBSERVED"
    || event.event_type === "GITHUB_COMMIT_ACCEPTED"
    || (event.event_type === "WORK_BLOCKED" && event.source.includes("publish"))
  ) {
    return `pg-github-publish-${correlation}`;
  }
  return `pg-${correlation}`;
}

function resultType(event: SystemEvent): string {
  if (event.event_type.startsWith("GITHUB_") || event.event_type === "SOURCE_PUBLISH_REQUESTED") return "github";
  if (event.event_type === "AGENT_MESSAGE" || event.event_type === "AGENT_ALLOCATED" || event.event_type === "AGENT_FAILED") return "agent";
  return "activity";
}

export function projectSystemEventDisplay(event: SystemEvent): DisplayPayload {
  const type = resultType(event);
  const human = displayTextForEvent(event);
  const githubVerified = displayStatusFor(event) === "VERIFIED";
  return projectOwnerDisplayPayload({
    type,
    subject: type === "github" ? "GITHUB" : type === "agent" ? "AGENT" : processingGroupId(event),
    state: human,
    status: displayStatusFor(event),
    icon_ref: event.actor_icon_ref ?? "",
    revision: event.remote_sha ?? "",
    remote_sha: event.remote_sha ?? "",
    sha_match: githubVerified,
    branch: type === "github" ? "main" : "",
    evidence_available: true,
    evidence_id: event.evidence_refs[0] ?? event.event_id,
    details_reference: event.evidence_refs[0] ?? event.event_id,
  });
}

export function ownerSurfaceFrame(event: SystemEvent): Record<string, unknown> {
  const item = listDisplayQueue(event.correlation_id).find((row) => row.event_id === event.event_id);
  const projection = item?.projection ?? projectSystemEventDisplay(event);
  return {
    event_id: event.event_id,
    event_type: event.event_type,
    state: event.state,
    correlation_id: event.correlation_id,
    work_id: event.work_id,
    work_order_id: event.work_order_id,
    observed_at: event.observed_at,
    actor_icon_ref: event.actor_icon_ref,
    details_reference: event.evidence_refs[0] ?? event.event_id,
    display: projection,
  };
}

export function enqueueOwnerDisplay(event: SystemEvent): DisplayQueueItem {
  ensure();
  const existing = listDisplayQueue().find((row) => row.event_id === event.event_id);
  if (existing) return existing;
  const human_readable = displayTextForEvent(event);
  const status = displayStatusFor(event);
  const item: DisplayQueueItem = {
    display_queue_id: `dq-${event.event_id}`,
    event_id: event.event_id,
    correlation_id: event.correlation_id,
    work_order_id: event.work_order_id ?? event.work_id ?? event.correlation_id,
    processing_group_id: processingGroupId(event),
    step_id: event.step_id ?? event.event_type.toLowerCase(),
    actor_icon_ref: event.actor_icon_ref ?? "icon:dna-os",
    status,
    human_readable,
    details_reference: event.evidence_refs[0] ?? event.event_id,
    priority: status === "VERIFIED" ? 10 : status === "RUNNING" || status === "REQUESTED" ? 50 : 30,
    enqueued_at: event.observed_at,
    projection: projectSystemEventDisplay(event),
  };
  appendFileSync(DISPLAY_QUEUE, `${JSON.stringify(item)}\n`);
  return item;
}

export function listDisplayQueue(correlationId?: string): readonly DisplayQueueItem[] {
  ensure();
  const raw = readFileSync(DISPLAY_QUEUE, "utf8");
  if (raw.trim().length === 0) return [];
  const rows = raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as DisplayQueueItem);
  const filtered = correlationId ? rows.filter((row) => row.correlation_id === correlationId || row.work_order_id === correlationId) : rows;
  return [...filtered].sort((a, b) => a.priority - b.priority || a.enqueued_at.localeCompare(b.enqueued_at));
}
