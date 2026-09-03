/**
 * หน้าที่: ส่งระบบธุรกิจที่ค้นพบทั้งหมดเข้า Registration Pipeline เดิม ผ่าน
 * Duplicate Gate เดิม — ไม่มี stage ใหม่ ไม่เขียนทะเบียนเอง
 *
 * Usage: npx tsx software/capability-registrar/register-discovered-business-systems.ts
 */
import { runRegistrationPipeline } from "../../control/registration-pipeline/contract";
import { createPersistentFileStore } from "../registry-database/adapters/persistent-file-store";
import { findCapability } from "../registry-database/contract";
import { resolveRouteFromDisk } from "../../control/capability-route/host-runtime";
import { DISCOVERED_BUSINESS_CANDIDATES } from "./candidates/discovered-business-systems";

function main(): number {
  const store = createPersistentFileStore();
  console.log("=".repeat(80));
  console.log("REGISTRATION PIPELINE — discovered business systems (found, not created)");
  console.log("=".repeat(80));
  let bad = 0;
  for (const c of DISCOVERED_BUSINESS_CANDIDATES) {
    const before = findCapability({ canonical_name: c.name }, store);
    const result = runRegistrationPipeline(c, store, "register-discovered-business-systems-cli");
    const route = resolveRouteFromDisk(c.name);
    console.log(`\n  ${c.name}`);
    console.log(`    pre-existing : ${before ? before.capability_id : "NOT FOUND"}`);
    console.log(`    STATUS       : ${result.status}`);
    if (result.status === "REGISTERED") console.log(`    capability_id: ${result.capability_id}`);
    else if (result.status === "DUPLICATE") console.log(`    duplicate_of : ${JSON.stringify(result.duplicate_of)}`);
    else { console.log(`    reason       : ${"reason_code" in result ? result.reason_code : "-"}`); bad += 1; }
    console.log(`    route        : ${route.outcome}${route.route ? ` ${route.route.address}` : ""}`);
  }
  console.log(`\n  ${DISCOVERED_BUSINESS_CANDIDATES.length} candidates submitted, ${bad} rejected`);
  return bad === 0 ? 0 : 1;
}
process.exit(main());
