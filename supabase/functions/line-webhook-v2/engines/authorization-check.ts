// Team collaboration without a LINE group (owner, 2026-07-26) — see
// migration 20260726000003_pending_authorizations.sql for the full quote.
// Real fraud-prevention primitive: before a request gets fulfilled on
// behalf of a company/site this LINE user isn't already linked to,
// verify with the company's real linked contact (company_line_links —
// "คนแรกที่ทักมาจากบริษัทคือคนรับผิดชอบอัตโนมัติ") by pushing THEM a
// yes/no question in their own real chat. Never trusts the claimant's own
// words alone.
//
// Honest scope note: this checks one concrete, deterministic signal —
// an unlinked LINE user requesting delivery to a customer_sites row that
// belongs to a DIFFERENT, already-linked company. Detecting every possible
// phrasing of "so-and-so said I could order this" from free text is a
// separate, harder problem (would need the local-AI pipeline to extract a
// claimed-authorizer name/company) and is not wired in yet — noted here so
// nobody assumes broader coverage than what's real today.
import { ResponseGateway } from "./response.ts"

export interface SiteOwnershipCheck {
  needsAuthorization: boolean
  responsibleLineUserId?: string
  companyId?: string
}

export async function checkSiteOwnership(
  supabase: any,
  requesterLineUserId: string,
  destinationSiteId: string | null,
): Promise<SiteOwnershipCheck> {
  if (!destinationSiteId) return { needsAuthorization: false }

  const { data: site } = await supabase
    .from("customer_sites").select("customer_company_id").eq("id", destinationSiteId).maybeSingle()
  if (!site?.customer_company_id) return { needsAuthorization: false }

  const { data: requesterLink } = await supabase
    .from("company_line_links").select("company_id")
    .eq("line_user_id", requesterLineUserId).eq("company_id", site.customer_company_id).maybeSingle()
  if (requesterLink) return { needsAuthorization: false } // already the real linked contact for this company

  const { data: responsibleLink } = await supabase
    .from("company_line_links").select("line_user_id")
    .eq("company_id", site.customer_company_id).order("created_at", { ascending: true }).limit(1).maybeSingle()
  if (!responsibleLink) return { needsAuthorization: false } // no real linked contact to verify against yet

  return { needsAuthorization: true, responsibleLineUserId: responsibleLink.line_user_id, companyId: site.customer_company_id }
}

export async function requestAuthorization(
  supabase: any,
  params: {
    companyId: string
    claimantLineUserId: string
    claimantDescription: string | null
    requestDescription: string
    responsibleLineUserId: string
    businessEventId: string | null
  },
): Promise<{ id: string }> {
  const { data: row } = await supabase.from("pending_authorizations").insert({
    company_id: params.companyId,
    claimant_line_user_id: params.claimantLineUserId,
    claimant_description: params.claimantDescription,
    request_description: params.requestDescription,
    responsible_line_user_id: params.responsibleLineUserId,
    business_event_id: params.businessEventId,
    status: "pending",
  }).select("id").single()

  await ResponseGateway.pushWithQuickReply(
    params.responsibleLineUserId,
    `มีคนติดต่อเข้ามาแจ้งว่า ${params.claimantDescription ?? "ไม่ทราบชื่อ"} ${params.requestDescription} คุณเป็นคนอนุญาตเองใช่ไหมครับ?`,
    [
      { type: "action", action: { type: "postback", label: "ใช่ ผมอนุญาตเอง", data: `AUTH_APPROVE:${row.id}` } },
      { type: "action", action: { type: "postback", label: "ไม่ใช่ ไม่รู้จัก", data: `AUTH_DENY:${row.id}` } },
    ],
  )

  return { id: row.id }
}
