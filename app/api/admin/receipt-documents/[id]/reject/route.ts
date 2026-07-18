import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

type Params = { params: Promise<{ id: string }> }

// Payment Verification Engine — Phase 1 (owner, 2026-07-18): the Rejected/
// Mismatch path — amount doesn't match, name doesn't match, no real transfer
// found, or a suspicious slip. No receipt_documents row is ever deleted
// (Rule 104 — nothing is wasted); it's marked rejected and stays in the
// audit trail.
export async function POST(req: Request, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const db = supabase()

  const { data: doc, error: docErr } = await db
    .from("receipt_documents").select("id, status").eq("id", id).maybeSingle()
  if (docErr) return NextResponse.json({ error: docErr.message }, { status: 500 })
  if (!doc) return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 })
  if (doc.status !== "ai_read" && doc.status !== "waiting_bank_confirmation") {
    return NextResponse.json({ error: `เอกสารนี้ถูกดำเนินการไปแล้ว (สถานะ: ${doc.status})` }, { status: 400 })
  }

  await db.from("receipt_documents")
    .update({
      status: "rejected",
      error_th: body?.reason || "ปฏิเสธโดยเจ้าหน้าที่ — ไม่พบหลักฐานเงินเข้าจริงหรือข้อมูลไม่ตรงกัน",
      confirmed_by: auth.email,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)

  return NextResponse.json({ ok: true })
}
