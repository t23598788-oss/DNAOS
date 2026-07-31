import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

// Finance Summary (owner request 2026-07-25): "ยังไม่เห็นกำไรและงบดุลบริษัทเลย"
// — a real, honest cash-flow summary aggregated from the actual documents/
// slips already in the system (invoices, standalone_documents, receipt
// slips confirmed by OCR+human, debt). NOT a formal balance sheet — this
// repo has no real fixed-asset/capital/liability-structure records, so a
// true balance sheet (assets/liabilities/equity) cannot be built without
// fabricating numbers. Says so plainly rather than presenting a fake one.
// Grouped by real document_date/created_at, not invented periods.

function monthKey(d: string | null): string {
  if (!d) return "unknown"
  return d.slice(0, 7) // YYYY-MM
}

// Real expense category breakdown (owner, 2026-07-31): "แยกหมวดหมู่ค่าใช้จ่าย
// ตามในจากตารางเดิม...แยกหมวดหมู่ค่าใช้จ่ายตามบิลจริง" — no pie chart (owner
// explicitly said skip it), just real totals grouped by category, derived
// from company_expenses' own existing real fields (document_type/vendor_name)
// — never a new invented taxonomy. document_type is already real and
// populated (tax_invoice/invoice/receipt/fuel_bill/partner_payable, #11/#37);
// vendor_name is checked first for known real vendors (e.g. "Supabase", from
// #37's auto-detected billing) since "partner_payable" alone is too broad a
// bucket to be useful (it covers both material-supplier payments and SaaS
// billing) — same real distinction the data itself already carries.
function expenseCategory(documentType: string, vendorName: string | null): string {
  const vendor = (vendorName ?? "").toLowerCase()
  if (vendor.includes("supabase")) return "ค่าบริการซอฟต์แวร์/Hosting"
  switch (documentType) {
    case "fuel_bill": return "ค่าน้ำมัน"
    case "partner_payable": return "จ่ายพาร์ทเนอร์/ซัพพลายเออร์"
    case "tax_invoice": return "ใบกำกับภาษี"
    case "invoice": return "ใบแจ้งหนี้"
    case "receipt": return "ใบเสร็จ"
    default: return "อื่นๆ"
  }
}

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const db = supabase()

  const [invoicesRes, standaloneRes, receiptsRes, debtRes, fuelRes, expensesRes] = await Promise.all([
    db.from("invoices").select("total_amount, created_at"),
    db.from("standalone_documents").select("total_amount, document_date, document_type"),
    db.from("receipt_documents").select("amount, document_date, document_type, payment_verified"),
    db.from("debt_snapshots").select("total_outstanding"),
    db.from("fuel_price_log").select("price, fetched_at").order("fetched_at", { ascending: false }).limit(1),
    db.from("company_expenses").select("document_type, vendor_name, amount, expense_date"),
  ])

  const revenueByMonth = new Map<string, number>()
  for (const inv of invoicesRes.data ?? []) {
    const k = monthKey(inv.created_at)
    revenueByMonth.set(k, (revenueByMonth.get(k) ?? 0) + Number(inv.total_amount ?? 0))
  }
  for (const doc of standaloneRes.data ?? []) {
    // ใบเสนอราคา (QT) ยังไม่ใช่รายได้จริง — นับเฉพาะเอกสารที่แปลว่าเงินจะเข้า/ออกจริง
    if (doc.document_type === "QT") continue
    const k = monthKey(doc.document_date)
    revenueByMonth.set(k, (revenueByMonth.get(k) ?? 0) + Number(doc.total_amount ?? 0))
  }

  const paymentsReceivedByMonth = new Map<string, number>()
  const fuelBillsByMonth = new Map<string, number>()
  // สลิปโอนเงินที่ยังไม่ถูกยืนยัน (owner needs to see this — real gap found
  // 2026-07-25: 12 real transfer_slip rows, ฿136,020, all payment_verified=false)
  let unverifiedTransferSlipTotal = 0
  let unverifiedTransferSlipCount = 0
  for (const r of receiptsRes.data ?? []) {
    const k = monthKey(r.document_date)
    if (r.document_type === "transfer_slip") {
      if (r.payment_verified) {
        paymentsReceivedByMonth.set(k, (paymentsReceivedByMonth.get(k) ?? 0) + Number(r.amount ?? 0))
      } else {
        unverifiedTransferSlipTotal += Number(r.amount ?? 0)
        unverifiedTransferSlipCount += 1
      }
    }
    if (r.document_type === "fuel_bill") {
      fuelBillsByMonth.set(k, (fuelBillsByMonth.get(k) ?? 0) + Number(r.amount ?? 0))
    }
  }

  const allMonths = [...new Set([...revenueByMonth.keys(), ...paymentsReceivedByMonth.keys(), ...fuelBillsByMonth.keys()])]
    .filter((m) => m !== "unknown")
    .sort()

  const months = allMonths.map((m) => ({
    month: m,
    revenue_documented: Math.round((revenueByMonth.get(m) ?? 0) * 100) / 100,
    payments_received_verified: Math.round((paymentsReceivedByMonth.get(m) ?? 0) * 100) / 100,
    fuel_bills: Math.round((fuelBillsByMonth.get(m) ?? 0) * 100) / 100,
  }))

  const expenseByCategory = new Map<string, number>()
  for (const e of expensesRes.data ?? []) {
    const cat = expenseCategory(e.document_type, e.vendor_name)
    expenseByCategory.set(cat, (expenseByCategory.get(cat) ?? 0) + Number(e.amount ?? 0))
  }
  const expenseCategories = [...expenseByCategory.entries()]
    .map(([category, total]) => ({ category, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => b.total - a.total)
  const totalCompanyExpenses = expenseCategories.reduce((s, c) => s + c.total, 0)

  const totalOutstandingDebt = (debtRes.data ?? []).reduce((s, d) => s + Number(d.total_outstanding ?? 0), 0)
  const totalRevenueDocumented = months.reduce((s, m) => s + m.revenue_documented, 0)
  const totalPaymentsReceived = months.reduce((s, m) => s + m.payments_received_verified, 0)
  const totalFuelBills = months.reduce((s, m) => s + m.fuel_bills, 0)
  const latestFuelPrice = fuelRes.data?.[0]?.price ?? null

  return NextResponse.json({
    ok: true,
    months,
    totals: {
      revenue_documented: Math.round(totalRevenueDocumented * 100) / 100,
      payments_received_verified: Math.round(totalPaymentsReceived * 100) / 100,
      fuel_bills: Math.round(totalFuelBills * 100) / 100,
      outstanding_debt: Math.round(totalOutstandingDebt * 100) / 100,
      unverified_transfer_slips: Math.round(unverifiedTransferSlipTotal * 100) / 100,
      unverified_transfer_slips_count: unverifiedTransferSlipCount,
      company_expenses: Math.round(totalCompanyExpenses * 100) / 100,
    },
    expense_categories: expenseCategories,
    latest_fuel_price: latestFuelPrice,
    honesty_note:
      "นี่คือสรุปกระแสเงินสดจากเอกสาร/สลิปจริงในระบบ ไม่ใช่งบดุลทางบัญชีที่ถูกต้องตามมาตรฐาน — ระบบยังไม่มีข้อมูลสินทรัพย์ถาวร/ทุน/หนี้สินโครงสร้างจริง จึงยังสร้างงบดุลจริงไม่ได้ ตัวเลขข้างต้นคำนวณจากเอกสารที่มีอยู่จริงในระบบเท่านั้น เอกสาร/สลิปที่ไม่เคยถูกบันทึกเข้าระบบจะไม่ปรากฏในนี้",
  })
}
