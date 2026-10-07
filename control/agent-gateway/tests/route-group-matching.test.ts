/**
 * หน้าที่: prove the extended capability matcher against the REAL registries —
 * all four tiers, all ten canonical route groups, and the legacy intents that
 * existed before it.
 *
 * NOTHING HERE IS MOCKED. `resolveCapability` is called with the real gateway
 * capability index, and it reads the real `control/command-router` registry
 * and the real persistent software registry. A tier that cannot find a row
 * fails the assertion rather than being softened.
 *
 * THE LEGACY REGRESSION IS THE POINT OF HALF THIS FILE. The three original
 * substring intents must still resolve to exactly the capabilities they
 * resolved to before, and must still be reached only after the registry tiers
 * decline — if a registry tier started stealing them, existing callers would
 * silently change behaviour.
 *
 * Usage: npx tsx control/agent-gateway/tests/route-group-matching.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveCapability } from "../capability-resolver";
import type { GatewayCapabilityEntry } from "../capability-resolver";
import { ROUTE_GROUPS } from "../../../contracts/command/route-group-capabilities";
import type { RouteGroup } from "../../../contracts/command/route-group-capabilities";

const REPO = process.cwd();
const INDEX: GatewayCapabilityEntry[] = JSON.parse(
  readFileSync(join(REPO, "reports/phase16-world-evidence/capability_index.json"), "utf-8"));

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { failed += 1; console.log(`FAIL ${name}\n     ${error instanceof Error ? error.message : String(error)}`); }
}
function assert(condition: boolean, message: string): void { if (!condition) throw new Error(message); }

console.log("=".repeat(96));
console.log("CAPABILITY MATCHING — four tiers, ten route groups, legacy regression");
console.log("=".repeat(96));

// --- tier 1: exact capability id ----------------------------------------
check("tier 1: an exact gateway-index problem_type resolves as EXACT_CAPABILITY_ID and is executable", () => {
  const result = resolveCapability(
    { intent_text: "unrelated sentence with no substring trigger", target_capability_id: "file_duplicate_or_orphan_detection" }, INDEX);
  assert(result.MATCH_METHOD === "EXACT_CAPABILITY_ID", `got ${result.MATCH_METHOD}`);
  assert(result.entry !== null, "a gateway-index hit must carry the row, or the gateway cannot execute it");
  assert(result.REGISTRY_REF!.includes("capability_index.json"), `registry_ref=${result.REGISTRY_REF}`);
});

check("tier 1: an exact command-router capability_id resolves, and is honestly NOT gateway-executable", () => {
  const result = resolveCapability({ intent_text: "no trigger words here", target_capability_id: "permission-reasoner" }, INDEX);
  assert(result.MATCH_METHOD === "EXACT_CAPABILITY_ID", `got ${result.MATCH_METHOD}`);
  assert(result.MATCHED_CAPABILITY_ID === "permission-reasoner", `got ${result.MATCHED_CAPABILITY_ID}`);
  // The command-router registry carries no execution_method. Reporting the
  // owner without an executable row is the correct answer: the gateway knows
  // WHO it is for and does not claim it may run it.
  assert(result.entry === null, "the command-router registry has no execution_method; entry must stay null");
  assert(result.REGISTRY_REF!.includes("capability-registry.ts"), `registry_ref=${result.REGISTRY_REF}`);
});

check("tier 1: an id no registry contains does NOT match, and does not fall through to a wrong tier", () => {
  const result = resolveCapability({ intent_text: "nothing matches this", target_capability_id: "capability-that-does-not-exist" }, INDEX);
  assert(result.MATCH_METHOD === "NO_EXISTING_CAPABILITY", `got ${result.MATCH_METHOD}`);
  assert(result.MATCHED_CAPABILITY_ID === null, "must not invent a capability");
  assert(result.considered.length > 0, "every attempted lookup must be recorded");
});

// --- tier 2: exact canonical name ----------------------------------------
check("tier 2: a canonical name in the persistent software registry resolves as EXACT_CANONICAL_NAME", () => {
  const result = resolveCapability(
    { intent_text: "no trigger words", target_capability_name: "real-work-resource-cost-measurement" }, INDEX);
  assert(result.MATCH_METHOD === "EXACT_CANONICAL_NAME", `got ${result.MATCH_METHOD}`);
  assert(result.REGISTRY_REF!.includes("capabilities.jsonl"), `registry_ref=${result.REGISTRY_REF}`);
});

// --- tier 3: registry-supported route group ------------------------------
check("tier 3: every one of the ten route groups resolves to a real registry row", () => {
  const unresolved: string[] = [];
  for (const group of ROUTE_GROUPS) {
    const result = resolveCapability({ intent_text: "sentence with no substring trigger at all", route_group: group }, INDEX);
    if (result.MATCH_METHOD !== "REGISTRY_ROUTE_GROUP" || !result.REGISTRY_REF) unresolved.push(`${group} -> ${result.MATCH_METHOD}`);
  }
  assert(unresolved.length === 0, `groups that failed to resolve: ${unresolved.join(", ")}`);
});

check("tier 3: a route group resolution never returns a match without a citable registry row", () => {
  for (const group of ROUTE_GROUPS) {
    const result = resolveCapability({ intent_text: "neutral", route_group: group }, INDEX);
    if (result.MATCHED_CAPABILITY_ID !== null) {
      assert(Boolean(result.REGISTRY_REF), `${group} matched ${result.MATCHED_CAPABILITY_ID} with no REGISTRY_REF`);
    }
  }
});

// --- tier 4: legacy regression -------------------------------------------
const LEGACY: readonly { intent: string; expect: string }[] = [
  { intent: "ตรวจ duplicate files", expect: "file_duplicate_or_orphan_detection" },
  { intent: "please modify the hanging server", expect: "server_hang_or_timeout" },
  { intent: "register external system lifecycle capability: probe", expect: "external_system_lifecycle_registration" },
];

check("tier 4: all three legacy intents still resolve to exactly the capabilities they always did", () => {
  for (const legacy of LEGACY) {
    const result = resolveCapability({ intent_text: legacy.intent }, INDEX);
    assert(result.MATCH_METHOD === "LEGACY_SUBSTRING", `${legacy.intent} -> ${result.MATCH_METHOD}`);
    assert(result.MATCHED_CAPABILITY_ID === legacy.expect, `${legacy.intent} -> ${result.MATCHED_CAPABILITY_ID}, expected ${legacy.expect}`);
    assert(result.entry !== null, `${legacy.intent} must still carry an executable row`);
  }
});

check("tier 4 runs LAST: a registry tier always wins over the substring matcher for the same sentence", () => {
  // This sentence would match the legacy "modify" rule. With a route group
  // present, the registry must decide instead — otherwise prose would still
  // be overriding the registry, which is the whole defect being fixed.
  const result = resolveCapability(
    { intent_text: "please modify the hanging server", route_group: "SECURITY_POLICY" }, INDEX);
  assert(result.MATCH_METHOD === "REGISTRY_ROUTE_GROUP", `got ${result.MATCH_METHOD}`);
  assert(result.MATCHED_CAPABILITY_ID !== "server_hang_or_timeout", "the substring rule must not win over a route group");
});

check("no tier ever invents a capability: an unmatched request returns NO_EXISTING_CAPABILITY", () => {
  const result = resolveCapability({ intent_text: "a completely neutral sentence about nothing" }, INDEX);
  assert(result.MATCH_METHOD === "NO_EXISTING_CAPABILITY", `got ${result.MATCH_METHOD}`);
  assert(result.REGISTRY_REF === null && result.MATCHED_CAPABILITY_ID === null, "must be empty, not a guess");
});

// --- the per-group report the Owner asked for ----------------------------
console.log("\nPER-GROUP RESOLUTION (tier 3, against the real registries)");
console.log(`${"ROUTE_GROUP".padEnd(24)}${"MATCH_METHOD".padEnd(24)}${"TARGET_CAPABILITY".padEnd(40)}EXECUTABLE_BY_GATEWAY`);
for (const group of ROUTE_GROUPS as readonly RouteGroup[]) {
  const result = resolveCapability({ intent_text: "neutral", route_group: group }, INDEX);
  console.log(
    `${group.padEnd(24)}${result.MATCH_METHOD.padEnd(24)}${String(result.MATCHED_CAPABILITY_ID).slice(0, 38).padEnd(40)}${result.entry ? "yes" : "no (owner named, dispatch belongs to it)"}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
