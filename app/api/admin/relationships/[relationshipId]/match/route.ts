import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ANY_AUTHENTICATED } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { resolveExternalIdentity, linkExternalIdentity } from "@/engines/connect/identity"
import { denyUnscoped, isCompanyVisible, notFound, resolveAdminReadScope } from "@/app/api/admin/_lib/read-scope"

type Params = { params: Promise<{ relationshipId: string }> }

/** Which provider account this screen is matching — not a business identity authority. */
const PROVIDER = "line"

// "New customers never disappear" (owner, 2026-07-18) — the deliberate human
// action that promotes an unmatched messaging contact into a real relationship.
// Capability C (2026-09-23): the mapping is written through the canonical
// Connect identity model (engines/connect/identity.ts#linkExternalIdentity);
// no provider-shaped table is written any more. Still admin-triggered (Rule 72),
// never automatic.
//
// body: { companyId: string } to link to an existing company, OR
//       { newCompany: { name, phone?, taxId? } } to create one first.
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ANY_AUTHENTICATED)
  if (auth instanceof NextResponse) return auth

  const { relationshipId: lineUserId } = await params
  const body = await req.json().catch(() => ({}))
  const db = supabase()

  const ctx = await resolveAdminReadScope(auth)
  const denied = denyUnscoped(ctx)
  if (denied) return denied

  let companyId: string | undefined = body.companyId
  if (companyId && !isCompanyVisible(ctx, companyId)) return notFound()

  if (!companyId && body.newCompany?.name) {
    const { data: newCompany, error: createErr } = await db
      .from("companies")
      .insert({
        name: body.newCompany.name,
        phone: body.newCompany.phone || null,
        tax_id: body.newCompany.taxId || null,
        type: "customer",
        // New records created by an organization admin belong to that
        // organization. Platform-created rows stay unattributed (NULL), exactly
        // like the existing dataset — no retroactive assignment happens here.
        organization_id: ctx.scope.mode === "organization" ? ctx.scope.organizationIds[0] : null,
      })
      .select("id")
      .single()
    if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 })
    companyId = newCompany.id
  }

  if (!companyId) {
    return NextResponse.json({ error: "ต้องระบุ companyId หรือ newCompany.name" }, { status: 400 })
  }

  // Capability C (2026-09-23): identity mapping goes through the canonical
  // Connect model — the legacy company_line_links table is now a read-only
  // projection, so a direct write there is rejected by the database.
  const existing = await resolveExternalIdentity(db, { provider: PROVIDER, externalSubjectId: lineUserId })
  if (existing?.companyId) {
    return NextResponse.json({ error: `ผู้ติดต่อนี้จับคู่กับบริษัทอื่นอยู่แล้ว (${existing.companyId})` }, { status: 400 })
  }

  const link = await linkExternalIdentity(db, {
    provider: PROVIDER,
    externalSubjectId: lineUserId,
    companyId,
    actor: auth.email ?? auth.id ?? "admin",
  })
  if (!link.ok) return NextResponse.json({ error: link.error }, { status: 500 })

  return NextResponse.json({ ok: true, companyId })
}
