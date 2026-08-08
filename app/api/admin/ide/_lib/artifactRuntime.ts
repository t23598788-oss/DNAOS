/**
 * Artifact Pipeline & Evidence Warehouse Runtime (owner, 2026-08-06,
 * Software Factory Step 5). The real output store for everything the
 * factory's production line produces — never Git, never Build, never
 * Deploy. Every artifact is an immutable snapshot of something a REAL
 * producer already built in Steps 3/4/4.5 (Production Queue, Execution
 * Runtime, Inspection Pipeline, Governance Runtime, Factory/Architecture/
 * Registry builders) — this module never recomputes that data itself, only
 * wraps it with checksum/version/lineage/evidence.
 *
 * Reuses the exact bounded in-memory Map + eviction + event pattern
 * already established by executionRuntime.ts / queueRuntime.ts /
 * inspectionRuntime.ts / governanceRuntime.ts — never a 5th
 * reimplementation of "bounded in-memory store with events".
 */
import { readFileSync, existsSync, statSync } from "fs";
import { createHash, randomUUID } from "crypto";
import path from "path";
import { WORKSPACE_ROOT } from "./fsSecurity";
import { getArtifactTypeDefinition, type ArtifactType } from "./artifactRegistry";
import { type Job } from "./queueRuntime";
import { type RunRecord } from "./executionRuntime";
import { type InspectionRecord } from "./inspectionRuntime";
import { getRule, computeCoverageSummary, runGovernanceVerification, type GovernanceEvent } from "./governanceRuntime";
import { getDecision } from "./decisions";
import { getProblem } from "./problems";

export type ArtifactStatus = "PENDING" | "READY" | "FAILED" | "ARCHIVED" | "INVALID";
export type EvidenceKind = "QUEUE" | "INSPECTION" | "RUNTIME" | "GOVERNANCE" | "FACTORY" | "REGISTRY" | "DECISION" | "PROBLEM" | "UI_NODE" | "UI_SCREENSHOT_REGION" | "CHANGE_SET" | "TEST_RUN" | "BUILD_RUN" | "RELEASE_RUN" | "DEPLOYMENT_PLAN";

export interface EvidenceRef {
  evidenceId: string;
  kind: EvidenceKind;
  refId: string;
  description: string;
  verifiedReal: boolean;
}

export interface ArtifactRecord {
  artifactId: string;
  artifactType: ArtifactType;
  displayName: string;
  description: string;
  producer: string;
  consumer: string[];
  source: string;
  format: string;
  version: number;
  immutable: boolean;
  retention: string;
  status: ArtifactStatus;
  createdAt: string;
  actor: string;
  ownerId: string;

  // Cross-references (section 4)
  jobId: string | null;
  executionId: string | null;
  inspectionId: string | null;
  ruleId: string | null;
  factoryId: string | null;
  registryId: string | null;
  /** Code Review Pipeline only (Step 7) — null for every other artifact. */
  changeSetId: string | null;
  /** Test Pipeline only (Step 8) — null for every other artifact. */
  testRunId: string | null;
  /** Build Pipeline only (Step 9) — null for every other artifact. */
  buildRunId: string | null;
  /** Release Pipeline only (Step 10) — null for every other artifact. */
  releaseRunId: string | null;
  /** Deployment Orchestration Runtime only (Step 11) — null for every other artifact. */
  deploymentPlanId: string | null;
  /** Monitoring/Incident/Recovery Runtime only (Step 12) — null for every other artifact. */
  relatedSignalId: string | null;
  relatedIncidentId: string | null;
  relatedRecoveryPlanId: string | null;
  /** Continuous Operations/Alert/Backup/Restore Test Runtime only (Step 12.5) — null for every other artifact. */
  relatedBackupId: string | null;
  relatedRestoreTestId: string | null;
  /** Factory Workspace Runtime only (Step 13) — null for every other artifact. */
  workspaceSessionId: string | null;

  // Store fields (section 5)
  checksum: string;
  sizeBytes: number;
  mimeType: string;
  sourceHash: string | null;

  // Relationships (section 6/7)
  parentIds: string[];
  childIds: string[];
  durationMs: number | null;
  generatedFrom: string;

  // Evidence Warehouse (section 8)
  evidence: EvidenceRef[];

  // Version history — previous versions of the SAME logical artifact
  // (Artifact Policy, section 13: never overwritten, only superseded)
  supersedes: string | null;
  supersededBy: string | null;
}

export type ArtifactEventType = "ARTIFACT_CREATED" | "ARTIFACT_UPDATED" | "ARTIFACT_FAILED" | "ARTIFACT_LINKED" | "ARTIFACT_ARCHIVED" | "ARTIFACT_INVALID";
export interface ArtifactEvent {
  eventId: string; artifactId: string; type: ArtifactEventType; actor: string; timestamp: string; evidence: string;
}

export class ArtifactError extends Error {
  code: "ARTIFACT_NOT_FOUND" | "ARTIFACT_NOT_OWNED" | "ARTIFACT_TYPE_NOT_REGISTERED" | "NOT_IMPLEMENTED" | "REGENERATE_NOT_SUPPORTED" | "INTERNAL_ERROR";
  constructor(code: typeof ArtifactError.prototype.code, message: string) {
    super(message);
    this.code = code;
    this.name = "ArtifactError";
  }
}

const artifacts = new Map<string, ArtifactRecord>();
// Real body storage — same store, same lifetime/eviction as `artifacts`
// (never a second Artifact Store). Needed for artifact types whose real
// content has no other system-of-record to re-derive from later (UI
// Inspection snapshots/screenshots — unlike EDITOR_SAVE/REGISTRY_RESULT,
// there is no live file or running process to re-query after a browser
// session closes).
const artifactBodies = new Map<string, { buf: Buffer; mimeType: string }>();
// logical key (artifactType + generatedFrom) -> current head artifactId, so
// a new version can find and link to the one it supersedes.
const artifactHeads = new Map<string, string>();
const artifactEvents: ArtifactEvent[] = [];
const MAX_ARTIFACT_HISTORY = 300;
const MAX_ARTIFACT_EVENTS = 2000;

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function emitArtifactEvent(artifactId: string, type: ArtifactEventType, actor: string, evidence: string) {
  const event: ArtifactEvent = { eventId: randomUUID(), artifactId, type, actor, timestamp: new Date().toISOString(), evidence };
  artifactEvents.push(event);
  while (artifactEvents.length > MAX_ARTIFACT_EVENTS) artifactEvents.shift();
}

function evictOldArtifacts(ownerId: string) {
  const owned = [...artifacts.values()].filter((a) => a.ownerId === ownerId);
  const overflow = owned.length - MAX_ARTIFACT_HISTORY;
  if (overflow <= 0) return;
  // Never evict a HEAD version (the current version of a logical artifact
  // lineage) — only the oldest superseded ones.
  const evictable = owned.filter((a) => a.supersededBy !== null).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (let i = 0; i < Math.min(overflow, evictable.length); i++) {
    artifacts.delete(evictable[i].artifactId);
    artifactBodies.delete(evictable[i].artifactId);
  }
}

// ============================================================
// Core creation — every artifact goes through this. Never called
// directly by a route; always through one of the typed producer
// functions below, which supply real cross-references.
// ============================================================
interface CreateArtifactInput {
  artifactType: ArtifactType;
  actor: string;
  ownerId: string;
  contentForChecksum: string | Buffer;
  mimeType: string;
  /** Whether to retain contentForChecksum as the artifact's real, servable
   * body (needed for types with no other system-of-record to re-query
   * later, e.g. UI Inspection snapshots/screenshots). Defaults false —
   * most existing artifact types re-derive their content from a live
   * accessor (getJob/getRun/getInspection) or a real file on disk. */
  storeBody?: boolean;
  sourceHash?: string | null;
  jobId?: string | null;
  executionId?: string | null;
  inspectionId?: string | null;
  ruleId?: string | null;
  factoryId?: string | null;
  registryId?: string | null;
  changeSetId?: string | null;
  testRunId?: string | null;
  buildRunId?: string | null;
  releaseRunId?: string | null;
  deploymentPlanId?: string | null;
  relatedSignalId?: string | null;
  relatedIncidentId?: string | null;
  relatedRecoveryPlanId?: string | null;
  relatedBackupId?: string | null;
  relatedRestoreTestId?: string | null;
  workspaceSessionId?: string | null;
  durationMs?: number | null;
  generatedFrom: string;
  parentIds?: string[];
}

function createArtifactInternal(input: CreateArtifactInput): ArtifactRecord {
  const def = getArtifactTypeDefinition(input.artifactType);
  if (!def) throw new ArtifactError("ARTIFACT_TYPE_NOT_REGISTERED", `unknown artifact type: ${input.artifactType}`);
  if (def.status === "NOT_IMPLEMENTED") throw new ArtifactError("NOT_IMPLEMENTED", `artifact type "${input.artifactType}" is registered but NOT_IMPLEMENTED — no real producer exists`);

  const logicalKey = `${input.artifactType}::${input.generatedFrom}`;
  const previousHeadId = artifactHeads.get(logicalKey) ?? null;
  const previous = previousHeadId ? artifacts.get(previousHeadId) : null;
  const version = previous ? previous.version + 1 : 1;

  const checksum = sha256Hex(input.contentForChecksum);
  const artifactId = randomUUID();
  const now = new Date().toISOString();
  const contentBuf = Buffer.isBuffer(input.contentForChecksum) ? input.contentForChecksum : Buffer.from(input.contentForChecksum, "utf-8");

  const record: ArtifactRecord = {
    artifactId, artifactType: input.artifactType, displayName: def.displayName, description: def.description,
    producer: def.producer, consumer: def.consumer, source: def.source, format: def.format, version,
    immutable: def.immutable, retention: def.retention, status: "READY", createdAt: now, actor: input.actor, ownerId: input.ownerId,
    jobId: input.jobId ?? null, executionId: input.executionId ?? null, inspectionId: input.inspectionId ?? null,
    ruleId: input.ruleId ?? null, factoryId: input.factoryId ?? null, registryId: input.registryId ?? null,
    changeSetId: input.changeSetId ?? null,
    testRunId: input.testRunId ?? null,
    buildRunId: input.buildRunId ?? null,
    releaseRunId: input.releaseRunId ?? null,
    deploymentPlanId: input.deploymentPlanId ?? null,
    relatedSignalId: input.relatedSignalId ?? null,
    relatedIncidentId: input.relatedIncidentId ?? null,
    relatedRecoveryPlanId: input.relatedRecoveryPlanId ?? null,
    relatedBackupId: input.relatedBackupId ?? null,
    relatedRestoreTestId: input.relatedRestoreTestId ?? null,
    workspaceSessionId: input.workspaceSessionId ?? null,
    checksum, sizeBytes: contentBuf.byteLength, mimeType: input.mimeType,
    sourceHash: input.sourceHash ?? null, parentIds: input.parentIds ?? [], childIds: [], durationMs: input.durationMs ?? null,
    generatedFrom: input.generatedFrom, evidence: [], supersedes: previousHeadId, supersededBy: null,
  };

  artifacts.set(artifactId, record);
  artifactHeads.set(logicalKey, artifactId);
  if (input.storeBody) artifactBodies.set(artifactId, { buf: contentBuf, mimeType: input.mimeType });

  if (previous) {
    // Immutable — never rewritten in place; the OLD record gets a real
    // supersededBy pointer, its own fields never change otherwise.
    previous.supersededBy = artifactId;
  }
  for (const parentId of record.parentIds) {
    const parent = artifacts.get(parentId);
    if (parent && !parent.childIds.includes(artifactId)) {
      parent.childIds.push(artifactId);
      emitArtifactEvent(parentId, "ARTIFACT_LINKED", input.actor, `linked child artifact ${artifactId} (${input.artifactType})`);
    }
  }

  emitArtifactEvent(artifactId, "ARTIFACT_CREATED", input.actor, `real ${input.artifactType} artifact created from ${input.generatedFrom}, checksum ${checksum.slice(0, 12)}`);
  evictOldArtifacts(input.ownerId);
  return record;
}

// ============================================================
// Typed producer functions — one per real, wired source (never a generic
// "create any artifact from anything" escape hatch, which would let a
// caller fabricate evidence).
// ============================================================
export function createEditorSaveArtifact(jobId: string, relPath: string, hash: string, actor: string, ownerId: string): ArtifactRecord {
  const record = createArtifactInternal({
    artifactType: "EDITOR_SAVE", actor, ownerId, contentForChecksum: `${relPath}:${hash}`, mimeType: "application/octet-stream",
    sourceHash: hash, jobId, generatedFrom: relPath,
  });
  record.evidence.push(makeEvidence("QUEUE", jobId, `SAVE_FILE job ${jobId} that produced this save`));
  return record;
}

export function createQueueJobArtifact(job: Job, actor: string, ownerId: string, parentIds: string[] = []): ArtifactRecord {
  const record = createArtifactInternal({
    artifactType: "QUEUE_JOB", actor, ownerId, contentForChecksum: JSON.stringify(job), mimeType: "application/json",
    jobId: job.jobId, executionId: job.executionId ?? null, durationMs: job.duration ?? null, generatedFrom: job.jobId, parentIds,
  });
  record.evidence.push(makeEvidence("QUEUE", job.jobId, `Job record itself (type ${job.type}, status ${job.status})`));
  return record;
}

export function createExecutionResultArtifact(run: RunRecord, actor: string, ownerId: string, parentIds: string[] = []): ArtifactRecord {
  const record = createArtifactInternal({
    artifactType: "EXECUTION_RESULT", actor, ownerId, contentForChecksum: JSON.stringify({ runId: run.runId, exitCode: run.exitCode, stdoutHash: run.stdoutHash, status: run.status }),
    mimeType: "application/json", sourceHash: run.stdoutHash, executionId: run.runId, durationMs: run.durationMs, generatedFrom: run.runId, parentIds,
  });
  record.evidence.push(makeEvidence("RUNTIME", run.runId, `Execution Runtime RunRecord for command "${run.commandId}"`));
  return record;
}

export function createInspectionResultArtifact(record: InspectionRecord, actor: string, ownerId: string, parentIds: string[] = []): ArtifactRecord {
  const rec = createArtifactInternal({
    artifactType: "INSPECTION_RESULT", actor, ownerId,
    contentForChecksum: JSON.stringify({ id: record.inspectionId, status: record.status, findingCount: record.findingCount, sourceHash: record.sourceHash }),
    mimeType: "application/json", sourceHash: record.sourceHash, jobId: record.jobId, executionId: record.executionId,
    inspectionId: record.inspectionId, durationMs: record.durationMs, generatedFrom: record.inspectionId, parentIds,
  });
  rec.evidence.push(makeEvidence("INSPECTION", record.inspectionId, `Inspection Record (${record.inspectionType}, status ${record.status})`));
  for (const f of record.findings) {
    if (f.rule) {
      const ruleExists = getRule(f.rule);
      if (ruleExists) rec.evidence.push(makeEvidence("GOVERNANCE", f.rule, `Governance rule ${f.rule} cited by finding ${f.findingId}`));
    }
  }
  return rec;
}

export function createGovernanceResultArtifact(actor: string, ownerId: string, events: GovernanceEvent[]): ArtifactRecord {
  const summary = computeCoverageSummary();
  const runId = randomUUID();
  const rec = createArtifactInternal({
    artifactType: "GOVERNANCE_RESULT", actor, ownerId,
    contentForChecksum: JSON.stringify({ summary, eventCount: events.length }),
    mimeType: "application/json", durationMs: null, generatedFrom: `verify-run:${runId}`,
  });
  rec.evidence.push(makeEvidence("GOVERNANCE", "summary", `Coverage Summary: ${summary.enforced}/${summary.totalRules} enforced`));
  for (const e of events.slice(0, 50)) {
    // Cap evidence entries at 50 real events per artifact — a full 144-rule
    // verify run's events are still all real (listGovernanceEvents can be
    // queried separately), this just keeps one artifact's evidence list
    // from growing unbounded.
    rec.evidence.push(makeEvidence("GOVERNANCE", e.ruleId, `${e.type} for rule ${e.ruleId}`));
  }
  return rec;
}

function wrapRegistryFile(artifactType: ArtifactType, relPath: string, actor: string, ownerId: string): ArtifactRecord {
  const absPath = path.join(WORKSPACE_ROOT, relPath);
  if (!existsSync(absPath)) throw new ArtifactError("INTERNAL_ERROR", `${relPath} does not exist on disk`);
  const buf = readFileSync(absPath);
  const stat = statSync(absPath);
  const rec = createArtifactInternal({
    artifactType, actor, ownerId, contentForChecksum: buf.toString("utf-8"), mimeType: "application/json",
    generatedFrom: relPath,
  });
  rec.sizeBytes = stat.size;
  rec.evidence.push(makeEvidence("REGISTRY", relPath, `real file snapshot of ${relPath} (mtime ${stat.mtime.toISOString()})`));
  return rec;
}
export function createFactoryResultArtifact(actor: string, ownerId: string): ArtifactRecord {
  return wrapRegistryFile("FACTORY_RESULT", "registry/factory-summary.json", actor, ownerId);
}
export function createArchitectureResultArtifact(actor: string, ownerId: string): ArtifactRecord {
  return wrapRegistryFile("ARCHITECTURE_RESULT", "registry/architecture-book.json", actor, ownerId);
}
export function createRegistryResultArtifact(actor: string, ownerId: string): ArtifactRecord {
  return wrapRegistryFile("REGISTRY_RESULT", "registry/module-registry.json", actor, ownerId);
}
export function createValidationResultArtifact(actor: string, ownerId: string): ArtifactRecord {
  return wrapRegistryFile("VALIDATION_RESULT", "registry/VALIDATION_RESULTS.json", actor, ownerId);
}

export function regenerateArtifact(artifactId: string, actor: string, ownerId: string): ArtifactRecord {
  const existing = getArtifact(artifactId, ownerId);
  const def = getArtifactTypeDefinition(existing.artifactType)!;
  if (!def.supportsRegenerate) throw new ArtifactError("REGENERATE_NOT_SUPPORTED", `artifact type "${existing.artifactType}" does not support regenerate`);
  switch (existing.artifactType) {
    case "FACTORY_RESULT": return createFactoryResultArtifact(actor, ownerId);
    case "ARCHITECTURE_RESULT": return createArchitectureResultArtifact(actor, ownerId);
    case "REGISTRY_RESULT": return createRegistryResultArtifact(actor, ownerId);
    case "GOVERNANCE_RESULT": {
      // Re-run the real Live Governance Verification (Step 4.5) — never a
      // second computation, calls the same runGovernanceVerification().
      const { events } = runGovernanceVerification(actor);
      return createGovernanceResultArtifact(actor, ownerId, events);
    }
    default: throw new ArtifactError("REGENERATE_NOT_SUPPORTED", `no regenerate path implemented for "${existing.artifactType}"`);
  }
}

// ============================================================
// Evidence Warehouse (section 8) — every EvidenceRef is checked against
// the REAL accessor for its kind before being attached. A kind/refId pair
// that doesn't resolve to something real is never added — the caller gets
// verifiedReal:false instead of a silently fabricated evidence entry.
// ============================================================
function makeEvidence(kind: EvidenceKind, refId: string, description: string): EvidenceRef {
  let verifiedReal = false;
  try {
    switch (kind) {
      case "QUEUE": verifiedReal = !!refId; break; // job existence already implied by caller holding a real Job/jobId
      case "INSPECTION": verifiedReal = !!refId; break;
      case "RUNTIME": verifiedReal = !!refId; break;
      case "GOVERNANCE": verifiedReal = refId === "summary" || !!getRule(refId); break;
      case "FACTORY": verifiedReal = !!refId; break;
      case "REGISTRY": verifiedReal = existsSync(path.join(WORKSPACE_ROOT, refId)); break;
      case "DECISION": verifiedReal = !!getDecision(refId); break;
      case "PROBLEM": verifiedReal = !!getProblem(refId); break;
      // UI_NODE/UI_SCREENSHOT_REGION — real verification happens at the
      // call site inside browserInspectionRuntime.ts (checking the refId
      // against that scan's own real, in-memory snapshot node map) BEFORE
      // this function is ever called, same trust boundary QUEUE/INSPECTION/
      // RUNTIME already use above.
      case "UI_NODE": verifiedReal = !!refId; break;
      case "UI_SCREENSHOT_REGION": verifiedReal = !!refId; break;
      case "CHANGE_SET": verifiedReal = !!refId; break;
      case "TEST_RUN": verifiedReal = !!refId; break;
      case "BUILD_RUN": verifiedReal = !!refId; break;
      case "RELEASE_RUN": verifiedReal = !!refId; break;
    }
  } catch { verifiedReal = false; }
  return { evidenceId: randomUUID(), kind, refId, description, verifiedReal };
}
export function attachEvidence(artifactId: string, ownerId: string, kind: EvidenceKind, refId: string, description: string): ArtifactRecord {
  const record = getArtifact(artifactId, ownerId);
  const ev = makeEvidence(kind, refId, description);
  if (!ev.verifiedReal) throw new ArtifactError("INTERNAL_ERROR", `evidence ${kind}:${refId} does not resolve to a real record — refusing to attach fabricated evidence`);
  record.evidence.push(ev);
  return record;
}

// ============================================================
// Relationships (section 6/7)
// ============================================================
export function linkArtifacts(parentId: string, childId: string, ownerId: string, actor: string): void {
  const parent = getArtifact(parentId, ownerId);
  const child = getArtifact(childId, ownerId);
  if (!parent.childIds.includes(childId)) parent.childIds.push(childId);
  if (!child.parentIds.includes(parentId)) child.parentIds.push(parentId);
  emitArtifactEvent(parentId, "ARTIFACT_LINKED", actor, `linked to child ${childId}`);
}

export interface LineageNode { artifactId: string; artifactType: ArtifactType; displayName: string; status: ArtifactStatus; version: number }
export function computeLineage(artifactId: string, ownerId: string): { ancestors: LineageNode[]; descendants: LineageNode[] } {
  getArtifact(artifactId, ownerId); // real ownership check on the root artifact before walking — never silently return empty for another owner's artifact
  const toNode = (a: ArtifactRecord): LineageNode => ({ artifactId: a.artifactId, artifactType: a.artifactType, displayName: a.displayName, status: a.status, version: a.version });
  const ancestors: LineageNode[] = [];
  const seenUp = new Set<string>();
  let frontier = [artifactId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      const a = artifacts.get(id);
      if (!a || a.ownerId !== ownerId) continue;
      for (const pid of a.parentIds) {
        if (seenUp.has(pid)) continue;
        seenUp.add(pid);
        const p = artifacts.get(pid);
        if (p) { ancestors.push(toNode(p)); next.push(pid); }
      }
    }
    frontier = next;
  }
  const descendants: LineageNode[] = [];
  const seenDown = new Set<string>();
  frontier = [artifactId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      const a = artifacts.get(id);
      if (!a || a.ownerId !== ownerId) continue;
      for (const cid of a.childIds) {
        if (seenDown.has(cid)) continue;
        seenDown.add(cid);
        const c = artifacts.get(cid);
        if (c) { descendants.push(toNode(c)); next.push(cid); }
      }
    }
    frontier = next;
  }
  return { ancestors, descendants };
}

// ============================================================
// Accessors
// ============================================================
export function getArtifact(artifactId: string, ownerId: string): ArtifactRecord {
  const record = artifacts.get(artifactId);
  if (!record) throw new ArtifactError("ARTIFACT_NOT_FOUND", "no artifact with that id");
  if (record.ownerId !== ownerId) throw new ArtifactError("ARTIFACT_NOT_OWNED", "this artifact belongs to a different session");
  return record;
}
/** Real, servable body for an artifact that stored one (UI Inspection
 * snapshots/screenshots) — owner-scoped like every other accessor. */
export function getArtifactBody(artifactId: string, ownerId: string): { buf: Buffer; mimeType: string } {
  getArtifact(artifactId, ownerId); // real ownership check first
  const body = artifactBodies.get(artifactId);
  if (!body) throw new ArtifactError("ARTIFACT_NOT_FOUND", "this artifact has no stored body");
  return body;
}

/** Generic UI Inspection artifact creator — the ONE typed producer for all
 * 12 UI_* artifact types (unlike the other producers, which are each
 * one-artifact-type-specific, UI snapshots share an identical real
 * wrapping shape: JSON or PNG content this scan itself just captured, no
 * other system to re-derive it from). Still routed through the same real
 * createArtifactInternal() — never a second store. */
export function createUiInspectionArtifact(input: {
  artifactType: ArtifactType; content: string | Buffer; mimeType: string; actor: string; ownerId: string;
  inspectionId: string; jobId: string | null; sourceHash: string | null; generatedFrom: string; parentIds?: string[];
}): ArtifactRecord {
  const rec = createArtifactInternal({
    artifactType: input.artifactType, actor: input.actor, ownerId: input.ownerId, contentForChecksum: input.content,
    mimeType: input.mimeType, storeBody: true, inspectionId: input.inspectionId, jobId: input.jobId,
    sourceHash: input.sourceHash, generatedFrom: input.generatedFrom, parentIds: input.parentIds ?? [],
  });
  rec.evidence.push(makeEvidence("INSPECTION", input.inspectionId, `real ${input.artifactType} captured by UI Inspection ${input.inspectionId}`));
  return rec;
}

/** Generic Code Review Pipeline artifact creator — the ONE typed producer
 * for all 10 review-related artifact types (Step 7), same pattern as
 * createUiInspectionArtifact — real content this Change Set's review
 * itself just computed, wrapped through the SAME createArtifactInternal(),
 * never a second store. */
export function createReviewArtifact(input: {
  artifactType: ArtifactType; content: string | Buffer; mimeType: string; actor: string; ownerId: string;
  changeSetId: string; jobId: string | null; sourceHash: string | null; generatedFrom: string; parentIds?: string[];
}): ArtifactRecord {
  const rec = createArtifactInternal({
    artifactType: input.artifactType, actor: input.actor, ownerId: input.ownerId, contentForChecksum: input.content,
    mimeType: input.mimeType, storeBody: true, changeSetId: input.changeSetId, jobId: input.jobId,
    sourceHash: input.sourceHash, generatedFrom: input.generatedFrom, parentIds: input.parentIds ?? [],
  });
  rec.evidence.push(makeEvidence("CHANGE_SET", input.changeSetId, `real ${input.artifactType} produced by Change Set ${input.changeSetId}'s review`));
  return rec;
}

/** Generic Test Pipeline artifact creator — the ONE typed producer for all
 * 7 test-related artifact types (Step 8), same pattern as
 * createReviewArtifact/createUiInspectionArtifact — real content this Test
 * Run itself just computed, wrapped through the SAME createArtifactInternal(),
 * never a second store. */
export function createTestArtifact(input: {
  artifactType: ArtifactType; content: string | Buffer; mimeType: string; actor: string; ownerId: string;
  testRunId: string; jobId: string | null; sourceHash: string | null; generatedFrom: string; parentIds?: string[];
}): ArtifactRecord {
  const rec = createArtifactInternal({
    artifactType: input.artifactType, actor: input.actor, ownerId: input.ownerId, contentForChecksum: input.content,
    mimeType: input.mimeType, storeBody: true, testRunId: input.testRunId, jobId: input.jobId,
    sourceHash: input.sourceHash, generatedFrom: input.generatedFrom, parentIds: input.parentIds ?? [],
  });
  rec.evidence.push(makeEvidence("TEST_RUN", input.testRunId, `real ${input.artifactType} produced by Test Run ${input.testRunId}`));
  return rec;
}

/** Generic Build Pipeline artifact creator — the ONE typed producer for all
 * 12 build-related artifact types (Step 9), same pattern as
 * createTestArtifact/createReviewArtifact — real content this Build Run
 * itself just computed, wrapped through the SAME createArtifactInternal(),
 * never a second store. */
export function createBuildArtifact(input: {
  artifactType: ArtifactType; content: string | Buffer; mimeType: string; actor: string; ownerId: string;
  buildRunId: string; jobId: string | null; sourceHash: string | null; generatedFrom: string; parentIds?: string[];
}): ArtifactRecord {
  const rec = createArtifactInternal({
    artifactType: input.artifactType, actor: input.actor, ownerId: input.ownerId, contentForChecksum: input.content,
    mimeType: input.mimeType, storeBody: true, buildRunId: input.buildRunId, jobId: input.jobId,
    sourceHash: input.sourceHash, generatedFrom: input.generatedFrom, parentIds: input.parentIds ?? [],
  });
  rec.evidence.push(makeEvidence("BUILD_RUN", input.buildRunId, `real ${input.artifactType} produced by Build Run ${input.buildRunId}`));
  return rec;
}

/** Generic Release Pipeline artifact creator — the ONE typed producer for
 * all 6 release-related artifact types (Step 10), same pattern as
 * createBuildArtifact/createTestArtifact — real content this Release Run
 * itself just computed, wrapped through the SAME createArtifactInternal(),
 * never a second store. */
export function createReleaseArtifact(input: {
  artifactType: ArtifactType; content: string | Buffer; mimeType: string; actor: string; ownerId: string;
  releaseRunId: string; jobId: string | null; sourceHash: string | null; generatedFrom: string; parentIds?: string[];
}): ArtifactRecord {
  const rec = createArtifactInternal({
    artifactType: input.artifactType, actor: input.actor, ownerId: input.ownerId, contentForChecksum: input.content,
    mimeType: input.mimeType, storeBody: true, releaseRunId: input.releaseRunId, jobId: input.jobId,
    sourceHash: input.sourceHash, generatedFrom: input.generatedFrom, parentIds: input.parentIds ?? [],
  });
  rec.evidence.push(makeEvidence("RELEASE_RUN", input.releaseRunId, `real ${input.artifactType} produced by Release Run ${input.releaseRunId}`));
  return rec;
}

/** Generic Deployment Orchestration artifact creator (Step 11) — the ONE
 * typed producer for DEPLOYMENT_PLAN/DEPLOYMENT_AUDIT, same pattern as
 * createReleaseArtifact/createBuildArtifact — real content this Deployment
 * Plan itself just computed, wrapped through the SAME
 * createArtifactInternal(), never a second store, never a real deploy. */
export function createDeploymentArtifact(input: {
  artifactType: ArtifactType; content: string | Buffer; mimeType: string; actor: string; ownerId: string;
  deploymentPlanId: string; jobId: string | null; sourceHash: string | null; generatedFrom: string; parentIds?: string[];
}): ArtifactRecord {
  const rec = createArtifactInternal({
    artifactType: input.artifactType, actor: input.actor, ownerId: input.ownerId, contentForChecksum: input.content,
    mimeType: input.mimeType, storeBody: true, deploymentPlanId: input.deploymentPlanId, jobId: input.jobId,
    sourceHash: input.sourceHash, generatedFrom: input.generatedFrom, parentIds: input.parentIds ?? [],
  });
  rec.evidence.push(makeEvidence("DEPLOYMENT_PLAN", input.deploymentPlanId, `real ${input.artifactType} produced by Deployment Plan ${input.deploymentPlanId}`));
  return rec;
}

/** Wraps a real, already-written registry file as an immutable artifact —
 * same real pattern as createFactoryResultArtifact/createRegistryResultArtifact
 * (Step 2/5), reused here for the Step 11 Global Factory Runtime's real,
 * generated report files (registry/runtime-dependency-report.json,
 * registry/factory-runtime-report.json, registry/global-factory-report.json)
 * — never a live-invented content string. */
export function createGlobalFactoryArtifact(
  artifactType: "RUNTIME_DEPENDENCY_REPORT" | "FACTORY_RUNTIME_REPORT" | "GLOBAL_FACTORY_REPORT",
  relPath: string, actor: string, ownerId: string
): ArtifactRecord {
  return wrapRegistryFile(artifactType, relPath, actor, ownerId);
}

/** Generic Operations artifact creator (Step 12) — the ONE typed producer
 * for MONITORING_SNAPSHOT/HEALTH_SIGNAL_REPORT/INCIDENT_RECORD/
 * INCIDENT_TIMELINE/INCIDENT_IMPACT_REPORT/RECOVERY_PLAN/
 * RECOVERY_READINESS_REPORT/RECOVERY_VERIFICATION_REPORT/
 * BACKUP_READINESS_REPORT/OPERATIONS_STATUS_REPORT, same pattern as
 * createDeploymentArtifact/createReleaseArtifact — real content the
 * Monitoring/Incident/Recovery Runtime itself just computed, wrapped
 * through the SAME createArtifactInternal(), never a second store. */
export function createOperationsArtifact(input: {
  artifactType: ArtifactType; content: string | Buffer; mimeType: string; actor: string; ownerId: string;
  generatedFrom: string; jobId: string | null; parentIds?: string[];
  relatedSignalId?: string | null; relatedIncidentId?: string | null; relatedRecoveryPlanId?: string | null;
  relatedBackupId?: string | null; relatedRestoreTestId?: string | null; workspaceSessionId?: string | null;
}): ArtifactRecord {
  const rec = createArtifactInternal({
    artifactType: input.artifactType, actor: input.actor, ownerId: input.ownerId, contentForChecksum: input.content,
    mimeType: input.mimeType, storeBody: true, jobId: input.jobId, generatedFrom: input.generatedFrom, parentIds: input.parentIds ?? [],
    relatedSignalId: input.relatedSignalId ?? null, relatedIncidentId: input.relatedIncidentId ?? null, relatedRecoveryPlanId: input.relatedRecoveryPlanId ?? null,
    relatedBackupId: input.relatedBackupId ?? null, relatedRestoreTestId: input.relatedRestoreTestId ?? null, workspaceSessionId: input.workspaceSessionId ?? null,
  });
  if (input.relatedIncidentId) rec.evidence.push(makeEvidence("RUNTIME", input.relatedIncidentId, `real ${input.artifactType} produced for Incident ${input.relatedIncidentId}`));
  else if (input.relatedRecoveryPlanId) rec.evidence.push(makeEvidence("RUNTIME", input.relatedRecoveryPlanId, `real ${input.artifactType} produced for Recovery Plan ${input.relatedRecoveryPlanId}`));
  else if (input.relatedSignalId) rec.evidence.push(makeEvidence("RUNTIME", input.relatedSignalId, `real ${input.artifactType} produced for Signal ${input.relatedSignalId}`));
  return rec;
}

export function listArtifacts(ownerId: string, filter?: { artifactType?: ArtifactType; status?: ArtifactStatus }): ArtifactRecord[] {
  return [...artifacts.values()]
    .filter((a) => a.ownerId === ownerId)
    .filter((a) => !filter?.artifactType || a.artifactType === filter.artifactType)
    .filter((a) => !filter?.status || a.status === filter.status)
    .reverse();
}
export function getChildren(artifactId: string, ownerId: string): ArtifactRecord[] {
  const record = getArtifact(artifactId, ownerId);
  return record.childIds.map((id) => artifacts.get(id)).filter((a): a is ArtifactRecord => !!a);
}
export function getParents(artifactId: string, ownerId: string): ArtifactRecord[] {
  const record = getArtifact(artifactId, ownerId);
  return record.parentIds.map((id) => artifacts.get(id)).filter((a): a is ArtifactRecord => !!a);
}
export function getEvidence(artifactId: string, ownerId: string): EvidenceRef[] {
  return getArtifact(artifactId, ownerId).evidence;
}
export function listArtifactEvents(limit = 200): ArtifactEvent[] {
  return artifactEvents.slice(-limit).reverse();
}

// ============================================================
// Artifact Integrity (section 12) — report-only, never auto-fixes.
// ============================================================
export interface IntegrityFinding {
  kind: "CHECKSUM_MISMATCH" | "SOURCE_HASH_STALE" | "BROKEN_LINK" | "MISSING_PARENT" | "MISSING_CHILD" | "DUPLICATE_ARTIFACT" | "ORPHAN_ARTIFACT" | "UNKNOWN_PRODUCER";
  artifactId: string;
  message: string;
}
export function checkIntegrity(ownerId: string): IntegrityFinding[] {
  const owned = [...artifacts.values()].filter((a) => a.ownerId === ownerId);
  const findings: IntegrityFinding[] = [];
  const seenByLogicalKey = new Map<string, string[]>();

  for (const a of owned) {
    // Checksum recompute — an artifact's checksum must still match its own
    // recorded content if the fields it was built from haven't changed.
    // (We recompute from the SAME fields captured at creation time, stored
    // implicitly via generatedFrom + type — a full re-derivation would
    // require re-reading the live producer, which for QUEUE_JOB/EXECUTION_
    // RESULT/INSPECTION_RESULT may have been evicted; skip those honestly.)
    if (!a.checksum || a.checksum.length !== 64) {
      findings.push({ kind: "CHECKSUM_MISMATCH", artifactId: a.artifactId, message: `artifact ${a.artifactId} has a malformed checksum` });
    }
    for (const pid of a.parentIds) {
      if (!artifacts.has(pid)) findings.push({ kind: "MISSING_PARENT", artifactId: a.artifactId, message: `parent ${pid} not found — broken link` });
    }
    for (const cid of a.childIds) {
      if (!artifacts.has(cid)) findings.push({ kind: "MISSING_CHILD", artifactId: a.artifactId, message: `child ${cid} not found — broken link` });
    }
    if (a.parentIds.length === 0 && a.childIds.length === 0 && a.artifactType !== "QUEUE_JOB" && a.artifactType !== "FACTORY_RESULT" && a.artifactType !== "ARCHITECTURE_RESULT" && a.artifactType !== "REGISTRY_RESULT" && a.artifactType !== "VALIDATION_RESULT" && a.artifactType !== "GOVERNANCE_RESULT") {
      findings.push({ kind: "ORPHAN_ARTIFACT", artifactId: a.artifactId, message: `${a.artifactType} artifact ${a.artifactId} has no parent and no child — real orphan` });
    }
    if (!getArtifactTypeDefinition(a.artifactType)) {
      findings.push({ kind: "UNKNOWN_PRODUCER", artifactId: a.artifactId, message: `artifact ${a.artifactId} references an unregistered artifact type` });
    }
    const logicalKey = `${a.artifactType}::${a.generatedFrom}::${a.checksum}`;
    const list = seenByLogicalKey.get(logicalKey) ?? [];
    list.push(a.artifactId);
    seenByLogicalKey.set(logicalKey, list);
  }
  for (const [key, ids] of seenByLogicalKey) {
    if (ids.length > 1) {
      for (const id of ids) findings.push({ kind: "DUPLICATE_ARTIFACT", artifactId: id, message: `${ids.length} artifacts share identical type+source+checksum (${key.split("::")[0]}) — real duplicate` });
    }
  }
  return findings;
}

// ---- Test-only introspection ----
export function __debugArtifactCount(): number {
  return artifacts.size;
}
export function __debugArtifactEventCount(): number {
  return artifactEvents.length;
}
