/**
 * หน้าที่: the storage sink for this capability's Sensor events — the step
 * that turns a live-only dashboard feed into queryable central data (Owner,
 * 2026-08-26). It sends each recorded row to
 * `public.dna_os_sensor_ingest` on the DNA OS Supabase project (schema:
 * ./migrations/0001..0003).
 *
 * IT IS NOT A NEW SENSOR. The Sensor is unchanged: ./client.ts#reportJoint is
 * still the only producer, and `control/agent-gateway/gateway.ts#persistStatus`
 * / `control/command-router/router.ts#admitAndBuildResult` are still its only
 * real call sites. This file sits AFTER ./joint-store.ts has already recorded
 * a row, and only mirrors it.
 *
 * IT IS NOT PART OF THE VIEWER. It is called by ./server.ts's ingest handlers,
 * not by the SSE handler and not by any browser code, so no viewer needs to be
 * open — or ever to have been opened — for events to reach storage. Closing the
 * viewer stops nothing here (Owner requirement 9).
 *
 * NO MODEL WRITES HERE. `classifyResult`/`classifyFailure` below are total
 * functions over the real status string: same input, same output, every time.
 * Nothing on this path asks anything to interpret an event.
 *
 * Input: a recorded `JointEvent`/`ViolationEvent`, plus env
 * `JOINT_MONITOR_SUPABASE_URL`, `JOINT_MONITOR_SUPABASE_ANON_KEY`,
 * `JOINT_MONITOR_SUPABASE_JWT`.
 * Output: `Promise<void>` — resolves whether or not the row landed.
 * Dependency ที่อนุญาต: ./types.ts, ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามให้ storage ที่ล่ม/ไม่ได้ตั้งค่า ทำให้ collector พัง — every path here
 *   resolves, same discipline as ./client.ts.
 * - ห้ามส่ง business payload ใดๆ ขึ้นไป — the gateway's `intent_text` (the
 *   Owner's own words) never reaches this file, and there is no column for it.
 * - ห้ามใช้ service_role key — it bypasses RLS on every business table in that
 *   project. This sink authenticates as `dna_os_sensor_writer`, which can call
 *   exactly one function and nothing else.
 */

import { hostPostJson, readEnvVar } from "./host-runtime";
import type { JointEvent, ViolationEvent } from "./types";

const INGEST_TIMEOUT_MS = 3000;

/** In-flight states are PENDING, not OK: a task that reached EXECUTING has not succeeded yet. */
const IN_FLIGHT_STATES = new Set(["RECEIVED", "ROUTING", "POLICY_CHECK", "EXECUTING", "VERIFYING", "WAITING_OWNER_DECISION"]);
const SUCCESS_STATES = new Set(["COMPLETED", "OK", "VERIFIED", "ADMITTED"]);

export interface SensorEventRow {
  event_id: string;
  occurred_at: string;
  occurred_seq: number;
  reporter_run_id: string;
  received_at: string;
  source_boundary: string;
  target_boundary: string;
  event_type: "JOINT_STATUS" | "BOUNDARY_VIOLATION";
  state_before: string | null;
  state_after: string | null;
  result: "OK" | "FAILED" | "BLOCKED" | "PENDING" | "UNKNOWN";
  failure_class: string | null;
  task_ref: string | null;
  correlation_ref: string | null;
  evidence_source: string;
  evidence_ref: string;
  summary: string;
}

/** Total over any status string, including ones this repo has never emitted — an unknown state is recorded as UNKNOWN, never guessed into a bucket. */
export function classifyResult(status: string): SensorEventRow["result"] {
  if (status === "FAILED") return "FAILED";
  if (status === "BLOCKED") return "BLOCKED";
  if (SUCCESS_STATES.has(status)) return "OK";
  if (IN_FLIGHT_STATES.has(status)) return "PENDING";
  return "UNKNOWN";
}

export function classifyFailure(status: string): string | null {
  if (status === "FAILED") return "TASK_FAILED";
  if (status === "BLOCKED") return "TASK_BLOCKED";
  return null;
}

/**
 * `state_before` stays null: today's Sensor reports only the state it moved
 * INTO. The real previous state is derived in SQL by
 * `dna_os_sensor.v_state_transition` from the events themselves — deriving it
 * here, from a single event, would mean inventing it.
 */
export function jointToSensorRow(row: JointEvent): SensorEventRow {
  return {
    event_id: row.event_id,
    occurred_at: row.occurred_at,
    occurred_seq: row.occurred_seq,
    reporter_run_id: row.reporter_run_id,
    received_at: row.received_at,
    source_boundary: row.from_capability,
    target_boundary: row.to_capability,
    event_type: "JOINT_STATUS",
    state_before: null,
    state_after: row.status,
    result: classifyResult(row.status),
    failure_class: classifyFailure(row.status),
    task_ref: row.task_id,
    correlation_ref: null,
    evidence_source: row.source,
    evidence_ref: `observability/joint-monitor/data/joints.jsonl#${row.event_id}`,
    summary: row.summary,
  };
}

export function violationToSensorRow(row: ViolationEvent): SensorEventRow {
  return {
    event_id: row.event_id,
    occurred_at: row.occurred_at,
    occurred_seq: row.occurred_seq,
    reporter_run_id: row.reporter_run_id,
    received_at: row.received_at,
    source_boundary: row.source,
    target_boundary: "circuit-breaker",
    event_type: "BOUNDARY_VIOLATION",
    state_before: null,
    state_after: null,
    // `enforced` is the real difference between "we detected it" and "we acted
    // on it" — recorded as BLOCKED vs FAILED so the two are never conflated.
    result: row.enforced ? "BLOCKED" : "FAILED",
    failure_class: row.reason,
    task_ref: null,
    correlation_ref: row.launch_id,
    evidence_source: row.source,
    evidence_ref: `observability/joint-monitor/data/violations.jsonl#${row.event_id}`,
    summary: `${row.reason}: ${row.detail}`,
  };
}

interface SinkConfig {
  url: string;
  anonKey: string;
  jwt: string;
}

/** `undefined` when the sink is not configured — the local Mac case, where storage is simply off and the collector behaves exactly as it did before this file existed. */
function sinkConfig(): SinkConfig | undefined {
  const url = readEnvVar("JOINT_MONITOR_SUPABASE_URL");
  const anonKey = readEnvVar("JOINT_MONITOR_SUPABASE_ANON_KEY");
  const jwt = readEnvVar("JOINT_MONITOR_SUPABASE_JWT");
  if (!url || !anonKey || !jwt) return undefined;
  return { url, anonKey, jwt };
}

export function isSinkConfigured(): boolean {
  return sinkConfig() !== undefined;
}

/** Fire-and-forget, exactly like ./client.ts: a storage outage must never break the collector, and the durable jsonl log on disk is written before this is ever called. */
/**
 * The loop breaker (2026-08-26). `ai/sensor-analysis-sandbox/` publishes its
 * validated analyses into this Monitor through the ordinary violation channel.
 * Those records are real Monitor records — but they must never become
 * `dna_os_sensor` rows, because that store is the sandbox's INPUT. Mirroring
 * them would mean the model reads its own conclusions back as if they were
 * sensor readings, which is a return path built by accident. Recognised by the
 * marker the adapter puts on `launch_id`, and dropped here.
 */
export function isAiAnalysisReport(row: SensorEventRow): boolean {
  return row.correlation_ref !== null && row.correlation_ref.startsWith("ai-sensor-analysis:");
}

export async function sinkSensorEvents(rows: readonly SensorEventRow[]): Promise<void> {
  const forwarded = rows.filter((row) => !isAiAnalysisReport(row));
  if (forwarded.length === 0) return;
  const config = sinkConfig();
  if (!config) return;
  await hostPostJson(
    `${config.url}/rest/v1/rpc/dna_os_sensor_ingest`,
    { events: forwarded },
    INGEST_TIMEOUT_MS,
    `Bearer ${config.jwt}`,
    { apikey: config.anonKey },
  );
}
