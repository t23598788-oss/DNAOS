import { NextRequest, NextResponse } from "next/server"
import { buildDebtNoticeDraft } from "@/lib/documents/debt-notice-draft"

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const draft = await buildDebtNoticeDraft(id)
  if (!draft) return NextResponse.json({ error: "ไม่พบข้อมูลลูกหนี้" }, { status: 404 })
  return NextResponse.json({ draft })
}
