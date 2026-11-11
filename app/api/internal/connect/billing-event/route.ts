import { NextResponse } from "next/server"
import { markSupabaseBillingEventPaid } from "@/engines/canonical/billing-event-write"

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null)

export async function POST(req: Request) {
  const secret = process.env.CONNECT_INTERNAL_SECRET
  if (!secret) return NextResponse.json({ ok: false, error: "CONNECT_INTERNAL_SECRET not configured" }, { status: 503 })
  if (req.headers.get("x-connect-internal-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "ไม่ได้รับอนุญาต" }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, error: "unparseable JSON body" }, { status: 400 })
  }

  const command = str(body.command)
  const actor = str(body.actor)
  if (!actor) return NextResponse.json({ ok: false, error: "actor is required" }, { status: 400 })

  try {
    if (command === "billing_event.mark_paid") {
      const p = (body.payload ?? {}) as Record<string, unknown>
      const partnerPayableRequestId = str(p.partner_payable_request_id)
      if (!partnerPayableRequestId) {
        return NextResponse.json({ ok: false, error: "partner_payable_request_id is required" }, { status: 400 })
      }
      await markSupabaseBillingEventPaid(partnerPayableRequestId)
      return NextResponse.json({ ok: true, data: { updated: true } })
    }
    return NextResponse.json({ ok: false, error: `unknown command: ${String(command)}` }, { status: 400 })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "operation failed"
    return NextResponse.json({ ok: false, error: message }, { status: 422 })
  }
}
