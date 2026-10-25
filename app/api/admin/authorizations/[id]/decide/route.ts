import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { decideCapabilityAuthorization } from "@/engines/jobs/authorization-resume"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

type Params = { params: Promise<{ id: string }> }

// Owner approval decide (Phase 7). The decision comes from the body, but the
// ACTOR always comes from the authenticated session (never the request body) —
// a client cannot forge its own approval.
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const decision = body?.decision === "deny" ? "deny" : body?.decision === "approve" ? "approve" : null
  if (!decision) return NextResponse.json({ ok: false, error: "decision ต้องเป็น approve หรือ deny" }, { status: 400 })

  const expiresAt = typeof body?.expires_at === "string" && body.expires_at ? body.expires_at : null

  const result = await decideCapabilityAuthorization(
    { db: supabase() as never, rpc: (fn, args) => supabase().rpc(fn, args) as never },
    { requestId: id, decision, actorId: auth.id, expiresAt },
  )

  if (!result.ok) return NextResponse.json({ ok: false, error: result.error ?? "decide_failed" }, { status: result.error === "already_decided" ? 409 : 400 })
  return NextResponse.json(result)
}
