/** Single existing Monitoring signal/event store, extracted without duplicating state. */
import { createHash, randomUUID } from "crypto";
import { getSignalTypeDefinition, type SignalType } from "./monitoringRegistry";
function sha256Hex(data: string): string { return createHash("sha256").update(data).digest("hex"); }


export type MonitoringStatus = "HEALTHY" | "DEGRADED" | "UNHEALTHY" | "STALE" | "MISSING" | "UNKNOWN" | "NOT_IMPLEMENTED";

export type Severity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";


export interface SignalRecord {
  signalId: string;
  signalType: SignalType;
  source: string;
  scope: string;
  observedAt: string;
  evaluatedAt: string;
  rawReference: string;
  normalizedValue: unknown;
  status: MonitoringStatus;
  severity: Severity;
  reason: string;
  sourceHash: string;
  evidence: string[];
  relatedRuntime: string | null;
  relatedProvider: string | null;
  relatedWorkspace: string | null;
  relatedDeploymentPlan: string | null;
  ownerId: string;
  actor: string;
}


export interface MonitoringEvent {
  eventId: string; type: "SIGNAL_COLLECTED" | "SIGNAL_MISSING" | "SIGNAL_STALE" | "HEALTH_DEGRADED" | "HEALTH_FAILED" | "HEALTH_RECOVERED";
  signalId: string | null; signalType: SignalType; actor: string; timestamp: string; evidence: string;
}


const signals = new Map<string, SignalRecord>();

const monitoringEvents: MonitoringEvent[] = [];

const MAX_SIGNAL_HISTORY = 500;

const MAX_EVENTS = 500;


function emitMonitoringEvent(type: MonitoringEvent["type"], signalId: string | null, signalType: SignalType, actor: string, evidence: string) {
  monitoringEvents.push({ eventId: randomUUID(), type, signalId, signalType, actor, timestamp: new Date().toISOString(), evidence });
  while (monitoringEvents.length > MAX_EVENTS) monitoringEvents.shift();
}

function evictOldSignals(ownerId: string) {
  const owned = [...signals.values()].filter((s) => s.ownerId === ownerId).sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  while (owned.length > MAX_SIGNAL_HISTORY) { const oldest = owned.shift()!; signals.delete(oldest.signalId); }
}


export interface CollectResult {
  status: MonitoringStatus; severity: Severity; reason: string; normalizedValue: unknown; rawReference: string;
  relatedRuntime?: string | null; relatedProvider?: string | null; relatedDeploymentPlan?: string | null;
}


export class MonitoringError extends Error {
  code: "SIGNAL_TYPE_NOT_REGISTERED" | "SIGNAL_NOT_FOUND" | "SIGNAL_NOT_OWNED" | "INTERNAL_ERROR";
  constructor(code: typeof MonitoringError.prototype.code, message: string) { super(message); this.code = code; this.name = "MonitoringError"; }
}


export function getSignal(signalId: string, ownerId: string): SignalRecord {
  const s = signals.get(signalId);
  if (!s) throw new MonitoringError("SIGNAL_NOT_FOUND", "no signal with that id");
  if (s.ownerId !== ownerId) throw new MonitoringError("SIGNAL_NOT_OWNED", "this signal belongs to a different session");
  return s;
}

export function listSignals(ownerId: string): SignalRecord[] {
  return [...signals.values()].filter((s) => s.ownerId === ownerId).sort((a, b) => b.observedAt.localeCompare(a.observedAt));
}

export function listMonitoringEvents(limit = 200): MonitoringEvent[] {
  return monitoringEvents.slice(-limit).reverse();
}


export interface MonitoringSummary {
  computedAt: string; total: number;
  byStatus: Record<MonitoringStatus, number>;
  overallStatus: "HEALTHY" | "DEGRADED" | "UNHEALTHY" | "UNKNOWN";
}

export function computeMonitoringSummary(ownerId: string): MonitoringSummary {
  const list = listSignals(ownerId);
  const byStatus: Record<MonitoringStatus, number> = { HEALTHY: 0, DEGRADED: 0, UNHEALTHY: 0, STALE: 0, MISSING: 0, UNKNOWN: 0, NOT_IMPLEMENTED: 0 };
  for (const s of list) byStatus[s.status]++;
  const overallStatus: MonitoringSummary["overallStatus"] = list.length === 0 ? "UNKNOWN" : (byStatus.UNHEALTHY > 0 || byStatus.MISSING > 0) ? "UNHEALTHY" : (byStatus.DEGRADED > 0 || byStatus.STALE > 0) ? "DEGRADED" : "HEALTHY";
  return { computedAt: new Date().toISOString(), total: list.length, byStatus, overallStatus };
}


export function __debugSignalCount(): number { return signals.size; }


export async function collectSignalWith(signalType: SignalType, ownerId: string, actor: string, collector: (ownerId: string) => Promise<CollectResult>): Promise<SignalRecord> {
  const def = getSignalTypeDefinition(signalType);
  if (!def) throw new MonitoringError("SIGNAL_TYPE_NOT_REGISTERED", `unknown signal type: ${signalType}`);

  const observedAt = new Date().toISOString();
  const result = await collector(ownerId);
  const evaluatedAt = new Date().toISOString();

  const record: SignalRecord = {
    signalId: randomUUID(), signalType, source: def.source, scope: def.scope, observedAt, evaluatedAt,
    rawReference: result.rawReference, normalizedValue: result.normalizedValue, status: result.status, severity: result.severity,
    reason: result.reason, sourceHash: sha256Hex(JSON.stringify(result.normalizedValue ?? null)), evidence: [`real, live evaluation of ${def.source}`],
    relatedRuntime: result.relatedRuntime ?? null, relatedProvider: result.relatedProvider ?? null, relatedWorkspace: null,
    relatedDeploymentPlan: result.relatedDeploymentPlan ?? null, ownerId, actor,
  };
  signals.set(record.signalId, record);
  evictOldSignals(ownerId);

  if (result.status === "MISSING") emitMonitoringEvent("SIGNAL_MISSING", record.signalId, signalType, actor, result.reason);
  else if (result.status === "STALE") emitMonitoringEvent("SIGNAL_STALE", record.signalId, signalType, actor, result.reason);
  else if (result.status === "UNHEALTHY") emitMonitoringEvent("HEALTH_FAILED", record.signalId, signalType, actor, result.reason);
  else if (result.status === "DEGRADED") emitMonitoringEvent("HEALTH_DEGRADED", record.signalId, signalType, actor, result.reason);
  else emitMonitoringEvent("SIGNAL_COLLECTED", record.signalId, signalType, actor, result.reason);

  return record;
}
