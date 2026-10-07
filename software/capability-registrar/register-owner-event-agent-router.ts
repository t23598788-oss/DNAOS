/**
 * หน้าที่: submit `./candidates/owner-event-agent-router.ts` through the
 * EXISTING Registration Pipeline into the EXISTING canonical persistent
 * store — same orchestration as
 * `./register-real-work-resource-cost.ts`, which is why this file adds no
 * stage of its own and writes to no file directly.
 *
 * Usage: npx tsx software/capability-registrar/register-owner-event-agent-router.ts
 */

import { runRegistrationPipeline } from "../../control/registration-pipeline/contract";
import { createPersistentFileStore } from "../registry-database/adapters/persistent-file-store";
import { findCapability } from "../registry-database/contract";
import { OWNER_EVENT_AGENT_ROUTER_CANDIDATE } from "./candidates/owner-event-agent-router";

function main(): number {
  const store = createPersistentFileStore();
  const result = runRegistrationPipeline(OWNER_EVENT_AGENT_ROUTER_CANDIDATE, store, "register-owner-event-agent-router-cli");

  console.log("=".repeat(78));
  console.log("REGISTRATION PIPELINE — owner-event-agent-router");
  console.log("=".repeat(78));
  console.log(`  STATUS       : ${result.status}`);
  if (result.status === "REGISTERED") {
    console.log(`  resource_id  : ${result.resource_id}`);
    console.log(`  capability_id: ${result.capability_id}`);
    console.log(`  repository_id: ${result.repository_id ?? "NOT_APPLICABLE (no repository claim made)"}`);
  } else if (result.status === "DUPLICATE") {
    console.log(`  reason_code  : ${result.reason_code}`);
    console.log(`  duplicate_of : ${JSON.stringify(result.duplicate_of)}`);
  } else {
    console.log(`  failed_stage : ${"failed_stage" in result ? result.failed_stage : "-"}`);
    console.log(`  reason_code  : ${"reason_code" in result ? result.reason_code : "-"}`);
  }

  const lookup = findCapability({ canonical_name: OWNER_EVENT_AGENT_ROUTER_CANDIDATE.name }, store);
  console.log(`  lookup back  : ${lookup ? `${lookup.capability_id} status=${lookup.status}` : "NOT FOUND"}`);
  return result.status === "REGISTERED" || result.status === "DUPLICATE" ? 0 : 1;
}

process.exit(main());
