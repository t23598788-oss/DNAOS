/**
 * หน้าที่: ส่ง DNA OS Accounting Kernel modules (พิสูจน์แล้ว 23/23 ใน isolated)
 * เข้า Registration Pipeline เดิม ผ่าน Duplicate Gate เดิม — ไม่มี stage ใหม่
 * ไม่เขียนทะเบียนเอง ไม่แตะ Supabase LIVE.
 *
 * lifecycle verdict = VERIFIED_ISOLATED ถูกพกใน evidence_refs (registry status
 * ยังเป็น REGISTERED ตามปกติ). ห้ามตีความเป็น LIVE/PRODUCTION.
 *
 * Usage: npx tsx software/capability-registrar/register-accounting-backend-modules.ts
 */
import { runRegistrationPipeline } from "../../control/registration-pipeline/contract";
import { createPersistentFileStore } from "../registry-database/adapters/persistent-file-store";
import { findCapability } from "../registry-database/contract";
import { ACCOUNTING_BACKEND_CANDIDATES } from "./candidates/accounting-backend-modules";

function main(): number {
  const store = createPersistentFileStore();
  console.log("=".repeat(80));
  console.log("REGISTRATION PIPELINE — accounting backend modules (VERIFIED_ISOLATED 23/23)");
  console.log("=".repeat(80));
  let registered = 0, duplicate = 0, bad = 0;
  for (const c of ACCOUNTING_BACKEND_CANDIDATES) {
    const before = findCapability({ canonical_name: c.name }, store);
    const result = runRegistrationPipeline(c, store, "register-accounting-backend-modules-cli");
    console.log(`\n  ${c.name}`);
    console.log(`    pre-existing : ${before ? before.capability_id : "NOT FOUND"}`);
    console.log(`    STATUS       : ${result.status}`);
    if (result.status === "REGISTERED") { registered++; console.log(`    capability_id: ${result.capability_id}`); }
    else if (result.status === "DUPLICATE") { duplicate++; console.log(`    duplicate_of : ${JSON.stringify("duplicate_of" in result ? result.duplicate_of : null)}`); }
    else { bad++; console.log(`    reason       : ${"reason_code" in result ? result.reason_code : "-"}${"failed_stage" in result ? " @" + result.failed_stage : ""}`); }
  }
  console.log(`\n  ${ACCOUNTING_BACKEND_CANDIDATES.length} candidates submitted — REGISTERED=${registered} DUPLICATE(REUSED)=${duplicate} REJECTED=${bad}`);
  return bad === 0 ? 0 : 1;
}
process.exit(main());
