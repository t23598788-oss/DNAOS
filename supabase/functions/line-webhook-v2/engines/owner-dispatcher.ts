// Owner Dispatcher / Exception Router (owner, 2026-07-27): "ถ้า Message หรือ
// Event เกิดจาก/ส่งหา User ID ของเฮีย ให้ถือว่าเป็น Owner Surface" — real
// gap found live: nothing in this codebase ever special-cased the owner's
// own LINE chat. line_profiles.role already supports an 'owner' value
// (migration 20260718000006) but the real row for เฮีย was tagged
// 'manager' until 20260727000003_owner_surface_and_partner_payable.sql
// fixed the data. This file is the one real place that answers "is this
// the owner's chat?" and routes the two real signals the owner asked for:
// anomaly alerts (reused/stale slip) and partner-payable approval requests
// (see project_partner_purchase_cascade memory — the outgoing mirror of
// the customer-incoming-payment cascade).
import { ResponseGateway } from "./response.ts"

let _ownerLineUserIdCache: string | null | undefined

export async function getOwnerLineUserId(supabase: any): Promise<string | null> {
  if (_ownerLineUserIdCache !== undefined) return _ownerLineUserIdCache
  const { data } = await supabase
    .from("line_profiles").select("line_user_id").eq("role", "owner").limit(1).maybeSingle()
  const resolved: string | null = data?.line_user_id ?? null
  _ownerLineUserIdCache = resolved
  return resolved
}

export async function isOwnerSurface(supabase: any, lineUserId: string | null): Promise<boolean> {
  if (!lineUserId) return false
  const ownerId = await getOwnerLineUserId(supabase)
  return ownerId !== null && ownerId === lineUserId
}

// Anomaly Detection routing: a reused/stale slip today only gets recorded
// silently in receipt_documents.error_th for a human to find later in
// /admin/relationships — nobody is actually told in real time. This pushes
// the same warning straight to the owner's own chat the moment it's found.
export async function alertOwnerAnomaly(supabase: any, text: string): Promise<void> {
  const ownerId = await getOwnerLineUserId(supabase)
  if (!ownerId) return
  await ResponseGateway.pushMessage(ownerId, `🚨 ตรวจพบความผิดปกติ:\n${text}`)
}

// Partner-Payable Event: a partner needs to be paid (they issued a real
// receipt/tax invoice TO the DNA OS company). Notify the owner with an
// acknowledge button — the real payment confirmation trigger is still the
// owner's own slip photo sent afterward in this same chat (see
// handlers/image.ts), not this button; the button only records that the
// owner has seen and accepted the request.
export async function requestPartnerPayableApproval(
  supabase: any,
  params: { partnerCompanyId: string | null; partnerName: string; partnerLineUserId: string | null; amount: number; description: string | null; businessEventId: string | null },
): Promise<{ id: string } | null> {
  const ownerId = await getOwnerLineUserId(supabase)
  if (!ownerId) return null

  const { data: row } = await supabase.from("partner_payable_requests").insert({
    partner_company_id: params.partnerCompanyId,
    partner_name: params.partnerName,
    partner_line_user_id: params.partnerLineUserId,
    amount: params.amount,
    description: params.description,
    business_event_id: params.businessEventId,
    status: "pending",
    owner_notified_at: new Date().toISOString(),
  }).select("id").single()
  if (!row) return null

  await ResponseGateway.pushWithQuickReply(
    ownerId,
    `💸 มีบิลต้องจ่ายออก\nพาร์ตเนอร์: ${params.partnerName}\nยอด: ${params.amount.toLocaleString()} บาท${params.description ? `\n${params.description}` : ""}\n\nโอนเสร็จแล้วส่งรูปสลิปมาในแชทนี้ได้เลยครับ ระบบจะยืนยันกับพาร์ตเนอร์และบันทึกต้นทุนให้อัตโนมัติ`,
    [{ type: "action", action: { type: "postback", label: "รับทราบ จะโอนให้", data: `OWNER_PAYABLE_ACK:${row.id}` } }],
  )

  return { id: row.id }
}

// Consensus step: called when the owner (a confirmed Owner Surface sender)
// sends a transfer_slip/payment_advice — finds the oldest still-open
// partner-payable request whose amount matches within +-5 THB, marks it
// paid_confirmed, and (best-effort) checks bank_notifications immediately
// in case the real outgoing-transfer email already landed (it can arrive
// before or after the slip photo — bank-email-sync's own reverse-match
// covers the "after" case for this same table).
export async function matchOwnerSlipToPartnerPayable(
  supabase: any,
  params: { amount: number; referenceNumber: string | null; lineEventId: string },
): Promise<{ id: string; partnerName: string; partnerLineUserId: string | null } | null> {
  const { data: pending } = await supabase
    .from("partner_payable_requests")
    .select("id, partner_name, partner_line_user_id, amount")
    .in("status", ["pending", "owner_acknowledged"])
    .order("created_at", { ascending: true })

  const match = (pending ?? []).find((r: any) => Math.abs(Number(r.amount) - params.amount) <= 5)
  if (!match) return null

  let bankEmailVerified = false
  if (params.referenceNumber) {
    const { data: bankMatch } = await supabase
      .from("bank_notifications").select("id, amount")
      .eq("reference_number", params.referenceNumber).limit(1).maybeSingle()
    if (bankMatch && Math.abs(Number(bankMatch.amount) - params.amount) <= 5) bankEmailVerified = true
  }

  await supabase.from("partner_payable_requests").update({
    status: bankEmailVerified ? "completed" : "paid_confirmed",
    paid_line_event_id: params.lineEventId,
    bank_email_verified: bankEmailVerified,
    completed_at: bankEmailVerified ? new Date().toISOString() : null,
  }).eq("id", match.id)

  if (match.partner_line_user_id) {
    await ResponseGateway.pushMessage(
      match.partner_line_user_id,
      `✅ โอนเงินยอด ${Number(match.amount).toLocaleString()} บาทให้เรียบร้อยแล้วครับ`,
    )
  }

  return { id: match.id, partnerName: match.partner_name, partnerLineUserId: match.partner_line_user_id }
}
