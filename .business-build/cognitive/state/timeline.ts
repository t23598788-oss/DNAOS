/**
 * Timeline — ลำดับเหตุการณ์และเวลา
 *
 * Pure Function
 */

import type { SituationEvent, Timeline } from "./types";

export function buildTimeline(events: SituationEvent[]): Timeline {
  const now = new Date().toISOString();
  const overdue = events.filter(e => e.status === "overdue");

  const upcoming = events
    .filter(e => e.status === "current" || e.status === "planned")
    .sort((a, b) => {
      if (!a.timestamp) return 1;
      if (!b.timestamp) return -1;
      return a.timestamp.localeCompare(b.timestamp);
    });

  return {
    events,
    current_time: now,
    next_deadline: upcoming[0] ?? null,
    overdue_events: overdue,
  };
}
