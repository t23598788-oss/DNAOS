import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { getDebtTrackings, createDebtTracking } from "@/services/supabase/queries"
import { calcDebtTrackingSummary } from "@/engines/debt/tracking"

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  try {
    const trackings = await getDebtTrackings()
    const withSummary = trackings.map((t) => ({
      ...t,
      summary: calcDebtTrackingSummary({
        principalAmount: Number(t.principal_amount ?? 0),
        feeRate: Number(t.fee_rate ?? 0),
        interestStartAt: t.interest_start_at,
      }),
    }))
    return NextResponse.json({ debtTrackings: withSummary })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const body = await req.json()
  if (!body.partnerId || !body.principalAmount) {
    return NextResponse.json({ error: "ต้องระบุพาร์ทเนอร์และเงินต้น" }, { status: 400 })
  }
  try {
    const tracking = await createDebtTracking({
      partner_id: body.partnerId,
      customer_name: body.customerName,
      principal_amount: Number(body.principalAmount),
      fee_rate: body.feeRate != null ? Number(body.feeRate) : undefined,
      interest_start_at: body.interestStartAt || undefined,
    })
    return NextResponse.json({ debtTracking: tracking }, { status: 201 })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" }, { status: 500 })
  }
}
