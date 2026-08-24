/**
 * หน้าที่: the real test for `../derive.ts` — the verification state machine and
 * drift detection. Drives the REAL exported functions with synthetic
 * observations, which is the whole reason `derive.ts` is pure: the state machine
 * can be proven exhaustively without putting the actual repository into nine
 * different states.
 *
 * The case that matters most is C1: a capability whose source moved after it was
 * verified MUST NOT still read VERIFIED. That is the Owner directive this
 * capability exists to satisfy, and it is the failure mode every static
 * capability map in this repo already has.
 *
 * Run: npx tsx software/live-census/tests/derive.test.ts
 */

import { deriveStatus, deriveCapability, deriveDrift, deriveCensus, deriveEdges, capabilityKey } from "../contract";
import type { Observation, VerificationRecord, CapabilityRecord } from "../contract";

declare const process: { exitCode?: number };
declare const console: { log(...a: unknown[]): void };

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n      ${JSON.stringify(detail)}`); }
}

const REPO = "dna-os-infrastructure";

function obs(over: Partial<Observation> = {}): Observation {
  return {
    repository: REPO,
    path: "control/example",
    code_files: ["contract.ts", "resolver.ts"],
    test_files: ["control/example/tests/example.test.ts"],
    source_digest: "digest-v1",
    test_digest: "tdigest-v1",
    entrypoint: "control/example/contract.ts",
    last_commit: { sha: "abc1234", date: "2026-08-20T00:00:00.000Z" },
    dirty: false,
    newest_mtime: "2026-08-24T00:00:00.000Z",
    importers: ["control/other/router.ts"],
    dependencies: ["permissions/execution-policy"],
    registry_matches: [],
    runtime_refs: [],
    observed_at: "2026-08-24T06:00:00.000Z",
    ...over,
  };
}

function ledgerRecord(over: Partial<VerificationRecord> = {}): VerificationRecord {
  return {
    capability_key: capabilityKey(REPO, "control/example"),
    source_digest: "digest-v1",
    verified_at: "2026-08-24T05:00:00.000Z",
    evidence_ref: "example.test.ts=9/0",
    outcome: "VERIFIED",
    verified_by: "test",
    ...over,
  };
}

function main(): void {
  // ---- A. structural verdicts precede evidence ----
  check("A1. a folder with no implementation is DECLARED_ONLY, whatever the ledger claims",
    deriveStatus(obs({ code_files: [] }), [ledgerRecord()]).status === "DECLARED_ONLY");
  check("A2. code with no ledger, no importers and no contract.ts is UNWIRED",
    deriveStatus(obs({ importers: [], entrypoint: null }), []).status === "UNWIRED");
  check("A2b. a capability with a LIVE process is never UNWIRED, even with no importers and no contract.ts",
    deriveStatus(obs({ importers: [], entrypoint: null, runtime_refs: ["node transport/owner-command-http/server.ts"] }), []).status === "UNVERIFIED");
  check("A3. code with importers but no evidence is UNVERIFIED, never VERIFIED",
    deriveStatus(obs(), []).status === "UNVERIFIED");

  // ---- B. registration must never imply verification ----
  const registered = deriveCapability(obs({ registry_matches: ["capability-abc@unverified"] }), []);
  check("B1. a REGISTERED capability with no evidence is still UNVERIFIED (REGISTERED != VERIFIED)",
    registered.registration_state === "REGISTERED_STALE" && registered.current_status === "UNVERIFIED",
    { reg: registered.registration_state, status: registered.current_status });
  check("B2. two registry rows for one capability are reported as duplicates",
    deriveCapability(obs({ registry_matches: ["capability-a@unverified", "capability-b@unverified"] }), []).duplicates.length === 2);

  // ---- C. THE CRITICAL RULE ----
  check("C1. evidence pinned to the CURRENT digest yields VERIFIED",
    deriveStatus(obs({ source_digest: "digest-v1" }), [ledgerRecord({ source_digest: "digest-v1" })]).status === "VERIFIED");
  const stale = deriveStatus(obs({ source_digest: "digest-v2" }), [ledgerRecord({ source_digest: "digest-v1" })]);
  check("C2. source moved after verification -> CHANGED_SINCE_VERIFICATION, NOT VERIFIED",
    stale.status === "CHANGED_SINCE_VERIFICATION", stale);
  check("C3. the stale reason names both digests so the reader never has to guess",
    stale.reason.includes("digest-v1") && stale.reason.includes("digest-v2"), stale.reason);
  check("C4. editing only a TEST does not invalidate the implementation's verification",
    deriveStatus(obs({ test_digest: "tdigest-v9" }), [ledgerRecord()]).status === "VERIFIED");
  check("C5. a capability queued for re-verification reports VERIFYING",
    deriveStatus(obs(), [ledgerRecord()], new Set([capabilityKey(REPO, "control/example")])).status === "VERIFYING");
  check("C6. BLOCKED evidence stays BLOCKED and is never upgraded by a matching digest",
    deriveStatus(obs(), [ledgerRecord({ outcome: "BLOCKED", evidence_ref: "FILE_READ_DEFAULT_DENY: 3 attempts, all SIGABRT" })]).status === "BLOCKED");
  check("C7. FAILED evidence derives FAILED, not UNVERIFIED",
    deriveStatus(obs(), [ledgerRecord({ outcome: "FAILED" })]).status === "FAILED");
  check("C8. PARTIAL evidence against the current digest derives PARTIAL",
    deriveStatus(obs(), [ledgerRecord({ outcome: "PARTIAL" })]).status === "PARTIAL");
  check("C9. the LATEST ledger record wins — an old VERIFIED cannot mask a newer FAILED",
    deriveStatus(obs(), [ledgerRecord(), ledgerRecord({ outcome: "FAILED", verified_at: "2026-08-24T07:00:00.000Z" })]).status === "FAILED");
  check("C10. lineage is preserved: every ledger record for the capability is retained",
    deriveCapability(obs(), [ledgerRecord(), ledgerRecord({ outcome: "PARTIAL" })]).lineage.length === 2);

  // ---- D. drift detection ----
  const v1 = deriveCapability(obs({ source_digest: "d1" }), []);
  const v2 = deriveCapability(obs({ source_digest: "d2" }), []);
  check("D1. a changed digest is reported as SOURCE_CHANGED",
    deriveDrift([v1], [v2]).some((d) => d.change === "SOURCE_CHANGED"));
  check("D2. a new capability is CAPABILITY_ADDED", deriveDrift([], [v1]).some((d) => d.change === "CAPABILITY_ADDED"));
  check("D3. a vanished capability is CAPABILITY_REMOVED", deriveDrift([v1], []).some((d) => d.change === "CAPABILITY_REMOVED"));
  const moved = deriveCapability(obs({ path: "control/moved", source_digest: "d1" }), []);
  check("D4. same source digest at a new path is CAPABILITY_MOVED, not removed+added",
    deriveDrift([v1], [moved]).some((d) => d.change === "CAPABILITY_MOVED"));
  check("D5. a new caller is CONNECTION_CHANGED",
    deriveDrift([v1], [deriveCapability(obs({ source_digest: "d1", importers: ["a.ts", "b.ts"] }), [])]).some((d) => d.change === "CONNECTION_CHANGED"));
  check("D6. a new test file is TEST_CHANGED",
    deriveDrift([v1], [deriveCapability(obs({ source_digest: "d1", test_files: ["x.test.ts", "y.test.ts"] }), [])]).some((d) => d.change === "TEST_CHANGED"));
  check("D7. going live is RUNTIME_CHANGED",
    deriveDrift([v1], [deriveCapability(obs({ source_digest: "d1", runtime_refs: ["node .../thing.mjs"] }), [])]).some((d) => d.change === "RUNTIME_CHANGED"));

  // ---- E. census assembly + derived edges ----
  /** The dependency endpoint declares no dependencies of its own, so the graph has exactly one real edge. */
  const endpoint = obs({ path: "permissions/execution-policy", dependencies: [] });
  const census = deriveCensus(REPO, "abc1234", [obs(), endpoint], [ledgerRecord()]);
  check("E1. census totals are derived from the records, not supplied",
    census.totals["capabilities:total"] === 2 && census.totals["status:VERIFIED"] === 1, census.totals);
  const edges = deriveEdges(census.capabilities);
  check("E2. an edge to a capability that is not verified is CONNECTED_UNVERIFIED, never verified-by-association",
    edges.length === 1 && edges[0].state === "CONNECTED_UNVERIFIED", edges);
  check("E2b. a capability declaring itself as a dependency produces no self-edge",
    deriveEdges([deriveCapability(obs({ path: "control/example", dependencies: ["control/example"] }), [])]).length === 0);
  const bothVerified = deriveCensus(REPO, "abc", [obs(), endpoint],
    [ledgerRecord(), ledgerRecord({ capability_key: capabilityKey(REPO, "permissions/execution-policy") })]);
  check("E3. an edge is CONNECTED_VERIFIED only when BOTH endpoints are verified",
    deriveEdges(bothVerified.capabilities)[0].state === "CONNECTED_VERIFIED");
  const broken = deriveEdges([deriveCapability(obs({ dependencies: ["does/not-exist"] }), [])]);
  check("E4. a declared dependency that is not a real capability is a BROKEN edge",
    broken[0].state === "BROKEN", broken);

  // ---- F. the census is a pure function of its inputs ----
  const a = deriveCensus(REPO, "abc", [obs()], [ledgerRecord()]);
  const b = deriveCensus(REPO, "abc", [obs()], [ledgerRecord()]);
  check("F. identical observations derive an identical census (no hidden state, no snapshot authority)",
    JSON.stringify(a.capabilities) === JSON.stringify(b.capabilities));
  void (null as unknown as CapabilityRecord);
}

main();
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
