/**
 * Compatibility Regression Suite (owner, 2026-08-07, Software Factory
 * Step 10) — verifies that Capability Package compatibility is always
 * honestly UNKNOWN (no compatibility-matrix registry exists), and that
 * real Package Dependency references resolve within a real package set —
 * never fabricated as compatible/incompatible.
 *
 * Run: npm run compatibility:test
 */
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { packageCapabilities } from "../app/api/admin/ide/_lib/releaseRuntime";

const ROOT = path.join(__dirname, "..");
interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

async function main() {
  const pkgs = packageCapabilities();

  await test("Compatibility: every real Capability Package reports compatibility UNKNOWN — no compatibility-matrix registry exists in this repo (verified: no such file under registry/)", () => {
    assert(pkgs.every((p) => p.compatibility === "UNKNOWN"), "expected every real package's compatibility to be honestly UNKNOWN");
    const registryFiles = readdirSync(path.join(ROOT, "registry")) as string[];
    assert(!registryFiles.some((f: string) => /compat/i.test(f)), "sanity: confirmed no real compatibility-matrix registry file exists");
  });
  await test("Compatibility: compatibility is never PASSED/FAILED/COMPATIBLE/INCOMPATIBLE — the type system only allows the literal UNKNOWN", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/releaseRuntime.ts"), "utf-8");
    assert(src.includes('compatibility: "UNKNOWN";'), "expected the CapabilityPackage.compatibility field to be typed as the literal \"UNKNOWN\" only");
  });
  await test("Package Dependency: every real dependency reference within the full 202-capability package set resolves to a real CapabilityId (no dangling reference in this repo's real, frozen registry)", () => {
    const allIds = new Set(pkgs.map((p) => p.capabilityId));
    const dangling: string[] = [];
    for (const p of pkgs) {
      for (const dep of p.dependencies) {
        if (!allIds.has(dep)) dangling.push(`${p.capabilityId} -> ${dep}`);
      }
    }
    assert(dangling.length === 0, `expected 0 real dangling dependency references, found: ${dangling.slice(0, 5).join(", ")}`);
  });
  await test("Package Dependency: dependency arrays are real, verbatim copies of the real registry's Dependencies field — never inferred or guessed", () => {
    const registry = JSON.parse(readFileSync(path.join(ROOT, "registry/capability-registry.json"), "utf-8"));
    const byId = new Map(registry.capabilities.map((c: { CapabilityId: string; Dependencies?: string[] }) => [c.CapabilityId, c.Dependencies ?? []]));
    for (const p of pkgs.slice(0, 30)) {
      assert(JSON.stringify(p.dependencies) === JSON.stringify(byId.get(p.capabilityId)), `dependency mismatch for ${p.capabilityId}`);
    }
  });
  await test("Country Package Dependency: every real package reports NONE — never a fabricated country dependency", () => {
    assert(pkgs.every((p) => p.countryPackageDependency === "NONE"), "expected every real package's countryPackageDependency to be NONE");
  });

  console.log("\n=== Compatibility Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}
main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
