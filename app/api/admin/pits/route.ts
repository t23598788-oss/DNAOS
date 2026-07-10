import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

// Real pit/quarry inventory that the pricing engines (engines/distance.ts,
// engines/cost.ts) actually read from — pit_profiles + pit_materials joined
// to real material names, so the control room shows exactly what the
// pricing pipeline can and can't compute yet (owner instruction 2026-07-10:
// this must live in the real control room, connected to the live database,
// not a one-off report).

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const db = supabase()

  const [{ data: pits, error }, { data: pitMaterials }, { data: materialTypes }] = await Promise.all([
    db.from("pit_profiles")
      .select("id, pit_name, address, latitude, longitude, deleted_at")
      .order("pit_name"),
    db.from("pit_materials")
      .select("pit_profile_id, material_type_id, price")
      .is("deleted_at", null),
    db.from("material_types").select("id, name"),
  ])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const materialNameById = new Map((materialTypes ?? []).map((m) => [m.id, m.name]))
  const materialsByPit = new Map<string, { name: string; price: number }[]>()
  for (const pm of pitMaterials ?? []) {
    const name = materialNameById.get(pm.material_type_id)
    if (!name) continue
    const list = materialsByPit.get(pm.pit_profile_id) ?? []
    list.push({ name, price: Number(pm.price) })
    materialsByPit.set(pm.pit_profile_id, list)
  }

  const provinceOf = (addr: string | null) => {
    const m = (addr ?? "").match(/จ\.?\s*([ก-๙]+)/)
    return m ? m[1] : null
  }

  const result = (pits ?? []).map((p) => ({
    id: p.id,
    name: p.pit_name,
    address: p.address,
    province: provinceOf(p.address),
    lat: p.latitude && Number(p.latitude) !== 0 ? Number(p.latitude) : null,
    lng: p.longitude && Number(p.longitude) !== 0 ? Number(p.longitude) : null,
    materials: materialsByPit.get(p.id) ?? [],
    active: !p.deleted_at,
  }))

  return NextResponse.json({ pits: result })
}
