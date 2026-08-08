/**
 * Factory Completion — System Registry (owner, 2026-08-07, Software
 * Factory Step 10.5, Phase 1/2). Declares the ~30 real named systems this
 * audit covers. Every `sourceFiles`/`routes`/`registries` entry below was
 * verified by direct inspection across Steps 2–10.5 of this session to
 * exist in this real repo — never guessed. Status/evidence/completion are
 * NOT hardcoded here — factoryCompletionRuntime.ts computes them live
 * from these real pointers (Rule: no fabricated completion, see
 * governance rules 167+).
 */

export type FactoryLayer =
  | "ide" | "execution" | "queue" | "inspection" | "governance" | "artifact"
  | "review" | "test" | "build" | "release" | "registry" | "ui" | "runtime"
  | "observer" | "data" | "control";

export interface SystemDefinition {
  id: string;
  name: string;
  name_th: string;
  factoryOwner: string;
  layer: FactoryLayer;
  responsibility: string;
  sourceFiles: string[];
  routes: string[];
  registries: string[];
  testFiles: string[];
}

export const FACTORY_SYSTEM_REGISTRY: SystemDefinition[] = [
  {
    id: "IDE_FILE_RUNTIME", name: "IDE / File Runtime", name_th: "IDE และระบบไฟล์",
    factoryOwner: "ide", layer: "ide",
    responsibility: "Real, sandboxed file read/write/tree/search operations backing the IDE workspace.",
    sourceFiles: ["app/api/admin/ide/_lib/fsOps.ts", "app/api/admin/ide/_lib/fsSecurity.ts", "app/api/admin/ide/_lib/fileWrite.ts", "app/api/admin/ide/_lib/tree.ts", "app/api/admin/ide/_lib/search.ts"],
    routes: ["app/api/admin/ide/file/route.ts", "app/api/admin/ide/tree/route.ts", "app/api/admin/ide/search/route.ts"],
    registries: [], testFiles: ["scripts/ide-regression-test.ts"],
  },
  {
    id: "EXECUTION_RUNTIME", name: "Execution Runtime", name_th: "รันไทม์การประมวลผล",
    factoryOwner: "execution", layer: "execution",
    responsibility: "Real, bounded in-memory execution job store — the base runtime pattern all later pipelines (Queue/Inspection/Governance/Artifact...) reuse.",
    sourceFiles: ["app/api/admin/ide/_lib/executionRuntime.ts", "app/api/admin/ide/_lib/executionRegistry.ts"],
    routes: ["app/api/admin/ide/execution/run/route.ts"], registries: [], testFiles: [],
  },
  {
    id: "PRODUCTION_QUEUE", name: "Production Queue", name_th: "คิวการผลิต",
    factoryOwner: "queue", layer: "queue",
    responsibility: "Real job queue runtime mediating between Execution and downstream pipelines.",
    sourceFiles: ["app/api/admin/ide/_lib/queueRuntime.ts", "app/api/admin/ide/_lib/queueRegistry.ts"],
    routes: ["app/api/admin/ide/queue/jobs/route.ts"], registries: [], testFiles: [],
  },
  {
    id: "INSPECTION_PIPELINE", name: "Inspection Pipeline", name_th: "ไปป์ไลน์ตรวจสอบ",
    factoryOwner: "inspection", layer: "inspection",
    responsibility: "Real static inspection findings (governance/architecture/quality checks) surfaced as Problems.",
    sourceFiles: ["app/api/admin/ide/_lib/inspectionRuntime.ts", "app/api/admin/ide/_lib/inspectionRegistry.ts"],
    routes: ["app/api/admin/ide/inspection/list/route.ts"], registries: [], testFiles: [],
  },
  {
    id: "GOVERNANCE_RUNTIME", name: "Governance Runtime", name_th: "รันไทม์การกำกับดูแล",
    factoryOwner: "governance", layer: "governance",
    responsibility: "Real Constitution/Iron Rule coverage computation and enforcement classification.",
    sourceFiles: ["app/api/admin/ide/_lib/governanceRuntime.ts", "scripts/build-governance-summary.ts"],
    routes: ["app/api/admin/ide/governance/summary/route.ts"],
    registries: ["registry/CONSTITUTION.json", "registry/rule-coverage.json", "registry/governance-summary.json"],
    testFiles: ["scripts/governance-test.ts"],
  },
  {
    id: "ARTIFACT_PIPELINE", name: "Artifact Pipeline", name_th: "ไปป์ไลน์อาร์ติแฟกต์",
    factoryOwner: "artifact", layer: "artifact",
    responsibility: "The single real Artifact/Evidence Store every later pipeline (Review/Test/Build/Release) writes evidence into.",
    sourceFiles: ["app/api/admin/ide/_lib/artifactRuntime.ts", "app/api/admin/ide/_lib/artifactRegistry.ts"],
    routes: ["app/api/admin/ide/artifact/list/route.ts"], registries: [], testFiles: ["scripts/artifact-test.ts"],
  },
  {
    id: "EVIDENCE_WAREHOUSE", name: "Evidence Warehouse", name_th: "คลังหลักฐาน",
    factoryOwner: "artifact", layer: "artifact",
    responsibility: "The queryable surface over Artifact Pipeline evidence records (same real store, not a second store).",
    sourceFiles: ["app/api/admin/ide/_lib/artifactRuntime.ts"], routes: ["app/api/admin/ide/artifact/list/route.ts"],
    registries: [], testFiles: ["scripts/artifact-test.ts"],
  },
  {
    id: "SOURCE_CONTROL_READONLY", name: "Source Control (Read Only)", name_th: "ควบคุมซอร์สแบบอ่านอย่างเดียว",
    factoryOwner: "ide", layer: "ide",
    responsibility: "Real, read-only git status/diff/log access — Git Write is forbidden by Rule (Rule 103 family).",
    sourceFiles: ["app/api/admin/ide/_lib/gitReadOnly.ts"], routes: ["app/api/admin/ide/git/status/route.ts"],
    registries: [], testFiles: [],
  },
  {
    id: "UI_INSPECTION", name: "UI Inspection / Browser Design Intelligence", name_th: "ตรวจสอบ UI",
    factoryOwner: "inspection", layer: "inspection",
    responsibility: "Real, live browser-driven UI inspection capability (Step 6).",
    sourceFiles: ["app/api/admin/ide/_lib/uiInspectionCapability.ts", "app/api/admin/ide/_lib/browserInspectionRuntime.ts", "app/api/admin/ide/_lib/viewportRegistry.ts"],
    routes: ["app/api/admin/ide/ui-inspection/list/route.ts"], registries: [], testFiles: ["scripts/ui-inspection-test.ts"],
  },
  {
    id: "CODE_REVIEW", name: "Code Review Pipeline", name_th: "ไปป์ไลน์รีวิวโค้ด",
    factoryOwner: "review", layer: "review",
    responsibility: "Real Change Set assembly + review workflow (Step 7).",
    sourceFiles: ["app/api/admin/ide/_lib/changeSetRuntime.ts", "app/api/admin/ide/_lib/reviewRegistry.ts"],
    routes: ["app/api/admin/ide/review/change-sets/route.ts"], registries: [], testFiles: ["scripts/review-test.ts"],
  },
  {
    id: "TEST_PIPELINE", name: "Test Pipeline", name_th: "ไปป์ไลน์ทดสอบ",
    factoryOwner: "test", layer: "test",
    responsibility: "Real Test Run execution + Quality Assurance Runtime (Step 8).",
    sourceFiles: ["app/api/admin/ide/_lib/testRuntime.ts", "app/api/admin/ide/_lib/testRegistry.ts"],
    routes: ["app/api/admin/ide/test/runs/route.ts"], registries: [], testFiles: ["scripts/test-test.ts"],
  },
  {
    id: "BUILD_PIPELINE", name: "Build Pipeline", name_th: "ไปป์ไลน์บิลด์",
    factoryOwner: "build", layer: "build",
    responsibility: "Real, reproducible Build Run execution + Build Gate Integrity (Steps 9/9.5).",
    sourceFiles: ["app/api/admin/ide/_lib/buildRuntime.ts", "app/api/admin/ide/_lib/buildRegistry.ts"],
    routes: ["app/api/admin/ide/build/runs/route.ts"], registries: [], testFiles: ["scripts/build-test.ts", "scripts/build-gate-test.ts"],
  },
  {
    id: "RELEASE_PIPELINE", name: "Release Pipeline", name_th: "ไปป์ไลน์รีลีส",
    factoryOwner: "release", layer: "release",
    responsibility: "Real Release Candidate, Validation, Capability Packaging, Approval, Operational Readiness (Step 10).",
    sourceFiles: ["app/api/admin/ide/_lib/releaseRuntime.ts", "app/api/admin/ide/_lib/releaseRegistry.ts"],
    routes: ["app/api/admin/ide/release/runs/route.ts"], registries: [], testFiles: ["scripts/release-test.ts", "scripts/package-test.ts", "scripts/readiness-test.ts", "scripts/compatibility-test.ts", "scripts/country-test.ts", "scripts/document-lifecycle-test.ts"],
  },
  {
    id: "FACTORY_REGISTRY", name: "Factory Registry / Mapping", name_th: "ทะเบียนโรงงาน",
    factoryOwner: "registry", layer: "registry",
    responsibility: "Real Factory ownership contracts + module -> factory mapping.",
    sourceFiles: ["scripts/build-factory-registry.ts"],
    routes: [], registries: ["registry/factory-registry.json", "registry/factory-mapping.json", "registry/factory-summary.json"],
    testFiles: ["scripts/factory-registry-test.ts"],
  },
  {
    id: "MODULE_REGISTRY", name: "Module Registry", name_th: "ทะเบียนโมดูล",
    factoryOwner: "registry", layer: "registry",
    responsibility: "Real, auto-synced source module inventory (owner/layer/purpose/exports/status).",
    sourceFiles: ["scripts/sync-registry.ts"], routes: [], registries: ["registry/module-registry.json"],
    testFiles: ["scripts/registry-sync-regression-test.ts"],
  },
  {
    id: "CAPABILITY_REGISTRY", name: "Capability Registry", name_th: "ทะเบียนความสามารถ",
    factoryOwner: "registry", layer: "registry",
    responsibility: "The real, frozen, checksum-locked 202-capability registry — sole source for Capability Packaging.",
    sourceFiles: [], routes: [], registries: ["registry/capability-registry.json", "registry/capability-roadmap.json"], testFiles: [],
  },
  {
    id: "COMMAND_REGISTRY", name: "Command Registry", name_th: "ทะเบียนคำสั่ง",
    factoryOwner: "registry", layer: "registry",
    responsibility: "Real command inventory surfaced via System Control Graph.",
    sourceFiles: ["scripts/build-system-control-graph.ts"], routes: [], registries: ["registry/system-control-graph.json"], testFiles: [],
  },
  {
    id: "WORKFLOW_REGISTRY", name: "Workflow Registry", name_th: "ทะเบียนเวิร์กโฟลว์",
    factoryOwner: "registry", layer: "registry",
    responsibility: "Real workflow definitions — checked via System Control Summary's related_workflows fields.",
    sourceFiles: [], routes: [], registries: ["registry/system-control-summary.json"], testFiles: [],
  },
  {
    id: "ARCHITECTURE_BOOK", name: "Architecture Book", name_th: "หนังสือสถาปัตยกรรม",
    factoryOwner: "registry", layer: "registry",
    responsibility: "Real, generated whole-repo module dependency book (nodes/edges/status).",
    sourceFiles: ["scripts/build-arch-book.ts"], routes: [], registries: ["registry/architecture-book.json"], testFiles: [],
  },
  {
    id: "DEPENDENCY_GRAPH", name: "Dependency Graph", name_th: "กราฟการพึ่งพา",
    factoryOwner: "registry", layer: "control",
    responsibility: "Real internal_dependencies/dependents edges inside the Architecture Book.",
    sourceFiles: ["scripts/build-arch-book.ts"], routes: [], registries: ["registry/architecture-book.json"], testFiles: [],
  },
  {
    id: "SYSTEM_CONTROL_GRAPH", name: "System Control Graph", name_th: "กราฟควบคุมระบบ",
    factoryOwner: "registry", layer: "control",
    responsibility: "Real, generated 1332-node/3411-edge control graph (modules/layers/commands/events/capabilities/services/drivers).",
    sourceFiles: ["scripts/build-system-control-graph.ts", "scripts/check-system-control-graph.ts"],
    routes: [], registries: ["registry/system-control-graph.json", "registry/system-control-summary.json"], testFiles: [],
  },
  {
    id: "DECISION_REGISTRY", name: "Decision Registry", name_th: "ทะเบียนการตัดสินใจ",
    factoryOwner: "governance", layer: "governance",
    responsibility: "Real decision log surface.",
    sourceFiles: ["app/api/admin/ide/_lib/decisions.ts"], routes: ["app/api/admin/ide/decisions/route.ts"], registries: [], testFiles: [],
  },
  {
    id: "PROBLEM_REGISTRY", name: "Problem Registry / Problems Panel", name_th: "ทะเบียนปัญหา",
    factoryOwner: "inspection", layer: "inspection",
    responsibility: "Real, live Problems Panel aggregating findings across pipelines.",
    sourceFiles: ["app/api/admin/ide/_lib/problems.ts"], routes: ["app/api/admin/ide/problems/route.ts"], registries: [], testFiles: [],
  },
  {
    id: "STORAGE_INTELLIGENCE", name: "Storage Intelligence", name_th: "ระบบเก็บข้อมูลอัจฉริยะ",
    factoryOwner: "runtime", layer: "runtime",
    responsibility: "Real local-runtime disk/storage threshold monitoring.",
    sourceFiles: ["local-runtime/storage-threshold-watcher.ts", "local-runtime/storage-smoke-test.ts"], routes: [], registries: [], testFiles: [],
  },
  {
    id: "WORKSPACE_LOCK_MIGRATION", name: "Workspace Lock / Migration", name_th: "การล็อก/ย้ายพื้นที่ทำงาน",
    factoryOwner: "runtime", layer: "runtime",
    responsibility: "Real WORKSPACE_ROOT resolution/verification across local-runtime modules.",
    sourceFiles: ["local-runtime/workspace-root-verifier-acceptance-test.ts", "local-runtime/workspace-acceptance-test.ts"], routes: [], registries: [], testFiles: [],
  },
  {
    id: "INFRASTRUCTURE_OBSERVER", name: "Infrastructure Observer", name_th: "ระบบสังเกตการณ์โครงสร้างพื้นฐาน",
    factoryOwner: "observer", layer: "observer",
    responsibility: "Real infrastructure/service inventory + cost summary.",
    sourceFiles: ["scripts/gateway-observe-supabase.ts"], routes: [], registries: ["registry/infrastructure.json"], testFiles: [],
  },
  {
    id: "COST_SUBSCRIPTION_OBSERVER", name: "Cost / Subscription Observer", name_th: "ระบบสังเกตการณ์ต้นทุน/สมาชิก",
    factoryOwner: "observer", layer: "observer",
    responsibility: "Real cost_summary field inside infrastructure.json — no dedicated cost engine confirmed elsewhere.",
    sourceFiles: [], routes: [], registries: ["registry/infrastructure.json"], testFiles: [],
  },
  {
    id: "DATABASE_WORKSPACE", name: "Database Workspace", name_th: "พื้นที่ทำงานฐานข้อมูล",
    factoryOwner: "data", layer: "data",
    responsibility: "Real Supabase migrations directory — the real schema source of truth.",
    sourceFiles: [], routes: [], registries: [], testFiles: [],
  },
  {
    id: "RUNTIME_DEV_LOOP", name: "Runtime / Dev Loop", name_th: "ลูปการพัฒนา",
    factoryOwner: "runtime", layer: "runtime",
    responsibility: "Real dev-loop voice-alert / problem-report-trigger verification scripts.",
    sourceFiles: ["scripts/verification/dev-loop-voice-alert.test.ts", "scripts/verification/problem-report-trigger.test.ts"], routes: [], registries: [], testFiles: [],
  },
  {
    id: "INTEGRATION_CONNECTOR_LIFECYCLE", name: "Integration / Connector Lifecycle", name_th: "วงจรชีวิตตัวเชื่อมต่อ",
    factoryOwner: "runtime", layer: "runtime",
    responsibility: "Real Supabase Edge Function connectors (LINE/bank/KIS/billing/etc.) — real external integration surface.",
    sourceFiles: [
      "supabase/functions/line-webhook-v2/index.ts", "supabase/functions/bank-email-sync/index.ts",
      "supabase/functions/kis-webhook/index.ts", "supabase/functions/bank-statement-reconcile/index.ts",
      "supabase/functions/supabase-billing-sync/index.ts",
    ],
    routes: [], registries: ["registry/system-control-summary.json"], testFiles: [],
  },
  {
    id: "OWNER_CONTROL_SURFACES", name: "Owner Control Surfaces", name_th: "พื้นผิวควบคุมของเจ้าของ",
    factoryOwner: "ui", layer: "ui",
    responsibility: "Real /admin/ide IDE Workspace shell — the single owner entry point this whole audit evaluates readiness of.",
    sourceFiles: ["components/ide-shell/IDEWorkspace.tsx"], routes: ["app/admin/ide/page.tsx"], registries: [], testFiles: ["scripts/ide-regression-test.ts"],
  },
  {
    id: "MONITORING_RUNTIME", name: "Monitoring Runtime", name_th: "รันไทม์เฝ้าระวัง",
    factoryOwner: "observer", layer: "observer",
    responsibility: "Real, observe-only Signal collection (Step 12) across 18 real Signal Types — never mutates production, never guesses HEALTHY.",
    sourceFiles: ["app/api/admin/ide/_lib/monitoringRuntime.ts", "app/api/admin/ide/_lib/monitoringRegistry.ts"],
    routes: ["app/api/admin/ide/operations/monitoring/summary/route.ts"], registries: [], testFiles: ["scripts/monitoring-test.ts"],
  },
  {
    id: "INCIDENT_RUNTIME", name: "Incident Runtime", name_th: "รันไทม์เหตุการณ์",
    factoryOwner: "observer", layer: "observer",
    responsibility: "Real Incident opening/correlation/timeline from real Monitoring findings only (Step 12) — never auto-closed, never a guessed root cause.",
    sourceFiles: ["app/api/admin/ide/_lib/incidentRuntime.ts", "app/api/admin/ide/_lib/incidentRegistry.ts"],
    routes: ["app/api/admin/ide/operations/incidents/route.ts"], registries: [], testFiles: ["scripts/incident-test.ts"],
  },
  {
    id: "RECOVERY_RUNTIME", name: "Recovery Runtime", name_th: "รันไทม์การกู้คืน",
    factoryOwner: "observer", layer: "observer",
    responsibility: "Real Recovery Plan + real, evidence-based Verification only (Step 12) — plans and verifies, never executes a real mutation.",
    sourceFiles: ["app/api/admin/ide/_lib/recoveryRuntime.ts", "app/api/admin/ide/_lib/recoveryRegistry.ts"],
    routes: ["app/api/admin/ide/operations/recovery/plans/route.ts"], registries: [], testFiles: ["scripts/recovery-test.ts"],
  },
  {
    id: "CONTINUOUS_OPERATIONS_RUNTIME", name: "Continuous Operations Runtime", name_th: "รันไทม์การดำเนินงานต่อเนื่อง",
    factoryOwner: "observer", layer: "observer",
    responsibility: "Real Operations Loop (Step 12.5) tying Monitoring/Incident/Alert/Backup together — real manual-trigger execution + a real, declarative Vercel Cron Scheduler Contract (adapter unverified this Step, no real deploy occurs).",
    sourceFiles: ["app/api/admin/ide/_lib/continuousOperationsRuntime.ts", "app/api/admin/ide/_lib/continuousOperationsRegistry.ts"],
    routes: ["app/api/admin/ide/operations/loop/run/route.ts", "app/api/cron/operations-loop/route.ts"], registries: [], testFiles: ["scripts/continuous-operations-test.ts"],
  },
  {
    id: "ALERT_RUNTIME", name: "Alert Runtime", name_th: "รันไทม์การแจ้งเตือน",
    factoryOwner: "observer", layer: "observer",
    responsibility: "Real, deterministic Alert dispatch from real Incidents only (Step 12.5) — reuses the real, single LINE gateway; DISPATCHED never implies DELIVERED (no real delivery receipt exists).",
    sourceFiles: ["app/api/admin/ide/_lib/alertRuntime.ts", "app/api/admin/ide/_lib/alertRegistry.ts"],
    routes: ["app/api/admin/ide/operations/alerts/route.ts"], registries: [], testFiles: ["scripts/alerting-test.ts"],
  },
  {
    id: "BACKUP_RESTORE_RUNTIME", name: "Backup & Restore Test Runtime", name_th: "รันไทม์สำรองข้อมูลและทดสอบกู้คืน",
    factoryOwner: "observer", layer: "observer",
    responsibility: "Real backup discovery + deterministic integrity verification, plus a real dry-run Restore Test (Step 12.5) — restore verification stays honestly PLAN_ONLY, no isolated database target exists in this environment.",
    sourceFiles: ["app/api/admin/ide/_lib/backupRuntime.ts", "app/api/admin/ide/_lib/backupRegistry.ts", "app/api/admin/ide/_lib/restoreTestRuntime.ts", "app/api/admin/ide/_lib/restoreTestRegistry.ts"],
    routes: ["app/api/admin/ide/operations/backups/route.ts", "app/api/admin/ide/operations/restore-tests/route.ts"], registries: [], testFiles: ["scripts/backup-integrity-test.ts", "scripts/restore-test-test.ts"],
  },
  {
    id: "FACTORY_WORKSPACE", name: "Factory Workspace", name_th: "พื้นที่ทำงานโรงงาน",
    factoryOwner: "ide", layer: "ide",
    responsibility: "Real, central Workspace Session orchestrator (Step 13) tying Intent/Capability/Context/Worker/Execution/Change Set/Review/Test/Build/Release into one, real, Owner-trackable flow — the single point the Owner starts and tracks work from.",
    sourceFiles: ["app/api/admin/ide/_lib/factoryWorkspaceRuntime.ts"],
    routes: ["app/api/admin/ide/factory-workspace/sessions/route.ts"], registries: [], testFiles: ["scripts/factory-workspace-test.ts"],
  },
  {
    id: "INTENT_RUNTIME", name: "Intent Intake Runtime", name_th: "รันไทม์รับเจตนา",
    factoryOwner: "ide", layer: "ide",
    responsibility: "Real, structured Intent capture (Step 13) — never a raw prompt treated as ground truth; AI-proposed splits stay AI_PROPOSED until the Owner or a deterministic validator confirms them.",
    sourceFiles: ["app/api/admin/ide/_lib/intentRuntime.ts"],
    routes: ["app/api/admin/ide/factory-workspace/sessions/[id]/intent/route.ts"], registries: [], testFiles: ["scripts/factory-workspace-test.ts"],
  },
  {
    id: "CAPABILITY_RESOLVER", name: "Capability Resolver", name_th: "ตัวแก้ปัญหาความสามารถ",
    factoryOwner: "registry", layer: "registry",
    responsibility: "Real, deterministic search against the real, frozen 202-capability registry (Step 13) — never a name-only match, never invents a new Capability automatically.",
    sourceFiles: ["app/api/admin/ide/_lib/capabilityResolverRuntime.ts"],
    routes: ["app/api/admin/ide/factory-workspace/sessions/[id]/resolve-capabilities/route.ts", "app/api/admin/ide/factory-workspace/capabilities/search/route.ts"],
    registries: ["registry/capability-registry.json"], testFiles: ["scripts/capability-resolver-test.ts"],
  },
  {
    id: "CONTEXT_PLANNER", name: "Context Planner", name_th: "ตัววางแผนบริบท",
    factoryOwner: "ide", layer: "ide",
    responsibility: "Real, minimal-scope Context Plan construction (Step 13) — reuses fsSecurity.ts's real exclusion rules and registry/architecture-book.json's real dependency edges; never sends the whole repo.",
    sourceFiles: ["app/api/admin/ide/_lib/contextPlannerRuntime.ts"],
    routes: ["app/api/admin/ide/factory-workspace/sessions/[id]/prepare-context/route.ts"], registries: [], testFiles: ["scripts/context-planner-test.ts"],
  },
  {
    id: "AI_CONTEXT_RUNTIME", name: "AI Context Runtime", name_th: "รันไทม์บริบทเอไอ",
    factoryOwner: "ide", layer: "ide",
    responsibility: "Real, provider-neutral Context Package builder (Step 13) between DNA OS and any AI Worker — the real Context Fingerprint is keyed to workspaceSessionId so Context A can never flow into Context B.",
    sourceFiles: ["app/api/admin/ide/_lib/aiContextRuntime.ts"],
    routes: ["app/api/admin/ide/factory-workspace/sessions/[id]/execute/route.ts"], registries: [], testFiles: ["scripts/ai-context-test.ts"],
  },
  {
    id: "WORKER_REGISTRY", name: "Worker Registry", name_th: "ทะเบียนผู้ปฏิบัติงาน",
    factoryOwner: "ide", layer: "ide",
    responsibility: "Real declaration of the 10 real Worker Types (Step 13) with honest status (ACTIVE/PARTIAL/COMPATIBILITY_ONLY/NOT_IMPLEMENTED) — never hardcodes Claude/OpenAI/Gemini as a permanent primary Worker.",
    sourceFiles: ["app/api/admin/ide/_lib/workerRegistry.ts"],
    routes: ["app/api/admin/ide/factory-workspace/workers/route.ts"], registries: [], testFiles: ["scripts/worker-assignment-test.ts"],
  },
  {
    id: "EXECUTION_PLANNER", name: "Execution Planner", name_th: "ตัววางแผนการดำเนินการ",
    factoryOwner: "ide", layer: "ide",
    responsibility: "Real, ordered Execution Plan builder (Step 13) from Intent -> Capability Resolution -> Context Plan -> Worker Assignment; EXTERNAL_MUTATION is always BLOCKED this Step.",
    sourceFiles: ["app/api/admin/ide/_lib/executionPlanRuntime.ts"],
    routes: ["app/api/admin/ide/factory-workspace/sessions/[id]/create-plan/route.ts", "app/api/admin/ide/factory-workspace/sessions/[id]/approve-plan/route.ts"],
    registries: [], testFiles: ["scripts/native-factory-flow-test.ts"],
  },
  {
    id: "CODE_WORKER_RUNTIME", name: "Code Worker Runtime", name_th: "รันไทม์ผู้ปฏิบัติงานเขียนโค้ด",
    factoryOwner: "ide", layer: "ide",
    responsibility: "Real, provider-neutral bridge (Step 13.5) letting DNA OS invoke CODE_WORKER programmatically via services/ai/gateway.ts's real code.generate capability — capped at one real call per Execution Step, always requiring a separate real Owner approval before any file is written; honestly PARTIAL in this environment (no real ANTHROPIC_API_KEY configured).",
    sourceFiles: ["app/api/admin/ide/_lib/codeWorkerRuntime.ts"],
    routes: ["app/api/admin/ide/factory-workspace/sessions/[id]/generate-proposal/route.ts", "app/api/admin/ide/factory-workspace/sessions/[id]/approve-proposal/route.ts"],
    registries: [], testFiles: ["scripts/code-worker-test.ts"],
  },
];
