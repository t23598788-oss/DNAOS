/**
 * Release Pipeline, Capability Packaging & Operational Readiness Runtime
 * (owner, 2026-08-07, Software Factory Step 10). Read-only against
 * Source Control and Source Code — never deploys, never writes Git
 * state, never auto-fixes. Reuses buildRuntime.ts/changeSetRuntime.ts/
 * testRuntime.ts/artifactRuntime.ts/queueRuntime.ts exactly — no new
 * Runtime/Queue/Artifact/Evidence Store (Rule 103).
 *
 * Reuse investigation (Phase 1) — real, confirmed by direct inspection:
 *  - buildRuntime.ts (Step 9/9.5) is the ONLY real source of a Release
 *    Candidate — getBuildRun()/refreshStaleness()/computeBuildGateReport()
 *    reused directly, never re-implemented.
 *  - changeSetRuntime.ts/testRuntime.ts (Steps 7/8) reused via the SAME
 *    real getChangeSet()/getTestRun() accessors Build Preconditions
 *    already use.
 *  - governanceRuntime.ts (Step 4.5) is reused INDIRECTLY, never a direct
 *    import here: computeBuildGateReport() (from buildRuntime.ts, above)
 *    already computes a real "Governance" gate via governanceRuntime.ts's
 *    computeCoverageSummary(); readinessFromRuntime() below consumes that
 *    real gate result from validation.gates — a second, direct Governance
 *    check here would be a duplicate computation, not real reuse.
 *  - artifactRuntime.ts (Step 5) — createReleaseArtifact() routes through
 *    the SAME createArtifactInternal() every prior Step's artifacts use.
 *  - queueRuntime.ts (Step 3) reused via startReleaseJob()/
 *    finalizeReleaseJob().
 *  - registry/capability-registry.json — the real, frozen (checksum-
 *    locked), 202-real-capability source Capability Packaging reads.
 *    Never a second capability list, never a fabricated capability.
 *  - registry/factory-mapping.json — real Factory ownership per
 *    Capability's real OwnerModule.
 *  - registry/business-coverage.json / registry/AI_REGISTRY.json /
 *    registry/infrastructure.json / registry/factory-summary.json — real,
 *    pre-existing sources for Operational Readiness. No new registry
 *    file invented.
 * Real gaps found, honestly reported (never guessed): no Legal Package,
 * Country Package, or compatibility-matrix registry exists anywhere in
 * this repo — Legal Ready, Country Package Dependency, and Compatibility
 * are therefore NOT_IMPLEMENTED/UNKNOWN, never fabricated as ready.
 */
import { readFileSync, existsSync } from "fs";
import { createHash, randomUUID } from "crypto";
import path from "path";
import { WORKSPACE_ROOT } from "./fsSecurity";
import { refreshStaleness, computeBuildGateReport, type BuildRun, type GateResult, type GateStatus } from "./buildRuntime";
import { getChangeSet, type ChangeSet } from "./changeSetRuntime";
import { getTestRun, type TestRun } from "./testRuntime";

import { startReleaseJob, finalizeReleaseJob } from "./queueRuntime";
import { createReleaseArtifact } from "./artifactRuntime";

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}
function safeReadFile(relPath: string): Buffer | null {
  try { return readFileSync(path.join(WORKSPACE_ROOT, relPath)); } catch { return null; }
}
function safeReadJson<T>(relPath: string): T | null {
  const buf = safeReadFile(relPath);
  if (!buf) return null;
  try { return JSON.parse(buf.toString("utf-8")) as T; } catch { return null; }
}

// ============================================================
// Contract types (Phase 2/3/4/5)
// ============================================================
export type ReleaseRunStatus = "REQUESTED" | "VALIDATING" | "BLOCKED" | "PACKAGING" | "APPROVING" | "READY" | "FAILED";

export interface ReleaseCandidate {
  releaseCandidateId: string;
  buildRunId: string;
  actor: string;
  createdAt: string;
  sourceRevision: string | null;
  sourceFingerprint: string;
}

export interface ReleaseValidationResult {
  valid: boolean;
  reasons: string[];
  gates: GateResult[];
}

export interface CapabilityPackage {
  capabilityId: string;
  manifest: { category: string; description: string; inputContract: string; outputContract: string; executionType: string; mutability: string; statePolicy: string };
  dependencies: string[];
  requiredRuntime: string | null;
  requiredRegistry: string[];
  businessDomain: string;
  evidence: string;
  version: string;
  compatibility: "UNKNOWN";
  countryPackageDependency: "NONE";
  owner: string | null;
  lifecycle: string;
  status: "OK" | "MISSING_OWNER_MODULE";
}

export interface PackageIntegrityResult {
  status: GateStatus;
  totalPackages: number;
  duplicateCapabilityIds: string[];
  missingOwnerModules: string[];
  findings: string[];
}

export interface ReadinessDimension {
  dimension: string;
  status: GateStatus;
  evidence: string;
}
export interface OperationalReadinessReport {
  computedAt: string;
  dimensions: ReadinessDimension[];
  overallStatus: "ALL_READY" | "BLOCKING_GAP" | "PARTIAL";
}

export interface ReleaseDecisionRecord {
  releaseDecisionId: string;
  releaseRunId: string | null;
  decision: "ALLOWED" | "BLOCKED";
  reasons: string[];
  computedAt: string;
}

export interface ReleaseRun {
  releaseRunId: string;
  buildRunId: string;
  actor: string;
  ownerId: string;
  status: ReleaseRunStatus;
  queueJobId: string | null;
  reason: string;
  startedAt: string;
  finishedAt: string | null;
  releaseCandidate: ReleaseCandidate | null;
  validation: ReleaseValidationResult | null;
  packages: CapabilityPackage[];
  packageIntegrity: PackageIntegrityResult | null;
  decision: ReleaseDecisionRecord | null;
  operationalReadiness: OperationalReadinessReport | null;
  artifactIds: string[];
  evidenceIds: string[];
  error: string | null;
}

export class ReleasePipelineError extends Error {
  code: "RELEASE_RUN_NOT_FOUND" | "RELEASE_RUN_NOT_OWNED" | "BUILD_RUN_NOT_FOUND" | "BUILD_RUN_NOT_OWNED" | "INVALID_REQUEST" | "INTERNAL_ERROR";
  constructor(code: typeof ReleasePipelineError.prototype.code, message: string) {
    super(message);
    this.code = code;
    this.name = "ReleasePipelineError";
  }
}

// ============================================================
// Bounded in-memory store — same pattern as buildRuntime.ts's buildRuns Map.
// ============================================================
const releaseRuns = new Map<string, ReleaseRun>();
const MAX_RELEASE_RUN_HISTORY = 30;

function evictOld(ownerId: string) {
  const owned = [...releaseRuns.values()].filter((r) => r.ownerId === ownerId);
  const overflow = owned.length - MAX_RELEASE_RUN_HISTORY;
  if (overflow <= 0) return;
  const sorted = owned.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (let i = 0; i < overflow; i++) releaseRuns.delete(sorted[i].releaseRunId);
}

// ============================================================
// Release Candidate + Validation (Phase 2)
// ============================================================
function createReleaseCandidate(build: BuildRun, actor: string): ReleaseCandidate {
  return {
    releaseCandidateId: randomUUID(), buildRunId: build.buildRunId, actor, createdAt: new Date().toISOString(),
    sourceRevision: build.manifest?.sourceRevision ?? null, sourceFingerprint: build.sourceFingerprintAfter ?? build.sourceFingerprintBefore,
  };
}

function validateReleaseCandidate(build: BuildRun, ownerId: string): ReleaseValidationResult {
  const reasons: string[] = [];
  if (build.status !== "SUCCEEDED" && build.status !== "SUCCEEDED_WITH_WARNINGS") {
    reasons.push(`real Build Run status is ${build.status}, not SUCCEEDED/SUCCEEDED_WITH_WARNINGS`);
  }
  if (build.staleForRelease) reasons.push("real Build Run is STALE_FOR_RELEASE — linked Change Set/Test Run has changed since the Build ran");
  if (build.manifest && build.manifest.integrityStatus !== "PASSED") reasons.push(`real Build Manifest integrityStatus is ${build.manifest.integrityStatus}, not PASSED`);

  let cs: ChangeSet | null = null;
  let tr: TestRun | null = null;
  try { cs = getChangeSet(build.sourceChangeSetId, ownerId); } catch { /* real, honestly unavailable */ }
  try { tr = getTestRun(build.sourceTestRunId, ownerId); } catch { /* real, honestly unavailable */ }

  const gateReport = computeBuildGateReport(cs, tr, build);
  for (const g of gateReport.gates) {
    if (g.status === "FAILED" || g.status === "BLOCKED") reasons.push(`Gate "${g.gate}" is ${g.status}: ${g.evidence}`);
  }
  return { valid: reasons.length === 0, reasons, gates: gateReport.gates };
}

// ============================================================
// Capability Packaging (Phase 3) — real, ONLY from
// registry/capability-registry.json's real, frozen capabilities.
// ============================================================
interface RawCapability {
  CapabilityId: string; OwnerModule: string; ExportName: string; Category: string; Description: string;
  Version: string; InputContract: string; OutputContract: string; ExecutionType: string; Mutability: string;
  StatePolicy: string; Dependencies?: string[]; Tags?: string[];
}
interface FactoryMappingModule { factoryOwner: string; domain: string; capability: string }

export function packageCapabilities(): CapabilityPackage[] {
  const registry = safeReadJson<{ capabilities: RawCapability[] }>("registry/capability-registry.json");
  const factoryMapping = safeReadJson<{ modules: Record<string, FactoryMappingModule> }>("registry/factory-mapping.json");
  const capabilityRoadmap = safeReadJson<{ capabilities: Record<string, { status?: string }> }>("registry/capability-roadmap.json");
  const caps = registry?.capabilities ?? [];
  return caps.map((c): CapabilityPackage => {
    const ownerExists = existsSync(path.join(WORKSPACE_ROOT, c.OwnerModule));
    const fm = factoryMapping?.modules?.[c.OwnerModule];
    const roadmapEntry = capabilityRoadmap?.capabilities?.[c.CapabilityId];
    return {
      capabilityId: c.CapabilityId,
      manifest: {
        category: c.Category, description: c.Description, inputContract: c.InputContract, outputContract: c.OutputContract,
        executionType: c.ExecutionType, mutability: c.Mutability, statePolicy: c.StatePolicy,
      },
      dependencies: c.Dependencies ?? [],
      requiredRuntime: fm?.factoryOwner ?? null,
      requiredRegistry: ["registry/capability-registry.json", ...(ownerExists ? [] : [])],
      businessDomain: fm?.domain ?? c.Category,
      evidence: `real registry/capability-registry.json entry "${c.CapabilityId}" (OwnerModule: ${c.OwnerModule}${ownerExists ? ", real file exists" : ", real file MISSING"})`,
      version: c.Version,
      compatibility: "UNKNOWN", // real gap: no compatibility-matrix registry exists this phase
      countryPackageDependency: "NONE", // real gap: no Country Package framework instance exists yet (Phase 7 defines the framework only)
      owner: fm?.factoryOwner ?? null,
      lifecycle: roadmapEntry?.status ?? "UNKNOWN",
      status: ownerExists ? "OK" : "MISSING_OWNER_MODULE",
    };
  });
}

export function checkPackageIntegrity(packages: CapabilityPackage[]): PackageIntegrityResult {
  const seen = new Map<string, number>();
  for (const p of packages) seen.set(p.capabilityId, (seen.get(p.capabilityId) ?? 0) + 1);
  const duplicateCapabilityIds = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  const missingOwnerModules = packages.filter((p) => p.status === "MISSING_OWNER_MODULE").map((p) => p.capabilityId);
  const findings: string[] = [];
  if (duplicateCapabilityIds.length > 0) findings.push(`${duplicateCapabilityIds.length} real duplicate CapabilityId(s): ${duplicateCapabilityIds.slice(0, 5).join(", ")}`);
  if (missingOwnerModules.length > 0) findings.push(`${missingOwnerModules.length} real Capability(ies) with a missing real OwnerModule file: ${missingOwnerModules.slice(0, 5).join(", ")}`);
  const status: GateStatus = duplicateCapabilityIds.length > 0 || missingOwnerModules.length > 0 ? "FAILED" : "PASSED";
  return { status, totalPackages: packages.length, duplicateCapabilityIds, missingOwnerModules, findings };
}

// ============================================================
// Operational Readiness (Phase 4) — real, per-dimension. UNKNOWN/
// NOT_IMPLEMENTED honestly wherever no real data source exists.
// ============================================================
function readinessFromBusinessCoverage(): ReadinessDimension {
  const d = safeReadJson<{ domains: Record<string, { status: string }> }>("registry/business-coverage.json");
  if (!d) return { dimension: "Business Ready", status: "UNKNOWN", evidence: "registry/business-coverage.json is missing or unreadable" };
  const domains = Object.values(d.domains);
  const missing = domains.filter((x) => x.status === "missing").length;
  const covered = domains.filter((x) => x.status === "covered").length;
  return {
    dimension: "Business Ready", status: missing === 0 ? "PASSED" : "FAILED",
    evidence: `real registry/business-coverage.json: ${covered}/${domains.length} real domains covered, ${missing} real domain(s) missing`,
  };
}
function readinessFromAiRegistry(): ReadinessDimension {
  const d = safeReadJson<{ agents: unknown[] }>("registry/AI_REGISTRY.json");
  if (!d) return { dimension: "AI Ready", status: "UNKNOWN", evidence: "registry/AI_REGISTRY.json is missing or unreadable" };
  return { dimension: "AI Ready", status: d.agents.length > 0 ? "PASSED" : "FAILED", evidence: `real registry/AI_REGISTRY.json: ${d.agents.length} real registered agent(s)` };
}
function readinessFromInfrastructure(): ReadinessDimension {
  const d = safeReadJson<{ services: Record<string, unknown> }>("registry/infrastructure.json");
  if (!d) return { dimension: "Infrastructure Ready", status: "UNKNOWN", evidence: "registry/infrastructure.json is missing or unreadable" };
  const count = Object.keys(d.services).length;
  return { dimension: "Infrastructure Ready", status: count > 0 ? "PASSED" : "FAILED", evidence: `real registry/infrastructure.json: ${count} real registered service(s)` };
}
function readinessFromFactory(): ReadinessDimension {
  const d = safeReadJson<{ coverage?: { coverage_percent?: number; conflict_modules?: string[] } }>("registry/factory-summary.json");
  const c = d?.coverage;
  if (!c || c.coverage_percent === undefined) return { dimension: "Factory Ready", status: "UNKNOWN", evidence: "registry/factory-summary.json coverage is missing or unreadable" };
  const conflicts = c.conflict_modules?.length ?? 0;
  return { dimension: "Factory Ready", status: conflicts === 0 ? "PASSED" : "FAILED", evidence: `real registry/factory-summary.json: ${c.coverage_percent}% real Factory coverage, ${conflicts} real CONFLICT module(s)` };
}
function readinessFromEvidence(run: ReleaseRun): ReadinessDimension {
  if (run.artifactIds.length === 0) return { dimension: "Evidence Ready", status: "NOT_IMPLEMENTED", evidence: "no real Release artifacts created yet" };
  return { dimension: "Evidence Ready", status: "PASSED", evidence: `${run.artifactIds.length} real Release artifact(s) created through the real Artifact Runtime, all real-checksummed` };
}
function readinessFromRuntime(validation: ReleaseValidationResult | null): ReadinessDimension {
  if (!validation) return { dimension: "Runtime Ready", status: "NOT_IMPLEMENTED", evidence: "no real Release Validation has run yet" };
  const runtimeGates = validation.gates.filter((g) => ["Registry", "Governance", "Architecture Drift"].includes(g.gate));
  const allPassed = runtimeGates.every((g) => g.status === "PASSED");
  return { dimension: "Runtime Ready", status: allPassed ? "PASSED" : "FAILED", evidence: `real Registry/Governance/Architecture Drift gates: ${runtimeGates.map((g) => `${g.gate}=${g.status}`).join(", ")}` };
}
function readinessFromPackages(integrity: PackageIntegrityResult | null): ReadinessDimension {
  if (!integrity) return { dimension: "Package Ready", status: "NOT_IMPLEMENTED", evidence: "no real Capability Packaging has run yet" };
  return { dimension: "Package Ready", status: integrity.status, evidence: `real Package Integrity: ${integrity.totalPackages} real packages, ${integrity.findings.join("; ") || "0 real findings"}` };
}
function readinessLegal(): ReadinessDimension {
  return { dimension: "Legal Ready", status: "NOT_IMPLEMENTED", evidence: "no real Legal Package or Country Package exists anywhere in this repo yet (Step 10 Phase 7 defines only the framework, not a real instance)" };
}

export function computeOperationalReadiness(run: ReleaseRun): OperationalReadinessReport {
  const dims: ReadinessDimension[] = [
    readinessFromBusinessCoverage(),
    readinessLegal(),
    readinessFromEvidence(run),
    readinessFromInfrastructure(),
    readinessFromAiRegistry(),
    readinessFromRuntime(run.validation),
    readinessFromPackages(run.packageIntegrity),
    readinessFromFactory(),
  ];
  // Composite dimensions — deterministic AND of the above, never an
  // independent guess.
  const anyFailed = dims.some((d) => d.status === "FAILED");
  const anyUnknownOrNotImpl = dims.some((d) => d.status === "UNKNOWN" || d.status === "NOT_IMPLEMENTED");
  const productionReady: ReadinessDimension = {
    dimension: "Production Ready",
    status: anyFailed ? "FAILED" : anyUnknownOrNotImpl ? "PARTIAL" as GateStatus : "PASSED",
    evidence: `deterministic AND of all real readiness dimensions: ${dims.map((d) => `${d.dimension}=${d.status}`).join(", ")}`,
  };
  const deploymentReadiness: ReadinessDimension = {
    dimension: "Deployment Readiness",
    status: "NOT_IMPLEMENTED",
    evidence: "no real Deployment Pipeline exists yet (Step 11, not started) — this dimension can never be real until that Step exists",
  };
  const allDims = [...dims, productionReady, deploymentReadiness];
  const hasBlocking = allDims.some((d) => d.status === "FAILED" || d.status === "BLOCKED");
  const allPassed = allDims.every((d) => d.status === "PASSED");
  return {
    computedAt: new Date().toISOString(), dimensions: allDims,
    overallStatus: hasBlocking ? "BLOCKING_GAP" : allPassed ? "ALL_READY" : "PARTIAL",
  };
}

// ============================================================
// Release Decision (Phase 2/5) — real, deterministic explanation.
// ============================================================
export function explainReleaseDecision(validation: ReleaseValidationResult, integrity: PackageIntegrityResult, releaseRunId: string | null): ReleaseDecisionRecord {
  const reasons: string[] = [];
  if (!validation.valid) reasons.push(...validation.reasons);
  if (integrity.status !== "PASSED") reasons.push(...integrity.findings);
  const blocked = reasons.length > 0;
  return {
    releaseDecisionId: randomUUID(), releaseRunId, decision: blocked ? "BLOCKED" : "ALLOWED",
    reasons: blocked ? reasons : ["real Release Validation passed all real gates, and real Package Integrity found 0 real blocking findings"],
    computedAt: new Date().toISOString(),
  };
}

// ============================================================
// Core orchestration
// ============================================================
export async function createReleaseRequest(actor: string, ownerId: string, input: { buildRunId: string; reason: string; ownerConfirmation: boolean }): Promise<ReleaseRun> {
  if (!input.reason || input.reason.trim().length === 0) throw new ReleasePipelineError("INVALID_REQUEST", "reason is required for every Release Request");
  if (!input.ownerConfirmation) throw new ReleasePipelineError("INVALID_REQUEST", "ownerConfirmation must be true");

  const releaseRunId = randomUUID();
  const startedAt = new Date().toISOString();
  const job = startReleaseJob("RELEASE_REQUEST", actor, ownerId, releaseRunId);

  const run: ReleaseRun = {
    releaseRunId, buildRunId: input.buildRunId, actor, ownerId, status: "REQUESTED", queueJobId: job.jobId, reason: input.reason,
    startedAt, finishedAt: null, releaseCandidate: null, validation: null, packages: [], packageIntegrity: null,
    decision: null, operationalReadiness: null, artifactIds: [], evidenceIds: [], error: null,
  };
  releaseRuns.set(releaseRunId, run);

  let build: BuildRun;
  try {
    build = refreshStaleness(input.buildRunId, ownerId);
  } catch (e) {
    run.status = "FAILED";
    run.error = e instanceof Error ? e.message : String(e);
    run.finishedAt = new Date().toISOString();
    finalizeReleaseJob(job.jobId, ownerId, { ok: false, result: null, error: run.error });
    evictOld(ownerId);
    return run;
  }

  run.status = "VALIDATING";
  run.releaseCandidate = createReleaseCandidate(build, actor);
  const candidateArtifact = createReleaseArtifact({
    artifactType: "RELEASE_CANDIDATE", content: JSON.stringify(run.releaseCandidate), mimeType: "application/json",
    actor, ownerId, releaseRunId, jobId: job.jobId, sourceHash: null, generatedFrom: releaseRunId,
  });
  run.artifactIds.push(candidateArtifact.artifactId);

  run.validation = validateReleaseCandidate(build, ownerId);

  run.status = "PACKAGING";
  run.packages = packageCapabilities();
  const manifestArtifact = createReleaseArtifact({
    artifactType: "PACKAGE_MANIFEST", content: JSON.stringify(run.packages), mimeType: "application/json",
    actor, ownerId, releaseRunId, jobId: job.jobId, sourceHash: null, generatedFrom: releaseRunId, parentIds: [candidateArtifact.artifactId],
  });
  run.artifactIds.push(manifestArtifact.artifactId);

  run.packageIntegrity = checkPackageIntegrity(run.packages);
  const integrityArtifact = createReleaseArtifact({
    artifactType: "PACKAGE_INTEGRITY", content: JSON.stringify(run.packageIntegrity), mimeType: "application/json",
    actor, ownerId, releaseRunId, jobId: job.jobId, sourceHash: null, generatedFrom: releaseRunId, parentIds: [manifestArtifact.artifactId],
  });
  run.artifactIds.push(integrityArtifact.artifactId);

  run.status = "APPROVING";
  run.decision = explainReleaseDecision(run.validation, run.packageIntegrity, releaseRunId);
  const decisionArtifact = createReleaseArtifact({
    artifactType: "RELEASE_DECISION", content: JSON.stringify(run.decision), mimeType: "application/json",
    actor, ownerId, releaseRunId, jobId: job.jobId, sourceHash: null, generatedFrom: releaseRunId, parentIds: [candidateArtifact.artifactId],
  });
  run.artifactIds.push(decisionArtifact.artifactId);

  run.operationalReadiness = computeOperationalReadiness(run);
  const readinessArtifact = createReleaseArtifact({
    artifactType: "OPERATIONAL_READINESS", content: JSON.stringify(run.operationalReadiness), mimeType: "application/json",
    actor, ownerId, releaseRunId, jobId: job.jobId, sourceHash: null, generatedFrom: releaseRunId, parentIds: [decisionArtifact.artifactId],
  });
  run.artifactIds.push(readinessArtifact.artifactId);

  const reportArtifact = createReleaseArtifact({
    artifactType: "RELEASE_REPORT",
    content: JSON.stringify({ releaseRunId, buildRunId: run.buildRunId, validation: run.validation, packageIntegrity: run.packageIntegrity, decision: run.decision, operationalReadiness: run.operationalReadiness }),
    mimeType: "application/json", actor, ownerId, releaseRunId, jobId: job.jobId, sourceHash: null, generatedFrom: releaseRunId, parentIds: [candidateArtifact.artifactId],
  });
  run.artifactIds.push(reportArtifact.artifactId);
  run.evidenceIds = [...run.artifactIds];

  run.status = run.decision.decision === "ALLOWED" ? "READY" : "BLOCKED";
  run.finishedAt = new Date().toISOString();
  finalizeReleaseJob(job.jobId, ownerId, { ok: run.status === "READY", result: run.status, error: run.status === "BLOCKED" ? run.decision.reasons.join(" | ") : null });

  releaseRuns.set(releaseRunId, run);
  evictOld(ownerId);
  return run;
}

export function getReleaseRun(releaseRunId: string, ownerId: string): ReleaseRun {
  const run = releaseRuns.get(releaseRunId);
  if (!run) throw new ReleasePipelineError("RELEASE_RUN_NOT_FOUND", "no Release Run with that id");
  if (run.ownerId !== ownerId) throw new ReleasePipelineError("RELEASE_RUN_NOT_OWNED", "this Release Run belongs to a different session");
  return run;
}
export function listReleaseRuns(ownerId: string): ReleaseRun[] {
  return [...releaseRuns.values()].filter((r) => r.ownerId === ownerId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
export async function rerunRelease(releaseRunId: string, ownerId: string, actor: string): Promise<ReleaseRun> {
  const prior = getReleaseRun(releaseRunId, ownerId);
  return createReleaseRequest(actor, ownerId, { buildRunId: prior.buildRunId, reason: `rerun of Release Run ${releaseRunId}`, ownerConfirmation: true });
}

export function __debugReleaseRunCount(): number {
  return releaseRuns.size;
}
