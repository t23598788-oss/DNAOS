/**
 * ประกาศให้ทะเบียนรู้ว่า control/agent-gateway/ เป็นห้องของใคร และใครมาใช้บริการ
 *
 * คำวินิจฉัยของเจ้าของ 2026-09-04:
 *   agent-gateway    = เจ้าของห้อง — ทางผ่านระหว่างฝั่งสั่งงานกับ worker/execution
 *   build_execution  = ผู้ใช้บริการ เข้ามาผ่านห้องนี้
 *   test_execution   = ผู้ใช้บริการ เข้ามาผ่านห้องนี้
 *
 * สอดคล้องกับหลักฐานที่การลงทะเบียนของทั้งสองอ้างไว้เอง — DECLARED_OPERATION
 * ที่ execution/run/process-registry.ts ไม่ใช่ที่ control/agent-gateway/
 *
 * ใช้ ADD_RELATIONSHIP ซึ่งเป็น mutation ที่ registration-update รองรับอยู่แล้ว
 * ไม่ต้องปลดล็อก Registry และไม่แก้ไฟล์ทะเบียนด้วยมือ
 */
import { readFileSync } from "node:fs";
import { createPersistentFileStore } from "../../../software/registry-database/adapters/persistent-file-store";
import { applyMutation } from "../../../control/registration-update/mutation";

const D = "software/registry-database/data/canonical";
const readLatest = <T extends Record<string, unknown>>(file: string, key: string): T[] => {
  const m = new Map<unknown, T>();
  for (const line of readFileSync(`${D}/${file}`, "utf8").split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try { const r = JSON.parse(s) as T; m.set(r[key], r); } catch { /* ข้ามบรรทัดเสีย */ }
  }
  return [...m.values()];
};

const caps = readLatest<{ capability_id: string; canonical_name: string; version: string[] }>("capabilities.jsonl", "capability_id");
const links = readLatest<{ resource_id: string; capability_id: string }>("resource_capabilities.jsonl", "resource_id");
const idOf = (name: string): string | null => caps.find((c) => c.canonical_name === name)?.capability_id ?? null;

const ROOM = "agent-gateway";
const CONSUMERS = [
  { name: "build_execution", entry: "execution/run/process-registry.ts#candidate.node.npm.build" },
  { name: "test_execution", entry: "execution/run/process-registry.ts#candidate.node.npm.test" },
] as const;

const store = createPersistentFileStore();
const roomId = idOf(ROOM);
if (roomId === null) { console.log("  ไม่พบ capability เจ้าของห้องในทะเบียน"); process.exit(1); }

const roomCap = store.findCapabilityById(roomId) as unknown as { version: readonly string[] } | null;
if (roomCap === null) { console.log("  store อ่าน capability เจ้าของห้องไม่ได้"); process.exit(1); }
const roomResource = links.find((l) => l.capability_id === roomId)?.resource_id ?? "";

let applied = 0, rejected = 0;
for (const c of CONSUMERS) {
  const consumerId = idOf(c.name);
  if (consumerId === null) { console.log(`  ไม่พบ ${c.name}`); rejected++; continue; }
  const res = applyMutation({
    resource_id: roomResource,
    capability_id: roomId,
    expected_current_version: roomCap.version[0],
    mutation_type: "ADD_RELATIONSHIP",
    mutation_payload: { to_type: "CAPABILITY", to_id: consumerId, relationship_kind: "ORCHESTRATES_CAPABILITY" },
    evidence_refs: [c.entry, "governance/architecture-rules/CAPABILITY_FOLDER_LAW.md#ข้อ9"],
    correlation_id: "owner-ruling-gateway-room-2026-09-04",
  }, store);
  if (res.status === "APPLIED") { applied++; console.log(`  บันทึกแล้ว: ${ROOM} orchestrates ${c.name}`); }
  else { rejected++; console.log(`  ปฏิเสธ ${c.name}: ${res.reason_code}`); }
}
console.log(`\n  สำเร็จ ${applied} · ถูกปฏิเสธ ${rejected}`);
