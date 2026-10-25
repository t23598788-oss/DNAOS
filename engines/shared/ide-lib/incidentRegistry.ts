/**
 * Incident — Incident Type Registry (owner, 2026-08-08, Software Factory
 * Step 12). Declares the real Incident Types incidentRuntime.ts can open.
 * Every type here is opened ONLY from a real Monitoring finding
 * (monitoringRuntime.ts) — never guessed, never opened from a hunch.
 * Auto-close is OFF for every type this Step (per mission: "Auto-close
 * ต้องปิดไว้ในรอบนี้") — closure always requires real, imported
 * verification evidence via recoveryRuntime.ts, never automatic.
 */
export type IncidentType =
  | "RUNTIME_FAILURE" | "API_FAILURE" | "DATABASE_FAILURE" | "QUEUE_STALL" | "EXECUTION_FAILURE"
  | "ARTIFACT_CORRUPTION" | "REGISTRY_DRIFT" | "GOVERNANCE_FAILURE" | "BUILD_FAILURE" | "RELEASE_FAILURE"
  | "DEPLOYMENT_BLOCKED" | "PROVIDER_OUTAGE" | "STORAGE_PRESSURE" | "CONNECTOR_FAILURE" | "COST_ANOMALY"
  | "PROCESS_LEAK" | "DATA_STALE" | "BACKUP_FAILURE" | "UNKNOWN_INCIDENT";

export type IncidentTypeStatus = "IMPLEMENTED" | "PARTIAL" | "NOT_IMPLEMENTED";

export interface IncidentTypeDefinition {
  id: IncidentType;
  displayName: string;
  detectionSources: string[];
  minimumSeverity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  deduplicationWindowMs: number;
  autoOpenPolicy: "MANUAL_ONLY" | "FROM_REAL_MONITORING_FINDING";
  autoClosePolicy: "DISABLED";
  owner: string;
  requiredEvidence: string[];
  recoveryPolicy: string;
  status: IncidentTypeStatus;
}

const MIN_30 = 30 * 60_000;

function def(id: IncidentType, displayName: string, detectionSources: string[], minimumSeverity: IncidentTypeDefinition["minimumSeverity"], recoveryPolicy: string, status: IncidentTypeStatus = "IMPLEMENTED"): IncidentTypeDefinition {
  return {
    id, displayName, detectionSources, minimumSeverity, deduplicationWindowMs: MIN_30,
    autoOpenPolicy: "FROM_REAL_MONITORING_FINDING", autoClosePolicy: "DISABLED", owner: "operations-center",
    requiredEvidence: ["real Signal Record(s) that triggered detection"], recoveryPolicy, status,
  };
}

export const INCIDENT_TYPE_REGISTRY: Record<IncidentType, IncidentTypeDefinition> = {
  RUNTIME_FAILURE: def("RUNTIME_FAILURE", "Runtime Failure", ["RUNTIME_HEALTH"], "HIGH", "MANUAL_INTERVENTION only — no real automatic Runtime restart mechanism exists"),
  API_FAILURE: def("API_FAILURE", "API Failure", ["API_HEALTH"], "MEDIUM", "MANUAL_INTERVENTION only", "PARTIAL"),
  DATABASE_FAILURE: def("DATABASE_FAILURE", "Database Failure", ["DATABASE_HEALTH"], "CRITICAL", "SWITCH_PROVIDER / MANUAL_INTERVENTION — plan only"),
  QUEUE_STALL: def("QUEUE_STALL", "Queue Stall", ["QUEUE_HEALTH"], "MEDIUM", "CLEAR_STALE_JOB — plan only, never auto-cleared"),
  EXECUTION_FAILURE: def("EXECUTION_FAILURE", "Execution Failure", ["EXECUTION_HEALTH"], "MEDIUM", "RETRY_OPERATION — plan only"),
  ARTIFACT_CORRUPTION: def("ARTIFACT_CORRUPTION", "Artifact Corruption", ["ARTIFACT_INTEGRITY"], "HIGH", "REBUILD_ARTIFACT — plan only"),
  REGISTRY_DRIFT: def("REGISTRY_DRIFT", "Registry Drift", ["REGISTRY_INTEGRITY"], "MEDIUM", "REGENERATE_REGISTRY — plan only (npm run sync is a real, safe, non-destructive command, but still requires explicit owner action, not auto-run by Incident Runtime)"),
  GOVERNANCE_FAILURE: def("GOVERNANCE_FAILURE", "Governance Failure", ["GOVERNANCE_HEALTH"], "HIGH", "MANUAL_INTERVENTION only"),
  BUILD_FAILURE: def("BUILD_FAILURE", "Build Failure", ["BUILD_HEALTH"], "MEDIUM", "RETRY_OPERATION — plan only"),
  RELEASE_FAILURE: def("RELEASE_FAILURE", "Release Failure", ["RELEASE_HEALTH"], "MEDIUM", "RETRY_OPERATION — plan only"),
  DEPLOYMENT_BLOCKED: def("DEPLOYMENT_BLOCKED", "Deployment Blocked", ["DEPLOYMENT_PLAN_HEALTH"], "INFO", "n/a — DEPLOYMENT_PLAN_HEALTH never opens this Incident by itself this Step (expected BLOCKED state, see Rule 176)", "PARTIAL"),
  PROVIDER_OUTAGE: def("PROVIDER_OUTAGE", "Provider Outage", ["EXTERNAL_PROVIDER_HEALTH"], "HIGH", "SWITCH_PROVIDER — plan only"),
  STORAGE_PRESSURE: def("STORAGE_PRESSURE", "Storage Pressure", ["STORAGE_HEALTH"], "MEDIUM", "MANUAL_INTERVENTION only", "PARTIAL"),
  CONNECTOR_FAILURE: def("CONNECTOR_FAILURE", "Connector Failure", ["CONNECTOR_HEALTH"], "MEDIUM", "DISABLE_CONNECTOR — plan only"),
  COST_ANOMALY: def("COST_ANOMALY", "Cost Anomaly", ["COST_ANOMALY"], "LOW", "MANUAL_INTERVENTION only — no real anomaly detector exists yet", "PARTIAL"),
  PROCESS_LEAK: def("PROCESS_LEAK", "Process Leak", ["PROCESS_LEAK"], "MEDIUM", "n/a — no real detection source exists this Step", "NOT_IMPLEMENTED"),
  DATA_STALE: def("DATA_STALE", "Data Stale", ["DATA_FRESHNESS"], "LOW", "REGENERATE_REGISTRY — plan only"),
  BACKUP_FAILURE: def("BACKUP_FAILURE", "Backup Failure", ["BACKUP_HEALTH"], "HIGH", "RESTORE_FROM_BACKUP — PLAN_ONLY, never executed (no verified restore-test cycle exists — see Recovery Registry)"),
  UNKNOWN_INCIDENT: def("UNKNOWN_INCIDENT", "Unknown Incident", ["(any Signal Type reporting UNKNOWN with no matching real Incident Type)"], "LOW", "MANUAL_INTERVENTION only — never auto-classified into a specific type without real evidence"),
};

export function listIncidentTypes(): IncidentTypeDefinition[] {
  return Object.values(INCIDENT_TYPE_REGISTRY);
}
export function getIncidentTypeDefinition(type: string): IncidentTypeDefinition | undefined {
  return INCIDENT_TYPE_REGISTRY[type as IncidentType];
}
