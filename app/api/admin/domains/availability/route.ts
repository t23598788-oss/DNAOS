import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { checkAvailability } from "@/engines/domains/hostinger"

// Read-only — no gateway/Rule-72 needed, checking availability changes nothing.
export async function GET(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const domain = req.nextUrl.searchParams.get("domain")
  if (!domain) return NextResponse.json({ error: "ต้องระบุ domain" }, { status: 400 })

  const r = await checkAvailability(domain)
  if (!("ok" in r) || !r.ok) return NextResponse.json(r, { status: "stage" in r ? 503 : 502 })
  return NextResponse.json(r)
}
