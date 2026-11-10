/**
 * /api/admin/rules/run — evaluate the rulebook for ONE event.
 *
 * Two uses, one code path (engines/rules/dispatch.ts):
 *
 *   1. The admin UI's "ทดสอบกฎ" button — dry run: resolve the roles and render
 *      the message, but push nothing. The result shows exactly who WOULD get it.
 *   2. A real event source (order created, truck delivered) — `live: true`
 *      actually sends through registry/communication and logs every attempt.
 *
 * `live: true` is opt-in on purpose: testing the rulebook must never message a
 * real customer by accident.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin } from "@/services/supabase/queries"
import { runRulesForEvent, type BusinessEvent } from "@/engines/rules"

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)

  const type = typeof body?.type === "string" ? body.type.trim().toUpperCase() : ""
  if (!type) return badRequest("ต้องระบุ type ของ event (เช่น EVENT_ORDER_CREATED)")

  const payload =
    body?.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? (body.payload as Record<string, unknown>)
      : {}

  const event: BusinessEvent = {
    type,
    payload,
    key: typeof body?.key === "string" && body.key.trim() ? body.key.trim() : null,
    occurredAt: new Date().toISOString(),
  }

  try {
    const result = await runRulesForEvent(event, {
      db: supabaseAdmin(),
      dryRun: body?.live !== true,
    })
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[rules/run] failed:", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
