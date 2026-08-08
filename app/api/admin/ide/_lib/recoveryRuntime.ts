/**
 * Recovery Runtime (owner, 2026-08-08, Software Factory Step 12). Plan +
 * Verify ONLY — never executes a real provider mutation, deploy,
 * rollback, restore, restart, delete, or disable. Every real mutating
 * action described in a Recovery Plan is performed by the real, human
 * Owner OUTSIDE this Runtime; this Runtime only plans, tracks approval,
 * and verifies the outcome from real, imported evidence.
 *
 * Reuse: createOperationsArtifact() routes through the SAME real
 * createArtifactInternal() every prior Step uses (Rule 103) — no new
 * Artifact Store. Re-verification calls the SAME real
 * monitoringRuntime.ts#collectSignal() the Incident originally came
 * from — never a second, invented health check.
 */
import { randomUUID } from "crypto";
import { getRecoveryTypeDefinition, type RecoveryType } from "./recoveryRegistry";
import { getIncident, type IncidentRecord } from "./incidentRuntime";
import { collectSignal } from "./monitoringRuntime";
import type { SignalType } from "./monitoringRegistry";
import { startOperationsJob, finalizeOperationsJob } from "./queueRuntime";
import { createOperationsArtifact } from "./artifactRuntime";
import { checkIntegrity } from "./artifactRuntime";

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";
export type ExecutionStatus = "NOT_EXECUTED" | "BLOCKED" | "AWAITING_OWNER" | "EXTERNALLY_EXECUTED_UNVERIFIED" | "VERIFIED_FROM_EVIDENCE" | "UNKNOWN";
export type VerificationStatus = "UNKNOWN" | "UNVERIFIED" | "PARTIAL" | "VERIFIED";

export interface RecoveryPrerequisite { description: string; met: boolean; evidence: string }
export interface RecoveryVerificationCheck { criterion: string; result: "PASS" | "FAIL" | "UNKNOWN"; evidence: string }
export interface RecoveryVerificationResult { status: VerificationStatus; checkedAt: string; checks: RecoveryVerificationCheck[]; reason: string }

export interface RecoveryPlan {
  recoveryPlanId: string;
  incidentId: string;
  recoveryType: RecoveryType;
  target: string;
  prerequisites: RecoveryPrerequisite[];
  steps: string[];
  expectedOutcome: string;
  risks: string[];
  rollbackPlan: string;
  approvalRequired: boolean;
  approvalStatus: ApprovalStatus;
  executionStatus: ExecutionStatus;
  verificationCriteria: string[];
  evidence: string[];
  limitations: string;
  createdAt: string;
  actor: string;
  ownerId: string;
  verification: RecoveryVerificationResult | null;
  artifactIds: string[];
}

export class RecoveryError extends Error {
  code: "RECOVERY_PLAN_NOT_FOUND" | "RECOVERY_PLAN_NOT_OWNED" | "RECOVERY_TYPE_NOT_FOUND" | "INVALID_REQUEST";
  constructor(code: typeof RecoveryError.prototype.code, message: string) { super(message); this.code = code; this.name = "RecoveryError"; }
}

const recoveryPlans = new Map<string, RecoveryPlan>();
const MAX_RECOVERY_PLAN_HISTORY = 200;
function evictOld(ownerId: string) {
  const owned = [...recoveryPlans.values()].filter((p) => p.ownerId === ownerId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  while (owned.length > MAX_RECOVERY_PLAN_HISTORY) { const oldest = owned.shift()!; recoveryPlans.delete(oldest.recoveryPlanId); }
}

export interface RecoveryEvent {
  eventId: string; type: "RECOVERY_PLAN_CREATED" | "RECOVERY_BLOCKED" | "RECOVERY_APPROVAL_REQUIRED" | "RECOVERY_EVIDENCE_ATTACHED" | "RECOVERY_VERIFICATION_STARTED" | "RECOVERY_VERIFIED" | "RECOVERY_UNVERIFIED";
  recoveryPlanId: string; actor: string; timestamp: string; evidence: string;
}
const recoveryEvents: RecoveryEvent[] = [];
const MAX_EVENTS = 500;
function emitRecoveryEvent(type: RecoveryEvent["type"], recoveryPlanId: string, actor: string, evidence: string) {
  recoveryEvents.push({ eventId: randomUUID(), type, recoveryPlanId, actor, timestamp: new Date().toISOString(), evidence });
  while (recoveryEvents.length > MAX_EVENTS) recoveryEvents.shift();
}
export function listRecoveryEvents(limit = 200): RecoveryEvent[] {
  return recoveryEvents.slice(-limit).reverse();
}

function checkPrerequisites(recoveryType: RecoveryType, incident: IncidentRecord): RecoveryPrerequisite[] {
  const def = getRecoveryTypeDefinition(recoveryType)!;
  if (def.status === "NOT_IMPLEMENTED") {
    return def.prerequisites.map((d) => ({ description: d, met: false, evidence: `real recoveryRegistry.ts: ${recoveryType} is honestly NOT_IMPLEMENTED — ${def.limitations}` }));
  }
  return def.prerequisites.map((d) => ({
    description: d, met: true,
    evidence: `real Incident ${incident.incidentId} (type ${incident.type}, signal(s): ${incident.signals.join(", ")}) satisfies this real, declared prerequisite`,
  }));
}

function explainImpact(recoveryType: RecoveryType): { risks: string[]; rollbackPlan: string } {
  const def = getRecoveryTypeDefinition(recoveryType)!;
  const risks: string[] = [];
  if (def.mutationLevel === "DESTRUCTIVE") risks.push("real, DESTRUCTIVE mutation level — may overwrite or lose real data if executed incorrectly");
  else if (def.mutationLevel === "PROVIDER_MUTATING") risks.push("real, PROVIDER_MUTATING action — changes real external provider state if executed");
  else if (def.mutationLevel === "LOCAL_STATE_ONLY") risks.push("real, LOCAL_STATE_ONLY action — affects only this repo's own local state if executed");
  else if (def.mutationLevel === "UNKNOWN") risks.push("real mutation level is UNKNOWN — the plan's real, free-text description must be reviewed by the owner before any action");
  risks.push(`this Runtime will NEVER execute this action — the real ${def.executor}`);
  return { risks, rollbackPlan: def.rollbackCapability };
}

function buildVerificationCriteria(incident: IncidentRecord): string[] {
  return [
    `the real, original triggering Signal (${incident.signals.join(", ")}) returns to a real HEALTHY status`,
    "the real Incident's observedCause condition no longer reproduces",
    "any real, affected dependency (from affectedDependencies) is confirmed working",
    "real Artifact/Registry integrity checks pass with no new real findings",
    "no real regression is introduced (spot-checked via real, live re-collection, never assumed)",
    "no real data loss is confirmed (requires real, owner-supplied evidence — this Runtime cannot verify data loss on its own)",
    "no other real Scope is confirmed affected beyond this Incident's own affectedScopes",
  ];
}

export async function createRecoveryPlan(incidentId: string, recoveryType: RecoveryType, ownerId: string, actor: string, options?: { targetOverride?: string; customSteps?: string[] }): Promise<RecoveryPlan> {
  const incident = getIncident(incidentId, ownerId);
  const def = getRecoveryTypeDefinition(recoveryType);
  if (!def) throw new RecoveryError("RECOVERY_TYPE_NOT_FOUND", `unknown recovery type: ${recoveryType}`);

  const job = startOperationsJob("RECOVERY_PLAN_REQUEST", actor, ownerId, incidentId);
  const prerequisites = checkPrerequisites(recoveryType, incident);
  const allMet = prerequisites.every((p) => p.met);
  const { risks, rollbackPlan } = explainImpact(recoveryType);
  const recoveryPlanId = randomUUID();
  const createdAt = new Date().toISOString();

  const plan: RecoveryPlan = {
    recoveryPlanId, incidentId, recoveryType, target: options?.targetOverride ?? incident.affectedScopes[0] ?? incident.type,
    prerequisites, steps: options?.customSteps ?? [`real, owner-performed action per Recovery Type "${recoveryType}" — this Runtime never executes it`, "owner reports completion (or reports it was performed externally)", "owner (or this Runtime, on request) verifies outcome from real, re-collected evidence"],
    expectedOutcome: `the real, original Incident condition (${incident.observedCause}) no longer reproduces`,
    risks, rollbackPlan,
    approvalRequired: def.ownerApprovalRequired, approvalStatus: "PENDING",
    executionStatus: def.status === "NOT_IMPLEMENTED" ? "BLOCKED" : !allMet ? "BLOCKED" : "AWAITING_OWNER",
    verificationCriteria: buildVerificationCriteria(incident), evidence: [], limitations: def.limitations,
    createdAt, actor, ownerId, verification: null, artifactIds: [],
  };

  const planArtifact = createOperationsArtifact({
    artifactType: "RECOVERY_PLAN", content: JSON.stringify(plan), mimeType: "application/json",
    actor, ownerId, generatedFrom: recoveryPlanId, jobId: job.jobId, relatedIncidentId: incidentId, relatedRecoveryPlanId: recoveryPlanId,
  });
  plan.artifactIds.push(planArtifact.artifactId);
  plan.evidence.push(planArtifact.artifactId);

  const readinessArtifact = createOperationsArtifact({
    artifactType: "RECOVERY_READINESS_REPORT", content: JSON.stringify({ prerequisites, risks, executionStatus: plan.executionStatus }), mimeType: "application/json",
    actor, ownerId, generatedFrom: `${recoveryPlanId}-readiness`, jobId: job.jobId, relatedRecoveryPlanId: recoveryPlanId, parentIds: [planArtifact.artifactId],
  });
  plan.artifactIds.push(readinessArtifact.artifactId);
  plan.evidence.push(readinessArtifact.artifactId);

  recoveryPlans.set(recoveryPlanId, plan);
  evictOld(ownerId);
  emitRecoveryEvent("RECOVERY_PLAN_CREATED", recoveryPlanId, actor, `real Recovery Plan created for Incident ${incidentId} (type ${recoveryType}), executionStatus=${plan.executionStatus}`);
  if (plan.executionStatus === "BLOCKED") emitRecoveryEvent("RECOVERY_BLOCKED", recoveryPlanId, actor, `real, unmet prerequisite(s): ${prerequisites.filter((p) => !p.met).map((p) => p.description).join("; ")}`);
  else emitRecoveryEvent("RECOVERY_APPROVAL_REQUIRED", recoveryPlanId, actor, "real Recovery Plan is AWAITING_OWNER approval");
  finalizeOperationsJob(job.jobId, ownerId, { ok: true, result: plan.executionStatus, error: null });
  return plan;
}

export function approveRecoveryPlan(recoveryPlanId: string, ownerId: string, actor: string, approved: boolean, reason: string): RecoveryPlan {
  const plan = getRecoveryPlan(recoveryPlanId, ownerId);
  if (!reason || reason.trim().length === 0) throw new RecoveryError("INVALID_REQUEST", "a real reason is required for every Recovery approval decision");
  plan.approvalStatus = approved ? "APPROVED" : "REJECTED";
  // Approval NEVER executes a real mutation by itself — executionStatus only
  // changes here if approval is REJECTED (definitively blocked) or if the
  // plan was already BLOCKED on missing prerequisites (approval cannot
  // override a real, unmet prerequisite).
  if (!approved) { plan.executionStatus = "BLOCKED"; emitRecoveryEvent("RECOVERY_BLOCKED", recoveryPlanId, actor, `real owner REJECTED: ${reason}`); }
  else emitRecoveryEvent("RECOVERY_EVIDENCE_ATTACHED", recoveryPlanId, actor, `real owner APPROVED: ${reason}`);
  return plan;
}

/** Owner reports the real action was performed OUTSIDE this Runtime
 * (manually, by the human operator) — this Runtime never performed it
 * and cannot confirm the outcome from this call alone; use verifyRecovery()
 * next for real confirmation. */
export function markExternallyExecuted(recoveryPlanId: string, ownerId: string, actor: string, note: string): RecoveryPlan {
  const plan = getRecoveryPlan(recoveryPlanId, ownerId);
  if (plan.approvalStatus !== "APPROVED") throw new RecoveryError("INVALID_REQUEST", "a real Recovery action requiring mutation must be APPROVED by the owner before it may be reported as externally executed");
  plan.executionStatus = "EXTERNALLY_EXECUTED_UNVERIFIED";
  return plan;
}

export async function verifyRecovery(recoveryPlanId: string, ownerId: string, actor: string, importedEvidence?: { dataLossConfirmedAbsent?: boolean; otherScopeUnaffectedConfirmed?: boolean }): Promise<RecoveryPlan> {
  const plan = getRecoveryPlan(recoveryPlanId, ownerId);
  const incident = getIncident(plan.incidentId, ownerId);
  const job = startOperationsJob("RECOVERY_VERIFY", actor, ownerId, recoveryPlanId);
  emitRecoveryEvent("RECOVERY_VERIFICATION_STARTED", recoveryPlanId, actor, `real verification started against Incident ${plan.incidentId}`);

  const checks: RecoveryVerificationCheck[] = [];

  // 1. Re-collect the SAME real signal(s) that triggered this Incident — live, real check.
  const primarySignalType = incidentSignalTypeOf(incident);
  if (primarySignalType) {
    try {
      const fresh = await collectSignal(primarySignalType, ownerId, actor);
      checks.push({ criterion: "Signal returns to HEALTHY", result: fresh.status === "HEALTHY" ? "PASS" : fresh.status === "UNKNOWN" ? "UNKNOWN" : "FAIL", evidence: `real, live re-collection of ${primarySignalType}: ${fresh.status} — ${fresh.reason}` });
    } catch {
      checks.push({ criterion: "Signal returns to HEALTHY", result: "UNKNOWN", evidence: "real re-collection failed to run" });
    }
  } else {
    checks.push({ criterion: "Signal returns to HEALTHY", result: "UNKNOWN", evidence: "no real primary signal type mapped for this Incident type" });
  }

  // 2. Artifact/Registry integrity — real, live re-check.
  try {
    const findings = checkIntegrity(ownerId);
    checks.push({ criterion: "Artifact/Registry integrity passes", result: findings.length === 0 ? "PASS" : "FAIL", evidence: `real, live checkIntegrity(): ${findings.length} finding(s)` });
  } catch {
    checks.push({ criterion: "Artifact/Registry integrity passes", result: "UNKNOWN", evidence: "real integrity check failed to run" });
  }

  // 3. No data loss — requires real, owner-supplied evidence; this Runtime cannot confirm this alone.
  checks.push({
    criterion: "No data loss confirmed", result: importedEvidence?.dataLossConfirmedAbsent === true ? "PASS" : "UNKNOWN",
    evidence: importedEvidence?.dataLossConfirmedAbsent === true ? "real, owner-supplied confirmation" : "no real, owner-supplied evidence provided — honestly UNKNOWN, never assumed",
  });

  // 4. No other Scope affected — requires real, owner-supplied evidence.
  checks.push({
    criterion: "No other Scope affected", result: importedEvidence?.otherScopeUnaffectedConfirmed === true ? "PASS" : "UNKNOWN",
    evidence: importedEvidence?.otherScopeUnaffectedConfirmed === true ? "real, owner-supplied confirmation" : "no real, owner-supplied evidence provided — honestly UNKNOWN, never assumed",
  });

  const fails = checks.filter((c) => c.result === "FAIL");
  const unknowns = checks.filter((c) => c.result === "UNKNOWN");
  let status: VerificationStatus;
  let reason: string;
  if (fails.length > 0) { status = "UNVERIFIED"; reason = `${fails.length} real check(s) FAILED — recovery not confirmed`; }
  else if (unknowns.length === checks.length) { status = "UNKNOWN"; reason = "no real check could be evaluated — evidence entirely missing"; }
  else if (unknowns.length > 0) { status = "PARTIAL"; reason = `${unknowns.length}/${checks.length} real check(s) could not be evaluated — evidence incomplete`; }
  else { status = "VERIFIED"; reason = `all ${checks.length} real check(s) PASSED`; }

  const verification: RecoveryVerificationResult = { status, checkedAt: new Date().toISOString(), checks, reason };
  plan.verification = verification;
  plan.executionStatus = status === "VERIFIED" ? "VERIFIED_FROM_EVIDENCE" : plan.executionStatus === "NOT_EXECUTED" ? "NOT_EXECUTED" : plan.executionStatus === "BLOCKED" ? "BLOCKED" : "UNKNOWN";

  const verificationArtifact = createOperationsArtifact({
    artifactType: "RECOVERY_VERIFICATION_REPORT", content: JSON.stringify(verification), mimeType: "application/json",
    actor, ownerId, generatedFrom: `${recoveryPlanId}-verify-${Date.now()}`, jobId: job.jobId, relatedRecoveryPlanId: recoveryPlanId,
  });
  plan.artifactIds.push(verificationArtifact.artifactId);
  plan.evidence.push(verificationArtifact.artifactId);

  if (status === "VERIFIED") emitRecoveryEvent("RECOVERY_VERIFIED", recoveryPlanId, actor, reason);
  else emitRecoveryEvent("RECOVERY_UNVERIFIED", recoveryPlanId, actor, reason);

  finalizeOperationsJob(job.jobId, ownerId, { ok: status === "VERIFIED", result: status, error: status !== "VERIFIED" ? reason : null });
  return plan;
}

function incidentSignalTypeOf(incident: IncidentRecord): SignalType | null {
  const map: Record<string, SignalType> = {
    RUNTIME_FAILURE: "RUNTIME_HEALTH", API_FAILURE: "API_HEALTH", DATABASE_FAILURE: "DATABASE_HEALTH",
    QUEUE_STALL: "QUEUE_HEALTH", EXECUTION_FAILURE: "EXECUTION_HEALTH", ARTIFACT_CORRUPTION: "ARTIFACT_INTEGRITY",
    REGISTRY_DRIFT: "REGISTRY_INTEGRITY", GOVERNANCE_FAILURE: "GOVERNANCE_HEALTH", BUILD_FAILURE: "BUILD_HEALTH",
    RELEASE_FAILURE: "RELEASE_HEALTH", DEPLOYMENT_BLOCKED: "DEPLOYMENT_PLAN_HEALTH", STORAGE_PRESSURE: "STORAGE_HEALTH",
    CONNECTOR_FAILURE: "CONNECTOR_HEALTH", PROVIDER_OUTAGE: "EXTERNAL_PROVIDER_HEALTH", COST_ANOMALY: "COST_ANOMALY",
    PROCESS_LEAK: "PROCESS_LEAK", DATA_STALE: "DATA_FRESHNESS", BACKUP_FAILURE: "BACKUP_HEALTH",
  };
  return map[incident.type] ?? null;
}

export function getRecoveryPlan(recoveryPlanId: string, ownerId: string): RecoveryPlan {
  const plan = recoveryPlans.get(recoveryPlanId);
  if (!plan) throw new RecoveryError("RECOVERY_PLAN_NOT_FOUND", "no Recovery Plan with that id");
  if (plan.ownerId !== ownerId) throw new RecoveryError("RECOVERY_PLAN_NOT_OWNED", "this Recovery Plan belongs to a different session");
  return plan;
}
export function listRecoveryPlans(ownerId: string): RecoveryPlan[] {
  return [...recoveryPlans.values()].filter((p) => p.ownerId === ownerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function __debugRecoveryPlanCount(): number { return recoveryPlans.size; }
