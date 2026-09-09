/**
 * ACTIVITY_VIEW_V1 — chronological projection of existing local resource events.
 * Not a second event system.
 */

import { listLocalResourceEvents } from "../local-resource-access/contract";
import { renderCanonicalView } from "./normalize";
import type { ActivityViewRow, CanonicalViewV1 } from "./types";

export function listActivityViewRows(work_id?: string): readonly ActivityViewRow[] {
  return listLocalResourceEvents(work_id).map((row) => ({
    time: row.timestamp,
    work_id: row.work_id,
    ai_client: null,
    canonical_action: row.action ?? row.detail ?? null,
    resource: row.resource_id ?? null,
    local_execution: row.locality === "LOCAL" || row.locality === undefined,
    network_egress: typeof row.bytes === "number" ? String(row.bytes) : null,
    approval_state: row.authority_decision ?? (row.event === "OWNER_APPROVAL_REQUIRED" ? "OWNER_APPROVAL_REQUIRED" : null),
    result: row.result_status ?? row.event,
    event: row.event,
  })).sort((a, b) => a.time.localeCompare(b.time));
}

export function renderActivityView(work_id?: string): CanonicalViewV1 {
  const rows = listActivityViewRows(work_id);
  return renderCanonicalView({
    view_type: "ACTIVITY_VIEW_V1",
    source_resource_ids: work_id ? [`work:${work_id}`] : [],
    fields: {
      rows,
      event_system: "local-resource-events",
      second_event_system: false,
    },
    actions_available: ["READ"],
    authority_state: "DENY",
  });
}
