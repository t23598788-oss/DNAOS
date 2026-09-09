import { randomUUID } from "node:crypto";
import { emitLocalResourceEvent } from "../local-resource-access/contract";
import { nowIso } from "./host-runtime";
import { listPersistedCommands, persistCommand } from "./persist";
import { detectCommandConflict } from "./conflict";
import type { CommandQueueState, OwnerCommandV1 } from "./types";

function latestById(): Map<string, OwnerCommandV1> {
  const map = new Map<string, OwnerCommandV1>();
  for (const row of listPersistedCommands<OwnerCommandV1>()) map.set(row.command_id, row);
  return map;
}

export function listCommandQueue(): readonly OwnerCommandV1[] {
  return [...latestById().values()];
}

export function getCommandStatus(command_id: string): OwnerCommandV1 | null {
  return latestById().get(command_id) ?? null;
}

export function persistCommandState(row: OwnerCommandV1): OwnerCommandV1 {
  persistCommand(row);
  return row;
}

export function enqueueOwnerCommand(input: Omit<OwnerCommandV1, "schema" | "command_id" | "created_at" | "execution_state" | "conflict_resolution" | "conflict_reason" | "result_ref" | "observed_events" | "verification"> & {
  readonly command_id?: string;
  readonly execution_state?: CommandQueueState;
}): OwnerCommandV1 {
  emitLocalResourceEvent("COMMAND_RECEIVED", input.work_id, input.canonical_action, undefined, {
    session_id: input.session_id, locality: "LOCAL", action: input.canonical_action,
  });
  const conflict = detectCommandConflict(listCommandQueue(), { canonical_action: input.canonical_action, resources: input.resources });
  const command: OwnerCommandV1 = {
    schema: "OWNER_COMMAND_QUEUE_V1",
    ...input,
    command_id: input.command_id ?? `cmd-${randomUUID()}`,
    created_at: nowIso(),
    result_ref: null,
    observed_events: [],
    verification: null,
    conflict_resolution: conflict.resolution,
    conflict_reason: conflict.reason,
    dependencies: conflict.resolution === "SERIALIZE"
      ? [...input.dependencies, ...listCommandQueue().filter((row) => row.resources.some((id) => input.resources.includes(id)) && (row.execution_state === "QUEUED" || row.execution_state === "EXECUTING" || row.execution_state === "WAITING_FOR_APPROVAL")).map((row) => row.command_id)]
      : input.dependencies,
    execution_state: conflict.resolution === "BLOCK" ? "BLOCKED" : (input.execution_state ?? "RECEIVED"),
  };
  persistCommand(command);
  emitLocalResourceEvent(command.execution_state === "BLOCKED" ? "COMMAND_CONFLICT" : "COMMAND_QUEUED", input.work_id, command.command_id, undefined, {
    session_id: input.session_id, locality: "LOCAL", action: conflict.reason ?? command.execution_state,
  });
  return command;
}

export function updateCommand(command_id: string, patch: Partial<OwnerCommandV1>): OwnerCommandV1 | null {
  const current = getCommandStatus(command_id);
  if (!current) return null;
  const next = { ...current, ...patch };
  persistCommand(next);
  return next;
}
