/**
 * หน้าที่: the FIXED INPUT CONTRACT for `ai/sensor-analysis-sandbox/` — the
 * only shape the local Qwen sandbox is ever given, built from
 * `dna_os_sensor`'s read-only reader role and nothing else (Owner,
 * 2026-08-26).
 *
 * This file is an allow-list, not a filter. A field reaches the model only
 * because it is named here; anything the reader RPC returns and this file does
 * not name never reaches the prompt. That is why `summary` is absent: it is
 * producer-written free text, and the rule for this round is that the model
 * sees system facts, never a payload it could read prose out of.
 *
 * Input: rows from `public.dna_os_sensor_events` / `public.dna_os_sensor_pattern`
 * (read-only role `dna_os_sensor_reader`).
 * Output: `SandboxInput` — a plain JSON value, serialisable, with no handles,
 * no callbacks and no credentials in it.
 * Dependency ที่อนุญาต: none (pure types + pure projection).
 * สิ่งที่ห้ามแตะ:
 * - ห้ามใส่ business payload — `intent_text` never enters `dna_os_sensor` at
 *   all, and `summary`/`correlation_ref` are dropped here on purpose.
 * - ห้ามใส่ credential, env, path, หรือ repo content ลงใน input ใดๆ — the
 *   sandbox's whole isolation claim rests on this object being the entire
 *   world the model can see.
 */

/** One raw event, reduced to the system facts a pattern claim can be checked against. */
export interface SandboxEvent {
  event_id: string;
  occurred_at: string;
  occurred_seq: number;
  joint_id: string;
  state_after: string | null;
  result: string;
  failure_class: string | null;
  transport_latency_ms: number | null;
  task_ref: string | null;
  evidence_ref: string;
}

export interface SandboxPatterns {
  repeated_sequence: readonly unknown[];
  repeated_failure: readonly unknown[];
  joint_health: readonly unknown[];
  latency_outlier: readonly unknown[];
  unexpected_transition: readonly unknown[];
}

export interface SandboxInput {
  analysis_id: string;
  window: { from: string; to: string };
  patterns: SandboxPatterns;
  events: readonly SandboxEvent[];
}

const EVENT_FIELDS: readonly (keyof SandboxEvent)[] = [
  "event_id", "occurred_at", "occurred_seq", "joint_id", "state_after",
  "result", "failure_class", "transport_latency_ms", "task_ref", "evidence_ref",
];

/** Projects a reader-RPC row down to the allow-listed fields. Unknown fields are dropped, never passed through. */
export function projectEvent(row: Record<string, unknown>): SandboxEvent {
  const projected: Record<string, unknown> = {};
  for (const field of EVENT_FIELDS) projected[field] = row[field] ?? null;
  return projected as unknown as SandboxEvent;
}

/**
 * Everything the model is allowed to refer to. The output validator checks
 * every claimed id against these sets, so a fabricated reference cannot pass
 * review even if the model produces one.
 */
export function referenceUniverse(input: SandboxInput): { eventIds: Set<string>; evidenceRefs: Set<string>; jointIds: Set<string> } {
  return {
    eventIds: new Set(input.events.map((event) => event.event_id)),
    evidenceRefs: new Set(input.events.map((event) => event.evidence_ref)),
    jointIds: new Set(input.events.map((event) => event.joint_id)),
  };
}
