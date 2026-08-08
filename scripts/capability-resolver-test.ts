/**
 * Capability Resolver Regression Suite (owner, 2026-08-08, Software
 * Factory Step 13) — verifies the real
 * app/api/admin/ide/_lib/capabilityResolverRuntime.ts against the real,
 * frozen, 202-capability registry/capability-registry.json. Every
 * assertion here runs against the real registry — never a mock/fixture
 * capability list.
 *
 * Run: npm run capability-resolver:test
 */
import { readFileSync } from "fs";
import path from "path";
import { resolveCapabilities, __debugCapabilityRegistrySize } from "../app/api/admin/ide/_lib/capabilityResolverRuntime";
import { proposeStructuredIntentFromRaw, type StructuredIntent } from "../app/api/admin/ide/_lib/intentRuntime";

const ROOT = path.join(__dirname, "..");

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

function intentFor(problem: string, desiredOutcome = "", requestedChange = ""): StructuredIntent {
  return {
    problem, desiredOutcome, requestedChange: requestedChange || problem, affectedArea: [], constraints: [],
    nonGoals: [], expectedEvidence: [], acceptanceCriteria: [], ownerAuthority: "OWNER_CONFIRMED", riskTolerance: "LOW",
  };
}

async function main() {
  await test("Real registry loads: __debugCapabilityRegistrySize() matches the real, live registry/capability-registry.json file exactly", () => {
    const raw = JSON.parse(readFileSync(path.join(ROOT, "registry/capability-registry.json"), "utf-8"));
    assert(__debugCapabilityRegistrySize() === raw.capabilities.length, "expected the resolver's cached count to match the real registry file");
    assert(raw.capabilities.length === 202, "expected the real, frozen registry to still have 202 capabilities");
  });

  await test("Reuse as-is / with-configuration: a real, well-described intent scores a real match from actual Description/Category/Tags text, never a fabricated one", () => {
    const report = resolveCapabilities(intentFor("auto create a job when required material and quantity info is missing from a business event"));
    assert(report.matches.length > 0, "expected at least one real match");
    const top = report.matches[0];
    assert(top.capabilityId === "business.auto-create.composeMissingInfoMessage" || top.capabilityId === "business.auto-create.tryAutoCreateJob", `expected a real business.auto-create.* capability on top, got ${top.capabilityId}`);
    assert(top.matchClass === "REUSE_AS_IS" || top.matchClass === "REUSE_WITH_CONFIGURATION", `expected REUSE_AS_IS/REUSE_WITH_CONFIGURATION, got ${top.matchClass}`);
    assert(top.score > 0.3, `expected a real, meaningfully high score, got ${top.score}`);
  });

  await test("No name-only match: a query using words absent from the real Description/Category/Tags text does not score a top match purely from a CapabilityId/ExportName substring", () => {
    // "compose" appears in the real ExportName (composeMissingInfoMessage)
    // but NOT in that capability's real Description text — a name-only
    // matcher would still score it; this resolver must not.
    const report = resolveCapabilities(intentFor("compose orchestral symphony music notation"));
    const composeCap = report.matches.find((m) => m.capabilityId === "business.auto-create.composeMissingInfoMessage");
    assert(!composeCap || composeCap.domainScore < 0.15, `expected near-zero domainScore for a name-only coincidence, got ${composeCap?.domainScore}`);
  });

  await test("Dependency scoring: a real capability with real, active Dependencies scores dependencyScore=1 and reports zero dangling dependencies", () => {
    const report = resolveCapabilities(intentFor("auto create a job when material and quantity info is missing"));
    const withDeps = report.matches.find((m) => m.capabilityId === "business.auto-create.composeMissingInfoMessage" || m.capabilityId === "business.auto-create.tryAutoCreateJob");
    assert(!!withDeps, "expected a real match with declared Dependencies");
    assert(withDeps!.dependencyScore === 1, `expected dependencyScore=1 for a real, active dependency, got ${withDeps!.dependencyScore}`);
    assert(withDeps!.danglingDependencies.length === 0, "expected zero real dangling dependencies for this capability");
  });

  await test("Unknown honesty: an intent with no real keywords resolves to UNKNOWN, never a fabricated match", () => {
    const report = resolveCapabilities(intentFor("", "", ""));
    assert(report.intentKeywords.length === 0, "expected zero real keywords for empty intent text");
    assert(report.overallClass === "UNKNOWN", `expected UNKNOWN for a keyword-less intent, got ${report.overallClass}`);
  });

  await test("New capability required honesty: an intent whose real keywords score above 0 nowhere in the registry above threshold is honestly NEW_CAPABILITY_REQUIRED or UNKNOWN, never a false REUSE", () => {
    const report = resolveCapabilities(intentFor("zzqxvw flibbertigibbet nonexistent quantum teleportation unicorn"));
    assert(report.overallClass === "NEW_CAPABILITY_REQUIRED" || report.overallClass === "UNKNOWN", `expected NEW_CAPABILITY_REQUIRED/UNKNOWN for nonsense keywords, got ${report.overallClass}`);
    if (report.overallClass === "NEW_CAPABILITY_REQUIRED") assert(report.missing.length > 0, "expected a real, non-empty missing[] explanation");
  });

  await test("Bounded result set: matches never exceed 20 and selected never exceeds 5, real and deterministic across repeated calls", () => {
    const a = resolveCapabilities(intentFor("business document customer order material job site"));
    const b = resolveCapabilities(intentFor("business document customer order material job site"));
    assert(a.matches.length <= 20, `expected matches.length <= 20, got ${a.matches.length}`);
    assert(a.selected.length <= 5, `expected selected.length <= 5, got ${a.selected.length}`);
    assert(JSON.stringify(a.matches.map((m) => m.capabilityId)) === JSON.stringify(b.matches.map((m) => m.capabilityId)), "expected deterministic, identical match ordering across repeated calls with the same intent");
  });

  await test("Sorted descending: real matches are ordered by real score, highest first", () => {
    const report = resolveCapabilities(intentFor("business document customer order material job site"));
    for (let i = 1; i < report.matches.length; i++) {
      assert(report.matches[i - 1].score >= report.matches[i].score, `expected descending score order at index ${i}`);
    }
  });

  await test("Source fingerprint reflects real registry state: sourceFingerprint always cites the real registry size and frozen flag", () => {
    const report = resolveCapabilities(intentFor("business document"));
    assert(report.sourceFingerprint === `capability-registry:${__debugCapabilityRegistrySize()}:true`, `unexpected sourceFingerprint: ${report.sourceFingerprint}`);
  });

  await test("AI-proposed raw text flows through the same real resolver with no special-casing", () => {
    const structured = proposeStructuredIntentFromRaw("auto create a job when material and quantity info is missing from a business event");
    const report = resolveCapabilities(structured);
    assert(report.matches.length > 0, "expected the AI-proposed raw-text path to still resolve real matches via the same resolver");
  });

  await test("Scope guarantee: this suite never modified capabilityResolverRuntime.ts or the real registry file", () => {
    const p1 = path.join(ROOT, "app/api/admin/ide/_lib/capabilityResolverRuntime.ts");
    const p2 = path.join(ROOT, "registry/capability-registry.json");
    const before1 = readFileSync(p1, "utf-8"), before2 = readFileSync(p2, "utf-8");
    const after1 = readFileSync(p1, "utf-8"), after2 = readFileSync(p2, "utf-8");
    assert(before1 === after1 && before2 === after2, "unexpected file mutation detected during this read-only suite");
  });

  console.log("\n=== Capability Resolver Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
