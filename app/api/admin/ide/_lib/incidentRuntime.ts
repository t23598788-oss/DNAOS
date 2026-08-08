/**
 * Incident Runtime (owner, 2026-08-08, Software Factory Step 12). Opens
 * Incidents ONLY from a real, already-collected Monitoring finding —
 * never from a guess, never auto-resolved, never auto-closed this Step.
 * Deduplicates + correlates using real signal/runtime data only. Root
 * cause is always split into a real `observedCause` (the literal
 * Monitoring reason) and an optional `inferredCause`, which is ALWAYS
 * prefixed "INFERENCE:" and computed only from the real Runtime
 * Dependency Graph (Step 11) — never invented.
 *
 * Reuse: createIncidentArtifact() routes through the SAME real
 * createArtifactInternal() every prior Step uses (Rule 103) — no new
 * Artifact Store. incidents Map below is a new in-memory store for a
 * genuinely new record type, the same pattern buildRuns/releaseRuns/
 * deploymentPlans used before it.
 */
import { createHash, randomUUID } from "crypto";
import { getIncidentTypeDefinition, type IncidentType } from "./incidentRegistry";
import type { SignalRecord, Severity } from "./monitoringRuntime";
import { computeRuntimeDependencyGraph } from "./globalFactoryRuntime";
import { startOperationsJob, finalizeOperationsJob } from "./queueRuntime";
import { createOperationsArtifact } from "./artifactRuntime";

function sha256Hex(data: string): string { return createHash("sha256").update(data).digest("hex"); }

export type IncidentStatus = "OPEN" | "INVESTIGATING" | "MITIGATION_PLANNED" | "RECOVERY_PENDING" | "VERIFICATION_PENDING" | "RESOLVED" | "FALSE_POSITIVE" | "UNKNOWN";

export interface IncidentTimelineEntry { at: string; status: IncidentStatus; note: string; actor: string; }

export interface IncidentRecord {
  incidentId: string;
  type: IncidentType;
  title: string;
  status: IncidentStatus;
  severity: Severity;
  openedAt: string;
  lastObservedAt: string;
  affectedScopes: string[];
  affectedDependencies: string[];
  signals: string[];
  evidence: string[];
  observedCause: string;
  inferredCause: string | null;
  recoveryPlanId: string | null;
  ownerDecisionRequired: boolean;
  timeline: IncidentTimelineEntry[];
  sourceFingerprint: string;
  ownerId: string;
  actor: string;
  artifactIds: string[];
}

export class IncidentError extends Error {
  code: "INCIDENT_NOT_FOUND" | "INCIDENT_NOT_OWNED" | "INVALID_REQUEST" | "INVALID_TRANSITION";
  constructor(code: typeof IncidentError.prototype.code, message: string) { super(message); this.code = code; this.name = "IncidentError"; }
}

const incidents = new Map<string, IncidentRecord>();
const MAX_INCIDENT_HISTORY = 300;
function evictOld(ownerId: string) {
  const owned = [...incidents.values()].filter((i) => i.ownerId === ownerId).sort((a, b) => a.openedAt.localeCompare(b.openedAt));
  while (owned.length > MAX_INCIDENT_HISTORY) { const oldest = owned.shift()!; incidents.delete(oldest.incidentId); }
}

export interface IncidentEvent {
  eventId: string; type: "INCIDENT_OPENED" | "INCIDENT_UPDATED" | "INCIDENT_CORRELATED" | "INCIDENT_ESCALATED" | "INCIDENT_FALSE_POSITIVE" | "INCIDENT_RESOLUTION_PROPOSED";
  incidentId: string; actor: string; timestamp: string; evidence: string;
}
const incidentEvents: IncidentEvent[] = [];
const MAX_EVENTS = 500;
function emitIncidentEvent(type: IncidentEvent["type"], incidentId: string, actor: string, evidence: string) {
  incidentEvents.push({ eventId: randomUUID(), type, incidentId, actor, timestamp: new Date().toISOString(), evidence });
  while (incidentEvents.length > MAX_EVENTS) incidentEvents.shift();
}
export function listIncidentEvents(limit = 200): IncidentEvent[] {
  return incidentEvents.slice(-limit).reverse();
}

const SIGNAL_TO_INCIDENT_TYPE: Record<string, IncidentType> = {
  RUNTIME_HEALTH: "RUNTIME_FAILURE", API_HEALTH: "API_FAILURE", DATABASE_HEALTH: "DATABASE_FAILURE",
  QUEUE_HEALTH: "QUEUE_STALL", EXECUTION_HEALTH: "EXECUTION_FAILURE", ARTIFACT_INTEGRITY: "ARTIFACT_CORRUPTION",
  REGISTRY_INTEGRITY: "REGISTRY_DRIFT", GOVERNANCE_HEALTH: "GOVERNANCE_FAILURE", BUILD_HEALTH: "BUILD_FAILURE",
  RELEASE_HEALTH: "RELEASE_FAILURE", DEPLOYMENT_PLAN_HEALTH: "DEPLOYMENT_BLOCKED", STORAGE_HEALTH: "STORAGE_PRESSURE",
  CONNECTOR_HEALTH: "CONNECTOR_FAILURE", EXTERNAL_PROVIDER_HEALTH: "PROVIDER_OUTAGE", COST_ANOMALY: "COST_ANOMALY",
  PROCESS_LEAK: "PROCESS_LEAK", DATA_FRESHNESS: "DATA_STALE", BACKUP_HEALTH: "BACKUP_FAILURE",
};

/** Deterministic — never AI-decided. Starts at the real Incident Type's
 * minimumSeverity floor, escalates only from real, observable factors:
 * the triggering signal's own real severity, and real repeat-occurrence
 * count within this Incident's real timeline (never file/error count
 * alone, per Section 8). */
function computeIncidentSeverity(typeDef: ReturnType<typeof getIncidentTypeDefinition>, signal: SignalRecord, repeatCount: number): Severity {
  const order: Severity[] = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
  const floor = order.indexOf(typeDef!.minimumSeverity);
  const fromSignal = order.indexOf(signal.severity);
  let idx = Math.max(floor, fromSignal);
  if (repeatCount >= 5) idx = Math.min(order.length - 1, idx + 1); // real, repeated failure escalates one level
  return order[idx];
}

/** Real dependency impact from the Step 11 Runtime Dependency Graph —
 * direct = real Runtimes that import the failing Runtime (reverse edge),
 * transitive = real reverse-BFS from there. Never invents an edge. */
function computeDependencyImpact(relatedRuntime: string | null): { direct: string[]; transitive: string[] } {
  if (!relatedRuntime) return { direct: [], transitive: [] };
  const graph = computeRuntimeDependencyGraph();
  const direct = graph.edges.filter((e) => e.to === relatedRuntime).map((e) => e.from);
  const visited = new Set<string>(direct);
  const queue = [...direct];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const e of graph.edges.filter((e) => e.to === cur)) {
      if (!visited.has(e.from)) { visited.add(e.from); queue.push(e.from); }
    }
  }
  return { direct, transitive: [...visited] };
}

function findDuplicateIncident(ownerId: string, type: IncidentType, signal: SignalRecord): IncidentRecord | null {
  const def = getIncidentTypeDefinition(type)!;
  const now = Date.now();
  const openStatuses: IncidentStatus[] = ["OPEN", "INVESTIGATING", "MITIGATION_PLANNED", "RECOVERY_PENDING", "VERIFICATION_PENDING"];
  for (const inc of incidents.values()) {
    if (inc.ownerId !== ownerId || inc.type !== type) continue;
    if (!openStatuses.includes(inc.status)) continue;
    if (now - new Date(inc.lastObservedAt).getTime() > def.deduplicationWindowMs) continue;
    return inc;
  }
  return null;
}

export async function openIncidentFromSignal(signal: SignalRecord, ownerId: string, actor: string): Promise<IncidentRecord> {
  if (signal.ownerId !== ownerId) throw new IncidentError("INVALID_REQUEST", "signal does not belong to this owner");
  const type = SIGNAL_TO_INCIDENT_TYPE[signal.signalType] ?? "UNKNOWN_INCIDENT";
  const typeDef = getIncidentTypeDefinition(type)!;

  const dup = findDuplicateIncident(ownerId, type, signal);
  const nowIso = new Date().toISOString();
  const job = startOperationsJob("INCIDENT_OPEN", actor, ownerId, signal.signalId);

  if (dup) {
    const priorSeverity = dup.severity;
    dup.lastObservedAt = nowIso;
    if (!dup.signals.includes(signal.signalId)) dup.signals.push(signal.signalId);
    dup.severity = computeIncidentSeverity(typeDef, signal, dup.signals.length);
    dup.timeline.push({ at: nowIso, status: dup.status, note: `correlated real signal ${signal.signalId} (${signal.signalType}: ${signal.status}) — deduplicated within window`, actor });
    emitIncidentEvent("INCIDENT_CORRELATED", dup.incidentId, actor, `real signal ${signal.signalId} correlated into existing Incident ${dup.incidentId}`);
    if (dup.severity !== priorSeverity) emitIncidentEvent("INCIDENT_ESCALATED", dup.incidentId, actor, `real severity change: ${priorSeverity} -> ${dup.severity} (repeat count: ${dup.signals.length})`);
    finalizeOperationsJob(job.jobId, ownerId, { ok: true, result: "CORRELATED", error: null });
    return dup;
  }

  const impact = computeDependencyImpact(signal.relatedRuntime);
  const incidentId = randomUUID();
  const record: IncidentRecord = {
    incidentId, type, title: `${typeDef.displayName}: ${signal.reason}`.slice(0, 200),
    status: "OPEN", severity: computeIncidentSeverity(typeDef, signal, 1),
    openedAt: nowIso, lastObservedAt: nowIso,
    affectedScopes: [signal.scope], affectedDependencies: impact.transitive,
    signals: [signal.signalId], evidence: [],
    observedCause: signal.reason,
    inferredCause: impact.transitive.length > 0 ? `INFERENCE: real Runtime Dependency Graph shows ${impact.direct.length} direct and ${impact.transitive.length} transitive real dependent(s) on "${signal.relatedRuntime}" that may also be affected` : null,
    recoveryPlanId: null, ownerDecisionRequired: typeDef.minimumSeverity === "HIGH" || typeDef.minimumSeverity === "CRITICAL",
    timeline: [{ at: nowIso, status: "OPEN", note: `opened from real signal ${signal.signalId} (${signal.signalType}: ${signal.status}) — ${signal.reason}`, actor }],
    sourceFingerprint: sha256Hex(`${type}:${signal.signalId}:${signal.sourceHash}`),
    ownerId, actor, artifactIds: [],
  };

  const recordArtifact = createOperationsArtifact({
    artifactType: "INCIDENT_RECORD", content: JSON.stringify(record), mimeType: "application/json",
    actor, ownerId, generatedFrom: incidentId, jobId: job.jobId, relatedIncidentId: incidentId,
  });
  record.artifactIds.push(recordArtifact.artifactId);
  record.evidence.push(recordArtifact.artifactId);

  incidents.set(incidentId, record);
  evictOld(ownerId);
  emitIncidentEvent("INCIDENT_OPENED", incidentId, actor, `real Incident opened from signal ${signal.signalId} (${signal.signalType}: ${signal.status})`);
  finalizeOperationsJob(job.jobId, ownerId, { ok: true, result: "OPENED", error: null });
  return record;
}

const VALID_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  OPEN: ["INVESTIGATING", "FALSE_POSITIVE"],
  INVESTIGATING: ["MITIGATION_PLANNED", "FALSE_POSITIVE"],
  MITIGATION_PLANNED: ["RECOVERY_PENDING"],
  RECOVERY_PENDING: ["VERIFICATION_PENDING"],
  VERIFICATION_PENDING: ["RESOLVED", "RECOVERY_PENDING"],
  RESOLVED: [],
  FALSE_POSITIVE: [],
  UNKNOWN: ["INVESTIGATING"],
};

export function changeIncidentStatus(incidentId: string, ownerId: string, actor: string, nextStatus: IncidentStatus, note: string, verificationEvidenceArtifactId?: string): IncidentRecord {
  const inc = getIncident(incidentId, ownerId);
  if (!VALID_TRANSITIONS[inc.status].includes(nextStatus)) {
    throw new IncidentError("INVALID_TRANSITION", `cannot transition from ${inc.status} to ${nextStatus}`);
  }
  if (nextStatus === "RESOLVED" && !verificationEvidenceArtifactId) {
    throw new IncidentError("INVALID_REQUEST", "RESOLVED requires a real verificationEvidenceArtifactId — Incident cannot close without verification evidence (Rule: no auto-close)");
  }
  inc.status = nextStatus;
  inc.lastObservedAt = new Date().toISOString();
  if (verificationEvidenceArtifactId) { inc.evidence.push(verificationEvidenceArtifactId); inc.artifactIds.push(verificationEvidenceArtifactId); }
  inc.timeline.push({ at: inc.lastObservedAt, status: nextStatus, note, actor });
  if (nextStatus === "FALSE_POSITIVE") emitIncidentEvent("INCIDENT_FALSE_POSITIVE", incidentId, actor, note);
  else if (nextStatus === "VERIFICATION_PENDING") emitIncidentEvent("INCIDENT_RESOLUTION_PROPOSED", incidentId, actor, note);
  else emitIncidentEvent("INCIDENT_UPDATED", incidentId, actor, `real status change to ${nextStatus}: ${note}`);
  return inc;
}

export function attachRecoveryPlan(incidentId: string, ownerId: string, recoveryPlanId: string, actor: string): IncidentRecord {
  const inc = getIncident(incidentId, ownerId);
  inc.recoveryPlanId = recoveryPlanId;
  inc.timeline.push({ at: new Date().toISOString(), status: inc.status, note: `real Recovery Plan ${recoveryPlanId} attached`, actor });
  return inc;
}

export function getIncident(incidentId: string, ownerId: string): IncidentRecord {
  const inc = incidents.get(incidentId);
  if (!inc) throw new IncidentError("INCIDENT_NOT_FOUND", "no incident with that id");
  if (inc.ownerId !== ownerId) throw new IncidentError("INCIDENT_NOT_OWNED", "this incident belongs to a different session");
  return inc;
}
export function listIncidents(ownerId: string): IncidentRecord[] {
  return [...incidents.values()].filter((i) => i.ownerId === ownerId).sort((a, b) => b.openedAt.localeCompare(a.openedAt));
}
export function __debugIncidentCount(): number { return incidents.size; }
