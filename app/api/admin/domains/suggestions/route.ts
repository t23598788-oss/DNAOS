import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { suggestDomains } from "@/engines/domains/hostinger"

// Read-only.
export async function GET(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const keyword = req.nextUrl.searchParams.get("keyword")
  if (!keyword) return NextResponse.json({ error: "ต้องระบุ keyword" }, { status: 400 })
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "10")

  const r = await suggestDomains(keyword, limit)
  if (!("ok" in r) || !r.ok) return NextResponse.json(r, { status: "stage" in r ? 503 : 502 })
  return NextResponse.json(r)
}
