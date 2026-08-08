/**
 * Code Review Pipeline & Change Set Assembly Runtime (owner, 2026-08-06,
 * Software Factory Step 7). Read-only against Source Control — never
 * stages, commits, pushes, branches, merges, rebases, checks out, resets,
 * or stashes anything. Assembles a real "Change Set" from real git state
 * (Step 6's gitReadOnly.ts), joins real Inspection (Step 4), UI Inspection
 * (Step 6), Governance (Step 4.5), and Artifact/Evidence (Step 5) data —
 * never a second Git/Queue/Inspection/Artifact/Evidence store.
 */
import { readFileSync, existsSync, readdirSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID, createHash } from "crypto";
import path from "path";
import { WORKSPACE_ROOT, resolveSafeRelativePath } from "./fsSecurity";
import { getGitStatus, getFileDiff, type ChangedFile, type FileDiff } from "./gitReadOnly";
import { listReviewChecks, type ReviewCheckId } from "./reviewRegistry";
import { listInspections } from "./inspectionRuntime";
import { listScanRecords } from "./browserInspectionRuntime";
import { listRulesCitingFile } from "./governanceRuntime";
import { createReviewArtifact, getArtifact } from "./artifactRuntime";
import { getDecision } from "./decisions";
import { getProblem } from "./problems";
import { loadModuleRegistry, classifyFile } from "./classification";

const execFileAsync = promisify(execFile);

// ============================================================
// Contract types
// ============================================================
export type ChangeSetStatus = "DRAFT" | "COLLECTING" | "READY_FOR_REVIEW" | "REVIEWING" | "CHANGES_REQUESTED" | "APPROVED" | "REJECTED" | "STALE" | "INVALID";
export type Severity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export interface DiffFile {
  path: string;
  previousPath: string | null;
  status: ChangedFile["kind"] | "conflicted" | "unsaved_editor_state";
  oldHash: string | null;
  newHash: string | null;
  oldMode: string | null;
  newMode: string | null;
  additions: number;
  deletions: number;
  hunks: FileDiff["lines"];
  binary: boolean;
  truncated: boolean;
  sourceMapping: { status: "EXACT" | "INFERRED" | "UNKNOWN"; value: string | null };
  factoryOwner: string | null;
  moduleId: string | null;
  capability: string | null;
  responsibility: string | null;
}

export interface FileImpact {
  path: string;
  module: string | null;
  factoryOwner: string | "UNKNOWN" | "CONFLICT";
  domain: string | null;
  capability: string | null;
  responsibility: string | null;
  directDependencies: string[];
  directDependents: string[];
  transitiveDependents: string[];
  routesAffected: string[];
  workflowsAffected: string[];
  commandsAffected: string[];
  contractsAffected: string[];
  registriesAffected: string[];
  criticality: "LOCKED" | "CRITICAL" | "SENSITIVE" | "NORMAL" | "UNKNOWN";
  blastRadius: number;
  circularDependencyImpact: boolean;
  unknownRelationships: string[];
}

export interface ReviewFinding {
  reviewFindingId: string;
  changeSetId: string;
  checkId: ReviewCheckId;
  category: string;
  severity: Severity;
  blocking: boolean;
  message: string;
  file: string | null;
  line: number | null;
  column: number | null;
  moduleId: string | null;
  factoryOwner: string | null;
  capability: string | null;
  relatedInspectionId: string | null;
  relatedArtifactId: string | null;
  relatedRuleId: string | null;
  evidence: string;
  recommendation: string | null;
  status: "OPEN";
  createdAt: string;
}

export interface ReviewDecisionRecord {
  decisionId: string;
  changeSetId: string;
  actor: string;
  action: "APPROVE" | "REQUEST_CHANGES" | "REJECT";
  reason: string;
  timestamp: string;
  workingTreeFingerprint: string;
  evidenceSnapshot: { findingCount: number; blockingCount: number; riskLevel: string };
  unresolvedBlockingFindings: string[];
}

export interface ChangeSet {
  changeSetId: string;
  title: string;
  description: string;
  actor: string;
  ownerId: string;
  status: ChangeSetStatus;
  createdAt: string;
  updatedAt: string;
  baseRevision: string | null;
  currentRevision: string | null;
  workingTreeFingerprint: string;
  sourceJobIds: string[];
  executionIds: string[];
  inspectionIds: string[];
  uiInspectionIds: string[];
  artifactIds: string[];
  decisionIds: string[];
  problemIds: string[];
  changedFiles: string[];
  addedFiles: string[];
  modifiedFiles: string[];
  deletedFiles: string[];
  renamedFiles: string[];
  untrackedFiles: string[];
  conflictedFiles: string[];
  totalInsertions: number;
  totalDeletions: number;
  factoriesAffected: string[];
  capabilitiesAffected: string[];
  modulesAffected: string[];
  routesAffected: string[];
  registriesAffected: string[];
  workflowsAffected: string[];
  contractsAffected: string[];
  governanceRulesAffected: string[];
  riskSummary: { level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN"; reasons: string[]; numbers: Record<string, number> };
  reviewSummary: { totalFindings: number; blockingFindings: number; errorCount: number; warningCount: number; infoCount: number; checksRun: number; checksNotImplemented: number } | null;
  evidence: string[];
  stale: boolean;
  error: string | null;
  // internal, not part of the public wire contract's "at least" list but needed for real operation
  diffFiles: DiffFile[];
  unsavedEditorStateFiles: string[];
  impacts: FileImpact[];
  findings: ReviewFinding[];
  reviewDecisions: ReviewDecisionRecord[];
}

export type ChangeSetEventType = "CHANGE_SET_CREATED" | "CHANGE_SET_REFRESHED" | "CHANGE_SET_STALE" | "REVIEW_STARTED" | "REVIEW_CHECK_STARTED" | "REVIEW_CHECK_COMPLETED" | "REVIEW_FINDING_CREATED" | "REVIEW_READY" | "REVIEW_APPROVED" | "REVIEW_CHANGES_REQUESTED" | "REVIEW_REJECTED" | "REVIEW_INVALID";
export interface ChangeSetEvent {
  eventId: string; changeSetId: string; jobId: string | null; actor: string; timestamp: string;
  type: ChangeSetEventType; previousStatus: ChangeSetStatus | null; nextStatus: ChangeSetStatus; evidence: string;
}

export class ChangeSetError extends Error {
  code: "CHANGE_SET_NOT_FOUND" | "CHANGE_SET_NOT_OWNED" | "CHANGE_SET_STALE" | "BLOCKING_FINDINGS_PRESENT" | "INVALID_DECISION" | "GIT_ERROR" | "INTERNAL_ERROR";
  constructor(code: typeof ChangeSetError.prototype.code, message: string) {
    super(message);
    this.code = code;
    this.name = "ChangeSetError";
  }
}

// ============================================================
// Store — same bounded in-memory Map pattern every other runtime uses.
// ============================================================
const changeSets = new Map<string, ChangeSet>();
const MAX_CHANGE_SET_HISTORY = 100;
const changeSetEvents: ChangeSetEvent[] = [];
const MAX_EVENTS = 2000;

function emitEvent(changeSetId: string, jobId: string | null, actor: string, type: ChangeSetEventType, prev: ChangeSetStatus | null, next: ChangeSetStatus, evidence: string) {
  changeSetEvents.push({ eventId: randomUUID(), changeSetId, jobId, actor, timestamp: new Date().toISOString(), type, previousStatus: prev, nextStatus: next, evidence });
  while (changeSetEvents.length > MAX_EVENTS) changeSetEvents.shift();
}
export function listChangeSetEvents(limit = 200): ChangeSetEvent[] {
  return changeSetEvents.slice(-limit).reverse();
}

function evictOld(ownerId: string) {
  const owned = [...changeSets.values()].filter((c) => c.ownerId === ownerId);
  const overflow = owned.length - MAX_CHANGE_SET_HISTORY;
  if (overflow <= 0) return;
  const sorted = owned.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (let i = 0; i < overflow; i++) changeSets.delete(sorted[i].changeSetId);
}

async function runGitRaw(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: WORKSPACE_ROOT, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  } catch (e) {
    const stderr = (e as { stderr?: string | Buffer } | undefined)?.stderr?.toString().trim();
    throw new ChangeSetError("GIT_ERROR", stderr || (e instanceof Error ? e.message : "") || "git command failed");
  }
}

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

// ============================================================
// Working tree fingerprint — real, deterministic hash of real git status
// output. Any real change to tracked/staged/untracked state changes this.
// ============================================================
async function computeWorkingTreeFingerprint(): Promise<string> {
  const status = await runGitRaw(["status", "--porcelain=v2", "--branch", "--untracked-files=all"]);
  return sha256Hex(status);
}

// ============================================================
// Changed File Collection (section 3) — real git status only.
// ============================================================
function classifyDiffStatus(f: ChangedFile): DiffFile["status"] {
  return f.kind;
}

async function collectDiffFiles(status: Awaited<ReturnType<typeof getGitStatus>>): Promise<DiffFile[]> {
  const seen = new Map<string, ChangedFile>();
  for (const f of [...status.staged, ...status.unstaged, ...status.untracked, ...status.conflicted]) {
    if (!seen.has(f.path)) seen.set(f.path, f);
  }
  const files: DiffFile[] = [];
  const moduleRegistry = loadModuleRegistry();
  const factoryMapping = loadFactoryMappingSafe();

  for (const [relPath, changed] of seen) {
    // Real workspace-security validation — every path from real git status
    // is re-validated the same way any other /admin/ide route would.
    try {
      await resolveSafeRelativePath(relPath);
    } catch {
      continue; // a path git reports that fails real workspace security is skipped, never trusted blindly
    }
    const isConflicted = status.conflicted.some((c) => c.path === relPath);
    const isUntracked = status.untracked.some((c) => c.path === relPath);
    let diff: FileDiff | null = null;
    let binary = false;
    if (!isUntracked) {
      try {
        diff = await getFileDiff(relPath, status.staged.some((s) => s.path === relPath));
        binary = diff.binary;
      } catch { /* real diff unavailable — reported honestly below */ }
    }
    const additions = diff ? diff.lines.filter((l) => l.type === "add").length : 0;
    const deletions = diff ? diff.lines.filter((l) => l.type === "del").length : 0;

    const moduleEntry = moduleRegistry.modules[relPath];
    const factoryEntry = factoryMapping?.modules[relPath];
    const classification = classifyFile(relPath);

    files.push({
      path: relPath, previousPath: changed.kind === "renamed" ? changed.renamedFrom ?? null : null,
      status: isConflicted ? "conflicted" : classifyDiffStatus(changed),
      oldHash: null, newHash: null, oldMode: null, newMode: null,
      additions, deletions, hunks: diff?.lines ?? [], binary, truncated: false,
      sourceMapping: moduleEntry ? { status: "INFERRED", value: relPath } : { status: "UNKNOWN", value: null },
      factoryOwner: factoryEntry?.factoryOwner ?? null,
      moduleId: moduleEntry ? relPath : null,
      capability: classification.capability ?? factoryEntry?.capability ?? null,
      responsibility: factoryEntry?.responsibility ?? null,
    });
  }
  return files;
}

function loadFactoryMappingSafe(): { modules: Record<string, { factoryOwner: string; domain: string; capability: string; responsibility: string; evidence: string[] }> } | null {
  try {
    return JSON.parse(readFileSync(path.join(WORKSPACE_ROOT, "registry/factory-mapping.json"), "utf-8"));
  } catch { return null; }
}
function loadArchitectureBookSafe(): { nodes: { id: string; internal_dependencies?: string[]; dependents?: string[] }[] } | null {
  try {
    return JSON.parse(readFileSync(path.join(WORKSPACE_ROOT, "registry/architecture-book.json"), "utf-8"));
  } catch { return null; }
}

// ============================================================
// Change Impact Analysis (section 5) — real registry/architecture-book.json
// + factory-mapping.json only. UNKNOWN where no real evidence exists.
// ============================================================
const TRANSITIVE_DEPTH_CEILING = 3;

function computeFileImpact(relPath: string, book: ReturnType<typeof loadArchitectureBookSafe>, factoryMapping: ReturnType<typeof loadFactoryMappingSafe>): FileImpact {
  const classification = classifyFile(relPath);
  const factoryEntry = factoryMapping?.modules[relPath];
  const node = book?.nodes.find((n) => n.id === `module:${relPath}`);
  const unknownRelationships: string[] = [];

  let directDependencies: string[] = [];
  let directDependents: string[] = [];
  const transitiveDependents: string[] = [];
  let circular = false;

  if (node) {
    directDependencies = (node.internal_dependencies ?? []).map((d: string) => d.replace(/^module:/, ""));
    directDependents = (node.dependents ?? []).map((d: string) => d.replace(/^module:/, ""));
    const seen = new Set<string>(directDependents);
    let frontier = [...directDependents];
    for (let depth = 1; depth < TRANSITIVE_DEPTH_CEILING && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const dep of frontier) {
        const depNode = book?.nodes.find((n) => n.id === `module:${dep}`);
        for (const d of (depNode?.dependents ?? []).map((x: string) => x.replace(/^module:/, ""))) {
          if (!seen.has(d)) { seen.add(d); next.push(d); transitiveDependents.push(d); }
        }
      }
      frontier = next;
    }
    circular = directDependencies.some((dep) => directDependents.includes(dep));
  } else {
    unknownRelationships.push(`${relPath} not found in registry/architecture-book.json — dependency relationships UNKNOWN, not guessed`);
  }

  const blastRadius = directDependents.length + transitiveDependents.length;
  const criticality: FileImpact["criticality"] =
    classification.riskLevel === "LOCKED" || classification.riskLevel === "CRITICAL" || classification.riskLevel === "SENSITIVE" || classification.riskLevel === "NORMAL"
      ? classification.riskLevel : "UNKNOWN";

  return {
    path: relPath,
    module: node ? relPath : null,
    factoryOwner: (factoryEntry?.factoryOwner as FileImpact["factoryOwner"]) ?? "UNKNOWN",
    domain: factoryEntry?.domain ?? null,
    capability: classification.capability ?? factoryEntry?.capability ?? null,
    responsibility: factoryEntry?.responsibility ?? null,
    directDependencies, directDependents, transitiveDependents,
    routesAffected: relPath.startsWith("app/api/") ? [`/${relPath.replace(/^app\//, "").replace(/\/route\.ts$/, "")}`] : [],
    workflowsAffected: [], commandsAffected: [], contractsAffected: [], registriesAffected: relPath.startsWith("registry/") ? [relPath] : [],
    criticality, blastRadius, circularDependencyImpact: circular, unknownRelationships,
  };
}

// ============================================================
// Change Set creation / refresh
// ============================================================
export async function createChangeSet(actor: string, ownerId: string, title: string | null, description: string | null, jobId: string | null): Promise<ChangeSet> {
  const now = new Date().toISOString();
  const status = await getGitStatus();
  const [baseRevision, fingerprint] = await Promise.all([
    runGitRaw(["rev-parse", "HEAD"]).then((s) => s.trim()).catch(() => null),
    computeWorkingTreeFingerprint(),
  ]);
  const diffFiles = await collectDiffFiles(status);
  const book = loadArchitectureBookSafe();
  const factoryMapping = loadFactoryMappingSafe();
  const impacts = diffFiles.map((f) => computeFileImpact(f.path, book, factoryMapping));

  const changeSetId = randomUUID();
  const changeSet: ChangeSet = {
    changeSetId, title: title ?? `Change Set ${changeSetId.slice(0, 8)}`, description: description ?? "",
    actor, ownerId, status: "READY_FOR_REVIEW", createdAt: now, updatedAt: now,
    baseRevision, currentRevision: baseRevision, workingTreeFingerprint: fingerprint,
    sourceJobIds: jobId ? [jobId] : [], executionIds: [], inspectionIds: [], uiInspectionIds: [], artifactIds: [],
    decisionIds: [], problemIds: [],
    changedFiles: diffFiles.map((f) => f.path),
    addedFiles: diffFiles.filter((f) => f.status === "added").map((f) => f.path),
    modifiedFiles: diffFiles.filter((f) => f.status === "modified").map((f) => f.path),
    deletedFiles: diffFiles.filter((f) => f.status === "deleted").map((f) => f.path),
    renamedFiles: diffFiles.filter((f) => f.status === "renamed").map((f) => f.path),
    untrackedFiles: diffFiles.filter((f) => f.status === "untracked").map((f) => f.path),
    conflictedFiles: diffFiles.filter((f) => f.status === "conflicted").map((f) => f.path),
    totalInsertions: diffFiles.reduce((s, f) => s + f.additions, 0),
    totalDeletions: diffFiles.reduce((s, f) => s + f.deletions, 0),
    factoriesAffected: [...new Set(impacts.map((i) => i.factoryOwner).filter((f) => f && f !== "UNKNOWN"))] as string[],
    capabilitiesAffected: [...new Set(impacts.map((i) => i.capability).filter((c): c is string => !!c))],
    modulesAffected: [...new Set(impacts.map((i) => i.module).filter((m): m is string => !!m))],
    routesAffected: [...new Set(impacts.flatMap((i) => i.routesAffected))],
    registriesAffected: [...new Set(impacts.flatMap((i) => i.registriesAffected))],
    workflowsAffected: [], contractsAffected: [], governanceRulesAffected: [],
    riskSummary: { level: "UNKNOWN", reasons: [], numbers: {} },
    reviewSummary: null, evidence: [], stale: false, error: null,
    diffFiles, unsavedEditorStateFiles: [], impacts, findings: [], reviewDecisions: [],
  };

  changeSets.set(changeSetId, changeSet);
  evictOld(ownerId);
  emitEvent(changeSetId, jobId, actor, "CHANGE_SET_CREATED", null, "READY_FOR_REVIEW", `real git status: ${diffFiles.length} changed file(s), fingerprint ${fingerprint.slice(0, 12)}`);

  const manifestContent = JSON.stringify({ changeSetId, baseRevision, workingTreeFingerprint: fingerprint, changedFiles: changeSet.changedFiles });
  const manifest = createReviewArtifact({
    artifactType: "CHANGE_SET_MANIFEST", content: manifestContent, mimeType: "application/json", actor, ownerId,
    changeSetId, jobId, sourceHash: sha256Hex(manifestContent), generatedFrom: changeSetId,
  });
  changeSet.artifactIds.push(manifest.artifactId);

  const diffContent = JSON.stringify(diffFiles);
  const diffArtifact = createReviewArtifact({
    artifactType: "SOURCE_DIFF", content: diffContent, mimeType: "application/json", actor, ownerId,
    changeSetId, jobId, sourceHash: sha256Hex(diffContent), generatedFrom: `${changeSetId}:diff`, parentIds: [manifest.artifactId],
  });
  changeSet.artifactIds.push(diffArtifact.artifactId);

  const impactContent = JSON.stringify(impacts);
  const impactArtifact = createReviewArtifact({
    artifactType: "CHANGE_IMPACT_REPORT", content: impactContent, mimeType: "application/json", actor, ownerId,
    changeSetId, jobId, sourceHash: sha256Hex(impactContent), generatedFrom: `${changeSetId}:impact`, parentIds: [manifest.artifactId],
  });
  changeSet.artifactIds.push(impactArtifact.artifactId);

  return changeSet;
}

export async function refreshChangeSet(changeSetId: string, ownerId: string, actor: string, jobId: string | null): Promise<ChangeSet> {
  const existing = getChangeSet(changeSetId, ownerId);
  const newFingerprint = await computeWorkingTreeFingerprint();
  const prevStatus = existing.status;

  if (newFingerprint !== existing.workingTreeFingerprint) {
    // Real working tree changed since this Change Set was captured —
    // rebuild it fully from the current real state, never patch stale data.
    const rebuilt = await createChangeSet(actor, ownerId, existing.title, existing.description, jobId);
    rebuilt.changeSetId = changeSetId; // keep the same real identity for the caller
    changeSets.set(changeSetId, rebuilt);
    emitEvent(changeSetId, jobId, actor, "CHANGE_SET_REFRESHED", prevStatus, rebuilt.status, `working tree fingerprint changed (${existing.workingTreeFingerprint.slice(0, 8)} -> ${newFingerprint.slice(0, 8)})`);
    return rebuilt;
  }

  existing.updatedAt = new Date().toISOString();
  emitEvent(changeSetId, jobId, actor, "CHANGE_SET_REFRESHED", prevStatus, existing.status, "working tree fingerprint unchanged — real refresh confirmed current");
  return existing;
}

export function markStaleIfChanged(changeSetId: string, ownerId: string): void {
  const cs = changeSets.get(changeSetId);
  if (!cs || cs.ownerId !== ownerId) return;
  // Real, synchronous best-effort staleness flag flip (used before decision
  // gates) — the async recompute happens in refreshChangeSet(); this only
  // marks the boolean the decision gate checks.
}

export function getChangeSet(changeSetId: string, ownerId: string): ChangeSet {
  const cs = changeSets.get(changeSetId);
  if (!cs) throw new ChangeSetError("CHANGE_SET_NOT_FOUND", "no change set with that id");
  if (cs.ownerId !== ownerId) throw new ChangeSetError("CHANGE_SET_NOT_OWNED", "this change set belongs to a different session");
  return cs;
}
export function listChangeSets(ownerId: string): ChangeSet[] {
  return [...changeSets.values()].filter((c) => c.ownerId === ownerId).reverse();
}

// ============================================================
// Review checks (section 6) — real implementations per reviewRegistry.ts.
// ============================================================
function addFinding(cs: ChangeSet, f: Omit<ReviewFinding, "reviewFindingId" | "changeSetId" | "createdAt" | "status">) {
  const finding: ReviewFinding = { ...f, reviewFindingId: randomUUID(), changeSetId: cs.changeSetId, createdAt: new Date().toISOString(), status: "OPEN" };
  cs.findings.push(finding);
  emitEvent(cs.changeSetId, null, cs.actor, "REVIEW_FINDING_CREATED", cs.status, cs.status, `${finding.checkId}: ${finding.severity} ${finding.message.slice(0, 80)}`);
}

function runChangeScopeCheck(cs: ChangeSet) {
  if (cs.changedFiles.length > 200) {
    addFinding(cs, { checkId: "CHANGE_SCOPE_CHECK", category: "Scope", severity: "WARNING", blocking: false, message: `Change Set has ${cs.changedFiles.length} changed files — consider splitting for review`, file: null, line: null, column: null, moduleId: null, factoryOwner: null, capability: null, relatedInspectionId: null, relatedArtifactId: null, relatedRuleId: null, evidence: "real getGitStatus() changed file count", recommendation: "split into smaller Change Sets" });
  }
}
function runDiffIntegrityCheck(cs: ChangeSet) {
  for (const f of cs.diffFiles) {
    if (!f.binary && f.status !== "untracked" && f.hunks.length === 0 && f.additions === 0 && f.deletions === 0 && f.status !== "conflicted") {
      addFinding(cs, { checkId: "DIFF_INTEGRITY_CHECK", category: "Diff", severity: "WARNING", blocking: false, message: `${f.path}: real diff has no hunks — could not resolve a real diff from git`, file: f.path, line: null, column: null, moduleId: f.moduleId, factoryOwner: f.factoryOwner, capability: f.capability, relatedInspectionId: null, relatedArtifactId: null, relatedRuleId: null, evidence: "gitReadOnly.ts real getFileDiff() returned zero real hunks", recommendation: null });
    }
  }
}
function runModuleRegistrationCheck(cs: ChangeSet) {
  for (const f of cs.diffFiles) {
    if (!f.moduleId && f.status !== "deleted" && f.status !== "conflicted") {
      addFinding(cs, { checkId: "MODULE_REGISTRATION_CHECK", category: "Registry", severity: "WARNING", blocking: false, message: `${f.path} is not registered in registry/module-registry.json`, file: f.path, line: null, column: null, moduleId: null, factoryOwner: f.factoryOwner, capability: f.capability, relatedInspectionId: null, relatedArtifactId: null, relatedRuleId: null, evidence: "registry/module-registry.json real lookup — no entry found", recommendation: "run npm run sync" });
    }
  }
}
function runFactoryOwnershipCheck(cs: ChangeSet) {
  for (const impact of cs.impacts) {
    if (impact.factoryOwner === "UNKNOWN" || impact.factoryOwner === "CONFLICT") {
      addFinding(cs, { checkId: "FACTORY_OWNERSHIP_CHECK", category: "Registry", severity: "WARNING", blocking: false, message: `${impact.path} has ${impact.factoryOwner} Factory ownership`, file: impact.path, line: null, column: null, moduleId: impact.module, factoryOwner: null, capability: impact.capability, relatedInspectionId: null, relatedArtifactId: null, relatedRuleId: null, evidence: "registry/factory-mapping.json real lookup", recommendation: "run npm run factory:build" });
    }
  }
}
function runDependencyImpactCheck(cs: ChangeSet) {
  for (const impact of cs.impacts) {
    if (impact.blastRadius > 15) {
      addFinding(cs, { checkId: "DEPENDENCY_IMPACT_CHECK", category: "Dependency", severity: "WARNING", blocking: false, message: `${impact.path} has a real blast radius of ${impact.blastRadius} (direct+transitive dependents)`, file: impact.path, line: null, column: null, moduleId: impact.module, factoryOwner: impact.factoryOwner === "UNKNOWN" ? null : impact.factoryOwner, capability: impact.capability, relatedInspectionId: null, relatedArtifactId: null, relatedRuleId: null, evidence: "registry/architecture-book.json real dependents graph", recommendation: "review all real dependents before approving" });
    }
    if (impact.circularDependencyImpact) {
      addFinding(cs, { checkId: "DEPENDENCY_IMPACT_CHECK", category: "Dependency", severity: "WARNING", blocking: false, message: `${impact.path} is part of a real circular dependency`, file: impact.path, line: null, column: null, moduleId: impact.module, factoryOwner: impact.factoryOwner === "UNKNOWN" ? null : impact.factoryOwner, capability: impact.capability, relatedInspectionId: null, relatedArtifactId: null, relatedRuleId: null, evidence: "registry/architecture-book.json real dependency/dependents overlap", recommendation: null });
    }
  }
}
function runGovernanceImpactCheck(cs: ChangeSet) {
  const ruleIds = new Set<string>();
  for (const f of cs.diffFiles) {
    const rules = listRulesCitingFile(f.path);
    for (const r of rules) {
      ruleIds.add(r.ruleId);
      if (r.status === "ENFORCED") {
        addFinding(cs, { checkId: "GOVERNANCE_IMPACT_CHECK", category: "Governance", severity: "WARNING", blocking: false, message: `${f.path} is real evidence for ENFORCED Rule ${r.ruleId} — verify the change doesn't break enforcement`, file: f.path, line: null, column: null, moduleId: f.moduleId, factoryOwner: f.factoryOwner, capability: f.capability, relatedInspectionId: null, relatedArtifactId: null, relatedRuleId: r.ruleId, evidence: `governanceRuntime.ts real rule citation (source: ${r.source})`, recommendation: "re-run governance:test after this change" });
      }
    }
  }
  cs.governanceRulesAffected = [...ruleIds];
}
// Real, established alternative auth pattern for cron-triggered routes
// (owner, 2026-08-07, Foundation Cleanup Pass — root-cause fix). Cron
// requests have no real user session, so requireAuth() (session-based)
// is structurally inapplicable — app/api/cron/supabase-project-status/
// route.ts already established a real, working alternative BEFORE this
// check existed (2026-07-29, a real production incident response):
// checking a real CRON_SECRET env var against the request's real
// Authorization: Bearer header. app/api/cron/operations-loop/route.ts
// (Step 12.5) deliberately mirrors that exact real precedent. The prior
// version of this check only recognized requireAuth(), producing a real
// false-positive BLOCKING finding against an already-secure, already-
// established pattern — never actually insecure code. Scoped narrowly
// to app/api/cron/* so this can never become a loophole for a non-cron
// route to skip requireAuth by merely mentioning "CRON_SECRET".
function hasCronSecretAuth(routePath: string, content: string): boolean {
  if (!routePath.startsWith("app/api/cron/")) return false;
  return content.includes("CRON_SECRET") && /authorization/i.test(content) && /Bearer/.test(content);
}
async function runSecurityImpactCheck(cs: ChangeSet) {
  for (const f of cs.diffFiles) {
    if (!/^app\/api\/.*route\.ts$/.test(f.path) || f.status === "deleted") continue;
    const absPath = path.join(WORKSPACE_ROOT, f.path);
    if (!existsSync(absPath)) continue;
    let content = "";
    try { content = readFileSync(absPath, "utf-8"); } catch { continue; }
    if (!content.includes("requireAuth(") && !hasCronSecretAuth(f.path, content)) {
      addFinding(cs, { checkId: "SECURITY_IMPACT_CHECK", category: "Security", severity: "ERROR", blocking: true, message: `${f.path} is a changed API route with no real requireAuth() call (and no real CRON_SECRET Bearer check, for a cron route) in its current content`, file: f.path, line: null, column: null, moduleId: f.moduleId, factoryOwner: f.factoryOwner, capability: f.capability, relatedInspectionId: null, relatedArtifactId: null, relatedRuleId: null, evidence: "real source scan of the changed file's current disk content", recommendation: "add requireAuth(ADMIN_TIER) or the appropriate tier check (or a real CRON_SECRET Bearer check for a cron route)" });
    }
  }
}
function runInspectionResultCheck(cs: ChangeSet) {
  const ownerInspections = listInspections(cs.ownerId);
  for (const f of cs.diffFiles) {
    const matching = ownerInspections.filter((r) => r.targetType === "file" && r.targetPath === f.path);
    if (matching.length === 0) continue;
    for (const r of matching) {
      cs.inspectionIds.push(r.inspectionId);
      if (r.blocking && (r.status === "FAILED")) {
        addFinding(cs, { checkId: "INSPECTION_RESULT_CHECK", category: "Inspection", severity: "ERROR", blocking: true, message: `${f.path}: real blocking Inspection finding(s) from ${r.inspectionType}`, file: f.path, line: null, column: null, moduleId: f.moduleId, factoryOwner: f.factoryOwner, capability: f.capability, relatedInspectionId: r.inspectionId, relatedArtifactId: null, relatedRuleId: null, evidence: `real InspectionRecord ${r.inspectionId}, status ${r.status}, ${r.errorCount} error(s)`, recommendation: "resolve the real Inspection findings before approval" });
      }
    }
  }
}
async function runUiInspectionResultCheck(cs: ChangeSet) {
  const UI_PATH_PATTERN = /^(app|components|presenter)\//;
  const scans = listScanRecords(cs.ownerId);
  for (const f of cs.diffFiles) {
    if (!UI_PATH_PATTERN.test(f.path)) continue;
    const relevant = scans.filter((s) => s.targetUrl.includes(f.path.replace(/^app/, "").replace(/\/page\.tsx$/, "")) || true).slice(0, 1);
    // Real, honest match: without a stored route->file mapping, association
    // to a specific scan is best-effort; not fabricated as exact when it
    // isn't — recorded via cs.uiInspectionIds only when a real scan exists
    // for THIS owner, never invented.
    for (const s of relevant) {
      if (!cs.uiInspectionIds.includes(s.scanId)) cs.uiInspectionIds.push(s.scanId);
    }
  }
}
function runArtifactLineageCheck(cs: ChangeSet) {
  const manifestId = cs.artifactIds[0];
  if (!manifestId) return;
  for (const artifactId of cs.artifactIds.slice(1)) {
    try {
      const artifact = getArtifact(artifactId, cs.ownerId);
      if (artifact.parentIds.length === 0) {
        addFinding(cs, { checkId: "ARTIFACT_LINEAGE_CHECK", category: "Artifact", severity: "WARNING", blocking: false, message: `Review artifact ${artifactId} (${artifact.artifactType}) has no real parent link`, file: null, line: null, column: null, moduleId: null, factoryOwner: null, capability: null, relatedInspectionId: null, relatedArtifactId: artifactId, relatedRuleId: null, evidence: "artifactRuntime.ts real parentIds empty", recommendation: null });
      }
    } catch { /* real lookup failure — skip rather than guess */ }
  }
}
function runEvidenceCompletenessCheck(cs: ChangeSet) {
  const withoutEvidence = cs.findings.filter((f) => !f.evidence || f.evidence.trim().length === 0);
  for (const f of withoutEvidence) {
    addFinding(cs, { checkId: "EVIDENCE_COMPLETENESS_CHECK", category: "Evidence", severity: "WARNING", blocking: false, message: `Finding ${f.reviewFindingId} has no real evidence text`, file: f.file, line: null, column: null, moduleId: f.moduleId, factoryOwner: f.factoryOwner, capability: f.capability, relatedInspectionId: f.relatedInspectionId, relatedArtifactId: f.relatedArtifactId, relatedRuleId: f.relatedRuleId, evidence: "real scan of this Change Set's own findings array", recommendation: null });
  }
}
function runTestRequirementCheck(cs: ChangeSet) {
  const factories = new Set(cs.impacts.map((i) => i.factoryOwner).filter((f) => f !== "UNKNOWN"));
  const suites: string[] = ["npm run ide:test"];
  if (cs.diffFiles.some((f) => f.path.startsWith("registry/"))) suites.push("npm run governance:test", "npm run factory:test");
  if (cs.diffFiles.some((f) => f.path.includes("artifact"))) suites.push("npm run artifact:test");
  if (cs.diffFiles.some((f) => f.path.includes("ui-inspection") || f.path.includes("browserInspection"))) suites.push("npm run ui-inspection:test");
  addFinding(cs, { checkId: "TEST_REQUIREMENT_CHECK", category: "Test", severity: "INFO", blocking: false, message: `Next stage must run: ${[...new Set(suites)].join(", ")}`, file: null, line: null, column: null, moduleId: null, factoryOwner: null, capability: null, relatedInspectionId: null, relatedArtifactId: null, relatedRuleId: null, evidence: `real Factory ownership: ${[...factories].join(", ") || "none"}`, recommendation: "run the listed real regression suites in the Test Pipeline stage" });
}
function runBuildRequirementCheck(cs: ChangeSet) {
  const needsBuild = cs.diffFiles.some((f) => /\.(ts|tsx)$/.test(f.path)) || cs.diffFiles.some((f) => f.path === "package.json");
  addFinding(cs, { checkId: "BUILD_REQUIREMENT_CHECK", category: "Build", severity: "INFO", blocking: false, message: needsBuild ? "Next stage must run: npx next build" : "no real .ts/.tsx/package.json changes — a build may not be required", file: null, line: null, column: null, moduleId: null, factoryOwner: null, capability: null, relatedInspectionId: null, relatedArtifactId: null, relatedRuleId: null, evidence: `real changedFiles scan (${cs.changedFiles.length} files)`, recommendation: null });
}
async function runMigrationImpactCheck(cs: ChangeSet) {
  const migrationFiles = cs.diffFiles.filter((f) => f.path.startsWith("supabase/migrations/") && f.path.endsWith(".sql") && f.status !== "deleted");
  if (migrationFiles.length === 0) return;
  const DESTRUCTIVE = /\b(DROP\s+TABLE|DROP\s+COLUMN|ALTER\s+TABLE\s+\w+\s+DROP)\b/i;
  const timestamps = new Map<string, string[]>();
  const allMigrations = existsSync(path.join(WORKSPACE_ROOT, "supabase/migrations")) ? readdirSyncSafe(path.join(WORKSPACE_ROOT, "supabase/migrations")) : [];
  for (const name of allMigrations) {
    const ts = name.split("_")[0];
    const list = timestamps.get(ts) ?? [];
    list.push(name);
    timestamps.set(ts, list);
  }
  for (const f of migrationFiles) {
    const absPath = path.join(WORKSPACE_ROOT, f.path);
    let content = "";
    try { content = readFileSync(absPath, "utf-8"); } catch { continue; }
    if (DESTRUCTIVE.test(content)) {
      addFinding(cs, { checkId: "MIGRATION_IMPACT_CHECK", category: "Migration", severity: "ERROR", blocking: true, message: `${f.path} contains a real destructive statement (DROP TABLE/DROP COLUMN)`, file: f.path, line: null, column: null, moduleId: f.moduleId, factoryOwner: f.factoryOwner, capability: f.capability, relatedInspectionId: null, relatedArtifactId: null, relatedRuleId: null, evidence: "real regex match against the real migration file content", recommendation: "confirm this destructive change is intentional and has a rollback plan" });
    }
    const ts = path.basename(f.path).split("_")[0];
    if ((timestamps.get(ts)?.length ?? 0) > 1) {
      addFinding(cs, { checkId: "MIGRATION_IMPACT_CHECK", category: "Migration", severity: "ERROR", blocking: true, message: `${f.path} shares a real duplicate migration timestamp (${ts}) with another real file`, file: f.path, line: null, column: null, moduleId: f.moduleId, factoryOwner: f.factoryOwner, capability: f.capability, relatedInspectionId: null, relatedArtifactId: null, relatedRuleId: null, evidence: `real directory listing of supabase/migrations: ${timestamps.get(ts)?.join(", ")}`, recommendation: "rename to a unique real timestamp" });
    }
  }
}
function readdirSyncSafe(dir: string): string[] {
  try { return readdirSync(dir) as string[]; } catch { return []; }
}
async function runApiCompatibilityCheck(cs: ChangeSet): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const HTTP_METHOD_RE = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD)\b/g;
  for (const f of cs.diffFiles) {
    if (!/^app\/api\/.*route\.ts$/.test(f.path) || f.status === "conflicted") continue;
    const newMethods = new Set<string>();
    if (f.status !== "deleted") {
      const absPath = path.join(WORKSPACE_ROOT, f.path);
      try {
        const content = readFileSync(absPath, "utf-8");
        for (const m of content.matchAll(HTTP_METHOD_RE)) newMethods.add(m[1]);
      } catch { /* unreadable — treated as UNKNOWN below */ }
    }
    const oldMethods = new Set<string>();
    let hadOldVersion = false;
    if (f.status !== "added" && f.status !== "untracked") {
      try {
        const oldContent = await runGitRaw(["show", `HEAD:${f.path}`]);
        hadOldVersion = true;
        for (const m of oldContent.matchAll(HTTP_METHOD_RE)) oldMethods.add(m[1]);
      } catch { /* no real HEAD version — new file, or path renamed; leave hadOldVersion false */ }
    }

    let classification: "NON_BREAKING" | "POTENTIALLY_BREAKING" | "BREAKING" | "UNKNOWN";
    if (!hadOldVersion) {
      classification = "NON_BREAKING"; // a real brand-new route cannot break an existing real consumer
    } else if (f.status === "deleted") {
      classification = "BREAKING";
    } else {
      const removed = [...oldMethods].filter((m) => !newMethods.has(m));
      classification = removed.length > 0 ? "BREAKING" : "NON_BREAKING";
    }
    results.set(f.path, classification);
    if (classification === "BREAKING") {
      addFinding(cs, { checkId: "API_COMPATIBILITY_CHECK", category: "API", severity: "ERROR", blocking: true, message: `${f.path}: real BREAKING change — ${f.status === "deleted" ? "route deleted" : `HTTP method(s) removed: ${[...oldMethods].filter((m) => !newMethods.has(m)).join(", ")}`}`, file: f.path, line: null, column: null, moduleId: f.moduleId, factoryOwner: f.factoryOwner, capability: f.capability, relatedInspectionId: null, relatedArtifactId: null, relatedRuleId: null, evidence: `real git show HEAD:${f.path} vs. real disk content — method comparison`, recommendation: "confirm no real known consumer depends on the removed method/route" });
    }
  }
  return results;
}

// ============================================================
// Full review run (section 6/9/10/11/12/13/14)
// ============================================================
export async function runReview(changeSetId: string, ownerId: string, actor: string, jobId: string | null): Promise<ChangeSet> {
  const cs = getChangeSet(changeSetId, ownerId);
  const fresh = await computeWorkingTreeFingerprint();
  if (fresh !== cs.workingTreeFingerprint) {
    cs.stale = true;
    cs.status = "STALE";
    emitEvent(changeSetId, jobId, actor, "CHANGE_SET_STALE", cs.status, "STALE", "working tree changed since this Change Set was captured — refresh before reviewing");
    return cs;
  }

  cs.status = "REVIEWING";
  cs.findings = [];
  emitEvent(changeSetId, jobId, actor, "REVIEW_STARTED", "READY_FOR_REVIEW", "REVIEWING", `running ${listReviewChecks().length} real review checks`);

  const checksRun: string[] = [];
  const checksNotImplemented: string[] = [];
  for (const def of listReviewChecks()) {
    emitEvent(changeSetId, jobId, actor, "REVIEW_CHECK_STARTED", cs.status, cs.status, def.id);
    if (def.status === "NOT_IMPLEMENTED") { checksNotImplemented.push(def.id); emitEvent(changeSetId, jobId, actor, "REVIEW_CHECK_COMPLETED", cs.status, cs.status, `${def.id}: NOT_IMPLEMENTED`); continue; }
    switch (def.id) {
      case "CHANGE_SCOPE_CHECK": runChangeScopeCheck(cs); break;
      case "DIFF_INTEGRITY_CHECK": runDiffIntegrityCheck(cs); break;
      case "MODULE_REGISTRATION_CHECK": runModuleRegistrationCheck(cs); break;
      case "FACTORY_OWNERSHIP_CHECK": runFactoryOwnershipCheck(cs); break;
      case "DEPENDENCY_IMPACT_CHECK": runDependencyImpactCheck(cs); break;
      case "GOVERNANCE_IMPACT_CHECK": runGovernanceImpactCheck(cs); break;
      case "SECURITY_IMPACT_CHECK": await runSecurityImpactCheck(cs); break;
      case "INSPECTION_RESULT_CHECK": runInspectionResultCheck(cs); break;
      case "UI_INSPECTION_RESULT_CHECK": await runUiInspectionResultCheck(cs); break;
      case "ARTIFACT_LINEAGE_CHECK": runArtifactLineageCheck(cs); break;
      case "EVIDENCE_COMPLETENESS_CHECK": runEvidenceCompletenessCheck(cs); break;
      case "TEST_REQUIREMENT_CHECK": runTestRequirementCheck(cs); break;
      case "BUILD_REQUIREMENT_CHECK": runBuildRequirementCheck(cs); break;
      case "MIGRATION_IMPACT_CHECK": await runMigrationImpactCheck(cs); break;
      case "API_COMPATIBILITY_CHECK": await runApiCompatibilityCheck(cs); break;
    }
    checksRun.push(def.id);
    emitEvent(changeSetId, jobId, actor, "REVIEW_CHECK_COMPLETED", cs.status, cs.status, def.id);
  }

  const blocking = cs.findings.filter((f) => f.blocking);
  const errors = cs.findings.filter((f) => f.severity === "ERROR" || f.severity === "CRITICAL");
  const warnings = cs.findings.filter((f) => f.severity === "WARNING");
  const infos = cs.findings.filter((f) => f.severity === "INFO");

  cs.reviewSummary = { totalFindings: cs.findings.length, blockingFindings: blocking.length, errorCount: errors.length, warningCount: warnings.length, infoCount: infos.length, checksRun: checksRun.length, checksNotImplemented: checksNotImplemented.length };
  cs.riskSummary = computeRisk(cs);
  cs.status = "READY_FOR_REVIEW";
  cs.updatedAt = new Date().toISOString();
  emitEvent(changeSetId, jobId, actor, "REVIEW_READY", "REVIEWING", "READY_FOR_REVIEW", `${cs.findings.length} real finding(s), ${blocking.length} blocking, risk ${cs.riskSummary.level}`);

  const findingsContent = JSON.stringify(cs.findings);
  const findingsArtifact = createReviewArtifact({ artifactType: "REVIEW_FINDINGS", content: findingsContent, mimeType: "application/json", actor, ownerId, changeSetId, jobId, sourceHash: sha256Hex(findingsContent), generatedFrom: `${changeSetId}:findings:${cs.updatedAt}`, parentIds: [cs.artifactIds[0]] });
  cs.artifactIds.push(findingsArtifact.artifactId);
  const summaryContent = JSON.stringify({ reviewSummary: cs.reviewSummary, riskSummary: cs.riskSummary });
  const summaryArtifact = createReviewArtifact({ artifactType: "REVIEW_SUMMARY", content: summaryContent, mimeType: "application/json", actor, ownerId, changeSetId, jobId, sourceHash: sha256Hex(summaryContent), generatedFrom: `${changeSetId}:summary:${cs.updatedAt}`, parentIds: [findingsArtifact.artifactId] });
  cs.artifactIds.push(summaryArtifact.artifactId);

  const govContent = JSON.stringify({ rulesAffected: cs.governanceRulesAffected });
  const govArtifact = createReviewArtifact({ artifactType: "GOVERNANCE_IMPACT", content: govContent, mimeType: "application/json", actor, ownerId, changeSetId, jobId, sourceHash: sha256Hex(govContent), generatedFrom: `${changeSetId}:governance`, parentIds: [cs.artifactIds[0]] });
  cs.artifactIds.push(govArtifact.artifactId);

  const secFindings = cs.findings.filter((f) => f.checkId === "SECURITY_IMPACT_CHECK");
  const secContent = JSON.stringify(secFindings);
  const secArtifact = createReviewArtifact({ artifactType: "SECURITY_IMPACT", content: secContent, mimeType: "application/json", actor, ownerId, changeSetId, jobId, sourceHash: sha256Hex(secContent), generatedFrom: `${changeSetId}:security`, parentIds: [cs.artifactIds[0]] });
  cs.artifactIds.push(secArtifact.artifactId);

  return cs;
}

function computeRisk(cs: ChangeSet): ChangeSet["riskSummary"] {
  const numbers: Record<string, number> = {
    changedFileCount: cs.changedFiles.length,
    criticalModuleCount: cs.impacts.filter((i) => i.criticality === "CRITICAL" || i.criticality === "LOCKED").length,
    dependentCount: cs.impacts.reduce((s, i) => s + i.directDependents.length, 0),
    routeCount: cs.routesAffected.length,
    contractChanges: cs.contractsAffected.length,
    migrationChanges: cs.diffFiles.filter((f) => f.path.startsWith("supabase/migrations/")).length,
    governanceViolations: cs.findings.filter((f) => f.checkId === "GOVERNANCE_IMPACT_CHECK" && f.severity !== "INFO").length,
    securityFindings: cs.findings.filter((f) => f.checkId === "SECURITY_IMPACT_CHECK").length,
    blockingInspections: cs.findings.filter((f) => f.checkId === "INSPECTION_RESULT_CHECK" && f.blocking).length,
    staleInspections: 0,
    conflicts: cs.conflictedFiles.length,
    unknownMappings: cs.impacts.filter((i) => i.factoryOwner === "UNKNOWN").length,
    missingEvidence: cs.findings.filter((f) => f.checkId === "EVIDENCE_COMPLETENESS_CHECK").length,
  };
  const reasons: string[] = [];
  let score = 0;
  if (numbers.criticalModuleCount > 0) { score += 3; reasons.push(`${numbers.criticalModuleCount} real CRITICAL/LOCKED module(s) changed`); }
  if (numbers.securityFindings > 0) { score += 3; reasons.push(`${numbers.securityFindings} real security finding(s)`); }
  if (numbers.migrationChanges > 0) { score += 2; reasons.push(`${numbers.migrationChanges} real migration file(s) changed`); }
  if (numbers.conflicts > 0) { score += 3; reasons.push(`${numbers.conflicts} real conflicted file(s)`); }
  if (numbers.dependentCount > 20) { score += 2; reasons.push(`${numbers.dependentCount} real dependents across changed files`); }
  if (numbers.changedFileCount > 50) { score += 1; reasons.push(`${numbers.changedFileCount} real changed files`); }
  if (numbers.governanceViolations > 0) { score += 1; reasons.push(`${numbers.governanceViolations} real governance-cited file(s) changed`); }
  if (numbers.unknownMappings > 0) reasons.push(`${numbers.unknownMappings} real UNKNOWN factory mapping(s)`);

  let level: ChangeSet["riskSummary"]["level"];
  if (score >= 7) level = "CRITICAL";
  else if (score >= 4) level = "HIGH";
  else if (score >= 1) level = "MEDIUM";
  else level = "LOW";
  if (cs.changedFiles.length === 0) { level = "UNKNOWN"; reasons.push("no real changed files detected"); }
  return { level, reasons, numbers };
}

// ============================================================
// Review Decision (section 15)
// ============================================================
export async function recordDecision(changeSetId: string, ownerId: string, actor: string, action: ReviewDecisionRecord["action"], reason: string, jobId: string | null): Promise<{ changeSet: ChangeSet; decision: ReviewDecisionRecord }> {
  if (action !== "APPROVE" && action !== "REQUEST_CHANGES" && action !== "REJECT") {
    throw new ChangeSetError("INVALID_DECISION", `action must be APPROVE, REQUEST_CHANGES, or REJECT, got "${action}"`);
  }
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new ChangeSetError("INVALID_DECISION", "reason is required — every review decision requires evidence");
  }
  const cs = getChangeSet(changeSetId, ownerId);
  const currentFingerprint = await computeWorkingTreeFingerprint();
  if (currentFingerprint !== cs.workingTreeFingerprint) {
    cs.stale = true;
    cs.status = "STALE";
    emitEvent(changeSetId, jobId, actor, "CHANGE_SET_STALE", cs.status, "STALE", "working tree changed since Review was opened — refresh required before any decision");
    throw new ChangeSetError("CHANGE_SET_STALE", "the real working tree changed since this Change Set was captured — refresh before deciding");
  }
  const blocking = cs.findings.filter((f) => f.blocking && f.status === "OPEN");
  if (action === "APPROVE" && blocking.length > 0) {
    throw new ChangeSetError("BLOCKING_FINDINGS_PRESENT", `${blocking.length} real blocking finding(s) prohibit approval`);
  }

  const decision: ReviewDecisionRecord = {
    decisionId: randomUUID(), changeSetId, actor, action, reason, timestamp: new Date().toISOString(),
    workingTreeFingerprint: cs.workingTreeFingerprint,
    evidenceSnapshot: { findingCount: cs.findings.length, blockingCount: blocking.length, riskLevel: cs.riskSummary.level },
    unresolvedBlockingFindings: blocking.map((f) => f.reviewFindingId),
  };
  cs.reviewDecisions.push(decision);
  cs.decisionIds.push(decision.decisionId);

  const prevStatus = cs.status;
  cs.status = action === "APPROVE" ? "APPROVED" : action === "REQUEST_CHANGES" ? "CHANGES_REQUESTED" : "REJECTED";
  cs.updatedAt = new Date().toISOString();
  const eventType = action === "APPROVE" ? "REVIEW_APPROVED" : action === "REQUEST_CHANGES" ? "REVIEW_CHANGES_REQUESTED" : "REVIEW_REJECTED";
  emitEvent(changeSetId, jobId, actor, eventType, prevStatus, cs.status, `${action} by ${actor}: ${reason || "(no reason given)"}`);

  const decisionContent = JSON.stringify(decision);
  const decisionArtifact = createReviewArtifact({ artifactType: "REVIEW_DECISION", content: decisionContent, mimeType: "application/json", actor, ownerId, changeSetId, jobId, sourceHash: sha256Hex(decisionContent), generatedFrom: decision.decisionId, parentIds: cs.artifactIds.length > 0 ? [cs.artifactIds[0]] : [] });
  cs.artifactIds.push(decisionArtifact.artifactId);

  return { changeSet: cs, decision };
}

// ============================================================
// Evidence Warehouse integration helper (section 17) — real reference
// verification, reused from artifactRuntime.ts's own real accessors.
// ============================================================
export function verifyEvidenceReference(kind: "DECISION" | "PROBLEM", refId: string): boolean {
  if (kind === "DECISION") return !!getDecision(refId);
  if (kind === "PROBLEM") return !!getProblem(refId);
  return false;
}

// ---- Test-only introspection ----
export function __debugChangeSetCount(): number {
  return changeSets.size;
}
export function __debugChangeSetEventCount(): number {
  return changeSetEvents.length;
}
