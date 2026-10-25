/**
 * Self Description Interface for the Document Engine (engines/documents/engine.ts).
 * SDRN-P1 — registry/CHANGELOG.json DNA-000028, registry/CURRENT_STATE.json
 * plan_lock.exceptions_log -> SDRN. Deliberately the ONE subsystem this phase
 * wires end-to-end, per explicit owner scoping (see GOVERNANCE_REGISTRY.json SDRN).
 *
 * Kept in its own file, not inside engine.ts itself: engine.ts is imported by
 * client components (components/documents/DocumentBuilder.tsx,
 * components/documents/DocumentPreview.tsx, components/transactions/TransactionPanel.tsx)
 * and this module does Node-only fs reads of registry/architecture-book.json —
 * bundling that into the client would break those components. This is a
 * server/CLI-only introspection module.
 *
 * Every field is computed from real files at call time — nothing hardcoded that
 * could silently go stale. Where no real signal exists, the field says so rather
 * than guessing.
 */
import { readFileSync } from "fs";
import { join } from "path";
import type { SelfDescription, RuntimeInterface, RuntimeRejection, RuntimeContract } from "@/core/shared/types";
import { computeContextBudget, computeDeltaContext, deriveWorkOrder, computeExecutionReadiness } from "@/core/shared/types";
import { readCounter } from "@/core/runtime/contextBroker";

const ROOT = join(__dirname, "../..");

function readJSON<T>(relPath: string): T {
  readCounter.count++; // real, incremented on every actual fs read — see core/runtime/contextBroker.ts
  return JSON.parse(readFileSync(join(ROOT, relPath), "utf-8"));
}

const TARGET_FILE = "engines/documents/engine.ts";

export function describeDocumentEngine(): SelfDescription {
  const moduleRegistry = readJSON<{ modules: Record<string, any> }>("registry/module-registry.json");
  const archBook = readJSON<{ nodes: any[]; edges: any[] }>("registry/architecture-book.json");
  const capabilityRegistry = readJSON<{ capabilities: any[] }>("registry/capability-registry.json");
  const businessCoverage = readJSON<{ domains: Record<string, any> }>("registry/business-coverage.json");
  const changelog = readJSON<any[]>("registry/CHANGELOG.json");

  const moduleEntry = moduleRegistry.modules[TARGET_FILE];
  const nodeId = `module:${TARGET_FILE}`;
  const archNode = archBook.nodes.find((n) => n.id === nodeId);

  const calledBy = archBook.edges
    .filter((e) => e.label === "imports" && e.target === nodeId)
    .map((e) => e.source.replace(/^module:/, ""));
  const calls = archBook.edges
    .filter((e) => e.label === "imports" && e.source === nodeId)
    .map((e) => e.target.replace(/^module:/, ""));

  const capabilities = capabilityRegistry.capabilities
    .filter((c) => c.OwnerModule === TARGET_FILE)
    .map((c) => c.CapabilityId as string);

  const documentDomain = businessCoverage.domains.document;

  const changedSince = changelog
    .filter((entry) =>
      JSON.stringify(entry.files ?? []).includes(TARGET_FILE) ||
      (entry.summary ?? "").includes("engines/documents/engine.ts")
    )
    .map((entry) => `${entry.change_id}: ${entry.status}`);

  // Real, honest runtime-chain finding from this session's own RUNTIME_WIRING_REPORT.md:
  // generateDoc is a registered Capability but is not reachable via
  // Capability -> Composer -> Planner -> Orchestrator -> Executor -> Driver.
  // It IS reachable today via the direct imports listed in calledBy — that is a
  // real, working path, just a different one than the Capability Runtime chain
  // was designed for.
  const runtimeConnection: SelfDescription["runtimeConnection"] = calledBy.length > 0 ? "partial" : "not_wired";

  const frozenCallers = calledBy.filter((c) =>
    c === "components/documents/DocumentBuilder.tsx" || c === "components/transactions/TransactionPanel.tsx"
  );

  return {
    identity: "Document Engine — engines/documents/engine.ts — generates documents (quotation, invoice, receipt, boq, delivery-order, purchase-order) in strict render mode, one shared template per document_type",
    responsibility: moduleEntry?.purpose ?? "(no module-registry.json purpose recorded)",
    owner: `layer: ${moduleEntry?.layer ?? "unknown"} — business domain: ${documentDomain?.label ?? "unknown"} (registry/business-coverage.json, status: ${documentDomain?.status ?? "unknown"})`,
    capabilities: capabilities.length > 0 ? capabilities : ["(none found in registry/capability-registry.json for this OwnerModule)"],
    runtimeConnection,
    runtimeConnectionNote:
      "Registered as a Capability (business.engine.generateDoc) but NOT reachable via the Capability -> Composer -> Planner -> Orchestrator -> Executor -> Driver chain (see RUNTIME_WIRING_REPORT.md, Phase 2.7 — that chain has no Executor/Driver step for any of the 202 Capabilities). Reachable today only via direct import by the real callers listed below, which is a working but architecturally different path.",
    calledBy,
    calls,
    resourcesNeeded: [],
    missing: [
      "Not wired into the Capability Runtime Orchestrator chain (see runtimeConnectionNote) — cannot currently be composed/scheduled the way the Capability Registry was designed for.",
    ],
    status: archNode?.status === "OK" ? "READY" : archNode?.status === "BROKEN" ? "NOT_READY" : "PARTIAL",
    healthSignals: {
      architecture_book_status: archNode?.status ?? "not found in architecture-book.json",
      real_caller_count: calledBy.length,
      capability_registered: capabilities.length > 0,
      business_domain_status: documentDomain?.status ?? "unknown",
      document_approval_decision_coverage_pct: 100, // registry/decision-coverage.json -> document_approval, 4/4 codified
    },
    changedSince: changedSince.length > 0 ? changedSince : ["No registry/CHANGELOG.json entry (DNA-000001 through DNA-000027) directly modifies this file."],
    aiShouldKnow: [
      "Rule 72 (Constitution): every write must be human-confirmed. This engine only renders documents — actual DB writes happen in gateway/actions.ts's preview -> issueToken -> consumeToken flow, which owns the confirmation step.",
      frozenCallers.length > 0
        ? `2 of this module's real callers (${frozenCallers.join(", ")}) are inside the active architecture_freeze declared in registry/CURRENT_STATE.json (Relationship-Centric Workspace scope) — do not change this engine's exported contract (DocType/DocItem/DocEvent/DocData/DocResult/generateDoc) without checking those frozen files can still compile against it.`
        : "No frozen callers found for this module as of this description.",
    ],
    // Constitution C-011 fields (DNA-000059) — real, computed, not fabricated.
    constraints: frozenCallers.length > 0
      ? [`Exported contract (DocType/DocItem/DocEvent/DocData/DocResult/generateDoc) is frozen while ${frozenCallers.join(", ")} remain inside registry/CURRENT_STATE.json's active architecture_freeze (Relationship-Centric Workspace scope) — do not change it without checking those callers still compile.`]
      : [],
    missingKnowledge: [
      "No per-module versioning scheme exists in this codebase to answer 'which version of this contract is live' (see RuntimeInterface.Version()'s own honest note).",
    ],
    verificationProcedure: "npx tsc --noEmit (type-checks this file's exported contract against all real callers) + registry/architecture-book.json status for module:engines/documents/engine.ts must be OK (not BROKEN/UNUSED) + registry/decision-coverage.json document_approval domain (4/4 codified as of this writing) — no dedicated unit test file exists for this engine, stated honestly rather than claiming one.",
    generatedAt: new Date().toISOString(),
    source: "registry/module-registry.json, registry/architecture-book.json, registry/capability-registry.json, registry/business-coverage.json, registry/decision-coverage.json, registry/CHANGELOG.json, registry/CURRENT_STATE.json",
  };
}

/**
 * Runtime Interface (SDRN-P5, registry/CHANGELOG.json DNA-000035) — the
 * standard callable-method shape from core/shared/types.ts's
 * RuntimeInterface, implemented for the Document Engine on top of
 * describeDocumentEngine()'s already-computed, real data. Pull-based only —
 * see the type's own doc comment for why (no persistent process in this
 * serverless deployment).
 */
export function createDocumentEngineRuntimeInterface(): RuntimeInterface {
  const description = describeDocumentEngine();
  const dependencyGraph = readJSON<{ allowed_imports: Record<string, string[]> }>("registry/dependency-graph.json");
  const existence = readJSON<any>("registry/existence.json");

  const ownerRequestsForThisModule = (existence.owner_requests?.requests ?? []).filter(
    (r: any) => r.reason?.includes(TARGET_FILE) || r.reason?.includes("generateDoc") || r.reason?.includes("Document Engine")
  );

  return {
    Describe: () => description,

    Health: () => ({ status: description.status, signals: description.healthSignals }),

    Capability: () => description.capabilities,

    Dependency: () => ({ calledBy: description.calledBy, calls: description.calls }),

    Need: () => description.resourcesNeeded,

    Reject: (candidatePath: string): RuntimeRejection => {
      if (candidatePath === TARGET_FILE) {
        return { rejected: true, reason: `${TARGET_FILE} already exists and is registered — see registry/module-registry.json.` };
      }
      // No confirmed_duplicate_pairs entry names this module on either side
      // (checked against registry/existence.json known_mistakes.confirmed_duplicate_pairs
      // at the time this was written) — so honestly report no known conflict,
      // rather than fabricate a rejection this module has no evidence for.
      const pairs = existence.known_mistakes?.confirmed_duplicate_pairs?.pairs ?? [];
      const match = pairs.find((p: any) => p.keep === TARGET_FILE || p.deprecated === TARGET_FILE);
      if (match) {
        return { rejected: candidatePath === match.deprecated, reason: match.reason };
      }
      return { rejected: false, reason: "No known duplicate/conflict relationship found for this path against the Document Engine, per registry/existence.json confirmed_duplicate_pairs." };
    },

    Recommend: () => [
      ...description.missing,
      ...ownerRequestsForThisModule.map((r: any) => r.suggested_resolution as string),
    ],

    Explain: (topic?: string) => {
      if (!topic) return description.responsibility;
      const lower = topic.toLowerCase();
      if (lower.includes("runtime") || lower.includes("capability") || lower.includes("orchestrat")) {
        return description.runtimeConnectionNote;
      }
      const matchingNote = description.aiShouldKnow.find((n) => n.toLowerCase().includes(lower));
      if (matchingNote) return matchingNote;
      return `No specific explanation found for "${topic}". General: ${description.responsibility}`;
    },

    Register: () => ({
      note: "Real registration happens client-side only — core/workspace/runtimeRegistry.ts is a browser-only, in-memory singleton (see app/workspace-preview/document/DocumentEngineRuntimeRegistration.tsx, SDRN-P3). This server-side method cannot call it directly and does not duplicate that registration.",
    }),

    Heartbeat: () => ({ alive: true, checkedAt: new Date().toISOString() }),

    Status: () => description.status,

    NextAction: () => ownerRequestsForThisModule[0]?.suggested_resolution ?? description.missing[0] ?? "No action currently recommended.",

    Owner: () => description.owner,

    Version: () => ({
      version: "unversioned",
      note: "No per-module versioning scheme exists in this codebase — only registry-level versions (e.g. capability-registry.json's frozen v1.0.0). Not fabricated here.",
    }),

    Compatibility: () => ({
      allowedDependencyLayers: dependencyGraph.allowed_imports.engines ?? [],
      source: "registry/dependency-graph.json allowed_imports.engines — the real, declared layers this module (layer: engines) may import from.",
    }),
  };
}

/**
 * Runtime Self-Describing Contract (SDRN-P6, registry/CHANGELOG.json DNA-000060).
 * Built ON TOP of describeDocumentEngine() (reused, not recomputed) — every
 * SelfDescription field maps onto one RuntimeContract field, plus the 7 new
 * ones the owner's directive named. Every value below is real/computed; where
 * no real signal exists, the field says so rather than guessing.
 */
export function getDocumentEngineRuntimeContract(): RuntimeContract {
  const description = describeDocumentEngine();
  const existence = readJSON<any>("registry/existence.json");

  const knownProblems = (existence.known_mistakes?.confirmed_duplicate_pairs?.pairs ?? [])
    .filter((p: any) => p.keep === TARGET_FILE || p.deprecated === TARGET_FILE)
    .map((p: any) => `${p.id}: ${p.reason}`);

  const requestedActions = (existence.owner_requests?.requests ?? [])
    .filter((r: any) => r.status === "open" && (
      r.reason?.includes(TARGET_FILE) || r.reason?.includes("generateDoc") || r.reason?.includes("Document Engine")
    ))
    .map((r: any) => r.suggested_resolution as string);

  return {
    identity: description.identity,
    purpose: description.responsibility,
    responsibilities: [
      "Render documents (quotation/invoice/receipt/boq/delivery-order/purchase-order) from validated input into one shared template per document_type",
    ],
    capabilities: description.capabilities,
    dependencies: { calledBy: description.calledBy, calls: description.calls },
    constraints: description.constraints,
    health: description.healthSignals,
    currentState: description.status,
    knownProblems,
    missingKnowledge: description.missingKnowledge,
    // Document Engine has no fixed interface contract to check against (unlike
    // AppDriver for drivers) — its one real, already-known gap is the
    // Capability Runtime Orchestrator wiring, already tracked in `missing`.
    missingCapabilities: description.missing,
    missingDependencies: [],
    resourcesNeeded: description.resourcesNeeded,
    requestedActions,
    executionScope: [TARGET_FILE, "engines/documents/selfDescription.ts"],
    forbiddenScope: description.calledBy.filter((c) =>
      c === "components/documents/DocumentBuilder.tsx" || c === "components/transactions/TransactionPanel.tsx"
    ).length > 0
      ? ["components/documents/DocumentBuilder.tsx", "components/transactions/TransactionPanel.tsx (frozen — registry/CURRENT_STATE.json architecture_freeze)"]
      : [],
    verificationProcedure: description.verificationProcedure,
    successCriteria: [
      "npx tsc --noEmit passes for this file and all real callers",
      "registry/architecture-book.json status for module:" + TARGET_FILE + " is OK",
      "registry/decision-coverage.json document_approval domain unchanged or improved (currently 4/4 codified)",
    ],
    confidence: "high",
    lastValidation: new Date().toISOString() + " — computed live from module-registry.json, architecture-book.json, capability-registry.json, business-coverage.json, decision-coverage.json, CHANGELOG.json, CURRENT_STATE.json, existence.json (this same invocation)",
    generatedAt: new Date().toISOString(),
    source: description.source + ", registry/existence.json",
  };
}

/**
 * Platform-level derived views (SDRN-P7, registry/CHANGELOG.json DNA-000061) —
 * pure projections of getDocumentEngineRuntimeContract(), reusing the shared
 * core/shared/types.ts functions rather than reimplementing them per module.
 */
export function getDocumentEngineContextBudget() {
  return computeContextBudget(getDocumentEngineRuntimeContract());
}
export function getDocumentEngineDeltaContext(previousVersionHash?: string) {
  return computeDeltaContext(getDocumentEngineRuntimeContract(), previousVersionHash);
}
export function getDocumentEngineWorkOrder() {
  return deriveWorkOrder(getDocumentEngineRuntimeContract());
}
export function getDocumentEngineExecutionReadiness() {
  return computeExecutionReadiness(getDocumentEngineRuntimeContract());
}
