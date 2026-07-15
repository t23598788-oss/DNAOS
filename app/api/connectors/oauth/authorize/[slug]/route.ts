/**
 * GET /api/connectors/oauth/authorize/[slug]
 *
 * ปุ่ม "Connect" ของ OAuth Connector ลิงก์มาที่นี่ — สร้าง authorize_url
 * จาก config ที่กรอกไว้ (authorize_url, client_id, scope, redirect_uri) แล้ว
 * redirect ออกไปหาบริการภายนอกจริง
 */

import { NextRequest, NextResponse } from "next/server"
import { getAuthedUser, ADMIN_TIER } from "@/core/auth/session"
import { getConnector } from "@/core/connector-loader"
import { supabaseAdmin } from "@/services/supabase/queries"

type Params = { params: Promise<{ slug: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const user = await getAuthedUser()
  if (!user || !ADMIN_TIER.includes(user.role)) {
    const loginUrl = new URL("/login", req.url)
    loginUrl.searchParams.set("next", req.nextUrl.pathname)
    return NextResponse.redirect(loginUrl)
  }

  const { slug } = await params
  const connector = await getConnector(supabaseAdmin(), slug)

  if (!connector || connector.auth_type !== "oauth") {
    return NextResponse.json({ error: "ไม่พบ OAuth Connector นี้" }, { status: 404 })
  }

  const config = connector.config as Record<string, unknown>
  const authorizeUrl = config.authorize_url as string
  const clientId = config.client_id as string
  const scope = (config.scope as string) ?? ""
  const redirectUri = config.redirect_uri as string

  if (!authorizeUrl || !clientId || !redirectUri) {
    return NextResponse.json(
      { error: "Connector นี้ยังไม่ครบ config: ต้องมี authorize_url, client_id, redirect_uri" },
      { status: 400 }
    )
  }

  const url = new URL(authorizeUrl)
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("response_type", "code")
  if (scope) url.searchParams.set("scope", scope)
  url.searchParams.set("state", connector.id)

  return NextResponse.redirect(url.toString())
}
