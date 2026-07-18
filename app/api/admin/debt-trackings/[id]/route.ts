import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { getDebtTrackingById, updateDebtTracking, deleteDebtTracking, getFirstInvoiceForPartner } from "@/services/supabase/queries"
import { calcDebtTrackingSummary, deriveCollectionStatus, sumManualAdjustments, sumManualInterestAdjustments } from "@/engines/debt/tracking"
import { supabaseAdmin } from "@/services/supabase/queries"

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  try {
    const tracking = await getDebtTrackingById(id)
    const firstInvoice = await getFirstInvoiceForPartner(tracking.partner_id, tracking.customer_name)
    const { data: events } = await supabaseAdmin().from("debt_events")
      .select("event_type, occurred_at, amount")
      .eq("customer_company_id", tracking.partner_id)
    const summary = calcDebtTrackingSummary({
      principalAmount: Number(tracking.principal_amount ?? 0),
      feeRate: Number(tracking.fee_rate ?? 0),
      interestStartAt: tracking.interest_start_at,
      manualAdjustmentAmount: sumManualAdjustments(events ?? []),
      manualInterestAdjustmentAmount: sumManualInterestAdjustments(events ?? []),
    })
    return NextResponse.json({ debtTracking: { ...tracking, collectionStatus: deriveCollectionStatus(events ?? []), summary, firstInvoice } })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ไม่พบข้อมูล" }, { status: 404 })
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const body = await req.json()
  try {
    const updated = await updateDebtTracking(id, {
      partner_id: body.partnerId,
      customer_name: body.customerName,
      principal_amount: body.principalAmount != null ? Number(body.principalAmount) : undefined,
      fee_rate: body.feeRate != null ? Number(body.feeRate) : undefined,
      interest_start_at: body.interestStartAt,
    })
    return NextResponse.json({ debtTracking: updated })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  try {
    await deleteDebtTracking(id)
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ลบไม่สำเร็จ" }, { status: 500 })
  }
}
