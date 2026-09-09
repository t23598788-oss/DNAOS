import { emitLocalResourceEvent, listLocalResourceEvents } from "../local-resource-access/contract";
import { nowIso } from "./host-runtime";
import { listPersistedCorrelations, persistCorrelation } from "./persist";
import type { ActivityClass, MacosEventCorrelationV1 } from "./types";

const BACKGROUND = /kernel_task|WindowServer|launchd|syslogd|mDNSResponder|node|Cursor|cfprefsd/;

export function classifyActivity(input: {
  readonly event_type: string;
  readonly process?: string | null;
  readonly command_id?: string | null;
  readonly expected?: boolean;
  readonly path_escape?: boolean;
}): ActivityClass {
  if (input.path_escape) return "POLICY_VIOLATION_ATTEMPT";
  if (input.expected && input.command_id) return "EXPECTED";
  if (input.process && BACKGROUND.test(input.process)) return "BACKGROUND_KNOWN";
  if (!input.command_id) return "UNRELATED";
  return "UNEXPECTED";
}

export function correlateMacosEvent(input: {
  readonly event_type: string;
  readonly command_id?: string | null;
  readonly work_id?: string | null;
  readonly execution_id?: string | null;
  readonly process?: string | null;
  readonly resource?: string | null;
  readonly application?: string | null;
  readonly expected?: boolean;
  readonly path_escape?: boolean;
}): MacosEventCorrelationV1 {
  const classification = classifyActivity(input);
  const row: MacosEventCorrelationV1 = {
    schema: "MACOS_EVENT_CORRELATION_V1",
    event_type: input.event_type,
    command_id: input.command_id ?? null,
    work_id: input.work_id ?? null,
    execution_id: input.execution_id ?? null,
    process: input.process ?? null,
    resource: input.resource ?? null,
    application: input.application ?? null,
    timestamp: nowIso(),
    classification,
    expected: Boolean(input.expected),
    policy_correlation: classification,
  };
  persistCorrelation(row);
  emitLocalResourceEvent("MACOS_EVENT_CORRELATED", input.work_id ?? null, input.event_type, input.execution_id ?? undefined, {
    resource_id: input.resource ?? undefined,
    action: input.command_id ?? undefined,
    locality: "LOCAL",
  });
  return row;
}

export function listSystemActivity(work_id?: string): readonly MacosEventCorrelationV1[] {
  const rows = listPersistedCorrelations<MacosEventCorrelationV1>();
  const filtered = work_id ? rows.filter((row) => row.work_id === work_id) : rows;
  const fromStream = listLocalResourceEvents(work_id).filter((row) => row.event === "MACOS_EVENT_CORRELATED");
  void fromStream;
  return filtered;
}
