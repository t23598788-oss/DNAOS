"use client";

/**
 * DNA OS — /admin/ide, the Software Factory workspace (owner, 2026-08-07,
 * "/admin/ide Foundation" audit — supersedes the 2026-08-05 header below,
 * which had gone stale: this file is NOT "mostly mock" any more).
 *
 * Real, wired-to-a-real-backend as of this pass: Explorer + Editor
 * (app/api/admin/ide/tree, /file, sha-conflict protection), Source
 * Control read-only (git/*), Problems (aggregates real Inspection +
 * Artifact Integrity + Review + Test + Build + Release), Execution
 * (governed replay of a fixed, 16-command allow-list —
 * executionRegistry.ts — never arbitrary shell text), Runtime Events
 * (same real event log as Execution), Queue, Inspection, Artifacts,
 * UI Inspection, Code Review, Test, Build, Release, Factory Completion,
 * Operations, Factory Workspace (incl. real Worker Bridge selection,
 * Step 13.6), AI Execution (real Worker/Provider health, Step 13.6
 * Bridge), Context (real, file-persisted Execution Context, survives a
 * dev-server restart — executionContextRuntime.ts), and the Owner
 * Command Surface (real, deterministic intent routing —
 * commandSurfaceRuntime.ts).
 *
 * Still honestly NOT_CONNECTED / static: left-sidebar Runtime/AI panels
 * (labeled "Not connected", not faked), Settings (no real config store),
 * and there is no free-form Terminal — the Execution tab is a real but
 * intentionally allow-listed command runner, not a general shell (see
 * this pass's final report for the reasoning).
 */
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  FolderTree, Search as SearchIcon, GitBranch, Activity, Bot, FileText, Settings as SettingsIcon,
  File, Folder, ChevronRight, ChevronDown, ChevronUp, X, XCircle, AlertTriangle, RefreshCw, FolderOpen,
  FilePlus, FolderPlus, Pencil, FolderInput, Trash2, Copy, RotateCcw, Trash, Lock,
} from "lucide-react";

// ---- Real workspace API client (app/api/admin/ide/*) ----
type IdeErrorCode =
  | "INVALID_PATH" | "INVALID_QUERY" | "INVALID_NAME" | "PATH_OUTSIDE_WORKSPACE" | "NOT_FOUND" | "ACCESS_DENIED"
  | "FILE_TOO_LARGE" | "UNSUPPORTED_FILE" | "SEARCH_LIMIT_REACHED" | "SEARCH_TIMEOUT" | "GIT_ERROR" | "FILE_CONFLICT"
  | "WRITE_FAILED" | "PATH_CONFLICT" | "DIRECTORY_NOT_EMPTY" | "INVALID_MOVE" | "TRASH_ENTRY_NOT_FOUND"
  | "CORRUPT_TRASH_ENTRY" | "OPERATION_FAILED" | "LOCKED_FILE" | "INTERNAL_ERROR";
interface TreeEntry { name: string; path: string; type: "file" | "directory" }
type TreeResponse = { ok: true; path: string; entries: TreeEntry[] } | { ok: false; code: IdeErrorCode; message: string };
type FileResponse = { ok: true; path: string; content: string; size_bytes: number; modified_at: string; hash: string; encoding: string; line_ending: "LF" | "CRLF" | "mixed"; read_only: boolean; classification: ClassificationInfo } | { ok: false; code: IdeErrorCode; message: string };
interface EvidenceChainStep { stage: string; detail: string; source: string | null }
type FileWriteResponse =
  | { ok: true; path: string; size_bytes: number; modified_at: string; hash: string; triggered_checks: { commandId: string; runId: string }[]; evidence_chain: EvidenceChainStep[] }
  | { ok: false; code: "FILE_CONFLICT"; message: string; disk_content: string; disk_hash: string; disk_modified_at: string }
  | { ok: false; code: Exclude<IdeErrorCode, "FILE_CONFLICT">; message: string };
interface SearchMatch { relativePath: string; line: number; column: number; preview: string; matchLength: number }
type SearchResponse = {
  ok: true; path: string; results: SearchMatch[]; result_count: number; files_scanned: number;
  truncated: boolean; truncation_reason: "SEARCH_LIMIT_REACHED" | "SEARCH_TIMEOUT" | null; duration_ms: number;
} | { ok: false; code: IdeErrorCode; message: string };

type ChangeKind = "added" | "modified" | "deleted" | "renamed" | "copied" | "untracked";
interface ChangedFile { path: string; kind: ChangeKind; renamedFrom?: string }
type GitStatusResponse = {
  ok: true; repositoryRoot: string; branch: string | null;
  headCommit: { hash: string; message: string; author: string; time: string } | null;
  ahead: number; behind: number; hasUpstream: boolean;
  staged: ChangedFile[]; unstaged: ChangedFile[]; untracked: ChangedFile[]; conflicted: ChangedFile[]; clean: boolean;
} | { ok: false; code: IdeErrorCode; message: string };
interface DiffLine { type: "context" | "add" | "del" | "hunk"; oldLine: number | null; newLine: number | null; content: string }
type GitDiffResponse = { ok: true; path: string; staged: boolean; binary: boolean; lines: DiffLine[] } | { ok: false; code: IdeErrorCode; message: string };

// ---- Source Control Workspace (Read Only) — owner, 2026-08-06, Software
// Factory Step 6. Client types mirror gitReadOnly.ts's real shapes exactly. ----
interface BranchInfo { name: string; current: boolean; remote: boolean; upstream: string | null; lastCommitHash: string | null; lastCommitSubject: string | null; lastCommitDate: string | null }
type GitBranchesResponse = { ok: true; branches: BranchInfo[] } | { ok: false; code: IdeErrorCode; message: string };
interface TagInfo { name: string; hash: string | null; subject: string | null; date: string | null; annotated: boolean }
type GitTagsResponse = { ok: true; tags: TagInfo[] } | { ok: false; code: IdeErrorCode; message: string };
interface FileHistoryEntry { hash: string; shortHash: string; author: string; date: string; subject: string }
type GitHistoryResponse = { ok: true; path: string; history: FileHistoryEntry[] } | { ok: false; code: IdeErrorCode; message: string };
interface BlameLine { line: number; content: string; hash: string; shortHash: string; author: string; date: string }
type GitBlameResponse = { ok: true; path: string; blame: BlameLine[] } | { ok: false; code: IdeErrorCode; message: string };
type GitMergeStatusResponse = { ok: true; inProgress: boolean; kind: "merge" | "rebase" | "cherry-pick" | "revert" | null; headBranch: string | null; mergeHeads: string[]; conflictedFiles: ChangedFile[] } | { ok: false; code: IdeErrorCode; message: string };
interface ConflictInfo { path: string; markersFound: boolean; markerCount: number }
type GitConflictsResponse = { ok: true; conflicts: ConflictInfo[] } | { ok: false; code: IdeErrorCode; message: string };

// ---- Real Inspection Pipeline (owner, 2026-08-06, Software Factory Step 4)
// client types — mirror app/api/admin/ide/_lib/inspectionRuntime.ts's real
// InspectionRecord/Finding shapes exactly; never a shape invented for the UI. ----
type InspectionType = "SYNTAX_CHECK" | "TYPE_DIAGNOSTIC" | "IMPORT_CHECK" | "CONTRACT_CHECK" | "REGISTRY_CHECK" | "DEPENDENCY_CHECK" | "GOVERNANCE_CHECK" | "SECURITY_POLICY_CHECK";
type InspectionStatus = "QUEUED" | "RUNNING" | "PASSED" | "FAILED" | "WARNING" | "CANCELLED" | "TIMED_OUT" | "REJECTED" | "NOT_IMPLEMENTED";
type FindingSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";
interface Finding {
  findingId: string; inspectionId: string; code: string; category: InspectionType; severity: FindingSeverity; message: string;
  file: string | null; line: number | null; column: number | null; endLine: number | null; endColumn: number | null;
  rule: string | null; evidence: string; blocking: boolean; source: string; createdAt: string;
}
interface InspectionRecord {
  inspectionId: string; jobId: string | null; executionId: string | null; actor: string; ownerId: string;
  inspectionType: InspectionType; targetType: "file" | "command"; targetPath: string; sourceHash: string | null;
  startedAt: string | null; finishedAt: string | null; durationMs: number | null; status: InspectionStatus;
  severity: FindingSeverity | null; blocking: boolean; findings: Finding[]; findingCount: number;
  errorCount: number; warningCount: number; infoCount: number; evidence: string; commandId: string | null;
  exitCode: number | null; stdoutHash: string | null; stderrHash: string | null; error: string | null; stale: boolean;
}
type InspectionListResponse = { ok: true; inspections: InspectionRecord[] } | { ok: false; code: string; message: string };
type InspectionRunResponse = { ok: true; inspection: InspectionRecord } | { ok: false; code: string; message: string };

// ---- Real Artifact Pipeline (owner, 2026-08-06, Software Factory Step 5)
// client types — mirror app/api/admin/ide/_lib/artifactRuntime.ts's real
// ArtifactRecord/EvidenceRef shapes exactly. ----
type ArtifactType = "EDITOR_SAVE" | "QUEUE_JOB" | "EXECUTION_RESULT" | "INSPECTION_RESULT" | "GOVERNANCE_RESULT" | "FACTORY_RESULT" | "ARCHITECTURE_RESULT" | "REGISTRY_RESULT" | "VALIDATION_RESULT" | "CUSTOM" | "BUILD_OUTPUT" | "TEST_RESULT";
type ArtifactStatus = "PENDING" | "READY" | "FAILED" | "ARCHIVED" | "INVALID";
type EvidenceKind = "QUEUE" | "INSPECTION" | "RUNTIME" | "GOVERNANCE" | "FACTORY" | "REGISTRY" | "DECISION" | "PROBLEM";
interface EvidenceRef { evidenceId: string; kind: EvidenceKind; refId: string; description: string; verifiedReal: boolean }
interface ArtifactRecord {
  artifactId: string; artifactType: ArtifactType; displayName: string; description: string; producer: string; consumer: string[];
  source: string; format: string; version: number; immutable: boolean; retention: string; status: ArtifactStatus;
  createdAt: string; actor: string; ownerId: string; jobId: string | null; executionId: string | null; inspectionId: string | null;
  ruleId: string | null; factoryId: string | null; registryId: string | null; checksum: string; sizeBytes: number; mimeType: string;
  sourceHash: string | null; parentIds: string[]; childIds: string[]; durationMs: number | null; generatedFrom: string;
  evidence: EvidenceRef[]; supersedes: string | null; supersededBy: string | null;
}
type ArtifactListResponse = { ok: true; artifacts: ArtifactRecord[] } | { ok: false; code: string; message: string };
interface IntegrityFinding { kind: string; artifactId: string; message: string }
type ArtifactIntegrityResponse = { ok: true; findings: IntegrityFinding[] } | { ok: false; code: string; message: string };

// ---- UI Inspection Capability (owner, 2026-08-06, Software Factory Step
// 6) — client types mirror browserInspectionRuntime.ts's real shapes. ----
interface UiViewportProfile { id: string; width: number; height: number; deviceScaleFactor: number; isMobile: boolean; hasTouch: boolean; orientation: string }
interface UiScanRecord {
  scanId: string; ownerId: string; targetUrl: string; environment: string; viewportsRun: string[]; inspectionIds: string[];
  manifestArtifactId: string; jobId: string | null; createdAt: string;
  findingCount?: number; errorCount?: number; warningCount?: number; status?: "PASSED" | "WARNING" | "FAILED";
}
type UiScanListResponse = { ok: true; scans: UiScanRecord[] } | { ok: false; code: string; message: string };
type UiScanDetailResponse = { ok: true; scan: UiScanRecord; inspections: InspectionRecord[] } | { ok: false; code: string; message: string };
type UiScanRunResponse = { ok: true; scanId: string; jobId: string; targetUrl: string; viewportsRun: string[]; findingCount: number; errorCount: number } | { ok: false; code: string; message: string };
type UiViewportListResponse = { ok: true; viewports: UiViewportProfile[] } | { ok: false; code: string; message: string };

const UI_VIEWPORT_CHOICES = [
  "DESKTOP_1920_1080", "DESKTOP_1440_900", "LAPTOP_1366_768", "LAPTOP_1280_720",
  "TABLET_1024_768", "TABLET_768_1024", "MOBILE_430_932", "MOBILE_390_844", "MOBILE_360_800",
];

// ---- Code Review Pipeline & Change Set Assembly (owner, 2026-08-06,
// Software Factory Step 7) — client types mirror changeSetRuntime.ts's
// real shapes. ----
type ChangeSetStatus = "DRAFT" | "COLLECTING" | "READY_FOR_REVIEW" | "REVIEWING" | "CHANGES_REQUESTED" | "APPROVED" | "REJECTED" | "STALE" | "INVALID";
interface DiffFileClient {
  path: string; previousPath: string | null; status: string; additions: number; deletions: number;
  hunks: DiffLine[]; binary: boolean; truncated: boolean; factoryOwner: string | null; moduleId: string | null; capability: string | null;
}
interface FileImpactClient {
  path: string; module: string | null; factoryOwner: string; domain: string | null; capability: string | null;
  directDependents: string[]; transitiveDependents: string[]; criticality: string; blastRadius: number; circularDependencyImpact: boolean;
}
interface ReviewFindingClient {
  reviewFindingId: string; changeSetId: string; checkId: string; category: string; severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  blocking: boolean; message: string; file: string | null; line: number | null; column: number | null;
  relatedInspectionId: string | null; relatedArtifactId: string | null; relatedRuleId: string | null; evidence: string; recommendation: string | null;
}
interface ChangeSetClient {
  changeSetId: string; title: string; description: string; actor: string; status: ChangeSetStatus; createdAt: string; updatedAt: string;
  baseRevision: string | null; currentRevision: string | null; workingTreeFingerprint: string;
  changedFiles: string[]; addedFiles: string[]; modifiedFiles: string[]; deletedFiles: string[]; renamedFiles: string[]; untrackedFiles: string[]; conflictedFiles: string[];
  totalInsertions: number; totalDeletions: number;
  factoriesAffected: string[]; capabilitiesAffected: string[]; modulesAffected: string[]; routesAffected: string[]; workflowsAffected: string[]; governanceRulesAffected: string[];
  riskSummary: { level: string; reasons: string[]; numbers: Record<string, number> };
  reviewSummary: { totalFindings: number; blockingFindings: number; errorCount: number; warningCount: number; infoCount: number; checksRun: number; checksNotImplemented: number } | null;
  artifactIds: string[]; findings: ReviewFindingClient[]; diffFiles: DiffFileClient[]; impacts: FileImpactClient[]; stale: boolean;
}
type ChangeSetListResponse = { ok: true; changeSets: ChangeSetClient[] } | { ok: false; code: string; message: string };
type ChangeSetCreateResponse = { ok: true; changeSet: ChangeSetClient; jobId: string } | { ok: false; code: string; message: string };
type ChangeSetActionResponse = { ok: true; changeSet: ChangeSetClient } | { ok: false; code: string; message: string };
type ChangeSetDecisionResponse = { ok: true; changeSet: ChangeSetClient; decision: unknown } | { ok: false; code: string; message: string };

// ---- Test Pipeline & Quality Assurance Runtime (owner, 2026-08-06,
// Software Factory Step 8) — client types mirror testRuntime.ts's real
// shapes. ----
type TestResultStatus = "PASSED" | "FAILED" | "SKIPPED" | "NOT_IMPLEMENTED" | "CANCELLED";
type TestRunStatus = "RUNNING" | "PASSED" | "FAILED" | "BLOCKED" | "CANCELLED";
interface TestResultClient {
  id: string; suite: string; name: string; testTypeId: string; status: TestResultStatus; duration: number;
  evidence: string; artifacts: string[]; output: string; warnings: string[]; failures: string[]; blocking: boolean;
  factoryOwner: string | null; capability: string | null; moduleId: string | null; executionId: string | null;
  command: string | null; exitCode: number | null; checksum: string;
}
interface TestRunClient {
  testRunId: string; actor: string; sourceChangeSet: string | null; reviewId: string | null; queueJobId: string | null;
  executionId: string | null; artifactIds: string[]; startedAt: string; finishedAt: string | null; duration: number | null;
  status: TestRunStatus; totals: { total: number; passed: number; failed: number; skipped: number; notImplemented: number };
  passed: number; failed: number; skipped: number; notImplemented: number; stale: boolean; evidence: string;
  blockingReasons: string[]; suitesCovered: string[]; results: TestResultClient[];
}
type TestRunListResponse = { ok: true; testRuns: TestRunClient[] } | { ok: false; code: string; message: string };
type TestRunCreateResponse = { ok: true; testRun: TestRunClient; jobId: string } | { ok: false; code: string; message: string };

// ---- Real Build Pipeline & Reproducible Build Artifacts (owner,
// 2026-08-06, Software Factory Step 9) — client types mirror
// buildRuntime.ts's real shapes. ----
type BuildRunStatus = "REQUESTED" | "VALIDATING" | "BLOCKED" | "QUEUED" | "RUNNING" | "VERIFYING" | "SUCCEEDED" | "SUCCEEDED_WITH_WARNINGS" | "FAILED" | "TIMED_OUT" | "CANCELLED" | "INVALID" | "STALE" | "NOT_IMPLEMENTED";
interface BuildFindingClient {
  findingId: string; buildRunId: string; code: string; category: string; severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  blocking: boolean; message: string; file: string | null; line: number | null; column: number | null; source: string; createdAt: string;
}
interface OutputFileRecordClient {
  relativePath: string; type: string; size: number; checksum: string; mimeType: string; executable: boolean; status: string;
}
interface BuildManifestClient {
  manifestVersion: number; buildRunId: string; createdAt: string; sourceRevision: string | null; sourceFingerprint: string;
  lockfileHash: string | null; environmentProfile: string; nodeVersion: string; buildCommand: string; buildTypes: string[];
  routeCount: number; serverRouteCount: number; staticRouteCount: number; dynamicRouteCount: number;
  outputFileCount: number; outputBytes: number; warnings: number; limitations: string[];
  integrityStatus: string; reproducibilityStatus: string;
}
interface BuildRunClient {
  buildRunId: string; buildRequestId: string; actor: string; status: BuildRunStatus; buildTypeIds: string[];
  sourceChangeSetId: string; sourceReviewId: string; sourceTestRunId: string; queueJobId: string | null; executionIds: string[];
  environmentProfileId: string; sourceFingerprintBefore: string; sourceFingerprintAfter: string | null;
  workspaceFingerprintBefore: string; workspaceFingerprintAfter: string | null; dependencyLockHash: string | null;
  startedAt: string; finishedAt: string | null; durationMs: number | null; exitCode: number | null; timedOut: boolean; cancelled: boolean;
  outputDirectory: string; outputFiles: OutputFileRecordClient[]; outputBytes: number; artifactIds: string[]; evidenceIds: string[];
  warnings: BuildFindingClient[]; failures: BuildFindingClient[]; reproducibilityStatus: string; error: string | null;
  manifest: BuildManifestClient | null; staleForRelease: boolean; blockingReasons: string[];
  gateReport: GateReportClient | null; decision: BuildDecisionClient | null;
  migrationIntegrity: MigrationIntegrityClient | null; registryGateAnalysis: RegistryGateAnalysisClient | null;
}
// ---- Step 9.5 — Build Gate Integrity & Pre-Release Blocker Resolution
// (owner, 2026-08-07) — client types mirror buildRuntime.ts's real shapes. ----
interface GateResultClient { gate: string; status: "PASSED" | "FAILED" | "BLOCKED" | "UNKNOWN" | "NOT_IMPLEMENTED"; evidence: string }
interface GateReportClient { buildGateReportId: string; computedAt: string; gates: GateResultClient[]; overallStatus: "ALL_PASSED" | "BLOCKING_FAILURE" | "PARTIAL" }
interface BuildDecisionClient { buildDecisionId: string; decision: "ALLOWED" | "BLOCKED"; reasons: string[]; computedAt: string }
interface MigrationConflictClient { timestamp: string; files: string[] }
interface MigrationLineageEntryClient { table: string; events: { fileName: string; timestamp: string; action: string }[]; anomalies: string[] }
interface MigrationIntegrityClient {
  generatedAt: string; totalMigrations: number; ordering: string[]; orderingAnomalies: string[];
  conflicts: MigrationConflictClient[]; lineage: MigrationLineageEntryClient[]; dependencies: { from: string; to: string; reason: string }[];
}
interface RegistryGateAnalysisClient { flaggedFiles: string[]; falsePositives: string[]; genuineGaps: string[]; evidence: string }
type BuildRunListResponse = { ok: true; runs: BuildRunClient[] } | { ok: false; code: string; message: string };
type BuildRunCreateResponse = { ok: true; request: unknown; run: BuildRunClient } | { ok: false; code: string; message: string };
type BuildRunActionResponse = { ok: true; run: BuildRunClient } | { ok: false; code: string; message: string };
// client type mirrors buildRuntime.ts's real ReproducibilityComparison shape.
interface ReproducibilityComparisonClient {
  buildRunIdA: string; buildRunIdB: string; status: "VERIFIED" | "PARTIAL" | "NOT_VERIFIED" | "NOT_SUPPORTED" | "FAILED";
  comparableInputs: boolean; matchedFiles: number; mismatchedFiles: string[]; missingInA: string[]; missingInB: string[];
  normalizedDifferences: string[]; reasons: string[];
}

// ---- Release Pipeline, Capability Packaging & Operational Readiness
// (owner, 2026-08-07, Software Factory Step 10) — client types mirror
// releaseRuntime.ts's real shapes. ----
type ReleaseRunStatus = "REQUESTED" | "VALIDATING" | "BLOCKED" | "PACKAGING" | "APPROVING" | "READY" | "FAILED";
interface ReleaseValidationClient { valid: boolean; reasons: string[]; gates: GateResultClient[] }
interface CapabilityPackageClient {
  capabilityId: string; businessDomain: string; version: string; compatibility: string; countryPackageDependency: string;
  owner: string | null; lifecycle: string; status: string; dependencies: string[]; requiredRuntime: string | null; evidence: string;
}
interface PackageIntegrityClient { status: string; totalPackages: number; duplicateCapabilityIds: string[]; missingOwnerModules: string[]; findings: string[] }
interface ReadinessDimensionClient { dimension: string; status: string; evidence: string }
interface OperationalReadinessClient { computedAt: string; dimensions: ReadinessDimensionClient[]; overallStatus: string }
interface ReleaseDecisionClient { releaseDecisionId: string; decision: "ALLOWED" | "BLOCKED"; reasons: string[]; computedAt: string }
interface ReleaseCandidateClient { releaseCandidateId: string; buildRunId: string; createdAt: string; sourceRevision: string | null; sourceFingerprint: string }
interface ReleaseRunClient {
  releaseRunId: string; buildRunId: string; actor: string; status: ReleaseRunStatus; reason: string;
  startedAt: string; finishedAt: string | null; releaseCandidate: ReleaseCandidateClient | null;
  validation: ReleaseValidationClient | null; packages: CapabilityPackageClient[]; packageIntegrity: PackageIntegrityClient | null;
  decision: ReleaseDecisionClient | null; operationalReadiness: OperationalReadinessClient | null; artifactIds: string[]; error: string | null;
}
type ReleaseRunListResponse = { ok: true; runs: ReleaseRunClient[] } | { ok: false; code: string; message: string };
type ReleaseRunCreateResponse = { ok: true; run: ReleaseRunClient } | { ok: false; code: string; message: string };

type FsOpResponse = { ok: true; path: string; type: "file" | "directory" } | { ok: false; code: IdeErrorCode; message: string };
type TrashOpResponse = { ok: true; id: string; originalPath: string; itemType: "file" | "directory"; trashedAt: string } | { ok: false; code: IdeErrorCode; message: string };
type RestoreOpResponse = { ok: true; path: string } | { ok: false; code: IdeErrorCode; message: string };
interface TrashListEntry { id: string; originalPath: string; itemType: "file" | "directory"; trashedAt: string }
type TrashListResponse = { ok: true; entries: TrashListEntry[]; corrupt_count: number } | { ok: false; code: IdeErrorCode; message: string };

async function postIde<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return res.json().catch(() => ({ ok: false, code: "INTERNAL_ERROR", message: "invalid response" })) as Promise<T>;
}

async function fetchIde<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  return res.json().catch(() => ({ ok: false, code: "INTERNAL_ERROR", message: "invalid response" })) as Promise<T>;
}

type ToolId = "explorer" | "search" | "source-control" | "trash" | "runtime" | "ai" | "documents" | "settings";

const TOOLS: { id: ToolId; label: string; icon: React.ElementType }[] = [
  { id: "explorer", label: "Explorer", icon: FolderTree },
  { id: "search", label: "Search", icon: SearchIcon },
  { id: "source-control", label: "Source Control", icon: GitBranch },
  { id: "trash", label: "Trash", icon: Trash },
  { id: "runtime", label: "Runtime", icon: Activity },
  { id: "ai", label: "AI", icon: Bot },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

type BottomTabId = "problems" | "runtime-events" | "execution" | "queue" | "inspection" | "artifacts" | "ui-inspection" | "code-review" | "test" | "build" | "release" | "ai-execution" | "factory-completion" | "operations" | "factory-workspace" | "context";

// "Logs" and "Build Output" tabs were removed (owner, 2026-08-07,
// /admin/ide Foundation audit) — both were MOCK_LOGS/MOCK_BUILD_OUTPUT
// fixtures duplicating real data already shown elsewhere: real command
// output lives in Runtime Events (exec.execEventLog) and the real
// Execution tab; real build history lives in the real "Build" tab
// (BuildPanel, /api/admin/ide/build/runs). Keeping a second, fake copy
// of either would violate "ห้ามปลอมข้อมูล" — removed rather than faked.
const BOTTOM_TABS: { id: BottomTabId; label: string }[] = [
  { id: "problems", label: "Problems" },
  { id: "runtime-events", label: "Runtime Events" },
  { id: "execution", label: "Execution" },
  { id: "queue", label: "Queue" },
  { id: "inspection", label: "Inspection" },
  { id: "artifacts", label: "Artifacts" },
  { id: "ui-inspection", label: "UI Inspection" },
  { id: "code-review", label: "Code Review" },
  { id: "test", label: "Test" },
  { id: "build", label: "Build" },
  { id: "release", label: "Release" },
  { id: "ai-execution", label: "AI Execution" },
  { id: "factory-completion", label: "Factory Completion" },
  { id: "operations", label: "Operations" },
  { id: "factory-workspace", label: "Factory Workspace" },
  { id: "context", label: "Context" },
];

// ---- Production Queue (owner, 2026-08-06, Software Factory Step 3) —
// client mirrors of app/api/admin/ide/_lib/queueRuntime.ts's real types. ----
type JobType = "OPEN_FILE" | "SAVE_FILE" | "RUN_COMMAND" | "TYPE_CHECK" | "TEST" | "BUILD" | "CUSTOM";
type JobStatus = "QUEUED" | "READY" | "RUNNING" | "WAITING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "REJECTED";
interface Job {
  jobId: string; type: JobType; createdAt: string; startedAt: string | null; finishedAt: string | null;
  actor: string; source: "editor" | "terminal"; file: string | null; command: string | null;
  status: JobStatus; progress: number; factory: string; executionId: string | null;
  result: string | null; duration: number | null; error: string | null;
}
type QueueErrorCode = "JOB_NOT_FOUND" | "JOB_NOT_OWNED" | "JOB_TYPE_NOT_IMPLEMENTED" | "DUPLICATE_JOB" | "JOB_NOT_CANCELLABLE" | "JOB_NOT_RETRYABLE" | "INTERNAL_ERROR";
type QueueJobsResponse = { ok: true; jobs: Job[] } | { ok: false; code: QueueErrorCode; message: string };
type QueueJobResponse = { ok: true; job: Job } | { ok: false; code: QueueErrorCode; message: string };

// ---- Execution Runtime (owner, 2026-08-05, Phase 4) — client types
// mirroring app/api/admin/ide/_lib/executionRegistry.ts /
// executionRuntime.ts exactly. The client only ever sends a commandId +
// typed args; it never sees or sends an executable/argv. ----
type ExecutionErrorCode =
  | "INVALID_COMMAND" | "INVALID_ARGUMENT" | "COMMAND_NOT_ALLOWED" | "WORKSPACE_NOT_AVAILABLE"
  | "RUN_NOT_FOUND" | "RUN_NOT_OWNED" | "CONCURRENCY_LIMIT" | "COMMAND_BUSY" | "OUTPUT_LIMIT_REACHED"
  | "COMMAND_TIMEOUT" | "COMMAND_CANCELLED" | "EXECUTION_FAILED"
  | "COMMAND_DENIED" | "OWNER_CONFIRMATION_REQUIRED" | "WORKSPACE_POLICY_VIOLATION" | "PROCESS_START_FAILED"
  | "INTERNAL_ERROR";
type ExecMode = "READ_ONLY" | "WORKSPACE_WRITE";
interface ExecCommandMeta {
  id: string; label: string; description: string; category: string; eventCategory: string;
  mode: ExecMode; changesWorkspace: boolean; requiresOwnerConfirmation: boolean; evidenceSource: string; status: string;
}
type ExecCommandsResponse = { ok: true; commands: ExecCommandMeta[] } | { ok: false; code: ExecutionErrorCode; message: string };
type ExecRunStatus = "queued" | "running" | "passed" | "failed" | "cancelled" | "timed_out" | "output_limited";
interface ExecRunRecord {
  runId: string; commandId: string; actor: string; status: ExecRunStatus; startedAt: string | null; queuedAt: string;
  completedAt: string | null; durationMs: number | null; exitCode: number | null; signal: string | null;
  outputBytes: number; truncated: boolean; errorCode: string | null;
  workingDirectory: string; mode: ExecMode; changesWorkspace: boolean; ownerConfirmation: boolean;
  timedOut: boolean; cancelled: boolean; stdoutHash: string | null; stderrHash: string | null;
  workspaceChangedPaths: string[] | null; workspacePolicyViolation: boolean;
}
type ExecRunResponse = { ok: true; run: ExecRunRecord } | { ok: false; code: ExecutionErrorCode; message: string };
type ExecRunsResponse = { ok: true; runs: ExecRunRecord[] } | { ok: false; code: ExecutionErrorCode; message: string };
type ExecStartResponse = { ok: true; runId: string; commandId: string; status: ExecRunStatus; startedAt: string; workingDirectory: string; mode: ExecMode; actor: string } | { ok: false; code: ExecutionErrorCode; message: string };
type ExecEventType =
  | "run.queued" | "run.started" | "run.stdout" | "run.stderr"
  | "run.completed" | "run.failed" | "run.cancelled" | "run.timeout" | "run.output_limited";
interface ExecRunEvent { seq: number; type: ExecEventType; ts: string; stream?: "stdout" | "stderr"; text?: string }
interface ExecOutputLine { seq: number; stream: "stdout" | "stderr"; text: string }

// ---- Semantic Code Classification (owner, 2026-08-05) — client mirrors of
// app/api/admin/ide/_lib/classification.ts's real types. The client never
// decides a category/risk itself — it only ever renders what the server's
// evidence-based classifyFile() returned. ----
type CodeCategory = "CORE_LOGIC" | "AI" | "INTEGRATION" | "WORKFLOW" | "DATABASE" | "SECURITY" | "UI" | "CONFIGURATION" | "DOCUMENTATION" | "UNKNOWN";
type RiskLevel = "NORMAL" | "SENSITIVE" | "CRITICAL" | "LOCKED" | "UNKNOWN";
interface ClassificationInfo {
  category: CodeCategory; categoryLabel: string; capability: string | null; riskLevel: RiskLevel;
  evidence: string[]; requiredChecks: string[]; purposeTh: string | null;
}
interface ClassificationEntry { path: string; category: CodeCategory; categoryLabel: string; capability: string | null; riskLevel: RiskLevel; registered: boolean }
type ClassificationListResponse = { ok: true; entries: ClassificationEntry[] } | { ok: false; code: IdeErrorCode; message: string };

// Muted, low-saturation tones per spec ("โทนหม่น ไม่จัดจ้าน") — checked
// against the #1e1e1e/#252526 dark chrome for real contrast, not picked for
// vibrance. Distinct hue per category; CONFIGURATION/DOCUMENTATION/UNKNOWN
// aren't in the spec's example list but need a real color too, chosen to
// stay visually distinct from the 7 examples.
const CATEGORY_COLORS: Record<CodeCategory, string> = {
  CORE_LOGIC: "#c07575",
  AI: "#6fa87f",
  INTEGRATION: "#6f96b8",
  WORKFLOW: "#9482b8",
  DATABASE: "#c08f5f",
  SECURITY: "#b8a75f",
  UI: "#969696",
  CONFIGURATION: "#6ba3a0",
  DOCUMENTATION: "#7d8fae",
  UNKNOWN: "#5a5a5a",
};
const RISK_COLORS: Record<RiskLevel, string> = {
  NORMAL: "#5a5a5a", SENSITIVE: "#c9a94e", CRITICAL: "#c96a6a", LOCKED: "#8a5a5a", UNKNOWN: "#4a4a4a",
};
const RISK_LABELS_TH: Record<RiskLevel, string> = {
  NORMAL: "ปกติ", SENSITIVE: "ละเอียดอ่อน", CRITICAL: "วิกฤต", LOCKED: "ล็อก (อ่านอย่างเดียว)", UNKNOWN: "ไม่ทราบ",
};

function classificationTooltip(c: ClassificationInfo): string {
  const lines = [`${c.categoryLabel}${c.capability ? ` / ${c.capability}` : ""} · ${RISK_LABELS_TH[c.riskLevel]}`];
  if (c.purposeTh) lines.push(c.purposeTh);
  if (c.evidence.length > 0) lines.push(...c.evidence.map((e) => `• ${e}`));
  return lines.join("\n");
}

interface Tab {
  id: string;
  title: string;
  kind: "file" | "diff";
  path: string;
  staged?: boolean; // only meaningful for kind "diff"
}

// Per-file editor state (owner, 2026-08-05, Phase 2) — lives at page level,
// keyed by tab id, so switching tabs never loses in-progress edits (unlike
// the old read-only Editor, which just re-fetched on every tab switch).
// "dirty" is derived (content !== originalContent), never stored
// separately, so it can never drift out of sync with the actual buffer.
export interface FileTabState {
  content: string;
  originalContent: string;
  hash: string;
  modifiedAt: string;
  loading: boolean;
  error: string | null;
  conflict: { diskContent: string; diskHash: string; diskModifiedAt: string } | null;
  // Optional (owner, 2026-08-05, Semantic Code Classification) — absent on
  // states constructed before a real GET response arrives, so existing
  // FileTabState literals elsewhere (including scripts/ide-regression-
  // test.ts's fixtures) stay valid without every call site adding it.
  classification?: ClassificationInfo | null;
  // Optional (owner, 2026-08-06, Real Editor Write Path Step 1) — real
  // encoding/line-ending as detected server-side from the actual bytes on
  // disk, and the real wall-clock time of the last successful save (client-
  // side only, reset on reload). Same "absent on pre-GET states" reasoning
  // as classification above.
  encoding?: string;
  lineEnding?: "LF" | "CRLF" | "mixed";
  lastSavedAt?: string | null;
}
// Exported (checkpoint, 2026-08-05) purely so scripts/ide-regression-test.ts
// can import the real function instead of re-implementing dirty-detection
// logic — not a behavior change, still only called internally otherwise.
export function isDirty(state: FileTabState | undefined): boolean {
  return !!state && !state.loading && !state.error && state.content !== state.originalContent;
}

const LEFT_MIN = 180;
const LEFT_MAX = 480;
// Floating Bottom Console (owner, 2026-08-05) — collapsed is a fixed thin
// strip; expanded starts at 280px (within the 260-320px spec range) and can
// be dragged up to 45% of the editor column's real measured height (see
// onBottomResizeStart), never a static px ceiling, so it scales with the
// actual viewport instead of overflowing a short window.
const BOTTOM_COLLAPSED_HEIGHT = 32;
const BOTTOM_MIN = 200;
const BOTTOM_DEFAULT_HEIGHT = 280;
const BOTTOM_MAX_RATIO = 0.45;
const BOTTOM_MAX_FALLBACK = 520;

export default function IDEWorkspace() {
  // Single page-level state, per instruction — no separate hook file.
  const [activeTool, setActiveTool] = useState<ToolId>("explorer");
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [bottomTab, setBottomTab] = useState<BottomTabId>("problems");
  const [leftWidth, setLeftWidth] = useState(260);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [bottomHeight, setBottomHeight] = useState(BOTTOM_DEFAULT_HEIGHT);
  const [bottomCollapsed, setBottomCollapsed] = useState(true);
  // Measures the real editor column height so the console's drag-resize can
  // clamp to 45% of the ACTUAL available space (never a hardcoded px cap
  // that could exceed a short window).
  const editorColumnRef = useRef<HTMLDivElement>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState<"connecting" | "connected" | "error">("connecting");

  // Real git branch for TopBar/StatusBar (owner, 2026-08-07, /admin/ide
  // Foundation audit) — replaces a literal hardcoded "main" that never
  // reflected the real checked-out branch. Same real
  // /api/admin/ide/git/status route SourceControlPanel already uses.
  const [realBranch, setRealBranch] = useState<string | null>(null);
  useEffect(() => {
    fetchIde<GitStatusResponse>("/api/admin/ide/git/status").then((body) => {
      setRealBranch(body.ok ? body.branch : null);
    }).catch(() => setRealBranch(null));
  }, []);

  // Real Problems count for the status bar (owner, 2026-08-06, Step 4) —
  // sums ERROR/CRITICAL findings across real, non-stale Inspection Records.
  // Polls independently of the Problems tab's own panel so the badge stays
  // accurate even while that tab isn't the active one.
  const [problemsCount, setProblemsCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const body = await fetchIde<InspectionListResponse>("/api/admin/ide/inspection/list");
      if (cancelled || !body.ok) return;
      const count = body.inspections.filter((r) => !r.stale).reduce((sum, r) => sum + r.errorCount, 0);
      setProblemsCount(count);
    };
    void poll();
    const interval = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);
  const [refreshNonce, setRefreshNonce] = useState(0);
  // Per-file edit buffers (Phase 2) — keyed by tab id, survives tab
  // switches. Bumped after a save so Source Control / the Diff Viewer
  // re-fetch and reflect the new on-disk state.
  const [fileStates, setFileStates] = useState<Record<string, FileTabState>>({});
  const [gitRefreshNonce, setGitRefreshNonce] = useState(0);
  // Execution Runtime (Phase 4) — lifted to page level like fileStates/
  // gitRefreshNonce above, so switching bottom tabs never drops an
  // in-flight run or its output.
  const [execCommands, setExecCommands] = useState<ExecCommandMeta[]>([]);
  const [execSelectedCommandId, setExecSelectedCommandId] = useState<string | null>(null);
  const [execRuns, setExecRuns] = useState<Record<string, ExecRunRecord>>({});
  const [execOutputs, setExecOutputs] = useState<Record<string, ExecOutputLine[]>>({});
  const [execHistory, setExecHistory] = useState<string[]>([]); // runIds, most recent first
  const [execActiveRunId, setExecActiveRunId] = useState<string | null>(null);
  const [execEventLog, setExecEventLog] = useState<{ ts: string; text: string }[]>([]);
  const [execStartError, setExecStartError] = useState<string | null>(null);
  // Refs mirroring the latest state — read inside saveFile/saveAllDirty/
  // reloadFromDisk so those callbacks always see current data without
  // needing tabs/fileStates as useCallback deps (which would recreate them,
  // and racing awaits, on every keystroke).
  const fileStatesRef = useRef(fileStates);
  useEffect(() => { fileStatesRef.current = fileStates; }, [fileStates]);
  const tabsRef = useRef(tabs);
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);

  const openTab = useCallback((kind: "file", path: string, title: string) => {
    const id = `${kind}:${path}`;
    setTabs((prev) => (prev.find((t) => t.id === id) ? prev : [...prev, { id, title, kind, path }]));
    setActiveTabId(id);
    return id;
  }, []);

  // Loads a file's real content into fileStates — only if not already
  // loaded, so re-opening an already-open (possibly dirty) tab never
  // clobbers unsaved edits.
  const loadFileState = useCallback((tabId: string, path: string) => {
    setFileStates((prev) => {
      if (prev[tabId]) return prev;
      return { ...prev, [tabId]: { content: "", originalContent: "", hash: "", modifiedAt: "", loading: true, error: null, conflict: null } };
    });
    fetchIde<FileResponse>(`/api/admin/ide/file?path=${encodeURIComponent(path)}`).then((body) => {
      setFileStates((prev) => {
        // Someone already loaded/edited this tab (e.g. duplicate calls) —
        // never overwrite real content with a stale response.
        if (prev[tabId] && (prev[tabId].content !== "" || !prev[tabId].loading)) return prev;
        if (body.ok) {
          return { ...prev, [tabId]: { content: body.content, originalContent: body.content, hash: body.hash, modifiedAt: body.modified_at, loading: false, error: null, conflict: null, classification: body.classification, encoding: body.encoding, lineEnding: body.line_ending, lastSavedAt: null } };
        }
        return { ...prev, [tabId]: { content: "", originalContent: "", hash: "", modifiedAt: "", loading: false, error: `${body.code} — ${body.message}`, conflict: null } };
      });
    });
  }, []);

  const openFileTab = useCallback((path: string, title: string) => {
    const id = openTab("file", path, title);
    loadFileState(id, path);
  }, [openTab, loadFileState]);
  const openDiffTab = useCallback((path: string, staged: boolean) => {
    const id = `diff:${staged ? "staged" : "unstaged"}:${path}`;
    const title = `${path.split("/").pop() ?? path} (${staged ? "staged" : "unstaged"})`;
    setTabs((prev) => (prev.find((t) => t.id === id) ? prev : [...prev, { id, title, kind: "diff" as const, path, staged }]));
    setActiveTabId(id);
  }, []);

  const closeTab = useCallback((id: string) => {
    setFileStates((prev) => {
      if (isDirty(prev[id]) && !window.confirm("This file has unsaved changes. Close without saving?")) {
        return prev; // cancelled — tab stays open, state untouched
      }
      setTabs((prevTabs) => prevTabs.filter((t) => t.id !== id));
      setActiveTabId((cur) => (cur === id ? null : cur));
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const updateFileContent = useCallback((tabId: string, content: string) => {
    setFileStates((prev) => (prev[tabId] ? { ...prev, [tabId]: { ...prev[tabId], content } } : prev));
  }, []);

  // ---- Execution Runtime (Phase 4) ----
  const pushEventLog = useCallback((text: string) => {
    setExecEventLog((prev) => [...prev.slice(-199), { ts: new Date().toLocaleTimeString("th-TH"), text }]);
  }, []);

  const saveFile = useCallback(async (tabId: string, path: string): Promise<boolean> => {
    const state = fileStatesRef.current[tabId];
    if (!state || state.loading || state.content === state.originalContent) return true;

    // Defense in depth — the textarea is already readOnly for LOCKED files
    // (so content should never actually diverge from originalContent), but
    // this is the real, load-bearing gate: never even attempt the PUT.
    if (state.classification?.riskLevel === "LOCKED") {
      setFileStates((prev) => ({ ...prev, [tabId]: { ...state, error: "This file is classified LOCKED — read-only, cannot be saved." } }));
      return false;
    }
    // CRITICAL requires an explicit human acknowledgement before the write
    // is even attempted — real confirm(), not a silent pass-through.
    if (state.classification?.riskLevel === "CRITICAL") {
      const checks = state.classification.requiredChecks;
      const checksText = checks.length > 0 ? `\n\nSaving will trigger these required checks: ${checks.join(", ")}.` : "";
      if (!window.confirm(`"${path}" is classified CRITICAL.${checksText}\n\nSave anyway?`)) return false;
    }

    const res = await fetch("/api/admin/ide/file", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content: state.content, expectedHash: state.hash, expectedLastModified: state.modifiedAt }),
    });
    const result: FileWriteResponse = await res.json().catch(() => ({ ok: false, code: "INTERNAL_ERROR", message: "invalid response" }));
    if (result.ok) {
      setFileStates((prev) => ({ ...prev, [tabId]: { content: state.content, originalContent: state.content, hash: result.hash, modifiedAt: result.modified_at, loading: false, error: null, conflict: null, classification: state.classification, encoding: state.encoding, lineEnding: state.lineEnding, lastSavedAt: new Date().toISOString() } }));
      setGitRefreshNonce((n) => n + 1);
      if (result.triggered_checks.length > 0) {
        setExecRuns((prev) => {
          const next = { ...prev };
          for (const { commandId, runId } of result.triggered_checks) {
            next[runId] = {
              runId, commandId, actor: "", status: "queued", startedAt: null, queuedAt: new Date().toISOString(),
              completedAt: null, durationMs: null, exitCode: null, signal: null, outputBytes: 0, truncated: false, errorCode: null,
              workingDirectory: "", mode: "READ_ONLY", changesWorkspace: false, ownerConfirmation: false,
              timedOut: false, cancelled: false, stdoutHash: null, stderrHash: null, workspaceChangedPaths: null, workspacePolicyViolation: false,
            };
          }
          return next;
        });
        setExecHistory((prev) => [...result.triggered_checks.map((c) => c.runId), ...prev].slice(0, 50));
        pushEventLog(`Save of "${path}" (CRITICAL) triggered required check${result.triggered_checks.length === 1 ? "" : "s"}: ${result.triggered_checks.map((c) => c.commandId).join(", ")}`);
      }
      // Evidence chain (real, request-scoped — see file/route.ts) — surfaced
      // in Runtime Events so the user can see WHY the save behaved the way
      // it did (Classification → Risk → Required Checks → Execution
      // Runtime → Result), not just a bare success message.
      if (state.classification && state.classification.riskLevel !== "NORMAL") {
        pushEventLog(`Evidence chain for "${path}": ${result.evidence_chain.map((s) => `${s.stage}=${s.detail}`).join(" → ")}`);
      }
      return true;
    }
    if (result.code === "FILE_CONFLICT") {
      setFileStates((prev) => ({ ...prev, [tabId]: { ...state, conflict: { diskContent: result.disk_content, diskHash: result.disk_hash, diskModifiedAt: result.disk_modified_at } } }));
      return false;
    }
    setFileStates((prev) => ({ ...prev, [tabId]: { ...state, error: `${result.code} — ${result.message}` } }));
    return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveAllDirty = useCallback(async () => {
    for (const tab of tabsRef.current) {
      if (tab.kind === "file" && isDirty(fileStatesRef.current[tab.id])) {
        await saveFile(tab.id, tab.path);
      }
    }
  }, [saveFile]);

  const reloadFromDisk = useCallback((tabId: string, path: string) => {
    const state = fileStatesRef.current[tabId];
    if (isDirty(state) && !window.confirm("Discard unsaved changes and reload from disk?")) return;
    setFileStates((prev) => {
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
    loadFileState(tabId, path);
  }, [loadFileState]);

  // Conflict resolution actions (owner, 2026-08-05) — never silently pick
  // one side. "Reload from disk" discards local edits; "Keep current
  // unsaved" just clears the conflict banner so the user can re-save
  // (which re-checks the hash again for real, not a forced overwrite).
  const conflictReloadFromDisk = useCallback((tabId: string) => {
    setFileStates((prev) => {
      const c = prev[tabId]?.conflict;
      if (!c) return prev;
      return { ...prev, [tabId]: { content: c.diskContent, originalContent: c.diskContent, hash: c.diskHash, modifiedAt: c.diskModifiedAt, loading: false, error: null, conflict: null } };
    });
  }, []);
  const conflictKeepMine = useCallback((tabId: string) => {
    setFileStates((prev) => {
      const c = prev[tabId]?.conflict;
      if (!c) return prev;
      // Adopt the disk's hash/mtime as the new baseline-to-check-against,
      // but keep the user's edited content — the next Save will re-verify
      // against disk again for real (this doesn't silently overwrite it).
      return { ...prev, [tabId]: { ...prev[tabId], hash: c.diskHash, modifiedAt: c.diskModifiedAt, conflict: null } };
    });
  }, []);

  // ---- File/folder management (owner, 2026-08-05, Phase 3) — real
  // Create/Rename/Move/Trash/Restore, wired to app/api/admin/ide/fs/*. ----
  const [explorerRefreshNonce, setExplorerRefreshNonce] = useState(0);

  const refreshAfterFsOp = useCallback(() => {
    setExplorerRefreshNonce((n) => n + 1);
    setGitRefreshNonce((n) => n + 1);
  }, []);

  // Remap any open tab — and its fileStates entry — whose path was
  // affected by a rename/move: the item itself, or anything nested under a
  // moved directory.
  const remapTabPaths = useCallback((oldPath: string, newPath: string) => {
    setTabs((prevTabs) => prevTabs.map((t) => {
      if (t.kind !== "file") return t;
      if (t.path === oldPath) return { ...t, path: newPath, id: `file:${newPath}`, title: newPath.split("/").pop() ?? newPath };
      if (t.path.startsWith(`${oldPath}/`)) {
        const remapped = `${newPath}${t.path.slice(oldPath.length)}`;
        return { ...t, path: remapped, id: `file:${remapped}`, title: remapped.split("/").pop() ?? remapped };
      }
      return t;
    }));
    setFileStates((prev) => {
      const next: Record<string, FileTabState> = {};
      const oldId = `file:${oldPath}`;
      for (const [id, state] of Object.entries(prev)) {
        if (id === oldId) next[`file:${newPath}`] = state;
        else if (id.startsWith(`${oldId}/`)) next[`file:${newPath}${id.slice(oldId.length)}`] = state;
        else next[id] = state;
      }
      return next;
    });
    setActiveTabId((cur) => {
      if (!cur) return cur;
      const oldId = `file:${oldPath}`;
      if (cur === oldId) return `file:${newPath}`;
      if (cur.startsWith(`${oldId}/`)) return `file:${newPath}${cur.slice(oldId.length)}`;
      return cur;
    });
  }, []);

  // Closes any open tab(s) under a path that was just trashed — after the
  // user already confirmed the trash action itself.
  const closeTabsUnderPath = useCallback((targetPath: string) => {
    const toCloseIds = new Set(
      tabsRef.current.filter((t) => t.kind === "file" && (t.path === targetPath || t.path.startsWith(`${targetPath}/`))).map((t) => t.id)
    );
    if (toCloseIds.size === 0) return;
    setTabs((prev) => prev.filter((t) => !toCloseIds.has(t.id)));
    setFileStates((prev) => {
      const next = { ...prev };
      for (const id of toCloseIds) delete next[id];
      return next;
    });
    setActiveTabId((cur) => (cur && toCloseIds.has(cur) ? null : cur));
  }, []);

  const isPathOpenAndDirty = useCallback((targetPath: string): boolean => {
    return tabsRef.current.some((t) => {
      if (t.kind !== "file") return false;
      if (t.path !== targetPath && !t.path.startsWith(`${targetPath}/`)) return false;
      return isDirty(fileStatesRef.current[t.id]);
    });
  }, []);

  const doCreateFile = useCallback(async (dirPath: string, name: string) => {
    const targetPath = dirPath ? `${dirPath}/${name}` : name;
    const result = await postIde<FsOpResponse>("/api/admin/ide/fs/create", { path: targetPath, type: "file" });
    if (!result.ok) { window.alert(`Create file failed: ${result.code} — ${result.message}`); return; }
    refreshAfterFsOp();
  }, [refreshAfterFsOp]);

  const doCreateFolder = useCallback(async (dirPath: string, name: string) => {
    const targetPath = dirPath ? `${dirPath}/${name}` : name;
    const result = await postIde<FsOpResponse>("/api/admin/ide/fs/create", { path: targetPath, type: "folder" });
    if (!result.ok) { window.alert(`Create folder failed: ${result.code} — ${result.message}`); return; }
    refreshAfterFsOp();
  }, [refreshAfterFsOp]);

  const doRename = useCallback(async (targetPath: string, newName: string) => {
    if (isPathOpenAndDirty(targetPath)) { window.alert("This item has unsaved changes open — save or discard them first."); return; }
    const result = await postIde<FsOpResponse>("/api/admin/ide/fs/rename", { path: targetPath, newName });
    if (!result.ok) { window.alert(`Rename failed: ${result.code} — ${result.message}`); return; }
    remapTabPaths(targetPath, result.path);
    refreshAfterFsOp();
  }, [isPathOpenAndDirty, remapTabPaths, refreshAfterFsOp]);

  const doMove = useCallback(async (targetPath: string, destinationDir: string) => {
    if (isPathOpenAndDirty(targetPath)) { window.alert("This item has unsaved changes open — save or discard them first."); return; }
    const result = await postIde<FsOpResponse>("/api/admin/ide/fs/move", { path: targetPath, destinationDir });
    if (!result.ok) { window.alert(`Move failed: ${result.code} — ${result.message}`); return; }
    remapTabPaths(targetPath, result.path);
    refreshAfterFsOp();
  }, [isPathOpenAndDirty, remapTabPaths, refreshAfterFsOp]);

  const doTrash = useCallback(async (targetPath: string) => {
    if (isPathOpenAndDirty(targetPath)) { window.alert("This item has unsaved changes open — save or discard them first."); return; }
    if (!window.confirm(`Move "${targetPath}" to the workspace trash?`)) return;
    const result = await postIde<TrashOpResponse>("/api/admin/ide/fs/trash", { path: targetPath });
    if (!result.ok) { window.alert(`Move to trash failed: ${result.code} — ${result.message}`); return; }
    closeTabsUnderPath(targetPath);
    refreshAfterFsOp();
  }, [isPathOpenAndDirty, closeTabsUnderPath, refreshAfterFsOp]);

  const doRestore = useCallback(async (id: string) => {
    const result = await postIde<RestoreOpResponse>("/api/admin/ide/fs/restore", { id });
    if (!result.ok) { window.alert(`Restore failed: ${result.code} — ${result.message}`); return; }
    refreshAfterFsOp();
  }, [refreshAfterFsOp]);

  const doCopyRelativePath = useCallback((targetPath: string) => {
    navigator.clipboard?.writeText(targetPath).catch(() => {});
  }, []);

  useEffect(() => {
    fetchIde<ExecCommandsResponse>("/api/admin/ide/execution/commands").then((body) => {
      if (body.ok) {
        setExecCommands(body.commands);
        setExecSelectedCommandId((cur) => cur ?? body.commands[0]?.id ?? null);
      }
    });
    // Seed run history across a page refresh — real prior runs this
    // session's identity owns; output text itself is re-fetched from the
    // server's own event buffer when a run is selected (see the SSE effect
    // below), not reconstructed here.
    fetchIde<ExecRunsResponse>("/api/admin/ide/execution/runs").then((body) => {
      if (body.ok) {
        setExecRuns((prev) => {
          const next = { ...prev };
          for (const r of body.runs) next[r.runId] = r;
          return next;
        });
        setExecHistory(body.runs.map((r) => r.runId));
      }
    });
  }, []);

  const execStartRun = useCallback(async (commandId: string, meta: ExecCommandMeta | undefined) => {
    setExecStartError(null);
    // WORKSPACE_WRITE commands require a real, explicit human confirmation
    // before the request is even sent — the server independently enforces
    // this too (OWNER_CONFIRMATION_REQUIRED), this is just the UI half.
    let ownerConfirmation = false;
    if (meta?.requiresOwnerConfirmation) {
      const proceed = window.confirm(`"${meta.label}" changes the workspace (${meta.evidenceSource}).\n\nRun anyway?`);
      if (!proceed) return;
      ownerConfirmation = true;
    }
    const result = await postIde<ExecStartResponse>("/api/admin/ide/execution/run", { commandId, ownerConfirmation });
    if (!result.ok) {
      setExecStartError(`${result.code} — ${result.message}`);
      return;
    }
    setExecRuns((prev) => ({
      ...prev,
      [result.runId]: {
        runId: result.runId, commandId: result.commandId, actor: result.actor, status: result.status, startedAt: result.startedAt,
        queuedAt: result.startedAt, completedAt: null, durationMs: null, exitCode: null, signal: null,
        outputBytes: 0, truncated: false, errorCode: null, workingDirectory: result.workingDirectory, mode: result.mode,
        changesWorkspace: meta?.changesWorkspace ?? false, ownerConfirmation, timedOut: false, cancelled: false,
        stdoutHash: null, stderrHash: null, workspaceChangedPaths: null, workspacePolicyViolation: false,
      },
    }));
    setExecOutputs((prev) => ({ ...prev, [result.runId]: [] }));
    setExecHistory((prev) => [result.runId, ...prev].slice(0, 50));
    setExecActiveRunId(result.runId);
  }, []);

  const execRunsRef = useRef(execRuns);
  useEffect(() => { execRunsRef.current = execRuns; }, [execRuns]);

  const execCancelRun = useCallback(async (runId: string) => {
    await postIde<ExecRunResponse>(`/api/admin/ide/execution/cancel/${encodeURIComponent(runId)}`, {});
  }, []);

  const execClearDisplay = useCallback(() => {
    if (!execActiveRunId) return;
    setExecOutputs((prev) => ({ ...prev, [execActiveRunId]: [] }));
  }, [execActiveRunId]);

  // One live SSE connection to whichever run is currently selected —
  // replays that run's full real event history first (even for an older,
  // already-terminal run picked from history), then streams live events if
  // it's still active. Refetches the authoritative run record on any
  // terminal event, since duration/exitCode/outputBytes/truncated aren't
  // carried on the event itself.
  useEffect(() => {
    if (!execActiveRunId) return;
    const runId = execActiveRunId;
    const es = new EventSource(`/api/admin/ide/execution/stream/${encodeURIComponent(runId)}`);
    const seenSeqs = new Set<number>();

    es.onmessage = (msg) => {
      let event: ExecRunEvent;
      try { event = JSON.parse(msg.data); } catch { return; }
      if (seenSeqs.has(event.seq)) return;
      seenSeqs.add(event.seq);

      if (event.type === "run.stdout" || event.type === "run.stderr") {
        setExecOutputs((prev) => {
          const list = prev[runId] ?? [];
          return { ...prev, [runId]: [...list, { seq: event.seq, stream: event.stream!, text: event.text ?? "" }] };
        });
        return;
      }

      const commandId = execRunsRef.current[runId]?.commandId ?? runId;
      const labelByType: Partial<Record<ExecEventType, string>> = {
        "run.queued": "queued", "run.started": "started", "run.completed": "completed",
        "run.failed": "failed", "run.cancelled": "cancelled", "run.timeout": "timed out", "run.output_limited": "output limit reached",
      };
      pushEventLog(`${commandId} — ${labelByType[event.type] ?? event.type}`);

      const terminalTypes: ExecEventType[] = ["run.completed", "run.failed", "run.cancelled", "run.timeout", "run.output_limited"];
      if (event.type === "run.started") {
        setExecRuns((prev) => (prev[runId] ? { ...prev, [runId]: { ...prev[runId], status: "running" } } : prev));
      } else if (terminalTypes.includes(event.type)) {
        fetchIde<ExecRunResponse>(`/api/admin/ide/execution/run/${encodeURIComponent(runId)}`).then((body) => {
          if (body.ok) setExecRuns((prev) => ({ ...prev, [runId]: body.run }));
        });
      }
    };
    es.onerror = () => { es.close(); };
    return () => es.close();
  }, [execActiveRunId, pushEventLog]);

  // Search → Editor jump target (owner, 2026-08-05). Kept separate from Tab
  // state since it's a one-shot "scroll to + highlight this" instruction,
  // not part of the tab's identity — clicking the same result twice should
  // still re-scroll/re-highlight even though the tab was already open.
  const [activeHighlight, setActiveHighlight] = useState<{ tabId: string; line: number; column: number; matchLength: number } | null>(null);
  const openSearchResult = useCallback((relPath: string, line: number, column: number, matchLength: number) => {
    const title = relPath.split("/").pop() ?? relPath;
    openFileTab(relPath, title);
    setActiveHighlight({ tabId: `file:${relPath}`, line, column, matchLength });
  }, [openFileTab]);

  // Real check — confirms the workspace root actually loads via
  // /api/admin/ide/tree before claiming "Connected". Re-runs on Refresh.
  useEffect(() => {
    let cancelled = false;
    setWorkspaceStatus("connecting");
    fetchIde<TreeResponse>("/api/admin/ide/tree?path=").then((body) => {
      if (cancelled) return;
      setWorkspaceStatus(body.ok ? "connected" : "error");
    });
    return () => { cancelled = true; };
  }, [refreshNonce]);

  // Genuinely functional — re-checks the real workspace connection above,
  // not just a timestamp bump.
  const refresh = useCallback(() => {
    setLastRefreshedAt(new Date().toLocaleTimeString("th-TH"));
    setRefreshNonce((n) => n + 1);
  }, []);

  const activeTabObj = tabs.find((t) => t.id === activeTabId) ?? null;

  const leftResize = useResizeHandle({ axis: "x", value: leftWidth, setValue: setLeftWidth, min: LEFT_MIN, max: LEFT_MAX });

  // Console drag-resize — a bespoke handler (not the generic useResizeHandle
  // used for the left panel) because the max height must be measured live
  // against the real editor column, not a fixed constant: 45% of whatever
  // height is actually available right now.
  const bottomDragRef = useRef<{ startY: number; startHeight: number; maxHeight: number } | null>(null);
  const onBottomResizeStart = useCallback((e: React.MouseEvent) => {
    const containerH = editorColumnRef.current?.clientHeight ?? BOTTOM_MAX_FALLBACK / BOTTOM_MAX_RATIO;
    const maxHeight = Math.min(BOTTOM_MAX_FALLBACK, Math.round(containerH * BOTTOM_MAX_RATIO));
    bottomDragRef.current = { startY: e.clientY, startHeight: bottomHeight, maxHeight };
  }, [bottomHeight]);
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const drag = bottomDragRef.current;
      if (!drag) return;
      const delta = drag.startY - e.clientY; // dragging up increases height
      setBottomHeight(Math.min(drag.maxHeight, Math.max(BOTTOM_MIN, drag.startHeight + delta)));
    }
    function onUp() { bottomDragRef.current = null; }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // Clicking the already-active, already-expanded tab collapses the
  // console; clicking any tab while collapsed expands it to that tab.
  const handleSelectBottomTab = useCallback((tabId: BottomTabId) => {
    if (!bottomCollapsed && bottomTab === tabId) {
      setBottomCollapsed(true);
      return;
    }
    setBottomTab(tabId);
    setBottomCollapsed(false);
  }, [bottomCollapsed, bottomTab]);

  // Collapsed-bar status indicator — real state only, never a permanent
  // glow: lit while a process is actually running, or while collapsed
  // content the user hasn't looked at yet contains a real failure / new
  // runtime events. Acknowledgement resets whenever the console is
  // expanded (the user is now looking at it). Adjusting state during
  // render (React's own recommended pattern for "run this when a value
  // changes") instead of in an effect — the snapshot only needs to be
  // current by the next paint, never anything that requires running
  // after paint.
  const [consoleAck, setConsoleAck] = useState<{ eventLogLen: number; ackFailedRunId: string | null }>({ eventLogLen: 0, ackFailedRunId: null });
  const isExecRunning = Object.values(execRuns).some((r) => r.status === "queued" || r.status === "running");
  const mostRecentTerminalRun = execHistory.map((id) => execRuns[id]).find((r) => r && r.status !== "queued" && r.status !== "running") ?? null;
  const terminalFailureTypes: ExecRunStatus[] = ["failed", "timed_out", "output_limited"];
  const [prevBottomCollapsedForAck, setPrevBottomCollapsedForAck] = useState(bottomCollapsed);
  if (bottomCollapsed !== prevBottomCollapsedForAck) {
    setPrevBottomCollapsedForAck(bottomCollapsed);
    if (!bottomCollapsed) {
      setConsoleAck({ eventLogLen: execEventLog.length, ackFailedRunId: mostRecentTerminalRun?.runId ?? consoleAck.ackFailedRunId });
    }
  }
  const hasUnreadFailure = !!mostRecentTerminalRun && terminalFailureTypes.includes(mostRecentTerminalRun.status) && mostRecentTerminalRun.runId !== consoleAck.ackFailedRunId;
  const hasUnreadOutput = execEventLog.length > consoleAck.eventLogLen;

  // Find-within-file bar (owner, 2026-08-05, Phase 2) — one flag, only
  // meaningful while the active tab is a file; toggled by Cmd/Ctrl+F below.
  const [findBarOpen, setFindBarOpen] = useState(false);

  // Cmd/Ctrl+S (save active file), Cmd/Ctrl+F (toggle find-in-file), and
  // Cmd/Ctrl+J (toggle the bottom console) — preventDefault stops the
  // browser's own save-page/find/(no native binding for J) behavior.
  const activeTabRef = useRef(activeTabObj);
  useEffect(() => { activeTabRef.current = activeTabObj; }, [activeTabObj]);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const tab = activeTabRef.current;
      if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (tab && tab.kind === "file") void saveFile(tab.id, tab.path);
      } else if (e.key.toLowerCase() === "f") {
        if (tab && tab.kind === "file") {
          e.preventDefault();
          setFindBarOpen(true);
        }
      } else if (e.key.toLowerCase() === "j") {
        e.preventDefault();
        setBottomCollapsed((c) => !c);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveFile]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100%", overflow: "hidden", fontFamily: "system-ui, sans-serif", fontSize: 13, background: "#1e1e1e", color: "#d4d4d4" }}>
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          @keyframes dna-ide-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
        }
      `}</style>
      <TopBar onRefresh={refresh} lastRefreshedAt={lastRefreshedAt} workspaceStatus={workspaceStatus} realBranch={realBranch} />
      <CommandSurfaceBar />
      <div style={{ flex: 1, display: "flex", minHeight: 0, minWidth: 0 }}>
        <ActivityBar activeTool={activeTool} onSelect={setActiveTool} />
        {!leftCollapsed && (
          <>
            <div style={{ width: leftWidth, flexShrink: 0, minWidth: 0 }}>
              <LeftPanel
                tool={activeTool}
                onOpenFileTab={openFileTab}
                onOpenSearchResult={openSearchResult}
                onOpenDiffTab={openDiffTab}
                onCollapse={() => setLeftCollapsed(true)}
                gitRefreshNonce={gitRefreshNonce}
                explorerRefreshNonce={explorerRefreshNonce}
                onCreateFile={doCreateFile}
                onCreateFolder={doCreateFolder}
                onRename={doRename}
                onMove={doMove}
                onTrash={doTrash}
                onRestore={doRestore}
                onCopyRelativePath={doCopyRelativePath}
                onRefreshExplorer={refreshAfterFsOp}
                activeFilePath={activeTabObj?.path ?? null}
              />
            </div>
            <div onMouseDown={leftResize.onMouseDown} style={{ width: 4, cursor: "col-resize", flexShrink: 0, background: "#1e1e1e" }} />
          </>
        )}
        {leftCollapsed && (
          <button onClick={() => setLeftCollapsed(false)} title="Expand panel" style={{ width: 14, flexShrink: 0, background: "#252526", border: "none", borderRight: "1px solid #1e1e1e", color: "#858585", cursor: "pointer" }}>
            <ChevronRight size={12} />
          </button>
        )}
        <div ref={editorColumnRef} style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, position: "relative", overflow: "hidden" }}>
          <TabStrip tabs={tabs} activeTabId={activeTabId} onSelect={setActiveTabId} onClose={closeTab} dirtyTabIds={tabs.filter((t) => isDirty(fileStates[t.id])).map((t) => t.id)} fileStates={fileStates} />
          <EditorToolbar
            tab={activeTabObj}
            dirty={!!activeTabObj && isDirty(fileStates[activeTabObj.id])}
            anyDirty={tabs.some((t) => isDirty(fileStates[t.id]))}
            classification={activeTabObj ? fileStates[activeTabObj.id]?.classification : undefined}
            onSave={() => activeTabObj && saveFile(activeTabObj.id, activeTabObj.path)}
            onSaveAll={saveAllDirty}
            onReload={() => activeTabObj && reloadFromDisk(activeTabObj.id, activeTabObj.path)}
            onToggleFind={() => setFindBarOpen((v) => !v)}
          />
          <EditorPane
            tab={activeTabObj}
            highlight={activeTabObj && activeHighlight?.tabId === activeTabObj.id ? activeHighlight : null}
            fileState={activeTabObj ? fileStates[activeTabObj.id] : undefined}
            onChangeContent={updateFileContent}
            onConflictReload={conflictReloadFromDisk}
            onConflictKeepMine={conflictKeepMine}
            findBarOpen={findBarOpen}
            onCloseFindBar={() => setFindBarOpen(false)}
            gitRefreshNonce={gitRefreshNonce}
          />
          {/* Floating Bottom Console — position:absolute inside this
              position:relative column, so it overlays the Editor from below
              instead of pushing it (Editor keeps flex:1 of the FULL column
              height at all times, collapsed or expanded). */}
          <BottomPanel
            activeTab={bottomTab}
            onSelectTab={handleSelectBottomTab}
            height={bottomHeight}
            collapsed={bottomCollapsed}
            onToggleCollapse={() => setBottomCollapsed((c) => !c)}
            onResizeStart={onBottomResizeStart}
            isExecRunning={isExecRunning}
            hasUnreadFailure={hasUnreadFailure}
            hasUnreadOutput={hasUnreadOutput}
            onOpenFinding={(relPath, line, column) => openSearchResult(relPath, line, column, 1)}
            execCommands={execCommands}
            execSelectedCommandId={execSelectedCommandId}
            onExecSelectCommand={setExecSelectedCommandId}
            execRuns={execRuns}
            execOutputs={execOutputs}
            execHistory={execHistory}
            execActiveRunId={execActiveRunId}
            onExecSelectRun={setExecActiveRunId}
            execStartError={execStartError}
            onExecRun={execStartRun}
            onExecCancel={execCancelRun}
            onExecClear={execClearDisplay}
            execEventLog={execEventLog}
          />
        </div>
      </div>
      <StatusBar problemsCount={problemsCount} workspaceStatus={workspaceStatus} realBranch={realBranch} />
    </div>
  );
}

// ---- Resize handle (shared by left panel width + bottom panel height) ----
function useResizeHandle({ axis, value, setValue, min, max, invert }: {
  axis: "x" | "y"; value: number; setValue: (v: number) => void; min: number; max: number; invert?: boolean;
}) {
  const startRef = useRef<{ pos: number; value: number } | null>(null);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!startRef.current) return;
      const pos = axis === "x" ? e.clientX : e.clientY;
      const delta = pos - startRef.current.pos;
      const next = startRef.current.value + (invert ? -delta : delta);
      setValue(Math.min(max, Math.max(min, next)));
    }
    function onUp() {
      startRef.current = null;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [axis, min, max, invert, setValue]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    startRef.current = { pos: axis === "x" ? e.clientX : e.clientY, value };
  }, [axis, value]);

  return { onMouseDown };
}

// ---- Top bar: system status ----
function TopBar({ onRefresh, lastRefreshedAt, workspaceStatus, realBranch }: { onRefresh: () => void; lastRefreshedAt: string | null; workspaceStatus: "connecting" | "connected" | "error"; realBranch: string | null }) {
  return (
    <div style={{ height: 40, flexShrink: 0, display: "flex", alignItems: "center", gap: 14, padding: "0 12px", background: "#252526", borderBottom: "1px solid #1e1e1e" }}>
      <span style={{ fontWeight: 600, fontSize: 12.5 }}>DNA OS Workspace</span>
      <Divider />
      <StatusChip label="Repository" value="Not connected" tone="muted" />
      <StatusChip label="Branch" value={realBranch ?? "unknown"} tone={realBranch ? "info" : "muted"} />
      <StatusChip label="Mode" value="Read-only" tone="muted" />
      <StatusChip
        label="Workspace"
        value={workspaceStatus === "connected" ? "Connected" : workspaceStatus === "error" ? "Error" : "Connecting…"}
        tone={workspaceStatus === "connected" ? "ok" : workspaceStatus === "error" ? "error" : "muted"}
      />
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        {lastRefreshedAt && <span style={{ fontSize: 10.5, color: "#6a6a6a" }}>Refreshed {lastRefreshedAt}</span>}
        <button onClick={onRefresh} title="Refresh — re-checks the real workspace connection" style={topBtnStyle}>
          <RefreshCw size={13} /> Refresh
        </button>
        <button disabled title="Not connected — no Source Control Provider configured" style={{ ...topBtnStyle, opacity: 0.4, cursor: "not-allowed" }}>
          <FolderOpen size={13} /> Open workspace
        </button>
      </div>
    </div>
  );
}
const topBtnStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 5, background: "#2d2d2d", border: "1px solid #3a3a3a",
  color: "#ccc", borderRadius: 4, padding: "4px 9px", fontSize: 11.5, cursor: "pointer",
};
function Divider() {
  return <span style={{ width: 1, height: 18, background: "#3a3a3a" }} />;
}
function StatusChip({ label, value, tone }: { label: string; value: string; tone: "info" | "muted" | "ok" | "error" }) {
  const color = tone === "ok" ? "#4ec9b0" : tone === "error" ? "#f14c4c" : tone === "info" ? "#9cdcfe" : "#858585";
  return (
    <span style={{ fontSize: 11.5, color: "#858585" }}>
      {label}: <span style={{ color }}>{value}</span>
    </span>
  );
}

// ---- Owner Command Surface (owner, 2026-08-07, /admin/ide Foundation)
// — real, deterministic intent routing (commandSurfaceRuntime.ts), NOT a
// freeform chat UI. Recognized patterns only: "ทำ Step N", "เปิดไฟล์ X",
// "ตรวจปัญหาปัจจุบัน", "แก้ module X", "รันทดสอบ [name]", "ตรวจ
// architecture". Every invocation is a real, evidenced
// COMMAND_INVOCATION artifact — never a chat turn. ----
interface CommandResultClient {
  invocationId: string; rawText: string; intent: string; status: string; detail: string;
  stepGate: { step: string; allowed: boolean; reasons: string[] } | null;
  dispatchedJob: { jobId: string; type: string; status: string } | null;
  evidenceArtifactId: string | null;
}
const COMMAND_STATUS_COLORS: Record<string, string> = {
  RESOLVED: "#4ec9b0", DISPATCHED: "#4ec9b0", BLOCKED: "#f37c7c", OWNER_ACTION_REQUIRED: "#e0a860", UNRECOGNIZED: "#858585", FAILED: "#f37c7c",
};

interface AutoOrchestrationResultClient {
  session: WorkspaceSessionClient;
  outcome: "ANSWERED" | "AWAITING_APPROVAL" | "BLOCKED";
  answer: string | null;
  proposal: CodeWorkerProposalClient | null;
  blockedReason: string | null;
}
interface ResumeResultClient {
  session: WorkspaceSessionClient; proposal: CodeWorkerProposalClient;
  changeSet: { changeSetId: string; status: string } | null;
  testRun: { testRunId: string; status: string; totals: { total: number; passed: number; failed: number; skipped: number; notImplemented: number } } | null;
  blockedReason: string | null;
}
type OwnerCommandResponse =
  | { ok: true; mode: "FAST_PATH"; result: CommandResultClient }
  | { ok: true; mode: "AUTO_ORCHESTRATION"; orchestration: AutoOrchestrationResultClient }
  | { ok: false; code: string; message: string };

function orchestrationSteps(o: AutoOrchestrationResultClient): { label: string; reached: boolean }[] {
  const s = o.session;
  return [
    { label: "received", reached: true },
    { label: "intent analyzed", reached: !!s.intentId },
    { label: "capability matched", reached: !!s.capabilityResolution },
    { label: "read scope prepared", reached: !!s.contextPlanId },
    { label: "execution planned", reached: !!s.executionPlanId },
    { label: "asked AI", reached: !!o.proposal },
    { label: o.outcome === "AWAITING_APPROVAL" ? "awaiting approval" : o.outcome === "BLOCKED" ? "blocked" : "done", reached: !!o.outcome },
  ];
}

function CommandSurfaceBar() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CommandResultClient | null>(null);
  const [orchestration, setOrchestration] = useState<AutoOrchestrationResultClient | null>(null);
  const [resumeResult, setResumeResult] = useState<ResumeResultClient | null>(null);
  const [buildRun, setBuildRun] = useState<BuildRunClient | null>(null);
  const [buildBusy, setBuildBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const submit = useCallback(async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setResult(null); setOrchestration(null); setResumeResult(null); setBuildRun(null); setErrorMsg(null);
    try {
      const body = await postIde<OwnerCommandResponse>("/api/admin/ide/owner-command", { text: t });
      if (!body.ok) { setErrorMsg(`${body.code} — ${body.message}`); setOpen(true); }
      else if (body.mode === "FAST_PATH") { setResult(body.result); setOpen(true); }
      else { setOrchestration(body.orchestration); setOpen(true); }
      setText("");
    } finally {
      setBusy(false);
    }
  }, [text, busy]);

  const approveAndWrite = useCallback(async () => {
    if (!orchestration?.proposal) return;
    setBusy(true);
    try {
      const body = await postIde<({ ok: true } & ResumeResultClient) | { ok: false; code: string; message: string }>(
        "/api/admin/ide/owner-command/approve",
        { workspaceSessionId: orchestration.session.workspaceSessionId, proposalId: orchestration.proposal.proposalId }
      );
      if (!body.ok) { setErrorMsg(`${body.code} — ${body.message}`); return; }
      setResumeResult(body);
      if (!body.blockedReason) {
        setBuildBusy(true);
        const buildBody = await postIde<BuildRunCreateResponse>(
          "/api/admin/ide/build/runs",
          { buildTypeIds: ["NEXT_PRODUCTION_BUILD"], sourceChangeSetId: body.changeSet?.changeSetId, sourceReviewId: body.changeSet?.changeSetId, sourceTestRunId: body.testRun?.testRunId, environmentProfileId: "LOCAL_PRODUCTION_BUILD", reason: "Owner Command Surface auto-build", ownerConfirmation: true }
        );
        if (buildBody.ok) setBuildRun(buildBody.run); else setErrorMsg(`${buildBody.code} — ${buildBody.message}`);
        setBuildBusy(false);
      }
    } finally {
      setBusy(false);
    }
  }, [orchestration]);

  return (
    <div style={{ flexShrink: 0, background: "#1e1e1e", borderBottom: "1px solid #2d2d2d" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px" }}>
        <Bot size={14} color="#858585" />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
          placeholder='Owner Command — e.g. "ทำ Step 14", "ตรวจ architecture", "รันทดสอบ governance"'
          style={{ flex: 1, background: "#2d2d2d", border: "1px solid #3a3a3a", color: "#ccc", borderRadius: 4, padding: "5px 8px", fontSize: 12 }}
        />
        <button onClick={() => void submit()} disabled={busy || !text.trim()} style={{ ...topBtnStyle, opacity: busy || !text.trim() ? 0.4 : 1 }}>
          {busy ? "…" : "Run"}
        </button>
        {(result || orchestration || errorMsg) && <button onClick={() => setOpen((o) => !o)} style={topBtnStyle}>{open ? "Hide" : "Show"} last result</button>}
      </div>
      {open && errorMsg && (
        <div style={{ padding: "6px 12px 10px", fontSize: 11.5, color: "#f37c7c" }}>{errorMsg}</div>
      )}
      {open && result && (
        <div style={{ padding: "6px 12px 10px", fontSize: 11.5 }}>
          <div style={{ color: "#858585" }}>&quot;{result.rawText}&quot; → intent: <span style={{ color: "#9cdcfe" }}>{result.intent}</span>, status: <span style={{ color: COMMAND_STATUS_COLORS[result.status] ?? "#858585" }}>{result.status}</span></div>
          <div style={{ color: "#ccc", marginTop: 2 }}>{result.detail}</div>
          {result.stepGate && (
            <div style={{ color: result.stepGate.allowed ? "#8fd3a3" : "#e0a860", marginTop: 2 }}>
              Gate: Step {result.stepGate.step} — {result.stepGate.allowed ? "ALLOWED" : "BLOCKED"}
              {!result.stepGate.allowed && <ul style={{ margin: "2px 0 0 16px", padding: 0 }}>{result.stepGate.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
            </div>
          )}
          {result.dispatchedJob && <div style={{ color: "#6a6a6a", marginTop: 2 }}>Job: {result.dispatchedJob.jobId} ({result.dispatchedJob.type}, {result.dispatchedJob.status}) — see Execution/Queue tab</div>}
        </div>
      )}
      {open && orchestration && (
        <div style={{ padding: "6px 12px 10px", fontSize: 11.5 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
            {orchestrationSteps(orchestration).map((step, i) => (
              <span key={i} style={{ color: step.reached ? "#4ec9b0" : "#6a6a6a" }}>{step.reached ? "✓" : "○"} {step.label}</span>
            ))}
          </div>
          {orchestration.outcome === "ANSWERED" && orchestration.answer && (
            <div style={{ color: "#ccc", whiteSpace: "pre-wrap" }}>{orchestration.answer}</div>
          )}
          {orchestration.outcome === "BLOCKED" && (
            <div style={{ color: "#e0a860" }}>blocked: {orchestration.blockedReason}</div>
          )}
          {orchestration.outcome === "AWAITING_APPROVAL" && orchestration.proposal && !resumeResult && (
            <div>
              <div style={{ color: "#e0a860", marginBottom: 4 }}>real file change proposed — review the diff before approving</div>
              {orchestration.proposal.requiresDestructiveApproval && <div style={{ color: "#f0a0a0", marginBottom: 4 }}>includes a real DELETE/RENAME</div>}
              {orchestration.proposal.operations.map((op, i) => (
                <div key={i} style={{ border: "1px solid #2a2a2a", borderRadius: 3, padding: "4px 6px", marginBottom: 4 }}>
                  <div style={{ color: "#9cdcfe" }}>{op.operation} · {op.path}</div>
                  {op.content !== null && <pre style={{ margin: "4px 0 0", maxHeight: 160, overflow: "auto", color: "#ccc", fontSize: 10.5, whiteSpace: "pre-wrap" }}>{op.content}</pre>}
                </div>
              ))}
              <button disabled={busy} onClick={() => void approveAndWrite()} style={{ ...topBtnStyle, marginTop: 4 }}>Approve &amp; Write (real files)</button>
            </div>
          )}
          {resumeResult && (
            <div style={{ marginTop: 6 }}>
              {resumeResult.blockedReason ? (
                <div style={{ color: "#e0a860" }}>{resumeResult.blockedReason}</div>
              ) : (
                <div style={{ color: "#4ec9b0" }}>
                  written to real disk · Change Set: {resumeResult.changeSet?.status ?? "—"} · Test: {resumeResult.testRun ? `${resumeResult.testRun.totals.passed}/${resumeResult.testRun.totals.total} passed` : "—"}
                </div>
              )}
              {buildBusy && <div style={{ color: "#9cdcfe", marginTop: 2 }}>building (real, may take a few minutes)…</div>}
              {buildRun && (
                <div style={{ color: buildRun.gateReport?.overallStatus === "ALL_PASSED" ? "#4ec9b0" : "#e0a860", marginTop: 2 }}>
                  Build: {buildRun.status} · Gate: {buildRun.gateReport?.overallStatus ?? "—"}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Activity bar ----
function ActivityBar({ activeTool, onSelect }: { activeTool: ToolId; onSelect: (t: ToolId) => void }) {
  return (
    <div style={{ width: 52, background: "#252526", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 8, gap: 4, flexShrink: 0 }}>
      {TOOLS.map((t) => {
        const Icon = t.icon;
        const active = activeTool === t.id;
        return (
          <button
            key={t.id}
            title={t.label}
            onClick={() => onSelect(t.id)}
            style={{
              width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center",
              background: active ? "#37373d" : "transparent", border: "none", borderLeft: active ? "2px solid #fff" : "2px solid transparent",
              color: active ? "#fff" : "#858585", cursor: "pointer", borderRadius: 4,
            }}
          >
            <Icon size={20} />
          </button>
        );
      })}
    </div>
  );
}

// ---- Left panel ----
function LeftPanel({
  tool, onOpenFileTab, onOpenSearchResult, onOpenDiffTab, onCollapse, gitRefreshNonce,
  explorerRefreshNonce, onCreateFile, onCreateFolder, onRename, onMove, onTrash, onRestore, onCopyRelativePath, onRefreshExplorer,
  activeFilePath,
}: {
  tool: ToolId; onOpenFileTab: (path: string, title: string) => void;
  onOpenSearchResult: (relPath: string, line: number, column: number, matchLength: number) => void;
  onOpenDiffTab: (path: string, staged: boolean) => void; onCollapse: () => void; gitRefreshNonce: number;
  explorerRefreshNonce: number;
  onCreateFile: (dirPath: string, name: string) => void; onCreateFolder: (dirPath: string, name: string) => void;
  onRename: (path: string, newName: string) => void; onMove: (path: string, destinationDir: string) => void;
  onTrash: (path: string) => void; onRestore: (id: string) => void; onCopyRelativePath: (path: string) => void;
  onRefreshExplorer: () => void; activeFilePath: string | null;
}) {
  return (
    <div style={{ height: "100%", background: "#252526", borderRight: "1px solid #1e1e1e", overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "#bbb" }}>{TOOLS.find((t) => t.id === tool)?.label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {tool === "explorer" && (
            <>
              <button onClick={() => onCreateFile("", window.prompt("New file name (at workspace root):") ?? "")} title="New File" style={iconBtnStyle}><FilePlus size={13} /></button>
              <button onClick={() => onCreateFolder("", window.prompt("New folder name (at workspace root):") ?? "")} title="New Folder" style={iconBtnStyle}><FolderPlus size={13} /></button>
              <button onClick={onRefreshExplorer} title="Refresh Folder" style={iconBtnStyle}><RefreshCw size={12} /></button>
            </>
          )}
          <button onClick={onCollapse} title="Collapse panel" style={{ background: "none", border: "none", color: "#858585", cursor: "pointer", padding: 2 }}>
            <ChevronRight size={12} style={{ transform: "rotate(180deg)" }} />
          </button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {tool === "explorer" && (
          <ExplorerPanel
            onOpenTab={onOpenFileTab}
            refreshNonce={explorerRefreshNonce}
            onCreateFile={onCreateFile}
            onCreateFolder={onCreateFolder}
            onRename={onRename}
            onMove={onMove}
            onTrash={onTrash}
            onCopyRelativePath={onCopyRelativePath}
          />
        )}
        {tool === "search" && <SearchPanel onOpenResult={onOpenSearchResult} invalidateNonce={explorerRefreshNonce} />}
        {tool === "source-control" && <SourceControlPanel onOpenDiffTab={onOpenDiffTab} refreshNonce={gitRefreshNonce} activeFilePath={activeFilePath} />}
        {tool === "trash" && <TrashPanel refreshNonce={explorerRefreshNonce} onRestore={onRestore} />}
        {tool === "runtime" && <RuntimePanel />}
        {tool === "ai" && <AiPanel />}
        {tool === "documents" && <DocumentsPanel onOpenTab={onOpenFileTab} />}
        {tool === "settings" && <SettingsPanel />}
      </div>
    </div>
  );
}

// ---- Explorer — real workspace tree, lazy per-folder (app/api/admin/ide/tree) ----
interface ExplorerOps {
  onCreateFile: (dirPath: string, name: string) => void;
  onCreateFolder: (dirPath: string, name: string) => void;
  onRename: (path: string, newName: string) => void;
  onMove: (path: string, destinationDir: string) => void;
  onTrash: (path: string) => void;
  onCopyRelativePath: (path: string) => void;
}

/** Fetches real classification for every FILE directly inside `dirPath` —
 * mirrors the tree endpoint's own one-level-at-a-time shape, called
 * alongside it (never blocking the tree render on it; dots simply appear a
 * beat later once classification resolves). */
async function fetchClassificationMap(dirPath: string): Promise<Record<string, ClassificationEntry>> {
  const body = await fetchIde<ClassificationListResponse>(`/api/admin/ide/classification?path=${encodeURIComponent(dirPath)}`);
  if (!body.ok) return {};
  const map: Record<string, ClassificationEntry> = {};
  for (const e of body.entries) map[e.path] = e;
  return map;
}

function ExplorerPanel({ onOpenTab, refreshNonce, onCreateFile, onCreateFolder, onRename, onMove, onTrash, onCopyRelativePath }: {
  onOpenTab: (path: string, title: string) => void; refreshNonce: number;
} & ExplorerOps) {
  const [entries, setEntries] = useState<TreeEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [classification, setClassification] = useState<Record<string, ClassificationEntry>>({});
  const ops: ExplorerOps = { onCreateFile, onCreateFolder, onRename, onMove, onTrash, onCopyRelativePath };

  useEffect(() => {
    let cancelled = false;
    fetchIde<TreeResponse>("/api/admin/ide/tree?path=").then((body) => {
      if (cancelled) return;
      if (body.ok) setEntries(body.entries);
      else setError(body.message);
    });
    fetchClassificationMap("").then((map) => { if (!cancelled) setClassification(map); });
    return () => { cancelled = true; };
  }, [refreshNonce]);

  if (error) return <SidebarMessage text={`Error: ${error}`} />;
  if (!entries) return <SidebarMessage text="Loading…" />;
  return (
    <div style={{ padding: "0 4px" }}>
      {entries.map((node) => (
        <TreeNode key={node.path} node={node} depth={0} onOpenTab={onOpenTab} refreshNonce={refreshNonce} classification={classification[node.path]} {...ops} />
      ))}
    </div>
  );
}

function TreeNode({ node, depth, onOpenTab, refreshNonce, classification, onCreateFile, onCreateFolder, onRename, onMove, onTrash, onCopyRelativePath }: {
  node: TreeEntry; depth: number; onOpenTab: (path: string, title: string) => void; refreshNonce: number;
  classification: ClassificationEntry | undefined;
} & ExplorerOps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<TreeEntry[] | null>(null);
  const [childClassification, setChildClassification] = useState<Record<string, ClassificationEntry>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hovering, setHovering] = useState(false);
  const Icon = node.type === "directory" ? Folder : File;

  const loadChildren = useCallback(async () => {
    setLoading(true);
    setError(null);
    const body = await fetchIde<TreeResponse>(`/api/admin/ide/tree?path=${encodeURIComponent(node.path)}`);
    setLoading(false);
    if (body.ok) setChildren(body.entries);
    else setError(body.message);
    fetchClassificationMap(node.path).then(setChildClassification);
  }, [node.path]);

  // A rename/create/trash/move anywhere re-fetches this node's children if
  // it's already expanded — keeps an open folder's listing honest without
  // requiring the user to manually collapse/re-expand it.
  useEffect(() => {
    if (expanded) void loadChildren();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshNonce]);

  const onClick = async () => {
    if (node.type === "file") {
      onOpenTab(node.path, node.name);
      return;
    }
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (children === null) void loadChildren();
  };

  const ops: ExplorerOps = { onCreateFile, onCreateFolder, onRename, onMove, onTrash, onCopyRelativePath };

  return (
    <div>
      <div
        onClick={onClick}
        onMouseEnter={(e) => { setHovering(true); e.currentTarget.style.background = "#2a2d2e"; }}
        onMouseLeave={(e) => { setHovering(false); e.currentTarget.style.background = "transparent"; }}
        style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 4px", paddingLeft: 8 + depth * 12, cursor: "pointer", borderRadius: 3, fontSize: 12.5 }}
      >
        {node.type === "directory" ? (expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span style={{ width: 12 }} />}
        <Icon size={13} />
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>{node.name}</span>
        {node.type === "file" && classification && (
          <span
            title={`${classification.categoryLabel}${classification.capability ? ` / ${classification.capability}` : ""} · ${RISK_LABELS_TH[classification.riskLevel]}`}
            style={{
              width: 6, height: 6, borderRadius: 3, flexShrink: 0, background: CATEGORY_COLORS[classification.category],
              boxShadow: classification.riskLevel === "CRITICAL" || classification.riskLevel === "LOCKED" ? `0 0 0 1.5px ${RISK_COLORS[classification.riskLevel]}` : undefined,
            }}
          />
        )}
        {hovering && (
          <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
            {node.type === "directory" && (
              <>
                <button title="New File here" style={rowIconBtnStyle} onClick={() => onCreateFile(node.path, window.prompt("New file name:") ?? "")}><FilePlus size={11} /></button>
                <button title="New Folder here" style={rowIconBtnStyle} onClick={() => onCreateFolder(node.path, window.prompt("New folder name:") ?? "")}><FolderPlus size={11} /></button>
              </>
            )}
            <button title="Rename" style={rowIconBtnStyle} onClick={() => { const n = window.prompt("New name:", node.name); if (n) onRename(node.path, n); }}><Pencil size={11} /></button>
            <button title="Move to…" style={rowIconBtnStyle} onClick={() => { const d = window.prompt("Move to directory (relative path, empty for root):", ""); if (d !== null) onMove(node.path, d); }}><FolderInput size={11} /></button>
            <button title="Copy Relative Path" style={rowIconBtnStyle} onClick={() => onCopyRelativePath(node.path)}><Copy size={11} /></button>
            <button title="Move to Trash" style={rowIconBtnStyle} onClick={() => onTrash(node.path)}><Trash2 size={11} /></button>
          </div>
        )}
      </div>
      {expanded && (
        <div>
          {loading && <div style={{ paddingLeft: 20 + depth * 12, fontSize: 11.5, color: "#858585" }}>Loading…</div>}
          {error && <div style={{ paddingLeft: 20 + depth * 12, fontSize: 11.5, color: "#f14c4c" }}>Error: {error}</div>}
          {children?.map((c) => <TreeNode key={c.path} node={c} depth={depth + 1} onOpenTab={onOpenTab} refreshNonce={refreshNonce} classification={childClassification[c.path]} {...ops} />)}
        </div>
      )}
    </div>
  );
}
const iconBtnStyle: React.CSSProperties = { background: "none", border: "none", color: "#858585", cursor: "pointer", padding: 3, display: "flex" };
const rowIconBtnStyle: React.CSSProperties = { background: "none", border: "none", color: "#aaa", cursor: "pointer", padding: 2, display: "flex" };

// ---- Search — real, read-only text search across the workspace via
// GET /api/admin/ide/search (owner, 2026-08-05). Runs only on Enter or the
// Search button — no per-keystroke debounce/auto-search. A new search
// cancels any still-in-flight previous one via AbortController. ----
type SearchState = "idle" | "loading" | "done" | "error";
function SearchPanel({ onOpenResult, invalidateNonce }: { onOpenResult: (relPath: string, line: number, column: number, matchLength: number) => void; invalidateNonce: number }) {
  const [q, setQ] = useState("");
  const [state, setState] = useState<SearchState>("idle");
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ truncated: boolean; reason: string | null; durationMs: number; filesScanned: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // A create/rename/move/trash op elsewhere means any stale search results
  // may point at paths that no longer exist — invalidate rather than risk
  // opening a dead path. Adjusting state during render (React's own
  // recommended pattern for "run this when a prop changes") instead of
  // in an effect — nothing here needs to run after paint.
  const [prevInvalidateNonce, setPrevInvalidateNonce] = useState(invalidateNonce);
  if (prevInvalidateNonce !== invalidateNonce) {
    setPrevInvalidateNonce(invalidateNonce);
    setResults([]);
    setSummary(null);
    if (state === "done") setState("idle");
  }

  const runSearch = useCallback(async () => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setState("error");
      setErrorMsg("Type at least 2 characters");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState("loading");
    setErrorMsg(null);
    try {
      const body = await fetchIde<SearchResponse>(`/api/admin/ide/search?q=${encodeURIComponent(trimmed)}`, controller.signal);
      if (!body.ok) {
        setState("error");
        setErrorMsg(`${body.code} — ${body.message}`);
        return;
      }
      setResults(body.results);
      setSummary({ truncated: body.truncated, reason: body.truncation_reason, durationMs: body.duration_ms, filesScanned: body.files_scanned });
      setState("done");
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setState("error");
      setErrorMsg("Search failed unexpectedly");
    }
  }, [q]);

  const grouped = useMemo(() => {
    const map = new Map<string, SearchMatch[]>();
    for (const r of results) {
      const list = map.get(r.relativePath) ?? [];
      list.push(r);
      map.set(r.relativePath, list);
    }
    return Array.from(map.entries());
  }, [results]);

  return (
    <div style={{ padding: 8, display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
          placeholder="Search workspace… (min 2 chars)"
          style={{ flex: 1, minWidth: 0, boxSizing: "border-box", background: "#3c3c3c", border: "1px solid #4a4a4a", color: "#ccc", borderRadius: 3, padding: "5px 8px", fontSize: 12 }}
        />
        <button onClick={runSearch} style={{ ...topBtnStyle, padding: "4px 10px" }}>Search</button>
      </div>

      {state === "loading" && <div style={{ marginTop: 8, fontSize: 11.5, color: "#858585" }}>Searching…</div>}
      {state === "error" && <div style={{ marginTop: 8, fontSize: 11.5, color: "#f14c4c" }}>{errorMsg}</div>}
      {state === "done" && (
        <div style={{ marginTop: 8, fontSize: 10.5, color: "#858585", flexShrink: 0 }}>
          {results.length} result{results.length === 1 ? "" : "s"} in {grouped.length} file{grouped.length === 1 ? "" : "s"}
          {summary && ` · ${summary.durationMs}ms · ${summary.filesScanned} files scanned`}
          {summary?.truncated && <div style={{ color: "#f0a020", marginTop: 2 }}>Stopped early ({summary.reason === "SEARCH_TIMEOUT" ? "time limit" : "result limit"} reached) — results may be incomplete.</div>}
        </div>
      )}
      {state === "done" && results.length === 0 && <SidebarMessage text="No matches" />}

      <div style={{ marginTop: 6, flex: 1, minHeight: 0, overflowY: "auto" }}>
        {grouped.map(([relPath, matches]) => (
          <div key={relPath} style={{ marginBottom: 4 }}>
            <div style={{ padding: "3px 4px", fontSize: 11.5, fontWeight: 600, color: "#ccc", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {relPath} <span style={{ color: "#858585", fontWeight: 400 }}>({matches.length})</span>
            </div>
            {matches.map((m, i) => (
              <div
                key={i}
                onClick={() => onOpenResult(m.relativePath, m.line, m.column, m.matchLength)}
                style={{ padding: "2px 4px 2px 14px", fontSize: 11.5, color: "#aaa", cursor: "pointer", fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#2a2d2e")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span style={{ color: "#6a9955" }}>{m.line}:</span> {m.preview}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Trash panel — lists items currently parked in .dnaos-trash via
// GET /api/admin/ide/fs/trash and lets the user restore them to their
// original relative path (owner, 2026-08-05, Phase 3). Never shows
// absolute paths or trashed-storage internals — only what the server's
// listTrash() already redacts down to. ----
function TrashPanel({ refreshNonce, onRestore }: { refreshNonce: number; onRestore: (id: string) => void }) {
  const [entries, setEntries] = useState<TrashListEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [corruptCount, setCorruptCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchIde<TrashListResponse>("/api/admin/ide/fs/trash").then((body) => {
      if (cancelled) return;
      if (body.ok) {
        setEntries(body.entries);
        setCorruptCount(body.corrupt_count ?? 0);
        setError(null);
      } else {
        setError(body.message);
      }
    });
    return () => { cancelled = true; };
  }, [refreshNonce]);

  if (error) return <SidebarMessage text={`Error: ${error}`} />;
  if (!entries) return <SidebarMessage text="Loading…" />;
  if (entries.length === 0 && corruptCount === 0) return <SidebarMessage text="Trash is empty" />;

  return (
    <div style={{ padding: 6 }}>
      {corruptCount > 0 && (
        <div style={{ fontSize: 11, color: "#f0a020", padding: "4px 6px", marginBottom: 6 }}>
          {corruptCount} trash entr{corruptCount === 1 ? "y" : "ies"} could not be read (CORRUPT_TRASH_ENTRY) and {corruptCount === 1 ? "is" : "are"} hidden.
        </div>
      )}
      {entries.map((e) => {
        const Icon = e.itemType === "directory" ? Folder : File;
        return (
          <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 6px", borderRadius: 3, fontSize: 12 }}>
            <Icon size={13} style={{ flexShrink: 0, color: "#858585" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "#ccc" }}>{e.originalPath}</div>
              <div style={{ fontSize: 10.5, color: "#858585" }}>{new Date(e.trashedAt).toLocaleString()}</div>
            </div>
            <button title="Restore" style={rowIconBtnStyle} onClick={() => onRestore(e.id)}><RotateCcw size={13} /></button>
          </div>
        );
      })}
    </div>
  );
}

// ---- Source Control (no real provider yet) ----
const KIND_LABEL: Record<ChangeKind, string> = {
  added: "A", modified: "M", deleted: "D", renamed: "R", copied: "C", untracked: "U",
};
const KIND_COLOR: Record<ChangeKind, string> = {
  added: "#4ec9b0", modified: "#cca700", deleted: "#f14c4c", renamed: "#9cdcfe", copied: "#9cdcfe", untracked: "#858585",
};

function ChangedFileRow({ file, staged, onOpenDiffTab }: { file: ChangedFile; staged: boolean; onOpenDiffTab: (path: string, staged: boolean) => void }) {
  return (
    <div
      onClick={() => onOpenDiffTab(file.path, staged)}
      style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 12px", fontSize: 12, cursor: "pointer" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#2a2d2e")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span style={{ width: 14, textAlign: "center", fontWeight: 700, color: KIND_COLOR[file.kind] }}>{KIND_LABEL[file.kind]}</span>
      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "#ccc" }}>
        {file.path}{file.renamedFrom ? ` ← ${file.renamedFrom}` : ""}
      </span>
    </div>
  );
}

// ---- Source Control — real, read-only git status (owner, 2026-08-05,
// Phase 1). No commit/push/pull/checkout/merge here — every write action
// stays disabled with an honest reason, not "Not connected" (the provider
// IS connected; these actions just aren't implemented in this phase). ----
type SourceControlSubTab = "changes" | "branches" | "tags" | "history" | "merge";
const SOURCE_CONTROL_SUB_TABS: { id: SourceControlSubTab; label: string }[] = [
  { id: "changes", label: "Changes" }, { id: "branches", label: "Branches" }, { id: "tags", label: "Tags" },
  { id: "history", label: "History" }, { id: "merge", label: "Merge" },
];

function SourceControlPanel({ onOpenDiffTab, refreshNonce, activeFilePath }: { onOpenDiffTab: (path: string, staged: boolean) => void; refreshNonce: number; activeFilePath: string | null }) {
  const [subTab, setSubTab] = useState<SourceControlSubTab>("changes");
  const [status, setStatus] = useState<GitStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchIde<GitStatusResponse>("/api/admin/ide/git/status").then((body) => {
      if (body.ok) setStatus(body);
      else setError(`${body.code} — ${body.message}`);
    });
  }, []);
  useEffect(() => { load(); }, [load, refreshNonce]);

  if (error) return <SidebarMessage text={`Error: ${error}`} />;
  if (!status || !status.ok) return <SidebarMessage text="Loading…" />;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ padding: "8px 12px", fontSize: 11.5, flexShrink: 0, borderBottom: "1px solid #333" }}>
        <div style={{ color: "#ccc" }}>{status.repositoryRoot} <span style={{ color: "#858585" }}>· {status.branch ?? "(detached)"}</span></div>
        {status.headCommit && (
          <div style={{ color: "#858585", marginTop: 3, fontSize: 11 }}>
            <span style={{ fontFamily: "ui-monospace, monospace" }}>{status.headCommit.hash.slice(0, 7)}</span> {status.headCommit.message}
            <div>{status.headCommit.author} · {new Date(status.headCommit.time).toLocaleString()}</div>
          </div>
        )}
        <div style={{ marginTop: 4, display: "flex", gap: 10, fontSize: 11 }}>
          <span style={{ color: status.clean ? "#4ec9b0" : "#f0a020" }}>{status.clean ? "Clean" : "Dirty"}</span>
          {status.hasUpstream && <span style={{ color: "#858585" }}>↑{status.ahead} ↓{status.behind}</span>}
          {status.conflicted.length > 0 && <span style={{ color: "#f37c7c" }}>{status.conflicted.length} conflicted</span>}
        </div>
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid #333", flexShrink: 0 }}>
        {SOURCE_CONTROL_SUB_TABS.map((t) => (
          <div
            key={t.id} onClick={() => setSubTab(t.id)}
            style={{ padding: "5px 9px", fontSize: 10.5, cursor: "pointer", color: subTab === t.id ? "#fff" : "#969696", borderBottom: subTab === t.id ? "1px solid #4da6ff" : "1px solid transparent" }}
          >
            {t.label}{t.id === "merge" && status.conflicted.length > 0 ? ` (${status.conflicted.length})` : ""}
          </div>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {subTab === "changes" && (
          <>
            <div style={{ padding: "6px 12px 2px", fontSize: 10, textTransform: "uppercase", color: "#858585" }}>Staged ({status.staged.length})</div>
            {status.staged.map((f) => <ChangedFileRow key={`s:${f.path}`} file={f} staged onOpenDiffTab={onOpenDiffTab} />)}
            <div style={{ padding: "6px 12px 2px", fontSize: 10, textTransform: "uppercase", color: "#858585" }}>Unstaged ({status.unstaged.length})</div>
            {status.unstaged.map((f) => <ChangedFileRow key={`u:${f.path}`} file={f} staged={false} onOpenDiffTab={onOpenDiffTab} />)}
            <div style={{ padding: "6px 12px 2px", fontSize: 10, textTransform: "uppercase", color: "#858585" }}>Untracked ({status.untracked.length})</div>
            {status.untracked.map((f) => <ChangedFileRow key={`t:${f.path}`} file={f} staged={false} onOpenDiffTab={onOpenDiffTab} />)}
            {status.clean && status.staged.length === 0 && status.unstaged.length === 0 && status.untracked.length === 0 && (
              <div style={{ padding: "4px 12px", fontSize: 11.5, color: "#858585" }}>No changes</div>
            )}
          </>
        )}
        {subTab === "branches" && <BranchesSubPanel />}
        {subTab === "tags" && <TagsSubPanel />}
        {subTab === "history" && <HistorySubPanel activeFilePath={activeFilePath} />}
        {subTab === "merge" && <MergeSubPanel refreshNonce={refreshNonce} />}
      </div>

      <div style={{ padding: 10, borderTop: "1px solid #333", flexShrink: 0 }}>
        <div style={{ fontSize: 10, color: "#6a6a6a", marginBottom: 6 }}>Read Only — Source Control Workspace (Step 6)</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {["Commit", "Push", "Pull"].map((label) => (
            <button key={label} disabled title="Read-only phase — not available yet" style={disabledBtnStyle}>{label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function BranchesSubPanel() {
  const [branches, setBranches] = useState<BranchInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchIde<GitBranchesResponse>("/api/admin/ide/git/branches").then((body) => {
      if (body.ok) setBranches(body.branches); else setError(`${body.code} — ${body.message}`);
    });
  }, []);
  if (error) return <SidebarMessage text={`Error: ${error}`} />;
  if (!branches) return <SidebarMessage text="Loading…" />;
  return (
    <div style={{ fontSize: 11.5 }}>
      {branches.map((b) => (
        <div key={b.name} style={{ padding: "5px 12px", borderBottom: "1px solid #232323" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {b.current && <span style={{ color: "#4ec9b0" }}>●</span>}
            <span style={{ color: b.remote ? "#858585" : "#ccc", fontFamily: "ui-monospace, monospace" }}>{b.name}</span>
            {b.upstream && <span style={{ color: "#6a6a6a", fontSize: 10 }}>→ {b.upstream}</span>}
          </div>
          {b.lastCommitSubject && (
            <div style={{ color: "#858585", fontSize: 10.5, marginTop: 2 }}>
              <span style={{ fontFamily: "ui-monospace, monospace" }}>{b.lastCommitHash}</span> {b.lastCommitSubject}
            </div>
          )}
        </div>
      ))}
      {branches.length === 0 && <div style={{ padding: 12, color: "#6a6a6a" }}>No branches.</div>}
    </div>
  );
}

function TagsSubPanel() {
  const [tags, setTags] = useState<TagInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchIde<GitTagsResponse>("/api/admin/ide/git/tags").then((body) => {
      if (body.ok) setTags(body.tags); else setError(`${body.code} — ${body.message}`);
    });
  }, []);
  if (error) return <SidebarMessage text={`Error: ${error}`} />;
  if (!tags) return <SidebarMessage text="Loading…" />;
  return (
    <div style={{ fontSize: 11.5 }}>
      {tags.map((t) => (
        <div key={t.name} style={{ padding: "5px 12px", borderBottom: "1px solid #232323" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "#ccc", fontFamily: "ui-monospace, monospace" }}>{t.name}</span>
            <span style={{ color: "#6a6a6a", fontSize: 10 }}>{t.annotated ? "annotated" : "lightweight"}</span>
          </div>
          {t.subject && <div style={{ color: "#858585", fontSize: 10.5, marginTop: 2 }}><span style={{ fontFamily: "ui-monospace, monospace" }}>{t.hash}</span> {t.subject}</div>}
        </div>
      ))}
      {tags.length === 0 && <div style={{ padding: 12, color: "#6a6a6a" }}>No tags.</div>}
    </div>
  );
}

function HistorySubPanel({ activeFilePath }: { activeFilePath: string | null }) {
  const [history, setHistory] = useState<FileHistoryEntry[] | null>(null);
  const [blame, setBlame] = useState<BlameLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showBlame, setShowBlame] = useState(false);

  useEffect(() => {
    if (!activeFilePath) { setHistory(null); setBlame(null); return; }
    setHistory(null); setBlame(null); setError(null);
    fetchIde<GitHistoryResponse>(`/api/admin/ide/git/history?path=${encodeURIComponent(activeFilePath)}`).then((body) => {
      if (body.ok) setHistory(body.history); else setError(`${body.code} — ${body.message}`);
    });
  }, [activeFilePath]);

  const loadBlame = useCallback(() => {
    if (!activeFilePath) return;
    setShowBlame(true);
    fetchIde<GitBlameResponse>(`/api/admin/ide/git/blame?path=${encodeURIComponent(activeFilePath)}`).then((body) => {
      if (body.ok) setBlame(body.blame); else setError(`${body.code} — ${body.message}`);
    });
  }, [activeFilePath]);

  if (!activeFilePath) return <SidebarMessage text="Open a file to see its real File History / Blame." />;
  if (error) return <SidebarMessage text={`Error: ${error}`} />;

  return (
    <div style={{ fontSize: 11 }}>
      <div style={{ padding: "6px 12px 2px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ color: "#858585", fontFamily: "ui-monospace, monospace" }}>{activeFilePath}</span>
        <button onClick={loadBlame} style={miniBtnStyle}>Blame</button>
      </div>
      {!showBlame ? (
        !history ? <SidebarMessage text="Loading…" /> : history.length === 0 ? <div style={{ padding: 12, color: "#6a6a6a" }}>No history — untracked or new file.</div> : history.map((h) => (
          <div key={h.hash} style={{ padding: "5px 12px", borderBottom: "1px solid #232323" }}>
            <div><span style={{ fontFamily: "ui-monospace, monospace", color: "#9cdcfe" }}>{h.shortHash}</span> {h.subject}</div>
            <div style={{ color: "#858585", fontSize: 10 }}>{h.author} · {new Date(h.date).toLocaleString()}</div>
          </div>
        ))
      ) : (
        !blame ? <SidebarMessage text="Loading blame…" /> : blame.map((l) => (
          <div key={l.line} style={{ display: "flex", gap: 8, padding: "1px 12px", fontFamily: "ui-monospace, monospace", fontSize: 10.5 }} title={`${l.author} · ${new Date(l.date).toLocaleString()}`}>
            <span style={{ color: "#6a6a6a", width: 40, textAlign: "right", flexShrink: 0 }}>{l.line}</span>
            <span style={{ color: "#9cdcfe", width: 60, flexShrink: 0 }}>{l.shortHash}</span>
            <span style={{ color: "#ccc", whiteSpace: "pre" }}>{l.content}</span>
          </div>
        ))
      )}
    </div>
  );
}

function MergeSubPanel({ refreshNonce }: { refreshNonce: number }) {
  const [mergeStatus, setMergeStatus] = useState<GitMergeStatusResponse | null>(null);
  const [conflicts, setConflicts] = useState<ConflictInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchIde<GitMergeStatusResponse>("/api/admin/ide/git/merge-status").then((body) => {
      if (body.ok) setMergeStatus(body); else setError(`${body.code} — ${body.message}`);
    });
    fetchIde<GitConflictsResponse>("/api/admin/ide/git/conflicts").then((body) => {
      if (body.ok) setConflicts(body.conflicts);
    });
  }, [refreshNonce]);
  if (error) return <SidebarMessage text={`Error: ${error}`} />;
  if (!mergeStatus || !mergeStatus.ok) return <SidebarMessage text="Loading…" />;
  return (
    <div style={{ fontSize: 11.5, padding: "8px 12px" }}>
      <div style={{ color: mergeStatus.inProgress ? "#f0a020" : "#4ec9b0" }}>
        {mergeStatus.inProgress ? `${mergeStatus.kind} in progress` : "No merge/rebase/cherry-pick/revert in progress"}
      </div>
      {mergeStatus.mergeHeads.length > 0 && (
        <div style={{ color: "#858585", marginTop: 4, fontFamily: "ui-monospace, monospace", fontSize: 10.5 }}>
          {mergeStatus.mergeHeads.map((h) => <div key={h}>{h}</div>)}
        </div>
      )}
      <div style={{ marginTop: 10, color: "#bbb", fontSize: 10, textTransform: "uppercase" }}>Conflicts ({conflicts?.length ?? 0})</div>
      {(conflicts ?? []).map((c) => (
        <div key={c.path} style={{ padding: "4px 0", color: "#f37c7c" }}>
          {c.path} — {c.markersFound ? `${c.markerCount} conflict marker(s) found in working tree` : "no markers found (resolved?)"}
        </div>
      ))}
      {conflicts?.length === 0 && <div style={{ color: "#6a6a6a", marginTop: 4 }}>No conflicts.</div>}
    </div>
  );
}

// ---- Runtime (no real provider yet) ----
function RuntimePanel() {
  return (
    <div style={{ padding: 10 }}>
      <div style={{ fontSize: 11.5, color: "#f0a020" }}>Runtime Provider: Not connected</div>
      <div style={{ fontSize: 11, color: "#858585", marginTop: 6 }}>Live runtime events will appear in the Bottom Panel → Runtime Events once connected.</div>
    </div>
  );
}

// ---- AI (no real provider yet — generic name only) ----
function AiPanel() {
  return (
    <div style={{ padding: 10 }}>
      <div style={{ fontSize: 11.5, color: "#f0a020", marginBottom: 8 }}>AI Provider: Not connected</div>
      <button disabled title="Not connected" style={disabledBtnStyle}>Run</button>
    </div>
  );
}

// ---- Documents (mock list) ----
// Real root docs opened through the exact same real file-open path as
// Explorer (onOpenFileTab -> /api/admin/ide/file) — owner, 2026-08-07,
// /admin/ide Foundation audit. No fake "doc" tab/mock content anymore.
const REAL_ROOT_DOCS = [
  { path: "README.md", title: "README.md" },
  { path: "CLAUDE.md", title: "CLAUDE.md" },
  { path: "MASTER_EXECUTION_STATE.md", title: "MASTER_EXECUTION_STATE.md" },
];
function DocumentsPanel({ onOpenTab }: { onOpenTab: (path: string, title: string) => void }) {
  return (
    <div>
      {REAL_ROOT_DOCS.map((d) => (
        <SidebarItem key={d.path} label={d.title} onClick={() => onOpenTab(d.path, d.title)} />
      ))}
    </div>
  );
}

// ---- Settings (no real config store yet) ----
function SettingsPanel() {
  return (
    <div style={{ padding: 10 }}>
      <div style={{ fontSize: 11.5, color: "#858585", marginBottom: 8 }}>Database Provider: Not connected</div>
      {["Auto-save", "Format on save", "Telemetry"].map((label) => (
        <label key={label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12, color: "#858585" }}>
          <input type="checkbox" disabled />
          {label}
        </label>
      ))}
    </div>
  );
}

function SidebarItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{ padding: "5px 12px", fontSize: 12.5, cursor: "pointer", color: "#ccc" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#2a2d2e")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {label}
    </div>
  );
}
function SidebarMessage({ text }: { text: string }) {
  return <div style={{ padding: 12, fontSize: 12, color: "#858585" }}>{text}</div>;
}
const disabledBtnStyle: React.CSSProperties = {
  background: "#2d2d2d", border: "1px solid #3a3a3a", color: "#6a6a6a", borderRadius: 4,
  padding: "5px 10px", fontSize: 12, cursor: "not-allowed", textAlign: "left",
};

// ---- Tab strip + editor ----
function TabStrip({ tabs, activeTabId, onSelect, onClose, dirtyTabIds, fileStates }: {
  tabs: Tab[]; activeTabId: string | null; onSelect: (id: string) => void; onClose: (id: string) => void; dirtyTabIds: string[];
  fileStates: Record<string, FileTabState>;
}) {
  if (tabs.length === 0) return <div style={{ height: 35, background: "#252526", borderBottom: "1px solid #1e1e1e", flexShrink: 0 }} />;
  const dirtySet = new Set(dirtyTabIds);
  return (
    <div style={{ display: "flex", background: "#252526", borderBottom: "1px solid #1e1e1e", overflowX: "auto", overflowY: "hidden", flexShrink: 0 }}>
      {tabs.map((t) => {
        const dirty = dirtySet.has(t.id);
        const classification = fileStates[t.id]?.classification;
        const categoryColor = classification ? CATEGORY_COLORS[classification.category] : null;
        return (
          <div
            key={t.id}
            onClick={() => onSelect(t.id)}
            title={classification ? classificationTooltip(classification) : (dirty ? `${t.title} — unsaved changes` : t.title)}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", fontSize: 12.5, cursor: "pointer",
              background: activeTabId === t.id ? "#1e1e1e" : "transparent", borderRight: "1px solid #1e1e1e",
              borderTop: categoryColor ? `2px solid ${categoryColor}` : "2px solid transparent",
              color: activeTabId === t.id ? "#fff" : "#969696", whiteSpace: "nowrap", flexShrink: 0,
            }}
          >
            {dirty && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#e2c08d", flexShrink: 0 }} />}
            {classification?.riskLevel === "LOCKED" && <Lock size={11} style={{ color: RISK_COLORS.LOCKED, flexShrink: 0 }} />}
            {t.title}
            <X size={12} onClick={(e) => { e.stopPropagation(); onClose(t.id); }} />
          </div>
        );
      })}
    </div>
  );
}

// ---- Editor toolbar — Save / Save All / Refresh / Find, cursor position ----
function EditorToolbar({ tab, dirty, anyDirty, classification, onSave, onSaveAll, onReload, onToggleFind }: {
  tab: Tab | null; dirty: boolean; anyDirty: boolean; classification: ClassificationInfo | null | undefined;
  onSave: () => void; onSaveAll: () => void; onReload: () => void; onToggleFind: () => void;
}) {
  if (!tab || tab.kind !== "file") return null;
  const locked = classification?.riskLevel === "LOCKED";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", background: "#252526", borderBottom: "1px solid #1e1e1e", flexShrink: 0 }}>
      <span style={{ fontSize: 10.5, color: "#4ec9b0", fontWeight: 600, marginRight: 4 }}>EDIT MODE</span>
      {classification && <ClassificationBadge classification={classification} />}
      <button onClick={onSave} disabled={!dirty || locked} title={locked ? "LOCKED — read-only, cannot be saved" : "Save (Cmd/Ctrl+S)"} style={{ ...topBtnStyle, opacity: !dirty || locked ? 0.4 : 1, cursor: !dirty || locked ? "not-allowed" : "pointer" }}>Save</button>
      <button onClick={onSaveAll} disabled={!anyDirty} style={{ ...topBtnStyle, opacity: anyDirty ? 1 : 0.4, cursor: anyDirty ? "pointer" : "not-allowed" }}>Save All</button>
      <button onClick={onReload} style={topBtnStyle} title="Reload from disk">Reload</button>
      <button onClick={onToggleFind} style={topBtnStyle} title="Find (Cmd/Ctrl+F)">Find</button>
      {locked && (
        <span style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto", fontSize: 10.5, color: RISK_COLORS.LOCKED }}>
          <Lock size={11} /> LOCKED — read-only
        </span>
      )}
    </div>
  );
}

// ---- Classification badge — category + risk, real evidence in the
// tooltip, never the whole file painted one color (owner, 2026-08-05). ----
function ClassificationBadge({ classification }: { classification: ClassificationInfo }) {
  const color = CATEGORY_COLORS[classification.category];
  const riskColor = RISK_COLORS[classification.riskLevel];
  return (
    <span title={classificationTooltip(classification)} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 7px", borderRadius: 10, background: `${color}26`, color, border: `1px solid ${color}55` }}>
        <span style={{ width: 6, height: 6, borderRadius: 3, background: color, flexShrink: 0 }} />
        {classification.categoryLabel}{classification.capability ? ` / ${classification.capability}` : ""}
      </span>
      {classification.riskLevel !== "NORMAL" && (
        <span style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 7px", borderRadius: 10, background: `${riskColor}26`, color: riskColor, border: `1px solid ${riskColor}55` }}>
          {classification.riskLevel === "LOCKED" ? <Lock size={9} /> : classification.riskLevel === "CRITICAL" ? <AlertTriangle size={9} /> : null}
          {RISK_LABELS_TH[classification.riskLevel]}
        </span>
      )}
    </span>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

interface EditorHighlight { tabId: string; line: number; column: number; matchLength: number }

function EditorPane({ tab, highlight, fileState, onChangeContent, onConflictReload, onConflictKeepMine, findBarOpen, onCloseFindBar, gitRefreshNonce }: {
  tab: Tab | null;
  highlight: EditorHighlight | null;
  fileState: FileTabState | undefined;
  onChangeContent: (tabId: string, content: string) => void;
  onConflictReload: (tabId: string) => void;
  onConflictKeepMine: (tabId: string) => void;
  findBarOpen: boolean;
  onCloseFindBar: () => void;
  gitRefreshNonce: number;
}) {
  if (!tab) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#5a5a5a", minWidth: 0 }}>
        No file open
      </div>
    );
  }
  if (tab.kind === "diff") {
    return <DiffPane path={tab.path} staged={!!tab.staged} refreshNonce={gitRefreshNonce} />;
  }

  // kind === "file" — real, editable
  return (
    <FileEditor
      tabId={tab.id}
      path={tab.path}
      state={fileState}
      highlight={highlight}
      onChangeContent={onChangeContent}
      onConflictReload={onConflictReload}
      onConflictKeepMine={onConflictKeepMine}
      findBarOpen={findBarOpen}
      onCloseFindBar={onCloseFindBar}
    />
  );
}

// ---- Real, editable file editor (owner, 2026-08-05, Phase 2) ----
function lineColAt(text: string, offset: number): { line: number; column: number } {
  let line = 1, lastNewline = -1;
  for (let i = 0; i < offset; i++) {
    if (text[i] === "\n") { line++; lastNewline = i; }
  }
  return { line, column: offset - lastNewline };
}
function offsetOfLine(text: string, targetLine: number): number {
  if (targetLine <= 1) return 0;
  let line = 1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      if (line === targetLine) return i + 1;
    }
  }
  return text.length;
}

function FileEditor({ tabId, path, state, highlight, onChangeContent, onConflictReload, onConflictKeepMine, findBarOpen, onCloseFindBar }: {
  tabId: string; path: string; state: FileTabState | undefined; highlight: EditorHighlight | null;
  onChangeContent: (tabId: string, content: string) => void;
  onConflictReload: (tabId: string) => void; onConflictKeepMine: (tabId: string) => void;
  findBarOpen: boolean; onCloseFindBar: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const [goToLineOpen, setGoToLineOpen] = useState(false);
  const [goToLineValue, setGoToLineValue] = useState("");
  const [showDiskDiff, setShowDiskDiff] = useState(false);
  const appliedHighlightRef = useRef<EditorHighlight | null>(null);

  const updateCursor = useCallback(() => {
    const el = textareaRef.current;
    if (!el || !state) return;
    setCursor(lineColAt(state.content, el.selectionStart));
  }, [state]);

  const syncGutterScroll = useCallback(() => {
    if (textareaRef.current && gutterRef.current) gutterRef.current.scrollTop = textareaRef.current.scrollTop;
  }, []);

  // Jump to a search-result location once, when it targets this tab.
  useEffect(() => {
    if (!highlight || highlight.tabId !== tabId || !state || appliedHighlightRef.current === highlight) return;
    appliedHighlightRef.current = highlight;
    const lines = state.content.split("\n");
    const targetLine = Math.min(highlight.line, lines.length);
    const base = offsetOfLine(state.content, targetLine);
    const offset = base + Math.max(0, highlight.column - 1);
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(offset, offset + highlight.matchLength);
      updateCursor();
    }
  }, [highlight, tabId, state, updateCursor]);

  const findMatches = useMemo(() => {
    if (!findQuery || findQuery.length < 1 || !state) return [];
    const hay = state.content.toLowerCase();
    const needle = findQuery.toLowerCase();
    const positions: number[] = [];
    let from = 0;
    while (true) {
      const idx = hay.indexOf(needle, from);
      if (idx === -1) break;
      positions.push(idx);
      from = idx + needle.length;
    }
    return positions;
  }, [findQuery, state]);

  const jumpToMatch = useCallback((idx: number) => {
    if (findMatches.length === 0) return;
    const clamped = ((idx % findMatches.length) + findMatches.length) % findMatches.length;
    setFindIndex(clamped);
    const pos = findMatches[clamped];
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(pos, pos + findQuery.length);
      updateCursor();
    }
  }, [findMatches, findQuery, updateCursor]);

  const goToLine = useCallback(() => {
    const n = Number(goToLineValue);
    if (!state || !Number.isFinite(n) || n < 1) return;
    const offset = offsetOfLine(state.content, n);
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(offset, offset);
      el.scrollTop = Math.max(0, (n - 5) * 18);
      updateCursor();
    }
    setGoToLineOpen(false);
    setGoToLineValue("");
  }, [goToLineValue, state, updateCursor]);

  if (!state || state.loading) {
    return <div style={{ flex: 1, padding: 16, fontSize: 12.5, color: "#858585" }}>Loading…</div>;
  }
  if (state.error) {
    return <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#f14c4c", minWidth: 0, padding: 16, textAlign: "center" }}>{state.error}</div>;
  }

  const lineCount = state.content.split("\n").length;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "5px 12px", fontSize: 10.5, color: "#858585", background: "#1a1a1a", borderBottom: "1px solid #1e1e1e", flexShrink: 0 }}>
        <span title={path}>{path}</span>
        <span>{formatBytes(new Blob([state.content]).size)}</span>
        {state.encoding && <span>{state.encoding}</span>}
        {state.lineEnding && <span>{state.lineEnding}</span>}
        <span>Ln {cursor.line}, Col {cursor.column}</span>
        <span style={{ position: "relative" }}>
          <button onClick={() => setGoToLineOpen((v) => !v)} style={{ ...miniBtnStyle }}>Go to Line</button>
          {goToLineOpen && (
            <span style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, background: "#2d2d2d", border: "1px solid #3a3a3a", borderRadius: 4, padding: 4, display: "flex", gap: 4, zIndex: 10 }}>
              <input
                autoFocus
                value={goToLineValue}
                onChange={(e) => setGoToLineValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") goToLine(); if (e.key === "Escape") setGoToLineOpen(false); }}
                placeholder="Line #"
                style={{ width: 60, background: "#3c3c3c", border: "1px solid #4a4a4a", color: "#ccc", borderRadius: 3, padding: "2px 6px", fontSize: 11 }}
              />
            </span>
          )}
        </span>
        {state.classification?.riskLevel === "LOCKED" && <span style={{ color: RISK_COLORS.LOCKED }}>Read-only</span>}
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {state.lastSavedAt && <span>Last saved {new Date(state.lastSavedAt).toLocaleTimeString("th-TH")}</span>}
          <span>{isDirty(state) ? "Unsaved changes" : "Saved"}</span>
        </span>
      </div>

      {state.conflict && (
        <div style={{ padding: 10, background: "#3a1e1e", borderBottom: "1px solid #5a2e2e", flexShrink: 0 }}>
          <div style={{ fontSize: 12, color: "#e8c3c3", marginBottom: 6 }}>
            File changed on disk since it was opened — your edits were NOT overwritten and NOT saved.
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => onConflictReload(tabId)} style={miniBtnStyle}>Reload from disk (discards your edits)</button>
            <button onClick={() => onConflictKeepMine(tabId)} style={miniBtnStyle}>Keep my unsaved content</button>
            <button onClick={() => setShowDiskDiff((v) => !v)} style={miniBtnStyle}>{showDiskDiff ? "Hide diff" : "Open diff between disk and editor"}</button>
          </div>
          {showDiskDiff && <DiskVsEditorDiff diskContent={state.conflict.diskContent} editorContent={state.content} />}
        </div>
      )}

      {findBarOpen && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", background: "#2d2d2d", borderBottom: "1px solid #1e1e1e", flexShrink: 0 }}>
          <input
            autoFocus
            value={findQuery}
            onChange={(e) => { setFindQuery(e.target.value); setFindIndex(0); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") jumpToMatch(e.shiftKey ? findIndex - 1 : findIndex + 1);
              if (e.key === "Escape") onCloseFindBar();
            }}
            placeholder="Find in file…"
            style={{ flex: 1, minWidth: 0, background: "#3c3c3c", border: "1px solid #4a4a4a", color: "#ccc", borderRadius: 3, padding: "4px 8px", fontSize: 12 }}
          />
          <span style={{ fontSize: 11, color: "#858585", whiteSpace: "nowrap" }}>
            {findMatches.length > 0 ? `${findIndex + 1}/${findMatches.length}` : "0 results"}
          </span>
          <button onClick={() => jumpToMatch(findIndex - 1)} disabled={findMatches.length === 0} style={miniBtnStyle}>Prev</button>
          <button onClick={() => jumpToMatch(findIndex + 1)} disabled={findMatches.length === 0} style={miniBtnStyle}>Next</button>
          <button onClick={onCloseFindBar} style={miniBtnStyle}><X size={11} /></button>
        </div>
      )}

      <div style={{ flex: 1, display: "flex", minHeight: 0, minWidth: 0 }}>
        {/* Category side strip — a thin accent bar, never a full-file wash
            (spec: "ห้ามย้อม syntax ทั้งไฟล์เป็นสีเดียว"). Real syntax
            highlighting doesn't exist in this plain-textarea editor to
            begin with, so there's nothing to conflict with here. */}
        {state.classification && (
          <div
            title={classificationTooltip(state.classification)}
            style={{ width: 4, flexShrink: 0, background: CATEGORY_COLORS[state.classification.category] }}
          />
        )}
        <div ref={gutterRef} style={{ width: 48, flexShrink: 0, overflow: "hidden", background: "#1e1e1e", color: "#5a5a5a", fontSize: 12.5, fontFamily: "ui-monospace, monospace", lineHeight: "18px", textAlign: "right", padding: "8px 8px 8px 0", userSelect: "none" }}>
          {Array.from({ length: lineCount }, (_, i) => <div key={i}>{i + 1}</div>)}
        </div>
        <textarea
          ref={textareaRef}
          value={state.content}
          onChange={(e) => { if (state.classification?.riskLevel !== "LOCKED") onChangeContent(tabId, e.target.value); }}
          onScroll={syncGutterScroll}
          onSelect={updateCursor}
          onClick={updateCursor}
          onKeyUp={updateCursor}
          spellCheck={false}
          wrap="off"
          readOnly={state.classification?.riskLevel === "LOCKED"}
          title={state.classification?.riskLevel === "LOCKED" ? "LOCKED — read-only" : undefined}
          style={{
            flex: 1, minWidth: 0, resize: "none", border: "none", outline: "none",
            background: state.classification?.riskLevel === "LOCKED" ? "#1a1a1a" : "#1e1e1e",
            color: state.classification?.riskLevel === "LOCKED" ? "#9a9a9a" : "#d4d4d4",
            cursor: state.classification?.riskLevel === "LOCKED" ? "not-allowed" : "text",
            fontSize: 12.5, fontFamily: "ui-monospace, monospace",
            lineHeight: "18px", padding: "8px 12px", whiteSpace: "pre",
          }}
        />
      </div>
    </div>
  );
}

// Minimal real LCS line diff — used only for the conflict resolution
// "Open diff between disk and editor" view (neither side is a git ref, so
// git diff can't produce this; both buffers are already in memory client-
// side). Guarded against pathological input size, same DIFF_LINE_STYLE as
// the git DiffPane for visual consistency.
function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const n = oldLines.length, m = newLines.length;
  if (n * m > 4_000_000) {
    return [{ type: "hunk", oldLine: null, newLine: null, content: "file too large for line-level diff here" }];
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const result: DiffLine[] = [];
  let i = 0, j = 0, oldLn = 1, newLn = 1;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      result.push({ type: "context", oldLine: oldLn, newLine: newLn, content: oldLines[i] });
      i++; j++; oldLn++; newLn++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: "del", oldLine: oldLn, newLine: null, content: oldLines[i] });
      i++; oldLn++;
    } else {
      result.push({ type: "add", oldLine: null, newLine: newLn, content: newLines[j] });
      j++; newLn++;
    }
  }
  while (i < n) { result.push({ type: "del", oldLine: oldLn, newLine: null, content: oldLines[i] }); i++; oldLn++; }
  while (j < m) { result.push({ type: "add", oldLine: null, newLine: newLn, content: newLines[j] }); j++; newLn++; }
  return result;
}

function DiskVsEditorDiff({ diskContent, editorContent }: { diskContent: string; editorContent: string }) {
  const lines = useMemo(() => computeLineDiff(diskContent, editorContent), [diskContent, editorContent]);
  return (
    <div style={{ marginTop: 8, maxHeight: 240, overflow: "auto", background: "#1e1e1e", border: "1px solid #3a3a3a", borderRadius: 4, fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
      {lines.map((line, i) => {
        const style = DIFF_LINE_STYLE[line.type];
        return (
          <div key={i} style={{ display: "flex", padding: "0 10px", whiteSpace: "pre", background: style.bg, color: style.color }}>
            <span style={{ width: 30, flexShrink: 0, textAlign: "right", marginRight: 6, color: "#5a5a5a", userSelect: "none" }}>{line.oldLine ?? ""}</span>
            <span style={{ width: 30, flexShrink: 0, textAlign: "right", marginRight: 10, color: "#5a5a5a", userSelect: "none" }}>{line.newLine ?? ""}</span>
            <span>{style.prefix}{line.content}</span>
          </div>
        );
      })}
    </div>
  );
}
const miniBtnStyle: React.CSSProperties = {
  background: "#2d2d2d", border: "1px solid #3a3a3a", color: "#ccc", borderRadius: 3, padding: "3px 8px", fontSize: 11, cursor: "pointer",
};

// ---- Diff viewer — real git diff for one file (owner, 2026-08-05, Phase 1) ----
const DIFF_LINE_STYLE: Record<DiffLine["type"], { bg: string; color: string; prefix: string }> = {
  add: { bg: "#1e3a1e", color: "#c3e8c3", prefix: "+" },
  del: { bg: "#3a1e1e", color: "#e8c3c3", prefix: "-" },
  context: { bg: "transparent", color: "#d4d4d4", prefix: " " },
  hunk: { bg: "#252526", color: "#9cdcfe", prefix: "" },
};

function DiffPane({ path, staged, refreshNonce }: { path: string; staged: boolean; refreshNonce: number }) {
  const [diff, setDiff] = useState<Extract<GitDiffResponse, { ok: true }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDiff(null);
    setError(null);
    fetchIde<GitDiffResponse>(`/api/admin/ide/git/diff?path=${encodeURIComponent(path)}&staged=${staged}`).then((body) => {
      if (body.ok) setDiff(body);
      else setError(`${body.code} — ${body.message}`);
    });
  }, [path, staged, refreshNonce]);

  if (error) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#f14c4c", minWidth: 0, padding: 16, textAlign: "center" }}>
        {error}
      </div>
    );
  }
  if (!diff) {
    return <div style={{ flex: 1, padding: 16, fontSize: 12.5, color: "#858585" }}>Loading diff…</div>;
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
      <div style={{ display: "flex", gap: 14, padding: "5px 12px", fontSize: 10.5, color: "#858585", background: "#1a1a1a", borderBottom: "1px solid #1e1e1e", flexShrink: 0 }}>
        <span>{diff.path}</span>
        <span>{diff.staged ? "staged" : "unstaged"}</span>
        <span style={{ marginLeft: "auto" }}>Read-only diff</span>
      </div>
      <div style={{ flex: 1, overflow: "auto", minWidth: 0, fontSize: 12.5, fontFamily: "ui-monospace, monospace" }}>
        {diff.binary && <div style={{ padding: 16, color: "#858585" }}>Binary file — diff not shown</div>}
        {!diff.binary && diff.lines.length === 0 && (
          <div style={{ padding: 16, color: "#858585" }}>Untracked file — no diff against HEAD available yet.</div>
        )}
        {!diff.binary && diff.lines.map((line, i) => {
          const style = DIFF_LINE_STYLE[line.type];
          return (
            <div key={i} style={{ display: "flex", padding: "0 12px", whiteSpace: "pre", background: style.bg, color: style.color }}>
              <span style={{ width: 36, flexShrink: 0, textAlign: "right", marginRight: 6, color: "#5a5a5a", userSelect: "none" }}>{line.oldLine ?? ""}</span>
              <span style={{ width: 36, flexShrink: 0, textAlign: "right", marginRight: 10, color: "#5a5a5a", userSelect: "none" }}>{line.newLine ?? ""}</span>
              <span>{style.prefix}{line.content}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Bottom panel ----
interface ExecutionPanelProps {
  execCommands: ExecCommandMeta[];
  execSelectedCommandId: string | null;
  onExecSelectCommand: (id: string) => void;
  execRuns: Record<string, ExecRunRecord>;
  execOutputs: Record<string, ExecOutputLine[]>;
  execHistory: string[];
  execActiveRunId: string | null;
  onExecSelectRun: (runId: string) => void;
  execStartError: string | null;
  onExecRun: (commandId: string, meta: ExecCommandMeta | undefined) => void;
  onExecCancel: (runId: string) => void;
  onExecClear: () => void;
  execEventLog: { ts: string; text: string }[];
}

// ---- Stick-to-bottom scroll (owner, 2026-08-05, Floating Console pass) —
// shared by the Runtime Events list and the Execution output pane, the two
// panels with genuinely growing real-time content. Auto-scrolls to the
// newest line ONLY while the user is already at (or near) the bottom;
// scrolling up to read history disables auto-scroll until the user either
// scrolls back down themselves or presses the "jump to latest" button. ----
function useStickToBottom(growthSignal: number) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 32);
  }, []);
  useEffect(() => {
    const el = containerRef.current;
    if (el && atBottom) el.scrollTop = el.scrollHeight;
    // Intentionally NOT depending on atBottom — this effect should only
    // re-run when new content arrives, checking atBottom's current value
    // via the closure, never forcing a scroll just because the user
    // scrolled (which is exactly what setAtBottom(false) already prevents).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [growthSignal]);
  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setAtBottom(true);
  }, []);
  return { containerRef, onScroll, atBottom, scrollToBottom };
}

function JumpToLatestButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        position: "absolute", bottom: 10, right: 14, background: "rgba(9,105,218,0.85)", color: "#fff",
        border: "none", borderRadius: 12, padding: "5px 12px", fontSize: 10.5, cursor: "pointer",
        boxShadow: "0 2px 8px rgba(0,0,0,0.35)", display: "flex", alignItems: "center", gap: 4,
      }}
    >
      <ChevronDown size={12} /> ไปข้อความล่าสุด
    </button>
  );
}

interface BottomPanelProps {
  activeTab: BottomTabId; onSelectTab: (t: BottomTabId) => void; height: number; collapsed: boolean;
  onToggleCollapse: () => void; onResizeStart: (e: React.MouseEvent) => void;
  isExecRunning: boolean; hasUnreadFailure: boolean; hasUnreadOutput: boolean;
  onOpenFinding: (relPath: string, line: number, column: number) => void;
}

// z-index hierarchy (owner, 2026-08-05, Floating Console pass): Editor
// content is normal flow (implicit stacking, z-index: auto). This console
// floats at z-index 30 — above the Editor, below anything that must appear
// "on top of everything" (native window.prompt/confirm/alert dialogs used
// elsewhere in this file are OS-level chrome and always render above any
// page z-index regardless; the one existing in-page dropdown in
// EditorToolbar's Save-All menu uses z-index 10 but is anchored near the
// TOP toolbar, never overlapping this bottom-anchored console).
const CONSOLE_Z_INDEX = 30;

function BottomPanel({
  activeTab, onSelectTab, height, collapsed, onToggleCollapse, onResizeStart,
  isExecRunning, hasUnreadFailure, hasUnreadOutput, onOpenFinding, ...exec
}: BottomPanelProps & ExecutionPanelProps) {
  const activeLabel = BOTTOM_TABS.find((t) => t.id === activeTab)?.label ?? activeTab;
  const runtimeEvents = useStickToBottom(exec.execEventLog.length);

  const dotColor = isExecRunning ? "#4da6ff" : hasUnreadFailure ? "#f37c7c" : hasUnreadOutput ? "#8fd3a3" : null;
  const showIndicator = collapsed && dotColor !== null;

  const glassStyle: React.CSSProperties = {
    background: "rgba(30,30,32,0.88)",
    backdropFilter: "blur(10px) saturate(1.1)",
    WebkitBackdropFilter: "blur(10px) saturate(1.1)",
    borderTop: "1px solid rgba(255,255,255,0.09)",
    boxShadow: "0 -8px 24px rgba(0,0,0,0.35)",
  };

  return (
    <div
      style={{
        position: "absolute", left: 0, right: 0, bottom: 0, zIndex: CONSOLE_Z_INDEX,
        height: collapsed ? BOTTOM_COLLAPSED_HEIGHT : height,
        display: "flex", flexDirection: "column", minWidth: 0, color: "#d4d4d4",
        transition: "height 120ms ease-out",
        ...glassStyle,
      }}
    >
      {collapsed ? (
        // ---- Collapsed strip: tab label + real status indicator + expand arrow ----
        <button
          onClick={onToggleCollapse}
          title="เปิดแผงการทำงาน (Cmd/Ctrl+J)"
          style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%", height: "100%",
            background: "none", border: "none", color: "#ccc", cursor: "pointer", padding: "0 12px", fontSize: 11.5, minHeight: 32,
          }}
        >
          {showIndicator && (
            <span
              style={{
                width: 7, height: 7, borderRadius: 4, background: dotColor!, flexShrink: 0,
                boxShadow: `0 0 6px ${dotColor}`,
                animation: isExecRunning ? "dna-ide-pulse 1.4s ease-in-out infinite" : undefined,
              }}
            />
          )}
          <span>{activeLabel}</span>
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, marginRight: -10 }}>
            <ChevronUp size={13} />
          </span>
        </button>
      ) : (
        <>
          {/* Drag handle — top edge only; clamps to BOTTOM_MIN..45% of the
              real editor column height (see onBottomResizeStart). */}
          <div
            onMouseDown={onResizeStart}
            title="ลากเพื่อปรับความสูง"
            style={{ height: 6, marginTop: -3, cursor: "row-resize", flexShrink: 0 }}
          />
          <div style={{ display: "flex", alignItems: "center", background: "transparent", flexShrink: 0, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            {BOTTOM_TABS.map((t) => {
              const tabDot = t.id === "execution" ? (isExecRunning || hasUnreadFailure) : t.id === "runtime-events" ? hasUnreadOutput : false;
              const tabDotColor = t.id === "execution" && isExecRunning ? "#4da6ff" : t.id === "execution" && hasUnreadFailure ? "#f37c7c" : "#8fd3a3";
              return (
                <div
                  key={t.id}
                  onClick={() => onSelectTab(t.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", fontSize: 11.5, cursor: "pointer",
                    color: activeTab === t.id ? "#fff" : "#969696",
                    borderBottom: activeTab === t.id ? "1px solid #4da6ff" : "1px solid transparent", flexShrink: 0,
                  }}
                >
                  {t.label}
                  {tabDot && <span style={{ width: 5, height: 5, borderRadius: 3, background: tabDotColor }} />}
                </div>
              );
            })}
            <button
              onClick={onToggleCollapse}
              title="พับแผงการทำงาน (Cmd/Ctrl+J)"
              style={{ marginLeft: "auto", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: "#858585", cursor: "pointer", flexShrink: 0 }}
            >
              <ChevronDown size={13} />
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
            {activeTab === "execution" ? (
              <ExecutionPanel {...exec} />
            ) : activeTab === "queue" ? (
              <QueuePanel active={activeTab === "queue"} />
            ) : activeTab === "inspection" ? (
              <InspectionPanel active={activeTab === "inspection"} onOpenFinding={onOpenFinding} />
            ) : activeTab === "artifacts" ? (
              <ArtifactsPanel active={activeTab === "artifacts"} />
            ) : activeTab === "ui-inspection" ? (
              <UiInspectionPanel active={activeTab === "ui-inspection"} />
            ) : activeTab === "code-review" ? (
              <CodeReviewPanel active={activeTab === "code-review"} onOpenFinding={onOpenFinding} />
            ) : activeTab === "test" ? (
              <TestPanel active={activeTab === "test"} onOpenFinding={onOpenFinding} />
            ) : activeTab === "build" ? (
              <BuildPanel active={activeTab === "build"} onOpenFinding={onOpenFinding} />
            ) : activeTab === "release" ? (
              <ReleasePanel active={activeTab === "release"} />
            ) : activeTab === "factory-completion" ? (
              <FactoryCompletionPanel active={activeTab === "factory-completion"} />
            ) : activeTab === "operations" ? (
              <OperationsPanel active={activeTab === "operations"} />
            ) : activeTab === "factory-workspace" ? (
              <FactoryWorkspacePanel active={activeTab === "factory-workspace"} />
            ) : activeTab === "problems" ? (
              <ProblemsPanel active={activeTab === "problems"} onOpenFinding={onOpenFinding} />
            ) : activeTab === "ai-execution" ? (
              <WorkerHealthPanel active={activeTab === "ai-execution"} />
            ) : activeTab === "context" ? (
              <ExecutionContextPanel active={activeTab === "context"} />
            ) : (
              <div
                ref={activeTab === "runtime-events" ? runtimeEvents.containerRef : undefined}
                onScroll={activeTab === "runtime-events" ? runtimeEvents.onScroll : undefined}
                style={{ height: "100%", overflowY: "auto", padding: 8, fontSize: 12, fontFamily: "ui-monospace, monospace" }}
              >
                {activeTab === "runtime-events" && (
                  exec.execEventLog.length === 0
                    ? <div style={{ color: "#858585" }}>No runtime events yet — run a command from the Execution tab.</div>
                    : exec.execEventLog.map((e, i) => (
                      <div key={i} style={{ padding: "2px 0", color: "#858585" }}>[{e.ts}] {e.text}</div>
                    ))
                )}
              </div>
            )}
            {activeTab === "runtime-events" && !runtimeEvents.atBottom && <JumpToLatestButton onClick={runtimeEvents.scrollToBottom} />}
          </div>
        </>
      )}
    </div>
  );
}

// ---- Execution panel — real command runner (owner, 2026-08-05, Phase 4).
// A fixed command selector + Run/Cancel/Clear, never a free-text shell
// prompt: the client can only ever send a commandId, never a command
// string. ----
function ExecutionPanel({
  execCommands, execSelectedCommandId, onExecSelectCommand, execRuns, execOutputs, execHistory,
  execActiveRunId, onExecSelectRun, execStartError, onExecRun, onExecCancel, onExecClear,
}: ExecutionPanelProps) {
  const activeRun = execActiveRunId ? execRuns[execActiveRunId] : null;
  const activeOutput = execActiveRunId ? execOutputs[execActiveRunId] ?? [] : [];
  const isRunning = activeRun?.status === "queued" || activeRun?.status === "running";
  const selectedMeta = execCommands.find((c) => c.id === execSelectedCommandId) ?? null;
  const { containerRef: outputContainerRef, onScroll: outputOnScroll, atBottom: outputAtBottom, scrollToBottom: outputScrollToBottom } = useStickToBottom(activeOutput.length);

  const statusColor: Record<ExecRunStatus, string> = {
    queued: "#cca700", running: "#9cdcfe", passed: "#4ec9b0", failed: "#f14c4c",
    cancelled: "#858585", timed_out: "#f14c4c", output_limited: "#f0a020",
  };

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      {/* Command selector + run controls */}
      <div style={{ width: 240, flexShrink: 0, borderRight: "1px solid #2d2d2d", display: "flex", flexDirection: "column", padding: 8, gap: 6, overflowY: "auto" }}>
        <select
          value={execSelectedCommandId ?? ""}
          onChange={(e) => onExecSelectCommand(e.target.value)}
          style={{ background: "#3c3c3c", border: "1px solid #4a4a4a", color: "#ccc", borderRadius: 3, padding: "5px 6px", fontSize: 11.5 }}
        >
          {execCommands.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        {selectedMeta && (
          <div style={{ fontSize: 10.5, color: "#858585" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, textTransform: "uppercase", letterSpacing: 0.3 }}>
              <span>{selectedMeta.category}</span>
              <span style={{ padding: "1px 6px", borderRadius: 8, background: selectedMeta.mode === "READ_ONLY" ? "#2d3a2d" : "#3a2d1e", color: selectedMeta.mode === "READ_ONLY" ? "#8fd3a3" : "#e0a860" }}>
                {selectedMeta.mode === "READ_ONLY" ? "Read Only" : "Workspace Write"}
              </span>
            </div>
            <div style={{ marginTop: 3 }}>{selectedMeta.description}</div>
            {selectedMeta.requiresOwnerConfirmation && <div style={{ marginTop: 3, color: "#e0a860" }}>Requires confirmation before running.</div>}
          </div>
        )}
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <button
            disabled={!execSelectedCommandId || isRunning}
            onClick={() => execSelectedCommandId && onExecRun(execSelectedCommandId, selectedMeta ?? undefined)}
            style={{ ...topBtnStyle, opacity: !execSelectedCommandId || isRunning ? 0.4 : 1, cursor: !execSelectedCommandId || isRunning ? "not-allowed" : "pointer" }}
          >
            Run
          </button>
          <button
            disabled={!activeRun || !isRunning}
            onClick={() => activeRun && onExecCancel(activeRun.runId)}
            style={{ ...topBtnStyle, opacity: !activeRun || !isRunning ? 0.4 : 1, cursor: !activeRun || !isRunning ? "not-allowed" : "pointer" }}
          >
            Cancel
          </button>
          <button onClick={onExecClear} style={topBtnStyle}>Clear</button>
        </div>
        {execStartError && <div style={{ color: "#f14c4c", fontSize: 10.5 }}>{execStartError}</div>}

        <div style={{ marginTop: 8, fontSize: 10.5, color: "#bbb", textTransform: "uppercase", letterSpacing: 0.3 }}>Run History</div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
          {execHistory.length === 0 && <div style={{ color: "#6a6a6a", fontSize: 10.5 }}>No runs yet</div>}
          {execHistory.map((runId) => {
            const r = execRuns[runId];
            if (!r) return null;
            const running = r.status === "queued" || r.status === "running";
            return (
              <div
                key={runId}
                onClick={() => onExecSelectRun(runId)}
                style={{ padding: "4px 6px", borderRadius: 3, cursor: "pointer", background: runId === execActiveRunId ? "#2a2d2e" : "transparent", fontSize: 10.5 }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 3, background: statusColor[r.status], flexShrink: 0 }} />
                  <span style={{ color: "#ccc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.commandId}</span>
                </div>
                <div style={{ color: "#6a6a6a" }}>{running ? "running…" : r.status}{r.durationMs != null ? ` · ${r.durationMs}ms` : ""}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Output + status */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {activeRun && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, padding: "6px 10px", borderBottom: "1px solid #2d2d2d", fontSize: 10.5, color: "#aaa", flexShrink: 0 }}>
            <span>Command: <span style={{ color: "#ccc" }}>{activeRun.commandId}</span></span>
            <span>Status: <span style={{ color: statusColor[activeRun.status] }}>{activeRun.status}</span></span>
            {activeRun.workingDirectory && <span title={activeRun.workingDirectory}>cwd: workspace root</span>}
            {activeRun.startedAt && <span>Started: {new Date(activeRun.startedAt).toLocaleTimeString("th-TH")}</span>}
            {activeRun.durationMs != null && <span>Duration: {activeRun.durationMs}ms</span>}
            {activeRun.exitCode != null && <span>Exit code: {activeRun.exitCode}</span>}
            {activeRun.truncated && <span style={{ color: "#f0a020" }}>Output truncated (limit reached)</span>}
            {activeRun.timedOut && <span style={{ color: "#f14c4c" }}>Timed out</span>}
            {activeRun.status === "cancelled" && <span style={{ color: "#858585" }}>Cancelled</span>}
            {activeRun.errorCode === "COMMAND_BUSY" && <span style={{ color: "#e0a860" }}>Locked — another run holds this command&apos;s exclusive lock</span>}
            {activeRun.workspacePolicyViolation && (
              <span style={{ color: "#f14c4c" }}>
                Policy violation: READ_ONLY command changed the workspace ({(activeRun.workspaceChangedPaths ?? []).length} path{(activeRun.workspaceChangedPaths ?? []).length === 1 ? "" : "s"})
              </span>
            )}
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
          <div ref={outputContainerRef} onScroll={outputOnScroll} style={{ height: "100%", overflowY: "auto", padding: 8 }}>
            {!activeRun && <div style={{ color: "#858585" }}>Select a command and press Run — output will appear here.</div>}
            {activeOutput.map((line) => (
              <div key={line.seq} style={{ whiteSpace: "pre-wrap", color: line.stream === "stderr" ? "#f14c4c" : "#ccc" }}>{line.text}</div>
            ))}
          </div>
          {!outputAtBottom && activeOutput.length > 0 && <JumpToLatestButton onClick={outputScrollToBottom} />}
        </div>
      </div>
    </div>
  );
}

// ---- Queue panel — Production Queue (owner, 2026-08-06, Software
// Factory Step 3). Read-only-plus-controls view of real Jobs created by
// the Editor's Save path and the Terminal's Run path — this panel never
// creates a job itself (no "Run" control here), it only observes and
// controls jobs that already exist. Auto-refreshes by polling
// GET /queue/jobs every 2s while this tab is active (reuses the existing
// Bottom Console tab-visibility mechanism for start/stop — no new
// infrastructure, matching the "ห้ามทำ Dashboard ใหม่" instruction). ----
const JOB_STATUS_COLORS: Record<JobStatus, string> = {
  QUEUED: "#cca700", READY: "#9cdcfe", RUNNING: "#9cdcfe", WAITING: "#cca700",
  SUCCEEDED: "#4ec9b0", FAILED: "#f37c7c", CANCELLED: "#858585", REJECTED: "#f0a020",
};
function QueuePanel({ active }: { active: boolean }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const body = await fetchIde<QueueJobsResponse>("/api/admin/ide/queue/jobs");
    if (body.ok) { setJobs(body.jobs); setError(null); } else { setError(`${body.code} — ${body.message}`); }
  }, []);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const interval = setInterval(() => void refresh(), 2000);
    return () => clearInterval(interval);
  }, [active, refresh]);

  const doCancel = useCallback(async (jobId: string) => {
    setBusyJobId(jobId);
    await postIde<QueueJobResponse>(`/api/admin/ide/queue/cancel/${encodeURIComponent(jobId)}`, {});
    setBusyJobId(null);
    void refresh();
  }, [refresh]);
  const doRetry = useCallback(async (jobId: string) => {
    setBusyJobId(jobId);
    await postIde<QueueJobResponse>(`/api/admin/ide/queue/retry/${encodeURIComponent(jobId)}`, {});
    setBusyJobId(null);
    void refresh();
  }, [refresh]);
  const doClearFinished = useCallback(async () => {
    await postIde<{ ok: boolean; cleared?: number }>("/api/admin/ide/queue/clear", {});
    void refresh();
  }, [refresh]);

  const counts = {
    queued: jobs.filter((j) => j.status === "QUEUED" || j.status === "READY" || j.status === "WAITING").length,
    running: jobs.filter((j) => j.status === "RUNNING").length,
    completed: jobs.filter((j) => j.status === "SUCCEEDED").length,
    failed: jobs.filter((j) => j.status === "FAILED" || j.status === "REJECTED").length,
    cancelled: jobs.filter((j) => j.status === "CANCELLED").length,
  };
  const isActive = (j: Job) => j.status === "QUEUED" || j.status === "READY" || j.status === "RUNNING" || j.status === "WAITING";
  const isRetryable = (j: Job) => (j.status === "FAILED" || j.status === "CANCELLED" || j.status === "REJECTED") && (j.type === "RUN_COMMAND" || j.type === "TYPE_CHECK");

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", fontSize: 11 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "6px 10px", borderBottom: "1px solid #2d2d2d", flexShrink: 0, color: "#aaa" }}>
        <span>Queue: <span style={{ color: "#cca700" }}>{counts.queued}</span></span>
        <span>Running: <span style={{ color: "#9cdcfe" }}>{counts.running}</span></span>
        <span>Completed: <span style={{ color: "#4ec9b0" }}>{counts.completed}</span></span>
        <span>Failed: <span style={{ color: "#f37c7c" }}>{counts.failed}</span></span>
        <span>Cancelled: <span style={{ color: "#858585" }}>{counts.cancelled}</span></span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#6a6a6a" }}>Auto-refreshing every 2s</span>
          <button onClick={doClearFinished} style={topBtnStyle}>Clear Finished</button>
        </span>
      </div>
      {error && <div style={{ padding: 8, color: "#f37c7c" }}>{error}</div>}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {jobs.length === 0 && <div style={{ padding: 12, color: "#6a6a6a" }}>No jobs yet — Save a file or Run a command to create one.</div>}
        {jobs.map((j) => (
          <div key={j.jobId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 10px", borderBottom: "1px solid #232323" }}>
            <span style={{ width: 7, height: 7, borderRadius: 4, background: JOB_STATUS_COLORS[j.status], flexShrink: 0 }} title={j.status} />
            <span style={{ width: 90, flexShrink: 0, color: "#9cdcfe" }}>{j.type}</span>
            <span style={{ width: 90, flexShrink: 0, color: "#858585" }}>{j.factory}</span>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#ccc" }} title={j.file ?? j.command ?? ""}>
              {j.file ?? j.command ?? "—"}
            </span>
            <span style={{ width: 70, flexShrink: 0, color: "#858585" }}>{j.progress}%</span>
            <span style={{ width: 70, flexShrink: 0, color: "#858585" }}>{j.duration != null ? `${j.duration}ms` : "—"}</span>
            <span style={{ width: 130, flexShrink: 0, color: "#6a6a6a", fontFamily: "ui-monospace, monospace", overflow: "hidden", textOverflow: "ellipsis" }} title={j.jobId}>{j.jobId.slice(0, 8)}</span>
            <span style={{ width: 130, flexShrink: 0, color: "#6a6a6a", fontFamily: "ui-monospace, monospace", overflow: "hidden", textOverflow: "ellipsis" }} title={j.executionId ?? ""}>{j.executionId ? j.executionId.slice(0, 8) : "—"}</span>
            <span style={{ width: 90, flexShrink: 0, color: JOB_STATUS_COLORS[j.status] }}>{j.status}</span>
            <span style={{ width: 110, flexShrink: 0, display: "flex", gap: 4 }}>
              {isActive(j) && (
                <button disabled={busyJobId === j.jobId} onClick={() => doCancel(j.jobId)} style={{ ...miniBtnStyle, opacity: busyJobId === j.jobId ? 0.5 : 1 }}>Cancel</button>
              )}
              {isRetryable(j) && (
                <button disabled={busyJobId === j.jobId} onClick={() => doRetry(j.jobId)} style={{ ...miniBtnStyle, opacity: busyJobId === j.jobId ? 0.5 : 1 }}>Retry</button>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Problems panel — Real Inspection Pipeline (owner, 2026-08-06,
// Software Factory Step 4). Every finding shown here comes from a real
// Inspection Record created by createInspection() (SAVE_FILE / RUN_COMMAND
// triggers, or a manual Run Again) — never mock data. Findings from a
// stale record (the file changed since it was inspected) are visually
// marked STALE, never presented as a current result. Clicking a finding
// opens the file and jumps to its real line/column via the same
// openSearchResult() the Search panel already uses. ----
const FINDING_SEVERITY_COLOR: Record<FindingSeverity, string> = { INFO: "#9cdcfe", WARNING: "#e0c880", ERROR: "#f37c7c", CRITICAL: "#ff5f5f" };

// Governance (Step 4.5) sub-category badges — derived from the real
// GOVERNANCE_CHECK finding.code (GOVERNANCE_RULE_ENFORCED/GHOST/
// NOT_IMPLEMENTED/DEPRECATED/UNKNOWN/DECLARED_NOT_ENFORCED), never a
// second classification — the code already reflects governanceRuntime.ts's
// real computed status.
const GOVERNANCE_CODE_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  GOVERNANCE_RULE_GHOST: { label: "Ghost Rule", color: "#ff9a9a", bg: "#3a1e1e" },
  GOVERNANCE_RULE_NOT_IMPLEMENTED: { label: "Not Implemented", color: "#f0a020", bg: "#3a2d1e" },
  GOVERNANCE_RULE_DEPRECATED: { label: "Deprecated Rule", color: "#c0c0c0", bg: "#2a2a2a" },
  GOVERNANCE_RULE_UNKNOWN: { label: "Unknown Rule", color: "#e0c880", bg: "#3a331e" },
  GOVERNANCE_RULE_DECLARED_NOT_ENFORCED: { label: "Unenforced Rule", color: "#9cdcfe", bg: "#1e2d3a" },
  GOVERNANCE_RULE_ENFORCED: { label: "Enforced", color: "#8fd3a3", bg: "#1e3a24" },
};
const GOVERNANCE_FILTER_CODES = ["GOVERNANCE_RULE_GHOST", "GOVERNANCE_RULE_DECLARED_NOT_ENFORCED", "GOVERNANCE_RULE_DEPRECATED", "GOVERNANCE_RULE_UNKNOWN"] as const;

// UI Inspection (Step 6) Problems filter groups — real InspectionType
// categories grouped by the spec's requested filter labels.
const UI_CATEGORY_GROUPS: { label: string; types: string[] }[] = [
  { label: "Layout", types: ["UI_LAYOUT_CHECK", "UI_DOM_STRUCTURE_CHECK"] },
  { label: "Overflow", types: ["UI_OVERFLOW_CHECK"] },
  { label: "Overlap", types: ["UI_OVERLAP_CHECK"] },
  { label: "Text", types: ["UI_TEXT_RENDER_CHECK"] },
  { label: "Color", types: ["UI_COLOR_CONTRAST_CHECK"] },
  { label: "Layer", types: ["UI_LAYER_CHECK"] },
  { label: "Responsive", types: ["UI_RESPONSIVE_CHECK"] },
  { label: "Accessibility", types: ["UI_ACCESSIBILITY_CHECK"] },
  { label: "Performance", types: ["UI_PERFORMANCE_CHECK"] },
  { label: "Resource", types: ["UI_RESOURCE_CHECK", "UI_INTERACTIVE_TARGET_CHECK"] },
];

const REVIEW_FINDING_CATEGORIES = ["Scope", "Diff", "Architecture", "Dependency", "Contract", "Registry", "Governance", "Security", "API", "Migration", "Inspection", "UI", "Artifact", "Evidence", "Stale"] as const;

// ---- AI Execution — real Worker/Provider health (Step 13.6 Bridge)
// (owner, 2026-08-07, /admin/ide Foundation). Same real
// /api/admin/ide/workers + /workers/[id]/health routes the Factory
// Workspace panel's Worker Selection section already uses — reused
// here, not a second implementation, just a focused health-only view. ----
interface WorkerAdapterClient { id: string; type: string; provider: string; capabilities: string[]; availability: { available: boolean; reason: string }; limitations: string[] }
interface WorkerHealthClient { status: string; reason: string; lastLiveCallAt: string | null; lastLiveCallOk: boolean | null }
const HEALTH_COLORS: Record<string, string> = { HEALTHY: "#4ec9b0", DEGRADED: "#e0a860", NOT_CONFIGURED: "#858585", UNAVAILABLE: "#f37c7c", UNKNOWN: "#858585" };
function WorkerHealthPanel({ active }: { active: boolean }) {
  const [adapters, setAdapters] = useState<WorkerAdapterClient[]>([]);
  const [health, setHealth] = useState<Record<string, WorkerHealthClient>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const body = await fetchIde<{ ok: true; adapters: WorkerAdapterClient[] } | { ok: false; code: string; message: string }>("/api/admin/ide/workers");
    if (body.ok) {
      setAdapters(body.adapters);
      setError(null);
      const entries = await Promise.all(body.adapters.map(async (a) => {
        const h = await fetchIde<{ ok: true; health: WorkerHealthClient } | { ok: false; code: string; message: string }>(`/api/admin/ide/workers/${encodeURIComponent(a.id)}/health`);
        return [a.id, h.ok ? h.health : { status: "UNKNOWN", reason: "health check failed", lastLiveCallAt: null, lastLiveCallOk: null }] as const;
      }));
      setHealth(Object.fromEntries(entries));
    } else {
      setError(`${body.code} — ${body.message}`);
    }
    setLoading(false);
  }, []);
  useEffect(() => { if (active) void refresh(); }, [active, refresh]);

  if (!active) return null;
  return (
    <div style={{ padding: 10, height: "100%", overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: "#858585", textTransform: "uppercase", letterSpacing: 0.3 }}>Worker / Provider Health (Step 13.6 Bridge)</span>
        <button onClick={() => void refresh()} disabled={loading} style={{ ...topBtnStyle, opacity: loading ? 0.5 : 1 }}>{loading ? "Refreshing…" : "Refresh"}</button>
      </div>
      {error && <div style={{ color: "#f14c4c", fontSize: 11.5, marginBottom: 8 }}>{error}</div>}
      {adapters.length === 0 && !loading && <div style={{ color: "#858585", fontSize: 12 }}>No real Worker Adapters registered.</div>}
      {adapters.map((a) => {
        const h = health[a.id];
        return (
          <div key={a.id} style={{ padding: "8px 10px", marginBottom: 6, background: "#252526", borderRadius: 4, border: "1px solid #2d2d2d" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 7, height: 7, borderRadius: 4, background: h ? HEALTH_COLORS[h.status] ?? "#858585" : "#858585", flexShrink: 0 }} />
              <span style={{ color: "#ccc", fontSize: 12.5 }}>{a.id}</span>
              <span style={{ color: "#858585", fontSize: 10.5 }}>{a.type} · {a.provider}</span>
              <span style={{ marginLeft: "auto", color: h ? HEALTH_COLORS[h.status] ?? "#858585" : "#858585", fontSize: 10.5 }}>{h?.status ?? "…"}</span>
            </div>
            <div style={{ color: "#858585", fontSize: 10.5, marginTop: 3 }}>{h?.reason ?? "loading…"}</div>
            {a.limitations.length > 0 && <div style={{ color: "#6a6a6a", fontSize: 10, marginTop: 3 }}>{a.limitations[0]}</div>}
          </div>
        );
      })}
    </div>
  );
}

// ---- Context — real, persisted Execution Context (owner, 2026-08-07,
// /admin/ide Foundation). Survives a dev-server restart because
// executionContextRuntime.ts reads registry/EXECUTION_CONTEXT.json fresh
// from disk on every request — never a cached in-memory value. ----
interface ExecutionContextClient {
  checkpointId: string; contextVersion: number; createdAt: string;
  current_step: string; last_completed_step: string | null;
  step_status: Record<string, string>; blockers: { id: string; severity: string; relatedStep: string; description: string }[];
  next_allowed_action: string; next_blocked_action: string;
  capability_state: { id: string; status: string; riskLevel: string }[];
  worker_state: { id: string; healthStatus: string }[];
  architecture_state: { totalModules: number | null; ok: number | null; broken: number | null; unregistered: number | null };
  governance_state: { totalRules: number | null; enforced: number | null; coveragePercent: number | null };
  git_head: string | null;
  working_tree_state: { branch: string | null; clean: boolean };
  test_baseline: Record<string, { status: string; passed: number; total: number; at: string }>;
}
function ExecutionContextPanel({ active }: { active: boolean }) {
  const [ctx, setCtx] = useState<ExecutionContextClient | null | undefined>(undefined);
  const refresh = useCallback(async () => {
    const body = await fetchIde<{ ok: true; current: ExecutionContextClient | null }>("/api/admin/ide/execution-context");
    setCtx(body.current);
  }, []);
  useEffect(() => { if (active) void refresh(); }, [active, refresh]);

  if (!active) return null;
  if (ctx === undefined) return <div style={{ padding: 10, color: "#858585", fontSize: 12 }}>Loading…</div>;
  if (ctx === null) return <div style={{ padding: 10, color: "#e0a860", fontSize: 12 }}>No Execution Context checkpoint exists yet.</div>;

  const partialCaps = ctx.capability_state.filter((c) => c.status === "PARTIAL");
  return (
    <div style={{ padding: 10, height: "100%", overflowY: "auto", fontSize: 12 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
        <Field label="Current Step" value={ctx.current_step} />
        <Field label="Last Completed Step" value={ctx.last_completed_step ?? "—"} />
        <Field label="Context Version" value={String(ctx.contextVersion)} />
        <Field label="Checkpointed" value={new Date(ctx.createdAt).toLocaleString("th-TH")} />
        <Field label="Git HEAD" value={ctx.git_head ? ctx.git_head.slice(0, 10) : "—"} />
        <Field label="Branch" value={ctx.working_tree_state.branch ?? "—"} />
      </div>
      <SectionLabel text="Next Allowed / Blocked Action" />
      <div style={{ color: "#8fd3a3", marginBottom: 4 }}>{ctx.next_allowed_action}</div>
      <div style={{ color: "#e0a860", marginBottom: 10 }}>{ctx.next_blocked_action}</div>

      <SectionLabel text={`Blockers (${ctx.blockers.length})`} />
      {ctx.blockers.length === 0 && <div style={{ color: "#858585", marginBottom: 10 }}>None.</div>}
      {ctx.blockers.map((b) => (
        <div key={b.id} style={{ color: b.severity === "BLOCKING" ? "#f37c7c" : "#858585", marginBottom: 3 }}>
          [{b.severity}] {b.description} <span style={{ color: "#6a6a6a" }}>(Step {b.relatedStep})</span>
        </div>
      ))}

      <SectionLabel text={`Partial Capabilities (${partialCaps.length})`} />
      {partialCaps.length === 0 && <div style={{ color: "#858585", marginBottom: 10 }}>None.</div>}
      {partialCaps.map((c) => <div key={c.id} style={{ color: "#e0a860", marginBottom: 2 }}>{c.id} — PARTIAL ({c.riskLevel})</div>)}

      <SectionLabel text="Latest Verification" />
      <div style={{ marginBottom: 10 }}>
        {Object.entries(ctx.test_baseline).map(([name, r]) => (
          <div key={name} style={{ color: r.status === "PASSED" ? "#8fd3a3" : "#f37c7c" }}>{name}: {r.passed}/{r.total} ({r.status})</div>
        ))}
        <div style={{ color: "#858585", marginTop: 4 }}>Architecture: {ctx.architecture_state.ok ?? "?"}/{ctx.architecture_state.totalModules ?? "?"} OK, {ctx.architecture_state.unregistered ?? "?"} unregistered</div>
        <div style={{ color: "#858585" }}>Governance: {ctx.governance_state.enforced ?? "?"}/{ctx.governance_state.totalRules ?? "?"} enforced ({ctx.governance_state.coveragePercent ?? "?"}%)</div>
      </div>

      <SectionLabel text="Worker/Provider Runtime Summary" />
      {ctx.worker_state.map((w) => <div key={w.id} style={{ color: HEALTH_COLORS[w.healthStatus] ?? "#858585" }}>{w.id}: {w.healthStatus}</div>)}
    </div>
  );
}
function Field({ label, value }: { label: string; value: string }) {
  return <div><div style={{ color: "#6a6a6a", fontSize: 10, textTransform: "uppercase" }}>{label}</div><div style={{ color: "#ccc" }}>{value}</div></div>;
}
function SectionLabel({ text }: { text: string }) {
  return <div style={{ color: "#858585", fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.3, margin: "8px 0 4px" }}>{text}</div>;
}

function ProblemsPanel({ active, onOpenFinding }: { active: boolean; onOpenFinding: (relPath: string, line: number, column: number) => void }) {
  const [inspections, setInspections] = useState<InspectionRecord[]>([]);
  const [artifactFindings, setArtifactFindings] = useState<IntegrityFinding[]>([]);
  const [changeSets, setChangeSets] = useState<ChangeSetClient[]>([]);
  const [testRuns, setTestRuns] = useState<TestRunClient[]>([]);
  const [buildRuns, setBuildRuns] = useState<BuildRunClient[]>([]);
  const [releaseRuns, setReleaseRuns] = useState<ReleaseRunClient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [governanceFilter, setGovernanceFilter] = useState<string | null>(null);
  const [uiCategoryFilter, setUiCategoryFilter] = useState<string | null>(null);
  const [reviewCategoryFilter, setReviewCategoryFilter] = useState<string | null>(null);
  const [testCategoryFilter, setTestCategoryFilter] = useState<string | null>(null);
  const [buildCategoryFilter, setBuildCategoryFilter] = useState<string | null>(null);
  const [gateCategoryFilter, setGateCategoryFilter] = useState<string | null>(null);
  const [releaseCategoryFilter, setReleaseCategoryFilter] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const body = await fetchIde<InspectionListResponse>("/api/admin/ide/inspection/list");
    if (body.ok) { setInspections(body.inspections); setError(null); } else { setError(`${body.code} — ${body.message}`); }
    const integrity = await fetchIde<ArtifactIntegrityResponse>("/api/admin/ide/artifact/integrity");
    if (integrity.ok) setArtifactFindings(integrity.findings);
    const review = await fetchIde<ChangeSetListResponse>("/api/admin/ide/review/change-sets");
    if (review.ok) setChangeSets(review.changeSets);
    const test = await fetchIde<TestRunListResponse>("/api/admin/ide/test/runs");
    if (test.ok) setTestRuns(test.testRuns);
    const build = await fetchIde<BuildRunListResponse>("/api/admin/ide/build/runs");
    if (build.ok) setBuildRuns(build.runs);
    const release = await fetchIde<ReleaseRunListResponse>("/api/admin/ide/release/runs");
    if (release.ok) setReleaseRuns(release.runs);
  }, []);
  useEffect(() => {
    if (!active) return;
    void refresh();
    const interval = setInterval(() => void refresh(), 2000);
    return () => clearInterval(interval);
  }, [active, refresh]);

  const allFindings = inspections.flatMap((r) => r.findings.map((f) => ({ finding: f, stale: r.stale, record: r })));
  const governanceCounts = GOVERNANCE_FILTER_CODES.reduce<Record<string, number>>((acc, code) => {
    acc[code] = allFindings.filter((x) => x.finding.code === code).length;
    return acc;
  }, {});
  const uiCounts = UI_CATEGORY_GROUPS.reduce<Record<string, number>>((acc, g) => {
    acc[g.label] = allFindings.filter((x) => g.types.includes(x.finding.category)).length;
    return acc;
  }, {});
  const findings = governanceFilter
    ? allFindings.filter((x) => x.finding.code === governanceFilter)
    : uiCategoryFilter
    ? allFindings.filter((x) => UI_CATEGORY_GROUPS.find((g) => g.label === uiCategoryFilter)?.types.includes(x.finding.category))
    : allFindings;

  const allReviewFindings = changeSets.flatMap((cs) => cs.findings.map((f) => ({ finding: f, changeSet: cs })));
  const reviewCounts = REVIEW_FINDING_CATEGORIES.reduce<Record<string, number>>((acc, cat) => {
    acc[cat] = cat === "Stale" ? changeSets.filter((cs) => cs.stale).length : allReviewFindings.filter((x) => x.finding.category === cat).length;
    return acc;
  }, {});
  const reviewFindings = reviewCategoryFilter === "Stale"
    ? allReviewFindings.filter((x) => x.changeSet.stale)
    : reviewCategoryFilter
    ? allReviewFindings.filter((x) => x.finding.category === reviewCategoryFilter)
    : allReviewFindings;

  const TEST_PROBLEM_CATEGORIES = ["Test Failure", "Security", "Registry", "Governance", "Coverage", "Performance"] as const;
  const testTypeCategory = (testTypeId: string, status: string): typeof TEST_PROBLEM_CATEGORIES[number] | null => {
    if (status === "NOT_IMPLEMENTED") return testTypeId === "PERFORMANCE_SMOKE_TEST" ? "Performance" : "Coverage";
    if (status !== "FAILED") return null;
    if (testTypeId === "ROUTE_AUTH_TEST" || testTypeId === "SECURITY_TEST") return "Security";
    if (testTypeId === "REGISTRY_TEST") return "Registry";
    if (testTypeId === "GOVERNANCE_TEST") return "Governance";
    if (testTypeId === "PERFORMANCE_SMOKE_TEST") return "Performance";
    return "Test Failure";
  };
  const latestTestRun = testRuns[0] ?? null;
  const allTestProblems = (latestTestRun?.results ?? [])
    .map((r) => ({ result: r, category: testTypeCategory(r.testTypeId, r.status) }))
    .filter((x): x is { result: TestResultClient; category: typeof TEST_PROBLEM_CATEGORIES[number] } => x.category !== null);
  const testCounts = TEST_PROBLEM_CATEGORIES.reduce<Record<string, number>>((acc, cat) => {
    acc[cat] = allTestProblems.filter((x) => x.category === cat).length;
    return acc;
  }, {});
  const testProblems = testCategoryFilter ? allTestProblems.filter((x) => x.category === testCategoryFilter) : allTestProblems;

  const BUILD_PROBLEM_CATEGORIES = ["Build", "Compile", "Type", "Route", "Config", "Environment", "Bundle", "Static Generation", "Integrity", "Reproducibility", "Source Mutation", "Security", "Unknown"] as const;
  const buildFindingCategory = (category: string): typeof BUILD_PROBLEM_CATEGORIES[number] => {
    switch (category) {
      case "TYPE_ERROR": return "Type";
      case "COMPILE_ERROR": return "Compile";
      case "ROUTE_ERROR": return "Route";
      case "CONFIG_ERROR": return "Config";
      case "MISSING_ENV": return "Environment";
      case "DEPRECATION": return "Build";
      case "BUNDLE_WARNING": return "Bundle";
      case "STATIC_GENERATION_ERROR": return "Static Generation";
      case "SECURITY_WARNING": return "Security";
      case "SOURCE_MUTATION": return "Source Mutation";
      case "OUTPUT_INTEGRITY": return "Integrity";
      case "REPRODUCIBILITY": return "Reproducibility";
      default: return "Unknown";
    }
  };
  const latestBuildRun = buildRuns[0] ?? null;
  const allBuildProblems = [...(latestBuildRun?.failures ?? []), ...(latestBuildRun?.warnings ?? [])]
    .map((f) => ({ finding: f, category: buildFindingCategory(f.category) }));
  const buildCounts = BUILD_PROBLEM_CATEGORIES.reduce<Record<string, number>>((acc, cat) => {
    acc[cat] = allBuildProblems.filter((x) => x.category === cat).length;
    return acc;
  }, {});
  const buildProblems = buildCategoryFilter ? allBuildProblems.filter((x) => x.category === buildCategoryFilter) : allBuildProblems;

  // Step 9.5 — Build Gate Integrity & Pre-Release Blocker Resolution
  // (owner, 2026-08-07): real gate/precondition/migration-conflict
  // problems, sourced from the latest real Build Run's real
  // gateReport/blockingReasons/migrationIntegrity — never fabricated.
  const GATE_PROBLEM_CATEGORIES = ["Build Gate Failure", "Registry Gate", "Migration Conflict", "Precondition Failure", "Integrity Failure", "Reproducibility Failure"] as const;
  interface GateProblem { category: typeof GATE_PROBLEM_CATEGORIES[number]; message: string; evidence: string }
  const allGateProblems: GateProblem[] = [];
  if (latestBuildRun?.gateReport) {
    for (const g of latestBuildRun.gateReport.gates) {
      if (g.status !== "FAILED" && g.status !== "BLOCKED") continue;
      if (g.gate === "Registry") allGateProblems.push({ category: "Registry Gate", message: g.evidence, evidence: g.evidence });
      else if (g.gate === "Artifact Integrity") allGateProblems.push({ category: "Integrity Failure", message: g.evidence, evidence: g.evidence });
      else if (g.gate === "Reproducibility") allGateProblems.push({ category: "Reproducibility Failure", message: g.evidence, evidence: g.evidence });
      else allGateProblems.push({ category: "Build Gate Failure", message: `${g.gate}: ${g.evidence}`, evidence: g.evidence });
    }
  }
  for (const r of latestBuildRun?.blockingReasons ?? []) allGateProblems.push({ category: "Precondition Failure", message: r, evidence: r });
  for (const c of latestBuildRun?.migrationIntegrity?.conflicts ?? []) allGateProblems.push({ category: "Migration Conflict", message: `real duplicate timestamp ${c.timestamp}: ${c.files.join(", ")}`, evidence: `${c.files.length} real files share timestamp ${c.timestamp}` });
  if (latestBuildRun?.registryGateAnalysis && latestBuildRun.registryGateAnalysis.falsePositives.length > 0) {
    allGateProblems.push({ category: "Registry Gate", message: latestBuildRun.registryGateAnalysis.evidence, evidence: latestBuildRun.registryGateAnalysis.evidence });
  }
  const gateCounts = GATE_PROBLEM_CATEGORIES.reduce<Record<string, number>>((acc, cat) => {
    acc[cat] = allGateProblems.filter((x) => x.category === cat).length;
    return acc;
  }, {});
  const gateProblems = gateCategoryFilter ? allGateProblems.filter((x) => x.category === gateCategoryFilter) : allGateProblems;

  // Step 10 — Release Pipeline, Capability Packaging & Operational
  // Readiness: real Release problems, sourced from the latest real
  // Release Run's real decision/packageIntegrity/operationalReadiness/
  // packages — never fabricated.
  const RELEASE_PROBLEM_CATEGORIES = ["Release Blocking", "Package Conflict", "Compatibility", "Operational Readiness", "Release Integrity", "Package Dependency"] as const;
  interface ReleaseProblem { category: typeof RELEASE_PROBLEM_CATEGORIES[number]; message: string; evidence: string }
  const latestReleaseRun = releaseRuns[0] ?? null;
  const allReleaseProblems: ReleaseProblem[] = [];
  if (latestReleaseRun?.decision?.decision === "BLOCKED") {
    for (const r of latestReleaseRun.decision.reasons) allReleaseProblems.push({ category: "Release Blocking", message: r, evidence: r });
  }
  if (latestReleaseRun?.packageIntegrity) {
    for (const id of latestReleaseRun.packageIntegrity.duplicateCapabilityIds) allReleaseProblems.push({ category: "Package Conflict", message: `real duplicate CapabilityId: ${id}`, evidence: id });
    if (latestReleaseRun.packageIntegrity.missingOwnerModules.length > 0) {
      allReleaseProblems.push({ category: "Release Integrity", message: `${latestReleaseRun.packageIntegrity.missingOwnerModules.length} real Capability(ies) with a missing OwnerModule file: ${latestReleaseRun.packageIntegrity.missingOwnerModules.slice(0, 5).join(", ")}`, evidence: latestReleaseRun.packageIntegrity.findings.join("; ") });
    }
  }
  if (latestReleaseRun?.operationalReadiness) {
    for (const d of latestReleaseRun.operationalReadiness.dimensions) {
      if (d.status === "FAILED" || d.status === "BLOCKED") allReleaseProblems.push({ category: "Operational Readiness", message: `${d.dimension}: ${d.status}`, evidence: d.evidence });
    }
  }
  if (latestReleaseRun?.packages?.length) {
    const unknownCompat = latestReleaseRun.packages.filter((p) => p.compatibility === "UNKNOWN").length;
    if (unknownCompat > 0) allReleaseProblems.push({ category: "Compatibility", message: `${unknownCompat} real Capability Package(s) have real UNKNOWN compatibility (no compatibility-matrix registry exists yet)`, evidence: "real registry/capability-registry.json has no compatibility matrix field" });
    const allIds = new Set(latestReleaseRun.packages.map((p) => p.capabilityId));
    for (const p of latestReleaseRun.packages) {
      for (const dep of p.dependencies) {
        if (!allIds.has(dep)) allReleaseProblems.push({ category: "Package Dependency", message: `${p.capabilityId} depends on real CapabilityId "${dep}" which is not present in this Release's real package set`, evidence: `real registry/capability-registry.json Dependencies field of ${p.capabilityId}` });
      }
    }
  }
  const releaseCounts = RELEASE_PROBLEM_CATEGORIES.reduce<Record<string, number>>((acc, cat) => {
    acc[cat] = allReleaseProblems.filter((x) => x.category === cat).length;
    return acc;
  }, {});
  const releaseProblems = releaseCategoryFilter ? allReleaseProblems.filter((x) => x.category === releaseCategoryFilter) : allReleaseProblems;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {governanceCounts && GOVERNANCE_FILTER_CODES.some((c) => governanceCounts[c] > 0) && (
        <div style={{ display: "flex", gap: 6, padding: "6px 8px", borderBottom: "1px solid #2d2d2d", flexShrink: 0, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10.5, color: "#858585", alignSelf: "center" }}>Governance:</span>
          {GOVERNANCE_FILTER_CODES.map((code) => {
            const meta = GOVERNANCE_CODE_LABEL[code];
            const count = governanceCounts[code];
            if (count === 0) return null;
            const isActive = governanceFilter === code;
            return (
              <button
                key={code}
                onClick={() => setGovernanceFilter(isActive ? null : code)}
                style={{
                  fontSize: 10.5, padding: "2px 8px", borderRadius: 10, border: isActive ? `1px solid ${meta.color}` : "1px solid transparent",
                  background: meta.bg, color: meta.color, cursor: "pointer",
                }}
              >
                {meta.label} ({count})
              </button>
            );
          })}
          {governanceFilter && <button onClick={() => setGovernanceFilter(null)} style={{ fontSize: 10.5, color: "#858585", background: "none", border: "none", cursor: "pointer" }}>Clear filter</button>}
        </div>
      )}
      {UI_CATEGORY_GROUPS.some((g) => uiCounts[g.label] > 0) && (
        <div style={{ display: "flex", gap: 6, padding: "6px 8px", borderBottom: "1px solid #2d2d2d", flexShrink: 0, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10.5, color: "#858585", alignSelf: "center" }}>UI Inspection:</span>
          {UI_CATEGORY_GROUPS.map((g) => {
            const count = uiCounts[g.label];
            if (count === 0) return null;
            const isActive = uiCategoryFilter === g.label;
            return (
              <button
                key={g.label}
                onClick={() => setUiCategoryFilter(isActive ? null : g.label)}
                style={{
                  fontSize: 10.5, padding: "2px 8px", borderRadius: 10, cursor: "pointer",
                  border: isActive ? "1px solid #9cdcfe" : "1px solid transparent", background: "#1e2d3a", color: "#9cdcfe",
                }}
              >
                {g.label} ({count})
              </button>
            );
          })}
          {uiCategoryFilter && <button onClick={() => setUiCategoryFilter(null)} style={{ fontSize: 10.5, color: "#858585", background: "none", border: "none", cursor: "pointer" }}>Clear filter</button>}
        </div>
      )}
      {REVIEW_FINDING_CATEGORIES.some((c) => reviewCounts[c] > 0) && (
        <div style={{ display: "flex", gap: 6, padding: "6px 8px", borderBottom: "1px solid #2d2d2d", flexShrink: 0, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10.5, color: "#858585", alignSelf: "center" }}>Code Review:</span>
          {REVIEW_FINDING_CATEGORIES.map((cat) => {
            const count = reviewCounts[cat];
            if (count === 0) return null;
            const isActive = reviewCategoryFilter === cat;
            return (
              <button
                key={cat}
                onClick={() => setReviewCategoryFilter(isActive ? null : cat)}
                style={{
                  fontSize: 10.5, padding: "2px 8px", borderRadius: 10, cursor: "pointer",
                  border: isActive ? "1px solid #cba6f7" : "1px solid transparent", background: "#2a1e3a", color: "#cba6f7",
                }}
              >
                {cat} ({count})
              </button>
            );
          })}
          {reviewCategoryFilter && <button onClick={() => setReviewCategoryFilter(null)} style={{ fontSize: 10.5, color: "#858585", background: "none", border: "none", cursor: "pointer" }}>Clear filter</button>}
        </div>
      )}
      {TEST_PROBLEM_CATEGORIES.some((c) => testCounts[c] > 0) && (
        <div style={{ display: "flex", gap: 6, padding: "6px 8px", borderBottom: "1px solid #2d2d2d", flexShrink: 0, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10.5, color: "#858585", alignSelf: "center" }}>Test:</span>
          {TEST_PROBLEM_CATEGORIES.map((cat) => {
            const count = testCounts[cat];
            if (count === 0) return null;
            const isActive = testCategoryFilter === cat;
            return (
              <button
                key={cat}
                onClick={() => setTestCategoryFilter(isActive ? null : cat)}
                style={{
                  fontSize: 10.5, padding: "2px 8px", borderRadius: 10, cursor: "pointer",
                  border: isActive ? "1px solid #e0a860" : "1px solid transparent", background: "#3a2d1e", color: "#e0a860",
                }}
              >
                {cat} ({count})
              </button>
            );
          })}
          {testCategoryFilter && <button onClick={() => setTestCategoryFilter(null)} style={{ fontSize: 10.5, color: "#858585", background: "none", border: "none", cursor: "pointer" }}>Clear filter</button>}
        </div>
      )}
      {BUILD_PROBLEM_CATEGORIES.some((c) => buildCounts[c] > 0) && (
        <div style={{ display: "flex", gap: 6, padding: "6px 8px", borderBottom: "1px solid #2d2d2d", flexShrink: 0, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10.5, color: "#858585", alignSelf: "center" }}>Build:</span>
          {BUILD_PROBLEM_CATEGORIES.map((cat) => {
            const count = buildCounts[cat];
            if (count === 0) return null;
            const isActive = buildCategoryFilter === cat;
            return (
              <button
                key={cat}
                onClick={() => setBuildCategoryFilter(isActive ? null : cat)}
                style={{
                  fontSize: 10.5, padding: "2px 8px", borderRadius: 10, cursor: "pointer",
                  border: isActive ? "1px solid #4ec9b0" : "1px solid transparent", background: "#1e3a2d", color: "#4ec9b0",
                }}
              >
                {cat} ({count})
              </button>
            );
          })}
          {buildCategoryFilter && <button onClick={() => setBuildCategoryFilter(null)} style={{ fontSize: 10.5, color: "#858585", background: "none", border: "none", cursor: "pointer" }}>Clear filter</button>}
        </div>
      )}
      {GATE_PROBLEM_CATEGORIES.some((c) => gateCounts[c] > 0) && (
        <div style={{ display: "flex", gap: 6, padding: "6px 8px", borderBottom: "1px solid #2d2d2d", flexShrink: 0, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10.5, color: "#858585", alignSelf: "center" }}>Build Gate:</span>
          {GATE_PROBLEM_CATEGORIES.map((cat) => {
            const count = gateCounts[cat];
            if (count === 0) return null;
            const isActive = gateCategoryFilter === cat;
            return (
              <button
                key={cat}
                onClick={() => setGateCategoryFilter(isActive ? null : cat)}
                style={{
                  fontSize: 10.5, padding: "2px 8px", borderRadius: 10, cursor: "pointer",
                  border: isActive ? "1px solid #cba6f7" : "1px solid transparent", background: "#2a1e3a", color: "#cba6f7",
                }}
              >
                {cat} ({count})
              </button>
            );
          })}
          {gateCategoryFilter && <button onClick={() => setGateCategoryFilter(null)} style={{ fontSize: 10.5, color: "#858585", background: "none", border: "none", cursor: "pointer" }}>Clear filter</button>}
        </div>
      )}
      {RELEASE_PROBLEM_CATEGORIES.some((c) => releaseCounts[c] > 0) && (
        <div style={{ display: "flex", gap: 6, padding: "6px 8px", borderBottom: "1px solid #2d2d2d", flexShrink: 0, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10.5, color: "#858585", alignSelf: "center" }}>Release:</span>
          {RELEASE_PROBLEM_CATEGORIES.map((cat) => {
            const count = releaseCounts[cat];
            if (count === 0) return null;
            const isActive = releaseCategoryFilter === cat;
            return (
              <button
                key={cat}
                onClick={() => setReleaseCategoryFilter(isActive ? null : cat)}
                style={{
                  fontSize: 10.5, padding: "2px 8px", borderRadius: 10, cursor: "pointer",
                  border: isActive ? "1px solid #4ec9b0" : "1px solid transparent", background: "#1e3a2d", color: "#4ec9b0",
                }}
              >
                {cat} ({count})
              </button>
            );
          })}
          {releaseCategoryFilter && <button onClick={() => setReleaseCategoryFilter(null)} style={{ fontSize: 10.5, color: "#858585", background: "none", border: "none", cursor: "pointer" }}>Clear filter</button>}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 8, fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
      {error && <div style={{ color: "#f37c7c", marginBottom: 6 }}>{error}</div>}
      {findings.length === 0 && <div style={{ color: "#858585" }}>No findings — Save a file or run a check-type command to inspect it.</div>}
      {findings.map(({ finding: f, stale, record }) => (
        <div
          key={f.findingId}
          onClick={() => f.file && f.line != null && onOpenFinding(f.file, f.line, f.column ?? 1)}
          style={{
            display: "flex", gap: 6, padding: "3px 0", alignItems: "flex-start",
            color: FINDING_SEVERITY_COLOR[f.severity], cursor: f.file && f.line != null ? "pointer" : "default", opacity: stale ? 0.55 : 1,
          }}
          title={f.evidence}
        >
          {f.severity === "ERROR" || f.severity === "CRITICAL" ? <XCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} /> : <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />}
          <span>
            [{f.category}] {f.file ?? record.targetPath}{f.line != null ? `:${f.line}:${f.column ?? 0}` : ""} — {f.message}
            {GOVERNANCE_CODE_LABEL[f.code] && (
              <span style={{ marginLeft: 6, padding: "0 5px", borderRadius: 3, background: GOVERNANCE_CODE_LABEL[f.code].bg, color: GOVERNANCE_CODE_LABEL[f.code].color, fontSize: 10 }}>
                {GOVERNANCE_CODE_LABEL[f.code].label}
              </span>
            )}
            {stale && <span style={{ marginLeft: 6, padding: "0 5px", borderRadius: 3, background: "#3a2d1e", color: "#e0a860", fontSize: 10 }}>STALE</span>}
            {f.blocking && <span style={{ marginLeft: 6, padding: "0 5px", borderRadius: 3, background: "#3a1e1e", color: "#f0a0a0", fontSize: 10 }}>BLOCKING</span>}
          </span>
        </div>
      ))}
      {artifactFindings.length > 0 && (
        <>
          <div style={{ marginTop: 10, marginBottom: 4, color: "#bbb", fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.3 }}>Artifact Integrity ({artifactFindings.length})</div>
          {artifactFindings.map((f, i) => (
            <div key={i} style={{ display: "flex", gap: 6, padding: "3px 0", alignItems: "flex-start", color: "#f0a020" }} title={f.artifactId}>
              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>[{f.kind}] {f.message}</span>
            </div>
          ))}
        </>
      )}
      {reviewFindings.length > 0 && (
        <>
          <div style={{ marginTop: 10, marginBottom: 4, color: "#bbb", fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.3 }}>Code Review ({reviewFindings.length})</div>
          {reviewFindings.map(({ finding: f, changeSet: cs }) => (
            <div
              key={f.reviewFindingId}
              onClick={() => f.file && f.line != null && onOpenFinding(f.file, f.line, f.column ?? 1)}
              style={{
                display: "flex", gap: 6, padding: "3px 0", alignItems: "flex-start",
                color: FINDING_SEVERITY_COLOR[f.severity] ?? "#e0c880", cursor: f.file && f.line != null ? "pointer" : "default",
              }}
              title={f.evidence}
            >
              {f.severity === "ERROR" || f.severity === "CRITICAL" ? <XCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} /> : <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />}
              <span>
                [{f.category}] {f.file ?? cs.title}{f.line != null ? `:${f.line}:${f.column ?? 0}` : ""} — {f.message}
                {cs.stale && <span style={{ marginLeft: 6, padding: "0 5px", borderRadius: 3, background: "#3a2d1e", color: "#e0a860", fontSize: 10 }}>STALE</span>}
                {f.blocking && <span style={{ marginLeft: 6, padding: "0 5px", borderRadius: 3, background: "#3a1e1e", color: "#f0a0a0", fontSize: 10 }}>BLOCKING</span>}
              </span>
            </div>
          ))}
        </>
      )}
      {testProblems.length > 0 && (
        <>
          <div style={{ marginTop: 10, marginBottom: 4, color: "#bbb", fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.3 }}>Test ({testProblems.length})</div>
          {testProblems.map(({ result: r, category }) => (
            <div key={r.id} style={{ display: "flex", gap: 6, padding: "3px 0", alignItems: "flex-start", color: r.status === "NOT_IMPLEMENTED" ? "#6a6a6a" : "#e0a860" }} title={r.evidence}>
              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                [{category}] {r.testTypeId} — {r.status === "NOT_IMPLEMENTED" ? "not implemented (no real harness exists)" : (r.failures[0] ?? "real failure")}
                {r.blocking && <span style={{ marginLeft: 6, padding: "0 5px", borderRadius: 3, background: "#3a1e1e", color: "#f0a0a0", fontSize: 10 }}>BLOCKING</span>}
              </span>
            </div>
          ))}
        </>
      )}
      {buildProblems.length > 0 && (
        <>
          <div style={{ marginTop: 10, marginBottom: 4, color: "#bbb", fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.3 }}>Build ({buildProblems.length})</div>
          {buildProblems.map(({ finding: f, category }) => (
            <div
              key={f.findingId}
              onClick={() => f.file && f.line != null && onOpenFinding(f.file, f.line, f.column ?? 1)}
              style={{ display: "flex", gap: 6, padding: "3px 0", alignItems: "flex-start", color: f.blocking ? "#f37c7c" : "#e0c880", cursor: f.file && f.line != null ? "pointer" : "default" }}
              title={f.source}
            >
              {f.blocking ? <XCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} /> : <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />}
              <span>
                [{category}] {f.file ?? f.buildRunId.slice(0, 8)}{f.line != null ? `:${f.line}:${f.column ?? 0}` : ""} — {f.message.slice(0, 160)}
                {f.blocking && <span style={{ marginLeft: 6, padding: "0 5px", borderRadius: 3, background: "#3a1e1e", color: "#f0a0a0", fontSize: 10 }}>BLOCKING</span>}
              </span>
            </div>
          ))}
        </>
      )}
      {gateProblems.length > 0 && (
        <>
          <div style={{ marginTop: 10, marginBottom: 4, color: "#bbb", fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.3 }}>Build Gate ({gateProblems.length})</div>
          {gateProblems.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 6, padding: "3px 0", alignItems: "flex-start", color: "#f0a0a0" }} title={p.evidence}>
              <XCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>[{p.category}] {p.message.slice(0, 200)}</span>
            </div>
          ))}
        </>
      )}
      {releaseProblems.length > 0 && (
        <>
          <div style={{ marginTop: 10, marginBottom: 4, color: "#bbb", fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.3 }}>Release ({releaseProblems.length})</div>
          {releaseProblems.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 6, padding: "3px 0", alignItems: "flex-start", color: "#e0a860" }} title={p.evidence}>
              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>[{p.category}] {p.message.slice(0, 200)}</span>
            </div>
          ))}
        </>
      )}
      </div>
    </div>
  );
}

// ---- Inspection panel — Real Inspection Pipeline (owner, 2026-08-06,
// Software Factory Step 4). Read-only-plus-controls view of real
// InspectionRecords: status, type, target, Job ID, Execution ID,
// error/warning counts, duration, blocking, source hash, Run Again,
// Cancel. Never a second dashboard — this reuses the exact same Bottom
// Console tab-strip QueuePanel/ExecutionPanel already established. ----
const INSPECTION_STATUS_COLORS: Record<InspectionStatus, string> = {
  QUEUED: "#cca700", RUNNING: "#9cdcfe", PASSED: "#4ec9b0", FAILED: "#f37c7c", WARNING: "#e0c880",
  CANCELLED: "#858585", TIMED_OUT: "#f37c7c", REJECTED: "#f0a020", NOT_IMPLEMENTED: "#6a6a6a",
};

function InspectionPanel({ active, onOpenFinding }: { active: boolean; onOpenFinding: (relPath: string, line: number, column: number) => void }) {
  const [inspections, setInspections] = useState<InspectionRecord[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const body = await fetchIde<InspectionListResponse>("/api/admin/ide/inspection/list");
    if (body.ok) { setInspections(body.inspections); setError(null); } else { setError(`${body.code} — ${body.message}`); }
  }, []);
  useEffect(() => {
    if (!active) return;
    void refresh();
    const interval = setInterval(() => void refresh(), 2000);
    return () => clearInterval(interval);
  }, [active, refresh]);

  const doRunAgain = useCallback(async (r: InspectionRecord) => {
    setBusyId(r.inspectionId);
    // Sends inspectionType + targetPath only — never a raw command, never
    // the previous inspection's internal state.
    await postIde<InspectionRunResponse>("/api/admin/ide/inspection/run", { inspectionType: r.inspectionType, targetPath: r.targetPath, jobId: r.jobId });
    setBusyId(null);
    void refresh();
  }, [refresh]);
  const doCancel = useCallback(async (r: InspectionRecord) => {
    setBusyId(r.inspectionId);
    await postIde<InspectionRunResponse>(`/api/admin/ide/inspection/${encodeURIComponent(r.inspectionId)}/cancel`, {});
    setBusyId(null);
    void refresh();
  }, [refresh]);

  const isActive = (r: InspectionRecord) => r.status === "QUEUED" || r.status === "RUNNING";

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", fontSize: 11 }}>
      {error && <div style={{ padding: 8, color: "#f37c7c" }}>{error}</div>}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {inspections.length === 0 && <div style={{ padding: 12, color: "#6a6a6a" }}>No inspections yet — Save a file or run a check-type command to create one.</div>}
        {inspections.map((r) => (
          <div key={r.inspectionId} style={{ borderBottom: "1px solid #232323" }}>
            <div
              onClick={() => setExpandedId(expandedId === r.inspectionId ? null : r.inspectionId)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 10px", cursor: "pointer" }}
            >
              <span style={{ width: 7, height: 7, borderRadius: 4, background: INSPECTION_STATUS_COLORS[r.status], flexShrink: 0 }} title={r.status} />
              <span style={{ width: 150, flexShrink: 0, color: "#9cdcfe" }}>{r.inspectionType}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#ccc" }} title={r.targetPath}>
                {r.targetPath}
                {r.stale && <span style={{ marginLeft: 6, padding: "0 5px", borderRadius: 3, background: "#3a2d1e", color: "#e0a860", fontSize: 10 }}>STALE</span>}
              </span>
              <span style={{ width: 60, flexShrink: 0, color: "#f37c7c" }}>{r.errorCount} err</span>
              <span style={{ width: 70, flexShrink: 0, color: "#e0c880" }}>{r.warningCount} warn</span>
              <span style={{ width: 70, flexShrink: 0, color: "#858585" }}>{r.durationMs != null ? `${r.durationMs}ms` : "—"}</span>
              <span style={{ width: 110, flexShrink: 0, color: "#6a6a6a", fontFamily: "ui-monospace, monospace", overflow: "hidden", textOverflow: "ellipsis" }} title={r.jobId ?? ""}>{r.jobId ? r.jobId.slice(0, 8) : "—"}</span>
              <span style={{ width: 110, flexShrink: 0, color: "#6a6a6a", fontFamily: "ui-monospace, monospace", overflow: "hidden", textOverflow: "ellipsis" }} title={r.executionId ?? ""}>{r.executionId ? r.executionId.slice(0, 8) : "—"}</span>
              <span style={{ width: 100, flexShrink: 0, color: INSPECTION_STATUS_COLORS[r.status] }}>{r.status}</span>
              <span style={{ width: 130, flexShrink: 0, display: "flex", gap: 4 }}>
                {isActive(r) ? (
                  <button disabled={busyId === r.inspectionId} onClick={(e) => { e.stopPropagation(); doCancel(r); }} style={{ ...miniBtnStyle, opacity: busyId === r.inspectionId ? 0.5 : 1 }}>Cancel</button>
                ) : (
                  <button disabled={busyId === r.inspectionId} onClick={(e) => { e.stopPropagation(); doRunAgain(r); }} style={{ ...miniBtnStyle, opacity: busyId === r.inspectionId ? 0.5 : 1 }}>Run Again</button>
                )}
              </span>
            </div>
            {expandedId === r.inspectionId && (
              <div style={{ padding: "4px 10px 10px 27px", fontSize: 10.5, color: "#aaa" }}>
                <div style={{ marginBottom: 4 }}>
                  Actor: {r.actor} · Blocking: {r.blocking ? "yes" : "no"} · Source Hash: {r.sourceHash ? r.sourceHash.slice(0, 12) : "—"} · Exit Code: {r.exitCode ?? "—"}
                </div>
                <div style={{ marginBottom: 4, color: "#858585" }}>{r.evidence}</div>
                {r.error && <div style={{ marginBottom: 4, color: "#f37c7c" }}>Error: {r.error}</div>}
                {r.findings.length === 0 ? (
                  <div style={{ color: "#6a6a6a" }}>No findings.</div>
                ) : r.findings.map((f) => (
                  <div
                    key={f.findingId}
                    onClick={() => f.file && f.line != null && onOpenFinding(f.file, f.line, f.column ?? 1)}
                    style={{ padding: "2px 0", color: FINDING_SEVERITY_COLOR[f.severity], cursor: f.file && f.line != null ? "pointer" : "default" }}
                  >
                    [{f.code}] {f.file ?? r.targetPath}{f.line != null ? `:${f.line}:${f.column ?? 0}` : ""} — {f.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Artifacts panel — Real Artifact Pipeline & Evidence Warehouse
// (owner, 2026-08-06, Software Factory Step 5). Read-only view of real,
// immutable Artifact records produced by SAVE_FILE/RUN_COMMAND/Inspection/
// Governance — never a second dashboard, reuses the exact same Bottom
// Console tab-strip pattern as Queue/Execution/Inspection. ----
const ARTIFACT_STATUS_COLORS: Record<ArtifactStatus, string> = {
  PENDING: "#cca700", READY: "#4ec9b0", FAILED: "#f37c7c", ARCHIVED: "#858585", INVALID: "#f0a020",
};
function ArtifactsPanel({ active }: { active: boolean }) {
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lineage, setLineage] = useState<{ ancestors: { artifactId: string; artifactType: string; displayName: string }[]; descendants: { artifactId: string; artifactType: string; displayName: string }[] } | null>(null);
  const [integrityFindings, setIntegrityFindings] = useState<IntegrityFinding[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const body = await fetchIde<ArtifactListResponse>("/api/admin/ide/artifact/list");
    if (body.ok) { setArtifacts(body.artifacts); setError(null); } else { setError(`${body.code} — ${body.message}`); }
    const integrity = await fetchIde<ArtifactIntegrityResponse>("/api/admin/ide/artifact/integrity");
    if (integrity.ok) setIntegrityFindings(integrity.findings);
  }, []);
  useEffect(() => {
    if (!active) return;
    void refresh();
    const interval = setInterval(() => void refresh(), 3000);
    return () => clearInterval(interval);
  }, [active, refresh]);

  const doExpand = useCallback(async (artifactId: string) => {
    if (expandedId === artifactId) { setExpandedId(null); setLineage(null); return; }
    setExpandedId(artifactId);
    const body = await fetchIde<{ ok: true; ancestors: { artifactId: string; artifactType: string; displayName: string }[]; descendants: { artifactId: string; artifactType: string; displayName: string }[] } | { ok: false; code: string; message: string }>(`/api/admin/ide/artifact/${encodeURIComponent(artifactId)}/lineage`);
    setLineage(body.ok ? { ancestors: body.ancestors, descendants: body.descendants } : null);
  }, [expandedId]);

  const doRegenerate = useCallback(async (artifactId: string) => {
    setBusyId(artifactId);
    await postIde<{ ok: boolean }>(`/api/admin/ide/artifact/${encodeURIComponent(artifactId)}/regenerate`, {});
    setBusyId(null);
    void refresh();
  }, [refresh]);

  const findingsForArtifact = (artifactId: string) => integrityFindings.filter((f) => f.artifactId === artifactId);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", fontSize: 11 }}>
      {integrityFindings.length > 0 && (
        <div style={{ padding: "6px 10px", borderBottom: "1px solid #2d2d2d", color: "#f0a020", flexShrink: 0 }}>
          {integrityFindings.length} integrity finding{integrityFindings.length === 1 ? "" : "s"} — see Problems tab for details
        </div>
      )}
      {error && <div style={{ padding: 8, color: "#f37c7c" }}>{error}</div>}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {artifacts.length === 0 && <div style={{ padding: 12, color: "#6a6a6a" }}>No artifacts yet — Save a file, run a command, or run a Governance verification to produce one.</div>}
        {artifacts.map((a) => {
          const artifactFindings = findingsForArtifact(a.artifactId);
          return (
            <div key={a.artifactId} style={{ borderBottom: "1px solid #232323" }}>
              <div onClick={() => doExpand(a.artifactId)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 10px", cursor: "pointer" }}>
                <span style={{ width: 7, height: 7, borderRadius: 4, background: ARTIFACT_STATUS_COLORS[a.status], flexShrink: 0 }} title={a.status} />
                <span style={{ width: 150, flexShrink: 0, color: "#9cdcfe" }}>{a.artifactType}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#ccc" }} title={a.generatedFrom}>
                  {a.generatedFrom}
                  {artifactFindings.length > 0 && <span style={{ marginLeft: 6, padding: "0 5px", borderRadius: 3, background: "#3a1e1e", color: "#f0a0a0", fontSize: 10 }}>{artifactFindings.length} issue{artifactFindings.length === 1 ? "" : "s"}</span>}
                </span>
                <span style={{ width: 50, flexShrink: 0, color: "#858585" }}>v{a.version}</span>
                <span style={{ width: 90, flexShrink: 0, color: "#6a6a6a", fontFamily: "ui-monospace, monospace" }} title={a.checksum}>{a.checksum.slice(0, 10)}</span>
                <span style={{ width: 90, flexShrink: 0, color: "#858585" }}>{a.childIds.length} child{a.childIds.length === 1 ? "" : "ren"}</span>
                <span style={{ width: 90, flexShrink: 0, color: "#858585" }}>{a.parentIds.length} parent{a.parentIds.length === 1 ? "" : "s"}</span>
                <span style={{ width: 100, flexShrink: 0, color: ARTIFACT_STATUS_COLORS[a.status] }}>{a.status}</span>
                <span style={{ width: 90, flexShrink: 0 }}>
                  <button
                    disabled={busyId === a.artifactId}
                    onClick={(e) => { e.stopPropagation(); doRegenerate(a.artifactId); }}
                    style={{ ...miniBtnStyle, opacity: busyId === a.artifactId ? 0.5 : 1 }}
                    title="Only supported for FACTORY_RESULT/ARCHITECTURE_RESULT/REGISTRY_RESULT/GOVERNANCE_RESULT"
                  >
                    Regenerate
                  </button>
                </span>
              </div>
              {expandedId === a.artifactId && (
                <div style={{ padding: "4px 10px 10px 27px", fontSize: 10.5, color: "#aaa" }}>
                  <div style={{ marginBottom: 4 }}>
                    Producer: {a.producer} · Actor: {a.actor} · Created: {new Date(a.createdAt).toLocaleTimeString()} · Size: {a.sizeBytes}B · Immutable: {a.immutable ? "yes" : "no"}
                  </div>
                  <div style={{ marginBottom: 4, color: "#858585" }}>{a.description}</div>
                  {a.jobId && <div>Job: <span style={{ fontFamily: "ui-monospace, monospace" }}>{a.jobId.slice(0, 8)}</span></div>}
                  {a.executionId && <div>Execution: <span style={{ fontFamily: "ui-monospace, monospace" }}>{a.executionId.slice(0, 8)}</span></div>}
                  {a.inspectionId && <div>Inspection: <span style={{ fontFamily: "ui-monospace, monospace" }}>{a.inspectionId.slice(0, 8)}</span></div>}
                  {a.sourceHash && <div>Source Hash: <span style={{ fontFamily: "ui-monospace, monospace" }}>{a.sourceHash.slice(0, 16)}</span></div>}
                  {a.supersedes && <div>Supersedes: <span style={{ fontFamily: "ui-monospace, monospace" }}>{a.supersedes.slice(0, 8)}</span> (previous version)</div>}
                  <div style={{ marginTop: 6, color: "#bbb" }}>Evidence ({a.evidence.length}):</div>
                  {a.evidence.length === 0 ? <div style={{ color: "#6a6a6a" }}>No evidence attached.</div> : a.evidence.map((ev) => (
                    <div key={ev.evidenceId} style={{ padding: "1px 0", color: ev.verifiedReal ? "#8fd3a3" : "#f37c7c" }}>
                      [{ev.kind}:{ev.refId.slice(0, 12)}] {ev.description} {!ev.verifiedReal && "(unverified)"}
                    </div>
                  ))}
                  {lineage && (
                    <>
                      <div style={{ marginTop: 6, color: "#bbb" }}>Lineage — Ancestors ({lineage.ancestors.length}):</div>
                      {lineage.ancestors.length === 0 ? <div style={{ color: "#6a6a6a" }}>None (this is a root artifact).</div> : lineage.ancestors.map((n) => (
                        <div key={n.artifactId} style={{ color: "#9cdcfe" }}>{n.artifactType} — {n.displayName}</div>
                      ))}
                      <div style={{ marginTop: 6, color: "#bbb" }}>Lineage — Descendants ({lineage.descendants.length}):</div>
                      {lineage.descendants.length === 0 ? <div style={{ color: "#6a6a6a" }}>None (leaf artifact so far).</div> : lineage.descendants.map((n) => (
                        <div key={n.artifactId} style={{ color: "#9cdcfe" }}>{n.artifactType} — {n.displayName}</div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- UI Inspection panel — Real Browser Design Intelligence (owner,
// 2026-08-06, Software Factory Step 6). Never a second dashboard — reuses
// the exact same Bottom Console tab-strip / Inspection Pipeline / Artifact
// Pipeline every other panel already uses. Real Chromium via Playwright
// produces every finding; this panel only displays it. ----
const UI_SCAN_STATUS_COLORS: Record<string, string> = { PASSED: "#4ec9b0", WARNING: "#e0c880", FAILED: "#f37c7c" };

function UiInspectionPanel({ active }: { active: boolean }) {
  const [scans, setScans] = useState<UiScanRecord[]>([]);
  const [expandedScanId, setExpandedScanId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InspectionRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [targetType, setTargetType] = useState<"CURRENT_PREVIEW" | "REGISTERED_ROUTE" | "DEPLOYED_URL">("CURRENT_PREVIEW");
  const [route, setRoute] = useState("/admin/ide");
  const [selectedViewports, setSelectedViewports] = useState<string[]>(["DESKTOP_1920_1080", "MOBILE_390_844"]);

  const refresh = useCallback(async () => {
    const body = await fetchIde<UiScanListResponse>("/api/admin/ide/ui-inspection/list");
    if (body.ok) { setScans(body.scans); setError(null); } else { setError(`${body.code} — ${body.message}`); }
  }, []);
  useEffect(() => {
    if (!active) return;
    void refresh();
    const interval = setInterval(() => void refresh(), 3000);
    return () => clearInterval(interval);
  }, [active, refresh]);

  const doExpand = useCallback(async (scanId: string) => {
    if (expandedScanId === scanId) { setExpandedScanId(null); setDetail(null); return; }
    setExpandedScanId(scanId);
    const body = await fetchIde<UiScanDetailResponse>(`/api/admin/ide/ui-inspection/${encodeURIComponent(scanId)}`);
    setDetail(body.ok ? body.inspections : null);
  }, [expandedScanId]);

  const toggleViewport = (id: string) => {
    setSelectedViewports((cur) => cur.includes(id) ? cur.filter((v) => v !== id) : [...cur, id]);
  };

  const doRun = useCallback(async () => {
    if (selectedViewports.length === 0) return;
    setBusy(true);
    setError(null);
    const body = await postIde<UiScanRunResponse>("/api/admin/ide/ui-inspection/run", {
      targetType, route: targetType === "DEPLOYED_URL" ? undefined : route, url: targetType === "DEPLOYED_URL" ? route : undefined,
      viewportProfileIds: selectedViewports,
    });
    if (!body.ok) setError(`${body.code} — ${body.message}`);
    setBusy(false);
    void refresh();
  }, [targetType, route, selectedViewports, refresh]);

  const doCancel = useCallback(async (scanId: string) => {
    await postIde<{ ok: boolean }>(`/api/admin/ide/ui-inspection/${encodeURIComponent(scanId)}/cancel`, {});
    void refresh();
  }, [refresh]);
  const doRerun = useCallback(async (scanId: string) => {
    setBusy(true);
    await postIde<UiScanRunResponse>(`/api/admin/ide/ui-inspection/${encodeURIComponent(scanId)}/rerun`, {});
    setBusy(false);
    void refresh();
  }, [refresh]);

  const openSnapshot = (scanId: string, artifactId: string) => {
    window.open(`/api/admin/ide/ui-inspection/${encodeURIComponent(scanId)}/snapshot/${encodeURIComponent(artifactId)}`, "_blank");
  };

  return (
    <div style={{ height: "100%", display: "flex", minHeight: 0 }}>
      <div style={{ width: 260, flexShrink: 0, borderRight: "1px solid #2d2d2d", display: "flex", flexDirection: "column", padding: 8, gap: 6, overflowY: "auto" }}>
        <select value={targetType} onChange={(e) => setTargetType(e.target.value as typeof targetType)} style={{ background: "#3c3c3c", border: "1px solid #4a4a4a", color: "#ccc", borderRadius: 3, padding: "5px 6px", fontSize: 11.5 }}>
          <option value="CURRENT_PREVIEW">Current Preview (this app)</option>
          <option value="REGISTERED_ROUTE">Registered Route (this app)</option>
          <option value="DEPLOYED_URL">Deployed URL (allowlisted host)</option>
        </select>
        <input
          value={route} onChange={(e) => setRoute(e.target.value)}
          placeholder={targetType === "DEPLOYED_URL" ? "https://..." : "/admin/ide"}
          style={{ background: "#3c3c3c", border: "1px solid #4a4a4a", color: "#ccc", borderRadius: 3, padding: "5px 6px", fontSize: 11.5 }}
        />
        <div style={{ fontSize: 10.5, color: "#bbb", marginTop: 4 }}>Viewports</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {UI_VIEWPORT_CHOICES.map((id) => (
            <button
              key={id} onClick={() => toggleViewport(id)}
              style={{
                fontSize: 9.5, padding: "2px 6px", borderRadius: 8, cursor: "pointer",
                border: selectedViewports.includes(id) ? "1px solid #4da6ff" : "1px solid #3a3a3a",
                background: selectedViewports.includes(id) ? "#1e2d3a" : "#2d2d2d", color: selectedViewports.includes(id) ? "#9cdcfe" : "#858585",
              }}
            >
              {id}
            </button>
          ))}
        </div>
        <button disabled={busy || selectedViewports.length === 0} onClick={doRun} style={{ ...topBtnStyle, opacity: busy || selectedViewports.length === 0 ? 0.5 : 1, marginTop: 4 }}>
          {busy ? "Running…" : "Run Scan"}
        </button>
        {error && <div style={{ color: "#f37c7c", fontSize: 10.5 }}>{error}</div>}
        <div style={{ fontSize: 10, color: "#6a6a6a", marginTop: 4 }}>
          Real Chromium via Playwright. Read-only — never auto-fixes UI, never edits source files or application DOM permanently.
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {scans.length === 0 && <div style={{ padding: 12, color: "#6a6a6a", fontSize: 11.5 }}>No scans yet — configure a target and Run Scan.</div>}
        {scans.map((s) => (
          <div key={s.scanId} style={{ borderBottom: "1px solid #232323" }}>
            <div onClick={() => doExpand(s.scanId)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", cursor: "pointer", fontSize: 11 }}>
              <span style={{ width: 7, height: 7, borderRadius: 4, background: UI_SCAN_STATUS_COLORS[s.status ?? "PASSED"], flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#ccc" }} title={s.targetUrl}>{s.targetUrl}</span>
              <span style={{ width: 130, flexShrink: 0, color: "#858585" }}>{s.viewportsRun.length} viewport(s)</span>
              <span style={{ width: 60, flexShrink: 0, color: "#f37c7c" }}>{s.errorCount ?? 0} err</span>
              <span style={{ width: 70, flexShrink: 0, color: "#e0c880" }}>{s.warningCount ?? 0} warn</span>
              <span style={{ width: 90, flexShrink: 0, color: UI_SCAN_STATUS_COLORS[s.status ?? "PASSED"] }}>{s.status ?? "PASSED"}</span>
              <span style={{ width: 140, flexShrink: 0, display: "flex", gap: 4 }}>
                <button onClick={(e) => { e.stopPropagation(); doRerun(s.scanId); }} style={miniBtnStyle}>Rerun</button>
                <button onClick={(e) => { e.stopPropagation(); doCancel(s.scanId); }} style={miniBtnStyle}>Cancel</button>
              </span>
            </div>
            {expandedScanId === s.scanId && (
              <div style={{ padding: "4px 10px 10px 27px", fontSize: 10.5, color: "#aaa" }}>
                <div style={{ marginBottom: 4 }}>
                  Environment: {s.environment} · Job: <span style={{ fontFamily: "ui-monospace, monospace" }}>{s.jobId?.slice(0, 8) ?? "—"}</span> · Manifest Artifact:{" "}
                  <span style={{ color: "#9cdcfe", cursor: "pointer", textDecoration: "underline" }} onClick={() => openSnapshot(s.scanId, s.manifestArtifactId)}>{s.manifestArtifactId.slice(0, 8)}</span>
                </div>
                {!detail ? <div style={{ color: "#6a6a6a" }}>Loading…</div> : detail.map((rec) => (
                  <div key={rec.inspectionId} style={{ marginBottom: 8 }}>
                    <div style={{ color: "#9cdcfe" }}>
                      {rec.inspectionType} — {rec.status} ({rec.findingCount} finding{rec.findingCount === 1 ? "" : "s"})
                    </div>
                    {rec.findings.map((f) => (
                      <div key={f.findingId} style={{ padding: "2px 0 2px 10px", color: FINDING_SEVERITY_COLOR[f.severity] }}>
                        [{f.code}] {f.message}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Code Review panel — Real Code Review Pipeline & Change Set Assembly
// (owner, 2026-08-06, Software Factory Step 7). Read-only against Source
// Control — no Stage/Commit/Push controls anywhere. Never a second
// dashboard — reuses the exact same Bottom Console tab-strip, and the
// SAME DiffLine/DIFF_LINE_STYLE the Source Control panel's diff viewer
// already established. ----
const CHANGE_SET_STATUS_COLORS: Record<string, string> = {
  DRAFT: "#858585", COLLECTING: "#cca700", READY_FOR_REVIEW: "#9cdcfe", REVIEWING: "#cca700",
  CHANGES_REQUESTED: "#e0a860", APPROVED: "#4ec9b0", REJECTED: "#f37c7c", STALE: "#f0a020", INVALID: "#f37c7c",
};
const REVIEW_RISK_COLORS: Record<string, string> = { LOW: "#4ec9b0", MEDIUM: "#e0c880", HIGH: "#e0a860", CRITICAL: "#f37c7c", UNKNOWN: "#858585" };

function CodeReviewPanel({ active, onOpenFinding }: { active: boolean; onOpenFinding: (relPath: string, line: number, column: number) => void }) {
  const [changeSets, setChangeSets] = useState<ChangeSetClient[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [diffPath, setDiffPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reasonDraft, setReasonDraft] = useState("");

  const refresh = useCallback(async () => {
    const body = await fetchIde<ChangeSetListResponse>("/api/admin/ide/review/change-sets");
    if (body.ok) { setChangeSets(body.changeSets); setError(null); } else { setError(`${body.code} — ${body.message}`); }
  }, []);
  useEffect(() => {
    if (!active) return;
    void refresh();
    const interval = setInterval(() => void refresh(), 4000);
    return () => clearInterval(interval);
  }, [active, refresh]);

  const doCreate = useCallback(async () => {
    setBusy(true);
    const body = await postIde<ChangeSetCreateResponse>("/api/admin/ide/review/change-sets", {});
    if (!body.ok) setError(`${body.code} — ${body.message}`);
    setBusy(false);
    void refresh();
  }, [refresh]);
  const doRefresh = useCallback(async (id: string) => {
    setBusy(true);
    await postIde<ChangeSetActionResponse>(`/api/admin/ide/review/change-sets/${encodeURIComponent(id)}/refresh`, {});
    setBusy(false);
    void refresh();
  }, [refresh]);
  const doReview = useCallback(async (id: string) => {
    setBusy(true);
    const body = await postIde<ChangeSetActionResponse>(`/api/admin/ide/review/change-sets/${encodeURIComponent(id)}/review`, {});
    if (!body.ok) setError(`${body.code} — ${body.message}`);
    setBusy(false);
    void refresh();
  }, [refresh]);
  const doDecision = useCallback(async (id: string, action: "APPROVE" | "REQUEST_CHANGES" | "REJECT") => {
    if (!reasonDraft.trim()) { setError("a reason is required for every review decision"); return; }
    setBusy(true);
    const body = await postIde<ChangeSetDecisionResponse>(`/api/admin/ide/review/change-sets/${encodeURIComponent(id)}/decision`, { action, reason: reasonDraft });
    if (!body.ok) setError(`${body.code} — ${body.message}`); else setReasonDraft("");
    setBusy(false);
    void refresh();
  }, [reasonDraft, refresh]);

  return (
    <div style={{ height: "100%", display: "flex", minHeight: 0 }}>
      <div style={{ width: 240, flexShrink: 0, borderRight: "1px solid #2d2d2d", display: "flex", flexDirection: "column", padding: 8, gap: 6, overflowY: "auto" }}>
        <button disabled={busy} onClick={doCreate} style={{ ...topBtnStyle, opacity: busy ? 0.5 : 1 }}>Create Change Set</button>
        {error && <div style={{ color: "#f37c7c", fontSize: 10.5 }}>{error}</div>}
        <div style={{ fontSize: 10, color: "#6a6a6a", marginTop: 4 }}>
          Read Only against Source Control — no Stage/Commit/Push. &quot;Approved&quot; means passed review in this system only.
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex" }}>
        <div style={{ flex: diffPath ? 1 : 2, minWidth: 0, overflowY: "auto" }}>
          {changeSets.length === 0 && <div style={{ padding: 12, color: "#6a6a6a", fontSize: 11.5 }}>No Change Sets yet — Create Change Set from the current working tree.</div>}
          {changeSets.map((cs) => (
            <div key={cs.changeSetId} style={{ borderBottom: "1px solid #232323" }}>
              <div onClick={() => setExpandedId(expandedId === cs.changeSetId ? null : cs.changeSetId)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", cursor: "pointer", fontSize: 11 }}>
                <span style={{ width: 7, height: 7, borderRadius: 4, background: CHANGE_SET_STATUS_COLORS[cs.status] ?? "#858585", flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#ccc" }} title={cs.title}>{cs.title}</span>
                <span style={{ width: 90, flexShrink: 0, color: "#858585" }}>{cs.changedFiles.length} files</span>
                <span style={{ width: 60, flexShrink: 0, color: "#4ec9b0" }}>+{cs.totalInsertions}</span>
                <span style={{ width: 60, flexShrink: 0, color: "#f37c7c" }}>-{cs.totalDeletions}</span>
                <span style={{ width: 70, flexShrink: 0, color: REVIEW_RISK_COLORS[cs.riskSummary.level] ?? "#858585" }}>{cs.riskSummary.level}</span>
                <span style={{ width: 110, flexShrink: 0, color: CHANGE_SET_STATUS_COLORS[cs.status] ?? "#858585" }}>{cs.status}</span>
              </div>
              {expandedId === cs.changeSetId && (
                <div style={{ padding: "4px 10px 10px 25px", fontSize: 10.5, color: "#aaa" }}>
                  <div style={{ marginBottom: 4 }}>
                    Base: <span style={{ fontFamily: "ui-monospace, monospace" }}>{cs.baseRevision?.slice(0, 10) ?? "—"}</span> · Fingerprint: <span style={{ fontFamily: "ui-monospace, monospace" }}>{cs.workingTreeFingerprint.slice(0, 12)}</span>
                    {cs.stale && <span style={{ marginLeft: 6, padding: "0 5px", borderRadius: 3, background: "#3a2d1e", color: "#e0a860", fontSize: 10 }}>STALE</span>}
                  </div>
                  <div style={{ marginBottom: 4 }}>Factories: {cs.factoriesAffected.join(", ") || "—"}</div>
                  <div style={{ marginBottom: 4 }}>Routes: {cs.routesAffected.join(", ") || "—"}</div>
                  <div style={{ marginBottom: 4 }}>Governance rules affected: {cs.governanceRulesAffected.join(", ") || "—"}</div>
                  {cs.reviewSummary && (
                    <div style={{ marginBottom: 4 }}>
                      Review: {cs.reviewSummary.totalFindings} finding(s), {cs.reviewSummary.blockingFindings} blocking, {cs.reviewSummary.checksRun} check(s) run, {cs.reviewSummary.checksNotImplemented} not implemented
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 4, marginTop: 6, marginBottom: 6, flexWrap: "wrap" }}>
                    <button disabled={busy} onClick={() => doRefresh(cs.changeSetId)} style={miniBtnStyle}>Refresh</button>
                    <button disabled={busy} onClick={() => doReview(cs.changeSetId)} style={miniBtnStyle}>Start Review</button>
                  </div>
                  <input value={reasonDraft} onChange={(e) => setReasonDraft(e.target.value)} placeholder="decision reason (required)" style={{ width: "100%", background: "#3c3c3c", border: "1px solid #4a4a4a", color: "#ccc", borderRadius: 3, padding: "4px 6px", fontSize: 10.5, marginBottom: 4 }} />
                  <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                    <button disabled={busy} onClick={() => doDecision(cs.changeSetId, "APPROVE")} style={miniBtnStyle}>Approve</button>
                    <button disabled={busy} onClick={() => doDecision(cs.changeSetId, "REQUEST_CHANGES")} style={miniBtnStyle}>Request Changes</button>
                    <button disabled={busy} onClick={() => doDecision(cs.changeSetId, "REJECT")} style={miniBtnStyle}>Reject</button>
                  </div>

                  <div style={{ color: "#bbb", marginBottom: 2 }}>Changed Files ({cs.diffFiles.length}):</div>
                  {cs.diffFiles.map((f) => (
                    <div key={f.path} onClick={() => setDiffPath(diffPath === f.path ? null : f.path)} style={{ padding: "2px 0", cursor: "pointer", color: diffPath === f.path ? "#9cdcfe" : "#ccc" }}>
                      [{f.status}] {f.path} <span style={{ color: "#4ec9b0" }}>+{f.additions}</span> <span style={{ color: "#f37c7c" }}>-{f.deletions}</span>
                      {f.binary && <span style={{ marginLeft: 6, color: "#858585" }}>(binary)</span>}
                    </div>
                  ))}

                  {cs.findings.length > 0 && (
                    <>
                      <div style={{ color: "#bbb", margin: "8px 0 2px" }}>Findings ({cs.findings.length}):</div>
                      {cs.findings.map((f) => (
                        <div
                          key={f.reviewFindingId}
                          onClick={() => f.file && f.line != null && onOpenFinding(f.file, f.line, f.column ?? 1)}
                          style={{ padding: "2px 0", color: FINDING_SEVERITY_COLOR[f.severity], cursor: f.file && f.line != null ? "pointer" : "default" }}
                          title={f.evidence}
                        >
                          [{f.checkId}] {f.file ?? "(change set)"} — {f.message}
                          {f.blocking && <span style={{ marginLeft: 6, padding: "0 5px", borderRadius: 3, background: "#3a1e1e", color: "#f0a0a0", fontSize: 10 }}>BLOCKING</span>}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        {diffPath && expandedId && (
          <ChangeSetDiffPane changeSetId={expandedId} path={diffPath} onClose={() => setDiffPath(null)} />
        )}
      </div>
    </div>
  );
}

function ChangeSetDiffPane({ changeSetId, path, onClose }: { changeSetId: string; path: string; onClose: () => void }) {
  const [diffFiles, setDiffFiles] = useState<DiffFileClient[] | null>(null);
  useEffect(() => {
    setDiffFiles(null);
    fetchIde<{ ok: true; diffFiles: DiffFileClient[] } | { ok: false; code: string; message: string }>(`/api/admin/ide/review/change-sets/${encodeURIComponent(changeSetId)}/diff`).then((body) => {
      if (body.ok) setDiffFiles(body.diffFiles);
    });
  }, [changeSetId]);
  const file = diffFiles?.find((f) => f.path === path);
  return (
    <div style={{ flex: 1, minWidth: 0, borderLeft: "1px solid #2d2d2d", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 14, padding: "5px 12px", fontSize: 10.5, color: "#858585", background: "#1a1a1a", borderBottom: "1px solid #1e1e1e", flexShrink: 0 }}>
        <span>{path}</span>
        <span style={{ marginLeft: "auto" }}>Read-only diff — Change Set snapshot</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#858585", cursor: "pointer" }}>✕</button>
      </div>
      <div style={{ flex: 1, overflow: "auto", minWidth: 0, fontSize: 12.5, fontFamily: "ui-monospace, monospace" }}>
        {!file ? <div style={{ padding: 16, color: "#858585" }}>Loading…</div> : file.binary ? (
          <div style={{ padding: 16, color: "#858585" }}>Binary file ({file.status}) — real metadata only, no text diff shown</div>
        ) : file.hunks.length === 0 ? (
          <div style={{ padding: 16, color: "#858585" }}>{file.status === "untracked" ? "Untracked file — no diff against HEAD available yet." : "No real diff content."}</div>
        ) : file.hunks.map((line, i) => {
          const style = DIFF_LINE_STYLE[line.type];
          return (
            <div key={i} style={{ display: "flex", padding: "0 12px", whiteSpace: "pre", background: style.bg, color: style.color }}>
              <span style={{ width: 36, flexShrink: 0, textAlign: "right", marginRight: 6, color: "#5a5a5a", userSelect: "none" }}>{line.oldLine ?? ""}</span>
              <span style={{ width: 36, flexShrink: 0, textAlign: "right", marginRight: 10, color: "#5a5a5a", userSelect: "none" }}>{line.newLine ?? ""}</span>
              <span>{style.prefix}{line.content}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Test Pipeline & Quality Assurance Runtime panel (owner, 2026-08-06,
// Software Factory Step 8) — reuses the exact same Bottom Console tab-strip
// CodeReviewPanel already established. Never a Stage/Commit/Push/Build/
// Deploy control anywhere here — "Run Test" only ever runs the real,
// registered Test Types, never a build. ----
const TEST_RUN_STATUS_COLORS: Record<string, string> = {
  RUNNING: "#9cdcfe", PASSED: "#4ec9b0", FAILED: "#e0a860", BLOCKED: "#f37c7c", CANCELLED: "#858585",
};
const TEST_RESULT_STATUS_COLORS: Record<string, string> = {
  PASSED: "#4ec9b0", FAILED: "#f37c7c", SKIPPED: "#858585", NOT_IMPLEMENTED: "#6a6a6a", CANCELLED: "#858585",
};

function TestPanel({ active, onOpenFinding }: { active: boolean; onOpenFinding: (relPath: string, line: number, column: number) => void }) {
  const [testRuns, setTestRuns] = useState<TestRunClient[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const body = await fetchIde<TestRunListResponse>("/api/admin/ide/test/runs");
    if (body.ok) { setTestRuns(body.testRuns); setError(null); } else { setError(`${body.code} — ${body.message}`); }
  }, []);
  useEffect(() => {
    if (!active) return;
    void refresh();
  }, [active, refresh]);

  const doRun = useCallback(async () => {
    setBusy(true);
    setError(null);
    const body = await postIde<TestRunCreateResponse>("/api/admin/ide/test/runs", {});
    if (!body.ok) setError(`${body.code} — ${body.message}`);
    setBusy(false);
    void refresh();
  }, [refresh]);
  const doRerun = useCallback(async (id: string) => {
    setBusy(true);
    setError(null);
    const body = await postIde<TestRunCreateResponse>(`/api/admin/ide/test/runs/${encodeURIComponent(id)}/rerun`, {});
    if (!body.ok) setError(`${body.code} — ${body.message}`);
    setBusy(false);
    void refresh();
  }, [refresh]);

  return (
    <div style={{ height: "100%", display: "flex", minHeight: 0 }}>
      <div style={{ width: 220, flexShrink: 0, borderRight: "1px solid #2d2d2d", display: "flex", flexDirection: "column", padding: 8, gap: 6, overflowY: "auto" }}>
        <button disabled={busy} onClick={doRun} style={{ ...topBtnStyle, opacity: busy ? 0.5 : 1 }}>{busy ? "Running…" : "Run Test"}</button>
        {error && <div style={{ color: "#f37c7c", fontSize: 10.5 }}>{error}</div>}
        <div style={{ fontSize: 10, color: "#6a6a6a", marginTop: 4 }}>
          Runs the 15 real registered Test Types. Never Build, never Git Write, never Deploy, never Auto-Fix.
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {testRuns.length === 0 && <div style={{ padding: 12, color: "#6a6a6a", fontSize: 11.5 }}>No Test Runs yet — Run Test to execute the real Test Pipeline.</div>}
        {testRuns.map((tr) => {
          const suites = [...new Set(tr.results.map((r) => r.suite))];
          return (
            <div key={tr.testRunId} style={{ borderBottom: "1px solid #232323" }}>
              <div onClick={() => setExpandedId(expandedId === tr.testRunId ? null : tr.testRunId)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", cursor: "pointer", fontSize: 11 }}>
                <span style={{ width: 7, height: 7, borderRadius: 4, background: TEST_RUN_STATUS_COLORS[tr.status] ?? "#858585", flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#ccc" }} title={tr.testRunId}>
                  {new Date(tr.startedAt).toLocaleString()}{tr.sourceChangeSet ? ` — Change Set ${tr.sourceChangeSet.slice(0, 8)}` : ""}
                </span>
                <span style={{ width: 50, flexShrink: 0, color: "#4ec9b0" }}>{tr.passed}✓</span>
                <span style={{ width: 50, flexShrink: 0, color: "#f37c7c" }}>{tr.failed}✗</span>
                <span style={{ width: 90, flexShrink: 0, color: "#6a6a6a" }}>{tr.notImplemented} n/a</span>
                <span style={{ width: 70, flexShrink: 0, color: "#858585" }}>{tr.duration != null ? `${(tr.duration / 1000).toFixed(1)}s` : "—"}</span>
                <span style={{ width: 90, flexShrink: 0, color: TEST_RUN_STATUS_COLORS[tr.status] ?? "#858585" }}>{tr.status}</span>
              </div>
              {expandedId === tr.testRunId && (
                <div style={{ padding: "4px 10px 10px 25px", fontSize: 10.5, color: "#aaa" }}>
                  <div style={{ marginBottom: 6, display: "flex", gap: 10, alignItems: "center" }}>
                    <span>Suites: {suites.join(", ")}</span>
                    <button disabled={busy} onClick={() => doRerun(tr.testRunId)} style={{ ...miniBtnStyle, opacity: busy ? 0.5 : 1 }}>Rerun</button>
                  </div>
                  {tr.blockingReasons.length > 0 && (
                    <div style={{ marginBottom: 6, padding: "4px 8px", borderRadius: 3, background: "#3a1e1e", color: "#f0a0a0" }}>
                      Blocking: {tr.blockingReasons.join(" | ")}
                    </div>
                  )}
                  {tr.results.map((r) => (
                    <div key={r.id} style={{ display: "flex", gap: 8, padding: "3px 0", alignItems: "flex-start" }}>
                      <span style={{ width: 8, height: 8, borderRadius: 4, background: TEST_RESULT_STATUS_COLORS[r.status] ?? "#858585", flexShrink: 0, marginTop: 2 }} />
                      <span style={{ width: 130, flexShrink: 0, color: "#9cdcfe" }}>{r.testTypeId}</span>
                      <span style={{ width: 70, flexShrink: 0, color: TEST_RESULT_STATUS_COLORS[r.status] ?? "#858585" }}>{r.status}</span>
                      <span style={{ width: 60, flexShrink: 0, color: "#6a6a6a" }}>{r.duration}ms</span>
                      <span style={{ flex: 1, minWidth: 0, color: "#888" }}>
                        {r.factoryOwner && <span style={{ marginRight: 6 }}>[{r.factoryOwner}]</span>}
                        {r.blocking && <span style={{ marginRight: 6, padding: "0 5px", borderRadius: 3, background: "#3a1e1e", color: "#f0a0a0", fontSize: 9.5 }}>BLOCKING</span>}
                        {r.failures.slice(0, 3).map((f, i) => <div key={i} style={{ color: "#e0a0a0" }}>{f}</div>)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Real Build Pipeline & Reproducible Build Artifacts panel (owner,
// 2026-08-06, Software Factory Step 9) — reuses the exact same Bottom
// Console tab-strip Test/Code Review panels already established. No
// Release/Deploy/Commit/Push/Stage/Git Write control anywhere here.
const BUILD_RUN_STATUS_COLORS: Record<string, string> = {
  REQUESTED: "#858585", VALIDATING: "#cca700", BLOCKED: "#f37c7c", QUEUED: "#cca700", RUNNING: "#9cdcfe", VERIFYING: "#9cdcfe",
  SUCCEEDED: "#4ec9b0", SUCCEEDED_WITH_WARNINGS: "#e0c880", FAILED: "#f37c7c", TIMED_OUT: "#f37c7c", CANCELLED: "#858585",
  INVALID: "#f37c7c", STALE: "#f0a020", NOT_IMPLEMENTED: "#6a6a6a",
};

function BuildPanel({ active, onOpenFinding }: { active: boolean; onOpenFinding: (relPath: string, line: number, column: number) => void }) {
  const [runs, setRuns] = useState<BuildRunClient[]>([]);
  const [changeSets, setChangeSets] = useState<ChangeSetClient[]>([]);
  const [testRuns, setTestRuns] = useState<TestRunClient[]>([]);
  const [selectedChangeSetId, setSelectedChangeSetId] = useState("");
  const [selectedTestRunId, setSelectedTestRunId] = useState("");
  const [reason, setReason] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [compareTargetId, setCompareTargetId] = useState<Record<string, string>>({});
  const [compareResult, setCompareResult] = useState<{ buildRunId: string; result: ReproducibilityComparisonClient } | null>(null);

  const refresh = useCallback(async () => {
    const body = await fetchIde<BuildRunListResponse>("/api/admin/ide/build/runs");
    if (body.ok) { setRuns(body.runs); setError(null); } else { setError(`${body.code} — ${body.message}`); }
    const cs = await fetchIde<ChangeSetListResponse>("/api/admin/ide/review/change-sets");
    if (cs.ok) setChangeSets(cs.changeSets);
    const tr = await fetchIde<TestRunListResponse>("/api/admin/ide/test/runs");
    if (tr.ok) setTestRuns(tr.testRuns);
  }, []);
  useEffect(() => {
    if (!active) return;
    void refresh();
    const interval = setInterval(() => void refresh(), 4000);
    return () => clearInterval(interval);
  }, [active, refresh]);

  const doRequestBuild = useCallback(async () => {
    if (!selectedChangeSetId || !selectedTestRunId) { setError("select a real Change Set and Test Run first"); return; }
    if (!reason.trim()) { setError("a reason is required for every Build Request"); return; }
    setBusy(true);
    setError(null);
    const body = await postIde<BuildRunCreateResponse>("/api/admin/ide/build/runs", {
      buildTypeIds: ["NEXT_PRODUCTION_BUILD"], sourceChangeSetId: selectedChangeSetId, sourceReviewId: selectedChangeSetId,
      sourceTestRunId: selectedTestRunId, environmentProfileId: "LOCAL_PRODUCTION_BUILD", reason, ownerConfirmation: true,
    });
    if (!body.ok) setError(`${body.code} — ${body.message}`); else setReason("");
    setBusy(false);
    void refresh();
  }, [selectedChangeSetId, selectedTestRunId, reason, refresh]);
  const doCancel = useCallback(async (id: string) => {
    setBusy(true);
    await postIde<BuildRunActionResponse>(`/api/admin/ide/build/runs/${encodeURIComponent(id)}/cancel`, {});
    setBusy(false);
    void refresh();
  }, [refresh]);
  const doRerun = useCallback(async (id: string) => {
    setBusy(true);
    const body = await postIde<BuildRunCreateResponse>(`/api/admin/ide/build/runs/${encodeURIComponent(id)}/rerun`, {});
    if (!body.ok) setError(`${body.code} — ${body.message}`);
    setBusy(false);
    void refresh();
  }, [refresh]);
  const doCompare = useCallback(async (id: string) => {
    const otherId = compareTargetId[id];
    if (!otherId) { setError("select another Build Run to compare against"); return; }
    const body = await postIde<{ ok: true; comparison: ReproducibilityComparisonClient } | { ok: false; code: string; message: string }>(`/api/admin/ide/build/runs/${encodeURIComponent(id)}/compare`, { otherBuildRunId: otherId });
    if (!body.ok) setError(`${body.code} — ${body.message}`);
    else setCompareResult({ buildRunId: id, result: body.comparison });
  }, [compareTargetId]);

  return (
    <div style={{ height: "100%", display: "flex", minHeight: 0 }}>
      <div style={{ width: 260, flexShrink: 0, borderRight: "1px solid #2d2d2d", display: "flex", flexDirection: "column", padding: 8, gap: 6, overflowY: "auto" }}>
        <label style={{ fontSize: 10, color: "#858585" }}>Change Set (APPROVED)</label>
        <select value={selectedChangeSetId} onChange={(e) => setSelectedChangeSetId(e.target.value)} style={{ fontSize: 11, background: "#1e1e1e", color: "#ccc", border: "1px solid #333", borderRadius: 3, padding: "3px 4px" }}>
          <option value="">— select —</option>
          {changeSets.map((cs) => <option key={cs.changeSetId} value={cs.changeSetId}>{cs.title} ({cs.status})</option>)}
        </select>
        <label style={{ fontSize: 10, color: "#858585" }}>Test Run</label>
        <select value={selectedTestRunId} onChange={(e) => setSelectedTestRunId(e.target.value)} style={{ fontSize: 11, background: "#1e1e1e", color: "#ccc", border: "1px solid #333", borderRadius: 3, padding: "3px 4px" }}>
          <option value="">— select —</option>
          {testRuns.map((tr) => <option key={tr.testRunId} value={tr.testRunId}>{new Date(tr.startedAt).toLocaleTimeString()} ({tr.status})</option>)}
        </select>
        <label style={{ fontSize: 10, color: "#858585" }}>Reason</label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="why this Build" style={{ fontSize: 11, background: "#1e1e1e", color: "#ccc", border: "1px solid #333", borderRadius: 3, padding: "3px 4px" }} />
        <button disabled={busy} onClick={doRequestBuild} style={{ ...topBtnStyle, opacity: busy ? 0.5 : 1 }}>{busy ? "Working…" : "Request Build"}</button>
        {error && <div style={{ color: "#f37c7c", fontSize: 10.5 }}>{error}</div>}
        <div style={{ fontSize: 10, color: "#6a6a6a", marginTop: 4 }}>
          Environment Profile: LOCAL_PRODUCTION_BUILD. Never Release, Deploy, Commit, Push, Stage, or Git Write.
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {runs.length === 0 && <div style={{ padding: 12, color: "#6a6a6a", fontSize: 11.5 }}>No Build Runs yet — select an APPROVED Change Set and its Test Run, then Request Build.</div>}
        {runs.map((run) => (
          <div key={run.buildRunId} style={{ borderBottom: "1px solid #232323" }}>
            <div onClick={() => setExpandedId(expandedId === run.buildRunId ? null : run.buildRunId)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", cursor: "pointer", fontSize: 11 }}>
              <span style={{ width: 7, height: 7, borderRadius: 4, background: BUILD_RUN_STATUS_COLORS[run.status] ?? "#858585", flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#ccc" }} title={run.buildRunId}>
                {new Date(run.startedAt).toLocaleString()}
                {run.staleForRelease && <span style={{ marginLeft: 6, padding: "0 5px", borderRadius: 3, background: "#3a2d1e", color: "#e0a860", fontSize: 10 }}>STALE_FOR_RELEASE</span>}
              </span>
              <span style={{ width: 60, flexShrink: 0, color: "#858585" }}>{run.outputFiles.length} files</span>
              <span style={{ width: 90, flexShrink: 0, color: "#858585" }}>{(run.outputBytes / 1024 / 1024).toFixed(1)}MB</span>
              <span style={{ width: 90, flexShrink: 0, color: "#858585" }}>{run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)}s` : "—"}</span>
              <span style={{ width: 130, flexShrink: 0, color: BUILD_RUN_STATUS_COLORS[run.status] ?? "#858585" }}>{run.status}</span>
            </div>
            {expandedId === run.buildRunId && (
              <div style={{ padding: "4px 10px 10px 25px", fontSize: 10.5, color: "#aaa" }}>
                <div style={{ marginBottom: 4 }}>Change Set: {run.sourceChangeSetId.slice(0, 8)} · Test Run: {run.sourceTestRunId.slice(0, 8)} · Env: {run.environmentProfileId}</div>
                <div style={{ marginBottom: 4 }}>Source fingerprint: <span style={{ fontFamily: "ui-monospace, monospace" }}>{run.sourceFingerprintBefore.slice(0, 16)}</span> · Exit code: {run.exitCode ?? "—"}</div>
                {run.blockingReasons.length > 0 && (
                  <div style={{ marginBottom: 6, padding: "4px 8px", borderRadius: 3, background: "#3a1e1e", color: "#f0a0a0" }}>
                    Blocked: {run.blockingReasons.join(" | ")}
                  </div>
                )}
                {run.decision && (
                  <div style={{ marginBottom: 6, padding: "4px 8px", borderRadius: 3, background: run.decision.decision === "ALLOWED" ? "#1e3a2d" : "#3a1e1e", color: run.decision.decision === "ALLOWED" ? "#4ec9b0" : "#f0a0a0" }}>
                    Decision: {run.decision.decision} — {run.decision.reasons[0]}
                  </div>
                )}
                {run.gateReport && (
                  <div style={{ marginBottom: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {run.gateReport.gates.map((g) => (
                      <span key={g.gate} title={g.evidence} style={{
                        fontSize: 9.5, padding: "1px 6px", borderRadius: 8,
                        background: g.status === "PASSED" ? "#1e3a2d" : g.status === "FAILED" || g.status === "BLOCKED" ? "#3a1e1e" : "#2a2a2a",
                        color: g.status === "PASSED" ? "#4ec9b0" : g.status === "FAILED" || g.status === "BLOCKED" ? "#f0a0a0" : "#888",
                      }}>
                        {g.gate}: {g.status}
                      </span>
                    ))}
                  </div>
                )}
                {run.registryGateAnalysis && run.registryGateAnalysis.falsePositives.length > 0 && (
                  <div style={{ marginBottom: 6, padding: "4px 8px", borderRadius: 3, background: "#1e2d3a", color: "#9cdcfe" }}>
                    Registry Gate: {run.registryGateAnalysis.evidence}
                  </div>
                )}
                {run.migrationIntegrity && run.migrationIntegrity.conflicts.length > 0 && (
                  <div style={{ marginBottom: 6, padding: "4px 8px", borderRadius: 3, background: "#3a2d1e", color: "#e0a860" }}>
                    Migration Integrity: {run.migrationIntegrity.conflicts.length} real duplicate-timestamp conflict(s) across {run.migrationIntegrity.totalMigrations} real migrations
                  </div>
                )}
                {run.manifest && (
                  <div style={{ marginBottom: 6 }}>
                    Manifest: {run.manifest.routeCount} routes ({run.manifest.staticRouteCount} static / {run.manifest.dynamicRouteCount} dynamic) · Integrity: {run.manifest.integrityStatus} · Reproducibility: {run.manifest.reproducibilityStatus}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                  {(run.status === "RUNNING" || run.status === "VERIFYING") && <button disabled={busy} onClick={() => doCancel(run.buildRunId)} style={miniBtnStyle}>Cancel</button>}
                  <button disabled={busy} onClick={() => doRerun(run.buildRunId)} style={miniBtnStyle}>Rerun</button>
                  <select value={compareTargetId[run.buildRunId] ?? ""} onChange={(e) => setCompareTargetId((s) => ({ ...s, [run.buildRunId]: e.target.value }))} style={{ fontSize: 10, background: "#1e1e1e", color: "#ccc", border: "1px solid #333", borderRadius: 3 }}>
                    <option value="">— compare against —</option>
                    {runs.filter((r) => r.buildRunId !== run.buildRunId).map((r) => <option key={r.buildRunId} value={r.buildRunId}>{r.buildRunId.slice(0, 8)}</option>)}
                  </select>
                  <button disabled={busy} onClick={() => doCompare(run.buildRunId)} style={miniBtnStyle}>Compare Build</button>
                </div>
                {compareResult?.buildRunId === run.buildRunId && (
                  <div style={{ marginBottom: 6, padding: "4px 8px", borderRadius: 3, background: "#1e2d3a", color: "#9cdcfe" }}>
                    Reproducibility: {compareResult.result.status} — matched {compareResult.result.matchedFiles}, mismatched {compareResult.result.mismatchedFiles?.length ?? 0}
                  </div>
                )}
                {[...run.failures, ...run.warnings].map((f) => (
                  <div
                    key={f.findingId}
                    onClick={() => f.file && f.line != null && onOpenFinding(f.file, f.line, f.column ?? 1)}
                    style={{ padding: "2px 0", color: f.blocking ? "#f37c7c" : "#e0c880", cursor: f.file && f.line != null ? "pointer" : "default" }}
                  >
                    [{f.category}] {f.message.slice(0, 160)}
                    {f.blocking && <span style={{ marginLeft: 6, padding: "0 5px", borderRadius: 3, background: "#3a1e1e", color: "#f0a0a0", fontSize: 9.5 }}>BLOCKING</span>}
                  </div>
                ))}
                {run.outputFiles.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ color: "#bbb", marginBottom: 2 }}>Output Inventory ({run.outputFiles.length} files):</div>
                    {run.outputFiles.slice(0, 30).map((f) => (
                      <div key={f.relativePath} style={{ display: "flex", gap: 8, color: f.status === "OK" ? "#888" : "#e0a860" }}>
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.relativePath}</span>
                        <span style={{ width: 60, flexShrink: 0 }}>{f.type}</span>
                        <span style={{ width: 70, flexShrink: 0 }}>{(f.size / 1024).toFixed(1)}KB</span>
                        <span style={{ width: 80, flexShrink: 0 }}>{f.status}</span>
                      </div>
                    ))}
                    {run.outputFiles.length > 30 && <div style={{ color: "#6a6a6a" }}>…and {run.outputFiles.length - 30} more real files</div>}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Release Pipeline, Capability Packaging & Operational Readiness
// panel (owner, 2026-08-07, Software Factory Step 10) — reuses the exact
// same Bottom Console tab-strip Build/Test panels already established.
// No Deploy/Git Write control anywhere here — "Request Release" only
// ever validates a real, already-successful Build Run.
const RELEASE_RUN_STATUS_COLORS: Record<string, string> = {
  REQUESTED: "#858585", VALIDATING: "#cca700", BLOCKED: "#f37c7c", PACKAGING: "#9cdcfe", APPROVING: "#9cdcfe",
  READY: "#4ec9b0", FAILED: "#f37c7c",
};

function ReleasePanel({ active }: { active: boolean }) {
  const [runs, setRuns] = useState<ReleaseRunClient[]>([]);
  const [buildRuns, setBuildRuns] = useState<BuildRunClient[]>([]);
  const [selectedBuildRunId, setSelectedBuildRunId] = useState("");
  const [reason, setReason] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const body = await fetchIde<ReleaseRunListResponse>("/api/admin/ide/release/runs");
    if (body.ok) { setRuns(body.runs); setError(null); } else { setError(`${body.code} — ${body.message}`); }
    const b = await fetchIde<BuildRunListResponse>("/api/admin/ide/build/runs");
    if (b.ok) setBuildRuns(b.runs);
  }, []);
  useEffect(() => {
    if (!active) return;
    void refresh();
    const interval = setInterval(() => void refresh(), 4000);
    return () => clearInterval(interval);
  }, [active, refresh]);

  const doRequestRelease = useCallback(async () => {
    if (!selectedBuildRunId) { setError("select a real Build Run first"); return; }
    if (!reason.trim()) { setError("a reason is required for every Release Request"); return; }
    setBusy(true);
    setError(null);
    const body = await postIde<ReleaseRunCreateResponse>("/api/admin/ide/release/runs", { buildRunId: selectedBuildRunId, reason, ownerConfirmation: true });
    if (!body.ok) setError(`${body.code} — ${body.message}`); else setReason("");
    setBusy(false);
    void refresh();
  }, [selectedBuildRunId, reason, refresh]);
  const doRerun = useCallback(async (id: string) => {
    setBusy(true);
    const body = await postIde<ReleaseRunCreateResponse>(`/api/admin/ide/release/runs/${encodeURIComponent(id)}/rerun`, {});
    if (!body.ok) setError(`${body.code} — ${body.message}`);
    setBusy(false);
    void refresh();
  }, [refresh]);

  return (
    <div style={{ height: "100%", display: "flex", minHeight: 0 }}>
      <div style={{ width: 260, flexShrink: 0, borderRight: "1px solid #2d2d2d", display: "flex", flexDirection: "column", padding: 8, gap: 6, overflowY: "auto" }}>
        <label style={{ fontSize: 10, color: "#858585" }}>Build Run (SUCCEEDED)</label>
        <select value={selectedBuildRunId} onChange={(e) => setSelectedBuildRunId(e.target.value)} style={{ fontSize: 11, background: "#1e1e1e", color: "#ccc", border: "1px solid #333", borderRadius: 3, padding: "3px 4px" }}>
          <option value="">— select —</option>
          {buildRuns.map((b) => <option key={b.buildRunId} value={b.buildRunId}>{new Date(b.startedAt).toLocaleTimeString()} ({b.status})</option>)}
        </select>
        <label style={{ fontSize: 10, color: "#858585" }}>Reason</label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="why this Release" style={{ fontSize: 11, background: "#1e1e1e", color: "#ccc", border: "1px solid #333", borderRadius: 3, padding: "3px 4px" }} />
        <button disabled={busy} onClick={doRequestRelease} style={{ ...topBtnStyle, opacity: busy ? 0.5 : 1 }}>{busy ? "Working…" : "Request Release"}</button>
        {error && <div style={{ color: "#f37c7c", fontSize: 10.5 }}>{error}</div>}
        <div style={{ fontSize: 10, color: "#6a6a6a", marginTop: 4 }}>
          Real Capability Packaging + Operational Readiness only. Never Deploy, never Git Write.
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {runs.length === 0 && <div style={{ padding: 12, color: "#6a6a6a", fontSize: 11.5 }}>No Release Runs yet — select a real SUCCEEDED Build Run, then Request Release.</div>}
        {runs.map((run) => (
          <div key={run.releaseRunId} style={{ borderBottom: "1px solid #232323" }}>
            <div onClick={() => setExpandedId(expandedId === run.releaseRunId ? null : run.releaseRunId)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", cursor: "pointer", fontSize: 11 }}>
              <span style={{ width: 7, height: 7, borderRadius: 4, background: RELEASE_RUN_STATUS_COLORS[run.status] ?? "#858585", flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#ccc" }} title={run.releaseRunId}>
                {new Date(run.startedAt).toLocaleString()} — {run.reason}
              </span>
              <span style={{ width: 90, flexShrink: 0, color: "#858585" }}>{run.packages.length} packages</span>
              <span style={{ width: 130, flexShrink: 0, color: run.operationalReadiness ? (run.operationalReadiness.overallStatus === "ALL_READY" ? "#4ec9b0" : "#e0a860") : "#858585" }}>{run.operationalReadiness?.overallStatus ?? "—"}</span>
              <span style={{ width: 110, flexShrink: 0, color: RELEASE_RUN_STATUS_COLORS[run.status] ?? "#858585" }}>{run.status}</span>
            </div>
            {expandedId === run.releaseRunId && (
              <div style={{ padding: "4px 10px 10px 25px", fontSize: 10.5, color: "#aaa" }}>
                <div style={{ marginBottom: 4 }}>Build Run: {run.buildRunId.slice(0, 8)} · Candidate fingerprint: <span style={{ fontFamily: "ui-monospace, monospace" }}>{run.releaseCandidate?.sourceFingerprint.slice(0, 16) ?? "—"}</span></div>
                {run.decision && (
                  <div style={{ marginBottom: 6, padding: "4px 8px", borderRadius: 3, background: run.decision.decision === "ALLOWED" ? "#1e3a2d" : "#3a1e1e", color: run.decision.decision === "ALLOWED" ? "#4ec9b0" : "#f0a0a0" }}>
                    Decision: {run.decision.decision} — {run.decision.reasons[0]}
                  </div>
                )}
                {run.packageIntegrity && (
                  <div style={{ marginBottom: 6 }}>
                    Package Integrity: {run.packageIntegrity.status} — {run.packageIntegrity.totalPackages} real packages, {run.packageIntegrity.findings.length} real finding(s)
                  </div>
                )}
                {run.operationalReadiness && (
                  <div style={{ marginBottom: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {run.operationalReadiness.dimensions.map((d) => (
                      <span key={d.dimension} title={d.evidence} style={{
                        fontSize: 9.5, padding: "1px 6px", borderRadius: 8,
                        background: d.status === "PASSED" ? "#1e3a2d" : d.status === "FAILED" || d.status === "BLOCKED" ? "#3a1e1e" : "#2a2a2a",
                        color: d.status === "PASSED" ? "#4ec9b0" : d.status === "FAILED" || d.status === "BLOCKED" ? "#f0a0a0" : "#888",
                      }}>
                        {d.dimension}: {d.status}
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                  <button disabled={busy} onClick={() => doRerun(run.releaseRunId)} style={miniBtnStyle}>Rerun</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Factory Completion panel (owner, 2026-08-07, Software Factory
// Step 10.5) — reuses the exact same Bottom Console tab-strip. Pure
// read-only view over the real, live Factory Completion Report — every
// number here is computed by factoryCompletionRuntime.ts from real
// fs/registry evidence, never a second, invented dashboard number.
const FACTORY_STATUS_COLORS: Record<string, string> = {
  COMPLETE: "#4ec9b0", OPERATIONAL: "#4ec9b0", PARTIAL: "#e0a860", DECLARED: "#e0a860",
  UI_ONLY: "#f0a0a0", CONTRACT_ONLY: "#f0a0a0", NOT_IMPLEMENTED: "#f37c7c", BLOCKED: "#f37c7c",
  STALE: "#858585", UNKNOWN: "#858585", DUPLICATED: "#cca700", MISPLACED: "#cca700",
};
const GATE_STATUS_COLORS: Record<string, string> = {
  PASSED: "#4ec9b0", PARTIAL: "#e0a860", BLOCKED: "#f37c7c", NOT_IMPLEMENTED: "#f37c7c", UNKNOWN: "#858585",
};

// ---- Real Factory Completion Report (owner, 2026-08-07, Software Factory
// Step 10.5) — client types mirror factoryCompletionRuntime.ts's real shapes. ----
type SystemStatusClient = "COMPLETE" | "OPERATIONAL" | "PARTIAL" | "DECLARED" | "UI_ONLY" | "CONTRACT_ONLY" | "NOT_IMPLEMENTED" | "BLOCKED" | "STALE" | "UNKNOWN" | "DUPLICATED" | "MISPLACED";
interface SystemCompletionRecordClient {
  id: string; name: string; name_th: string; factoryOwner: string; layer: string; responsibility: string;
  sourceFiles: string[]; routes: string[]; registries: string[]; tests: string[];
  runtimeEvidence: { path: string; exists: boolean }[];
  status: SystemStatusClient; completionPercent: number; evidence: string[]; limitations: string[]; nextRequiredAction: string;
}
interface ChainStageRecordClient { stage: string; status: "IMPLEMENTED" | "PARTIAL" | "NOT_IMPLEMENTED" | "MANUAL" | "EXTERNAL_TOOL_DEPENDENT" | "DNA_OS_NATIVE"; evidence: string }
interface ExternalDependencyRecordClient {
  tool: string; whyRequired: string; currentDependency: string; dnaOsReplacementAvailable: boolean;
  replacementStatus: string; blockingOwnerMigration: boolean; evidence: string;
  classification: "INTERNAL_MACHINE_TOOL" | "TEMPORARY_CONSTRUCTION_TOOL" | "PERMANENT_EXTERNAL_PROVIDER" | "REPLACEABLE_PROVIDER" | "OWNER_VISIBLE_DEPENDENCY" | "OWNER_HIDDEN_DEPENDENCY";
}
interface PrincipleRecordClient { principle: string; level: "DOCUMENT_ONLY" | "CODE_ENFORCED" | "RUNTIME_ENFORCED" | "BUILD_ENFORCED" | "TEST_ENFORCED" | "ARCHITECTURE_ISOLATED" | "PARTIAL" | "MISSING"; evidence: string }
interface DataBoundaryClaimClient { claim: string; status: "PROVEN" | "PARTIAL" | "UNKNOWN"; evidence: string }
interface CapabilityReuseFoundationClient {
  registryComplete: boolean; totalCapabilities: number; withInputContract: number; withOutputContract: number;
  withDependencies: number; resolverExists: boolean; note: string;
}
interface CompletionGateClient { id: string; status: "PASSED" | "PARTIAL" | "BLOCKED" | "NOT_IMPLEMENTED" | "UNKNOWN"; blocking: boolean; checks: string[]; evidence: string[]; missing: string[]; ownerDecisionRequired: boolean }
interface FactoryCompletionReportClient {
  generatedAt: string; totalSystems: number; byStatus: Record<string, number>;
  completionByFactory: Record<string, { count: number; avgCompletion: number }>;
  systems: SystemCompletionRecordClient[]; endToEndChain: ChainStageRecordClient[];
  vscodeDependencies: ExternalDependencyRecordClient[]; nativeDNAEnforcement: PrincipleRecordClient[];
  dataBoundaryStatus: DataBoundaryClaimClient[]; capabilityReuseReadiness: CapabilityReuseFoundationClient;
  completionGates: CompletionGateClient[]; criticalBlockers: string[];
}

function FactoryCompletionPanel({ active }: { active: boolean }) {
  const [report, setReport] = useState<FactoryCompletionReportClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedSystem, setExpandedSystem] = useState<string | null>(null);
  const [section, setSection] = useState<"systems" | "chain" | "vscode" | "dna" | "gates">("gates");

  const refresh = useCallback(async () => {
    const body = await fetchIde<{ ok: boolean; report?: FactoryCompletionReportClient; code?: string; message?: string }>("/api/admin/ide/factory-completion");
    if (body.ok) { setReport(body.report ?? null); setError(null); } else { setError(`${body.code} — ${body.message}`); }
  }, []);
  useEffect(() => {
    if (!active) return;
    void refresh();
    const interval = setInterval(() => void refresh(), 8000);
    return () => clearInterval(interval);
  }, [active, refresh]);

  if (error) return <div style={{ padding: 12, color: "#f37c7c", fontSize: 11.5 }}>{error}</div>;
  if (!report) return <div style={{ padding: 12, color: "#6a6a6a", fontSize: 11.5 }}>Loading real Factory Completion Report…</div>;

  const sections: { id: typeof section; label: string }[] = [
    { id: "gates", label: `Gates (${report.criticalBlockers.length} blockers)` },
    { id: "systems", label: `Systems (${report.totalSystems})` },
    { id: "chain", label: "End-to-End Chain" },
    { id: "vscode", label: "VS Code Dependency" },
    { id: "dna", label: "Native DNA" },
  ];

  return (
    <div style={{ height: "100%", display: "flex", minHeight: 0 }}>
      <div style={{ width: 200, flexShrink: 0, borderRight: "1px solid #2d2d2d", display: "flex", flexDirection: "column", padding: 8, gap: 4, overflowY: "auto" }}>
        {sections.map((s) => (
          <button key={s.id} onClick={() => setSection(s.id)} style={{ ...topBtnStyle, textAlign: "left", background: section === s.id ? "#2d2d2d" : "transparent" }}>{s.label}</button>
        ))}
        <div style={{ fontSize: 10, color: "#6a6a6a", marginTop: 8 }}>
          Real, evidence-derived report. Never a fabricated 100%. Generated {new Date(report.generatedAt).toLocaleString()}.
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 10, fontSize: 11 }}>
        {section === "gates" && (
          <div>
            {report.completionGates.map((g) => (
              <div key={g.id} style={{ marginBottom: 8, padding: "6px 8px", borderRadius: 3, border: "1px solid #2a2a2a" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 4, background: GATE_STATUS_COLORS[g.status] ?? "#858585", flexShrink: 0 }} />
                  <span style={{ color: "#ccc", fontWeight: 600 }}>{g.id}</span>
                  <span style={{ color: GATE_STATUS_COLORS[g.status] ?? "#858585" }}>{g.status}</span>
                  {g.blocking && <span style={{ fontSize: 9.5, padding: "1px 5px", borderRadius: 6, background: "#3a1e1e", color: "#f0a0a0" }}>blocking</span>}
                  {g.ownerDecisionRequired && <span style={{ fontSize: 9.5, padding: "1px 5px", borderRadius: 6, background: "#2a2a2a", color: "#e0a860" }}>owner decision required</span>}
                </div>
                {g.evidence.length > 0 && <div style={{ color: "#858585", marginTop: 4 }}>{g.evidence.join("; ")}</div>}
                {g.missing.length > 0 && <div style={{ color: "#f0a0a0", marginTop: 2 }}>Missing: {g.missing.join(", ")}</div>}
              </div>
            ))}
          </div>
        )}
        {section === "systems" && (
          <div>
            {report.systems.map((s) => (
              <div key={s.id} style={{ borderBottom: "1px solid #232323" }}>
                <div onClick={() => setExpandedSystem(expandedSystem === s.id ? null : s.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 4px", cursor: "pointer" }}>
                  <span style={{ width: 7, height: 7, borderRadius: 4, background: FACTORY_STATUS_COLORS[s.status] ?? "#858585", flexShrink: 0 }} />
                  <span style={{ flex: 1, color: "#ccc" }}>{s.name}</span>
                  <span style={{ width: 60, textAlign: "right", color: "#858585" }}>{s.completionPercent}%</span>
                  <span style={{ width: 110, textAlign: "right", color: FACTORY_STATUS_COLORS[s.status] ?? "#858585" }}>{s.status}</span>
                </div>
                {expandedSystem === s.id && (
                  <div style={{ padding: "2px 10px 8px 25px", color: "#aaa", fontSize: 10.5 }}>
                    <div>{s.responsibility}</div>
                    {s.evidence.map((e: string, i: number) => <div key={i} style={{ color: "#4ec9b0" }}>✓ {e}</div>)}
                    {s.limitations.map((l: string, i: number) => <div key={i} style={{ color: "#f0a0a0" }}>⚠ {l}</div>)}
                    <div style={{ color: "#858585", marginTop: 2 }}>Next: {s.nextRequiredAction}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {section === "chain" && (
          <div>
            {report.endToEndChain.map((c) => (
              <div key={c.stage} style={{ display: "flex", gap: 8, padding: "4px 2px", borderBottom: "1px solid #1c1c1c" }}>
                <span style={{ width: 170, color: "#ccc", flexShrink: 0 }}>{c.stage}</span>
                <span style={{ width: 170, flexShrink: 0, color: c.status === "DNA_OS_NATIVE" ? "#4ec9b0" : c.status === "NOT_IMPLEMENTED" ? "#f37c7c" : "#e0a860" }}>{c.status}</span>
                <span style={{ color: "#858585" }}>{c.evidence}</span>
              </div>
            ))}
          </div>
        )}
        {section === "vscode" && (
          <div>
            {report.vscodeDependencies.map((v, i) => (
              <div key={i} style={{ marginBottom: 8, padding: "6px 8px", borderRadius: 3, border: "1px solid #2a2a2a" }}>
                <div style={{ color: "#ccc", fontWeight: 600 }}>{v.tool} {v.blockingOwnerMigration && <span style={{ color: "#f37c7c" }}>(blocking)</span>}</div>
                <div style={{ color: "#858585", marginTop: 2 }}>{v.evidence}</div>
                <div style={{ color: "#e0a860", marginTop: 2 }}>{v.replacementStatus}</div>
              </div>
            ))}
          </div>
        )}
        {section === "dna" && (
          <div>
            {report.nativeDNAEnforcement.map((p, i) => (
              <div key={i} style={{ display: "flex", gap: 8, padding: "4px 2px", borderBottom: "1px solid #1c1c1c" }}>
                <span style={{ width: 260, color: "#ccc", flexShrink: 0 }}>{p.principle}</span>
                <span style={{ width: 150, flexShrink: 0, color: ["RUNTIME_ENFORCED", "ARCHITECTURE_ISOLATED", "CODE_ENFORCED", "BUILD_ENFORCED", "TEST_ENFORCED"].includes(p.level) ? "#4ec9b0" : p.level === "MISSING" ? "#f37c7c" : "#e0a860" }}>{p.level}</span>
                <span style={{ color: "#858585" }}>{p.evidence}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Operations panel (owner, 2026-08-08, Software Factory Step 12) —
// reuses the exact same Bottom Console tab-strip. Monitoring/Incident/
// Recovery are all real, live Runtimes — every number here drills down
// to real Evidence/Artifacts. Never displays HEALTHY from missing data.
const MONITORING_STATUS_COLORS: Record<string, string> = {
  HEALTHY: "#4ec9b0", DEGRADED: "#e0a860", UNHEALTHY: "#f37c7c", STALE: "#cca700",
  MISSING: "#f37c7c", UNKNOWN: "#858585", NOT_IMPLEMENTED: "#858585",
};
const SEVERITY_COLORS: Record<string, string> = { INFO: "#858585", LOW: "#9cdcfe", MEDIUM: "#e0a860", HIGH: "#f0a0a0", CRITICAL: "#f37c7c" };

// ---- Real Operations Runtimes (owner, 2026-08-08, Software Factory Step
// 12/12.5) — client types mirror monitoringRuntime.ts/incidentRuntime.ts/
// recoveryRuntime.ts/alertRuntime.ts/backupRuntime.ts/restoreTestRuntime.ts's
// real shapes exactly. ----
type MonitoringStatusClient = "HEALTHY" | "DEGRADED" | "UNHEALTHY" | "STALE" | "MISSING" | "UNKNOWN" | "NOT_IMPLEMENTED";
interface SignalRecordClient {
  signalId: string; signalType: string; source: string; scope: string; observedAt: string; evaluatedAt: string;
  rawReference: string; normalizedValue: unknown; status: MonitoringStatusClient; severity: string; reason: string;
  sourceHash: string; evidence: string[]; relatedRuntime: string | null; relatedProvider: string | null;
  relatedWorkspace: string | null; relatedDeploymentPlan: string | null; ownerId: string; actor: string;
}
interface MonitoringSummaryClient {
  computedAt: string; total: number; byStatus: Record<MonitoringStatusClient, number>;
  overallStatus: "HEALTHY" | "DEGRADED" | "UNHEALTHY" | "UNKNOWN";
}
interface OwnerDecisionRequiredClient { kind: string; id: string; reason: string }
interface OperationsStatusClient {
  generatedAt: string; monitoring: MonitoringSummaryClient;
  incidents: { total: number; open: number; critical: number };
  recovery: { total: number; blocked: number; unverified: number };
  staleOrMissingSignals: number; ownerDecisionsRequired: OwnerDecisionRequiredClient[];
}
interface IncidentTimelineEntryClient { at: string; status: string; note: string; actor: string }
interface IncidentRecordClient {
  incidentId: string; type: string; title: string; status: string; severity: string; openedAt: string;
  lastObservedAt: string; affectedScopes: string[]; affectedDependencies: string[]; signals: string[];
  evidence: string[]; observedCause: string; inferredCause: string | null; recoveryPlanId: string | null;
  ownerDecisionRequired: boolean; timeline: IncidentTimelineEntryClient[]; sourceFingerprint: string;
  ownerId: string; actor: string; artifactIds: string[];
}
interface RecoveryPrerequisiteClient { description: string; met: boolean; evidence: string }
interface RecoveryVerificationCheckClient { criterion: string; result: "PASS" | "FAIL" | "UNKNOWN"; evidence: string }
interface RecoveryVerificationResultClient { status: "UNKNOWN" | "UNVERIFIED" | "PARTIAL" | "VERIFIED"; checkedAt: string; checks: RecoveryVerificationCheckClient[]; reason: string }
interface RecoveryPlanClient {
  recoveryPlanId: string; incidentId: string; recoveryType: string; target: string;
  prerequisites: RecoveryPrerequisiteClient[]; steps: string[]; expectedOutcome: string; risks: string[];
  rollbackPlan: string; approvalRequired: boolean; approvalStatus: "PENDING" | "APPROVED" | "REJECTED";
  executionStatus: string; verificationCriteria: string[]; evidence: string[]; limitations: string;
  createdAt: string; actor: string; ownerId: string; verification: RecoveryVerificationResultClient | null; artifactIds: string[];
}
interface ChannelDispatchResultClient { channel: string; attempted: boolean; ok: boolean; detail: string; dispatchedAt: string | null }
interface AlertRecordClient {
  alertId: string; incidentId: string; severity: string; title: string; reason: string;
  status: "CREATED" | "QUEUED" | "DISPATCHED" | "DELIVERED" | "FAILED" | "SUPPRESSED" | "ACKNOWLEDGED" | "UNKNOWN";
  channelResults: ChannelDispatchResultClient[]; suppressionReason: string | null; escalationState: "NONE" | "ESCALATED";
  acknowledgedAt: string | null; acknowledgedBy: string | null; createdAt: string; evidence: string[];
  artifactIds: string[]; ownerId: string; actor: string;
}
interface BackupManifestClient { created_at: string; tables: number; success: number; errors: number; total_rows: number; error_details?: string[]; checksums?: Record<string, string> }
interface BackupRecordClient { backupId: string; path: string; manifest: BackupManifestClient; discoveredAt: string }
interface RestoreTestStageResultClient {
  stage: string; status: "NOT_STARTED" | "RUNNING" | "PASSED" | "FAILED" | "BLOCKED" | "SKIPPED" | "UNKNOWN";
  startedAt: string | null; finishedAt: string | null; evidence: string; failureReason: string | null;
  mutationScope: "NONE" | "ISOLATED_TARGET_ONLY"; cleanupStatus: "NOT_APPLICABLE" | "CLEAN";
}
interface RestoreTestRunClient {
  restoreTestId: string; backupId: string; status: "PLAN_ONLY" | "PARTIAL" | "FAILED"; stages: RestoreTestStageResultClient[];
  createdAt: string; finishedAt: string | null; ownerId: string; actor: string; artifactIds: string[]; limitations: string;
}
interface SchedulerContractStatusClient {
  contract: "IMPLEMENTED"; adapter: "NOT_IMPLEMENTED" | "COMPATIBILITY_ONLY" | "IMPLEMENTED";
  loop: "MANUAL_TRIGGER_ONLY" | "PARTIAL" | "CONTINUOUS"; evidence: string[];
}
interface OperationsReadinessClient { generatedAt: string; gates: CompletionGateClient[]; schedulerContract: SchedulerContractStatusClient }

function OperationsPanel({ active }: { active: boolean }) {
  const [section, setSection] = useState<"status" | "signals" | "incidents" | "recovery" | "alerts" | "backups" | "readiness">("status");
  const [status, setStatus] = useState<OperationsStatusClient | null>(null);
  const [signals, setSignals] = useState<SignalRecordClient[]>([]);
  const [incidents, setIncidents] = useState<IncidentRecordClient[]>([]);
  const [plans, setPlans] = useState<RecoveryPlanClient[]>([]);
  const [alerts, setAlerts] = useState<AlertRecordClient[]>([]);
  const [backups, setBackups] = useState<BackupRecordClient[]>([]);
  const [restoreTests, setRestoreTests] = useState<RestoreTestRunClient[]>([]);
  const [readiness, setReadiness] = useState<OperationsReadinessClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [s, sig, inc, rp, al, bk, rt, rd] = await Promise.all([
      fetchIde<{ ok: boolean; status?: OperationsStatusClient; code?: string; message?: string }>("/api/admin/ide/operations/status"),
      fetchIde<{ ok: boolean; signals?: SignalRecordClient[] }>("/api/admin/ide/operations/monitoring/signals"),
      fetchIde<{ ok: boolean; incidents?: IncidentRecordClient[] }>("/api/admin/ide/operations/incidents"),
      fetchIde<{ ok: boolean; plans?: RecoveryPlanClient[] }>("/api/admin/ide/operations/recovery/plans"),
      fetchIde<{ ok: boolean; alerts?: AlertRecordClient[] }>("/api/admin/ide/operations/alerts"),
      fetchIde<{ ok: boolean; backups?: BackupRecordClient[] }>("/api/admin/ide/operations/backups"),
      fetchIde<{ ok: boolean; restoreTests?: RestoreTestRunClient[] }>("/api/admin/ide/operations/restore-tests"),
      fetchIde<{ ok: boolean; readiness?: OperationsReadinessClient }>("/api/admin/ide/operations/readiness"),
    ]);
    if (s.ok) { setStatus(s.status ?? null); setError(null); } else setError(`${s.code} — ${s.message}`);
    if (sig.ok) setSignals(sig.signals ?? []);
    if (inc.ok) setIncidents(inc.incidents ?? []);
    if (rp.ok) setPlans(rp.plans ?? []);
    if (al.ok) setAlerts(al.alerts ?? []);
    if (bk.ok) setBackups(bk.backups ?? []);
    if (rt.ok) setRestoreTests(rt.restoreTests ?? []);
    if (rd.ok) setReadiness(rd.readiness ?? null);
  }, []);
  useEffect(() => {
    if (!active) return;
    void refresh();
    const interval = setInterval(() => void refresh(), 10000);
    return () => clearInterval(interval);
  }, [active, refresh]);

  const doCollect = useCallback(async () => {
    setBusy(true);
    const body = await postIde<{ ok: boolean; code?: string; message?: string }>("/api/admin/ide/operations/monitoring/collect", {});
    if (!body.ok) setError(`${body.code} — ${body.message}`);
    setBusy(false);
    void refresh();
  }, [refresh]);
  const doRunLoop = useCallback(async () => {
    setBusy(true);
    const body = await postIde<{ ok: boolean; code?: string; message?: string }>("/api/admin/ide/operations/loop/run", {});
    if (!body.ok) setError(`${body.code} — ${body.message}`);
    setBusy(false);
    void refresh();
  }, [refresh]);
  const doOpenIncident = useCallback(async (signalId: string) => {
    setBusy(true);
    const body = await postIde<{ ok: boolean; code?: string; message?: string }>("/api/admin/ide/operations/incidents", { signalId });
    if (!body.ok) setError(`${body.code} — ${body.message}`);
    setBusy(false);
    void refresh();
  }, [refresh]);
  const doAcknowledge = useCallback(async (alertId: string) => {
    setBusy(true);
    const body = await postIde<{ ok: boolean; code?: string; message?: string }>(`/api/admin/ide/operations/alerts/${alertId}/acknowledge`, { note: "acknowledged by owner via Operations tab" });
    if (!body.ok) setError(`${body.code} — ${body.message}`);
    setBusy(false);
    void refresh();
  }, [refresh]);
  const doVerifyBackup = useCallback(async (backupId: string) => {
    setBusy(true);
    const body = await postIde<{ ok: boolean; code?: string; message?: string }>(`/api/admin/ide/operations/backups/${backupId}/verify`, {});
    if (!body.ok) setError(`${body.code} — ${body.message}`);
    setBusy(false);
    void refresh();
  }, [refresh]);
  const doRunRestoreTest = useCallback(async (backupId: string) => {
    setBusy(true);
    const body = await postIde<{ ok: boolean; code?: string; message?: string }>("/api/admin/ide/operations/restore-tests", { backupId });
    if (!body.ok) setError(`${body.code} — ${body.message}`);
    setBusy(false);
    void refresh();
  }, [refresh]);

  if (!status) return <div style={{ padding: 12, color: "#6a6a6a", fontSize: 11.5 }}>{error ?? "Loading real Operations status…"}</div>;

  const sections: { id: typeof section; label: string }[] = [
    { id: "status", label: `Status (${status.ownerDecisionsRequired.length} decisions)` },
    { id: "signals", label: `Signals (${signals.length})` },
    { id: "incidents", label: `Incidents (${status.incidents.open})` },
    { id: "recovery", label: `Recovery (${status.recovery.total})` },
    { id: "alerts", label: `Alerts (${alerts.length})` },
    { id: "backups", label: `Backups (${backups.length})` },
    { id: "readiness", label: "Readiness" },
  ];

  return (
    <div style={{ height: "100%", display: "flex", minHeight: 0 }}>
      <div style={{ width: 220, flexShrink: 0, borderRight: "1px solid #2d2d2d", display: "flex", flexDirection: "column", padding: 8, gap: 4, overflowY: "auto" }}>
        {sections.map((s) => (
          <button key={s.id} onClick={() => setSection(s.id)} style={{ ...topBtnStyle, textAlign: "left", background: section === s.id ? "#2d2d2d" : "transparent" }}>{s.label}</button>
        ))}
        <button disabled={busy} onClick={doCollect} style={{ ...topBtnStyle, opacity: busy ? 0.5 : 1, marginTop: 8 }}>{busy ? "Working…" : "Collect Signals Now"}</button>
        <button disabled={busy} onClick={doRunLoop} style={{ ...topBtnStyle, opacity: busy ? 0.5 : 1 }}>{busy ? "Working…" : "Run Operations Loop"}</button>
        {error && <div style={{ color: "#f37c7c", fontSize: 10.5, marginTop: 6 }}>{error}</div>}
        <div style={{ fontSize: 10, color: "#6a6a6a", marginTop: 8 }}>
          Observe-only. Never mutates production. Missing/stale signal is never shown as HEALTHY.
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 10, fontSize: 11 }}>
        {section === "status" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ width: 9, height: 9, borderRadius: 5, background: MONITORING_STATUS_COLORS[status.monitoring.overallStatus] ?? "#858585" }} />
              <span style={{ fontWeight: 600, color: "#ccc" }}>Overall: {status.monitoring.overallStatus}</span>
              <span style={{ color: "#858585" }}>({status.monitoring.total} real signals)</span>
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
              {Object.entries(status.monitoring.byStatus).map(([k, v]) => v > 0 && (
                <span key={k} style={{ fontSize: 9.5, padding: "1px 6px", borderRadius: 8, background: "#2a2a2a", color: MONITORING_STATUS_COLORS[k] ?? "#858585" }}>{k}: {v}</span>
              ))}
            </div>
            <div style={{ color: "#ccc", marginBottom: 4 }}>Incidents: {status.incidents.total} total, {status.incidents.open} open, {status.incidents.critical} critical</div>
            <div style={{ color: "#ccc", marginBottom: 4 }}>Recovery: {status.recovery.total} total, {status.recovery.blocked} blocked, {status.recovery.unverified} unverified</div>
            <div style={{ color: "#ccc", marginBottom: 10 }}>Stale/Missing signals: {status.staleOrMissingSignals}</div>
            <div style={{ color: "#e0a860", fontWeight: 600, marginBottom: 4 }}>Owner Decisions Required ({status.ownerDecisionsRequired.length})</div>
            {status.ownerDecisionsRequired.map((d, i) => (
              <div key={i} style={{ padding: "3px 0", color: "#e0a860" }}>[{d.kind}] {d.id.slice(0, 8)} — {d.reason}</div>
            ))}
          </div>
        )}
        {section === "signals" && (
          <div>
            {signals.map((s) => (
              <div key={s.signalId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px", borderBottom: "1px solid #1c1c1c" }}>
                <span style={{ width: 7, height: 7, borderRadius: 4, background: MONITORING_STATUS_COLORS[s.status] ?? "#858585", flexShrink: 0 }} />
                <span style={{ width: 190, flexShrink: 0, color: "#ccc" }}>{s.signalType}</span>
                <span style={{ width: 90, flexShrink: 0, color: MONITORING_STATUS_COLORS[s.status] ?? "#858585" }}>{s.status}</span>
                <span style={{ flex: 1, color: "#858585", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.reason}>{s.reason}</span>
                {(s.status === "UNHEALTHY" || s.status === "DEGRADED" || s.status === "STALE" || s.status === "MISSING") && (
                  <button disabled={busy} onClick={() => doOpenIncident(s.signalId)} style={{ ...topBtnStyle, fontSize: 9.5, padding: "1px 6px" }}>Open Incident</button>
                )}
              </div>
            ))}
          </div>
        )}
        {section === "incidents" && (
          <div>
            {incidents.map((inc) => (
              <div key={inc.incidentId} style={{ marginBottom: 8, padding: "6px 8px", borderRadius: 3, border: "1px solid #2a2a2a" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 4, background: SEVERITY_COLORS[inc.severity] ?? "#858585", flexShrink: 0 }} />
                  <span style={{ color: "#ccc", fontWeight: 600 }}>{inc.type}</span>
                  <span style={{ color: SEVERITY_COLORS[inc.severity] }}>{inc.severity}</span>
                  <span style={{ color: "#858585" }}>{inc.status}</span>
                </div>
                <div style={{ color: "#858585", marginTop: 3 }}>{inc.title}</div>
                <div style={{ color: "#6a6a6a", marginTop: 2 }}>observed: {inc.observedCause}</div>
                {inc.inferredCause && <div style={{ color: "#9cdcfe", marginTop: 2 }}>{inc.inferredCause}</div>}
              </div>
            ))}
            {incidents.length === 0 && <div style={{ color: "#6a6a6a" }}>No real Incidents open.</div>}
          </div>
        )}
        {section === "recovery" && (
          <div>
            {plans.map((p) => (
              <div key={p.recoveryPlanId} style={{ marginBottom: 8, padding: "6px 8px", borderRadius: 3, border: "1px solid #2a2a2a" }}>
                <div style={{ color: "#ccc", fontWeight: 600 }}>{p.recoveryType}</div>
                <div style={{ color: "#858585", marginTop: 2 }}>execution: {p.executionStatus} · approval: {p.approvalStatus}</div>
                {p.verification && <div style={{ color: p.verification.status === "VERIFIED" ? "#4ec9b0" : "#e0a860", marginTop: 2 }}>verification: {p.verification.status} — {p.verification.reason}</div>}
                <div style={{ color: "#6a6a6a", marginTop: 2 }}>{p.limitations}</div>
              </div>
            ))}
            {plans.length === 0 && <div style={{ color: "#6a6a6a" }}>No real Recovery Plans yet.</div>}
          </div>
        )}
        {section === "alerts" && (
          <div>
            {alerts.map((a) => (
              <div key={a.alertId} style={{ marginBottom: 8, padding: "6px 8px", borderRadius: 3, border: "1px solid #2a2a2a" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 4, background: SEVERITY_COLORS[a.severity] ?? "#858585", flexShrink: 0 }} />
                  <span style={{ color: "#ccc", fontWeight: 600 }}>{a.title}</span>
                  <span style={{ color: a.status === "DISPATCHED" ? "#4ec9b0" : a.status === "SUPPRESSED" ? "#858585" : a.status === "ACKNOWLEDGED" ? "#9cdcfe" : "#f0a0a0" }}>{a.status}</span>
                  {a.status === "DISPATCHED" && !a.acknowledgedAt && (
                    <button disabled={busy} onClick={() => doAcknowledge(a.alertId)} style={{ ...topBtnStyle, fontSize: 9.5, padding: "1px 6px" }}>Acknowledge</button>
                  )}
                </div>
                <div style={{ color: "#858585", marginTop: 2 }}>{a.reason}</div>
                {a.suppressionReason && <div style={{ color: "#6a6a6a", marginTop: 2 }}>suppressed: {a.suppressionReason}</div>}
                {a.channelResults?.length > 0 && (
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                    {a.channelResults.map((c, i) => (
                      <span key={i} title={c.detail} style={{ fontSize: 9.5, padding: "1px 6px", borderRadius: 8, background: "#2a2a2a", color: c.ok ? "#4ec9b0" : "#f0a0a0" }}>{c.channel}: {c.attempted ? (c.ok ? "ok" : "fail") : "not attempted"}</span>
                    ))}
                  </div>
                )}
                <div style={{ color: "#6a6a6a", marginTop: 2, fontSize: 9.5 }}>DISPATCHED never implies DELIVERED — no real delivery receipt exists for any channel.</div>
              </div>
            ))}
            {alerts.length === 0 && <div style={{ color: "#6a6a6a" }}>No real Alerts yet.</div>}
          </div>
        )}
        {section === "backups" && (
          <div>
            {backups.map((b) => (
              <div key={b.backupId} style={{ marginBottom: 8, padding: "6px 8px", borderRadius: 3, border: "1px solid #2a2a2a" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "#ccc", fontWeight: 600 }}>{b.backupId}</span>
                  <button disabled={busy} onClick={() => doVerifyBackup(b.backupId)} style={{ ...topBtnStyle, fontSize: 9.5, padding: "1px 6px" }}>Verify Integrity</button>
                  <button disabled={busy} onClick={() => doRunRestoreTest(b.backupId)} style={{ ...topBtnStyle, fontSize: 9.5, padding: "1px 6px" }}>Run Restore Test (dry-run)</button>
                </div>
                <div style={{ color: "#858585", marginTop: 2 }}>{b.manifest.success}/{b.manifest.tables} tables, {b.manifest.total_rows} rows, {b.manifest.errors} error(s) — created {new Date(b.manifest.created_at).toLocaleString()}</div>
              </div>
            ))}
            {backups.length === 0 && <div style={{ color: "#6a6a6a" }}>No real backups discovered.</div>}
            <div style={{ color: "#e0a860", fontWeight: 600, marginTop: 12, marginBottom: 4 }}>Restore Tests ({restoreTests.length})</div>
            {restoreTests.map((r) => (
              <div key={r.restoreTestId} style={{ marginBottom: 6, padding: "4px 8px", borderRadius: 3, border: "1px solid #2a2a2a" }}>
                <div style={{ color: "#ccc" }}>{r.backupId} — <span style={{ color: r.status === "FAILED" ? "#f0a0a0" : "#e0a860" }}>{r.status}</span></div>
                <div style={{ color: "#6a6a6a", fontSize: 9.5, marginTop: 2 }}>{r.limitations}</div>
              </div>
            ))}
          </div>
        )}
        {section === "readiness" && readiness && (
          <div>
            {readiness.gates.map((g) => (
              <div key={g.id} style={{ marginBottom: 8, padding: "6px 8px", borderRadius: 3, border: "1px solid #2a2a2a" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 4, background: GATE_STATUS_COLORS[g.status] ?? "#858585", flexShrink: 0 }} />
                  <span style={{ color: "#ccc", fontWeight: 600 }}>{g.id}</span>
                  <span style={{ color: GATE_STATUS_COLORS[g.status] ?? "#858585" }}>{g.status}</span>
                </div>
                {g.evidence.map((e: string, i: number) => <div key={i} style={{ color: "#858585", marginTop: 2 }}>{e}</div>)}
                {g.missing.map((m: string, i: number) => <div key={i} style={{ color: "#f0a0a0", marginTop: 2 }}>missing: {m}</div>)}
              </div>
            ))}
            <div style={{ color: "#e0a860", fontWeight: 600, marginTop: 8 }}>Scheduler Contract</div>
            <div style={{ color: "#858585", marginTop: 2 }}>contract: {readiness.schedulerContract.contract} · adapter: {readiness.schedulerContract.adapter} · loop: {readiness.schedulerContract.loop}</div>
            {readiness.schedulerContract.evidence.map((e: string, i: number) => <div key={i} style={{ color: "#6a6a6a", fontSize: 9.5, marginTop: 2 }}>{e}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Factory Workspace panel (owner, 2026-08-08, Software Factory Step
// 13). The one, real place the Owner starts and tracks work: Intent ->
// Capability Resolver -> Context Plan -> Execution Plan -> Native File
// Change Flow -> Result. Every action here calls a real, owner-scoped
// API route — nothing here is mocked or simulated.
const WORKSPACE_STATUS_COLORS: Record<string, string> = {
  DRAFT: "#858585", ANALYZING: "#9cdcfe", CAPABILITY_MATCHING: "#9cdcfe", CONTEXT_PREPARING: "#9cdcfe",
  AWAITING_OWNER: "#e0a860", READY_FOR_EXECUTION: "#4ec9b0", EXECUTING: "#9cdcfe", REVIEWING: "#9cdcfe",
  TESTING: "#9cdcfe", BUILDING: "#9cdcfe", RELEASE_CANDIDATE: "#4ec9b0", BLOCKED: "#f37c7c",
  COMPLETED: "#4ec9b0", CANCELLED: "#858585", UNKNOWN: "#858585",
};
const RESULT_STATUS_COLORS: Record<string, string> = {
  OUTCOME_PROVEN: "#4ec9b0", TECHNICALLY_COMPLETE: "#9cdcfe", PARTIAL: "#e0a860", BLOCKED: "#f37c7c",
  UNVERIFIED: "#858585", FAILED: "#f37c7c", UNKNOWN: "#858585",
};
const fwInputStyle: React.CSSProperties = {
  background: "#1e1e1e", border: "1px solid #3c3c3c", borderRadius: 3, color: "#ccc", fontSize: 11, padding: "4px 6px", outline: "none",
};

// ---- Real Factory Workspace Runtime (owner, 2026-08-08, Software Factory
// Step 13/13.6) — client types mirror factoryWorkspaceRuntime.ts/
// capabilityResolverRuntime.ts/codeWorkerRuntime.ts/workerRegistry.ts/
// workerAdapter.ts/workerSelectorRuntime.ts's real shapes exactly. ----
interface OwnerDecisionRecordClient {
  decisionId: string; gate: string; requiredReason: string; options: string[]; evidence: string[];
  impact: string; owner: string; decidedAt: string | null; decision: "APPROVED" | "REJECTED" | "PENDING";
}
interface CapabilityMatchClient {
  capabilityId: string; matchClass: string; score: number; domainScore: number; dependencyScore: number;
  evidenceScore: number; lifecycleScore: number; reasons: string[]; danglingDependencies: string[];
}
interface CapabilityResolutionReportClient {
  computedAt: string; intentKeywords: string[]; matches: CapabilityMatchClient[]; selected: CapabilityMatchClient[];
  missing: string[]; overallClass: string; sourceFingerprint: string;
}
interface OutcomeReportClient {
  status: "OUTCOME_PROVEN" | "TECHNICALLY_COMPLETE" | "PARTIAL" | "BLOCKED" | "UNVERIFIED" | "FAILED" | "UNKNOWN";
  intentReceived: boolean; capabilitiesReused: string[]; capabilitiesMissing: string[]; workerUsed: string[];
  providerCalled: string[]; filesChanged: string[]; testsRun: { passed: number; failed: number } | null;
  buildResult: string | null; governanceResult: string | null; artifactIds: string[]; evidenceIds: string[];
  costReal: number | null; durationMs: number | null; limitations: string[]; realWorldReadiness: string;
  ownerActionsRequired: string[]; computedAt: string;
}
interface WorkspaceSessionClient {
  workspaceSessionId: string; ownerId: string; actor: string; intentId: string | null; desiredOutcome: string;
  constraints: string[]; acceptanceCriteria: string[]; businessContext: string; legalContext: string;
  costLimit: number | null; timeLimit: string | null; riskLevel: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
  sourceScope: string[]; capabilityResolution: CapabilityResolutionReportClient | null; contextPlanId: string | null;
  executionPlanId: string | null; aiContextPackageIds: string[]; changeSetId: string | null; reviewRunId: string | null;
  testRunId: string | null; buildRunId: string | null; releaseRunId: string | null; artifactIds: string[];
  evidenceIds: string[]; ownerDecisions: OwnerDecisionRecordClient[]; status: string; blockers: string[];
  resultReport: OutcomeReportClient | null; createdAt: string; updatedAt: string;
}
interface WorkerDefinitionClient {
  id: string; displayName: string; capabilities: string[]; limitations: string[]; inputContract: string;
  outputContract: string; provider: string; executionMode: string; locality: string; costModel: string;
  availability: "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN"; evidenceRequirements: string[]; permittedTools: string[];
  status: "ACTIVE" | "CONFIGURED" | "PARTIAL" | "COMPATIBILITY_ONLY" | "NOT_IMPLEMENTED" | "UNKNOWN";
}
interface WorkerAvailabilityClient { available: boolean; reason: string }
interface WorkerAdapterInfoClient {
  id: string; type: "API" | "CLI" | "MCP" | "LOCAL_RUNTIME" | "REMOTE_RUNTIME" | "HUMAN"; provider: string;
  capabilities: string[]; availability: WorkerAvailabilityClient; limitations: string[];
}
interface WorkerHealthReportClient {
  status: "HEALTHY" | "DEGRADED" | "NOT_CONFIGURED" | "UNAVAILABLE" | "UNKNOWN"; reason: string;
  lastLiveCallAt: string | null; lastLiveCallOk: boolean | null;
}
interface WorkerSelectionResultClient {
  outcome: string; selectedAdapterId: string | null; fallbackChain: string[]; reasons: string[];
  candidatesConsidered: { adapterId: string; eligible: boolean; reason: string }[];
}
type SessionActionResponse = { ok: boolean; code?: string; message?: string };
interface ProposedFileRejectionClient { path: string; reason: string }
interface ProposedOperationClient { path: string; operation: "CREATE" | "MODIFY" | "DELETE" | "RENAME"; content: string | null; purpose: string; risk: string }
interface CodeWorkerProposalClient {
  proposalId: string; workspaceSessionId: string; contextPlanId: string; executionStepId: string; ok: boolean;
  error: string | null; answer: string | null; operations: ProposedOperationClient[]; files: { path: string; content: string }[]; rejectedFiles: ProposedFileRejectionClient[];
  requiresDestructiveApproval: boolean; destructiveApproved: boolean; destructiveApprovedAt: string | null;
  workerAdapterId: string | null; provider: string; model: string | null;
  cost: { amount: number | null; currency: string | null; kind: "ACTUAL" | "ESTIMATED" | "UNKNOWN" } | null;
  selection: WorkerSelectionResultClient | null; requestId: string | null; evidenceId: string | null;
  approved: boolean; approvedAt: string | null; applied: boolean; appliedAt: string | null; createdAt: string;
  ownerId: string; actor: string; artifactIds: string[];
}

function FactoryWorkspacePanel({ active }: { active: boolean }) {
  const [sessions, setSessions] = useState<WorkspaceSessionClient[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [session, setSession] = useState<WorkspaceSessionClient | null>(null);
  const [workers, setWorkers] = useState<WorkerDefinitionClient[]>([]);
  const [result, setResult] = useState<OutcomeReportClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [problem, setProblem] = useState("");
  const [desiredOutcome, setDesiredOutcome] = useState("");
  const [requestedChange, setRequestedChange] = useState("");
  const [proposalTask, setProposalTask] = useState("");
  const [proposal, setProposal] = useState<CodeWorkerProposalClient | null>(null);
  const [workerAdapters, setWorkerAdapters] = useState<WorkerAdapterInfoClient[]>([]);
  const [selectedAdapterId, setSelectedAdapterId] = useState<string>("");
  const [adapterHealth, setAdapterHealth] = useState<Record<string, WorkerHealthReportClient>>({});

  const refreshList = useCallback(async () => {
    const [s, w, wa] = await Promise.all([
      fetchIde<{ ok: boolean; sessions?: WorkspaceSessionClient[] }>("/api/admin/ide/factory-workspace/sessions"),
      fetchIde<{ ok: boolean; workers?: WorkerDefinitionClient[] }>("/api/admin/ide/factory-workspace/workers"),
      fetchIde<{ ok: boolean; adapters?: WorkerAdapterInfoClient[] }>("/api/admin/ide/workers"),
    ]);
    if (s.ok) setSessions(s.sessions ?? []);
    if (w.ok) setWorkers(w.workers ?? []);
    if (wa.ok) setWorkerAdapters(wa.adapters ?? []);
  }, []);
  const doCheckAdapterHealth = useCallback(async (adapterId: string) => {
    const res = await fetchIde<{ ok: boolean; health?: WorkerHealthReportClient }>(`/api/admin/ide/workers/${adapterId}/health`);
    if (res.ok) setAdapterHealth((prev) => (res.health ? { ...prev, [adapterId]: res.health } : prev));
  }, []);
  const refreshSession = useCallback(async (id: string) => {
    const s = await fetchIde<{ ok: boolean; session?: WorkspaceSessionClient; code?: string; message?: string }>(`/api/admin/ide/factory-workspace/sessions/${id}`);
    if (s.ok) { setSession(s.session ?? null); setError(null); } else setError(`${s.code} — ${s.message}`);
  }, []);
  useEffect(() => { if (!active) return; void refreshList(); }, [active, refreshList]);
  useEffect(() => { if (selectedId) void refreshSession(selectedId); }, [selectedId, refreshSession]);

  const call = useCallback(async <T extends SessionActionResponse = SessionActionResponse>(path: string, body: unknown = {}): Promise<T | undefined> => {
    if (!selectedId) return;
    setBusy(true);
    const res = await postIde<T>(`/api/admin/ide/factory-workspace/sessions/${selectedId}${path}`, body);
    if (!res.ok) setError(`${res.code} — ${res.message}`); else setError(null);
    setBusy(false);
    void refreshSession(selectedId);
    void refreshList();
    return res;
  }, [selectedId, refreshSession, refreshList]);

  const doCreate = useCallback(async () => {
    setBusy(true);
    const res = await postIde<{ ok: boolean; session?: WorkspaceSessionClient; code?: string; message?: string }>("/api/admin/ide/factory-workspace/sessions", {});
    setBusy(false);
    if (res.ok && res.session) { setSelectedId(res.session.workspaceSessionId); void refreshList(); } else setError(`${res.code} — ${res.message}`);
  }, [refreshList]);

  const doCaptureIntent = useCallback(async () => {
    await call("/intent", {
      raw: `${problem} ${requestedChange}`.trim(),
      structured: { problem, desiredOutcome, requestedChange, affectedArea: [], constraints: [], nonGoals: [], expectedEvidence: [], acceptanceCriteria: [], ownerAuthority: "OWNER_CONFIRMED", riskTolerance: "LOW" },
    });
  }, [call, problem, desiredOutcome, requestedChange]);
  const doConfirmIntent = useCallback(() => call("/decide", { gate: "INTENT_CONFIRMED", decision: "APPROVED", reason: "Owner confirmed real Intent via Factory Workspace tab" }), [call]);
  const doResolveCapabilities = useCallback(() => call("/resolve-capabilities"), [call]);
  const doPrepareContext = useCallback(() => call("/prepare-context", {}), [call]);
  const doApproveContext = useCallback(() => call("/approve-context", { reason: "Owner reviewed real Context Plan scope via Factory Workspace tab" }), [call]);
  const doCreatePlan = useCallback(() => call("/create-plan"), [call]);
  const doApprovePlan = useCallback(() => call("/approve-plan"), [call]);
  const doGenerateProposal = useCallback(async () => {
    const stepId = session?.executionPlanId ? `${session.executionPlanId}:step-2` : "adhoc-step";
    const ownerPreference = selectedAdapterId ? [selectedAdapterId] : [];
    const res = await call<SessionActionResponse & { proposal?: CodeWorkerProposalClient }>("/generate-proposal", { executionStepId: stepId, taskDescription: proposalTask || problem, acceptanceCriteria: session?.acceptanceCriteria ?? [], ownerPreference });
    if (res?.ok) setProposal(res.proposal ?? null);
  }, [call, proposalTask, problem, session, selectedAdapterId]);
  const doApproveProposal = useCallback(async () => {
    if (!proposal) return;
    const res = await call<SessionActionResponse & { proposal?: CodeWorkerProposalClient }>("/approve-proposal", { proposalId: proposal.proposalId, reason: "Owner reviewed real CODE_WORKER diff via Factory Workspace tab" });
    if (res?.ok) setProposal(res.proposal ?? null);
  }, [call, proposal]);
  const doExecute = useCallback(() => call("/execute", { title: problem || "Native Factory change" }), [call, problem]);
  const doApproveReview = useCallback(() => call("/approve-review", { reason: "Owner approved real Review via Factory Workspace tab" }), [call]);
  const doBuild = useCallback(() => call("/build", {}), [call]);
  const doRelease = useCallback(() => call("/release", { reason: "Owner approved real Release Candidate via Factory Workspace tab" }), [call]);
  const doResult = useCallback(async () => {
    if (!selectedId) return;
    const res = await fetchIde<{ ok: boolean; result?: OutcomeReportClient }>(`/api/admin/ide/factory-workspace/sessions/${selectedId}/result`);
    if (res.ok) setResult(res.result ?? null);
  }, [selectedId]);

  return (
    <div style={{ height: "100%", display: "flex", minHeight: 0 }}>
      <div style={{ width: 240, flexShrink: 0, borderRight: "1px solid #2d2d2d", display: "flex", flexDirection: "column", padding: 8, gap: 4, overflowY: "auto" }}>
        <button disabled={busy} onClick={doCreate} style={{ ...topBtnStyle, opacity: busy ? 0.5 : 1 }}>{busy ? "Working…" : "+ New Workspace Session"}</button>
        {sessions.map((s) => (
          <button key={s.workspaceSessionId} onClick={() => setSelectedId(s.workspaceSessionId)} style={{ ...topBtnStyle, textAlign: "left", background: selectedId === s.workspaceSessionId ? "#2d2d2d" : "transparent" }}>
            <span style={{ width: 7, height: 7, borderRadius: 4, background: WORKSPACE_STATUS_COLORS[s.status] ?? "#858585", display: "inline-block", marginRight: 6 }} />
            {s.workspaceSessionId.slice(0, 8)} — {s.status}
          </button>
        ))}
        {error && <div style={{ color: "#f37c7c", fontSize: 10.5, marginTop: 6 }}>{error}</div>}
        <div style={{ fontSize: 10, color: "#6a6a6a", marginTop: 8 }}>
          Human owns Intent and Approval. DNA OS owns Context, Capability, Execution Plan, Evidence. AI is a Worker only.
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 10, fontSize: 11 }}>
        {!session && <div style={{ color: "#6a6a6a" }}>Select or create a real Workspace Session.</div>}
        {session && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ width: 9, height: 9, borderRadius: 5, background: WORKSPACE_STATUS_COLORS[session.status] ?? "#858585" }} />
              <span style={{ fontWeight: 600, color: "#ccc" }}>{session.workspaceSessionId}</span>
              <span style={{ color: WORKSPACE_STATUS_COLORS[session.status] ?? "#858585" }}>{session.status}</span>
            </div>

            {session.blockers.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                {session.blockers.map((b: string, i: number) => <div key={i} style={{ color: "#f37c7c" }}>blocked: {b}</div>)}
              </div>
            )}

            <div style={{ color: "#e0a860", fontWeight: 600, marginBottom: 4 }}>1. Intent</div>
            {!session.intentId ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10, maxWidth: 480 }}>
                <input placeholder="Problem" value={problem} onChange={(e) => setProblem(e.target.value)} style={fwInputStyle} />
                <input placeholder="Desired Outcome" value={desiredOutcome} onChange={(e) => setDesiredOutcome(e.target.value)} style={fwInputStyle} />
                <input placeholder="Requested Change" value={requestedChange} onChange={(e) => setRequestedChange(e.target.value)} style={fwInputStyle} />
                <button disabled={busy || !problem || !desiredOutcome || !requestedChange} onClick={doCaptureIntent} style={{ ...topBtnStyle, alignSelf: "flex-start" }}>Capture Intent</button>
              </div>
            ) : (
              <div style={{ marginBottom: 10 }}>
                <div style={{ color: "#858585" }}>real Intent {session.intentId.slice(0, 8)} attached</div>
                {!session.ownerDecisions.some((d) => d.gate === "INTENT_CONFIRMED" && d.decision === "APPROVED") && (
                  <button disabled={busy} onClick={doConfirmIntent} style={{ ...topBtnStyle, marginTop: 4 }}>Confirm Intent (Owner Decision Gate)</button>
                )}
              </div>
            )}

            <div style={{ color: "#e0a860", fontWeight: 600, marginBottom: 4 }}>2. Capability Resolver</div>
            <div style={{ marginBottom: 10 }}>
              {!session.capabilityResolution ? (
                <button disabled={busy || session.status !== "CAPABILITY_MATCHING"} onClick={doResolveCapabilities} style={topBtnStyle}>Resolve Capabilities</button>
              ) : (
                <div>
                  <div style={{ color: "#858585" }}>overall: {session.capabilityResolution.overallClass} · {session.capabilityResolution.selected.length} selected of {session.capabilityResolution.matches.length} matched</div>
                  {session.capabilityResolution.selected.map((m) => (
                    <div key={m.capabilityId} style={{ color: "#4ec9b0", marginTop: 2 }}>{m.capabilityId} — {m.matchClass} (score {m.score.toFixed(2)})</div>
                  ))}
                  {session.capabilityResolution.missing.map((m: string, i: number) => <div key={i} style={{ color: "#f0a0a0", marginTop: 2 }}>missing: {m}</div>)}
                </div>
              )}
            </div>

            <div style={{ color: "#e0a860", fontWeight: 600, marginBottom: 4 }}>3. Context Plan</div>
            <div style={{ marginBottom: 10 }}>
              {!session.contextPlanId ? (
                <button disabled={busy || !session.capabilityResolution} onClick={doPrepareContext} style={topBtnStyle}>Prepare Context Plan</button>
              ) : (
                <div>
                  <div style={{ color: "#858585" }}>real Context Plan {session.contextPlanId.slice(0, 8)}</div>
                  {!session.ownerDecisions.some((d) => d.gate === "CONTEXT_SCOPE_APPROVED" && d.decision === "APPROVED") && (
                    <button disabled={busy} onClick={doApproveContext} style={{ ...topBtnStyle, marginTop: 4 }}>Approve Context Scope (Owner Decision Gate)</button>
                  )}
                </div>
              )}
            </div>

            <div style={{ color: "#e0a860", fontWeight: 600, marginBottom: 4 }}>4. Execution Plan</div>
            <div style={{ marginBottom: 10 }}>
              {!session.executionPlanId ? (
                <button disabled={busy || session.status !== "READY_FOR_EXECUTION"} onClick={doCreatePlan} style={topBtnStyle}>Create Execution Plan</button>
              ) : (
                <button disabled={busy} onClick={doApprovePlan} style={topBtnStyle}>Approve Execution Plan (never EXTERNAL_MUTATION)</button>
              )}
            </div>

            <div style={{ color: "#e0a860", fontWeight: 600, marginBottom: 4 }}>4.4 Worker Selection (Universal Worker Bridge — Step 13.6)</div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
                {workerAdapters.map((a) => {
                  const health = adapterHealth[a.id];
                  const healthColor = health?.status === "HEALTHY" ? "#4ec9b0" : health?.status === "DEGRADED" ? "#e0a860" : health?.status === "UNAVAILABLE" ? "#f37c7c" : "#858585";
                  return (
                    <button key={a.id} onClick={() => { setSelectedAdapterId(a.id); void doCheckAdapterHealth(a.id); }} style={{ ...topBtnStyle, textAlign: "left", background: selectedAdapterId === a.id ? "#2d2d2d" : "transparent", display: "flex", flexDirection: "column", alignItems: "flex-start", minWidth: 150 }}>
                      <span style={{ color: "#ccc", fontWeight: 600 }}>{a.id}</span>
                      <span style={{ fontSize: 9.5, color: "#858585" }}>{a.type} · {a.provider}</span>
                      <span style={{ fontSize: 9.5, color: a.availability?.available ? "#4ec9b0" : "#f37c7c" }}>{a.availability?.available ? "available" : "unavailable"}</span>
                      {health && <span style={{ fontSize: 9.5, color: healthColor }}>health: {health.status}</span>}
                    </button>
                  );
                })}
              </div>
              {selectedAdapterId && (() => {
                const a = workerAdapters.find((x) => x.id === selectedAdapterId);
                const health = adapterHealth[selectedAdapterId];
                if (!a) return null;
                return (
                  <div style={{ padding: "6px 8px", border: "1px solid #2a2a2a", borderRadius: 3, fontSize: 10.5 }}>
                    <div style={{ color: "#ccc" }}>Selected: {a.id} · Adapter: {a.type} · Provider: {a.provider} · Local/Cloud: {a.type === "LOCAL_RUNTIME" ? "Local" : a.type === "HUMAN" ? "N/A" : "Cloud"}</div>
                    <div style={{ color: "#858585", marginTop: 2 }}>Health: {health?.status ?? "not yet checked"} — {health?.reason ?? ""}</div>
                    {a.limitations?.map((l: string, i: number) => <div key={i} style={{ color: "#e0a860", marginTop: 2 }}>limitation: {l}</div>)}
                  </div>
                );
              })()}
              <div style={{ color: "#6a6a6a", fontSize: 9.5, marginTop: 4 }}>Owner can override the Worker before Execute — real selection still passes through the real Selector/Contract/Policy.</div>
            </div>

            <div style={{ color: "#e0a860", fontWeight: 600, marginBottom: 4 }}>4.5 CODE_WORKER Proposal (real, programmatic — Step 13.6)</div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                <input placeholder="Task description for the real provider call" value={proposalTask} onChange={(e) => setProposalTask(e.target.value)} style={{ ...fwInputStyle, flex: 1 }} />
                <button disabled={busy || !session.contextPlanId} onClick={doGenerateProposal} style={topBtnStyle}>Generate Proposal (1 real provider call)</button>
              </div>
              {proposal && (
                <div style={{ padding: "6px 8px", border: "1px solid #2a2a2a", borderRadius: 3 }}>
                  <div style={{ color: proposal.ok ? "#4ec9b0" : "#f37c7c" }}>ok={String(proposal.ok)} · adapter={proposal.workerAdapterId ?? "none"} · provider={proposal.provider} · {proposal.files?.length ?? 0} real file(s) proposed{proposal.error ? ` — ${proposal.error}` : ""}</div>
                  {proposal.answer && <div style={{ color: "#ccc", fontSize: 11, marginTop: 4, whiteSpace: "pre-wrap" }}>{proposal.answer}</div>}
                  {proposal.cost && <div style={{ color: "#858585", fontSize: 10.5, marginTop: 2 }}>cost: {proposal.cost.amount ?? "?"} {proposal.cost.currency ?? ""} ({proposal.cost.kind})</div>}
                  {proposal.selection && proposal.selection.fallbackChain.length > 0 && <div style={{ color: "#858585", fontSize: 10.5, marginTop: 2 }}>fallback chain: {proposal.selection.fallbackChain.join(" → ")}</div>}
                  {proposal.requiresDestructiveApproval && <div style={{ color: "#e0a860", fontSize: 10.5, marginTop: 2 }}>contains real DELETE/RENAME — requires a separate destructive approval</div>}
                  {proposal.rejectedFiles?.map((r, i) => <div key={i} style={{ color: "#e0a860", fontSize: 10.5 }}>rejected: {r.path} — {r.reason}</div>)}
                  {proposal.ok && proposal.files.length > 0 && !proposal.approved && (
                    <button disabled={busy} onClick={doApproveProposal} style={{ ...topBtnStyle, marginTop: 4 }}>Approve &amp; Apply Diff (Owner Decision Gate — writes real files)</button>
                  )}
                  {proposal.applied && <div style={{ color: "#4ec9b0", marginTop: 4 }}>applied to real disk at {proposal.appliedAt}</div>}
                </div>
              )}
            </div>

            <div style={{ color: "#e0a860", fontWeight: 600, marginBottom: 4 }}>5. Native File Change Flow</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
              <button disabled={busy || !session.executionPlanId} onClick={doExecute} style={topBtnStyle}>Capture Change Set + Review + Test</button>
              <button disabled={busy || !session.changeSetId} onClick={doApproveReview} style={topBtnStyle}>Approve Review (Owner Decision Gate)</button>
              <button disabled={busy || !session.changeSetId} onClick={doBuild} style={topBtnStyle}>Run Real Build</button>
              <button disabled={busy || !session.buildRunId} onClick={doRelease} style={topBtnStyle}>Request Release Candidate</button>
            </div>
            {session.changeSetId && <div style={{ color: "#858585" }}>Change Set: {session.changeSetId.slice(0, 8)} · Test Run: {session.testRunId?.slice(0, 8) ?? "—"} · Build Run: {session.buildRunId?.slice(0, 8) ?? "—"} · Release Run: {session.releaseRunId?.slice(0, 8) ?? "—"}</div>}

            <div style={{ color: "#e0a860", fontWeight: 600, marginTop: 12, marginBottom: 4 }}>6. Result</div>
            <button disabled={busy} onClick={doResult} style={topBtnStyle}>Compute Real Outcome Report</button>
            {result && (
              <div style={{ marginTop: 8, padding: "6px 8px", border: "1px solid #2a2a2a", borderRadius: 3 }}>
                <div style={{ color: RESULT_STATUS_COLORS[result.status] ?? "#858585", fontWeight: 600 }}>{result.status}</div>
                <div style={{ color: "#858585", marginTop: 2 }}>{result.realWorldReadiness}</div>
                {result.limitations.map((l: string, i: number) => <div key={i} style={{ color: "#e0a860", marginTop: 2, fontSize: 10.5 }}>limitation: {l}</div>)}
                {result.ownerActionsRequired.map((a: string, i: number) => <div key={i} style={{ color: "#9cdcfe", marginTop: 2, fontSize: 10.5 }}>owner action: {a}</div>)}
              </div>
            )}

            <div style={{ color: "#6a6a6a", fontWeight: 600, marginTop: 14, marginBottom: 4 }}>Worker Registry ({workers.length})</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {workers.map((w) => (
                <span key={w.id} title={w.capabilities.join("; ")} style={{ fontSize: 9.5, padding: "1px 6px", borderRadius: 8, background: "#2a2a2a", color: w.status === "ACTIVE" ? "#4ec9b0" : w.status === "COMPATIBILITY_ONLY" || w.status === "PARTIAL" ? "#e0a860" : "#858585" }}>{w.id}: {w.status}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Status bar ----
function StatusBar({ problemsCount, workspaceStatus, realBranch }: { problemsCount: number; workspaceStatus: "connecting" | "connected" | "error"; realBranch: string | null }) {
  const isError = workspaceStatus === "error";
  // process.env.NODE_ENV is statically inlined by the Next.js/webpack
  // build — a real, non-mock value (owner, 2026-08-07, /admin/ide
  // Foundation audit; replaces a literal "development (mock)" string).
  const nodeEnv = process.env.NODE_ENV ?? "unknown";
  return (
    <div style={{ height: 22, background: isError ? "#a1260d" : "#007acc", display: "flex", alignItems: "center", gap: 16, padding: "0 10px", fontSize: 11, color: "#fff", flexShrink: 0 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 4 }} title={realBranch ? "real git branch, from /api/admin/ide/git/status" : "no real branch resolved yet"}>
        <GitBranch size={12} /> {realBranch ?? "unknown"}
      </span>
      <span title="real process.env.NODE_ENV">Environment: {nodeEnv}</span>
      <span>Workspace: {workspaceStatus === "connected" ? "Connected" : workspaceStatus === "error" ? "Error" : "Connecting…"}</span>
      <span title="no Source Control Provider connector exists yet — honest, not faked">Connection: Not connected</span>
      <span title="no Runtime Provider connector exists yet — honest, not faked">Runtime: Not connected</span>
      <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
        <AlertTriangle size={12} /> {problemsCount} Problems
      </span>
    </div>
  );
}
