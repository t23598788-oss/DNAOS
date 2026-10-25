/**
 * Artifact Pipeline — Artifact Type Registry (owner, 2026-08-06, Software
 * Factory Step 5). Declares the real artifact types this factory's
 * production line can emit. Every IMPLEMENTED type here is wired to a real
 * producer already built in Steps 3/4/4.5 (Production Queue, Inspection
 * Pipeline, Governance Runtime, Factory/Architecture/Registry builders) —
 * never a new pipeline invented for this step. BUILD_OUTPUT/TEST_RESULT/
 * CUSTOM are honestly NOT_IMPLEMENTED: this step forbids Build Center/Test
 * Center, so no real producer exists for them yet.
 */
export type ArtifactType =
  | "EDITOR_SAVE" | "QUEUE_JOB" | "EXECUTION_RESULT" | "INSPECTION_RESULT" | "GOVERNANCE_RESULT"
  | "FACTORY_RESULT" | "ARCHITECTURE_RESULT" | "REGISTRY_RESULT" | "VALIDATION_RESULT"
  | "CUSTOM" | "BUILD_OUTPUT" | "TEST_RESULT"
  | "UI_INSPECTION_MANIFEST" | "UI_DOM_SNAPSHOT" | "UI_LAYOUT_SNAPSHOT" | "UI_STYLE_SNAPSHOT"
  | "UI_ACCESSIBILITY_SNAPSHOT" | "UI_LAYER_SNAPSHOT" | "UI_PERFORMANCE_SNAPSHOT" | "UI_RESOURCE_SNAPSHOT"
  | "UI_SCREENSHOT" | "UI_ANNOTATED_SCREENSHOT" | "UI_FINDINGS" | "UI_INSPECTION_SUMMARY"
  | "CHANGE_SET_MANIFEST" | "SOURCE_DIFF" | "CHANGE_IMPACT_REPORT" | "REVIEW_FINDINGS" | "REVIEW_SUMMARY"
  | "REVIEW_DECISION" | "GOVERNANCE_IMPACT" | "SECURITY_IMPACT" | "API_COMPATIBILITY_REPORT" | "MIGRATION_IMPACT_REPORT"
  | "TEST_RUN" | "TEST_REPORT" | "TEST_SUMMARY" | "TEST_LOG" | "TEST_COVERAGE" | "TEST_FAILURE" | "TEST_EVIDENCE"
  | "BUILD_REQUEST" | "BUILD_RUN" | "BUILD_MANIFEST" | "BUILD_LOG" | "BUILD_OUTPUT_INVENTORY" | "BUILD_OUTPUT_FILE"
  | "BUILD_WARNING_REPORT" | "BUILD_FAILURE_REPORT" | "BUILD_INTEGRITY_REPORT" | "BUILD_REPRODUCIBILITY_REPORT"
  | "BUILD_ENVIRONMENT_REPORT" | "BUILD_EVIDENCE_PACKAGE"
  | "BUILD_GATE_REPORT" | "BUILD_PRECONDITIONS_REPORT" | "MIGRATION_INTEGRITY_REPORT" | "BUILD_DECISION"
  | "RELEASE_CANDIDATE" | "RELEASE_REPORT" | "PACKAGE_MANIFEST" | "PACKAGE_INTEGRITY" | "OPERATIONAL_READINESS" | "RELEASE_DECISION"
  | "DEPLOYMENT_PLAN" | "DEPLOYMENT_AUDIT" | "RUNTIME_DEPENDENCY_REPORT" | "FACTORY_RUNTIME_REPORT" | "GLOBAL_FACTORY_REPORT"
  | "MONITORING_SNAPSHOT" | "HEALTH_SIGNAL_REPORT" | "INCIDENT_RECORD" | "INCIDENT_TIMELINE" | "INCIDENT_IMPACT_REPORT"
  | "RECOVERY_PLAN" | "RECOVERY_READINESS_REPORT" | "RECOVERY_VERIFICATION_REPORT" | "BACKUP_READINESS_REPORT" | "OPERATIONS_STATUS_REPORT"
  | "CONTINUOUS_MONITORING_RUN" | "ALERT_RECORD" | "ALERT_DISPATCH_REPORT" | "BACKUP_PLAN" | "BACKUP_MANIFEST"
  | "BACKUP_INTEGRITY_REPORT" | "RESTORE_TEST_PLAN" | "RESTORE_TEST_RUN" | "RESTORE_VERIFICATION_REPORT" | "OPERATIONS_READINESS_REPORT"
  | "WORKSPACE_SESSION" | "INTENT_RECORD" | "CAPABILITY_RESOLUTION_REPORT" | "CONTEXT_PLAN" | "AI_CONTEXT_PACKAGE"
  | "WORKER_ASSIGNMENT" | "EXECUTION_PLAN" | "OWNER_DECISION_RECORD" | "NATIVE_FACTORY_RUN" | "OUTCOME_REPORT" | "VS_CODE_DEPENDENCY_REPORT" | "CODE_WORKER_PROPOSAL"
  | "SECURITY_EXECUTION_GATE_RECORD"
  | "WORKER_REQUEST" | "WORKER_SELECTION_REPORT" | "WORKER_EXECUTION_RECORD" | "PROVIDER_CALL_RECORD" | "CLI_EXECUTION_RECORD"
  | "MCP_EXECUTION_RECORD" | "LOCAL_MODEL_EXECUTION_RECORD" | "EXECUTION_BUDGET_REPORT" | "CODE_WORKER_PROPOSAL_V2" | "WORKER_HEALTH_REPORT"
  | "DOMAIN_ASSET_RECORD" | "SUBDOMAIN_DISCOVERY_REPORT" | "DNS_VERIFICATION_REPORT" | "HTTP_PROBE_REPORT" | "TLS_EVIDENCE_RECORD" | "EXTERNAL_DRIFT_REPORT"
  | "COMMAND_INVOCATION" | "EXECUTION_CONTEXT_CHECKPOINT" | "FACTORY_READINESS_REPORT"
  | "MANAGER_QUESTION_RECORD" | "ORCHESTRATOR_WORK_ITEM_RECORD" | "COST_GATE_DECISION" | "EDGE_FUNCTION_DISPATCH_RECORD"
  | "CONFIG_CHANGE_RECORD" | "SETTING_RUNTIME_RECORD";

export type ArtifactRegistrationStatus = "IMPLEMENTED" | "NOT_IMPLEMENTED";
export type ArtifactFormat = "json" | "text" | "png" | "n/a";

export interface ArtifactTypeDefinition {
  artifactType: ArtifactType;
  displayName: string;
  description: string;
  producer: string;
  consumer: string[];
  source: string;
  format: ArtifactFormat;
  immutable: boolean;
  retention: string;
  supportsRegenerate: boolean;
  status: ArtifactRegistrationStatus;
}

export const ARTIFACT_TYPE_REGISTRY: Record<ArtifactType, ArtifactTypeDefinition> = {
  EDITOR_SAVE: {
    artifactType: "EDITOR_SAVE", displayName: "Editor Save",
    description: "Real snapshot of a successful SAVE_FILE write — the exact sha256 hash file/route.ts's PUT handler already computes after writeFileAtomic().",
    producer: "app/api/admin/ide/file/route.ts (PUT)", consumer: ["INSPECTION_RESULT", "Problems Panel"],
    source: "engines/shared/ide-lib/fileWrite.ts#sha256Hex", format: "n/a", immutable: true,
    retention: "same bound as the Production Queue's job history (MAX_JOB_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  QUEUE_JOB: {
    artifactType: "QUEUE_JOB", displayName: "Queue Job",
    description: "Real snapshot of one Production Queue Job (queueRuntime.ts's Job record) at the moment it reached a terminal status.",
    producer: "engines/shared/ide-lib/queueRuntime.ts", consumer: ["EXECUTION_RESULT", "EDITOR_SAVE", "Problems Panel"],
    source: "engines/shared/ide-lib/queueRuntime.ts#getJob", format: "json", immutable: true,
    retention: "same as the Job itself (MAX_JOB_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  EXECUTION_RESULT: {
    artifactType: "EXECUTION_RESULT", displayName: "Execution Result",
    description: "Real snapshot of one Execution Runtime RunRecord (executionRuntime.ts) at its real terminal status — exit code, stdout/stderr hash, duration.",
    producer: "engines/shared/ide-lib/executionRuntime.ts", consumer: ["INSPECTION_RESULT", "Problems Panel"],
    source: "engines/shared/ide-lib/executionRuntime.ts#getRun", format: "json", immutable: true,
    retention: "same as the Run itself (MAX_RUN_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  INSPECTION_RESULT: {
    artifactType: "INSPECTION_RESULT", displayName: "Inspection Result",
    description: "Real snapshot of one Inspection Record (inspectionRuntime.ts, Step 4) at its real terminal status — findings, severity, blocking.",
    producer: "engines/shared/ide-lib/inspectionRuntime.ts", consumer: ["GOVERNANCE_RESULT", "Problems Panel"],
    source: "engines/shared/ide-lib/inspectionRuntime.ts#getInspection", format: "json", immutable: true,
    retention: "same as the InspectionRecord itself (MAX_INSPECTION_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  GOVERNANCE_RESULT: {
    artifactType: "GOVERNANCE_RESULT", displayName: "Governance Result",
    description: "Real snapshot of one Live Governance Verification run (governanceRuntime.ts's runGovernanceVerification(), Step 4.5) — the coverage summary + every emitted rule event, at the moment the verify completed.",
    producer: "engines/shared/ide-lib/governanceRuntime.ts#runGovernanceVerification", consumer: ["Problems Panel"],
    source: "engines/shared/ide-lib/governanceRuntime.ts", format: "json", immutable: true,
    retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: true, status: "IMPLEMENTED",
  },
  FACTORY_RESULT: {
    artifactType: "FACTORY_RESULT", displayName: "Factory Summary Result",
    description: "Real snapshot of the current registry/factory-summary.json on disk, checksummed at wrap time. Regenerate re-reads the CURRENT file bytes (does not itself re-run scripts/build-factory-registry.ts) — a new artifact version only reflects a change already made by the real generator.",
    producer: "scripts/build-factory-registry.ts (existing, Step \"Factory Architecture Phase 1.1\")", consumer: ["Problems Panel"],
    source: "registry/factory-summary.json", format: "json", immutable: true,
    retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: true, status: "IMPLEMENTED",
  },
  ARCHITECTURE_RESULT: {
    artifactType: "ARCHITECTURE_RESULT", displayName: "Architecture Book Result",
    description: "Real snapshot of the current registry/architecture-book.json on disk, checksummed at wrap time. Regenerate re-reads current bytes only, same non-invasive policy as FACTORY_RESULT.",
    producer: "scripts/build-arch-book.ts (existing)", consumer: ["Problems Panel"],
    source: "registry/architecture-book.json", format: "json", immutable: true,
    retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: true, status: "IMPLEMENTED",
  },
  REGISTRY_RESULT: {
    artifactType: "REGISTRY_RESULT", displayName: "Module Registry Result",
    description: "Real snapshot of the current registry/module-registry.json on disk, checksummed at wrap time. Regenerate re-reads current bytes only, same non-invasive policy as FACTORY_RESULT.",
    producer: "scripts/sync-registry.ts (existing)", consumer: ["Problems Panel"],
    source: "registry/module-registry.json", format: "json", immutable: true,
    retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: true, status: "IMPLEMENTED",
  },
  VALIDATION_RESULT: {
    artifactType: "VALIDATION_RESULT", displayName: "Validation Ledger Result",
    description: "Real snapshot of the current registry/VALIDATION_RESULTS.json on disk, checksummed at wrap time. No automatic regenerate — nothing in this pipeline re-runs the validators themselves.",
    producer: "scripts/record-validation.ts (existing)", consumer: ["Problems Panel"],
    source: "registry/VALIDATION_RESULTS.json", format: "json", immutable: true,
    retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  CUSTOM: {
    artifactType: "CUSTOM", displayName: "Custom Artifact",
    description: "No real generic custom-artifact producer exists in this codebase today — registered per instruction, not implemented this phase.",
    producer: "NOT_IMPLEMENTED", consumer: [], source: "none — no real implementation exists to cite.", format: "n/a", immutable: false,
    retention: "n/a", supportsRegenerate: false, status: "NOT_IMPLEMENTED",
  },
  BUILD_OUTPUT: {
    artifactType: "BUILD_OUTPUT", displayName: "Build Output",
    description: "No Build Center exists in this repository, and this step explicitly forbids creating one — registered per instruction, not implemented.",
    producer: "NOT_IMPLEMENTED", consumer: [], source: "none — no real implementation exists to cite.", format: "n/a", immutable: false,
    retention: "n/a", supportsRegenerate: false, status: "NOT_IMPLEMENTED",
  },
  TEST_RESULT: {
    artifactType: "TEST_RESULT", displayName: "Test Result",
    description: "No Test Center exists in this repository, and this step explicitly forbids creating one — registered per instruction, not implemented. (Regression suite PASS/FAIL console output is not persisted anywhere real today.)",
    producer: "NOT_IMPLEMENTED", consumer: [], source: "none — no real implementation exists to cite.", format: "n/a", immutable: false,
    retention: "n/a", supportsRegenerate: false, status: "NOT_IMPLEMENTED",
  },

  // ================= UI Inspection Capability (Step 6) =================
  UI_INSPECTION_MANIFEST: {
    artifactType: "UI_INSPECTION_MANIFEST", displayName: "UI Inspection Manifest",
    description: "Real manifest for one UI Inspection scan — target, viewport profiles run, artifact ids produced, timing. The root of a scan's Artifact Relationship tree.",
    producer: "engines/shared/ide-lib/browserInspectionRuntime.ts", consumer: ["Problems Panel", "UI Inspection tab"],
    source: "browserInspectionRuntime.ts scan manifest", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  UI_DOM_SNAPSHOT: {
    artifactType: "UI_DOM_SNAPSHOT", displayName: "UI DOM Snapshot",
    description: "Real DOM node list captured from a real Playwright page — tagName/selector/role/rect/attributes (redacted), per the DOM Snapshot contract.",
    producer: "engines/shared/ide-lib/browserInspectionRuntime.ts", consumer: ["UI_LAYOUT_CHECK", "UI_OVERLAP_CHECK", "Problems Panel"],
    source: "Playwright Page.evaluate() real DOM walk", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  UI_LAYOUT_SNAPSHOT: {
    artifactType: "UI_LAYOUT_SNAPSHOT", displayName: "UI Layout Snapshot",
    description: "Real per-element box-model data (rect/scroll/client/offset sizes, overflow, position, zIndex) from the real browser layout engine.",
    producer: "engines/shared/ide-lib/browserInspectionRuntime.ts", consumer: ["UI_OVERFLOW_CHECK", "UI_OVERLAP_CHECK", "Problems Panel"],
    source: "Playwright Page.evaluate() real getBoundingClientRect()/getComputedStyle()", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  UI_STYLE_SNAPSHOT: {
    artifactType: "UI_STYLE_SNAPSHOT", displayName: "UI Computed Style Snapshot",
    description: "Real, scoped subset of getComputedStyle() per element (display/flex/color/font/etc. — never every CSS property) for Inspection rules that need it.",
    producer: "engines/shared/ide-lib/browserInspectionRuntime.ts", consumer: ["UI_TEXT_RENDER_CHECK", "UI_COLOR_CONTRAST_CHECK", "Problems Panel"],
    source: "Playwright Page.evaluate() real getComputedStyle()", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  UI_ACCESSIBILITY_SNAPSHOT: {
    artifactType: "UI_ACCESSIBILITY_SNAPSHOT", displayName: "UI Accessibility Snapshot",
    description: "Real Chromium accessibility tree captured via Playwright's page.accessibility.snapshot() — role/name/focusable/disabled/etc.",
    producer: "engines/shared/ide-lib/browserInspectionRuntime.ts", consumer: ["UI_ACCESSIBILITY_CHECK", "Problems Panel"],
    source: "Playwright page.accessibility.snapshot()", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  UI_LAYER_SNAPSHOT: {
    artifactType: "UI_LAYER_SNAPSHOT", displayName: "UI Layer Snapshot",
    description: "No real Layer Tree capture is wired this phase (see UI_LAYER_CHECK's registration) — registered per instruction, not implemented.",
    producer: "NOT_IMPLEMENTED", consumer: [], source: "none — no real implementation exists to cite.", format: "n/a", immutable: false, retention: "n/a", supportsRegenerate: false, status: "NOT_IMPLEMENTED",
  },
  UI_PERFORMANCE_SNAPSHOT: {
    artifactType: "UI_PERFORMANCE_SNAPSHOT", displayName: "UI Performance Snapshot",
    description: "No real performance trace capture is wired this phase (see UI_PERFORMANCE_CHECK's registration) — registered per instruction, not implemented.",
    producer: "NOT_IMPLEMENTED", consumer: [], source: "none — no real implementation exists to cite.", format: "n/a", immutable: false, retention: "n/a", supportsRegenerate: false, status: "NOT_IMPLEMENTED",
  },
  UI_RESOURCE_SNAPSHOT: {
    artifactType: "UI_RESOURCE_SNAPSHOT", displayName: "UI Resource Snapshot",
    description: "Real network response/failure list observed by Playwright during the real page load — status, URL, resource type.",
    producer: "engines/shared/ide-lib/browserInspectionRuntime.ts", consumer: ["UI_RESOURCE_CHECK", "Problems Panel"],
    source: "Playwright page.on('response')/page.on('requestfailed')", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  UI_SCREENSHOT: {
    artifactType: "UI_SCREENSHOT", displayName: "UI Screenshot",
    description: "Real full-page PNG screenshot from Playwright's page.screenshot({ fullPage: true }) — evidence, never the primary judgment source for any blocking finding.",
    producer: "engines/shared/ide-lib/browserInspectionRuntime.ts", consumer: ["UI_ANNOTATED_SCREENSHOT", "Problems Panel", "UI Inspection tab"],
    source: "Playwright page.screenshot()", format: "png", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  UI_ANNOTATED_SCREENSHOT: {
    artifactType: "UI_ANNOTATED_SCREENSHOT", displayName: "UI Annotated Screenshot",
    description: "Real UI_SCREENSHOT with real finding rects drawn on top via sharp (already a project dependency) — rectangles + a numbered legend, drawn from real Finding.rect data, never AI-drawn or AI-judged.",
    producer: "engines/shared/ide-lib/browserInspectionRuntime.ts", consumer: ["Problems Panel", "UI Inspection tab"],
    source: "sharp SVG composite over the real UI_SCREENSHOT artifact", format: "png", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  UI_FINDINGS: {
    artifactType: "UI_FINDINGS", displayName: "UI Findings",
    description: "Real, immutable snapshot of every Finding this scan produced (the same Finding[] the Inspection Pipeline's InspectionRecord already carries) — wrapped as its own artifact for lineage/evidence traceability.",
    producer: "engines/shared/ide-lib/browserInspectionRuntime.ts", consumer: ["Problems Panel", "UI Inspection tab"],
    source: "the real InspectionRecord.findings this scan produced", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  UI_INSPECTION_SUMMARY: {
    artifactType: "UI_INSPECTION_SUMMARY", displayName: "UI Inspection Summary",
    description: "Real roll-up of one scan — finding counts by severity/category, viewport coverage, artifact ids, pass/fail per rule.",
    producer: "engines/shared/ide-lib/browserInspectionRuntime.ts", consumer: ["Problems Panel", "UI Inspection tab", "Factory Registry health"],
    source: "the real InspectionRecord this scan produced", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },

  // ================= Code Review Pipeline & Change Set Assembly (Step 7) =================
  CHANGE_SET_MANIFEST: {
    artifactType: "CHANGE_SET_MANIFEST", displayName: "Change Set Manifest",
    description: "Real manifest for one Change Set — base/current revision, working tree fingerprint, changed file list, source job/inspection/artifact ids. The root of a review's Artifact Relationship tree.",
    producer: "engines/shared/ide-lib/changeSetRuntime.ts", consumer: ["Problems Panel", "Code Review tab"],
    source: "gitReadOnly.ts's real getGitStatus()", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  SOURCE_DIFF: {
    artifactType: "SOURCE_DIFF", displayName: "Source Diff",
    description: "Real per-file diff assembled from gitReadOnly.ts's real getFileDiff() — never from Editor state alone.",
    producer: "engines/shared/ide-lib/changeSetRuntime.ts", consumer: ["Diff Viewer", "Code Review tab"],
    source: "gitReadOnly.ts's real getFileDiff()", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  CHANGE_IMPACT_REPORT: {
    artifactType: "CHANGE_IMPACT_REPORT", displayName: "Change Impact Report",
    description: "Real per-file impact analysis (module/factory/dependents/blast radius) from registry/architecture-book.json + registry/factory-mapping.json — UNKNOWN where no real evidence exists, never guessed from a file name.",
    producer: "engines/shared/ide-lib/changeSetRuntime.ts", consumer: ["Code Review tab", "Problems Panel"],
    source: "registry/architecture-book.json + registry/factory-mapping.json", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  REVIEW_FINDINGS: {
    artifactType: "REVIEW_FINDINGS", displayName: "Review Findings",
    description: "Real, immutable snapshot of every Review Finding a Change Set's review produced.",
    producer: "engines/shared/ide-lib/changeSetRuntime.ts", consumer: ["Problems Panel", "Code Review tab"],
    source: "the real review run this Change Set produced", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  REVIEW_SUMMARY: {
    artifactType: "REVIEW_SUMMARY", displayName: "Review Summary",
    description: "Real roll-up of one Change Set's review — finding counts by severity/category, risk level, per-check status.",
    producer: "engines/shared/ide-lib/changeSetRuntime.ts", consumer: ["Code Review tab", "Factory Registry health"],
    source: "the real review run this Change Set produced", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  REVIEW_DECISION: {
    artifactType: "REVIEW_DECISION", displayName: "Review Decision",
    description: "Real, immutable record of one owner's APPROVE/REQUEST_CHANGES/REJECT decision on a Change Set, with a real evidence snapshot and the real workingTreeFingerprint at decision time.",
    producer: "engines/shared/ide-lib/changeSetRuntime.ts", consumer: ["Code Review tab"],
    source: "the real decision the owner made", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  GOVERNANCE_IMPACT: {
    artifactType: "GOVERNANCE_IMPACT", displayName: "Governance Impact",
    description: "Real per-changed-file Constitution rule citations and their real ENFORCED/DECLARED_NOT_ENFORCED/GHOST/UNKNOWN status, from the real Governance Runtime.",
    producer: "engines/shared/ide-lib/changeSetRuntime.ts", consumer: ["Code Review tab", "Problems Panel"],
    source: "engines/shared/ide-lib/governanceRuntime.ts", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  SECURITY_IMPACT: {
    artifactType: "SECURITY_IMPACT", displayName: "Security Impact",
    description: "Real, scoped security findings for changed API routes/files (auth boundary, path security) — never a repo-wide scan.",
    producer: "engines/shared/ide-lib/changeSetRuntime.ts", consumer: ["Code Review tab", "Problems Panel"],
    source: "engines/shared/ide-lib/fsSecurity.ts + real diff text", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  API_COMPATIBILITY_REPORT: {
    artifactType: "API_COMPATIBILITY_REPORT", displayName: "API Compatibility Report",
    description: "Real NON_BREAKING/POTENTIALLY_BREAKING/BREAKING/UNKNOWN classification per changed app/api/**/route.ts file, from a real old-vs-new HTTP method comparison.",
    producer: "engines/shared/ide-lib/changeSetRuntime.ts", consumer: ["Code Review tab", "Problems Panel"],
    source: "real `git show HEAD:<path>` vs. real disk content", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  MIGRATION_IMPACT_REPORT: {
    artifactType: "MIGRATION_IMPACT_REPORT", displayName: "Migration Impact Report",
    description: "Real destructive-statement / duplicate-timestamp scan of changed supabase/migrations/**/*.sql files — report only, never applies a migration.",
    producer: "engines/shared/ide-lib/changeSetRuntime.ts", consumer: ["Code Review tab", "Problems Panel"],
    source: "real supabase/migrations/*.sql file content", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  TEST_RUN: {
    artifactType: "TEST_RUN", displayName: "Test Run",
    description: "Real, immutable snapshot of one full Test Pipeline run — every Suite/Test Type executed, their real statuses, totals, and cross-references to the Change Set/Review/Queue Job that triggered it.",
    producer: "engines/shared/ide-lib/testRuntime.ts", consumer: ["Test tab", "Problems Panel"],
    source: "real TestRun record", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  TEST_REPORT: {
    artifactType: "TEST_REPORT", displayName: "Test Report",
    description: "Real, per-Suite breakdown of every TestResult (id/suite/name/status/duration/evidence/output/warnings/failures) produced by a Test Run.",
    producer: "engines/shared/ide-lib/testRuntime.ts", consumer: ["Test tab", "Problems Panel"],
    source: "real TestResult[] from the Test Run", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  TEST_SUMMARY: {
    artifactType: "TEST_SUMMARY", displayName: "Test Summary",
    description: "Real aggregation of a Test Run — totals/passed/failed/skipped/notImplemented/stale, blocking policy result, coverage-by-suite.",
    producer: "engines/shared/ide-lib/testRuntime.ts", consumer: ["Test tab", "Problems Panel", "Code Review tab"],
    source: "real aggregation computed from the Test Run's own TestResult[]", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  TEST_LOG: {
    artifactType: "TEST_LOG", displayName: "Test Log",
    description: "Real, concatenated stdout/stderr from every real command-based Suite this Test Run executed via the Execution Runtime — never fabricated output.",
    producer: "engines/shared/ide-lib/testRuntime.ts", consumer: ["Test tab"],
    source: "real executionRuntime.ts RunRecord stdout/stderr for each Suite's real process", format: "text", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  TEST_COVERAGE: {
    artifactType: "TEST_COVERAGE", displayName: "Test Coverage",
    description: "Real per-Suite coverage record: which of the 15 real Test Types ran, which are honestly NOT_IMPLEMENTED, and which Suites were skipped — never a fabricated code-coverage percentage (no coverage instrumentation exists in this repo).",
    producer: "engines/shared/ide-lib/testRuntime.ts", consumer: ["Test tab", "Problems Panel"],
    source: "real Test Registry status + real Test Run results", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  TEST_FAILURE: {
    artifactType: "TEST_FAILURE", displayName: "Test Failure",
    description: "Real, isolated record of every real blocking/failing TestResult in a Test Run, with its real evidence — the input to the Blocking Policy gate.",
    producer: "engines/shared/ide-lib/testRuntime.ts", consumer: ["Test tab", "Problems Panel"],
    source: "real TestResult[] filtered to status FAILED or blocking", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  TEST_EVIDENCE: {
    artifactType: "TEST_EVIDENCE", displayName: "Test Evidence",
    description: "Real, per-Test evidence bundle — stdout/stderr/exitCode/duration/command/checksum — the raw evidence a real TestResult's `evidence` field summarizes.",
    producer: "engines/shared/ide-lib/testRuntime.ts", consumer: ["Test tab", "Evidence Warehouse"],
    source: "real per-Test execution evidence", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  BUILD_REQUEST: {
    artifactType: "BUILD_REQUEST", displayName: "Build Request",
    description: "Real, immutable snapshot of one Build Request — real buildTypeIds, real sourceChangeSetId/sourceReviewId/sourceTestRunId cross-references, real environmentProfileId, real reason. Never a raw command, cwd, or env value.",
    producer: "engines/shared/ide-lib/buildRuntime.ts", consumer: ["Build tab", "Problems Panel"],
    source: "real BuildRequest record", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  BUILD_RUN: {
    artifactType: "BUILD_RUN", displayName: "Build Run",
    description: "Real, immutable snapshot of one full Build Run — real status, real fingerprints before/after, real duration/exitCode, real cross-references to the Change Set/Review/Test Run/Queue Job that triggered it.",
    producer: "engines/shared/ide-lib/buildRuntime.ts", consumer: ["Build tab", "Problems Panel"],
    source: "real BuildRun record", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  BUILD_MANIFEST: {
    artifactType: "BUILD_MANIFEST", displayName: "Build Manifest",
    description: "Real manifest assembled from a real Build Run's real output — route counts read from real .next/routes-manifest.json + app-path-routes-manifest.json, real output file/byte counts, real checksums. Never guessed from source alone.",
    producer: "engines/shared/ide-lib/buildRuntime.ts", consumer: ["Build tab", "Problems Panel", "Release Pipeline (future)"],
    source: "real .next/** output + real routes-manifest.json", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  BUILD_LOG: {
    artifactType: "BUILD_LOG", displayName: "Build Log",
    description: "Real, concatenated stdout/stderr from the real `next build` process, captured via the Execution Runtime — never fabricated output.",
    producer: "engines/shared/ide-lib/buildRuntime.ts", consumer: ["Build tab"],
    source: "real executionRuntime.ts RunRecord stdout/stderr for the real build process", format: "text", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  BUILD_OUTPUT_INVENTORY: {
    artifactType: "BUILD_OUTPUT_INVENTORY", displayName: "Build Output Inventory",
    description: "Real per-file metadata (relativePath/type/size/checksum/mimeType/executable) for every real output file under the real .next/** build output — never the file contents themselves.",
    producer: "engines/shared/ide-lib/buildRuntime.ts", consumer: ["Build tab", "Build Output Viewer"],
    source: "real fs walk + real sha256 of .next/** output", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  BUILD_OUTPUT_FILE: {
    artifactType: "BUILD_OUTPUT_FILE", displayName: "Build Output File Record",
    description: "Real single-file metadata record (never the raw file bytes) for one real build output file, cross-referenced to its Build Run.",
    producer: "engines/shared/ide-lib/buildRuntime.ts", consumer: ["Build Output Viewer"],
    source: "real fs.statSync + real sha256 of one real output file", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  BUILD_WARNING_REPORT: {
    artifactType: "BUILD_WARNING_REPORT", displayName: "Build Warning Report",
    description: "Real, isolated record of every real non-blocking Build Finding parsed from the real build process's stdout/stderr.",
    producer: "engines/shared/ide-lib/buildRuntime.ts", consumer: ["Build tab", "Problems Panel"],
    source: "real BuildFinding[] filtered to non-blocking", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  BUILD_FAILURE_REPORT: {
    artifactType: "BUILD_FAILURE_REPORT", displayName: "Build Failure Report",
    description: "Real, isolated record of every real blocking Build Finding parsed from the real build process's stdout/stderr.",
    producer: "engines/shared/ide-lib/buildRuntime.ts", consumer: ["Build tab", "Problems Panel"],
    source: "real BuildFinding[] filtered to blocking", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  BUILD_INTEGRITY_REPORT: {
    artifactType: "BUILD_INTEGRITY_REPORT", displayName: "Build Integrity Report",
    description: "Real re-checksum verification of every real output file against the Build Manifest, real missing/duplicate/zero-byte/secret-leakage/source-map-leakage findings.",
    producer: "engines/shared/ide-lib/buildRuntime.ts", consumer: ["Build tab", "Problems Panel"],
    source: "real re-read + re-hash of every real output file", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  BUILD_REPRODUCIBILITY_REPORT: {
    artifactType: "BUILD_REPRODUCIBILITY_REPORT", displayName: "Build Reproducibility Report",
    description: "Real comparison of two real Build Runs' output inventories — real per-file match/mismatch, real BUILD_ID normalization documented explicitly, real reproducibilityStatus (VERIFIED/PARTIAL/NOT_VERIFIED/NOT_SUPPORTED/FAILED). Never declares VERIFIED from one run.",
    producer: "engines/shared/ide-lib/buildRuntime.ts", consumer: ["Build tab", "Problems Panel"],
    source: "real per-file checksum comparison across two real Build Runs", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  BUILD_ENVIRONMENT_REPORT: {
    artifactType: "BUILD_ENVIRONMENT_REPORT", displayName: "Build Environment Report",
    description: "Real Environment Profile snapshot at Build time — real node/npm version, real OS/arch, real environment-key presence-only check (never a value).",
    producer: "engines/shared/ide-lib/buildRuntime.ts", consumer: ["Build tab"],
    source: "real process.version/process.platform/process.arch + real `npm --version` + real presence-only env scan", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  BUILD_EVIDENCE_PACKAGE: {
    artifactType: "BUILD_EVIDENCE_PACKAGE", displayName: "Build Evidence Package",
    description: "Real, aggregated Evidence Warehouse bundle for one Build Run — cites the real Change Set/Review/Test Run artifacts this Build depended on, plus this Build's own real Artifacts.",
    producer: "engines/shared/ide-lib/buildRuntime.ts", consumer: ["Build tab", "Evidence Warehouse"],
    source: "real cross-references to changeSetRuntime.ts/testRuntime.ts/artifactRuntime.ts records", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  BUILD_GATE_REPORT: {
    artifactType: "BUILD_GATE_REPORT", displayName: "Build Gate Report",
    description: "Real, per-gate status (Registry/Governance/Review/Test/Artifact Integrity/Source Fingerprint/Reproducibility/Architecture Drift/Factory Coverage/Capability Registration) with real evidence citations — PASSED/FAILED/BLOCKED/UNKNOWN/NOT_IMPLEMENTED per gate, never a guessed status (owner, 2026-08-07, Software Factory Step 9.5).",
    producer: "engines/shared/ide-lib/buildRuntime.ts", consumer: ["Build tab", "Problems Panel"],
    source: "real registry/architecture-book.json, registry/factory-summary.json, registry/system-control-summary.json, changeSetRuntime.ts, testRuntime.ts", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  BUILD_PRECONDITIONS_REPORT: {
    artifactType: "BUILD_PRECONDITIONS_REPORT", displayName: "Build Preconditions Report",
    description: "Real, itemized Precondition results (each with a real pass/fail + evidence) computed BEFORE any Build process runs — the same real checks evaluatePreconditions() enforces, exposed as a real, immutable record for audit (owner, 2026-08-07, Software Factory Step 9.5).",
    producer: "engines/shared/ide-lib/buildRuntime.ts", consumer: ["Build tab", "Problems Panel"],
    source: "engines/shared/ide-lib/buildRuntime.ts#evaluatePreconditions", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  MIGRATION_INTEGRITY_REPORT: {
    artifactType: "MIGRATION_INTEGRITY_REPORT", displayName: "Migration Integrity Report",
    description: "Real, repo-wide (not just changed-file-scoped) analysis of every real supabase/migrations/*.sql file — real Lineage (per-table create/alter/drop history), real Dependency edges, real duplicate-timestamp Conflicts, real chronological Ordering. Report only — never renames, deletes, or auto-fixes a migration file (owner, 2026-08-07, Software Factory Step 9.5).",
    producer: "engines/shared/ide-lib/buildRuntime.ts", consumer: ["Build tab", "Problems Panel"],
    source: "real supabase/migrations/*.sql file content + filenames", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  BUILD_DECISION: {
    artifactType: "BUILD_DECISION", displayName: "Build Decision",
    description: "Real, deterministic explanation of why a Build Run was ALLOWED or BLOCKED — cites the exact real gate(s) and Precondition(s) responsible, never a vague or fabricated reason (owner, 2026-08-07, Software Factory Step 9.5).",
    producer: "engines/shared/ide-lib/buildRuntime.ts", consumer: ["Build tab", "Problems Panel"],
    source: "real BuildGateReport + real evaluatePreconditions() result", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  RELEASE_CANDIDATE: {
    artifactType: "RELEASE_CANDIDATE", displayName: "Release Candidate",
    description: "Real, immutable snapshot referencing exactly one real, successful Build Run — never a new build, never a copy of build output (owner, 2026-08-07, Software Factory Step 10).",
    producer: "engines/shared/ide-lib/releaseRuntime.ts", consumer: ["Release tab", "Problems Panel"],
    source: "real BuildRun (Step 9/9.5)", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  RELEASE_REPORT: {
    artifactType: "RELEASE_REPORT", displayName: "Release Report",
    description: "Real, full Release Pipeline run report — real per-stage status (Release Candidate/Validation/Capability Packaging/Approval/Operational Ready), never a guessed summary (owner, 2026-08-07, Software Factory Step 10).",
    producer: "engines/shared/ide-lib/releaseRuntime.ts", consumer: ["Release tab", "Problems Panel"],
    source: "real ReleaseRun record", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  PACKAGE_MANIFEST: {
    artifactType: "PACKAGE_MANIFEST", displayName: "Capability Package Manifest",
    description: "Real, per-Capability package manifest (dependencies, required Runtime, required Registry, business domain, evidence, version, compatibility, Country Package dependency, owner, lifecycle) built ONLY from registry/capability-registry.json's real, frozen capabilities (owner, 2026-08-07, Software Factory Step 10).",
    producer: "engines/shared/ide-lib/releaseRuntime.ts", consumer: ["Release tab", "Problems Panel"],
    source: "registry/capability-registry.json", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  PACKAGE_INTEGRITY: {
    artifactType: "PACKAGE_INTEGRITY", displayName: "Capability Package Integrity",
    description: "Real integrity check across every real Capability Package this Release produced — real missing OwnerModule detection, real duplicate CapabilityId detection, real checksum verification (owner, 2026-08-07, Software Factory Step 10).",
    producer: "engines/shared/ide-lib/releaseRuntime.ts", consumer: ["Release tab", "Problems Panel"],
    source: "real per-Capability Package manifests", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  OPERATIONAL_READINESS: {
    artifactType: "OPERATIONAL_READINESS", displayName: "Operational Readiness Report",
    description: "Real, per-dimension Operational Readiness (Production/Factory/Business/Legal/Evidence/Infrastructure/AI/Runtime/Package/Deployment) — UNKNOWN/NOT_IMPLEMENTED honestly reported wherever no real data source exists (owner, 2026-08-07, Software Factory Step 10).",
    producer: "engines/shared/ide-lib/releaseRuntime.ts", consumer: ["Release tab", "Problems Panel"],
    source: "registry/business-coverage.json, registry/AI_REGISTRY.json, registry/infrastructure.json, registry/factory-summary.json", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  RELEASE_DECISION: {
    artifactType: "RELEASE_DECISION", displayName: "Release Decision",
    description: "Real, deterministic explanation of why a Release Run was ALLOWED or BLOCKED — cites the exact real Release Validation/Capability Packaging results responsible, never a vague or fabricated reason (owner, 2026-08-07, Software Factory Step 10).",
    producer: "engines/shared/ide-lib/releaseRuntime.ts", consumer: ["Release tab", "Problems Panel"],
    source: "real ReleaseRun stage results", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  DEPLOYMENT_PLAN: {
    artifactType: "DEPLOYMENT_PLAN", displayName: "Deployment Plan",
    description: "Real, immutable snapshot of a Deployment Plan (Stage/Target/Rollback Plan/Gate/Approval/Manifest), computed ONLY from a real, already-READY Release Run — never triggers a real deploy, never calls Vercel/Supabase, never Git Push (owner, 2026-08-08, Software Factory Step 11).",
    producer: "engines/shared/ide-lib/deploymentRuntime.ts", consumer: ["Deployment tab", "Problems Panel"],
    source: "real ReleaseRun (Step 10) + real Factory Completion Gates (Step 10.5)", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  DEPLOYMENT_AUDIT: {
    artifactType: "DEPLOYMENT_AUDIT", displayName: "Deployment Audit",
    description: "Real, deterministic audit record of a Deployment Plan's Gate + Approval evaluation — cites the exact real Deployment Gate results responsible, honestly BLOCKED whenever DEPLOYMENT_READY is not real (owner, 2026-08-08, Software Factory Step 11).",
    producer: "engines/shared/ide-lib/deploymentRuntime.ts", consumer: ["Deployment tab", "Problems Panel"],
    source: "real DeploymentPlan stage results", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  RUNTIME_DEPENDENCY_REPORT: {
    artifactType: "RUNTIME_DEPENDENCY_REPORT", displayName: "Runtime Dependency Report",
    description: "Real Runtime Graph — nodes/edges computed MECHANICALLY from each real Runtime file's own real import statements (grep-verified, never guessed); Monitoring/Incident/Recovery honestly reported NOT_IMPLEMENTED (no real source file exists) (owner, 2026-08-08, Software Factory Step 11).",
    producer: "engines/shared/ide-lib/globalFactoryRuntime.ts", consumer: ["Global Factory tab", "Problems Panel"],
    source: "real engines/shared/ide-lib/*.ts import statements", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: true, status: "IMPLEMENTED",
  },
  FACTORY_RUNTIME_REPORT: {
    artifactType: "FACTORY_RUNTIME_REPORT", displayName: "Factory Runtime Report",
    description: "Real, internal composition health-check of the Global Factory Runtime itself — which real sub-Runtimes it successfully reached and what each returned, never fabricated as fully wired (owner, 2026-08-08, Software Factory Step 11).",
    producer: "engines/shared/ide-lib/globalFactoryRuntime.ts", consumer: ["Global Factory tab", "Problems Panel"],
    source: "live calls into releaseRuntime.ts/factoryCompletionRuntime.ts/deploymentRuntime.ts", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: true, status: "IMPLEMENTED",
  },
  GLOBAL_FACTORY_REPORT: {
    artifactType: "GLOBAL_FACTORY_REPORT", displayName: "Global Factory Report",
    description: "Real, top-level aggregate across Factory/Workspace/Capability/Package/Deployment/Monitoring/Incident/Recovery — every domain sourced from a real, already-existing Runtime/registry; Monitoring/Incident honestly NOT_IMPLEMENTED, Recovery honestly PARTIAL (owner, 2026-08-08, Software Factory Step 11).",
    producer: "engines/shared/ide-lib/globalFactoryRuntime.ts", consumer: ["Global Factory tab", "Problems Panel"],
    source: "registry/factory-summary.json + releaseRuntime.ts + factoryCompletionRuntime.ts + deploymentRuntime.ts", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: true, status: "IMPLEMENTED",
  },
  MONITORING_SNAPSHOT: {
    artifactType: "MONITORING_SNAPSHOT", displayName: "Monitoring Snapshot",
    description: "Real, immutable snapshot of computeMonitoringSummary() at a point in time — never a fabricated health rollup (owner, 2026-08-08, Software Factory Step 12).",
    producer: "engines/shared/ide-lib/monitoringRuntime.ts", consumer: ["Operations tab", "Problems Panel"],
    source: "real, live Signal Records", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  HEALTH_SIGNAL_REPORT: {
    artifactType: "HEALTH_SIGNAL_REPORT", displayName: "Health Signal Report",
    description: "Real, immutable snapshot of one collected Signal Record — sourceHash-verified, never a guessed status (owner, 2026-08-08, Software Factory Step 12).",
    producer: "engines/shared/ide-lib/monitoringRuntime.ts", consumer: ["Operations tab", "Problems Panel"],
    source: "real signal collector output", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  INCIDENT_RECORD: {
    artifactType: "INCIDENT_RECORD", displayName: "Incident Record",
    description: "Real, immutable snapshot of an Incident opened from a real Monitoring finding — never opened from a guess (owner, 2026-08-08, Software Factory Step 12).",
    producer: "engines/shared/ide-lib/incidentRuntime.ts", consumer: ["Operations tab", "Problems Panel"],
    source: "real IncidentRecord", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  INCIDENT_TIMELINE: {
    artifactType: "INCIDENT_TIMELINE", displayName: "Incident Timeline",
    description: "Real, immutable snapshot of an Incident's real status-transition timeline — every entry cites a real actor and real evidence, never a fabricated status history (owner, 2026-08-08, Software Factory Step 12).",
    producer: "engines/shared/ide-lib/incidentRuntime.ts", consumer: ["Operations tab", "Problems Panel"],
    source: "real IncidentRecord.timeline", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  INCIDENT_IMPACT_REPORT: {
    artifactType: "INCIDENT_IMPACT_REPORT", displayName: "Incident Impact Report",
    description: "Real dependency impact (direct + transitive) computed from the real Step 11 Runtime Dependency Graph — never a guessed blast radius (owner, 2026-08-08, Software Factory Step 12).",
    producer: "engines/shared/ide-lib/incidentRuntime.ts", consumer: ["Operations tab", "Problems Panel"],
    source: "engines/shared/ide-lib/globalFactoryRuntime.ts#computeRuntimeDependencyGraph", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  RECOVERY_PLAN: {
    artifactType: "RECOVERY_PLAN", displayName: "Recovery Plan",
    description: "Real, immutable Recovery Plan — plan/verify only this Step, never a real mutation record (owner, 2026-08-08, Software Factory Step 12).",
    producer: "engines/shared/ide-lib/recoveryRuntime.ts", consumer: ["Operations tab", "Problems Panel"],
    source: "real RecoveryPlan", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  RECOVERY_READINESS_REPORT: {
    artifactType: "RECOVERY_READINESS_REPORT", displayName: "Recovery Readiness Report",
    description: "Real, deterministic precondition + impact evaluation for a Recovery Plan — never a fabricated readiness (owner, 2026-08-08, Software Factory Step 12).",
    producer: "engines/shared/ide-lib/recoveryRuntime.ts", consumer: ["Operations tab", "Problems Panel"],
    source: "real RecoveryPlan preconditions", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  RECOVERY_VERIFICATION_REPORT: {
    artifactType: "RECOVERY_VERIFICATION_REPORT", displayName: "Recovery Verification Report",
    description: "Real verification against real, owner-imported evidence only — UNKNOWN/UNVERIFIED/PARTIAL whenever evidence is incomplete, never a guessed VERIFIED (owner, 2026-08-08, Software Factory Step 12).",
    producer: "engines/shared/ide-lib/recoveryRuntime.ts", consumer: ["Operations tab", "Problems Panel"],
    source: "real, owner-supplied verification evidence", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  BACKUP_READINESS_REPORT: {
    artifactType: "BACKUP_READINESS_REPORT", displayName: "Backup Readiness Report",
    description: "Real backup manifest + restore-test audit — honestly PARTIAL/PLAN_ONLY whenever no verified restore-test cycle exists, never claims ready to recover (owner, 2026-08-08, Software Factory Step 12).",
    producer: "engines/shared/ide-lib/monitoringRuntime.ts", consumer: ["Operations tab", "Problems Panel"],
    source: "real backups/*/_manifest.json + registry/infrastructure.json#backup", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  OPERATIONS_STATUS_REPORT: {
    artifactType: "OPERATIONS_STATUS_REPORT", displayName: "Operations Status Report",
    description: "Real, top-level Operations aggregate — Monitoring + Incidents + Recovery, every field sourced from a real, already-existing Runtime (owner, 2026-08-08, Software Factory Step 12).",
    producer: "engines/shared/ide-lib/monitoringRuntime.ts + incidentRuntime.ts + recoveryRuntime.ts", consumer: ["Operations tab", "Problems Panel"],
    source: "real Monitoring/Incident/Recovery Runtimes", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: true, status: "IMPLEMENTED",
  },
  CONTINUOUS_MONITORING_RUN: {
    artifactType: "CONTINUOUS_MONITORING_RUN", displayName: "Continuous Monitoring Run",
    description: "Real, immutable snapshot of one Operations Loop run — real steps/signals/incidents/alerts, real duration, real sourceHash (owner, 2026-08-08, Software Factory Step 12.5).",
    producer: "engines/shared/ide-lib/continuousOperationsRuntime.ts", consumer: ["Operations tab", "Problems Panel"],
    source: "real monitoringRuntime.ts/incidentRuntime.ts/alertRuntime.ts calls made during the run", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  ALERT_RECORD: {
    artifactType: "ALERT_RECORD", displayName: "Alert Record",
    description: "Real, immutable Alert snapshot — DISPATCHED never implies DELIVERED (no real delivery receipt exists for any channel) (owner, 2026-08-08, Software Factory Step 12.5).",
    producer: "engines/shared/ide-lib/alertRuntime.ts", consumer: ["Operations tab", "Problems Panel"],
    source: "real AlertRecord", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  ALERT_DISPATCH_REPORT: {
    artifactType: "ALERT_DISPATCH_REPORT", displayName: "Alert Dispatch Report",
    description: "Real, per-channel dispatch result (LINE/WEBHOOK/OWNER_UI/SYSTEM_EVENT) — ok:false is recorded honestly, never hidden (owner, 2026-08-08, Software Factory Step 12.5).",
    producer: "engines/shared/ide-lib/alertRuntime.ts", consumer: ["Operations tab", "Problems Panel"],
    source: "real ChannelDispatchResult[]", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  BACKUP_PLAN: {
    artifactType: "BACKUP_PLAN", displayName: "Backup Plan",
    description: "Real, declarative plan of what backupRuntime.ts WOULD back up per real, declared Backup Scope — never triggers a real backup (owner, 2026-08-08, Software Factory Step 12.5).",
    producer: "engines/shared/ide-lib/backupRuntime.ts", consumer: ["Operations tab", "Problems Panel"],
    source: "backupRegistry.ts real Backup Scope declarations", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  BACKUP_MANIFEST: {
    artifactType: "BACKUP_MANIFEST", displayName: "Backup Manifest",
    description: "Real, immutable wrap of an existing, real backups/*/_manifest.json file — never a fabricated manifest (owner, 2026-08-08, Software Factory Step 12.5).",
    producer: "engines/shared/ide-lib/backupRuntime.ts", consumer: ["Operations tab", "Problems Panel"],
    source: "real backups/*/_manifest.json", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  BACKUP_INTEGRITY_REPORT: {
    artifactType: "BACKUP_INTEGRITY_REPORT", displayName: "Backup Integrity Report",
    description: "Real, deterministic integrity verification (manifest/checksum/scope/staleness) — never VERIFIED from file presence alone (owner, 2026-08-08, Software Factory Step 12.5).",
    producer: "engines/shared/ide-lib/backupRuntime.ts", consumer: ["Operations tab", "Problems Panel"],
    source: "real per-table backup file reads + real sha256 checksums computed at verification time", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  RESTORE_TEST_PLAN: {
    artifactType: "RESTORE_TEST_PLAN", displayName: "Restore Test Plan",
    description: "Real, declarative restore-test plan referencing a real, verified Backup — plan only, never a real restore (owner, 2026-08-08, Software Factory Step 12.5).",
    producer: "engines/shared/ide-lib/restoreTestRuntime.ts", consumer: ["Operations tab", "Problems Panel"],
    source: "real BackupIntegrityReport", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  RESTORE_TEST_RUN: {
    artifactType: "RESTORE_TEST_RUN", displayName: "Restore Test Run",
    description: "Real, immutable dry-run/parser-based restore test execution record — every stage's real status, never a fabricated PASSED (owner, 2026-08-08, Software Factory Step 12.5).",
    producer: "engines/shared/ide-lib/restoreTestRuntime.ts", consumer: ["Operations tab", "Problems Panel"],
    source: "real per-table backup file parse + real row-count comparison against the real manifest", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  RESTORE_VERIFICATION_REPORT: {
    artifactType: "RESTORE_VERIFICATION_REPORT", displayName: "Restore Verification Report",
    description: "Real verification result — PLAN_ONLY/PARTIAL honestly reported whenever no isolated restore target exists, never a fabricated VERIFIED_RESTORE (owner, 2026-08-08, Software Factory Step 12.5).",
    producer: "engines/shared/ide-lib/restoreTestRuntime.ts", consumer: ["Operations tab", "Problems Panel"],
    source: "real RestoreTestRun stage results", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  OPERATIONS_READINESS_REPORT: {
    artifactType: "OPERATIONS_READINESS_REPORT", displayName: "Operations Readiness Report",
    description: "Real, top-level readiness aggregate across Monitoring/Incident/Recovery/Backup/Alerting — every field sourced from a real, already-existing Runtime (owner, 2026-08-08, Software Factory Step 12.5).",
    producer: "engines/shared/ide-lib/continuousOperationsRuntime.ts", consumer: ["Operations tab", "Problems Panel"],
    source: "real Monitoring/Incident/Recovery/Alert/Backup/RestoreTest Runtimes", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: true, status: "IMPLEMENTED",
  },
  WORKSPACE_SESSION: {
    artifactType: "WORKSPACE_SESSION", displayName: "Workspace Session",
    description: "Real, immutable snapshot of a Factory Workspace Session — the single, real, owner-scoped record tying Intent -> Capability Resolution -> Context Plan -> Worker Assignment -> Execution Plan -> Change Set -> Result together (owner, 2026-08-08, Software Factory Step 13).",
    producer: "engines/shared/ide-lib/factoryWorkspaceRuntime.ts", consumer: ["Factory Workspace tab", "Problems Panel"],
    source: "real WorkspaceSession record", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  INTENT_RECORD: {
    artifactType: "INTENT_RECORD", displayName: "Intent Record",
    description: "Real, structured Owner intent — raw text preserved verbatim, structured fields honestly marked AI_PROPOSED until Owner-confirmed, never AI-owned (owner, 2026-08-08, Software Factory Step 13).",
    producer: "engines/shared/ide-lib/intentRuntime.ts", consumer: ["Factory Workspace tab", "Problems Panel"],
    source: "real StructuredIntent", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  CAPABILITY_RESOLUTION_REPORT: {
    artifactType: "CAPABILITY_RESOLUTION_REPORT", displayName: "Capability Resolution Report",
    description: "Real, deterministic, multi-factor Capability match report against the real, frozen 202-capability registry — never a name-only match (owner, 2026-08-08, Software Factory Step 13).",
    producer: "engines/shared/ide-lib/capabilityResolverRuntime.ts", consumer: ["Factory Workspace tab", "Problems Panel"],
    source: "registry/capability-registry.json", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  CONTEXT_PLAN: {
    artifactType: "CONTEXT_PLAN", displayName: "Context Plan",
    description: "Real, scoped context selection — included/excluded files with real reasons, real source fingerprint, real forbidden-path enforcement (never .env/secrets/other workspaces) (owner, 2026-08-08, Software Factory Step 13).",
    producer: "engines/shared/ide-lib/contextPlannerRuntime.ts", consumer: ["Factory Workspace tab", "Problems Panel"],
    source: "real file tree + real Capability Resolution + real Change Set scope", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  AI_CONTEXT_PACKAGE: {
    artifactType: "AI_CONTEXT_PACKAGE", displayName: "AI Context Package",
    description: "Real, provider-neutral request package built ONLY from an approved Context Plan — real context fingerprint, real scoped read/write, never cross-workspace (owner, 2026-08-08, Software Factory Step 13).",
    producer: "engines/shared/ide-lib/aiContextRuntime.ts", consumer: ["Factory Workspace tab", "Problems Panel"],
    source: "real, approved ContextPlan", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  WORKER_ASSIGNMENT: {
    artifactType: "WORKER_ASSIGNMENT", displayName: "Worker Assignment",
    description: "Real Worker selection from the real Worker Registry — deterministic selection criteria, never a hardcoded provider monopoly (owner, 2026-08-08, Software Factory Step 13).",
    producer: "engines/shared/ide-lib/workerRegistry.ts", consumer: ["Factory Workspace tab", "Problems Panel"],
    source: "real WORKER_REGISTRY declarations", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  EXECUTION_PLAN: {
    artifactType: "EXECUTION_PLAN", displayName: "Execution Plan",
    description: "Real, ordered step plan from Intent->Capability->Context->Worker — every step's real mutationLevel declared, EXTERNAL_MUTATION always BLOCKED this Step (owner, 2026-08-08, Software Factory Step 13).",
    producer: "engines/shared/ide-lib/executionPlanRuntime.ts", consumer: ["Factory Workspace tab", "Problems Panel"],
    source: "real WorkspaceSession state", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  OWNER_DECISION_RECORD: {
    artifactType: "OWNER_DECISION_RECORD", displayName: "Owner Decision Record",
    description: "Real, owner-authored decision at a real Decision Gate — AI may never approve on the Owner's behalf (owner, 2026-08-08, Software Factory Step 13).",
    producer: "engines/shared/ide-lib/factoryWorkspaceRuntime.ts", consumer: ["Factory Workspace tab", "Problems Panel"],
    source: "real owner decision input", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  NATIVE_FACTORY_RUN: {
    artifactType: "NATIVE_FACTORY_RUN", displayName: "Native Factory Run",
    description: "Real, end-to-end record of one Intent->...->Release Candidate native flow — reuses real Review/Test/Build/Release Runtimes throughout, never a fabricated demo (owner, 2026-08-08, Software Factory Step 13).",
    producer: "engines/shared/ide-lib/factoryWorkspaceRuntime.ts", consumer: ["Factory Workspace tab", "Problems Panel"],
    source: "real changeSetRuntime.ts/testRuntime.ts/buildRuntime.ts/releaseRuntime.ts calls made during the run", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  OUTCOME_REPORT: {
    artifactType: "OUTCOME_REPORT", displayName: "Outcome Report",
    description: "Real result summary — never claims OUTCOME_PROVEN without a real, checkable, real-world effect; reports Capability reuse/gaps, Worker/Provider used, files changed, tests/build/governance results honestly (owner, 2026-08-08, Software Factory Step 13).",
    producer: "engines/shared/ide-lib/factoryWorkspaceRuntime.ts", consumer: ["Factory Workspace tab", "Problems Panel"],
    source: "real WorkspaceSession full state", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  VS_CODE_DEPENDENCY_REPORT: {
    artifactType: "VS_CODE_DEPENDENCY_REPORT", displayName: "VS Code Dependency Report",
    description: "Real, per-stage classification of this native flow run (DNA_OS_NATIVE/EXTERNAL_TOOL_HIDDEN/OWNER_EXTERNAL_ACTION_REQUIRED/MANUAL/NOT_IMPLEMENTED/UNKNOWN) — never claims FULL_EXIT while Deploy/Provider operations remain non-native (owner, 2026-08-08, Software Factory Step 13).",
    producer: "engines/shared/ide-lib/factoryWorkspaceRuntime.ts", consumer: ["Factory Workspace tab", "Problems Panel"],
    source: "real, live NativeFactoryRun stage classification", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  CODE_WORKER_PROPOSAL: {
    artifactType: "CODE_WORKER_PROPOSAL", displayName: "Code Worker Proposal",
    description: "Real, raw output from a real programmatic CODE_WORKER provider call (services/ai/gateway.ts's real code.generate capability) — never applied to disk until a separate, explicit real Owner approval (owner, 2026-08-08, Software Factory Step 13.5).",
    producer: "engines/shared/ide-lib/codeWorkerRuntime.ts", consumer: ["Factory Workspace tab", "Problems Panel"],
    source: "real AiGatewayResult from services/ai/gateway.ts#invokeAiGateway", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  SECURITY_EXECUTION_GATE_RECORD: {
    artifactType: "SECURITY_EXECUTION_GATE_RECORD", displayName: "Security Execution Gate Record",
    description: "Real, immutable evidence of every real Owner request to execute a Restricted Security Capability — records the full real checklist (Intent/Authorization/Target/Scope/Risk/Evidence/Rollback/Stop Condition/Legal Notice) and the real outcome, whether ALLOWED or BLOCKED (owner, 2026-08-08, Software Factory Step 13.25).",
    producer: "engines/shared/ide-lib/securityExecutionRuntime.ts", consumer: ["Owner Console (internal only)"],
    source: "real SecurityExecutionGateRequest + real gate evaluation", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  WORKER_REQUEST: {
    artifactType: "WORKER_REQUEST", displayName: "Worker Request",
    description: "Real, provider-neutral WorkerRequest sent to the Universal Worker Bridge — the exact contract every Adapter receives (owner, 2026-08-08, Software Factory Step 13.6).",
    producer: "engines/shared/ide-lib/codeWorkerRuntime.ts", consumer: ["Factory Workspace tab", "Problems Panel"],
    source: "real WorkerRequest object", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  WORKER_SELECTION_REPORT: {
    artifactType: "WORKER_SELECTION_REPORT", displayName: "Worker Selection Report",
    description: "Real, deterministic Worker Selector output — every candidate considered, eligibility reasons, and the real, explained selection outcome (owner, 2026-08-08, Software Factory Step 13.6).",
    producer: "engines/shared/ide-lib/workerSelectorRuntime.ts", consumer: ["Factory Workspace tab", "Problems Panel"],
    source: "real WorkerSelectionResult", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  WORKER_EXECUTION_RECORD: {
    artifactType: "WORKER_EXECUTION_RECORD", displayName: "Worker Execution Record",
    description: "Real WorkerResponse from a real Adapter execute() call — status/output/proposedChanges/cost/evidence, whatever the real outcome was (owner, 2026-08-08, Software Factory Step 13.6).",
    producer: "engines/shared/ide-lib/codeWorkerRuntime.ts", consumer: ["Factory Workspace tab", "Problems Panel"],
    source: "real WorkerResponse", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  PROVIDER_CALL_RECORD: {
    artifactType: "PROVIDER_CALL_RECORD", displayName: "Provider Call Record",
    description: "Real, per-call evidence for an API Adapter invocation (Anthropic via services/ai/gateway.ts) — provider/model/tokenUsage/cost as reported by the real gateway (owner, 2026-08-08, Software Factory Step 13.6).",
    producer: "engines/shared/ide-lib/workerAdapters/apiWorkerAdapter.ts", consumer: ["Factory Workspace tab"],
    source: "real AiGatewayResult provenance", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  CLI_EXECUTION_RECORD: {
    artifactType: "CLI_EXECUTION_RECORD", displayName: "CLI Execution Record",
    description: "Real, per-call evidence for a CLI Adapter invocation (real spawn of the claude binary, argv-safe) — real stdout envelope, real cost, real duration (owner, 2026-08-08, Software Factory Step 13.6).",
    producer: "engines/shared/ide-lib/workerAdapters/cliWorkerAdapter.ts", consumer: ["Factory Workspace tab"],
    source: "real CLI process result envelope", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  MCP_EXECUTION_RECORD: {
    artifactType: "MCP_EXECUTION_RECORD", displayName: "MCP Execution Record",
    description: "Real evidence for an MCP Adapter invocation attempt — honestly always NOT_SUPPORTED this Step (no real MCP client exists in this repo) (owner, 2026-08-08, Software Factory Step 13.6).",
    producer: "engines/shared/ide-lib/workerAdapters/mcpWorkerAdapter.ts", consumer: ["Factory Workspace tab"],
    source: "real WorkerResponse from mcpWorkerAdapter", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  LOCAL_MODEL_EXECUTION_RECORD: {
    artifactType: "LOCAL_MODEL_EXECUTION_RECORD", displayName: "Local Model Execution Record",
    description: "Real, per-call evidence for a Local Model Adapter invocation (Ollama via services/ai/gateway.ts) — real $0 ACTUAL cost, real reachability status (owner, 2026-08-08, Software Factory Step 13.6).",
    producer: "engines/shared/ide-lib/workerAdapters/localModelWorkerAdapter.ts", consumer: ["Factory Workspace tab"],
    source: "real AiGatewayResult provenance", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  EXECUTION_BUDGET_REPORT: {
    artifactType: "EXECUTION_BUDGET_REPORT", displayName: "Execution Budget Report",
    description: "Real, per Workspace-Session/Execution-Step budget usage snapshot — real PRECHECK/RESERVE/RECORD/ENFORCE state, never a guessed cost (owner, 2026-08-08, Software Factory Step 13.6).",
    producer: "engines/shared/ide-lib/executionBudgetRuntime.ts", consumer: ["Factory Workspace tab", "Problems Panel"],
    source: "real BudgetRecord", format: "json", immutable: false, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  CODE_WORKER_PROPOSAL_V2: {
    artifactType: "CODE_WORKER_PROPOSAL_V2", displayName: "Code Worker Proposal (v2, Universal Worker Bridge)",
    description: "Real, structured CODE_WORKER output (operations[] with CREATE/MODIFY/DELETE/RENAME, purpose/risk/requiredTests) routed through the real Universal Worker Bridge — supersedes Step 13.5's CODE_WORKER_PROPOSAL, never applied to disk until real, separate Owner approval (owner, 2026-08-08, Software Factory Step 13.6).",
    producer: "engines/shared/ide-lib/codeWorkerRuntime.ts", consumer: ["Factory Workspace tab", "Problems Panel"],
    source: "real CodeWorkerProposal", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  WORKER_HEALTH_REPORT: {
    artifactType: "WORKER_HEALTH_REPORT", displayName: "Worker Health Report",
    description: "Real, live-checked Adapter health snapshot — never infers HEALTHY from configuration presence alone; requires a real, recent, successful live call (owner, 2026-08-08, Software Factory Step 13.6).",
    producer: "app/api/admin/ide/workers/[id]/health/route.ts", consumer: ["Factory Workspace tab", "Problems Panel"],
    source: "real WorkerHealthReport", format: "json", immutable: false, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  DOMAIN_ASSET_RECORD: {
    artifactType: "DOMAIN_ASSET_RECORD", displayName: "Domain Asset Record",
    description: "Real, Owner-registered domain asset declaration — the real safety boundary for External Attack Surface Discovery; never scanned until separately, explicitly verified (owner, 2026-08-08, Software Factory Step 13.7).",
    producer: "engines/shared/ide-lib/domainAssetRuntime.ts", consumer: ["Owner Console (internal only)"],
    source: "real DomainAsset record", format: "json", immutable: false, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  SUBDOMAIN_DISCOVERY_REPORT: {
    artifactType: "SUBDOMAIN_DISCOVERY_REPORT", displayName: "Subdomain Discovery Report",
    description: "Real, passive subdomain enumeration output (Subfinder) for one real, verified Domain Asset — never active/brute-force discovery (owner, 2026-08-08, Software Factory Step 13.7).",
    producer: "engines/shared/ide-lib/externalDiscoveryAdapters/subfinderAdapter.ts", consumer: ["Owner Console (internal only)"],
    source: "real subfinder CLI JSON output", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  DNS_VERIFICATION_REPORT: {
    artifactType: "DNS_VERIFICATION_REPORT", displayName: "DNS Verification Report",
    description: "Real DNS resolution results (Node's built-in dns module) for every real, discovered candidate host — honest NXDOMAIN/error handling, never guessed (owner, 2026-08-08, Software Factory Step 13.7).",
    producer: "engines/shared/ide-lib/externalDiscoveryAdapters/dnsVerificationRuntime.ts", consumer: ["Owner Console (internal only)"],
    source: "real dns.promises resolution results", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  HTTP_PROBE_REPORT: {
    artifactType: "HTTP_PROBE_REPORT", displayName: "HTTP Probe Report",
    description: "Real, non-invasive HTTP/HTTPS liveness probe output (httpx) — status code/title/technology/IP/redirect, never fuzzing/bruteforce/exploitation (owner, 2026-08-08, Software Factory Step 13.7).",
    producer: "engines/shared/ide-lib/externalDiscoveryAdapters/httpxAdapter.ts", consumer: ["Owner Console (internal only)"],
    source: "real httpx CLI JSON output", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  TLS_EVIDENCE_RECORD: {
    artifactType: "TLS_EVIDENCE_RECORD", displayName: "TLS Evidence Record",
    description: "Real TLS certificate metadata captured during the real, non-invasive HTTP probe — never an active TLS fuzzing/downgrade attempt (owner, 2026-08-08, Software Factory Step 13.7).",
    producer: "engines/shared/ide-lib/externalDiscoveryAdapters/httpxAdapter.ts", consumer: ["Owner Console (internal only)"],
    source: "real httpx TLS probe fields", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  EXTERNAL_DRIFT_REPORT: {
    artifactType: "EXTERNAL_DRIFT_REPORT", displayName: "External Drift Report",
    description: "Real, deterministic Source Code -> Registry -> DNS -> Public Internet comparison — classifies every real host KNOWN/NEW/CHANGED/DISAPPEARED/UNREGISTERED/UNREACHABLE, never AI-guessed (owner, 2026-08-08, Software Factory Step 13.7).",
    producer: "engines/shared/ide-lib/externalAttackSurfaceRuntime.ts", consumer: ["Owner Console (internal only)", "Problems Panel"],
    source: "real, deterministic 4-layer comparison", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  COMMAND_INVOCATION: {
    artifactType: "COMMAND_INVOCATION", displayName: "Command Invocation",
    description: "Real record of one Owner Command Surface invocation — raw text, resolved intent, dispatch outcome, and evidence — never a fabricated log (owner, 2026-08-07, /admin/ide Foundation).",
    producer: "engines/shared/ide-lib/commandSurfaceRuntime.ts", consumer: ["Owner Console (internal only)", "Problems Panel"],
    source: "real, deterministic intent resolution", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  EXECUTION_CONTEXT_CHECKPOINT: {
    artifactType: "EXECUTION_CONTEXT_CHECKPOINT", displayName: "Execution Context Checkpoint",
    description: "Real, append-only snapshot of the Software Factory's persisted Execution Context (current_step, blockers, live architecture/governance/worker/capability state) — written to registry/EXECUTION_CONTEXT.json, survives dev-server restart (owner, 2026-08-07, /admin/ide Foundation).",
    producer: "engines/shared/ide-lib/executionContextRuntime.ts", consumer: ["Owner Console (internal only)", "/admin/ide"],
    source: "registry/EXECUTION_CONTEXT.json", format: "json", immutable: true, retention: "permanent, append-only", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  FACTORY_READINESS_REPORT: {
    artifactType: "FACTORY_READINESS_REPORT", displayName: "Factory Readiness Report",
    description: "Real, live, evidence-based READY/NOT_READY verdict across the full Instruction -> Release Gate closed loop — every stage computed from a live check (file existence, live worker health, live registry status), never hardcoded (owner, 2026-08-07, Software Factory Foundation full-pipeline audit).",
    producer: "engines/shared/ide-lib/factoryReadinessGateRuntime.ts", consumer: ["Owner Console (internal only)"],
    source: "live, real evidence across executionContextRuntime/workerSelectorRuntime/restrictedCapabilityRegistry/executionRegistry/deploymentRegistry/gitReadOnly", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: true, status: "IMPLEMENTED",
  },
  MANAGER_QUESTION_RECORD: {
    artifactType: "MANAGER_QUESTION_RECORD", displayName: "Manager Question Record",
    description: "Real, immutable, versioned snapshot of one aggregated Worker/Job question's lifecycle inside the Manager Question Queue (submit/dedupe/registry-lookup/resolve-internally/escalate/owner-answer/fan-out) — the real build for Constitution Rule 251 (Single Owner Inquiry Authority): only the Factory Manager may ask the Owner directly, Workers route every question through it first (owner, 2026-08-09, TASK-042).",
    producer: "engines/shared/ide-lib/managerQuestionRuntime.ts", consumer: ["Factory Workspace tab", "Owner Console (Manager Question Queue)"],
    source: "real WorkerQuestionAsk submissions, real registry-first lookup results (CONSTITUTION.json/CURRENT_STATE.json/CHANGELOG.json/rule-coverage.json/factory-registry.json), real Owner answer", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  ORCHESTRATOR_WORK_ITEM_RECORD: {
    artifactType: "ORCHESTRATOR_WORK_ITEM_RECORD", displayName: "Orchestrator Work Item Record",
    description: "Real, immutable, versioned snapshot of one Work Item's lifecycle through the Switch-Based Orchestrator's gate pipeline (VALIDATE/CLASSIFY/DEDUP/NOISE_FILTER/DEPENDENCY_CHECK/LOCK/ROUTE/WORKER/VERIFY/REPAIR) and its 9-value state machine (BLOCKED/READY/LOCKED/RUNNING/VERIFYING/PASSED/REPAIR/REJECTED/DONE) — MANAGER-07's own control/route/lock/unlock/schedule/observe boundary (Constitution Rule 252) never Worker-role content computation (owner, 2026-08-09, Switch-Based Orchestrator).",
    producer: "engines/shared/ide-lib/switchBasedOrchestratorRuntime.ts", consumer: ["Owner Console (internal only)", "scripts/switch-based-orchestrator-test.ts"],
    source: "real GateInputSubmission intake, real registry-first classification/lock/route decisions, real dispatch-denial evidence from registry/WORKER_IDENTITIES.json", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  COST_GATE_DECISION: {
    artifactType: "COST_GATE_DECISION", displayName: "Cost Gate Decision",
    description: "Real, immutable snapshot of one real COST_GATE RELEASE/LOCK decision (Constitution Rule 257 — Execution Plane Cost Gate, TASK-048/FCR-009): the real provider/operation/estimated_cost/currency/max_cost/reason/task_id/worker_id/evidence checked, which real budget (if any) covered it, and — for a LOCK — the real financial_approval_required escalation outcome via managerQuestionRuntime.ts's single Owner Inquiry channel. Separate from registry/COST_LEDGER.json (which records real ACTUAL post-execution cost, not the gate decision itself).",
    producer: "engines/shared/ide-lib/costGateRuntime.ts", consumer: ["Owner Console (internal only)", "scripts/cost-gate-test.ts"],
    source: "real CostGateRequest input, real registry/COST_BUDGETS.json lookup, real submitWorkerQuestion() escalation outcome when LOCKed", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  EDGE_FUNCTION_DISPATCH_RECORD: {
    artifactType: "EDGE_FUNCTION_DISPATCH_RECORD", displayName: "Edge Function Dispatch Record",
    description: "Real, immutable snapshot of one real EDGE_FUNCTION_WORKER dispatch attempt (owner, 2026-08-09, TASK-045 — 11th WorkerType, Owner-authorized Rule 252 exception, DNA-000082/083): the real targetFunction/payload shape, the real Cost Gate outcome checked BEFORE any network call, and — once dispatched — the real, constructed request URL and fire-and-forget/awaited outcome. This is the honest, local analog of supabase/functions/line-webhook-v2/engines/profile-refresh.ts's line_profile_refresh_queue insert step (see edgeFunctionWorkerRuntime.ts's header for why this is a local Evidence Warehouse record rather than a new, generic, cross-domain Supabase queue table this task was not scoped to design/migrate).",
    producer: "engines/shared/ide-lib/edgeFunctionWorkerRuntime.ts", consumer: ["Owner Console (internal only)", "scripts/edge-function-worker-test.ts"],
    source: "real EdgeFunctionWorkerJobContract input, real checkCostGate() outcome, real constructed fetch() request", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  CONFIG_CHANGE_RECORD: {
    artifactType: "CONFIG_CHANGE_RECORD", displayName: "Config Change Record",
    description: "Real, immutable snapshot of one real app_configs key/value write via a settings API route (owner, 2026-08-10, TASK-068 — /admin/ide Settings tab real wiring, capability #61 Phase 1) — the real key, the real new value, and the real app_configs.updated_at timestamp re-read from core/config-loader.ts's cache right after the write, never a fabricated evidence entry.",
    producer: "app/api/admin/ide/settings/route.ts (PUT), core/config/company-settings.ts's future callers", consumer: ["Owner Console (internal only)", "/admin/ide Settings tab"],
    source: "real app_configs upsert result + core/config-loader.ts#getConfigUpdatedAt", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
  SETTING_RUNTIME_RECORD: {
    artifactType: "SETTING_RUNTIME_RECORD", displayName: "Setting Runtime Record",
    description: "Real, immutable, versioned snapshot of one real IDE setting's runtime lifecycle (owner, 2026-08-10, TASK-069 — Auto-save real debounce runtime, capability #61, activating Auto-save as the first genuinely ACTIVE /admin/ide setting) — SETTING_CHANGED/SETTING_PERSISTED evidence from a real settings PUT (previous value, new value, and a real cache-confirmed persistence check), RUNTIME_BEHAVIOR_VERIFIED evidence from the real runtime consumer (e.g. saveFile() invoked via the real auto-save debounce timer) actually using the value and producing a real, observable outcome, and SETTING_RELOADED evidence from a real, fresh GET confirming the persisted value survives reload. Each write to the SAME setting key produces a new version, never overwritten in place.",
    producer: "app/api/admin/ide/settings/route.ts (PUT/GET), app/api/admin/ide/file/route.ts (PUT, autosave-triggered writes)", consumer: ["Owner Console (internal only)", "/admin/ide Settings tab"],
    source: "real app_configs read/write via core/config-loader.ts, real saveFile() write outcome reported by app/api/admin/ide/file/route.ts", format: "json", immutable: true, retention: "bounded artifact history (MAX_ARTIFACT_HISTORY)", supportsRegenerate: false, status: "IMPLEMENTED",
  },
};

export function listArtifactTypes(): ArtifactTypeDefinition[] {
  return Object.values(ARTIFACT_TYPE_REGISTRY);
}
export function getArtifactTypeDefinition(type: string): ArtifactTypeDefinition | undefined {
  return ARTIFACT_TYPE_REGISTRY[type as ArtifactType];
}
