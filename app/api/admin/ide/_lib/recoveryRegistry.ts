/**
 * Recovery — Recovery Type Registry (owner, 2026-08-08, Software Factory
 * Step 12). Declares the real Recovery Types recoveryRuntime.ts can plan.
 * Every type that mutates the real world (provider config, deploy,
 * rollback, restore, restart, delete, disable) is registered
 * `status: "PLAN_ONLY"` or `"NOT_IMPLEMENTED"` this Step — never
 * `"IMPLEMENTED"` for a real mutation (mission: "Action ที่เปลี่ยนโลก
 * จริงต้องเป็น PLAN_ONLY หรือ NOT_IMPLEMENTED").
 *
 * Reuse investigation: RESTORE_FROM_BACKUP's real underlying mechanism is
 * scripts/backup.ts's restore() function (real, exists) — but Phase 12's
 * audit found no evidence a real, verified restore-and-check cycle has
 * ever been run via that automated path (the one real recovery this repo
 * has evidence of, 2026-07-10's pit_profiles/pit_materials/vehicle_types
 * recreation, was a manual SQL schema rebuild citing the backup, not an
 * automated `npm run restore` execution) — so RESTORE_FROM_BACKUP stays
 * PLAN_ONLY, never IMPLEMENTED, per the mission's explicit backup-without-
 * restore-test rule.
 */
export type RecoveryType =
  | "RETRY_OPERATION" | "RESTART_PROCESS" | "RESTORE_FROM_BACKUP" | "ROLLBACK_RELEASE" | "ROLLBACK_DEPLOYMENT"
  | "SWITCH_PROVIDER" | "DISABLE_CONNECTOR" | "REBUILD_ARTIFACT" | "REGENERATE_REGISTRY" | "CLEAR_STALE_JOB"
  | "MANUAL_INTERVENTION" | "CUSTOM_RECOVERY";

export type RecoveryTypeStatus = "IMPLEMENTED" | "PLAN_ONLY" | "VERIFICATION_ONLY" | "NOT_IMPLEMENTED" | "UNKNOWN";
export type MutationLevel = "NONE" | "LOCAL_STATE_ONLY" | "PROVIDER_MUTATING" | "DESTRUCTIVE" | "UNKNOWN";

export interface RecoveryTypeDefinition {
  id: RecoveryType;
  displayName: string;
  status: RecoveryTypeStatus;
  planner: string;
  executor: string;
  verification: string;
  mutationLevel: MutationLevel;
  ownerApprovalRequired: boolean;
  prerequisites: string[];
  evidenceRequirements: string[];
  rollbackCapability: string;
  limitations: string;
}

export const RECOVERY_TYPE_REGISTRY: Record<RecoveryType, RecoveryTypeDefinition> = {
  RETRY_OPERATION: {
    id: "RETRY_OPERATION", displayName: "Retry Operation", status: "PLAN_ONLY",
    planner: "recoveryRuntime.ts#createRecoveryPlan", executor: "NONE this Step", verification: "recoveryRuntime.ts#verifyRecovery (re-checks the real, same Monitoring signal)",
    mutationLevel: "LOCAL_STATE_ONLY", ownerApprovalRequired: true,
    prerequisites: ["a real, failed Job/Run/Build/Release record to re-target"], evidenceRequirements: ["the real prior failure record"],
    rollbackCapability: "n/a — retrying creates a new record, never mutates the original", limitations: "planning only this Step; the real retry action itself is not executed",
  },
  RESTART_PROCESS: {
    id: "RESTART_PROCESS", displayName: "Restart Process", status: "NOT_IMPLEMENTED",
    planner: "recoveryRuntime.ts#createRecoveryPlan", executor: "NONE", verification: "NONE",
    mutationLevel: "PROVIDER_MUTATING", ownerApprovalRequired: true,
    prerequisites: ["a real process manager integration (does not exist in this repo)"], evidenceRequirements: [],
    rollbackCapability: "UNKNOWN — no real process manager exists to audit", limitations: "no real process/service manager exists anywhere in this repo — honestly NOT_IMPLEMENTED, not merely unplanned",
  },
  RESTORE_FROM_BACKUP: {
    id: "RESTORE_FROM_BACKUP", displayName: "Restore From Backup", status: "PLAN_ONLY",
    planner: "recoveryRuntime.ts#createRecoveryPlan", executor: "scripts/backup.ts#restore (real, exists, NOT invoked by this Runtime)", verification: "recoveryRuntime.ts#verifyRecovery (requires real, owner-supplied post-restore evidence)",
    mutationLevel: "DESTRUCTIVE", ownerApprovalRequired: true,
    prerequisites: ["a real backup manifest (backups/*/_manifest.json)", "explicit owner approval"], evidenceRequirements: ["real BACKUP_HEALTH signal", "real, owner-supplied post-restore verification evidence"],
    rollbackCapability: "NONE confirmed — restore is upsert-only per scripts/backup.ts, no pre-restore snapshot mechanism exists", limitations: "no real, verified restore-and-check cycle has ever been run via the automated path in this repo (Phase 12 audit) — never IMPLEMENTED until one is",
  },
  ROLLBACK_RELEASE: {
    id: "ROLLBACK_RELEASE", displayName: "Rollback Release", status: "PLAN_ONLY",
    planner: "recoveryRuntime.ts#createRecoveryPlan", executor: "NONE this Step", verification: "recoveryRuntime.ts#verifyRecovery",
    mutationLevel: "LOCAL_STATE_ONLY", ownerApprovalRequired: true,
    prerequisites: ["a real, prior Release Run to roll back to (releaseRuntime.ts#listReleaseRuns)"], evidenceRequirements: ["real ReleaseRun records"],
    rollbackCapability: "n/a — this IS the rollback plan", limitations: "planning only — no real deploy exists this Step for a rollback to reverse",
  },
  ROLLBACK_DEPLOYMENT: {
    id: "ROLLBACK_DEPLOYMENT", displayName: "Rollback Deployment", status: "PLAN_ONLY",
    planner: "recoveryRuntime.ts#createRecoveryPlan", executor: "NONE this Step", verification: "recoveryRuntime.ts#verifyRecovery",
    mutationLevel: "LOCAL_STATE_ONLY", ownerApprovalRequired: true,
    prerequisites: ["a real Deployment Plan's real RollbackPlan (deploymentRuntime.ts#buildRollbackPlan)"], evidenceRequirements: ["real DeploymentPlan records"],
    rollbackCapability: "n/a — this IS the rollback plan", limitations: "planning only — deploymentRuntime.ts's own RollbackPlan.executionStatus is already honestly NOT_IMPLEMENTED (Step 11 Rule 180); this Recovery Type only re-surfaces that plan for Incident linkage",
  },
  SWITCH_PROVIDER: {
    id: "SWITCH_PROVIDER", displayName: "Switch Provider", status: "NOT_IMPLEMENTED",
    planner: "recoveryRuntime.ts#createRecoveryPlan", executor: "NONE", verification: "NONE",
    mutationLevel: "PROVIDER_MUTATING", ownerApprovalRequired: true,
    prerequisites: ["a real alternate provider configuration (does not exist for any provider in this repo)"], evidenceRequirements: [],
    rollbackCapability: "UNKNOWN", limitations: "no real alternate/failover provider is configured anywhere in this repo",
  },
  DISABLE_CONNECTOR: {
    id: "DISABLE_CONNECTOR", displayName: "Disable Connector", status: "PLAN_ONLY",
    planner: "recoveryRuntime.ts#createRecoveryPlan", executor: "NONE this Step", verification: "recoveryRuntime.ts#verifyRecovery",
    mutationLevel: "PROVIDER_MUTATING", ownerApprovalRequired: true,
    prerequisites: ["a real, identified failing Connector (CONNECTOR_HEALTH signal)"], evidenceRequirements: ["real CONNECTOR_HEALTH signal"],
    rollbackCapability: "re-enabling is a real, separate, owner-driven action outside this Runtime", limitations: "planning only — disabling a real Supabase Edge Function cron requires a real SQL migration, not executed by this Runtime",
  },
  REBUILD_ARTIFACT: {
    id: "REBUILD_ARTIFACT", displayName: "Rebuild Artifact", status: "PLAN_ONLY",
    planner: "recoveryRuntime.ts#createRecoveryPlan", executor: "artifactRuntime.ts#regenerateArtifact (real, exists, NOT invoked automatically)", verification: "recoveryRuntime.ts#verifyRecovery (re-runs checkIntegrity())",
    mutationLevel: "LOCAL_STATE_ONLY", ownerApprovalRequired: true,
    prerequisites: ["a real ARTIFACT_CORRUPTION finding", "an artifact type with supportsRegenerate:true"], evidenceRequirements: ["real IntegrityFinding"],
    rollbackCapability: "n/a — regenerateArtifact() creates a new version, never deletes the old (immutable per Rule established Step 5)", limitations: "planning only — the real regenerateArtifact() call itself requires explicit owner action",
  },
  REGENERATE_REGISTRY: {
    id: "REGENERATE_REGISTRY", displayName: "Regenerate Registry", status: "PLAN_ONLY",
    planner: "recoveryRuntime.ts#createRecoveryPlan", executor: "npm run sync (real, exists, NOT invoked automatically)", verification: "recoveryRuntime.ts#verifyRecovery (re-reads registry/architecture-book.json summary)",
    mutationLevel: "LOCAL_STATE_ONLY", ownerApprovalRequired: true,
    prerequisites: ["a real REGISTRY_DRIFT or DATA_STALE finding"], evidenceRequirements: ["real REGISTRY_INTEGRITY or DATA_FRESHNESS signal"],
    rollbackCapability: "n/a — sync only adds/updates registry entries, never deletes real modules", limitations: "planning only — npm run sync itself is a real, safe, idempotent command, but still requires explicit owner action",
  },
  CLEAR_STALE_JOB: {
    id: "CLEAR_STALE_JOB", displayName: "Clear Stale Job", status: "PLAN_ONLY",
    planner: "recoveryRuntime.ts#createRecoveryPlan", executor: "NONE this Step", verification: "recoveryRuntime.ts#verifyRecovery",
    mutationLevel: "LOCAL_STATE_ONLY", ownerApprovalRequired: true,
    prerequisites: ["a real, stuck Job record (QUEUE_STALL finding)"], evidenceRequirements: ["real QUEUE_HEALTH signal"],
    rollbackCapability: "n/a", limitations: "planning only — no real job-clearing mutation exists in queueRuntime.ts to invoke",
  },
  MANUAL_INTERVENTION: {
    id: "MANUAL_INTERVENTION", displayName: "Manual Intervention", status: "PLAN_ONLY",
    planner: "recoveryRuntime.ts#createRecoveryPlan", executor: "the real, human Owner, outside this Runtime entirely", verification: "recoveryRuntime.ts#verifyRecovery (requires real, owner-supplied evidence)",
    mutationLevel: "NONE", ownerApprovalRequired: true,
    prerequisites: ["any real Incident"], evidenceRequirements: ["real, owner-supplied verification evidence after the manual action"],
    rollbackCapability: "n/a — outside this Runtime's control by design", limitations: "always the honest fallback when no other real Recovery Type applies",
  },
  CUSTOM_RECOVERY: {
    id: "CUSTOM_RECOVERY", displayName: "Custom Recovery", status: "PLAN_ONLY",
    planner: "recoveryRuntime.ts#createRecoveryPlan", executor: "the real, human Owner, outside this Runtime entirely", verification: "recoveryRuntime.ts#verifyRecovery (requires real, owner-supplied evidence)",
    mutationLevel: "UNKNOWN", ownerApprovalRequired: true,
    prerequisites: ["a real Incident with no matching standard Recovery Type"], evidenceRequirements: ["real, owner-supplied verification evidence"],
    rollbackCapability: "UNKNOWN — depends entirely on the real, owner-defined action", limitations: "a real, free-text plan description only — this Runtime never infers or executes a custom action",
  },
};

export function listRecoveryTypes(): RecoveryTypeDefinition[] {
  return Object.values(RECOVERY_TYPE_REGISTRY);
}
export function getRecoveryTypeDefinition(type: string): RecoveryTypeDefinition | undefined {
  return RECOVERY_TYPE_REGISTRY[type as RecoveryType];
}
