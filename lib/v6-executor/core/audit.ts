/**
 * Audit Log — ทุก step ถูก log
 */
import type { AuditEntry } from "@/lib/shared/types";

const log: AuditEntry[] = [];
let counter = 0;

export function record(workflow: string, app: string, step: string, result: "success" | "failed", durationMs: number, error?: string): AuditEntry {
  const entry: AuditEntry = { id: ++counter, workflow, app, step, result, durationMs, timestamp: Date.now(), error };
  log.push(entry);
  if (log.length > 500) log.shift();
  return entry;
}

export function recent(n = 20): AuditEntry[] { return log.slice(-n); }
export function clear() { log.length = 0; }
