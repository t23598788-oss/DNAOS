import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

type Params = { params: Promise<{ pitId: string }> }

// Owner-reported gap 2026-07-11: /admin/pits was a read-only report — เฮีย
// could SEE that 91 of 96 pits had no price set (the real reason the LINE
// bot and admin ask-AI box can't answer price questions), but had no way to
// actually enter one. This is that missing write path. pit_materials has no
// unique constraint on (pit_profile_id, material_type_id), so we check for
// an existing row ourselves before deciding update vs insert.

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { pitId } = await params
  const body = await req.json().catch(() => ({}))
  const materialTypeId = typeof body?.material_type_id === "string" ? body.material_type_id : ""
  const price = Number(body?.price)

  if (!materialTypeId) return NextResponse.json({ error: "ขาด material_type_id" }, { status: 400 })
  if (!Number.isFinite(price) || price <= 0) return NextResponse.json({ error: "ราคาต้องเป็นตัวเลขมากกว่า 0" }, { status: 400 })

  const db = supabase()

  const { data: existing } = await db
    .from("pit_materials")
    .select("id")
    .eq("pit_profile_id", pitId)
    .eq("material_type_id", materialTypeId)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle()

  if (existing) {
    const { error } = await db.from("pit_materials").update({ price, updated_at: new Date().toISOString() }).eq("id", existing.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await db.from("pit_materials").insert({
      id: crypto.randomUUID(),
      pit_profile_id: pitId,
      material_type_id: materialTypeId,
      price,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
