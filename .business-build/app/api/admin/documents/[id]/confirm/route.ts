import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { issueDocument } from "@/engines/canonical/document-write"

type Params = { params: Promise<{ id: string }> }

// PHASE D9 — issuing a document goes through the canonical write service:
// status change + a NEW version snapshot (append-only). standalone_documents now
// really has a status column, so issuing is meaningful for both kinds, and an
// issued document must have real line items (no row invented from a total).
export async function POST(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id } = await params

  const { data: invoice } = await supabase().from("invoices").select("id, invoice_no").eq("id", id).maybeSingle()
  const { data: standalone } = invoice ? { data: null } : await supabase().from("standalone_documents").select("id, document_no").eq("id", id).maybeSingle()

  const kind = invoice ? "invoice" : standalone ? "standalone_document" : null
  if (!kind) return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 })

  try {
    const result = await issueDocument({
      document_kind: kind,
      document_id: id,
      actor: auth.email,
      new_status: kind === "invoice" ? "SENT" : "active",
    })
    return NextResponse.json({
      document: {
        id: result.document_id,
        document_number: invoice?.invoice_no ?? standalone?.document_no ?? null,
        status: result.status.toLowerCase(),
        confirmed_at: new Date().toISOString(),
        version_no: result.version.version_no,
      },
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "ยืนยันเอกสารไม่สำเร็จ"
    const status = message.startsWith("DOCUMENT_") && !message.startsWith("DOCUMENT_NOT_FOUND") ? 400 : 500
    return NextResponse.json({ error: message }, { status: message.startsWith("DOCUMENT_NOT_FOUND") ? 404 : status })
  }
}
