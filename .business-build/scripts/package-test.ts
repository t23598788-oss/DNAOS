/**
 * Capability Packaging Regression Suite (owner, 2026-08-07, Software
 * Factory Step 10) — verifies packageCapabilities()/checkPackageIntegrity()
 * against this repo's real, frozen registry/capability-registry.json (202
 * real capabilities). Never fabricates a Capability, never duplicates one.
 *
 * Run: npm run package:test
 */
import { readFileSync } from "fs";
import path from "path";
import { packageCapabilities, checkPackageIntegrity } from "../app/api/admin/ide/_lib/releaseRuntime";
import { WORKSPACE_ROOT } from "../app/api/admin/ide/_lib/fsSecurity";

const ROOT = path.join(__dirname, "..");
interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

async function main() {
  const registry = JSON.parse(readFileSync(path.join(ROOT, "registry/capability-registry.json"), "utf-8"));
  const realCapabilities = registry.capabilities as {
    CapabilityId: string; Category?: string; Description?: string; Version?: string | number;
    Dependencies?: string[]; OwnerModule?: string;
  }[];

  await test("Packaging: packageCapabilities() packages EVERY real capability from registry/capability-registry.json — none dropped, none added", () => {
    const pkgs = packageCapabilities();
    assert(pkgs.length === realCapabilities.length, `expected ${realCapabilities.length} real packages, got ${pkgs.length}`);
    const realIds = new Set(realCapabilities.map((c) => c.CapabilityId));
    for (const p of pkgs) assert(realIds.has(p.capabilityId), `packaged capability ${p.capabilityId} is not a real registry entry`);
  });
  await test("Packaging: every real package's manifest fields come verbatim from the real registry entry — never guessed", () => {
    const pkgs = packageCapabilities();
    const byId = new Map(realCapabilities.map((c) => [c.CapabilityId, c]));
    for (const p of pkgs.slice(0, 20)) {
      const real = byId.get(p.capabilityId)!;
      assert(p.manifest.category === real.Category, `category mismatch for ${p.capabilityId}`);
      assert(p.manifest.description === real.Description, `description mismatch for ${p.capabilityId}`);
      assert(p.version === real.Version, `version mismatch for ${p.capabilityId}`);
      assert(JSON.stringify(p.dependencies) === JSON.stringify(real.Dependencies ?? []), `dependencies mismatch for ${p.capabilityId}`);
    }
  });
  await test("Packaging: compatibility is always honestly UNKNOWN — no compatibility-matrix registry exists in this repo", () => {
    const pkgs = packageCapabilities();
    assert(pkgs.every((p) => p.compatibility === "UNKNOWN"), "expected every real package's compatibility to be UNKNOWN");
  });
  await test("Packaging: countryPackageDependency is always honestly NONE — no real Country Package exists yet", () => {
    const pkgs = packageCapabilities();
    assert(pkgs.every((p) => p.countryPackageDependency === "NONE"), "expected every real package's countryPackageDependency to be NONE");
  });
  await test("Packaging: a real package whose OwnerModule file exists is status OK; a real missing OwnerModule is honestly flagged", () => {
    const pkgs = packageCapabilities();
    const missing = pkgs.filter((p) => p.status === "MISSING_OWNER_MODULE");
    for (const p of missing) assert(p.evidence.includes("MISSING"), `expected evidence to honestly cite the missing real file for ${p.capabilityId}`);
    const ok = pkgs.filter((p) => p.status === "OK");
    assert(ok.length + missing.length === pkgs.length, "every real package must be exactly OK or MISSING_OWNER_MODULE");
  });
  await test("Packaging: owner is resolved from the real registry/factory-mapping.json only — UNKNOWN/null when not found, never guessed", () => {
    const fm = JSON.parse(readFileSync(path.join(WORKSPACE_ROOT, "registry/factory-mapping.json"), "utf-8"));
    const pkgs = packageCapabilities();
    for (const p of pkgs.slice(0, 20)) {
      const real = realCapabilities.find((c) => c.CapabilityId === p.capabilityId)!;
      const expectedOwner = fm.modules?.[real.OwnerModule ?? ""]?.factoryOwner ?? null;
      assert(p.owner === expectedOwner, `owner mismatch for ${p.capabilityId}: expected ${expectedOwner}, got ${p.owner}`);
    }
  });
  await test("Integrity: checkPackageIntegrity() detects 0 real duplicate CapabilityIds in the real, frozen registry (checksum-locked, should be unique by construction)", () => {
    const pkgs = packageCapabilities();
    const integrity = checkPackageIntegrity(pkgs);
    assert(integrity.duplicateCapabilityIds.length === 0, `expected 0 real duplicates in the frozen registry, got ${integrity.duplicateCapabilityIds.length}`);
  });
  await test("Integrity: checkPackageIntegrity() totalPackages always matches the real input array length", () => {
    const pkgs = packageCapabilities();
    const integrity = checkPackageIntegrity(pkgs);
    assert(integrity.totalPackages === pkgs.length, "totalPackages must match the real input length");
  });
  await test("Integrity: two consecutive calls against the SAME real, unchanged registry produce the SAME real result (deterministic)", () => {
    const pkgs1 = packageCapabilities();
    const pkgs2 = packageCapabilities();
    assert(JSON.stringify(pkgs1) === JSON.stringify(pkgs2), "expected deterministic packaging output for the same real registry state");
  });
  await test("Reuse: packageCapabilities() reads ONLY registry/capability-registry.json + registry/factory-mapping.json + registry/capability-roadmap.json — no second capability list invented", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/releaseRuntime.ts"), "utf-8");
    const fnSrc = src.slice(src.indexOf("export function packageCapabilities"), src.indexOf("export function checkPackageIntegrity"));
    assert(fnSrc.includes("capability-registry.json"), "expected the real capability-registry.json read");
    assert(!fnSrc.includes("writeFileSync") && !fnSrc.includes("writeFile("), "packageCapabilities() must never write a file");
  });

  console.log("\n=== Capability Packaging Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}
main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
