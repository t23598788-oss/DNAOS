/**
 * POST /api/connectors/webhook/[slug]
 *
 * Endpoint รับ event จากบริการภายนอกจริง (inbound) — ไม่ต้องแก้โค้ด ไม่ต้อง
 * deploy ใหม่ แค่สร้าง Webhook Connector จากหน้า Connectors แล้วเอา URL นี้
 * ไปตั้งค่าฝั่งบริการภายนอก
 *
 * Security (owner audit 2026-10-26, finding C1/C2/C4/C6/C7): this route is now
 * fail-closed. Every decision lives in ./_lib/webhookGate.ts so it can be tested
 * without a server; this file only does I/O.
 *
 *   - resolution requires status=connected AND enabled=true (a disabled or
 *     errored connector stops ingesting immediately)
 *   - a webhook whose signature configuration is missing is rejected 503, never
 *     accepted
 *   - unverified bodies are never stored and never answered 200
 *   - body size is capped and only allow-listed headers are persisted
 */

import { NextRequest, NextResponse } from "next/server"
import { getConnectedConnector } from "@/core/connector-loader"
import { recordWebhookEvent } from "@/gateway/connectors"
import { supabaseAdmin } from "@/services/supabase/queries"
import { MAX_WEBHOOK_BODY_BYTES, evaluateWebhookRequest } from "./_lib/webhookGate"

type Params = { params: Promise<{ slug: string }> }

const NOT_FOUND = NextResponse.json({ error: "ไม่พบ Webhook Connector นี้" }, { status: 404 })

export async function POST(req: NextRequest, { params }: Params) {
  const { slug } = await params

  // Only a connector that passed Connect → Register → Test → Enable may ingest.
  const connector = await getConnectedConnector(supabaseAdmin(), slug)
  if (!connector) return NOT_FOUND

  // Cheap pre-read guard: refuse an oversized body before buffering it.
  const declaredLength = req.headers.get("content-length")
  if (declaredLength && Number(declaredLength) > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ error: "เนื้อหาคำขอใหญ่เกินกำหนด" }, { status: 413 })
  }

  const rawBody = await req.text()

  const headers: Record<string, string> = {}
  req.headers.forEach((value, key) => { headers[key.toLowerCase()] = value })

  const decision = evaluateWebhookRequest({
    connector,
    rawBody,
    headers,
    contentLength: declaredLength,
  })

  if (!decision.ok) {
    return NextResponse.json({ error: decision.error, reason: decision.reason }, { status: decision.status })
  }

  await recordWebhookEvent(
    connector.id,
    decision.storedHeaders,
    decision.payload,
    decision.verified,
    decision.eventKey
  )

  return NextResponse.json({ ok: true })
}
