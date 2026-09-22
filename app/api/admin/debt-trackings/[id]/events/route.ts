import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin } from "@/services/supabase/queries"
import { appendDebtEvent, refreshDebtSnapshotFromLedger, type DebtEventType } from "@/engines/canonical/debt-write"

type Params = { params: Promise<{ id: string }> }
type Action = "pause" | "resume" | "adjust_fee" | "adjust_interest" | "close"

const EVENT_TYPES: Record<Action, DebtEventType> = {
  pause: "collection_paused",
  resume: "collection_resumed",
  adjust_fee: "manual_adjustment",
  adjust_interest: "manual_interest_adjustment",
  close: "debt_closed",
}

// PHASE D5/D9 — every debt mutation goes through the canonical ledger service and
// then refreshes the snapshot projection from that ledger (never from invoices).
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const action = body.action as Action
  if (!action || !EVENT_TYPES[action]) {
    return NextResponse.json({ error: "ไม่รู้จักการดำเนินการ" }, { status: 400 })
  }

  const db = supabaseAdmin()
  const { data: tracking, error: trackingError } = await db
    .from("debt_snapshots")
    .select("customer_company_id")
    .eq("id", id)
    .maybeSingle()
  if (trackingError || !tracking) return NextResponse.json({ error: "ไม่พบรายการติดตามหนี้" }, { status: 404 })

  const amount = action === "adjust_fee" || action === "adjust_interest" ? Number(body.amount) : null
  if ((action === "adjust_fee" || action === "adjust_interest") && (!Number.isFinite(amount) || amount === 0)) {
    return NextResponse.json({ error: "ต้องระบุยอดปรับที่ไม่เป็นศูนย์" }, { status: 400 })
  }

  const note = typeof body.note === "string" ? body.note.trim() : ""
  if ((action === "adjust_fee" || action === "adjust_interest") && !note) {
    return NextResponse.json({ error: "กรุณาระบุเหตุผลการปรับยอด" }, { status: 400 })
  }

  try {
    const event = await appendDebtEvent({
      customer_company_id: String(tracking.customer_company_id),
      event_type: EVENT_TYPES[action],
      amount,
      occurred_at: body.occurredAt || new Date().toISOString().slice(0, 10),
      note: note || null,
      source: "admin_manual",
      actor: auth.email,
    })
    const projection = await refreshDebtSnapshotFromLedger(String(tracking.customer_company_id), auth.email)
    return NextResponse.json(
      {
        event: {
          id: event.id,
          event_type: event.event_type,
          amount: event.amount,
          occurred_at: event.occurred_at,
          note: event.note,
        },
        projection,
      },
      { status: 201 },
    )
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "บันทึกเหตุการณ์หนี้ไม่สำเร็จ" }, { status: 500 })
  }
}
