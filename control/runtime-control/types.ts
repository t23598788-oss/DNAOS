/**
 * หน้าที่: type contracts for `control/runtime-control/` — a bounded
 * Runtime Control Adapter over the four local dev-runtime services DNA OS
 * currently owns (Deadboard, Lab/Monitor UI, its research API, its compute
 * API). launchd remains the only real process supervisor/executor; this
 * capability never spawns, forks, or polls a process itself — it only
 * issues one-shot `launchctl`/HTTP calls and records what was actually
 * true before and after, per the Owner's explicit architecture:
 * DNA OS Control -> Runtime Control Adapter -> launchd -> Process ->
 * Health/Evidence -> DNA OS.
 *
 * Input: none (pure type definitions).
 * Output: `ServiceId`, `Action`, `ServiceDefinition`, `HealthCheckResult`,
 * `LaunchdState`, `DuplicateCheck`, `OperationEvidence`.
 * Dependency ที่อนุญาต: none — a leaf contract.
 * สิ่งที่ห้ามแตะ: never add a field to `OperationEvidence` that isn't
 * populated from a real, host-runtime-observed fact — this record is the
 * evidence the Owner explicitly required (service identity, launchd
 * label, requested action, PID before/after, port, health result,
 * timestamp, exit/result status, failure reason). No field may be
 * inferred or fabricated to make an operation look more successful than
 * what was actually observed.
 */

export type ServiceId = "deadboard" | "lab-ui" | "research-api" | "compute-api";

export type Action = "start" | "stop" | "restart" | "health" | "status";

export interface ServiceDefinition {
  service_id: ServiceId;
  launchd_label: string;
  /** Absolute path to the LaunchAgent plist — used only for `bootstrap` when the job isn't currently loaded. */
  plist_path: string;
  port: number;
  /** Path used for the HTTP health probe. A response (any status the server itself returns) counts as reachable; only a specific expected status counts as healthy — see `health_expect_status`. */
  health_path: string;
  health_expect_status: number;
}

export interface HealthCheckResult {
  checked_at: string;
  http_status: number | null;
  healthy: boolean;
  error: string | null;
}

export interface LaunchdState {
  label: string;
  /** Real PID as reported by `launchctl list`, or null when the column reads "-" (not currently running). This is launchd's OWN claim — kept separate from `listening_pids`, which is what the OS actually shows bound to the port. */
  pid: number | null;
  /** false only when `launchctl list` has no row at all for this label (job not bootstrapped into this session). */
  loaded: boolean;
}

export interface DuplicateCheck {
  listening_pids: number[];
  duplicate_detected: boolean;
}

export type OperationResult = "SUCCESS" | "FAILED";

export interface OperationEvidence {
  operation_id: string;
  service_id: ServiceId;
  launchd_label: string;
  requested_action: Action;
  port: number;
  pid_before: number | null;
  pid_after: number | null;
  launchd_loaded_before: boolean;
  launchd_loaded_after: boolean;
  health_before: HealthCheckResult;
  health_after: HealthCheckResult;
  duplicate_check: DuplicateCheck;
  timestamp_started: string;
  timestamp_completed: string;
  result: OperationResult;
  failure_reason: string | null;
}
