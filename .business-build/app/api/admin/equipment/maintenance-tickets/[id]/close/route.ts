import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { buildRelayCommandText, sendRelayCommand } from "@/engines/equipment/relay-command"

// Equipment GPS/Relay — Close Maintenance Ticket (implemented 2026-08-04).
// Human-confirmed (requireAuth) — a mechanic/admin marking service done is
// exactly the kind of write Rule 72 requires confirmation for (it changes
// the machine's operational state and, if it was auto-locked, sends a real
// unlock command).
//
// BUSINESS RULE taken literally from the doc's business-event chain:
// "Mechanic closes maintenance ticket -> Reset hour counter, send RELAY
// unlock." Implemented as: total_engine_hours and last_ticket_trigger_hours
// both reset to 0 (fresh 250h cycle starts now), and if the asset is
// currently LOCKED (from the +50h-overdue safety lock), send a real unlock
// command via the same relay-command engine trigger-start uses.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const body = await req.json().catch(() => ({})) as { closedBy?: string }
  const closedBy = typeof body?.closedBy === "string" ? body.closedBy.trim() : null

  const db = supabase()

  const { data: ticket, error: ticketErr } = await db
    .from("maintenance_tickets")
    .select("id, equipment_id, status")
    .eq("id", id)
    .maybeSingle()
  if (ticketErr || !ticket) {
    return NextResponse.json({ error: ticketErr?.message ?? "ไม่พบใบงานซ่อมบำรุง" }, { status: 404 })
  }
  if (ticket.status === "closed") {
    return NextResponse.json({ error: "ใบงานนี้ปิดไปแล้ว" }, { status: 400 })
  }

  const { data: equipment } = await db
    .from("equipment_assets")
    .select("sim_number, box_password, current_status")
    .eq("id", ticket.equipment_id)
    .maybeSingle()

  let unlockWarning: string | null = null
  if (equipment?.current_status === "LOCKED") {
    if (!equipment.sim_number || !equipment.box_password) {
      unlockWarning = "เครื่องยังล็อกอยู่ แต่ยังไม่ได้ตั้งค่าเบอร์ซิม/รหัสผ่านกล่อง GPS จึงปลดล็อกอัตโนมัติไม่ได้"
    } else {
      const commandText = buildRelayCommandText("unlock", equipment.box_password)
      const sent = await sendRelayCommand(equipment.sim_number, commandText)
      if (!sent.ok) {
        unlockWarning = `ปลดล็อกไม่สำเร็จ: ${sent.error}`
      } else {
        await db.from("equipment_assets").update({ current_status: "UNLOCKED" }).eq("id", ticket.equipment_id)
      }
    }
  }

  const nowIso = new Date().toISOString()
  const { error: closeErr } = await db
    .from("maintenance_tickets")
    .update({ status: "closed", closed_at: nowIso, closed_by: closedBy, updated_at: nowIso })
    .eq("id", id)
  if (closeErr) return NextResponse.json({ error: closeErr.message }, { status: 500 })

  await db
    .from("equipment_assets")
    .update({ total_engine_hours: 0, last_ticket_trigger_hours: 0, updated_at: nowIso })
    .eq("id", ticket.equipment_id)

  return NextResponse.json({ ok: true, ...(unlockWarning ? { unlock_warning: unlockWarning } : {}) })
}
