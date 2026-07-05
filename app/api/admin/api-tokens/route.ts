/**
 * GET  /api/admin/api-tokens  — list tokens for current user
 * POST /api/admin/api-tokens  — create a new token
 */

import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { listTokensForEmail, createApiToken } from "@/lib/supabase/api-tokens"

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

export async function GET() {
  const email = await getCurrentEmail()
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tokens = await listTokensForEmail(email)
  // ซ่อน token จริง ยกเว้น created_at (UI ต้องการเพื่อแสดง คัดลอกตอนสร้างใหม่เท่านั้น)
  const safe = tokens.map(t => ({
    ...t,
    token: t.token, // คงไว้ — UI จะซ่อนด้วยตัวเอง (แสดงแค่ 8 chars แรก)
  }))
  return NextResponse.json({ tokens: safe })
}

export async function POST(req: NextRequest) {
  const email = await getCurrentEmail()
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const label = String(body.label ?? "").trim() || "default"

  const token = await createApiToken(email, label)
  return NextResponse.json({ token }, { status: 201 })
}
