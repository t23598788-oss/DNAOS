/**
 * JSONL observability stream for local resource access. Reader only — no dashboard.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { dataPath, nowIso } from "./host-runtime";
import type { LocalObservabilityEvent, LocalObservabilityEventType } from "./types";

function eventFile(): string {
  return dataPath("local-resource-events.jsonl", "LOCAL_RESOURCE_EVENTS_LOG");
}

export function emitLocalResourceEvent(
  event: LocalObservabilityEventType,
  work_id: string | null,
  detail?: string,
  execution_id?: string,
    extras: {
    readonly session_id?: string;
    readonly resource_id?: string;
    readonly authority_decision?: LocalObservabilityEvent["authority_decision"];
    readonly locality?: LocalObservabilityEvent["locality"];
    readonly action?: string;
    readonly bytes?: number;
    readonly result_status?: LocalObservabilityEvent["result_status"];
  } = {},
): LocalObservabilityEvent {
  const row: LocalObservabilityEvent = {
    event,
    timestamp: nowIso(),
    work_id,
    ...(execution_id ? { execution_id } : {}),
    ...(detail ? { detail } : {}),
    ...(extras.session_id ? { session_id: extras.session_id } : {}),
    ...(extras.resource_id ? { resource_id: extras.resource_id } : {}),
    ...(extras.authority_decision ? { authority_decision: extras.authority_decision } : {}),
    ...(extras.locality ? { locality: extras.locality } : {}),
    ...(extras.action ? { action: extras.action } : {}),
    ...(typeof extras.bytes === "number" ? { bytes: extras.bytes } : {}),
    ...(extras.result_status ? { result_status: extras.result_status } : {}),
  };
  const p = eventFile();
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, `${JSON.stringify(row)}\n`, "utf8");
  return row;
}

export function listLocalResourceEvents(workId?: string): readonly LocalObservabilityEvent[] {
  const p = eventFile();
  if (!existsSync(p)) return [];
  const rows: LocalObservabilityEvent[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as LocalObservabilityEvent;
      if (!workId || row.work_id === workId) rows.push(row);
    } catch {
      /* skip */
    }
  }
  return rows;
}
