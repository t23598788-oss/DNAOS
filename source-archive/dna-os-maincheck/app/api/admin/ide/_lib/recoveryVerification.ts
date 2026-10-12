/** Existing recovery verification; shares the original recovery-plan and event stores. */
import { getRecoveryPlan, emitRecoveryEvent, type RecoveryPlan, type RecoveryVerificationCheck, type RecoveryVerificationResult, type VerificationStatus } from "./recoveryPlans";
import { getIncident, type IncidentRecord } from "./incidentRuntime";
import { collectSignal } from "./monitoringRuntime";
import type { SignalType } from "./monitoringRegistry";
import { startOperationsJob, finalizeOperationsJob } from "./queueRuntime";
import { checkIntegrity, createOperationsArtifact } from "./artifactRuntime";


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
