import { NextResponse } from "next/server"
import { lineDocumentMessages, storeDocumentArtifacts } from "@/gateway/document-artifact-storage"
import type { DocData } from "@/engines/documents/engine"
import { sendLineMessage } from "@/registry/communication"

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
  const lineRes = await sendLineMessage(body.lineUserId, lineDocumentMessages(artifacts, body.altText ?? "เอกสาร"))
  if (!lineRes.success) return NextResponse.json({ error: `ส่ง LINE ไม่สำเร็จ: ${(lineRes.error ?? "").slice(0, 200)}` }, { status: 502 })
  return NextResponse.json({ ok: true, document_artifact: artifacts })
}
