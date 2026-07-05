import { NextRequest, NextResponse } from "next/server"
import { getDebtTrackingById, updateDebtTracking, deleteDebtTracking, getFirstInvoiceForPartner } from "@/lib/supabase/queries"
import { calcDebtTrackingSummary } from "@/lib/v3-engines/debt/tracking"

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  try {
    const tracking = await getDebtTrackingById(id)
    const firstInvoice = await getFirstInvoiceForPartner(tracking.partner_id, tracking.customer_name)
    const summary = calcDebtTrackingSummary({
      principalAmount: Number(tracking.principal_amount ?? 0),
      feeRate: Number(tracking.fee_rate ?? 0),
      interestStartAt: tracking.interest_start_at,
    })
    return NextResponse.json({ debtTracking: { ...tracking, summary, firstInvoice } })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ไม่พบข้อมูล" }, { status: 404 })
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
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
  const { id } = await params
  try {
    await deleteDebtTracking(id)
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ลบไม่สำเร็จ" }, { status: 500 })
  }
}
