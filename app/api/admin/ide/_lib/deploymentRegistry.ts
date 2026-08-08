/**
 * Deployment Orchestration — Deployment Target & Stage Registry (owner,
 * 2026-08-08, Software Factory Step 11). Declares the real Deployment
 * Stages and the real, KNOWN external Deployment Targets this repo could
 * eventually deploy to — never a real integration. Every target here is
 * registered `integrationStatus: "NOT_IMPLEMENTED"` per the Step 11
 * mandate ("ห้าม Deploy จริง, ห้าม Git Push") — this registry exists so
 * the Deployment Orchestration Runtime has real, named things to plan
 * against, never so it can actually call them.
 *
 * Reuse investigation (Phase 1) confirmed: Step 10.5's VS Code Dependency
 * Audit already found Vercel UI and Supabase UI to be real,
 * `blockingOwnerMigration: true`, `replacementStatus: NOT_IMPLEMENTED`
 * dependencies (app/api/admin/ide/_lib/factoryCompletionRuntime.ts#
 * computeVSCodeDependencyAudit) — this registry is consistent with, and
 * cites, that same real finding rather than re-deciding it.
 */
export type DeploymentStage =
  | "PLAN" | "MANIFEST" | "GATE_CHECK" | "APPROVAL" | "ROLLBACK_PLAN";

export interface DeploymentStageDefinition {
  stage: DeploymentStage;
  name: string;
  description: string;
  evidenceSource: string;
  status: "IMPLEMENTED" | "NOT_IMPLEMENTED";
}

export const DEPLOYMENT_STAGE_REGISTRY: Record<DeploymentStage, DeploymentStageDefinition> = {
  PLAN: {
    stage: "PLAN", name: "Deployment Plan",
    description: "Real, read-only plan referencing exactly one real, READY Release Run (Step 10) — never a new build, never a copy of release output.",
    evidenceSource: "app/api/admin/ide/_lib/releaseRuntime.ts#getReleaseRun", status: "IMPLEMENTED",
  },
  MANIFEST: {
    stage: "MANIFEST", name: "Deployment Manifest",
    description: "Real, declarative list of what WOULD be deployed (the Release Run's real Capability Packages) — pure data, never a real deploy call.",
    evidenceSource: "app/api/admin/ide/_lib/releaseRuntime.ts#packageCapabilities (via the referenced Release Run)", status: "IMPLEMENTED",
  },
  GATE_CHECK: {
    stage: "GATE_CHECK", name: "Deployment Gate",
    description: "Reuses the real DEPLOYMENT_READY Factory Completion Gate (Step 10.5) — honestly BLOCKED/NOT_IMPLEMENTED, since no real deploy target integration exists in this repo.",
    evidenceSource: "app/api/admin/ide/_lib/factoryCompletionRuntime.ts#computeCompletionGates", status: "IMPLEMENTED",
  },
  APPROVAL: {
    stage: "APPROVAL", name: "Deployment Approval",
    description: "Real, deterministic decision requiring explicit ownerConfirmation — never an AI-originated approval, never triggers a real deploy regardless of decision.",
    evidenceSource: "app/api/admin/ide/_lib/deploymentRuntime.ts#explainDeploymentDecision", status: "IMPLEMENTED",
  },
  ROLLBACK_PLAN: {
    stage: "ROLLBACK_PLAN", name: "Rollback Plan",
    description: "Real reference to the Release Run's real Capability Package versions as the rollback target — honestly NOT_IMPLEMENTED for real rollback EXECUTION (no real deploy history exists in this repo to roll back from).",
    evidenceSource: "app/api/admin/ide/_lib/releaseRuntime.ts (real ReleaseRun.packages[].version)", status: "IMPLEMENTED",
  },
};

export type DeploymentProvider = "VERCEL" | "SUPABASE";
export type DeploymentEnvironment = "PRODUCTION" | "STAGING";

export interface DeploymentTargetDefinition {
  targetId: string;
  provider: DeploymentProvider;
  environment: DeploymentEnvironment;
  description: string;
  integrationStatus: "NOT_IMPLEMENTED";
  evidence: string;
}

export const DEPLOYMENT_TARGET_REGISTRY: Record<string, DeploymentTargetDefinition> = {
  "vercel-production": {
    targetId: "vercel-production", provider: "VERCEL", environment: "PRODUCTION",
    description: "The real hosting provider this repo's `next build` output is intended for — registered as a real, known name only, never a real API integration.",
    integrationStatus: "NOT_IMPLEMENTED",
    evidence: "No real Vercel API call exists anywhere under app/api/admin/ide/_lib/ (grep-verified) — confirmed also by Step 10.5's VS Code Dependency Audit (Vercel UI: REPLACEABLE_PROVIDER, replacementStatus NOT_IMPLEMENTED).",
  },
  "supabase-production": {
    targetId: "supabase-production", provider: "SUPABASE", environment: "PRODUCTION",
    description: "The real database/edge-function provider this repo's supabase/migrations and supabase/functions target — registered as a real, known name only, never a real API integration.",
    integrationStatus: "NOT_IMPLEMENTED",
    evidence: "No real Supabase deploy/migration-push call exists anywhere under app/api/admin/ide/_lib/ (grep-verified) — confirmed also by Step 10.5's VS Code Dependency Audit (Supabase UI: OWNER_HIDDEN_DEPENDENCY, replacementStatus NOT_IMPLEMENTED).",
  },
};

export function listDeploymentTargets(): DeploymentTargetDefinition[] {
  return Object.values(DEPLOYMENT_TARGET_REGISTRY);
}
export function getDeploymentTargetDefinition(targetId: string): DeploymentTargetDefinition | undefined {
  return DEPLOYMENT_TARGET_REGISTRY[targetId];
}
export function listDeploymentStages(): DeploymentStageDefinition[] {
  return Object.values(DEPLOYMENT_STAGE_REGISTRY);
}
export function getDeploymentStageDefinition(stage: string): DeploymentStageDefinition | undefined {
  return DEPLOYMENT_STAGE_REGISTRY[stage as DeploymentStage];
}
