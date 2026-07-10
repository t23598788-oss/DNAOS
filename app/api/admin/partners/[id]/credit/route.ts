import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

type Params = { params: Promise<{ id: string }> }

// documents(invoice/receipt) → invoices (receipt = invoice ที่ invoice_status = PAID)
// debt_trackings → debt_snapshots, transactions → customer_orders
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id: partnerId } = await params

  const [invoicesRes, debtRes, txRes] = await Promise.all([
    supabase()
      .from("invoices")
      .select("id, total_amount, invoice_date, invoice_status, created_at")
      .eq("customer_company_id", partnerId),

    supabase()
      .from("debt_snapshots")
      .select("id, total_outstanding, debt_start_at, created_at")
      .eq("customer_company_id", partnerId),

    supabase()
      .from("customer_orders")
      .select("id, status, created_at")
      .eq("customer_company_id", partnerId),
  ])

  const invoices = invoicesRes.data ?? []
  const receipts = invoices.filter((d: any) => d.invoice_status === "PAID")
  const debts = debtRes.data ?? []
  const transactions = txRes.data ?? []

  // ─── คำนวณ ────────────────────────────────────────────────────────────────

  const totalInvoiced = invoices.reduce((s, d: any) => s + Number(d.total_amount ?? 0), 0)
  const totalReceived = receipts.reduce((s, d: any) => s + Number(d.total_amount ?? 0), 0)
  const outstanding = Math.max(0, totalInvoiced - totalReceived)
  const paymentRate = totalInvoiced > 0 ? Math.min(1, totalReceived / totalInvoiced) : null

  // จำนวนงานที่ปิดสำเร็จ vs ทั้งหมด
  const closedJobs = transactions.filter((t: any) => t.status === "PAID").length
  const totalJobs = transactions.length

  // หนี้ค้างชำระ
  const openDebt = debts.length > 0
  const totalDebt = debts.reduce((s, d: any) => s + Number(d.total_outstanding ?? 0), 0)

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
      invoice_count: invoices.length,
      receipt_count: receipts.length,
      open_debt_count: debts.length,
      total_debt: totalDebt,
      job_count: totalJobs,
      closed_job_count: closedJobs,
    },
    calculated_at: new Date().toISOString(),
  })
}
