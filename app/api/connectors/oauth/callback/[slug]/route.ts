/**
 * GET /api/connectors/oauth/callback/[slug]
 *
 * บริการภายนอก redirect กลับมาที่นี่พร้อม ?code=...&state=<connector_id>
 * แลก code เป็น access_token ที่ token_url จริง แล้วบันทึกกลับ ผูกกับ Core อัตโนมัติ
 */

import { NextRequest, NextResponse } from "next/server"
import { recordConnectorTest, updateConnector } from "@/gateway/connectors"
import { getConnector } from "@/core/connector-loader"
import { ADMIN_TIER, getAuthedUser } from "@/core/auth/session"
import { connectorOAuthCookieName, verifyConnectorOAuthState } from "@/core/auth/connector-oauth-state"
import { supabaseAdmin } from "@/services/supabase/queries"
import { completeUserOAuthCallback } from "@/services/connectors/completeUserOAuth"
import { userOAuthCookieName } from "@/services/connectors/userOAuthPolicy"

type Params = { params: Promise<{ slug: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { slug } = await params
  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const oauthError = url.searchParams.get("error")
  const user = await getAuthedUser()
  const db = supabaseAdmin()
  const connector = await getConnector(db, slug)

  if (!connector || connector.auth_type !== "oauth") {
    return NextResponse.json({ error: "ไม่พบ OAuth Connector นี้" }, { status: 404 })
  }

  // User account grants share the registered OAuth app but store each end-user token
  // in that user's own connection row and Vault reference, never in connectors.secret.
  const userCookieName = userOAuthCookieName(connector.id)
  const userCookieValue = req.cookies.get(userCookieName)?.value
  if (userCookieValue) {
    if (!user) {
      const response = NextResponse.redirect(new URL("/login?next=/account/connections", req.url))
      response.cookies.set(userCookieName, "", { httpOnly: true, secure: req.nextUrl.protocol === "https:", sameSite: "lax", path: `/api/connectors/oauth/callback/${slug}`, maxAge: 0 })
      return response
    }
    return completeUserOAuthCallback({ req, user, connector, state, code, oauthError, cookieValue: userCookieValue })
  }

  if (!user || !ADMIN_TIER.includes(user.role)) {
    const loginUrl = new URL("/login", req.url)
    loginUrl.searchParams.set("next", req.nextUrl.pathname)
    return NextResponse.redirect(loginUrl)
  }

  const cookieName = connectorOAuthCookieName(connector.id)
  const cookieValue = req.cookies.get(cookieName)?.value
  if (!verifyConnectorOAuthState({ userId: user.id, state, cookieValue })) {
    return NextResponse.json({ error: "OAuth state ไม่ถูกต้อง หมดอายุ หรือไม่ตรงกับผู้ใช้ที่เริ่มเชื่อมต่อ" }, { status: 400 })
  }

  const finish = (response: NextResponse) => {
    response.cookies.set(cookieName, "", {
      httpOnly: true,
      secure: req.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: `/api/connectors/oauth/callback/${slug}`,
      maxAge: 0,
    })
    return response
  }

  if (oauthError) {
    await recordConnectorTest(connector.id, { ok: false, error: `บริการภายนอกปฏิเสธ: ${oauthError}` })
    return finish(NextResponse.redirect(new URL("/admin/connectors?error=oauth_denied", req.url)))
  }

  if (!code) {
    return finish(NextResponse.json({ error: "ไม่พบ authorization code" }, { status: 400 }))
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
      return finish(NextResponse.redirect(new URL("/admin/connectors?error=token_exchange_failed", req.url)))
    }

    const tokenBody = await tokenRes.json() as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
    }
    if (typeof tokenBody.access_token !== "string" || !tokenBody.access_token) {
      await recordConnectorTest(connector.id, { ok: false, error: "แลก token ไม่สำเร็จ: ไม่มี access_token ในคำตอบ" })
      return finish(NextResponse.redirect(new URL("/admin/connectors?error=token_exchange_failed", req.url)))
    }
    const expiresAt = tokenBody.expires_in
      ? new Date(Date.now() + Number(tokenBody.expires_in) * 1000).toISOString()
      : undefined

    await updateConnector(connector.id, {
      secret: {
        // Preserve the OAuth application's client_secret: user-level grants
        // are stored separately and still need this shared app credential.
        client_secret: secret.client_secret,
        access_token: tokenBody.access_token,
        refresh_token: typeof tokenBody.refresh_token === "string" ? tokenBody.refresh_token : secret.refresh_token,
        expires_at: expiresAt,
      },
    })

    await recordConnectorTest(connector.id, { ok: true })
    return finish(NextResponse.redirect(new URL("/admin/connectors?connected=" + slug, req.url)))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await recordConnectorTest(connector.id, { ok: false, error: msg })
    return finish(NextResponse.redirect(new URL("/admin/connectors?error=exception", req.url)))
  }
}
