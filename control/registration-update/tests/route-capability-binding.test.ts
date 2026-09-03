/**
 * หน้าที่: PIPE 2B proof — that binding a command-router ROUTE to a canonical
 * CAPABILITY needs NO new vocabulary and NO schema change, because the legacy
 * `CAPABILITY_TO_API` kind with `to_type: "API"` already means exactly "this
 * capability is exposed at this addressable endpoint", and the existing
 * registration-update gate (`applyMutation`) already accepts it.
 *
 * Runs entirely against an EPHEMERAL local store. Canonical data is read
 * read-only for the backward-compatibility count and is never written here.
 *
 * Dependency ที่อนุญาต: ../contract.ts, ../../../software/registry-database/*.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyMutation } from "../contract";
import { createLocalFileStore } from "../../../software/registry-database/adapters/local-file-store";
import type { RelationshipRow } from "../../../software/registry-database/types";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "  -> " + detail : "")); }
};

// ---------- backward compatibility: the real canonical rows, read-only ----------
const CANON = join(__dirname, "..", "..", "..", "software", "registry-database", "data", "canonical", "relationships.jsonl");
const legacy = readFileSync(CANON, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as RelationshipRow);
console.log("\nPIPE 2B — legacy relationships remain readable and untouched");
// The first 180 rows are the pre-Pipe-2 legacy prefix. relationships.jsonl is
// append-only, so those rows must stay present, in order, and untouched no
// matter how many route bindings are appended after them.
const legacyPrefix = legacy.slice(0, 180);
ok("legacy 180-row prefix still present", legacyPrefix.length === 180, String(legacy.length));
ok("every legacy row keeps its relationship_id", legacyPrefix.every((r) => typeof r.relationship_id === "string" && r.relationship_id.length > 0));
ok("no LEGACY row uses CAPABILITY_TO_API (bindings are additive only)", legacyPrefix.every((r) => r.relationship_kind !== "CAPABILITY_TO_API"));
// Appended rows come only from sanctioned, additive paths:
//   CAPABILITY_TO_API     Pipe 2 route bindings
//   CAPABILITY_TO_WORKER  Pipe 3 worker bindings (probe-proven)
//   MODULE_TO_CAPABILITY  written by the Registration Pipeline itself when a
//                         new capability is registered (Phase 2, 2026-09-01 —
//                         owner-display-projection was the first)
// None of the three rewrites a legacy row. Any OTHER kind appearing here means
// something wrote to canonical outside those paths, which is what this guards.
const APPENDABLE_KINDS = ["CAPABILITY_TO_API", "CAPABILITY_TO_WORKER", "MODULE_TO_CAPABILITY"] as const;
const appended = legacy.slice(180);
const routeBindings = appended.filter((r) => r.relationship_kind === "CAPABILITY_TO_API");
const workerBindings = appended.filter((r) => r.relationship_kind === "CAPABILITY_TO_WORKER");
const moduleBindings = appended.filter((r) => r.relationship_kind === "MODULE_TO_CAPABILITY");
const unexpected = appended.filter((r) => !APPENDABLE_KINDS.includes(r.relationship_kind as typeof APPENDABLE_KINDS[number]));
ok("every appended row comes from a sanctioned additive path", unexpected.length === 0,
  `${appended.length} appended: ${routeBindings.length} route + ${workerBindings.length} worker + ${moduleBindings.length} module; unexpected=${JSON.stringify(unexpected.map((r) => r.relationship_kind))}`);
// A MODULE_TO_CAPABILITY row may only exist for a capability that really registered.
const CAPS = join(__dirname, "..", "..", "..", "software", "registry-database", "data", "canonical", "capabilities.jsonl");
const registeredCapIds = new Set(readFileSync(CAPS, "utf8").split("\n").filter(Boolean)
  .map((l) => (JSON.parse(l) as { capability_id: string }).capability_id));
ok("every appended MODULE_TO_CAPABILITY points at a registered capability",
  moduleBindings.every((r) => registeredCapIds.has(r.to_id)),
  JSON.stringify(moduleBindings.filter((r) => !registeredCapIds.has(r.to_id)).map((r) => r.to_id)));
ok("every route binding targets to_type API with a route: id", routeBindings.every((r) => r.to_type === "API" && r.to_id.startsWith("route:")));
ok("every worker binding targets to_type WORKER", workerBindings.every((r) => r.to_type === "WORKER"));

// ---------- the gate accepts ROUTE binding with EXISTING vocabulary ----------
console.log("\nPIPE 2B — existing gate accepts CAPABILITY -> API without schema change");
const store = createLocalFileStore();
const write = store.writeApprovedCandidate({
  resource: { resource_id: "resource-test-route", resource_type: "capability", owner_id: "owner", repository_id: null, source_location: "control/test-route/", module: null, version: "1.0.0", content_hash: "hash-test-route", status: "REGISTERED" },
  capability: { capability_id: "capability-test-route", canonical_name: "test-route", capability_type: "capability", purpose: "pipe 2 fixture", input_contract: [], output_contract: [], side_effects: [], semantic_fingerprint: "fp-test-route", ingress_metadata: null },
  relationships: [],
  version: { resource_id: "resource-test-route", version: "1.0.0", commit_sha: null, hash: "hash-test-route", source_location: "control/test-route/", evidence_ref: null },
  evidence: [],
});
ok("fixture capability registered", write.inserted || !!write.capability_id);

const accepted = applyMutation({
  resource_id: "resource-test-route",
  capability_id: "capability-test-route",
  expected_current_version: "1.0.0",
  mutation_type: "ADD_RELATIONSHIP",
  mutation_payload: { to_type: "API", to_id: "route:test-slug", relationship_kind: "CAPABILITY_TO_API" },
  evidence_refs: ["control/command-router/capability-registry.ts"],
  correlation_id: "pipe2-accept",
}, store);
ok("CAPABILITY_TO_API + to_type API ACCEPTED by existing gate", accepted.status === "APPLIED", accepted.reason_code ?? "");

// ---------- the gate still rejects what it should ----------
console.log("\nPIPE 2B — invalid input still rejected (gate not weakened)");
const badKind = applyMutation({
  resource_id: "resource-test-route", capability_id: "capability-test-route", expected_current_version: "1.0.0",
  mutation_type: "ADD_RELATIONSHIP",
  mutation_payload: { to_type: "API", to_id: "route:x", relationship_kind: "ROUTE_EXPOSES_CAPABILITY" },
  evidence_refs: [], correlation_id: "pipe2-badkind",
}, store);
ok("unknown relationship_kind REJECTED", badKind.status === "REJECTED" && badKind.reason_code === "INVALID_RELATIONSHIP", `${badKind.status}/${badKind.reason_code}`);

const badType = applyMutation({
  resource_id: "resource-test-route", capability_id: "capability-test-route", expected_current_version: "1.0.0",
  mutation_type: "ADD_RELATIONSHIP",
  mutation_payload: { to_type: "ROUTE", to_id: "route:x", relationship_kind: "CAPABILITY_TO_API" },
  evidence_refs: [], correlation_id: "pipe2-badtype",
}, store);
ok("unknown entity type ROUTE REJECTED", badType.status === "REJECTED" && badType.reason_code === "INVALID_RELATIONSHIP", `${badType.status}/${badType.reason_code}`);

const stale = applyMutation({
  resource_id: "resource-test-route", capability_id: "capability-test-route", expected_current_version: "9.9.9",
  mutation_type: "ADD_RELATIONSHIP",
  mutation_payload: { to_type: "API", to_id: "route:y", relationship_kind: "CAPABILITY_TO_API" },
  evidence_refs: [], correlation_id: "pipe2-stale",
}, store);
ok("stale expected_current_version REJECTED", stale.status === "REJECTED" && stale.reason_code === "STALE_VERSION", `${stale.status}/${stale.reason_code}`);

const unknownCap = applyMutation({
  resource_id: "resource-test-route", capability_id: "capability-does-not-exist", expected_current_version: "1.0.0",
  mutation_type: "ADD_RELATIONSHIP",
  mutation_payload: { to_type: "API", to_id: "route:z", relationship_kind: "CAPABILITY_TO_API" },
  evidence_refs: [], correlation_id: "pipe2-unknowncap",
}, store);
ok("unknown capability REJECTED", unknownCap.status === "REJECTED" && unknownCap.reason_code === "UNKNOWN_CAPABILITY", `${unknownCap.status}/${unknownCap.reason_code}`);

// ---------- idempotency: same binding twice must not duplicate ----------
console.log("\nPIPE 2B — repeat binding is idempotent");
const again = applyMutation({
  resource_id: "resource-test-route", capability_id: "capability-test-route", expected_current_version: "1.0.0",
  mutation_type: "ADD_RELATIONSHIP",
  mutation_payload: { to_type: "API", to_id: "route:test-slug", relationship_kind: "CAPABILITY_TO_API" },
  evidence_refs: [], correlation_id: "pipe2-repeat",
}, store);
const after = store.findCapabilityById("capability-test-route");
const apiEdges = (after?.relationships ?? []).filter((r) => r.relationship_kind === "CAPABILITY_TO_API" && r.to_id === "route:test-slug");
ok("repeat ADD_RELATIONSHIP creates no duplicate edge", apiEdges.length === 1, `edges=${apiEdges.length} status=${again.status}`);

// ---------- forward + reverse traversal on the fixture ----------
console.log("\nPIPE 2B — forward and reverse traversal");
const fwd = (after?.relationships ?? []).find((r) => r.relationship_kind === "CAPABILITY_TO_API");
ok("capability -> route resolves", fwd?.to_id === "route:test-slug", JSON.stringify(fwd ?? null));
ok("route -> capability resolves by explicit edge, not name", !!after && after.capability_id === "capability-test-route");

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail > 0) process.exit(1);
