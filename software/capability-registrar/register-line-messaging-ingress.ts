/**
 * หน้าที่: ส่ง `./candidates/line-messaging-ingress.ts` เข้า Registration Pipeline
 * เดิม — ไม่มี stage ใหม่ ไม่เขียนไฟล์เอง และไม่ประกาศ runtime ที่ยังพิสูจน์ไม่ได้
 *
 * Usage: npx tsx software/capability-registrar/register-line-messaging-ingress.ts
 */
import { runRegistrationPipeline } from "../../control/registration-pipeline/contract";
import { createPersistentFileStore } from "../registry-database/adapters/persistent-file-store";
import { findCapability } from "../registry-database/contract";
import { resolveRouteFromDisk } from "../../control/capability-route/host-runtime";
import { LINE_MESSAGING_INGRESS_CANDIDATE as C } from "./candidates/line-messaging-ingress";

function main(): number {
  const store = createPersistentFileStore();
  console.log("=".repeat(78));
  console.log("REGISTRATION PIPELINE — line-messaging-ingress (existing adapter, not rewritten)");
  console.log("=".repeat(78));
  const before = findCapability({ canonical_name: C.name }, store);
  console.log(`  pre-existing  : ${before ? `${before.capability_id} status=${before.status}` : "NOT FOUND"}`);

  const result = runRegistrationPipeline(C, store, "register-line-messaging-ingress-cli");
  console.log(`  STATUS        : ${result.status}`);
  if (result.status === "REGISTERED") {
    console.log(`  resource_id   : ${result.resource_id}`);
    console.log(`  capability_id : ${result.capability_id}`);
  } else if (result.status === "DUPLICATE") {
    console.log(`  reason_code   : ${result.reason_code}`);
    console.log(`  duplicate_of  : ${JSON.stringify(result.duplicate_of)}`);
  } else {
    console.log(`  failed_stage  : ${"failed_stage" in result ? result.failed_stage : "-"}`);
    console.log(`  reason_code   : ${"reason_code" in result ? result.reason_code : "-"}`);
  }

  // ถามชั้น route ทันที — capability ที่ลงทะเบียนถูกต้องต้อง resolve ได้โดยไม่มี
  // ใครไปแก้ router และคำตอบต้องตรงกับความจริง ไม่ใช่ตรงกับความหวัง
  const route = resolveRouteFromDisk(C.name);
  console.log(`  route outcome : ${route.outcome}`);
  console.log(`  route address : ${route.route?.address ?? "-"}`);
  console.log(`  route reason  : ${route.reason ?? "-"}`);
  console.log(`  source pointer: ${JSON.stringify(route.route?.source_pointer ?? [])}`);
  return result.status === "REGISTERED" || result.status === "DUPLICATE" ? 0 : 1;
}
process.exit(main());
