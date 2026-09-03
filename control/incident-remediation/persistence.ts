/**
 * หน้าที่: §I — persist/resume the remediation record. NO NEW STORE: this
 * delegates to the EXISTING durable evidence store,
 * `../agent-gateway/contract.ts#saveEvidence`/`#loadEvidenceForTask`, the
 * same one `../work-resolution/persistence.ts` already uses.
 *
 * Keyed by incident_id so a fresh worker given ONLY an incident_id (or a
 * work_id) recovers the whole loop state — attempts, failed providers,
 * observation, verification, next_action — with no rediscovery.
 *
 * Input: `RemediationRecord`.
 * Output: `saveRemediation`, `loadRemediation`, `loadRemediationByWorkId`.
 * Dependency ที่อนุญาต: ./types.ts, ../agent-gateway/contract.ts.
 * สิ่งที่ห้ามแตะ: never write a remediation row from anywhere but
 * `saveRemediation` — every state change must land in the same append-only
 * trail, so "what happened" is reconstructible.
 */

import { saveEvidence, loadEvidenceForTask } from "../agent-gateway/contract";
import type { RemediationRecord } from "./types";

const SOURCE_MARKER = "control/incident-remediation/persistence.ts";

/** Append-only: every save is a new row, so the attempt history survives. */
export function saveRemediation(record: RemediationRecord): RemediationRecord {
  saveEvidence({
    evidence_id: `remediation-${record.incident_id}-${Date.now()}-${record.attempts.length}`,
    task_id: record.incident_id,
    kind: "recovery",
    source: SOURCE_MARKER,
    recorded_at: record.updated_at,
    payload: record,
  });
  return record;
}

function latestFor(taskId: string): RemediationRecord | null {
  const rows = loadEvidenceForTask(taskId)
    .filter((e) => e.source === SOURCE_MARKER && e.kind === "recovery")
    .sort((a, b) => a.evidence_id.localeCompare(b.evidence_id));
  const latest = rows[rows.length - 1];
  return latest ? (latest.payload as RemediationRecord) : null;
}

export function loadRemediation(incidentId: string): RemediationRecord | null {
  return latestFor(incidentId);
}

/** work_id is `work-<incident_id>` by construction — see remediation.ts#openRemediation. */
export function loadRemediationByWorkId(workId: string): RemediationRecord | null {
  return workId.startsWith("work-") ? latestFor(workId.slice("work-".length)) : null;
}
