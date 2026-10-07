/**
 * หน้าที่: the public boundary of `observability/joint-monitor/` — the
 * only file another capability folder may import from, per
 * `../../governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: `reportJoint`, `reportViolation` (for any capability reporting
 * a real call), `startJointMonitorServer`, `JointStore` (for the process
 * that runs the dashboard itself, see ./start.ts), plus every type a
 * caller needs.
 * Dependency ที่อนุญาต: ./client.ts, ./server.ts, ./joint-store.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never re-export ./host-runtime.ts here — private implementation.
 */

export { reportJoint, reportViolation } from "./client";
export { startJointMonitorServer } from "./server";
export { JointStore } from "./joint-store";
export type { JointEvent, ViolationEvent, ReportJointInput, ReportViolationInput, JointMonitorSnapshot } from "./types";
export { onJoint, onViolation } from "./client";
export { jointToEvent, violationToEvent, startJointEventBridge, isLoopingJoint, FAILURE_JOINT_STATUSES, JOINT_EVENT_SOURCE, VIOLATION_EVENT_SOURCE } from "./event-ingress-bridge";
export type { JointBridgeHandle } from "./event-ingress-bridge";
