/**
 * หน้าที่: type contracts for `observability/joint-monitor/` — pure types,
 * no behavior. `status`/`reason` are plain `string`, deliberately never
 * imported from `contracts/command/capability-result.ts`'s
 * `CapabilityResultStatus` or `control/agent-gateway/types.ts`'s `Status`:
 * this capability observes BOTH `control/command-router/` (which uses the
 * former) and `control/agent-gateway/` (which uses a different, unrelated
 * union), so it must stay decoupled from either caller's specific status
 * vocabulary rather than pick one and silently misrepresent the other.
 *
 * Input: none (pure type definitions).
 * Output: `JointEvent`, `ViolationEvent`, `ReportJointInput`,
 * `ReportViolationInput`, `JointMonitorSnapshot`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never add a field that lets a caller pre-supply
 * `event_id`/`at` — both are only ever produced by ./joint-store.ts at
 * the moment an event is actually recorded, never by the reporting
 * caller (see reports/SYSTEM_JOINT_AND_SEARCH_WASTE_AUDIT_2026-08-22.md
 * for why fabricated evidence timestamps are exactly the failure mode
 * this capability exists to make impossible).
 */

/** One real cross-capability call, as reported by the capability that made it — never inferred, never scanned for. */
export interface JointEvent {
  event_id: string;
  from_capability: string;
  to_capability: string;
  /** The real task_id this joint produced/belongs to, when one exists — null for joints that never mint a Task (e.g. an early classification exit). */
  task_id: string | null;
  status: string;
  summary: string;
  /** `<file path>#<function name>` of the real call site that reported this — matches the evidence-citation convention every other capability in this repo already uses. */
  source: string;
  at: string;
}

/** One detected policy/boundary violation, from `control/circuit-breaker/` (or any future reporter) — `enforced` records whether this violation actually triggered a kill, or was report-only (dry-run mode), so the dashboard never conflates "detected" with "acted on". */
export interface ViolationEvent {
  event_id: string;
  launch_id: string;
  reason: string;
  detail: string;
  source: string;
  at: string;
  enforced: boolean;
}

export type ReportJointInput = Omit<JointEvent, "event_id" | "at">;
export type ReportViolationInput = Omit<ViolationEvent, "event_id" | "at">;

export interface JointMonitorSnapshot {
  recent_joints: readonly JointEvent[];
  recent_violations: readonly ViolationEvent[];
  updated_at: string;
}
