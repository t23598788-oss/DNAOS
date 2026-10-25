/**
 * Production Queue — Job Type Registry (owner, 2026-08-06, Software
 * Factory Step 3). Declares the real job types the Production Queue
 * accepts — not implementations, just the registry entries themselves.
 * BUILD and TEST are registered per instruction but deliberately NOT
 * runnable yet (createJob() rejects them with JOB_TYPE_NOT_IMPLEMENTED) —
 * running `build`/`ide.test` as a plain RUN_COMMAND job already works
 * today via the existing Execution Runtime (Step 2), which is a different,
 * already-real path from a dedicated BUILD/TEST job pipeline.
 *
 * `factory` links each job type to its real owner in
 * registry/factory-registry.json (Phase 1.1) — not a new ownership model,
 * just referencing the one that already exists.
 */
export type JobType =
  | "OPEN_FILE" | "SAVE_FILE" | "RUN_COMMAND" | "TYPE_CHECK" | "TEST" | "BUILD" | "CUSTOM" | "UI_INSPECTION"
  | "CHANGE_SET_CREATE" | "CHANGE_SET_REFRESH" | "CODE_REVIEW" | "REVIEW_DECISION"
  | "RUN_TEST" | "RERUN_TEST" | "TEST_COLLECTION" | "TEST_REPORT"
  | "BUILD_REQUEST" | "RUN_BUILD" | "VERIFY_BUILD" | "COMPARE_BUILD" | "BUILD_REPORT"
  | "RELEASE_REQUEST" | "VALIDATE_RELEASE" | "PACKAGE_CAPABILITIES" | "APPROVE_RELEASE" | "OPERATIONAL_READINESS_CHECK"
  | "DEPLOYMENT_PLAN_REQUEST" | "DEPLOYMENT_GATE_CHECK" | "APPROVE_DEPLOYMENT"
  | "MONITORING_COLLECT" | "INCIDENT_OPEN" | "INCIDENT_STATUS_CHANGE" | "RECOVERY_PLAN_REQUEST" | "RECOVERY_APPROVE" | "RECOVERY_VERIFY"
  | "WORKER_INVOKE";

export interface JobTypeDefinition {
  id: JobType;
  label: string;
  description: string;
  factory: string;
  implemented: boolean;
}

export const JOB_TYPE_REGISTRY: Record<JobType, JobTypeDefinition> = {
  OPEN_FILE: {
    id: "OPEN_FILE", label: "Open File", factory: "software-factory", implemented: true,
    description: "Reads a real file's content via GET /api/admin/ide/file — same read path the Editor already uses.",
  },
  SAVE_FILE: {
    id: "SAVE_FILE", label: "Save File", factory: "software-factory", implemented: true,
    description: "Writes real file content via PUT /api/admin/ide/file — same conflict-safe write path the Editor already uses.",
  },
  RUN_COMMAND: {
    id: "RUN_COMMAND", label: "Run Command", factory: "runtime-factory", implemented: true,
    description: "Runs a registered command via the real Execution Runtime (Step 2) — the same engine the Terminal panel uses.",
  },
  TYPE_CHECK: {
    id: "TYPE_CHECK", label: "Type Check", factory: "runtime-factory", implemented: true,
    description: "RUN_COMMAND specialized to commandId \"typecheck\" — real `npx tsc --noEmit` via the Execution Runtime.",
  },
  TEST: {
    id: "TEST", label: "Test", factory: "qa-factory", implemented: false,
    description: "Reserved generic placeholder, deliberately left NOT implemented. The real dedicated Test Pipeline (Step 8) uses RUN_TEST/RERUN_TEST/TEST_COLLECTION/TEST_REPORT below instead — this generic id is kept for backward compatibility with any earlier reference, never repurposed.",
  },
  BUILD: {
    id: "BUILD", label: "Build", factory: "deployment-factory", implemented: false,
    description: "Reserved generic placeholder, deliberately left NOT implemented. The real dedicated Build Pipeline (Step 9) uses BUILD_REQUEST/RUN_BUILD/VERIFY_BUILD/COMPARE_BUILD/BUILD_REPORT below instead — this generic id is kept for backward compatibility with any earlier reference, never repurposed.",
  },
  CUSTOM: {
    id: "CUSTOM", label: "Custom", factory: "software-factory", implemented: false,
    description: "Reserved for a future generic/user-defined job type. No executor exists yet.",
  },
  UI_INSPECTION: {
    id: "UI_INSPECTION", label: "UI Inspection", factory: "qa-factory", implemented: true,
    description: "Real Browser Inspection Runtime scan (Step 6) — opens a real, policy-validated page via Playwright, captures real DOM/layout/style/accessibility/network evidence across the requested real viewport profiles, and records the job's real outcome via recordCompletedJob() once the scan settles.",
  },
  CHANGE_SET_CREATE: {
    id: "CHANGE_SET_CREATE", label: "Change Set Create", factory: "qa-factory", implemented: true,
    description: "Real Change Set assembly (Step 7) from the real working tree — real git status, real diffs, real impact analysis.",
  },
  CHANGE_SET_REFRESH: {
    id: "CHANGE_SET_REFRESH", label: "Change Set Refresh", factory: "qa-factory", implemented: true,
    description: "Recomputes a real Change Set's real working tree fingerprint; marks it STALE if the real working tree changed since the prior snapshot.",
  },
  CODE_REVIEW: {
    id: "CODE_REVIEW", label: "Code Review", factory: "qa-factory", implemented: true,
    description: "Runs the real Review Check Registry against a real Change Set — produces real Review Findings and a real risk assessment.",
  },
  REVIEW_DECISION: {
    id: "REVIEW_DECISION", label: "Review Decision", factory: "qa-factory", implemented: true,
    description: "Records a real owner APPROVE/REQUEST_CHANGES/REJECT decision on a real Change Set — never mutates Git state.",
  },
  RUN_TEST: {
    id: "RUN_TEST", label: "Run Test", factory: "qa-factory", implemented: true,
    description: "Real Test Pipeline run (Step 8) — executes every IMPLEMENTED real Test Suite (TypeScript/Build Readiness/IDE/Review/Inspection/UI Inspection/Governance/Artifact/Factory/Registry/Security), aggregates real results, applies the real Blocking Policy. Never Build, never Git Write.",
  },
  RERUN_TEST: {
    id: "RERUN_TEST", label: "Rerun Test", factory: "qa-factory", implemented: true,
    description: "Re-executes a real, prior Test Run's real Suites against the current working tree — creates a brand new TestRun, never mutates the original.",
  },
  TEST_COLLECTION: {
    id: "TEST_COLLECTION", label: "Test Collection", factory: "qa-factory", implemented: true,
    description: "Real result collection only, no re-execution — aggregates a Test Run's already-produced real TestResult[] into its TEST_SUMMARY/TEST_COVERAGE artifacts.",
  },
  TEST_REPORT: {
    id: "TEST_REPORT", label: "Test Report", factory: "qa-factory", implemented: true,
    description: "Produces the real TEST_REPORT artifact (per-Suite TestResult breakdown) for an already-completed real Test Run.",
  },
  BUILD_REQUEST: {
    id: "BUILD_REQUEST", label: "Build Request", factory: "deployment-factory", implemented: true,
    description: "Real Build Request validation (Step 9) — real Change Set/Review/Test Run cross-reference checks, real Preconditions, before any process runs.",
  },
  RUN_BUILD: {
    id: "RUN_BUILD", label: "Run Build", factory: "deployment-factory", implemented: true,
    description: "Real Build Run (Step 9) — runs the real `next build` (and its real prebuild gate) via the Execution Runtime, produces a real Build Manifest/Output Inventory/Integrity Report. Never Git Write, never Deploy.",
  },
  VERIFY_BUILD: {
    id: "VERIFY_BUILD", label: "Verify Build", factory: "deployment-factory", implemented: true,
    description: "Real, standalone re-verification of an already-completed Build Run's real Artifact Integrity (re-checksum, no re-build).",
  },
  COMPARE_BUILD: {
    id: "COMPARE_BUILD", label: "Compare Build", factory: "deployment-factory", implemented: true,
    description: "Real comparison of two real Build Runs for the Reproducibility Check — never declares VERIFIED from a single run.",
  },
  BUILD_REPORT: {
    id: "BUILD_REPORT", label: "Build Report", factory: "deployment-factory", implemented: true,
    description: "Produces the real BUILD_MANIFEST/BUILD_WARNING_REPORT/BUILD_FAILURE_REPORT artifacts for an already-completed real Build Run.",
  },
  RELEASE_REQUEST: {
    id: "RELEASE_REQUEST", label: "Release Request", factory: "deployment-factory", implemented: true,
    description: "Real Release Request validation (Step 10) — real, successful Build Run reference required; never Deploy, never Git Write.",
  },
  VALIDATE_RELEASE: {
    id: "VALIDATE_RELEASE", label: "Validate Release", factory: "deployment-factory", implemented: true,
    description: "Real Release Validation (Step 10) — re-checks the real Build Gate Report + Change Set/Test Run freshness + Governance coverage.",
  },
  PACKAGE_CAPABILITIES: {
    id: "PACKAGE_CAPABILITIES", label: "Package Capabilities", factory: "deployment-factory", implemented: true,
    description: "Real Capability Packaging (Step 10) — builds real per-Capability package manifests from registry/capability-registry.json's real, frozen capabilities.",
  },
  APPROVE_RELEASE: {
    id: "APPROVE_RELEASE", label: "Approve Release", factory: "deployment-factory", implemented: true,
    description: "Real, deterministic Release Approval decision (Step 10) — never Deploy, never Git Write, never an AI-originated approval.",
  },
  OPERATIONAL_READINESS_CHECK: {
    id: "OPERATIONAL_READINESS_CHECK", label: "Operational Readiness Check", factory: "deployment-factory", implemented: true,
    description: "Real, per-dimension Operational Readiness computation (Step 10) — UNKNOWN/NOT_IMPLEMENTED honestly reported wherever no real data source exists.",
  },
  DEPLOYMENT_PLAN_REQUEST: {
    id: "DEPLOYMENT_PLAN_REQUEST", label: "Deployment Plan Request", factory: "deployment-factory", implemented: true,
    description: "Real Deployment Plan computation (Step 11) — real, already-READY Release Run reference required. Never Deploy, never Vercel/Supabase call, never Git Push.",
  },
  DEPLOYMENT_GATE_CHECK: {
    id: "DEPLOYMENT_GATE_CHECK", label: "Deployment Gate Check", factory: "deployment-factory", implemented: true,
    description: "Real Deployment Gate evaluation (Step 11) — reuses factoryCompletionRuntime.ts's real DEPLOYMENT_READY gate; honestly reports BLOCKED/NOT_IMPLEMENTED since no real deploy target integration exists.",
  },
  APPROVE_DEPLOYMENT: {
    id: "APPROVE_DEPLOYMENT", label: "Approve Deployment", factory: "deployment-factory", implemented: true,
    description: "Real, deterministic Deployment Approval decision (Step 11) — never triggers a real deploy, never Git Write, never an AI-originated approval.",
  },
  MONITORING_COLLECT: {
    id: "MONITORING_COLLECT", label: "Monitoring Collect", factory: "operations-center", implemented: true,
    description: "Real Signal collection (Step 12) — observes real, already-existing sources only (executionRuntime/queueRuntime/buildRuntime/releaseRuntime/deploymentRuntime/artifactRuntime/governanceRuntime/system_health_status); never mutates production, never guesses HEALTHY.",
  },
  INCIDENT_OPEN: {
    id: "INCIDENT_OPEN", label: "Incident Open", factory: "operations-center", implemented: true,
    description: "Real Incident Record opened from a real, already-collected Monitoring finding (Step 12) — never opened from a guess, never auto-closed.",
  },
  INCIDENT_STATUS_CHANGE: {
    id: "INCIDENT_STATUS_CHANGE", label: "Incident Status Change", factory: "operations-center", implemented: true,
    description: "Real, owner-driven Incident status transition (Step 12) — never an automatic resolution.",
  },
  RECOVERY_PLAN_REQUEST: {
    id: "RECOVERY_PLAN_REQUEST", label: "Recovery Plan Request", factory: "operations-center", implemented: true,
    description: "Real Recovery Plan computation (Step 12) — plan/verify only, never a real provider mutation, deploy, rollback, or restore.",
  },
  RECOVERY_APPROVE: {
    id: "RECOVERY_APPROVE", label: "Recovery Approve", factory: "operations-center", implemented: true,
    description: "Real, deterministic Recovery Approval decision (Step 12) — approval alone never executes a real mutation.",
  },
  RECOVERY_VERIFY: {
    id: "RECOVERY_VERIFY", label: "Recovery Verify", factory: "operations-center", implemented: true,
    description: "Real Recovery Verification against real, imported evidence only (Step 12) — never guesses VERIFIED.",
  },
  WORKER_INVOKE: {
    id: "WORKER_INVOKE", label: "Worker Invoke", factory: "software-factory", implemented: true,
    description: "Real dispatch of an Owner instruction into the Worker Selector -> Worker Adapter pipeline (Step 13.6 Bridge) — every real AI Worker call (read-only repository search or CODE_WORKER mutation proposal) is a real WORKER_INVOKE Job, never skipped (owner, 2026-08-07, /admin/ide Foundation).",
  },
};

export function listJobTypes(): JobTypeDefinition[] {
  return Object.values(JOB_TYPE_REGISTRY);
}

export function getJobTypeDefinition(type: string): JobTypeDefinition | undefined {
  return JOB_TYPE_REGISTRY[type as JobType];
}
