/**
 * Code Review Pipeline — Review Check Registry (owner, 2026-08-06,
 * Software Factory Step 7). Declares the real review checks the Change
 * Set review runs. Every IMPLEMENTED check here is wired to a real
 * producer already built in prior Steps (Source Control Workspace Step 6,
 * Inspection Pipeline Step 4, UI Inspection Step 6, Governance Runtime
 * Step 4.5, Artifact Pipeline Step 5) — never a new scanner invented for
 * this step. TEST_REQUIREMENT_CHECK/BUILD_REQUIREMENT_CHECK are
 * IMPLEMENTED but deliberately narrow: they only ever report what the
 * NEXT pipeline stage must run — they never run a Test/Build Center
 * themselves (forbidden this phase).
 */
export type ReviewCheckId =
  | "CHANGE_SCOPE_CHECK" | "DIFF_INTEGRITY_CHECK" | "MODULE_REGISTRATION_CHECK" | "FACTORY_OWNERSHIP_CHECK"
  | "DEPENDENCY_IMPACT_CHECK" | "CONTRACT_IMPACT_CHECK" | "GOVERNANCE_IMPACT_CHECK" | "SECURITY_IMPACT_CHECK"
  | "INSPECTION_RESULT_CHECK" | "UI_INSPECTION_RESULT_CHECK" | "ARTIFACT_LINEAGE_CHECK" | "EVIDENCE_COMPLETENESS_CHECK"
  | "TEST_REQUIREMENT_CHECK" | "BUILD_REQUIREMENT_CHECK" | "MIGRATION_IMPACT_CHECK" | "API_COMPATIBILITY_CHECK";

export type ReviewCheckStatus = "IMPLEMENTED" | "NOT_IMPLEMENTED";
export type ReviewScope = "FILE" | "CHANGE_SET";

export interface ReviewCheckDefinition {
  id: ReviewCheckId;
  description: string;
  implementation: string;
  evidenceSource: string;
  blocking: boolean;
  severityPolicy: string;
  supportedScope: ReviewScope;
  timeoutMs: number;
  status: ReviewCheckStatus;
}

const SEC_10S = 10_000, SEC_30 = 30_000;

export const REVIEW_CHECK_REGISTRY: Record<ReviewCheckId, ReviewCheckDefinition> = {
  CHANGE_SCOPE_CHECK: {
    id: "CHANGE_SCOPE_CHECK",
    description: "Real changed-file scope check — flags an oversized change set (too many files/insertions for one real review) and confirms every changed path resolved through the real workspace security gate.",
    implementation: "app/api/admin/ide/_lib/changeSetRuntime.ts#runChangeScopeCheck",
    evidenceSource: "gitReadOnly.ts's real getGitStatus() + resolveSafeRelativePath() per changed file",
    blocking: false, severityPolicy: "an oversized change set (>200 files) is WARNING, not blocking", supportedScope: "CHANGE_SET", timeoutMs: SEC_10S, status: "IMPLEMENTED",
  },
  DIFF_INTEGRITY_CHECK: {
    id: "DIFF_INTEGRITY_CHECK",
    description: "Verifies every DiffFile in the Change Set has a real oldHash/newHash consistent with the real git diff output (or is honestly marked binary/truncated) — never a diff assembled from Editor state alone.",
    implementation: "app/api/admin/ide/_lib/changeSetRuntime.ts#runDiffIntegrityCheck",
    evidenceSource: "gitReadOnly.ts's real getFileDiff()",
    blocking: true, severityPolicy: "a diff that could not be resolved from real git output is ERROR and blocking", supportedScope: "CHANGE_SET", timeoutMs: SEC_10S, status: "IMPLEMENTED",
  },
  MODULE_REGISTRATION_CHECK: {
    id: "MODULE_REGISTRATION_CHECK",
    description: "Reuses REGISTRY_CHECK's real registry/module-registry.json lookup — every changed file should be registered with a real (non-auto-stub) purpose.",
    implementation: "app/api/admin/ide/_lib/changeSetRuntime.ts#runModuleRegistrationCheck",
    evidenceSource: "registry/module-registry.json",
    blocking: false, severityPolicy: "an unregistered or auto-stub-purpose changed file is WARNING", supportedScope: "FILE", timeoutMs: SEC_10S, status: "IMPLEMENTED",
  },
  FACTORY_OWNERSHIP_CHECK: {
    id: "FACTORY_OWNERSHIP_CHECK",
    description: "Reuses the real registry/factory-mapping.json — every changed file should resolve to a real, non-UNKNOWN/non-CONFLICT Factory owner.",
    implementation: "app/api/admin/ide/_lib/changeSetRuntime.ts#runFactoryOwnershipCheck",
    evidenceSource: "registry/factory-mapping.json",
    blocking: false, severityPolicy: "UNKNOWN or CONFLICT factory ownership is WARNING", supportedScope: "FILE", timeoutMs: SEC_10S, status: "IMPLEMENTED",
  },
  DEPENDENCY_IMPACT_CHECK: {
    id: "DEPENDENCY_IMPACT_CHECK",
    description: "Reuses the real registry/architecture-book.json dependency graph — computes real direct dependents and a bounded transitive blast radius per changed file.",
    implementation: "app/api/admin/ide/_lib/changeSetRuntime.ts#runDependencyImpactCheck",
    evidenceSource: "registry/architecture-book.json",
    blocking: false, severityPolicy: "a changed file with a real large blast radius (>15 transitive dependents) is WARNING", supportedScope: "FILE", timeoutMs: SEC_30, status: "IMPLEMENTED",
  },
  CONTRACT_IMPACT_CHECK: {
    id: "CONTRACT_IMPACT_CHECK",
    description: "No generic, repo-wide contract validator exists (same honest gap as Step 4's CONTRACT_CHECK) — registered per instruction, not implemented this phase.",
    implementation: "NOT_IMPLEMENTED", evidenceSource: "none — no real implementation exists to cite.",
    blocking: false, severityPolicy: "n/a — always reports NOT_IMPLEMENTED, never a guessed pass/fail", supportedScope: "CHANGE_SET", timeoutMs: SEC_10S, status: "NOT_IMPLEMENTED",
  },
  GOVERNANCE_IMPACT_CHECK: {
    id: "GOVERNANCE_IMPACT_CHECK",
    description: "Reuses the real Governance Runtime's listRulesCitingFile() — reports which real Constitution rules cite each changed file and their real ENFORCED/DECLARED_NOT_ENFORCED/GHOST/UNKNOWN status, never a mechanical PASS for a declared-only rule.",
    implementation: "app/api/admin/ide/_lib/changeSetRuntime.ts#runGovernanceImpactCheck",
    evidenceSource: "app/api/admin/ide/_lib/governanceRuntime.ts",
    blocking: false, severityPolicy: "a changed file that is the sole real evidence for an ENFORCED rule is WARNING (verify the enforcement still holds)", supportedScope: "FILE", timeoutMs: SEC_10S, status: "IMPLEMENTED",
  },
  SECURITY_IMPACT_CHECK: {
    id: "SECURITY_IMPACT_CHECK",
    description: "Reuses fsSecurity.ts's real path-security gate and a real, scoped source-text scan (not a repo-wide scanner) for changed API routes: requireAuth presence, and known-dangerous patterns (raw exec/eval/fs write outside policy) in the real diff text only.",
    implementation: "app/api/admin/ide/_lib/changeSetRuntime.ts#runSecurityImpactCheck",
    evidenceSource: "app/api/admin/ide/_lib/fsSecurity.ts + real diff text of changed files",
    blocking: true, severityPolicy: "a changed app/api/**/route.ts file with no requireAuth call in its real new content is ERROR and blocking", supportedScope: "FILE", timeoutMs: SEC_10S, status: "IMPLEMENTED",
  },
  INSPECTION_RESULT_CHECK: {
    id: "INSPECTION_RESULT_CHECK",
    description: "Reuses the real Inspection Pipeline (Step 4) — aggregates real InspectionRecords for each changed file, split current/stale/blocking/non-blocking/passed/failed/warning/not-implemented/unknown via real sourceHash comparison.",
    implementation: "app/api/admin/ide/_lib/changeSetRuntime.ts#runInspectionResultCheck",
    evidenceSource: "app/api/admin/ide/_lib/inspectionRuntime.ts",
    blocking: true, severityPolicy: "a real blocking Inspection finding on a changed file is ERROR and blocking for the Change Set", supportedScope: "FILE", timeoutMs: SEC_10S, status: "IMPLEMENTED",
  },
  UI_INSPECTION_RESULT_CHECK: {
    id: "UI_INSPECTION_RESULT_CHECK",
    description: "Reuses the real UI Inspection Capability (Step 6) — for changed files under a UI-shaped path (app/**, components/**, presenter/**), aggregates the most recent real scan whose route/sourceHash matches.",
    implementation: "app/api/admin/ide/_lib/changeSetRuntime.ts#runUiInspectionResultCheck",
    evidenceSource: "app/api/admin/ide/_lib/browserInspectionRuntime.ts",
    blocking: false, severityPolicy: "a real blocking UI finding is WARNING for the Change Set (never auto-fixed, never screenshot-only)", supportedScope: "FILE", timeoutMs: SEC_10S, status: "IMPLEMENTED",
  },
  ARTIFACT_LINEAGE_CHECK: {
    id: "ARTIFACT_LINEAGE_CHECK",
    description: "Verifies every Artifact this Change Set's review produced traces back to the real Change Set manifest artifact via real Artifact Runtime lineage — never an orphan review artifact.",
    implementation: "app/api/admin/ide/_lib/changeSetRuntime.ts#runArtifactLineageCheck",
    evidenceSource: "app/api/admin/ide/_lib/artifactRuntime.ts",
    blocking: false, severityPolicy: "an orphan review artifact (no real parent link) is WARNING", supportedScope: "CHANGE_SET", timeoutMs: SEC_10S, status: "IMPLEMENTED",
  },
  EVIDENCE_COMPLETENESS_CHECK: {
    id: "EVIDENCE_COMPLETENESS_CHECK",
    description: "Verifies every Review Finding carries at least one real, verified Evidence Warehouse reference — never a Finding with zero real evidence.",
    implementation: "app/api/admin/ide/_lib/changeSetRuntime.ts#runEvidenceCompletenessCheck",
    evidenceSource: "app/api/admin/ide/_lib/artifactRuntime.ts's real Evidence Warehouse",
    blocking: false, severityPolicy: "a Finding with zero real evidence is WARNING", supportedScope: "CHANGE_SET", timeoutMs: SEC_10S, status: "IMPLEMENTED",
  },
  TEST_REQUIREMENT_CHECK: {
    id: "TEST_REQUIREMENT_CHECK",
    description: "Informational only, per this phase's explicit scope: states which real regression suites (ide:test/factory:test/governance:test/artifact:test/ui-inspection:test) touch the changed files' real modules, based on real Factory ownership — never runs them, never reports PASS/FAIL for testing itself (no Test Center exists).",
    implementation: "app/api/admin/ide/_lib/changeSetRuntime.ts#runTestRequirementCheck",
    evidenceSource: "registry/factory-mapping.json + package.json's real *:test scripts",
    blocking: false, severityPolicy: "always INFO — this check never blocks, it only states what the next stage must run", supportedScope: "CHANGE_SET", timeoutMs: SEC_10S, status: "IMPLEMENTED",
  },
  BUILD_REQUIREMENT_CHECK: {
    id: "BUILD_REQUIREMENT_CHECK",
    description: "Informational only, per this phase's explicit scope: states whether the real changed file set includes anything that would require a real `next build` in the next stage — never runs a build itself (no Build Center exists).",
    implementation: "app/api/admin/ide/_lib/changeSetRuntime.ts#runBuildRequirementCheck",
    evidenceSource: "real changedFiles list",
    blocking: false, severityPolicy: "always INFO — this check never blocks, it only states what the next stage must run", supportedScope: "CHANGE_SET", timeoutMs: SEC_10S, status: "IMPLEMENTED",
  },
  MIGRATION_IMPACT_CHECK: {
    id: "MIGRATION_IMPACT_CHECK",
    description: "For real changed files under supabase/migrations/**, scans the real new file content for destructive statements (DROP TABLE/DROP COLUMN/ALTER...DROP), duplicate real migration timestamps against real existing files, and reports — never applies a migration, never connects to a database.",
    implementation: "app/api/admin/ide/_lib/changeSetRuntime.ts#runMigrationImpactCheck",
    evidenceSource: "real supabase/migrations/*.sql file content + filenames",
    blocking: true, severityPolicy: "a real destructive statement (DROP TABLE/DROP COLUMN) is ERROR and blocking; duplicate timestamp is ERROR and blocking", supportedScope: "FILE", timeoutMs: SEC_10S, status: "IMPLEMENTED",
  },
  API_COMPATIBILITY_CHECK: {
    id: "API_COMPATIBILITY_CHECK",
    description: "For real changed app/api/**/route.ts files, compares the real old (git HEAD) vs. new (working tree) exported HTTP methods via real source parsing — classifies NON_BREAKING/POTENTIALLY_BREAKING/BREAKING/UNKNOWN. No request/response schema baseline is stored anywhere in this repo, so schema-level changes are honestly UNKNOWN, never guessed from the route name.",
    implementation: "app/api/admin/ide/_lib/changeSetRuntime.ts#runApiCompatibilityCheck",
    evidenceSource: "real `git show HEAD:<path>` (old) vs. real disk content (new)",
    blocking: true, severityPolicy: "a real removed HTTP method on an existing route is ERROR and blocking (BREAKING)", supportedScope: "FILE", timeoutMs: SEC_10S, status: "IMPLEMENTED",
  },
};

export function listReviewChecks(): ReviewCheckDefinition[] {
  return Object.values(REVIEW_CHECK_REGISTRY);
}
export function getReviewCheckDefinition(id: string): ReviewCheckDefinition | undefined {
  return REVIEW_CHECK_REGISTRY[id as ReviewCheckId];
}
