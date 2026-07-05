import { NextRequest, NextResponse } from "next/server"
import {
  getPartnerById,
  getDocumentsByPartner,
  getBusinessEventsByPartner,
} from "@/lib/supabase/queries"
import { buildPartnerTimeline, buildPartnerSummary } from "@/lib/v3-engines/partner/timeline"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
