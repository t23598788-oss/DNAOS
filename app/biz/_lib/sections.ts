/**
 * SECTIONS — ทะเบียนหน้าจอของ Business Workspace ใหม่ (หน้าจอเดียว · nav บนแถวเดียว)
 *
 * หลักการย้าย (owner 2026-10-13):
 *  - หน้าจอธุรกิจทุกใบ "ใช้ของเดิม" — ไม่มีการเขียน Business Logic ใหม่
 *  - section ที่เดิมเป็น thin wrapper รอบ component อยู่แล้ว → host component เดิม (capability ครบ 100%)
 *  - section ที่ต้องการตารางกลางร่วมกัน (STEP 4) → ใช้ BizTable + API เดิม (ไม่มี endpoint ใหม่)
 *  - ห้ามอ้างอิงไฟล์ที่ยังเป็นงานค้างของ session อื่น (เช่น app/admin/materials/*)
 */

export interface BizSection {
  key: string
  label: string
  /** หน้าจอเดิมที่ capability นี้อยู่ (ใช้เป็นหลักฐานย้อนกลับ + ลิงก์สำรอง) */
  legacyHref: string
  description: string
}

export const BIZ_SECTIONS: BizSection[] = [
  { key: "resources", label: "วัตถุดิบและทรัพยากร", legacyHref: "/admin/equipment", description: "รถ·อุปกรณ์·คนขับ·พิกัด GPS (หน้าเดิม /admin/equipment)" },
  { key: "quarry", label: "โรงโม่หิน", legacyHref: "/admin/pits", description: "บ่อ/แพล้นท์ประเภท ROCK_QUARRY" },
  { key: "sand", label: "บ่อทราย", legacyHref: "/admin/pits", description: "บ่อ/แพล้นท์ประเภท SAND_PIT" },
  { key: "soil", label: "บ่อดิน", legacyHref: "/admin/pits", description: "บ่อ/แพล้นท์ประเภท SOIL_PIT" },
  { key: "factory", label: "โรงงาน", legacyHref: "/admin/pits", description: "โรงงานผลิตภัณฑ์คอนกรีต + คอนกรีตผสมเสร็จ" },
  { key: "create-document", label: "สร้างเอกสาร", legacyHref: "/admin/create-document", description: "DocumentBuilder เดิมทุกชนิดเอกสาร" },
  { key: "documents", label: "เอกสาร", legacyHref: "/admin/documents", description: "คลังเอกสาร/ค้นหา/ดาวน์โหลด/พิมพ์" },
  { key: "finance", label: "ธุรกรรมการเงิน", legacyHref: "/admin/finance", description: "FinanceWorkspace เดิม (สร้าง/รายการ/เอกสาร/ประวัติ) + PayablesPanel (เจ้าหนี้) ในแท็บค่าใช้จ่าย" },
  // ——— รอบ 2: ความสามารถที่ค้างจากการย้ายครั้งก่อน (STEP 4) — host หน้าจอเดิมทั้งใบ ———
  { key: "partners", label: "บริษัท/คู่ค้า", legacyHref: "/admin/partners", description: "พาร์ตเนอร์ + สรุปเอกสารล่าสุด (หน้าเดิม /admin/partners)" },
  { key: "relationships", label: "ความสัมพันธ์", legacyHref: "/admin/relationships", description: "RelationshipWorkspacePage เดิม (feed + LINE chat)" },
  { key: "line-customers", label: "ลูกค้า LINE", legacyHref: "/admin/line-customers", description: "รายชื่อลูกค้า LINE ทั้งหมด (หน้าเดิม /admin/line-customers)" },
  { key: "line-profiles", label: "โปรไฟล์ LINE", legacyHref: "/admin/line-profiles", description: "โปรไฟล์/บทบาท/ความไว้วางใจ (หน้าเดิม /admin/line-profiles)" },
  { key: "debt-tracking", label: "ลูกหนี้", legacyHref: "/admin/debt-tracking", description: "DebtTrackingManager เดิม (บันทึก/ประวัติ/ยืนยันชำระ)" },
  { key: "receipts", label: "ใบเสร็จ", legacyHref: "/admin/receipts", description: "คิวตรวจใบเสร็จ/หลักฐานชำระเงิน (หน้าเดิม /admin/receipts)" },
  { key: "receipt", label: "เปิดใบเสร็จ", legacyHref: "/admin/receipt", description: "DocumentBuilder โหมด browser ชนิด receipt (หน้าเดิม /admin/receipt)" },
  { key: "transactions", label: "ธุรกรรม", legacyHref: "/admin/transactions", description: "TransactionPanel เดิม (ธุรกรรมทั้งหมด + สร้างใหม่)" },
]

/** กลุ่ม business_type ที่แต่ละ section ของ pits แสดง (ใช้ code เดียวกับ API /api/admin/pits) */
export const PITS_TYPE_CODES: Record<string, string[]> = {
  quarry: ["ROCK_QUARRY"],
  sand: ["SAND_PIT"],
  soil: ["SOIL_PIT"],
  factory: ["FACTORY", "CONCRETE_PLANT"],
}

export function findSection(key: string): BizSection | undefined {
  return BIZ_SECTIONS.find((s) => s.key === key)
}
