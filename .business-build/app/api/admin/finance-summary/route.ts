import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { buildFinancialStatements } from "@/engines/accounting/financial-statements"
import { ORG_CONTEXT_COOKIE, sanitizeOrgCookie } from "@/core/auth/orgContext"
import { resolveVerifiedScope } from "@/services/supabase/tenantAuthority"

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

  // Tenant scope is verified against org_members + companies ownership, never
  // taken from the browser. Every reader below uses the service-role client,
  // so these explicit filters are the isolation boundary (RLS is bypassed).
  const orgCookie = sanitizeOrgCookie((await cookies()).get(ORG_CONTEXT_COOKIE)?.value ?? null)
  const scopeResult = await resolveVerifiedScope(supabase(), { auth, organizationId: orgCookie })
  if (!scopeResult.ok) {
    return NextResponse.json({ ok: false, code: scopeResult.code, error: scopeResult.reason }, { status: 403 })
  }
  const scope = scopeResult.scope

  const db = supabase()

  // PHASE E5.1 — canonical sources only:
  //   revenue  = document_canonical (VOID + quotation excluded; gross/net per v1.1)
  //   payments = payment_allocations (rows are the truth; `payment_verified` is
  //              evidence/status and is NEVER counted as money)
  //   debt     = company_debt_current (ledger projection, never recomputed here)
  //   VAT in   = company_expenses.amount_pre_vat + vat_amount (never gross `amount`)
  const [docsRes, receiptsRes, debtRes, fuelRes, expensesRes, allocRes] = await Promise.all([
    db
      .from("document_canonical")
      .select("document_kind, document_type, document_status, issue_date, subtotal, discount_amount, vat_amount, gross_amount, total_amount, wht_amount, net_payable, paid_amount, data_completeness")
      .in("customer_company_id", scope.companyIds),
    db
      .from("receipt_documents")
      .select("amount, document_date, document_type, status")
      .in("customer_company_id", scope.companyIds),
    db
      .from("company_debt_current")
      .select("ledger_outstanding, snapshot_total_outstanding")
      .in("company_id", scope.companyIds),
    db.from("fuel_price_log").select("price, fetched_at").order("fetched_at", { ascending: false }).limit(1),
    // company_expenses has no organization/company column — ownership is reached
    // through its receipt document (real FK), never assumed.
    db
      .from("company_expenses")
      .select("document_type, vendor_name, amount, amount_pre_vat, vat_amount, expense_date, receipt_documents!inner(customer_company_id)")
      .in("receipt_documents.customer_company_id", scope.companyIds),
    // payment_allocations has no org column either — reached through its receipt.
    db
      .from("payment_allocations")
      .select("amount, allocated_at, receipt_documents!inner(customer_company_id)")
      .in("receipt_documents.customer_company_id", scope.companyIds),
  ])

  const canonicalDocs = (docsRes.data ?? []).filter(
    (d) => !["VOID", "void"].includes(String(d.document_status ?? "")) && d.document_type !== "quotation",
  )

  const revenueByMonth = new Map<string, number>()
  for (const d of canonicalDocs) {
    const k = monthKey(d.issue_date ?? null)
    const gross = Number(d.gross_amount ?? d.total_amount ?? 0)
    revenueByMonth.set(k, (revenueByMonth.get(k) ?? 0) + gross)
  }

  const paymentsAllocatedByMonth = new Map<string, number>()
  for (const a of allocRes.data ?? []) {
    const k = monthKey(a.allocated_at ?? null)
    paymentsAllocatedByMonth.set(k, (paymentsAllocatedByMonth.get(k) ?? 0) + Number(a.amount ?? 0))
  }

  const fuelBillsByMonth = new Map<string, number>()
  // Unconfirmed slips are payment EVIDENCE, not payments: reported separately with
  // their own count/amount and deliberately excluded from every money total above.
  let unconfirmedEvidenceTotal = 0
  let unconfirmedEvidenceCount = 0
  for (const r of receiptsRes.data ?? []) {
    const k = monthKey(r.document_date)
    if (r.document_type === "fuel_bill") {
      fuelBillsByMonth.set(k, (fuelBillsByMonth.get(k) ?? 0) + Number(r.amount ?? 0))
    }
    if (["transfer_slip", "payment_advice"].includes(String(r.document_type)) && r.status !== "confirmed") {
      unconfirmedEvidenceTotal += Number(r.amount ?? 0)
      unconfirmedEvidenceCount += 1
    }
  }

  const allMonths = [...new Set([...revenueByMonth.keys(), ...paymentsAllocatedByMonth.keys(), ...fuelBillsByMonth.keys()])]
    .filter((m) => m !== "unknown")
    .sort()

  const months = allMonths.map((m) => {
    const payments = Math.round((paymentsAllocatedByMonth.get(m) ?? 0) * 100) / 100
    return {
      month: m,
      revenue_documented: Math.round((revenueByMonth.get(m) ?? 0) * 100) / 100,
      payments_allocated: payments,
      // legacy key kept so the existing UI keeps working — the source is now
      // allocation rows, not the payment_verified flag
      payments_received_verified: payments,
      fuel_bills: Math.round((fuelBillsByMonth.get(m) ?? 0) * 100) / 100,
    }
  })

  const expenseByCategory = new Map<string, number>()
  let expenseVatInput = 0
  for (const e of expensesRes.data ?? []) {
    const cat = expenseCategory(e.document_type, e.vendor_name)
    const base = e.amount_pre_vat !== null && e.amount_pre_vat !== undefined ? Number(e.amount_pre_vat) : Number(e.amount ?? 0)
    expenseByCategory.set(cat, (expenseByCategory.get(cat) ?? 0) + base)
    expenseVatInput += Number(e.vat_amount ?? 0)
  }
  const expenseCategories = [...expenseByCategory.entries()]
    .map(([category, total]) => ({ category, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => b.total - a.total)
  const totalCompanyExpenses = expenseCategories.reduce((s, c) => s + c.total, 0)

  const totalOutstandingDebt = (debtRes.data ?? []).reduce((s, d) => s + Number(d.ledger_outstanding ?? 0), 0)
  const totalRevenueDocumented = months.reduce((s, m) => s + m.revenue_documented, 0)
  const totalPaymentsAllocated = months.reduce((s, m) => s + m.payments_allocated, 0)
  const totalFuelBills = months.reduce((s, m) => s + m.fuel_bills, 0)
  const latestFuelPrice = fuelRes.data?.[0]?.price ?? null
  const sumCanon = (pick: (d: (typeof canonicalDocs)[number]) => unknown) =>
    Math.round(canonicalDocs.reduce((s, d) => s + Number(pick(d) ?? 0), 0) * 100) / 100

  return NextResponse.json({
    ok: true,
    months,
    totals: {
      revenue_documented: Math.round(totalRevenueDocumented * 100) / 100,
      revenue_subtotal: sumCanon((d) => d.subtotal),
      revenue_vat_output: sumCanon((d) => d.vat_amount),
      revenue_wht_output: sumCanon((d) => d.wht_amount),
      revenue_gross: sumCanon((d) => d.gross_amount ?? d.total_amount),
      revenue_net_payable: sumCanon((d) => d.net_payable ?? d.gross_amount ?? d.total_amount),
      payments_allocated: Math.round(totalPaymentsAllocated * 100) / 100,
      // legacy key kept for the existing UI (now allocation-derived)
      payments_received_verified: Math.round(totalPaymentsAllocated * 100) / 100,
      outstanding_debt: Math.round(totalOutstandingDebt * 100) / 100,
      unverified_transfer_slips: Math.round(unconfirmedEvidenceTotal * 100) / 100,
      unverified_transfer_slips_count: unconfirmedEvidenceCount,
      company_expenses: Math.round(totalCompanyExpenses * 100) / 100,
      company_expenses_pre_vat: Math.round(totalCompanyExpenses * 100) / 100,
      vat_input: Math.round(expenseVatInput * 100) / 100,
      fuel_bills: Math.round(totalFuelBills * 100) / 100,
    },
    // ENG-1 accounting-financial-statements (adopted 2026-10-08): P&L / ฐานะการเงิน /
    // กระแสเงินสด คำนวณจาก totals canonical ด้านบน — engine ล้วน ๆ ไม่ query เอง
    // (finance page แสดงผลจาก key นี้; queries คง PHASE E5.1 canonical sources ไว้)
    financial_statements: buildFinancialStatements({
      revenueDocumented: Math.round(totalRevenueDocumented * 100) / 100,
      paymentsReceivedVerified: Math.round(totalPaymentsAllocated * 100) / 100,
      fuelBills: Math.round(totalFuelBills * 100) / 100,
      outstandingDebt: Math.round(totalOutstandingDebt * 100) / 100,
      unverifiedTransferSlips: Math.round(unconfirmedEvidenceTotal * 100) / 100,
      companyExpenses: totalCompanyExpenses,
    }),
    revenue_basis: "document_canonical — ตัดเอกสาร VOID และใบเสนอราคา (quotation); ยอดเป็น gross/net ตาม canonical v1.1",
    payment_basis: "payment_allocations — แถวการจัดสรรคือความจริง; payment_verified เป็นเพียงสถานะ/หลักฐาน ไม่ถูกนับเป็นเงิน",
    expense_categories: expenseCategories,
    latest_fuel_price: latestFuelPrice,
    honesty_note:
      "นี่คือสรุปกระแสเงินสดจากเอกสาร/สลิปจริงในระบบ (canonical model v1.1) ไม่ใช่งบดุลทางบัญชีที่ถูกต้องตามมาตรฐาน — ยังไม่มีข้อมูลสินทรัพย์ถาวร/ทุน/หนี้สินโครงสร้างจริง จึงยังสร้างงบดุลจริงไม่ได้ · รายได้ตัดเอกสาร VOID และใบเสนอราคาออก · การรับเงินนับจากแถวการจัดสรร (payment_allocations) เท่านั้น ไม่นับจากธง payment_verified · ยอดค้างชำระมาจาก ledger ของหนี้ (company_debt_current) · ค่าใช้จ่ายแสดงแบบก่อน VAT และแยก VAT ซื้อไว้ที่ totals.vat_input",
  })
}
