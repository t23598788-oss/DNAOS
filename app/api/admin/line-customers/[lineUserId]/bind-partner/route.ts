// Admin binding route: link a LINE contact to a partner/customer business
// profile. The provider tier only reads and delegates — every identity write
// goes through engines/canonical/partner-binding-write.ts.
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { denyUnscoped, resolveAdminReadScope } from "@/app/api/admin/_lib/read-scope"
import { bindLineChannelToPartner } from "@/engines/canonical/partner-binding-write"

type Params = { params: Promise<{ lineUserId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth
  const ctx = await resolveAdminReadScope(auth)
  const denied = denyUnscoped(ctx)
  if (denied) return denied

  const { lineUserId } = await params
  const body = await req.json().catch(() => ({}))

  // The provider tier only reads and delegates: every business/identity write
  // (pit_profiles, partner_business_profiles, partner_channel_bindings,
  // identity_business_capabilities) belongs to the canonical writer, audited
  // with this admin as the actor.
  try {
    const result = await bindLineChannelToPartner({
      line_user_id: lineUserId,
      partner_profile_id: body.partner_profile_id ?? null,
      create: body.create ? { name: body.name ?? null } : null,
      actor: auth.id,
    })
    return NextResponse.json({
      ok: true,
      binding_id: result.binding_id,
      partner_profile_id: result.partner_profile_id,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "bind failed"
    const status = message.startsWith("PARTNER_PROFILE_REQUIRED") ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
