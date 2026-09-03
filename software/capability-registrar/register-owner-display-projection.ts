/**
 * หน้าที่: ส่ง `./candidates/owner-display-projection.ts` ผ่าน Registration
 * Pipeline เดิม (Candidate -> Duplicate Gate -> Registry Writer) เข้าสู่
 * canonical persistent store เดิม — เหมือน
 * `./register-service-lifecycle-supervision.ts` ทุกประการ ไฟล์นี้จึงไม่มี
 * stage ของตัวเอง และไม่เขียนไฟล์ใดโดยตรง
 *
 * Usage: npx tsx software/capability-registrar/register-owner-display-projection.ts
 */

import { runRegistrationPipeline } from "../../control/registration-pipeline/contract";
import { createPersistentFileStore } from "../registry-database/adapters/persistent-file-store";
import { findCapability } from "../registry-database/contract";
import { OWNER_DISPLAY_PROJECTION_CANDIDATE } from "./candidates/owner-display-projection";

function main(): number {
  const store = createPersistentFileStore();
  const result = runRegistrationPipeline(OWNER_DISPLAY_PROJECTION_CANDIDATE, store, "register-owner-display-projection-phase2");

  console.log("=".repeat(78));
  console.log("REGISTRATION PIPELINE — owner-display-projection");
  console.log("=".repeat(78));
  console.log(`  STATUS       : ${result.status}`);
  if (result.status === "REGISTERED") {
    console.log(`  resource_id  : ${result.resource_id}`);
    console.log(`  capability_id: ${result.capability_id}`);
  } else if (result.status === "DUPLICATE") {
    console.log(`  reason_code  : ${result.reason_code}`);
    console.log(`  duplicate_of : ${JSON.stringify(result.duplicate_of)}`);
  } else {
    console.log(`  failed_stage : ${"failed_stage" in result ? result.failed_stage : "-"}`);
    console.log(`  reason_code  : ${"reason_code" in result ? result.reason_code : "-"}`);
  }

  // READ BACK — ผ่าน port เดิม ไม่ได้อ่านไฟล์ตรง ๆ
  const lookup = findCapability({ canonical_name: OWNER_DISPLAY_PROJECTION_CANDIDATE.name }, store);
  console.log(`  read back    : ${lookup ? `${lookup.capability_id} status=${lookup.status}` : "NOT FOUND"}`);
  return result.status === "REGISTERED" || result.status === "DUPLICATE" ? 0 : 1;
}

process.exit(main());
