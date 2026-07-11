import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

type Params = { params: Promise<{ pitId: string }> }

// Fills in real GPS for pits that don't have it yet (9 of 96 pits per the
// 2026-07-11 audit) — the pricing engine (engines/distance.ts) can't find a
// pit at all without real coordinates.

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { pitId } = await params
  const body = await req.json().catch(() => ({}))
  const latitude = Number(body?.latitude)
  const longitude = Number(body?.longitude)

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude === 0 || longitude === 0) {
    return NextResponse.json({ error: "พิกัดไม่ถูกต้อง" }, { status: 400 })
  }

  const db = supabase()
  const { error } = await db
    .from("pit_profiles")
    .update({ latitude, longitude, updated_at: new Date().toISOString() })
    .eq("id", pitId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
