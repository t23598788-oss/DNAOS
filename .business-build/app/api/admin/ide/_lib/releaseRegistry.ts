/**
 * Release Pipeline — Release Stage Registry (owner, 2026-08-07, Software
 * Factory Step 10). Declares the real Release Pipeline stages. Every
 * stage reuses a real, already-built Runtime from Steps 2–9.5 — never a
 * new Runtime/Queue/Artifact/Evidence Store (Rule 103).
 *
 * Reuse investigation (Phase 1) confirmed real, by direct inspection:
 *  - buildRuntime.ts (Step 9/9.5) — the real source of a Release
 *    Candidate: only a real BuildRun with status SUCCEEDED or
 *    SUCCEEDED_WITH_WARNINGS, and a real, fresh (non-stale) Gate Report,
 *    may become a Release Candidate.
 *  - changeSetRuntime.ts / testRuntime.ts (Steps 7/8) — Release
 *    Validation re-checks the real Change Set/Test Run linkage the
 *    Build Run already carries, via the SAME real accessors.
 *  - governanceRuntime.ts (Step 4.5) — reused for the real Governance
 *    gate inside Release Validation (computeCoverageSummary()).
 *  - artifactRuntime.ts (Step 5) — the ONLY real Artifact/Evidence Store;
 *    every new Release artifact type routes through createReleaseArtifact()
 *    -> the SAME createArtifactInternal().
 *  - queueRuntime.ts (Step 3) — reused via startReleaseJob()/
 *    finalizeReleaseJob(), generalized the same way every prior Step did.
 *  - registry/capability-registry.json (real, frozen, 202 real
 *    capabilities) — the ONLY real source Capability Packaging reads from;
 *    never a second capability list.
 *  - registry/factory-mapping.json / registry/factory-summary.json — real
 *    Factory ownership for Package Owner + Factory Ready.
 *  - registry/business-coverage.json / registry/AI_REGISTRY.json /
 *    registry/infrastructure.json — real, existing sources for Business
 *    Ready / AI Ready / Infrastructure Ready. No new registry file
 *    invented for these.
 * Real gap found: no Legal Package / Country Package of any kind exists
 * anywhere in this repo — Legal Ready and Country Package Dependency are
 * therefore honestly NOT_IMPLEMENTED, never guessed READY.
 */
export type ReleaseStage =
  | "BUILD" | "RELEASE_CANDIDATE" | "RELEASE_VALIDATION" | "CAPABILITY_PACKAGING" | "RELEASE_APPROVAL" | "OPERATIONAL_READY";

export type ReleaseStageStatus = "PASSED" | "FAILED" | "BLOCKED" | "UNKNOWN" | "NOT_IMPLEMENTED";

export interface ReleaseStageDefinition {
  stage: ReleaseStage;
  name: string;
  description: string;
  producer: string;
  requiredInputs: string[];
  blockingPolicy: string;
  evidenceSource: string;
  status: "IMPLEMENTED" | "NOT_IMPLEMENTED";
}

export const RELEASE_STAGE_REGISTRY: Record<ReleaseStage, ReleaseStageDefinition> = {
  BUILD: {
    stage: "BUILD", name: "Build",
    description: "Real, already-completed Build Run from the Build Pipeline (Step 9/9.5) — the Release Pipeline never re-runs or re-implements a build.",
    producer: "app/api/admin/ide/_lib/buildRuntime.ts",
    requiredInputs: ["a real BuildRun with status SUCCEEDED or SUCCEEDED_WITH_WARNINGS"],
    blockingPolicy: "any other real BuildRun status blocks Release Candidate creation",
    evidenceSource: "app/api/admin/ide/_lib/buildRuntime.ts#getBuildRun",
    status: "IMPLEMENTED",
  },
  RELEASE_CANDIDATE: {
    stage: "RELEASE_CANDIDATE", name: "Release Candidate",
    description: "Real, immutable snapshot referencing one real, successful Build Run — never a new build, never a copy of build output.",
    producer: "app/api/admin/ide/_lib/releaseRuntime.ts#createReleaseCandidate",
    requiredInputs: ["real buildRunId"],
    blockingPolicy: "a stale or non-SUCCEEDED real Build Run blocks Release Candidate creation",
    evidenceSource: "app/api/admin/ide/_lib/releaseRuntime.ts",
    status: "IMPLEMENTED",
  },
  RELEASE_VALIDATION: {
    stage: "RELEASE_VALIDATION", name: "Release Validation",
    description: "Real re-validation of the Release Candidate's real Build Gate Report, real Change Set/Test Run freshness, and real Governance coverage — never a guessed re-stamp of the Build's own result.",
    producer: "app/api/admin/ide/_lib/releaseRuntime.ts#validateReleaseCandidate",
    requiredInputs: ["real Release Candidate", "real, current registry/*.json state"],
    blockingPolicy: "any real FAILED/BLOCKED gate, or real staleness, blocks Release Validation",
    evidenceSource: "app/api/admin/ide/_lib/buildRuntime.ts#computeBuildGateReport + app/api/admin/ide/_lib/changeSetRuntime.ts + app/api/admin/ide/_lib/testRuntime.ts",
    status: "IMPLEMENTED",
  },
  CAPABILITY_PACKAGING: {
    stage: "CAPABILITY_PACKAGING", name: "Capability Packaging",
    description: "Real per-Capability package manifests built ONLY from registry/capability-registry.json's real, frozen 202 capabilities — never a fabricated or duplicated capability.",
    producer: "app/api/admin/ide/_lib/releaseRuntime.ts#packageCapabilities",
    requiredInputs: ["real registry/capability-registry.json", "real registry/factory-mapping.json"],
    blockingPolicy: "a real capability referencing a real missing OwnerModule file blocks packaging for that capability only",
    evidenceSource: "registry/capability-registry.json",
    status: "IMPLEMENTED",
  },
  RELEASE_APPROVAL: {
    stage: "RELEASE_APPROVAL", name: "Release Approval",
    description: "Real, deterministic ALLOWED/BLOCKED decision citing the exact real Release Validation + Capability Packaging results — same discipline as Step 9.5's Build Decision.",
    producer: "app/api/admin/ide/_lib/releaseRuntime.ts#explainReleaseDecision",
    requiredInputs: ["real Release Validation result", "real Capability Packaging result"],
    blockingPolicy: "never blocking itself — reports the real upstream blocking reasons",
    evidenceSource: "app/api/admin/ide/_lib/releaseRuntime.ts",
    status: "IMPLEMENTED",
  },
  OPERATIONAL_READY: {
    stage: "OPERATIONAL_READY", name: "Operational Ready",
    description: "Real, per-dimension Operational Readiness (Production/Factory/Business/Legal/Evidence/Infrastructure/AI/Runtime/Package/Deployment) — UNKNOWN/NOT_IMPLEMENTED honestly reported wherever no real data source exists (Legal Ready has none this phase).",
    producer: "app/api/admin/ide/_lib/releaseRuntime.ts#computeOperationalReadiness",
    requiredInputs: ["real Release Approval result"],
    blockingPolicy: "never itself blocking — a real report of readiness, not a gate",
    evidenceSource: "registry/business-coverage.json, registry/AI_REGISTRY.json, registry/infrastructure.json, registry/factory-summary.json",
    status: "IMPLEMENTED",
  },
};

export function listReleaseStages(): ReleaseStageDefinition[] {
  return Object.values(RELEASE_STAGE_REGISTRY);
}
export function getReleaseStageDefinition(stage: string): ReleaseStageDefinition | undefined {
  return RELEASE_STAGE_REGISTRY[stage as ReleaseStage];
}
