import { NextResponse } from "next/server"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { buildRelayCommandText, sendRelayCommand } from "@/engines/equipment/relay-command"

// Equipment GPS/Relay — internal lock-command bridge (owner spec
// 2026-07-24, implemented 2026-08-04). Supabase Edge Functions (Deno)
// cannot import engines/equipment/relay-command.ts directly (Node runtime,
// same cross-runtime boundary documented in
// supabase/functions/debt-reminder-cron/index.ts), so the scheduled cron
// job calls this narrowly-scoped bridge route with a secret — same pattern
// as app/api/internal/line/document-artifact/route.ts. This reuses the
// REAL relay-command engine (Rule 103/111 — never re-implement the SMS
// command shape a second time), it does not fork it.
//
// Used for two automatic (non-admin-confirmed) lock triggers per
// docs/equipment-maintenance-lock-module.md's business-event chain:
// +50h-overdue maintenance safety lock, and 17:00 shift-end lock. Both are
// SAFETY locks, not unlock/start actions — Rule 72's human-confirmation
// requirement is about actions with financial/operational risk from the
// system ACTING (e.g. starting machinery); an automatic LOCK is the
// system defaulting to the safe state, the same posture already accepted
// for gated env-var checks elsewhere in this repo. See
// docs/equipment-maintenance-lock-module.md's Constitution Alignment
// section — trigger-start (unlock) stays admin-confirmed; this route is
// intentionally NOT.
export async function POST(req: Request) {
  const secret = process.env.EQUIPMENT_LOCK_INTERNAL_SECRET
  const got = req.headers.get("x-equipment-lock-secret")
  if (!secret) {
    return NextResponse.json({ error: "ยังไม่ได้ตั้งค่า EQUIPMENT_LOCK_INTERNAL_SECRET" }, { status: 500 })
  }
  if (got !== secret) {
    return NextResponse.json({ error: "ไม่ได้รับอนุญาต" }, { status: 401 })
  }

  const body = await req.json().catch(() => ({})) as { equipmentId?: string }
  const equipmentId = typeof body?.equipmentId === "string" ? body.equipmentId.trim() : ""
  if (!equipmentId) {
    return NextResponse.json({ error: "ต้องระบุ equipmentId" }, { status: 400 })
  }

  const db = supabase()
  const { data: equipment, error: eqErr } = await db
    .from("equipment_assets")
    .select("id, sim_number, box_password, current_status")
    .eq("id", equipmentId)
    .maybeSingle()
  if (eqErr || !equipment) {
    return NextResponse.json({ error: eqErr?.message ?? "ไม่พบเครื่องจักร" }, { status: 404 })
  }
  if (equipment.current_status === "LOCKED") {
    return NextResponse.json({ ok: true, skipped: "locked already" })
  }
  if (!equipment.sim_number || !equipment.box_password) {
    return NextResponse.json({ error: "เครื่องจักรนี้ยังไม่ได้ตั้งค่าเบอร์ซิม/รหัสผ่านกล่อง GPS" }, { status: 400 })
  }

  const commandText = buildRelayCommandText("lock", equipment.box_password)
  const sent = await sendRelayCommand(equipment.sim_number, commandText)
  if (!sent.ok) {
    return NextResponse.json({ error: sent.error }, { status: 502 })
  }

  await db.from("equipment_assets").update({ current_status: "LOCKED", updated_at: new Date().toISOString() }).eq("id", equipmentId)

  return NextResponse.json({ ok: true })
}
