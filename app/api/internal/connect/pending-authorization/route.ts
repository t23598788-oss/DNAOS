import { NextResponse } from "next/server"
import {
  createPendingAuthorization,
  resolvePendingAuthorization,
} from "@/engines/canonical/authorization-write"

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
    if (command === "pending_authorization.create") {
      const p = (body.payload ?? {}) as Record<string, unknown>
      const companyId = str(p.company_id)
      const claimantLineUserId = str(p.claimant_line_user_id)
      const requestDescription = str(p.request_description)
      const responsibleLineUserId = str(p.responsible_line_user_id)
      if (!companyId || !claimantLineUserId || !requestDescription || !responsibleLineUserId) {
        return NextResponse.json({ ok: false, error: "field ไม่ครบ" }, { status: 400 })
      }
      const result = await createPendingAuthorization({
        company_id: companyId,
        claimant_line_user_id: claimantLineUserId,
        claimant_description: str(p.claimant_description),
        request_description: requestDescription,
        responsible_line_user_id: responsibleLineUserId,
        business_event_id: str(p.business_event_id),
        status: str(p.status) ?? "pending",
      })
      return NextResponse.json({ ok: true, data: result })
    }

    if (command === "pending_authorization.resolve") {
      const p = (body.payload ?? {}) as Record<string, unknown>
      const id = str(p.id)
      const status = str(p.status)
      if (!id || !status) {
        return NextResponse.json({ ok: false, error: "id and status are required" }, { status: 400 })
      }
      const result = await resolvePendingAuthorization(id, status)
      return NextResponse.json({ ok: true, data: result })
    }

    return NextResponse.json({ ok: false, error: `unknown command: ${String(command)}` }, { status: 400 })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "operation failed"
    return NextResponse.json({ ok: false, error: message }, { status: 422 })
  }
}
