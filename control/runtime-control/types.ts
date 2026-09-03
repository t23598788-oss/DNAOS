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
 * Dependency ที่อนุญาต: type-only จาก ./requester.ts (ซึ่งหยิบชุดย่อยของ
 * contracts/identity#EnvelopeIdentity มาใช้ต่อ ไม่ประกาศตัวตนแบบใหม่).
 * สิ่งที่ห้ามแตะ: never add a field to `OperationEvidence` that isn't
 * populated from a real, host-runtime-observed fact — this record is the
 * evidence the Owner explicitly required (service identity, launchd
 * label, requested action, PID before/after, port, health result,
 * timestamp, exit/result status, failure reason). No field may be
 * inferred or fabricated to make an operation look more successful than
 * what was actually observed.
 */

/**
 * `machine-observer` added 2026-08-26 on the Owner's explicit instruction
 * ("Wire observer-daemon.ts into the existing runtime/service mechanism") —
 * ../../control/machine-observation/host-runtime.ts's own rule requires that
 * the Owner add a fifth target deliberately, and this is that addition.
 */
/**
 * `control-workspace` and `joint-monitor` added 2026-08-27 on the Owner's
 * explicit instruction (the boot-conveyor message: "ทำติดตั้งลงทะเบียนในระบบ
 * เราให้สมบูรณ์"). Both were unsupervised processes that died silently and
 * produced ERR_CONNECTION_REFUSED in the browser — exactly the failure this
 * registry exists to make impossible.
 */
import type { RuntimeExecutor, RuntimeRequestLineage, RuntimeRequesterIdentity } from "./requester";

export type ServiceId =
  | "deadboard" | "lab-ui" | "research-api" | "compute-api"
  | "machine-observer" | "recovery-supervisor"
  | "control-workspace" | "joint-monitor"
  | "dna-os-mcp";

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
  /**
   * How long this service may take, after launchd reports a PID, to actually
   * bind its port and answer. Declared PER SERVICE because it is a property of
   * the service, not of the supervisor: a compiled server answers in
   * milliseconds, a tsx cold start does not. Measured, not guessed — see the
   * note on each value in ./host-runtime.ts.
   */
  readiness_timeout_ms: number;
  /**
   * Services that must be HEALTHY before this one is started.
   *
   * Declared here rather than inferred, because the real order is a fact about
   * the system, not about the folder names: `control-workspace` proxies to
   * `compute-api` and `joint-monitor`, so bringing it up first produces a UI
   * that renders and then immediately reports its dependencies as DOWN — which
   * is indistinguishable, on screen, from those dependencies being genuinely
   * broken.
   *
   * An empty array means "no DNA OS dependency", never "unknown".
   */
  depends_on: readonly ServiceId[];
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
  /**
   * ── ไม่ได้วัด != ไม่มีซ้ำ (2026-08-29) ──
   * optional เพราะมีเส้นทางที่ไม่ได้เรียก `getListeningPids` เลย (boot) การเขียน
   * `duplicate_detected: false` ในกรณีนั้นคือการรายงานผลของการตรวจที่ไม่เคยเกิดขึ้น
   * ช่องที่หายไป = NOT_MEASURED แถวเก่าทุกแถวมีช่องนี้อยู่แล้วจึงอ่านได้เหมือนเดิม
   */
  duplicate_check?: DuplicateCheck;
  /**
   * How long the health probe actually had to wait, after launchd reported a
   * PID, before the service answered — 0 when it answered on the first probe.
   * An observed duration, not a configured one.
   */
  readiness_wait_ms: number;
  /** The bound that wait was held to, so a timeout can be told apart from a fast failure. */
  readiness_deadline_ms: number;
  timestamp_started: string;
  timestamp_completed: string;
  result: OperationResult;
  failure_reason: string | null;
  /**
   * ── ผู้ขอ (2026-08-29) ──
   * ตัวตนที่ผู้เรียกส่งมาอย่างชัดแจ้ง ไม่ใช่ค่าที่ runtime-control อนุมานเอง
   * ทั้งสามช่องเป็น optional เพราะแถวก่อนหน้านี้ทั้งหมดไม่มี และจะไม่ถูกเขียนใหม่
   * ช่องที่หายไป = NOT_MEASURED (ดู ./requester.ts#readRequester) ห้ามอ่านว่าเป็น
   * OWNER, SYSTEM, RECOVERY หรือ UNKNOWN
   *
   * การมี `requested_by` ไม่ได้ให้อำนาจใด ๆ แก่ผู้ขอ: ไม่ใช่คำอนุมัติ ไม่ใช่การ
   * ประกาศสถานะที่พึงเป็น และผู้ลงมือยังเป็น runtime-control เสมอ (`executed_by`
   * มีค่าเดียวที่เป็นไปได้ และผู้เรียกกำหนดไม่ได้)
   */
  requested_by?: RuntimeRequesterIdentity;
  requester_lineage?: RuntimeRequestLineage;
  executed_by?: RuntimeExecutor;
}
