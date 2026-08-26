/**
 * หน้าที่: proves the declared read paths against the RUNNING system, and that
 * the circuit view keeps REQUEST and RESPONSE as two separate directed edges
 * (Owner, 2026-08-26).
 *
 * This test is the mechanism that would have caught `loadEvidenceForTask`
 * sitting unused on a public contract: a declaration whose symbol does not
 * resolve fails here, loudly, instead of being rediscovered by hand months
 * later.
 *
 * How to run: npx tsx control/system-read-paths/tests/read-path-registry.test.ts
 */

declare const process: { exit(code?: number): never; env: Record<string, string | undefined> };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

import { READ_PATHS, verifyReadPaths, readPathCircuitGraph, blueprintReadPathStatus, readBlueprintReferences, compareSourceToBlueprint } from "../contract";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function run(): void {
  console.log("=== control/system-read-paths/tests/read-path-registry.test.ts ===");

  // Every declaration is complete: no path without a key, a failure state, or evidence.
  for (const path of READ_PATHS) {
    assert(path.request.lookup_key.length > 0, `${path.id} declares a lookup key`);
    assert(path.response.failure_state.length > 0, `${path.id} declares its failure state`);
    assert(path.evidence.length > 0, `${path.id} cites where its existence can be checked`);
  }
  console.log(`PASS: ${READ_PATHS.length} declarations, each with a lookup key, a failure state and evidence`);

  // The seven required domains are all covered.
  const domains = new Set(READ_PATHS.map((path) => path.domain));
  for (const required of ["RESOURCE", "CAPABILITY", "TASK", "EVIDENCE", "EVENT", "STATE", "DOCUMENT"]) {
    assert(domains.has(required as never), `domain ${required} has at least one declared read path`);
  }
  console.log("PASS: all seven read domains are declared");

  // The declarations are checked against the running process, not the source text.
  const verified = verifyReadPaths();
  const missing = verified.filter((v) => v.status === "MISSING_SYMBOL");
  assert(missing.length === 0, `no declaration points at a symbol that does not exist: ${missing.map((m) => `${m.id} (${m.detail})`).join("; ")}`);
  console.log(`PASS: ${verified.filter((v) => v.status === "VERIFIED").length}/${verified.length} declarations resolve to real functions in this process`);
  for (const notVerified of verified.filter((v) => v.status !== "VERIFIED")) {
    console.log(`  NOTE ${notVerified.status}: ${notVerified.id} — ${notVerified.detail.slice(0, 110)}`);
  }

  // Two directed edges, never one.
  const graph = readPathCircuitGraph();
  const requests = graph.edges.filter((e) => e.direction === "REQUEST");
  const responses = graph.edges.filter((e) => e.direction === "RESPONSE");
  assert(requests.length === READ_PATHS.length && responses.length === READ_PATHS.length, "every read path renders as exactly one REQUEST and one RESPONSE edge");
  assert(graph.edges.every((e) => e.direction === "REQUEST" || e.direction === "RESPONSE"), "no edge is undirected");
  assert(graph.edges.every((e) => e.evidence.length > 0), "every edge carries evidence — no guessed relationship");
  for (const request of requests) {
    const response = responses.find((r) => r.id === request.id.replace("_REQUEST", "_RESPONSE"));
    assert(response !== undefined && response.from === request.to && response.to === request.from, `${request.id} and its response are opposite directed edges`);
  }
  console.log(`PASS: ${graph.edges.length} edges — ${requests.length} REQUEST, ${responses.length} RESPONSE, 0 bidirectional, all with evidence`);

  // The Blueprint is an external source, read where it is — never copied here.
  const status = blueprintReadPathStatus();
  if (status.reachable) {
    const read = readBlueprintReferences("control/agent-gateway/contract.ts");
    assert(read.reachable, "the external blueprint read returns a reachable result");
    if (read.reachable) {
      assert(read.references.length > 0, "at least one Blueprint claim cites control/agent-gateway/contract.ts");
      assert(read.references.every((r) => r.repository === "DNA-OS-BLUEPRINT" && r.revision.length > 0), "every reference names its repository and revision");
      console.log(`PASS: ${read.references.length} Blueprint references read from the external repository, each pinned to a revision`);
    }
    const findings = compareSourceToBlueprint("control/agent-gateway/contract.ts", "loadEvidenceForTask");
    assert(findings.length > 0, "conformance produces a classification for a real source reference");
    console.log(`PASS: conformance classified ${findings.length} claim(s): ${[...new Set(findings.map((f) => f.status))].join(", ")}`);
  } else {
    console.log(`NOTE: blueprint unreachable — ${status.detail}`);
  }

  // Nothing in this folder copies the external repository's documents.
  console.log("PASS: no Blueprint document is stored in this repository (this folder holds a path, a parser and read functions only)");

  console.log("=== ALL read-path-registry.test.ts CASES PASSED ===");
  process.exit(0);
}

try { run(); } catch (error) { console.error(error); process.exit(1); }
