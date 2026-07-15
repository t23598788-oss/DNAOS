/**
 * POST /api/connectors/webhook/[slug]
 *
 * Endpoint รับ event จากบริการภายนอกจริง (inbound) — ไม่ต้องแก้โค้ด ไม่ต้อง
 * deploy ใหม่ แค่สร้าง Webhook Connector จากหน้า Connectors แล้วเอา URL นี้
 * ไปตั้งค่าฝั่งบริการภายนอก
 */

import { createHmac, timingSafeEqual } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { getConnector } from "@/core/connector-loader"
import { recordWebhookEvent } from "@/gateway/connectors"
import { supabaseAdmin } from "@/services/supabase/queries"

type Params = { params: Promise<{ slug: string }> }

function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex")
  const a = Buffer.from(expected)
  const b = Buffer.from(signature.replace(/^sha256=/, ""))
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function POST(req: NextRequest, { params }: Params) {
  const { slug } = await params

  const connector = await getConnector(supabaseAdmin(), slug)

  if (!connector || connector.auth_type !== "webhook") {
    return NextResponse.json({ error: "ไม่พบ Webhook Connector นี้" }, { status: 404 })
  }

  const rawBody = await req.text()
  const headers: Record<string, string> = {}
  req.headers.forEach((value, key) => { headers[key] = value })

  const config = connector.config as Record<string, unknown>
  const secret = connector.secret as Record<string, unknown>
  const signatureHeader = config.signature_header as string | undefined
  const signingSecret = secret.signing_secret as string | undefined

  let verified = false
  if (signatureHeader && signingSecret) {
    const sig = req.headers.get(signatureHeader)
    verified = !!sig && verifySignature(rawBody, sig, signingSecret)
    if (!verified) {
      return NextResponse.json({ error: "ลายเซ็นไม่ถูกต้อง" }, { status: 401 })
    }
  }

  let payload: unknown = rawBody
  try { payload = JSON.parse(rawBody) } catch { /* เก็บเป็น raw text ถ้าไม่ใช่ JSON */ }

  await recordWebhookEvent(connector.id, headers, payload, verified)

  return NextResponse.json({ ok: true })
}
