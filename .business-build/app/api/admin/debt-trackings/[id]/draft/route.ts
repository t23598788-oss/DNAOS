import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { buildDebtNoticeDraft } from "@/engines/documents/debt-notice-draft"

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const draft = await buildDebtNoticeDraft(id)
  if (!draft) return NextResponse.json({ error: "ไม่พบข้อมูลลูกหนี้" }, { status: 404 })
  return NextResponse.json({ draft })
}
