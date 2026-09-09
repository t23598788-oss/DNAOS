/**
 * DATA_EGRESS_POLICY_V1 recording. Secrets/credentials are always DENIED.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { dataPath, nowIso } from "./host-runtime";
import type { AuthorityDecision, DataClassification, DataEgressRecord, NetworkEgressPolicy } from "./types";

function egressFile(): string {
  return dataPath("data-egress.jsonl", "LOCAL_RESOURCE_EGRESS_LOG");
}

export function classifyEgressPayload(value: unknown): DataClassification {
  const blob = JSON.stringify(value);
  if (/\b(ghp_|github_pat_|BEGIN (RSA |OPENSSH )?PRIVATE KEY)/.test(blob)) return "CREDENTIAL";
  if (/password|secret[_-]?key/i.test(blob)) return "SECRET";
  return "INTERNAL";
}

export function recordDataEgress(input: Omit<DataEgressRecord, "schema" | "timestamp">): DataEgressRecord {
  const classification = input.data_classification;
  let policy_state: NetworkEgressPolicy = input.policy_state;
  let bytes_actually_sent = input.bytes_actually_sent;
  let authority_decision: AuthorityDecision = input.authority_decision;
  if (classification === "SECRET" || classification === "CREDENTIAL") {
    policy_state = "DENIED";
    bytes_actually_sent = 0;
    authority_decision = "DENY";
  }
  const row: DataEgressRecord = {
    schema: "DATA_EGRESS_POLICY_V1",
    ...input,
    data_classification: classification,
    policy_state,
    bytes_actually_sent,
    authority_decision,
    timestamp: nowIso(),
  };
  const p = egressFile();
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, `${JSON.stringify(row)}\n`, "utf8");
  return row;
}

export function listDataEgress(workId?: string): readonly DataEgressRecord[] {
  const p = egressFile();
  if (!existsSync(p)) return [];
  const rows: DataEgressRecord[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as DataEgressRecord;
      if (!workId || row.work_id === workId) rows.push(row);
    } catch {
      /* skip */
    }
  }
  return rows;
}
