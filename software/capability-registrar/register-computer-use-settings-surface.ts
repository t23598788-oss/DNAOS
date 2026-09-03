/** Usage: npx tsx software/capability-registrar/register-computer-use-settings-surface.ts */
import { runRegistrationPipeline } from "../../control/registration-pipeline/contract";
import { createPersistentFileStore } from "../registry-database/adapters/persistent-file-store";
import { findCapability } from "../registry-database/contract";
import { COMPUTER_USE_SETTINGS_SURFACE_CANDIDATE } from "./candidates/computer-use-settings-surface";

function main(): number {
  const store = createPersistentFileStore();
  const r = runRegistrationPipeline(COMPUTER_USE_SETTINGS_SURFACE_CANDIDATE, store, "register-computer-use-settings-surface");
  console.log(`STATUS       : ${r.status}`);
  if (r.status === "REGISTERED") { console.log(`resource_id  : ${r.resource_id}`); console.log(`capability_id: ${r.capability_id}`); }
  else if ("reason_code" in r) console.log(`reason_code  : ${r.reason_code}`);
  const back = findCapability({ canonical_name: COMPUTER_USE_SETTINGS_SURFACE_CANDIDATE.name }, store);
  console.log(`read back    : ${back ? `${back.capability_id} in=${(back.input_contract ?? []).length} out=${(back.output_contract ?? []).length}` : "NOT FOUND"}`);
  return r.status === "REGISTERED" || r.status === "DUPLICATE" ? 0 : 1;
}
process.exit(main());
