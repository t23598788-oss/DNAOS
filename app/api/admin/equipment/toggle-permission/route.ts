import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { setDriverStartButtonRichMenu } from "@/registry/line-richmenu"

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

  return NextResponse.json({
    ok: true,
    rich_menu: richMenu.ok ? "updated" : `ไม่สำเร็จ (ไม่กระทบสิทธิ์ที่บันทึกแล้ว): ${richMenu.error}`,
  })
}
