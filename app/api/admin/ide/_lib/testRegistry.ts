/**
 * Test Pipeline — Test Type Registry (owner, 2026-08-06, Software Factory
 * Step 8). Declares the real test types the Test Pipeline runs. Every
 * IMPLEMENTED type here is wired to a real, already-existing producer
 * (a real npm script exposed as a governed Execution Runtime command, or a
 * real, bounded static scan) — never a new test framework invented for
 * this step, and never a fabricated PASS. UNIT_TEST/INTEGRATION_TEST/
 * API_TEST/PERFORMANCE_SMOKE_TEST/CUSTOM_TEST are honestly NOT_IMPLEMENTED
 * because no real harness for them exists in this repo (no jest/vitest
 * config, no dedicated API/perf/custom test framework) — registering them
 * NOT_IMPLEMENTED and refusing to report PASS is the same discipline Step
 * 4's CONTRACT_CHECK and Step 7's CONTRACT_IMPACT_CHECK already established.
 */
export type TestTypeId =
  | "TYPESCRIPT_CHECK" | "ESLINT_CHECK" | "UNIT_TEST" | "INTEGRATION_TEST" | "API_TEST"
  | "ROUTE_AUTH_TEST" | "GOVERNANCE_TEST" | "REGISTRY_TEST" | "UI_INSPECTION_TEST" | "REVIEW_TEST"
  | "ARTIFACT_TEST" | "FACTORY_TEST" | "SECURITY_TEST" | "PERFORMANCE_SMOKE_TEST" | "CUSTOM_TEST";

export type TestTypeStatus = "IMPLEMENTED" | "NOT_IMPLEMENTED";
/** How this test type produces its real result. */
export type TestExecutionMode = "COMMAND" | "STATIC_SCAN" | "NOT_IMPLEMENTED";

export interface TestTypeDefinition {
  id: TestTypeId;
  suite: string;
  description: string;
  executionMode: TestExecutionMode;
  /** Real Execution Runtime commandId (executionRegistry.ts) this type
   * runs via startRun(), or null when executionMode isn't COMMAND. */
  commandId: string | null;
  evidenceSource: string;
  blocking: boolean;
  severityPolicy: string;
  timeoutMs: number;
  status: TestTypeStatus;
}

const MIN_4 = 4 * 60_000, MIN_5 = 5 * 60_000, MIN_10 = 10 * 60_000, SEC_20 = 20_000;

export const TEST_TYPE_REGISTRY: Record<TestTypeId, TestTypeDefinition> = {
  TYPESCRIPT_CHECK: {
    id: "TYPESCRIPT_CHECK", suite: "TypeScript",
    description: "Real `npx tsc --noEmit` via the Execution Runtime's registered \"typecheck\" command — the exact same real command Step 4's TYPE_DIAGNOSTIC inspection already uses.",
    executionMode: "COMMAND", commandId: "typecheck",
    evidenceSource: "app/api/admin/ide/_lib/executionRegistry.ts's \"typecheck\" CommandDefinition",
    blocking: true, severityPolicy: "any real tsc error diagnostic is ERROR and blocking", timeoutMs: MIN_4, status: "IMPLEMENTED",
  },
  ESLINT_CHECK: {
    id: "ESLINT_CHECK", suite: "TypeScript",
    description: "Real `npm run lint` → `eslint` via the Execution Runtime's registered \"lint\" command.",
    executionMode: "COMMAND", commandId: "lint",
    evidenceSource: "app/api/admin/ide/_lib/executionRegistry.ts's \"lint\" CommandDefinition",
    blocking: false, severityPolicy: "a non-zero real eslint exit code is WARNING, never blocking on its own", timeoutMs: MIN_4, status: "IMPLEMENTED",
  },
  UNIT_TEST: {
    id: "UNIT_TEST", suite: "Custom",
    description: "No real unit test framework is configured in this repo (no jest.config/vitest.config, no unit-test npm script) — registered per instruction, not implemented this phase.",
    executionMode: "NOT_IMPLEMENTED", commandId: null,
    evidenceSource: "none — no real implementation exists to cite.",
    blocking: false, severityPolicy: "n/a — always reports NOT_IMPLEMENTED, never a guessed pass/fail", timeoutMs: SEC_20, status: "NOT_IMPLEMENTED",
  },
  INTEGRATION_TEST: {
    id: "INTEGRATION_TEST", suite: "Custom",
    description: "No real integration test harness exists in this repo — registered per instruction, not implemented this phase.",
    executionMode: "NOT_IMPLEMENTED", commandId: null,
    evidenceSource: "none — no real implementation exists to cite.",
    blocking: false, severityPolicy: "n/a — always reports NOT_IMPLEMENTED, never a guessed pass/fail", timeoutMs: SEC_20, status: "NOT_IMPLEMENTED",
  },
  API_TEST: {
    id: "API_TEST", suite: "Custom",
    description: "No real, generic project-wide API test harness exists — the closest real coverage (per-route auth assertions) already exists as ROUTE_AUTH_TEST below, which is a narrower, honestly-scoped real check, not a general API test framework.",
    executionMode: "NOT_IMPLEMENTED", commandId: null,
    evidenceSource: "none — no real implementation exists to cite.",
    blocking: false, severityPolicy: "n/a — always reports NOT_IMPLEMENTED, never a guessed pass/fail", timeoutMs: SEC_20, status: "NOT_IMPLEMENTED",
  },
  ROUTE_AUTH_TEST: {
    id: "ROUTE_AUTH_TEST", suite: "Security",
    description: "Real, bounded static scan of every real app/api/admin/ide/**/route.ts file's current disk content for a real requireAuth( call — the same scoped pattern Step 7's SECURITY_IMPACT_CHECK already established, applied here to the whole admin/ide API surface rather than only changed files.",
    executionMode: "STATIC_SCAN", commandId: null,
    evidenceSource: "app/api/admin/ide/_lib/testRuntime.ts#runRouteAuthTest — real fs.readFileSync of each real route.ts",
    blocking: true, severityPolicy: "a real admin/ide route.ts with no requireAuth( call in its current content is ERROR and blocking", timeoutMs: SEC_20, status: "IMPLEMENTED",
  },
  GOVERNANCE_TEST: {
    id: "GOVERNANCE_TEST", suite: "Governance",
    description: "Real `npm run governance:test` via the Execution Runtime's registered \"governance.test\" command — the real Governance Enforcement Regression Suite (25 real assertions against CONSTITUTION.json/rule-coverage.json).",
    executionMode: "COMMAND", commandId: "governance.test",
    evidenceSource: "app/api/admin/ide/_lib/executionRegistry.ts's \"governance.test\" CommandDefinition",
    blocking: true, severityPolicy: "any real failing assertion in the suite is ERROR and blocking", timeoutMs: MIN_4, status: "IMPLEMENTED",
  },
  REGISTRY_TEST: {
    id: "REGISTRY_TEST", suite: "Registry",
    description: "Real, direct read of registry/architecture-book.json's own real summary counts (broken/unregistered modules) — the same real file scripts/build-arch-book.ts already produces (npm run sync), read here rather than regenerated to stay strictly read-only.",
    executionMode: "STATIC_SCAN", commandId: null,
    evidenceSource: "app/api/admin/ide/_lib/testRuntime.ts#runRegistryTest — real read of registry/architecture-book.json",
    blocking: true, severityPolicy: "broken>0 or unregistered>0 in the real architecture book is ERROR and blocking", timeoutMs: SEC_20, status: "IMPLEMENTED",
  },
  UI_INSPECTION_TEST: {
    id: "UI_INSPECTION_TEST", suite: "UI Inspection",
    description: "Real `npm run ui-inspection:test` via the Execution Runtime's registered \"ui-inspection.test\" command — the real Browser Inspection Runtime regression suite (49 real assertions, real Chromium via Playwright).",
    executionMode: "COMMAND", commandId: "ui-inspection.test",
    evidenceSource: "app/api/admin/ide/_lib/executionRegistry.ts's \"ui-inspection.test\" CommandDefinition",
    blocking: false, severityPolicy: "any real failing assertion in the suite is WARNING (non-blocking — UI regressions are reviewed, not gate-blocking, this phase)", timeoutMs: MIN_10, status: "IMPLEMENTED",
  },
  REVIEW_TEST: {
    id: "REVIEW_TEST", suite: "Review",
    description: "Real `npm run review:test` via the Execution Runtime's registered \"review.test\" command — the real Code Review Pipeline & Change Set Assembly regression suite (34 real assertions against this repo's actual working tree).",
    executionMode: "COMMAND", commandId: "review.test",
    evidenceSource: "app/api/admin/ide/_lib/executionRegistry.ts's \"review.test\" CommandDefinition",
    blocking: true, severityPolicy: "any real failing assertion in the suite is ERROR and blocking", timeoutMs: MIN_5, status: "IMPLEMENTED",
  },
  ARTIFACT_TEST: {
    id: "ARTIFACT_TEST", suite: "Artifact",
    description: "Real `npm run artifact:test` via the Execution Runtime's registered \"artifact.test\" command — the real Artifact Pipeline & Evidence Warehouse regression suite (31 real assertions).",
    executionMode: "COMMAND", commandId: "artifact.test",
    evidenceSource: "app/api/admin/ide/_lib/executionRegistry.ts's \"artifact.test\" CommandDefinition",
    blocking: true, severityPolicy: "any real failing assertion in the suite is ERROR and blocking (a broken Artifact/Evidence chain blocks the Test Pipeline)", timeoutMs: MIN_4, status: "IMPLEMENTED",
  },
  FACTORY_TEST: {
    id: "FACTORY_TEST", suite: "Factory",
    description: "Real `npm run factory:test` via the Execution Runtime's ALREADY-registered \"factory.test\" command (Step 2) — the real Factory Registry regression suite (11 real assertions), reused as-is, never re-implemented.",
    executionMode: "COMMAND", commandId: "factory.test",
    evidenceSource: "app/api/admin/ide/_lib/executionRegistry.ts's \"factory.test\" CommandDefinition",
    blocking: false, severityPolicy: "any real failing assertion in the suite is WARNING (non-blocking — Factory coverage gaps are tracked, not gate-blocking, this phase)", timeoutMs: MIN_4, status: "IMPLEMENTED",
  },
  SECURITY_TEST: {
    id: "SECURITY_TEST", suite: "Security",
    description: "Real, bounded static scan of app/api/admin/ide/_lib/*.ts for shell-string command construction (a template-literal argument to exec or execSync) and direct .env access — the same scoped-not-repo-wide discipline Step 7's Security Review established, applied to this module's own surface.",
    executionMode: "STATIC_SCAN", commandId: null,
    evidenceSource: "app/api/admin/ide/_lib/testRuntime.ts#runSecurityTest — real fs.readFileSync + pattern scan",
    blocking: true, severityPolicy: "a real shell-string exec/execSync pattern or direct .env read is ERROR and blocking", timeoutMs: SEC_20, status: "IMPLEMENTED",
  },
  PERFORMANCE_SMOKE_TEST: {
    id: "PERFORMANCE_SMOKE_TEST", suite: "Custom",
    description: "No real performance measurement harness exists in this repo (no load-test tool, no perf budget config) — registered per instruction, not implemented this phase.",
    executionMode: "NOT_IMPLEMENTED", commandId: null,
    evidenceSource: "none — no real implementation exists to cite.",
    blocking: false, severityPolicy: "n/a — always reports NOT_IMPLEMENTED, never a guessed pass/fail", timeoutMs: SEC_20, status: "NOT_IMPLEMENTED",
  },
  CUSTOM_TEST: {
    id: "CUSTOM_TEST", suite: "Custom",
    description: "Reserved for a future generic/user-defined test type, same honest placeholder pattern as artifactRegistry.ts's CUSTOM type — no real executor exists yet.",
    executionMode: "NOT_IMPLEMENTED", commandId: null,
    evidenceSource: "none — no real implementation exists to cite.",
    blocking: false, severityPolicy: "n/a — always reports NOT_IMPLEMENTED, never a guessed pass/fail", timeoutMs: SEC_20, status: "NOT_IMPLEMENTED",
  },
};

export function listTestTypes(): TestTypeDefinition[] {
  return Object.values(TEST_TYPE_REGISTRY);
}
export function getTestTypeDefinition(id: string): TestTypeDefinition | undefined {
  return TEST_TYPE_REGISTRY[id as TestTypeId];
}
/** Real Suite grouping — every distinct `suite` value across the registry,
 * in registration order, deduplicated. Drives the Test tab's real Suite
 * list and section 7's required suite coverage (TypeScript/Next Build
 * readiness/IDE/Review/Inspection/UI Inspection/Governance/Artifact/
 * Factory/Registry/Security/Custom). "Next Build readiness" and "IDE"/
 * "Inspection" are synthesized by testRuntime.ts from TYPESCRIPT_CHECK's
 * and ide.test's real results respectively — see testRuntime.ts's own
 * doc comment for why no separate Test Type exists for either. */
export function listTestSuites(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of listTestTypes()) {
    if (!seen.has(t.suite)) { seen.add(t.suite); out.push(t.suite); }
  }
  for (const extra of ["Next Build Readiness", "IDE", "Inspection"]) {
    if (!seen.has(extra)) { seen.add(extra); out.push(extra); }
  }
  return out;
}
