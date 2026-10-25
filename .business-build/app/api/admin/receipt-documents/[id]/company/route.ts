import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { ORG_CONTEXT_COOKIE, sanitizeOrgCookie } from "@/core/auth/orgContext"
import { isCompanyInScope } from "@/core/auth/orgScope"
import { resolveVerifiedScope } from "@/services/supabase/tenantAuthority"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { assignReceiptCompany } from "@/engines/canonical/receipt-company-assignment"

// Receipt debtor assignment (BATCH 33) — the ONE approved write path for
// receipt_documents.customer_company_id when automatic identity resolution
// cannot decide (e.g. slips forwarded through an internal LINE account).
//
//   · Admin picks the debtor themselves from EXISTING companies/person rows
//     (companies.is_individual covers person debtors) — never from OCR,
//     never from a name-similarity guess.
//   · Gate: only status=ai_read (pre-confirm) receipts can be assigned —
//     a confirmed receipt already anchored money in the ledger.
//   · Writes through this route only + recordCanonicalAudit (who assigned)
//     — payment RPC / receipt-confirm-flow untouched: after assignment the
//     existing confirm button works unchanged.
//   · The auto backfill in receipt-reconcile-sweep remains the automatic
//     path (line identity based); this is the manual counterpart for rows
//     that path cannot resolve.

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const orgCookie = sanitizeOrgCookie((await cookies()).get(ORG_CONTEXT_COOKIE)?.value ?? null)
  const scopeResult = await resolveVerifiedScope(supabase(), { auth, organizationId: orgCookie })
  if (!scopeResult.ok) {
    return NextResponse.json({ ok: false, code: scopeResult.code, error: scopeResult.reason }, { status: 403 })
  }
  const scope = scopeResult.scope

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const companyId = typeof body?.customer_company_id === "string" ? body.customer_company_id.trim() : ""
  if (!companyId) {
    return NextResponse.json({ error: "ต้องระบุ customer_company_id จากบริษัท/บุคคลที่มีอยู่แล้ว", code: "COMPANY_REQUIRED" }, { status: 400 })
  }

  // Target company must belong to the verified org. The receipt's current owner,
  // if any, must also be in scope; an out-of-scope owner is treated as not found.
  if (!isCompanyInScope(scope, companyId)) {
    return NextResponse.json({ error: "ไม่พบบริษัทในองค์กรนี้", code: "COMPANY_NOT_IN_SCOPE" }, { status: 403 })
  }
  const { data: current, error: currentErr } = await supabase()
    .from("receipt_documents").select("id, customer_company_id").eq("id", id).maybeSingle()
  if (currentErr) return NextResponse.json({ error: currentErr.message }, { status: 500 })
  if (!current || (current.customer_company_id && !isCompanyInScope(scope, current.customer_company_id))) {
    return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 })
  }

  const result = await assignReceiptCompany({
    receipt_document_id: id,
    customer_company_id: companyId,
    actor: auth.email ?? auth.id,
    reason: "admin debtor assignment (manual)",
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status ?? 500 })
  }
  return NextResponse.json({ ok: true, customer_company_id: result.customer_company_id, company_name: result.company_name })
}
