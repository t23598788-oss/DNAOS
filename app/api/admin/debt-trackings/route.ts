import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { getDebtTrackings, createDebtTracking } from "@/services/supabase/queries"
import { supabaseAdmin } from "@/services/supabase/queries"
import { calcDebtTrackingSummary, deriveFreezeWindows } from "@/engines/debt/tracking"

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  try {
    const trackings = await getDebtTrackings()

    // Debt Collection Freeze Window (owner, 2026-07-18) — batched, one query
    // for the whole list (not per-row), same pattern as every other list-view
    // route (e.g. app/api/admin/relationships/route.ts).
    const companyIds = trackings.map((t) => t.partner_id).filter(Boolean)
    const { data: debtEvents } = companyIds.length
      ? await supabaseAdmin().from("debt_events").select("customer_company_id, event_type, occurred_at")
          .in("customer_company_id", companyIds)
          .in("event_type", ["collection_paused", "collection_resumed"])
      : { data: [] }
    const eventsByCompanyId = new Map<string, { event_type: string; occurred_at: string }[]>()
    for (const e of debtEvents ?? []) {
      const arr = eventsByCompanyId.get(e.customer_company_id) ?? []
      arr.push({ event_type: e.event_type, occurred_at: e.occurred_at })
      eventsByCompanyId.set(e.customer_company_id, arr)
    }

    const withSummary = trackings.map((t) => ({
      ...t,
      summary: calcDebtTrackingSummary({
        principalAmount: Number(t.principal_amount ?? 0),
        feeRate: Number(t.fee_rate ?? 0),
        interestStartAt: t.interest_start_at,
        freezeFrom: t.freeze_from ?? null,
        freezeUntil: t.freeze_until ?? null,
        freezeWindows: deriveFreezeWindows(eventsByCompanyId.get(t.partner_id) ?? []),
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
