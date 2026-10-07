/**
 * หน้าที่: Phase 3 proof for `../resolver.ts` — RESOLVED against two real,
 * already-registered entities from two different existing registries,
 * UNRESOLVED for the real "DNA_LAB" case (see
 * ../../../reports/SYSTEM_ADDRESSABILITY_REPORT.md §PHASE_2), and
 * AMBIGUOUS when two real registries genuinely name the same entity.
 *
 * How to run: npx tsx control/system-reference-resolution/tests/resolve-system-reference.test.ts
 */

import { resolveSystemReference } from "../contract";
import { createLocalFileStore } from "../../../software/registry-database/adapters/local-file-store";
import { runRegistrationPipeline } from "../../../control/registration-pipeline/contract";
import type { RegistrationCandidate } from "../../../control/event-pipeline/contract";
import type { RegistryStore } from "../../../software/registry-database/contract";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function baseCandidate(overrides: Partial<RegistrationCandidate>): RegistrationCandidate {
  return {
    candidate_id: "candidate-system-reference-resolution-test",
    name: "test-fixture",
    kind: "capability",
    source_location: "control/system-reference-resolution/tests/resolve-system-reference.test.ts",
    owner: "control/system-reference-resolution/",
    input: [],
    output: [],
    side_effects: [],
    dependencies: [],
    behavior: "test fixture for Phase 3 AMBIGUOUS proof",
    version: "1.0.0",
    evidence_refs: ["control/system-reference-resolution/tests/resolve-system-reference.test.ts"],
    domain: "SOFTWARE_CONTROL_PLANE",
    resource_type: "CAPABILITY",
    data_classification: "INTERNAL",
    source_system: "dna-os-infrastructure",
    scope: "software_registry",
    ...overrides,
  };
}

function run(): void {
  console.log("=== control/system-reference-resolution/tests/resolve-system-reference.test.ts ===");
  const emptyStore: RegistryStore = createLocalFileStore();

  // 1. RESOLVED via control/command-router/'s real, static CAPABILITY_REGISTRY
  {
    const resolution = resolveSystemReference({ request: "CHECK", target: "github" }, { registryStore: emptyStore });
    assert(resolution.status === "RESOLVED", `"github" (a real, registered command-router capability) resolves (got ${resolution.status})`);
    assert(resolution.match!.source === "COMMAND_ROUTER_CAPABILITY", `matched via COMMAND_ROUTER_CAPABILITY (got ${resolution.match!.source})`);
    assert(resolution.match!.capability_id === "github", "capability_id round-trips the real registered id");
    assert(resolution.match!.evidence_refs.length === 1 && resolution.match!.evidence_refs[0].endsWith(".ts"), "evidence_refs cites the real contract file path, not invented");
    console.log(`PASS: "github" -> RESOLVED via COMMAND_ROUTER_CAPABILITY (capability_id=${resolution.match!.capability_id})`);
  }

  // 2. RESOLVED via connections/os-ui/'s real target allowlist
  {
    const resolution = resolveSystemReference({ request: "OPEN", target: "dna-os" }, { registryStore: emptyStore });
    assert(resolution.status === "RESOLVED", `"dna-os" (a real, registered os-ui target) resolves (got ${resolution.status})`);
    assert(resolution.match!.source === "OS_UI_TARGET", `matched via OS_UI_TARGET (got ${resolution.match!.source})`);
    assert(resolution.match!.ui_ref === "dna-os", "ui_ref round-trips the real target id");
    assert(resolution.match!.action_ref === "connections/os-ui#openOsUi", `an OPEN request against an openable target names the real, existing open action (got ${resolution.match!.action_ref})`);
    console.log(`PASS: "dna-os" + OPEN -> RESOLVED via OS_UI_TARGET (action_ref=${resolution.match!.action_ref})`);
  }

  // 2b. Normalization: "DNA OS" / "dna_os" also resolve to the same real target
  {
    const spaced = resolveSystemReference({ request: "OPEN", target: "DNA OS" }, { registryStore: emptyStore });
    const underscored = resolveSystemReference({ request: "OPEN", target: "dna_os" }, { registryStore: emptyStore });
    assert(spaced.status === "RESOLVED" && spaced.match!.entity_id === "dna-os", `"DNA OS" normalizes to the same real target (got ${spaced.status})`);
    assert(underscored.status === "RESOLVED" && underscored.match!.entity_id === "dna-os", `"dna_os" normalizes to the same real target (got ${underscored.status})`);
    console.log("PASS: space/underscore/case variants of a real target id normalize to the same match");
  }

  // 3. UNRESOLVED for the real DNA_LAB case — proven MISSING in Phase 2, never guessed here
  {
    const resolution = resolveSystemReference({ request: "OPEN", target: "DNA_LAB" }, { registryStore: emptyStore });
    assert(resolution.status === "UNRESOLVED", `"DNA_LAB" has no real registered record anywhere (got ${resolution.status})`);
    assert(resolution.reason_code === "NO_REGISTERED_MATCH", `reason_code names why, honestly (got ${resolution.reason_code})`);
    assert(resolution.match === null && resolution.candidates.length === 0, "UNRESOLVED never carries a guessed match or fabricated candidate");
    console.log("PASS: \"DNA_LAB\" -> UNRESOLVED (NO_REGISTERED_MATCH) — no guess, matches Phase 2's proven gap exactly");
  }

  // 4. AMBIGUOUS — two real, distinct registries genuinely naming the same entity
  {
    const ambiguousStore: RegistryStore = createLocalFileStore();
    const candidate = baseCandidate({ candidate_id: "candidate-ambiguous-github-fixture", name: "github" });
    const registration = runRegistrationPipeline(candidate, ambiguousStore, "corr-ambiguous-fixture");
    assert(registration.status === "REGISTERED", `test fixture registers cleanly first (got ${registration.status})`);

    const resolution = resolveSystemReference({ request: "CHECK", target: "github" }, { registryStore: ambiguousStore });
    assert(resolution.status === "AMBIGUOUS", `"github" now matches both command-router's real static entry AND this test's own registered fixture (got ${resolution.status})`);
    assert(resolution.candidates.length === 2, `both real matches are listed, none silently dropped (got ${resolution.candidates.length})`);
    const sources = resolution.candidates.map((c) => c.source).sort();
    assert(JSON.stringify(sources) === JSON.stringify(["COMMAND_ROUTER_CAPABILITY", "REGISTRY_DATABASE_CAPABILITY"]), `both distinct sources are named (got ${sources.join(",")})`);
    assert(resolution.match === null, "AMBIGUOUS never auto-picks one candidate as the answer");
    console.log("PASS: a genuine two-registry name collision -> AMBIGUOUS, both candidates named, never auto-picked");
  }

  console.log("=== ALL resolve-system-reference.test.ts CASES PASSED ===");
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
