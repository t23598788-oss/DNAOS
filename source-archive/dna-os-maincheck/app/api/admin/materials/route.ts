import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

// DNA-000238: Admin material master (READ-ONLY) — canonical authority = material_types +
// pit_materials + pit_profiles เดิม ไม่มี writer ใหม่ (CREATE/EDIT/ARCHIVE = BLOCKED รอ canonical writer)
export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const mats = await supabase().from("material_types")
    .select("id, name, density_ton_per_cbm, deleted_at").order("name")
  if (mats.error) return NextResponse.json({ error: mats.error.message }, { status: 500 })
  const links = await supabase().from("pit_materials")
    .select("material_type_id, price, pit_profile_id").is("deleted_at", null)
  const pits = await supabase().from("pit_profiles")
    .select("id, pit_name, latitude, longitude").is("deleted_at", null)
  type Link = { material_type_id: string; price: number; pit_profile_id: string }
  type Pit = { id: string; pit_name: string; latitude: string | number | null; longitude: string | number | null }
  const linkRows = ((links.data ?? []) as unknown as Link[]) ?? []
  const pitRows = ((pits.data ?? []) as unknown as Pit[]) ?? []
  const pitMap = new Map(pitRows.map((x) => [x.id, x]))
  const rows = ((mats.data ?? []) as unknown as { id: string; name: string; density_ton_per_cbm: number | null; deleted_at: string | null }[]).map((m) => {
    const src = linkRows.filter((l) => l.material_type_id === m.id)
    const prices = src.map((x) => Number(x.price)).filter((n) => n > 0)
    return {
      id: m.id, name: m.name, density_ton_per_cbm: m.density_ton_per_cbm,
      status: m.deleted_at ? "ARCHIVED" : "ACTIVE",
      sources: src.map((l) => { const p = pitMap.get(l.pit_profile_id); return { pit_name: p?.pit_name ?? "(ไม่ระบุ)", latitude: p?.latitude ?? null, longitude: p?.longitude ?? null, price: Number(l.price) || null } }),
      price_min: prices.length ? Math.min(...prices) : null, price_max: prices.length ? Math.max(...prices) : null,
    }
  })
  return NextResponse.json({ total: rows.length, active: rows.filter((r) => r.status === "ACTIVE").length, materials: rows, write_operations: "BLOCKED — ไม่มี canonical writer สำหรับ material master (รอ approve)" })
}
