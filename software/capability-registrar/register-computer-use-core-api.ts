/**
 * หน้าที่: ส่ง `./candidates/computer-use-core-api.ts` ผ่าน Registration Pipeline
 * เดิมเข้าสู่ canonical store เดิม — ไม่มี stage ของตัวเอง ไม่เขียนไฟล์โดยตรง
 *
 * Usage: npx tsx software/capability-registrar/register-computer-use-core-api.ts
 */
import { runRegistrationPipeline } from "../../control/registration-pipeline/contract";
import { createPersistentFileStore } from "../registry-database/adapters/persistent-file-store";
import { findCapability } from "../registry-database/contract";
import { COMPUTER_USE_CORE_API_CANDIDATE } from "./candidates/computer-use-core-api";

function main(): number {
  const store = createPersistentFileStore();
  const result = runRegistrationPipeline(COMPUTER_USE_CORE_API_CANDIDATE, store, "register-computer-use-core-api");
  console.log("=".repeat(74));
  console.log("REGISTRATION PIPELINE — computer-use-core-api");
  console.log("=".repeat(74));
  console.log(`  STATUS       : ${result.status}`);
  if (result.status === "REGISTERED") {
    console.log(`  resource_id  : ${result.resource_id}`);
    console.log(`  capability_id: ${result.capability_id}`);
  } else if (result.status === "DUPLICATE") {
    console.log(`  reason_code  : ${result.reason_code}`);
  } else {
    console.log(`  failed_stage : ${"failed_stage" in result ? result.failed_stage : "-"}`);
    console.log(`  reason_code  : ${"reason_code" in result ? result.reason_code : "-"}`);
  }
  const back = findCapability({ canonical_name: COMPUTER_USE_CORE_API_CANDIDATE.name }, store);
  console.log(`  read back    : ${back ? `${back.capability_id} status=${back.status} in=${(back.input_contract ?? []).length} out=${(back.output_contract ?? []).length}` : "NOT FOUND"}`);
  return result.status === "REGISTERED" || result.status === "DUPLICATE" ? 0 : 1;
}
process.exit(main());
