/**
 * หน้าที่: the real test for `../impact.ts` — transitive verification
 * invalidation. Drives the REAL exported functions with synthetic records, so
 * the closure (including cycles and the deliberate non-triggers) is proven
 * exhaustively without needing the repository in a particular state.
 *
 * The case that matters is B1: the exact hole proven live before impact.ts
 * existed — a VERIFIED capability whose VERIFIED dependency then moved kept
 * reporting VERIFIED.
 *
 * Run: npx tsx software/live-census/tests/impact.test.ts
 */

import { deriveImpact, applyImpact, impactOf } from "../contract";
import type { CapabilityRecord, CapabilityStatus } from "../contract";

declare const process: { exitCode?: number };
declare const console: { log(...a: unknown[]): void };

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n      ${JSON.stringify(detail)}`); }
}

function cap(path: string, status: CapabilityStatus, dependencies: string[] = []): CapabilityRecord {
  return {
    capability_key: `dna-os-infrastructure:${path}`,
    capability_id: null, resource_id: null, canonical_name: path, domain: "test",
    repository: "dna-os-infrastructure", path, entrypoint: null, version_commit: null,
    last_changed: null, owner_boundary: path.split("/")[0], input_contract: [], output_contract: [],
    dependencies, callers: [], downstream: [], runtime_state: "UNKNOWN", test_state: "HAS_TESTS",
    test_files: [], verification_state: status, evidence_references: [], registration_state: "UNREGISTERED",
    registry_matches: [], lineage: [], supersedes: [], duplicates: [], security_boundary: [],
    source_digest: "d1", last_observed: "now", last_verified: null, current_status: status,
    status_reason: "synthetic",
  };
}

function main(): void {
  // ---- A. no false positives ----
  check("A1. a VERIFIED capability whose dependencies are all VERIFIED stays VERIFIED",
    deriveImpact([cap("a/one", "VERIFIED", ["b/two"]), cap("b/two", "VERIFIED")]).length === 0);
  check("A2. a capability with no dependencies is never invalidated",
    deriveImpact([cap("a/one", "VERIFIED")]).length === 0);
  check("A3. a capability that is not VERIFIED is not reported (nothing to invalidate)",
    deriveImpact([cap("a/one", "UNVERIFIED", ["b/two"]), cap("b/two", "CHANGED_SINCE_VERIFICATION")]).length === 0);

  // ---- B. THE HOLE THIS FILE EXISTS TO CLOSE ----
  const direct = deriveImpact([cap("control/command-router", "VERIFIED", ["permissions/execution-policy"]), cap("permissions/execution-policy", "CHANGED_SINCE_VERIFICATION")]);
  check("B1. a VERIFIED capability whose DIRECT dependency moved is invalidated (the proven live hole)",
    direct.length === 1 && direct[0].capability_path === "control/command-router", direct);
  check("B2. the finding names the dependency that moved and the path to it",
    direct[0]?.invalidated_by.includes("permissions/execution-policy") && direct[0]?.via.join(" -> ") === "control/command-router -> permissions/execution-policy", direct[0]);

  // ---- C. transitive, cycle-safe ----
  const chain = [cap("a/one", "VERIFIED", ["b/two"]), cap("b/two", "VERIFIED", ["c/three"]), cap("c/three", "CHANGED_SINCE_VERIFICATION")];
  const chainFindings = deriveImpact(chain);
  check("C1. invalidation is TRANSITIVE — a change two hops down still invalidates the top",
    chainFindings.some((f) => f.capability_path === "a/one"), chainFindings);
  check("C2. the intermediate is invalidated too", chainFindings.some((f) => f.capability_path === "b/two"));
  const cyclic = [cap("a/one", "VERIFIED", ["b/two"]), cap("b/two", "VERIFIED", ["a/one", "c/three"]), cap("c/three", "CHANGED_SINCE_VERIFICATION")];
  check("C3. a dependency CYCLE terminates instead of recursing forever",
    deriveImpact(cyclic).some((f) => f.capability_path === "a/one"));
  check("C4. REQUIRES_REVERIFICATION propagates further (a moved dependent invalidates ITS dependents)",
    deriveImpact([cap("a/one", "VERIFIED", ["b/two"]), cap("b/two", "REQUIRES_REVERIFICATION")]).length === 1);

  // ---- D. deliberate NON-triggers ----
  check("D1. a merely UNVERIFIED dependency does NOT invalidate — its code has not moved, so the evidence still describes it",
    deriveImpact([cap("a/one", "VERIFIED", ["b/two"]), cap("b/two", "UNVERIFIED")]).length === 0);
  check("D2. a DECLARED_ONLY dependency does not invalidate",
    deriveImpact([cap("a/one", "VERIFIED", ["b/two"]), cap("b/two", "DECLARED_ONLY")]).length === 0);
  check("D3. a dependency outside the census is ignored, not treated as moved",
    deriveImpact([cap("a/one", "VERIFIED", ["not/present"])]).length === 0);
  check("D4. a self-dependency does not invalidate the capability itself",
    deriveImpact([cap("a/one", "VERIFIED", ["a/one"])]).length === 0);

  // ---- E. applyImpact only ever DOWNGRADES ----
  const applied = applyImpact([cap("a/one", "VERIFIED", ["b/two"]), cap("b/two", "CHANGED_SINCE_VERIFICATION")]);
  check("E1. VERIFIED becomes REQUIRES_REVERIFICATION", applied[0].current_status === "REQUIRES_REVERIFICATION");
  check("E2. verification_state is kept consistent with current_status", applied[0].verification_state === "REQUIRES_REVERIFICATION");
  check("E3. the reason explains that its OWN source is unchanged but its dependency moved",
    applied[0].status_reason.includes("permissions") === false && applied[0].status_reason.includes("b/two") && applied[0].status_reason.includes("own source is unchanged"), applied[0].status_reason);
  check("E4. a non-VERIFIED record is returned untouched — impact NEVER upgrades anything",
    applied[1].current_status === "CHANGED_SINCE_VERIFICATION");
  const inputRecords = [cap("a/one", "VERIFIED", ["b/two"]), cap("b/two", "CHANGED_SINCE_VERIFICATION")];
  applyImpact(inputRecords);
  check("E5. applyImpact does not mutate its input", inputRecords[0].current_status === "VERIFIED");

  // ---- F. forward impact: "if I change X, what must be re-verified?" ----
  const graph = [cap("a/one", "VERIFIED", ["b/two"]), cap("b/two", "VERIFIED", ["c/three"]), cap("c/three", "VERIFIED"), cap("z/unrelated", "VERIFIED")];
  const forward = impactOf("c/three", graph);
  check("F1. impactOf returns the transitive DEPENDENTS, nearest first",
    forward.map((f) => f.path).join(",") === "b/two,a/one", forward);
  check("F2. depth reflects real distance", forward[0].depth === 1 && forward[1].depth === 2);
  check("F3. unrelated capabilities are excluded", !forward.some((f) => f.path === "z/unrelated"));
  check("F4. impactOf on a leaf nothing depends on returns empty", impactOf("z/unrelated", graph).length === 0);
}

main();
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
