import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import {
  getPartnerById,
  getDocumentsByPartner,
  getBusinessEventsByPartner,
} from "@/services/supabase/queries"
import { buildPartnerTimeline, buildPartnerSummary } from "@/engines/partner/timeline"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id } = await params

  try {
    const [partner, docs, events] = await Promise.all([
      getPartnerById(id),
      getDocumentsByPartner(id),
      getBusinessEventsByPartner(id),
    ])

    const timeline = buildPartnerTimeline(docs, events)
    const summary = buildPartnerSummary(partner, docs)

    return NextResponse.json({ summary, timeline })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ" },
      { status: 500 }
    )
  }
}
