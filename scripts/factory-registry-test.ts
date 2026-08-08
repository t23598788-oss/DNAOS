/**
 * Regression suite for DNA OS Factory Architecture Phase 1.1 (owner,
 * 2026-08-06) — verifies scripts/build-factory-registry.ts's real output,
 * not a re-implementation of its logic. Read-only: this suite never moves,
 * renames, or deletes a source file — it only re-runs the real generator
 * and inspects its real output files.
 *
 * Run: npx tsx scripts/factory-registry-test.ts
 */
import { readFileSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);
const ROOT = path.join(__dirname, "..");

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    results.push({ name, pass: true });
  } catch (e) {
    results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) });
  }
}
function assert(cond: boolean, message: string) {
  if (!cond) throw new Error(message);
}

// Real, minimal shape of a registry/factory-mapping.json entry — only the
// fields this suite actually reads.
interface FactoryMappingEntry {
  factoryOwner: string;
  evidence: string[];
  domain: string | null;
  capability: string | null;
  conflictingFactories?: string[];
}

async function main() {
  // Re-run the real generator so this suite always checks fresh, real
  // output — never a stale snapshot.
  await execFileAsync("npx", ["tsx", "scripts/build-factory-registry.ts"], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });

  const moduleRegistry = JSON.parse(readFileSync(path.join(ROOT, "registry/module-registry.json"), "utf-8"));
  const factoryRegistry = JSON.parse(readFileSync(path.join(ROOT, "registry/factory-registry.json"), "utf-8"));
  const factoryMapping = JSON.parse(readFileSync(path.join(ROOT, "registry/factory-mapping.json"), "utf-8"));
  const factorySummary = JSON.parse(readFileSync(path.join(ROOT, "registry/factory-summary.json"), "utf-8"));

  const REQUIRED_FACTORIES = [
    "executive-office", "architecture-office", "software-factory", "ai-factory", "business-factory",
    "communication-factory", "document-factory", "runtime-factory", "infrastructure-factory",
    "qa-factory", "deployment-factory", "operations-center",
  ];
  const CONTRACT_FIELDS = [
    "id", "name", "description", "responsibilities", "ownedModules", "ownedRoutes", "ownedServices",
    "ownedRegistries", "inputs", "outputs", "dependencies", "interfaces", "health", "owner", "status",
  ];

  await test("Factory Registry: all 12 required Factories are declared", () => {
    const ids = factoryRegistry.factories.map((f: { id: string }) => f.id);
    for (const id of REQUIRED_FACTORIES) assert(ids.includes(id), `missing required factory "${id}"`);
    assert(factoryRegistry.factories.length === 12, `expected exactly 12 factories, got ${factoryRegistry.factories.length}`);
  });

  await test("Factory Contract: every Factory has all required contract fields", () => {
    for (const f of factoryRegistry.factories) {
      for (const field of CONTRACT_FIELDS) {
        assert(field in f, `factory "${f.id}" missing contract field "${field}"`);
      }
    }
  });

  await test("Factory Mapping: every real module in module-registry.json has a mapping entry", () => {
    const modulePaths = Object.keys(moduleRegistry.modules);
    for (const p of modulePaths) {
      assert(p in factoryMapping.modules, `module "${p}" has no factory mapping entry at all`);
    }
    assert(Object.keys(factoryMapping.modules).length === modulePaths.length, "mapping entry count does not match module-registry.json's real module count");
  });

  await test("Factory Mapping: factoryOwner is always a real Factory id, UNKNOWN, or CONFLICT — never fabricated", () => {
    const validValues = new Set([...REQUIRED_FACTORIES, "UNKNOWN", "CONFLICT"]);
    for (const [p, entry] of Object.entries(factoryMapping.modules) as [string, FactoryMappingEntry][]) {
      assert(validValues.has(entry.factoryOwner), `module "${p}" has an invalid factoryOwner "${entry.factoryOwner}"`);
    }
  });

  await test("Factory Mapping: UNKNOWN modules carry no evidence (honestly reported, not guessed)", () => {
    const unknowns = (Object.entries(factoryMapping.modules) as [string, FactoryMappingEntry][]).filter(([, e]) => e.factoryOwner === "UNKNOWN");
    for (const [p, entry] of unknowns) {
      assert(Array.isArray(entry.evidence) && entry.evidence.length === 0, `UNKNOWN module "${p}" unexpectedly carries evidence — it should have none`);
      assert(entry.domain === null && entry.capability === null, `UNKNOWN module "${p}" should have null domain/capability, not a guessed value`);
    }
  });

  await test("Factory Mapping: CONFLICT modules list 2+ real conflicting factories with real evidence for each", () => {
    const conflicts = (Object.entries(factoryMapping.modules) as [string, FactoryMappingEntry][]).filter(([, e]) => e.factoryOwner === "CONFLICT");
    for (const [p, entry] of conflicts) {
      const conflictingFactories = entry.conflictingFactories ?? [];
      assert(conflictingFactories.length >= 2, `conflict module "${p}" must list 2+ conflicting factories`);
      assert(entry.evidence.length >= conflictingFactories.length, `conflict module "${p}" evidence count doesn't cover all conflicting factories`);
    }
  });

  await test("Factory Summary: counts are internally consistent with the real mapping", () => {
    const mappingEntries = Object.entries(factoryMapping.modules) as [string, FactoryMappingEntry][];
    const unknownCount = mappingEntries.filter(([, e]) => e.factoryOwner === "UNKNOWN").length;
    const conflictCount = mappingEntries.filter(([, e]) => e.factoryOwner === "CONFLICT").length;
    assert(factorySummary.unknown_count === unknownCount, `summary unknown_count (${factorySummary.unknown_count}) doesn't match real mapping (${unknownCount})`);
    assert(factorySummary.conflict_count === conflictCount, `summary conflict_count (${factorySummary.conflict_count}) doesn't match real mapping (${conflictCount})`);
    const sumPerFactory = (Object.values(factorySummary.modules_per_factory) as number[]).reduce((a, b) => a + b, 0);
    assert(sumPerFactory + unknownCount + conflictCount === factorySummary.total_modules, "modules_per_factory + unknown + conflict does not add up to total_modules");
  });

  await test("Factory Summary: coverage_percent matches real modules_with_factory_owner / total_modules", () => {
    const expected = Math.round((factorySummary.coverage.modules_with_factory_owner / factorySummary.total_modules) * 1000) / 10;
    assert(factorySummary.coverage.coverage_percent === expected, `coverage_percent ${factorySummary.coverage.coverage_percent} does not match computed ${expected}`);
  });

  await test("Factory Registry: ownedModules per factory in factory-registry.json matches factory-mapping.json exactly", () => {
    for (const f of factoryRegistry.factories) {
      const fromMapping = (Object.entries(factoryMapping.modules) as [string, FactoryMappingEntry][]).filter(([, e]) => e.factoryOwner === f.id).map(([p]) => p).sort();
      const fromRegistry = [...f.ownedModules].sort();
      assert(JSON.stringify(fromMapping) === JSON.stringify(fromRegistry), `factory "${f.id}"'s ownedModules in factory-registry.json diverges from factory-mapping.json`);
    }
  });

  await test("Read-only guarantee: build-factory-registry.ts never moves, renames, or deletes a source file", async () => {
    const src = readFileSync(path.join(ROOT, "scripts/build-factory-registry.ts"), "utf-8");
    for (const forbidden of ["fs.rename(", "fs.unlink(", "fs.rm(", "fs.rmdir(", "execFile(\"git\", [\"mv\"", "execFile(\"rm\""]) {
      assert(!src.includes(forbidden), `build-factory-registry.ts contains a forbidden file-mutation call: ${forbidden}`);
    }
    assert(src.includes("writeFileSync"), "expected the script to write its own registry/factory-*.json outputs via writeFileSync");
  });

  await test("Real evidence, not extension-based: every non-UNKNOWN, non-CONFLICT module has at least one real evidence string", () => {
    const assigned = (Object.entries(factoryMapping.modules) as [string, FactoryMappingEntry][]).filter(([, e]) => e.factoryOwner !== "UNKNOWN" && e.factoryOwner !== "CONFLICT");
    assert(assigned.length > 0, "expected at least some modules to be assigned a real factory");
    for (const [p, entry] of assigned) {
      assert(Array.isArray(entry.evidence) && entry.evidence.length > 0, `module "${p}" assigned factory "${entry.factoryOwner}" with no evidence recorded`);
    }
  });

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log("\n=== Factory Registry Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) {
    console.error(`\n${failed.length} test(s) failed.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("SUITE CRASHED:", e);
  process.exit(1);
});
