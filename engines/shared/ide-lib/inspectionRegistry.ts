/**
 * Real Inspection Pipeline — Inspection Type Registry (owner, 2026-08-06,
 * Software Factory Step 4). Declares the real inspection types the
 * pipeline supports. Every type here was checked against a REAL tool/file
 * already in this repo before being registered — SYNTAX_CHECK uses the
 * real TypeScript compiler's parser (already a project dependency, already
 * used by scripts/*.ts via tsx), TYPE_DIAGNOSTIC uses the real registered
 * "typecheck" Execution Runtime command (Step 2), REGISTRY_CHECK reads the
 * real registry/module-registry.json + registry/factory-mapping.json,
 * DEPENDENCY_CHECK reads the real registry/architecture-book.json (its
 * import_sites/internal_dependencies/status fields, already computed by
 * scripts/build-arch-book.ts), GOVERNANCE_CHECK reads the real
 * registry/rule-coverage.json + registry/CONSTITUTION.json, and
 * SECURITY_POLICY_CHECK reuses the real fsSecurity.ts checks
 * (resolveSafeRelativePath, isExcludedName) and executionRegistry.ts's
 * isCommandDenied — never a new/duplicate scanner.
 *
 * CONTRACT_CHECK is registered NOT_IMPLEMENTED — no generic, repo-wide
 * "contract" validator exists anywhere in this codebase (checked: no
 * schema-validation framework wired to event/transport/business/registry/
 * API/command/workflow contracts as one system). Inventing one is out of
 * scope for this phase per instruction ("ห้ามคิด Contract ใหม่ในรอบนี้").
 */
export type InspectionType =
  | "SYNTAX_CHECK" | "TYPE_DIAGNOSTIC" | "IMPORT_CHECK" | "CONTRACT_CHECK"
  | "REGISTRY_CHECK" | "DEPENDENCY_CHECK" | "GOVERNANCE_CHECK" | "SECURITY_POLICY_CHECK"
  | "UI_DOM_STRUCTURE_CHECK" | "UI_LAYOUT_CHECK" | "UI_OVERFLOW_CHECK" | "UI_OVERLAP_CHECK"
  | "UI_RESPONSIVE_CHECK" | "UI_TEXT_RENDER_CHECK" | "UI_COLOR_CONTRAST_CHECK"
  | "UI_INTERACTIVE_TARGET_CHECK" | "UI_LAYER_CHECK" | "UI_ACCESSIBILITY_CHECK"
  | "UI_PERFORMANCE_CHECK" | "UI_RESOURCE_CHECK" | "FACTORY_COMPLETION_CHECK" | "GLOBAL_FACTORY_CHECK" | "OPERATIONS_CHECK" | "FACTORY_WORKSPACE_CHECK";

export type InspectionScope = "FILE" | "PROJECT" | "COMMAND" | "URL";
export type InspectionStatus2 = "IMPLEMENTED" | "NOT_IMPLEMENTED";

export interface InspectionTypeDefinition {
  id: InspectionType;
  name: string;
  description: string;
  scope: InspectionScope;
  evidenceSource: string;
  implementation: string;
  allowedFileTypes: string[] | null;
  severityPolicy: string;
  blocking: boolean;
  autoFixAllowed: false;
  timeoutMs: number;
  status: InspectionStatus2;
  /** UI Inspection only (Step 6) — null for every non-UI inspection type. */
  supportedViewport: string[] | null;
  supportedTarget: string[] | null;
}

const SEC_10S = 10_000, MIN_4 = 4 * 60_000, SEC_30 = 30_000;
// UI Inspection (Step 6) — shared constants so viewport/target support is
// declared once, never hardcoded per-type.
const ALL_VIEWPORT_IDS = [
  "DESKTOP_1920_1080", "DESKTOP_1440_900", "LAPTOP_1366_768", "LAPTOP_1280_720",
  "TABLET_1024_768", "TABLET_768_1024", "MOBILE_430_932", "MOBILE_390_844", "MOBILE_360_800",
];
const ALL_TARGET_TYPES = ["CURRENT_PREVIEW", "DEPLOYED_URL", "REGISTERED_ROUTE"];

export const INSPECTION_TYPE_REGISTRY: Record<InspectionType, InspectionTypeDefinition> = {
  SYNTAX_CHECK: {
    id: "SYNTAX_CHECK", name: "Syntax Check",
    description: "Real parse of the saved file — TypeScript's own parser for .ts/.tsx/.js/.jsx (ts.createSourceFile + parseDiagnostics), JSON.parse for .json.",
    scope: "FILE", evidenceSource: "typescript package (already a project dependency, already used by tsx/scripts/*.ts) — ts.createSourceFile's real parseDiagnostics array; JSON.parse's real thrown SyntaxError for .json.",
    implementation: "engines/shared/ide-lib/inspectionRuntime.ts#runSyntaxCheck", allowedFileTypes: [".ts", ".tsx", ".js", ".jsx", ".json"],
    severityPolicy: "a real parse error is ERROR and blocking; no parse errors is PASSED", blocking: true, autoFixAllowed: false,
    timeoutMs: SEC_10S, status: "IMPLEMENTED", supportedViewport: null, supportedTarget: null,
  },
  TYPE_DIAGNOSTIC: {
    id: "TYPE_DIAGNOSTIC", name: "Type Diagnostic",
    description: "Real `npx tsc --noEmit` (the registered \"typecheck\" Execution Runtime command) — PROJECT scope, stated honestly: this repository has no isolated single-file type-check path, so this really type-checks the whole project, not just the target file. Findings are filtered to those whose file matches the target when the target was the trigger.",
    scope: "PROJECT", evidenceSource: "engines/shared/ide-lib/executionRegistry.ts's \"typecheck\" command definition (npx tsc --noEmit — the real command behind package.json's \"type-check\" script).",
    implementation: "engines/shared/ide-lib/inspectionRuntime.ts#runTypeDiagnostic (via executionRuntime.ts's real startRun)", allowedFileTypes: [".ts", ".tsx"],
    severityPolicy: "a real tsc diagnostic is ERROR and blocking (scope: whole project)", blocking: true, autoFixAllowed: false,
    timeoutMs: MIN_4, status: "IMPLEMENTED", supportedViewport: null, supportedTarget: null,
  },
  IMPORT_CHECK: {
    id: "IMPORT_CHECK", name: "Import Check",
    description: "Real parse of the saved file's import statements (TypeScript parser) — each relative import is resolved against the real filesystem via the same resolveSafeRelativePath() every other /admin/ide route uses, so a traversal or missing target is caught with the same real logic, never a second implementation.",
    scope: "FILE", evidenceSource: "engines/shared/ide-lib/fsSecurity.ts's resolveSafeRelativePath() — the same function every read/write route already uses.",
    implementation: "engines/shared/ide-lib/inspectionRuntime.ts#runImportCheck", allowedFileTypes: [".ts", ".tsx", ".js", ".jsx"],
    severityPolicy: "an unresolved or traversal-attempting import is ERROR and blocking; a duplicate import is WARNING", blocking: true, autoFixAllowed: false,
    timeoutMs: SEC_10S, status: "IMPLEMENTED", supportedViewport: null, supportedTarget: null,
  },
  CONTRACT_CHECK: {
    id: "CONTRACT_CHECK", name: "Contract Check",
    description: "No generic, repo-wide contract validator exists in this codebase today (checked: no schema-validation framework wired to event/transport/business/registry/API/command/workflow contracts as one system) — registered per instruction, not implemented this phase.",
    scope: "FILE", evidenceSource: "none — no real implementation exists to cite.", implementation: "NOT_IMPLEMENTED",
    allowedFileTypes: null, severityPolicy: "n/a — always reports NOT_IMPLEMENTED, never a guessed pass/fail", blocking: false, autoFixAllowed: false,
    timeoutMs: SEC_10S, status: "NOT_IMPLEMENTED", supportedViewport: null, supportedTarget: null,
  },
  REGISTRY_CHECK: {
    id: "REGISTRY_CHECK", name: "Registry Check",
    description: "Reuses the real registry/module-registry.json + registry/factory-mapping.json — checks the target file is registered, has a real (non-auto-stub) purpose, a real owner, and a real Factory mapping (not UNKNOWN/CONFLICT).",
    scope: "FILE", evidenceSource: "registry/module-registry.json (scripts/sync-registry.ts) + registry/factory-mapping.json (scripts/build-factory-registry.ts).",
    implementation: "engines/shared/ide-lib/inspectionRuntime.ts#runRegistryCheck", allowedFileTypes: [".ts", ".tsx"],
    severityPolicy: "unregistered or unmapped is WARNING (not blocking — registration lags saves by design, real npm run sync is separate)", blocking: false, autoFixAllowed: false,
    timeoutMs: SEC_10S, status: "IMPLEMENTED", supportedViewport: null, supportedTarget: null,
  },
  DEPENDENCY_CHECK: {
    id: "DEPENDENCY_CHECK", name: "Dependency Check",
    description: "Reuses the real registry/architecture-book.json (scripts/build-arch-book.ts's already-computed import_sites/internal_dependencies/status/dependents per module) — reports the target file's real broken/unused/orphan status as already computed, honestly noting when the file isn't in the snapshot yet (the book is generated separately via `npm run architecture:generate`, not on every save).",
    scope: "FILE", evidenceSource: "registry/architecture-book.json (scripts/build-arch-book.ts).",
    implementation: "engines/shared/ide-lib/inspectionRuntime.ts#runDependencyCheck", allowedFileTypes: [".ts", ".tsx"],
    severityPolicy: "a real broken/circular dependency already flagged in the architecture book is ERROR and blocking; an orphan (no dependents) is INFO", blocking: true, autoFixAllowed: false,
    timeoutMs: SEC_10S, status: "IMPLEMENTED", supportedViewport: null, supportedTarget: null,
  },
  GOVERNANCE_CHECK: {
    id: "GOVERNANCE_CHECK", name: "Governance Check",
    description: "Reuses the real registry/rule-coverage.json + registry/CONSTITUTION.json — for a target file, reports which real Constitution rules cite it in their enforced_by list, and whether that rule's coverage type is mechanically enforced (runtime) or only a declared principle (DECLARED_NOT_ENFORCED, never silently reported as a mechanical pass).",
    scope: "FILE", evidenceSource: "registry/rule-coverage.json + registry/CONSTITUTION.json.",
    implementation: "engines/shared/ide-lib/inspectionRuntime.ts#runGovernanceCheck", allowedFileTypes: null,
    severityPolicy: "a rule whose enforced_by cites this file and whose type is not real/mechanical is reported INFO (DECLARED_NOT_ENFORCED, never PASSED); no rule citing this file is INFO", blocking: false, autoFixAllowed: false,
    timeoutMs: SEC_10S, status: "IMPLEMENTED", supportedViewport: null, supportedTarget: null,
  },
  FACTORY_COMPLETION_CHECK: {
    id: "FACTORY_COMPLETION_CHECK", name: "Factory Completion Check",
    description: "Reuses the real factoryCompletionRuntime.ts (Step 10.5) — surfaces 11 real Problems categories from the live Factory Completion Report: Factory Incomplete, UI Only, Contract Only, Native DNA Missing, Data Boundary Unknown, VS Code Dependency, Capability Duplicate, Source Bottleneck, Registry Auto-Sync Defect, Cost Evidence Missing, Operational Reality Gap. PROJECT scope — target is ignored, always evaluates the whole real Factory state.",
    scope: "PROJECT", evidenceSource: "engines/shared/ide-lib/factoryCompletionRuntime.ts#buildFactoryCompletionReport (registry/factory-completion-report.json).",
    implementation: "engines/shared/ide-lib/inspectionRuntime.ts#runFactoryCompletionCheck", allowedFileTypes: null,
    severityPolicy: "a blocking Completion Gate that is BLOCKED/NOT_IMPLEMENTED/UNKNOWN is WARNING (never blocking itself — this is an audit, not a build gate); everything else is INFO", blocking: false, autoFixAllowed: false,
    timeoutMs: SEC_10S, status: "IMPLEMENTED", supportedViewport: null, supportedTarget: null,
  },
  GLOBAL_FACTORY_CHECK: {
    id: "GLOBAL_FACTORY_CHECK", name: "Global Factory Check",
    description: "Reuses the real globalFactoryRuntime.ts + deploymentRuntime.ts (Step 11) — surfaces 7 real Problems categories: Deployment, Runtime Dependency, Factory Runtime, Monitoring, Incident, Recovery, Global Factory. PROJECT scope — target is ignored, always evaluates the whole real Global Factory state.",
    scope: "PROJECT", evidenceSource: "engines/shared/ide-lib/globalFactoryRuntime.ts#computeGlobalFactoryReport (registry/global-factory-report.json).",
    implementation: "engines/shared/ide-lib/inspectionRuntime.ts#runGlobalFactoryCheck", allowedFileTypes: null,
    severityPolicy: "a real NOT_IMPLEMENTED domain (Monitoring/Incident) is WARNING (never blocking — this is an audit, not a build gate); a real PARTIAL domain is INFO", blocking: false, autoFixAllowed: false,
    timeoutMs: SEC_10S, status: "IMPLEMENTED", supportedViewport: null, supportedTarget: null,
  },
  OPERATIONS_CHECK: {
    id: "OPERATIONS_CHECK", name: "Operations Check",
    description: "Reuses the real monitoringRuntime.ts/incidentRuntime.ts/recoveryRuntime.ts (Step 12) — surfaces 11 real Problems categories from the live, owner-scoped Operations state: Monitoring Missing, Signal Stale, Runtime Unhealthy, Provider Health Unknown, Incident Open, Critical Incident, Recovery Blocked, Recovery Unverified, Backup Not Verified, Dependency Impact, Operations Evidence Missing. PROJECT scope — target is ignored.",
    scope: "PROJECT", evidenceSource: "engines/shared/ide-lib/monitoringRuntime.ts + incidentRuntime.ts + recoveryRuntime.ts (owner-scoped, live).",
    implementation: "engines/shared/ide-lib/inspectionRuntime.ts#runOperationsCheck", allowedFileTypes: null,
    severityPolicy: "a real CRITICAL/HIGH open Incident is WARNING; everything else (stale signal, blocked/unverified recovery, unknown provider, missing evidence) is INFO — never blocking (this is an audit, not a build gate)", blocking: false, autoFixAllowed: false,
    timeoutMs: SEC_10S, status: "IMPLEMENTED", supportedViewport: null, supportedTarget: null,
  },
  FACTORY_WORKSPACE_CHECK: {
    id: "FACTORY_WORKSPACE_CHECK", name: "Factory Workspace Check",
    description: "Reuses the real factoryWorkspaceRuntime.ts/intentRuntime.ts/capabilityResolverRuntime.ts/contextPlannerRuntime.ts/executionPlanRuntime.ts/aiContextRuntime.ts/workerRegistry.ts (Step 13) — surfaces 14 real Problems categories from the live, owner-scoped Factory Workspace state: Intent Incomplete, Capability Not Found, Capability Conflict, Context Scope Too Broad, Context Evidence Missing, Worker Unavailable, Worker Capability Mismatch, Execution Plan Blocked, Owner Decision Required, File Scope Violation, AI Context Isolation Failure, Native Factory Flow Failure, VS Code Dependency Remaining, Outcome Unverified. PROJECT scope — target is ignored.",
    scope: "PROJECT", evidenceSource: "engines/shared/ide-lib/factoryWorkspaceRuntime.ts + intentRuntime.ts + capabilityResolverRuntime.ts + contextPlannerRuntime.ts + executionPlanRuntime.ts + aiContextRuntime.ts + workerRegistry.ts (owner-scoped, live).",
    implementation: "engines/shared/ide-lib/inspectionRuntime.ts#runFactoryWorkspaceCheck", allowedFileTypes: null,
    severityPolicy: "a real BLOCKED Workspace Session or Owner Decision required is WARNING; everything else (incomplete intent, missing capability, broad context, unavailable worker, unverified outcome) is INFO — never blocking (this is an audit, not a build gate)", blocking: false, autoFixAllowed: false,
    timeoutMs: SEC_10S, status: "IMPLEMENTED", supportedViewport: null, supportedTarget: null,
  },
  SECURITY_POLICY_CHECK: {
    id: "SECURITY_POLICY_CHECK", name: "Security Policy Check",
    description: "Reuses the real, already-implemented checks: fsSecurity.ts's resolveSafeRelativePath (path traversal, symlink escape, .env/secret path exclusion) and executionRegistry.ts's isCommandDenied (for COMMAND-scope targets: shell operators, denylisted binaries). Never a repo-wide scanner — always scoped to the one target path/command being inspected.",
    scope: "FILE", evidenceSource: "engines/shared/ide-lib/fsSecurity.ts + engines/shared/ide-lib/executionRegistry.ts (both already real, already enforced on every read/write/execute).",
    implementation: "engines/shared/ide-lib/inspectionRuntime.ts#runSecurityPolicyCheck", allowedFileTypes: null,
    severityPolicy: "a real policy violation (traversal/symlink/.env/denied command) is CRITICAL and blocking; no violation is PASSED", blocking: true, autoFixAllowed: false,
    timeoutMs: SEC_10S, status: "IMPLEMENTED", supportedViewport: null, supportedTarget: null,
  },

  // ================= UI Inspection Capability (Step 6) =================
  // Every real check function lives in browserInspectionRuntime.ts, reuses
  // the SAME Playwright session captured once per (target, viewport) pair
  // — never a second browser launch per rule. Real Chromium via Playwright
  // (approved dependency, 2026-08-06) is the evidence source throughout;
  // never a screenshot-only or AI-vision judgment.
  UI_DOM_STRUCTURE_CHECK: {
    id: "UI_DOM_STRUCTURE_CHECK", name: "UI DOM Structure Check",
    description: "Real DOM tree capture via Playwright's page.evaluate() walking document.body — reports node count, structural depth, and duplicate-id/missing-landmark structural issues from the real live DOM.",
    scope: "URL", evidenceSource: "Playwright Page.evaluate() real DOM walk (document.*, Element.getBoundingClientRect, etc.)",
    implementation: "engines/shared/ide-lib/browserInspectionRuntime.ts#runUiDomStructureCheck", allowedFileTypes: null,
    severityPolicy: "duplicate real DOM id is WARNING; no structural issues is PASSED", blocking: false, autoFixAllowed: false,
    timeoutMs: SEC_30, status: "IMPLEMENTED", supportedViewport: ALL_VIEWPORT_IDS, supportedTarget: ALL_TARGET_TYPES,
  },
  UI_LAYOUT_CHECK: {
    id: "UI_LAYOUT_CHECK", name: "UI Layout Check",
    description: "Real layout box model per element (getBoundingClientRect + scroll/client/offset sizes) — UI_OUTSIDE_VIEWPORT and general layout-region rules. Values come directly from the real browser layout engine, never estimated from a screenshot.",
    scope: "URL", evidenceSource: "Playwright Page.evaluate() real Element.getBoundingClientRect()/scrollWidth/clientWidth/offsetWidth etc.",
    implementation: "engines/shared/ide-lib/browserInspectionRuntime.ts#runUiLayoutCheck", allowedFileTypes: null,
    severityPolicy: "an important element entirely outside the real viewport is ERROR and blocking", blocking: true, autoFixAllowed: false,
    timeoutMs: SEC_30, status: "IMPLEMENTED", supportedViewport: ALL_VIEWPORT_IDS, supportedTarget: ALL_TARGET_TYPES,
  },
  UI_OVERFLOW_CHECK: {
    id: "UI_OVERFLOW_CHECK", name: "UI Overflow Check",
    description: "Real UI_OVERFLOW_HORIZONTAL/UI_OVERFLOW_VERTICAL rules — scrollWidth/scrollHeight vs. clientWidth/clientHeight from the real browser layout, beyond a stated pixel tolerance.",
    scope: "URL", evidenceSource: "Playwright Page.evaluate() real Element.scrollWidth/scrollHeight/clientWidth/clientHeight.",
    implementation: "engines/shared/ide-lib/browserInspectionRuntime.ts#runUiOverflowCheck", allowedFileTypes: null,
    severityPolicy: "unintended horizontal overflow is ERROR and blocking; vertical overflow on a non-scroll-declared element is WARNING", blocking: true, autoFixAllowed: false,
    timeoutMs: SEC_30, status: "IMPLEMENTED", supportedViewport: ALL_VIEWPORT_IDS, supportedTarget: ALL_TARGET_TYPES,
  },
  UI_OVERLAP_CHECK: {
    id: "UI_OVERLAP_CHECK", name: "UI Overlap Check",
    description: "Real bounding-box intersection test, scoped to visible interactive elements + heading/paragraph text nodes only (never all-pairs across the whole DOM) — reports real overlap area in pixels and ratio. Parent-child containment and declared fixed/overlay elements are excluded by real ancestor-chain and computed-style checks, not guessed.",
    scope: "URL", evidenceSource: "Playwright Page.evaluate() real getBoundingClientRect() intersection math over a real, filtered element set.",
    implementation: "engines/shared/ide-lib/browserInspectionRuntime.ts#runUiOverlapCheck", allowedFileTypes: null,
    severityPolicy: "interactive-target overlap is ERROR and blocking; text-content overlap is WARNING", blocking: true, autoFixAllowed: false,
    timeoutMs: SEC_30, status: "IMPLEMENTED", supportedViewport: ALL_VIEWPORT_IDS, supportedTarget: ALL_TARGET_TYPES,
  },
  UI_RESPONSIVE_CHECK: {
    id: "UI_RESPONSIVE_CHECK", name: "UI Responsive Check",
    description: "Real cross-viewport comparison — the SAME scan run across every requested real Viewport Profile, diffing element presence/rect/visibility by a real selector-based identity to find where a page breaks.",
    scope: "URL", evidenceSource: "Multiple real Playwright page.setViewportSize() passes over the same page load, compared by real selector identity.",
    implementation: "engines/shared/ide-lib/browserInspectionRuntime.ts#runUiResponsiveCheck", allowedFileTypes: null,
    severityPolicy: "an element that disappears or breaks in one real viewport but not others is ERROR and blocking", blocking: true, autoFixAllowed: false,
    timeoutMs: MIN_4, status: "IMPLEMENTED", supportedViewport: ALL_VIEWPORT_IDS, supportedTarget: ALL_TARGET_TYPES,
  },
  UI_TEXT_RENDER_CHECK: {
    id: "UI_TEXT_RENDER_CHECK", name: "UI Text Render Check",
    description: "Real UI_TEXT_CLIPPED detection — a text-bearing leaf element whose real scrollWidth/scrollHeight exceeds its real clientWidth/clientHeight under overflow:hidden with no visible expand affordance. Font-fallback and OCR-based checks are NOT implemented this phase — never approximated from a screenshot.",
    scope: "URL", evidenceSource: "Playwright Page.evaluate() real getComputedStyle() (overflow/text-overflow/white-space) + real scroll/client sizes.",
    implementation: "engines/shared/ide-lib/browserInspectionRuntime.ts#runUiTextRenderCheck", allowedFileTypes: null,
    severityPolicy: "clipped text with no expand affordance is WARNING (not blocking — many real clamp patterns are intentional)", blocking: false, autoFixAllowed: false,
    timeoutMs: SEC_30, status: "IMPLEMENTED", supportedViewport: ALL_VIEWPORT_IDS, supportedTarget: ALL_TARGET_TYPES,
  },
  UI_COLOR_CONTRAST_CHECK: {
    id: "UI_COLOR_CONTRAST_CHECK", name: "UI Color Contrast Check",
    description: "Real WCAG contrast ratio computed from getComputedStyle() color + backgroundColor walked up the real ancestor chain for a real solid background. When the real background is an image/gradient (unresolvable to one real RGB value), reports UNKNOWN — never guesses PASS. Screenshot is attached only as corroborating evidence in that case.",
    scope: "URL", evidenceSource: "Playwright Page.evaluate() real getComputedStyle() color/backgroundColor/fontSize/fontWeight, WCAG 2.1 contrast formula (already declared in registry/standards.json).",
    implementation: "engines/shared/ide-lib/browserInspectionRuntime.ts#runUiColorContrastCheck", allowedFileTypes: null,
    severityPolicy: "a real ratio below the required WCAG threshold for the real font size/weight is ERROR and blocking; UNKNOWN is never blocking", blocking: true, autoFixAllowed: false,
    timeoutMs: SEC_30, status: "IMPLEMENTED", supportedViewport: ALL_VIEWPORT_IDS, supportedTarget: ALL_TARGET_TYPES,
  },
  UI_INTERACTIVE_TARGET_CHECK: {
    id: "UI_INTERACTIVE_TARGET_CHECK", name: "UI Interactive Target Check",
    description: "Real UI_SMALL_TARGET rule — interactive element (button/link/input/[role=button] etc.) whose real rendered width/height is below the declared minimum target size policy (44x44 CSS px, WCAG 2.5.5/2.5.8-aligned).",
    scope: "URL", evidenceSource: "Playwright Page.evaluate() real getBoundingClientRect() on real interactive elements.",
    implementation: "engines/shared/ide-lib/browserInspectionRuntime.ts#runUiInteractiveTargetCheck", allowedFileTypes: null,
    severityPolicy: "an interactive target below the real minimum size policy is WARNING", blocking: false, autoFixAllowed: false,
    timeoutMs: SEC_30, status: "IMPLEMENTED", supportedViewport: ALL_VIEWPORT_IDS, supportedTarget: ALL_TARGET_TYPES,
  },
  UI_LAYER_CHECK: {
    id: "UI_LAYER_CHECK", name: "UI Layer Check",
    description: "No real Layer Tree access is wired this phase — Playwright's stable API does not expose Chrome's LayerTree CDP domain, and building a raw-CDP LayerTree integration is out of this phase's real, verified scope. Honestly registered NOT_IMPLEMENTED rather than approximating stacking-context/paint-order findings from DOM.elementFromPoint alone and calling it a Layer Tree.",
    scope: "URL", evidenceSource: "none — no real implementation exists to cite this phase.", implementation: "NOT_IMPLEMENTED", allowedFileTypes: null,
    severityPolicy: "n/a — always reports NOT_IMPLEMENTED, never a guessed pass/fail", blocking: false, autoFixAllowed: false,
    timeoutMs: SEC_30, status: "NOT_IMPLEMENTED", supportedViewport: ALL_VIEWPORT_IDS, supportedTarget: ALL_TARGET_TYPES,
  },
  UI_ACCESSIBILITY_CHECK: {
    id: "UI_ACCESSIBILITY_CHECK", name: "UI Accessibility Check",
    description: "Real accessibility tree via Playwright's page.accessibility.snapshot() (Chromium's own real a11y tree, not a heuristic) — missing accessible name on an interactive node, input without a real label relationship, and heading-level hierarchy jumps computed directly from the real snapshot.",
    scope: "URL", evidenceSource: "Playwright page.accessibility.snapshot() — Chromium's real accessibility tree.",
    implementation: "engines/shared/ide-lib/browserInspectionRuntime.ts#runUiAccessibilityCheck", allowedFileTypes: null,
    severityPolicy: "an interactive element with no real accessible name is ERROR and blocking", blocking: true, autoFixAllowed: false,
    timeoutMs: SEC_30, status: "IMPLEMENTED", supportedViewport: ALL_VIEWPORT_IDS, supportedTarget: ALL_TARGET_TYPES,
  },
  UI_PERFORMANCE_CHECK: {
    id: "UI_PERFORMANCE_CHECK", name: "UI Performance Check",
    description: "No real performance trace capture is wired this phase (CDP Performance/Tracing domain integration was not built and verified within this pass's real scope) — honestly registered NOT_IMPLEMENTED rather than reporting an estimated or partial number as a real measurement.",
    scope: "URL", evidenceSource: "none — no real implementation exists to cite this phase.", implementation: "NOT_IMPLEMENTED", allowedFileTypes: null,
    severityPolicy: "n/a — always reports NOT_IMPLEMENTED, never a guessed pass/fail", blocking: false, autoFixAllowed: false,
    timeoutMs: SEC_30, status: "NOT_IMPLEMENTED", supportedViewport: ALL_VIEWPORT_IDS, supportedTarget: ALL_TARGET_TYPES,
  },
  UI_RESOURCE_CHECK: {
    id: "UI_RESOURCE_CHECK", name: "UI Resource Check",
    description: "Real UI_RESOURCE_FAILURE rule — every real network response Playwright observes during page load; a real non-2xx/failed response for a CSS/font/image/script resource is reported with its real status/URL.",
    scope: "URL", evidenceSource: "Playwright page.on('response')/page.on('requestfailed') — real network events for the real page load.",
    implementation: "engines/shared/ide-lib/browserInspectionRuntime.ts#runUiResourceCheck", allowedFileTypes: null,
    severityPolicy: "a real failed CSS/font/script load is ERROR and blocking; a failed image load is WARNING", blocking: true, autoFixAllowed: false,
    timeoutMs: SEC_30, status: "IMPLEMENTED", supportedViewport: ALL_VIEWPORT_IDS, supportedTarget: ALL_TARGET_TYPES,
  },
};

export function listInspectionTypes(): InspectionTypeDefinition[] {
  return Object.values(INSPECTION_TYPE_REGISTRY);
}
export function getInspectionTypeDefinition(type: string): InspectionTypeDefinition | undefined {
  return INSPECTION_TYPE_REGISTRY[type as InspectionType];
}
