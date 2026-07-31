/**
 * GET  /api/admin/api-tokens  — list tokens for current user
 * POST /api/admin/api-tokens  — create a new token
 */

import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { listTokensForEmail, createApiToken } from "@/services/supabase/api-tokens"

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  try {
    const tokens = await listTokensForEmail(auth.email)
    return NextResponse.json({ tokens })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[api-tokens] list query failed:", msg)
    return NextResponse.json({ tokens: [] })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  try {
    const body = await req.json().catch(() => ({}))
    const label = String(body.label ?? "").trim() || "default"
    const token = await createApiToken(auth.email, label)
    return NextResponse.json({ token }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
