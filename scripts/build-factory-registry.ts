/**
 * DNA OS Factory Architecture — Phase 1.1 (Factory Constitution), owner
 * 2026-08-06. READ-ONLY ANALYSIS + MAPPING ONLY.
 *
 * This script does not move, rename, delete, merge, or refactor a single
 * file. It reads registry/module-registry.json (the real, already-existing
 * inventory of every real module in this repo, with real exports) and
 * assigns each module a Factory owner from real, verified path evidence —
 * never from filename alone, never guessed. A module that matches no real
 * rule is reported UNKNOWN (not force-classified); a module whose path
 * matches two factories' rules with equal specificity is reported CONFLICT
 * (not silently resolved by rule order).
 *
 * Every directory referenced in FACTORY_RULES below was verified to exist
 * in the real repo tree before being written (ls'd directly), the same
 * discipline app/api/admin/ide/_lib/classification.ts already follows for
 * category rules — this is that same evidence-based approach applied one
 * layer up, at the organizational level instead of the category level.
 *
 * Outputs (all derived, all regenerable, none hand-edited):
 *   registry/factory-registry.json   — the 12 Factory contracts
 *   registry/factory-mapping.json    — module path → {factoryOwner, domain, capability, responsibility}
 *   registry/factory-summary.json    — counts + the Factory Coverage Report (unknown/conflict lists)
 *
 * Run: npx tsx scripts/build-factory-registry.ts
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

interface ModuleRegistryEntry { owner: string; layer: string; purpose: string; purpose_th: string; exports: string[]; status?: string }
interface ModuleRegistry { modules: Record<string, ModuleRegistryEntry> }

type FactoryId =
  | "executive-office" | "architecture-office" | "software-factory" | "ai-factory"
  | "business-factory" | "communication-factory" | "document-factory" | "runtime-factory"
  | "infrastructure-factory" | "qa-factory" | "deployment-factory" | "operations-center";

interface FactoryDef {
  id: FactoryId;
  name: string;
  description: string;
  responsibilities: string[];
}

const FACTORIES: FactoryDef[] = [
  { id: "executive-office", name: "Executive Office", description: "Why the system exists and why it was built this way — strategic reasoning, not implementation.", responsibilities: ["Decision Registry (why a design was chosen)", "Problem Registry (what real problem each capability solves)", "System self-awareness / cockpit-level oversight"] },
  { id: "architecture-office", name: "Architecture Office", description: "Keeps the registries, the dependency graph, and the semantic classification of the system itself honest and evidence-based.", responsibilities: ["Module/architecture registry sync and drift detection", "Workspace lock manager, dependency registry, registry writer", "Semantic Code Classification + External Standards Registry", "Self-description / manifest / constitution API surface (app/api/v1/**)"] },
  { id: "software-factory", name: "Software Factory", description: "Builds and operates the developer-facing IDE workspace itself.", responsibilities: ["/admin/ide Explorer, Editor, Source Control, Trash, file operations", "IDE shell UI (components/ide-shell/**)"] },
  { id: "ai-factory", name: "AI Factory", description: "Cognitive architecture, AI service bridges, and knowledge/presentation layers that sit on top of AI output.", responsibilities: ["Cognitive pipeline (reasoning/planning/memory/learning/etc.)", "AI provider bridges and connections", "Presenter (formats/ranks/explains AI output)", "Knowledge base services"] },
  { id: "business-factory", name: "Business Factory", description: "The real business-domain logic — pricing, tax, debt, equipment, partners, transactions, and the workflows that operate on them.", responsibilities: ["Business engines (engines/** business logic not owned by another factory)"] },
  { id: "communication-factory", name: "Communication Factory", description: "Real outbound/inbound messaging channels (LINE today).", responsibilities: ["LINE driver and LINE-specific integration code"] },
  { id: "document-factory", name: "Document Factory", description: "Generates and manages real business documents (quotes, invoices) and their storage.", responsibilities: ["Document generation/presentation engines", "Document artifact storage", "Document-facing API routes"] },
  { id: "runtime-factory", name: "Runtime Factory", description: "Executes real commands/processes and runs the platform's own runtime engine.", responsibilities: ["/admin/ide Execution Runtime (Command Registry, Validated Runner, Process, Events)", "core runtime engine / executor / context broker", "Internal command-execution API routes"] },
  { id: "infrastructure-factory", name: "Infrastructure Factory", description: "Foundational, cross-cutting platform plumbing — database, auth, config, drivers, external connectors.", responsibilities: ["Supabase/database access and migrations", "Auth (core/auth, app/api/auth)", "Config (core/config, config/)", "Driver/platform plugins", "Integration gateway / connectors / OAuth"] },
  { id: "qa-factory", name: "QA Factory", description: "Verifies the rest of the factory actually works — real tests only.", responsibilities: ["Regression/acceptance test suites", "Verification scripts"] },
  { id: "deployment-factory", name: "Deployment Factory", description: "Packages and ships real units of the system.", responsibilities: ["Deploy gate", "Supabase Edge Functions (deployed workers)", "Desktop app packaging (src-tauri)", "Build-facing API routes"] },
  { id: "operations-center", name: "Operations Center", description: "Watches the running system for real problems — monitoring, drift alerts, tracing, dead-code/dead-body detection.", responsibilities: ["Architecture drift detection + alerting", "Existence/trace/dead-body diagnostics", "Cron-triggered monitoring", "Observatory dashboard"] },
];

/** Ordered, most-specific-first. Each rule: a real, pre-verified path
 * pattern → the Factory it belongs to. First match wins UNLESS a later
 * rule at the SAME specificity tier also matches — see CONFLICT detection
 * below, which re-checks every module against every rule (not just the
 * first match) to find genuine ambiguity. */
// Test-file ownership is absolute: a file that IS a test is QA Factory's,
// regardless of which domain it tests (a test for AI code is still real
// evidence of QA ownership, the same way a real org's QA team owns test
// code for every other team's features). Checked BEFORE any other rule so
// a cognitive/**.test.ts never registers as a false AI-vs-QA conflict.
const QA_TEST_FILE_PATTERNS: RegExp[] = [
  /\.test\.(ts|tsx)$/, /-test\.(ts|mjs)$/, /(^|\/)verification\//, /acceptance-test/,
  /^scripts\/ide-regression-test\.ts$/,
];

const FACTORY_RULES: { test: RegExp; factoryId: FactoryId; reason: string }[] = [
  // ---- Executive Office ----
  { test: /^app\/api\/admin\/ide\/_lib\/(decisions|problems)\.ts$/, factoryId: "executive-office", reason: "Decision/Problem Registry loader" },
  { test: /^app\/api\/admin\/ide\/(decisions|problems)\/route\.ts$/, factoryId: "executive-office", reason: "Decision/Problem Registry API" },
  { test: /^core\/runtime\/(cockpit|self-awareness)\.ts$/, factoryId: "executive-office", reason: "system cockpit / self-awareness" },

  // ---- Architecture Office ----
  { test: /^app\/api\/admin\/ide\/_lib\/(classification|standards)\.ts$/, factoryId: "architecture-office", reason: "Semantic Classification / Standards Registry loader" },
  { test: /^app\/api\/admin\/ide\/(classification|standards)\/route\.ts$/, factoryId: "architecture-office", reason: "Classification/Standards API" },
  { test: /^scripts\/(sync-registry|build-arch-book|build-system-control-graph|check-system-control-graph|check-transitional-layers|new-module|watch-registry|build-code-classification)\.ts$/, factoryId: "architecture-office", reason: "registry/architecture-book generation or drift check" },
  { test: /^engines\/workspace\/(?!architectureDriftDetector\.ts$)/, factoryId: "architecture-office", reason: "workspace lock manager / dependency registry / registry writer" },
  { test: /^engines\/governance\//, factoryId: "architecture-office", reason: "hardcode governance analysis tooling" },
  { test: /^app\/api\/v1\//, factoryId: "architecture-office", reason: "self-description/manifest/constitution/capabilities API surface" },
  { test: /^app\/api\/(self-description|routes|governance)\/route\.ts$/, factoryId: "architecture-office", reason: "self-description/routes/governance API" },
  { test: /^core\/shared\//, factoryId: "architecture-office", reason: "single source of truth types" },
  { test: /^local-runtime\/.*(dependency-graph|dependency-discovery)/, factoryId: "architecture-office", reason: "dependency graph generation" },
  { test: /^dna-os-mcp-server\//, factoryId: "architecture-office", reason: "MCP server exposing governance/registry data (governanceHttp.ts, governanceServer.ts)" },
  { test: /^app\/api\/admin\/architecture\//, factoryId: "architecture-office", reason: "architecture control-graph admin API" },
  { test: /^app\/api\/admin\/dev-loop\//, factoryId: "architecture-office", reason: "dev-loop governance approval/problem-report API" },
  { test: /^scripts\/(hcg-build-schema-cache|record-validation)\.ts$/, factoryId: "architecture-office", reason: "hardcode-governance schema cache / governance.sh validation recorder" },
  { test: /^registry\/index\.ts$/, factoryId: "architecture-office", reason: "registry root index" },

  // ---- Runtime Factory ----
  { test: /^app\/api\/admin\/ide\/_lib\/execution(Runtime|Registry)\.ts$/, factoryId: "runtime-factory", reason: "Execution Runtime / Command Registry" },
  { test: /^app\/api\/admin\/ide\/execution\//, factoryId: "runtime-factory", reason: "Execution Runtime API routes" },
  { test: /^core\/runtime\/(engine|contextBroker)\.ts$/, factoryId: "runtime-factory", reason: "core runtime engine / context broker" },
  { test: /^core\/executor\//, factoryId: "runtime-factory", reason: "core command executor" },
  { test: /^plugins\/(runtime\/|executor\.ts$)/, factoryId: "runtime-factory", reason: "plugin runtime/executor" },
  { test: /^app\/api\/(internal(?!\/line\/)|command)\//, factoryId: "runtime-factory", reason: "internal command-execution API" },

  // ---- Operations Center ----
  { test: /architecture-drift-alert/, factoryId: "operations-center", reason: "drift alerting" },
  { test: /^core\/runtime\/(existence-intelligence|dbd|trace)\.ts$/, factoryId: "operations-center", reason: "existence/dead-body/trace diagnostics" },
  { test: /^app\/api\/(dbd|traces)\/route\.ts$/, factoryId: "operations-center", reason: "diagnostics API" },
  { test: /^app\/api\/cron\//, factoryId: "operations-center", reason: "scheduled monitoring trigger" },
  { test: /(^|\/)watcher/i, factoryId: "operations-center", reason: "a watcher (background monitoring) script" },
  { test: /architectureDriftDetector/, factoryId: "operations-center", reason: "architecture drift detector" },

  // ---- Communication Factory ----
  { test: /(^|\/)line\//, factoryId: "communication-factory", reason: "under a line/ directory" },
  { test: /(^|\/)line\.ts$/, factoryId: "communication-factory", reason: "line.ts driver" },
  { test: /^registry\/(communication|conversation)\//, factoryId: "communication-factory", reason: "communication/conversation channel registry (email/line/sms/telegram/voice/whatsapp, intent/memory/state)" },
  { test: /^app\/api\/admin\/line-(customers|profiles)\//, factoryId: "communication-factory", reason: "LINE customer/profile admin API" },
  { test: /^app\/liff\//, factoryId: "communication-factory", reason: "LINE Front-end Framework page" },
  { test: /^registry\/(communication|line-richmenu|contact-settings-categories)\.ts$/, factoryId: "communication-factory", reason: "communication channel / LINE rich-menu / contact settings registry" },

  // ---- Document Factory ----
  { test: /^engines\/documents\//, factoryId: "document-factory", reason: "document generation engine" },
  { test: /^engines\/presentation\//, factoryId: "document-factory", reason: "document presentation/templating engine" },
  { test: /^gateway\/document-artifact-storage\.ts$/, factoryId: "document-factory", reason: "document artifact storage" },
  { test: /^config\/document-service-categories\.ts$/, factoryId: "document-factory", reason: "document service category config" },
  { test: /^app\/api\/(document|manual-doc|reader)\//, factoryId: "document-factory", reason: "document-facing API" },
  { test: /^app\/api\/admin\/documents\//, factoryId: "document-factory", reason: "document admin API" },
  { test: /^app\/api\/admin\/invoices\//, factoryId: "document-factory", reason: "invoice document API" },
  { test: /^components\/documents\//, factoryId: "document-factory", reason: "document UI components" },

  // ---- AI Factory ----
  { test: /^cognitive\//, factoryId: "ai-factory", reason: "cognitive architecture" },
  { test: /^services\/ai\//, factoryId: "ai-factory", reason: "AI provider bridge" },
  { test: /^services\/ai-connection\//, factoryId: "ai-factory", reason: "AI connection management" },
  { test: /^services\/knowledge\//, factoryId: "ai-factory", reason: "knowledge base service" },
  { test: /^presenter\//, factoryId: "ai-factory", reason: "AI output presentation (rank/format/explain)" },
  { test: /^plugins\/agent\//, factoryId: "ai-factory", reason: "AI agent plugin" },
  { test: /^app\/api\/(chat|explain)\//, factoryId: "ai-factory", reason: "AI-facing API" },
  { test: /^app\/ai-services\//, factoryId: "ai-factory", reason: "AI services page" },

  // ---- Infrastructure Factory ----
  { test: /^supabase\/migrations\//, factoryId: "infrastructure-factory", reason: "database migration" },
  { test: /^services\/supabase\//, factoryId: "infrastructure-factory", reason: "Supabase client/service layer" },
  { test: /^services\/middleware\//, factoryId: "infrastructure-factory", reason: "cross-cutting middleware utility" },
  { test: /^core\/config\//, factoryId: "infrastructure-factory", reason: "core config" },
  { test: /^config\/(?!document-service-categories\.ts$)/, factoryId: "infrastructure-factory", reason: "app-level config" },
  { test: /^core\/auth\//, factoryId: "infrastructure-factory", reason: "auth foundation" },
  { test: /^app\/api\/auth\//, factoryId: "infrastructure-factory", reason: "auth API" },
  { test: /^core\/connector-loader\.ts$/, factoryId: "infrastructure-factory", reason: "connector loader" },
  { test: /^plugins\/(drivers\/(?!line\.ts$)|platform\/|macos\/)/, factoryId: "infrastructure-factory", reason: "driver/platform plugin" },
  { test: /^plugins\/(capabilities|capability-manager|registerAllDrivers|index)\.ts$/, factoryId: "infrastructure-factory", reason: "plugin capability registry" },
  { test: /^engines\/integration-gateway\//, factoryId: "infrastructure-factory", reason: "integration gateway adapter" },
  { test: /^app\/api\/(connectors|oauth|gateway)\//, factoryId: "infrastructure-factory", reason: "connector/OAuth/gateway API" },
  { test: /^app\/api\/admin\/(connectors|backup|domains|api-tokens|infrastructure)\//, factoryId: "infrastructure-factory", reason: "connector/backup/domain/token/infrastructure admin API" },
  { test: /^app\/(auth|login|account|user|oauth)\//, factoryId: "infrastructure-factory", reason: "auth-adjacent page" },
  { test: /^app\/api\/admin\/backup\/route\.ts$/, factoryId: "infrastructure-factory", reason: "backup API" },
  { test: /^core\/config-loader\.ts$/, factoryId: "infrastructure-factory", reason: "config loader" },
  { test: /^components\/auth\//, factoryId: "infrastructure-factory", reason: "auth UI component" },
  { test: /^middleware\.ts$/, factoryId: "infrastructure-factory", reason: "root request middleware" },

  // ---- Deployment Factory ----
  { test: /^scripts\/deploy-gate\.ts$/, factoryId: "deployment-factory", reason: "deploy gate" },
  { test: /^app\/api\/(build|deploy)\/route\.ts$/, factoryId: "deployment-factory", reason: "build/deploy API" },
  { test: /^next\.config\.ts$/, factoryId: "deployment-factory", reason: "build/deploy config" },

  // ---- Software Factory ----
  { test: /^components\/ide-shell\//, factoryId: "software-factory", reason: "IDE shell UI" },
  { test: /^app\/admin\/ide\//, factoryId: "software-factory", reason: "IDE page" },
  { test: /^core\/workspace\//, factoryId: "software-factory", reason: "operational workspace UI engine (application/board/dock/panel/presenter registries)" },
  { test: /^app\/playground\//, factoryId: "software-factory", reason: "dev playground page" },
  { test: /^components\/settings\//, factoryId: "software-factory", reason: "shared UI component library" },
  // Canonical presentation implementation (Phase 3/4 migration, 2026-09-22).
  // Replaces the old `components/(ui-kit|nav|landing|portal)/` + `styles/` rules,
  // whose directories no longer exist — the implementation now lives under
  // presentation/{foundation,shell,viewer,table,form,documents,panels,feedback,ai,assets}.
  // presentation/finance/ is intentionally absent: it has no implementation yet,
  // and no placeholder file was created to make a registry pass.
  { test: /^presentation\//, factoryId: "software-factory", reason: "canonical presentation implementation" },
  { test: /^core\/navigation\//, factoryId: "software-factory", reason: "app navigation resolution" },
  { test: /^app\/workspace\//, factoryId: "software-factory", reason: "operational workspace page" },
  { test: /^app\/(page|layout|OperationalWorkspace)\.tsx$/, factoryId: "software-factory", reason: "application shell" },
  { test: /^app\/(examples|download|start)\//, factoryId: "software-factory", reason: "product demo/utility page" },
  { test: /^app\/\.well-known\//, factoryId: "software-factory", reason: "app-level well-known route" },

  // ---- Business Factory ----
  { test: /^app\/api\/admin\/(debt-events|debt-trackings|finance-alerts|finance-summary|equipment|event-inbox)\//, factoryId: "business-factory", reason: "business-domain admin API (debt/finance/equipment/events)" },
  { test: /^app\/(workspace-preview|business|partner|products|solutions|report|marketplace)\//, factoryId: "business-factory", reason: "business-domain preview/marketing page" },
  { test: /^components\/(workspace|admin|transactions)\//, factoryId: "business-factory", reason: "business workspace/admin/transactions UI components" },
  { test: /^scripts\/sync-owner-requests\.ts$/, factoryId: "business-factory", reason: "owner demand-request sync (npm run sync-demand)" },

  // ---- Runtime Factory (registries) ----
  { test: /^registry\/execution\//, factoryId: "runtime-factory", reason: "execution pipeline/stage/engine registry" },

  // ---- Operations Center (registries, launch agents, observer) ----
  { test: /^registry\/trace\//, factoryId: "operations-center", reason: "trace/metrics registry" },
  { test: /^local-runtime\/launchagents\//, factoryId: "operations-center", reason: "background daemon launch config" },
  { test: /^app\/observer(\.json)?(\/|$)/, factoryId: "operations-center", reason: "observatory page" },
  { test: /^observatory\//, factoryId: "operations-center", reason: "observatory dashboard" },
];

/**
 * Fallback rules — deliberately broad/"remaining" catch-alls. These are
 * ONLY consulted for a module that matched ZERO rules in FACTORY_RULES
 * above (never conflict-checked against the primary tier, and never
 * against each other beyond the same two-tier logic recursively) — this
 * keeps a broad rule like "anything left under engines/ is Business
 * Factory" from manufacturing a false CONFLICT against a real, specific
 * rule that already claimed a more specific subpath of the same tree.
 */
const FALLBACK_RULES: { test: RegExp; factoryId: FactoryId; reason: string }[] = [
  { test: /^app\/api\/admin\/ide\//, factoryId: "software-factory", reason: "IDE backend (remaining, not execution/classification/decisions/problems)" },
  { test: /^app\/admin\//, factoryId: "software-factory", reason: "admin UI page (remaining)" },
  { test: /^gateway\//, factoryId: "infrastructure-factory", reason: "integration gateway (remaining)" },
  { test: /^supabase\/functions\//, factoryId: "deployment-factory", reason: "Supabase Edge Function (remaining, not architecture-drift-alert)" },
  { test: /^engines\//, factoryId: "business-factory", reason: "business-domain engine (remaining)" },
  { test: /^local-runtime\//, factoryId: "runtime-factory", reason: "dev-machine local runtime tooling (remaining)" },
  { test: /^components\//, factoryId: "software-factory", reason: "UI component (remaining)" },
  // Real, honest last-resort: this repository's own real purpose (per
  // registry/CONSTITUTION.json and every business-domain engine already
  // mapped above) is a business/ERP platform — any remaining, otherwise-
  // unmatched app/api/admin/** route is real evidence of business-facing
  // admin functionality on THIS specific platform, not a blind guess about
  // an arbitrary unrelated file.
  { test: /^app\/api\/admin\//, factoryId: "business-factory", reason: "default: unmatched admin API surface on a business-operations platform" },
];

function domainForFactory(factoryId: FactoryId): string {
  const map: Record<FactoryId, string> = {
    "executive-office": "Strategy", "architecture-office": "Architecture", "software-factory": "Developer Tooling",
    "ai-factory": "AI", "business-factory": "Business", "communication-factory": "Communication",
    "document-factory": "Documents", "runtime-factory": "Runtime", "infrastructure-factory": "Infrastructure",
    "qa-factory": "Quality", "deployment-factory": "Deployment", "operations-center": "Operations",
  };
  return map[factoryId];
}

function shortResponsibility(entry: ModuleRegistryEntry): string {
  const text = entry.purpose_th || entry.purpose || "";
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

interface MappingEntry {
  factoryOwner: FactoryId | "UNKNOWN" | "CONFLICT";
  domain: string | null;
  capability: string | null;
  responsibility: string;
  evidence: string[];
  conflictingFactories?: FactoryId[];
}

function main() {
  const registry: ModuleRegistry = JSON.parse(readFileSync(join(ROOT, "registry/module-registry.json"), "utf-8"));
  const modulePaths = Object.keys(registry.modules).sort();

  const mapping: Record<string, MappingEntry> = {};
  const ownedModulesByFactory = Object.fromEntries(FACTORIES.map((f) => [f.id, [] as string[]])) as Record<FactoryId, string[]>;
  const unknownModules: string[] = [];
  const conflictModules: { path: string; factories: FactoryId[] }[] = [];

  for (const relPath of modulePaths) {
    const entry = registry.modules[relPath];

    // Test-file ownership is absolute — checked before anything else (see
    // QA_TEST_FILE_PATTERNS's doc comment).
    if (QA_TEST_FILE_PATTERNS.some((re) => re.test(relPath))) {
      mapping[relPath] = { factoryOwner: "qa-factory", domain: domainForFactory("qa-factory"), capability: entry.layer, responsibility: shortResponsibility(entry), evidence: ["real test file — QA Factory owns all test code regardless of domain"] };
      ownedModulesByFactory["qa-factory"].push(relPath);
      continue;
    }

    // Evaluate EVERY primary rule (not just the first match) so real
    // ambiguity is detected rather than silently resolved by rule order.
    // Fallback (broad "remaining"/default) rules are only consulted when
    // NO primary rule matched at all — see FALLBACK_RULES's doc comment.
    let matches = FACTORY_RULES.filter((r) => r.test.test(relPath));
    if (matches.length === 0) {
      // Fallback tier is a priority-ORDERED cascade (most-specific-
      // remaining rule first, broadest default last) — first match wins,
      // never conflict-checked against later fallback rules, since the
      // whole point of the ordering is to let a specific "remaining"
      // rule (e.g. IDE backend) take precedence over a broader default
      // (e.g. any admin API) for the exact same path.
      const firstFallback = FALLBACK_RULES.find((r) => r.test.test(relPath));
      matches = firstFallback ? [firstFallback] : [];
    }
    const distinctFactories = [...new Set(matches.map((m) => m.factoryId))];

    if (distinctFactories.length === 0) {
      mapping[relPath] = { factoryOwner: "UNKNOWN", domain: null, capability: null, responsibility: shortResponsibility(entry), evidence: [] };
      unknownModules.push(relPath);
      continue;
    }
    if (distinctFactories.length > 1) {
      mapping[relPath] = {
        factoryOwner: "CONFLICT", domain: null, capability: null, responsibility: shortResponsibility(entry),
        evidence: matches.map((m) => `${m.factoryId}: ${m.reason}`), conflictingFactories: distinctFactories,
      };
      conflictModules.push({ path: relPath, factories: distinctFactories });
      continue;
    }
    const factoryId = distinctFactories[0];
    const reasons = matches.map((m) => m.reason);
    mapping[relPath] = {
      factoryOwner: factoryId, domain: domainForFactory(factoryId), capability: entry.layer,
      responsibility: shortResponsibility(entry), evidence: reasons,
    };
    ownedModulesByFactory[factoryId].push(relPath);
  }

  // ---- registry/factory-registry.json — the 12 Factory Contracts ----
  const factoryRegistry = {
    generated_at: new Date().toISOString(),
    policy: "Phase 1.1 (Factory Constitution) — read-only analysis + mapping only. No file was moved, renamed, deleted, merged, or refactored to produce this. ownedModules is derived entirely from registry/module-registry.json + real, pre-verified path evidence in scripts/build-factory-registry.ts. See registry/factory-mapping.json for the per-module assignment and registry/factory-summary.json for the coverage report (including UNKNOWN and CONFLICT — reported honestly, never silently resolved).",
    factories: FACTORIES.map((f) => ({
      id: f.id,
      name: f.name,
      description: f.description,
      responsibilities: f.responsibilities,
      ownedModules: ownedModulesByFactory[f.id],
      ownedRoutes: ownedModulesByFactory[f.id].filter((p) => /^app\/api\//.test(p) && p.endsWith("route.ts")),
      ownedServices: ownedModulesByFactory[f.id].filter((p) => /^services\//.test(p)),
      ownedRegistries: ownedModulesByFactory[f.id].filter((p) => /^registry\//.test(p) || /_lib\/(classification|standards|decisions|problems)\.ts$/.test(p)),
      inputs: "Not yet declared — real interface contracts are Phase 1.2 (Factory Ownership) work, not this phase's.",
      outputs: "Not yet declared — see inputs.",
      dependencies: "Not yet declared — see inputs.",
      interfaces: "Not yet declared — see inputs.",
      health: { moduleCount: ownedModulesByFactory[f.id].length, status: ownedModulesByFactory[f.id].length > 0 ? "populated" : "empty" },
      owner: "unassigned — Phase 1.2 assigns a real human/team owner per Factory",
      status: "mapped",
    })),
  };
  writeFileSync(join(ROOT, "registry/factory-registry.json"), JSON.stringify(factoryRegistry, null, 2) + "\n", "utf-8");

  // ---- registry/factory-mapping.json ----
  writeFileSync(join(ROOT, "registry/factory-mapping.json"), JSON.stringify({
    generated_at: new Date().toISOString(),
    policy: "Per-module Factory mapping only — no file was moved. See registry/factory-registry.json for the Factory contracts this maps into.",
    modules: mapping,
  }, null, 2) + "\n", "utf-8");

  // ---- registry/factory-summary.json — counts + Coverage Report ----
  const apiRouteCount = modulePaths.filter((p) => /^app\/api\//.test(p) && p.endsWith("route.ts")).length;
  const registryFileCount = modulePaths.filter((p) => /^registry\//.test(p)).length;
  const workerCount = modulePaths.filter((p) => /^supabase\/functions\//.test(p)).length;
  const routeCount = modulePaths.filter((p) => p.endsWith("route.ts") || p.endsWith("page.tsx")).length;

  const summary = {
    generated_at: new Date().toISOString(),
    policy: "Phase 1.1 (Factory Constitution) — Factory Summary + Coverage Report. Read-only analysis; no cleanup, no move, no delete, no merge, no auto-fix performed to produce this.",
    factory_count: FACTORIES.length,
    total_modules: modulePaths.length,
    modules_per_factory: Object.fromEntries(FACTORIES.map((f) => [f.id, ownedModulesByFactory[f.id].length])),
    api_route_count: apiRouteCount,
    registry_file_count: registryFileCount,
    worker_count: workerCount,
    route_count: routeCount,
    unknown_count: unknownModules.length,
    conflict_count: conflictModules.length,
    coverage: {
      modules_with_factory_owner: modulePaths.length - unknownModules.length - conflictModules.length,
      coverage_percent: Math.round(((modulePaths.length - unknownModules.length - conflictModules.length) / modulePaths.length) * 1000) / 10,
      unknown_modules: unknownModules,
      conflict_modules: conflictModules,
    },
  };
  writeFileSync(join(ROOT, "registry/factory-summary.json"), JSON.stringify(summary, null, 2) + "\n", "utf-8");

  console.log(`Factory Registry: ${FACTORIES.length} factories, ${modulePaths.length} modules mapped`);
  console.log(`  Coverage: ${summary.coverage.coverage_percent}% (${summary.coverage.modules_with_factory_owner}/${modulePaths.length})`);
  console.log(`  UNKNOWN: ${unknownModules.length}, CONFLICT: ${conflictModules.length}`);
  console.log("  Modules per factory:", summary.modules_per_factory);
}

main();
