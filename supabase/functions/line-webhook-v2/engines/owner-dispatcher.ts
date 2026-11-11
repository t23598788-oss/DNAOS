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
import { sendConnectExpenseCommand } from "../../_shared/connect-expense.ts"
import { markSupabaseBillingEventPaidViaConnect } from "../../_shared/connect-billing-event.ts"

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
//
// LANDED (D3 deferred work, owner 2026-09-24): the three monetary writes in
// this file (partner_payable_requests insert/transition + company_expenses
// insert) now go through the Connect expense bridge → engines/canonical/
// expense-write.ts (closed status vocabulary + row-filtered fail-closed
// transitions + canonical audit on every money-out row). No direct money
// write remains here — supabase_billing_events stays (chore status flip, not
// a money row). Census keeps provider monetary sites at the out-of-scope pair
// only (scripts/connect-boundary-census-test.ts).
export async function requestPartnerPayableApproval(
  supabase: any,
  params: { partnerCompanyId: string | null; partnerName: string; partnerLineUserId: string | null; amount: number; description: string | null; businessEventId: string | null },
): Promise<{ id: string } | null> {
  const ownerId = await getOwnerLineUserId(supabase)
  if (!ownerId) return null

  // P4/D3 (owner 2026-09-24): money-out row สร้างผ่าน Connect expense bridge →
  // engines/canonical/expense-write (status เริ่ม pending เสมอ + audit ทุกแถว) —
  // fail-closed: ไม่มีแถว = ไม่แจ้งเตือน (null contract เดิมตอน insert ล้มเหลว)
  const created = await sendConnectExpenseCommand("payable.request", {
    partner_company_id: params.partnerCompanyId,
    partner_name: params.partnerName,
    partner_line_user_id: params.partnerLineUserId,
    amount: params.amount,
    description: params.description,
    business_event_id: params.businessEventId,
  }, "system:line-owner-dispatcher")
  if (!created.ok || !created.data?.payable_id) {
    console.error(`[owner-dispatcher] PAYABLE_REQUEST_FAILED: ${created.error}`)
    return null
  }
  const row = { id: String(created.data.payable_id) }

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

  // P4/D3: status transition ผ่าน bridge (row-filtered fail-closed + audit) —
  // ของเดิม update error ถูกกลืนเงียบแล้ว flow ไปต่อ → คงพฤติกรรมเดิม (log ให้
  // เห็น ไม่หยุด flow) เพราะ expense+push ข้างล่างไม่ขึ้นกับผลลัพธ์นี้
  const settled = await sendConnectExpenseCommand("payable.transition", {
    payable_id: match.id,
    to: bankEmailVerified ? "completed" : "paid_confirmed",
    paid_line_event_id: params.lineEventId,
    bank_email_verified: bankEmailVerified,
  }, "system:line-owner-dispatcher")
  if (!settled.ok) console.error(`[owner-dispatcher] PAYABLE_TRANSITION_FAILED(${match.id}): ${settled.error}`)

  // Real gap, owner-reported 2026-07-31: "โอนแล้ว...นำค่าใช้จ่ายเข้าไปลง
  // บันทึกไว้ในค่าใช้จ่าย รายรับรายจ่ายของบริษัทซะ" — the owner's own slip
  // confirming a partner/bill payment is real evidence of a real company
  // cost, same standing as an internal-sender document (capability #11) —
  // record it into company_expenses here, the one real place this
  // confirmation happens, instead of only marking the request row done.
  const ownerLineUserId = await getOwnerLineUserId(supabase)
  // P4/D3: expense row ผ่าน bridge → canonical expense-write (+ audit) —
  // ของเดิม insert error ก็ถูกกลืนเงียบ → log แล้วไปต่อ เหมือนเดิมทุกประการ
  const expense = await sendConnectExpenseCommand("expense.record", {
    document_type: "partner_payable",
    amount: Number(match.amount),
    vendor_name: match.partner_name,
    expense_date: new Date().toISOString().slice(0, 10),
    submitted_by_line_user_id: ownerLineUserId ?? "unknown",
    submitted_by_name: "เฮีย (owner)",
    submitted_by_role: "owner",
  }, "system:line-owner-dispatcher")
  if (!expense.ok) console.error(`[owner-dispatcher] EXPENSE_RECORD_FAILED(${match.id}): ${expense.error}`)

  // Supabase billing events are one real kind of partner-payable request —
  // close the loop back to that table too, so its own status (pending →
  // owner_notified → paid) reflects the real outcome instead of staying
  // stuck at owner_notified forever once the slip lands.
  const billingUpdated = await markSupabaseBillingEventPaidViaConnect(match.id, "system:line-owner-dispatcher")
  if (!billingUpdated.ok) console.error(`[owner-dispatcher] BILLING_EVENT_UPDATE_FAILED(${match.id}): ${billingUpdated.error}`)

  if (match.partner_line_user_id) {
    await ResponseGateway.pushMessage(
      match.partner_line_user_id,
      `✅ โอนเงินยอด ${Number(match.amount).toLocaleString()} บาทให้เรียบร้อยแล้วครับ`,
    )
  }

  return { id: match.id, partnerName: match.partner_name, partnerLineUserId: match.partner_line_user_id }
}
