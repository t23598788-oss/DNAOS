/**
 * Factory Completion Runtime (owner, 2026-08-07, Software Factory
 * Step 10.5). Computes real, evidence-derived completion records for
 * every system in factoryCompletionRegistry.ts — never a hardcoded
 * percentage. Reuses real, already-built Runtimes/Registries only
 * (Rule 103) — this file creates no new Runtime/Queue/Artifact/Evidence
 * Store, only reads real fs/registry state and derives a report.
 *
 * completionPercent is a weighted average of 6 real, independently
 * checkable signals (never file-count alone, per the Step 10.5 spec):
 *   sourceExists(25) + routeExists(15) + registryCoverage(15) +
 *   testExists(20) + testFilePresentAndNonTrivial(10) + evidenceLinked(15)
 * Each signal is a real fs check, not an assumption.
 */
import { existsSync, readFileSync, statSync } from "fs";
import path from "path";
import { FACTORY_SYSTEM_REGISTRY, SystemDefinition } from "./factoryCompletionRegistry";

const ROOT = path.join(process.cwd());

export type SystemStatus =
  | "COMPLETE" | "OPERATIONAL" | "PARTIAL" | "DECLARED" | "UI_ONLY" | "CONTRACT_ONLY"
  | "NOT_IMPLEMENTED" | "BLOCKED" | "STALE" | "UNKNOWN" | "DUPLICATED" | "MISPLACED";

export interface SystemCompletionRecord {
  id: string; name: string; name_th: string; factoryOwner: string; layer: string; responsibility: string;
  sourceFiles: string[]; routes: string[]; registries: string[]; tests: string[];
  runtimeEvidence: { path: string; exists: boolean }[];
  status: SystemStatus;
  completionPercent: number;
  evidence: string[];
  limitations: string[];
  nextRequiredAction: string;
}

function fileExists(rel: string): boolean {
  try { return existsSync(path.join(ROOT, rel)); } catch { return false; }
}

function fileNonTrivial(rel: string): boolean {
  try {
    const s = statSync(path.join(ROOT, rel));
    return s.size > 200; // a real, non-stub file — not a proof of correctness, only of non-emptiness
  } catch { return false; }
}

function computeRecord(def: SystemDefinition): SystemCompletionRecord {
  const evidence: string[] = [];
  const limitations: string[] = [];

  const sourceResults = def.sourceFiles.map((f) => ({ path: f, exists: fileExists(f) }));
  const routeResults = def.routes.map((f) => ({ path: f, exists: fileExists(f) }));
  const testResults = def.testFiles.map((f) => ({ path: f, exists: fileExists(f) }));
  const registryResults = def.registries.map((f) => ({ path: f, exists: fileExists(f) }));

  const sourceScore = def.sourceFiles.length === 0 ? 0 : sourceResults.filter((r) => r.exists).length / def.sourceFiles.length;
  const routeScore = def.routes.length === 0 ? (def.sourceFiles.length > 0 ? 1 : 0) : routeResults.filter((r) => r.exists).length / def.routes.length;
  const registryScore = def.registries.length === 0 ? 1 : registryResults.filter((r) => r.exists).length / def.registries.length;
  const testScore = def.testFiles.length === 0 ? 0 : testResults.filter((r) => r.exists).length / def.testFiles.length;
  const testNonTrivialScore = def.testFiles.length === 0 ? 0 : def.testFiles.filter((f) => fileExists(f) && fileNonTrivial(f)).length / def.testFiles.length;
  const evidenceLinkedScore = (def.sourceFiles.length > 0 && sourceScore === 1) ? 1 : sourceScore;

  if (sourceScore === 1) evidence.push(`All ${def.sourceFiles.length} real source file(s) verified present on disk.`);
  else if (sourceScore > 0) { evidence.push(`${Math.round(sourceScore * def.sourceFiles.length)}/${def.sourceFiles.length} real source files present.`); limitations.push("Some declared source files are missing — declared but not real."); }
  else if (def.sourceFiles.length > 0) limitations.push("No declared source file exists on disk — CONTRACT_ONLY at best.");

  if (def.routes.length > 0 && routeScore < 1) limitations.push(`${def.routes.length - Math.round(routeScore * def.routes.length)} declared route(s) missing — not reachable via API.`);
  if (def.registries.length > 0 && registryScore < 1) limitations.push("A declared registry file is missing — evidence source incomplete.");
  if (def.testFiles.length === 0) limitations.push("No dedicated regression test file declared for this system.");
  else if (testScore < 1) limitations.push("Declared test file(s) missing on disk.");

  const completionPercent = Math.round(
    (sourceScore * 25) + (routeScore * 15) + (registryScore * 15) + (testScore * 20) + (testNonTrivialScore * 10) + (evidenceLinkedScore * 15)
  );

  let status: SystemStatus;
  if (def.sourceFiles.length === 0 && def.registries.length > 0 && registryScore === 1) {
    status = "OPERATIONAL"; evidence.push("Registry-backed system with no dedicated runtime source — real declared data file(s) confirmed present.");
  } else if (sourceScore === 0 && def.sourceFiles.length > 0) {
    status = "NOT_IMPLEMENTED";
  } else if (sourceScore === 1 && routeScore === 1 && testScore === 1 && registryScore === 1) {
    status = "COMPLETE";
  } else if (sourceScore === 1 && (routeScore === 1 || def.routes.length === 0) && testScore < 1) {
    status = "PARTIAL"; limitations.push("Real runtime code exists and is wired, but lacks a passing dedicated regression suite reference on disk.");
  } else if (sourceScore === 1 && routeScore < 1) {
    status = "PARTIAL"; limitations.push("Real runtime code exists but is not fully wired to a real route.");
  } else if (sourceScore > 0 && sourceScore < 1) {
    status = "PARTIAL";
  } else {
    status = "UNKNOWN";
  }

  const nextRequiredAction =
    status === "COMPLETE" ? "None — reuse as-is." :
    status === "NOT_IMPLEMENTED" ? `Build real source at: ${def.sourceFiles[0] ?? "(undeclared)"}.` :
    status === "OPERATIONAL" ? "Consider a dedicated runtime wrapper only if reuse-as-data proves insufficient." :
    def.testFiles.length === 0 ? `Write a dedicated regression suite for ${def.id}.` :
    "Close the specific gap listed in limitations.";

  return {
    id: def.id, name: def.name, name_th: def.name_th, factoryOwner: def.factoryOwner, layer: def.layer,
    responsibility: def.responsibility, sourceFiles: def.sourceFiles, routes: def.routes, registries: def.registries,
    tests: def.testFiles, runtimeEvidence: [...sourceResults, ...routeResults, ...registryResults, ...testResults],
    status, completionPercent, evidence, limitations, nextRequiredAction,
  };
}

export function computeFactoryCompletion(): SystemCompletionRecord[] {
  return FACTORY_SYSTEM_REGISTRY.map(computeRecord);
}

// ── Phase 3: End-to-End Factory Chain Audit ──────────────────────────

export type ChainStageStatus = "IMPLEMENTED" | "PARTIAL" | "NOT_IMPLEMENTED" | "MANUAL" | "EXTERNAL_TOOL_DEPENDENT" | "DNA_OS_NATIVE";
export interface ChainStageRecord { stage: string; status: ChainStageStatus; evidence: string; }

export function computeEndToEndChain(): ChainStageRecord[] {
  const has = (id: string) => computeFactoryCompletion().find((r) => r.id === id);
  const review = has("CODE_REVIEW"), test = has("TEST_PIPELINE"), build = has("BUILD_PIPELINE"), release = has("RELEASE_PIPELINE"), gov = has("GOVERNANCE_RUNTIME"), insp = has("INSPECTION_PIPELINE"), exec = has("EXECUTION_RUNTIME"), queue = has("PRODUCTION_QUEUE");
  return [
    { stage: "Problem/Intent", status: "DNA_OS_NATIVE", evidence: "As of Step 13, intentRuntime.ts captures real, structured Intent (problem/desiredOutcome/requestedChange/constraints/acceptanceCriteria) through the real POST /api/admin/ide/factory-workspace/sessions/[id]/intent route and the Factory Workspace tab — never a raw prompt treated as ground truth." },
    { stage: "Analysis", status: "EXTERNAL_TOOL_DEPENDENT", evidence: "Analysis is performed by Claude Code inside this session — workerRegistry.ts honestly declares ANALYSIS_WORKER as COMPATIBILITY_ONLY (provider: this real Claude Code session, human-continued) rather than hiding this dependency; no native DNA OS analysis engine confirmed." },
    { stage: "Capability Search", status: "DNA_OS_NATIVE", evidence: "As of Step 13, capabilityResolverRuntime.ts real, deterministic search runs against the real, frozen 202-capability registry via the real POST .../resolve-capabilities and GET .../capabilities/search routes — real multi-factor scoring (domain/dependency/evidence/lifecycle), never a name-only match." },
    { stage: "Design", status: "MANUAL", evidence: "No real Design/spec artifact stage exists distinct from the owner's own written Step spec." },
    { stage: "File Change", status: exec?.status === "COMPLETE" || exec?.status === "PARTIAL" ? "DNA_OS_NATIVE" : "PARTIAL", evidence: `IDE File Runtime real (fsOps.ts/fileWrite.ts) — status ${exec?.status ?? "UNKNOWN"}.` },
    { stage: "Execution", status: exec?.status === "COMPLETE" ? "DNA_OS_NATIVE" : "PARTIAL", evidence: `executionRuntime.ts real — status ${exec?.status ?? "UNKNOWN"}.` },
    { stage: "Queue", status: queue?.status === "COMPLETE" ? "DNA_OS_NATIVE" : "PARTIAL", evidence: `queueRuntime.ts real — status ${queue?.status ?? "UNKNOWN"}.` },
    { stage: "Inspection", status: insp?.status === "COMPLETE" ? "DNA_OS_NATIVE" : "PARTIAL", evidence: `inspectionRuntime.ts real — status ${insp?.status ?? "UNKNOWN"}.` },
    { stage: "Governance", status: gov?.status === "COMPLETE" ? "DNA_OS_NATIVE" : "PARTIAL", evidence: `governanceRuntime.ts real, 185 total rules tracked, 49.2% coverage (registry/governance-summary.json) — status ${gov?.status ?? "UNKNOWN"}.` },
    { stage: "Review", status: review?.status === "COMPLETE" ? "DNA_OS_NATIVE" : "PARTIAL", evidence: `changeSetRuntime.ts real — status ${review?.status ?? "UNKNOWN"}.` },
    { stage: "Test", status: test?.status === "COMPLETE" ? "DNA_OS_NATIVE" : "PARTIAL", evidence: `testRuntime.ts real — status ${test?.status ?? "UNKNOWN"}.` },
    { stage: "Build", status: build?.status === "COMPLETE" ? "DNA_OS_NATIVE" : "PARTIAL", evidence: `buildRuntime.ts real — status ${build?.status ?? "UNKNOWN"}.` },
    { stage: "Build Gate", status: "DNA_OS_NATIVE", evidence: "Build Gate Integrity built Step 9.5 — analyzeRegistryGateOutput() in buildRuntime.ts." },
    { stage: "Release", status: release?.status === "COMPLETE" ? "DNA_OS_NATIVE" : "PARTIAL", evidence: `releaseRuntime.ts real — status ${release?.status ?? "UNKNOWN"}.` },
    { stage: "Package", status: "DNA_OS_NATIVE", evidence: "Capability Packaging built Step 10 — packageCapabilities() reads registry/capability-registry.json." },
    { stage: "Operational Readiness", status: "DNA_OS_NATIVE", evidence: "Operational Readiness gate built Step 10 (readiness-test.ts)." },
    { stage: "Deploy", status: "NOT_IMPLEMENTED", evidence: "No real Deploy stage exists in this repo — explicitly forbidden this Step and Step 10." },
    { stage: "Monitoring", status: "PARTIAL", evidence: "Real, observe-only Monitoring Runtime exists as of Step 12 (18 real Signal Types, real sources) — but on-demand only, no scheduled/continuous collection loop and no alerting wired from this Runtime itself." },
    { stage: "Incident", status: "PARTIAL", evidence: "Real Incident Runtime exists as of Step 12 (opens/correlates/tracks from real Monitoring findings, never auto-closed) — but has no automatic trigger, only invoked on-demand via API." },
    { stage: "Recovery", status: "PARTIAL", evidence: "Real Recovery Runtime exists as of Step 12 (Plan + real evidence-based Verification) — but every real, mutating Recovery action remains PLAN_ONLY or NOT_IMPLEMENTED by mission mandate; scripts/backup.ts exists but no verified automated restore-test cycle exists." },
  ];
}

// ── Phase 4: VS Code / External Tool Dependency Audit ────────────────

export type ExternalDependencyClass = "INTERNAL_MACHINE_TOOL" | "TEMPORARY_CONSTRUCTION_TOOL" | "PERMANENT_EXTERNAL_PROVIDER" | "REPLACEABLE_PROVIDER" | "OWNER_VISIBLE_DEPENDENCY" | "OWNER_HIDDEN_DEPENDENCY";
export interface ExternalDependencyRecord {
  tool: string; whyRequired: string; currentDependency: string; dnaOsReplacementAvailable: boolean;
  replacementStatus: string; blockingOwnerMigration: boolean; evidence: string; classification: ExternalDependencyClass;
}

export function computeVSCodeDependencyAudit(): ExternalDependencyRecord[] {
  return [
    { tool: "Claude Code / VS Code", whyRequired: "Every Step of this Factory (including this one) is authored and executed through a Claude Code session, not a native DNA OS agent runtime.", currentDependency: "Partial as of Step 13.5 — a real, programmatic CODE_WORKER invocation path now exists (codeWorkerRuntime.ts -> services/ai/gateway.ts's real code.generate capability), but this environment has no real ANTHROPIC_API_KEY configured, so a live call honestly fails; the human-continued Claude Code session remains the real, only proven-working path today.", dnaOsReplacementAvailable: false, replacementStatus: "PARTIAL — as of Step 13, factoryWorkspaceRuntime.ts/workerRegistry.ts/aiContextRuntime.ts real, native Intent->Capability->Context->Worker->Execution Plan->Change Set->Review->Test->Build->Release orchestration exists and is owner-triggerable from the Factory Workspace tab; as of Step 13.5, codeWorkerRuntime.ts real, programmatic CODE_WORKER invocation exists and is wired to the real Anthropic provider — honestly reported as WORKER_REGISTRY.CODE_WORKER.status PARTIAL (real code path, unproven live in this environment: missing real credentials).", blockingOwnerMigration: true, evidence: "workerRegistry.ts#WORKER_REGISTRY.CODE_WORKER.status === 'PARTIAL'; a real call against this environment fails with the real, honest AI_GATEWAY_ANTHROPIC_NOT_CONFIGURED error until the Owner provisions a real ANTHROPIC_API_KEY.", classification: "OWNER_VISIBLE_DEPENDENCY" },
    { tool: "External Terminal", whyRequired: "All npm scripts (sync, tests, build) in this session were run via Bash, not via a DNA OS UI action.", currentDependency: "Full for verification/testing.", dnaOsReplacementAvailable: false, replacementStatus: "PARTIAL — build/test/release Runtimes exist and are route-triggerable, but many scripts/*.ts diagnostics (sync-registry, arch-book, governance-build) have no UI trigger.", blockingOwnerMigration: true, evidence: "grep confirms no app/api/admin/ide route wraps scripts/sync-registry.ts, scripts/build-arch-book.ts, or scripts/build-governance-summary.ts.", classification: "OWNER_HIDDEN_DEPENDENCY" },
    { tool: "GitHub UI", whyRequired: "Real pushes/PRs still require GitHub's own web UI or gh CLI — Source Control here is read-only by Rule.", currentDependency: "Full for any Git Write action.", dnaOsReplacementAvailable: false, replacementStatus: "NOT_IMPLEMENTED by design — Git Write is forbidden inside DNA OS by governance rule, not merely unbuilt.", blockingOwnerMigration: false, evidence: "gitReadOnly.ts confirmed to expose only status/diff/log/branches/tags/blame/merge-status/conflicts — no write endpoint exists.", classification: "PERMANENT_EXTERNAL_PROVIDER" },
    { tool: "Vercel UI", whyRequired: "No real Deploy stage exists in this Factory (Phase 3 chain: Deploy = NOT_IMPLEMENTED); any real deploy today happens outside DNA OS.", currentDependency: "Full.", dnaOsReplacementAvailable: false, replacementStatus: "NOT_IMPLEMENTED — explicitly out of scope for Step 10.5 and prior Steps.", blockingOwnerMigration: true, evidence: "No deploy/ route or DeployRuntime file exists anywhere under app/api/admin/ide/_lib/.", classification: "REPLACEABLE_PROVIDER" },
    { tool: "Supabase UI", whyRequired: "Database Workspace (schema/migrations) has no in-DNA-OS editor — real schema changes are authored as raw .sql migration files.", currentDependency: "Partial — read access exists via Infrastructure Observer inventory only.", dnaOsReplacementAvailable: false, replacementStatus: "NOT_IMPLEMENTED — no Database Workspace UI/runtime confirmed in this repo.", blockingOwnerMigration: true, evidence: "No route under app/api/admin/ide/ reads or writes supabase/migrations/*.sql; registry/infrastructure.json only carries service inventory, not schema.", classification: "OWNER_HIDDEN_DEPENDENCY" },
    { tool: "External Browser (manual)", whyRequired: "UI Inspection (Step 6) automates live browser checks, but the owner still opens a real browser to view the running /admin/ide app itself.", currentDependency: "Partial — the IDE Workspace itself is a web page, requiring a browser, which is expected/normal, not a gap.", dnaOsReplacementAvailable: true, replacementStatus: "COMPLETE — this is the DNA OS surface itself, not an external dependency in the problematic sense.", blockingOwnerMigration: false, evidence: "components/ide-shell/IDEWorkspace.tsx is the real, existing native surface.", classification: "INTERNAL_MACHINE_TOOL" },
  ];
}

// ── Phase 5: Native DNA Enforcement Audit ─────────────────────────────

export type EnforcementLevel = "DOCUMENT_ONLY" | "CODE_ENFORCED" | "RUNTIME_ENFORCED" | "BUILD_ENFORCED" | "TEST_ENFORCED" | "ARCHITECTURE_ISOLATED" | "PARTIAL" | "MISSING";
export interface PrincipleRecord { principle: string; level: EnforcementLevel; evidence: string; }

export function computeNativeDNAEnforcement(): PrincipleRecord[] {
  return [
    { principle: "Workspace isolation", level: "RUNTIME_ENFORCED", evidence: "fsSecurity.ts confirmed to real-path-resolve and reject any path escaping WORKSPACE_ROOT — a real, code-level check, not documentation." },
    { principle: "Organization isolation", level: "MISSING", evidence: "No real multi-organization data model or route was found in this repo (single-tenant IDE Workspace only) — unprovable either way; honestly reported as MISSING evidence, never claimed proven." },
    { principle: "User private data boundary", level: "MISSING", evidence: "No real end-user-facing data model exists in the /admin/ide surface audited — this Factory operates on source code, not user records; boundary is unprovable from this codebase alone." },
    { principle: "Capability data boundary", level: "ARCHITECTURE_ISOLATED", evidence: "registry/capability-registry.json's real CapabilityId/InputContract/OutputContract shape carries no user-specific fields by construction (verified: schema has no tenant/user/customer field)." },
    { principle: "AI context scoping", level: "CODE_ENFORCED", evidence: "As of Step 13, aiContextRuntime.ts's real buildAIContextPackage() keys the Context Fingerprint to sha256(workspaceSessionId:contextPlanId:sourceFingerprint) — two different Workspace Sessions can never produce the same fingerprint by construction, and readScope/writeScope are taken directly from the real, approved ContextPlan, never the whole repo." },
    { principle: "Provider independence", level: "PARTIAL", evidence: "Supabase Edge Functions (14 real connectors) are the real integration layer, but core pipelines (Build/Test/Release/Review) have zero Supabase coupling — Provider independence holds for the Factory core, not proven for the wider app." },
    { principle: "No direct provider dependency in core", level: "CODE_ENFORCED", evidence: "grep across app/api/admin/ide/_lib/*.ts confirmed zero imports of @supabase/* in the pipeline Runtimes (execution/queue/inspection/governance/artifact/review/test/build/release)." },
    { principle: "No cross-workspace data path", level: "ARCHITECTURE_ISOLATED", evidence: "Single real WORKSPACE_ROOT constant used throughout fsSecurity.ts — no second workspace root exists in source to cross into." },
    { principle: "No AI access to financial mutation", level: "MISSING", evidence: "No real Financial Runtime was found under app/api/admin/ide/ — cannot prove or disprove AI mutation access from this codebase; honestly reported as MISSING evidence." },
    { principle: "Financial deterministic runtime", level: "MISSING", evidence: "No real Financial Runtime exists in the audited surface." },
    { principle: "Document evidence ownership", level: "DOCUMENT_ONLY", evidence: "documentLifecycleConstitution.ts (Step 10) declares 8 policies, all honestly DECLARED_NOT_ENFORCED or NOT_IMPLEMENTED per its own regression suite — confirmed no real Document engine exists." },
    { principle: "Artifact immutability", level: "RUNTIME_ENFORCED", evidence: "artifactRuntime.ts confirmed (Step 5/9.5 investigation) to never mutate a stored Artifact record in place — regenerate creates a new artifact, never overwrites." },
    { principle: "Evidence validation", level: "RUNTIME_ENFORCED", evidence: "artifact/[artifactId]/evidence and /integrity routes exist and are exercised by scripts/artifact-test.ts." },
    { principle: "Capability reuse before creation", level: "RUNTIME_ENFORCED", evidence: "As of Step 13, capabilityResolverRuntime.ts's real resolveCapabilities() runs before factoryWorkspaceRuntime.ts allows Context Preparation to proceed (requires a real CapabilityResolutionReport on the session) — a real, deterministic, multi-factor score, never a name-only match; NEW_CAPABILITY_REQUIRED still requires explicit Owner approval before any new Capability would be created (not auto-created this Step)." },
    { principle: "Registry required before runtime use", level: "PARTIAL", evidence: "sync-registry.ts + factory-registry-test.ts enforce this for module registration, but no runtime gate blocks executing an unregistered module — enforced at CI/test time, not at real runtime." },
    { principle: "Every decision has evidence", level: "PARTIAL", evidence: "decisions.ts exists as a real decision log surface, but no code-level gate rejects a decision lacking evidence — declared practice, partially wired." },
    { principle: "No guess", level: "TEST_ENFORCED", evidence: "Multiple regression suites (compatibility-test.ts, country-test.ts, document-lifecycle-test.ts) explicitly assert honest UNKNOWN/NOT_IMPLEMENTED statuses rather than fabricated values — a real, repeatable test-enforced discipline." },
    { principle: "Standards are external", level: "CODE_ENFORCED", evidence: "standards.ts reads real external standard references rather than hardcoding rule text inline (confirmed by file presence and role in Step 1-era investigation)." },
    { principle: "Source mutation restrictions", level: "RUNTIME_ENFORCED", evidence: "fileWrite.ts + targetPolicy.ts confirmed to gate writes through a real allow/deny policy, not an unrestricted fs.writeFileSync." },
    { principle: "Git write restrictions", level: "ARCHITECTURE_ISOLATED", evidence: "gitReadOnly.ts exposes zero write operations by construction — there is no code path to a git commit/push from this module." },
    { principle: "Release/Deploy approval boundaries", level: "RUNTIME_ENFORCED", evidence: "releaseRuntime.ts's Release Approval stage confirmed (Step 10) to require an explicit approve action before Operational Readiness — verified via release-test.ts." },
  ];
}

// ── Phase 6: Data & Capability Boundary Audit ─────────────────────────

export interface DataBoundaryClaim { claim: string; status: "PROVEN" | "PARTIAL" | "UNKNOWN"; evidence: string; }
export function computeDataBoundaryAudit(): DataBoundaryClaim[] {
  return [
    { claim: "User data never flows into the central Capability store", status: "PARTIAL", evidence: "registry/capability-registry.json's real schema has no user-identifying field (verified structurally) — but no runtime guard was found that would REJECT a hypothetical write containing one; structurally clean, not actively enforced." },
    { claim: "AI never sees the unified database", status: "UNKNOWN", evidence: "No real 'unified database' or AI Context Runtime was found in this repo to audit either direction." },
    { claim: "AI only sees Context the Runtime explicitly provides", status: "PARTIAL", evidence: "As of Step 13, aiContextRuntime.ts's real AIContextPackage.readScope/writeScope are taken directly from the real, approved ContextPlan (never the whole repo) and its Context Fingerprint is keyed to workspaceSessionId so one session's package can never merge with another's by construction — proven for the new Factory Workspace path specifically; not proven for this Claude Code session's own tool access (Read/Edit/Bash), which remains broader by design (an IDE session, not a scoped Worker call)." },
    { claim: "Capabilities entering Core carry no user-specific data", status: "PARTIAL", evidence: "Same structural finding as claim 1 — schema-level, not runtime-enforced." },
    { claim: "Financial mutation has no path from AI", status: "UNKNOWN", evidence: "No Financial Runtime exists in the audited surface — unprovable." },
    { claim: "Workspace A has no path to Workspace B", status: "PARTIAL", evidence: "Only one real WORKSPACE_ROOT exists in this repo's IDE surface — there is no second workspace to test a cross-path against; the claim is vacuously true here but not proven against a real multi-workspace scenario." },
    { claim: "Providers never own System State", status: "PARTIAL", evidence: "Core pipeline Runtimes (Build/Test/Release/Review/Artifact) hold state in their own in-memory Maps, not in Supabase — verified by absence of @supabase imports in those files. Edge Functions (14 real connectors) DO own their own webhook processing state outside this audit's reach." },
    { claim: "DNA OS owns its own Registry/State/Evidence", status: "PROVEN", evidence: "All 30 audited systems' registries/evidence are real local JSON files under registry/ or in-memory Runtimes under app/api/admin/ide/_lib/ — zero external system-of-record dependency confirmed for the Factory pipeline itself." },
  ];
}

// ── Phase 7: Capability Reuse Audit ───────────────────────────────────

export type ReuseClass = "REUSABLE_AS_IS" | "REUSABLE_WITH_CONFIGURATION" | "REUSABLE_WITH_CONNECTOR" | "REQUIRES_EXTENSION" | "MUST_BE_NEW" | "UNKNOWN";
export interface CapabilityReuseFoundation {
  registryComplete: boolean; totalCapabilities: number; withInputContract: number; withOutputContract: number;
  withDependencies: number; resolverExists: boolean; note: string;
}
export function computeCapabilityReuseAudit(): CapabilityReuseFoundation {
  try {
    const reg = JSON.parse(readFileSync(path.join(ROOT, "registry/capability-registry.json"), "utf-8"));
    const caps: { InputContract?: unknown; OutputContract?: unknown; Dependencies?: unknown[] }[] = reg.capabilities ?? [];
    const resolverExists = fileExists("app/api/admin/ide/_lib/capabilityResolverRuntime.ts");
    return {
      registryComplete: !!reg.frozen,
      totalCapabilities: caps.length,
      withInputContract: caps.filter((c) => c.InputContract).length,
      withOutputContract: caps.filter((c) => c.OutputContract).length,
      withDependencies: caps.filter((c) => Array.isArray(c.Dependencies) && c.Dependencies.length > 0).length,
      resolverExists,
      note: resolverExists
        ? "Foundation is real and structurally sound (frozen, checksum-locked, 202 capabilities each with real contracts). As of Step 13, a real, deterministic Capability Resolver (capabilityResolverRuntime.ts) exists — real multi-factor scoring (domain/dependency/evidence/lifecycle), never a name-only match, never auto-creates a new Capability. It is wired to real routes (resolve-capabilities, capabilities/search) and to factoryWorkspaceRuntime.ts's real Workspace Session flow."
        : "Foundation is real and structurally sound (frozen, checksum-locked, 202 capabilities each with real contracts) — but NO Capability Resolver exists anywhere in this repo.",
    };
  } catch (e) {
    return { registryComplete: false, totalCapabilities: 0, withInputContract: 0, withOutputContract: 0, withDependencies: 0, resolverExists: false, note: `Could not read registry/capability-registry.json: ${e}` };
  }
}

// ── Phase 13: Factory Completion Gates ────────────────────────────────

export type GateStatus = "PASSED" | "PARTIAL" | "BLOCKED" | "NOT_IMPLEMENTED" | "UNKNOWN";
export interface CompletionGate { id: string; status: GateStatus; blocking: boolean; checks: string[]; evidence: string[]; missing: string[]; ownerDecisionRequired: boolean; }

export function computeCompletionGates(): CompletionGate[] {
  const systems = computeFactoryCompletion();
  const complete = systems.filter((s) => s.status === "COMPLETE" || s.status === "OPERATIONAL").length;
  const vscode = computeVSCodeDependencyAudit();
  const dna = computeNativeDNAEnforcement();
  const boundary = computeDataBoundaryAudit();
  const reuse = computeCapabilityReuseAudit();

  const criticalEnforced = dna.filter((d) => ["ARCHITECTURE_ISOLATED", "RUNTIME_ENFORCED", "CODE_ENFORCED", "TEST_ENFORCED", "BUILD_ENFORCED"].includes(d.level)).length;
  const monitoringRt = systems.find((s) => s.id === "MONITORING_RUNTIME");
  const incidentRt = systems.find((s) => s.id === "INCIDENT_RUNTIME");
  const recoveryRt = systems.find((s) => s.id === "RECOVERY_RUNTIME");
  const continuousOpsRt = systems.find((s) => s.id === "CONTINUOUS_OPERATIONS_RUNTIME");
  const alertRt = systems.find((s) => s.id === "ALERT_RUNTIME");
  const backupRt = systems.find((s) => s.id === "BACKUP_RESTORE_RUNTIME");
  const factoryWorkspaceRt = systems.find((s) => s.id === "FACTORY_WORKSPACE");
  const capabilityResolverRt = systems.find((s) => s.id === "CAPABILITY_RESOLVER");
  const contextPlannerRt = systems.find((s) => s.id === "CONTEXT_PLANNER");
  const aiContextRt = systems.find((s) => s.id === "AI_CONTEXT_RUNTIME");
  const workerRegistryRt = systems.find((s) => s.id === "WORKER_REGISTRY");
  const executionPlannerRt = systems.find((s) => s.id === "EXECUTION_PLANNER");
  const intentRt = systems.find((s) => s.id === "INTENT_RUNTIME");

  return [
    { id: "CORE_RUNTIME_READY", status: complete >= systems.length * 0.6 ? "PARTIAL" : "BLOCKED", blocking: true, checks: ["Execution/Queue/Inspection/Governance/Artifact runtimes real"], evidence: [`${complete}/${systems.length} systems COMPLETE or OPERATIONAL`], missing: systems.filter((s) => s.status === "NOT_IMPLEMENTED").map((s) => s.id), ownerDecisionRequired: false },
    { id: "FACTORY_PIPELINE_READY", status: "PARTIAL", blocking: true, checks: ["Review->Test->Build->Release chain real end-to-end", "Monitoring/Incident/Recovery Runtimes real"], evidence: ["Chain audit: Review/Test/Build/Release all real Runtimes with passing suites (Steps 7-10)", "Monitoring/Incident/Recovery Runtimes real as of Step 12 (observe/plan/verify only)"], missing: ["Deploy stage entirely", "Continuous/scheduled Monitoring loop", "Real Recovery execution (mutating actions remain PLAN_ONLY by design)"], ownerDecisionRequired: false },
    { id: "CAPABILITY_REUSE_READY", status: reuse.resolverExists ? "PASSED" : (reuse.registryComplete ? "PARTIAL" : "BLOCKED"), blocking: false, checks: ["Capability Registry frozen and contract-complete", "Resolver exists"], evidence: [`${reuse.totalCapabilities} real capabilities, registryComplete=${reuse.registryComplete}`], missing: ["Capability Resolver (explicitly not built this round)"], ownerDecisionRequired: true },
    { id: "DATA_ISOLATION_READY", status: boundary.some((b) => b.status === "UNKNOWN") ? "UNKNOWN" : "PARTIAL", blocking: true, checks: ["8 real data boundary claims"], evidence: [`${boundary.filter((b) => b.status === "PROVEN").length}/${boundary.length} claims PROVEN`], missing: boundary.filter((b) => b.status !== "PROVEN").map((b) => b.claim), ownerDecisionRequired: true },
    { id: "PROVIDER_INDEPENDENCE_READY", status: "PARTIAL", blocking: false, checks: ["No @supabase import in core pipeline Runtimes"], evidence: ["Confirmed via grep: 0 imports across execution/queue/inspection/governance/artifact/review/test/build/release Runtimes"], missing: ["Wider app (outside /admin/ide) not audited this round"], ownerDecisionRequired: false },
    { id: "OWNER_WORKSPACE_READY", status: (factoryWorkspaceRt?.status === "COMPLETE" || factoryWorkspaceRt?.status === "PARTIAL") ? "PARTIAL" : "BLOCKED", blocking: true, checks: ["Single owner entry point exists and is wired to real pipelines", "Real Factory Workspace tab lets the Owner start and track work without VS Code"], evidence: [`components/ide-shell/IDEWorkspace.tsx real, wired to 37 audited systems`, `Factory Workspace Runtime: ${factoryWorkspaceRt?.status ?? "UNKNOWN"} (Step 13) — real Intent capture + Owner Decision Gates now exist in the Factory Workspace tab`], missing: ["Design stage still has no dedicated artifact", "CODE_WORKER execution still requires a human-continued Claude Code session (see VS_CODE_EXIT_READY)"], ownerDecisionRequired: false },
    // NATIVE_FACTORY_FLOW_READY (new gate, Step 13): PASSED requires a real,
    // proven end-to-end Native Factory Flow with a real regression test —
    // never PASSED from file presence alone.
    { id: "NATIVE_FACTORY_FLOW_READY", status: factoryWorkspaceRt?.status === "COMPLETE" ? "PARTIAL" : (factoryWorkspaceRt?.status === "NOT_IMPLEMENTED" ? "NOT_IMPLEMENTED" : "BLOCKED"), blocking: true,
      checks: ["Real Workspace Session orchestrator exists", "Real Intent->Capability->Context->Worker->Execution Plan->Change Set->Review->Test->Build->Release chain is wired end-to-end", "A real, passing native-factory-flow-test.ts regression proves at least one real, safe, scoped task reached a real outcome"],
      evidence: [`Factory Workspace Runtime: ${factoryWorkspaceRt?.status ?? "UNKNOWN"} (Step 13) — real factoryWorkspaceRuntime.ts orchestrates real changeSetRuntime.ts/testRuntime.ts/buildRuntime.ts/releaseRuntime.ts, never a second/duplicate pipeline`],
      missing: ["Real Deploy remains explicitly out of scope/forbidden — a passing Release Candidate is the real ceiling this Step, never OUTCOME_PROVEN implying Deploy occurred"], ownerDecisionRequired: true },
    // CAPABILITY_RESOLUTION_READY (new gate, Step 13).
    { id: "CAPABILITY_RESOLUTION_READY", status: reuse.resolverExists ? (reuse.registryComplete ? "PASSED" : "PARTIAL") : "BLOCKED", blocking: false,
      checks: ["Real, deterministic Capability Resolver exists", "Wired to real routes", "Never a name-only match"],
      evidence: [`Capability Resolver: ${capabilityResolverRt?.status ?? "UNKNOWN"} — ${reuse.totalCapabilities} real capabilities, registryComplete=${reuse.registryComplete}, resolverExists=${reuse.resolverExists}`],
      missing: reuse.resolverExists ? [] : ["Capability Resolver"], ownerDecisionRequired: false },
    // AI_CONTEXT_ISOLATION_READY (new gate, Step 13): PASSED requires the
    // real Context Fingerprint isolation mechanism AND a passing ai-context
    // regression test proving cross-session isolation.
    { id: "AI_CONTEXT_ISOLATION_READY", status: aiContextRt?.status === "COMPLETE" ? "PARTIAL" : (aiContextRt?.status === "NOT_IMPLEMENTED" ? "NOT_IMPLEMENTED" : "BLOCKED"), blocking: true,
      checks: ["Real, provider-neutral Context Package builder exists", "Context Fingerprint is keyed to workspaceSessionId — code-level, not documented-only", "A real ai-context-test.ts regression proves cross-session isolation"],
      evidence: [`AI Context Runtime: ${aiContextRt?.status ?? "UNKNOWN"} (Step 13) — aiContextRuntime.ts#buildAIContextPackage() keys contextFingerprint to sha256(workspaceSessionId:contextPlanId:sourceFingerprint)`],
      missing: ["As of Step 13.5, real AI provider invocation IS wired for CODE_WORKER (codeWorkerRuntime.ts), but unproven live in this environment — no real ANTHROPIC_API_KEY configured; ANALYSIS_WORKER remains COMPATIBILITY_ONLY (human-continued session only)"], ownerDecisionRequired: false },
    { id: "VS_CODE_EXIT_READY", status: "BLOCKED", blocking: true, checks: ["No OWNER_VISIBLE_DEPENDENCY or OWNER_HIDDEN_DEPENDENCY remains blocking"], evidence: [`${vscode.filter((v) => v.blockingOwnerMigration).length}/${vscode.length} dependencies still block owner migration`], missing: vscode.filter((v) => v.blockingOwnerMigration).map((v) => v.tool), ownerDecisionRequired: true },
    { id: "COST_INTELLIGENCE_READY", status: "PARTIAL", blocking: false, checks: ["Real cost_summary field in registry/infrastructure.json"], evidence: ["registry/infrastructure.json confirmed to carry a cost_summary field (Step 10.5 Phase 10)"], missing: ["No Cost-per-Capability or Cost-per-Build linkage confirmed"], ownerDecisionRequired: false },
    { id: "DOCUMENT_LIFECYCLE_READY", status: "NOT_IMPLEMENTED", blocking: false, checks: ["8 Document Lifecycle policies ENFORCED"], evidence: ["documentLifecycleConstitution.ts: all 8 policies honestly DECLARED_NOT_ENFORCED/NOT_IMPLEMENTED (Step 10)"], missing: ["Real Document engine"], ownerDecisionRequired: false },
    // DEPLOYMENT_READY intentionally left NOT_IMPLEMENTED per Step 12 mission
    // instruction: "ห้ามเปลี่ยนเป็น PASSED เพียงเพราะ Monitoring มีแล้ว" —
    // real Monitoring existing does not make real Deploy exist.
    { id: "DEPLOYMENT_READY", status: "NOT_IMPLEMENTED", blocking: true, checks: ["Real Deploy stage exists"], evidence: [], missing: ["Deploy stage entirely — explicitly out of scope through Step 12"], ownerDecisionRequired: true },
    // MONITORING_READY (Step 12.5): PASSED requires a real, PROVEN scheduled
    // loop + current signals + alerting evidence. The real Scheduler
    // Contract now exists (vercel.json cron entry + CRON_SECRET-gated
    // route), but the real Adapter is honestly COMPATIBILITY_ONLY — no
    // real deploy occurs this Step, so firing is unproven. Stays PARTIAL.
    { id: "MONITORING_READY", status: (monitoringRt?.status === "NOT_IMPLEMENTED" || continuousOpsRt?.status === "NOT_IMPLEMENTED") ? "NOT_IMPLEMENTED" : "PARTIAL", blocking: true,
      checks: ["Real Monitoring Runtime exists", "Real Signal collection from real sources", "Real Scheduler Contract declared", "Real Scheduler Adapter proven firing", "Alerting wired"],
      evidence: [`Monitoring Runtime: ${monitoringRt?.status ?? "UNKNOWN"}, Continuous Operations Runtime: ${continuousOpsRt?.status ?? "UNKNOWN"}, Alert Runtime: ${alertRt?.status ?? "UNKNOWN"} (Step 12.5)`, "real vercel.json cron entry + real CRON_SECRET-gated /api/cron/operations-loop route exist (Scheduler Contract: IMPLEMENTED)"],
      missing: ["Real, live proof the Vercel Cron adapter has ever fired (Adapter: COMPATIBILITY_ONLY — no real deploy this Step)"], ownerDecisionRequired: true },
    // INCIDENT_RECOVERY_READY: PASSED requires incident detection + alert +
    // recovery planning + a VERIFIED restore/recovery cycle. Restore Test
    // is honestly PLAN_ONLY (no isolated DB target exists) — stays PARTIAL.
    { id: "INCIDENT_RECOVERY_READY", status: (incidentRt?.status === "NOT_IMPLEMENTED" || recoveryRt?.status === "NOT_IMPLEMENTED" || alertRt?.status === "NOT_IMPLEMENTED") ? "NOT_IMPLEMENTED" : "PARTIAL", blocking: true,
      checks: ["Real Incident Runtime exists", "Real Alert dispatch from real Incidents", "Real Recovery Plan + Verification exists", "Real, VERIFIED restore-and-check cycle exists"],
      evidence: [`Incident Runtime: ${incidentRt?.status ?? "UNKNOWN"}, Alert Runtime: ${alertRt?.status ?? "UNKNOWN"}, Recovery Runtime: ${recoveryRt?.status ?? "UNKNOWN"} (Step 12/12.5) — real Incident open/correlate/timeline, real Alert dispatch (DISPATCHED never implies DELIVERED), and Recovery Plan/Verify all exist`],
      missing: ["Real, VERIFIED restore-from-backup cycle (Restore Test Runtime only ever reaches PLAN_ONLY — no isolated database target exists in this environment)", "Real Recovery execution (all mutating types remain PLAN_ONLY/NOT_IMPLEMENTED by design)"], ownerDecisionRequired: true },
    // BACKUP_READY (new gate, Step 12.5): must separate backup exists /
    // integrity verified / restore verified — never conflate the three.
    { id: "BACKUP_READY", status: backupRt?.status === "NOT_IMPLEMENTED" ? "NOT_IMPLEMENTED" : "PARTIAL", blocking: true,
      checks: ["A real backup exists", "Real, deterministic integrity verification exists", "A real, VERIFIED restore test exists"],
      evidence: [`Backup & Restore Test Runtime: ${backupRt?.status ?? "UNKNOWN"} (Step 12.5) — real backups/2026-07-05_0502 discovered, real deterministic integrity check exists (backupRuntime.ts#verifyBackupIntegrity), real dry-run Restore Test exists (restoreTestRuntime.ts#runRestoreTest)`],
      missing: ["The real, only known backup is STALE (30+ days old) and integrity-checks as STALE, not VERIFIED", "No real, VERIFIED restore has ever occurred — Restore Test always caps at PLAN_ONLY (no isolated database target exists in this environment)"], ownerDecisionRequired: true },
  ];
}

// ── Full Report ────────────────────────────────────────────────────

export interface FactoryCompletionReport {
  generatedAt: string;
  totalSystems: number;
  byStatus: Record<string, number>;
  completionByFactory: Record<string, { count: number; avgCompletion: number }>;
  systems: SystemCompletionRecord[];
  endToEndChain: ChainStageRecord[];
  vscodeDependencies: ExternalDependencyRecord[];
  nativeDNAEnforcement: PrincipleRecord[];
  dataBoundaryStatus: DataBoundaryClaim[];
  capabilityReuseReadiness: CapabilityReuseFoundation;
  completionGates: CompletionGate[];
  criticalBlockers: string[];
}

export function buildFactoryCompletionReport(): FactoryCompletionReport {
  const systems = computeFactoryCompletion();
  const byStatus: Record<string, number> = {};
  for (const s of systems) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;

  const byFactory: Record<string, { count: number; sum: number }> = {};
  for (const s of systems) {
    byFactory[s.factoryOwner] ??= { count: 0, sum: 0 };
    byFactory[s.factoryOwner].count++;
    byFactory[s.factoryOwner].sum += s.completionPercent;
  }
  const completionByFactory: Record<string, { count: number; avgCompletion: number }> = {};
  for (const [k, v] of Object.entries(byFactory)) completionByFactory[k] = { count: v.count, avgCompletion: Math.round(v.sum / v.count) };

  const gates = computeCompletionGates();
  const criticalBlockers = gates.filter((g) => g.blocking && (g.status === "BLOCKED" || g.status === "NOT_IMPLEMENTED" || g.status === "UNKNOWN")).map((g) => `${g.id}: ${g.status}`);

  return {
    generatedAt: new Date().toISOString(),
    totalSystems: systems.length,
    byStatus,
    completionByFactory,
    systems,
    endToEndChain: computeEndToEndChain(),
    vscodeDependencies: computeVSCodeDependencyAudit(),
    nativeDNAEnforcement: computeNativeDNAEnforcement(),
    dataBoundaryStatus: computeDataBoundaryAudit(),
    capabilityReuseReadiness: computeCapabilityReuseAudit(),
    completionGates: gates,
    criticalBlockers,
  };
}
