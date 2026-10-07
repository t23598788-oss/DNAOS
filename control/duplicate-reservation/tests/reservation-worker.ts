/**
 * หน้าที่: a real, separate OS process (launched by
 * ../tests/duplicate-reservation.test.ts's real cross-process test) that
 * attempts one `reserveAndRegister` call against a SHARED real persistent
 * store directory and prints the real outcome to stdout.
 */

import { createPersistentFileStore } from "../../../software/registry-database/adapters/persistent-file-store";
import { reserveAndRegister } from "../contract";
import type { RegistrationCandidate } from "../../event-pipeline/contract";

const [, , dataDir, holderId] = process.argv;
const storeFactory = () => createPersistentFileStore({ dataDir });

const candidate: RegistrationCandidate = {
  candidate_id: `candidate-cross-process-dup-${holderId}`,
  name: "test-cross-process-duplicate-reservation",
  kind: "capability",
  source_location: "control/duplicate-reservation/tests/fixtures/cross-process/",
  // Deliberately CONSTANT across every real OS process in this test — the
  // whole point is that all 15 processes describe the SAME real
  // capability (only candidate_id differs, which the real semantic
  // fingerprint already excludes). A per-process owner would make each
  // process's fingerprint genuinely different, defeating the test (found
  // and fixed live: this exact bug produced 15/15 "REGISTERED" before the
  // fix, which looked like the staleness gap but was actually just 15
  // different fingerprints never contending for the same lock at all).
  owner: "control/duplicate-reservation/tests/duplicate-reservation.test.ts",
  input: [], output: [], side_effects: [], dependencies: [],
  behavior: "a fixed, identical behavior string shared by every real OS process in this cross-process duplicate test",
  version: "1.0.0",
  evidence_refs: ["control/duplicate-reservation/tests/duplicate-reservation.test.ts"],
  domain: "SOFTWARE_CONTROL_PLANE",
  resource_type: "CAPABILITY",
  data_classification: "INTERNAL",
  source_system: "dna-os-infrastructure",
  scope: "test",
};

const result = reserveAndRegister(candidate, storeFactory, `corr-${holderId}`, holderId, 10_000);
const outcome = result.reservation_outcome === "RESERVED_AND_REGISTERED" ? `REGISTERED:${(result.pipeline_result as { status: string }).status}` : "CONFLICT";
process.stdout.write(outcome);
