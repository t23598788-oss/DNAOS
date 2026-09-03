/**
 * หน้าที่: submit `./candidates/real-work-resource-cost-measurement.ts`
 * through the EXISTING Registration Pipeline into the EXISTING canonical
 * persistent store. This file orchestrates; it implements no stage of its
 * own and writes to no file directly.
 *
 *   Candidate -> control/registration-pipeline/#runRegistrationPipeline
 *             -> (Validation, Classification, Duplicate Resolution,
 *                 Decision, Repository Resolution, Registry Writer)
 *             -> software/registry-database/adapters/persistent-file-store
 *                (data/canonical/*.jsonl — the live server's real store)
 *
 * `createPersistentFileStore` and not `createLocalFileStore`: the local one
 * is documented test-only and writes to a throwaway per-run directory, so a
 * registration made through it would vanish. The persistent store rehydrates
 * from data/canonical/ on construction, which is also what makes the
 * Duplicate Gate real here — it reads back every previously registered
 * capability before deciding this one is new.
 *
 * Idempotent by construction: a second run reaches Duplicate Resolution,
 * which recognises the identical semantic fingerprint and returns DUPLICATE
 * instead of writing a second row. That is a correct outcome, not a failure,
 * and this script reports it as such.
 *
 * Usage: npx tsx software/capability-registrar/register-real-work-resource-cost.ts
 */

import { runRegistrationPipeline } from "../../control/registration-pipeline/contract";
import { createPersistentFileStore } from "../registry-database/adapters/persistent-file-store";
import { findCapability } from "../registry-database/contract";
import { REAL_WORK_RESOURCE_COST_CANDIDATE } from "./candidates/real-work-resource-cost-measurement";

function main(): number {
  const store = createPersistentFileStore();
  const correlationId = `register-real-work-resource-cost-${process.env.CORRELATION_ID ?? "cli"}`;

  console.log("=".repeat(78));
  console.log("REGISTRATION PIPELINE");
  console.log("=".repeat(78));
  console.log(`  candidate_id : ${REAL_WORK_RESOURCE_COST_CANDIDATE.candidate_id}`);
  console.log(`  name         : ${REAL_WORK_RESOURCE_COST_CANDIDATE.name}`);
  console.log(`  domain       : ${REAL_WORK_RESOURCE_COST_CANDIDATE.domain}`);
  console.log(`  resource_type: ${REAL_WORK_RESOURCE_COST_CANDIDATE.resource_type}`);
  console.log(`  scope        : ${REAL_WORK_RESOURCE_COST_CANDIDATE.scope}`);
  console.log(`  evidence     : ${REAL_WORK_RESOURCE_COST_CANDIDATE.evidence_refs.length} refs`);

  const result = runRegistrationPipeline(REAL_WORK_RESOURCE_COST_CANDIDATE, store, correlationId);

  console.log("");
  console.log(`  STATUS       : ${result.status}`);
  if (result.status === "REGISTERED") {
    console.log(`  resource_id  : ${result.resource_id}`);
    console.log(`  capability_id: ${result.capability_id}`);
    console.log(`  repository_id: ${result.repository_id ?? "NOT_APPLICABLE (no repository claim made)"}`);
  } else if (result.status === "DUPLICATE") {
    console.log(`  reason_code  : ${result.reason_code}`);
    console.log(`  duplicate_of : ${JSON.stringify(result.duplicate_of)}`);
    console.log("  Already registered — the Duplicate Gate did its job; nothing was written twice.");
  } else {
    console.log(`  failed_stage : ${"failed_stage" in result ? result.failed_stage : "-"}`);
    console.log(`  reason_code  : ${"reason_code" in result ? result.reason_code : "-"}`);
  }

  // Read it back through the Lookup API, not through the store internals:
  // proving the row is findable by the same path any consumer would use is
  // the only thing that shows the registration actually landed.
  const lookup = findCapability({ canonical_name: REAL_WORK_RESOURCE_COST_CANDIDATE.name }, store);
  console.log("");
  console.log("  LOOKUP BACK (findCapability by canonical_name):");
  console.log(`    ${lookup ? JSON.stringify(lookup, null, 2).split("\n").join("\n    ") : "NOT FOUND"}`);

  // DUPLICATE is a success for this script's purpose: the capability is in
  // the registry either way. Only a genuine rejection is a failure.
  return result.status === "REGISTERED" || result.status === "DUPLICATE" ? 0 : 1;
}

process.exit(main());
