/**
 * Persist local execution envelopes for MCP evidence reads.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { dataPath } from "./host-runtime";
import type { LocalExecutionEnvelope } from "./types";

function evidenceFile(): string {
  return dataPath("local-execution-evidence.jsonl", "LOCAL_RESOURCE_EVIDENCE_LOG");
}

export function persistLocalExecution(envelope: LocalExecutionEnvelope): void {
  const p = evidenceFile();
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, `${JSON.stringify(envelope)}\n`, "utf8");
}

export function listLocalExecutions(workId?: string): readonly LocalExecutionEnvelope[] {
  const p = evidenceFile();
  if (!existsSync(p)) return [];
  const rows: LocalExecutionEnvelope[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as LocalExecutionEnvelope;
      if (!workId || row.work_id === workId) rows.push(row);
    } catch {
      /* skip */
    }
  }
  return rows;
}

export function getLocalExecution(executionId: string): LocalExecutionEnvelope | null {
  return listLocalExecutions().find((row) => row.execution_id === executionId) ?? null;
}
