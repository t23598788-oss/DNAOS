/**
 * DNA OS — ERP Brain Core (สมองกลางประมวลผล ERP)
 *
 * แกนเดียวที่รวม "หัวใจ" ของ ERP แต่ละส่วนเข้าด้วยกัน พร้อมระบุแหล่งข้อมูลจริง
 * ที่แต่ละออร์แกนอ่าน/เขียน — ไม่มีตัวเลขที่แต่งขึ้นเอง
 *
 * หลักการ:
 *  - นิยามออร์แกน + ตาราง/วิว + route + canonical writer ไว้ที่เดียว (ไฟล์นี้)
 *  - route ทำหน้าที่แค่ probe จำนวนแถวจริง แล้วส่งให้ buildErpBrainSnapshot()
 *  - count = จำนวนแถวที่มีอยู่จริง; ไม่ใช่ตัวเลขทางธุรกิจ (ยอดเงินดูที่ finance-summary)
 *  - ตารางที่ probe ไม่ได้ → status "unavailable" ไม่เดาเป็น 0
 */

export interface ErpOrganDefinition {
  key: string
  label_th: string
  purpose_th: string
  /** ออร์แกนหัวใจหลักของ ERP */
  heart: boolean
  /** ตาราง/วิวที่ออร์แกนนี้อ่านเป็นแหล่งความจริง */
  tables: string[]
  /** route ที่ให้บริการข้อมูลของออร์แกนนี้ */
  routes: string[]
  /** canonical writer ที่ใช้เขียนข้อมูล (ถ้ามี) */
  writers: string[]
}

export interface ErpSourceProbe {
  table: string
  count: number | null
  error?: string
}

export interface ErpOrganSnapshot {
  key: string
  label_th: string
  purpose_th: string
  heart: boolean
  status: "available" | "partial" | "unavailable"
  sources: { table: string; count: number | null }[]
  routes: string[]
  writers: string[]
}

export interface ErpBrainSnapshot {
  brain: "dna-os-erp-core"
  generated_at: string
  health: "healthy" | "partial" | "disconnected"
  coverage: {
    organs_total: number
    organs_available: number
    organs_partial: number
    organs_unavailable: number
    sources_total: number
    sources_available: number
    sources_missing: number
  }
  organs: ErpOrganSnapshot[]
  missing_sources: string[]
  note: string
}

export const ERP_ORGANS: ErpOrganDefinition[] = [
  {
    key: "identity_and_access",
    label_th: "ตัวตนและสิทธิ์",
    purpose_th: "ผู้ใช้ บทบาท และขอบเขตการเข้าถึงข้อมูล",
    heart: true,
    tables: ["profiles", "role_assignments"],
    routes: ["/api/admin/users", "/api/admin/roles"],
    writers: [],
  },
  {
    key: "unified_inbox",
    label_th: "กล่องข้อความรวม",
    purpose_th: "รับข้อความ LINE/Facebook แยกอิสระตามช่องทาง แล้วรวมเป็นรายการเดียวเรียงตามเวลา",
    heart: true,
    tables: ["conversations", "messages"],
    routes: ["/api/admin/conversations"],
    writers: ["engines/canonical/inbound-write.ts"],
  },
  {
    key: "product_catalog_and_media",
    label_th: "สินค้า แคตตาล็อก และสื่อ",
    purpose_th: "สินค้า ราคา โปรไฟล์ธุรกิจ และสื่อที่ใช้ตอบลูกค้า/โชว์ผลงาน",
    heart: true,
    tables: ["products", "business_profiles", "media_showcases"],
    routes: ["/api/admin/facebook-page/ingest"],
    writers: [],
  },
  {
    key: "document_engine",
    label_th: "เครื่องเอกสาร",
    purpose_th: "ใบเสนอราคา ใบสั่งซื้อ ใบส่งของ ใบแจ้งหนี้ ใบเสร็จ จาก canonical model",
    heart: true,
    tables: ["document_canonical", "receipt_documents"],
    routes: ["/api/admin/documents", "/api/admin/receipt-documents"],
    writers: ["engines/canonical/document-write.ts", "engines/canonical/receipt-confirm-flow.ts"],
  },
  {
    key: "finance_and_payables",
    label_th: "การเงินและเจ้าหนี้",
    purpose_th: "รายจ่าย การจัดสรรเงินรับ และสรุปกระแสเงินสด",
    heart: true,
    tables: ["company_expenses", "payment_allocations"],
    routes: ["/api/admin/finance", "/api/admin/finance-summary", "/api/admin/payables"],
    writers: ["engines/canonical/expense-write.ts", "engines/canonical/payment-write.ts"],
  },
  {
    key: "debt_tracking",
    label_th: "ติดตามหนี้",
    purpose_th: "ยอดค้างชำระ ดอกเบี้ย และประวัติการเปลี่ยนสถานะหนี้",
    heart: true,
    tables: ["company_debt_current", "debt_events"],
    routes: ["/api/admin/debt-trackings"],
    writers: ["engines/canonical/debt-write.ts"],
  },
  {
    key: "stock_and_materials",
    label_th: "คลังและวัสดุ",
    purpose_th: "สต๊อก วัสดุ และการเคลื่อนไหวของสต๊อก",
    heart: true,
    tables: ["inventory", "stock_movements", "material_types"],
    routes: ["/api/admin/storage-intelligence"],
    writers: ["engines/canonical/stock-write.ts"],
  },
  {
    key: "partners_and_pits",
    label_th: "คู่ค้าและบ่อวัสดุ",
    purpose_th: "ทะเบียนคู่ค้า โปรไฟล์บ่อ และราคาวัสดุจากบ่อ",
    heart: true,
    tables: ["partners", "pit_profiles"],
    routes: ["/api/admin/partners", "/api/admin/pits"],
    writers: ["engines/canonical/partner-binding-write.ts", "engines/canonical/material-price-write.ts"],
  },
  {
    key: "equipment_and_assets",
    label_th: "อุปกรณ์และสินทรัพย์",
    purpose_th: "ทะเบียนรถ/เครื่องจักร สิทธิ์การใช้งาน และแจ้งเตือนบำรุงรักษา",
    heart: false,
    tables: ["equipment_assets", "equipment_maintenance_alerts"],
    routes: ["/api/admin/equipment"],
    writers: [],
  },
  {
    key: "payment_gateway",
    label_th: "ช่องทางชำระเงิน",
    purpose_th: "ผลตอบกลับการชำระเงินจากธนาคาร/ผู้ให้บริการ และการsettle",
    heart: false,
    tables: ["payment_callbacks", "settlements"],
    routes: ["/api/admin/partner-portal"],
    writers: [],
  },
]

export const ERP_PROBE_TABLES: string[] = [...new Set(ERP_ORGANS.flatMap((o) => o.tables))]

export const ERP_BRAIN_NOTE =
  "count คือจำนวนแถวจริงในแหล่งข้อมูลของแต่ละออร์แกน ไม่ใช่ยอดเงินหรือตัวชี้วัดทางธุรกิจ — " +
  "ยอดเงิน/กำไร/ภาษี ดูที่ /api/admin/finance-summary · ตารางที่ probe ไม่ได้จะรายงานเป็น unavailable ไม่เดาเป็น 0"

export function buildErpBrainSnapshot(probes: ErpSourceProbe[], generatedAt = new Date().toISOString()): ErpBrainSnapshot {
  const byTable = new Map(probes.map((p) => [p.table, p]))
  const missing = new Set<string>()

  const organs: ErpOrganSnapshot[] = ERP_ORGANS.map((organ) => {
    const sources = organ.tables.map((table) => {
      const probe = byTable.get(table)
      if (!probe || probe.count === null) missing.add(table)
      return { table, count: probe?.count ?? null }
    })
    const available = sources.filter((s) => s.count !== null).length
    const status: ErpOrganSnapshot["status"] =
      available === sources.length ? "available" : available > 0 ? "partial" : "unavailable"
    return {
      key: organ.key,
      label_th: organ.label_th,
      purpose_th: organ.purpose_th,
      heart: organ.heart,
      status,
      sources,
      routes: organ.routes,
      writers: organ.writers,
    }
  })

  const organsAvailable = organs.filter((o) => o.status === "available").length
  const organsPartial = organs.filter((o) => o.status === "partial").length
  const organsUnavailable = organs.filter((o) => o.status === "unavailable").length

  const sourcesTotal = ERP_PROBE_TABLES.length
  const sourcesMissing = missing.size

  return {
    brain: "dna-os-erp-core",
    generated_at: generatedAt,
    health:
      organsUnavailable === 0 && organsPartial === 0
        ? "healthy"
        : organsAvailable + organsPartial === 0
          ? "disconnected"
          : "partial",
    coverage: {
      organs_total: organs.length,
      organs_available: organsAvailable,
      organs_partial: organsPartial,
      organs_unavailable: organsUnavailable,
      sources_total: sourcesTotal,
      sources_available: sourcesTotal - sourcesMissing,
      sources_missing: sourcesMissing,
    },
    organs,
    missing_sources: [...missing].sort(),
    note: ERP_BRAIN_NOTE,
  }
}
