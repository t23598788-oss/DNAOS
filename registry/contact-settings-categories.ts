// Contact Settings Category Registry (owner, 2026-07-18)
//
// "ถ้าวันหลังเพิ่มโมดูลใหม่ ไม่ต้องแก้ Contact Settings แค่ Register หมวดใหม่
// มันก็จะโผล่ใน Popup อัตโนมัติ" — every category (and subcategory) is a
// declarative entry here, not hardcoded JSX in the modal component.
// components/line/ContactSettingsModal.tsx is a GENERIC tree-renderer that
// reads this array; adding a module's settings later means adding one entry
// here, not touching the modal.
//
// Storage: profile-target fields save to their line_profiles column
// directly (display_name/role/trust_level/department/notes — real columns,
// built 2026-07-18). permissions-target fields save nested under
// line_profiles.permissions[category.key] = { fieldKey: value } — jsonb,
// already supports arbitrary keys, no migration needed per new category.

export type FieldType = "boolean" | "text" | "textarea" | "select"

export interface FieldDef {
  key: string
  label: string
  type: FieldType
  options?: { value: string; label: string }[]
}

export interface CategoryNode {
  key: string
  label: string
  parent: string | null
  target: "profile" | "permissions"
  fields?: FieldDef[]
  built: boolean
}

export const CONTACT_SETTINGS_CATEGORIES: CategoryNode[] = [
  {
    key: "basic", label: "ข้อมูลพื้นฐาน", parent: null, target: "profile", built: true,
    fields: [
      { key: "displayName", label: "ชื่อที่แสดง", type: "text" },
      { key: "department", label: "แผนก", type: "text" },
    ],
  },
  {
    key: "role", label: "บทบาท", parent: null, target: "profile", built: true,
    fields: [
      {
        key: "role", label: "บทบาท", type: "select",
        options: [
          { value: "", label: "— ยังไม่กำหนด —" },
          { value: "employee", label: "พนักงานบริษัท" },
          { value: "customer", label: "ลูกค้า" },
          { value: "supplier", label: "ซัพพลายเออร์" },
          { value: "driver", label: "คนขับรถ" },
          { value: "owner", label: "เจ้าของรถ" },
          { value: "contractor", label: "ผู้รับเหมา" },
          { value: "accountant", label: "บัญชี" },
          { value: "manager", label: "ผู้จัดการ" },
          { value: "admin", label: "แอดมิน" },
          { value: "external", label: "บุคคลภายนอก" },
        ],
      },
      {
        key: "trustLevel", label: "ความน่าเชื่อถือ", type: "select",
        options: [
          { value: "unverified", label: "ยังไม่ยืนยัน" },
          { value: "verified", label: "ยืนยันแล้ว" },
          { value: "flagged", label: "ต้องระวัง" },
        ],
      },
    ],
  },
  {
    key: "rights", label: "สิทธิ์", parent: null, target: "permissions", built: true,
    fields: [
      { key: "approve_document", label: "อนุมัติเอกสาร", type: "boolean" },
      { key: "approve_finance", label: "อนุมัติการเงิน", type: "boolean" },
      { key: "receive_po", label: "รับ PO", type: "boolean" },
      { key: "receive_invoice", label: "รับ Invoice", type: "boolean" },
      { key: "receive_payment", label: "รับ Payment", type: "boolean" },
    ],
  },

  // Automation — parent only, no own fields; each real module registers a
  // subcategory here. Only "invoice" has real fields today (matching the
  // owner's own worked example) — the rest are honest placeholders, not
  // fabricated controls, until each module actually reads these flags.
  { key: "automation", label: "Automation", parent: null, target: "permissions", built: true },
  {
    key: "automation.invoice", label: "Invoice", parent: "automation", target: "permissions", built: true,
    fields: [
      { key: "auto_send", label: "ส่งอัตโนมัติ", type: "boolean" },
      { key: "draft_first", label: "ร่างก่อนส่ง", type: "boolean" },
      { key: "need_approval", label: "ต้องอนุมัติ", type: "boolean" },
      { key: "send_pdf", label: "ส่ง PDF", type: "boolean" },
      { key: "send_excel", label: "ส่ง Excel", type: "boolean" },
    ],
  },
  { key: "automation.quotation", label: "Quotation", parent: "automation", target: "permissions", built: false },
  { key: "automation.receipt", label: "Receipt", parent: "automation", target: "permissions", built: false },
  { key: "automation.debt", label: "Debt", parent: "automation", target: "permissions", built: false },
  { key: "automation.followup", label: "Follow Up", parent: "automation", target: "permissions", built: false },
  { key: "automation.notification", label: "Notification", parent: "automation", target: "permissions", built: false },

  { key: "ai", label: "AI", parent: null, target: "permissions", built: false },
  { key: "documents", label: "เอกสาร", parent: null, target: "permissions", built: false },
  { key: "notifications", label: "การแจ้งเตือน", parent: null, target: "permissions", built: false },
  { key: "finance", label: "การเงิน", parent: null, target: "permissions", built: false },
  { key: "workflow", label: "Workflow", parent: null, target: "permissions", built: false },
  { key: "tags", label: "Tag", parent: null, target: "permissions", built: false },
  { key: "custom_fields", label: "Custom Fields", parent: null, target: "permissions", built: false },
  { key: "advanced", label: "Advanced", parent: null, target: "permissions", built: false },

  {
    key: "notes", label: "หมายเหตุ", parent: null, target: "profile", built: true,
    fields: [{ key: "notes", label: "หมายเหตุ", type: "textarea" }],
  },
]

export function childrenOf(key: string | null): CategoryNode[] {
  return CONTACT_SETTINGS_CATEGORIES.filter((c) => c.parent === key)
}

export function findCategory(key: string): CategoryNode | undefined {
  return CONTACT_SETTINGS_CATEGORIES.find((c) => c.key === key)
}
