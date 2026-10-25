import { NextResponse } from "next/server"
import { lineDocumentMessages, storeDocumentArtifacts } from "@/gateway/document-artifact-storage"
import type { DocData } from "@/engines/documents/engine"
import { sendLineMessage } from "@/registry/communication";
import { supabaseAdmin } from "@/services/supabase/queries";

/**
 * Edge-cron bridge. Supabase Edge Functions cannot import the Node artifact
 * renderer, so they call this narrowly-scoped server route with a secret.
 * It still uses the same artifact generator and never sends a Flex card.
 */
export async function POST(req: Request) {
  const secret = process.env.DOCUMENT_ARTIFACT_INTERNAL_SECRET
  if (!secret || req.headers.get("x-document-artifact-secret") !== secret) {
    return NextResponse.json({ error: "ไม่ได้รับอนุญาต" }, { status: 401 })
  }

  const body = await req.json().catch(() => null) as { lineUserId?: string; documentId?: string; altText?: string; document?: DocData } | null
  if (!body?.lineUserId || !body.documentId || !body.document) {
    return NextResponse.json({ error: "ข้อมูลเอกสารไม่ครบ" }, { status: 400 })
  }
  const artifacts = await storeDocumentArtifacts(body.documentId, body.document)
  const lineRes = await sendLineMessage(supabaseAdmin(), body.lineUserId, lineDocumentMessages(artifacts, body.altText ?? "เอกสาร"))
  if (!lineRes.success) return NextResponse.json({ error: `ส่ง LINE ไม่สำเร็จ: ${(lineRes.error ?? "").slice(0, 200)}` }, { status: 502 })

  // Delivery evidence (BATCH 38) — this path used to send with NO record at all.
  // Same line_events direction "out" shape as sendInvoiceToLine / send-document:
  // recipient · sent_at (created_at) · provider message id · status · document ref.
  await supabaseAdmin().from("line_events").insert({
    line_user_id: body.lineUserId,
    raw_type: "flex",
    raw_text: `📄 ${body.altText ?? "เอกสาร"} ส่งให้ลูกค้าแล้ว`,
    status: "processed",
    direction: "out",
    line_message_id: lineRes.messageId ?? null,
    extracted: {
      document_kind: body.document.type,
      document_id: body.documentId,
      document_no: body.document.docNumber ?? null,
      provider: "line",
    },
  })

  return NextResponse.json({ ok: true, document_artifact: artifacts })
}
