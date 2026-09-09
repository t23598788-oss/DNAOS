/**
 * Register the existing Owner Command display/history knowledge through the
 * existing Registration Pipeline. No direct JSONL append and no execution
 * route are introduced.
 *
 * Usage: npx tsx software/capability-registrar/register-owner-command-display-history.ts
 */
import { runRegistrationPipeline } from "../../control/registration-pipeline/contract";
import { createPersistentFileStore } from "../registry-database/adapters/persistent-file-store";
import { findCapability } from "../registry-database/contract";
import { OWNER_COMMAND_DISPLAY_HISTORY_CANDIDATE } from "./candidates/owner-command-display-history";

function main(): number {
  const candidate = OWNER_COMMAND_DISPLAY_HISTORY_CANDIDATE;
  const store = createPersistentFileStore();
  const before = findCapability({ canonical_name: candidate.name }, store);
  const result = runRegistrationPipeline(candidate, store, "register-owner-command-display-history-cli");

  console.log(JSON.stringify({
    candidate_id: candidate.candidate_id,
    canonical_name: candidate.name,
    pre_existing_capability_id: before?.capability_id ?? null,
    result,
  }, null, 2));

  return result.status === "REGISTERED" || result.status === "DUPLICATE" ? 0 : 1;
}

process.exit(main());
