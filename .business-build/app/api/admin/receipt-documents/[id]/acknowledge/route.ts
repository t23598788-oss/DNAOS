import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { ORG_CONTEXT_COOKIE, sanitizeOrgCookie } from "@/core/auth/orgContext"
import { isCompanyInScope } from "@/core/auth/orgScope"
import { resolveVerifiedScope } from "@/services/supabase/tenantAuthority"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { acknowledgePayment } from "@/gateway/payment-acknowledgement"

type Params = { params: Promise<{ id: string }> }

// Payment acknowledgement (BATCH 40) — manual/retry trigger for the
// post-confirm acknowledgement pipeline (select-or-create receipt doc +
// ledger summary + LINE push + delivery evidence). The confirm route runs the
// same helper automatically after a successful confirm; this endpoint exists
// so an ack can be issued or retried for an ALREADY confirmed receipt (e.g.
// the first real payment, or a send that failed at the provider).
export async function POST(_req: Request, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const orgCookie = sanitizeOrgCookie((await cookies()).get(ORG_CONTEXT_COOKIE)?.value ?? null)
  const scopeResult = await resolveVerifiedScope(supabase(), { auth, organizationId: orgCookie })
  if (!scopeResult.ok) {
    return NextResponse.json({ ok: false, code: scopeResult.code, error: scopeResult.reason }, { status: 403 })
  }
  const scope = scopeResult.scope

  const { id } = await params
  const { data: owned } = await supabase()
    .from("receipt_documents").select("id, customer_company_id").eq("id", id).maybeSingle()
  if (!owned || !isCompanyInScope(scope, owned.customer_company_id)) {
    return NextResponse.json({ ok: false, code: "RECEIPT_NOT_FOUND", error: "ไม่พบเอกสาร" }, { status: 404 })
  }
  const result = await acknowledgePayment({ receipt_document_id: id, actor: auth.email ?? auth.id })

  if (result.ok) return NextResponse.json(result)
  const status =
    result.code === "RECEIPT_NOT_FOUND" ? 404
    : result.code === "RECEIPT_NOT_CONFIRMED" ? 409
    : result.code === "ACK_NO_LINE_RECIPIENT" || result.code === "ACK_NO_COMPANY" ? 400
    : result.code === "ACK_SEND_FAILED" ? 502
    : 500
  return NextResponse.json(result, { status })
}
