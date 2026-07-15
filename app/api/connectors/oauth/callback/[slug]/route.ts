/**
 * GET /api/connectors/oauth/callback/[slug]
 *
 * บริการภายนอก redirect กลับมาที่นี่พร้อม ?code=...&state=<connector_id>
 * แลก code เป็น access_token ที่ token_url จริง แล้วบันทึกกลับ ผูกกับ Core อัตโนมัติ
 */

import { NextRequest, NextResponse } from "next/server"
import { recordConnectorTest, updateConnector } from "@/gateway/connectors"
import { getConnector } from "@/core/connector-loader"
import { supabaseAdmin } from "@/services/supabase/queries"

type Params = { params: Promise<{ slug: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { slug } = await params
  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const oauthError = url.searchParams.get("error")

  const connector = await getConnector(supabaseAdmin(), slug)

  if (!connector || connector.auth_type !== "oauth") {
    return NextResponse.json({ error: "ไม่พบ OAuth Connector นี้" }, { status: 404 })
  }

  if (oauthError) {
    await recordConnectorTest(connector.id, { ok: false, error: `บริการภายนอกปฏิเสธ: ${oauthError}` })
    return NextResponse.redirect(new URL("/admin/connectors?error=oauth_denied", req.url))
  }

  if (!code || state !== connector.id) {
    return NextResponse.json({ error: "ไม่พบ code หรือ state ไม่ตรงกัน (อาจถูกปลอมแปลง)" }, { status: 400 })
  }

  const config = connector.config as Record<string, unknown>
  const secret = connector.secret as Record<string, unknown>
  const tokenUrl = config.token_url as string
  const clientId = config.client_id as string
  const clientSecret = secret.client_secret as string
  const redirectUri = config.redirect_uri as string

  if (!tokenUrl || !clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Connector นี้ยังไม่ครบ config: ต้องมี token_url, client_id, client_secret" },
      { status: 400 }
    )
  }

  try {
    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    })

    if (!tokenRes.ok) {
      const body = await tokenRes.text()
      await recordConnectorTest(connector.id, { ok: false, error: `แลก token ไม่สำเร็จ: HTTP ${tokenRes.status} ${body.slice(0, 200)}` })
      return NextResponse.redirect(new URL("/admin/connectors?error=token_exchange_failed", req.url))
    }

    const tokenBody = await tokenRes.json()
    const expiresAt = tokenBody.expires_in
      ? new Date(Date.now() + Number(tokenBody.expires_in) * 1000).toISOString()
      : undefined

    await updateConnector(connector.id, {
      secret: {
        access_token: tokenBody.access_token,
        refresh_token: tokenBody.refresh_token ?? secret.refresh_token,
        expires_at: expiresAt,
      },
    })

    await recordConnectorTest(connector.id, { ok: true })
    return NextResponse.redirect(new URL("/admin/connectors?connected=" + slug, req.url))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await recordConnectorTest(connector.id, { ok: false, error: msg })
    return NextResponse.redirect(new URL("/admin/connectors?error=exception", req.url))
  }
}
