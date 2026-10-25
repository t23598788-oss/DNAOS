// app/_nav/sectionMeta.ts — DNA-000239: central page-identity metadata (STEP 6)
// แผนที่เส้นทาง → ชื่อหมวด/หน้า ภาษาไทย จุดเดียวสำหรับ top bar — ไม่ hardcode ชื่อใน layout แต่ละหน้า
// ไม่แตะ business logic ไม่เปลี่ยน navigation ปัจจุบัน (reuse เท่านั้น)

export type SectionMeta = { section: string; page: string }

const SECTION_MAP: [string, string][] = [
  ["/admin/finance", "การเงิน"],
  ["/admin/debt-tracking", "การเงิน"],
  ["/admin/debt", "การเงิน"],
  ["/admin/create-document", "เอกสาร"],
  ["/admin/payment-voucher", "การเงิน"],
  ["/admin/company-expenses", "การเงิน"],
  ["/workspace", "พื้นที่ทำงาน"],
  ["/admin/documents", "เอกสาร"],
  ["/admin/invoice", "เอกสาร"],
  ["/admin/receipt", "เอกสาร"],
  ["/admin/receipts", "เอกสาร"],
  ["/admin/quotation", "เอกสาร"],
  ["/admin/purchase-order", "เอกสาร"],
  ["/admin/delivery-order", "เอกสาร"],
  ["/admin/create-document", "เอกสาร"],
  ["/admin/materials", "วัสดุ"],
  ["/admin/pits", "วัสดุ"],
  ["/admin/partners", "บริษัท"],
  ["/admin/relationships", "บริษัท"],
  ["/admin/line-customers", "บริษัท"],
  ["/admin/line-profiles", "บริษัท"],
  ["/admin/equipment", "รถและคนขับ"],
  ["/admin/jobs", "คิวงาน"],
  ["/admin/transactions", "ธุรกรรม"],
  ["/admin/settings", "ตั้งค่า"],
  ["/admin/system-config", "ตั้งค่า"],
  ["/admin/users", "ตั้งค่า"],
  ["/admin/api-tokens", "ตั้งค่า"],
]

const PAGE_FALLBACK: Record<string, string> = {
  "/workspace": "บอร์ดสนทนา",
  "/admin/materials": "คลังวัสดุ",
  "/admin/jobs": "คิวงาน",
  "/admin/pits": "แหล่งผลิต",
  "/admin/partners": "คู่ค้า",
  "/admin/documents": "เอกสารทั้งหมด",
  "/admin/create-document": "สร้างเอกสาร",
  "/admin/debt-tracking": "ติดตามหนี้",
  "/admin/finance": "ภาพรวมการเงิน",
}

export function sectionMetaForPath(pathname: string): SectionMeta {
  const clean = pathname.replace(/\/+$/, "") || "/"
  for (const [prefix, section] of SECTION_MAP) {
    if (clean === prefix || clean.startsWith(prefix + "/")) {
      const rest = clean.slice(prefix.length).replace(/^\//, "")
      const page = rest
        ? rest.split("/").map((seg) => PAGE_FALLBACK["/" + prefix.split("/").slice(2).join("/") + "/" + seg] ?? decodeURIComponent(seg)).join(" / ")
        : (PAGE_FALLBACK[prefix] ?? section)
      return { section, page }
    }
  }
  return { section: "DNA OS", page: clean === "/" ? "หน้าแรก" : clean }
}
