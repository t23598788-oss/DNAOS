/** Usage: npx tsx software/capability-registrar/register-n8n-behavior-test-harness.ts */
import { runRegistrationPipeline } from "../../control/registration-pipeline/contract";
import { createPersistentFileStore } from "../registry-database/adapters/persistent-file-store";
import { findCapability } from "../registry-database/contract";
import { N8N_TEST_HARNESS_CANDIDATES } from "./candidates/n8n-behavior-test-harness";
function main(): number {
  const store = createPersistentFileStore();
  console.log("REGISTRATION PIPELINE — n8n behavior test harness");
  let ok = 0, bad = 0;
  for (const c of N8N_TEST_HARNESS_CANDIDATES) {
    const before = findCapability({ canonical_name: c.name }, store);
    const r = runRegistrationPipeline(c, store, "register-n8n-behavior-test-harness-cli");
    console.log(`  ${c.name.padEnd(34)} ${r.status}${r.status === "REGISTERED" ? " " + r.capability_id : ""}${before ? " (was " + before.capability_id + ")" : ""}`);
    if (r.status === "REGISTERED" || r.status === "DUPLICATE") ok++; else { bad++; console.log("     reason:", "reason_code" in r ? r.reason_code : r); }
  }
  console.log(`OK=${ok} REJECTED=${bad}`);
  return bad === 0 ? 0 : 1;
}
process.exit(main());
