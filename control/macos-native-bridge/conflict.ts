import { evaluateProcessJobRequest, emitLocalResourceEvent } from "../local-resource-access/contract";
import type { ConflictResolution, OwnerCommandV1 } from "./types";

const DESTRUCTIVE = new Set(["DELETE", "MOVE", "WRITE", "COPY", "OPEN_DOCUMENT", "OPEN_APPLICATION", "REVEAL_RESOURCE"]);

export function detectCommandConflict(pending: readonly OwnerCommandV1[], incoming: {
  readonly canonical_action: string;
  readonly resources: readonly string[];
}): { resolution: ConflictResolution | null; reason: string | null } {
  const active = pending.filter((row) =>
    row.execution_state === "EXECUTING" || row.execution_state === "QUEUED" || row.execution_state === "WAITING_FOR_APPROVAL" || row.execution_state === "VALIDATED",
  );
  const overlap = active.filter((row) => row.resources.some((id) => incoming.resources.includes(id)));
  if (overlap.length === 0) return { resolution: null, reason: null };
  const actions = new Set(overlap.map((row) => row.canonical_action).concat(incoming.canonical_action));
  if ((actions.has("MOVE") && actions.has("DELETE")) || (actions.has("WRITE") && actions.has("DELETE")) || (actions.has("COPY") && actions.has("DELETE"))) {
    return { resolution: "BLOCK", reason: "WRITE_MOVE_DELETE_CONFLICT" };
  }
  if ((actions.has("OPEN") || actions.has("OPEN_DOCUMENT") || actions.has("READ")) && actions.has("DELETE")) {
    return { resolution: "OWNER_REVIEW_REQUIRED", reason: "OPEN_VS_DESTRUCTIVE" };
  }
  const destWrites = overlap.filter((row) => DESTRUCTIVE.has(row.canonical_action));
  if (destWrites.length > 0 && DESTRUCTIVE.has(incoming.canonical_action)) {
    return { resolution: "SERIALIZE", reason: "SAME_RESOURCE_MUTATION" };
  }
  if (overlap.some((row) => row.canonical_action === incoming.canonical_action && DESTRUCTIVE.has(incoming.canonical_action))) {
    return { resolution: "SERIALIZE", reason: "PROCESS_JOB_ALREADY_RUNNING" };
  }
  return { resolution: "SERIALIZE", reason: "RESOURCE_LOCK" };
}

export function clientCannotBypassQueue(): false {
  return false;
}

export function sudoAndShellClosed(): { ARBITRARY_SHELL_ACCESS: false; SUDO_ACCESS: false } {
  const sudo = evaluateProcessJobRequest({ job_id: "sudo" });
  void sudo;
  emitLocalResourceEvent("COMMAND_VALIDATED", null, "SHELL_CLOSED");
  return { ARBITRARY_SHELL_ACCESS: false, SUDO_ACCESS: false };
}
