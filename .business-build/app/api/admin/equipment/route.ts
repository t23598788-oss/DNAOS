import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

// Equipment GPS/Relay Permission System (owner spec, 2026-07-24) — the
// control-room list/create endpoint. Separate from Contact Settings
// (registry/contact-settings-categories.ts) on purpose: a driver can have
// permission to MORE THAN ONE equipment unit, each with its own sim/status —
// a real many-to-many relationship the generic per-contact jsonb settings
// blob doesn't model. This is the EXTEND path (Rule 103), a dedicated small
// admin surface like /admin/pits, not a duplicate of Contact Settings.

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const db = supabase()
  const [{ data: equipment, error }, { data: permissions }] = await Promise.all([
    db.from("equipment_assets").select("id, asset_code, name, sim_number, imei, current_status, total_engine_hours").order("asset_code"),
    db.from("driver_equipment_permissions").select("id, line_user_id, equipment_id, is_active"),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const lineUserIds = [...new Set((permissions ?? []).map((p) => p.line_user_id))]
  const { data: profiles } = lineUserIds.length
    ? await db.from("line_profiles").select("line_user_id, display_name").in("line_user_id", lineUserIds)
    : { data: [] as { line_user_id: string; display_name: string | null }[] }
  const nameByLineUserId = new Map((profiles ?? []).map((p) => [p.line_user_id, p.display_name]))

  const permissionsByEquipment = new Map<string, { id: string; line_user_id: string; display_name: string | null; is_active: boolean }[]>()
  for (const p of permissions ?? []) {
    const list = permissionsByEquipment.get(p.equipment_id) ?? []
    list.push({ id: p.id, line_user_id: p.line_user_id, display_name: nameByLineUserId.get(p.line_user_id) ?? null, is_active: p.is_active })
    permissionsByEquipment.set(p.equipment_id, list)
  }

  const result = (equipment ?? []).map((e) => ({
    ...e,
    permissions: permissionsByEquipment.get(e.id) ?? [],
  }))

  return NextResponse.json({ equipment: result })
}

export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))
  const assetCode = typeof body?.asset_code === "string" ? body.asset_code.trim() : ""
  const name = typeof body?.name === "string" ? body.name.trim() : ""
  if (!assetCode || !name) return NextResponse.json({ error: "ต้องระบุ asset_code และ name" }, { status: 400 })

  const db = supabase()
  const { data, error } = await db
    .from("equipment_assets")
    .insert({
      asset_code: assetCode,
      name,
      sim_number: typeof body?.sim_number === "string" ? body.sim_number.trim() || null : null,
      imei: typeof body?.imei === "string" ? body.imei.trim() || null : null,
      box_password: typeof body?.box_password === "string" ? body.box_password.trim() || null : null,
    })
    .select("id")
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, id: data.id })
}
