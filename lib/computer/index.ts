/**
 * DNA OS V6 — Human Computer Control Layer
 *
 * DNA Command → Capability → Task Planner → Queue → Computer Control → macOS → App → Event Monitor → Result
 *
 * ห้ามแก้ V1-V5 / Business Logic / Registry / Calculation Engine
 * เพิ่มเฉพาะความสามารถ V6
 */

// ── Driver Interface ──
export type { AppDriver, AppStatus, StepResult } from "./driver";
export { createStepResult } from "./driver";

// ── Registry ──
export { registerDriver, getDriver, listDrivers, hasDriver, getDriverInfo } from "./registry";

// ── Task Planner (2-Layer: Intent → Execution) ──
export type { IntentAction, IntentStep, IntentPlan, ExecutionAction, ExecutionStep, PlannedStep, TaskPlan } from "./planner";
export { planTask, getIntentPlan, hasPlan, listPlannedCapabilities, getAppForCapability } from "./planner";

// ── Execution Queue ──
export type { QueueItem, QueueItemStatus } from "./queue";
export { enqueue, cancelItem, getQueue, getQueueItem, getPendingCount, getRunningCount, clearCompleted } from "./queue";

// ── State Monitor ──
export { isRunning, isFocused, activate, waitUntilReady, getAppStatus, getAllRunningApps, getFocusedApp } from "./state-monitor";

// ── Event Monitor ──
export type { EventType, ExecutionEvent } from "./event-monitor";
export { onEvent, emit, getRecentEvents, getEventsByCapability, clearEvents } from "./event-monitor";

// ── Audit ──
export type { AuditEntry } from "./audit";
export { logAudit, logStepStart, getAuditLog, getAuditByCapability, getAuditByApp, getFailedAudits, clearAudit, getAuditStats } from "./audit";

// ── Human Confirm ──
export type { PendingConfirmation } from "./confirm";
export { requestConfirmation, confirmExecution, denyExecution, isConfirmed, getPendingConfirmations, getConfirmation } from "./confirm";

// ── Permission Checker ──
export type { PermissionType, PermissionStatus, PermissionCheck, PermissionReport } from "./permission";
export { checkAccessibility, checkAutomation, checkScreenRecording, checkFullDiskAccess, checkAllPermissions, checkBeforeExecute, openPermissionSettings } from "./permission";

// ── Recovery Engine ──
export type { RecoveryStrategy, RecoveryAttempt, RecoveryPlan } from "./recovery";
export { attemptRecovery, getRecoveryPlan, detectFailureType } from "./recovery";

// ── Context Manager ──
export type { ComputerContext, ContextEntry } from "./context";
export { setContext, getContext, getContextValue, clearContext, getContextHistory, resolveReference, updateFromStepResult } from "./context";

// ── Auto-register App Drivers ──
import { registerDriver } from "./registry";
import { lineDriver } from "./apps/line";
import { chromeDriver } from "./apps/chrome";
import { finderDriver } from "./apps/finder";
import { terminalDriver } from "./apps/terminal";
import { vscodeDriver } from "./apps/vscode";
import { googleMapsDriver } from "./apps/google-maps";
import { googleEarthDriver } from "./apps/google-earth";
import { mailDriver } from "./apps/mail";
import { calendarDriver } from "./apps/calendar";
import { pdfDriver } from "./apps/pdf";
import { githubDriver } from "./apps/github";

const drivers = [
  lineDriver,
  chromeDriver,
  finderDriver,
  terminalDriver,
  vscodeDriver,
  googleMapsDriver,
  googleEarthDriver,
  mailDriver,
  calendarDriver,
  pdfDriver,
  githubDriver,
];

for (const d of drivers) {
  registerDriver(d);
}
