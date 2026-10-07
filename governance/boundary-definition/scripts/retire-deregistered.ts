/**
 * ถอนทะเบียน capability ที่ source_location ชี้ไปที่ที่ไม่มีอยู่จริง
 *
 * คำสั่ง Owner 2026-09-04 · ใช้เส้นทาง registration-update ที่เปิดภายใต้ OWNER UNLOCK
 * ไม่แก้ไฟล์ทะเบียนด้วยมือแม้แต่บรรทัดเดียว — ผ่าน applyMutation เท่านั้น
 * ไม่ลบแถว เปลี่ยนเฉพาะ status เป็น RETIRED เพื่อให้ประวัติยังตรวจสอบย้อนหลังได้
 */
import { readFileSync } from "node:fs";
import { createPersistentFileStore } from "../../../software/registry-database/adapters/persistent-file-store";
import { applyMutation } from "../../../control/registration-update/mutation";

const ORDER = "governance/boundary-definition/data/deregistration-order.jsonl";
const rows = readFileSync(ORDER, "utf8").split("\n").filter((l) => l.trim())
  .map((l) => JSON.parse(l) as { canonical_id: string; canonical_name: string; reason: string });

// resource_id ที่ผูกกับ capability — อ่านจากตารางเชื่อมของทะเบียนเอง
const LINKS = "software/registry-database/data/canonical/resource_capabilities.jsonl";
const linkOf = new Map<string, string>();
for (const line of readFileSync(LINKS, "utf8").split("\n")) {
  const t = line.trim();
  if (!t) continue;
  try {
    const l = JSON.parse(t) as { resource_id: string; capability_id: string };
    if (!linkOf.has(l.capability_id)) linkOf.set(l.capability_id, l.resource_id);
  } catch { /* ข้ามบรรทัดเสีย */ }
}

const store = createPersistentFileStore();
let applied = 0, notFound = 0, rejected = 0;
for (const r of rows) {
  const cap = store.findCapabilityById(r.canonical_id) as unknown as
    { capability_id: string; resource_id?: string; version: readonly string[]; status: string } | null;
  if (cap === null) { notFound++; console.log(`  ไม่พบในทะเบียน  ${r.canonical_name}`); continue; }
  const res = applyMutation({
    resource_id: linkOf.get(r.canonical_id) ?? cap.resource_id ?? "",
    capability_id: r.canonical_id,
    expected_current_version: cap.version[0],
    mutation_type: "RETIRE",
    mutation_payload: { reason: r.reason },
    evidence_refs: [ORDER],
    correlation_id: "owner-deregistration-order-2026-09-04",
  }, store);
  if (res.status === "APPLIED") applied++;
  else { rejected++; console.log(`  ปฏิเสธ  ${r.canonical_name}  ${res.reason_code}`); }
}
console.log(`\n  ถอนสำเร็จ ${applied} · ไม่พบ ${notFound} · ถูกปฏิเสธ ${rejected} · จากทั้งหมด ${rows.length}`);
