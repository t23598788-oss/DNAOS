import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { JointEvent } from "../../observability/joint-monitor/types";

export type ActionQueueItem = {
  queue_item_id: string;
  correlation_identity: { type: "task_id"; id: string };
  state: "OPEN" | "BLOCKED" | "WAITING" | "VERIFYING" | "RESOLVED" | "UNKNOWN";
  source: string;
  latest_event_at: string;
  reason: string;
  evidence_refs: string[];
  current_verification: null;
};

const terminal = new Set(["COMPLETED", "PASS", "PASSED", "HEALTHY", "VERIFIED_HEALTHY", "RESOLVED", "CLOSED"]);
const readOnly = (file: string): JointEvent[] => {
  try {
    return readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line) as JointEvent]; } catch { return []; }
    });
  } catch { return []; }
};

function stateOf(status: string): ActionQueueItem["state"] {
  const value = status.toUpperCase();
  if (value === "BLOCKED" || value === "OWNER_REVIEW") return "BLOCKED";
  if (value.includes("WAIT")) return "WAITING";
  if (value === "VERIFYING" || value.includes("VERIF")) return "VERIFYING";
  if (terminal.has(value)) return "RESOLVED";
  if (value === "FAILED" || value === "OPEN" || value === "RUNNING" || value === "EXECUTING") return "OPEN";
  return "UNKNOWN";
}

function isTestOrProbe(event: JointEvent): boolean {
  const text = `${event.source} ${event.from_capability} ${event.to_capability} ${event.summary}`.toLowerCase();
  return /(^|[./:_-])(test|tests|fixture|fixtures|acceptance|probe|canonical-flow|continuation)([./:_-]|$)/.test(text)
    || text.includes("registration-pipeline");
}

export function getCurrentActionQueue(): Record<string, unknown> {
  const dataDir = process.env.JOINT_MONITOR_DATA_DIR ?? join(process.cwd(), "observability/joint-monitor/data");
  const events = readOnly(join(dataDir, "joints.jsonl"));
  const grouped = new Map<string, JointEvent[]>();
  for (const event of events) if (event.task_id) grouped.set(event.task_id, [...(grouped.get(event.task_id) ?? []), event]);
  const items: ActionQueueItem[] = [];
  const needsVerification: ActionQueueItem[] = [];
  let resolved = 0;
  let unknown = 0;
  let testProbeExcluded = 0;
  for (const [taskId, rows] of grouped) {
    rows.sort((a, b) => `${a.occurred_at}|${a.occurred_seq}`.localeCompare(`${b.occurred_at}|${b.occurred_seq}`));
    const latest = rows.at(-1)!;
    const state = stateOf(latest.status);
    const item: ActionQueueItem = {
      queue_item_id: `task:${taskId}`,
      correlation_identity: { type: "task_id", id: taskId },
      state,
      source: latest.source,
      latest_event_at: latest.occurred_at,
      reason: latest.summary,
      evidence_refs: rows.map((row) => `observability/joint-monitor/data/joints.jsonl#${row.event_id}`),
      current_verification: null,
    };
    if (isTestOrProbe(latest)) {
      testProbeExcluded++;
      continue;
    }
    if (state === "RESOLVED") resolved++;
    else {
      // A persisted non-terminal event is historical evidence, not a current
      // failure. No deterministic current observation is attached to these
      // rows yet, so they remain visible but cannot enter the Owner queue.
      unknown++;
      needsVerification.push(item);
    }
  }
  const historicalEventCount = events.length;
  return {
    observed_at: new Date().toISOString(),
    active_count: items.length,
    items,
    needs_verification: needsVerification,
    source: "observability/joint-monitor/data/joints.jsonl",
    historical_event_count: historicalEventCount,
    correlated_issue_count: grouped.size,
    resolved_count: resolved,
    unknown_count: unknown,
    test_probe_excluded_count: testProbeExcluded,
    duplicate_collapsed_count: Math.max(0, events.filter((event) => event.task_id).length - grouped.size),
  };
}
