import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase/queries"

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id: partnerId } = await params

  const [invoicesRes, receiptsRes, debtRes, txRes] = await Promise.all([
    supabase()
      .from("documents")
      .select("id, net_amount, issue_date, status, created_at")
      .eq("partner_id", partnerId)
      .eq("document_type", "invoice")
      .is("deleted_at", null),

    supabase()
      .from("documents")
      .select("id, net_amount, issue_date, created_at")
      .eq("partner_id", partnerId)
      .eq("document_type", "receipt")
      .is("deleted_at", null),

    supabase()
      .from("debt_trackings")
      .select("id, principal_amount, fee_rate, interest_start_at, created_at")
      .eq("partner_id", partnerId)
      .is("deleted_at", null),

    supabase()
      .from("transactions")
      .select("id, tx_type, state, net_amount, paid_amount, created_at")
      .eq("partner_id", partnerId)
      .is("deleted_at", null),
  ])

  const invoices = invoicesRes.data ?? []
  const receipts = receiptsRes.data ?? []
  const debts = debtRes.data ?? []
  const transactions = txRes.data ?? []

  // ─── คำนวณ ────────────────────────────────────────────────────────────────

  const totalInvoiced = invoices.reduce((s, d) => s + Number(d.net_amount ?? 0), 0)
  const totalReceived = receipts.reduce((s, d) => s + Number(d.net_amount ?? 0), 0)
  const outstanding = Math.max(0, totalInvoiced - totalReceived)
  const paymentRate = totalInvoiced > 0 ? Math.min(1, totalReceived / totalInvoiced) : null

  // จำนวนงานที่ปิดสำเร็จ vs ทั้งหมด
  const closedJobs = transactions.filter((t) => t.state === "closed" || t.state === "paid").length
  const totalJobs = transactions.length

  // หนี้ค้างชำระ
  const openDebt = debts.length > 0
  const totalDebt = debts.reduce((s, d) => s + Number(d.principal_amount ?? 0), 0)

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
