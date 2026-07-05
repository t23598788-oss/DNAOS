/**
 * DELETE /api/admin/api-tokens/[id]  — revoke a token (owner only)
 */

import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { revokeApiToken } from "@/lib/supabase/api-tokens"

async function getCurrentEmail(): Promise<string | null> {
  const cookieStore = await cookies()
  // admin_session = base64("email:timestamp") — ดู app/api/auth/login/route.ts
  const raw = cookieStore.get("admin_session")?.value
  if (!raw) return null
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf-8")
    return decoded.split(":")[0] ?? null
  } catch {
    return null
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const email = await getCurrentEmail()
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  await revokeApiToken(id, email)
  return NextResponse.json({ ok: true })
}
