/**
 * /api/admin/god-view/override — the owner's manual override on an exception.
 *
 * "กด Override เฉพาะเคสที่มีปัญหา (Accident Exception)"
 *
 * What an override IS here: the owner takes responsibility for one flagged case
 * (stuck broadcast, stalled order, failed rule send) — the decision is recorded
 * in audit_logs with the exception kind, the record id and an optional note.
 * What it is NOT: a silent status mutation. Changing an order/truck state stays
 * on that record's own route (where the state machine and its guards live), so
 * pressing override here can never skip a transition.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin } from "@/services/supabase/queries"

const OVERRIDE_ACTIONS = ["acknowledge", "escalate", "resolved"] as const
type OverrideAction = (typeof OVERRIDE_ACTIONS)[number]

export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const kind = typeof body?.kind === "string" ? body.kind.trim() : ""
  const refId = typeof body?.refId === "string" ? body.refId.trim() : ""
  const action = typeof body?.action === "string" ? (body.action.trim() as OverrideAction) : "acknowledge"
  const note = typeof body?.note === "string" ? body.note.trim() : ""

  if (!kind) return NextResponse.json({ error: "ต้องระบุ kind ของ exception" }, { status: 400 })
  if (!refId) return NextResponse.json({ error: "ต้องระบุ refId ของรายการ" }, { status: 400 })
  if (!OVERRIDE_ACTIONS.includes(action)) {
    return NextResponse.json(
      { error: `action ต้องเป็นหนึ่งใน ${OVERRIDE_ACTIONS.join(", ")}` },
      { status: 400 },
    )
  }

  const { error } = await supabaseAdmin().from("audit_logs").insert({
    entity_type: "god_view_exception",
    entity_id: refId,
    action: `override_${action}`,
    field: kind,
    old_value: null,
    new_value: note || `by ${auth.email ?? auth.id}`,
  })

  if (error) {
    console.error("[god-view/override] audit write failed:", error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, kind, refId, action })
}
