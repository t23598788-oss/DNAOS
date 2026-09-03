/**
 * หน้าที่: ส่ง accounting-system node + knowledge record เข้า Registration Pipeline
 * เดิม ผ่าน Duplicate Gate เดิม — ไม่มี stage ใหม่ ไม่เขียนทะเบียนเอง ไม่แตะ LIVE.
 *
 * Usage: npx tsx software/capability-registrar/register-accounting-system-knowledge.ts
 */
import { runRegistrationPipeline } from "../../control/registration-pipeline/contract";
import { createPersistentFileStore } from "../registry-database/adapters/persistent-file-store";
import { findCapability } from "../registry-database/contract";
import { ACCOUNTING_SYSTEM_CANDIDATES } from "./candidates/accounting-system-knowledge";

function main(): number {
  const store = createPersistentFileStore();
  console.log("=".repeat(80));
  console.log("REGISTRATION PIPELINE — accounting system knowledge (node + knowledge record)");
  console.log("=".repeat(80));
  let ok = 0, bad = 0;
  for (const c of ACCOUNTING_SYSTEM_CANDIDATES) {
    const before = c.kind === "capability" ? findCapability({ canonical_name: c.name }, store) : null;
    const result = runRegistrationPipeline(c, store, "register-accounting-system-knowledge-cli");
    console.log(`\n  ${c.name} (${c.kind}/${c.resource_type})`);
    console.log(`    pre-existing : ${before ? before.capability_id : "n/a"}`);
    console.log(`    STATUS       : ${result.status}`);
    if (result.status === "REGISTERED") { ok++; console.log(`    id           : ${result.capability_id ?? result.resource_id ?? "-"}`); }
    else if (result.status === "DUPLICATE") { ok++; console.log(`    duplicate_of : ${JSON.stringify("duplicate_of" in result ? result.duplicate_of : null)}`); }
    else { bad++; console.log(`    reason       : ${"reason_code" in result ? result.reason_code : "-"}${"failed_stage" in result ? " @" + result.failed_stage : ""}`); }
  }
  console.log(`\n  ${ACCOUNTING_SYSTEM_CANDIDATES.length} submitted — OK=${ok} REJECTED=${bad}`);
  return bad === 0 ? 0 : 1;
}
process.exit(main());
