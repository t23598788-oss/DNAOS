/**
 * หน้าที่: proves the PRODUCTION path — canonical key, real-evidence adapter,
 * and the resume join — against the Owner's cases A–H.
 *
 * The two that matter most are B (near-miss spellings must canonicalise to one
 * key, because a near-miss stalls silently forever) and G (an UNKNOWN fact must
 * produce no event at all, because a false satisfaction wakes work against a
 * world that is not ready).
 *
 * The process-kill proof (case H) is NOT here — it cannot be honestly proven
 * inside one process. It lives in `./restart-proof.mjs`, which really exits and
 * is really re-launched.
 *
 * Run: npx tsx control/work-continuation/tests/event-path.test.ts
 */

import { dependencyKey, capabilityKeyOf, deriveEvents, deriveEventsWithFailures, eventsFromCapability,
         decideResumes, appendWaiting, currentWaiting } from "../contract";
import type { CapabilityRecord } from "../../../software/live-census/contract";
import type { WaitingWork } from "../contract";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

declare const process: { exitCode?: number; cwd(): string };
declare const console: { log(...a: unknown[]): void };

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n      ${JSON.stringify(detail)}`); }
}

function cap(over: Partial<CapabilityRecord> = {}): CapabilityRecord {
  return {
    capability_key: "dna-os-infrastructure:control/demo", capability_id: null, resource_id: null,
    canonical_name: "demo", domain: "test", repository: "dna-os-infrastructure", path: "control/demo",
    entrypoint: "control/demo/contract.ts", version_commit: null, last_changed: null,
    owner_boundary: "control", input_contract: [], output_contract: [], dependencies: [], callers: [],
    downstream: [], runtime_state: "UNKNOWN", test_state: "HAS_TESTS", test_files: [],
    verification_state: "UNVERIFIED", evidence_references: [], registration_state: "UNREGISTERED",
    registry_matches: [], lineage: [], supersedes: [], duplicates: [], security_boundary: [],
    source_digest: "d1", last_observed: "2026-08-26T00:00:00.000Z", last_verified: null,
    current_status: "UNVERIFIED", status_reason: "synthetic", ...over,
  } as CapabilityRecord;
}
function work(over: Partial<WaitingWork> = {}): WaitingWork {
  return {
    work_id: "work-1", current_phase: "BUILD", status: "WAITING",
    blocked_on: [dependencyKey("verification", "control/demo")],
    required_evidence: [], required_resources: [], required_capabilities: [],
    required_runtime_state: [], required_external_state: [],
    resume_condition: "ALL_AVAILABLE", exact_state: null, next_action: "continue step 3",
    resolved_work_context_ref: "resolution-abc", last_verified_revision: null, evidence_refs: [],
    resume_attempt_count: 0, last_resume_reason: null, last_input_digest: null, last_result_digest: null,
    required_worker_class: "DETERMINISTIC_TEST", recorded_at: "2026-08-26T00:00:00.000Z", ...over,
  };
}
const NO_DIGEST = () => null;

function main(): void {
  // ---- 1. CANONICAL KEY (Owner requirement 1) ----
  const variants = ["control/x", "/control/x", "control/x/", `${process.cwd()}/control/x`];
  const keys = variants.map((v) => dependencyKey("path", v));
  check("1A. all four path spellings canonicalise to ONE key",
    new Set(keys).size === 1 && keys[0] === "path:control/x", keys);
  check("1B. different resources produce different keys",
    dependencyKey("path", "control/x") !== dependencyKey("path", "control/y"));
  check("1C. a `#symbol` suffix is preserved while the path is canonicalised",
    dependencyKey("caller", "/control/x/#doThing") === "caller:control/x#doThing",
    dependencyKey("caller", "/control/x/#doThing"));
  check("1D. non-path namespaces are NOT path-normalised (ids/fields stay verbatim)",
    dependencyKey("contract_field", "input_source") === "contract_field:input_source" &&
    dependencyKey("owner", "decision:buy-seat") === "owner:decision:buy-seat");
  check("1E. a refused path (..) is returned verbatim and simply never matches — never invented",
    dependencyKey("path", "control/../../etc") === "path:control/../../etc");
  check("1F. capabilityKeyOf uses the census path form",
    capabilityKeyOf("control/work-session-state") === "capability:control/work-session-state");

  // ---- 2. EVENT ADAPTER from real evidence shapes ----
  const verified = eventsFromCapability(cap({ current_status: "VERIFIED", evidence_references: ["tests=9/0"] }), "T");
  check("2A. a VERIFIED capability emits a verification event",
    verified.some((e) => e.key === "verification:control/demo" && e.value === "VERIFIED"), verified.map((e) => e.key));
  check("2B. that event carries the REAL evidence_ref, not a placeholder",
    verified.find((e) => e.key === "verification:control/demo")!.evidence_ref === "tests=9/0");
  const failed_ = eventsFromCapability(cap({ current_status: "FAILED" }), "T");
  check("2C. a FAILED capability emits NO verification event (failure is not satisfaction)",
    !failed_.some((e) => e.key.startsWith("verification:")), failed_.map((e) => e.key));
  const registered = eventsFromCapability(cap({ registration_state: "REGISTERED", capability_id: "capability-abc", resource_id: "resource-xyz" }), "T");
  check("2D. registration emits registry + resource events with real ids",
    registered.some((e) => e.key === "registry:control/demo") &&
    registered.some((e) => e.key === "resource:resource-xyz"), registered.map((e) => e.key));
  const live = eventsFromCapability(cap({ runtime_state: "IN_USE_NOW" }), "T");
  check("2E. evidence-backed runtime emits runtime + runtime_evidence events",
    live.some((e) => e.key === "runtime:control/demo") && live.some((e) => e.key === "runtime_evidence:control/demo"));

  // ---- CASE G: UNKNOWN produces no false satisfaction ----
  const unknown = eventsFromCapability(cap({ runtime_state: "UNKNOWN", registration_state: "UNKNOWN", current_status: "UNKNOWN" }), "T");
  check("G1. an UNKNOWN capability emits NO runtime event",
    !unknown.some((e) => e.key.startsWith("runtime")), unknown.map((e) => e.key));
  check("G2. an UNKNOWN capability emits NO verification event",
    !unknown.some((e) => e.key.startsWith("verification:")));
  check("G3. an UNKNOWN capability emits NO registry event",
    !unknown.some((e) => e.key.startsWith("registry:")));
  const declared = eventsFromCapability(cap({ current_status: "DECLARED_ONLY", entrypoint: null }), "T");
  check("G4. a DECLARED_ONLY folder emits nothing at all — presence is not a dependency",
    declared.length === 0, declared);

  // ---- CASE A: exact dependency satisfied -> resumes ----
  const rowsA = [work({ work_id: "work-A" })];
  const evA = eventsFromCapability(cap({ current_status: "VERIFIED" }), "T");
  const decA = decideResumes(rowsA, evA, NO_DIGEST, NO_DIGEST, "T");
  check("A1. the real verification event resumes the waiting work",
    decA.length === 1 && decA[0].evaluation.verdict === "RESUME_ELIGIBLE", decA[0]?.evaluation);
  check("A2. the decision carries the PERSISTED next_action — nothing is re-derived",
    decA[0].next_action === "continue step 3" && decA[0].resolved_work_context_ref === "resolution-abc");

  // ---- CASE B: near-miss spelling still resumes ----
  const rowsB = [work({ work_id: "work-B", blocked_on: [dependencyKey("path", "/control/demo/contract.ts/")] })];
  const evB = eventsFromCapability(cap(), "T");   // producer emits path:control/demo/contract.ts
  const decB = decideResumes(rowsB, evB, NO_DIGEST, NO_DIGEST, "T");
  check("B1. a near-miss spelling recorded by the producer still matches the event",
    decB.length === 1 && decB[0].evaluation.verdict === "RESUME_ELIGIBLE", decB.map((d) => d.evaluation.reason));

  // ---- CASE C: unrelated event leaves work waiting ----
  const decC = decideResumes([work({ work_id: "work-C" })],
    eventsFromCapability(cap({ path: "control/somethingelse", entrypoint: "control/somethingelse/contract.ts", current_status: "VERIFIED" }), "T"),
    NO_DIGEST, NO_DIGEST, "T");
  check("C1. an unrelated capability event selects NO waiting work", decC.length === 0, decC);

  // ---- CASE D: one of several required deps satisfied -> still waiting ----
  const rowsD = [work({ work_id: "work-D", blocked_on: [dependencyKey("verification", "control/demo"), dependencyKey("registry", "control/other")] })];
  const decD = decideResumes(rowsD, eventsFromCapability(cap({ current_status: "VERIFIED" }), "T"), NO_DIGEST, NO_DIGEST, "T");
  check("D1. ALL_AVAILABLE with one of two satisfied stays blocked",
    decD[0].evaluation.verdict === "STILL_BLOCKED", decD[0].evaluation.reason);
  check("D2. the verdict names what is still missing", decD[0].evaluation.missing.length === 1, decD[0].evaluation.missing);

  // ---- CASE E: all satisfied -> resumes exactly once ----
  const rowsE = [work({ work_id: "work-E", blocked_on: [dependencyKey("verification", "control/demo"), dependencyKey("capability", "control/demo")] })];
  const decE = decideResumes(rowsE, eventsFromCapability(cap({ current_status: "VERIFIED" }), "T"), NO_DIGEST, NO_DIGEST, "T");
  check("E1. all dependencies satisfied -> RESUME_ELIGIBLE", decE[0].evaluation.verdict === "RESUME_ELIGIBLE", decE[0].evaluation);
  check("E2. TWO matching events in one batch still produce exactly ONE decision",
    decE.length === 1, decE.length);
  check("E3. the SAME work_id is preserved", decE[0].work_id === "work-E");

  // ---- CASE F: duplicate event -> no duplicate execution ----
  const already = work({ work_id: "work-F", resume_attempt_count: 1, last_result_digest: "r1" });
  const evF = eventsFromCapability(cap({ current_status: "VERIFIED" }), "T");
  const first = decideResumes([already], evF, NO_DIGEST, NO_DIGEST, "T");
  const withDigest = work({ ...already, last_input_digest: first[0].evaluation.input_digest });
  const replay = decideResumes([withDigest], evF, NO_DIGEST, () => "r1", "T");
  check("F1. replaying the identical event with an unchanged result is refused",
    replay[0].evaluation.verdict === "STILL_BLOCKED", replay[0].evaluation.reason);

  // ---- full-census projection is deterministic ----
  const census = { generated_at: "T", repository: "r", head_commit: "h",
    capabilities: [cap({ current_status: "VERIFIED" }), cap({ path: "control/two", entrypoint: "control/two/contract.ts" })],
    drift: [], totals: {} } as never;
  const a = deriveEvents(census), b = deriveEvents(census);
  check("K1. deriveEvents is a pure projection — same census, same events",
    JSON.stringify(a) === JSON.stringify(b) && a.length > 0);

  // ---- REGRESSION: one malformed record must not kill the batch ----
  // Found by peer review 2026-08-26. Previously `record.evidence_references[...]`
  // threw on a record missing the field, and because callers wrap producers in
  // try/catch the observable result was "0 events" — indistinguishable from
  // "nothing became available". A silent stall wearing the costume of patience.
  const healthy = cap({ current_status: "VERIFIED", path: "control/ok", entrypoint: "control/ok/contract.ts" });
  const malformed = { ...cap({ current_status: "VERIFIED", path: "control/bad" }), evidence_references: undefined } as unknown as CapabilityRecord;
  const mixed = { generated_at: "T", repository: "r", head_commit: "h",
    capabilities: [healthy, malformed, cap({ path: "control/three", entrypoint: "control/three/contract.ts" })],
    drift: [], totals: {} } as never;
  let threw = false;
  let got: ReturnType<typeof deriveEventsWithFailures> = { events: [], failures: [] };
  try { got = deriveEventsWithFailures(mixed); } catch { threw = true; }
  check("L1. a malformed record no longer throws the whole batch", !threw);
  check("L2. the healthy records still produce their events",
    got.events.some((e) => e.key === "verification:control/ok") &&
    got.events.some((e) => e.key === "capability:control/three"), got.events.map((e) => e.key));
  check("L3. a record merely MISSING evidence_references now succeeds via the fallback, not fails",
    got.failures.length === 0 &&
    got.events.find((e) => e.key === "verification:control/bad")?.evidence_ref === "census:d1",
    { failures: got.failures, ref: got.events.find((e) => e.key === "verification:control/bad")?.evidence_ref });

  // Isolation still has to work for a malformation the fallback CANNOT absorb.
  // A throwing getter stands in for "some future record shape we did not foresee".
  const hostile = { ...cap({ path: "control/hostile", current_status: "VERIFIED" }) } as Record<string, unknown>;
  Object.defineProperty(hostile, "entrypoint", { get() { throw new Error("hostile record"); } });
  const isolated = deriveEventsWithFailures({ generated_at: "T", repository: "r", head_commit: "h",
    capabilities: [healthy, hostile as unknown as CapabilityRecord], drift: [], totals: {} } as never);
  check("L3b. a record that genuinely throws costs ONLY its own events",
    isolated.events.some((e) => e.key === "verification:control/ok"), isolated.events.map((e) => e.key));
  check("L3c. and it is REPORTED by path, so a crashed producer cannot look like an empty batch",
    isolated.failures.length === 1 && isolated.failures[0].capability_path === "control/hostile" &&
    isolated.failures[0].error.includes("hostile record"), isolated.failures);
  check("L4. deriveEvents stays compatible and returns only the good events",
    deriveEvents(mixed).length === got.events.length);
  check("L5. a healthy census reports zero failures",
    deriveEventsWithFailures(census).failures.length === 0);

  // ---- persistence round-trip on a real file ----
  const dir = mkdtempSync(join(tmpdir(), "wc-ev-"));
  const path = join(dir, "w.jsonl");
  appendWaiting(work({ work_id: "work-P" }), path);
  check("K2. a waiting row round-trips through the real store",
    currentWaiting(path)[0].work_id === "work-P");
  rmSync(dir, { recursive: true, force: true });
}

main();
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
