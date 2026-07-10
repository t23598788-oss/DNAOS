import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { resolveMaterial, type MaterialTypeRow } from "@/engines/material-resolver"
import { tryQuoteMaterialPrice } from "@/engines/quote-price"
import { runCognitivePipeline } from "@/cognitive/pipeline"

type Params = { params: Promise<{ lineUserId: string }> }

// Owner-reported gap 2026-07-11: "ถาม AI" in this page couldn't answer real
// material-price questions — it only talked to the generic cognitive
// pipeline (view customer/debt/create document intents), which has no idea
// about pit_materials at all. This route checks deterministically (not via
// AI judgment — ห้ามเดา) whether the question names a real material first;
// if so it answers with the real engine using this specific contact's last
// known GPS. Anything else falls through to the existing pipeline unchanged.

function extractQuantity(text: string): number {
  const match = text.match(/\d+(\.\d+)?/)
  return match ? Number(match[0]) : 1
}

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { lineUserId } = await params
  const body = await req.json().catch(() => ({}))
  const question = typeof body?.question === "string" ? body.question.trim() : ""
  if (!question) return NextResponse.json({ error: "คำถามว่างเปล่า" }, { status: 400 })

  const db = supabase()

  const { data: materialTypes } = await db.from("material_types").select("id, name")
  const match = resolveMaterial(question, (materialTypes ?? []) as MaterialTypeRow[])

  if (match.matched || match.candidates.length > 0) {
    const { data: locationMsg } = await db
      .from("line_events")
      .select("extracted")
      .eq("line_user_id", lineUserId)
      .eq("raw_type", "location")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    const gps = locationMsg?.extracted?.latitude != null && locationMsg?.extracted?.longitude != null
      ? { lat: Number(locationMsg.extracted.latitude), lng: Number(locationMsg.extracted.longitude) }
      : null

    const quantity = extractQuantity(question)
    const text = await tryQuoteMaterialPrice(question, quantity, gps)
    return NextResponse.json({ sender: "ai", type: "text", text })
  }

  // Not a price question — fall through to the existing chat pipeline
  // (create documents, view debt/jobs, general Q&A) unchanged.
  const result = await runCognitivePipeline(question)
  return NextResponse.json(result)
}
