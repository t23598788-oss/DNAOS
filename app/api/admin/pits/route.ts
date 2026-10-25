import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { parseAreaFromAddress } from "@/core/public-catalog/geography"

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
      .select("id, pit_name, address, latitude, longitude, deleted_at, line_user_id")
      .order("pit_name"),
    // `id` is included so the publication writer (app/api/admin/publications)
    // can grant per-price publication permission from this same control room.
    db.from("pit_materials")
      .select("id, pit_profile_id, material_type_id, price")
      .is("deleted_at", null),
    db.from("material_types").select("id, name"),
  ])

  if (error) {
    console.error("[pits] list query failed:", error.message)
    return NextResponse.json({ pits: [], materialTypes: materialTypes ?? [] })
  }

  const materialNameById = new Map((materialTypes ?? []).map((m) => [m.id, m.name]))
  const materialsByPit = new Map<string, { id: string; material_type_id: string; name: string; price: number }[]>()
  for (const pm of pitMaterials ?? []) {
    const name = materialNameById.get(pm.material_type_id)
    if (!name) continue
    const list = materialsByPit.get(pm.pit_profile_id) ?? []
    list.push({ id: pm.id, material_type_id: pm.material_type_id, name, price: Number(pm.price) })
    materialsByPit.set(pm.pit_profile_id, list)
  }

  // One parser, shared with the public reader (core/public-catalog/geography)
  // — the control room and the public table can never disagree on จังหวัด.
  const result = (pits ?? []).map((p) => ({
    id: p.id,
    name: p.pit_name,
    address: p.address,
    province: parseAreaFromAddress(p.address).province,
    lat: p.latitude && Number(p.latitude) !== 0 ? Number(p.latitude) : null,
    lng: p.longitude && Number(p.longitude) !== 0 ? Number(p.longitude) : null,
    materials: materialsByPit.get(p.id) ?? [],
    active: !p.deleted_at,
    line_user_id: p.line_user_id ?? null,
  }))

  return NextResponse.json({ pits: result, materialTypes: materialTypes ?? [] })
}
