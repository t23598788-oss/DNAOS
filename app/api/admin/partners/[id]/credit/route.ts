import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ANY_AUTHENTICATED } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { denyUnscoped, isCompanyVisible, notFound, resolveAdminReadScope } from "@/app/api/admin/_lib/read-scope"

type Params = { params: Promise<{ id: string }> }

// documents(invoice/receipt) → invoices (receipt = invoice ที่ PAID) · debt → canonical ledger
// PHASE E5.2 — every money figure comes from the canonical model:
//   invoiced/received  = document_canonical + payment_allocations (never `invoice_status === 'PAID'`)
//   open debt          = company_debt_current (ledger projection) — interest/penalty are NOT
//                        recomputed here any more (that lived in the legacy debt calculator)
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ANY_AUTHENTICATED)
  if (auth instanceof NextResponse) return auth

  const { id: partnerId } = await params

  const ctx = await resolveAdminReadScope(auth)
  const denied = denyUnscoped(ctx)
  if (denied) return denied
  if (!isCompanyVisible(ctx, partnerId)) return notFound()

  const [docsRes, allocRes, debtRes, txRes] = await Promise.all([
    supabase()
      .from("document_canonical")
      .select("document_kind, document_id, document_type, document_status, issue_date, subtotal, vat_amount, gross_amount, total_amount, wht_amount, net_payable"),
    supabase()
      .from("payment_allocations")
      .select("amount, invoice_id, standalone_document_id, allocation_kind, allocated_at")
      .or(`invoice_id.not.is.null,standalone_document_id.not.is.null`),
    supabase()
      .from("company_debt_current")
      .select("company_id, snapshot_total_outstanding, ledger_outstanding, ledger_event_count, snapshot_collection_state, snapshot_days_overdue, last_event_at")
      .eq("company_id", partnerId),
    supabase().from("customer_orders").select("id, status, created_at").eq("customer_company_id", partnerId),
  ])

  const transactions = txRes.data ?? []

  // documents of this partner only (document_canonical carries customer_company_id)
  const { data: partnerDocs } = await supabase()
    .from("document_canonical")
    .select("document_id, document_kind, document_type, document_status, gross_amount, total_amount, net_payable, wht_amount, vat_amount, subtotal")
    .eq("customer_company_id", partnerId)
  const docs = (partnerDocs ?? []).filter((d) => !["VOID", "void"].includes(String(d.document_status ?? "")))

  const docIds = new Set(docs.map((d) => String(d.document_id)))
  const allocations = (allocRes.data ?? []).filter(
    (a) => (a.invoice_id && docIds.has(String(a.invoice_id))) || (a.standalone_document_id && docIds.has(String(a.standalone_document_id))),
  )
  const receivedFromAllocations = allocations.reduce((s, a) => s + Number(a.amount ?? 0), 0)

  // receivable = Σ net_payable (fallback gross) of the partner's own non-void documents
  const totalInvoiced = docs.reduce((s, d) => s + Number(d.net_payable ?? d.gross_amount ?? d.total_amount ?? 0), 0)
  const receivedDocs = docs.filter((d) => allocations.some((a) => [a.invoice_id, a.standalone_document_id].includes(d.document_id)))
  const totalReceived = receivedFromAllocations
  const outstanding = Math.max(0, totalInvoiced - receivedFromAllocations)
  const paymentRate = totalInvoiced > 0 ? Math.min(1, receivedFromAllocations / totalInvoiced) : null
  const voidedCount = (partnerDocs ?? []).filter((d) => ["VOID", "void"].includes(String(d.document_status ?? ""))).length

  const closedJobs = transactions.filter((t) => t.status === "PAID").length
  const totalJobs = transactions.length

  const debtRow = debtRes.data?.[0]
  const openDebt = Boolean(debtRow && Number(debtRow.ledger_outstanding ?? 0) > 0)
  const totalDebt = Number(debtRow?.ledger_outstanding ?? 0)


  // ─── Score (0-100) ────────────────────────────────────────────────────────

  let score = 60 // base score

  // +20 ถ้า payment rate ดี
  if (paymentRate !== null) {
    score += Math.round(paymentRate * 20)
  }

  // -20 ถ้ามีหนี้ค้าง
  if (openDebt) score -= 20

  // +10 ถ้ามีประวัติงาน
  if (totalJobs >= 3) score += 5
  if (totalJobs >= 10) score += 5

  // +10 ถ้าปิดงานสำเร็จหลายงาน
  if (closedJobs >= 2) score += 5
  if (totalJobs > 0 && closedJobs / totalJobs >= 0.8) score += 5

  // -15 ถ้าค้างเยอะเกิน 30% ของยอดรวม
  if (totalInvoiced > 0 && outstanding / totalInvoiced > 0.3) score -= 15

  score = Math.max(0, Math.min(100, score))

  // ─── Risk level ──────────────────────────────────────────────────────────

  const risk: "low" | "medium" | "high" =
    score >= 70 ? "low" : score >= 45 ? "medium" : "high"

  const riskLabel = { low: "ดี", medium: "ปานกลาง", high: "ระวัง" }[risk]
  const riskColor = { low: "emerald", medium: "amber", high: "rose" }[risk]

  // ─── ปัจจัยเสี่ยง ─────────────────────────────────────────────────────────

  const flags: string[] = []
  if (openDebt) flags.push("มีรายการติดตามหนี้ที่ยังเปิดอยู่")
  if (outstanding > 50000) flags.push(`ยอดค้างชำระสูง ฿${outstanding.toLocaleString("th-TH")}`)
  if (paymentRate !== null && paymentRate < 0.5) flags.push("อัตราการชำระต่ำกว่า 50%")
  if (totalJobs === 0) flags.push("ยังไม่มีประวัติการทำงาน")

  return NextResponse.json({
    partner_id: partnerId,
    score,
    risk,
    risk_label: riskLabel,
    risk_color: riskColor,
    flags,
    summary: {
      total_invoiced: totalInvoiced,
      total_received: totalReceived,
      outstanding,
      payment_rate: paymentRate,
      invoice_count: docs.length,
      receipt_count: receivedDocs.length,
      voided_count: voidedCount,
      open_debt_count: debtRow ? 1 : 0,
      total_debt: totalDebt,
      job_count: totalJobs,
      closed_job_count: closedJobs,
    },
    payment_basis: "payment_allocations — ยอดที่รับจริงมาจากแถวการจัดสรร ไม่ใช้ invoice_status='PAID'",
    debt_basis: "company_debt_current (ledger ของ debt_events) — ไม่คำนวณดอกเบี้ย/ค่าปรับซ้ำในเส้นนี้",
    calculated_at: new Date().toISOString(),
  })
}
