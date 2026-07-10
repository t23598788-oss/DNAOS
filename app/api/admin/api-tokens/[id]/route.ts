/**
 * DELETE /api/admin/api-tokens/[id]  — revoke a token (owner only)
 */

import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { revokeApiToken } from "@/services/supabase/api-tokens"

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  await revokeApiToken(id, auth.email)
  return NextResponse.json({ ok: true })
}
