/**
 * Audit Logger
 *
 * ทุก Execute ต้อง Log — Command / Capability / App / Step / Start / End / Result / Error
 */

export interface AuditEntry {
  id: string;
  command: string;
  capability: string;
  app: string;
  step: string;
  start: number;
  end: number;
  result: "success" | "failed" | "cancelled";
  error?: string;
}

const auditLog: AuditEntry[] = [];
const MAX_ENTRIES = 1000;
let counter = 0;

export function logAudit(entry: Omit<AuditEntry, "id">): AuditEntry {
  const full: AuditEntry = { id: `audit_${++counter}_${entry.start}`, ...entry };
  auditLog.push(full);
  if (auditLog.length > MAX_ENTRIES) auditLog.shift();
  return full;
}

export function logStepStart(
  command: string,
  capability: string,
  app: string,
  step: string
): { finish: (result: "success" | "failed" | "cancelled", error?: string) => AuditEntry } {
  const start = Date.now();
  return {
    finish: (result, error) =>
      logAudit({ command, capability, app, step, start, end: Date.now(), result, error }),
  };
}

export function getAuditLog(count: number = 50): AuditEntry[] {
  return auditLog.slice(-count);
}

export function getAuditByCapability(capability: string): AuditEntry[] {
  return auditLog.filter((e) => e.capability === capability);
}

export function getAuditByApp(app: string): AuditEntry[] {
  return auditLog.filter((e) => e.app.toLowerCase() === app.toLowerCase());
}

export function getFailedAudits(): AuditEntry[] {
  return auditLog.filter((e) => e.result === "failed");
}

export function clearAudit(): void {
  auditLog.length = 0;
}

export function getAuditStats(): {
  total: number;
  success: number;
  failed: number;
  cancelled: number;
  avgDurationMs: number;
} {
  const total = auditLog.length;
  const success = auditLog.filter((e) => e.result === "success").length;
  const failed = auditLog.filter((e) => e.result === "failed").length;
  const cancelled = auditLog.filter((e) => e.result === "cancelled").length;
  const totalDuration = auditLog.reduce((sum, e) => sum + (e.end - e.start), 0);
  return { total, success, failed, cancelled, avgDurationMs: total > 0 ? totalDuration / total : 0 };
}
