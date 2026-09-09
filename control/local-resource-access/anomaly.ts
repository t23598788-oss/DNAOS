/**
 * Read-only anomaly classification. Never remediates.
 */

import { emitLocalResourceEvent } from "./events";
import type { AnomalyObservation } from "./types";

export function classifyAnomaly(
  kind: string,
  detail: string,
  work_id: string | null,
  session_id?: string,
  resource_id?: string,
): AnomalyObservation {
  let className: AnomalyObservation["class"] = "OBSERVE";
  if (kind === "WORKSPACE_ESCAPE" || kind === "UNAUTHORIZED_FILE_ACCESS" || kind === "BLOCKED_CAPABILITY" || kind === "UNEXPECTED_SPAWN") {
    className = "BLOCKED";
  } else if (kind === "UNEXPECTED_PROCESS" || kind === "NEW_LISTENING_PORT" || kind === "UNEXPECTED_NETWORK_DESTINATION") {
    className = "OWNER_REVIEW_REQUIRED";
  } else if (kind === "CPU_SPIKE" || kind === "MEMORY_SPIKE") {
    className = "OBSERVE";
  }
  const row: AnomalyObservation = { class: className, kind, detail, automatic_remediation: false };
  emitLocalResourceEvent("ANOMALY_DETECTED", work_id, `${kind}:${className}`, undefined, {
    session_id, resource_id, authority_decision: className === "BLOCKED" ? "DENY" : "ALLOW", locality: "LOCAL",
  });
  return row;
}
