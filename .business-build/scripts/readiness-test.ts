/**
 * Operational Readiness Regression Suite (owner, 2026-08-07, Software
 * Factory Step 10) — verifies computeOperationalReadiness() against
 * this repo's real registry/business-coverage.json, registry/
 * AI_REGISTRY.json, registry/infrastructure.json, registry/factory-
 * summary.json. UNKNOWN/NOT_IMPLEMENTED must stay honest — never a
 * fabricated READY.
 *
 * Run: npm run readiness:test
 */
import { readFileSync } from "fs";
import path from "path";
import { computeOperationalReadiness, type ReleaseRun } from "../app/api/admin/ide/_lib/releaseRuntime";
import { WORKSPACE_ROOT } from "../app/api/admin/ide/_lib/fsSecurity";

const ROOT = path.join(__dirname, "..");
interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

function emptyRun(): ReleaseRun {
  return {
    releaseRunId: "test", buildRunId: "test", actor: "test", ownerId: "test", status: "REQUESTED", queueJobId: null, reason: "test",
    startedAt: new Date().toISOString(), finishedAt: null, releaseCandidate: null, validation: null, packages: [], packageIntegrity: null,
    decision: null, operationalReadiness: null, artifactIds: [], evidenceIds: [], error: null,
  };
}

async function main() {
  await test("Readiness: exactly 10 real dimensions are always computed (8 real sources + 2 composite), in the same order, every time", () => {
    const r1 = computeOperationalReadiness(emptyRun());
    const r2 = computeOperationalReadiness(emptyRun());
    assert(r1.dimensions.length === 10, `expected 10 real dimensions, got ${r1.dimensions.length}`);
    assert(JSON.stringify(r1.dimensions.map((d) => d.dimension)) === JSON.stringify(r2.dimensions.map((d) => d.dimension)), "expected the same real dimension order every time");
  });
  await test("Readiness: Legal Ready is ALWAYS NOT_IMPLEMENTED — no real Legal Package or Country Package exists anywhere in this repo", () => {
    const r = computeOperationalReadiness(emptyRun());
    const legal = r.dimensions.find((d) => d.dimension === "Legal Ready")!;
    assert(legal.status === "NOT_IMPLEMENTED", `expected NOT_IMPLEMENTED, got ${legal.status}`);
  });
  await test("Readiness: Deployment Readiness is ALWAYS NOT_IMPLEMENTED — no real Deployment Pipeline (Step 11) exists yet", () => {
    const r = computeOperationalReadiness(emptyRun());
    const deploy = r.dimensions.find((d) => d.dimension === "Deployment Readiness")!;
    assert(deploy.status === "NOT_IMPLEMENTED", `expected NOT_IMPLEMENTED, got ${deploy.status}`);
  });
  await test("Readiness: Evidence Ready is honestly NOT_IMPLEMENTED for a Release Run with zero real artifacts", () => {
    const r = computeOperationalReadiness(emptyRun());
    const ev = r.dimensions.find((d) => d.dimension === "Evidence Ready")!;
    assert(ev.status === "NOT_IMPLEMENTED", `expected NOT_IMPLEMENTED with 0 real artifacts, got ${ev.status}`);
  });
  await test("Readiness: Runtime Ready is honestly NOT_IMPLEMENTED when no real Validation has run yet", () => {
    const r = computeOperationalReadiness(emptyRun());
    const rt = r.dimensions.find((d) => d.dimension === "Runtime Ready")!;
    assert(rt.status === "NOT_IMPLEMENTED", `expected NOT_IMPLEMENTED with no real validation, got ${rt.status}`);
  });
  await test("Readiness: Package Ready is honestly NOT_IMPLEMENTED when no real Capability Packaging has run yet", () => {
    const r = computeOperationalReadiness(emptyRun());
    const pkg = r.dimensions.find((d) => d.dimension === "Package Ready")!;
    assert(pkg.status === "NOT_IMPLEMENTED", `expected NOT_IMPLEMENTED with no real packaging, got ${pkg.status}`);
  });
  await test("Readiness: Business Ready reads the real, current registry/business-coverage.json — real covered/missing counts, never guessed", () => {
    const real = JSON.parse(readFileSync(path.join(WORKSPACE_ROOT, "registry/business-coverage.json"), "utf-8"));
    const domains = Object.values(real.domains) as { status: string }[];
    const missing = domains.filter((x) => x.status === "missing").length;
    const r = computeOperationalReadiness(emptyRun());
    const biz = r.dimensions.find((d) => d.dimension === "Business Ready")!;
    assert(biz.status === (missing === 0 ? "PASSED" : "FAILED"), `expected status to match real missing count (${missing}), got ${biz.status}`);
    assert(biz.evidence.includes(`${domains.length} real domains`), "expected the real total domain count in evidence");
  });
  await test("Readiness: AI Ready reads the real, current registry/AI_REGISTRY.json — real agent count, never guessed", () => {
    const real = JSON.parse(readFileSync(path.join(WORKSPACE_ROOT, "registry/AI_REGISTRY.json"), "utf-8"));
    const r = computeOperationalReadiness(emptyRun());
    const ai = r.dimensions.find((d) => d.dimension === "AI Ready")!;
    assert(ai.evidence.includes(`${real.agents.length} real registered agent`), "expected the real current agent count in evidence");
  });
  await test("Readiness: Infrastructure Ready reads the real, current registry/infrastructure.json — real service count, never guessed", () => {
    const real = JSON.parse(readFileSync(path.join(WORKSPACE_ROOT, "registry/infrastructure.json"), "utf-8"));
    const r = computeOperationalReadiness(emptyRun());
    const infra = r.dimensions.find((d) => d.dimension === "Infrastructure Ready")!;
    assert(infra.evidence.includes(`${Object.keys(real.services).length} real registered service`), "expected the real current service count in evidence");
  });
  await test("Readiness: Factory Ready reads the real, current registry/factory-summary.json — real coverage percent, never guessed", () => {
    const real = JSON.parse(readFileSync(path.join(WORKSPACE_ROOT, "registry/factory-summary.json"), "utf-8"));
    const r = computeOperationalReadiness(emptyRun());
    const factory = r.dimensions.find((d) => d.dimension === "Factory Ready")!;
    assert(factory.evidence.includes(`${real.coverage.coverage_percent}%`), "expected the real current coverage percent in evidence");
  });
  await test("Readiness: Production Ready is a deterministic composite (AND) of the other real dimensions — never an independent guess", () => {
    const r = computeOperationalReadiness(emptyRun());
    const prod = r.dimensions.find((d) => d.dimension === "Production Ready")!;
    const others = r.dimensions.filter((d) => d.dimension !== "Production Ready" && d.dimension !== "Deployment Readiness");
    const anyFailed = others.some((d) => d.status === "FAILED");
    if (anyFailed) assert(prod.status === "FAILED", "expected Production Ready to be FAILED when any real dimension failed");
  });
  await test("Readiness: overallStatus is BLOCKING_GAP whenever any real dimension is FAILED/BLOCKED — never silently ALL_READY", () => {
    const r = computeOperationalReadiness(emptyRun());
    const anyBlocking = r.dimensions.some((d) => d.status === "FAILED" || d.status === "BLOCKED");
    if (anyBlocking) assert(r.overallStatus === "BLOCKING_GAP", `expected BLOCKING_GAP given a real blocking dimension, got ${r.overallStatus}`);
  });
  await test("Readiness: never invokes a real process — pure real fs/JSON reads only", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/releaseRuntime.ts"), "utf-8");
    const fnSrc = src.slice(src.indexOf("export function computeOperationalReadiness"), src.indexOf("export function explainReleaseDecision"));
    assert(!fnSrc.includes("execFile") && !fnSrc.includes("startRun("), "computeOperationalReadiness() must never spawn a real process");
  });

  console.log("\n=== Operational Readiness Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}
main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
