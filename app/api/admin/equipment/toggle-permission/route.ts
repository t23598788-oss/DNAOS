import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { setDriverStartButtonRichMenu } from "@/registry/line-richmenu"
import { buildRelayCommandText, sendRelayCommand } from "@/engines/equipment/relay-command"

// Permission-revocation → hardware lock (implemented 2026-08-04, per
// docs/equipment-maintenance-lock-module.md's "NOT WIRED YET" row).
//
// BUSINESS RULE ASSUMED, stated explicitly per this task's own instruction
// not to guess silently: driver_equipment_permissions is many-to-many
// (one equipment unit can be permitted to several drivers — see the doc's
// "Why this exists" section: "One GPS/relay box can be shared by many
// drivers"). Revoking ONE driver's permission does not mean nobody is
// authorized anymore — locking on every single revoke would strand a
// different, still-authorized driver mid-shift. The literal, defensible
// reading: lock the physical asset only when revoking this permission
// leaves ZERO other active permissions for that equipment_id (i.e. no
// driver on earth is currently authorized to run it). This is the
// interpretation implemented below — flagged here for the owner to
// confirm, since the doc's business-event chain diagram doesn't
// disambiguate "a driver's permission revoked" vs "the last driver's
// permission revoked."
async function lockIfNoActivePermissionsRemain(db: any, equipmentId: string): Promise<string | null> {
  const { count } = await db
    .from("driver_equipment_permissions")
    .select("id", { count: "exact", head: true })
    .eq("equipment_id", equipmentId)
    .eq("is_active", true)
  if ((count ?? 0) > 0) return null // someone else still authorized — do not lock

  const { data: equipment } = await db
    .from("equipment_assets")
    .select("sim_number, box_password, current_status")
    .eq("id", equipmentId)
    .maybeSingle()
  if (!equipment || equipment.current_status === "LOCKED") return null
  if (!equipment.sim_number || !equipment.box_password) {
    return "ไม่มีผู้มีสิทธิ์เหลือแล้ว แต่ยังไม่ได้ตั้งค่าเบอร์ซิม/รหัสผ่านกล่อง GPS จึงล็อกอัตโนมัติไม่ได้"
  }

  const commandText = buildRelayCommandText("lock", equipment.box_password)
  const sent = await sendRelayCommand(equipment.sim_number, commandText)
  if (!sent.ok) return `ล็อกอัตโนมัติไม่สำเร็จ: ${sent.error}`

  await db.from("equipment_assets").update({ current_status: "LOCKED", updated_at: new Date().toISOString() }).eq("id", equipmentId)
  return null
}

// Equipment GPS/Relay Permission System (owner spec, 2026-07-24) — the
// "ไม้กายสิทธิ์" (magic wand) toggle: admin turns a driver's permission for
// one equipment unit on/off, and the driver's LINE Rich Menu updates to
// match (start button appears/disappears) so what they can DO on LINE
// always matches what they're actually allowed to do — never a stale UI.
export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))
  const lineUserId = typeof body?.lineUserId === "string" ? body.lineUserId.trim() : ""
  const equipmentId = typeof body?.equipmentId === "string" ? body.equipmentId.trim() : ""
  const isActive = Boolean(body?.isActive)
  const simNumber = typeof body?.simNumber === "string" ? body.simNumber.trim() : ""

  if (!lineUserId || !equipmentId) {
    return NextResponse.json({ error: "ต้องระบุ lineUserId และ equipmentId" }, { status: 400 })
  }

  const db = supabase()

  const { data: profile } = await db.from("line_profiles").select("line_user_id").eq("line_user_id", lineUserId).maybeSingle()
  if (!profile) {
    return NextResponse.json({ error: "ยังไม่พบผู้ติดต่อรายนี้ใน line_profiles — ต้องมีประวัติแชทจริงก่อนให้สิทธิ์" }, { status: 400 })
  }

  if (simNumber) {
    await db.from("equipment_assets").update({ sim_number: simNumber, updated_at: new Date().toISOString() }).eq("id", equipmentId)
  }

  const { data: existing } = await db
    .from("driver_equipment_permissions")
    .select("id")
    .eq("line_user_id", lineUserId)
    .eq("equipment_id", equipmentId)
    .maybeSingle()

  if (existing) {
    await db.from("driver_equipment_permissions").update({ is_active: isActive, updated_at: new Date().toISOString() }).eq("id", existing.id)
  } else {
    await db.from("driver_equipment_permissions").insert({ line_user_id: lineUserId, equipment_id: equipmentId, is_active: isActive })
  }

  const richMenu = await setDriverStartButtonRichMenu(lineUserId, isActive)

  let lockWarning: string | null = null
  if (!isActive) {
    lockWarning = await lockIfNoActivePermissionsRemain(db, equipmentId)
  }

  return NextResponse.json({
    ok: true,
    rich_menu: richMenu.ok ? "updated" : `ไม่สำเร็จ (ไม่กระทบสิทธิ์ที่บันทึกแล้ว): ${richMenu.error}`,
    ...(lockWarning ? { lock_warning: lockWarning } : {}),
  })
}
