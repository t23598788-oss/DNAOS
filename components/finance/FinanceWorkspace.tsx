"use client"

import { useState } from "react"
import SummaryTab from "./SummaryTab"
import IncomeEntryTab from "./IncomeEntryTab"
import ExpenseEntryTab from "./ExpenseEntryTab"
import UnifiedListTab from "./UnifiedListTab"
import DocumentsTab from "./DocumentsTab"
import AuditTab from "./AuditTab"

// FinanceWorkspace (UNIFIED FINANCE ADMIN mission, 2026-10-11) — หน้าจอการเงิน
// รวมของ Admin: ทุก tab คุยกับ canonical API/writer เดิมที่มีอยู่จริง
//   ภาพรวม   → GET /api/admin/finance-summary (เดิม)
//   เงินเข้า → POST /api/admin/receipt-documents (inbound canonical writer) —
//              บันทึก = หลักฐาน ai_read เท่านั้น · ยืนยันเงินจริงที่ /admin/receipts
//   เงินออก → POST /api/admin/company-expenses + /api/admin/payables (expense writer)
//   รายการ   → GET /api/admin/finance/transactions (merge canonical 4 tables)
//   เอกสาร   → GET /api/admin/documents + หน้าเอกสารเดิม
//   ประวัติ  → GET /api/admin/finance/audit (audit_logs)
// ไม่มีระบบ Manual แยก · ไม่มี writer ใหม่ · ไม่มีตารางเงินเพิ่ม

const TABS = [
  { id: "overview", label: "ภาพรวม" },
  { id: "income", label: "บันทึกเงินเข้า" },
  { id: "expense", label: "บันทึกเงินออก" },
  { id: "list", label: "รายการการเงิน" },
  { id: "documents", label: "เอกสาร" },
  { id: "history", label: "ประวัติการดำเนินงาน" },
] as const

type TabId = (typeof TABS)[number]["id"]

export default function FinanceWorkspace() {
  const [tab, setTab] = useState<TabId>("overview")

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-xl font-semibold text-stone-800 mb-1">การเงิน</h1>
      <p className="text-sm text-stone-500 mb-5">
        รายรับ · รายจ่าย · เอกสาร — ทุกช่องทาง (Admin/LINE/ธนาคาร/อัตโนมัติ) บันทึกผ่านระบบการเงิน Canonical ชุดเดียวกัน
      </p>

      <div className="flex flex-wrap gap-1 border-b border-stone-200 mb-5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm rounded-t-lg border-b-2 -mb-px transition ${
              tab === t.id
                ? "border-emerald-600 text-emerald-700 font-medium"
                : "border-transparent text-stone-500 hover:text-stone-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && <SummaryTab />}
      {tab === "income" && <IncomeEntryTab />}
      {tab === "expense" && <ExpenseEntryTab />}
      {tab === "list" && <UnifiedListTab />}
      {tab === "documents" && <DocumentsTab />}
      {tab === "history" && <AuditTab />}
    </div>
  )
}
