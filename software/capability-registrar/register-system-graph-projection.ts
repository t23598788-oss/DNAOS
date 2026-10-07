/**
 * หน้าที่: ส่ง `./candidates/system-graph-projection.ts` เข้า Registration
 * Pipeline ที่มีอยู่ ไปยังสโตร์ canonical ที่มีอยู่ — โครงเดียวกับ
 * `./register-control-workspace-resilience.ts` ไฟล์นี้จึงไม่เพิ่มขั้นตอนใด
 * และไม่เขียนไฟล์ใดโดยตรง Duplicate Gate อยู่ในไปป์ไลน์ ไม่ใช่ที่นี่
 *
 * Usage: npx tsx software/capability-registrar/register-system-graph-projection.ts
 */

import { runRegistrationPipeline } from "../../control/registration-pipeline/contract";
import { createPersistentFileStore } from "../registry-database/adapters/persistent-file-store";
import { SYSTEM_GRAPH_PROJECTION_CANDIDATE } from "./candidates/system-graph-projection";

function main(): number {
  const store = createPersistentFileStore();
  const result = runRegistrationPipeline(SYSTEM_GRAPH_PROJECTION_CANDIDATE, store, "register-system-graph-projection-cli");

  console.log("=".repeat(70));
  console.log("REGISTRATION PIPELINE — system-graph-projection");
  console.log("=".repeat(70));
  console.log(`  STATUS       : ${result.status}`);
  if (result.status === "REGISTERED") {
    console.log(`  resource_id  : ${result.resource_id}`);
    console.log(`  capability_id: ${result.capability_id}`);
    console.log(`  repository_id: ${result.repository_id ?? "NOT_APPLICABLE"}`);
    return 0;
  }
  console.log(`  reason_code  : ${"reason_code" in result ? result.reason_code : "-"}`);
  if ("duplicate_of" in result) console.log(`  duplicate_of : ${JSON.stringify(result.duplicate_of)}`);
  return 1;
}

process.exit(main());
