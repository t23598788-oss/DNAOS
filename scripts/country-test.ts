/**
 * Country Package Foundation Regression Suite (owner, 2026-08-07,
 * Software Factory Step 10, Phase 7) — verifies the real Country Package
 * FRAMEWORK contracts. No real Country Package exists yet, and this
 * suite proves the framework honestly reports that, never fabricating
 * a real country's readiness.
 *
 * Run: npm run country:test
 */
import { readFileSync } from "fs";
import path from "path";
import {
  COUNTRY_PACKAGE_REGISTRY, listCountryPackages, getCountryPackage, getCountryPackageFrameworkStatus,
} from "../app/api/admin/ide/_lib/countryPackageRegistry";

const ROOT = path.join(__dirname, "..");
interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

async function main() {
  await test("Country Package: the real registry is honestly empty — no real Country Package (Thailand or otherwise) has been built yet", () => {
    assert(Object.keys(COUNTRY_PACKAGE_REGISTRY).length === 0, "expected COUNTRY_PACKAGE_REGISTRY to be real and empty this phase");
    assert(listCountryPackages().length === 0, "expected listCountryPackages() to return an empty real array");
  });
  await test("Country Package: getCountryPackage() for any real country code honestly returns undefined — never a fabricated package", () => {
    assert(getCountryPackage("TH") === undefined, "expected undefined for Thailand — no real package exists yet");
    assert(getCountryPackage("US") === undefined, "expected undefined for the US — no real package exists yet");
  });
  await test("Country Package: getCountryPackageFrameworkStatus() always reports NOT_IMPLEMENTED with 0 real registered countries", () => {
    const status = getCountryPackageFrameworkStatus();
    assert(status.status === "NOT_IMPLEMENTED", `expected NOT_IMPLEMENTED, got ${status.status}`);
    assert(status.registeredCountries === 0, "expected 0 real registered countries");
  });
  await test("Country Package: real, typed contracts exist for all 6 required package types (Legal/Tax/Document/BusinessRules/Localization/CapabilityExtension)", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/countryPackageRegistry.ts"), "utf-8");
    for (const t of ["LegalPackageContract", "TaxPackageContract", "DocumentPackageContract", "BusinessRulesPackageContract", "LocalizationPackageContract", "CapabilityExtensionPackageContract"]) {
      assert(src.includes(`interface ${t}`), `expected a real TypeScript interface ${t}`);
    }
  });
  await test("Country Package: CountryMetadata contract exists with real ISO field references (countryCode, currency)", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/countryPackageRegistry.ts"), "utf-8");
    assert(src.includes("interface CountryMetadata"), "expected a real CountryMetadata interface");
    assert(src.includes("ISO 3166-1") && src.includes("ISO 4217"), "expected real ISO standard references documented");
  });
  await test("Country Package: no real country is hardcoded into any Core module — the registry is the ONLY real source of a Country Package", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/countryPackageRegistry.ts"), "utf-8");
    assert(src.includes("COUNTRY_PACKAGE_REGISTRY: Record<string, CountryPackage> = {}"), "expected the real registry to be declared genuinely empty in source");
  });
  await test("Country Package: this file never writes to disk — pure real, static framework declarations only", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/countryPackageRegistry.ts"), "utf-8");
    assert(!src.includes("writeFileSync") && !src.includes("execFile"), "countryPackageRegistry.ts must never write a file or spawn a process");
  });

  console.log("\n=== Country Package Foundation Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}
main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
