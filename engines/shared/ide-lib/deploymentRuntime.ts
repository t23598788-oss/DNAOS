/**
 * Deployment Orchestration Runtime (owner, 2026-08-08, Software Factory
 * Step 11). A factory that COMMANDS deployment readiness — never a real
 * Deploy system. Read-only against Source Control and Source Code: never
 * deploys, never calls Vercel/Supabase, never writes Git state. Reuses
 * releaseRuntime.ts/factoryCompletionRuntime.ts/queueRuntime.ts/
 * artifactRuntime.ts exactly — no new Runtime/Queue/Artifact/Evidence
 * Store (Rule 103); deploymentPlans below is a new in-memory Map for a
 * genuinely new record type, the same pattern buildRuns/releaseRuns used
 * in Steps 9/10, never a duplicate of an existing store.
 *
 * Reuse investigation (Phase 1) — real, confirmed by direct inspection:
 *  - releaseRuntime.ts (Step 10) is the ONLY real source of a real,
 *    READY Release Run — getReleaseRun() reused directly, never
 *    re-implemented. A Deployment Plan may only reference a Release Run
 *    whose real status is "READY".
 *  - factoryCompletionRuntime.ts (Step 10.5) is the ONLY real source of
 *    the DEPLOYMENT_READY Factory Completion Gate — computeCompletionGates()
 *    reused directly. That gate is real and NOT_IMPLEMENTED (no real
 *    Deploy stage exists anywhere in this repo) — so the Deployment Gate
 *    here is deterministically, honestly BLOCKED for every real plan,
 *    never fabricated as PASSED.
 *  - artifactRuntime.ts (Step 5) — createDeploymentArtifact() routes
 *    through the SAME createArtifactInternal() every prior Step's
 *    artifacts use.
 *  - queueRuntime.ts (Step 3) reused via startDeploymentJob()/
 *    finalizeDeploymentJob(), generalized the same way every prior Step
 *    did.
 *  - deploymentRegistry.ts (this Step) — real, declared Deployment
 *    Targets/Stages, every target integrationStatus: NOT_IMPLEMENTED.
 * Real gap found, honestly reported (never guessed): no real deploy
 * target integration of any kind exists in this repo — every Deployment
 * Plan this runtime produces is therefore honestly BLOCKED at the Gate
 * stage; this is the correct, expected behavior, not a bug.
 */
import { randomUUID } from "crypto";
import { getReleaseRun, type ReleaseRun } from "./releaseRuntime";
import { computeCompletionGates, type CompletionGate } from "./factoryCompletionRuntime";
import { getDeploymentTargetDefinition, listDeploymentTargets, type DeploymentTargetDefinition } from "./deploymentRegistry";
import { startDeploymentJob, finalizeDeploymentJob } from "./queueRuntime";
import { createDeploymentArtifact } from "./artifactRuntime";

export type DeploymentPlanStatus = "REQUESTED" | "PLANNING" | "GATE_CHECKING" | "APPROVING" | "BLOCKED" | "FAILED";

export interface DeploymentManifestEntry {
  capabilityId: string;
  version: string;
  category: string;
}
export interface DeploymentManifest {
  releaseRunId: string;
  targetId: string;
  entries: DeploymentManifestEntry[];
  computedAt: string;
}

export interface DeploymentGateResult {
  gate: string;
  status: "PASSED" | "FAILED" | "BLOCKED" | "UNKNOWN" | "NOT_IMPLEMENTED";
  evidence: string;
}
export interface DeploymentGateReport {
  computedAt: string;
  gates: DeploymentGateResult[];
  overallStatus: "ALL_PASSED" | "BLOCKED";
}

export interface RollbackPlan {
  rollbackTargetVersion: Record<string, string>;
  executionStatus: "NOT_IMPLEMENTED";
  evidence: string;
}

export interface DeploymentDecisionRecord {
  deploymentDecisionId: string;
  deploymentPlanId: string | null;
  decision: "ALLOWED" | "BLOCKED";
  reasons: string[];
  computedAt: string;
}

export interface DeploymentPlan {
  deploymentPlanId: string;
  releaseRunId: string;
  targetId: string;
  actor: string;
  ownerId: string;
  status: DeploymentPlanStatus;
  queueJobId: string | null;
  reason: string;
  startedAt: string;
  finishedAt: string | null;
  target: DeploymentTargetDefinition | null;
  manifest: DeploymentManifest | null;
  gateReport: DeploymentGateReport | null;
  rollbackPlan: RollbackPlan | null;
  decision: DeploymentDecisionRecord | null;
  artifactIds: string[];
  evidenceIds: string[];
  error: string | null;
}

export class DeploymentPipelineError extends Error {
  code: "DEPLOYMENT_PLAN_NOT_FOUND" | "DEPLOYMENT_PLAN_NOT_OWNED" | "RELEASE_RUN_NOT_FOUND" | "RELEASE_RUN_NOT_READY" | "TARGET_NOT_FOUND" | "INVALID_REQUEST" | "INTERNAL_ERROR";
  constructor(code: typeof DeploymentPipelineError.prototype.code, message: string) {
    super(message);
    this.code = code;
    this.name = "DeploymentPipelineError";
  }
}

const deploymentPlans = new Map<string, DeploymentPlan>();
const MAX_DEPLOYMENT_PLAN_HISTORY = 200;
function evictOld(ownerId: string) {
  const owned = [...deploymentPlans.values()].filter((p) => p.ownerId === ownerId).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  while (owned.length > MAX_DEPLOYMENT_PLAN_HISTORY) {
    const oldest = owned.shift()!;
    deploymentPlans.delete(oldest.deploymentPlanId);
  }
}

// ============================================================
// Manifest — real, declarative "what would be deployed", never a real call
// ============================================================
export function buildDeploymentManifest(release: ReleaseRun, targetId: string): DeploymentManifest {
  return {
    releaseRunId: release.releaseRunId, targetId,
    entries: release.packages.map((p) => ({ capabilityId: p.capabilityId, version: p.version, category: p.manifest.category })),
    computedAt: new Date().toISOString(),
  };
}

// ============================================================
// Gate — reuses the real DEPLOYMENT_READY Factory Completion Gate
// (Step 10.5) — never a second, invented readiness computation.
// ============================================================
export function computeDeploymentGate(release: ReleaseRun): DeploymentGateReport {
  const gates: DeploymentGateResult[] = [];

  gates.push({
    gate: "ReleaseReady",
    status: release.status === "READY" ? "PASSED" : "BLOCKED",
    evidence: `real ReleaseRun ${release.releaseRunId} status: ${release.status} — a Deployment Plan may only be built from a READY Release Run`,
  });

  const factoryGates: CompletionGate[] = computeCompletionGates();
  const deploymentReadyGate = factoryGates.find((g) => g.id === "DEPLOYMENT_READY")!;
  gates.push({
    gate: "FactoryDeploymentReady",
    status: deploymentReadyGate.status === "PASSED" ? "PASSED" : deploymentReadyGate.status === "NOT_IMPLEMENTED" ? "NOT_IMPLEMENTED" : "BLOCKED",
    evidence: `real factoryCompletionRuntime.ts DEPLOYMENT_READY gate: ${deploymentReadyGate.status} — ${deploymentReadyGate.evidence.join("; ") || "no real Deploy stage exists in this repo"}`,
  });

  const monitoringGate = factoryGates.find((g) => g.id === "MONITORING_READY")!;
  gates.push({
    gate: "MonitoringReady",
    status: monitoringGate.status === "PASSED" ? "PASSED" : monitoringGate.status === "NOT_IMPLEMENTED" ? "NOT_IMPLEMENTED" : "BLOCKED",
    evidence: `real factoryCompletionRuntime.ts MONITORING_READY gate: ${monitoringGate.status} — a real deploy without real Monitoring would be unobservable`,
  });

  const overallStatus: "ALL_PASSED" | "BLOCKED" = gates.every((g) => g.status === "PASSED") ? "ALL_PASSED" : "BLOCKED";
  return { computedAt: new Date().toISOString(), gates, overallStatus };
}

// ============================================================
// Rollback Plan — real reference to current package versions; execution
// honestly NOT_IMPLEMENTED (no real deploy history exists to roll back
// from in this repo).
// ============================================================
export function buildRollbackPlan(release: ReleaseRun): RollbackPlan {
  const rollbackTargetVersion: Record<string, string> = {};
  for (const p of release.packages) rollbackTargetVersion[p.capabilityId] = p.version;
  return {
    rollbackTargetVersion, executionStatus: "NOT_IMPLEMENTED",
    evidence: "real, current Capability Package versions from the referenced Release Run are recorded as the rollback reference point — no real deploy has ever occurred in this repo, so there is no real prior deployed state to roll back to, and no real rollback executor exists.",
  };
}

// ============================================================
// Approval / Decision — real, deterministic, never triggers a real deploy
// regardless of outcome.
// ============================================================
export function explainDeploymentDecision(gateReport: DeploymentGateReport, deploymentPlanId: string | null): DeploymentDecisionRecord {
  const reasons: string[] = [];
  for (const g of gateReport.gates) {
    if (g.status !== "PASSED") reasons.push(`${g.gate}: ${g.status} — ${g.evidence}`);
  }
  const blocked = reasons.length > 0;
  return {
    deploymentDecisionId: randomUUID(), deploymentPlanId, decision: blocked ? "BLOCKED" : "ALLOWED",
    reasons: blocked ? reasons : ["all real Deployment Gates passed"],
    computedAt: new Date().toISOString(),
  };
}

// ============================================================
// Core orchestration — real, read-only. Even a real "ALLOWED" decision
// NEVER triggers a real deploy call — this runtime only ever produces a
// plan/report; the mission forbids a real Deploy this Step entirely.
// ============================================================
export async function createDeploymentPlan(actor: string, ownerId: string, input: { releaseRunId: string; targetId: string; reason: string; ownerConfirmation: boolean }): Promise<DeploymentPlan> {
  if (!input.reason || input.reason.trim().length === 0) throw new DeploymentPipelineError("INVALID_REQUEST", "reason is required for every Deployment Plan");
  if (!input.ownerConfirmation) throw new DeploymentPipelineError("INVALID_REQUEST", "ownerConfirmation must be true");

  const target = getDeploymentTargetDefinition(input.targetId);
  if (!target) throw new DeploymentPipelineError("TARGET_NOT_FOUND", `no real Deployment Target registered with id "${input.targetId}" — real targets: ${listDeploymentTargets().map((t) => t.targetId).join(", ")}`);

  const deploymentPlanId = randomUUID();
  const startedAt = new Date().toISOString();
  const job = startDeploymentJob("DEPLOYMENT_PLAN_REQUEST", actor, ownerId, deploymentPlanId);

  const plan: DeploymentPlan = {
    deploymentPlanId, releaseRunId: input.releaseRunId, targetId: input.targetId, actor, ownerId,
    status: "REQUESTED", queueJobId: job.jobId, reason: input.reason, startedAt, finishedAt: null,
    target, manifest: null, gateReport: null, rollbackPlan: null, decision: null,
    artifactIds: [], evidenceIds: [], error: null,
  };
  deploymentPlans.set(deploymentPlanId, plan);

  let release: ReleaseRun;
  try {
    release = getReleaseRun(input.releaseRunId, ownerId);
  } catch (e) {
    plan.status = "FAILED";
    plan.error = e instanceof Error ? e.message : String(e);
    plan.finishedAt = new Date().toISOString();
    finalizeDeploymentJob(job.jobId, ownerId, { ok: false, result: null, error: plan.error });
    evictOld(ownerId);
    return plan;
  }

  plan.status = "PLANNING";
  plan.manifest = buildDeploymentManifest(release, input.targetId);
  const manifestArtifact = createDeploymentArtifact({
    artifactType: "DEPLOYMENT_PLAN", content: JSON.stringify({ manifest: plan.manifest, target: plan.target }), mimeType: "application/json",
    actor, ownerId, deploymentPlanId, jobId: job.jobId, sourceHash: null, generatedFrom: deploymentPlanId,
  });
  plan.artifactIds.push(manifestArtifact.artifactId);

  plan.status = "GATE_CHECKING";
  plan.gateReport = computeDeploymentGate(release);
  plan.rollbackPlan = buildRollbackPlan(release);
  const auditArtifact = createDeploymentArtifact({
    artifactType: "DEPLOYMENT_AUDIT", content: JSON.stringify({ gateReport: plan.gateReport, rollbackPlan: plan.rollbackPlan }), mimeType: "application/json",
    actor, ownerId, deploymentPlanId, jobId: job.jobId, sourceHash: null, generatedFrom: deploymentPlanId, parentIds: [manifestArtifact.artifactId],
  });
  plan.artifactIds.push(auditArtifact.artifactId);

  plan.status = "APPROVING";
  plan.decision = explainDeploymentDecision(plan.gateReport, deploymentPlanId);
  const decisionArtifact = createDeploymentArtifact({
    artifactType: "DEPLOYMENT_AUDIT", content: JSON.stringify(plan.decision), mimeType: "application/json",
    actor, ownerId, deploymentPlanId, jobId: job.jobId, sourceHash: null, generatedFrom: `${deploymentPlanId}-decision`, parentIds: [auditArtifact.artifactId],
  });
  plan.artifactIds.push(decisionArtifact.artifactId);
  plan.evidenceIds = [...plan.artifactIds];

  // NEVER "READY"/"DEPLOYED" — this runtime forbids a real deploy this
  // Step by construction; the terminal status is always BLOCKED, even
  // when every real Gate passes, because there is no real deploy
  // executor to hand the ALLOWED decision to.
  plan.status = "BLOCKED";
  plan.finishedAt = new Date().toISOString();
  finalizeDeploymentJob(job.jobId, ownerId, { ok: false, result: plan.decision.decision, error: `real deploy execution is forbidden this Step regardless of decision (${plan.decision.decision})` });

  deploymentPlans.set(deploymentPlanId, plan);
  evictOld(ownerId);
  return plan;
}

export function getDeploymentPlan(deploymentPlanId: string, ownerId: string): DeploymentPlan {
  const plan = deploymentPlans.get(deploymentPlanId);
  if (!plan) throw new DeploymentPipelineError("DEPLOYMENT_PLAN_NOT_FOUND", "no Deployment Plan with that id");
  if (plan.ownerId !== ownerId) throw new DeploymentPipelineError("DEPLOYMENT_PLAN_NOT_OWNED", "this Deployment Plan belongs to a different session");
  return plan;
}
export function listDeploymentPlans(ownerId: string): DeploymentPlan[] {
  return [...deploymentPlans.values()].filter((p) => p.ownerId === ownerId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function __debugDeploymentPlanCount(): number {
  return deploymentPlans.size;
}
