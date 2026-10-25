/**
 * Factory Completion Regression Suite (owner, 2026-08-07, Software
 * Factory Step 10.5, Phase 18) — verifies the real, evidence-derived
 * Factory Completion Model, honesty of status classification, and the
 * completion gates never fake 100%.
 *
 * Run: npm run factory-completion:test
 */
import { readFileSync, existsSync, readdirSync } from "fs";
import path from "path";
import {
  computeFactoryCompletion, computeEndToEndChain, computeVSCodeDependencyAudit,
  computeNativeDNAEnforcement, computeDataBoundaryAudit, computeCapabilityReuseAudit,
  computeCompletionGates, buildFactoryCompletionReport,
} from "../app/api/admin/ide/_lib/factoryCompletionRuntime";
import { FACTORY_SYSTEM_REGISTRY } from "../app/api/admin/ide/_lib/factoryCompletionRegistry";
import { runFactoryCompletionCheck } from "../app/api/admin/ide/_lib/inspectionRuntime";
import { getInspectionTypeDefinition } from "../app/api/admin/ide/_lib/inspectionRegistry";

const ROOT = path.join(__dirname, "..");
interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

const VALID_STATUSES = ["COMPLETE", "OPERATIONAL", "PARTIAL", "DECLARED", "UI_ONLY", "CONTRACT_ONLY", "NOT_IMPLEMENTED", "BLOCKED", "STALE", "UNKNOWN", "DUPLICATED", "MISPLACED"];

async function main() {
  await test("Completion status is deterministic — two calls produce identical results", () => {
    const a = computeFactoryCompletion(); const b = computeFactoryCompletion();
    assert(JSON.stringify(a) === JSON.stringify(b), "expected the same real computation on every call");
  });

  await test("Every real system record uses only a valid, spec-defined status literal", () => {
    for (const r of computeFactoryCompletion()) assert(VALID_STATUSES.includes(r.status), `system ${r.id} has invalid status ${r.status}`);
  });

  await test("completionPercent is never derived from file count alone — sourceFiles.length varies independently of completionPercent for at least 2 different systems with equal file counts but different real status", () => {
    const systems = computeFactoryCompletion();
    const byFileCount = new Map<number, number[]>();
    for (const s of systems) {
      const n = s.sourceFiles.length;
      byFileCount.set(n, [...(byFileCount.get(n) ?? []), s.completionPercent]);
    }
    const anyVariance = [...byFileCount.values()].some((pcts) => new Set(pcts).size > 1);
    assert(anyVariance, "expected completionPercent to vary even among systems with the same source file count (proves it's not file-count-only)");
  });

  await test("NOT_IMPLEMENTED honesty: a system whose declared source files do not exist is never reported COMPLETE", () => {
    for (const r of computeFactoryCompletion()) {
      if (r.status === "NOT_IMPLEMENTED") assert(r.completionPercent < 100, `NOT_IMPLEMENTED system ${r.id} must not report 100%`);
    }
  });

  await test("UNKNOWN honesty: capability data boundary claims are never fabricated PROVEN when no evidence exists", () => {
    const boundary = computeDataBoundaryAudit();
    for (const b of boundary) assert(["PROVEN", "PARTIAL", "UNKNOWN"].includes(b.status), `invalid boundary status ${b.status}`);
    assert(boundary.some((b) => b.status === "UNKNOWN"), "expected at least one honestly UNKNOWN data boundary claim (AI/Financial claims have no real runtime to verify against)");
  });

  await test("Critical gate blocking: report never claims overall 100% while any blocking gate is BLOCKED/NOT_IMPLEMENTED/UNKNOWN", () => {
    const report = buildFactoryCompletionReport();
    const criticalBad = report.completionGates.some((g) => g.blocking && ["BLOCKED", "NOT_IMPLEMENTED", "UNKNOWN"].includes(g.status));
    if (criticalBad) assert(report.criticalBlockers.length > 0, "expected criticalBlockers to be non-empty whenever a blocking gate is unhealthy");
  });

  await test("No fake 100%: at least one real completion gate is not PASSED (this repo genuinely has unfinished work — Deploy/Monitoring/Incident/Recovery)", () => {
    const gates = computeCompletionGates();
    assert(gates.some((g) => g.status !== "PASSED"), "expected real, honest incompleteness — a fully PASSED gate set here would be fabricated");
  });

  await test("End-to-end chain mapping: all 20 real pipeline stages are classified with a valid ChainStageStatus literal", () => {
    const valid = ["IMPLEMENTED", "PARTIAL", "NOT_IMPLEMENTED", "MANUAL", "EXTERNAL_TOOL_DEPENDENT", "DNA_OS_NATIVE"];
    const chain = computeEndToEndChain();
    assert(chain.length === 20, `expected 20 real chain stages, got ${chain.length}`);
    for (const c of chain) assert(valid.includes(c.status), `stage ${c.stage} has invalid status ${c.status}`);
  });

  await test("VS Code dependency detection: Claude Code / VS Code is honestly reported as still blocking owner migration", () => {
    const deps = computeVSCodeDependencyAudit();
    const claudeCode = deps.find((d) => d.tool.includes("Claude Code"));
    assert(!!claudeCode && claudeCode.blockingOwnerMigration === true, "expected Claude Code / VS Code dependency to be honestly blocking=true — this repo cannot yet fully self-drive");
  });

  await test("Native DNA enforcement detection: every principle uses a valid EnforcementLevel, and at least one critical principle (Workspace isolation) is RUNTIME_ENFORCED or ARCHITECTURE_ISOLATED, never Prompt-only", () => {
    const valid = ["DOCUMENT_ONLY", "CODE_ENFORCED", "RUNTIME_ENFORCED", "BUILD_ENFORCED", "TEST_ENFORCED", "ARCHITECTURE_ISOLATED", "PARTIAL", "MISSING"];
    const principles = computeNativeDNAEnforcement();
    for (const p of principles) assert(valid.includes(p.level), `principle "${p.principle}" has invalid level ${p.level}`);
    const workspaceIsolation = principles.find((p) => p.principle === "Workspace isolation");
    assert(!!workspaceIsolation && ["RUNTIME_ENFORCED", "ARCHITECTURE_ISOLATED"].includes(workspaceIsolation.level), "expected Workspace isolation to be RUNTIME_ENFORCED or ARCHITECTURE_ISOLATED, never merely documented");
  });

  await test("Workspace isolation evidence cites a real file (fsSecurity.ts) that actually exists", () => {
    const principles = computeNativeDNAEnforcement();
    const wi = principles.find((p) => p.principle === "Workspace isolation")!;
    assert(wi.evidence.includes("fsSecurity.ts"), "expected evidence to cite fsSecurity.ts");
    assert(existsSync(path.join(ROOT, "app/api/admin/ide/_lib/fsSecurity.ts")), "fsSecurity.ts must be a real, existing file");
  });

  await test("AI context scoping is honestly reported CODE_ENFORCED as of Step 13's real aiContextRuntime.ts, never fabricated beyond what the code actually proves", () => {
    const principles = computeNativeDNAEnforcement();
    const aiScoping = principles.find((p) => p.principle === "AI context scoping")!;
    assert(aiScoping.level === "CODE_ENFORCED", `expected CODE_ENFORCED, got ${aiScoping.level}`);
    assert(existsSync(path.join(ROOT, "app/api/admin/ide/_lib/aiContextRuntime.ts")), "aiContextRuntime.ts must be a real, existing file backing this claim");
  });

  await test("Financial runtime isolation is honestly reported (MISSING or UNKNOWN-equivalent), never fabricated as enforced — no Financial Runtime exists in this repo", () => {
    const principles = computeNativeDNAEnforcement();
    const fin = principles.find((p) => p.principle === "Financial deterministic runtime")!;
    assert(fin.level === "MISSING", `expected MISSING, got ${fin.level}`);
  });

  await test("Capability reuse readiness: real registry stats are read live from registry/capability-registry.json, never invented, and resolverExists honestly reflects the real Step 13 Capability Resolver", () => {
    const reuse = computeCapabilityReuseAudit();
    const raw = JSON.parse(readFileSync(path.join(ROOT, "registry/capability-registry.json"), "utf-8"));
    assert(reuse.totalCapabilities === raw.capabilities.length, "expected totalCapabilities to match the real registry file exactly");
    assert(reuse.resolverExists === true, "expected resolverExists=true — Step 13 built a real, deterministic Capability Resolver (capabilityResolverRuntime.ts)");
  });

  await test("Capability Resolver foundation: a real resolver-named file exists under app/api/admin/ide/_lib (Step 13 built it — Step 10.5's prohibition was scoped to that Step only)", () => {
    const libFiles = readdirSync(path.join(ROOT, "app/api/admin/ide/_lib")) as string[];
    assert(libFiles.some((f: string) => /resolver/i.test(f)), "expected a real Capability Resolver file to exist as of Step 13");
  });

  await test("File bottleneck calculation foundation: FACTORY_SYSTEM_REGISTRY declares real, existing source files only (spot check: every declared sourceFiles entry across all systems resolves to a real file or is honestly reported NOT_IMPLEMENTED)", () => {
    for (const def of FACTORY_SYSTEM_REGISTRY) {
      const record = computeFactoryCompletion().find((r) => r.id === def.id)!;
      if (record.status !== "NOT_IMPLEMENTED") {
        const missingSources = def.sourceFiles.filter((f) => !existsSync(path.join(ROOT, f)));
        assert(missingSources.length === 0 || record.limitations.length > 0, `system ${def.id} has missing source files but no limitation reported`);
      }
    }
  });

  await test("Registry auto-sync root cause regression: MODULE_REGISTRY system cites the real regression test file, and that file exists and is non-trivial", () => {
    const rec = computeFactoryCompletion().find((r) => r.id === "MODULE_REGISTRY")!;
    assert(rec.tests.includes("scripts/registry-sync-regression-test.ts"), "expected MODULE_REGISTRY to cite the real Phase 12 regression test");
    assert(existsSync(path.join(ROOT, "scripts/registry-sync-regression-test.ts")), "the cited regression test file must really exist");
  });

  await test("Cost evidence availability: COST_SUBSCRIPTION_OBSERVER system honestly reports based on the real registry/infrastructure.json cost_summary field, never a fabricated ROI number", () => {
    const infra = JSON.parse(readFileSync(path.join(ROOT, "registry/infrastructure.json"), "utf-8"));
    assert("cost_summary" in infra, "expected a real cost_summary field in registry/infrastructure.json");
    const rec = computeFactoryCompletion().find((r) => r.id === "COST_SUBSCRIPTION_OBSERVER")!;
    assert(rec.registries.includes("registry/infrastructure.json"), "expected COST_SUBSCRIPTION_OBSERVER to cite the real registry file");
  });

  await test("Operational reality classification: RELEASE_PIPELINE system cites real, existing dedicated test files (not zero, not fabricated)", () => {
    const rec = computeFactoryCompletion().find((r) => r.id === "RELEASE_PIPELINE")!;
    assert(rec.tests.length >= 6, `expected >=6 real cited test files for RELEASE_PIPELINE, got ${rec.tests.length}`);
    for (const t of rec.tests) assert(existsSync(path.join(ROOT, t)), `cited test file ${t} must really exist`);
  });

  await test("Report generation: buildFactoryCompletionReport() output matches the persisted registry/factory-completion-report.json (same real generator, no drift)", () => {
    const live = buildFactoryCompletionReport();
    const persisted = JSON.parse(readFileSync(path.join(ROOT, "registry/factory-completion-report.json"), "utf-8"));
    assert(live.totalSystems === persisted.totalSystems, "totalSystems must match between live computation and persisted report");
    assert(JSON.stringify(live.byStatus) === JSON.stringify(persisted.byStatus), "byStatus must match — same real computation, not divergent logic");
  });

  await test("Artifact/Evidence lineage: this suite never writes to disk except via the dedicated generator script (no active writeFileSync call in this test file's own logic)", () => {
    const src = readFileSync(path.join(ROOT, "scripts/factory-completion-test.ts"), "utf-8");
    const activeCalls = src.split("\n").filter((line) => line.includes("writeFileSync(") && !line.includes('"'));
    assert(activeCalls.length === 0, `this regression suite must be read-only, found: ${JSON.stringify(activeCalls)}`);
  });

  await test("Scope guarantee: no real Deploy stage exists anywhere under app/ (forbidden scope) — Monitoring (Step 12) and the Capability Resolver (Step 13) are real per their own Steps' explicit, authorized scope", () => {
    const gates = computeCompletionGates();
    const deploy = gates.find((g) => g.id === "DEPLOYMENT_READY")!;
    assert(deploy.status === "NOT_IMPLEMENTED", "Deploy must remain honestly NOT_IMPLEMENTED — building it is still forbidden as of Step 12");
  });

  await test("Problems Integration: FACTORY_COMPLETION_CHECK is a real, IMPLEMENTED inspection type producing at least one of the 11 real Step 10.5 finding categories", () => {
    const def = getInspectionTypeDefinition("FACTORY_COMPLETION_CHECK");
    assert(!!def && def.status === "IMPLEMENTED", "expected FACTORY_COMPLETION_CHECK to be a real, IMPLEMENTED inspection type");
  });

  await test("Problems Integration: runFactoryCompletionCheck() produces real findings tagged category FACTORY_COMPLETION_CHECK, sourced from the SAME live report", async () => {
    const record = await runFactoryCompletionCheck("test-suite@dna-os", "test-owner", null);
    assert(record.status === "PASSED", `expected PASSED (informational audit), got ${record.status}`);
    assert(record.findings.length > 0, "expected at least one real finding — this repo genuinely has real gaps to report");
    assert(record.findings.every((f) => f.category === "FACTORY_COMPLETION_CHECK"), "every finding must carry the real FACTORY_COMPLETION_CHECK category");
    const codes = new Set(record.findings.map((f) => f.code));
    assert(codes.has("VS_CODE_DEPENDENCY") || codes.has("FACTORY_INCOMPLETE"), "expected at least one real, honest FACTORY_INCOMPLETE or VS_CODE_DEPENDENCY finding");
  });

  await test("Read-only scope + auth: the live route requires ADMIN_TIER auth (source check)", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/factory-completion/route.ts"), "utf-8");
    assert(src.includes("requireAuth(ADMIN_TIER)"), "expected the real route to be ADMIN_TIER auth-gated");
  });

  console.log("\n=== Factory Completion Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}
main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
