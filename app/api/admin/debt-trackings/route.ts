import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { getDebtTrackings, createDebtTracking } from "@/services/supabase/queries"
import { supabaseAdmin } from "@/services/supabase/queries"
import { calcDebtTrackingSummary, deriveCollectionStatus, deriveFreezeWindows, sumManualAdjustments, sumManualInterestAdjustments } from "@/engines/debt/tracking"
import { denyUnscoped, resolveAdminReadScope } from "@/app/api/admin/_lib/read-scope"

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const ctx = await resolveAdminReadScope(auth)
  const denied = denyUnscoped(ctx)
  if (denied) return denied
  if (ctx.companyIds && ctx.companyIds.size === 0) return NextResponse.json({ debtTrackings: [] })

  try {
    // Organization scope is applied by the query layer (debt_snapshots carries
    // customer_company_id) — no debt row is fetched outside the caller's org.
    const trackings = await getDebtTrackings(ctx.scope)

    // Debt Collection Freeze Window (owner, 2026-07-18) — batched, one query
    // for the whole list (not per-row), same pattern as every other list-view
    // route (e.g. app/api/admin/relationships/route.ts).
    const companyIds = trackings.map((t) => t.partner_id).filter(Boolean)
    const { data: debtEvents } = companyIds.length
      ? await supabaseAdmin().from("debt_events").select("customer_company_id, event_type, occurred_at, amount")
          .in("customer_company_id", companyIds)
          .in("event_type", ["collection_paused", "collection_resumed", "manual_adjustment", "manual_interest_adjustment", "debt_closed"])
      : { data: [] }
    const eventsByCompanyId = new Map<string, { event_type: string; occurred_at: string; amount?: number | null }[]>()
    for (const e of debtEvents ?? []) {
      const arr = eventsByCompanyId.get(e.customer_company_id) ?? []
      arr.push({ event_type: e.event_type, occurred_at: e.occurred_at, amount: e.amount })
      eventsByCompanyId.set(e.customer_company_id, arr)
    }

    const withSummary = trackings.map((t) => ({
      ...t,
      collectionStatus: deriveCollectionStatus(eventsByCompanyId.get(t.partner_id) ?? []),
      summary: calcDebtTrackingSummary({
        principalAmount: Number(t.principal_amount ?? 0),
        feeRate: Number(t.fee_rate ?? 0),
        interestStartAt: t.interest_start_at,
        freezeFrom: t.freeze_from ?? null,
        freezeUntil: t.freeze_until ?? null,
        freezeWindows: deriveFreezeWindows(eventsByCompanyId.get(t.partner_id) ?? []),
        manualAdjustmentAmount: sumManualAdjustments(eventsByCompanyId.get(t.partner_id) ?? []),
        manualInterestAdjustmentAmount: sumManualInterestAdjustments(eventsByCompanyId.get(t.partner_id) ?? []),
      }),
    }))
    return NextResponse.json({ debtTrackings: withSummary })
  } catch (e: unknown) {
    console.error("[debt-trackings] list query failed:", e instanceof Error ? e.message : e)
    return NextResponse.json({ debtTrackings: [] })
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
