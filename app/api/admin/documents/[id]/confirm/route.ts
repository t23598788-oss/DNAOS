import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

type Params = { params: Promise<{ id: string }> }

// invoices: DRAFT → SENT ("ยืนยัน" = ออกเอกสารจริงให้ลูกค้าแล้ว)
// standalone_documents ไม่มีคอลัมน์สถานะ — ไม่มีอะไรให้ยืนยัน ถือว่าเอกสารสมบูรณ์ตั้งแต่สร้างแล้ว
export async function POST(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id } = await params

  const { data: invoice } = await supabase()
    .from("invoices")
    .select("id, invoice_status")
    .eq("id", id)
    .maybeSingle()

  if (invoice) {
    const { data, error } = await supabase()
      .from("invoices")
      .update({ invoice_status: "SENT", updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id, invoice_no, invoice_status, updated_at")
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ document: { id: data.id, document_number: data.invoice_no, status: data.invoice_status?.toLowerCase(), confirmed_at: data.updated_at } })
  }

  const { data: standalone, error: findErr } = await supabase()
    .from("standalone_documents")
    .select("id, document_no")
    .eq("id", id)
    .maybeSingle()

  if (findErr || !standalone) return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 })

  return NextResponse.json({ document: { id: standalone.id, document_number: standalone.document_no, status: "draft", confirmed_at: null } })
}
