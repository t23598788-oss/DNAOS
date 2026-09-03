import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalFileStore } from "../adapters/local-file-store";
import { runRegistrationPipeline } from "../../../control/registration-pipeline/contract";
import type { RegistrationCandidate } from "../../../control/event-pipeline/contract";

const root = mkdtempSync(join(tmpdir(), "dna-resource-projection-"));
const store = createLocalFileStore({ dataDir: root });
const ref = { identity_type: "repository", identity_id: "repository://t23598788-oss/dna-os-control-workspace" };
function candidate(kind: string): RegistrationCandidate {
  return { candidate_id: `projection-${kind}`, name: `projection-${kind}`, kind: "resource", source_location: "/Users/tam/Desktop/dna-os-control-workspace", owner: "projection-test", input: [], output: [], side_effects: [], dependencies: [], behavior: "canonical resource projection", version: "1.0.0", evidence_refs: ["canonical-resource-projection-persistence.test.ts"], domain: "SOFTWARE_CONTROL_PLANE", resource_type: "SOFTWARE_RESOURCE", data_classification: "INTERNAL", source_system: "dna-os-infrastructure", scope: `projection-${kind}`, canonical_ref: ref, projection_kind: kind };
}
const first = runRegistrationPipeline(candidate("workspace"), store, "projection-corr-1");
if (first.status !== "REGISTERED") throw new Error(`first registration failed: ${first.status}`);
const row = store.listResourceRows!().find((r) => r.resource_id === first.resource_id);
if (!row || row.canonical_ref?.identity_id !== ref.identity_id || row.projection_kind !== "workspace") throw new Error("projection fields were not preserved in read-back row");
const second = runRegistrationPipeline(candidate("workspace"), store, "projection-corr-2");
if (second.status !== "DUPLICATE" || second.duplicate_of.resource_id !== first.resource_id) throw new Error("canonical duplicate was not idempotent");
const different = runRegistrationPipeline(candidate("repository"), store, "projection-corr-3");
if (different.status !== "REGISTERED") throw new Error("different projection kind was incorrectly deduplicated");
const persisted = JSON.parse(readFileSync(join(root, "resources.jsonl"), "utf8").trim().split("\n")[0]);
if (persisted.canonical_ref.identity_id !== ref.identity_id || persisted.projection_kind !== "workspace") throw new Error("persisted JSONL projection fields missing");
const invalid: any = { ...candidate("invalid"), canonical_ref: { identity_type: "", identity_id: "" } };
const beforeInvalid = store.debugCounts().resources;
const invalidResult = runRegistrationPipeline(invalid, store, "projection-corr-invalid");
if (invalidResult.status !== "REJECTED" || store.debugCounts().resources !== beforeInvalid) throw new Error("invalid canonical_ref was not rejected before write");
console.log("PASS canonical projection preservation, duplicate idempotency, and different projection kind");
