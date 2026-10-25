import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import {
  getPartnerById,
  getDocumentsByPartner,
  getBusinessEventsByPartner,
} from "@/services/supabase/queries"
import { buildPartnerTimeline, buildPartnerSummary } from "@/engines/partner/timeline"
import { denyUnscoped, isCompanyVisible, notFound, resolveAdminReadScope } from "@/app/api/admin/_lib/read-scope"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id } = await params

  const ctx = await resolveAdminReadScope(auth)
  const denied = denyUnscoped(ctx)
  if (denied) return denied
  if (!isCompanyVisible(ctx, id)) return notFound()

  try {
    const [partner, docs, events] = await Promise.all([
      getPartnerById(id, ctx.scope),
      getDocumentsByPartner(id, ctx.scope),
      getBusinessEventsByPartner(id, ctx.scope),
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
