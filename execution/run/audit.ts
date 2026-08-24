/**
 * หน้าที่: the execution audit event contract + a stable recording
 * interface. The durable file audit store in `../../audit/command-audit/`
 * is the default sink; the in-memory sink remains available for isolated
 * tests.
 *
 * Input: the fields of a completed (or refused) execution.
 * Output: `ExecutionAuditEvent`, `ExecutionAuditSink`,
 * `createInMemoryAuditSink`, `defaultAuditSink`.
 * Dependency ที่อนุญาต: ./types.ts, ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ: never put raw (non-sanitized) stdout/stderr text
 * directly on `ExecutionAuditEvent` — only a `stdout_hash`/`stderr_hash`
 * reference, matching `ExecutionResult`. Never make `record()` throw —
 * a failing audit write must never take down an execution that already
 * happened; a sink that cannot durably persist should log and continue,
 * not throw into `./executor.ts`.
 *
 */

import { hostLog, nowIso } from "./host-runtime";
import type { ExecutionErrorCode, ExecutionStatus } from "./types";
import { createFileAuditSink } from "../../audit/command-audit/file-audit-sink";

export interface ExecutionAuditEvent {
  execution_id: string;
  correlation_id: string;
  command_id: string;
  identity_id: string;
  account_id: string;
  workspace_id: string;
  permission_decision_id: string;
  started_at: string | null;
  completed_at: string | null;
  exit_code: number | null;
  status: ExecutionStatus;
  error_code: ExecutionErrorCode | null;
  duration_ms: number | null;
  verification_result: "workspace_unchanged" | "workspace_changed_as_expected" | "workspace_policy_violation" | "not_verified";
  /** A reference, never the raw content — the same hash `ExecutionResult.stdoutHash`/`stderrHash` already carries. */
  stdout_reference: string | null;
  stderr_reference: string | null;
  recorded_at: string;
}

export interface ExecutionAuditSink {
  record(event: ExecutionAuditEvent): void;
  list(): readonly ExecutionAuditEvent[];
}

/** The only implementation this round provides. Process-local, bounded by nothing external — intentional, since this is a placeholder for a real store, never presented as durable audit storage. */
export function createInMemoryAuditSink(): ExecutionAuditSink {
  const events: ExecutionAuditEvent[] = [];
  return {
    record(event: ExecutionAuditEvent) {
      events.push(event);
    },
    list() {
      return [...events];
    },
  };
}

export const defaultAuditSink: ExecutionAuditSink = createFileAuditSink();

export function buildAuditEvent(input: Omit<ExecutionAuditEvent, "recorded_at">): ExecutionAuditEvent {
  return { ...input, recorded_at: nowIso() };
}

/** Best-effort console mirror so a failing sink is still observable during development — never the sole record. */
export function logAuditEvent(event: ExecutionAuditEvent): void {
  hostLog(`[execution-audit] ${event.execution_id} ${event.command_id} -> ${event.status}${event.error_code ? ` (${event.error_code})` : ""}`);
}
