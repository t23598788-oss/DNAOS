/**
 * ผู้เข้าแข่งขันหนึ่งรายสำหรับการทดสอบการสร้างพร้อมกันจริงข้ามโปรเซส
 *
 * ไม่ใช่การจำลอง: เทสต์ spawn ไฟล์นี้สองตัวพร้อมกัน ทั้งคู่ชี้ไปที่ state root
 * ชั่วคราวตัวเดียวกัน แล้วพิมพ์ผลลัพธ์เป็น JSON บรรทัดเดียว
 *
 * argv: <installation_id> <created_at>
 */
import { buildInitializationRecord } from "../../../contracts/installation/installation-initialization";
import { createInstallationInitializationFromCeremony } from "../restricted";

const [, , installationId, createdAt] = process.argv;
const built = buildInitializationRecord({
  installation_id: installationId,
  created_at: createdAt,
  evidence_refs: ["execution/installation-initialization/tests/create-worker.ts#main"],
});
if (!built.ok) { console.log(JSON.stringify({ result: "BUILD_FAILED", reason_code: built.reason_code })); process.exit(1); }
const outcome = createInstallationInitializationFromCeremony(built.record);
console.log(JSON.stringify({ result: outcome.result, id: "initialization" in outcome ? outcome.initialization.initialization_id : null }));
