import type { HandlerContext, LinePostbackEvent } from "../events/types.ts"
import { saveEvent } from "../events/store.ts"
import { ResponseGateway } from "../engines/response.ts"
import { handlePrintCopiesSelected, handlePrintPaymentMethodSelected } from "../engines/print-jobs.ts"
import { sendConnectEventCommand, CONNECT_PROVIDER } from "../../_shared/connect-event.ts"
import { sendConnectExpenseCommand } from "../../_shared/connect-expense.ts"

export async function handlePostback(ctx: HandlerContext): Promise<void> {
  const pb = (ctx.event as LinePostbackEvent).postback
  const data = pb?.data ?? ""

  const saved = await saveEvent(ctx.supabase, {
    event:     ctx.event,
    userId:    ctx.userId,
    groupId:   ctx.groupId,
    rawType:   "postback",
    rawText:   data,
    extracted: pb.params ? { params: pb.params } : undefined,
  })

  // Redelivered webhook — CONFIRM_JOB/CANCEL_JOB actually change job state,
  // so replaying them isn't just a noisy duplicate reply, it's a real risk.
  if (saved?.duplicate) return

  // Route postback data string to the correct action
  const [action, ...rest] = data.split(":")
  const payload = rest.join(":")

  // Owner-reported bug (2026-07-26): these buttons carried a fake ID and
  // did nothing real on confirm — payload is now the actual
  // business_events.id (see engines/quote-price.ts), so pressing the
  // button really does move the real record forward.
  if (action === "CONFIRM_JOB") {
    // Owner instruction (2026-07-26): "ระบบต้องเห็นสลิปจริงก่อนถึงสั่งรถ...
    // ถ้าระบบบอกให้ไปส่งแล้วไม่มีคนจ่ายเงิน ใครจะรับผิดชอบ" — confirming the
    // price is NOT the same as being safe to dispatch. This moves the
    // record to "awaiting_payment", not "confirmed" — a real transfer slip
    // matching quoted_amount (handled where transfer_slip/payment_advice
    // images are classified) is what actually clears it for dispatch.
    // Capability D: UNPROVEN_FROM_COMPATIBILITY_TRANSITION — the source does not
    // prove the from-state for a postback, so only the validated target state is
    // sent (no invented FROM→TO rule).
    await sendConnectEventCommand("business_event.transition", {
      event_id: payload, status: "awaiting_payment",
    }, `system:${CONNECT_PROVIDER}:postback`)
    const { data: ev } = await ctx.supabase
      .from("business_events").select("event_code, quoted_amount").eq("id", payload).maybeSingle()
    if (ctx.replyToken) {
      await ResponseGateway.replyText(
        ctx.replyToken,
        ev
          ? `รับทราบครับ ยืนยันใบเสนอราคา ${ev.event_code} แล้ว ยอด ${Number(ev.quoted_amount ?? 0).toLocaleString()} บาท\nรบกวนโอนเงินแล้วส่งรูปสลิปมาในแชทนี้ก่อนนะครับ ระบบจะตรวจสอบแล้วจัดรถให้ทันที (ยังไม่สั่งรถจนกว่าจะเห็นสลิปจริง)`
          : "ยืนยันแล้วครับ"
      )
    }
    return
  }

  if (action === "CANCEL_JOB") {
    await sendConnectEventCommand("business_event.transition", {
      event_id: payload, status: "cancelled",
    }, `system:${CONNECT_PROVIDER}:postback`)
    const { data: ev } = await ctx.supabase
      .from("business_events").select("event_code").eq("id", payload).maybeSingle()
    if (ctx.replyToken) {
      await ResponseGateway.replyText(
        ctx.replyToken,
        ev ? `❌ ยกเลิกใบเสนอราคา ${ev.event_code} แล้วครับ` : "ยกเลิกแล้วครับ"
      )
    }
    return
  }

  // Photocopy-shop-via-LINE (owner, 2026-07-25) — see engines/print-jobs.ts
  if (action === "PRINT_COPIES") {
    const [jobId, copiesStr] = rest
    await handlePrintCopiesSelected(ctx.supabase, {
      jobId, copies: parseInt(copiesStr, 10) || 1, replyToken: ctx.replyToken,
    })
    return
  }

  if (action === "PRINT_PAY") {
    const [jobId, method] = rest
    if (method === "cash" || method === "transfer") {
      await handlePrintPaymentMethodSelected(ctx.supabase, { jobId, method, replyToken: ctx.replyToken })
    }
    return
  }

  // Team collaboration without a LINE group (owner, 2026-07-26) — see
  // engines/authorization-check.ts. Only the real responsible contact
  // (company_line_links) ever sees these buttons, so pressing one IS the
  // human verification the whole feature exists for.
  if (action === "AUTH_APPROVE" || action === "AUTH_DENY") {
    const newStatus = action === "AUTH_APPROVE" ? "approved" : "denied"
    const { data: auth } = await ctx.supabase
      .from("pending_authorizations")
      .update({ status: newStatus, resolved_at: new Date().toISOString() })
      .eq("id", payload).eq("status", "pending")
      .select("claimant_line_user_id, request_description").maybeSingle()

    if (ctx.replyToken) {
      await ResponseGateway.replyText(
        ctx.replyToken,
        auth ? (newStatus === "approved" ? "รับทราบครับ อนุมัติแล้ว" : "รับทราบครับ ปฏิเสธคำขอนี้แล้ว") : "รายการนี้ถูกดำเนินการไปแล้วครับ"
      )
    }
    if (auth) {
      await ResponseGateway.pushMessage(
        auth.claimant_line_user_id,
        newStatus === "approved"
          ? `ผู้รับผิดชอบยืนยันแล้วครับ ดำเนินการต่อให้เลยครับ`
          : `ขอโทษครับ ผู้รับผิดชอบไม่ยืนยันคำขอนี้ ไม่สามารถดำเนินการให้ได้ครับ`
      )
    }
    return
  }

  // Owner Dispatcher — Partner-Payable acknowledge (owner, 2026-07-27): the
  // real payment confirmation trigger is still the owner's own slip photo
  // (handlers/image.ts, matchOwnerSlipToPartnerPayable) — this button only
  // records that the owner has seen and accepted the request.
  // LANDED (D3 deferred work, owner 2026-09-24): this payable ack now goes
  // through the Connect expense bridge → engines/canonical/expense-write
  // (row-filtered fail-closed transition + canonical audit).
  if (action === "OWNER_PAYABLE_ACK") {
    const ack = await sendConnectExpenseCommand("payable.transition", {
      payable_id: payload,
      to: "owner_acknowledged",
    }, "system:line-postback")
    if (ctx.replyToken) {
      // honest replies (P4b precedent): transition ไม่สำเร็จ = ไม่ตอบว่า "รับทราบ"
      const reply = ack.ok
        ? "รับทราบครับ โอนเสร็จส่งสลิปมาในแชทนี้ได้เลย"
        : ack.error?.startsWith("PAYABLE_TRANSITION_INVALID")
          ? "รายการนี้ถูกดำเนินการไปแล้วครับ"
          : "บันทึกข้อมูลไม่สำเร็จ ลองใหม่อีกครั้งครับ"
      await ResponseGateway.replyText(ctx.replyToken, reply)
      if (!ack.ok) console.error(`[postback] PAYABLE_ACK_FAILED(${payload}): ${ack.error}`)
    } else if (!ack.ok) {
      console.error(`[postback] PAYABLE_ACK_FAILED(${payload}): ${ack.error}`)
    }
    return
  }

  if (ctx.replyToken) {
    await ResponseGateway.replyText(ctx.replyToken, "รับทราบครับ")
  }
}
