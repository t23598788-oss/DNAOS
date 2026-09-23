/**
 * GET  /api/admin/api-tokens  — list tokens for current user
 * POST /api/admin/api-tokens  — create a new token
 *
 * Scope selection (owner decision, 2026-09-23): the ADMIN-authenticated issuer
 * may choose from the system's allow-list (see
 * services/supabase/api-tokens.ts#ALLOWED_API_TOKEN_SCOPES) so a contractor
 * runtime can be given ["read","governance:propose"]. Clients never request
 * scopes: this route is the only place the field is read, it requires an admin
 * session, and anything outside the allow-list is rejected before any DB write.
 */

import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { listTokensForEmail, createApiToken, validateApiTokenScopes } from "@/services/supabase/api-tokens"

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

    // Validate BEFORE createApiToken so an unallowed scope gets a clear 400
    // instead of a 500 from the service's own fail-closed guard.
    const requested = validateApiTokenScopes(body.scopes)
    if (!requested.ok) {
      return NextResponse.json(
        {
          error: "scope not allowed",
          rejected: requested.rejected,
          allowed: ["read", "governance:read", "governance:propose"],
        },
        { status: 400 },
      )
    }

    const token = await createApiToken(auth.email, label, requested.scopes)
    return NextResponse.json({ token }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
