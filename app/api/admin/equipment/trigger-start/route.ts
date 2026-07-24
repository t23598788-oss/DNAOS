import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { buildRelayCommandText, sendRelayCommand } from "@/engines/equipment/relay-command"

// Equipment GPS/Relay Permission System (owner spec, 2026-07-24) — the
// actual hardware-unlock trigger.
//
// SCOPE NOTE (deliberate, not the original spec's shape): the original spec
// had this fire automatically the instant a driver's LINE report-in message
// arrived, no human in the loop. Starting real heavy machinery (an
// excavator someone could be standing near) carries a different risk class
// than a financial confirmation — Rule 72's confirm-before-act principle is
// applied here even more conservatively than the payment auto-confirm case
// built earlier this session. This route is admin-confirmed (requireAuth)
// for now; wiring it to fire from an unattended LINE message match is a
// separate, explicitly-scoped decision for later, once the box's real SMS
// command protocol is confirmed and the message-matching logic exists.
export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))
  const lineUserId = typeof body?.lineUserId === "string" ? body.lineUserId.trim() : ""
  const equipmentId = typeof body?.equipmentId === "string" ? body.equipmentId.trim() : ""
  if (!lineUserId || !equipmentId) {
    return NextResponse.json({ error: "ต้องระบุ lineUserId และ equipmentId" }, { status: 400 })
  }

  const db = supabase()

  const { data: perm } = await db
    .from("driver_equipment_permissions")
    .select("is_active, equipment_assets(id, sim_number, box_password, current_status)")
    .eq("line_user_id", lineUserId)
    .eq("equipment_id", equipmentId)
    .maybeSingle()

  const equipment = (perm as any)?.equipment_assets
  if (!perm || !perm.is_active || !equipment) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์ใช้งานเครื่องจักรนี้" }, { status: 403 })
  }
  if (!equipment.sim_number || !equipment.box_password) {
    return NextResponse.json({ error: "เครื่องจักรนี้ยังไม่ได้ตั้งค่าเบอร์ซิม/รหัสผ่านกล่อง GPS" }, { status: 400 })
  }

  const commandText = buildRelayCommandText("unlock", equipment.box_password)
  const sent = await sendRelayCommand(equipment.sim_number, commandText)
  if (!sent.ok) {
    return NextResponse.json({ error: sent.error }, { status: 502 })
  }

  await db.from("equipment_assets").update({ current_status: "UNLOCKED", updated_at: new Date().toISOString() }).eq("id", equipmentId)

  return NextResponse.json({ ok: true })
}
